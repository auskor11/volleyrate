// Runs the rally detector (public/detector, copied from rally-lab/web) in a worker on this device.
import { loadActiveModel } from './training';
import { CAMERA_KINDS, type CameraKind } from './cameras';
import type { Segment } from './games';

export interface DetectorProgress { videoTime: number; duration: number; elapsed: number }
export interface DetectorResult {
  rallies: [number, number][];
  segments: Segment[];
  peaks: number[];
  duration: number;
  elapsed: number;
  userAgent: string;
}

export const DETECTOR_VERSION = 'rally-lab-2026-10-08';

export function runDetector(
  file: File,
  onProgress: (p: DetectorProgress) => void,
  onInfo?: (info: { duration?: number; codec?: string }) => void,
  audioOnly = false,
  kind: CameraKind = 'side',
): { result: Promise<DetectorResult>; cancel: () => void } {
  const worker = new Worker('/detector/worker.js');
  let adtsQueue = Promise.resolve();
  const result = (async () => {
    const model = await loadActiveModel(kind);
    return new Promise<DetectorResult>((resolve, reject) => {
      worker.onerror = e => reject(new Error(e.message));
      worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'adts') adtsQueue = adtsQueue.then(() => decodeAdts(worker, m));
        else if (m.type === 'info') onInfo?.(m);
        else if (m.type === 'progress') onProgress(m);
        else if (m.type === 'error') reject(new Error(m.message));
        else if (m.type === 'done') resolve(m);
      };
      worker.postMessage({ source: file, model, opts: { noCandidates: true, audioOnly, params: CAMERA_KINDS[kind].params } });
    });
  })().finally(() => worker.terminate());
  return { result, cancel: () => worker.terminate() };
}

// Older Safari has no WebCodecs AudioDecoder: the worker sends ADTS chunks that we decode here.
async function decodeAdts(worker: Worker, m: { seq: number; data: ArrayBuffer; drop: number }) {
  let pcm = new Float32Array(0);
  try {
    const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(m.data);
    const n = buf.length, ch = buf.numberOfChannels;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    pcm = mono.slice(Math.min(Math.round(m.drop * buf.sampleRate / 48000), n));
  } catch { /* a silent chunk only weakens audio features for that minute */ }
  worker.postMessage({ type: 'pcm', seq: m.seq, pcm }, [pcm.buffer]);
}

export function detectorSupported(): boolean {
  return 'VideoDecoder' in window && typeof Worker !== 'undefined' && window.isSecureContext;
}
