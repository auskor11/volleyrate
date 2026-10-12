import { Link } from 'react-router-dom';
import { PlayerCard } from '../components/PlayerCard';
import { useAuth } from '../lib/auth';
import { usePlayers } from '../lib/data';
import { useRatedPlayers } from '../lib/rated';
import { useGames } from '../lib/games';
import { LEADER_STATS, computeStats } from '../lib/stats';
import { overall, tier } from '../lib/ratings';
import { useTheme } from '../lib/theme';
import { Avatar } from '../components/Avatar';

export function Home() {
  const { member, user } = useAuth();
  const { players } = useRatedPlayers();
  const clean = useTheme() === 'clean';
  const me = players?.find(p => p.id === member?.playerId);
  const ranked = (players ?? [])
    .map(p => ({ p, ovr: overall(p.ratings, p.positions[0] ?? 'OH') }))
    .filter(x => x.ovr !== null)
    .sort((a, b) => b.ovr! - a.ovr!);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">
        Hi {me?.name ?? user?.displayName?.split(' ')[0] ?? 'there'}
      </h1>

      {me ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Your card</h2>
          <PlayerCard player={me} size="lg" />
        </section>
      ) : (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
          Your account isn't linked to a player card yet.
        </p>
      )}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Top rated</h2>
          <Link to="/players" className="text-sm text-ball">All players</Link>
        </div>
        {ranked.length ? (
          <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {ranked.slice(0, 5).map(({ p, ovr }, i) => (
              <li key={p.id}>
                <Link to={`/players/${p.id}`} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-5 font-display text-muted">{i + 1}</span>
                  {clean && <Avatar name={p.name} photo={p.photo} tier={tier(ovr)} size={32} />}
                  <span className="flex-1 font-medium">{p.name}</span>
                  <span className="text-xs text-muted">{p.positions[0]}</span>
                  <span className="w-8 text-right font-display text-xl font-bold">{ovr}</span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">No ratings published yet.</p>
        )}
      </section>

      <Leaders />

      <Link to="/games" className="block rounded-xl border border-line bg-surface p-4">
        <h2 className="font-semibold">Game film →</h2>
        <p className="mt-1 text-sm text-muted">Watch every rally from our recorded games.</p>
      </Link>
    </div>
  );
}

function Leaders() {
  const clean = useTheme() === 'clean';
  const games = useGames();
  const { players } = usePlayers();
  if (!games || !players) return null;
  const stats = computeStats(games);
  if (!Object.keys(stats).length) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Leaders</h2>
      <div className="grid grid-cols-2 gap-2">
        {LEADER_STATS.map(({ k, label }) => {
          const top = Object.entries(stats).map(([id, s]) => ({ id, n: s[k].length }))
            .filter(x => x.n > 0).sort((a, b) => b.n - a.n)[0];
          const p = top && players.find(x => x.id === top.id);
          return (
            <div key={k} className="rounded-xl border border-line bg-surface p-3">
              <div className="text-xs text-muted">{label}</div>
              {p ? (
                <Link to={`/players/${p.id}`} className={`mt-0.5 flex justify-between gap-2 ${clean ? 'items-center' : 'items-baseline'}`}>
                  {clean && <Avatar name={p.name} photo={p.photo} size={26} ring={0} />}
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <span className="font-display text-xl font-bold text-ball">{top.n}</span>
                </Link>
              ) : <div className="mt-0.5 text-sm text-muted">–</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
