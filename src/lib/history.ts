// Ratings session by session: the rating model rebuilt as of each Saturday, so every player has an overall
// before their first session and after each one (used by the rating chart and the session recaps).
import { useMemo } from 'react';
import { buildModel, effectiveRatings, type EngineSettings } from './engine';
import { overall, type Position } from './ratings';
import { isApplied, useGames, type Game } from './games';
import { usePlayers, type Player } from './data';
import { useEngineSettings } from './rated';

export interface HistoryPoint { date: string | null; ovr: number | null; played: boolean }  // date null = starting ratings

export interface RatingHistory {
  sessions: string[];                              // dates with games that count, oldest first
  byPlayer: Record<string, HistoryPoint[]>;        // start, then one point per session
}

const counts = (g: Game) => isApplied(g) && g.rallies.some(r => r.st !== 'bad' && r.touches?.length && r.end);
const playedIn = (games: Game[]) => new Set(games.flatMap(g => g.rallies.flatMap(r => (r.touches ?? []).map(t => t.p))));

export function ratingHistory(games: Game[], players: Player[], settings: EngineSettings): RatingHistory {
  const sessions = [...new Set(games.filter(counts).map(g => g.date))].sort();
  const pos = (p: Player): Position => p.positions?.[0] ?? 'OH';
  const byPlayer: RatingHistory['byPlayer'] = Object.fromEntries(players.map(p => [p.id, [{ date: null, ovr: overall(p.ratings ?? {}, pos(p)), played: false }]]));
  for (const d of sessions) {
    const model = buildModel(games.filter(g => g.date <= d), settings);
    const played = playedIn(games.filter(g => g.date === d && counts(g)));
    for (const p of players) byPlayer[p.id].push({ date: d, ovr: overall(effectiveRatings({ ...p, ratings: p.ratings ?? {} }, model), pos(p)), played: played.has(p.id) });
  }
  return { sessions, byPlayer };
}

export function useRatingHistory(): RatingHistory | null {
  const games = useGames();
  const { players } = usePlayers();
  const settings = useEngineSettings();
  const key = JSON.stringify(settings);
  return useMemo(() => (games && players ? ratingHistory(games, players, settings) : null), [games, players, key]);  // eslint-disable-line react-hooks/exhaustive-deps
}

export const fmtDay = (d: string, long = false) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
