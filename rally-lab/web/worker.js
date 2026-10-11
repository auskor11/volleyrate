// Background worker: read MP4 -> hardware-decode video + audio (WebCodecs) -> analyze -> detect rallies.
// Messages in:  { source: File | { url }, model, opts: { mode?: 'webgl'|'rgba'|'canvas', audio?: 'adts', maxSeconds?, noCandidates?, audioOnly?, params?, serveWindows? } }
//                audioOnly: skip video, only return contact-sound peaks (fast)
//                { type: 'pcm', seq, pcm }   (reply to an 'adts' request, see AdtsAudio)
// Messages out: { type: 'info' | 'progress' | 'done' | 'error' | 'adts', ... }
importScripts('vendor/mp4box.all.min.js', 'analyze.js', 'detect.js');

const FPS = 15;
const WINDOW = 32 << 20;  // bytes read per file request

self.onmessage = e => {
  if (e.data.type === 'pcm') return adtsReply(e.data);
  run(e.data).catch(err => post('error', { message: String(err && err.stack || err) }));
};

function post(type, data) { self.postMessage({ type, ...data }); }

// ---- file access: local File or URL with Range requests ----
function openSource(src) {
  if (src instanceof Blob) {
    return { size: src.size, name: src.name, read: (off, len) => src.slice(off, off + len).arrayBuffer() };
  }
  return (async () => {
    const head = await fetch(src.url, { headers: { Range: 'bytes=0-0' } });
    const size = Number(head.headers.get('Content-Range').split('/')[1]);
    return {
      size, name: decodeURIComponent(src.url.split('/').pop()),
      read: async (off, len) => (await fetch(src.url, { headers: { Range: `bytes=${off}-${off + len - 1}` } })).arrayBuffer(),
    };
  })();
}

// top-level MP4 boxes: [{ type, start, size }]
async function topBoxes(f) {
  const boxes = [];
  for (let pos = 0; pos < f.size;) {
    const h = new DataView(await f.read(pos, 16));
    let size = h.getUint32(0);
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (size === 1) size = Number(h.getBigUint64(8));
    else if (size === 0) size = f.size - pos;
    boxes.push({ type, start: pos, size });
    pos += size;
  }
  return boxes;
}

// Parse only ftyp + moov with mp4box (moov is at the end of phone recordings); sample tables
// keep absolute file offsets, so we read sample data ourselves afterwards.
async function parseMoov(f) {
  const boxes = await topBoxes(f);
  const need = boxes.filter(b => b.type === 'ftyp' || b.type === 'moov');
  if (!need.some(b => b.type === 'moov')) throw new Error('No moov box: not an MP4 file?');
  const mp4 = MP4Box.createFile();
  let info = null;
  mp4.onReady = i => { info = i; };
  mp4.onError = e => { throw new Error('mp4box: ' + e); };
  let fake = 0;
  for (const b of need) {
    const buf = await f.read(b.start, b.size);
    buf.fileStart = fake;
    fake += b.size;
    mp4.appendBuffer(buf);
  }
  mp4.flush();
  if (!info) throw new Error('Could not read MP4 header');
  return { mp4, info };
}

function codecDescription(mp4, track) {
  const trak = mp4.getTrackById(track.id);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const s = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(s);
      return new Uint8Array(s.buffer, 8);  // strip the box header
    }
    if (entry.esds) return entry.esds.esd.descs[0].descs[0].data;  // AudioSpecificConfig
  }
  return undefined;
}

async function run({ source, model, opts = {} }) {
  const t0 = performance.now();
  const f = await openSource(source);
  const { mp4, info } = await parseMoov(f);
  const vt = info.videoTracks[0], at = info.audioTracks[0];
  if (!vt) throw new Error('No video track');
  const duration = info.duration / info.timescale;

  const vConfig = {
    codec: vt.codec, codedWidth: vt.video.width, codedHeight: vt.video.height,
    description: codecDescription(mp4, vt), hardwareAcceleration: 'prefer-hardware',
  };
  const vSupport = await VideoDecoder.isConfigSupported(vConfig);
  if (!vSupport.supported) throw new Error(`This browser cannot decode ${vt.codec} video`);
  post('info', { name: f.name, size: f.size, duration, codec: vt.codec, width: vt.video.width,
                 height: vt.video.height, audio: at ? at.codec : null });

  // ---- video: pick frames at 15 fps like ffmpeg's fps filter, analyze in order ----
  const fa = new FrameAnalyzer(vt.video.width, vt.video.height);
  const cand = [];
  let nextSlot = 0, firstTs = null, frames = 0, mode = null, colour = null;
  const queue = [];
  let processing = Promise.resolve();
  let lastProgress = 0, videoTime = 0;
  const timing = { pixels: 0, analyze: 0, waiting: 0, reading: 0 };

  const decoder = new VideoDecoder({
    output: frame => {
      if (firstTs === null) firstTs = frame.timestamp;
      const t = (frame.timestamp - firstTs) / 1e6;
      let slot = -1;
      // slot k uses the first frame at or after k/15 (within half an input frame);
      // skipped slots would be duplicates with no motion, so no candidates
      while (nextSlot / FPS - 1 / 60 <= t) { if (slot < 0) slot = nextSlot; nextSlot++; }
      if (slot < 0) { frame.close(); return; }
      queue.push(frame);
      processing = processing.then(() => analyzeFrame(queue.shift(), slot));
    },
    error: e => post('error', { message: 'Video decode error: ' + e.message }),
  });
  decoder.configure(vConfig);

  async function analyzeFrame(frame, slot) {
    try {
      videoTime = frame.timestamp / 1e6;
      if (mode === null) {
        mode = opts.mode || (['I420', 'I420P10', 'NV12'].includes(frame.format) ? 'yuv'
                             : hasWebgl2() ? 'webgl' : 'canvas');
        colour = frameColour(frame, vt);
        post('info', { frameFormat: frame.format, colour, mode });
      }
      if (mode === 'yuv') {
        const { pl, bits } = await copyPlanes(frame);
        fa.convertYuv(pl, bits, colour.full, colour.matrix);
      } else if (mode === 'webgl') {
        // pipelined: submit this frame to the GPU, analyze the previous one meanwhile
        const tg = performance.now();
        glSubmit(frame, fa.w, fa.h);
        frame.close();
        glPending.push(slot);
        timing.pixels += performance.now() - tg;
        if (glPending.length > 1) await analyzeGl(glPending.shift());
        return;
      } else if (mode === 'rgba') {
        fa.setRgba(await copyRgba(frame, fa.f, fa.w, fa.h));
      } else {
        fa.setRgba(drawRgba(frame, fa.w, fa.h));
      }
    } finally {
      frame.close();
    }
    collect(slot);
  }

  const glPending = [];
  async function analyzeGl(slot) {
    const tg = performance.now();
    fa.setRgba(glCollect());
    timing.pixels += performance.now() - tg;
    collect(slot);
  }

  function collect(slot) {
    const tc = performance.now();
    const rows = fa.candidates(slot / FPS);
    timing.analyze += performance.now() - tc;
    for (const r of rows) cand.push(r);
    frames++;
    const now = performance.now();
    if (now - lastProgress > 500) {
      lastProgress = now;
      post('progress', { videoTime, duration, frames, elapsed: (now - t0) / 1000, timing });
    }
  }

  // ---- audio: WebCodecs if available, else ADTS chunks decoded by the page (older Safari) ----
  let au = null, audioDecoder = null, adts = null;
  const audioConfig = at && { codec: at.codec, sampleRate: at.audio.sample_rate,
                              numberOfChannels: at.audio.channel_count, description: codecDescription(mp4, at) };
  const webcodecsAudio = at && opts.audio !== 'adts' && typeof AudioDecoder !== 'undefined' &&
    (await AudioDecoder.isConfigSupported(audioConfig).catch(() => ({}))).supported;
  if (at) au = new AudioAnalyzer(at.audio.sample_rate);
  if (at && !webcodecsAudio) {
    adts = new AdtsAudio(audioConfig.description, au);
    post('info', { audioPath: 'page decodeAudioData (ADTS)' });
  } else if (at) {
    audioDecoder = new AudioDecoder({
      output: data => {
        const n = data.numberOfFrames, ch = data.numberOfChannels;
        const mono = new Float32Array(n), tmp = new Float32Array(n);
        for (let c = 0; c < ch; c++) {
          data.copyTo(tmp, { planeIndex: c, format: 'f32-planar' });
          for (let i = 0; i < n; i++) mono[i] += tmp[i] / ch;
        }
        data.close();
        au.push(mono);
      },
      error: e => post('error', { message: 'Audio decode error: ' + e.message }),
    });
    audioDecoder.configure(audioConfig);
    post('info', { audioPath: 'WebCodecs AudioDecoder' });
  }

  // ---- read samples in file order, feed both decoders ----
  const samples = [];
  if (!opts.audioOnly) for (const s of mp4.getTrackSamplesInfo(vt.id)) samples.push({ s, v: true });
  if (at) for (const s of mp4.getTrackSamplesInfo(at.id)) samples.push({ s, v: false });
  samples.sort((a, b) => a.s.offset - b.s.offset);
  if (opts.maxSeconds) {  // test runs: cut in decode order so no reference frame is missing
    for (let k = samples.length - 1; k >= 0; k--)
      if (samples[k].s.dts / samples[k].s.timescale > opts.maxSeconds) samples.splice(k, 1);
  }

  let i = 0;
  while (i < samples.length) {
    const start = samples[i].s.offset;
    let end = start;
    let j = i;
    // audio-only: don't read across the big video chunks between audio chunks
    while (j < samples.length && samples[j].s.offset + samples[j].s.size - start <= WINDOW &&
           (!opts.audioOnly || j === i || samples[j].s.offset - end < (1 << 16))) {
      end = Math.max(end, samples[j].s.offset + samples[j].s.size); j++;
    }
    if (j === i) { end = start + samples[i].s.size; j = i + 1; }
    const tr = performance.now();
    const buf = await f.read(start, end - start);
    timing.reading += performance.now() - tr;
    for (; i < j; i++) {
      const { s, v } = samples[i];
      const data = new Uint8Array(buf, s.offset - start, s.size);
      const ts = 1e6 * s.cts / s.timescale, dur = 1e6 * s.duration / s.timescale;
      if (v) {
        decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: ts, duration: dur, data }));
        // backpressure: keep the decoder and analysis queues short
        const tw = performance.now();
        while (decoder.decodeQueueSize > 24 || queue.length > 6) await sleep(2);
        timing.waiting += performance.now() - tw;
      } else if (audioDecoder) {
        audioDecoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: ts, duration: dur, data }));
      } else {
        adts.add(data);
      }
    }
  }
  await decoder.flush();
  if (audioDecoder) await audioDecoder.flush();
  if (adts) await adts.finish();
  await processing;
  while (glPending.length) await analyzeGl(glPending.shift());
  decoder.close();
  if (audioDecoder) audioDecoder.close();

  const audio = au ? au.finish() : { tf: new Float64Array(0), flux: new Float64Array(0) };
  // opts.params: per-camera overrides of PARAMS (e.g. a camera behind a team); model null = keep every candidate
  const P = { ...PARAMS, ...(opts.params || {}) };
  const { rallies, segments } = opts.audioOnly ? { rallies: [], segments: [] } : detectRallies(cand, audio, model, P);
  const peaks = onsetPeaks(audio);
  // serve signature of each rally (given windows, else the detected rallies): tells which end served
  const serves = opts.audioOnly ? [] : serveSignatures(cand, opts.serveWindows || rallies, P);
  post('done', {
    rallies, segments, peaks, serves, frames, candidates: opts.noCandidates ? undefined : cand, mode, colour, timing,
    elapsed: (performance.now() - t0) / 1000, duration, processed: Math.min(duration, opts.maxSeconds || duration),
    userAgent: navigator.userAgent,
  });
}

function hasWebgl2() {
  try { return typeof OffscreenCanvas !== 'undefined' && !!new OffscreenCanvas(1, 1).getContext('webgl2'); }
  catch { return false; }
}

// Fallback audio path: wrap AAC frames in ADTS headers, send ~1 minute at a time to the page
// (decodeAudioData only exists on the main thread), get PCM back and feed it in order.
// Each chunk starts OVERLAP frames early; the decoder's warm-up output for those is dropped.
const ADTS_CHUNK = 2800, OVERLAP = 4;
let adtsPending = new Map();
function adtsReply(m) { const r = adtsPending.get(m.seq); adtsPending.delete(m.seq); r(m.pcm); }

class AdtsAudio {
  constructor(asc, au) {
    const b0 = asc[0], b1 = asc[1];
    this.profile = (b0 >> 3) - 1;               // AAC object type - 1 (LC = 1)
    this.freq = ((b0 & 7) << 1) | (b1 >> 7);    // sampling frequency index
    this.chan = (b1 >> 3) & 15;                 // channel configuration
    this.au = au; this.frames = []; this.prev = []; this.seq = 0;
    this.chain = Promise.resolve();
  }
  add(data) {
    this.frames.push(data.slice());
    if (this.frames.length >= ADTS_CHUNK) this.send();
  }
  send() {
    if (!this.frames.length) return;
    const all = this.prev.concat(this.frames);
    const drop = this.prev.length;
    this.prev = this.frames.slice(-OVERLAP);
    this.frames = [];
    const size = all.reduce((n, f) => n + f.length + 7, 0);
    const out = new Uint8Array(size);
    let o = 0;
    for (const f of all) {
      const len = f.length + 7;
      out.set([0xFF, 0xF1, (this.profile << 6) | (this.freq << 2) | (this.chan >> 2),
               ((this.chan & 3) << 6) | (len >> 11), (len >> 3) & 0xFF, ((len & 7) << 5) | 0x1F, 0xFC], o);
      out.set(f, o + 7);
      o += len;
    }
    const seq = this.seq++;
    const got = new Promise(r => adtsPending.set(seq, r));
    self.postMessage({ type: 'adts', seq, data: out.buffer, drop: drop * 1024 }, [out.buffer]);
    // feed results strictly in order
    this.chain = this.chain.then(() => got).then(pcm => this.au.push(pcm));
  }
  finish() { this.send(); return this.chain; }
}

function frameColour(frame, track) {
  const cs = frame.colorSpace || {};
  const m = cs.matrix || '';
  const matrix = m.startsWith('bt2020') ? 'bt2020' : m === 'bt709' ? 'bt709'
    : (m === 'smpte170m' || m === 'bt470bg') ? 'bt601'
    : (frame.format === 'I420P10' ? 'bt2020' : 'bt709');
  return { matrix, full: cs.fullRange === true, reported: { matrix: cs.matrix, fullRange: cs.fullRange } };
}

async function copyPlanes(frame) {
  const buf = new ArrayBuffer(frame.allocationSize());
  const layout = await frame.copyTo(buf);
  const ten = frame.format === 'I420P10';
  const bpp = ten ? 2 : 1;
  const view = ten ? new Uint16Array(buf) : new Uint8Array(buf);
  const plane = k => view.subarray(layout[k].offset / bpp);
  if (frame.format === 'NV12') {
    const uv = plane(1);
    return { bits: 8, pl: { Y: plane(0), U: uv, V: uv.subarray(1), uvInterleaved: true,
             yStride: layout[0].stride, uStride: layout[1].stride, vStride: layout[1].stride } };
  }
  return { bits: ten ? 10 : 8, pl: { Y: plane(0), U: plane(1), V: plane(2),
           yStride: layout[0].stride / bpp, uStride: layout[1].stride / bpp, vStride: layout[2].stride / bpp } };
}

let canvas = null, ctx = null;
function drawRgba(frame, w, h) {
  if (!canvas) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext('2d', { willReadFrequently: true }); }
  ctx.drawImage(frame, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

// Full-size RGBA from the decoder, box-averaged down by f.
let rgbaBuf = null, small = null;
async function copyRgba(frame, f, w, h) {
  const W = frame.visibleRect.width;
  const size = W * frame.visibleRect.height * 4;
  if (!rgbaBuf || rgbaBuf.byteLength !== size) rgbaBuf = new Uint8Array(size);
  await frame.copyTo(rgbaBuf, { format: 'RGBA', colorSpace: 'srgb' });
  if (!small) small = new Uint8Array(w * h * 4);
  const ff = f * f;
  for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const p = ((oy * f + dy) * W + ox * f + dx) * 4;
      r += rgbaBuf[p]; g += rgbaBuf[p + 1]; b += rgbaBuf[p + 2];
    }
    const o = (oy * w + ox) * 4;
    small[o] = Math.round(r / ff); small[o + 1] = Math.round(g / ff); small[o + 2] = Math.round(b / ff);
  }
  return small;
}

// GPU path: upload the frame as a texture, box-filter it down to w x h in a shader, and read it
// back through pixel-pack buffers so the read of frame N-1 overlaps the GPU work for frame N.
let gl = null, glOut = null, pbos = [], pboIdx = 0, glQueue = [];
function glInit(frame, w, h) {
  const c = new OffscreenCanvas(w, h);
  gl = c.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  const vs = `#version 300 es
    in vec2 p; out vec2 uv;
    void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const fs = `#version 300 es
    precision highp float; uniform sampler2D tex; uniform vec2 src; in vec2 uv; out vec4 o;
    void main() {
      // average the 2x2 source texels under this output pixel (f = 2 for 1280x720 -> 640x360)
      vec2 t = 1.0 / src; vec2 c = uv;
      o = 0.25 * (texture(tex, c + vec2(-0.5, -0.5) * t) + texture(tex, c + vec2(0.5, -0.5) * t)
                + texture(tex, c + vec2(-0.5, 0.5) * t) + texture(tex, c + vec2(0.5, 0.5) * t));
    }`;
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
                        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.uniform2f(gl.getUniformLocation(prog, 'src'), frame.displayWidth, frame.displayHeight);
  gl.viewport(0, 0, w, h);
  glOut = new Uint8Array(w * h * 4);
  for (let i = 0; i < 2; i++) {
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pb);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
    pbos.push(pb);
  }
}

function glSubmit(frame, w, h) {
  if (!gl) glInit(frame, w, h);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const pb = pbos[pboIdx]; pboIdx = (pboIdx + 1) % pbos.length;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pb);
  // readPixels returns the framebuffer bottom row first; that row sampled v = 0, the image top
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  glQueue.push(pb);
  gl.flush();
}

function glCollect() {
  const pb = glQueue.shift();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pb);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, glOut);
  return glOut;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
