// Face photos: a round avatar (photo, or initials in the tier colour), and the editor that crops a picture to it.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { savePhoto } from '../lib/data';
import { useAuth } from '../lib/auth';

export const TIER_COLOR = { gold: '#d4ab2c', silver: '#aeb8c6', bronze: '#c27d48', unrated: '#4a5161' } as const;
export type Tier = keyof typeof TIER_COLOR;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

export function Avatar({ name, photo, tier = 'unrated', size = 36, ring = 2 }: { name: string; photo?: string; tier?: Tier; size?: number; ring?: number }) {
  const c = TIER_COLOR[tier];
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold"
      style={{ width: size, height: size, boxShadow: `0 0 0 ${ring}px ${c}`, background: photo ? '#1e2128' : `color-mix(in srgb, ${c} 18%, #16191f)`, color: c, fontSize: size * 0.36 }}>
      {photo ? <img src={photo} alt="" className="h-full w-full object-cover" draggable={false} /> : initials(name)}
    </span>
  );
}

const OUT = 256;  // saved size (px): ~15–30 KB

/** Crop a picture to a face circle: drag to move, slider to zoom. */
export function PhotoEditor({ player, onClose }: { player: { id: string; name: string; photo?: string }; onClose: () => void }) {
  const auth = useAuth();
  const by = (auth?.user?.displayName ?? auth?.user?.email ?? 'someone').split(/[\s@]/)[0];
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });   // image centre offset from the circle centre, in box px
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const BOX = 240;

  const open = (f: File) => {
    setError('');
    const u = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { setImg(im); setZoom(1); setPos({ x: 0, y: 0 }); };
    im.onerror = () => setError("That file isn't a picture this browser can open.");
    im.src = u;
  };
  // the picture covers the circle at zoom 1
  const base = img ? BOX / Math.min(img.width, img.height) : 1;
  const w = img ? img.width * base * zoom : 0, h = img ? img.height * base * zoom : 0;
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.max(-(w - BOX) / 2, Math.min((w - BOX) / 2, p.x)),
    y: Math.max(-(h - BOX) / 2, Math.min((h - BOX) / 2, p.y)),
  });
  useEffect(() => setPos(p => clamp(p)), [zoom]);  // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: ReactPointerEvent) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; };
  const move = (e: ReactPointerEvent) => { const d = drag.current; if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })); };

  const save = async (remove = false) => {
    setBusy(true); setError('');
    try {
      let data: string | null = null;
      if (!remove && img) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = OUT;
        const k = OUT / BOX;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, (BOX / 2 + pos.x - w / 2) * k, (BOX / 2 + pos.y - h / 2) * k, w * k, h * k);
        data = cv.toDataURL('image/webp', 0.82);
        if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/jpeg', 0.82);  // older Safari
      }
      await savePhoto(player.id, data, by);
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-t-2xl border border-line bg-surface p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold">{player.name}'s photo</h2>
        {img ? (
          <>
            <div className="relative mx-auto touch-none select-none overflow-hidden rounded-full bg-black" style={{ width: BOX, height: BOX }}
              onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }}>
              <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none"
                style={{ width: w, height: h, left: BOX / 2 + pos.x - w / 2, top: BOX / 2 + pos.y - h / 2 }} />
            </div>
            <p className="text-center text-xs text-muted">Drag to move · fit the face in the circle</p>
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={e => setZoom(Number(e.target.value))} className="w-full accent-[var(--color-ball)]" aria-label="Zoom" />
          </>
        ) : (
          <div className="flex justify-center py-2"><Avatar name={player.name} photo={player.photo} size={120} ring={3} /></div>
        )}
        <label className="block cursor-pointer rounded-lg border-2 border-dashed border-line p-3 text-center text-sm hover:border-muted">
          {img ? 'Choose a different picture' : 'Choose a picture'}
          <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && open(e.target.files[0])} />
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex gap-2">
          {img && <button disabled={busy} onClick={() => save()} className="flex-1 rounded-lg bg-ball py-2.5 font-semibold text-bg disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>}
          {!img && player.photo && <button disabled={busy} onClick={() => save(true)} className="flex-1 rounded-lg border border-line py-2.5 text-bad">Remove photo</button>}
          <button disabled={busy} onClick={onClose} className="flex-1 rounded-lg border border-line py-2.5">Cancel</button>
        </div>
      </div>
    </div>
  );
}
