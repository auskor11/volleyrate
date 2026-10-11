import { useEffect, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { CourtSetup, CourtState, LegacyLineup, Team } from './rotation';
import type { Angle, CameraKind } from './cameras';

// One rally on the YouTube timeline. `as`/`ae` keep the detector's original bounds so reviewed
// games can be exported to retrain the detector.
export interface Rally {
  s: number;
  e: number;
  st: 'auto' | 'ok' | 'bad' | 'added';
  as?: number;
  ae?: number;
  tag?: PointTag;          // older point-only tagging
  touches?: Touch[];       // touch-by-touch tagging
  end?: RallyEnd;          // which touch decided the rally
  sk?: number[];           // suggested touch moments the tagger skipped ("not a touch"), for tuning
  by?: string;             // who last edited this rally (first name)
  court?: CourtState;      // where everyone stood, as checked when the rally was tagged or edited
}

// Edit history: games/{id}/history, append-only.
export interface HistoryEntry { id: string; at?: { toDate(): Date }; email: string; name: string; changes: string[] }

export async function logHistory(gameId: string, who: { email?: string | null; displayName?: string | null } | null, changes: string[]) {
  if (!changes.length) return;
  await addDoc(collection(db, 'games', gameId, 'history'), {
    at: serverTimestamp(), email: who?.email ?? '', name: who?.displayName ?? who?.email ?? 'Someone', changes,
  });
}

export function useHistory(gameId: string, enabled: boolean) {
  const [list, setList] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(query(collection(db, 'games', gameId, 'history'), orderBy('at', 'desc')),
      s => setList(s.docs.map(d => ({ id: d.id, ...d.data() }) as HistoryEntry)), () => setList([]));
  }, [gameId, enabled]);
  return list;
}

export const SKILLS = {
  serve: 'Serve', receive: 'Receive', set: 'Set', attack: 'Attack', block: 'Block', dig: 'Dig', free: 'Free ball', other: 'Other',
} as const;
export type Skill = keyof typeof SKILLS;

// p = player id or a guest ('guest-a' / 'guest-b': a guest on team A / B; plain 'guest' in older tags);
// t = video time of the touch.
// Optional detail: q = quality of a receive / dig / set (3 perfect or good, 2 OK, 1 poor);
// a = attack type when it isn't a spike (missing = spike).
export interface Touch { p: string; k: Skill; t: number; q?: Grade; a?: AttackType }

/** Guests are tagged by team so the app knows their side (older tags just say 'guest'). */
export const isGuest = (p?: string) => !!p && (p === 'guest' || p.startsWith('guest-'));
export const guestTeam = (p: string): 'a' | 'b' | null => (p === 'guest-a' ? 'a' : p === 'guest-b' ? 'b' : null);
export const guestName = (p: string) => (p === 'guest-a' ? 'Guest A' : p === 'guest-b' ? 'Guest B' : 'Guest');
export type Grade = 1 | 2 | 3;
export type AttackType = 'tip' | 'roll';
export const ATTACK_TYPES: Record<'spike' | AttackType, string> = { spike: 'Spike', tip: 'Tip', roll: 'Smart placement' };
/** A set nobody graded counts as OK. */
export const DEFAULT_SET_GRADE: Grade = 2;
/** Skills that can be graded 3 / 2 / 1. */
export const GRADED: Skill[] = ['receive', 'dig', 'set'];
export const GRADE_LABELS: Record<'pass' | 'set', Record<Grade, string>> = {
  pass: { 3: 'Perfect', 2: 'OK', 1: 'Poor' },
  set: { 3: 'Good', 2: 'OK', 1: 'Poor' },
};
export interface RallyEnd { i: number; r: 'point' | 'error' }

/** Most likely next skill given the touches so far (the natural order of play). */
export function nextSkill(touches: Touch[]): Skill {
  const last = touches[touches.length - 1]?.k;
  if (!last) return 'serve';
  return ({ serve: 'receive', receive: 'set', dig: 'set', set: 'attack', attack: 'dig', block: 'dig', free: 'receive', other: 'set' } as const)[last];
}

// A defensive error right after the other side's serve / attack / block / set-over also scores for that
// touch: serve → receive/dig error = ace; attack → receive/dig/block error = kill; block → receive/dig
// error = block point; a set that goes over → receive/dig/block error = set-over point for the setter.
const FORCED: Partial<Record<Skill, Skill[]>> = {
  serve: ['receive', 'dig'],
  attack: ['receive', 'dig', 'block'],
  block: ['receive', 'dig'],
  set: ['receive', 'dig', 'block'],
};
const POINT_LABEL: Partial<Record<Skill, string>> = { serve: 'Ace', attack: 'Kill', block: 'Block', set: 'Set over' };

/** Index of the touch that earned the point when the rally ended on a forced defensive error, else -1. */
export function forcedBy(touches: Touch[], end: RallyEnd): number {
  if (end.r !== 'error' || end.i < 1) return -1;
  const err = touches[end.i], prev = touches[end.i - 1];
  return prev && err && prev.p !== err.p && FORCED[prev.k]?.includes(err.k) ? end.i - 1 : -1;
}

/** Whether two players could be teammates: false only when they're known to be on different teams. */
export type SameTeam = (a: string, b: string) => boolean;

/**
 * Who gets the assist for the attack at touch i, as a touch index (-1 = nobody): the set just before it,
 * or a dig straight to the attacker (no set in between) by a teammate. Never the attacker themselves.
 */
export function assistIndex(ts: Touch[], i: number, sameTeam?: SameTeam): number {
  const x = ts[i], before = ts[i - 1];
  if (x?.k !== 'attack' || !before || before.p === x.p) return -1;
  if (before.k === 'set') return i - 1;
  if (before.k === 'dig' && (sameTeam?.(before.p, x.p) ?? true)) return i - 1;
  return -1;
}

/** Short description of how a rally ended, from touches or an older point tag. */
export function rallyResult(r: Rally, sameTeam?: SameTeam): { label: string; good: boolean; who: string; note?: string; noteWho?: string; assist?: string } | null {
  if (r.touches?.length && r.end) {
    const ts = r.touches;
    const t = ts[r.end.i];
    if (!t) return null;
    const point = r.end.r === 'point';
    // the set (or a teammate's dig) just before a kill is an assist
    const assistFor = (i: number) => { const a = assistIndex(ts, i, sameTeam); return a >= 0 ? ts[a].p : undefined; };
    const f = forcedBy(ts, r.end);
    if (f >= 0) {
      const by = ts[f];
      return { label: POINT_LABEL[by.k]!, good: true, who: by.p, note: `${SKILLS[t.k].toLowerCase()} error`, noteWho: t.p, assist: assistFor(f) };
    }
    const label = point ? POINT_LABEL[t.k] ?? `${SKILLS[t.k]} point` : `${SKILLS[t.k]} error`;
    return { label, good: point, who: t.p, assist: point ? assistFor(r.end.i) : undefined };
  }
  if (r.tag) return { label: OUTCOMES[r.tag.o].label, good: OUTCOMES[r.tag.o].good, who: r.tag.p, assist: r.tag.o === 'kill' ? r.tag.a : undefined };
  return null;
}

export const isTagged = (r: Rally) => !!(r.tag || (r.touches?.length && r.end));

// How a rally ended and who did it. p / a are player ids or 'guest'.
export interface PointTag { o: Outcome; p: string; a?: string }

export const OUTCOMES = {
  kill: { label: 'Kill', good: true },
  ace: { label: 'Ace', good: true },
  block: { label: 'Block', good: true },
  serr: { label: 'Service error', good: false },
  aerr: { label: 'Attack error', good: false },
  blocked: { label: 'Got blocked', good: false },
  rerr: { label: 'Reception error', good: false },
  oerr: { label: 'Other error', good: false },
} as const;
export type Outcome = keyof typeof OUTCOMES;

// Candidate stretch the detector's classifier judged (features f, probability p); kept for retraining.
export interface Segment { a: number; b: number; f: number[]; p: number }

export interface Game {
  id: string;
  title: string;
  date: string;           // YYYY-MM-DD
  youtubeId: string;
  duration: number;       // seconds
  rallies: Rally[];
  reviewed: boolean;
  createdBy: string;
  detector?: { version: string; elapsed: number; device: string };
  segments?: Segment[];
  peaks?: number[];       // contact-like sounds [t0, h0, t1, h1, ...] used to suggest touch moments
  // Whether this game's stats count toward ratings. Missing = counted at 1× (games from before approval
  // existed); new games start { applied: false } until an admin applies them with per-player strengths.
  rating?: GameRating;
  court?: CourtSetup;     // the two teams at the first rally: positions 1–6, subs, roles (see rotation.ts)
  lineup?: LegacyLineup;  // teams saved in the older serving-order format (read via gameSetup)
  // cameras (see cameras.ts): the main video's kind / name / side, and any extra cameras lined up with it
  camera?: CameraKind;
  cameraName?: string;
  behind?: Team;
  net?: number;           // back camera: the top of the net in the picture (fraction of height)
  angles?: Angle[];
}

export interface GameRating { applied: boolean; weights?: Record<string, number>; by?: string; at?: unknown }

/** How much a game counts for a player's ratings (0 = not at all). */
export function gameWeight(g: Game, playerId: string): number {
  if (!g.rating) return 1;
  return g.rating.applied ? g.rating.weights?.[playerId] ?? 1 : 0;
}
export const isApplied = (g: Game) => !g.rating || g.rating.applied;

export async function setGameRating(id: string, rating: GameRating) {
  await updateDoc(doc(db, 'games', id), { rating: { ...rating, at: serverTimestamp() } });
}

// Suggested touch moments: contact sounds inside a rally, strong enough and spaced out like real touches.
export const SUGGEST = { minStrength: 12, minGap: 0.5 };
export function suggestTouches(peaks: number[] | undefined, s: number, e: number): number[] {
  if (!peaks) return [];
  const c: [number, number][] = [];
  for (let i = 0; i < peaks.length; i += 2)
    if (peaks[i] >= s - 0.3 && peaks[i] <= e + 0.3 && peaks[i + 1] >= SUGGEST.minStrength) c.push([peaks[i], peaks[i + 1]]);
  c.sort((a, b) => b[1] - a[1]);  // keep the stronger of two sounds that are too close together
  const kept: number[] = [];
  for (const [t] of c) if (kept.every(k => Math.abs(k - t) >= SUGGEST.minGap)) kept.push(t);
  return kept.sort((a, b) => a - b);
}

export function useGames() {
  const [games, setGames] = useState<Game[] | null>(null);
  useEffect(() => onSnapshot(query(collection(db, 'games'), orderBy('date', 'desc')),
    s => setGames(s.docs.map(d => ({ id: d.id, ...d.data() }) as Game))), []);
  return games;
}

export function useGame(id: string | undefined) {
  const [game, setGame] = useState<Game | null | undefined>(undefined);
  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, 'games', id), s => setGame(s.exists() ? ({ id: s.id, ...s.data() }) as Game : null));
  }, [id]);
  return game;
}

export async function createGame(g: Omit<Game, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'games'), { ...g, createdAt: serverTimestamp() });
  return ref.id;
}

export async function saveRallies(id: string, rallies: Rally[]) {
  const sorted = [...rallies].sort((a, b) => a.s - b.s).map(r => ({ ...r, s: round1(r.s), e: round1(r.e) }));
  await updateDoc(doc(db, 'games', id), { rallies: sorted, updatedAt: serverTimestamp() });
}

export async function updateGame(id: string, patch: Partial<Pick<Game, 'title' | 'date' | 'reviewed' | 'peaks' | 'segments' | 'court' | 'angles' | 'camera' | 'cameraName' | 'behind' | 'net'>>) {
  await updateDoc(doc(db, 'games', id), patch);
}

export const deleteGame = (id: string) => deleteDoc(doc(db, 'games', id));

export const liveRallies = (g: Game) => g.rallies.filter(r => r.st !== 'bad');
export const round1 = (t: number) => Math.round(t * 10) / 10;
export const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
