import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { removeHighlight, useHighlights, type Highlight } from '../lib/highlights';
import { createPlayer, type YTPlayer } from '../lib/youtube';
import { Link, useParams } from 'react-router-dom';
import { AttrBar, PlayerCard } from '../components/PlayerCard';
import { useRatedPlayers } from '../lib/rated';
import { BLOCK_CREDIT, METRICS, experience, metricsFor, type RatingModel } from '../lib/engine';
import { fmtTime, useGames } from '../lib/games';
import { STAT_GROUPS, STAT_LABELS, avgGrade, computeStats, ratio, taggedGames, type StatKey } from '../lib/stats';
import { CATEGORIES, POSITIONS, categoryScore, categoryWeights, overall, type Position } from '../lib/ratings';

export function Players() {
  const { players, error } = useRatedPlayers();
  const [pos, setPos] = useState<Position | 'ALL'>('ALL');
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
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {list.map(({ p }) => <PlayerCard key={p.id} player={p} />)}
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
  if (!players || !model) return null;
  const p = players.find(x => x.id === id);
  if (!p) return <p className="text-muted">Player not found. <Link to="/players" className="text-ball">Back</Link></p>;

  return (
    <div className="space-y-5">
      <Link to="/players" className="text-sm text-muted">← Players</Link>
      <PlayerCard player={p} size="lg" />
      <Highlights playerId={p.id} name={p.name} />


      {CATEGORIES.filter(c => c.attrs.length > 1).map(c => {
        const s = categoryScore(p.ratings, c.key, p.positions[0]);
        const cw = categoryWeights(c.key, p.positions[0]);
        return (
          <section key={c.key} className="rounded-xl border border-line bg-surface p-4">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-lg font-semibold">{c.label}</h2>
              <span className="font-display text-2xl font-bold">{s === null ? '–' : Math.round(s)}</span>
            </div>
            {cw && (
              <p className="mb-1 text-[11px] text-muted">
                As a {POSITIONS[p.positions[0]].toLowerCase()}: {c.attrs.map(([k, label]) => `${cw[k] ?? 0}% ${label.toLowerCase()}`).join(', ')}
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

function PlayerStatsSection({ playerId }: { playerId: string }) {
  const games = useGames();
  const [open, setOpen] = useState<StatKey | null>(null);
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
          <h3 className="text-sm font-semibold">{STAT_GROUPS.find(g => g.stats.some(x => x.k === open))?.label} · {STAT_LABELS[open]} · tap to watch</h3>
          {st[open].length ? (
            <ul className="mt-1 max-h-72 divide-y divide-line overflow-y-auto text-sm">
              {st[open].map((cl, i) => (
                <li key={`${cl.gameId}-${cl.t}-${i}`}>
                  <Link to={`/games/${cl.gameId}?t=${cl.t}`} className="flex justify-between py-2">
                    <span className="truncate">{cl.title} <span className="text-muted">· {cl.date}</span></span>
                    <span className="tabular-nums text-ball" title={`Touch at ${fmtTime(cl.t)}`}>▶ rally {fmtTime(cl.s)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-sm text-muted">None yet.</p>}
        </div>
      )}
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
  const [cur, setCur] = useState<number | null>(null);
  const [reel, setReel] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const yt = useRef<YTPlayer | null>(null);
  const loadedAt = useRef(0);   // when the current clip was loaded (ignore stale "ended" events just after)
  const state = useRef({ list, cur, reel });
  state.current = { list, cur, reel };

  function play(i: number) {
    const h = state.current.list?.[i];
    if (!h || !yt.current) return;
    setCur(i);
    state.current.cur = i;
    loadedAt.current = Date.now();
    yt.current.loadVideoById({ videoId: h.youtubeId, startSeconds: Math.max(0, h.s - 0.5), endSeconds: h.e + 0.5 });
  }
  // move to the next highlight in the reel (once per clip), or finish
  function next() {
    const { list, cur, reel } = state.current;
    if (!reel || !list || cur === null || Date.now() - loadedAt.current < 1500) return;
    if (cur < list.length - 1) play(cur + 1);
    else { setReel(false); state.current.reel = false; }
  }

  // Create the player as soon as there are highlights, so a tap can start playback directly
  // (browsers, especially iPhones, only allow video to start straight from a tap).
  const first = list?.[0];
  useEffect(() => {
    if (!first || !el.current || yt.current) return;
    let dead = false;
    const host = document.createElement('div');
    el.current.replaceChildren(host);
    createPlayer(host, first.youtubeId, st => { if (st === 0) next(); })  // 0 = ended at endSeconds
      .then(p => { if (dead) p.destroy(); else yt.current = p; });
    // backup: YouTube sometimes pauses at the end instead of reporting "ended"
    const watch = setInterval(() => {
      const { list, cur, reel } = state.current;
      const h = cur !== null ? list?.[cur] : undefined;
      if (reel && h && yt.current && yt.current.getCurrentTime() >= h.e + 0.4) next();
    }, 300);
    return () => { dead = true; clearInterval(watch); yt.current?.destroy(); yt.current = null; };
  }, [first?.youtubeId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // keep the playing highlight visible in the list
  const listEl = useRef<HTMLUListElement>(null);
  useEffect(() => { listEl.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [cur]);

  if (!list) return null;
  if (!list.length) return (
    <section className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
      <b className="text-ink">★ Highlights</b>: none yet. On any game, select a rally and tap ★ Highlight to save it here.
    </section>
  );
  const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">★ Highlights <span className="text-sm font-normal text-muted">({list.length})</span></h2>
        {reel
          ? <button onClick={() => { setReel(false); state.current.reel = false; yt.current?.pauseVideo(); }} className="rounded-lg border border-ball px-3 py-1.5 text-sm font-semibold text-ball">⏹ Stop</button>
          : <button onClick={() => { setReel(true); state.current.reel = true; play(0); }} className="rounded-lg bg-ball px-3 py-1.5 text-sm font-semibold text-bg">▶ Play all</button>}
      </div>
      <div ref={el} className="mt-3 aspect-video overflow-hidden rounded-lg bg-black" />
      {cur !== null && list[cur] && (
        <p className="mt-1 text-xs text-muted">
          {reel ? `Reel ${cur + 1}/${list.length} · ` : ''}{list[cur].title} · {fmtTime(list[cur].s)}{list[cur].note ? ` · ${list[cur].note}` : ''}
        </p>
      )}
      <ul ref={listEl} className="mt-2 max-h-80 divide-y divide-line overflow-y-auto text-sm">
        {list.map((h, i) => (
          <li key={h.id} data-i={i} className={`flex items-center gap-2 py-2 ${cur === i ? 'text-ball' : ''}`}>
            <button className="min-w-0 flex-1 text-left" onClick={() => { setReel(false); state.current.reel = false; play(i); }}>
              <span className="block truncate">▶ {h.note || `Rally at ${fmtTime(h.s)}`}</span>
              <span className="block truncate text-xs text-muted">
                {h.title} · {fmtDate(h.date)} · {fmtTime(h.s)}–{fmtTime(h.e)}{h.by !== me && h.byName ? ` · added by ${h.byName.split(' ')[0]}` : ''}
              </span>
            </button>
            <Link to={`/games/${h.gameId}?t=${h.s}`} className="shrink-0 text-xs text-muted underline">in game</Link>
            {canRemove(h) && (
              <button className="shrink-0 text-xs text-muted" title="Remove highlight"
                onClick={() => { if (confirm(`Remove this highlight from ${name}'s profile?`)) removeHighlight(h.id); }}>✕</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
