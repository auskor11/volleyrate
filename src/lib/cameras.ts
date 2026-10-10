// Several cameras on one game. The game's own video (youtubeId, peaks, segments) is its main camera and
// sets the timeline every rally and tag uses; extra cameras (game.angles) are the same game filmed from
// elsewhere, lined up by an offset: camera time = game time + offset.
//
// Each kind of camera has its own rally-detector settings and model, so retraining one never changes
// the other.
import type { Game, Segment } from './games';
import type { Team } from './rotation';

export type CameraKind = 'side' | 'back';

export const CAMERA_KINDS: Record<CameraKind, { label: string; params: Record<string, number> }> = {
  side: { label: 'Side', params: {} },
  // Provisional, from one still of the court: the ball is "above head height" down to about the net's top in
  // this view, and it mostly flies towards / away from the camera, so the sideways check is nearly off.
  // To be tuned on the first back-camera games.
  back: { label: 'Behind a team', params: { y_max: 200, min_xrange: 10 } },
};

export interface Angle {
  id: string;
  name: string;            // e.g. "Side", "Back"
  kind: CameraKind;
  behind?: Team;           // a back camera: which team it stands behind (this game)
  youtubeId: string;
  offset: number;          // seconds: this camera's time = game time + offset
  segments?: Segment[];    // its own detector's candidates (training data for that kind of camera)
  peaks?: number[];        // contact sounds, used to line it up
  sync?: { matched: number; total: number };  // how well the auto-sync matched contact sounds
}

/** Every camera of a game, main one first (its offset is 0). */
export function cameras(g: Game): Angle[] {
  const main: Angle = {
    id: 'main', name: g.cameraName ?? CAMERA_KINDS[g.camera ?? 'side'].label, kind: g.camera ?? 'side',
    ...(g.behind ? { behind: g.behind } : {}), youtubeId: g.youtubeId, offset: 0, segments: g.segments, peaks: g.peaks,
  };
  return [main, ...(g.angles ?? [])];
}

export const cameraLabel = (a: Pick<Angle, 'name' | 'kind' | 'behind'>) =>
  a.kind === 'back' && a.behind ? `${a.name} (behind ${a.behind.toUpperCase()})` : a.name;

/**
 * Line a second camera up with the main one from their contact sounds: the offset at which the most sharp
 * sounds coincide. Returns null if too few sounds match to trust it.
 */
export function autoSync(main: number[], other: number[], maxOffset = 60): { offset: number; matched: number; total: number } | null {
  const pts = (p: number[], n: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < p.length; i += 2) out.push([p[i], p[i + 1]]);
    return out.sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]).sort((a, b) => a - b);
  };
  const A = pts(main, 400), B = pts(other, 400);
  if (A.length < 20 || B.length < 20) return null;
  // vote on offsets between the strongest sounds of each camera (20 ms bins)
  const SA = pts(main, 150), SB = pts(other, 150);
  const votes = new Map<number, number>();
  for (const a of SA) for (const b of SB) {
    const d = b - a;
    if (Math.abs(d) > maxOffset) continue;
    const k = Math.round(d / 0.02);
    votes.set(k, (votes.get(k) ?? 0) + 1);
  }
  let best = 0, bestK = 0;
  for (const [k, v] of votes) { const s = v + (votes.get(k - 1) ?? 0) + (votes.get(k + 1) ?? 0); if (s > best) { best = s; bestK = k; } }
  // refine: average of the matching differences near the winning offset, then count matches overall
  const near = (d0: number, tol: number) => {
    const ds: number[] = [];
    let j = 0;
    for (const a of A) {
      while (j < B.length && B[j] < a + d0 - tol) j++;
      if (j < B.length && Math.abs(B[j] - (a + d0)) <= tol) ds.push(B[j] - a);
    }
    return ds;
  };
  const d1 = near(bestK * 0.02, 0.06);
  if (!d1.length) return null;
  const offset = Math.round((d1.reduce((s, x) => s + x, 0) / d1.length) * 100) / 100;
  const matched = near(offset, 0.06).length;
  return matched >= Math.max(10, A.length * 0.15) ? { offset, matched, total: A.length } : null;
}
