// A Saturday's recap: who moved in the ratings, the session's leaders, and its plays to watch back to back.
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { isGuest, rallyResult, useGames } from '../lib/games';
import { usePlayers } from '../lib/data';
import { computeStats, sameTeamIn, STAT_LABELS, type StatKey } from '../lib/stats';
import { tier } from '../lib/ratings';
import { fmtDay, useRatingHistory } from '../lib/history';
import { Avatar } from '../components/Avatar';
import { ClipReel } from '../components/ClipReel';
import { MEDAL_COLOR, MedalBadge } from '../components/MatchCard';
import { GAME_RATING, matchRatings, type Medal } from '../lib/gameRating';

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
  const [reel, setReel] = useState<StatKey | 'all'>('all');
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
  // game ratings: each game's MVP, and the session MVP (best average over the games they played; at least half)
  const matches = dayGames.flatMap(g => { const result = matchRatings(g); return result ? [{ game: g, result }] : []; });
  const per: Record<string, { sum: number; n: number; mvps: number; loseMvps: number }> = {};
  for (const { result } of matches) for (const r of result.rows) {
    const x = (per[r.id] ??= { sum: 0, n: 0, mvps: 0, loseMvps: 0 });
    x.sum += r.score; x.n++; if (r.medal === 'mvp') x.mvps++; if (r.medal === 'mvp-lose') x.loseMvps++;
  }
  const sessionMvp = Object.entries(per).filter(([, x]) => x.n * 2 >= matches.length)
    .map(([id, x]) => ({ id, avg: x.sum / x.n, n: x.n, mvps: x.mvps }))
    .sort((a, b) => b.avg - a.avg || b.mvps - a.mvps)[0];
  // session ratings: everyone's average game rating today, medals by the same cut-offs, Session MVP on top
  const board = Object.entries(per).map(([id, x]) => {
    const avg = Math.round((x.sum / x.n) * 10) / 10;
    const medal: Medal = id === sessionMvp?.id ? 'mvp' : avg >= GAME_RATING.medals.gold ? 'gold' : avg >= GAME_RATING.medals.silver ? 'silver' : 'bronze';
    return { id, avg, n: x.n, mvps: x.mvps, loseMvps: x.loseMvps, medal, short: x.n * 2 < matches.length };
  }).sort((a, b) => (b.medal === 'mvp' ? 1 : 0) - (a.medal === 'mvp' ? 1 : 0) || b.avg - a.avg || b.mvps - a.mvps);
  const rallies = dayGames.reduce((n, g) => n + g.rallies.filter(r => r.st !== 'bad').length, 0);
  // "All": every rally won by a kill, ace, block or set over, once each (a kill's assist is in its label)
  const compilation = dayGames.flatMap(g => {
    const same = sameTeamIn(g);
    return g.rallies.filter(r => r.st !== 'bad').sort((a, b) => a.s - b.s).flatMap(r => {
      const res = rallyResult(r, same);
      if (!res?.good || !['Kill', 'Ace', 'Block', 'Set over'].includes(res.label) || isGuest(res.who)) return [];
      return [{ key: `${g.id}|${r.s}`, youtubeId: g.youtubeId, s: r.s, e: r.e,
        label: `${res.label} · ${name(res.who)}${res.assist && !isGuest(res.assist) ? ` (assist ${name(res.assist)})` : ''}`, sub: g.title }];
    });
  });
  const clips = reel === 'all' ? compilation : Object.entries(stats).flatMap(([id, st]) => st[reel].map(c => ({ ...c, who: id })))
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

      {matches.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold">MVPs</h2>
          {sessionMvp && (
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-raised p-3" style={{ boxShadow: `inset 3px 0 0 ${MEDAL_COLOR.mvp}` }}>
              <Avatar name={name(sessionMvp.id)} photo={photo(sessionMvp.id)} tier="gold" size={48} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted">👑 Session MVP · best average game rating</div>
                <Link to={`/players/${sessionMvp.id}`} className="font-semibold">{name(sessionMvp.id)}</Link>
                <div className="text-xs text-muted">{sessionMvp.n} game{sessionMvp.n === 1 ? '' : 's'}{sessionMvp.mvps ? ` · ${sessionMvp.mvps} MVP${sessionMvp.mvps === 1 ? '' : 's'}` : ''}</div>
              </div>
              <span className="font-display text-2xl font-bold tabular-nums" style={{ color: MEDAL_COLOR.mvp }}>{sessionMvp.avg.toFixed(1)}</span>
            </div>
          )}
          <ul className="mt-2 divide-y divide-line text-sm">
            {matches.map(({ game: g, result }) => {
              const m = result.rows.find(r => r.medal === 'mvp');
              return m && (
                <li key={g.id}>
                  <Link to={`/games/${g.id}?box=1`} className="flex items-center gap-3 py-2">
                    <span className="w-28 shrink-0 truncate text-muted">{g.title.replace(/^\d+ \w+ \d+ /, '')}</span>
                    <Avatar name={name(m.id)} photo={photo(m.id)} size={26} ring={0} />
                    <span className="min-w-0 flex-1 truncate">{name(m.id)}</span>
                    <MedalBadge m="mvp" score={m.score} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {board.length > 0 && (
        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">Session ratings</h2>
            <span className="text-[11px] text-muted">average game rating today</span>
          </div>
          <ol className="mt-2 space-y-0.5 text-sm">
            {board.map((x, i) => (
              <li key={x.id}>
                <Link to={`/players/${x.id}`} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${x.medal === 'mvp' ? 'bg-raised' : ''}`}
                  style={x.medal === 'mvp' ? { boxShadow: `inset 3px 0 0 ${MEDAL_COLOR.mvp}` } : undefined}>
                  <span className="w-4 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                  <Avatar name={name(x.id)} photo={photo(x.id)} size={28} ring={0} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{name(x.id)}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {x.n} of {matches.length} game{matches.length === 1 ? '' : 's'}{x.mvps ? ` · 👑 ${x.mvps}` : ''}{x.loseMvps ? ` · MVP (lose) ${x.loseMvps}` : ''}{x.short ? ' · too few games for MVP' : ''}
                    </span>
                  </span>
                  <MedalBadge m={x.medal} score={x.avg} />
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

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
          {(['all', ...REELS] as const).map(s => (
            <button key={s} onClick={() => setReel(s)}
              className={`rounded-full border px-2.5 py-1 text-xs ${reel === s ? 'border-ball bg-ball/20 text-ball' : 'border-line text-muted'}`}>
              {s === 'all' ? `All (${compilation.length})` : lab(s)}
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
    </div>
  );
}
