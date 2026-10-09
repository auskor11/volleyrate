// Retraining the detector's clip classifier from reviewed games, entirely in the browser.
// Mirrors rally-lab/train.py: standardise features, L2 logistic regression (C = 1, intercept not
// penalised), keep a clip when probability >= 0.4.
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Game } from './games';

export interface Model { mean: number[]; scale: number[]; coef: number[]; intercept: number }
export interface Row { f: number[]; y: 0 | 1 }
export interface Eval { real: number; falses: number; realKept: number; falseKept: number }

export const MIN_PROB = 0.4;
const configRef = () => doc(db, 'config', 'detector');

/** Model the detector should use: the retrained one if an admin activated it, else the bundled one. */
export async function loadActiveModel(): Promise<Model> {
  try {
    const snap = await getDoc(configRef());
    if (snap.exists() && snap.data().model) return snap.data().model as Model;
  } catch { /* fall back to the bundled model */ }
  return fetch('/detector/model.json').then(r => r.json());
}

export async function activeModelInfo(): Promise<{ trainedAt?: Date; n?: number; by?: string } | null> {
  const snap = await getDoc(configRef());
  if (!snap.exists()) return null;
  const d = snap.data();
  return { trainedAt: d.trainedAt?.toDate?.(), n: d.n, by: d.by };
}

export async function activateModel(model: Model, n: number, by: string) {
  await setDoc(configRef(), { model, n, by, trainedAt: serverTimestamp() });
}

export async function resetModel() {
  await setDoc(configRef(), { model: null, n: null, by: null, trainedAt: serverTimestamp() });
}

/** Training rows from reviewed games: a candidate is real if it overlaps a rally that survived review. */
export function rowsFromGames(games: Game[]): Row[] {
  const rows: Row[] = [];
  for (const g of games) {
    if (!g.reviewed || !g.segments?.length) continue;
    const real = g.rallies.filter(r => r.st !== 'bad');
    for (const s of g.segments) {
      const hit = real.some(r => Math.min(r.e, s.b) - Math.max(r.s, s.a) > 0);
      rows.push({ f: s.f, y: hit ? 1 : 0 });
    }
  }
  return rows;
}

export async function baseRows(): Promise<Row[]> {
  const d = await fetch('/detector/train_base.json').then(r => r.json());
  return d.rows;
}

export function prob(f: number[], m: Model): number {
  let z = m.intercept;
  for (let k = 0; k < f.length; k++) z += (f[k] - m.mean[k]) / m.scale[k] * m.coef[k];
  return 1 / (1 + Math.exp(-z));
}

export function evaluate(rows: Row[], predict: (r: Row, i: number) => number): Eval {
  const e: Eval = { real: 0, falses: 0, realKept: 0, falseKept: 0 };
  rows.forEach((r, i) => {
    const keep = predict(r, i) >= MIN_PROB;
    if (r.y) { e.real++; if (keep) e.realKept++; } else { e.falses++; if (keep) e.falseKept++; }
  });
  return e;
}

export function train(rows: Row[]): Model {
  const d = rows[0].f.length, n = rows.length;
  const mean = Array.from({ length: d }, (_, k) => rows.reduce((s, r) => s + r.f[k], 0) / n);
  const scale = mean.map((m, k) => Math.sqrt(rows.reduce((s, r) => s + (r.f[k] - m) ** 2, 0) / n) || 1);
  const X = rows.map(r => [...r.f.map((v, k) => (v - mean[k]) / scale[k]), 1]);  // last column = intercept
  const theta = fit(X, rows.map(r => r.y));
  return { mean, scale, coef: theta.slice(0, d), intercept: theta[d] };
}

/** Leave-one-out evaluation: each row is scored by a model trained without it. */
export function leaveOneOut(rows: Row[]): Eval {
  return evaluate(rows, (r, i) => prob(r.f, train(rows.filter((_, j) => j !== i))));
}

// Newton's method on 0.5·|w|² + Σ logloss (C = 1).
function fit(X: number[][], y: number[]): number[] {
  const D = X[0].length;
  let t = new Array(D).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = new Array(D).fill(0);
    const H = Array.from({ length: D }, () => new Array(D).fill(0));
    for (let i = 0; i < X.length; i++) {
      const x = X[i];
      const p = 1 / (1 + Math.exp(-x.reduce((s, v, k) => s + v * t[k], 0)));
      const w = p * (1 - p);
      for (let a = 0; a < D; a++) {
        g[a] += (p - y[i]) * x[a];
        for (let b = 0; b < D; b++) H[a][b] += w * x[a] * x[b];
      }
    }
    for (let a = 0; a < D - 1; a++) { g[a] += t[a]; H[a][a] += 1; }  // penalty on weights, not intercept
    const step = solve(H, g);
    t = t.map((v, k) => v - step[k]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return t;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
