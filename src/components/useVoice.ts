// The browser's speech recognition, kept listening while voice tagging is on (it stops itself after a
// silence, so it's restarted). Each finished phrase comes with a video moment per touch, stamped as the
// words first appear (not when the phrase ends a second or two later).
import { useEffect, useRef, useState } from 'react';

interface Rec {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; abort(): void;
}
type RecClass = new () => Rec;
const recImpl = () => {
  const w = window as unknown as { SpeechRecognition?: RecClass; webkitSpeechRecognition?: RecClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const voiceSupported = () => typeof window !== 'undefined' && !!recImpl();

export function useVoice(onPhrase: (text: string, times: number[]) => void, count: (text: string) => number, now: () => number) {
  const [on, setOn] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const cb = useRef({ onPhrase, count, now });
  cb.current = { onPhrase, count, now };

  useEffect(() => {
    const Impl = on ? recImpl() : undefined;
    if (!Impl) return;
    let stopped = false, rec: Rec | null = null;
    const stamps: number[] = [];
    const start = () => {
      rec = new Impl();
      rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
      rec.onresult = e => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i], text = res[0].transcript;
          const n = cb.current.count(text);
          while (stamps.length < n) stamps.push(cb.current.now());
          setHeard(text);
          if (res.isFinal) cb.current.onPhrase(text, stamps.splice(0));
        }
      };
      rec.onerror = e => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          stopped = true; setOn(false);
          setError('The microphone is blocked: allow it for this site in the browser settings (on iPhone, Siri must be on too).');
        }
      };
      rec.onend = () => { if (!stopped) setTimeout(() => { if (!stopped) start(); }, 250); };
      try { rec.start(); } catch { /* already started */ }
    };
    setError(''); setHeard('');
    start();
    return () => { stopped = true; rec?.abort(); };
  }, [on]);

  return { on, toggle: () => setOn(x => !x), heard, error };
}
