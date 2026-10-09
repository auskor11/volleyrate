// Per-frame ball candidates and audio onset strength.
// Mirrors balltrack.py (canonical pipeline) and detect.onsets() in Python; keep them in sync.

const BALL = { hLo: 18, sLo: 60, vLo: 100, hHi: 40, minArea: 6, maxArea: 900, moveT: 18, minMove: 0.3 };
const MATRICES = { bt601: [0.299, 0.114], bt709: [0.2126, 0.0722], bt2020: [0.2627, 0.0593] };

// OpenCV's 8-bit BGR->HSV division tables (hsv_shift = 12, hue range 180).
const HSV_SHIFT = 12;
const SDIV = new Int32Array(256), HDIV = new Int32Array(256);
for (let i = 1; i < 256; i++) {
  SDIV[i] = Math.round((255 << HSV_SHIFT) / i);
  HDIV[i] = Math.round((180 << HSV_SHIFT) / (6 * i));
}

class FrameAnalyzer {
  constructor(width, height, outW = 640) {
    this.f = Math.max(1, Math.round(width / outW));
    this.w = Math.floor(width / this.f);
    this.h = Math.floor(height / this.f);
    const n = this.w * this.h;
    this.R = new Uint8Array(n); this.G = new Uint8Array(n); this.B = new Uint8Array(n);
    this.gray = new Uint8Array(n); this.prev = null;
    this.H = new Uint8Array(n); this.S = new Uint8Array(n); this.V = new Uint8Array(n);
    this.mask = new Uint8Array(n); this.tmp = new Uint8Array(n);
    this.label = new Int32Array(n); this.stack = new Int32Array(n);
  }

  // planes: { Y, U, V (typed arrays of samples), yStride, uStride, vStride (in samples),
  //           uvInterleaved (NV12: U/V share one plane, V = U + 1) }
  convertYuv(pl, bits, full, matrix) {
    const { f, w, h, R, G, B } = this;
    const [kr, kb] = MATRICES[matrix];
    const kg = 1 - kr - kb;
    const s = 1 << (bits - 8);
    const ff = f * f;
    const cStep = pl.uvInterleaved ? 2 : 1;
    for (let oy = 0; oy < h; oy++) {
      for (let ox = 0; ox < w; ox++) {
        let sy = 0, su = 0, sv = 0;
        for (let dy = 0; dy < f; dy++) {
          const y = oy * f + dy;
          const yRow = y * pl.yStride, cy = y >> 1;
          const uRow = cy * pl.uStride, vRow = cy * pl.vStride;
          for (let dx = 0; dx < f; dx++) {
            const x = ox * f + dx, cx = (x >> 1) * cStep;
            sy += pl.Y[yRow + x];
            su += pl.U[uRow + cx];
            sv += pl.V[vRow + cx];
          }
        }
        let yy = sy / ff, uu = su / ff, vv = sv / ff;
        yy = full ? yy / (255 * s) : (yy / s - 16) / 219;
        uu = (uu / s - 128) / (full ? 255 : 224);
        vv = (vv / s - 128) / (full ? 255 : 224);
        const r = yy + 2 * (1 - kr) * vv;
        const b = yy + 2 * (1 - kb) * uu;
        const g = (yy - kr * r - kb * b) / kg;
        const i = oy * w + ox;
        R[i] = clamp8(Math.floor(r * 255 + 0.5));
        G[i] = clamp8(Math.floor(g * 255 + 0.5));
        B[i] = clamp8(Math.floor(b * 255 + 0.5));
      }
    }
  }

  // Fallback when raw YUV is unavailable: RGBA from a canvas (browser colour-managed, not canonical).
  setRgba(rgba) {
    const n = this.w * this.h;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      this.R[i] = rgba[j]; this.G[i] = rgba[j + 1]; this.B[i] = rgba[j + 2];
    }
  }

  // Returns candidate rows [t, x, y, area, moving, h, s, v, fill] like balltrack.find_candidates().
  // Only the few yellow pixels go through closing / labelling, so this stays fast.
  candidates(t) {
    const { w, h, R, G, B, gray, H, S, V, mask, tmp, label, stack } = this;
    const n = w * h;
    let nYellow = 0;
    const yellow = this.yellow || (this.yellow = new Int32Array(n));
    for (let i = 0; i < n; i++) {
      const r = R[i], g = G[i], b = B[i];
      gray[i] = (b * 1868 + g * 9617 + r * 4899 + (1 << 13)) >> 14;
      const v = r > g ? (r > b ? r : b) : (g > b ? g : b);
      if (v < BALL.vLo) continue;  // can't be ball-yellow; H/S unused for this pixel
      const vmin = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const diff = v - vmin;
      const sat = (diff * SDIV[v] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
      if (sat < BALL.sLo) continue;
      let hh = v === r ? g - b : v === g ? b - r + 2 * diff : r - g + 4 * diff;
      hh = (hh * HDIV[diff] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
      if (hh < 0) hh += 180;
      if (hh < BALL.hLo || hh > BALL.hHi) continue;
      H[i] = hh; S[i] = sat; V[i] = v;
      yellow[nYellow++] = i;
    }
    const prev = this.prev || gray;
    // morphological close (3x3) on the sparse yellow set: dilate into mask, erode back into tmp.
    // HSV of pixels added by the closing is needed for the per-blob means, so compute it there.
    const touched = this.touched || (this.touched = new Int32Array(n));
    let nT = 0;
    for (let k = 0; k < nYellow; k++) tmp[yellow[k]] = 1;
    for (let k = 0; k < nYellow; k++) {
      const p = yellow[k], px = p % w, py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (!mask[q]) { mask[q] = 1; touched[nT++] = q; }
        }
      }
    }
    // erode: a dilated pixel survives if every in-image neighbour is dilated too
    const closed = this.closed || (this.closed = new Int32Array(n));
    let nC = 0;
    for (let k = 0; k < nT; k++) {
      const q = touched[k], qx = q % w, qy = (q - qx) / w;
      let keep = true;
      for (let dy = -1; dy <= 1 && keep; dy++) {
        const yy = qy + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = qx + dx;
          if (xx < 0 || xx >= w) continue;
          if (!mask[yy * w + xx]) { keep = false; break; }
        }
      }
      if (keep) closed[nC++] = q;
    }
    for (let k = 0; k < nYellow; k++) tmp[yellow[k]] = 0;
    for (let k = 0; k < nC; k++) {
      const q = closed[k];
      tmp[q] = 1;
      if (!yellowAt(this, q)) hsvAt(this, q);
    }
    for (let k = 0; k < nT; k++) mask[touched[k]] = 0;
    // 8-connected components, seeded in raster order like OpenCV
    closed.subarray(0, nC).sort();
    const rows = [];
    let next = 0;
    for (let c = 0; c < nC; c++) {
      const start = closed[c];
      if (label[start]) continue;
      next++;
      let sp = 0, area = 0, sx = 0, sy = 0, mv = 0, sh = 0, ss = 0, sv = 0;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      stack[sp++] = start; label[start] = next;
      while (sp) {
        const p = stack[--sp];
        const px = p % w, py = (p - px) / w;
        area++; sx += px; sy += py;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (Math.abs(gray[p] - prev[p]) > BALL.moveT) mv++;
        sh += H[p]; ss += S[p]; sv += V[p];
        for (let dy = -1; dy <= 1; dy++) {
          const yy = py + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = px + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (tmp[q] && !label[q]) { label[q] = next; stack[sp++] = q; }
          }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (area < BALL.minArea || area > BALL.maxArea || Math.max(bw, bh) > 2 * Math.min(bw, bh) + 2) continue;
      const move = mv / area;
      if (move < BALL.minMove) continue;
      rows.push([t, sx / area, sy / area, area, move, sh / area, ss / area, sv / area, area / (bw * bh)]);
    }
    // reset only what we touched
    for (let k = 0; k < nC; k++) { tmp[closed[k]] = 0; label[closed[k]] = 0; }
    if (!this.prev) this.prev = new Uint8Array(n);
    this.prev.set(gray);
    return rows;
  }
}

function yellowAt(fa, i) {
  const r = fa.R[i], g = fa.G[i], b = fa.B[i];
  const v = r > g ? (r > b ? r : b) : (g > b ? g : b);
  if (v < BALL.vLo) return false;
  const vmin = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const diff = v - vmin;
  const sat = (diff * SDIV[v] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
  if (sat < BALL.sLo) return false;
  let hh = v === r ? g - b : v === g ? b - r + 2 * diff : r - g + 4 * diff;
  hh = (hh * HDIV[diff] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
  if (hh < 0) hh += 180;
  return hh >= BALL.hLo && hh <= BALL.hHi;
}

// OpenCV 8-bit HSV of pixel i into fa.H/S/V
function hsvAt(fa, i) {
  const r = fa.R[i], g = fa.G[i], b = fa.B[i];
  const v = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const vmin = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const diff = v - vmin;
  let hh = v === r ? g - b : v === g ? b - r + 2 * diff : r - g + 4 * diff;
  hh = (hh * HDIV[diff] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
  if (hh < 0) hh += 180;
  fa.H[i] = hh; fa.S[i] = (diff * SDIV[v] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT; fa.V[i] = v;
}

function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// ---- audio: mono 16 kHz -> STFT (hann 256, hop 128, zero boundary) -> positive log-spectral flux ----

const SR = 16000, NFFT = 256, HOP = 128;

class AudioAnalyzer {
  constructor(inRate) {
    this.inRate = inRate;
    // low-pass FIR (windowed sinc) before resampling to 16 kHz
    const taps = 63, fc = 0.45 * SR / inRate;
    this.fir = new Float64Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const k = i - (taps - 1) / 2;
      const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
      const win = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1));
      this.fir[i] = sinc * win; sum += this.fir[i];
    }
    for (let i = 0; i < taps; i++) this.fir[i] /= sum;
    this.ring = taps + 1;
    // ring buffer of input samples, stored twice so any window is contiguous (no modulo in the filter loop)
    this.hist = new Float64Array(2 * this.ring);
    this.hpos = 0;
    this.inCount = 0;      // input samples consumed
    this.outPos = 0;       // next output sample position in input-sample units
    this.step = inRate / SR;
    // STFT state: start with NFFT/2 zeros (scipy boundary='zeros')
    this.buf = new Float64Array(1 << 20); this.bufLen = HOP; this.frame = 0;
    this.win = new Float64Array(NFFT);
    for (let i = 0; i < NFFT; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NFFT);
    this.winSum = this.win.reduce((a, b) => a + b, 0);
    this.prevLog = null;
    this.flux = [];  // flux[k-1] belongs to frame k (time k*HOP/SR)
    this.re = new Float64Array(NFFT); this.im = new Float64Array(NFFT);
    this.fftInit();
  }

  // FIR output over the window starting at ring slot hpos + start. The ring is one longer
  // than the filter, so start = 1 is the window ending at the newest sample, 0 the one before.
  filtered(start) {
    const { fir, hist } = this, taps = fir.length;
    let acc = 0;
    for (let k = 0, p = (this.hpos + start) % this.ring; k < taps; k++, p++) acc += fir[k] * hist[p];
    return acc;
  }

  push(mono) {
    const delay = (this.fir.length - 1) / 2;
    for (let i = 0; i < mono.length; i++) {
      this.hist[this.hpos] = this.hist[this.hpos + this.ring] = mono[i];
      this.hpos = (this.hpos + 1) % this.ring;
      // the filtered sample for input index (inCount - delay) is now available;
      // outputs between it and the previous one are linearly interpolated
      const idx = this.inCount - delay;
      while (this.outPos <= idx) {
        const frac = this.outPos - (idx - 1);
        const last = this.filtered(1);
        this.emit(frac >= 1 ? last : this.filtered(0) * (1 - frac) + last * frac);
        this.outPos += this.step;
      }
      this.inCount++;
    }
  }

  emit(x) {
    if (this.bufLen >= this.buf.length) {
      // keep only the unprocessed tail
      const keepFrom = this.frame * HOP - this.base();
      this.buf.copyWithin(0, keepFrom, this.bufLen);
      this.bufLen -= keepFrom; this.baseOffset = (this.baseOffset || 0) + keepFrom;
    }
    this.buf[this.bufLen++] = x;
    while (this.frame * HOP - this.base() + NFFT <= this.bufLen) this.stftFrame();
  }

  base() { return this.baseOffset || 0; }

  stftFrame() {
    const off = this.frame * HOP - this.base();
    const { re, im, win, buf } = this;
    for (let i = 0; i < NFFT; i++) { re[i] = buf[off + i] * win[i]; im[i] = 0; }
    this.fft(re, im);
    const nb = NFFT / 2 + 1, lg = new Float64Array(nb);
    const sc = 200 / this.winSum;
    for (let k = 0; k < nb; k++) lg[k] = Math.log1p(Math.sqrt(re[k] * re[k] + im[k] * im[k]) * sc);
    if (this.prevLog) {
      let s = 0;
      for (let k = 0; k < nb; k++) { const d = lg[k] - this.prevLog[k]; if (d > 0) s += d; }
      this.flux.push(s);
    }
    this.prevLog = lg;
    this.frame++;
  }

  finish() {
    for (let i = 0; i < NFFT; i++) this.emit(0);  // scipy pads the end with zeros
    const flux = Float64Array.from(this.flux);
    const sorted = Float64Array.from(flux).sort();
    const m = sorted.length;
    const median = m % 2 ? sorted[(m - 1) / 2] : (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
    const tf = new Float64Array(m);
    for (let k = 0; k < m; k++) { tf[k] = (k + 1) * HOP / SR; flux[k] /= median; }
    return { tf, flux };
  }

  fftInit() {
    const n = NFFT;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2); this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / n); this.sin[i] = -Math.sin(2 * Math.PI * i / n); }
  }

  fft(re, im) {
    const n = NFFT, rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * this.cos[k] - im[b] * this.sin[k];
          const ti = re[b] * this.sin[k] + im[b] * this.cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}
