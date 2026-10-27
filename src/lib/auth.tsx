import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { Member } from './data';

interface AuthState {
  user: User | null;
  member: Member | null;      // null = signed in but not on the team list
  isAdmin: boolean;
  isGuest: boolean;    // not on the team list (signed out, or signed in without access): watches only
  name: string;        // first name to record on things this person does (never their email: games are public)
  isPlayer: boolean;   // players (and admins): everything except admin settings
  canEdit: boolean;    // players, admins and editors: review rallies and tag games
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null!);
/** Dev preview only: render signed-in screens with a stand-in user. */
export const AuthPreviewProvider = Ctx.Provider;
export const useAuth = () => useContext(Ctx);

// Home-screen apps and phones handle popups badly; use a full-page redirect there.
const preferRedirect = () =>
  matchMedia('(display-mode: standalone)').matches || /iPhone|iPad|Android/i.test(navigator.userAgent);

// SHA-256 of the owner emails (same hashes as isOwner() in firestore.rules; kept hashed so the repo doesn't publish them).
const OWNER_HASHES = new Set([
  '7d99c35cf45491553a917b4658ff4c2d36e7e3268b6886e47480ab41bb1ad19d',
  '225af8a3e6040d8d88b6d773d016a5ed74c673827a3454c337f43d7e3ff236b5',
]);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadMember(email: string): Promise<Member | null> {
  const ref = doc(db, 'members', email);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as Partial<Member>) : null;
  // Owners always get an admin record (created on first sign-in, repaired if it was overwritten).
  if (OWNER_HASHES.has(await sha256(email)) && data?.role !== 'admin') {
    await setDoc(ref, { role: 'admin', ...(data ? {} : { playerId: null }) }, { merge: true });
    return { email, playerId: data?.playerId ?? null, role: 'admin' };
  }
  return data ? { email, playerId: null, role: 'player', ...data } : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [member, setMemberState] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRedirectResult(auth).catch(e => setError(String(e.message || e)));
    return onAuthStateChanged(auth, async u => {
      setLoading(true);
      setUser(u);
      try {
        setMemberState(u?.email ? await loadMember(u.email.toLowerCase()) : null);
      } catch (e) {
        setError(String((e as Error).message || e));
        setMemberState(null);
      }
      setLoading(false);
    });
  }, []);

  // "last seen": stamp the team-list entry when the app opens or comes back to the front (at most every 30 min)
  useEffect(() => {
    const email = user?.email?.toLowerCase();
    if (!email || !member) return;
    const KEY = `volleyrate.lastSeen.${email}`;
    const stamp = () => {
      if (document.visibilityState !== 'visible') return;
      let last = 0;
      try { last = Number(localStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
      if (Date.now() - last < 30 * 60 * 1000) return;
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
      updateDoc(doc(db, 'members', email), { lastSeen: serverTimestamp() }).catch(() => {});
    };
    stamp();
    document.addEventListener('visibilitychange', stamp);
    return () => document.removeEventListener('visibilitychange', stamp);
  }, [user?.email, !!member]);  // eslint-disable-line react-hooks/exhaustive-deps

  const value: AuthState = {
    user, member, loading, error,
    isAdmin: member?.role === 'admin',
    isGuest: !member,
    name: (user?.displayName || user?.email || 'Someone').split(/[ @]/)[0],
    isPlayer: member?.role === 'admin' || member?.role === 'player',
    canEdit: member?.role === 'admin' || member?.role === 'player' || member?.role === 'editor',
    signIn: async () => {
      setError(null);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (preferRedirect()) return signInWithRedirect(auth, provider);
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'auth/popup-blocked') return signInWithRedirect(auth, provider);
        if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request')
          setError(String((e as Error).message || e));
      }
    },
    signOut: () => signOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
