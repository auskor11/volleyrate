// Season views over any set of games: per-player totals and rates, game-rating averages, and attendance.
import { computeStats, type StatKey } from './stats';
import { matchRatings } from './gameRating';
import { gameSetup } from './rotation';
import { isGuest, type Game } from './games';

/** Everyone who played in a game: anyone tagged touching the ball, or on the court / bench in the team setup. */
export function playedIn(g: Game): Set<string> {
  const out = new Set<string>();
  for (const r of g.rallies) if (r.st !== 'bad') for (const t of r.touches ?? []) if (!isGuest(t.p)) out.add(t.p);
  const s = gameSetup(g);
  if (s) for (const t of ['a', 'b'] as const) for (const p of [...s[t].pos, ...s[t].bench]) if (p && !isGuest(p) && p !== 'guest') out.add(p);
  return out;
}

export interface SeasonRow {
  id: string;
  sessions: number;
  games: number;
  n: Record<StatKey, number>;   // counts
  rating: number | null;        // average game rating
  mvps: number;
}

export function seasonTable(games: Game[]): SeasonRow[] {
  const stats = computeStats(games);
  const rows = new Map<string, SeasonRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) { r = { id, sessions: 0, games: 0, n: {} as Record<StatKey, number>, rating: null, mvps: 0 }; rows.set(id, r); }
    return r;
  };
  const days = new Map<string, Set<string>>();
  for (const g of games) for (const p of playedIn(g)) {
    row(p).games++;
    (days.get(p) ?? days.set(p, new Set()).get(p)!).add(g.date);
  }
  for (const [p, d] of days) row(p).sessions = d.size;
  for (const [id, s] of Object.entries(stats)) for (const [k, clips] of Object.entries(s)) row(id).n[k as StatKey] = clips.length;
  const sum = new Map<string, { t: number; c: number }>();
  for (const g of games) {
    const m = matchRatings(g);
    for (const r of m?.rows ?? []) {
      const x = sum.get(r.id) ?? { t: 0, c: 0 };
      x.t += r.score; x.c++; sum.set(r.id, x);
      if (r.medal === 'mvp') row(r.id).mvps++;
    }
  }
  for (const [id, x] of sum) row(id).rating = Math.round((x.t / x.c) * 10) / 10;
  return [...rows.values()];
}

/** Rates with a minimum number of tries (null below it). */
export const rate = (num: number, den: number, min: number) => (den >= min ? num / den : null);
export const grade = (n: Record<StatKey, number>, kind: 'pass' | 'set') => {
  const c3 = n[`${kind}3` as StatKey] ?? 0, c2 = n[`${kind}2` as StatKey] ?? 0, c1 = n[`${kind}1` as StatKey] ?? 0;
  return c1 + c2 + c3 >= 5 ? (3 * c3 + 2 * c2 + c1) / (c1 + c2 + c3) : null;
};

/** Who played each Saturday (games played that day), with streaks. */
export function attendance(games: Game[]) {
  const dates = [...new Set(games.map(g => g.date))].sort();
  const played: Record<string, Record<string, number>> = {};
  for (const g of games) for (const p of playedIn(g)) ((played[p] ??= {})[g.date] = (played[p][g.date] ?? 0) + 1);
  const streaks = Object.fromEntries(Object.entries(played).map(([p, by]) => {
    let cur = 0, best = 0, run = 0;
    for (const d of dates) { run = by[d] ? run + 1 : 0; best = Math.max(best, run); }
    for (let i = dates.length - 1; i >= 0 && by[dates[i]]; i--) cur++;
    return [p, { current: cur, best }];
  }));
  return { dates, played, streaks };
}
