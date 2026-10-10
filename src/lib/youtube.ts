// Minimal YouTube IFrame API wrapper.

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

export async function createPlayer(el: HTMLElement, videoId: string, onStateChange?: (state: number) => void): Promise<YTPlayer> {
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
