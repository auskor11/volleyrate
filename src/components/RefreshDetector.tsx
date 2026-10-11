// Re-run a camera's rally detector on a game that's already been reviewed: refreshes that camera's training
// examples (after its detector settings changed) and shows how it would have done against the review.
// The game's rallies and tags are never touched.
import { useEffect, useRef, useState } from 'react';
import { CAMERA_KINDS, packServes, type Angle } from '../lib/cameras';
import { detectorSupported, runDetector, type DetectorProgress } from '../lib/detector';
import { fmtTime, logHistory, updateGame, type Game } from '../lib/games';
import { useAuth } from '../lib/auth';
import { NetLine, lastNetLine, netParams } from './NetLine';

/** Reviewed rallies found by the detector's clips (each clip counts for one rally) and clips matching none. */
function score(clips: [number, number][], truth: { s: number; e: number }[]) {
  const ov = (a: number, b: number, s: number, e: number) => Math.min(b, e) - Math.max(a, s);
  const found = new Set<number>();
  let falses = 0;
  for (const [a, b] of clips) {
    let best = -1, bo = 0;
    truth.forEach((r, k) => { const o = ov(a, b, r.s, r.e); if (o > bo) { bo = o; best = k; } });
    if (best < 0) falses++; else found.add(best);
  }
  return { found: found.size, total: truth.length, falses, clips: clips.length };
}

export function RefreshDetector({ game, cam, onClose }: { game: Game; cam: Angle; onClose: () => void }) {
  const user = useAuth()?.user ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [p, setP] = useState<DetectorProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReturnType<typeof score> & { examples: number } | null>(null);
  const [error, setError] = useState('');
  const [net, setNet] = useState(cam.net ?? lastNetLine());  // back camera: the top of the net in the picture
  const [waitingNet, setWaitingNet] = useState(false);
  const cancel = useRef<() => void>(undefined);
  useEffect(() => () => cancel.current?.(), []);

  async function run(f: File, confirmed = false) {
    setFile(f); setError(''); setDone(null);
    if (cam.kind === 'back' && !confirmed) { setWaitingNet(true); return; }
    setWaitingNet(false); setBusy(true);
    let lock: WakeLockSentinel | null = null;
    try { lock = await navigator.wakeLock.request('screen'); } catch { /* not supported */ }
    try {
      // measure serves in the reviewed rallies themselves (incl. ones added by hand), in this camera's time
      const live = game.rallies.filter(x => x.st !== 'bad').sort((a, b) => a.s - b.s);
      const job = runDetector(f, setP, undefined, false, cam.kind, cam.kind === 'back' ? netParams(net) : {},
        live.map(x => [x.s + cam.offset, x.e + cam.offset] as [number, number]));
      const netField = cam.kind === 'back' ? { net: Math.round(net * 1000) / 1000 } : {};
      cancel.current = job.cancel;
      const r = await job.result;
      const serveField = cam.kind === 'back' && r.serves?.length ? { serves: packServes(live.map(x => x.s), r.serves) } : {};
      // this camera's clips on the game's timeline, scored against the reviewed rallies
      const clips = r.rallies.map(([a, b]) => [a - cam.offset, b - cam.offset] as [number, number]);
      const sc = score(clips, game.rallies.filter(x => x.st !== 'bad'));
      if (cam.id === 'main') await updateGame(game.id, { segments: r.segments, peaks: r.peaks, ...netField, ...serveField });
      else await updateGame(game.id, { angles: (game.angles ?? []).map(a => a.id === cam.id ? { ...a, segments: r.segments, peaks: r.peaks, ...netField, ...serveField } : a) });
      logHistory(game.id, user, [`Refreshed the "${cam.name}" camera's detector data: it finds ${sc.found} of ${sc.total} reviewed rallies, ${sc.falses} false clips`]).catch(() => {});
      setDone({ ...sc, examples: r.segments.length });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock?.release().catch(() => {});
    }
  }

  const frac = p ? Math.min(1, p.videoTime / Math.max(1, p.duration)) : 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl border border-line bg-surface p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="font-semibold">Refresh detector data · {cam.name}</h2>
          <p className="mt-0.5 text-sm text-muted">
            Runs the {CAMERA_KINDS[cam.kind].label.toLowerCase()} camera's current rally detector on this video again. Your
            rallies and tags stay exactly as they are; this camera's training examples are replaced (for Admin → Detector →
            Train){cam.kind === 'back' ? ', and each rally\'s serve is checked so Review can pre-pick the server' : ''}.
          </p>
        </div>
        {!game.reviewed && <p className="text-sm text-muted">This game isn't reviewed yet: its training examples only count once it is.{cam.kind === 'back' ? " The serve check (which end served) works straight away." : ''}</p>}
        {!detectorSupported() ? <p className="text-sm text-bad">This browser can't read video files. Use Safari or Chrome on a Mac or iPhone.</p> : (
          <label className={`block rounded-lg border-2 border-dashed border-line p-3 text-center text-sm ${busy ? 'opacity-50' : 'cursor-pointer hover:border-muted'}`}>
            {file ? file.name : `Choose the ${cam.name} camera's original video file`}
            <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden" disabled={busy}
              onChange={e => e.target.files?.[0] && run(e.target.files[0])} />
          </label>
        )}
        {file && waitingNet && (
          <div className="space-y-2">
            <NetLine file={file} value={net} onChange={setNet} />
            <button className="w-full rounded-lg bg-ball py-2.5 font-semibold text-bg" onClick={() => run(file, true)}>Find the rallies</button>
          </div>
        )}
        {busy && (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-raised"><div className="h-full bg-ball transition-all" style={{ width: `${frac * 100}%` }} /></div>
            <p className="mt-1 text-xs text-muted">Finding rallies… {p ? `${fmtTime(p.videoTime)} / ${fmtTime(p.duration)}` : ''} Keep this screen open.</p>
          </div>
        )}
        {done && (
          <div className="rounded-lg bg-raised p-3 text-sm">
            <p><span className="text-good">✓</span> Updated: <b>{done.examples}</b> training examples.</p>
            <p className="mt-1 text-muted">
              Against your review, this detector finds <b className="text-ink">{done.found} of {done.total}</b> rallies
              ({Math.round((100 * done.found) / Math.max(1, done.total))}%) with <b className="text-ink">{done.falses}</b> false clips
              out of {done.clips}.
            </p>
          </div>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        <button onClick={() => { cancel.current?.(); onClose(); }} className="w-full rounded-lg border border-line py-2.5">{done ? 'Done' : 'Cancel'}</button>
      </div>
    </div>
  );
}
