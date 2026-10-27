// Minimal YouTube IFrame API wrapper, plus the same interface over a <video> for videos saved on the device.
import { localVideoUrl } from './offline';

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  loadVideoById(o: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: object) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
export function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  apiPromise ??= new Promise(resolve => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** Video id from any common YouTube URL form (watch, youtu.be, shorts, live, embed) or a bare id. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 11);
      const m = u.pathname.match(/\/(shorts|live|embed)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch { /* not a URL */ }
  return null;
}

/** A player for this video: the copy saved on this device when there is one (offline), else YouTube. */
export async function createPlayer(el: HTMLElement, videoId: string, onStateChange?: (state: number) => void): Promise<YTPlayer> {
  const local = await localVideoUrl(videoId);
  if (local) return localPlayer(el, local, onStateChange);
  return youTubePlayer(el, videoId, onStateChange);
}

async function youTubePlayer(el: HTMLElement, videoId: string, onStateChange?: (state: number) => void): Promise<YTPlayer> {
  await loadYouTubeApi();
  return new Promise(resolve => {
    const p: YTPlayer = new window.YT!.Player(el, {
      videoId,
      width: '100%',
      height: '100%',
      // disablekb: YouTube's own number keys would jump around the video while tagging with the keyboard
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, disablekb: 1 },
      events: { onReady: () => resolve(p), onStateChange: (e: { data: number }) => onStateChange?.(e.data) },
    });
  });
}

export const thumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/**
 * A player for a camera whose video is shifted from the game's timeline: everything the app reads and seeks
 * is in game time (camera time = game time + offset).
 */
export function withOffset(p: YTPlayer, offset: () => number): YTPlayer {
  return {
    playVideo: () => p.playVideo(),
    pauseVideo: () => p.pauseVideo(),
    seekTo: (t, ahead) => p.seekTo(Math.max(0, t + offset()), ahead),
    getCurrentTime: () => p.getCurrentTime() - offset(),
    getDuration: () => p.getDuration() - offset(),
    getPlayerState: () => p.getPlayerState(),
    loadVideoById: o => p.loadVideoById(o),
    destroy: () => p.destroy(),
  };
}

/**
 * The YouTube player's interface over a <video> playing a saved copy (states as YouTube's: 1 playing,
 * 2 paused, 0 ended, 3 buffering). Loading another video uses its saved copy; one that isn't saved shows a note.
 */
function localPlayer(host: HTMLElement, url: string, onStateChange?: (state: number) => void): Promise<YTPlayer> {
  const box = document.createElement('div');
  box.style.cssText = 'position:relative;width:100%;height:100%;background:#000';
  const v = document.createElement('video');
  v.playsInline = true; v.controls = true; v.preload = 'auto';
  v.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
  const note = document.createElement('div');
  note.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:16px;text-align:center;color:#ccc;font:14px system-ui';
  const badge = document.createElement('div');
  badge.textContent = '📥 Saved copy';
  badge.style.cssText = 'position:absolute;left:8px;top:8px;padding:2px 8px;border-radius:6px;background:#0009;color:#ddd;font:12px system-ui;pointer-events:none';
  box.append(v, note, badge);
  host.replaceWith(box);
  const urls = [url];
  let endAt: number | null = null;
  const state = () => (v.ended ? 0 : v.paused ? 2 : v.readyState < 3 ? 3 : 1);
  for (const ev of ['play', 'playing', 'pause', 'ended', 'waiting']) v.addEventListener(ev, () => onStateChange?.(state()));
  v.addEventListener('timeupdate', () => { if (endAt !== null && v.currentTime >= endAt) { endAt = null; v.pause(); onStateChange?.(0); } });
  const p: YTPlayer = {
    playVideo: () => { void v.play().catch(() => {}); },
    pauseVideo: () => v.pause(),
    seekTo: t => { v.currentTime = Math.max(0, t); },
    getCurrentTime: () => v.currentTime,
    getDuration: () => (Number.isFinite(v.duration) ? v.duration : 0),
    getPlayerState: state,
    loadVideoById: o => {
      void localVideoUrl(o.videoId).then(u => {
        if (!u) { v.pause(); v.style.visibility = 'hidden'; note.style.display = 'flex'; note.textContent = "This game's video isn't saved on this device."; return; }
        urls.push(u); note.style.display = 'none'; v.style.visibility = 'visible';
        endAt = o.endSeconds ?? null;
        v.src = u;
        v.addEventListener('loadedmetadata', () => { v.currentTime = o.startSeconds ?? 0; void v.play().catch(() => {}); }, { once: true });
      });
    },
    destroy: () => { v.pause(); v.removeAttribute('src'); v.load(); box.remove(); urls.forEach(u => URL.revokeObjectURL(u)); },
  };
  return new Promise(resolve => {
    v.addEventListener('loadedmetadata', () => resolve(p), { once: true });
    v.addEventListener('error', () => resolve(p), { once: true });
    v.src = url;
  });
}
