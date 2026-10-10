// Add another camera's video to a game: its YouTube link, which camera it is, and (optionally) the original
// file, which this device reads to line the video up with the game by sound and to run that camera's
// rally detector (its clips become training data once the game is reviewed).
import { useEffect, useRef, useState } from 'react';
import { CameraFields, defaultCamera, type CameraChoice } from './CameraFields';
import { autoSync, type Angle } from '../lib/cameras';
import { detectorSupported, runDetector, type DetectorProgress } from '../lib/detector';
import { fmtTime, logHistory, updateGame, type Game } from '../lib/games';
import { parseYouTubeId } from '../lib/youtube';
import { useAuth } from '../lib/auth';

type Step = { what: string; p: DetectorProgress | null };

export function AddCamera({ game, onClose }: { game: Game; onClose: () => void }) {
  const user = useAuth()?.user ?? null;
  const [camera, setCamera] = useState<CameraChoice>(defaultCamera('back'));
  const [link, setLink] = useState('');
  const ytId = parseYouTubeId(link);
  const [file, setFile] = useState<File | null>(null);
  const [mainFile, setMainFile] = useState<File | null>(null);   // only if the game has no contact sounds saved
  const [detect, setDetect] = useState(true);                      // run this camera's rally detector too
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState('');
  const cancel = useRef<() => void>(undefined);
  useEffect(() => () => cancel.current?.(), []);
  const needMain = !game.peaks?.length;

  async function read(f: File, what: string, audioOnly: boolean) {
    setStep({ what, p: null });
    const run = runDetector(f, p => setStep({ what, p }), undefined, audioOnly, camera.kind);
    cancel.current = run.cancel;
    return run.result;
  }

  async function save() {
    if (!ytId) return;
    setError('');
    let lock: WakeLockSentinel | null = null;
    try { lock = await navigator.wakeLock.request('screen'); } catch { /* not supported */ }
    try {
      const angle: Angle = {
        id: Math.random().toString(36).slice(2, 8), name: camera.name.trim() || 'Camera', kind: camera.kind,
        ...(camera.kind === 'back' && camera.behind ? { behind: camera.behind } : {}),
        youtubeId: ytId, offset: 0,
      };
      let note = '';
      let mainPeaks: number[] = [];
      if (file) {
        mainPeaks = needMain && mainFile ? (await read(mainFile, "Reading the main video's sound", true)).peaks : game.peaks ?? [];
        const r = await read(file, detect ? "Finding rallies in this camera's video" : "Reading this camera's sound", !detect);
        angle.peaks = r.peaks;
        if (detect) angle.segments = r.segments;
        const s = mainPeaks.length ? autoSync(mainPeaks, r.peaks) : null;
        if (s) { angle.offset = s.offset; angle.sync = { matched: s.matched, total: s.total }; note = ` · lined up by sound (${s.offset >= 0 ? '+' : ''}${s.offset.toFixed(2)} s)`; }
        else note = ' · couldn\'t line it up by sound: adjust it by eye';
      }
      setStep({ what: 'Saving', p: null });
      // a main-video sound read for lining up is kept too (it also powers touch suggestions)
      await updateGame(game.id, { angles: [...(game.angles ?? []), angle], ...(needMain && mainPeaks.length ? { peaks: mainPeaks } : {}) });
      logHistory(game.id, user, [`Added camera "${angle.name}"${note}`]).catch(() => {});
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setStep(null);
    } finally {
      lock?.release().catch(() => {});
    }
  }

  const input = 'w-full rounded-lg border border-line bg-raised px-3 py-2 text-ink outline-none focus:border-ball';
  const pick = (label: string, f: File | null, set: (f: File) => void) => (
    <label className="block cursor-pointer rounded-lg border-2 border-dashed border-line p-3 text-center text-sm hover:border-muted">
      {f ? f.name : label}
      <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden" onChange={e => e.target.files?.[0] && set(e.target.files[0])} />
    </label>
  );
  const frac = step?.p ? Math.min(1, step.p.videoTime / Math.max(1, step.p.duration)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={step ? undefined : onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="font-semibold">Add a camera</h2>
          <p className="mt-0.5 text-sm text-muted">Another video of this same game. Rallies and tags are shared; you can switch cameras while watching or tagging.</p>
        </div>
        <CameraFields value={camera} onChange={setCamera} disabled={!!step} />
        <input className={input} placeholder="YouTube link (unlisted)" value={link} onChange={e => setLink(e.target.value)} disabled={!!step} />
        {link && !ytId && <p className="text-sm text-bad">That doesn't look like a YouTube link.</p>}

        <div className="space-y-2 rounded-lg border border-line p-3">
          <p className="text-sm">Original video file <span className="text-muted">(recommended)</span></p>
          <p className="text-xs text-muted">
            Read on this device, never uploaded. Used to line the two videos up by their ball-contact sounds
            {camera.kind !== 'side' ? ' and to run this camera\'s own rally detector' : ''}.
          </p>
          {!detectorSupported() ? <p className="text-sm text-bad">This browser can't read video files. Use Safari or Chrome on a Mac or iPhone.</p> : <>
            {pick("Choose this camera's file", file, setFile)}
            {file && needMain && (
              <>
                <p className="text-xs text-ball">This game's main video has no sound data saved yet. Pick its original file too (only its sound is read):</p>
                {pick('Choose the main video file', mainFile, setMainFile)}
              </>
            )}
            {file && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={detect} onChange={e => setDetect(e.target.checked)} className="accent-[#f5c518]" />
                Also run this camera's rally detector (slower; builds its training data)
              </label>
            )}
          </>}
        </div>

        {step && (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-raised"><div className="h-full bg-ball transition-all" style={{ width: `${frac * 100}%` }} /></div>
            <p className="mt-1 text-xs text-muted">{step.what}…{step.p ? ` ${fmtTime(step.p.videoTime)} / ${fmtTime(step.p.duration)}` : ''} Keep this screen open.</p>
          </div>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={!ytId || !!step || (!!file && needMain && !mainFile)}
            className="flex-1 rounded-lg bg-ball py-2.5 font-semibold text-bg disabled:opacity-40">
            {step ? 'Working…' : file ? 'Add camera' : 'Add without lining up'}
          </button>
          <button onClick={() => { cancel.current?.(); onClose(); }} className="rounded-lg border border-line px-4 py-2.5">Cancel</button>
        </div>
      </div>
    </div>
  );
}
