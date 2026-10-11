import { Link } from 'react-router-dom';
import type { Player } from '../lib/data';
import { CATEGORIES, categoryScore, overall, tier, type Position, type Ratings } from '../lib/ratings';

/** `as`: show the ratings weighted for another position (a what-if; the profile's positions stay as they are). */
export function PlayerCard({ player, size = 'md', as }: { player: Player & { base?: Ratings }; size?: 'md' | 'lg'; as?: Position }) {
  const pos = as ?? player.positions[0] ?? 'OH';
  const whatIf = !!as && as !== player.positions[0];
  const ovr = overall(player.ratings, pos);
  const start = player.base ? overall(player.base, pos) : null;
  const diff = ovr !== null && start !== null ? ovr - start : 0;
  const big = size === 'lg';
  return (
    <Link
      to={`/players/${player.id}`}
      className={`tier-${tier(ovr)} relative block overflow-hidden rounded-2xl shadow-lg shadow-black/40 ${big ? 'p-5' : 'p-3.5'} transition active:scale-[0.98]`}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full border-[10px] border-current opacity-[0.08]" />
      <div className="flex items-start justify-between">
        <div>
          <div className={`flex items-start gap-1 font-display font-bold leading-none ${big ? 'text-6xl' : 'text-4xl'}`}>
            {ovr ?? 'NR'}
            {diff !== 0 && (
              <span className={`rounded px-1 py-0.5 font-sans font-bold leading-none ${big ? 'text-sm' : 'text-[10px]'} ${diff > 0 ? 'bg-green-900/80 text-green-200' : 'bg-red-900/80 text-red-200'}`}>
                {diff > 0 ? '▲' : '▼'}{Math.abs(diff)}
              </span>
            )}
          </div>
          <div className={`mt-1 font-display font-semibold tracking-wide opacity-80 ${big ? 'text-lg' : 'text-sm'}`}>
            {whatIf ? `as ${pos}` : player.positions.join(' / ')}
          </div>
        </div>
        {player.number !== null && (
          <div className={`font-display font-bold opacity-30 ${big ? 'text-5xl' : 'text-3xl'}`}>#{player.number}</div>
        )}
      </div>
      <div className={`mt-3 truncate font-display font-bold uppercase tracking-wide ${big ? 'text-3xl' : 'text-lg'}`}>
        {player.name}
      </div>
      <div className={`mt-2 grid grid-cols-3 gap-x-3 gap-y-0.5 font-display ${big ? 'text-base' : 'text-xs'}`}>
        {CATEGORIES.map(c => {
          const s = categoryScore(player.ratings, c.key, pos);
          return (
            <div key={c.key} className="flex justify-between gap-1">
              <span className="opacity-60">{c.short}</span>
              <span className="font-bold">{s === null ? '–' : Math.round(s)}</span>
            </div>
          );
        })}
      </div>
    </Link>
  );
}

export function AttrBar({ label, value }: { label: string; value: number | undefined }) {
  const v = typeof value === 'number' ? value : null;
  const color = v === null ? 'bg-line' : v >= 80 ? 'bg-good' : v >= 70 ? 'bg-ball' : v >= 60 ? 'bg-orange-400' : 'bg-bad';
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-36 shrink-0 text-sm text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${v ?? 0}%` }} />
      </div>
      <span className="w-8 text-right font-display font-semibold tabular-nums">{v ?? '–'}</span>
    </div>
  );
}
