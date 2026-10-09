// Court rotation: where everyone stands, who serves, and how that changes rally by rally.
// Games are two mixed teams playing real rotations; 'guest' marks a guest's spot.
//
// Positions are numbered the standard way, anticlockwise from back right: 1 (serves), 2 front right,
// 3 front middle, 4 front left, 5 back left, 6 back middle. pos[0] is position 1.
//
// Roles belong to court spots. At the start of a set they are 1 OH1, 2 S, 3 MB, 4 OH2, 5 OPP, 6 L; a clip
// that starts mid-set is set up by saying which roles are at positions 1 and 2 (that pair fixes the rest).
// A spot keeps its role as it rotates, so players who swap spots swap roles, and a sub takes over the
// role of the player they replace.
//
// After each rally: if the serving team won, nothing moves. Otherwise the other team wins the serve and
// rotates clockwise (2 → 1, 3 → 2 … 1 → 6), and its new position-1 player serves.
//
// Libero (teams with an extra middle blocker on the bench): the two middle spots (MB and L) are opposite
// each other, so one is always in the back row. The libero plays for whichever middle is in the back
// row, except that the middle serves: when the back-row middle rotates to position 1 the libero comes
// off, and as soon as the team loses that serve the libero comes back on for him.
// A team of six with no subs has no libero: that spot plays middle. If it has a libero-type player
// (Darius) who doesn't play front court, he swaps with the other middle each time he rotates into the
// front row; if he does play front court, the rotation carries on as usual and he's shown as L/MB.
// Other subs are made by the reviewer. A rally only stores a court when the reviewer changes it by hand;
// every other rally's court is worked out from the setup and those changes, so fixes carry forward.
import type { Rally, Skill, Touch } from './games';
import type { Position } from './ratings';

export type Team = 'a' | 'b';
export const TEAMS: Team[] = ['a', 'b'];
export const other = (t: Team): Team => (t === 'a' ? 'b' : 'a');

/** Roles of positions 1–6 at the start of a set: OH1, S, MB, OH2, OPP, L. */
export const START_ROLES: Position[] = ['OH', 'S', 'MB', 'OH', 'OPP', 'L'];
export const ROLE_NAMES = ['OH1', 'S', 'MB', 'OH2', 'OPP', 'L'];

/** Spot roles k rotations into a set (k = 0: start of a set). Position 1 has ROLE_NAMES[k], 2 has ROLE_NAMES[k + 1]. */
export const rolesAt = (k: number): Position[] => START_ROLES.map((_, i) => START_ROLES[(i + k) % 6]);
/** Which rotation a set of spot roles is (0–5), or -1 if players have swapped spots keeping their roles. */
export const rotationOf = (roles: Position[]): number =>
  [0, 1, 2, 3, 4, 5].find(k => rolesAt(k).every((r, i) => r === roles[i])) ?? -1;

/**
 * One team. pos[0] = position 1 … pos[5] = position 6 ('' = nobody yet); roles[i] = role of the spot at
 * pos[i] (rotates with it); bench = subs, longest waiting first. mb = the extra middle blocker (a sub)
 * and lib = the libero, set up by the reviewer; mid = the middles who own the MB and L spots, worked out
 * at the first rally so the libero can stand in for whichever is in the back row.
 */
export interface Side {
  pos: string[]; roles: Position[]; bench: string[]; mb?: string; lib?: string; mid?: [string, string];
  l6?: string;        // six-player team: its libero-type player ('' = none)
  l6front?: boolean;  // …who plays front court too (otherwise he swaps with the other middle at the front row)
}

/** Players who normally stay in the back court; preselected as a six-player team's libero-type player. */
export const BACK_COURT_PLAYERS = ['darius'];
export interface CourtState { a: Side; b: Side; serving: Team; manual?: boolean }  // manual: changed by hand (a sub, a fix)
/** The court at the first rally, plus the score then (a clip may start mid-set). */
export interface CourtSetup extends CourtState { score?: { a: number; b: number } }

export const emptySide = (): Side => ({ pos: ['', '', '', '', '', ''], roles: [...START_ROLES], bench: [] });

/** Courts saved before spots had roles get the starting roles. */
export const normSide = (s: Side): Side => (s.roles?.length === 6 ? s : { ...s, roles: [...START_ROLES] });
const norm = (c: CourtState): CourtState => ({ ...c, a: normSide(c.a), b: normSide(c.b) });

/** The role a player is playing at spot i. */
export function roleAt(s: Side, i: number): string {
  const p = s.pos[i];
  if (p && s.l6 && p === s.l6) return s.l6front ? 'L/MB' : 'L';
  const middle = s.roles[i] === 'MB' || s.roles[i] === 'L';
  if (middle && s.mid) return p === s.lib ? 'L' : 'MB';  // libero system: whoever stands in a middle spot
  if (s.roles[i] !== 'L') return s.roles[i];
  if (p && p === s.mb) return 'MB';
  return s.bench.length ? 'L' : 'MB';         // six players, no subs: no libero
}

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
const CROSSES: Partial<Record<Skill, boolean>> = { serve: true, attack: true, free: true, receive: false, dig: false, set: false };

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

/** The bench without one occurrence of p (several guests can sit on a bench). */
const dropOne = (bench: string[], p: string) => { const i = bench.indexOf(p); return i < 0 ? bench : [...bench.slice(0, i), ...bench.slice(i + 1)]; };

const turn = <T,>(xs: T[], back = false): T[] => (back ? [xs[5], ...xs.slice(0, 5)] : [...xs.slice(1), xs[0]]);
/** Clockwise: the player at 2 moves to 1, 3 to 2 … 1 to 6 (each spot keeps its role). */
export const rotate = (s: Side): Side => ({ ...s, pos: turn(s.pos), roles: turn(s.roles) });
export const rotateBack = (s: Side): Side => ({ ...s, pos: turn(s.pos, true), roles: turn(s.roles, true) });

/** A six-player team's back-court player swaps with the middle opposite him whenever he reaches the front row. */
function backCourtSwap(s: Side): Side {
  if (!s.l6 || s.l6front) return s;
  const i = s.pos.indexOf(s.l6);
  if (i < 1 || i > 3) return s;
  const j = (i + 3) % 6;
  return { ...s, pos: s.pos.map((p, k) => (k === i ? s.pos[j] : k === j ? s.pos[i] : p)) };
}

/**
 * Put the libero in for the back-row middle, and the middles in the front row or serving. `serving` =
 * this team serves the next rally. Leaves the court alone if the reviewer has subbed someone else in.
 */
function liberoRule(s: Side, serving: boolean): Side {
  if (!s.mid || !s.lib) return s;
  const spots = [s.roles.indexOf('MB'), s.roles.indexOf('L')];
  if (spots.some(i => i < 0)) return s;
  const trio = [s.mid[0], s.mid[1], s.lib];
  // the two on court in the middle spots and the one on the bench must be exactly these three
  const now = spots.map(i => s.pos[i]);
  let rest = [...trio];
  for (const p of now) { const k = rest.indexOf(p); if (k < 0) return s; rest = [...rest.slice(0, k), ...rest.slice(k + 1)]; }
  const off = rest[0];
  if (!s.bench.includes(off)) return s;
  const want = spots.map((i, k) => (i >= 1 && i <= 3) || (i === 0 && serving) ? s.mid![k] : s.lib!);
  let left = [...trio];
  for (const p of want) { const k = left.indexOf(p); left = [...left.slice(0, k), ...left.slice(k + 1)]; }
  const newOff = left[0];
  if (newOff === off) return s;
  return {
    ...s,
    pos: s.pos.map((p, i) => (i === spots[0] ? want[0] : i === spots[1] ? want[1] : p)),
    bench: [...dropOne(s.bench, off), newOff],
  };
}

/**
 * At the first rally: work out which middle owns which middle spot. The setup has the libero and one
 * middle in the two middle spots (the other middle on the bench), or both middles on court.
 */
function withMiddles(s: Side): Side {
  const { mid: _m, ...base } = s;
  if (!s.mb) return base;
  const iM = s.roles.indexOf('MB'), iL = s.roles.indexOf('L');
  if (iM < 0 || iL < 0) return base;
  const lib = s.lib ?? (s.pos[iL] !== s.mb ? s.pos[iL] : undefined);
  if (!lib) return base;
  const oM = s.pos[iM], oL = s.pos[iL];
  const mid: [string, string] | null =
    s.bench.includes(lib) && oM !== lib && oL !== lib ? [oM, oL]
    : oL === lib && s.bench.includes(s.mb) ? [oM, s.mb]
    : oM === lib && s.bench.includes(s.mb) ? [s.mb, oL]
    : null;
  return mid ? { ...base, lib, mid } : base;
}

/** Put player p at position 1 of their team (keeping everyone's order) and make that team serve. */
export function makeServer(c: CourtState, p: string): CourtState {
  for (const t of TEAMS) {
    const j = c[t].pos.indexOf(p);
    if (j >= 0) return { ...c, [t]: { ...c[t], pos: [...c[t].pos.slice(j), ...c[t].pos.slice(0, j)], roles: [...c[t].roles.slice(j), ...c[t].roles.slice(0, j)] }, serving: t };
  }
  return c;
}

/**
 * After a hand-made rotation or a change of serving team: the libero and middles (and a six-player team's
 * back-court player) go where the rules put them, the same as after an automatic rotation.
 */
export const placeSpecialists = (c: CourtState): CourtState => ({
  ...c,
  a: liberoRule(backCourtSwap(c.a), c.serving === 'a'),
  b: liberoRule(backCourtSwap(c.b), c.serving === 'b'),
});

/** The court at the first rally: middles and libero placed for who serves first. */
export const startCourt = (c: CourtSetup): CourtState => {
  const n = courtOnly(c);
  const side = (t: Team) => liberoRule(withMiddles(backCourtSwap(n[t])), n.serving === t);
  return { ...n, a: side('a'), b: side('b') };
};

/** The court after rally r, and who won it. */
function advance(c: CourtState, r: Rally): { next: CourtState; winner: Team | null } {
  let cur = c;
  // a tagged serve by someone else (games tagged before courts existed): line the rotation up with it
  const sv = r.touches?.[0];
  if (sv?.k === 'serve' && sv.p !== 'guest' && sv.p !== server(c)) cur = makeServer(c, sv.p);
  const winner = rallyWinner(cur, r);
  if (!winner || winner === cur.serving) return { next: cur, winner };
  // side-out: the winners rotate and serve; the team that lost its serve gets its libero back
  const loser = other(winner);
  return {
    next: { ...cur, [winner]: liberoRule(backCourtSwap(rotate(cur[winner])), true), [loser]: liberoRule(cur[loser], false), serving: winner },
    winner,
  };
}

export interface ScoreRow { before: { a: number; b: number }; after: { a: number; b: number }; winner: Team | null }

/**
 * Running score: who won each rally (from its tags and the court that rally was played on) and the score
 * before and after it. Rallies whose result can't be told (untagged) don't change the score.
 */
export function scoreSheet(setup: CourtSetup, rallies: Rally[]): ScoreRow[] {
  let state = startCourt(setup);
  const sc = { a: setup.score?.a ?? 0, b: setup.score?.b ?? 0 };
  return rallies.map(r => {
    const h = handSet(r);
    const cur = h ? withDetails(h, state) : state;
    const { next, winner } = advance(cur, r);
    const before = { ...sc };
    if (winner) sc[winner]++;
    state = next;
    return { before, after: { ...sc }, winner };
  });
}

export const courtOnly = (c: CourtState): CourtState => ({ a: normSide(c.a), b: normSide(c.b), serving: c.serving });
export const sameCourt = (x: CourtState, y: CourtState) => JSON.stringify(courtOnly(x)) === JSON.stringify(courtOnly(y));

export interface CourtView {
  state: CourtState;        // the court for this rally: as saved, else worked out from earlier rallies
  derived: CourtState;      // what the rotation says it should be
  saved: boolean;           // the reviewer changed this rally's court by hand (a sub, a swap, a fix)
  manual: boolean;          // same as saved (kept for readability at call sites)
  mismatch: boolean;        // the hand-set court differs from what the rotation alone gives
  first: boolean;           // first rally: nothing to go on but the setup
  lastWinner: Team | null;  // who won the rally before (null = couldn't tell)
}

const handSet = (r?: Rally) => (r?.court?.manual ? r.court : undefined);

/**
 * A hand-set court, keeping the team details it doesn't record itself (courts saved before those details
 * existed): the extra middle, libero, middles and back-court player carry on from the worked-out court.
 */
function withDetails(hand: CourtState, from: CourtState): CourtState {
  const side = (t: Team): Side => {
    const h = normSide(hand[t]), f = from[t];
    return { ...h, ...(h.mb === undefined && f.mb ? { mb: f.mb } : {}), ...(h.lib === undefined && f.lib ? { lib: f.lib } : {}),
      ...(h.mid === undefined && f.mid ? { mid: f.mid } : {}), ...(h.l6 === undefined && f.l6 !== undefined ? { l6: f.l6, ...(f.l6front ? { l6front: true } : {}) } : {}) };
  };
  return { a: side('a'), b: side('b'), serving: hand.serving };
}

/** The court for rallies[at] (the live rallies of a game, in time order). */
export function courtFor(setup: CourtSetup, rallies: Rally[], at: number): CourtView {
  let state: CourtState = startCourt(setup);
  let lastWinner: Team | null = null;
  for (let i = 0; i < at; i++) {
    const h = handSet(rallies[i]);
    const step = advance(h ? withDetails(h, state) : state, rallies[i]);
    state = step.next;
    lastWinner = step.winner;
  }
  const sv = handSet(rallies[at]);
  const saved = sv && { ...withDetails(sv, state), manual: true };
  return {
    state: saved ?? state, derived: state, saved: !!saved, manual: !!saved,
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
