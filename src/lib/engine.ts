// Stats → ratings. Each player's displayed rating = starting rating (players/{id}.ratings, from the
// team poll; admins can edit) + an adjustment from touch-tagged games for the attributes stats can measure.
//
//   adjustment = rate × (player's metric − frozen team benchmark) × attempts / (attempts + k)
//
// - Benchmark: the team's pooled metric over the first sessions holding 5 touch-tagged games, then fixed,
//   so everyone's ratings can rise as the team improves. Graded metrics (pass / set quality) start
//   later, so they count from the first sessions holding 5 games with grades.
// - Setting and Receiving each have two metrics; their adjustments add up.
// - Blocking is different: a bonus that only grows (beginners shouldn't lose rating for going up to
//   block). strength × (2 per block point + 0.5 per other block touch), errors 0, at most +15.
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

// What the measurable attributes are based on. `attr` = the attribute a metric adjusts; `rate` = rating
// points per percentage point; `graded` = built from optional quality grades (own benchmark start).
// Quality metrics put the 1–3 grade on a 0–100% scale: (average grade − 1) ÷ 2, so 1 = 0%, 2 = 50%, 3 = 100%.
export const METRICS = {
  spiking: { attr: 'spiking', label: 'Hitting efficiency', rate: 0.5, k: 25, graded: false, what: '(kills − attack errors − times blocked) ÷ attacks' },
  serving: { attr: 'serving', label: 'Serve efficiency', rate: 0.5, k: 25, graded: false, what: '(aces − serve errors) ÷ serves' },
  setting: { attr: 'setting', label: 'Set efficiency', rate: 0.4, k: 25, graded: false, what: '(assists + set-over points − set errors) ÷ sets' },
  setQuality: { attr: 'setting', label: 'Set quality', rate: 0.3, k: 25, graded: true, what: 'average grade of sets that weren\'t errors (good 3, OK 2, poor 1)' },
  receiving: { attr: 'receiving', label: 'Ball control', rate: 1.0, k: 25, graded: false, what: 'receives + digs without an error ÷ receives + digs' },
  passQuality: { attr: 'receiving', label: 'Pass quality', rate: 0.3, k: 25, graded: true, what: 'average grade of receives + digs that weren\'t errors (perfect 3, OK 2, poor 1)' },
  blocking: { attr: 'blocking', label: 'Block credit', rate: 0.5, k: 15, graded: false, what: '2 per block point + 0.5 per other block touch (errors 0), × strength, max +15' },
  consistency: { attr: 'consistency', label: 'Error rate', rate: -1.5, k: 25, graded: false, what: 'errors ÷ all touches (lower is better)' },
} as const;
export type MetricKey = keyof typeof METRICS;
/** Blocking bonus (no team comparison, never negative). */
export const BLOCK_CREDIT = { perPoint: 2, perTouch: 0.5, cap: 15 };
const blockCredit = (c: Counts) =>
  BLOCK_CREDIT.perPoint * c.blockPts + BLOCK_CREDIT.perTouch * Math.max(0, c.blocks - c.blockPts - c.blockErr);

/** Metrics that adjust an attribute (Setting and Receiving have two). */
export const metricsFor = (attr: string) => (Object.keys(METRICS) as MetricKey[]).filter(m => METRICS[m].attr === attr);

// Raw counts per player per game.
interface Counts {
  touches: number; errors: number;
  attacks: number; kills: number; aerr: number; blocked: number;
  serves: number; aces: number; serr: number;
  sets: number; assists: number; setErr: number; setPts: number;  // setPts: sets that went over and won the point
  ctrl: number; ctrlErr: number;          // receives + digs
  blocks: number; blockPts: number; blockErr: number;
  passQ: number; passN: number;           // sum and count of grades on non-error receives + digs
  setQ: number; setN: number;             // …and on non-error sets
}
const zero = (): Counts => ({
  touches: 0, errors: 0, attacks: 0, kills: 0, aerr: 0, blocked: 0, serves: 0, aces: 0, serr: 0,
  sets: 0, assists: 0, setErr: 0, setPts: 0, ctrl: 0, ctrlErr: 0, blocks: 0, blockPts: 0, blockErr: 0,
  passQ: 0, passN: 0, setQ: 0, setN: 0,
});

function gameCounts(g: Game): Record<string, Counts> {
  const out: Record<string, Counts> = {};
  const c = (p: string) => (out[p] ??= zero());
  const ATT: Partial<Record<Skill, keyof Counts>> = { attack: 'attacks', serve: 'serves', set: 'sets', block: 'blocks', receive: 'ctrl', dig: 'ctrl' };
  const ERR: Partial<Record<Skill, keyof Counts>> = { attack: 'aerr', serve: 'serr', set: 'setErr', block: 'blockErr', receive: 'ctrlErr', dig: 'ctrlErr' };
  const PT: Partial<Record<Skill, keyof Counts>> = { attack: 'kills', serve: 'aces', block: 'blockPts', set: 'setPts' };
  for (const r of g.rallies) {
    if (r.st === 'bad' || !r.touches?.length || !r.end) continue;
    const ts = r.touches;
    const erred = r.end.r === 'error' ? r.end.i : -1;
    ts.forEach((t, j) => {
      c(t.p).touches++;
      const a = ATT[t.k]; if (a) c(t.p)[a]++;
      // optional grades, on touches that weren't the rally-ending error (errors count elsewhere)
      if (t.q && j !== erred) {
        if (t.k === 'receive' || t.k === 'dig') { c(t.p).passQ += t.q; c(t.p).passN++; }
        if (t.k === 'set') { c(t.p).setQ += t.q; c(t.p).setN++; }
      }
    });
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
    case 'setting': return [(c.assists + c.setPts - c.setErr) / c.sets, c.sets];
    case 'setQuality': return [(c.setQ / c.setN - 1) / 2, c.setN];
    case 'passQuality': return [(c.passQ / c.passN - 1) / 2, c.passN];
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
  block?: { points: number; errors: number; touches: number };  // blocking only: raw counts behind the bonus
}

export interface RatingModel {
  settings: EngineSettings;
  gamesPlayed: Record<string, number>;  // tagged games each player has touches in
  taggedGames: Game[];          // games with touch-tagged rallies, oldest first
  benchmarkFrom: number;        // how many games the benchmark uses
  benchFrom: Partial<Record<MetricKey, number>>;  // …per metric (graded metrics start later)
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

  // frozen benchmark: whole team over the first N tagged games (for graded metrics: the first N games
  // with grades). Whole sessions only: every game dated on or before the date of the Nth game counts.
  const teamOf = (g: Record<string, Counts>) => { const t = zero(); Object.values(g).forEach(c => addInto(t, c)); return t; };
  const perTeam = per.map(teamOf);
  const benchFor = (k: MetricKey): [number | undefined, number] => {
    const idx = tagged.map((_, i) => i).filter(i => !METRICS[k].graded || metric(k, perTeam[i])[1] > 0);
    const cutoff = tagged[idx[Math.min(ENGINE.benchmarkGames, idx.length) - 1]]?.date;
    if (!cutoff) return [undefined, 0];
    const team = zero();
    let used = 0;
    tagged.forEach((g, i) => { if (g.date <= cutoff) { addInto(team, perTeam[i]); used++; } });
    const [v, n] = metric(k, team);
    return [n > 0 ? v : undefined, used];
  };
  const bench: RatingModel['bench'] = {};
  const benchFrom: RatingModel['benchFrom'] = {};
  for (const k of Object.keys(METRICS) as MetricKey[]) {
    const [v, used] = benchFor(k);
    if (v !== undefined) { bench[k] = v; benchFrom[k] = used; }
  }
  const nb = benchFrom.spiking ?? 0;

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
      if (k === 'blocking') {  // bonus only: weighted credit × strength, capped
        if (!(c.blocks > 0)) continue;
        const r = raw[p];
        (adj[p] ??= {}).blocking = {
          delta: Math.min(BLOCK_CREDIT.cap, settings.strength * blockCredit(c)),
          value: blockCredit(c), rawValue: blockCredit(r), bench: 0, attempts: c.blocks, rawAttempts: r.blocks, weight: 1,
          block: { points: r.blockPts, errors: r.blockErr, touches: r.blocks },
        };
        continue;
      }
      const b = bench[k];
      if (!(n > 0) || b === undefined) continue;
      const weight = n / (n + METRICS[k].k * settings.dataScale);
      (adj[p] ??= {})[k] = {
        delta: METRICS[k].rate * settings.strength * (v - b) * 100 * weight,
        value: v, rawValue: metric(k, raw[p])[0], bench: b, attempts: n, rawAttempts: metric(k, raw[p])[1], weight,
      };
    }
  }
  return { settings, gamesPlayed, taggedGames: tagged, benchmarkFrom: nb, benchFrom, bench, adj };
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
    const stats = metricsFor(k).reduce((sum, m) => sum + (model.adj[p.id]?.[m]?.delta ?? 0), 0);
    out[k] = Math.max(0, Math.min(99, Math.round(base + exp + stats)));
  }
  return out;
}
