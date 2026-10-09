// Attribute model: six categories, their attributes, and how each position weights the attributes.

export type Position = 'S' | 'OH' | 'OPP' | 'MB' | 'L';

export const POSITIONS: Record<Position, string> = {
  S: 'Setter',
  OH: 'Outside Hitter',
  OPP: 'Opposite',
  MB: 'Middle Blocker',
  L: 'Libero',
};

// Single-attribute categories use the category key as the attribute key.
export const CATEGORIES = [
  { key: 'attack', label: 'Attack', short: 'ATK', attrs: [['spiking', 'Spiking'], ['setting', 'Setting'], ['serving', 'Serving']] },
  { key: 'defence', label: 'Defence', short: 'DEF', attrs: [['blocking', 'Blocking'], ['receiving', 'Receiving']] },
  { key: 'gameIQ', label: 'Game Intelligence', short: 'IQ', attrs: [['positioning', 'Positioning'], ['adaptability', 'Adaptability'], ['reading', 'Reading']] },
  { key: 'consistency', label: 'Consistency', short: 'CON', attrs: [['consistency', 'Consistency']] },
  { key: 'physical', label: 'Physical', short: 'PHY', attrs: [['physical', 'Physical']] },
  { key: 'technique', label: 'Technique', short: 'TEC', attrs: [['technique', 'Technique']] },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];
export type Ratings = Partial<Record<string, number>>;

// Share of the overall each attribute contributes, per position (each row sums to 1).
// Weighting attributes rather than whole categories means a setter isn't marked down for spiking,
// and a libero isn't marked down for serving or blocking.
const WEIGHTS: Record<Position, Record<string, number>> = {
  S:   { setting: .30, serving: .06, spiking: .02, blocking: .05, receiving: .05, positioning: .07, adaptability: .07, reading: .08, consistency: .12, physical: .06, technique: .12 },
  OH:  { spiking: .20, setting: .02, serving: .08, blocking: .07, receiving: .18, positioning: .06, adaptability: .05, reading: .06, consistency: .10, physical: .08, technique: .10 },
  OPP: { spiking: .28, setting: .02, serving: .09, blocking: .14, receiving: .04, positioning: .06, adaptability: .05, reading: .06, consistency: .10, physical: .10, technique: .06 },
  MB:  { spiking: .18, setting: .01, serving: .07, blocking: .28, receiving: .02, positioning: .07, adaptability: .04, reading: .10, consistency: .08, physical: .10, technique: .05 },
  L:   { setting: .06, receiving: .34, positioning: .12, adaptability: .07, reading: .12, consistency: .12, physical: .07, technique: .10 },
};

/** Average of a category's rated attributes, or null if none are rated. */
export function categoryScore(r: Ratings, key: CategoryKey): number | null {
  const cat = CATEGORIES.find(c => c.key === key)!;
  const vals = cat.attrs.map(([k]) => r[k]).filter((v): v is number => typeof v === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Position-weighted overall; unrated attributes are left out and the rest re-weighted. */
export function overall(r: Ratings, pos: Position): number | null {
  let sum = 0, wsum = 0;
  for (const [k, w] of Object.entries(WEIGHTS[pos])) {
    const v = r[k];
    if (typeof v === 'number') { sum += v * w; wsum += w; }
  }
  return wsum >= 0.5 ? Math.round(sum / wsum) : null;  // need most of the weight rated
}

/** Attribute weights for a position, as whole percentages (for showing what matters most). */
export function weightsFor(pos: Position): Record<string, number> {
  return Object.fromEntries(Object.entries(WEIGHTS[pos]).map(([k, w]) => [k, Math.round(w * 100)]));
}

export function tier(ovr: number | null): 'gold' | 'silver' | 'bronze' | 'unrated' {
  if (ovr === null) return 'unrated';
  return ovr >= 80 ? 'gold' : ovr >= 70 ? 'silver' : 'bronze';
}
