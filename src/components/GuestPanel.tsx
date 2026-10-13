// Home, for people who aren't on the team list: sign in, then ask an admin to be an editor or a player.
// Admins see who's waiting.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { cancelRequest, requestAccess, useAccessRequests, useMyRequest, usePlayers } from '../lib/data';

const box = 'rounded-xl border border-line bg-surface p-4 text-sm';

export function GuestPanel() {
  const { user, isGuest, isAdmin, signIn, error } = useAuth();
  const mine = useMyRequest(isGuest ? user?.email : null);
  const waiting = useAccessRequests(isAdmin);
  if (isAdmin && waiting.length) return (
    <Link to="/admin?tab=access" className={`${box} block border-ball/50`}>
      <b className="text-ball">{waiting.length} {waiting.length === 1 ? 'person wants' : 'people want'} access</b>
      <span className="text-muted">: {waiting.map(r => r.name).join(', ')}. Review in Admin → Access →</span>
    </Link>
  );
  if (!isGuest) return null;
  if (!user) return (
    <div className={box}>
      <p><b>You're watching as a guest.</b> <span className="text-muted">Games, ratings and stats are all open.</span></p>
      <p className="mt-1 text-muted">On the team, or want to help review and tag games? Sign in with Google and ask for access.</p>
      <button onClick={signIn} className="mt-3 rounded-lg bg-ink px-4 py-2 font-semibold text-bg">Sign in with Google</button>
      {error && <p className="mt-2 text-bad">{error}</p>}
    </div>
  );
  if (mine === undefined) return null;
  if (mine) return (
    <div className={box}>
      <p><b>Request sent</b> <span className="text-muted">to be {mine.want === 'player' ? 'a player' : 'an editor'}. An admin will see it next time they open the app; until then you can watch as a guest.</span></p>
      <button onClick={() => cancelRequest(user.email!)} className="mt-2 text-xs text-muted underline">Cancel request</button>
    </div>
  );
  return <RequestForm email={user.email!} name={user.displayName ?? user.email!.split('@')[0]} />;
}

function RequestForm({ email, name }: { email: string; name: string }) {
  const { players } = usePlayers();
  const { signOut } = useAuth();
  const [want, setWant] = useState<'player' | 'editor'>('player');
  const [pid, setPid] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    try { await requestAccess(email, { name, want, ...(want === 'player' && pid ? { playerId: pid } : {}), ...(note.trim() ? { note: note.trim() } : {}) }); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const seg = (on: boolean) => `flex-1 rounded-md py-1.5 ${on ? 'bg-ball font-semibold text-bg' : 'text-muted'}`;
  return (
    <div className={`${box} space-y-3`}>
      <div>
        <p><b>Ask for access</b></p>
        <p className="text-muted">Signed in as {email}. You can watch as a guest now; an admin decides the rest.</p>
      </div>
      <div className="flex rounded-lg bg-raised p-0.5">
        <button className={seg(want === 'player')} onClick={() => setWant('player')}>I'm a player</button>
        <button className={seg(want === 'editor')} onClick={() => setWant('editor')}>I want to help review and tag</button>
      </div>
      {want === 'player' && (
        <select value={pid} onChange={e => setPid(e.target.value)} className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-ink">
          <option value="">Which player are you?</option>
          {players?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="A note for the admin (optional)"
        className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-ink" />
      <div className="flex gap-2">
        <button disabled={busy} onClick={send} className="flex-1 rounded-lg bg-ball py-2 font-semibold text-bg disabled:opacity-50">{busy ? 'Sending…' : 'Send request'}</button>
        <button onClick={signOut} className="rounded-lg border border-line px-3 py-2">Sign out</button>
      </div>
      {err && <p className="text-bad">{err}</p>}
    </div>
  );
}
