// Match ratings, Mobile Legends style: every player gets a 0–10 score for one game, the best player on the
// winning side is MVP (and the best on the losing side "MVP (lose)"), medals by score, and titles for the
// game's standouts. Separate from the player ratings: it never changes them. Maths in docs/ratings.md.
import { computeStats, type PlayerStats, type StatKey } from './stats';
import { gameSetup, scoreSheet, startCourt, teamOf, type Team } from './rotation';
import { isGuest, rallyResult, type Game } from './games';
import { sameTeamIn } from './stats';
import { useMemo } from 'react';
import { useGames } from './games';

// what each stat is worth (points scored = 1; errors = −1)
export const GAME_RATING = {
  plus: { kill: 1, ace: 1, blockpt: 1, setpt: 1, assist: 0.6, dig: 0.25, receive: 0.15, block: 0.15, free: 0.1 } as Partial<Record<StatKey, number>>,
  minus: { aerr: 1, serr: 1, rerr: 1, oerr: 1, blocked: 0.5 } as Partial<Record<StatKey, number>>,
  base: 6,          // an even game
  perPoint: 0.5,    // score per net point (per 50 rallies)
  winBonus: 0.5,
  medals: { gold: 7.5, silver: 6 },  // below silver: bronze
} as const;

export type Medal = 'mvp' | 'mvp-lose' | 'gold' | 'silver' | 'bronze';
export interface MatchRow {
  id: string;
  team: Team | null;
  score: number;        // 0–10, one decimal
  net: number;          // points scored and set up minus errors, before scaling
  medal: Medal;
  titles: string[];
  stats: PlayerStats;
}
export interface MatchResult { rows: MatchRow[]; winner: Team | null; final: { a: number; b: number } | null; rallies: number }

const TITLES: { k: StatKey; title: string }[] = [
  { k: 'kill', title: 'Most kills' }, { k: 'ace', title: 'Most aces' }, { k: 'blockpt', title: 'Most blocks' },
  { k: 'assist', title: 'Playmaker' }, { k: 'dig', title: 'Most digs' },
];

export function matchRatings(game: Game): MatchResult | null {
  const live = game.rallies.filter(r => r.st !== 'bad').sort((a, b) => a.s - b.s);
  const stats = computeStats([game]);
  const ids = Object.keys(stats).filter(id => !isGuest(id));
  if (!ids.length) return null;
  const setup = gameSetup(game);
  const sheet = setup ? scoreSheet(setup, live) : null;
  const final = sheet?.length ? sheet[sheet.length - 1].after : null;
  const winner: Team | null = final && final.a !== final.b ? (final.a > final.b ? 'a' : 'b') : null;
  const court = setup ? startCourt(setup) : null;
  const tagged = Math.max(1, live.filter(r => r.touches?.length && r.end).length);
  const n = (s: PlayerStats, k: StatKey) => s[k]?.length ?? 0;

  const rows: MatchRow[] = ids.map(id => {
    const s = stats[id];
    const plus = Object.entries(GAME_RATING.plus).reduce((t, [k, w]) => t + w * n(s, k as StatKey), 0);
    const minus = Object.entries(GAME_RATING.minus).reduce((t, [k, w]) => t + w * n(s, k as StatKey), 0);
    const net = plus - minus;
    const team = court ? teamOf(court, id) : null;
    const raw = GAME_RATING.base + GAME_RATING.perPoint * net * (50 / tagged) + (winner && team === winner ? GAME_RATING.winBonus : 0);
    return { id, team, score: Math.round(Math.min(10, Math.max(0, raw)) * 10) / 10, net, medal: 'bronze' as Medal, titles: [] as string[], stats: s };
  }).sort((a, b) => b.score - a.score || b.net - a.net);

  // medals: MVP for the best on the winning side, MVP (lose) for the best on the other; then by score
  const best = (t: Team) => rows.find(r => r.team === t);
  const mvp = winner ? best(winner) : rows[0];
  const mvpLose = winner ? best(winner === 'a' ? 'b' : 'a') : undefined;
  for (const r of rows) r.medal = r === mvp ? 'mvp' : r === mvpLose ? 'mvp-lose' : r.score >= GAME_RATING.medals.gold ? 'gold' : r.score >= GAME_RATING.medals.silver ? 'silver' : 'bronze';

  // titles: the game's leader in each stat (outright, at least 2), and a hot streak (3+ points in a row)
  for (const { k, title } of TITLES) {
    const top = [...rows].sort((a, b) => n(b.stats, k) - n(a.stats, k));
    if (top[0] && n(top[0].stats, k) >= 2 && n(top[0].stats, k) > n(top[1]?.stats ?? ({} as PlayerStats), k)) top[0].titles.push(title);
  }
  const same = sameTeamIn(game);
  let streakWho = '', streak = 0;
  const streaks: Record<string, number> = {};
  for (const r of live) {
    const res = rallyResult(r, same);
    const who = res?.good ? res.who : '';
    streak = who && who === streakWho ? streak + 1 : who ? 1 : 0;
    streakWho = who;
    if (who) streaks[who] = Math.max(streaks[who] ?? 0, streak);
  }
  for (const r of rows) if ((streaks[r.id] ?? 0) >= 3) r.titles.push(`${streaks[r.id]} in a row`);
  return { rows, winner, final, rallies: tagged };
}

export const MEDAL_LABEL: Record<Medal, string> = { mvp: 'MVP', 'mvp-lose': 'MVP', gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };

/** Every game's ratings (games with tagged touches), newest first. */
export function useMatchRatings(): { game: Game; result: MatchResult }[] | null {
  const games = useGames();
  return useMemo(() => games ? games.flatMap(g => { const result = matchRatings(g); return result ? [{ game: g, result }] : []; })
    .sort((a, b) => b.game.date.localeCompare(a.game.date) || b.game.title.localeCompare(a.game.title, undefined, { numeric: true })) : null, [games]);
}
