// Serving rotation: from each team's serving order and the tagged rallies so far, predict who serves
// the next rally. Games are two mixed teams; 'guest' fills a guest's slot in a team's order.
//
// Volleyball rule: if the serving team wins the rally, the same player serves again; otherwise the
// other team wins the serve and its next player in order serves. Each tagged serve re-syncs the
// rotation, so a missed rally or a substitution only affects the prediction until it's corrected once.
import type { Rally, Skill, Touch } from './games';
import type { Position } from './ratings';

export type Team = 'a' | 'b';
export interface Lineup {
  a: string[]; b: string[];                    // serving order per team: player ids or 'guest'
  nonServing?: { a: string[]; b: string[] };   // on the team but not in the serving order (e.g. a libero)
  roles?: Record<string, Position>;            // each named player's role in this game
}

/** Both teams have a serving order, so tagging can start. */
export const lineupReady = (l?: Lineup): l is Lineup => !!l && l.a.length > 0 && l.b.length > 0;

const other = (t: Team): Team => (t === 'a' ? 'b' : 'a');

export function teamOf(l: Lineup, p: string): Team | null {
  if (p === 'guest') return null;
  const on = (t: Team) => l[t].includes(p) || !!l.nonServing?.[t].includes(p);
  return on('a') ? 'a' : on('b') ? 'b' : null;
}

// After a touch of this skill, does the next touch come from the other side (true), the same side
// (false), or can't we tell (null)? Blocks and "other" touches can go either way.
const CROSSES: Partial<Record<Skill, boolean>> = { serve: true, attack: true, receive: false, dig: false, set: false };

/** Team of every touch: named players are known; guests are inferred from neighbouring touches. */
function touchTeams(l: Lineup, ts: Touch[], servingGuess: Team | null): (Team | null)[] {
  const out = ts.map(t => teamOf(l, t.p));
  if (out[0] === null && servingGuess) out[0] = servingGuess;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < ts.length; i++) {  // forward
      const c = CROSSES[ts[i - 1].k];
      if (out[i] === null && out[i - 1] !== null && c !== undefined) out[i] = c ? other(out[i - 1]!) : out[i - 1];
    }
    for (let i = ts.length - 2; i >= 0; i--) {  // backward
      const c = CROSSES[ts[i].k];
      if (out[i] === null && out[i + 1] !== null && c !== undefined) out[i] = c ? other(out[i + 1]!) : out[i + 1];
    }
  }
  return out;
}

/** Which team won the rally, or null if the tags can't tell. */
export function rallyWinner(l: Lineup, r: Rally, servingGuess: Team | null = null): Team | null {
  if (!r.touches?.length || !r.end) return null;
  const t = touchTeams(l, r.touches, servingGuess)[r.end.i];
  if (!t) return null;
  return r.end.r === 'point' ? t : other(t);
}

interface State {
  serving: Team | null;          // team that served the last rally
  idx: Record<Team, number>;     // slot of each team's most recent server (-1 = hasn't served yet)
  winner: Team | null;           // who won the last rally
}

export interface ServerGuess { p: string; likely: boolean }

function slot(l: Lineup, t: Team, i: number): string | undefined {
  const order = l[t];
  return order.length ? order[((i % order.length) + order.length) % order.length] : undefined;
}

function guessesFor(s: State): { team: Team; i: number; likely: boolean }[] {
  if (!s.serving) {  // start of the game, or lost track: either team's next server
    return (['a', 'b'] as const).map(t => ({ team: t, i: s.idx[t] + 1, likely: false }));
  }
  const keep = { team: s.serving, i: s.idx[s.serving] };
  const swap = { team: other(s.serving), i: s.idx[other(s.serving)] + 1 };
  if (s.winner === null) return [{ ...keep, likely: false }, { ...swap, likely: false }];
  return s.winner === s.serving ? [{ ...keep, likely: true }, { ...swap, likely: false }] : [{ ...swap, likely: true }, { ...keep, likely: false }];
}

export interface ServerPrediction {
  guesses: ServerGuess[];      // most likely first; usually the rotation's pick + the alternative
  lastWinner: Team | null;     // who won the previous rally (null = couldn't tell, or first rally)
  first: boolean;              // first rally of the game: no previous result to go on
}

/**
 * Who serves rallies[at] (the live rallies of a game, in time order). Every tagged serve before it
 * re-syncs the rotation, so correcting a server restarts the cycle from that player.
 */
export function predictServer(l: Lineup, rallies: Rally[], at: number): ServerPrediction {
  let s: State = { serving: null, idx: { a: -1, b: -1 }, winner: null };
  for (let k = 0; k < at; k++) s = step(l, s, rallies[k]);
  const seen = new Set<string>();
  const guesses = guessesFor(s)
    .map(g => ({ p: slot(l, g.team, g.i), likely: g.likely }))
    .filter((g): g is ServerGuess => !!g.p && !seen.has(g.p) && !!seen.add(g.p));
  return { guesses, lastWinner: s.serving ? s.winner : null, first: at === 0 };
}

function step(l: Lineup, s: State, r: Rally): State {
  const serve = r.touches?.[0];
  if (!serve || serve.k !== 'serve') {
    // untagged rally: the serve still changed hands somehow, so we no longer know the result
    return { ...s, winner: null };
  }
  const teams = touchTeams(l, r.touches!, null);
  const cands = guessesFor(s);
  let team = teams[0];
  let i = -1;
  if (team) {
    const order = l[team];
    if (serve.p !== 'guest') i = order.indexOf(serve.p);
    else {  // a guest served for this team: the guest slot the rotation expects (or the next one)
      const g = cands.find(c => c.team === team && slot(l, c.team, c.i) === 'guest');
      if (g) i = g.i % order.length;
      else {
        const from = s.serving === team ? s.idx[team] : s.idx[team] + 1;
        for (let d = 0; d < order.length; d++) if (slot(l, team, from + d) === 'guest') { i = (from + d) % order.length; break; }
      }
    }
  } else {  // guest server and no named teammate to tell us the team: match the expected slots
    const g = cands.find(c => slot(l, c.team, c.i) === serve.p);
    if (g) { team = g.team; i = g.i % l[g.team].length; }
  }
  if (!team || i < 0) return { serving: null, idx: s.idx, winner: null };
  return { serving: team, idx: { ...s.idx, [team]: i }, winner: rallyWinner(l, r, team) };
}

/**
 * Did the serving side lose this rally (so the serve changed teams)? Worked out from the touches alone,
 * relative to the server: crossings flip sides, and a player is always on the same side. null = can't tell.
 */
function sideOut(r: Rally): boolean | null {
  const ts = r.touches;
  if (!ts?.length || !r.end || ts[0].k !== 'serve') return null;
  const rel: (number | null)[] = [0];  // 0 = server's side, 1 = the other side
  const seen = new Map<string, number>([[ts[0].p, 0]]);
  for (let i = 1; i < ts.length; i++) {
    const c = CROSSES[ts[i - 1].k];
    let v: number | null = c !== undefined && rel[i - 1] !== null ? rel[i - 1]! ^ (c ? 1 : 0) : null;
    if (ts[i].p !== 'guest' && seen.has(ts[i].p)) v = seen.get(ts[i].p)!;
    rel.push(v);
    if (v !== null && ts[i].p !== 'guest') seen.set(ts[i].p, v);
  }
  const e = rel[r.end.i];
  if (e === null) return null;
  const serverWon = r.end.r === 'point' ? e === 0 : e === 1;
  return !serverWon;
}

/**
 * Teams and serving orders read from already-tagged serves. Each side-out hands the serve to the other
 * team, so runs of serves alternate between the teams; each team's order is its servers up to the
 * first repeat.
 */
export function learnLineup(rallies: Rally[]): Lineup | null {
  const runs: string[] = [];
  let prev: Rally | null = null;
  for (const r of rallies) {
    const sv = r.touches?.[0];
    if (sv?.k !== 'serve') { prev = null; continue; }
    const last = runs[runs.length - 1];
    // a new server always means a side-out; the same name (two guests) only when the last rally says so
    const changed = last === undefined || last !== sv.p || (sv.p === 'guest' && prev !== null && sideOut(prev) === true);
    if (changed) runs.push(sv.p);
    prev = r;
  }
  const out: Lineup = { a: [], b: [] };
  const done = { a: false, b: false };
  runs.forEach((p, k) => {
    const t: Team = k % 2 ? 'b' : 'a';
    if (done[t]) return;
    if (p !== 'guest' && out[t].includes(p)) {
      done[t] = true;
      // the order started with guests: the same number at the end belong to the next time round
      const lead = out[t].indexOf(p);
      if (lead > 0 && out[t].slice(0, lead).every(x => x === 'guest')) out[t] = out[t].slice(0, out[t].length - lead);
    } else out[t].push(p);
  });
  return out.a.length + out.b.length >= 4 ? out : null;
}
