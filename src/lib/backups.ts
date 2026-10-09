// Rating backups: starting ratings + engine settings + which games count (and how strongly).
// Created automatically before anything that changes ratings, and on demand in Admin → Ratings.
import { useEffect, useState } from 'react';
import {
  addDoc, collection, deleteField, doc, limit, onSnapshot, orderBy, query, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Player } from './data';
import type { Game, GameRating } from './games';
import type { EngineSettings } from './engine';
import type { Ratings } from './ratings';

export interface Backup {
  id: string;
  label: string;
  by: string;
  at?: { toDate(): Date };
  players: Record<string, Ratings>;
  settings: EngineSettings;
  games: Record<string, GameRating | null>;  // null = game had no rating field (counted at 1×)
}

export async function createBackup(label: string, by: string, players: Player[], settings: EngineSettings, games: Game[]) {
  const strip = (r?: GameRating) => (r ? { applied: r.applied, ...(r.weights ? { weights: r.weights } : {}) } : null);
  await addDoc(collection(db, 'ratingBackups'), {
    label, by, at: serverTimestamp(), settings,
    players: Object.fromEntries(players.map(p => [p.id, p.ratings ?? {}])),
    games: Object.fromEntries(games.map(g => [g.id, strip(g.rating)])),
  });
}

export function useBackups(enabled: boolean) {
  const [list, setList] = useState<Backup[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(query(collection(db, 'ratingBackups'), orderBy('at', 'desc'), limit(50)),
      s => setList(s.docs.map(d => ({ id: d.id, ...d.data() }) as Backup)));
  }, [enabled]);
  return list;
}

/** Put a backup back (the current state is backed up first by the caller). */
export async function restoreBackup(b: Backup, current: Game[]) {
  const batch = writeBatch(db);
  for (const [id, r] of Object.entries(b.players)) batch.update(doc(db, 'players', id), { ratings: r });
  batch.set(doc(db, 'config', 'ratingsEngine'), b.settings);
  for (const g of current) {
    if (!(g.id in b.games)) continue;  // game added after the backup: leave it as is
    const r = b.games[g.id];
    batch.update(doc(db, 'games', g.id), { rating: r ?? deleteField() });
  }
  await batch.commit();
}
