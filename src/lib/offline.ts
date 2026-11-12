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

const CHUNK = 8 * 1024 * 1024;   // copy 8 MB at a time (tiny stream pieces made a 0.75 GB copy take thousands of steps)
const STALL_MS = 45_000;          // a step this slow means the copy has stopped (screen locked, app in the background)

/** Why a copy failed, in words for the person saving. */
export class SaveError extends Error {}

function step<T>(p: Promise<T>, done: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, reject) => { t = setTimeout(() => reject(new SaveError(`stalled at ${fmtSize(done)}`)), STALL_MS); }),
  ]);
}

/** Keep the screen on while copying: if the phone locks, iOS pauses the page and the copy stops. */
async function keepAwake(): Promise<() => void> {
  let lock: { release(): Promise<void> } | null = null;
  const get = async () => { try { lock = await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not allowed */ } };
  const again = () => { if (document.visibilityState === 'visible') get(); };
  await get();
  document.addEventListener('visibilitychange', again);
  return () => { document.removeEventListener('visibilitychange', again); lock?.release().catch(() => {}); };
}

/** Copy a video file into this device's storage for the given YouTube video. */
export async function saveVideo(youtubeId: string, title: string, file: File, onProgress?: (done: number) => void): Promise<void> {
  try { await navigator.storage?.persist?.(); } catch { /* best effort: ask the browser not to clear it */ }
  const release = await keepAwake();
  try {
    if (await opfsOK()) {
      const dir = await opfsDir();
      const w = await (await dir.getFileHandle(youtubeId, { create: true })).createWritable();
      let done = 0;
      try {
        while (done < file.size) {
          const buf = await step(file.slice(done, done + CHUNK).arrayBuffer(), done);
          await step(w.write(buf), done);
          done += buf.byteLength;
          onProgress?.(done / file.size);
        }
        await step(w.close(), done);
      } catch (e) {
        w.abort().catch(() => {});
        try { await dir.removeEntry(youtubeId); } catch { /* nothing kept */ }
        if (e instanceof DOMException && e.name === 'QuotaExceededError') throw new SaveError(`not enough room on this phone (stopped at ${fmtSize(done)})`);
        throw e;
      }
    } else {
      await tx('videos', 'readwrite', s => s.put(file, youtubeId));
      onProgress?.(1);
    }
  } finally { release(); }
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
