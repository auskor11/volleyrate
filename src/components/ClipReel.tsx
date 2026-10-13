// A video player with a list of clips (whole rallies): tap one to watch it, or play them all back to back.
// Used for a player's highlights and for a stat's clips (e.g. all of someone's assists).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPlayer, type YTPlayer } from '../lib/youtube';
import { fmtTime } from '../lib/games';

export interface ReelClip {
  key: string;
  youtubeId: string;
  s: number;            // clip start / end (video seconds)
  e: number;
  label: string;        // first line in the list
  sub: string;          // second line (game, date, …)
  star?: string;        // saved as a highlight (for whom), marked ★
  extra?: ReactNode;    // buttons at the end of the row
}

/** `nowPlaying`: buttons for the clip that's playing (highlight, share, …), shown under the video. */
export function ClipReel({ clips, autoStart = false, nowPlaying }: { clips: ReelClip[]; autoStart?: boolean; nowPlaying?: (c: ReelClip) => ReactNode }) {
  const [cur, setCur] = useState<number | null>(null);
  const [reel, setReel] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const yt = useRef<YTPlayer | null>(null);
  const loadedAt = useRef(0);   // when the current clip was loaded (ignore stale "ended" events just after)
  const video = useRef('');     // the YouTube video in the player now
  const state = useRef({ clips, cur, reel });
  state.current = { clips, cur, reel };

  function play(i: number) {
    const c = state.current.clips[i];
    if (!c || !yt.current) return;
    setCur(i);
    state.current.cur = i;
    loadedAt.current = Date.now();
    // Same video: jump within it. Loading a video again makes an iPhone leave fullscreen, so that only
    // happens when the next clip is from another game. (No endSeconds: the watcher below stops each clip.)
    if (video.current === c.youtubeId) {
      yt.current.seekTo(Math.max(0, c.s - 0.5), true);
      yt.current.playVideo();
    } else {
      video.current = c.youtubeId;
      yt.current.loadVideoById({ videoId: c.youtubeId, startSeconds: Math.max(0, c.s - 0.5) });
    }
  }
  const startReel = () => { setReel(true); state.current.reel = true; play(0); };
  const stopReel = () => { setReel(false); state.current.reel = false; };
  // move to the next clip in the reel (once per clip), or finish
  function next() {
    const { clips, cur, reel } = state.current;
    if (!reel || cur === null || Date.now() - loadedAt.current < 1500) return;
    if (cur < clips.length - 1) play(cur + 1);
    else stopReel();
  }

  // Create the player straight away, so a tap can start playback directly
  // (browsers, especially iPhones, only allow video to start straight from a tap).
  const first = clips[0];
  useEffect(() => {
    if (!first || !el.current || yt.current) return;
    let dead = false;
    const host = document.createElement('div');
    el.current.replaceChildren(host);
    createPlayer(host, first.youtubeId, st => { if (st === 0) next(); })  // 0 = the video ended
      .then(p => { if (dead) p.destroy(); else { yt.current = p; video.current = first.youtubeId; if (autoStart) startReel(); } });
    // each clip ends here: move on in a reel, otherwise pause (just after a jump, the old time can still show)
    const watch = setInterval(() => {
      const { clips, cur, reel } = state.current;
      const c = cur !== null ? clips[cur] : undefined;
      const p = yt.current;
      if (!c || !p || Date.now() - loadedAt.current < 1500 || p.getPlayerState() !== 1) return;
      if (p.getCurrentTime() >= c.e + 0.5) { if (reel) next(); else p.pauseVideo(); }
    }, 250);
    return () => { dead = true; clearInterval(watch); yt.current?.destroy(); yt.current = null; };
  }, [first?.youtubeId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // keep the playing clip visible in the list
  const listEl = useRef<HTMLUListElement>(null);
  useEffect(() => { listEl.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [cur]);

  const c = cur !== null ? clips[cur] : undefined;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{c ? `${reel ? `${cur! + 1} of ${clips.length} · ` : ''}${c.sub}` : `${clips.length} clip${clips.length === 1 ? '' : 's'}`}</span>
        {reel
          ? <button onClick={() => { stopReel(); yt.current?.pauseVideo(); }} className="rounded-lg border border-ball px-3 py-1.5 text-sm font-semibold text-ball">⏹ Stop</button>
          : <button onClick={startReel} className="rounded-lg bg-ball px-3 py-1.5 text-sm font-semibold text-bg">▶ Play all</button>}
      </div>
      <div ref={el} className="mt-2 aspect-video overflow-hidden rounded-lg bg-black" />
      {c && nowPlaying && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{nowPlaying(c)}</div>}
      {reel && cur !== null && (
        <div className="mt-1.5 flex gap-1.5 text-xs">
          <button disabled={cur === 0} onClick={() => play(cur - 1)} className="flex-1 rounded-md border border-line py-1.5 disabled:opacity-40">◀ Previous</button>
          <button onClick={() => play(cur)} className="flex-1 rounded-md border border-line py-1.5">↻ Replay</button>
          <button disabled={cur >= clips.length - 1} onClick={() => play(cur + 1)} className="flex-1 rounded-md border border-line py-1.5 disabled:opacity-40">Next ▶</button>
        </div>
      )}
      <ul ref={listEl} className="mt-2 max-h-80 divide-y divide-line overflow-y-auto text-sm">
        {clips.map((x, i) => (
          <li key={x.key} data-i={i} className={`flex items-center gap-2 py-2 ${cur === i ? 'text-ball' : ''}`}>
            <button className="min-w-0 flex-1 text-left" onClick={() => { stopReel(); play(i); }}>
              <span className="block truncate">▶ {x.label}{x.star && <span className="ml-1 text-ball" title={`Highlight for ${x.star}`}>★</span>}</span>
              <span className="block truncate text-xs text-muted">{x.sub} · {fmtTime(x.s)}–{fmtTime(x.e)}</span>
            </button>
            {x.extra}
          </li>
        ))}
      </ul>
    </div>
  );
}
