// Everyone's numbers from a set of games, computed with the app's own code (used by ratings-check.mjs).
import { DEFAULT_SETTINGS, buildModel, effectiveRatings, type EngineSettings } from '../src/lib/engine';
import { computeStats } from '../src/lib/stats';
import { overall } from '../src/lib/ratings';
import type { Game } from '../src/lib/games';
import type { Player } from '../src/lib/data';

export interface Data { games: Game[]; players: Player[]; settings: Partial<EngineSettings> | null }
export interface PlayerResult {
  name: string;
  position: string;
  overall: number | null;
  ratings: Record<string, number>;   // every attribute after experience + stats
  stats: Record<string, number>;     // every game stat count (kills, assists, aces, …)
}

export function compute(d: Data): Record<string, PlayerResult> {
  const settings = { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) };
  const model = buildModel(d.games, settings);
  const stats = computeStats(d.games);
  const out: Record<string, PlayerResult> = {};
  for (const p of d.players) {
    const player = { ...p, ratings: p.ratings ?? {} };
    const r = effectiveRatings(player, model);
    const position = p.positions?.[0] ?? 'OH';
    out[p.id] = {
      name: p.name, position, overall: overall(r, position),
      ratings: Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
      stats: Object.fromEntries(Object.entries(stats[p.id] ?? {}).map(([k, clips]) => [k, clips.length])),
    };
  }
  return out;
}
