import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import {
  approveRequest, cancelRequest, importRoster, importStartingRatings, useAccessRequests, saveRatings, savePlayer, setMember, slug, useMembers, usePlayers, type Member, type Player, type RosterRow,
} from '../lib/data';
import { CATEGORIES, POSITIONS, overall, type Position, type Ratings } from '../lib/ratings';
import { suggestTouches, useGames, type Game } from '../lib/games';
import { CAMERA_KINDS, cameras, type CameraKind } from '../lib/cameras';
import { buildModel, effectiveRatings, METRICS, DEFAULT_SETTINGS, type EngineSettings, type MetricKey } from '../lib/engine';
import { saveEngineSettings, useEngineSettings, useRatedPlayers } from '../lib/rated';
import { createBackup, restoreBackup, useBackups } from '../lib/backups';
import { Link } from 'react-router-dom';
import {
  activateModel, activeModelInfo, baseRows, evaluate, leaveOneOut, loadActiveModel, prob, resetModel, rowsFromGames, train,
  type Eval, type Model,
} from '../lib/training';

const card = 'rounded-xl border border-line bg-surface p-4';
const input = 'w-full rounded-lg border border-line bg-raised px-3 py-2 text-ink outline-none focus:border-ball';
const btn = 'rounded-lg bg-ball px-4 py-2 font-semibold text-bg disabled:opacity-40';

export function Admin() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<'ratings' | 'roster' | 'access' | 'detector'>(() => new URLSearchParams(location.search).get('tab') === 'access' ? 'access' : 'ratings');
  if (!isAdmin) return <p className="text-muted">Admins only.</p>;
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Admin</h1>
      <div className="mt-3 flex gap-1 rounded-xl bg-surface p-1">
        {(['ratings', 'roster', 'access', 'detector'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold capitalize ${tab === t ? 'bg-raised text-ink' : 'text-muted'}`}>
            {t === 'access' ? 'Access' : t}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'ratings' && <RatingsEditor />}
        {tab === 'roster' && <Roster />}
        {tab === 'access' && <Access />}
        {tab === 'detector' && <Detector />}
      </div>
    </div>
  );
}

function RatingsEditor() {
  const { user } = useAuth();
  const { players } = usePlayers();
  const games = useGames({ detector: true });
  const settings = useEngineSettings();
  const model = games ? buildModel(games, settings) : null;
  const [importMsg, setImportMsg] = useState('');
  const [id, setId] = useState('');
  const [draft, setDraft] = useState<Ratings>({});
  const [status, setStatus] = useState('');
  const p = players?.find(x => x.id === id);
  useEffect(() => { setDraft(p?.ratings ?? {}); setStatus(''); }, [id]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!players) return null;
  const pos = p?.positions[0] ?? 'OH';
  const ovr = overall(draft, pos);
  const live = p && model ? effectiveRatings({ ...p, ratings: draft }, model) : null;
  const liveOvr = live ? overall(live, pos) : null;
  const dirty = p && JSON.stringify(draft) !== JSON.stringify(p.ratings ?? {});

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="font-semibold">Starting ratings</h2>
        <p className="mt-1 text-sm text-muted">
          These are each player's starting point. What everyone sees = starting rating + changes from tagged games
          (Spiking, Serving, Setting, Receiving, Blocking, Consistency). Game Intelligence, Physical and Technique only
          change here.
        </p>
        <label className={`${btn} mt-3 inline-block cursor-pointer`}>
          Import starting ratings file
          <input type="file" accept=".json,application/json" className="hidden" onChange={async e => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const data = JSON.parse(await f.text());
              await createBackup('Before importing starting ratings', user?.email ?? '', players, settings, games ?? []);
              const n = await importStartingRatings(data.players ?? data, players);
              setImportMsg(`Set starting ratings for ${n} players (previous ratings backed up).`);
            } catch (err) { setImportMsg('Import failed: ' + (err as Error).message); }
          }} />
        </label>
        {importMsg && <p className="mt-2 text-sm text-muted">{importMsg}</p>}
      </section>

      <PendingGames />
      <Sensitivity saved={settings} />
      <Backups />

      <select className={input} value={id} onChange={e => setId(e.target.value)}>
        <option value="">Choose a player…</option>
        {players.map(x => <option key={x.id} value={x.id}>{x.name}{x.number !== null ? ` #${x.number}` : ''}</option>)}
      </select>
      {p && (
        <>
          <div className={`${card} flex items-center justify-between`}>
            <div>
              <div className="text-sm text-muted">Starting overall as {POSITIONS[pos]}</div>
              <div className="font-display text-4xl font-bold">{ovr ?? 'NR'}
                {liveOvr !== null && liveOvr !== ovr && <span className="ml-2 text-base font-normal text-muted">→ {liveOvr} now (stats + experience)</span>}
              </div>
            </div>
            <button className={btn} disabled={!dirty}
              onClick={async () => {
                setStatus('Saving…');
                await createBackup(`Before editing ${p.name}'s starting ratings`, user?.email ?? '', players, settings, games ?? []);
                await saveRatings(p.id, draft); setStatus('Saved');
              }}>
              Save
            </button>
          </div>
          {status && <p className="text-sm text-muted">{status}</p>}
          {[...CATEGORIES.filter(c => c.attrs.length > 1).map(c => ({ key: c.key, label: c.label, attrs: c.attrs as readonly (readonly [string, string])[] })),
            { key: 'single', label: 'Consistency · Physical · Technique',
              attrs: CATEGORIES.filter(c => c.attrs.length === 1).map(c => c.attrs[0] as readonly [string, string]) }].map(c => (
            <section key={c.key} className={card}>
              <h2 className="mb-2 font-display text-lg font-semibold">{c.label}</h2>
              {c.attrs.map(([k, label]) => {
                const v = draft[k];
                return (
                  <div key={k} className="py-1.5">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-muted">{label}</span>
                      <span className="flex items-center gap-2">
                        {live && typeof v === 'number' && live[k] !== v && (
                          <span className="text-xs text-muted">→ {live[k]} now{k in METRICS ? ` (${Math.round(model?.adj[p.id]?.[k as MetricKey]?.rawAttempts ?? 0)} tries)` : ''}</span>
                        )}
                        <span className="w-8 text-right font-display text-lg font-bold tabular-nums">{v ?? '–'}</span>
                        {v !== undefined && (
                          <button className="text-xs text-muted underline"
                            onClick={() => { const d = { ...draft }; delete d[k]; setDraft(d); }}>clear</button>
                        )}
                      </span>
                    </div>
                    <input type="range" min={25} max={99} value={v ?? 60}
                      className={`w-full accent-[#f5c518] ${v === undefined ? 'opacity-40' : ''}`}
                      onChange={e => setDraft({ ...draft, [k]: Number(e.target.value) })} />
                  </div>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

const POS_NAMES: Record<string, Position> = {
  setter: 'S', 'outside hitter': 'OH', outside: 'OH', 'opposite hitter': 'OPP', opposite: 'OPP',
  'middle blocker': 'MB', middle: 'MB', libero: 'L', s: 'S', oh: 'OH', opp: 'OPP', mb: 'MB', l: 'L',
};

function Roster() {
  const { players } = usePlayers();
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name: '', number: '', positions: [] as Position[] });

  async function onFile(f: File) {
    try {
      const rows = JSON.parse(await f.text()) as Array<RosterRow & { positions: string[] }>;
      const clean: RosterRow[] = rows.map(r => ({
        ...r,
        positions: r.positions.map(x => POS_NAMES[x.toLowerCase()] ?? x).filter((x): x is Position => x in POSITIONS),
      }));
      await importRoster(clean);
      setMsg(`Imported ${clean.length} players (existing ratings kept).`);
    } catch (e) {
      setMsg('Import failed: ' + (e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="font-semibold">Import roster</h2>
        <p className="mt-1 text-sm text-muted">
          A JSON list of players: name, number, positions and Google email. Adds team access for each email too.
        </p>
        <label className={`${btn} mt-3 inline-block cursor-pointer`}>
          Choose file
          <input type="file" accept=".json,application/json" className="hidden"
            onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      </section>

      <section className={card}>
        <h2 className="font-semibold">Add a player</h2>
        <div className="mt-3 grid grid-cols-[1fr_5rem] gap-2">
          <input className={input} placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className={input} placeholder="#" inputMode="numeric" value={form.number}
            onChange={e => setForm({ ...form, number: e.target.value.replace(/\D/g, '') })} />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(POSITIONS) as Position[]).map(k => {
            const i = form.positions.indexOf(k);
            return (
              <button key={k}
                onClick={() => setForm({ ...form, positions: i >= 0 ? form.positions.filter(x => x !== k) : [...form.positions, k] })}
                className={`rounded-full border px-3 py-1 text-sm ${i >= 0 ? 'border-ball bg-ball text-bg' : 'border-line text-muted'}`}>
                {k}{i >= 0 ? ` ${i + 1}` : ''}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted">Tap positions in order: primary first.</p>
        <button className={`${btn} mt-3`} disabled={!form.name.trim() || !form.positions.length}
          onClick={async () => {
            await savePlayer({ id: slug(form.name), name: form.name.trim(), number: form.number ? Number(form.number) : null, positions: form.positions });
            setForm({ name: '', number: '', positions: [] });
          }}>
          Add player
        </button>
      </section>

      <section className={card}>
        <h2 className="font-semibold">Roster ({players?.length ?? 0})</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {players?.map(x => (
            <li key={x.id} className="flex justify-between py-2">
              <span>{x.name}{x.number !== null && <span className="text-muted"> #{x.number}</span>}</span>
              <span className="text-muted">{x.positions.join(' / ')}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** "5 min ago", "3 h ago", "yesterday", "12 Oct". */
function ago(d: Date): string {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  if (m < 48 * 60) return 'yesterday';
  if (m < 7 * 24 * 60) return `${Math.round(m / 1440)} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const ROLES: { k: Member['role']; label: string; what: string }[] = [
  { k: 'viewer', label: 'Viewer', what: 'like a guest, but signed in (also sees highlights); changes nothing' },
  { k: 'editor', label: 'Editor', what: 'a viewer who also reviews rallies and tags games' },
  { k: 'player', label: 'Player', what: 'everything except admin settings (adds games, highlights, photos)' },
  { k: 'admin', label: 'Admin', what: 'everything, including ratings and access' },
];

/** People who signed in and asked to help: approve with a role (and their player), or dismiss. */
function Requests() {
  const { players } = usePlayers();
  const list = useAccessRequests(true);
  const [pick, setPick] = useState<Record<string, { role: Member['role']; pid: string }>>({});
  if (!list.length) return null;
  return (
    <section className={`${card} border-ball/50`}>
      <h2 className="font-semibold">Asking for access ({list.length})</h2>
      <ul className="mt-2 divide-y divide-line text-sm">
        {list.map(r => {
          const c = pick[r.email] ?? { role: r.want, pid: r.playerId ?? '' };
          const set = (x: Partial<typeof c>) => setPick(p => ({ ...p, [r.email]: { ...c, ...x } }));
          return (
            <li key={r.email} className="space-y-2 py-3">
              <div>
                <b>{r.name}</b> <span className="text-muted">· {r.email}</span>
                <div className="text-xs text-muted">
                  Wants to be {r.want === 'player' ? `a player${r.playerId ? ` (says they're ${players?.find(p => p.id === r.playerId)?.name ?? r.playerId})` : ''}` : 'an editor'}
                  {r.at ? ` · ${r.at.toDate().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
                </div>
                {r.note && <p className="mt-1 text-xs">“{r.note}”</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <select className="rounded-md border border-line bg-raised px-2 py-1" value={c.role} onChange={e => set({ role: e.target.value as Member['role'] })}>
                  {ROLES.filter(x => x.k !== 'admin').map(x => <option key={x.k} value={x.k}>{x.label}</option>)}
                </select>
                <select className="rounded-md border border-line bg-raised px-2 py-1" value={c.pid} onChange={e => set({ pid: e.target.value })}>
                  <option value="">Not linked to a player</option>
                  {players?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button className="rounded-md bg-ball px-3 py-1 font-semibold text-bg" onClick={() => approveRequest(r, c.role, c.pid || null)}>Approve</button>
                <button className="rounded-md border border-line px-3 py-1 text-muted" onClick={() => { if (confirm(`Dismiss ${r.name}'s request? They can still watch as a guest.`)) cancelRequest(r.email); }}>Dismiss</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Access() {
  const { players } = usePlayers();
  const members = useMembers(true);
  const [email, setEmail] = useState('');
  const [pid, setPid] = useState('');
  const [role, setRole] = useState<Member['role'] | ''>('');  // '' = by link: player if linked, else viewer
  const name = (p: Player | undefined) => p?.name ?? '—';
  const newRole: Member['role'] = role || (pid ? 'player' : 'editor');

  return (
    <div className="space-y-4">
      <Requests />
      <section className={card}>
        <h2 className="font-semibold">Give someone access</h2>
        <p className="mt-1 text-sm text-muted">Anyone can watch as a guest without signing in. People who sign in and ask for access show up above; you can also add an account here.</p>
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {ROLES.map(r => <li key={r.k}><b className="text-ink">{r.label}</b>: {r.what}</li>)}
        </ul>
        <input className={`${input} mt-3`} type="email" placeholder="name@gmail.com" value={email}
          onChange={e => setEmail(e.target.value)} />
        <select className={`${input} mt-2`} value={pid} onChange={e => setPid(e.target.value)}>
          <option value="">Not linked to a player</option>
          {players?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className={`${input} mt-2`} value={role} onChange={e => setRole(e.target.value as Member['role'] | '')}>
          <option value="">Role: {pid ? 'Player' : 'Editor'} (default)</option>
          {ROLES.map(r => <option key={r.k} value={r.k}>Role: {r.label}</option>)}
        </select>
        <button className={`${btn} mt-3`} disabled={!/^\S+@\S+\.\S+$/.test(email)}
          onClick={async () => { await setMember(email, pid || null, newRole); setEmail(''); setPid(''); setRole(''); }}>
          Add
        </button>
      </section>
      <section className={card}>
        <h2 className="font-semibold">Team list ({members.length})</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {members.map(m => (
            <li key={m.email} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{m.email}</span>
                <span className="block text-[11px] text-muted">{m.lastSeen ? `last seen ${ago(m.lastSeen.toDate())}` : 'not seen since last seen was added'}</span>
              </span>
              <select className={`rounded-md border px-2 py-1 text-sm ${m.role === 'admin' ? 'border-ball/50 bg-ball/10 text-ball' : 'border-line bg-raised'}`}
                value={m.role} aria-label="Role"
                onChange={e => { const r = e.target.value as Member['role']; if (r !== 'admin' || confirm(`Make ${m.email} an admin? Admins can change everything, including ratings and who has access.`)) setMember(m.email, m.playerId, r); }}>
                {ROLES.map(r => <option key={r.k} value={r.k}>{r.label}</option>)}
              </select>
              <select className="rounded-md border border-line bg-raised px-2 py-1 text-sm" value={m.playerId ?? ''}
                onChange={e => setMember(m.email, e.target.value || null)}>
                <option value="">—</option>
                {players?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="sr-only">{name(players?.find(p => p.id === m.playerId))}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function pct(n: number, d: number) { return d ? `${Math.round((100 * n) / d)}%` : '–'; }

function EvalRow({ label, e }: { label: string; e: Eval }) {
  const kept = e.realKept + e.falseKept;
  return (
    <tr className="border-t border-line">
      <td className="py-2 pr-2">{label}</td>
      <td className="py-2 text-right tabular-nums">{pct(e.realKept, e.real)}</td>
      <td className="py-2 text-right tabular-nums">{pct(e.falseKept, kept)}</td>
    </tr>
  );
}

function Detector() {
  const { user } = useAuth();
  const games = useGames({ detector: true });
  const [kind, setKind] = useState<CameraKind>('side');  // each kind of camera has its own detector
  const [info, setInfo] = useState<Awaited<ReturnType<typeof activeModelInfo>>>(null);
  const [res, setRes] = useState<{ model: Model; n: number; cur: Eval; next: Eval } | null>(null);
  const [busy, setBusy] = useState('');
  const [base, setBase] = useState(0);
  useEffect(() => { activeModelInfo(kind).then(setInfo); baseRows(kind).then(r => setBase(r.length)); setRes(null); }, [kind]);
  if (!games) return null;
  const reviewed = games.filter(g => g.reviewed);
  const usable = reviewed.filter(g => cameras(g).some(c => c.kind === kind && c.segments?.length));
  const fresh = rowsFromGames(games, kind);

  async function run() {
    setBusy('Training…'); setRes(null);
    await new Promise(r => setTimeout(r, 30));
    const rows = [...(await baseRows(kind)), ...fresh];
    const current = await loadActiveModel(kind);
    const cur = evaluate(rows, r => (current ? prob(r.f, current) : 1));
    const next = leaveOneOut(rows);
    setRes({ model: train(rows), n: rows.length, cur, next });
    setBusy('');
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-surface p-1">
        {(Object.keys(CAMERA_KINDS) as CameraKind[]).map(k => (
          <button key={k} onClick={() => setKind(k)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold ${kind === k ? 'bg-raised text-ink' : 'text-muted'}`}>
            {CAMERA_KINDS[k].label} camera
          </button>
        ))}
      </div>
      <section className={card}>
        <h2 className="font-semibold">Improve the {CAMERA_KINDS[kind].label.toLowerCase()} camera's rally detector</h2>
        <p className="mt-1 text-sm text-muted">
          Retrains the part of the detector that decides which ball flights are real rallies, using every game
          that's been reviewed (Finish review). Fewer false clips is what improves; rallies the ball tracker never
          noticed can't be learned this way.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          <li>Reviewed games: <b>{reviewed.length}</b> ({usable.length} with detector data; games added before this
            update don't have it)</li>
          <li>New training examples: <b>{fresh.length}</b> ({fresh.filter(r => r.y).length} real,{' '}
            {fresh.filter(r => !r.y).length} false){base ? `, plus ${base} from the original lab review` : ''}</li>
          <li>Model in use: <b>{info?.trainedAt && info.n ? `retrained ${info.trainedAt.toLocaleDateString()} on ${info.n} examples`
            : kind === 'side' ? 'original (lab)' : 'none yet: keeps every candidate clip'}</b></li>
        </ul>
        <button className={`${btn} mt-4`} onClick={run}
          disabled={!!busy || !fresh.length || (!base && !(fresh.some(r => r.y) && fresh.some(r => !r.y)))}>{busy || 'Train new model'}</button>
        {!fresh.length && <p className="mt-2 text-xs text-muted">
          {kind === 'side' ? 'Review a newly added game first.'
            : 'Add a game with this camera (or add it as an extra camera to a game) using its original video file, then review the game.'}
        </p>}
        {kind !== 'side' && (
          <p className="mt-2 text-xs text-muted">
            Reviewing a game once is enough: an extra camera shares the game's rallies, so its clips are labelled automatically.
            Retraining this camera never changes the side camera's detector.
          </p>
        )}
      </section>

      {res && (
        <section className={card}>
          <h2 className="font-semibold">Result ({res.n} examples)</h2>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-muted">
              <th className="text-left font-normal">Model</th>
              <th className="text-right font-normal">Real rallies kept</th>
              <th className="text-right font-normal">Clips that are false</th>
            </tr></thead>
            <tbody>
              <EvalRow label="Current" e={res.cur} />
              <EvalRow label="New (fair test)" e={res.next} />
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            "Fair test" scores each example with a model trained without it. The current model has seen some of these
            examples before, so its numbers are a little flattering. Use the new one if it keeps about as many real
            rallies and lets through fewer false clips.
          </p>
          <div className="mt-3 flex gap-2">
            <button className={btn} disabled={!!busy}
              onClick={async () => { setBusy('Saving…'); await activateModel(res.model, res.n, user?.email ?? '', kind); setInfo(await activeModelInfo(kind)); setRes(null); setBusy(''); }}>
              Use new model
            </button>
            <button className="rounded-lg border border-line px-4 py-2 text-sm" onClick={() => setRes(null)}>Discard</button>
          </div>
        </section>
      )}

      <TouchSuggestionScore games={games} />

      {info?.n ? (
        <button className="text-sm text-muted underline"
          onClick={async () => { if (confirm(`Go back to the ${kind === 'side' ? 'original' : 'untrained'} ${CAMERA_KINDS[kind].label.toLowerCase()} detector?`)) { await resetModel(kind); setInfo(await activeModelInfo(kind)); } }}>
          Reset to the {kind === 'side' ? 'original' : 'untrained'} model
        </button>
      ) : null}
    </div>
  );
}

/** How well suggested touch moments match what people actually tagged (fully tagged rallies only). */
function TouchSuggestionScore({ games }: { games: Game[] }) {
  let kept = 0, skipped = 0, manual = 0, rallies = 0;
  for (const g of games) {
    if (!g.peaks?.length) continue;
    for (const r of g.rallies) {
      if (r.st === 'bad' || !r.end || !r.touches?.length) continue;
      rallies++;
      const sugs = suggestTouches(g.peaks, r.s, r.e);
      const hit = (t: number) => sugs.some(x => Math.abs(x - t) < 0.15);
      const k = r.touches.filter(t => hit(t.t)).length;
      kept += k; manual += r.touches.length - k; skipped += r.sk?.length ?? 0;
    }
  }
  return (
    <section className={card}>
      <h2 className="font-semibold">Suggested touches</h2>
      {rallies ? (
        <>
          <p className="mt-1 text-sm text-muted">From {rallies} fully tagged rallies in games with touch suggestions.</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-raised/50 py-2"><div className="font-display text-xl font-bold text-good">{pct(kept, kept + skipped)}</div><div className="text-xs text-muted">suggestions that were real ({kept}/{kept + skipped})</div></div>
            <div className="rounded-lg bg-raised/50 py-2"><div className="font-display text-xl font-bold">{pct(kept, kept + manual)}</div><div className="text-xs text-muted">touches it found ({kept}/{kept + manual})</div></div>
            <div className="rounded-lg bg-raised/50 py-2"><div className="font-display text-xl font-bold text-bad">{manual}</div><div className="text-xs text-muted">touches added by hand</div></div>
          </div>
        </>
      ) : <p className="mt-1 text-sm text-muted">No data yet: tag a few rallies with suggestions turned on.</p>}
    </section>
  );
}

/** Sliders for how strongly stats move ratings, with a live preview of every player's overall. */
function Sensitivity({ saved }: { saved: EngineSettings }) {
  const { user } = useAuth();
  const { players: raw } = usePlayers();
  const allGames = useGames({ detector: true });
  const [s, setS] = useState<EngineSettings>(saved);
  const [msg, setMsg] = useState('');
  useEffect(() => { setS(saved); }, [JSON.stringify(saved)]);  // eslint-disable-line react-hooks/exhaustive-deps
  const { players } = useRatedPlayers(s);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const rows = (players ?? []).map(p => {
    const pos = p.positions[0] ?? 'OH';
    return { p, start: overall(p.base, pos), now: overall(p.ratings, pos) };
  }).sort((a, b) => (b.now ?? 0) - (a.now ?? 0));
  const half = Math.round(25 * s.dataScale);
  return (
    <section className={card}>
      <h2 className="font-semibold">How strongly stats move ratings</h2>
      <label className="mt-3 block text-sm">
        <div className="flex justify-between"><span>Strength</span><b>{s.strength.toFixed(1)}×</b></div>
        <input type="range" min={0.5} max={4} step={0.1} value={s.strength} className="w-full accent-[#f5c518]"
          onChange={e => setS({ ...s, strength: Number(e.target.value) })} />
        <span className="text-xs text-muted">Rating points per stat difference (1.0× = the original Standard).</span>
      </label>
      <label className="mt-3 block text-sm">
        <div className="flex justify-between"><span>Data needed</span><b>{half} attempts = half weight</b></div>
        <input type="range" min={0.1} max={1.5} step={0.05} value={s.dataScale} className="w-full accent-[#f5c518]"
          onChange={e => setS({ ...s, dataScale: Number(e.target.value) })} />
        <span className="text-xs text-muted">Lower = ratings react to fewer attempts (faster, but noisier).</span>
      </label>
      <label className="mt-3 block text-sm">
        <div className="flex justify-between"><span>Experience per game played</span><b>+{s.expPerGame.toFixed(2)}</b></div>
        <input type="range" min={0} max={4} step={0.25} value={s.expPerGame} className="w-full accent-[#f5c518]"
          onChange={e => setS({ ...s, expPerGame: Number(e.target.value) })} />
        <span className="text-xs text-muted">Added to every attribute for each tagged game a player is in, so everyone improves over time.</span>
      </label>
      <label className="mt-3 block text-sm">
        <div className="flex justify-between"><span>Maximum experience bonus</span><b>+{s.expMax}</b></div>
        <input type="range" min={0} max={40} step={1} value={s.expMax} className="w-full accent-[#f5c518]"
          onChange={e => setS({ ...s, expMax: Number(e.target.value) })} />
        <span className="text-xs text-muted">Reached after {s.expPerGame ? Math.ceil(s.expMax / s.expPerGame) : '∞'} games.</span>
      </label>
      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-muted"><tr>
            <th className="px-2 py-1 text-left font-normal">Player</th>
            <th className="px-2 py-1 text-right font-normal">Start</th>
            <th className="px-2 py-1 text-right font-normal">With stats</th>
          </tr></thead>
          <tbody>
            {rows.map(({ p, start, now }) => {
              const d = start !== null && now !== null ? now - start : 0;
              return (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-2 py-1">{p.name} <span className="text-xs text-muted">{p.positions[0]}</span></td>
                  <td className="px-2 py-1 text-right tabular-nums">{start ?? '–'}</td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">{now ?? '–'}
                    {d !== 0 && <span className={`ml-1 text-xs ${d > 0 ? 'text-good' : 'text-bad'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btn} disabled={!dirty} onClick={async () => {
          await createBackup('Before changing rating strength settings', user?.email ?? '', raw ?? [], saved, allGames ?? []);
          await saveEngineSettings(s); setMsg('Saved: everyone now sees these ratings.');
        }}>Save</button>
        <button className="rounded-lg border border-line px-3 py-2 text-sm" onClick={() => setS(DEFAULT_SETTINGS)}>Recommended</button>
        <button className="rounded-lg border border-line px-3 py-2 text-sm" onClick={() => setS({ ...s, strength: 1, dataScale: 1 })}>Original standard</button>
      </div>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </section>
  );
}

/** Tagged games whose stats don't count yet. */
function PendingGames() {
  const games = useGames({ detector: true });
  const pending = (games ?? []).filter(g => g.rating && !g.rating.applied && g.rallies.some(r => r.touches?.length && r.end));
  if (!pending.length) return null;
  return (
    <section className={`${card} border-ball/40`}>
      <h2 className="font-semibold">Games waiting to be applied ({pending.length})</h2>
      <p className="mt-1 text-sm text-muted">Their stats don't count yet. Open a game → Box score to see the changes and apply.</p>
      <ul className="mt-2 divide-y divide-line text-sm">
        {pending.map(g => (
          <li key={g.id}><Link to={`/games/${g.id}?box=1`} className="flex justify-between py-2">
            <span>{g.title} <span className="text-muted">· {g.date}</span></span><span className="text-ball">Review →</span>
          </Link></li>
        ))}
      </ul>
    </section>
  );
}

function Backups() {
  const { user } = useAuth();
  const list = useBackups(true);
  const { players } = usePlayers();
  const games = useGames({ detector: true });
  const settings = useEngineSettings();
  const [msg, setMsg] = useState('');
  const fmt = (d?: Date) => d ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '…';
  return (
    <section className={card}>
      <h2 className="font-semibold">Backups</h2>
      <p className="mt-1 text-sm text-muted">
        Saved automatically before any change to ratings (imports, edits, strength settings, applying games). Restoring
        puts back the starting ratings, strength settings and which games count, after backing up the current state.
      </p>
      <button className={`${btn} mt-3`} onClick={async () => {
        await createBackup('Manual backup', user?.email ?? '', players ?? [], settings, games ?? []); setMsg('Backup saved.');
      }}>Back up now</button>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto text-sm">
        {list.map(b => (
          <li key={b.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{b.label}</span>
              <span className="text-xs text-muted">{fmt(b.at?.toDate())} · {Object.keys(b.players).length} players</span>
            </span>
            <button className="rounded-md border border-line px-2 py-1 text-xs" onClick={async () => {
              if (!confirm(`Restore "${b.label}"? Current ratings will be backed up first.`)) return;
              await createBackup(`Before restoring "${b.label}"`, user?.email ?? '', players ?? [], settings, games ?? []);
              await restoreBackup(b, games ?? []);
              setMsg(`Restored "${b.label}".`);
            }}>Restore</button>
          </li>
        ))}
        {!list.length && <li className="py-2 text-muted">No backups yet.</li>}
      </ul>
    </section>
  );
}
