import { useEffect, useState } from 'react';
import { collection, deleteDoc, deleteField, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import type { Position, Ratings } from './ratings';

export interface Player {
  id: string;
  name: string;
  number: number | null;
  positions: Position[];  // primary first
  ratings: Ratings;
  photo?: string;         // face photo: a small square image as a data URL (anyone on the team can change it)
  photoBy?: string;       // first name of whoever set it
}

export interface Member {
  email: string;
  playerId: string | null;
  role: 'admin' | 'player' | 'editor' | 'viewer';  // editor: reviews and tags games; viewer: watches only
}

export function usePlayers() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onSnapshot(
    query(collection(db, 'players'), orderBy('name')),
    s => setPlayers(s.docs.map(d => ({ id: d.id, ratings: {}, ...d.data() }) as Player)),
    e => setError(e.message),
  ), []);
  return { players, error };
}

export function useMembers(enabled: boolean) {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(collection(db, 'members'),
      s => setMembers(s.docs.map(d => ({ email: d.id, playerId: null, role: 'player', ...d.data() }) as Member)));
  }, [enabled]);
  return members;
}

export async function saveRatings(playerId: string, ratings: Ratings) {
  await updateDoc(doc(db, 'players', playerId), { ratings, ratingsUpdatedAt: serverTimestamp() });
}

/** A player's own positions (primary first): the only profile field players can change themselves. */
export async function savePositions(playerId: string, positions: Position[]) {
  await updateDoc(doc(db, 'players', playerId), { positions });
}

/** Set or remove (null) a player's face photo. Anyone on the team can change anyone's. */
export async function savePhoto(playerId: string, photo: string | null, by: string) {
  await updateDoc(doc(db, 'players', playerId), photo ? { photo, photoBy: by } : { photo: deleteField(), photoBy: deleteField() });
}

export async function savePlayer(p: Omit<Player, 'ratings'>) {
  const { id, ...rest } = p;
  await setDoc(doc(db, 'players', id), rest, { merge: true });
}

/** Link an email to a player. The role is only changed when one is passed; new members default to player. */
export async function setMember(email: string, playerId: string | null, role?: Member['role']) {
  await setDoc(doc(db, 'members', email.trim().toLowerCase()), { playerId, ...(role ? { role } : {}) }, { merge: true });
}

export interface RosterRow { name: string; number?: number | null; positions: Position[]; email?: string }

/** Create/update players and their sign-in emails from a roster file. Existing ratings are kept. */
export async function importRoster(rows: RosterRow[]) {
  const batch = writeBatch(db);
  for (const r of rows) {
    const id = slug(r.name);
    batch.set(doc(db, 'players', id), { name: r.name, number: r.number ?? null, positions: r.positions }, { merge: true });
    // no role here: re-importing must never demote an admin (missing role = player)
    if (r.email) batch.set(doc(db, 'members', r.email.trim().toLowerCase()), { playerId: id }, { merge: true });
  }
  await batch.commit();
}

/** Replace starting ratings from a file { players: { [id]: Ratings } }; previous ratings are kept in ratingsBackup. */
export async function importStartingRatings(file: Record<string, Ratings>, current: Player[]): Promise<number> {
  const batch = writeBatch(db);
  let n = 0;
  for (const p of current) {
    const r = file[p.id];
    if (!r) continue;
    batch.update(doc(db, 'players', p.id), { ratings: r, ratingsBackup: p.ratings ?? {}, ratingsUpdatedAt: serverTimestamp() });
    n++;
  }
  await batch.commit();
  return n;
}

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Someone signed in who isn't on the team list, asking to help (doc id = their lowercase email). */
export interface AccessRequest {
  email: string;
  name: string;
  want: 'editor' | 'player';
  playerId?: string;       // "I'm this player" (for player requests)
  note?: string;
  at?: { toDate(): Date };
}

export async function requestAccess(email: string, r: Omit<AccessRequest, 'email' | 'at'>) {
  await setDoc(doc(db, 'accessRequests', email.toLowerCase()), { ...r, at: serverTimestamp() });
}

export const cancelRequest = (email: string) => deleteDoc(doc(db, 'accessRequests', email.toLowerCase()));

/** Your own pending request (null = none). */
export function useMyRequest(email: string | null | undefined) {
  const [r, setR] = useState<AccessRequest | null | undefined>(undefined);
  useEffect(() => {
    if (!email) { setR(null); return; }
    return onSnapshot(doc(db, 'accessRequests', email.toLowerCase()),
      s => setR(s.exists() ? ({ email: s.id, ...s.data() } as AccessRequest) : null), () => setR(null));
  }, [email]);
  return r;
}

/** Pending requests, for admins (the Admin tab shows how many). */
export function useAccessRequests(enabled: boolean) {
  const [list, setList] = useState<AccessRequest[]>([]);
  useEffect(() => {
    if (!enabled) { setList([]); return; }
    return onSnapshot(collection(db, 'accessRequests'),
      s => setList(s.docs.map(x => ({ email: x.id, ...x.data() }) as AccessRequest)), () => setList([]));
  }, [enabled]);
  return list;
}

/** Approve: put them on the team list with that role (and player), then clear the request. */
export async function approveRequest(r: AccessRequest, role: Member['role'], playerId: string | null) {
  await setMember(r.email, playerId, role);
  await cancelRequest(r.email);
}
