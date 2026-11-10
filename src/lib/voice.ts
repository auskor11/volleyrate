// Voice tagging: turn what the tagger says ("Alex serve, Ben pass, Chris set, Dana kill") into touches.
// Uses the browser's own speech recognition (free; Chrome and Safari), nothing is stored.
import { canShare, nextSkill, type AttackType, type Grade, type RallyEnd, type Skill, type Touch } from './games';

export type VoiceOp =
  | { op: 'touch'; p: string; p2?: string; k?: Skill; a?: AttackType; q?: Grade }  // p2: a second blocker ("Brayden and Jeremy block")
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
const ERROR_WORDS = new Set(['error', 'errors', 'out', 'net', 'fault', 'miss', 'missed', 'mistake', 'miscommunication', 'miscom', 'miscomm', 'collision']);
const GRADE_WORDS: Record<string, Grade> = { perfect: 3, great: 3, good: 3, okay: 2, ok: 2, decent: 2, poor: 1, bad: 1 };
const UNDO_WORDS = new Set(['undo', 'scratch', 'delete', 'cancel']);
const JOIN_WORDS = new Set(['and', 'plus', 'with', 'n']);
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

export interface VoicePlayer { id: string; name: string; number: number | null; voice?: string[] }

/** Who a word means: a name or voice name (in full, run together, or just the first word, or close to it for speech slips), or a shirt number. */
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
  const said = (pl: VoicePlayer) => [pl.name, ...(pl.voice ?? [])].map(n => n.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)).filter(x => x.length);
  // the longest match wins: a full name ("yi jie") or one run together ("yijie")
  let best: [string, number] | null = null;
  for (const pl of players) for (const parts of said(pl)) {
    if (parts.length > 1 && parts.every((x, k) => words[i + k] === x) && parts.length > (best?.[1] ?? 0)) best = [pl.id, parts.length];
    else if (!best && parts.join('') === w) best = [pl.id, 1];
  }
  if (best) return best;
  const exact = players.filter(pl => said(pl).some(parts => parts[0] === w));
  if (exact.length === 1) return [exact[0].id, 1];
  if (!exact.length && !(w in SKILL_WORDS) && !(w in POINT_WORDS) && !ERROR_WORDS.has(w) && !(w in GRADE_WORDS) && !GUEST_A.has(w) && !GUEST_B.has(w)) {
    const close = players.filter(pl => said(pl).some(parts => near(w, parts.join('')) || near(w, parts[0])));
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
  let join = false;                // "and" just after a name with no skill yet: maybe a double block
  const lastTouch = () => { const o = ops[ops.length - 1]; return o?.op === 'touch' ? o : null; };
  for (let i = 0; i < words.length;) {
    const w = words[i];
    const pl = playerAt(words, i, players);
    if (pl) {
      const t = lastTouch();
      if (join && t && !t.p2 && (!t.k || t.k === 'block') && t.p !== pl[0]) t.p2 = pl[0];  // kept only if it turns out to be a block
      else ops.push({ op: 'touch', p: pl[0], ...(pending ? { k: pending } : {}) });
      pending = undefined; join = false; i += pl[1]; continue;
    }
    join = JOIN_WORDS.has(w) && !!lastTouch();
    if (join) { i++; continue; }
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
  for (const [idx, o] of ops.entries()) {
    if (o.op === 'undo') { if (!virtual && list.length) list = list.slice(0, -1); continue; }
    if (o.op === 'end') {
      if (!list.length) continue;
      return { touches: list, end: { i: list.length - 1, r: o.r }, added: n };
    }
    const prevT = list[list.length - 1]?.t ?? -Infinity;
    const t = Math.round(Math.max(times[n] ?? prevT, prevT + 0.1) * 10) / 10;
    const k = o.k ?? nextSkill(list);
    // "Ben and Chris receive error" / "Chris and Dana attack error": a miscommunication, the error shared half each
    const next = ops[idx + 1];
    const shared = !!o.p2 && canShare(k) && next?.op === 'end' && next.r === 'error';
    const touch: Touch = { p: o.p, k, t, ...(o.a ? { a: o.a } : {}), ...(o.q ? { q: o.q } : {}), ...(o.p2 && (k === 'block' || shared) ? { p2: o.p2 } : {}) };
    // saying the serve replaces the prediction, like choosing Serve by hand
    list = virtual && k === 'serve' ? [touch] : [...list, touch];
    virtual = false;
    n++;
    // "Ben and Chris" that wasn't a block: two touches after all
    if (o.p2 && k !== 'block' && !shared) {
      const t2 = Math.round(Math.max(times[n] ?? t, t + 0.1) * 10) / 10;
      list = [...list, { p: o.p2, k: nextSkill(list), t: t2 }];
      n++;
    }
  }
  return { touches: list, added: n };
}
