// Mark the top of the net on a video: the back camera's detector only counts the ball when it's above this line,
// and where the net sits depends on where the camera stood and how far it was zoomed. The line can tilt (a slanted
// camera) and can change partway through (the camera got hit): each change is a mark "from this time, this line".
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { fmtTime } from '../lib/games';

/** From time t (seconds into the video), the top of the net runs from l (left edge) to r (right edge), as fractions of the height. */
export interface NetMark { t: number; l: number; r: number }

const LAST = 'volleyrate.netLine';
const clamp = (v: number) => Math.min(0.95, Math.max(0.1, v));
/** The line the reviewer used last time (cameras often stand in the same place). */
export const lastNetLine = (): NetMark[] => {
  try {
    const [l, r = l] = (localStorage.getItem(LAST) ?? '').split(',').map(Number);
    if (l > 0.1 && l < 0.95 && r > 0.1 && r < 0.95) return [{ t: 0, l, r }];
  } catch { /* storage blocked */ }
  return [{ t: 0, l: 200 / 360, r: 200 / 360 }];  // the first tuned back camera
};
const remember = (m: NetMark) => { try { localStorage.setItem(LAST, `${m.l},${m.r}`); } catch { /* storage blocked */ } };

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** As saved on a game or camera: net (the first line's middle, for older readers) and netMarks [t, l, r, ...]. */
export const packNet = (m: NetMark[]) => ({ net: r3((m[0].l + m[0].r) / 2), netMarks: m.flatMap(x => [Math.round(x.t * 10) / 10, r3(x.l), r3(x.r)]) });
export function unpackNet(c: { net?: number; netMarks?: number[] }): NetMark[] | null {
  const n = c.netMarks;
  if (n?.length) return Array.from({ length: n.length / 3 }, (_, i) => ({ t: n[3 * i], l: n[3 * i + 1], r: n[3 * i + 2] }));
  return c.net ? [{ t: 0, l: c.net, r: c.net }] : null;
}
const activeAt = (m: NetMark[], t: number) => { let k = 0; m.forEach((x, i) => { if (x.t <= t) k = i; }); return k; };

export function NetLine({ file, value, onChange }: { file: File; value: NetMark[]; onChange: (v: NetMark[]) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState(0);
  const [at, setAt] = useState(0);                 // the frame shown (seconds)
  const seeking = useRef(false), want = useRef<number | null>(null);
  const drag = useRef<{ part: 'l' | 'r' | 'both'; y: number; from: NetMark } | null>(null);
  useEffect(() => { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);

  const k = activeAt(value, at), line = value[k];
  const seek = (t: number) => {
    setAt(t);
    const v = video.current; if (!v) return;
    if (seeking.current) { want.current = t; return; }  // scrubbing: catch up once this seek lands
    seeking.current = true; v.currentTime = t;
  };
  const put = (m: NetMark) => {
    const c = { ...m, l: clamp(m.l), r: clamp(m.r) };
    onChange(value.map((x, i) => (i === k ? c : x)));
    if (k === 0) remember(c);
  };
  const start = (e: ReactPointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const rect = box.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
    // grab an end to tilt the line, or the middle to move all of it; tapping away from the line jumps that part there
    const part = x < 0.25 ? 'l' : x > 0.75 ? 'r' : 'both';
    const lineY = line.l + (line.r - line.l) * x;
    const from = Math.abs(y - lineY) < 0.06 ? line
      : part === 'both' ? { ...line, l: line.l + y - lineY, r: line.r + y - lineY }
      : { ...line, [part]: y };
    drag.current = { part, y, from };
    put(from);
  };
  const follow = (e: ReactPointerEvent) => {
    const d = drag.current; if (!d || !e.buttons) return;
    const rect = box.current!.getBoundingClientRect();
    const dy = (e.clientY - rect.top) / rect.height - d.y;
    put({ ...d.from, l: d.part === 'r' ? d.from.l : d.from.l + dy, r: d.part === 'l' ? d.from.r : d.from.r + dy });
  };
  const moved = () => {
    if (value.some(x => Math.abs(x.t - at) < 1)) return;
    onChange([...value, { ...line, t: Math.round(at * 10) / 10 }].sort((a, b) => a.t - b.t));
  };
  const nudge = (dl: number, dr: number) => put({ ...line, l: line.l + dl, r: line.r + dr });
  const yAt = (x: number) => (line.l + (line.r - line.l) * x) * 100;
  const btn = 'rounded border border-line px-2 py-1';

  return (
    <div className="space-y-2">
      <p className="text-sm">
        Drag the yellow line onto the <b>top of the net</b>. Drag an <b>end</b> to tilt it if the camera is slanted.
        {' '}If the camera got knocked partway, slide to just after it and tap <b>Camera moved here</b>.
      </p>
      <div ref={box} className="relative aspect-video touch-none select-none overflow-hidden rounded-lg bg-black"
        onPointerDown={start} onPointerMove={follow} onPointerUp={() => { drag.current = null; }}>
        {/* the frame is copied to a canvas: some browsers stop painting a paused video once it's drawn over */}
        <canvas ref={canvas} width={640} height={360} className="h-full w-full object-contain" />
        {url && (
          <video ref={video} src={url} muted playsInline preload="auto" className="hidden"
            onLoadedMetadata={e => { const d = e.currentTarget.duration || 0; setDuration(d); seek(Math.min(60, d / 4)); }}
            onSeeked={e => {
              canvas.current?.getContext('2d')?.drawImage(e.currentTarget, 0, 0, 640, 360);
              seeking.current = false;
              if (want.current != null) { const t = want.current; want.current = null; seek(t); }
            }}
            onError={() => setFailed(true)} />
        )}
        {failed && <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted">This browser can't show this video's picture. Try Safari, or set the line by eye: the net is usually about halfway up.</p>}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="0" y1={yAt(0)} x2="100" y2={yAt(1)} style={{ stroke: 'var(--color-ball)' }} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {[0.03, 0.97].map(x => (
          <span key={x} className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-ball"
            style={{ left: `${x * 100}%`, top: `${yAt(x)}%` }} />
        ))}
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-6 whitespace-nowrap rounded bg-ball px-1.5 text-[11px] font-semibold text-bg"
          style={{ top: `${yAt(0.5)}%` }}>top of the net{value.length > 1 ? ` · from ${fmtTime(line.t)}` : ''}</span>
      </div>
      {duration > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="w-12 tabular-nums text-muted">{fmtTime(at)}</span>
          <input type="range" min={0} max={duration} step={0.5} value={at} onChange={e => seek(Number(e.target.value))}
            className="flex-1 accent-[var(--color-ball)]" aria-label="Video time" />
          <span className="w-12 text-right tabular-nums text-muted">{fmtTime(duration)}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
        <button type="button" onClick={() => nudge(-0.005, -0.005)} className={btn}>▲ up</button>
        <button type="button" onClick={() => nudge(0.005, 0.005)} className={btn}>▼ down</button>
        <button type="button" onClick={() => nudge(0.005, -0.005)} className={btn} aria-label="Tilt: left end down">↘ tilt</button>
        <button type="button" onClick={() => nudge(-0.005, 0.005)} className={btn} aria-label="Tilt: right end down">↗ tilt</button>
        {line.l !== line.r && <button type="button" onClick={() => put({ ...line, l: (line.l + line.r) / 2, r: (line.l + line.r) / 2 })} className={btn}>Level</button>}
        {duration > 0 && <button type="button" onClick={moved} className={`${btn} border-ball text-ball`}>Camera moved here</button>}
      </div>
      {value.length > 1 && (
        <ul className="space-y-1 text-xs">
          {value.map((m, i) => (
            <li key={m.t} className={`flex items-center gap-2 rounded px-2 py-1 ${i === k ? 'bg-raised' : ''}`}>
              <button type="button" className="flex-1 text-left" onClick={() => seek(i === 0 ? Math.min(60, value[1].t / 2) : m.t + 1)}>
                {i === 0 ? 'From the start' : `Camera moved at ${fmtTime(m.t)}`}{m.l !== m.r ? ' · tilted' : ''}
              </button>
              {i > 0 && <button type="button" className="text-muted hover:text-bad" aria-label={`Remove the change at ${fmtTime(m.t)}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Detector settings from the marked lines (frames are analysed at 640×360). */
export const netParams = (m: NetMark[]) => ({
  y_max: Math.round(((m[0].l + m[0].r) / 2) * 360),
  net: m.flatMap(x => [x.t, Math.round(x.l * 360), Math.round(x.r * 360)]),
});
