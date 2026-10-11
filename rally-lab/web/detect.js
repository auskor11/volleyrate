// Rally segmentation. Mirrors detect.py exactly; keep the two in sync.

const PARAMS = {
  y_max: 110, min_hue: 18, gap: 4.0, min_hits: 3, min_len: 0.3,
  pad_start: 1.0, pad_end: 1.0, min_xrange: 40,
  serve_peak: 9.0, hit_rate: 1.5, min_prob: 0.4,
  split_gap: 1.6, loud: 12.0, min_loud: 2, end_pad: 1.5,
};

// cand rows: [t, x, y, area, moving, h, s, v, fill]; t = frameIndex / fps
function highBall(cand, p) {
  return cand.filter(r => r[2] < p.y_max && r[5] >= p.min_hue).map(r => [r[0], r[1]]);
}

const uniqSorted = a => Array.from(new Set(a)).sort((x, y) => x - y);
// loops, not Math.max(...a): spreading a long array (a long rally seen in every frame) overflows the stack
const maxOf = a => { let m = -Infinity; for (const x of a) if (x > m) m = x; return m; };
const minOf = a => { let m = Infinity; for (const x of a) if (x < m) m = x; return m; };
const ptp = a => maxOf(a) - minOf(a);

function segment(hb, p) {
  if (!hb.length) return [];
  hb = hb.slice().sort((a, b) => a[0] - b[0]);
  const groups = [[hb[0]]];
  for (let i = 1; i < hb.length; i++) {
    if (hb[i][0] - hb[i - 1][0] > p.gap) groups.push([]);
    groups[groups.length - 1].push(hb[i]);
  }
  const out = [];
  for (const g of groups) {
    const t = uniqSorted(g.map(r => r[0]));
    if (t.length >= p.min_hits && t[t.length - 1] - t[0] >= p.min_len && ptp(g.map(r => r[1])) >= p.min_xrange)
      out.push([Math.max(0, t[0] - p.pad_start), t[t.length - 1] + p.pad_end, t[0]]);
  }
  return out;
}

// flux values with tf in [lo, hi] (tf is sorted)
function fluxRange(au, lo, hi) {
  const { tf, flux } = au;
  let i = lowerBound(tf, lo);
  const out = [];
  for (; i < tf.length && tf[i] <= hi; i++) out.push(flux[i]);
  return out;
}

function lowerBound(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

function audioFeats(r, au) {
  const [a, b, first] = r;
  const w = fluxRange(au, first - 1.5, first + 0.2);
  const peak = w.length ? maxOf(w) : 0;
  const rate = fluxRange(au, a, b).filter(x => x > 6).length / (b - a);
  return [peak, rate];
}

function audioOk(r, au, p) {
  const [peak, rate] = audioFeats(r, au);
  return peak >= p.serve_peak || rate >= p.hit_rate;
}

function features(segs, i, hb, au) {
  const [a, b] = segs[i];
  const [peak, rate] = audioFeats(segs[i], au);
  const g = hb.filter(r => r[0] >= a && r[0] <= b);
  const hits = uniqSorted(g.map(r => r[0])).length;
  const gapPrev = i ? a - segs[i - 1][1] : 60;
  return [Math.log(peak + 1), rate, Math.log(b - a), hits / (b - a),
          ptp(g.map(r => r[1])) / 100, Math.min(gapPrev, 60) / 10];
}

function prob(x, m) {
  let z = m.intercept;
  for (let k = 0; k < x.length; k++) z += (x[k] - m.mean[k]) / m.scale[k] * m.coef[k];
  return 1 / (1 + Math.exp(-z));
}

function splitQuiet(r, hb, au, p) {
  const [a, b, first] = r;
  const t = uniqSorted(hb.filter(x => x[0] >= first && x[0] <= b - p.pad_end + 1e-3).map(x => x[0]));
  const pieces = [[t[0]]];
  for (let i = 1; i < t.length; i++) {
    if (t[i] - t[i - 1] > p.split_gap) pieces.push([]);
    pieces[pieces.length - 1].push(t[i]);
  }
  const loud = (lo, hi) => fluxRange(au, lo, hi).filter(x => x > p.loud).length;
  const clips = [];
  let cur = [pieces[0]];
  for (const pc of pieces.slice(1)) {
    const last = pc[pc.length - 1];
    if (cur.length && loud(pc[0] - 0.5, last + 0.3) >= p.min_loud) {
      cur.push(pc);
    } else if (cur.length) {
      clips.push(cur);  // quiet flight: rally is over
      cur = [];
    } else {
      const w = fluxRange(au, pc[0] - 1.5, pc[0] + 0.2);
      if (loud(pc[0] - 1.5, pc[0] + 0.2) >= 1 && maxOf(w) >= p.serve_peak) cur = [pc];  // new serve
    }
  }
  if (cur.length) clips.push(cur);
  const out = [];
  clips.forEach((c, i) => {
    if (i === 0 || c.reduce((s, x) => s + x.length, 0) >= p.min_hits) {
      const lastPc = c[c.length - 1];
      out.push([i === 0 ? a : Math.max(0, c[0][0] - p.pad_start), lastPc[lastPc.length - 1] + p.end_pad]);
    }
  });
  return out;
}

// Returns { rallies, segments }. Each segment is a candidate the classifier judged, with the
// features it used, so reviewed games can be turned into training data without the video.
function detectRallies(cand, au, model, p = PARAMS) {
  const hb = highBall(cand, p);
  const segs = segment(hb, p);
  const out = [], segments = [];
  const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000;
  segs.forEach((r, i) => {
    if (!audioOk(r, au, p)) return;  // the classifier never sees these
    const f = features(segs, i, hb, au);
    const pr = model ? prob(f, model) : 1;
    segments.push({ a: r1(r[0]), b: r1(r[1]), f: f.map(r3), p: r3(pr) });
    if (pr < p.min_prob) return;
    out.push(...splitQuiet(r, hb, au, p));
  });
  return { rallies: out.map(([a, b]) => [r1(a), r1(b)]), segments };
}

// Serve signature for each window [a, b]: the ball's first flight above the head-height line, as
// [log ball size, height relative to the line] (null if not seen). From a camera behind one team, that
// team's serves start big and high in the picture and the far team's small and near the net, so the
// app can split a game's serves into the two ends. Tested on a reviewed game: 97% of serving teams right.
function serveSignatures(cand, windows, p) {
  const high = cand.filter(r => r[2] < p.y_max && r[5] >= p.min_hue).sort((x, y) => x[0] - y[0]);
  const ht = high.map(r => r[0]);
  const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
  return windows.map(([a, b]) => {
    let i = lowerBound(ht, a);
    const first = [];
    for (; i < high.length && high[i][0] <= b; i++) {
      if (first.length && high[i][0] > first[0][0] + 0.8) break;  // only the first flight: the serve
      first.push(high[i]);
    }
    if (!first.length) return null;
    const r3 = x => Math.round(x * 1000) / 1000;
    return [r3(Math.log(median(first.map(r => r[3])) + 1)), r3(median(first.map(r => r[2])) / p.y_max)];
  });
}

// Contact-like sounds across the whole game, flattened as [t0, h0, t1, h1, ...] (time s, strength).
// Local maxima of the onset strength above minH, at least dist seconds apart (stronger wins).
// The app turns these into suggested touch moments inside each rally.
function onsetPeaks(au, minH = 8, dist = 0.25) {
  const { tf, flux } = au, cand = [];
  for (let i = 1; i < flux.length - 1; i++)
    if (flux[i] >= minH && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) cand.push(i);
  cand.sort((a, b) => flux[b] - flux[a]);
  const kept = [];
  for (const i of cand) if (!kept.some(j => Math.abs(tf[j] - tf[i]) < dist)) kept.push(i);
  kept.sort((a, b) => a - b);
  return kept.flatMap(i => [Math.round(tf[i] * 100) / 100, Math.round(flux[i] * 10) / 10]);
}
