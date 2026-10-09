// Stats → ratings. Each player's displayed rating = starting rating (players/{id}.ratings, from the
// team poll; admins can edit) + an adjustment from touch-tagged games for the attributes stats can measure.
//
//   adjustment = rate × (player's metric − frozen team benchmark) × attempts / (attempts + k)
//
// - Benchmark: the team's pooled metric over the first sessions holding 5 touch-tagged games, then fixed,
//   so everyone's ratings can rise as the team improves.
// - Recent sessions count more: a session's weight halves every 8 sessions (all games on one date equal).
// - Only rallies tagged touch-by-touch (with a result) count; quick point tags lack attempt counts.
// - No caps beyond the 0–99 scale.
import { forcedBy, gameWeight, isApplied, type Game, type Skill } from './games';
import type { Player } from './data';
import type { Ratings } from './ratings';

export const ENGINE = {
  benchmarkGames: 5,     // benchmark = every game from the sessions (dates) that contain the first 5 games
  halfLifeSessions: 8,   // a session's (date's) weight halves every 8 sessions; same-day games weigh the same
};

// Admin-tunable (config/ratingsEngine): strength multiplies every rate; dataScale multiplies every k
// (smaller = fewer attempts needed before stats count fully).
// expPerGame / expMax: experience bonus added to every attribute for each tagged game a player took part in.
export interface EngineSettings { strength: number; dataScale: number; expPerGame: number; expMax: number }
export const DEFAULT_SETTINGS: EngineSettings = { strength: 1.6, dataScale: 0.4, expPerGame: 1.5, expMax: 20 };

// A receive / dig error straight after the other side's serve, attack or block is hard to avoid:
// it counts this much against Receiving and Consistency (the attacker still gets full credit).
export const FORCED_ERROR_WEIGHT = 0.5;

// What each measurable attribute is based on. `rate` = rating points per percentage point.
export const METRICS = {
  spiking: { label: 'Hitting efficiency', rate: 0.5, k: 25, what: '(kills − attack errors − times blocked) ÷ attacks' },
  serving: { label: 'Serve efficiency', rate: 0.5, k: 25, what: '(aces − serve errors) ÷ serves' },
  setting: { label: 'Set efficiency', rate: 0.4, k: 25, what: '(assists − set errors) ÷ sets' },
  receiving: { label: 'Ball control', rate: 1.0, k: 25, what: 'receives + digs without an error ÷ receives + digs' },
  blocking: { label: 'Block efficiency', rate: 0.5, k: 15, what: '(block points − block errors) ÷ block touches' },
  consistency: { label: 'Error rate', rate: -1.5, k: 25, what: 'errors ÷ all touches (lower is better)' },
} as const;
export type MetricKey = keyof typeof METRICS;

// Raw counts per player per game.
interface Counts {
  touches: number; errors: number;
  attacks: number; kills: number; aerr: number; blocked: number;
  serves: number; aces: number; serr: number;
  sets: number; assists: number; setErr: number;
  ctrl: number; ctrlErr: number;          // receives + digs
  blocks: number; blockPts: number; blockErr: number;
}
const zero = (): Counts => ({
  touches: 0, errors: 0, attacks: 0, kills: 0, aerr: 0, blocked: 0, serves: 0, aces: 0, serr: 0,
  sets: 0, assists: 0, setErr: 0, ctrl: 0, ctrlErr: 0, blocks: 0, blockPts: 0, blockErr: 0,
});

function gameCounts(g: Game): Record<string, Counts> {
  const out: Record<string, Counts> = {};
  const c = (p: string) => (out[p] ??= zero());
  const ATT: Partial<Record<Skill, keyof Counts>> = { attack: 'attacks', serve: 'serves', set: 'sets', block: 'blocks', receive: 'ctrl', dig: 'ctrl' };
  const ERR: Partial<Record<Skill, keyof Counts>> = { attack: 'aerr', serve: 'serr', set: 'setErr', block: 'blockErr', receive: 'ctrlErr', dig: 'ctrlErr' };
  const PT: Partial<Record<Skill, keyof Counts>> = { attack: 'kills', serve: 'aces', block: 'blockPts' };
  for (const r of g.rallies) {
    if (r.st === 'bad' || !r.touches?.length || !r.end) continue;
    const ts = r.touches;
    for (const t of ts) {
      c(t.p).touches++;
      const a = ATT[t.k]; if (a) c(t.p)[a]++;
    }
    const t = ts[r.end.i], prev = ts[r.end.i - 1];
    if (!t) continue;
    const credit = (i: number) => {  // point for touch i (+ assist / blocked bookkeeping)
      const x = ts[i], before = ts[i - 1];
      const pk = PT[x.k]; if (pk) c(x.p)[pk]++;
      if (x.k === 'attack' && before?.k === 'set' && before.p !== x.p) c(before.p).assists++;
    };
    if (r.end.r === 'point') {
      credit(r.end.i);
      if (t.k === 'block' && prev?.k === 'attack' && prev.p !== t.p) c(prev.p).blocked++;
    } else {
      const f = forcedBy(ts, r.end);
      const w = f >= 0 && (t.k === 'receive' || t.k === 'dig') ? FORCED_ERROR_WEIGHT : 1;
      c(t.p).errors += w;
      const ek = ERR[t.k]; if (ek) c(t.p)[ek] += w;
      if (f >= 0) credit(f);
    }
  }
  delete out.guest;
  return out;
}

// metric value (fraction) and attempts from counts
function metric(k: MetricKey, c: Counts): [number, number] {
  switch (k) {
    case 'spiking': return [(c.kills - c.aerr - c.blocked) / c.attacks, c.attacks];
    case 'serving': return [(c.aces - c.serr) / c.serves, c.serves];
    case 'setting': return [(c.assists - c.setErr) / c.sets, c.sets];
    case 'receiving': return [1 - c.ctrlErr / c.ctrl, c.ctrl];
    case 'blocking': return [(c.blockPts - c.blockErr) / c.blocks, c.blocks];
    case 'consistency': return [c.errors / c.touches, c.touches];
  }
}

function addInto(a: Counts, b: Counts, w = 1) {
  for (const key of Object.keys(a) as (keyof Counts)[]) a[key] += b[key] * w;
}

export interface Adjustment {
  delta: number;        // rating points added to the starting rating
  value: number;        // player's metric used for the rating (fraction, weighted by recency + game strength)
  rawValue: number;     // the same metric from plain counts (no weighting)
  bench: number;        // frozen team benchmark (fraction)
  attempts: number;     // recency-weighted attempts
  rawAttempts: number;  // unweighted attempts
  weight: number;       // attempts / (attempts + k)
}

export interface RatingModel {
  settings: EngineSettings;
  gamesPlayed: Record<string, number>;  // tagged games each player has touches in
  taggedGames: Game[];          // games with touch-tagged rallies, oldest first
  benchmarkFrom: number;        // how many games the benchmark uses
  bench: Partial<Record<MetricKey, number>>;
  adj: Record<string, Partial<Record<MetricKey, Adjustment>>>;  // player → attribute → adjustment
}

/**
 * `preview` treats one game as applied with the given per-player strengths (or not applied when null),
 * to show what applying / undoing it would do.
 */
export function buildModel(
  games: Game[], settings: EngineSettings = DEFAULT_SETTINGS,
  preview?: { gameId: string; weights: Record<string, number> | null },
): RatingModel {
  if (preview) games = games.map(g => g.id !== preview.gameId ? g
    : { ...g, rating: { applied: !!preview.weights, weights: preview.weights ?? undefined } });
  const tagged = games
    .filter(g => isApplied(g) && g.rallies.some(r => r.st !== 'bad' && r.touches?.length && r.end))
    .sort((a, b) => a.date.localeCompare(b.date));
  const per = tagged.map(gameCounts);

  // frozen benchmark: whole team over the first N tagged games
  // whole sessions only: include every game dated on or before the date of the Nth game
  const cutoff = tagged[Math.min(ENGINE.benchmarkGames, tagged.length) - 1]?.date;
  const nb = cutoff ? tagged.filter(g => g.date <= cutoff).length : 0;
  const team = zero();
  per.slice(0, nb).forEach(g => Object.values(g).forEach(c => addInto(team, c)));
  const bench: RatingModel['bench'] = {};
  for (const k of Object.keys(METRICS) as MetricKey[]) {
    const [v, n] = metric(k, team);
    if (n > 0) bench[k] = v;
  }

  // recency-weighted totals per player
  const sessions = [...new Set(tagged.map(g => g.date))].sort();
  const weighted: Record<string, Counts> = {}, raw: Record<string, Counts> = {};
  const gamesPlayed: Record<string, number> = {};
  per.forEach((g, i) => {
    for (const p of Object.keys(g)) gamesPlayed[p] = (gamesPlayed[p] ?? 0) + gameWeight(tagged[i], p);
    const age = sessions.length - 1 - sessions.indexOf(tagged[i].date);  // sessions since this game's date
    const w = Math.pow(0.5, age / ENGINE.halfLifeSessions);
    for (const [p, c] of Object.entries(g)) {
      const gw = gameWeight(tagged[i], p);  // admin-chosen strength of this game for this player
      if (gw <= 0) continue;
      addInto(weighted[p] ??= zero(), c, w * gw);
      addInto(raw[p] ??= zero(), c);
    }
  });

  const adj: RatingModel['adj'] = {};
  for (const [p, c] of Object.entries(weighted)) {
    for (const k of Object.keys(METRICS) as MetricKey[]) {
      const [v, n] = metric(k, c);
      const b = bench[k];
      if (!(n > 0) || b === undefined) continue;
      const weight = n / (n + METRICS[k].k * settings.dataScale);
      (adj[p] ??= {})[k] = {
        delta: METRICS[k].rate * settings.strength * (v - b) * 100 * weight,
        value: v, rawValue: metric(k, raw[p])[0], bench: b, attempts: n, rawAttempts: metric(k, raw[p])[1], weight,
      };
    }
  }
  return { settings, gamesPlayed, taggedGames: tagged, benchmarkFrom: nb, bench, adj };
}

/** Experience bonus for a player: per tagged game played, up to the maximum. */
export function experience(playerId: string, model: RatingModel): number {
  const { expPerGame, expMax } = model.settings;
  return Math.min(expMax, expPerGame * (model.gamesPlayed[playerId] ?? 0));
}

/** Starting ratings + experience + stats adjustments, rounded and kept on the 0–99 scale. */
export function effectiveRatings(p: Player, model: RatingModel): Ratings {
  const out: Ratings = {};
  const exp = experience(p.id, model);
  for (const [k, base] of Object.entries(p.ratings)) {
    if (typeof base !== 'number') continue;
    const a = model.adj[p.id]?.[k as MetricKey];
    out[k] = Math.max(0, Math.min(99, Math.round(base + exp + (a?.delta ?? 0))));
  }
  return out;
}
