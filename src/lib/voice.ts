// Voice tagging: turn what the tagger says ("Alex serve, Ben pass, Chris set, Dana kill") into touches.
// Uses the browser's own speech recognition (free; Chrome and Safari), nothing is stored.
import { nextSkill, type AttackType, type Grade, type RallyEnd, type Skill, type Touch } from './games';

export type VoiceOp =
  | { op: 'touch'; p: string; k?: Skill; a?: AttackType; q?: Grade }
  | { op: 'end'; r: RallyEnd['r'] }
  | { op: 'undo' };

const SKILL_WORDS: Record<string, Skill> = {
  serve: 'serve', serves: 'serve', served: 'serve', service: 'serve', serving: 'serve', surf: 'serve',
  receive: 'receive', receives: 'receive', received: 'receive', reception: 'receive', pass: 'receive', passes: 'receive', passed: 'receive',
  set: 'set', sets: 'set', setting: 'set',
  attack: 'attack', attacks: 'attack', hit: 'attack', hits: 'attack', spike: 'attack', spikes: 'attack', spiked: 'attack',
  block: 'block', blocks: 'block', blocked: 'block',
  dig: 'dig', digs: 'dig', dug: 'dig',
  free: 'free', freeball: 'free',
};
const ATTACK_WORDS: Record<string, AttackType> = { tip: 'tip', tips: 'tip', tipped: 'tip', roll: 'roll', rolls: 'roll', placement: 'roll' };
const POINT_WORDS: Record<string, Skill | undefined> = { point: undefined, points: undefined, scored: undefined, score: undefined, winner: undefined, kill: 'attack', kills: 'attack', ace: 'serve', aces: 'serve' };
const ERROR_WORDS = new Set(['error', 'errors', 'out', 'net', 'fault', 'miss', 'missed', 'mistake']);
const GRADE_WORDS: Record<string, Grade> = { perfect: 3, great: 3, good: 3, okay: 2, ok: 2, decent: 2, poor: 1, bad: 1 };
const UNDO_WORDS = new Set(['undo', 'scratch', 'delete', 'cancel']);
const GRADED: Skill[] = ['receive', 'dig', 'set'];
const GUEST_WORDS = new Set(['guest', 'guests', 'guess', 'guessed', 'guesses']);
const GUEST_A = new Set(['a', 'eh', 'hey', 'ay', 'ey', 'one', '1', '8']);
const GUEST_B = new Set(['b', 'bee', 'be', 'bea', 'beat', 'v', 'vee', 'p', 'pee', 'd', 'the', 'two', 'to', 'too', '2']);

function near(a: string, b: string) {
  if (a === b) return true;
  const max = b.length >= 7 ? 2 : b.length >= 4 ? 1 : 0;
  if (!max || Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length] <= max;
}

export interface VoicePlayer { id: string; name: string; number: number | null }

/** Who a word means: a first name (or close to it, for speech slips), a full name, or a shirt number. */
function playerAt(words: string[], i: number, players: VoicePlayer[]): [string, number] | null {
  const w = words[i];
  // speech often hears "Guest B" as "guessed be", "guest v", "guestbee"…
  const glued = /^(?:guest|guess)(a|b|bee|be|eh)$/.exec(w);
  if (glued) return [glued[1] === 'a' || glued[1] === 'eh' ? 'guest-a' : 'guest-b', 1];
  if (GUEST_WORDS.has(w)) {
    const t = words[i + 1];
    if (t && GUEST_A.has(t)) return ['guest-a', 2];
    if (t && GUEST_B.has(t)) return ['guest-b', 2];
    return null;
  }
  for (const pl of players) {
    const parts = pl.name.toLowerCase().split(/\s+/);
    if (parts.length > 1 && parts.every((x, k) => words[i + k] === x)) return [pl.id, parts.length];
  }
  const exact = players.filter(pl => pl.name.toLowerCase().split(/\s+/)[0] === w);
  if (exact.length === 1) return [exact[0].id, 1];
  if (!exact.length && !(w in SKILL_WORDS) && !(w in POINT_WORDS) && !ERROR_WORDS.has(w) && !(w in GRADE_WORDS)) {
    const close = players.filter(pl => near(w, pl.name.toLowerCase().split(/\s+/)[0]));
    if (close.length === 1) return [close[0].id, 1];
  }
  if (/^\d+$/.test(w)) {
    const n = players.filter(pl => pl.number === Number(w));
    if (n.length === 1) return [n[0].id, 1];
  }
  return null;
}

/** Everything recognisable in a phrase, in order; unknown words are skipped. */
export function parseVoice(text: string, players: VoicePlayer[]): VoiceOp[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const ops: VoiceOp[] = [];
  let pending: Skill | undefined;  // a skill said before the name ("serve Alex")
  const lastTouch = () => { const o = ops[ops.length - 1]; return o?.op === 'touch' ? o : null; };
  for (let i = 0; i < words.length;) {
    const w = words[i];
    const pl = playerAt(words, i, players);
    if (pl) { ops.push({ op: 'touch', p: pl[0], ...(pending ? { k: pending } : {}) }); pending = undefined; i += pl[1]; continue; }
    if (w === 'free' && words[i + 1] === 'ball') i++;
    const t = lastTouch();
    if (w in SKILL_WORDS) { if (t && !t.k) t.k = SKILL_WORDS[w]; else pending = SKILL_WORDS[w]; }
    else if (w in ATTACK_WORDS) { if (t) { t.k = 'attack'; t.a = ATTACK_WORDS[w]; } }
    else if (w in POINT_WORDS) { if (t && !t.k && POINT_WORDS[w]) t.k = POINT_WORDS[w]; ops.push({ op: 'end', r: 'point' }); }  // "Dana kill" = attack
    else if (ERROR_WORDS.has(w)) ops.push({ op: 'end', r: 'error' });
    else if (w in GRADE_WORDS) { if (t && t.k && GRADED.includes(t.k)) t.q = GRADE_WORDS[w]; }
    else if (UNDO_WORDS.has(w)) ops.push({ op: 'undo' });
    i++;
  }
  return ops;
}

/**
 * Apply spoken ops to a rally's touches. `pre` is the predicted serve not saved yet (shown as the first
 * touch); `times` gives each new touch its moment in the video. Stops at the first end (the rally is over).
 */
export function applyVoice(saved: Touch[], pre: Touch | null, ops: VoiceOp[], times: number[]): { touches: Touch[]; end?: RallyEnd; added: number } {
  let list = pre ? [pre] : [...saved];
  let virtual = !!pre;  // the list is still just the unsaved prediction
  let n = 0;
  for (const o of ops) {
    if (o.op === 'undo') { if (!virtual && list.length) list = list.slice(0, -1); continue; }
    if (o.op === 'end') {
      if (!list.length) continue;
      return { touches: list, end: { i: list.length - 1, r: o.r }, added: n };
    }
    const prevT = list[list.length - 1]?.t ?? -Infinity;
    const t = Math.round(Math.max(times[n] ?? prevT, prevT + 0.1) * 10) / 10;
    const k = o.k ?? nextSkill(list);
    const touch: Touch = { p: o.p, k, t, ...(o.a ? { a: o.a } : {}), ...(o.q ? { q: o.q } : {}) };
    // saying the serve replaces the prediction, like choosing Serve by hand
    list = virtual && k === 'serve' ? [touch] : [...list, touch];
    virtual = false;
    n++;
  }
  return { touches: list, added: n };
}
