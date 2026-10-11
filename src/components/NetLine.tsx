// Mark the top of the net on a frame of a video: the back camera's detector only counts the ball when it's
// above this line, and where the net sits depends on where the camera stood and how far it was zoomed.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const LAST = 'volleyrate.netLine';
/** The line the reviewer used last time (cameras often stand in the same place), as a fraction of the height. */
export const lastNetLine = (): number => {
  try { const v = Number(localStorage.getItem(LAST)); if (v > 0.1 && v < 0.95) return v; } catch { /* storage blocked */ }
  return 200 / 360;  // the first tuned back camera
};
const remember = (v: number) => { try { localStorage.setItem(LAST, String(v)); } catch { /* storage blocked */ } };

export function NetLine({ file, value, onChange }: { file: File; value: number; onChange: (v: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  const set = (v: number) => { const c = Math.min(0.95, Math.max(0.1, v)); onChange(c); remember(c); };
  const fromPointer = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    set((e.clientY - r.top) / r.height);
  };
  return (
    <div className="space-y-2">
      <p className="text-sm">Drag the yellow line onto the <b>top of the net</b>.</p>
      <div ref={box} className="relative aspect-video touch-none select-none overflow-hidden rounded-lg bg-black"
        onPointerDown={e => { (e.currentTarget as Element).setPointerCapture(e.pointerId); fromPointer(e); }}
        onPointerMove={e => { if (e.buttons) fromPointer(e); }}>
        {/* the frame is copied to a canvas: some browsers stop painting a paused video once it's drawn over */}
        <canvas ref={canvas} width={640} height={360} className="h-full w-full object-contain" />
        {url && (
          <video src={url} muted playsInline preload="auto" className="hidden"
            onLoadedMetadata={e => { const v = e.currentTarget; v.currentTime = Math.min(60, (v.duration || 0) / 4); }}
            onSeeked={e => canvas.current?.getContext('2d')?.drawImage(e.currentTarget, 0, 0, 640, 360)}
            onError={() => setFailed(true)} />
        )}
        {failed && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted">This browser can't show this video's picture. Try Safari, or set the line by eye: the net is usually about halfway up.</p>}
        <div className="pointer-events-none absolute inset-x-0 border-t-2 border-ball" style={{ top: `${value * 100}%` }}>
          <span className="absolute right-1 -top-5 rounded bg-ball px-1.5 text-[11px] font-semibold text-bg">top of the net</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 text-xs">
        <button type="button" onClick={() => set(value - 0.005)} className="rounded border border-line px-2 py-1">▲ up</button>
        <button type="button" onClick={() => set(value + 0.005)} className="rounded border border-line px-2 py-1">▼ down</button>
      </div>
    </div>
  );
}

/** Detector setting from the marked line (frames are analysed at 640×360). */
export const netParams = (frac: number) => ({ y_max: Math.round(frac * 360) });
