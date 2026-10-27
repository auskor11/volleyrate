import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { PhotoEditor } from '../components/Avatar';
import { removeHighlight, useHighlights, type Highlight } from '../lib/highlights';
import { ClipReel } from '../components/ClipReel';
import { RatingChart } from '../components/RatingChart';
import { MedalBadge } from '../components/MatchCard';
import { useMatchRatings } from '../lib/gameRating';
import { partners } from '../lib/partners';
import { fmtDay, useRatingHistory } from '../lib/history';
import { HighlightDialog, ShareRally } from '../components/RallyActions';
import { Link, useParams } from 'react-router-dom';
import { AttrBar, PlayerCard } from '../components/PlayerCard';
import { useRatedPlayers } from '../lib/rated';
import { BLOCK_CREDIT, METRICS, experience, metricsFor, type RatingModel } from '../lib/engine';
import { fmtTime, useGames } from '../lib/games';
import { savePositions, usePlayers } from '../lib/data';
import { STAT_GROUPS, STAT_LABELS, avgGrade, computeStats, ratio, taggedGames, type StatKey } from '../lib/stats';
import { CATEGORIES, POSITIONS, categoryScore, categoryWeights, overall, type Position } from '../lib/ratings';

export function Players() {
  const { players, error } = useRatedPlayers();
  const [pos, setPos] = useState<Position | 'ALL'>('ALL');
  const clean = useTheme() === 'clean';
  if (error) return <p className="text-bad">{error}</p>;
  if (!players) return null;
  const list = players
    .filter(p => pos === 'ALL' || p.positions.includes(pos))
    .map(p => ({ p, ovr: overall(p.ratings, pos !== 'ALL' ? pos : p.positions[0] ?? 'OH') }))
    .sort((a, b) => (b.ovr ?? -1) - (a.ovr ?? -1) || a.p.name.localeCompare(b.p.name));

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Players</h1>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {(['ALL', ...Object.keys(POSITIONS)] as const).map(k => (
          <button
            key={k}
            onClick={() => setPos(k as Position | 'ALL')}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium ${pos === k ? 'border-ball bg-ball text-bg' : 'border-line text-muted'}`}
          >
            {k === 'ALL' ? 'All' : k}
          </button>
        ))}
      </div>
      <div className={`mt-4 grid gap-3 ${clean ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
        {list.map(({ p }) => <PlayerCard key={p.id} player={p} as={pos !== 'ALL' && clean ? pos : undefined} />)}
      </div>
      {pos !== 'ALL' && (
        <p className="mt-3 text-xs text-muted">Overalls shown as a {POSITIONS[pos]}.</p>
      )}
    </div>
  );
}

export function PlayerDetail() {
  const { id } = useParams();
  const { players, model } = useRatedPlayers();
  const [as, setAs] = useState<Position | null>(null);  // what-if position (reset when opening another player)
  const [photo, setPhoto] = useState(false);
  const isMember = !!useAuth()?.isPlayer;
  const isGuest = useAuth()?.isGuest ?? true;  // highlights are for the team (they record who added them)  // players and admins change photos (viewers and editors don't)
  useEffect(() => setAs(null), [id]);
  if (!players || !model) return null;
  const p = players.find(x => x.id === id);
  if (!p) return <p className="text-muted">Player not found. <Link to="/players" className="text-ball">Back</Link></p>;
  const main = p.positions[0] ?? 'OH';
  const pos = as ?? main;

  return (
    <div className="space-y-5">
      <Link to="/players" className="text-sm text-muted">← Players</Link>
      <PlayerCard player={p} size="lg" as={pos} />
      {isMember && (
        <div className="-mt-2 flex items-center justify-center gap-2 text-xs text-muted">
          <button className="rounded-md border border-line px-2.5 py-1 text-ink" onClick={() => setPhoto(true)}>📷 {p.photo ? 'Change photo' : 'Add photo'}</button>
          {p.photo && p.photoBy && <span>photo by {p.photoBy}</span>}
        </div>
      )}
      {photo && <PhotoEditor player={p} onClose={() => setPhoto(false)} />}
      <section className="rounded-xl border border-line bg-surface p-3">
        <p className="text-xs text-muted">Overall at each position (tap one to see the ratings weighted that way)</p>
        <div className="clean-only mt-2 flex flex-wrap gap-1.5">
          {(Object.keys(POSITIONS) as Position[]).map(k => (
            <button key={k} onClick={() => setAs(k === main ? null : k)} title={POSITIONS[k]}
              className={`rounded-full border px-3 py-1 text-sm tabular-nums ${pos === k ? 'border-ball bg-ball/20 font-semibold text-ball' : 'border-line text-ink'}`}>
              {k} <b className="font-semibold">{overall(p.ratings, k) ?? 'NR'}</b>{p.positions.includes(k) && <span className="ml-0.5 text-muted">✓</span>}
            </button>
          ))}
        </div>
        <div className="classic-only mt-2 grid grid-cols-5 gap-1.5">
          {(Object.keys(POSITIONS) as Position[]).map(k => {
            const o = overall(p.ratings, k);
            return (
              <button key={k} onClick={() => setAs(k === main ? null : k)}
                className={`rounded-lg border py-1.5 text-center ${pos === k ? 'border-ball bg-ball/20 text-ball' : 'border-line'}`}>
                <div className="font-display text-xl font-bold">{o ?? 'NR'}</div>
                <div className="text-[11px] text-muted">{k}{p.positions.includes(k) ? ' ✓' : ''}</div>
              </button>
            );
          })}
        </div>
        <PositionsEditor player={p} />
        {pos !== main && (
          <p className="mt-2 text-xs text-muted">
            What if {p.name.split(' ')[0]} played {POSITIONS[pos].toLowerCase()}: the same attribute ratings, weighted for that
            position. Their profile stays {p.positions.join(' / ') || 'unset'}.{' '}
            <button className="text-ball underline" onClick={() => setAs(null)}>Back to {main}</button>
          </p>
        )}
      </section>
      <RatingHistorySection playerId={p.id} />
      <GameRatingsSection playerId={p.id} />
      <PartnersSection playerId={p.id} />
      {!isGuest && <Highlights playerId={p.id} name={p.name} />}


      {CATEGORIES.filter(c => c.attrs.length > 1).map(c => {
        const s = categoryScore(p.ratings, c.key, pos);
        const cw = categoryWeights(c.key, pos);
        return (
          <section key={c.key} className="rounded-xl border border-line bg-surface p-4">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-lg font-semibold">{c.label}</h2>
              <span className="font-display text-2xl font-bold">{s === null ? '–' : Math.round(s)}</span>
            </div>
            {cw && (
              <p className="mb-1 text-[11px] text-muted">
                As a {POSITIONS[pos].toLowerCase()}: {c.attrs.map(([k, label]) => `${cw[k] ?? 0}% ${label.toLowerCase()}`).join(', ')}
              </p>
            )}
            {c.attrs.map(([k, label]) => <Attr key={k} k={k} label={label} p={p} model={model} />)}
          </section>
        );
      })}
      <section className="rounded-xl border border-line bg-surface p-4">
        {CATEGORIES.filter(c => c.attrs.length === 1).map(c =>
          <Attr key={c.key} k={c.attrs[0][0]} label={c.label} p={p} model={model} />)}
      </section>

      <PlayerStatsSection playerId={p.id} />
    </div>
  );
}

/** The player (or an admin) sets the positions saved on the profile, primary first. */
function PositionsEditor({ player }: { player: { id: string; name: string; positions: Position[] } }) {
  const auth = useAuth();
  const [draft, setDraft] = useState<Position[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = auth?.member?.playerId === player.id;
  if (!mine && !auth?.isAdmin) return null;
  if (!draft) return (
    <p className="mt-2 flex items-center gap-2 text-xs text-muted">
      {mine ? 'Your' : 'Saved'} positions: <b className="text-ink">{player.positions.join(' / ') || 'none'}</b>
      <button className="rounded-md border border-line px-2 py-0.5 text-ink" onClick={() => { setDraft([...player.positions]); setError(''); }}>Edit</button>
    </p>
  );
  const save = async () => {
    setBusy(true); setError('');
    try { await savePositions(player.id, draft); setDraft(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-raised/50 p-2 text-xs">
      <p className="text-muted">Tap positions in order, main position first. This changes {mine ? 'your' : `${player.name.split(' ')[0]}'s`} profile: the overall on the card and in the Players list uses the main one.</p>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(POSITIONS) as Position[]).map(k => {
          const i = draft.indexOf(k);
          return (
            <button key={k} onClick={() => setDraft(i >= 0 ? draft.filter(x => x !== k) : [...draft, k])}
              className={`rounded-md border px-2.5 py-1 ${i >= 0 ? 'border-ball bg-ball/20 text-ball' : 'border-line text-muted'}`}>
              {i >= 0 && <span className="mr-1 font-bold">{i + 1}</span>}{POSITIONS[k]}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button disabled={busy || !draft.length} onClick={save} className="rounded-md bg-ball px-3 py-1.5 font-semibold text-bg disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        <button disabled={busy} onClick={() => setDraft(null)} className="rounded-md border border-line px-3 py-1.5">Cancel</button>
      </div>
      {error && <p className="text-bad">{error}</p>}
    </div>
  );
}

/** Who this player connects with: kills they set up and were set up for, and their best teammates. */
function PartnersSection({ playerId }: { playerId: string }) {
  const games = useGames();
  const { players } = usePlayers();
  const book = useMemo(() => (games ? partners(games) : null), [games]);
  if (!book || !players) return null;
  const name = (id: string) => players.find(p => p.id === id)?.name ?? id;
  const top = (m: Record<string, number> | undefined) => Object.entries(m ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const setFor = top(book.assists[playerId]);
  const setBy = top(Object.fromEntries(Object.entries(book.assists).map(([s, m]) => [s, m[playerId] ?? 0]).filter(([, n]) => (n as number) > 0)));
  const mates = Object.entries(book.together[playerId] ?? {}).filter(([, r]) => r.games >= 2)
    .sort((a, b) => b[1].won / b[1].games - a[1].won / a[1].games || b[1].games - a[1].games).slice(0, 3);
  if (!setFor.length && !setBy.length && !mates.length) return null;
  const list = (xs: [string, number][]) => xs.map(([id, n]) => <Link key={id} to={`/players/${id}`} className="mr-2 inline-block">{name(id)} <b className="text-ball">{n}</b></Link>);
  return (
    <section className="rounded-xl border border-line bg-surface p-4 text-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Partnerships</h2>
        <Link to={`/compare?a=${playerId}`} className="text-xs text-ball">Compare with… →</Link>
      </div>
      {setFor.length > 0 && <p><span className="text-muted">Sets up kills for:</span> {list(setFor)}</p>}
      {setBy.length > 0 && <p className="mt-1"><span className="text-muted">Kills set up by:</span> {list(setBy as [string, number][])}</p>}
      {mates.length > 0 && (
        <p className="mt-1"><span className="text-muted">Best record with:</span> {mates.map(([id, r]) => (
          <Link key={id} to={`/compare?a=${playerId}&b=${id}`} className="mr-2 inline-block">{name(id)} <b className="text-good">{r.won}–{r.games - r.won}</b></Link>
        ))}</p>
      )}
    </section>
  );
}

function GameRatingsSection({ playerId }: { playerId: string }) {
  const all = useMatchRatings();
  if (!all) return null;
  const mine = all.flatMap(({ game, result }) => { const r = result.rows.find(x => x.id === playerId); return r ? [{ game, r }] : []; });
  if (!mine.length) return null;
  const avg = mine.reduce((t, x) => t + x.r.score, 0) / mine.length;
  const mvps = mine.filter(x => x.r.medal === 'mvp').length, lose = mine.filter(x => x.r.medal === 'mvp-lose').length;
  const best = [...mine].sort((a, b) => b.r.score - a.r.score)[0];
  const tile = (v: string, l: string) => <div className="rounded-lg bg-raised/50 py-2 text-center"><div className="font-display text-lg font-bold">{v}</div><div className="text-[10px] text-muted">{l}</div></div>;
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Game ratings</h2>
        <span className="text-xs text-muted">{mine.length} game{mine.length === 1 ? '' : 's'} · 0–10 per game</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {tile(avg.toFixed(1), 'Average')}{tile(String(mvps), '👑 MVP')}{tile(String(lose), 'MVP (lose)')}{tile(best.r.score.toFixed(1), 'Best')}
      </div>
      <ul className="mt-2 divide-y divide-line text-sm">
        {mine.slice(0, 6).map(({ game, r }) => (
          <li key={game.id}>
            <Link to={`/games/${game.id}?box=1`} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate">{game.title} <span className="text-xs text-muted">{r.titles.join(' · ')}</span></span>
              <MedalBadge m={r.medal} score={r.score} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RatingHistorySection({ playerId }: { playerId: string }) {
  const h = useRatingHistory();
  const pts = h?.byPlayer[playerId];
  if (!h || !pts || h.sessions.length < 1) return null;
  const played = h.sessions.filter((_, i) => pts[i + 1]?.played);
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Overall by session</h2>
        <span className="text-xs text-muted">{played.length} of {h.sessions.length} sessions played</span>
      </div>
      <RatingChart points={pts} />
      {played.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {played.slice(-4).reverse().map(d => <Link key={d} to={`/sessions/${d}`} className="rounded-md border border-line px-2 py-0.5 text-muted">{fmtDay(d)} recap →</Link>)}
        </div>
      )}
    </section>
  );
}

function PlayerStatsSection({ playerId }: { playerId: string }) {
  const canStar = !!useAuth()?.isPlayer;
  const games = useGames();
  const { players } = usePlayers();
  const [open, setOpen] = useState<StatKey | null>(null);
  const [star, setStar] = useState<{ gameId: string; s: number; e: number } | null>(null);  // saving a highlight
  const allHighlights = useHighlights({ all: true });
  // who a rally is already a highlight for (same game, same rally start), to mark it ★
  const starredFor = (gameId: string, s: number) => [...new Set((allHighlights ?? [])
    .filter(h => h.gameId === gameId && Math.abs(h.s - s) < 1)
    .map(h => players?.find(p => p.id === h.playerId)?.name ?? h.playerId))].join(', ');
  if (!games) return null;
  const n = taggedGames(games);
  const st = computeStats(games)[playerId];
  if (!n || !st) return (
    <section className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
      Game stats appear here once games are tagged (Games → a game → Tag).
    </section>
  );
  const c = (k: StatKey) => st[k].length;
  const rates: [string, string][] = [
    ['Kill %', ratio(c('kill'), c('attack'))],
    ['Hitting eff.', c('attack') ? `${Math.round((100 * (c('kill') - c('aerr') - c('blocked'))) / c('attack'))}%` : '–'],
    ['Ace %', ratio(c('ace'), c('serve'))],
    ['Serve in %', c('serve') ? `${Math.round((100 * (c('serve') - c('serr'))) / c('serve'))}%` : '–'],
    ['Pass error %', ratio(c('rerr'), c('receive'))],
    ['Pass rating', avgGrade(c('pass3'), c('pass2'), c('pass1'))],
    ['Set rating', avgGrade(c('set3'), c('set2'), c('set1'))],
  ];
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Game stats</h2>
        <span className="text-xs text-muted">from {n} tagged game{n === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5 text-center sm:grid-cols-7">
        {rates.map(([label, v]) => (
          <div key={label} className="rounded-lg bg-raised/50 py-2">
            <div className="font-display text-lg font-bold">{v}</div>
            <div className="text-[10px] leading-tight text-muted">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {STAT_GROUPS.map(g => (
          <div key={g.label} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted">{g.label}</span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {g.stats.map(({ k, good }) => (
                <button key={k} onClick={() => setOpen(open === k ? null : k)}
                  className={`rounded-lg px-2 py-1 text-xs ${open === k ? 'bg-raised ring-1 ring-ball' : 'bg-raised/50'}`}>
                  <b className={`font-display text-base ${!c(k) ? 'text-muted' : good === true ? 'text-good' : good === false ? 'text-bad' : 'text-ink'}`}>{c(k)}</b>
                  {' '}<span className="text-muted">{STAT_LABELS[k]}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {open && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold">{STAT_GROUPS.find(g => g.stats.some(x => x.k === open))?.label} · {STAT_LABELS[open]} · watch one, or play them all</h3>
          {st[open].length ? (
            <div className="mt-2">
              <ClipReel key={open} nowPlaying={c => {
                const [gameId, s] = [c.key.split('|')[0], c.s];
                const g = games.find(x => x.id === gameId);
                return g && <>
                  <span className="text-xs text-muted">{c.label}</span>
                  {c.star && <span className="rounded-md bg-ball/20 px-2 py-0.5 text-xs font-semibold text-ball">★ Highlight for {c.star}</span>}
                  {canStar && <button onClick={() => setStar({ gameId, s, e: c.e })} className="rounded-md border border-ball/50 px-2 py-0.5 text-xs font-semibold text-ball">{c.star ? '★ Add for someone else' : '★ Highlight'}</button>}
                  <ShareRally gameId={gameId} rally={{ s }} title={`${g.title} · rally at ${fmtTime(s)}`} />
                </>;
              }} clips={[...st[open]]
                .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title) || a.t - b.t)  // newest session first; each game in order
                .flatMap((cl, i) => {
                  const g = games.find(x => x.id === cl.gameId);
                  if (!g) return [];
                  // the whole rally, stretched to include the touch if it was tagged after the clip ends
                  return [{
                    key: `${cl.gameId}|${cl.t}|${i}`, youtubeId: g.youtubeId, s: cl.s, e: Math.max(cl.e, cl.t + 2),
                    label: `${STAT_LABELS[open]} ${i + 1} · ${cl.title}`, sub: cl.date, star: starredFor(cl.gameId, cl.s) || undefined,
                    extra: <Link to={`/games/${cl.gameId}?t=${cl.t}&r=${cl.s}`} className="shrink-0 text-xs text-muted underline">in game</Link>,
                  }];
                })} />
            </div>
          ) : <p className="mt-1 text-sm text-muted">None yet.</p>}
        </div>
      )}
      {star && games && (() => {
        const g = games.find(x => x.id === star.gameId);
        return g && <HighlightDialog game={g} rally={star} players={players ?? []} forPlayer={playerId} onClose={() => setStar(null)} />;
      })()}
    </section>
  );
}

/** Attribute bar; for attributes stats can measure, a line explaining starting rating + stats. */
function Attr({ k, label, p, model }: { k: string; label: string; p: { id: string; ratings: Record<string, number | undefined>; base: Record<string, number | undefined> }; model: RatingModel }) {
  const ms = metricsFor(k);
  const exp = experience(p.id, model), games = model.gamesPlayed[p.id] ?? 0;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const num = (x: number) => (Math.round(x * 10) / 10).toString();
  return (
    <div>
      <AttrBar label={label} value={p.ratings[k]} />
      {typeof p.base[k] === 'number' && (
        <p className="-mt-0.5 mb-1 pl-0.5 text-[11px] leading-snug text-muted">
          Start {p.base[k]}
          {exp > 0 && <> + {num(exp)} experience ({games} game{games === 1 ? '' : 's'})</>}
          {ms.map(mk => {
            const a = model.adj[p.id]?.[mk], m = METRICS[mk];
            if (!a) return m.graded ? null : <span key={mk}> · no tagged {m.label.toLowerCase()} data yet</span>;
            if (a.block) return (
              <span key={mk}> + {num(a.delta)} block credit ({a.block.points} block point{a.block.points === 1 ? '' : 's'}, {a.block.touches - a.block.points - a.block.errors} other
                block touch{a.block.touches - a.block.points - a.block.errors === 1 ? '' : 'es'}{a.delta >= BLOCK_CREDIT.cap - 0.01 ? ', at the +15 max' : ''})</span>
            );
            return (
              <span key={mk}> {a.delta >= 0 ? '+' : '−'} {num(Math.abs(a.delta))} {m.label.toLowerCase()} {pct(a.rawValue)}
                {pct(a.value) !== pct(a.rawValue) && <span title="Counted after weighting recent sessions more and applying each game's strength"> ({pct(a.value)} weighted)</span>}
                {' '}vs team {pct(a.bench)} ({Math.round(a.rawAttempts)} {Math.round(a.rawAttempts) === 1 ? 'try' : 'tries'})</span>
            );
          })}
        </p>
      )}
    </div>
  );
}

/** A player's bookmarked rallies, playable one by one or as a reel (whole rallies). */
export function Highlights({ playerId, name, sample }: { playerId: string; name: string; sample?: Highlight[] }) {
  const saved = useHighlights({ playerId });
  const list = sample ?? saved;  // sample: dev preview only
  const auth = useAuth();
  const me = auth?.user?.email?.toLowerCase();
  const canRemove = (h: Highlight) => auth?.isAdmin || h.by === me || auth?.member?.playerId === playerId;
  if (!list) return null;
  if (!list.length) return (
    <section className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
      <b className="text-ink">★ Highlights</b>: none yet. On any game, select a rally and tap ★ Highlight to save it here.
    </section>
  );
  const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-2 font-display text-lg font-semibold">★ Highlights <span className="text-sm font-normal text-muted">({list.length})</span></h2>
      <ClipReel nowPlaying={c => {
        const h = list.find(x => x.id === c.key);
        return h && <ShareRally gameId={h.gameId} rally={h} title={`${h.title} · ${h.note || `rally at ${fmtTime(h.s)}`}`} />;
      }} clips={list.map(h => ({
        key: h.id, youtubeId: h.youtubeId, s: h.s, e: h.e,
        label: h.note || `Rally at ${fmtTime(h.s)}`,
        sub: `${h.title} · ${fmtDate(h.date)}${h.by !== me && h.byName ? ` · added by ${h.byName.split(' ')[0]}` : ''}`,
        extra: <>
          <Link to={`/games/${h.gameId}?t=${h.s}&r=${h.s}`} className="shrink-0 text-xs text-muted underline">in game</Link>
          {canRemove(h) && (
            <button className="shrink-0 text-xs text-muted" title="Remove highlight"
              onClick={() => { if (confirm(`Remove this highlight from ${name}'s profile?`)) removeHighlight(h.id); }}>✕</button>
          )}
        </>,
      }))} />
    </section>
  );
}
