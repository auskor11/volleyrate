// The end-of-game scoreboard (Mobile Legends style): each team's players with their game rating, MVP badges,
// medals and titles. Winners first.
import { Link } from 'react-router-dom';
import { MEDAL_LABEL, type MatchResult, type MatchRow, type Medal } from '../lib/gameRating';
import type { Player } from '../lib/data';
import type { Team } from '../lib/rotation';
import { Avatar } from './Avatar';

export const MEDAL_COLOR: Record<Medal, string> = { mvp: '#f5c518', 'mvp-lose': '#b48cf2', gold: '#d4ab2c', silver: '#aeb8c6', bronze: '#c27d48' };

export function MedalBadge({ m, score }: { m: Medal; score: number }) {
  const c = MEDAL_COLOR[m];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: c, background: `color-mix(in srgb, ${c} 16%, transparent)` }}>
        {m === 'mvp' ? '👑 MVP' : m === 'mvp-lose' ? 'MVP' : MEDAL_LABEL[m]}
      </span>
      <span className="w-9 text-right font-display text-xl font-bold tabular-nums" style={{ color: c }}>{score.toFixed(1)}</span>
    </span>
  );
}

function Row({ r, p }: { r: MatchRow; p?: Player }) {
  const mvp = r.medal === 'mvp' || r.medal === 'mvp-lose';
  return (
    <li className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${mvp ? 'bg-raised' : ''}`}
      style={mvp ? { boxShadow: `inset 3px 0 0 ${MEDAL_COLOR[r.medal]}` } : undefined}>
      <Avatar name={p?.name ?? r.id} photo={p?.photo} size={30} ring={mvp ? 2 : 0} tier={r.medal === 'mvp' ? 'gold' : 'unrated'} />
      <div className="min-w-0 flex-1">
        <Link to={`/players/${r.id}`} className="block truncate text-sm font-semibold">{p?.name ?? r.id}</Link>
        {r.titles.length > 0 && <div className="truncate text-[11px] text-muted">{r.titles.join(' · ')}</div>}
      </div>
      <MedalBadge m={r.medal} score={r.score} />
    </li>
  );
}

export function MatchCard({ result, players }: { result: MatchResult; players: Player[] }) {
  const { rows, winner, final } = result;
  const p = (id: string) => players.find(x => x.id === id);
  const sides: (Team | null)[] = winner ? [winner, winner === 'a' ? 'b' : 'a'] : rows.some(r => r.team) ? ['a', 'b'] : [null];
  return (
    <section className="@container rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 className="font-semibold">Game ratings</h2>
        <span className="text-[11px] text-muted">0–10 for this game · separate from player ratings</span>
      </div>
      <div className={`grid gap-3 ${sides.length > 1 ? '@xl:grid-cols-2' : ''}`}>
        {sides.map(t => {
          const list = rows.filter(r => (t ? r.team === t : true));
          if (!list.length) return null;
          return (
            <div key={t ?? 'all'}>
              {t && (
                <div className="mb-1 flex items-center justify-between px-2 text-xs">
                  <span className={t === winner ? 'font-semibold text-good' : 'text-muted'}>Team {t.toUpperCase()} {t === winner ? '· Victory' : winner ? '· Defeat' : ''}</span>
                  {final && <span className="tabular-nums text-muted">{final[t]} pts</span>}
                </div>
              )}
              <ul className="space-y-0.5">{list.map(r => <Row key={r.id} r={r} p={p(r.id)} />)}</ul>
            </div>
          );
        })}
      </div>
      {rows.some(r => !r.team) && sides.length > 1 && <p className="mt-2 px-2 text-[11px] text-muted">Players not in the team setup aren't shown on a side.</p>}
    </section>
  );
}
