// The app's look: "classic" (the original) or "clean" (the redesign). Chosen per device in the account
// menu; the whole redesign hangs off <html data-ui="clean"> (see index.css), so classic is untouched.
import { useEffect, useState } from 'react';

export type UiTheme = 'classic' | 'clean';
const KEY = 'volleyrate.ui';
const DEFAULT: UiTheme = 'clean';

export function savedTheme(): UiTheme {
  try { const v = localStorage.getItem(KEY); if (v === 'classic' || v === 'clean') return v; } catch { /* storage blocked */ }
  return DEFAULT;
}

const listeners = new Set<(t: UiTheme) => void>();

export function applyTheme(t: UiTheme) {
  document.documentElement.dataset.ui = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'clean' ? '#0f1115' : '#0b1220');
}

export function setTheme(t: UiTheme) {
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked: still switch for this visit */ }
  applyTheme(t);
  listeners.forEach(f => f(t));
}

export function useTheme(): UiTheme {
  const [t, setT] = useState<UiTheme>(() => (document.documentElement.dataset.ui as UiTheme) || savedTheme());
  useEffect(() => { listeners.add(setT); return () => { listeners.delete(setT); }; }, []);
  return t;
}
