// Pictures to post in the group chat: a player card and a session recap, drawn on a canvas (1080×1350, the
// portrait size chat apps show best), then shared (phones) or downloaded (computers).
import { TIER_COLOR, type Tier } from '../components/Avatar';

const W = 1080, H = 1350;
const BG = '#0f1115', SURF = '#16191f', LINE = '#272b33', INK = '#e7e9ee', MUTED = '#8b919c', BALL = '#f5c518', GOOD = '#4cc38a', BAD = '#e5534b';
const font = (px: number, weight = 600) => `${weight} ${px}px Inter, system-ui, -apple-system, sans-serif`;

function canvas() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = BG; x.fillRect(0, 0, W, H);
  return { c, x };
}
const loadImage = (src: string) => new Promise<HTMLImageElement | null>(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function round(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, r: number) { x.beginPath(); x.roundRect(X, Y, w, h, r); }
function text(x: CanvasRenderingContext2D, s: string, X: number, Y: number, px: number, color = INK, weight = 600, align: CanvasTextAlign = 'left') {
  x.font = font(px, weight); x.fillStyle = color; x.textAlign = align; x.textBaseline = 'alphabetic'; x.fillText(s, X, Y);
}
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
async function face(x: CanvasRenderingContext2D, name: string, photo: string | undefined, cx: number, cy: number, r: number, ring: string) {
  x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); x.clip();
  const img = photo ? await loadImage(photo) : null;
  if (img) x.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else { x.fillStyle = '#232733'; x.fillRect(cx - r, cy - r, r * 2, r * 2); text(x, initials(name), cx, cy + r * 0.28, r * 0.8, ring, 700, 'center'); }
  x.restore();
  x.lineWidth = Math.max(4, r * 0.06); x.strokeStyle = ring; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
}
function footer(x: CanvasRenderingContext2D) {
  text(x, 'VolleyRate · Yappy\'s Bakery', W / 2, H - 50, 30, MUTED, 500, 'center');
}

export interface CardImage { name: string; photo?: string; number: number | null; positions: string; overall: number | null; tier: Tier; change?: { diff: number; since?: string }; scores: [string, number | null][]; extra?: string }

export async function playerCardImage(p: CardImage): Promise<Blob> {
  await document.fonts?.ready;
  const { c, x } = canvas();
  const col = TIER_COLOR[p.tier];
  const g = x.createRadialGradient(W / 2, 520, 50, W / 2, 520, 620);
  g.addColorStop(0, col + '44'); g.addColorStop(1, '#00000000');
  round(x, 60, 60, W - 120, H - 200, 48); x.fillStyle = SURF; x.fill(); x.fillStyle = g; x.fill();
  x.lineWidth = 6; x.strokeStyle = col; x.stroke();
  text(x, p.overall === null ? 'NR' : String(p.overall), 120, 230, 170, p.tier === 'unrated' ? INK : col, 700);
  text(x, p.positions, 126, 290, 44, MUTED, 500);
  if (p.number !== null) text(x, `#${p.number}`, W - 120, 170, 52, MUTED, 600, 'right');
  await face(x, p.name, p.photo, W / 2, 560, 230, col);
  text(x, p.name, W / 2, 890, 84, INK, 700, 'center');
  if (p.change && p.change.diff) text(x, `${p.change.diff > 0 ? '▲' : '▼'}${Math.abs(p.change.diff)}${p.change.since ? ` since ${p.change.since}` : ''}`, W / 2, 950, 40, p.change.diff > 0 ? GOOD : BAD, 600, 'center');
  x.fillStyle = LINE; x.fillRect(120, 990, W - 240, 3);
  p.scores.forEach(([label, v], i) => {
    const X = 150 + (i % 3) * 270, Y = 1065 + Math.floor(i / 3) * 80;
    text(x, label, X, Y, 38, MUTED, 500);
    text(x, v === null ? '–' : String(Math.round(v)), X + 200, Y, 46, INK, 700, 'right');
  });
  if (p.extra) text(x, p.extra, W / 2, H - 110, 32, MUTED, 500, 'center');
  footer(x);
  return new Promise(res => c.toBlob(b => res(b!), 'image/png'));
}

export interface RecapImage {
  date: string; games: number; rallies: number;
  mvp?: { name: string; photo?: string; avg: number; mvps: number };
  movers: { name: string; before: number; after: number }[];
  leaders: { label: string; name: string; n: number }[];
}

export async function recapImage(r: RecapImage): Promise<Blob> {
  await document.fonts?.ready;
  const { c, x } = canvas();
  text(x, 'Session recap', 80, 130, 44, BALL, 700);
  text(x, r.date, 80, 215, 72, INK, 700);
  text(x, `${r.games} game${r.games === 1 ? '' : 's'} · ${r.rallies} rallies`, 80, 270, 36, MUTED, 500);
  let y = 320;
  if (r.mvp) {
    round(x, 60, y, W - 120, 250, 32); x.fillStyle = SURF; x.fill(); x.lineWidth = 4; x.strokeStyle = BALL; x.stroke();
    await face(x, r.mvp.name, r.mvp.photo, 200, y + 125, 90, BALL);
    text(x, '👑 Session MVP', 320, y + 85, 36, BALL, 600);
    text(x, r.mvp.name, 320, y + 155, 64, INK, 700);
    text(x, `${r.mvp.mvps} MVP${r.mvp.mvps === 1 ? '' : 's'} · average game rating`, 320, y + 205, 30, MUTED, 500);
    text(x, r.mvp.avg.toFixed(1), W - 110, y + 160, 96, BALL, 700, 'right');
    y += 290;
  }
  if (r.movers.length) {
    text(x, 'Biggest risers', 80, y + 40, 38, MUTED, 600);
    r.movers.slice(0, 3).forEach((m, i) => {
      const Y = y + 105 + i * 64;
      text(x, m.name, 80, Y, 44, INK, 600);
      text(x, `${m.before} → ${m.after}`, W - 260, Y, 40, MUTED, 500, 'right');
      const d = m.after - m.before;
      text(x, `${d > 0 ? '▲' : d < 0 ? '▼' : ''}${Math.abs(d) || '–'}`, W - 80, Y, 44, d > 0 ? GOOD : d < 0 ? BAD : MUTED, 700, 'right');
    });
    y += 130 + Math.min(3, r.movers.length) * 64;
  }
  if (r.leaders.length) {
    text(x, 'Leaders', 80, y + 20, 38, MUTED, 600);
    r.leaders.slice(0, 4).forEach((l, i) => {
      const X = 60 + (i % 2) * 490, Y = y + 50 + Math.floor(i / 2) * 150;
      round(x, X, Y, 470, 130, 24); x.fillStyle = SURF; x.fill();
      text(x, l.label, X + 30, Y + 50, 32, MUTED, 500);
      text(x, l.name, X + 30, Y + 105, 44, INK, 700);
      text(x, String(l.n), X + 440, Y + 105, 60, BALL, 700, 'right');
    });
  }
  footer(x);
  return new Promise(res => c.toBlob(b => res(b!), 'image/png'));
}

/** Phones: the share sheet with the picture; computers: download it. */
export async function shareImage(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
