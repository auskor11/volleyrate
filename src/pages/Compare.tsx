// Two players side by side: cards, attributes, season numbers, and how they do together and against each other.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRatedPlayers } from '../lib/rated';
import { useGames } from '../lib/games';
import { CATEGORIES, categoryScore, overall } from '../lib/ratings';
import { grade, rate, seasonTable, type SeasonRow } from '../lib/season';
import { partners } from '../lib/partners';
import { PlayerCard } from '../components/PlayerCard';

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const LINES: { label: string; v: (r?: SeasonRow) => number | null; fmt?: (x: number | null) => string }[] = [
  { label: 'Average game rating', v: r => r?.rating ?? null, fmt: x => (x === null ? '–' : x.toFixed(1)) },
  { label: 'MVPs', v: r => r?.mvps ?? 0 },
  { label: 'Saturdays played', v: r => r?.sessions ?? 0 },
  { label: 'Kills', v: r => r?.n.kill ?? 0 },
  { label: 'Kill %', v: r => (r ? rate(r.n.kill ?? 0, r.n.attack ?? 0, 10) : null), fmt: pct },
  { label: 'Aces', v: r => r?.n.ace ?? 0 },
  { label: 'Serves in', v: r => (r ? rate((r.n.serve ?? 0) - (r.n.serr ?? 0), r.n.serve ?? 0, 10) : null), fmt: pct },
  { label: 'Block points', v: r => r?.n.blockpt ?? 0 },
  { label: 'Assists', v: r => r?.n.assist ?? 0 },
  { label: 'Digs', v: r => r?.n.dig ?? 0 },
  { label: 'Pass grade (1–3)', v: r => (r ? grade(r.n, 'pass') : null), fmt: x => (x === null ? '–' : x.toFixed(2)) },
];

export function Compare() {
  const [q, setQ] = useSearchParams();
  const { players } = useRatedPlayers();
  const games = useGames();
  const table = useMemo(() => (games ? seasonTable(games) : []), [games]);
  const book = useMemo(() => (games ? partners(games) : null), [games]);
  if (!players || !games || !book) return null;
  const sorted = [...players].sort((x, y) => x.name.localeCompare(y.name));
  const aId = q.get('a') ?? sorted[0]?.id, bId = q.get('b') ?? sorted.find(p => p.id !== aId)?.id;
  const A = players.find(p => p.id === aId), B = players.find(p => p.id === bId);
  const pick = (k: 'a' | 'b', id: string) => { const n = new URLSearchParams(q); n.set(k, id); setQ(n, { replace: true }); };
  const sel = 'w-full rounded-lg border border-line bg-raised px-3 py-2 text-ink';
  const row = (label: string, a: number | null, b: number | null, fmt: (x: number | null) => string = x => (x === null ? '–' : String(x))) => {
    const win = a !== null && b !== null && a !== b ? (a > b ? 'a' : 'b') : null;
    return (
      <div key={label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line py-1.5 text-sm tabular-nums">
        <span className={`text-right ${win === 'a' ? 'font-semibold text-ball' : 'text-muted'}`}>{fmt(a)}</span>
        <span className="text-center text-xs text-muted">{label}</span>
        <span className={win === 'b' ? 'font-semibold text-ball' : 'text-muted'}>{fmt(b)}</span>
      </div>
    );
  };
  const tog = A && B ? book.together[A.id]?.[B.id] : undefined, vs = A && B ? book.against[A.id]?.[B.id] : undefined;
  const ab = A && B ? book.assists[A.id]?.[B.id] ?? 0 : 0, ba = A && B ? book.assists[B.id]?.[A.id] ?? 0 : 0;
  const rowOf = (id?: string) => table.find(r => r.id === id);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">Compare</h1>
      <div className="grid grid-cols-2 gap-3">
        <select className={sel} value={aId} onChange={e => pick('a', e.target.value)}>{sorted.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className={sel} value={bId} onChange={e => pick('b', e.target.value)}>{sorted.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {A && B && (
        <>
          <div className="grid grid-cols-2 gap-3">{[A, B].map(p => <PlayerCard key={p.id} player={p} />)}</div>
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-1 font-semibold">Together and against</h2>
            <p className="text-sm">
              {tog ? <>Same team: <b>{tog.games}</b> game{tog.games === 1 ? '' : 's'}, won <b className="text-good">{tog.won}</b></> : 'Never on the same team yet'}
              <span className="text-muted"> · </span>
              {vs ? <>Head to head: <b>{A.name}</b> {vs.won}–{vs.games - vs.won} <b>{B.name}</b></> : 'never on opposite teams yet'}
            </p>
            <p className="mt-1 text-sm text-muted">Kills set up: {A.name} → {B.name} <b className="text-ink">{ab}</b> · {B.name} → {A.name} <b className="text-ink">{ba}</b></p>
          </section>
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-1 font-semibold">Ratings</h2>
            {row('Overall (main position)', overall(A.ratings, A.positions[0] ?? 'OH'), overall(B.ratings, B.positions[0] ?? 'OH'))}
            {CATEGORIES.map(c => row(c.label, Math.round(categoryScore(A.ratings, c.key, A.positions[0]) ?? 0) || null, Math.round(categoryScore(B.ratings, c.key, B.positions[0]) ?? 0) || null))}
          </section>
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-1 font-semibold">All games</h2>
            {LINES.map(l => row(l.label, l.v(rowOf(A.id)), l.v(rowOf(B.id)), l.fmt))}
          </section>
          <p className="text-center text-xs text-muted"><Link to="/stats" className="underline">Full leaderboards</Link></p>
        </>
      )}
    </div>
  );
}
