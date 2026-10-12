import { Link } from 'react-router-dom';
import type { Player } from '../lib/data';
import { CATEGORIES, categoryScore, overall, tier, type Position, type Ratings } from '../lib/ratings';
import { useTheme } from '../lib/theme';
import { Avatar, TIER_COLOR } from './Avatar';

type CardPlayer = Player & { base?: Ratings; prev?: Ratings; since?: string };

/** `as`: show the ratings weighted for another position (a what-if; the profile's positions stay as they are). */
export function PlayerCard(props: { player: CardPlayer; size?: 'md' | 'lg'; as?: Position }) {
  const clean = useTheme() === 'clean';
  if (clean) return props.size === 'lg' ? <TallCard {...props} /> : <WideCard {...props} />;
  return <ClassicCard {...props} />;
}

/** Overall (as a position), its change at the latest session, and the tier. */
function cardNumbers(player: CardPlayer, as?: Position) {
  const pos = as ?? player.positions[0] ?? 'OH';
  const ovr = overall(player.ratings, pos);
  const before = player.prev ?? player.base;
  const start = before ? overall(before, pos) : null;
  const diff = ovr !== null && start !== null ? ovr - start : 0;
  const since = player.since && new Date(`${player.since}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return { pos, ovr, diff, since, tier: tier(ovr), whatIf: !!as && as !== player.positions[0] };
}

const Change = ({ diff, since, long }: { diff: number; since?: string; long?: boolean }) => diff === 0 ? null : (
  <span className={diff > 0 ? 'text-good' : 'text-bad'} title={since ? `Change from the ${since} session` : undefined}>
    {diff > 0 ? '▲' : '▼'}{Math.abs(diff)}{long && since ? <span className="text-muted"> since {since}</span> : null}
  </span>
);

const Scores = ({ player, pos, cols }: { player: CardPlayer; pos: Position; cols: 3 | 6 }) => (
  <div className={`grid tabular-nums ${cols === 6 ? 'grid-cols-6 text-center' : 'grid-cols-3 gap-x-4 gap-y-0.5'}`}>
    {CATEGORIES.map(c => {
      const s = categoryScore(player.ratings, c.key, pos);
      return cols === 6
        ? <div key={c.key}><div className="text-[10px] text-muted">{c.short}</div><div className="text-sm font-semibold">{s === null ? '–' : Math.round(s)}</div></div>
        : <div key={c.key} className="flex justify-between text-sm"><span className="text-muted">{c.short}</span><span className="font-semibold">{s === null ? '–' : Math.round(s)}</span></div>;
    })}
  </div>
);

/** Clean, big: a tall collectible card with the face in the middle. */
function TallCard({ player, as }: { player: CardPlayer; as?: Position }) {
  const { pos, ovr, diff, since, tier: t, whatIf } = cardNumbers(player, as);
  const col = TIER_COLOR[t];
  return (
    <Link to={`/players/${player.id}`} className="relative mx-auto block max-w-sm overflow-hidden rounded-3xl bg-surface p-5 transition active:scale-[0.99]"
      style={{ boxShadow: `inset 0 0 0 1.5px ${col}`, backgroundImage: `radial-gradient(circle at 50% 38%, color-mix(in srgb, ${col} 22%, transparent) 0%, transparent 62%)` }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-5xl font-semibold leading-none tabular-nums" style={{ color: t === 'unrated' ? undefined : col }}>{ovr ?? 'NR'}</div>
          <div className="mt-1 text-sm font-medium text-muted">{whatIf ? `as ${pos}` : player.positions.join(' · ')}</div>
        </div>
        {player.number !== null && <div className="text-sm text-muted">#{player.number}</div>}
      </div>
      <div className="-mt-4 flex justify-center"><Avatar name={player.name} photo={player.photo} tier={t} size={148} ring={3} /></div>
      <div className="mt-3 truncate text-center text-2xl font-semibold">{player.name}</div>
      <div className="text-center text-sm"><Change diff={diff} since={since} long /></div>
      <div className="mt-4 border-t border-line pt-3"><Scores player={player} pos={pos} cols={3} /></div>
    </Link>
  );
}

/** Clean, grid: a wide card, face on the left and the six scores underneath. */
function WideCard({ player, as }: { player: CardPlayer; as?: Position }) {
  const { pos, ovr, diff, since, tier: t, whatIf } = cardNumbers(player, as);
  const col = TIER_COLOR[t];
  return (
    <Link to={`/players/${player.id}`} className="block overflow-hidden rounded-2xl bg-surface transition active:scale-[0.99]"
      style={{ boxShadow: `inset 0 3px 0 ${col}, inset 0 0 0 1px var(--color-line)` }}>
      <div className="flex items-center gap-3 p-3 pt-4">
        <Avatar name={player.name} photo={player.photo} tier={t} size={56} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{player.name}</div>
          <div className="truncate text-xs text-muted">{player.number !== null ? `#${player.number} · ` : ''}{whatIf ? `as ${pos}` : player.positions.join(' · ')}</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold leading-none tabular-nums" style={{ color: t === 'unrated' ? undefined : col }}>{ovr ?? 'NR'}</div>
          <div className="mt-0.5 text-xs"><Change diff={diff} since={since} /></div>
        </div>
      </div>
      <div className="border-t border-line px-2 py-2"><Scores player={player} pos={pos} cols={6} /></div>
    </Link>
  );
}

function ClassicCard({ player, size = 'md', as }: { player: CardPlayer; size?: 'md' | 'lg'; as?: Position }) {
  const pos = as ?? player.positions[0] ?? 'OH';
  const whatIf = !!as && as !== player.positions[0];
  const ovr = overall(player.ratings, pos);
  // change in overall from the latest session (ratings before it vs now)
  const before = player.prev ?? player.base;
  const start = before ? overall(before, pos) : null;
  const diff = ovr !== null && start !== null ? ovr - start : 0;
  const sinceLabel = player.since && new Date(`${player.since}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const big = size === 'lg';
  return (
    <Link
      to={`/players/${player.id}`}
      className={`tier-${tier(ovr)} relative block overflow-hidden rounded-2xl shadow-lg shadow-black/40 ${big ? 'p-5' : 'p-3.5'} transition active:scale-[0.98]`}
    >
      <div className="card-deco pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full border-[10px] border-current opacity-[0.08]" />
      <div className="flex items-start justify-between">
        <div>
          <div className={`card-ovr flex items-start gap-1 font-display font-bold leading-none ${big ? 'text-6xl' : 'text-4xl'}`}>
            {ovr ?? 'NR'}
            {diff !== 0 && (
              <span title={sinceLabel ? `Change from the ${sinceLabel} session` : 'Change from starting ratings'} className={`card-diff ${diff > 0 ? 'up' : 'down'} rounded px-1 py-0.5 font-sans font-bold leading-none ${big ? 'text-sm' : 'text-[10px]'} ${diff > 0 ? 'bg-green-900/80 text-green-200' : 'bg-red-900/80 text-red-200'}`}>
                {diff > 0 ? '▲' : '▼'}{Math.abs(diff)}{big && sinceLabel ? <span className="font-normal opacity-70"> {sinceLabel}</span> : null}
              </span>
            )}
          </div>
          <div className={`mt-1 font-display font-semibold tracking-wide opacity-80 ${big ? 'text-lg' : 'text-sm'}`}>
            {whatIf ? `as ${pos}` : player.positions.join(' / ')}
          </div>
        </div>
        {player.number !== null && (
          <div className={`card-num font-display font-bold opacity-30 ${big ? 'text-5xl' : 'text-3xl'}`}>#{player.number}</div>
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
