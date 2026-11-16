// The app's background picture, chosen per device in the account menu. "Team photo" is for players only: it's
// stored in the database (backgrounds/team) where only players and admins can read it, never in the public site
// files. The rainbow flag is drawn here, so it needs nothing stored and anyone can pick it.
import { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type Background = 'team' | 'rainbow' | 'none';
const KEY = 'volleyrate.bg';
const DEFAULT: Background = 'team';   // players see the team photo until they pick something else

export const BACKGROUNDS: { id: Background; label: string; players?: boolean }[] = [
  { id: 'team', label: 'Team photo', players: true },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'none', label: 'None' },
];

export const RAINBOW = 'linear-gradient(to bottom, #e40303 0 16.67%, #ff8c00 0 33.33%, #ffed00 0 50%, #008026 0 66.67%, #004dff 0 83.33%, #750787 0)';

function saved(): Background {
  try { const v = localStorage.getItem(KEY); if (v === 'team' || v === 'rainbow' || v === 'none') return v; } catch { /* storage blocked */ }
  return DEFAULT;
}

const listeners = new Set<(b: Background) => void>();
let current = saved();

export function setBackground(b: Background) {
  current = b;
  try { localStorage.setItem(KEY, b); } catch { /* storage blocked: still switch for this visit */ }
  listeners.forEach(f => f(b));
}

/** The background picked on this device. */
export function useBackground(): Background {
  const [b, setB] = useState(current);
  useEffect(() => { listeners.add(setB); return () => { listeners.delete(setB); }; }, []);
  return b;
}

let teamImage: Promise<string | null> | null = null;
/** The team photo (a data URL), or null if this person can't see it or it isn't set. Loaded once per visit. */
export function useTeamImage(enabled: boolean): string | null {
  const [img, setImg] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => { const f = () => setVersion(v => v + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  useEffect(() => {
    if (!enabled) { setImg(null); return; }
    teamImage ??= getDoc(doc(db, 'backgrounds', 'team')).then(d => (d.data()?.image as string | undefined) ?? null).catch(() => { teamImage = null; return null; });
    let live = true;
    teamImage.then(i => { if (live) setImg(i); });
    return () => { live = false; };
  }, [enabled, version]);
  return img;
}

/** Admins: make a picture the team photo background (shrunk to fit in the database, under 900 KB). */
export async function saveTeamImage(file: File): Promise<void> {
  const img = await createImageBitmap(file);
  let image = '';
  for (const long of [1600, 1280, 1000, 800]) {
    const k = Math.min(1, long / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    image = c.toDataURL('image/webp', 0.8);
    if (!image.startsWith('data:image/webp')) image = c.toDataURL('image/jpeg', 0.8);  // Safari can't make webp
    if (image.length < 850_000) break;
  }
  if (image.length >= 850_000) throw new Error('that picture is too big even after shrinking it');
  await setDoc(doc(db, 'backgrounds', 'team'), { image, updatedAt: serverTimestamp() });
  teamImage = Promise.resolve(image);
  listeners.forEach(f => f(current));
}
