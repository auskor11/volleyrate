// Game videos saved on this device for watching offline (and without using data). Each is stored under its
// YouTube id, so every player that would play that video plays the saved copy instead. Files live in the
// browser's private storage for this site (OPFS where available, else IndexedDB); nothing is uploaded.
import { useEffect, useState } from 'react';

export interface SavedVideo { id: string; title: string; size: number; savedAt: number }

const DB = 'volleyrate-offline';
const idb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('videos'); r.result.createObjectStore('meta'); };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function tx<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = f(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

const opfsOK = async () => {
  try { return !!navigator.storage?.getDirectory && 'createWritable' in FileSystemFileHandle.prototype; } catch { return false; }
};
const opfsDir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('videos', { create: true });

const listeners = new Set<() => void>();
const changed = () => listeners.forEach(f => f());

export async function savedVideos(): Promise<SavedVideo[]> {
  try { return (await tx<SavedVideo[]>('meta', 'readonly', s => s.getAll())) ?? []; } catch { return []; }
}

/** A playable URL for the saved copy of this YouTube video, or null. */
export async function localVideoUrl(youtubeId: string): Promise<string | null> {
  try {
    const meta = await tx<SavedVideo | undefined>('meta', 'readonly', s => s.get(youtubeId));
    if (!meta) return null;
    if (await opfsOK()) {
      try { return URL.createObjectURL(await (await (await opfsDir()).getFileHandle(youtubeId)).getFile()); } catch { /* stored in IndexedDB */ }
    }
    const blob = await tx<Blob | undefined>('videos', 'readonly', s => s.get(youtubeId));
    return blob ? URL.createObjectURL(blob) : null;
  } catch { return null; }
}

/** Copy a video file into this device's storage for the given YouTube video. */
export async function saveVideo(youtubeId: string, title: string, file: File, onProgress?: (done: number) => void): Promise<void> {
  try { await navigator.storage?.persist?.(); } catch { /* best effort: ask the browser not to clear it */ }
  if (await opfsOK()) {
    const h = await (await opfsDir()).getFileHandle(youtubeId, { create: true });
    const w = await h.createWritable();
    const reader = file.stream().getReader();
    let done = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      await w.write(value);
      done += value.byteLength;
      onProgress?.(done / file.size);
    }
    await w.close();
  } else {
    await tx('videos', 'readwrite', s => s.put(file, youtubeId));
    onProgress?.(1);
  }
  await tx('meta', 'readwrite', s => s.put({ id: youtubeId, title, size: file.size, savedAt: Date.now() } satisfies SavedVideo, youtubeId));
  changed();
}

export async function removeVideo(youtubeId: string): Promise<void> {
  try { if (await opfsOK()) await (await opfsDir()).removeEntry(youtubeId); } catch { /* not there */ }
  try { await tx('videos', 'readwrite', s => s.delete(youtubeId)); } catch { /* not there */ }
  await tx('meta', 'readwrite', s => s.delete(youtubeId));
  changed();
}

/** Saved videos, kept up to date. */
export function useSavedVideos(): SavedVideo[] | null {
  const [list, setList] = useState<SavedVideo[] | null>(null);
  useEffect(() => {
    const load = () => { savedVideos().then(setList); };
    load();
    listeners.add(load);
    return () => { listeners.delete(load); };
  }, []);
  return list;
}

export const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);

/** How long a video file is (to check it's the right game), or null if this browser can't read it. */
export function fileDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.onloadedmetadata = () => { resolve(Number.isFinite(v.duration) ? v.duration : null); URL.revokeObjectURL(url); };
    v.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    v.src = url;
  });
}
