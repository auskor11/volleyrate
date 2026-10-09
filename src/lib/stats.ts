import { forcedBy, type Game, type Rally, type Skill, type Touch } from './games';

export type StatKey =
  | 'serve' | 'ace' | 'serr'
  | 'receive' | 'rerr'
  | 'set' | 'assist'
  | 'attack' | 'kill' | 'aerr' | 'blocked'
  | 'block' | 'blockpt'
  | 'dig'
  | 'free'
  | 'tip' | 'tipkill' | 'roll' | 'rollkill'
  | 'pass3' | 'pass2' | 'pass1'
  | 'set3' | 'set2' | 'set1'
  | 'oerr';

export const STAT_LABELS: Record<StatKey, string> = {
  serve: 'Serves', ace: 'Aces', serr: 'Errors',
  receive: 'Receives', rerr: 'Errors',
  set: 'Sets', assist: 'Assists',
  attack: 'Attacks', kill: 'Kills', aerr: 'Errors', blocked: 'Got blocked',
  block: 'Blocks', blockpt: 'Points',
  dig: 'Digs',
  free: 'Free balls',
  tip: 'Tips', tipkill: 'Tip kills', roll: 'Placements', rollkill: 'Placement kills',
  pass3: 'Perfect', pass2: 'OK', pass1: 'Poor',
  set3: 'Good', set2: 'OK', set1: 'Poor',
  oerr: 'Other errors',
};

// How the stats are grouped on a player page; `good` colours the number.
export const STAT_GROUPS: { label: string; stats: { k: StatKey; good: boolean | null }[] }[] = [
  { label: 'Serving', stats: [{ k: 'serve', good: null }, { k: 'ace', good: true }, { k: 'serr', good: false }] },
  { label: 'Receiving', stats: [{ k: 'receive', good: null }, { k: 'rerr', good: false }] },
  { label: 'Passes', stats: [{ k: 'pass3', good: true }, { k: 'pass2', good: null }, { k: 'pass1', good: false }] },
  { label: 'Setting', stats: [{ k: 'set', good: null }, { k: 'assist', good: true }] },
  { label: 'Set quality', stats: [{ k: 'set3', good: true }, { k: 'set2', good: null }, { k: 'set1', good: false }] },
  { label: 'Attacking', stats: [{ k: 'attack', good: null }, { k: 'kill', good: true }, { k: 'aerr', good: false }, { k: 'blocked', good: false }] },
  { label: 'Attack types', stats: [{ k: 'tip', good: null }, { k: 'tipkill', good: true }, { k: 'roll', good: null }, { k: 'rollkill', good: true }] },
  { label: 'Blocking', stats: [{ k: 'block', good: null }, { k: 'blockpt', good: true }] },
  { label: 'Defence', stats: [{ k: 'dig', good: null }, { k: 'free', good: null }, { k: 'oerr', good: false }] },
];

export const LEADER_STATS: { k: StatKey; label: string }[] = [
  { k: 'kill', label: 'Kills' }, { k: 'ace', label: 'Aces' }, { k: 'blockpt', label: 'Block points' }, { k: 'assist', label: 'Assists' },
];

export interface Clip { gameId: string; title: string; date: string; s: number; e: number; t: number }
export type PlayerStats = Record<StatKey, Clip[]>;

const empty = (): PlayerStats =>
  Object.fromEntries(Object.keys(STAT_LABELS).map(k => [k, []])) as unknown as PlayerStats;

const ATTEMPT: Partial<Record<Skill, StatKey>> = {
  serve: 'serve', receive: 'receive', set: 'set', attack: 'attack', block: 'block', dig: 'dig', free: 'free',
};
const TYPE_KILL = { tip: 'tipkill', roll: 'rollkill' } as const;

/** Grade / attack-type lists a touch belongs to (e.g. a perfect pass, a tip). */
function detail(t: Touch): StatKey[] {
  const out: StatKey[] = [];
  if (t.q && (t.k === 'receive' || t.k === 'dig')) out.push(`pass${t.q}` as StatKey);
  if (t.q && t.k === 'set') out.push(`set${t.q}` as StatKey);
  if (t.k === 'attack' && t.a) out.push(t.a);
  return out;
}
const POINT: Partial<Record<Skill, StatKey>> = { serve: 'ace', attack: 'kill', block: 'blockpt' };
const ERROR: Partial<Record<Skill, StatKey>> = { serve: 'serr', receive: 'rerr', attack: 'aerr' };

/** Every tagged touch / result credited to players (guests are skipped). */
export function computeStats(games: Game[]): Record<string, PlayerStats> {
  const out: Record<string, PlayerStats> = {};
  const add = (pid: string | undefined, k: StatKey | undefined, c: Clip) => {
    if (!pid || pid === 'guest' || !k) return;
    (out[pid] ??= empty())[k].push(c);
  };
  for (const g of games) {
    for (const r of g.rallies) {
      if (r.st === 'bad') continue;
      const clip = (t: number): Clip => ({ gameId: g.id, title: g.title, date: g.date, s: r.s, e: r.e, t });
      if (r.touches?.length) addTouches(r, clip, add);
      else if (r.tag) addPointTag(r, clip(r.s), add);
    }
  }
  return out;
}

type Add = (pid: string | undefined, k: StatKey | undefined, c: Clip) => void;

function addTouches(r: Rally, clip: (t: number) => Clip, add: Add) {
  const ts = r.touches!;
  ts.forEach(t => { add(t.p, ATTEMPT[t.k], clip(t.t)); detail(t).forEach(k => add(t.p, k, clip(t.t))); });
  const kill = (x: Touch) => { if (x.k === 'attack' && x.a) add(x.p, TYPE_KILL[x.a], clip(x.t)); };
  if (!r.end) return;
  const t = ts[r.end.i], prev = ts[r.end.i - 1];
  if (!t) return;
  if (r.end.r === 'point') {
    add(t.p, POINT[t.k], clip(t.t));
    kill(t);
    // a player can't touch twice in a row, so never credit them for their own set / attack
    if (t.k === 'attack' && prev?.k === 'set' && prev.p !== t.p) add(prev.p, 'assist', clip(prev.t));
    if (t.k === 'block' && prev?.k === 'attack' && prev.p !== t.p) add(prev.p, 'blocked', clip(prev.t));
  } else {
    add(t.p, ERROR[t.k] ?? 'oerr', clip(t.t));
    // the serve / attack / block that forced this error also scored
    const f = forcedBy(ts, r.end);
    if (f >= 0) {
      const by = ts[f], before = ts[f - 1];
      add(by.p, POINT[by.k], clip(by.t));
      kill(by);
      if (by.k === 'attack' && before?.k === 'set' && before.p !== by.p) add(before.p, 'assist', clip(before.t));
    }
  }
}

// Rallies tagged with the older point-only tagger.
function addPointTag(r: Rally, c: Clip, add: Add) {
  const { o, p, a } = r.tag!;
  const map: Record<string, StatKey[]> = {
    kill: ['attack', 'kill'], ace: ['serve', 'ace'], block: ['block', 'blockpt'], serr: ['serve', 'serr'],
    aerr: ['attack', 'aerr'], blocked: ['attack', 'blocked'], rerr: ['receive', 'rerr'], oerr: ['oerr'],
  };
  map[o].forEach(k => add(p, k, c));
  if (o === 'kill') add(a, 'assist', c);
}

export const taggedGames = (games: Game[]) =>
  games.filter(g => g.rallies.some(r => r.tag || r.touches?.length)).length;

/** Average grade (3 / 2 / 1) from the counts of each grade, e.g. pass rating 2.3; '–' if none graded. */
export const avgGrade = (n3: number, n2: number, n1: number) =>
  n3 + n2 + n1 ? (Math.round(((3 * n3 + 2 * n2 + n1) / (n3 + n2 + n1)) * 10) / 10).toFixed(1) : '–';

/** e.g. kill % = kills / attacks */
export const ratio = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
