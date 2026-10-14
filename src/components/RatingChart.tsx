// A player's overall across sessions: one line (no legend; the heading names it), a dot for each session they
// played, a hover/tap tooltip, quiet gridlines. Sessions they missed carry the line on without a dot.
import { useEffect, useRef, useState } from 'react';
import { fmtDay, type HistoryPoint } from '../lib/history';

const H = 150, PAD = { l: 30, r: 12, t: 12, b: 24 };

export function RatingChart({ points }: { points: HistoryPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = points.map((p, i) => ({ ...p, i })).filter(p => p.ovr !== null) as (HistoryPoint & { i: number; ovr: number })[];
  if (pts.length < 2) return <p className="text-sm text-muted">The chart starts after this player's first tagged session.</p>;
  const vals = pts.map(p => p.ovr);
  const lo = Math.floor((Math.min(...vals) - 2) / 5) * 5, hi = Math.ceil((Math.max(...vals) + 2) / 5) * 5;
  const x = (i: number) => PAD.l + (i / Math.max(1, points.length - 1)) * (w - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - PAD.t - PAD.b);
  const ticks = Array.from({ length: Math.floor((hi - lo) / 5) + 1 }, (_, k) => lo + k * 5).filter((_, k, a) => a.length <= 5 || k % 2 === 0);
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.ovr).toFixed(1)}`).join(' ');
  const h = hover !== null ? pts.find(p => p.i === hover) : undefined;
  const prev = h ? pts.filter(p => p.i < h.i).at(-1) : undefined;
  const label = (p: HistoryPoint) => (p.date ? fmtDay(p.date) : 'Start');

  // nearest point to the pointer (hit area: the whole plot, not just the dots)
  const pick = (cx: number) => {
    const r = box.current!.getBoundingClientRect();
    const px = cx - r.left;
    let best = pts[0];
    for (const p of pts) if (Math.abs(x(p.i) - px) < Math.abs(x(best.i) - px)) best = p;
    setHover(best.i);
  };

  return (
    <div ref={box} className="relative select-none" onPointerMove={e => pick(e.clientX)} onPointerDown={e => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
      <svg width={w} height={H} role="img" aria-label={`Overall by session: ${pts.map(p => `${label(p)} ${p.ovr}`).join(', ')}`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">{t}</text>
          </g>
        ))}
        {[0, points.length - 1].map(i => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i ? 'end' : 'start'} fontSize={11} fill="var(--color-muted)">{label(points[i])}</text>
        ))}
        {h && <line x1={x(h.i)} x2={x(h.i)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-muted)" strokeWidth={1} strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke="var(--color-ball)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.filter(p => p.played || p.date === null).map(p => (
          <circle key={p.i} cx={x(p.i)} cy={y(p.ovr)} r={p.i === hover ? 5.5 : 4} fill="var(--color-ball)" stroke="var(--color-surface)" strokeWidth={2} />
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(0, x(h.i) - 60), w - 130), width: 130 }}>
          <div className="text-muted">{h.date ? fmtDay(h.date, true) : 'Starting rating'}</div>
          <div className="font-semibold tabular-nums">
            {h.ovr}{prev && h.ovr !== prev.ovr && <span className={h.ovr > prev.ovr ? 'text-good' : 'text-bad'}> {h.ovr > prev.ovr ? '▲' : '▼'}{Math.abs(h.ovr - prev.ovr)}</span>}
          </div>
          {h.date && !h.played && <div className="text-muted">didn't play</div>}
        </div>
      )}
    </div>
  );
}
