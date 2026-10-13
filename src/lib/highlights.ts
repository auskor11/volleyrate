// Highlights: whole rallies bookmarked to a player's profile (highlights/{id}).
import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase';

export interface Highlight {
  id: string;
  playerId: string;
  gameId: string;
  youtubeId: string;
  title: string;      // game title
  date: string;       // game date
  s: number;          // rally start / end (whole rally)
  e: number;
  note: string;
  by: string;         // email of whoever added it
  byName: string;
  at?: { toDate(): Date };
}

export async function addHighlight(h: Omit<Highlight, 'id' | 'at'>) {
  await addDoc(collection(db, 'highlights'), { ...h, at: serverTimestamp() });
}

export const removeHighlight = (id: string) => deleteDoc(doc(db, 'highlights', id));

/** Highlights for one player (newest game first) or for one game (to mark its rallies). */
/** A player's or a game's highlights, or every highlight (`all`: to mark highlighted rallies in playlists). */
export function useHighlights(filter: { playerId?: string; gameId?: string; all?: boolean }) {
  const [list, setList] = useState<Highlight[] | null>(null);
  const key = filter.all ? 'all' : filter.playerId ? `p:${filter.playerId}` : `g:${filter.gameId}`;
  useEffect(() => {
    const [field, value] = filter.playerId ? ['playerId', filter.playerId] : ['gameId', filter.gameId];
    if (!filter.all && !value) return;
    return onSnapshot(filter.all ? collection(db, 'highlights') : query(collection(db, 'highlights'), where(field!, '==', value)),
      s => setList(s.docs.map(d => ({ id: d.id, ...d.data() }) as Highlight)
        .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title) || a.s - b.s)),
      () => setList([]));
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}
