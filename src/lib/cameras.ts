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
  // Tuned in rally-lab (tune_camera.py) on the reviewed "Back Angle" game (22 Aug, 94 rallies): found 81/94
  // with 16% false clips, up from 58/94. This view: "above head height" is about the net's top; the ball
  // flies mostly towards / away from the camera (little sideways travel); contacts sound much quieter
  // than from the side, so the sound rules are far looser; slightly longer gaps inside a rally.
  back: {
    label: 'Behind a team',
    params: { y_max: 200, min_xrange: 10, serve_peak: 5, hit_rate: 0.6, min_hits: 2, loud: 6, min_loud: 2, gap: 5 },
  },
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
  net?: number;            // back camera: where the top of the net is (fraction of the picture's height)
  serves?: number[];       // serve signatures [rally start (game time), ball size, height, ...] (see serveGuesses)
}

/** Every camera of a game, main one first (its offset is 0). */
export function cameras(g: Game): Angle[] {
  const main: Angle = {
    id: 'main', name: g.cameraName ?? CAMERA_KINDS[g.camera ?? 'side'].label, kind: g.camera ?? 'side',
    ...(g.behind ? { behind: g.behind } : {}), ...(g.net ? { net: g.net } : {}), ...(g.serves ? { serves: g.serves } : {}),
    youtubeId: g.youtubeId, offset: 0, segments: g.segments, peaks: g.peaks,
  };
  return [main, ...(g.angles ?? [])];
}

/** Flatten the detector's per-rally serve signatures as [start (game time), size, height, ...]. */
export function packServes(starts: number[], sigs: ((number[] | null) | undefined)[]): number[] {
  const out: number[] = [];
  starts.forEach((s, i) => { const f = sigs[i]; if (f) out.push(Math.round(s * 10) / 10, f[0], f[1]); });
  return out;
}

/**
 * Which team served each rally, from a camera behind a team: that team's serves start with a big ball high
 * in the picture, the far team's with a small one near the net. The game's serves are split into those two
 * groups (no thresholds, so it adapts to each camera and zoom); the big-ball group is the team the camera is
 * behind. Tested on a reviewed game: 97% right. Returns a lookup by rally start (game time).
 */
export function serveGuesses(g: Game): (rallyStart: number) => { team: Team; sure: boolean } | null {
  const cam = cameras(g).find(c => c.kind === 'back' && c.behind && (c.serves?.length ?? 0) >= 30);
  if (!cam) return () => null;
  const pts: { s: number; f: [number, number] }[] = [];
  for (let i = 0; i + 2 < cam.serves!.length; i += 3) pts.push({ s: cam.serves![i], f: [cam.serves![i + 1], cam.serves![i + 2]] });
  const mean = [0, 1].map(k => pts.reduce((a, p) => a + p.f[k], 0) / pts.length);
  const sd = [0, 1].map(k => Math.sqrt(pts.reduce((a, p) => a + (p.f[k] - mean[k]) ** 2, 0) / pts.length) || 1);
  const z = pts.map(p => [0, 1].map(k => (p.f[k] - mean[k]) / sd[k]));
  // two groups, started from a split at the median ball size
  const med = [...z.map(v => v[0])].sort((a, b) => a - b)[z.length >> 1];
  let cent = [z.filter(v => v[0] >= med), z.filter(v => v[0] < med)].map(gr => [0, 1].map(k => gr.reduce((a, v) => a + v[k], 0) / Math.max(1, gr.length)));
  const d2 = (v: number[], c: number[]) => (v[0] - c[0]) ** 2 + (v[1] - c[1]) ** 2;
  let lab = z.map(v => (d2(v, cent[0]) <= d2(v, cent[1]) ? 0 : 1));
  for (let it = 0; it < 20; it++) {
    cent = [0, 1].map(c => { const gr = z.filter((_, i) => lab[i] === c); return [0, 1].map(k => gr.reduce((a, v) => a + v[k], 0) / Math.max(1, gr.length)); });
    lab = z.map(v => (d2(v, cent[0]) <= d2(v, cent[1]) ? 0 : 1));
  }
  const near = cent[0][0] >= cent[1][0] ? 0 : 1;  // the bigger-ball group is the near end
  const margin = z.map(v => Math.abs(d2(v, cent[0]) - d2(v, cent[1])));
  const cut = [...margin].sort((a, b) => a - b)[Math.floor(margin.length * 0.1)];  // the least clear 10% aren't "sure"
  const behind = cam.behind!, farTeam: Team = behind === 'a' ? 'b' : 'a';
  return start => {
    let best = -1, bd = 1.5;
    pts.forEach((p, i) => { const d = Math.abs(p.s - start); if (d < bd) { bd = d; best = i; } });
    return best < 0 ? null : { team: lab[best] === near ? behind : farTeam, sure: margin[best] > cut };
  };
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
