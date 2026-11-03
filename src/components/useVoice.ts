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
    let lang = navigator.language || 'en-US';
    let continuous = true;
    let quick = 0, lastError = '';  // sessions that ended at once with nothing heard: something's wrong, don't loop
    const stamps: number[] = [];
    const fail = (msg: string) => { stopped = true; setOn(false); setError(msg); rec?.abort(); };
    const start = () => {
      const began = Date.now();
      let got = false;
      rec = new Impl();
      rec.continuous = continuous; rec.interimResults = true; rec.lang = lang;
      rec.onresult = e => {
        got = true; quick = 0;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i], text = res[0].transcript;
          const n = cb.current.count(text);
          while (stamps.length < n) stamps.push(cb.current.now());
          setHeard(text);
          if (res.isFinal) cb.current.onPhrase(text, stamps.splice(0));
        }
      };
      rec.onerror = e => {
        lastError = e.error;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
          fail('The microphone is blocked: allow it for this site in the browser settings (on a Mac also System Settings → Privacy → Microphone; on iPhone, Siri must be on too).');
        else if (e.error === 'audio-capture') fail('No microphone found. Plug one in or check the input in System Settings → Sound.');
        else if (e.error === 'language-not-supported' && lang !== 'en-US') lang = 'en-US';  // e.g. en-SG: retry in US English
        else if (e.error === 'network') fail("This browser can't reach its speech service. Use Chrome or Safari (Brave, Arc and some others don't include it), and check the internet connection.");
      };
      rec.onend = () => {
        if (stopped) return;
        stamps.length = 0;
        if (!got && Date.now() - began < 1500) {
          quick++;
          if (quick === 2) continuous = false;  // Safari can be fussy about continuous listening: one phrase at a time instead
          if (quick >= 4) { fail(`Speech recognition keeps stopping straight away${lastError ? ` (${lastError})` : ''}. Try Chrome or Safari, or send the admin what this says.`); return; }
        }
        setTimeout(() => { if (!stopped) start(); }, quick ? 600 : 150);
      };
      try { rec.start(); } catch { /* already started */ }
    };
    setError(''); setHeard('');
    start();
    return () => { stopped = true; rec?.abort(); };
  }, [on]);

  return { on, toggle: () => setOn(x => !x), heard, error };
}
