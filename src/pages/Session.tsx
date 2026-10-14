// A Saturday's recap: who moved in the ratings, the session's leaders, and its plays to watch back to back.
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useGames } from '../lib/games';
import { usePlayers } from '../lib/data';
import { computeStats, STAT_LABELS, type StatKey } from '../lib/stats';
import { tier } from '../lib/ratings';
import { fmtDay, useRatingHistory } from '../lib/history';
import { Avatar } from '../components/Avatar';
import { ClipReel } from '../components/ClipReel';

const LEADERS: { k: StatKey; label: string }[] = [
  { k: 'kill', label: 'Kills' }, { k: 'ace', label: 'Aces' }, { k: 'assist', label: 'Assists' },
  { k: 'blockpt', label: 'Block points' }, { k: 'dig', label: 'Digs' }, { k: 'setpt', label: 'Set-over points' },
];
const REELS: StatKey[] = ['kill', 'ace', 'blockpt', 'assist'];
const lab = (s: StatKey) => LEADERS.find(x => x.k === s)?.label ?? STAT_LABELS[s];
const card = 'rounded-xl border border-line bg-surface p-4';

/** /sessions: the latest session. */
export function LatestSession() {
  const h = useRatingHistory();
  if (!h) return null;
  const last = h.sessions.at(-1);
  return last ? <Navigate to={`/sessions/${last}`} replace /> : <p className="text-muted">No tagged sessions yet.</p>;
}

export function Session() {
  const { date = '' } = useParams();
  const games = useGames();
  const { players } = usePlayers();
  const h = useRatingHistory();
  const [reel, setReel] = useState<StatKey>('kill');
  if (!games || !players || !h) return null;
  const k = h.sessions.indexOf(date);
  const prev = h.sessions[k - 1], next = h.sessions[k + 1];
  const dayGames = games.filter(g => g.date === date).sort((a, b) => a.title.localeCompare(b.title));
  if (!dayGames.length) return <p className="text-muted">No games on {date}. <Link to="/games" className="text-ball">All games</Link></p>;
  const name = (id: string) => players.find(p => p.id === id)?.name ?? id;
  const photo = (id: string) => players.find(p => p.id === id)?.photo;

  // rating changes for everyone who played (index k + 1: after this session; k: before it)
  const movers = k < 0 ? [] : players.flatMap(p => {
    const pts = h.byPlayer[p.id];
    const a = pts?.[k]?.ovr, b = pts?.[k + 1]?.ovr;
    return pts?.[k + 1]?.played && a != null && b != null ? [{ id: p.id, before: a, after: b, d: b - a }] : [];
  }).sort((x, y) => y.d - x.d || y.after - x.after);
  const stats = computeStats(dayGames);
  const top = (s: StatKey) => Object.entries(stats).map(([id, st]) => ({ id, n: st[s].length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const rallies = dayGames.reduce((n, g) => n + g.rallies.filter(r => r.st !== 'bad').length, 0);
  const clips = Object.entries(stats).flatMap(([id, st]) => st[reel].map(c => ({ ...c, who: id })))
    .sort((a, b) => a.title.localeCompare(b.title) || a.t - b.t)
    .flatMap((c, i) => {
      const g = dayGames.find(x => x.id === c.gameId);
      return g ? [{ key: `${c.gameId}|${c.t}|${i}`, youtubeId: g.youtubeId, s: c.s, e: Math.max(c.e, c.t + 2), label: `${lab(reel)} · ${name(c.who)}`, sub: g.title }] : [];
    });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-sm">
        {prev ? <Link to={`/sessions/${prev}`} className="text-muted">← {fmtDay(prev)}</Link> : <span />}
        {next ? <Link to={`/sessions/${next}`} className="text-muted">{fmtDay(next)} →</Link> : <span />}
      </div>
      <div>
        <h1 className="font-display text-3xl font-bold">{fmtDay(date, true)}</h1>
        <p className="text-sm text-muted">{dayGames.length} game{dayGames.length === 1 ? '' : 's'} · {rallies} rallies</p>
      </div>

      {movers.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold">Ratings this session</h2>
          {movers[0].d > 0 && (
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-raised p-3">
              <Avatar name={name(movers[0].id)} photo={photo(movers[0].id)} tier={tier(movers[0].after)} size={48} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted">Biggest riser</div>
                <Link to={`/players/${movers[0].id}`} className="font-semibold">{name(movers[0].id)}</Link>
              </div>
              <div className="text-right tabular-nums"><span className="text-muted">{movers[0].before} →</span> <b className="text-lg">{movers[0].after}</b> <span className="text-good">▲{movers[0].d}</span></div>
            </div>
          )}
          <ul className="mt-2 divide-y divide-line text-sm">
            {movers.map(m => (
              <li key={m.id}>
                <Link to={`/players/${m.id}`} className="flex items-center gap-3 py-2">
                  <Avatar name={name(m.id)} photo={photo(m.id)} tier={tier(m.after)} size={28} ring={1.5} />
                  <span className="flex-1">{name(m.id)}</span>
                  <span className="tabular-nums text-muted">{m.before} → <b className="text-ink">{m.after}</b></span>
                  <span className={`w-10 text-right tabular-nums ${m.d > 0 ? 'text-good' : m.d < 0 ? 'text-bad' : 'text-muted'}`}>{m.d > 0 ? `▲${m.d}` : m.d < 0 ? `▼${-m.d}` : '–'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {k < 0 && <p className={`${card} text-sm text-muted`}>This session's games aren't in the ratings yet (not tagged, or not applied by an admin).</p>}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">Session leaders</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LEADERS.map(({ k: s, label }) => {
            const t = top(s);
            return (
              <div key={s} className="rounded-xl border border-line bg-surface p-3">
                <div className="text-xs text-muted">{label}</div>
                {t[0] ? (
                  <Link to={`/players/${t[0].id}`} className="mt-1 flex items-center gap-2">
                    <Avatar name={name(t[0].id)} photo={photo(t[0].id)} size={24} ring={0} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{name(t[0].id)}</span>
                    <span className="font-display text-xl font-bold text-ball">{t[0].n}</span>
                  </Link>
                ) : <div className="mt-1 text-sm text-muted">–</div>}
                {t[1] && <div className="mt-0.5 truncate text-xs text-muted">then {t.slice(1, 3).map(x => `${name(x.id)} ${x.n}`).join(', ')}</div>}
              </div>
            );
          })}
        </div>
      </section>

      <section className={card}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <h2 className="mr-auto font-semibold">Watch the session</h2>
          {REELS.map(s => (
            <button key={s} onClick={() => setReel(s)}
              className={`rounded-full border px-2.5 py-1 text-xs ${reel === s ? 'border-ball bg-ball/20 text-ball' : 'border-line text-muted'}`}>
              {lab(s)}
            </button>
          ))}
        </div>
        {clips.length ? <ClipReel key={reel} clips={clips} /> : <p className="text-sm text-muted">None this session.</p>}
      </section>

      <section className={card}>
        <h2 className="font-semibold">Games</h2>
        <ul className="mt-1 divide-y divide-line text-sm">
          {dayGames.map(g => (
            <li key={g.id}><Link to={`/games/${g.id}`} className="flex justify-between py-2"><span>{g.title}</span><span className="text-muted">{g.rallies.filter(r => r.st !== 'bad').length} rallies →</span></Link></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
