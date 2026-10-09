// Court rotation: where everyone stands, who serves, and how that changes rally by rally.
// Games are two mixed teams playing real rotations; 'guest' marks a guest's spot.
//
// Positions are numbered the standard way, anticlockwise from back right: 1 (serves), 2 front right,
// 3 front middle, 4 front left, 5 back left, 6 back middle. pos[0] is position 1.
//
// After each rally: if the serving team won, nothing moves. Otherwise the other team wins the serve and
// rotates clockwise (2 → 1, 3 → 2 … 1 → 6), and its new position-1 player serves. A bench player with
// the same role as the one rotating into position 1 (e.g. the extra middle) comes on to serve in their
// place. Each rally's court is saved once it's tagged or edited, so a fix carries forward from there.
import type { Rally, Skill, Touch } from './games';
import type { Position } from './ratings';

export type Team = 'a' | 'b';
export const TEAMS: Team[] = ['a', 'b'];
export const other = (t: Team): Team => (t === 'a' ? 'b' : 'a');

/** One team: pos[0] = position 1 … pos[5] = position 6 ('' = nobody yet); bench = subs, longest waiting first. */
export interface Side { pos: string[]; bench: string[] }
export interface CourtState { a: Side; b: Side; serving: Team; manual?: boolean }  // manual: changed by hand (a sub, a fix)
export interface CourtSetup extends CourtState { roles: Record<string, Position> }

export const emptySide = (): Side => ({ pos: ['', '', '', '', '', ''], bench: [] });

/** Both teams have all six spots filled, so tagging can start. */
export const setupReady = (c?: CourtSetup | null): c is CourtSetup =>
  !!c && TEAMS.every(t => c[t].pos.length === 6 && c[t].pos.every(Boolean));

export const server = (c: CourtState) => c[c.serving].pos[0];

export function teamOf(c: CourtState, p: string): Team | null {
  if (p === 'guest' || !p) return null;
  return TEAMS.find(t => c[t].pos.includes(p) || c[t].bench.includes(p)) ?? null;
}

// After a touch of this skill, does the next touch come from the other side (true), the same side
// (false), or can't we tell (undefined)? Blocks and "other" touches can go either way.
const CROSSES: Partial<Record<Skill, boolean>> = { serve: true, attack: true, receive: false, dig: false, set: false };

/** Team of every touch: named players are known; guests are inferred from neighbouring touches. */
function touchTeams(c: CourtState, ts: Touch[]): (Team | null)[] {
  const out = ts.map(t => teamOf(c, t.p));
  if (out[0] === null && ts[0]?.k === 'serve') out[0] = c.serving;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < ts.length; i++) {  // forward
      const x = CROSSES[ts[i - 1].k];
      if (out[i] === null && out[i - 1] !== null && x !== undefined) out[i] = x ? other(out[i - 1]!) : out[i - 1];
    }
    for (let i = ts.length - 2; i >= 0; i--) {  // backward
      const x = CROSSES[ts[i].k];
      if (out[i] === null && out[i + 1] !== null && x !== undefined) out[i] = x ? other(out[i + 1]!) : out[i + 1];
    }
  }
  return out;
}

/** Which team won the rally, or null if the tags can't tell (or it isn't tagged). */
export function rallyWinner(c: CourtState, r: Rally): Team | null {
  if (!r.touches?.length || !r.end) return null;
  const t = touchTeams(c, r.touches)[r.end.i];
  if (!t) return null;
  return r.end.r === 'point' ? t : other(t);
}

/** Clockwise: the player at 2 moves to 1, 3 to 2 … 1 to 6. */
export const rotate = (s: Side): Side => ({ ...s, pos: [...s.pos.slice(1), s.pos[0]] });
export const rotateBack = (s: Side): Side => ({ ...s, pos: [s.pos[5], ...s.pos.slice(0, 5)] });

/** The bench player with the same role as the new position-1 player comes on to serve. */
function autoSub(s: Side, roles: Record<string, Position>): Side {
  const p = s.pos[0], r = roles[p];
  if (!r) return s;
  const i = s.bench.findIndex(b => roles[b] === r);
  if (i < 0) return s;
  const bench = [...s.bench];
  const [sub] = bench.splice(i, 1);
  return { pos: [sub, ...s.pos.slice(1)], bench: [...bench, p] };
}

/** Put player p at position 1 of their team (keeping everyone's order) and make that team serve. */
export function makeServer(c: CourtState, p: string): CourtState {
  for (const t of TEAMS) {
    const j = c[t].pos.indexOf(p);
    if (j >= 0) return { ...c, [t]: { ...c[t], pos: [...c[t].pos.slice(j), ...c[t].pos.slice(0, j)] }, serving: t };
  }
  return c;
}

/** The court after rally r, and who won it. */
function advance(c: CourtState, r: Rally, roles: Record<string, Position>): { next: CourtState; winner: Team | null } {
  let cur = c;
  // a tagged serve by someone else (games tagged before courts existed): line the rotation up with it
  const sv = r.touches?.[0];
  if (sv?.k === 'serve' && sv.p !== 'guest' && sv.p !== server(c)) cur = makeServer(c, sv.p);
  const winner = rallyWinner(cur, r);
  if (!winner || winner === cur.serving) return { next: cur, winner };
  return { next: { ...cur, [winner]: autoSub(rotate(cur[winner]), roles), serving: winner }, winner };
}

export const courtOnly = (c: CourtState): CourtState => ({ a: c.a, b: c.b, serving: c.serving });
export const sameCourt = (x: CourtState, y: CourtState) => JSON.stringify(courtOnly(x)) === JSON.stringify(courtOnly(y));

export interface CourtView {
  state: CourtState;        // the court for this rally: as saved, else worked out from earlier rallies
  derived: CourtState;      // what the rotation says it should be
  saved: boolean;           // a reviewer saved (tagged or edited) this rally's court
  manual: boolean;          // …and changed it by hand (a sub or a fix), so differing from the rotation is expected
  mismatch: boolean;        // saved court differs from the rotation (an earlier rally may have changed)
  first: boolean;           // first rally: nothing to go on but the setup
  lastWinner: Team | null;  // who won the rally before (null = couldn't tell)
}

/** The court for rallies[at] (the live rallies of a game, in time order). */
export function courtFor(setup: CourtSetup, rallies: Rally[], at: number): CourtView {
  let k = at - 1;
  while (k >= 0 && !rallies[k].court) k--;
  let state: CourtState = courtOnly(k >= 0 ? rallies[k].court! : setup);
  let lastWinner: Team | null = null;
  for (let i = Math.max(k, 0); i < at; i++) {
    const step = advance(state, rallies[i], setup.roles);
    state = step.next;
    lastWinner = step.winner;
  }
  const saved = rallies[at]?.court;
  return {
    state: saved ?? state, derived: state, saved: !!saved, manual: !!saved?.manual,
    mismatch: !!saved && !sameCourt(saved, state), first: at === 0, lastWinner,
  };
}

// Teams entered before the court view: serving order lists → positions 1–6 + bench.
export interface LegacyLineup { a: string[]; b: string[]; nonServing?: { a: string[]; b: string[] }; roles?: Record<string, Position> }

export function fromLegacy(l: LegacyLineup): CourtSetup {
  const side = (order: string[], ns: string[] = []): Side => {
    const pos = order.slice(0, 6);
    while (pos.length < 6) pos.push('');
    return { pos, bench: [...order.slice(6), ...ns] };
  };
  return { a: side(l.a, l.nonServing?.a), b: side(l.b, l.nonServing?.b), serving: 'a', roles: l.roles ?? {} };
}

/** The game's court setup (converting teams saved in the older list format). */
export const gameSetup = (g: { court?: CourtSetup; lineup?: LegacyLineup }): CourtSetup | null =>
  g.court ?? (g.lineup ? fromLegacy(g.lineup) : null);
