// Court rotation: where everyone stands, who serves, and how that changes rally by rally.
// Games are two mixed teams playing real rotations; 'guest' marks a guest's spot.
//
// Positions are numbered the standard way, anticlockwise from back right: 1 (serves), 2 front right,
// 3 front middle, 4 front left, 5 back left, 6 back middle. pos[0] is position 1.
//
// Roles belong to court spots, set by where the spot starts: 1 OH, 2 S, 3 MB, 4 OH, 5 OPP, 6 L. A spot
// keeps its role as it rotates, so players who swap spots swap roles, and a sub takes over the role of
// the player they replace.
//
// After each rally: if the serving team won, nothing moves. Otherwise the other team wins the serve and
// rotates clockwise (2 → 1, 3 → 2 … 1 → 6), and its new position-1 player serves. The extra middle
// blocker (a sub marked as such) comes on for the libero when the libero's spot reaches the front row
// (5 → 4), serves when it gets to 1, and the libero comes back on as it moves to the back row (1 → 6).
// Other subs are made by the reviewer. Each rally's court is saved once it's tagged or edited, so a fix
// carries forward from there.
import type { Rally, Skill, Touch } from './games';
import type { Position } from './ratings';

export type Team = 'a' | 'b';
export const TEAMS: Team[] = ['a', 'b'];
export const other = (t: Team): Team => (t === 'a' ? 'b' : 'a');

/** Role of each spot by where it starts: position 1 OH, 2 S, 3 MB, 4 OH, 5 OPP, 6 L. */
export const START_ROLES: Position[] = ['OH', 'S', 'MB', 'OH', 'OPP', 'L'];

/**
 * One team. pos[0] = position 1 … pos[5] = position 6 ('' = nobody yet); roles[i] = role of the spot at
 * pos[i] (rotates with it); bench = subs, longest waiting first; mb = the sub who is the extra middle
 * blocker; libero = who to bring back when the extra middle goes off.
 */
export interface Side { pos: string[]; roles: Position[]; bench: string[]; mb?: string; libero?: string }
export interface CourtState { a: Side; b: Side; serving: Team; manual?: boolean }  // manual: changed by hand (a sub, a fix)
export type CourtSetup = CourtState;

export const emptySide = (): Side => ({ pos: ['', '', '', '', '', ''], roles: [...START_ROLES], bench: [] });

/** Courts saved before spots had roles get the starting roles. */
export const normSide = (s: Side): Side => (s.roles?.length === 6 ? s : { ...s, roles: [...START_ROLES] });
const norm = (c: CourtState): CourtState => ({ ...c, a: normSide(c.a), b: normSide(c.b) });

/** The role a player is playing at spot i (the extra middle plays middle when standing in for the libero). */
export const roleAt = (s: Side, i: number): Position => (s.roles[i] === 'L' && s.pos[i] && s.pos[i] === s.mb ? 'MB' : s.roles[i]);

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

const turn = <T,>(xs: T[], back = false): T[] => (back ? [xs[5], ...xs.slice(0, 5)] : [...xs.slice(1), xs[0]]);
/** Clockwise: the player at 2 moves to 1, 3 to 2 … 1 to 6 (each spot keeps its role). */
export const rotate = (s: Side): Side => ({ ...s, pos: turn(s.pos), roles: turn(s.roles) });
export const rotateBack = (s: Side): Side => ({ ...s, pos: turn(s.pos, true), roles: turn(s.roles, true) });

/** After a rotation: the extra middle and the libero trade places at the front-row and back-row lines. */
function liberoSwap(s: Side): Side {
  const i = s.roles.indexOf('L');
  if (i < 0 || !s.mb) return s;
  const swapIn = (on: string, off: string, extra: Partial<Side>): Side => ({
    ...s, ...extra,
    pos: s.pos.map((p, j) => (j === i ? on : p)),
    bench: [...s.bench.filter(b => b !== on), off],
  });
  // libero's spot just moved 5 → 4 (front row): the extra middle comes on
  if (i === 3 && s.pos[i] !== s.mb && s.bench.includes(s.mb)) return swapIn(s.mb, s.pos[i], { libero: s.pos[i] });
  // …and just moved 1 → 6 (back row, after serving): the libero comes back on
  if (i === 5 && s.pos[i] === s.mb && s.libero && s.bench.includes(s.libero)) return swapIn(s.libero, s.mb, {});
  return s;
}

/** Put player p at position 1 of their team (keeping everyone's order) and make that team serve. */
export function makeServer(c: CourtState, p: string): CourtState {
  for (const t of TEAMS) {
    const j = c[t].pos.indexOf(p);
    if (j >= 0) return { ...c, [t]: { ...c[t], pos: [...c[t].pos.slice(j), ...c[t].pos.slice(0, j)], roles: [...c[t].roles.slice(j), ...c[t].roles.slice(0, j)] }, serving: t };
  }
  return c;
}

/** The court after rally r, and who won it. */
function advance(c: CourtState, r: Rally): { next: CourtState; winner: Team | null } {
  let cur = c;
  // a tagged serve by someone else (games tagged before courts existed): line the rotation up with it
  const sv = r.touches?.[0];
  if (sv?.k === 'serve' && sv.p !== 'guest' && sv.p !== server(c)) cur = makeServer(c, sv.p);
  const winner = rallyWinner(cur, r);
  if (!winner || winner === cur.serving) return { next: cur, winner };
  return { next: { ...cur, [winner]: liberoSwap(rotate(cur[winner])), serving: winner }, winner };
}

export const courtOnly = (c: CourtState): CourtState => ({ a: normSide(c.a), b: normSide(c.b), serving: c.serving });
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
    const step = advance(state, rallies[i]);
    state = step.next;
    lastWinner = step.winner;
  }
  const sv = rallies[at]?.court;
  const saved = sv && { ...courtOnly(sv), ...(sv.manual ? { manual: true } : {}) };
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
    return { pos, roles: [...START_ROLES], bench: [...order.slice(6), ...ns] };
  };
  return { a: side(l.a, l.nonServing?.a), b: side(l.b, l.nonServing?.b), serving: 'a' };
}

/** The game's court setup (converting teams saved in older formats). */
export const gameSetup = (g: { court?: CourtSetup; lineup?: LegacyLineup }): CourtSetup | null =>
  g.court ? norm(g.court) : g.lineup ? fromLegacy(g.lineup) : null;
