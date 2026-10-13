// Things you can do with one rally, from the game page or a playlist: save it as a highlight, or share a link to it.
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { addHighlight } from '../lib/highlights';
import { fmtTime, logHistory, type Game } from '../lib/games';
import type { Player } from '../lib/data';

/** Save a whole rally as a highlight on a player's profile. */
export function HighlightDialog({ game, rally, players, onClose, forPlayer }: {
  game: Pick<Game, 'id' | 'youtubeId' | 'title' | 'date'>; rally: { s: number; e: number }; players: Pick<Player, 'id' | 'name'>[];
  onClose: () => void; forPlayer?: string;  // who it's for by default (else whoever is signed in)
}) {
  const auth = useAuth();
  const mine = auth?.member?.playerId ?? '';
  const [pid, setPid] = useState(forPlayer || mine || players[0]?.id || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pid) return;
    setBusy(true);
    const user = auth?.user;
    await addHighlight({
      playerId: pid, gameId: game.id, youtubeId: game.youtubeId, title: game.title, date: game.date,
      s: rally.s, e: rally.e, note: note.trim(),
      by: (user?.email ?? '').toLowerCase(), byName: user?.displayName ?? user?.email ?? '',
    });
    const who = players.find(p => p.id === pid)?.name ?? pid;
    logHistory(game.id, user ?? null, [`Rally ${fmtTime(rally.s)}: saved as a highlight for ${who}${note.trim() ? ` ("${note.trim()}")` : ''}`]).catch(() => {});
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl border border-line bg-surface p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold">★ Save highlight</h2>
        <p className="mt-1 text-sm text-muted">The whole rally ({fmtTime(rally.s)}–{fmtTime(rally.e)}) goes on this player's profile.</p>
        <label className="mt-3 block text-sm">For
          <select value={pid} onChange={e => setPid(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-ink outline-none focus:border-ball">
            {players.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === mine ? ' (me)' : ''}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-sm">Note (optional)
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={80} placeholder="e.g. cross-court kill off the block"
            className="mt-1 w-full rounded-lg border border-line bg-raised px-3 py-2 text-ink outline-none focus:border-ball" />
        </label>
        <div className="mt-4 flex gap-2">
          <button onClick={save} disabled={busy || !pid} className="flex-1 rounded-lg bg-ball py-2.5 font-semibold text-bg disabled:opacity-40">
            {busy ? 'Saving…' : 'Save highlight'}
          </button>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2.5">Cancel</button>
        </div>
      </div>
    </div>
  );
}


/** Share a link that opens the game and plays this rally (people still sign in to watch). */
export function ShareRally({ gameId, rally, title }: { gameId: string; rally: { s: number }; title: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${location.origin}/games/${gameId}?t=${rally.s}&r=${rally.s}`;
    // phones: the share sheet (WhatsApp, Telegram, …); computers: copy the link
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title, text: title, url }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); } catch { prompt('Copy this link', url); return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={share} className="rounded-md border border-line px-2 py-0.5 text-xs font-semibold text-ink">
      {copied ? '✓ Link copied' : '↗ Share'}
    </button>
  );
}
