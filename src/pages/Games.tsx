import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { DETECTOR_VERSION, detectorSupported, runDetector, type DetectorProgress, type DetectorResult } from '../lib/detector';
import { createGame, fmtTime, liveRallies, logHistory, useGames, type Game } from '../lib/games';
import { createPlayer, parseYouTubeId, thumbnail, type YTPlayer } from '../lib/youtube';

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = (d: string) => new Date(`${d.slice(0, 7)}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const OPEN_KEY = 'vr-games-open';

export function Games() {
  return <GamesList games={useGames()} />;
}

export function GamesList({ games }: { games: Game[] | null }) {
  const [q, setQ] = useState('');
  // which date groups are expanded (remembered on this device); default = the most recent date
  const [open, setOpen] = useState<Set<string> | null>(() => {
    try { const v = localStorage.getItem(OPEN_KEY); return v ? new Set(JSON.parse(v)) : null; } catch { return null; }
  });
  const toggle = (d: string, now: Set<string>) => {
    const next = new Set(now);
    if (next.has(d)) next.delete(d); else next.add(d);
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
  };

  const term = q.trim().toLowerCase();
  const shown = (games ?? []).filter(g => !term || g.title.toLowerCase().includes(term) || g.date.includes(term)
    || fmtDay(g.date).toLowerCase().includes(term));
  const dates = [...new Set(shown.map(g => g.date))].sort().reverse();
  const isOpen = open ?? new Set(dates.slice(0, 1));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Games</h1>
        <Link to="/games/new" className="rounded-lg bg-ball px-4 py-2 font-semibold text-bg">+ Add game</Link>
      </div>
      {games && !games.length && (
        <div className="mt-4 rounded-xl border border-dashed border-line p-6 text-center text-muted">
          <p className="font-medium text-ink">No games yet</p>
          <p className="mt-1 text-sm">Upload a recording to YouTube (unlisted), then add it here.</p>
        </div>
      )}
      {!!games?.length && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by title or date (e.g. Game 2, Sep, 2026-09-26)"
          className="mt-4 w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-ink outline-none focus:border-ball" />
      )}
      {term && !shown.length && <p className="mt-4 text-sm text-muted">No games match "{q}".</p>}

      <div className="mt-4 space-y-2">
        {dates.map((d, i) => {
          const day = shown.filter(g => g.date === d);
          const expanded = !!term || isOpen.has(d);
          const rallies = day.reduce((n, g) => n + liveRallies(g).length, 0);
          const toReview = day.filter(g => !g.reviewed).length;
          const newMonth = i === 0 || dates[i - 1].slice(0, 7) !== d.slice(0, 7);
          return (
            <div key={d}>
              {newMonth && <h2 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-muted first:mt-0">{fmtMonth(d)}</h2>}
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                <button onClick={() => toggle(d, isOpen)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className={`text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="flex-1">
                    <span className="font-semibold">{fmtDay(d)}</span>
                    <span className="block text-xs text-muted">
                      {day.length} video{day.length === 1 ? '' : 's'} · {rallies} rallies
                      {toReview ? <span className="text-ball"> · {toReview} need{toReview === 1 ? 's' : ''} review</span> : null}
                    </span>
                  </span>
                </button>
                {expanded && (
                  <div className="space-y-2 border-t border-line p-2">
                    {day.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })).map(g => (
                      <Link key={g.id} to={`/games/${g.id}`} className="flex gap-3 overflow-hidden rounded-lg bg-raised/50 hover:bg-raised">
                        <img src={thumbnail(g.youtubeId)} alt="" className="aspect-video w-32 shrink-0 object-cover" />
                        <div className="min-w-0 py-2 pr-3">
                          <div className="truncate font-semibold">{g.title}</div>
                          <div className="text-sm text-muted">{liveRallies(g).length} rallies</div>
                          {!g.reviewed && <span className="mt-1 inline-block rounded bg-ball/20 px-1.5 text-xs text-ball">needs review</span>}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const input = 'w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-ink outline-none focus:border-ball';
const step = 'rounded-xl border border-line bg-surface p-4';

export function AddGame() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [link, setLink] = useState('');
  const ytId = parseYouTubeId(link);
  const [ytDuration, setYtDuration] = useState<number | null>(null);
  const playerEl = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [progress, setProgress] = useState<DetectorProgress | null>(null);
  const [result, setResult] = useState<DetectorResult | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const cancelRef = useRef<() => void>(undefined);

  // YouTube preview + duration
  useEffect(() => {
    setYtDuration(null);
    if (!ytId || !playerEl.current) return;
    let p: YTPlayer | null = null, dead = false;
    const host = document.createElement('div');
    playerEl.current.replaceChildren(host);
    createPlayer(host, ytId).then(pl => {
      p = pl;
      if (dead) return pl.destroy();
      // duration can be 0 until metadata loads
      const poll = setInterval(() => { const d = pl.getDuration(); if (d > 0) { setYtDuration(d); clearInterval(poll); } }, 300);
      setTimeout(() => clearInterval(poll), 15000);
    });
    return () => { dead = true; p?.destroy(); };
  }, [ytId]);

  useEffect(() => () => cancelRef.current?.(), []);

  async function onFile(f: File) {
    cancelRef.current?.();
    setFile(f); setResult(null); setError(''); setProgress(null); setFileDuration(null);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    setDate(new Date(f.lastModified).toISOString().slice(0, 10));
    let lock: WakeLockSentinel | null = null;
    try { lock = await navigator.wakeLock.request('screen'); } catch { /* not supported */ }
    const run = runDetector(f, setProgress, i => { if (i.duration) setFileDuration(i.duration); });
    cancelRef.current = run.cancel;
    try {
      setResult(await run.result);
    } catch (e) {
      const msg = (e as Error).message;
      setError(/moov|MP4/.test(msg) ? "This doesn't look like an MP4/MOV video. Pick the original recording."
        : /decode/i.test(msg) ? `This device couldn't decode the video (${msg}). Try Safari or Chrome on an iPhone or Mac.`
        : msg);
    } finally {
      lock?.release().catch(() => {});
    }
  }

  const mismatch = ytDuration && fileDuration && Math.abs(ytDuration - fileDuration) > 3;
  const canSave = ytId && result && title.trim() && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const id = await createGame({
        title: title.trim(), date, youtubeId: ytId!, duration: ytDuration ?? result!.duration,
        rallies: result!.rallies.map(([s, e]) => ({ s, e, st: 'auto', as: s, ae: e })),
        segments: result!.segments ?? [],
        peaks: result!.peaks ?? [],
        rating: { applied: false },  // stats count toward ratings once an admin applies this game
        reviewed: false, createdBy: user?.email ?? '',
        detector: { version: DETECTOR_VERSION, elapsed: Math.round(result!.elapsed), device: result!.userAgent },
      });
      logHistory(id, user, [`Added the game · ${result!.rallies.length} rallies detected`]).catch(() => {});
      nav(`/games/${id}?review=1`);
    } catch (e) {
      setError((e as Error).message); setSaving(false);
    }
  }

  const frac = progress ? Math.min(1, progress.videoTime / progress.duration) : 0;
  const speed = progress && progress.elapsed > 0 ? progress.videoTime / progress.elapsed : 0;

  return (
    <div className="space-y-4">
      <Link to="/games" className="text-sm text-muted">← Games</Link>
      <h1 className="font-display text-3xl font-bold">Add game</h1>

      <section className={step}>
        <h2 className="font-semibold">1 · YouTube link</h2>
        <p className="mt-1 text-sm text-muted">Upload the recording to YouTube as <b>Unlisted</b>, then paste its link.</p>
        <input className={`${input} mt-3`} placeholder="https://youtu.be/…" value={link} onChange={e => setLink(e.target.value)} />
        {link && !ytId && <p className="mt-2 text-sm text-bad">That doesn't look like a YouTube link.</p>}
        <div className={`mt-3 aspect-video overflow-hidden rounded-lg bg-black ${ytId ? '' : 'hidden'}`} ref={playerEl} />
      </section>

      <section className={step}>
        <h2 className="font-semibold">2 · Find the rallies</h2>
        <p className="mt-1 text-sm text-muted">
          Pick the <b>original video file</b> (the one you uploaded). It's processed on this device and never uploaded.
          On iPhone, choose it from Files; picking from Photos may compress it.
        </p>
        {!detectorSupported() ? (
          <p className="mt-3 text-sm text-bad">This browser can't process video. Use Safari or Chrome on an iPhone or Mac.</p>
        ) : (
          <label className="mt-3 block cursor-pointer rounded-lg border-2 border-dashed border-line p-4 text-center hover:border-muted">
            {file ? file.name : 'Choose video file'}
            <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden"
              onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        )}
        {file && !result && !error && (
          <div className="mt-3">
            <div className="h-2.5 overflow-hidden rounded-full bg-raised">
              <div className="h-full bg-ball transition-all" style={{ width: `${frac * 100}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted">
              {progress
                ? `${fmtTime(progress.videoTime)} / ${fmtTime(progress.duration)} · ${speed.toFixed(0)}× · about ${fmtTime((progress.duration - progress.videoTime) / Math.max(speed, 0.1))} left`
                : 'Starting…'}
            </p>
            <p className="text-xs text-muted">Keep this screen open until it finishes.</p>
          </div>
        )}
        {result && (
          <p className="mt-3 text-sm">
            <span className="text-good">✓</span> Found <b>{result.rallies.length} rallies</b> in {fmtTime(result.elapsed)}.
          </p>
        )}
        {mismatch && (
          <p className="mt-2 rounded-lg bg-bad/15 p-2 text-sm text-bad">
            The file is {fmtTime(fileDuration!)} long but the YouTube video is {fmtTime(ytDuration!)}. Make sure they're
            the same recording, or the clips won't line up.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      </section>

      <section className={step}>
        <h2 className="font-semibold">3 · Details</h2>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <input className={input} placeholder="e.g. Scrimmage vs NUS" value={title} onChange={e => setTitle(e.target.value)} />
          <input className={input} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button className="mt-4 w-full rounded-lg bg-ball py-3 font-semibold text-bg disabled:opacity-40" disabled={!canSave} onClick={save}>
          {saving ? 'Saving…' : 'Save & review rallies'}
        </button>
        {!canSave && !saving && (
          <p className="mt-2 text-center text-xs text-muted">
            {!ytId ? 'Add the YouTube link' : !result ? 'Wait for rally detection to finish' : 'Add a title'}
          </p>
        )}
      </section>
    </div>
  );
}
