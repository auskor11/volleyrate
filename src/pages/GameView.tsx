import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { usePlayers, type Player } from '../lib/data';
import {
  ATTACK_TYPES, DEFAULT_SET_GRADE, GRADED, GRADE_LABELS, SKILLS, guestName, guestTeam, isGuest, deleteGame, fmtTime, isTagged, nextSkill, rallyResult, saveRallies, suggestTouches,
  updateGame, useGame, type AttackType, type Game, type SameTeam, type Grade, type Rally, type RallyEnd, type Skill, type Touch,
} from '../lib/games';
import { createPlayer, withOffset, type YTPlayer } from '../lib/youtube';
import { cameraLabel, cameras, serveGuesses } from '../lib/cameras';
import { AddCamera } from '../components/AddCamera';
import { RefreshDetector } from '../components/RefreshDetector';
import { avgGrade, computeStats, sameTeamIn, type StatKey } from '../lib/stats';
import { buildModel, effectiveRatings, type RatingModel } from '../lib/engine';
import { useEngineSettings } from '../lib/rated';
import { createBackup } from '../lib/backups';
import { CATEGORIES, overall } from '../lib/ratings';
import { logHistory, setGameRating, useGames, useHistory } from '../lib/games';
import { useHighlights } from '../lib/highlights';
import { detectorSupported, runDetector } from '../lib/detector';
import {
  BACK_COURT_PLAYERS, ROLE_NAMES, TEAMS, assignMiddles, courtFor, guestServes, likelyLibero, sameCourt, courtOnly, emptySide, gameSetup, makeServer, rallyWinner, rolesAt, rotationOf,
  scoreSheet, server, setupReady, startCourt,
  type CourtSetup, type CourtState, type CourtView, type Team,
} from '../lib/rotation';
import { HighlightDialog, ShareRally } from '../components/RallyActions';
import { AutoplaySwitch, useAutoplay } from '../components/ClipReel';
import { Avatar } from '../components/Avatar';
import { MatchCard } from '../components/MatchCard';
import { matchRatings } from '../lib/gameRating';
import { Court } from '../components/Court';

const STATUS: Record<Rally['st'], { label: string; cls: string }> = {
  auto: { label: 'unchecked', cls: 'bg-line text-muted' },
  ok: { label: '✓ ok', cls: 'bg-good/20 text-good' },
  bad: { label: '✗ not a rally', cls: 'bg-bad/20 text-bad' },
  added: { label: '+ added', cls: 'bg-court/25 text-sky-300' },
};

// every gap between rallies is listed in Review mode (that's where missed rallies hide)
const GAP_MIN = 1;

/** "1:30", "90", "1:02:03" -> seconds */
export function parseTime(s: string): number | null {
  const parts = s.trim().split(':');
  if (!parts.every(p => /^\d+(\.\d+)?$/.test(p)) || parts.length > 3) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

function TimeBar({ clock, onSeek, onSkip }: { clock: number; onSeek: (t: number) => void; onSkip: (d: number) => void }) {
  const [text, setText] = useState('');
  const bad = text !== '' && parseTime(text) === null;
  const small = 'rounded-lg border border-line bg-raised px-2 py-1.5 text-xs font-semibold tabular-nums active:scale-[0.97]';
  return (
    <form className="flex items-center gap-1.5"
      onSubmit={e => { e.preventDefault(); const t = parseTime(text); if (t !== null) { onSeek(t); setText(''); (document.activeElement as HTMLElement)?.blur(); } }}>
      <button type="button" className={small} onClick={() => onSkip(-10)}>−10s</button>
      <button type="button" className={small} onClick={() => onSkip(-5)}>−5s</button>
      <div className="flex min-w-0 flex-1 items-center rounded-lg border border-line bg-raised focus-within:border-ball">
        <input value={text} onChange={e => setText(e.target.value)} inputMode="numeric" enterKeyHint="go"
          placeholder={`${fmtTime(clock)} · go to…`}
          className={`w-full min-w-0 bg-transparent px-2 py-1.5 text-center text-xs tabular-nums outline-none ${bad ? 'text-bad' : ''}`} />
        {text && <button className="px-2 text-xs font-semibold text-ball">Go</button>}
      </div>
      <button type="button" className={small} onClick={() => onSkip(5)}>+5s</button>
      <button type="button" className={small} onClick={() => onSkip(10)}>+10s</button>
    </form>
  );
}

type Mode = 'watch' | 'review' | 'tag' | 'box';

const SKILL_KEYS = Object.keys(SKILLS) as Skill[];

/**
 * Touch-by-touch tagging: tap the player for each contact (the skill is predicted from the order of
 * play and can be changed), then say which of the last touches decided the rally. Works while the video
 * plays (touch time = tap time minus reaction lag) and from the keyboard on a laptop.
 */
const REACTION = 0.3;  // seconds between seeing a touch and tapping the name
const PLAYER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const SKILL_KEYS_KB: Record<string, Skill> = { q: 'serve', w: 'receive', e: 'set', r: 'attack', t: 'block', y: 'dig', i: 'free', u: 'other' };
// grade the last touch (receive / dig / set: 3 / 2 / 1) or say what kind of attack it was
const DETAIL_KEYS = ['a', 's', 'd'];
const SKILL_KEY_OF = Object.fromEntries(Object.entries(SKILL_KEYS_KB).map(([k, v]) => [v, k])) as Record<Skill, string>;

function Kbd({ k }: { k: string }) {
  return <span className="ml-1 hidden rounded border border-line px-1 font-mono text-[10px] text-muted lg:inline">{k}</span>;
}

function TouchTagger({ rally, players, name, now, playing, togglePlay, onChange, onDone, onPrev, onNext, hasPrev, hasNext, sug, onSkip, serve, onServer, wonBy, needTeams, onTeams, sameTeam }: {
  rally: Rally | undefined; players: Player[]; name: (id?: string) => string; now: () => number;
  playing: () => boolean; togglePlay: () => void;
  onChange: (touches: Touch[], end?: RallyEnd) => void; onDone: () => void;
  onPrev: () => void; onNext: () => void; hasPrev: boolean; hasNext: boolean;
  sug: { t: number; i: number; n: number } | null;  // suggested touch waiting to be tagged
  onSkip: () => void;
  // predicted server for an untagged rally (pre-selected), when the teams are set
  serve: { p: string; t: number; why: string; choices: string[] } | null;
  onServer: (p: string) => void;  // correct the server: their team rotates so they're at position 1
  wonBy: Team | null;      // which team won this rally, from its tags
  needTeams: boolean;      // teams not entered yet: tagging new rallies waits for them
  onTeams: () => void;
  sameTeam?: SameTeam;     // from the court setup: keeps dig assists within a team
}) {
  const saved = rally?.touches ?? [];
  const [skill, setSkill] = useState<Skill | null>(null);  // null = use the prediction
  const [sel, setSel] = useState<number | null>(null);     // touch being edited
  const [fixServer, setFixServer] = useState(false);
  useEffect(() => { setSkill(null); }, [rally?.s, saved.length]);
  useEffect(() => { setSel(null); setFixServer(false); }, [rally?.s]);
  // The predicted serve is shown as the first touch and saved with the next tap (or the result).
  const pre: Touch | null = rally && !saved.length && serve?.p ? { p: serve.p, k: 'serve', t: Math.round(serve.t * 10) / 10 } : null;
  const touches = pre ? [pre] : saved;
  const blocked = needTeams && !saved.length;
  const sorted = [...players].sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
  const k = skill ?? nextSkill(touches);
  const res = rally && rallyResult(rally, sameTeam);
  const enders = touches.map((t, i) => ({ t, i })).slice(-2).reverse();  // last touch first

  // at the suggested moment if paused on one; else the current time, minus reaction lag while playing
  const addTouch = (p: string) => {
    if (!rally) return;
    if (blocked) return;
    if (sel !== null) {  // change who made the selected touch
      if (pre) onServer(p);
      else onChange(touches.map((x, i) => i === sel ? { ...x, p } : x), rally.end);
      setSel(null);
      return;
    }
    const t = sug ? sug.t : now() - (playing() ? REACTION : 0);
    const touch = { p, k, t: Math.round(Math.max(rally.s, t) * 10) / 10 };
    // choosing Serve by hand replaces the predicted server
    onChange(pre && k === 'serve' ? [touch] : [...touches, touch]);
  };
  const correctServer = (p: string) => { onServer(p); setFixServer(false); };
  const undo = () => saved.length && onChange(saved.slice(0, -1));
  const pickSkill = (s: Skill) => {
    if (sel !== null && rally && !pre) { onChange(touches.map((x, i) => i === sel ? { ...x, k: s } : x), rally.end); setSel(null); }
    else setSkill(s);
  };
  const removeSel = () => {
    if (sel === null || !rally) return;
    if (pre) { setSel(null); return; }  // nothing saved yet
    const end = rally.end && rally.end.i !== sel ? { ...rally.end, i: rally.end.i > sel ? rally.end.i - 1 : rally.end.i } : undefined;
    onChange(touches.filter((_, i) => i !== sel), end);
    setSel(null);
  };
  // a player can't touch the ball twice in a row: probably a tagging slip
  const doubled = touches.findIndex((x, i) => i > 0 && !isGuest(x.p) && x.p === touches[i - 1].p);
  const finish = (i: number, r: RallyEnd['r']) => { onChange(touches, { i, r }); onDone(); };

  // optional detail for the selected touch (or the latest one): a grade, or the attack type
  const di = sel ?? (saved.length ? saved.length - 1 : -1);
  const dt = !pre && di >= 0 ? saved[di] : undefined;
  const detailOpts: { label: string; on: boolean; set: () => void }[] = !dt ? []
    : GRADED.includes(dt.k) ? ([3, 2, 1] as Grade[]).map(q => ({
        label: `${q} ${GRADE_LABELS[dt.k === 'set' ? 'set' : 'pass'][q]}`, on: (dt.q ?? (dt.k === 'set' ? DEFAULT_SET_GRADE : undefined)) === q,
        set: () => setDetail(di, x => { const { q: _q, ...rest } = x; return dt.q === q ? rest : { ...rest, q }; }),
      }))
    : dt.k === 'attack' ? (['spike', 'tip', 'roll'] as const).map(a => ({
        label: ATTACK_TYPES[a], on: (dt.a ?? 'spike') === a,
        set: () => setDetail(di, x => { const { a: _a, ...rest } = x; return a === 'spike' ? rest : { ...rest, a: a as AttackType }; }),
      }))
    : [];
  function setDetail(i: number, f: (t: Touch) => Touch) {
    if (!rally) return;
    onChange(saved.map((x, j) => (j === i ? f(x) : x)), rally.end);
  }

  // laptop shortcuts
  const keys = useRef({ addTouch, undo, finish, onSkip, togglePlay, onPrev, onNext, sorted, touches, sug, pickSkill, detailOpts });
  keys.current = { addTouch, undo, finish, onSkip, togglePlay, onPrev, onNext, sorted, touches, sug, pickSkill, detailOpts };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).tagName === 'INPUT') return;
      const c = keys.current, key = e.key.toLowerCase();
      const pi = PLAYER_KEYS.indexOf(key);
      const last = c.touches.length - 1;
      const act =
        pi >= 0 && c.sorted[pi] ? () => c.addTouch(c.sorted[pi].id)
        : key === 'g' ? () => c.addTouch('guest-a')
        : key === 'h' ? () => c.addTouch('guest-b')
        : SKILL_KEYS_KB[key] ? () => c.pickSkill(SKILL_KEYS_KB[key])
        : DETAIL_KEYS.includes(key) && c.detailOpts.length ? c.detailOpts[DETAIL_KEYS.indexOf(key)].set
        : key === ' ' ? c.togglePlay
        : key === 'z' ? c.undo
        : key === 'p' && last >= 0 ? () => c.finish(last, 'point')
        : key === 'x' && last >= 0 ? () => c.finish(last, 'error')
        : key === 'n' && c.sug ? c.onSkip
        : key === 'arrowleft' ? c.onPrev
        : key === 'arrowright' ? c.onNext
        : null;
      if (act) { e.preventDefault(); act(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const status = !rally ? 'Tap a rally to start tagging'
    : blocked ? 'Enter both teams before tagging'
    : res ? <>Ended: <b className={res.good ? 'text-good' : 'text-bad'}>{res.label} · {name(res.who)}</b>{res.assist && <span className="text-muted"> (assist {name(res.assist)})</span>}{res.note && <span className="text-muted"> ({name(res.noteWho)} {res.note})</span>}{wonBy && <span className="text-muted"> · Team {wonBy.toUpperCase()}'s point</span>}</>
    : touches.length ? 'Next touch, or how did it end?' : 'Who served?';
  const why = serve?.why ?? '';

  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-2">
      <div className="flex items-center gap-2">
        <button className={`${btn} px-3 py-1.5`} disabled={!hasPrev} onClick={onPrev}>◀</button>
        <div className="min-w-0 flex-1 truncate text-center text-sm">{status}</div>
        <button className={`${btn} px-3 py-1.5`} disabled={!hasNext} onClick={onNext}>▶</button>
      </div>
      {rally && (
        <>
          {sug && (
            <div className="flex items-center gap-2 rounded-lg bg-ball/15 px-3 py-1.5 text-xs">
              <span className="flex-1">Suggested touch {sug.i + 1}/{sug.n} at <b>{fmtTime(sug.t)}</b>: who touched it?</span>
              <button className="rounded-md border border-line px-2 py-1 font-semibold" onClick={onSkip}>Not a touch<Kbd k="N" /></button>
            </div>
          )}
          {rally.tag && !touches.length && (
            <p className="text-xs text-muted">Has a quick point tag; adding touches replaces it with a full breakdown.</p>
          )}
          {touches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {touches.map((t, i) => (
                <button key={i} onClick={() => setSel(sel === i ? null : i)} title="Tap to change or delete this touch"
                  className={`rounded-md px-1.5 py-0.5 ${sel === i ? 'ring-2 ring-ball' : ''} ${doubled === i ? 'outline outline-1 outline-bad' : ''} ${pre ? 'border border-dashed border-ball/60' : ''} ${rally.end?.i === i ? (rally.end.r === 'point' ? 'bg-good/20 text-good' : 'bg-bad/20 text-bad') : 'bg-raised'}`}>
                  {name(t.p)} <span className="text-muted">{t.k === 'attack' && t.a ? ATTACK_TYPES[t.a] : SKILLS[t.k]}</span>
                  {t.q && <span className="ml-0.5 rounded bg-surface px-1 text-[10px] font-semibold">{t.q}</span>}
                </button>
              ))}
              {saved.length > 0 && <button className="ml-1 text-muted underline" onClick={undo}>undo<Kbd k="Z" /></button>}
            </div>
          )}
          {sel !== null && touches[sel] && (
            <div className="flex items-center gap-2 rounded-lg bg-ball/15 px-3 py-1.5 text-xs">
              <span className="flex-1">Editing touch {sel + 1} ({name(touches[sel].p)} {SKILLS[touches[sel].k].toLowerCase()}): tap a player or skill to change it</span>
              <button className="rounded-md border border-line px-2 py-1 font-semibold text-bad" onClick={removeSel}>Delete</button>
              <button className="rounded-md border border-line px-2 py-1" onClick={() => setSel(null)}>Done</button>
            </div>
          )}
          {doubled >= 0 && sel === null && (
            <p className="text-xs text-bad">
              {name(touches[doubled].p)} is tagged twice in a row (touches {doubled} and {doubled + 1}); a player can't do that. Tap a touch to fix it.
            </p>
          )}
          {pre && serve && (
            <div className="rounded-lg bg-raised px-2 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  🏐 <b>{name(pre.p)}</b> serves <span className="text-muted">· {why}</span>
                </span>
                <button className="shrink-0 rounded-md border border-line px-2 py-1" onClick={() => setFixServer(!fixServer)}>
                  {fixServer ? 'Cancel' : 'Wrong server?'}
                </button>
              </div>
              {fixServer && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {serve.choices.filter(p => p !== pre.p).map(p => (
                    <button key={p} onClick={() => correctServer(p)} className="rounded-md border border-line bg-surface px-2 py-1 font-semibold">{name(p)}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {blocked && (
            <button onClick={onTeams} className="w-full rounded-lg border border-ball/60 bg-ball/10 px-3 py-3 text-sm font-semibold text-ball">
              Set up both teams on the court first →
            </button>
          )}
          {!blocked && <>
          {detailOpts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-full text-[11px] text-muted">
                {name(dt!.p)}'s {SKILLS[dt!.k].toLowerCase()}{dt!.k === 'set' ? ' (OK unless you grade it)' : GRADED.includes(dt!.k) ? ' (optional grade)' : ''}
              </span>
              {detailOpts.map((o, i) => (
                <button key={o.label} onClick={o.set}
                  className={`min-w-0 flex-1 rounded-md border px-1 py-1 text-[11px] font-semibold leading-tight ${o.on ? 'border-court bg-court/25 text-ink' : 'border-line text-muted'}`}>
                  {o.label}<Kbd k={DETAIL_KEYS[i].toUpperCase()} />
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-8 lg:grid-cols-4 xl:grid-cols-8">
            {SKILL_KEYS.map(s => (
              <button key={s} onClick={() => pickSkill(s)}
                className={`rounded-md border py-1 text-[11px] font-semibold ${s === k ? 'border-ball bg-ball text-bg' : 'border-line text-muted'}`}>
                {SKILLS[s]}<span className="hidden text-[9px] opacity-60 lg:inline"> {SKILL_KEY_OF[s].toUpperCase()}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-3">
            {sorted.map((pl, i) => (
              <button key={pl.id} onClick={() => addTouch(pl.id)}
                className="flex items-center justify-between gap-1 rounded-lg border border-line bg-raised px-2 py-2 text-left text-sm font-semibold active:scale-[0.97] active:border-ball">
                {pl.photo && <span className="clean-only"><Avatar name={pl.name} photo={pl.photo} size={22} ring={0} /></span>}
                <span className="min-w-0 flex-1 truncate">{pl.name}</span>
                <span className="shrink-0 text-xs text-muted">{pl.number !== null ? `#${pl.number}` : ''}{PLAYER_KEYS[i] && <Kbd k={PLAYER_KEYS[i]} />}</span>
              </button>
            ))}
            {(['a', 'b'] as const).map(t => (
              <button key={t} onClick={() => addTouch(`guest-${t}`)}
                className="rounded-lg border border-line bg-raised px-2 py-2 text-sm text-muted active:scale-[0.97]">Guest {t.toUpperCase()}<Kbd k={t === 'a' ? 'G' : 'H'} /></button>
            ))}
          </div>
          {enders.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {enders.map(({ t, i }) => (
                <Fragment key={i}>
                  <button className="truncate rounded-lg border border-line bg-raised px-2 py-2 text-xs font-semibold text-good" onClick={() => finish(i, 'point')}>
                    ✓ {name(t.p)}'s {SKILLS[t.k].toLowerCase()} scored{i === touches.length - 1 && <Kbd k="P" />}
                  </button>
                  <button className="truncate rounded-lg border border-line bg-raised px-2 py-2 text-xs font-semibold text-bad" onClick={() => finish(i, 'error')}>
                    ✗ {name(t.p)}'s {SKILLS[t.k].toLowerCase()} error{i === touches.length - 1 && <Kbd k="X" />}
                  </button>
                </Fragment>
              ))}
            </div>
          )}
          </>}
        </>
      )}
    </div>
  );
}

const btn = 'rounded-lg border border-line bg-raised px-3 py-2.5 text-sm font-semibold active:scale-[0.97] disabled:opacity-40';

export function GameView() {
  const { id } = useParams();
  const game = useGame(id);
  const { isAdmin, canEdit, isPlayer } = useAuth();
  if (game === undefined) return null;
  if (game === null) return <p className="text-muted">Game not found. <Link to="/games" className="text-ball">Back</Link></p>;
  return <GamePlayer game={game} canDelete={isAdmin} canEdit={canEdit} canStar={isPlayer} />;
}

/** canEdit: may review and tag (players, editors, admins); canStar: may save highlights (players, admins). */
export function GamePlayer({ game, canDelete, samplePlayers, canEdit = true, canStar = true }: {
  game: Game; canDelete: boolean; samplePlayers?: Player[]; canEdit?: boolean; canStar?: boolean;
}) {
  const id = game.id;
  const nav = useNavigate();
  const [search] = useSearchParams();
  const [mode, setMode] = useState<Mode>(canEdit && search.get('review') ? 'review' : canEdit && search.get('tag') ? 'tag' : search.get('box') ? 'box' : 'watch');
  const { players: dbPlayers } = usePlayers();
  const players = samplePlayers ?? dbPlayers;  // samplePlayers: dev preview only
  const [rallies, setRallies] = useState<Rally[]>([]);
  const [cur, setCur] = useState(-1);
  const [autoplay, setAutoplay] = useAutoplay();  // Watch / Box score: carry on to the next rally (same setting as playlists)
  const playAll = autoplay && (mode === 'watch' || mode === 'box');
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const playerEl = useRef<HTMLDivElement>(null);
  const listEl = useRef<HTMLOListElement>(null);
  const listEl2 = useRef<HTMLOListElement>(null);  // the copy under the video (Tag tab, wide screens)
  const player = useRef<YTPlayer | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // keep local copy in sync with the database unless we have unsaved edits
  useEffect(() => { if (!dirty.current) setRallies(game.rallies); }, [game]);

  const list = mode === 'review' ? rallies : rallies.filter(r => r.st !== 'bad');
  const rally = list[cur];
  // suggested touch moments for this rally that haven't been tagged or skipped yet
  const sugs = mode === 'tag' && rally ? suggestTouches(game.peaks, rally.s, rally.e) : [];
  // the two teams on court for this rally (worked out from the setup and earlier rallies, or as saved)
  const setup = gameSetup(game);
  const teamsReady = setupReady(setup);
  // running score from the tags (live rallies in order); needs the teams to know who won each rally
  const liveRallies = rallies.filter(r => r.st !== 'bad');
  // the court for the selected rally (Tag and Review); clips marked "not a rally" have none
  const showCourt = mode === 'tag' || mode === 'review';
  const view = showCourt && rally && teamsReady && rally.st !== 'bad' ? courtFor(setup, liveRallies, liveRallies.indexOf(rally)) : null;
  const sheet = teamsReady ? scoreSheet(setup, liveRallies) : null;
  const match = useMemo(() => (mode === 'box' ? matchRatings(game) : null), [mode, game]);
  const scoreAt = new Map(liveRallies.map((r, i) => [r, sheet?.[i]]));
  const notCounted = (upTo: number) => (sheet ?? []).slice(0, upTo).filter(x => !x.winner).length;
  const handled = (t: number) =>
    (rally?.touches ?? []).some(x => Math.abs(x.t - t) < 0.15) || (rally?.sk ?? []).some(x => Math.abs(x - t) < 0.05);
  const pendingIdx = sugs.findIndex(t => !handled(t));
  const pending = pendingIdx >= 0 ? sugs[pendingIdx] : null;

  // cameras: the game's own video plus any added ones; switching keeps the same moment playing
  const cams = cameras(game);
  const [camId, setCamId] = useState('main');
  const cam = cams.find(c => c.id === camId) ?? cams[0];
  const offsetRef = useRef(cam.offset);
  offsetRef.current = cam.offset;
  const resumeAt = useRef<{ t: number; playing: boolean } | null>(null);
  const settleUntil = useRef(0);  // just after a camera switch the new video reports stale times: ignore them
  const [addingCam, setAddingCam] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const switchCam = (id: string) => {
    if (id === cam.id) return;
    const p = player.current;
    resumeAt.current = p ? { t: p.getCurrentTime(), playing: p.getPlayerState() === 1 } : null;
    setCamId(id);
  };
  // fine-tune how a camera lines up: keep showing the same game moment while shifting it
  const nudge = async (d: number) => {
    if (cam.id === 'main') return;
    const t = player.current?.getCurrentTime();
    const offset = Math.round((cam.offset + d) * 100) / 100;
    offsetRef.current = offset;
    if (t !== undefined) player.current?.seekTo(t, true);
    await updateGame(game.id, { angles: (game.angles ?? []).map(a => a.id === cam.id ? { ...a, offset } : a) });
  };
  const removeCam = async () => {
    if (cam.id === 'main' || !confirm(`Remove the "${cam.name}" camera from this game? (The YouTube video itself stays.)`)) return;
    setCamId('main');
    await updateGame(game.id, { angles: (game.angles ?? []).filter(a => a.id !== cam.id) });
    logHistory(game.id, user, [`Removed camera "${cam.name}"`]).catch(() => {});
  };

  // YouTube player (the current camera's video; times are converted to the game's timeline)
  useEffect(() => {
    if (!playerEl.current) return;
    let dead = false;
    setReady(false);
    const host = document.createElement('div');
    playerEl.current.replaceChildren(host);
    createPlayer(host, cam.youtubeId).then(p => {
      if (dead) { p.destroy(); return; }
      player.current = withOffset(p, () => offsetRef.current);
      setReady(true);
      const r = resumeAt.current;
      resumeAt.current = null;
      if (r) { settleUntil.current = Date.now() + 2000; player.current.seekTo(r.t, true); if (r.playing) player.current.playVideo(); }
    });
    return () => { dead = true; player.current?.destroy(); player.current = null; };
  }, [cam.youtubeId]);

  // "clip" = we started a rally and should stop at its end; any seek away turns it off (free play)
  const clip = useRef(false);
  const [ready, setReady] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [highlighting, setHighlighting] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const openTeams = () => { player.current?.pauseVideo(); setTeamsOpen(true); };  // the setup has its own video
  const [teamsFrom, setTeamsFrom] = useState(false);  // re-entering the teams at the selected rally
  const openTeamsFrom = () => { player.current?.pauseVideo(); setTeamsFrom(true); };
  const gameHighlights = useHighlights({ gameId: game.id });
  const starred = (r: Rally) => (gameHighlights ?? []).filter(h => Math.abs(h.s - r.s) < 1);
  const [step, setStep] = useState(false);  // pause at suggested touch moments while tagging (off until suggestions improve)
  const [clock, setClock] = useState(0);

  const go = useCallback((i: number) => {
    if (i < 0 || i >= list.length) return;
    setCur(i);
    clip.current = true;
    player.current?.seekTo(list[i].s, true);
    player.current?.playVideo();
  }, [list]);

  // ?t=<seconds> (from a player's stats) plays that rally once the player is ready
  const startAt = useRef(search.get('t'));
  // set when a linked rally couldn't start on its own (phones block playing with sound until a tap)
  const [tapToPlay, setTapToPlay] = useState<{ i: number; t: number } | null>(null);
  const playLinked = useCallback((i: number, t: number) => {
    const r = list[i];
    if (t <= r.e + 0.5) {
      go(i);
      if (t - r.s > 3) player.current?.seekTo(t - 3, true);  // jump close to the touch
    } else {
      // the touch was tagged after the clip ends: play on from the rally start through to it
      setCur(i);
      seekFree(Math.max(r.s, t - 8));
    }
  }, [go, list]);
  useEffect(() => {
    // wait for both the player and the game's rallies
    if (!ready || startAt.current === null || !list.length) return;
    const t = Number(startAt.current);
    startAt.current = null;
    // the rally the link came from (by its start), else the rally around the time, else the one before it
    const rs = search.get('r');
    let i = rs !== null ? list.findIndex(r => Math.abs(r.s - Number(rs)) < 0.6) : -1;
    if (i < 0) i = list.findIndex(r => t >= r.s - 0.2 && t <= r.e + 0.5);
    if (i < 0) i = list.reduce((best, r, k) => (r.s <= t ? k : best), -1);
    if (i < 0) return;
    playLinked(i, t);
    setTimeout(() => { if (player.current?.getPlayerState() !== 1) setTapToPlay({ i, t }); }, 1500);
  }, [ready, list, playLinked]);

  const seekFree = (t: number) => {
    const p = player.current;
    if (!p) return;
    clip.current = false;
    p.seekTo(Math.max(0, Math.min(t, (p.getDuration() || game.duration) - 0.5)), true);
    p.playVideo();
  };
  const skip = (d: number) => seekFree((player.current?.getCurrentTime() ?? 0) + d);

  // stop (or move on) at the end of the current rally, unless the viewer has moved elsewhere
  const state = useRef({ list, cur, playAll, go, pending: null as number | null, stepping: false });
  state.current = { list, cur, playAll, go, pending, stepping: mode === 'tag' && step && !rally?.end };
  const [atSug, setAtSug] = useState<number | null>(null);  // suggestion we're paused on
  useEffect(() => {
    const t = setInterval(() => {
      const { list, cur, playAll, go, pending, stepping } = state.current;
      const p = player.current;
      if (!p) return;
      const now = p.getCurrentTime();
      setClock(now);
      if (p.getPlayerState() === 1) setTapToPlay(null);
      const r = list[cur];
      if (stepping && pending !== null && p.getPlayerState() === 1 && now >= pending + 0.3 && now < pending + 1.5) {
        p.pauseVideo();  // just after the suggested touch, so you can see who played it
        setAtSug(pending);
        return;
      }
      if (!clip.current || !r || p.getPlayerState() !== 1 || Date.now() < settleUntil.current) return;  // 1 = playing
      if (now < r.s - 1 || now > r.e + 1.5) { clip.current = false; return; }  // viewer seeked away
      if (now >= r.e) {
        if (playAll && cur < list.length - 1) go(cur + 1);
        else { p.pauseVideo(); clip.current = false; }
      }
    }, 200);
    return () => clearInterval(t);
  }, []);

  // history notes waiting for the next save, keyed so repeated edits to one rally collapse into one line
  const notes = useRef(new Map<string, string>());
  const user = useAuth()?.user ?? null;  // (no auth context in the dev preview)
  const me = (user?.displayName || user?.email || 'Someone').split(/[ @]/)[0];

  function commit(next: Rally[], focusStart?: number, note?: [string, string]) {
    // stamp rallies changed by this edit with who did it
    const before = new Set(rallies);
    next = next.map(r => (before.has(r) ? r : { ...r, by: me })).sort((a, b) => a.s - b.s);
    if (note) { notes.current.delete(note[0]); notes.current.set(note[0], note[1]); }
    dirty.current = true;
    setRallies(next);
    if (focusStart !== undefined) {
      const shown = mode === 'review' ? next : next.filter(r => r.st !== 'bad');
      setCur(shown.findIndex(r => r.s === focusStart));
    }
    setSaveState('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveRallies(id!, next);
        setSaveState('saved');
        const changes = [...notes.current.values()];
        notes.current.clear();
        logHistory(id!, user, changes).catch(() => {});
      } catch { setSaveState('error'); }
      dirty.current = false;
    }, 600);
  }

  const now = () => Math.round((player.current?.getCurrentTime() ?? 0) * 10) / 10;
  const label = (r: Rally) => `Rally ${fmtTime(r.as ?? r.s)}`;
  const edit = (patch: Partial<Rally>, note?: string) => {
    if (!rally) return;
    commit(rallies.map(r => r === rally ? { ...r, ...patch } : r), patch.s ?? rally.s,
      note ? [`rev:${rally.as ?? rally.s}:${note.split(':')[0]}`, `${label(rally)}: ${note}`] : undefined);
  };
  const mark = (st: 'ok' | 'bad') => {
    if (!rally) return;
    if (st === 'bad' && rally.st === 'added') {  // remove a rally someone added by mistake
      commit(rallies.filter(r => r !== rally), undefined, [`del:${rally.s}`, `Removed the added rally at ${fmtTime(rally.s)}`]);
      return;
    }
    const nst = rally.st === 'added' ? 'added' : rally.st === st ? 'auto' : st;
    edit({ st: nst }, `marked ${nst === 'ok' ? 'good' : nst === 'bad' ? 'not a rally' : nst === 'auto' ? 'unchecked' : 'added'}`);
    if (rally.st !== st && cur < list.length - 1) setTimeout(() => go(cur + 1), 150);
  };
  // Review: confirm who served (the court's prediction, or the reviewer's pick) as the rally's first touch
  const [pickServer, setPickServer] = useState(false);
  useEffect(() => setPickServer(false), [rally?.s]);
  const predictedServer = view ? (isGuest(server(view.state)) ? `guest-${view.state.serving}` : server(view.state)) : null;
  const reviewServer = rally?.touches?.[0]?.k === 'serve' ? rally.touches[0].p : predictedServer;
  const serverTeam = (p: string): Team | null => guestTeam(p) ?? (view ? TEAMS.find(t => view.state[t].pos.includes(p) || view.state[t].bench.includes(p)) ?? null : null);
  // The server is always one of two people: the same team served again (it won the last rally) or the
  // other team's next server (side-out). Each choice also records who won the previous rally.
  const liveIdx = rally ? liveRallies.indexOf(rally) : -1;
  const prevLive = liveIdx > 0 ? liveRallies[liveIdx - 1] : null;
  const prevServing = view && prevLive ? courtFor(setup!, liveRallies, liveIdx - 1).state.serving : null;
  const guessServe = useMemo(() => serveGuesses(game), [game]);
  const serveOptions = view && prevLive && prevServing && !view.saved
    ? (() => {
        const opts = ([prevServing, prevServing === 'a' ? 'b' : 'a'] as Team[]).map(w => {
          const v = courtFor(setup!, liveRallies.map(r => (r === prevLive ? { ...r, won: w } : r)), liveIdx);
          const sp = server(v.derived);
          return { won: w, p: isGuest(sp) ? `guest-${v.derived.serving}` : sp, again: w === prevServing, court: v.derived };
        });
        if (opts[0].p === opts[1].p) return [opts[0]];  // the previous rally's tags already decide it
        // a camera behind a team can tell which end served: put that choice first (Y)
        const g = rally ? guessServe(rally.s) : null;
        return g?.sure && opts[1].won === g.team ? [{ ...opts[1], cam: true }, opts[0]] : g?.sure ? [{ ...opts[0], cam: true }, opts[1]] : opts;
      })()
    : null;
  const good = (p = reviewServer, court?: CourtState, won?: Team) => {
    if (!rally) return;
    if (!p || !view) { mark('ok'); return; }  // no teams set up: plain review
    const r0 = rally;
    const ts = r0.touches ?? [];
    const t = Math.round((suggestTouches(game.peaks, r0.s, r0.e)[0] ?? r0.s) * 10) / 10;
    const touches = !ts.length ? [{ p, k: 'serve' as Skill, t }] : ts[0].k === 'serve' ? [{ ...ts[0], p }, ...ts.slice(1)] : ts;
    const nst = r0.st === 'added' ? 'added' : 'ok';
    // one save: status, serve, and (when the server was changed) the corrected court
    const fix = court ? { court: { ...courtOnly(court), manual: true } } : {};
    commit(rallies.map(r => (r === r0 ? { ...r, st: nst, touches, ...fix } : won && r === prevLive ? { ...r, won } : r)), r0.s,
      [`rev:${r0.as ?? r0.s}:st`, `${label(r0)}: marked good · ${name(p)} served${court ? ' (court corrected)' : ''}${won ? ` · Team ${won.toUpperCase()} won the rally before` : ''}`]);
    if (cur < list.length - 1) setTimeout(() => go(cur + 1), 150);
  };
  // the reviewer picks who served from the list. Their team decides who won the rally before (same team =
  // they won it, the other team = side-out, rotation included), exactly like the two buttons; only a player
  // the rotation doesn't expect (a missed rally, a sub) also needs the court lined up with them by hand.
  const chooseServer = (p: string) => {
    setPickServer(false);
    if (!view) return;
    const t = serverTeam(p);
    const opt = t && serveOptions ? serveOptions.find(o => o.won === t) ?? null : null;
    const won = opt && serveOptions!.length > 1 ? opt.won : undefined;
    if (opt && (opt.p === p || (isGuest(p) && isGuest(opt.p)))) { good(opt.p, undefined, won); return; }
    const base = opt?.court ?? view.state;
    const g = guestTeam(p);
    const c = g ? guestServes(base, g) : makeServer(base, p);
    good(p, sameCourt(c, view.state) ? undefined : c, won);
  };
  const setStart = () => { const t = now(); if (rally && t < rally.e) edit({ s: t, st: rally.st === 'auto' ? 'ok' : rally.st }, `start: changed start to ${fmtTime(t)}`); };
  const setEnd = () => { const t = now(); if (rally && t > rally.s) edit({ e: t, st: rally.st === 'auto' ? 'ok' : rally.st }, `end: changed end to ${fmtTime(t)}`); };
  const add = () => { const s = now(); commit([...rallies, { s, e: s + 6, st: 'added' }], s, [`add:${s}`, `Added a rally at ${fmtTime(s)}`]); };
  const setTouches = (touches: Touch[], end?: RallyEnd) => {
    if (!rally) return;
    const r0 = rally;
    const updated = rallies.map(r => {
      if (r !== r0) return r;
      const { tag: _t, end: _e, touches: _ts, ...rest } = r;
      return { ...rest, touches, ...(end && end.i < touches.length ? { end } : {}) };
    });
    const res = rallyResult(updated.find(r => r.s === r0.s)!, sameTeamIn(game));
    const who = (pid: string) => isGuest(pid) ? guestName(pid) : players?.find(p => p.id === pid)?.name ?? pid;
    const chain = touches.map(t => `${who(t.p)} ${SKILLS[t.k].toLowerCase()}`).join(' → ');
    commit(updated, r0.s, [`tag:${r0.as ?? r0.s}`, !touches.length ? `${label(r0)}: cleared tags`
      : `${label(r0)}: ${chain}${res ? ` ⇒ ${res.label} · ${who(res.who)}` : ' (in progress)'}`]);
  };
  const setCourt = (c: CourtState, what: string, manual = true) => {
    if (!rally) return;
    const r0 = rally;
    // only hand-made changes are stored; undoing one goes back to the worked-out court
    const upd = (r: Rally): Rally => {
      if (manual) return { ...r, court: { ...courtOnly(c), manual: true } };
      const { court: _c, ...rest } = r;
      return rest;
    };
    commit(rallies.map(r => r === r0 ? upd(r) : r), r0.s, [`court:${r0.as ?? r0.s}`, `${label(r0)}: ${what}`]);
  };
  const resume = () => { setAtSug(null); if (step) player.current?.playVideo(); };
  const skipSug = () => {
    if (!rally || pending === null) return;
    const r0 = rally;
    commit(rallies.map(r => r === r0 ? { ...r, sk: [...(r.sk ?? []), pending] } : r), r0.s);
    resume();
  };
  // after a rally's result is tagged, move on to the next rally that still needs tagging
  const nextUntagged = () => {
    const i0 = cur;
    const next = list.findIndex((r, i) => i > i0 && !isTagged(r));
    if (next >= 0) setTimeout(() => go(next), 150);
  };

  // desktop shortcuts in review mode
  useEffect(() => {
    if (mode !== 'review') return;
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        y: () => serveOptions ? good(serveOptions[0].p, undefined, serveOptions.length > 1 ? serveOptions[0].won : undefined) : good(),
        u: () => { if (serveOptions?.[1]) good(serveOptions[1].p, undefined, serveOptions[1].won); },
        x: () => mark('bad'), '[': setStart, ']': setEnd, a: add, r: () => go(cur),
        ',': () => skip(-5), '.': () => skip(5),
        arrowright: () => go(cur + 1), arrowleft: () => go(cur - 1), n: () => go(cur + 1), p: () => go(cur - 1),
      };
      if (map[k]) { e.preventDefault(); map[k](); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // keep the playing rally visible in the list (e.g. during Play all)
  useEffect(() => {
    for (const el of [listEl.current, listEl2.current])
      el?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cur]);

  const unchecked = rallies.filter(r => r.st === 'auto').length;
  const untagged = rallies.filter(r => r.st !== 'bad' && !isTagged(r)).length;
  const name = (id?: string) => !id ? '' : isGuest(id) ? guestName(id) : players?.find(p => p.id === id)?.name ?? '?';
  const live = rallies.filter(r => r.st !== 'bad').length;

  const remove = async () => {
    if (confirm(`Delete "${game.title}" and all its rallies? This can't be undone.`)) { await deleteGame(game.id); nav('/games'); }
  };

  // the rally list: in the middle column, or under the video while tagging on a wide screen
  const rallyList = (ref: RefObject<HTMLOListElement | null>, cls: string, compact = false) => (
    <ol ref={ref} className={`${cls} divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface`}>
      {list.map((r, i) => {
        const prevEnd = i ? list[i - 1].e : 0;
        const gap = mode === 'review' && r.s - prevEnd >= GAP_MIN ? (
          <li key={`gap-${i}`}>
            <button onClick={() => seekFree(prevEnd)}
              className="flex w-full items-center gap-3 border-l-2 border-dashed border-line px-4 py-2 text-left text-sm text-muted hover:bg-raised">
              <span className="w-7 text-center">⋯</span>
              <span className="flex-1 tabular-nums">No rally {fmtTime(prevEnd)} – {fmtTime(r.s)} <span className="text-xs">({Math.round(r.s - prevEnd)}s)</span></span>
              <span className="text-xs">▶ check</span>
            </button>
          </li>
        ) : null;
        return [gap, (
        <li key={`${r.s}-${i}`} data-i={i}>
          <button onClick={() => go(i)}
            className={`flex w-full items-center gap-3 px-4 ${compact ? 'py-2' : 'py-3'} text-left ${i === cur ? 'bg-raised shadow-[inset_3px_0_0] shadow-ball' : ''} ${r.st === 'bad' ? 'opacity-50' : ''}`}>
            <span className="w-7 font-display text-muted">{i + 1}</span>
            <span className={`flex-1 tabular-nums ${compact ? 'min-w-0 truncate whitespace-nowrap' : ''}`}>{fmtTime(r.s)} – {fmtTime(r.e)} <span className="text-xs text-muted">({Math.round(r.e - r.s)}s)</span>
              {!compact && mode !== 'watch' && mode !== 'box' && r.by && <span className="ml-1 text-[10px] text-muted">· by {r.by}</span>}
              {starred(r).length > 0 && (
                <span className="ml-1 text-xs text-ball" title={`Highlight for ${starred(r).map(h => players?.find(p => p.id === h.playerId)?.name ?? h.playerId).join(', ')}`}>★</span>
              )}
            </span>
            {mode === 'review' && <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[r.st].cls}`}>{STATUS[r.st].label}</span>}
            {mode !== 'review' && (() => {
              const res = rallyResult(r, sameTeamIn(game));
              if (res) return (
                <span className={`truncate rounded-full px-2 py-0.5 text-xs ${res.good ? 'bg-good/20 text-good' : 'bg-bad/20 text-bad'}`}>
                  {res.label} · {name(res.who)}{res.assist && <span className="opacity-70"> (assist {name(res.assist)})</span>}{res.note && <span className="opacity-70"> ({name(res.noteWho)} {res.note})</span>}
                </span>
              );
              if (mode === 'tag') return <span className="text-xs text-muted">{r.touches?.length ? `${r.touches.length} touches…` : 'untagged'}</span>;
              return null;
            })()}
            {mode !== 'review' && scoreAt.get(r)?.winner && (
              <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted" title="Score after this rally (Team A – Team B)">
                {scoreAt.get(r)!.after.a}–{scoreAt.get(r)!.after.b}
              </span>
            )}
          </button>
        </li>
        )];
      })}
      {mode === 'review' && list.length > 0 && game.duration - list[list.length - 1].e >= GAP_MIN && (
        <li>
          <button onClick={() => seekFree(list[list.length - 1].e)}
            className="flex w-full items-center gap-3 border-l-2 border-dashed border-line px-4 py-2 text-left text-sm text-muted hover:bg-raised">
            <span className="w-7 text-center">⋯</span>
            <span className="flex-1 tabular-nums">No rally {fmtTime(list[list.length - 1].e)} – end</span>
            <span className="text-xs">▶ check</span>
          </button>
        </li>
      )}
    </ol>
  );

  // Fills the screen: phone = video on top + list scrolling below; wide screen = video left, list right.
  return (
    <div className={`game-fill flex h-[calc(100dvh-11.5rem-env(safe-area-inset-top))] flex-col gap-3 lg:grid lg:gap-5 ${mode === 'box' ? 'max-lg:!h-auto' : ''} ${showCourt
      ? 'lg:grid-cols-[minmax(0,1.9fr)_minmax(280px,1fr)_minmax(230px,0.75fr)]' : 'lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]'}`}>
      <div className={`shrink-0 space-y-2 ${mode === 'tag' ? 'lg:flex lg:min-h-0 lg:flex-col lg:gap-2 lg:space-y-0 lg:overflow-y-auto' : 'lg:overflow-y-auto'}`}>
        <div className="game-head flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Link to="/games" className="text-sm text-muted">← Games</Link>
            <h1 className="truncate font-display text-2xl font-bold">{game.title}</h1>
            <p className="text-sm text-muted">{game.date} · {live} rallies{!game.reviewed && ' · needs review'}</p>
          </div>
          {canEdit && (
            <button onClick={() => setShowHistory(true)} className="mt-5 shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm">
              History
            </button>
          )}
          {canDelete && (
            <button onClick={remove} className="mt-5 shrink-0 rounded-lg border border-bad/40 px-3 py-1.5 text-sm text-bad">
              Delete game
            </button>
          )}
        </div>
        {showHistory && <HistoryDialog gameId={game.id} onClose={() => setShowHistory(false)} />}
        {teamsOpen && <TeamsDialog game={game} players={players ?? []} onClose={() => setTeamsOpen(false)}
          video={{ youtubeId: cam.youtubeId, offset: cam.offset, start: liveRallies[0]?.s ?? 0, name: cameraLabel(cam) }} />}
        {teamsFrom && view && rally && <TeamsDialog game={game} players={players ?? []} onClose={() => setTeamsFrom(false)}
          video={{ youtubeId: cam.youtubeId, offset: cam.offset, start: rally.s, name: cameraLabel(cam) }}
          fromRally={{ label: `rally ${liveRallies.indexOf(rally) + 1}`, state: view.state, onSave: c => setCourt(c, 're-entered the teams from this rally') }} />}
        {highlighting && rally && (
          <HighlightDialog game={game} rally={rally} players={players ?? []} onClose={() => setHighlighting(false)} />
        )}

        {addingCam && <AddCamera game={game} onClose={() => setAddingCam(false)} />}
        {refreshing && <RefreshDetector game={game} cam={cam} onClose={() => setRefreshing(false)} />}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {cams.length > 1 && cams.map(c => (
            <button key={c.id} onClick={() => switchCam(c.id)}
              className={`rounded-md border px-2.5 py-1 font-semibold ${c.id === cam.id ? 'border-ball bg-ball/20 text-ball' : 'border-line text-muted'}`}>
              🎥 {cameraLabel(c)}
            </button>
          ))}
          {!samplePlayers && canEdit && <button onClick={() => setAddingCam(true)} className="rounded-md border border-dashed border-line px-2.5 py-1 text-muted">+ Add camera</button>}
          {!samplePlayers && canEdit && (
            <button onClick={() => setRefreshing(true)} className="rounded-md border border-dashed border-line px-2.5 py-1 text-muted"
              title={`Re-run the ${cam.name} camera's rally detector: refreshes its training examples and (back cameras) which end each serve came from. Rallies stay as they are.`}>⟳ Detector data</button>
          )}
          {cam.id !== 'main' && (
            <span className="ml-auto flex items-center gap-1 text-muted">
              <span title={cam.sync ? `Lined up by sound: ${cam.sync.matched} of ${cam.sync.total} contact sounds matched` : 'Not lined up by sound'}>
                {cam.offset >= 0 ? '+' : ''}{cam.offset.toFixed(2)} s{cam.sync ? ' · synced' : ''}
              </span>
              <button onClick={() => nudge(-0.1)} className="rounded border border-line px-1.5">−0.1</button>
              <button onClick={() => nudge(0.1)} className="rounded border border-line px-1.5">+0.1</button>
              <button onClick={removeCam} className="rounded border border-line px-1.5 text-bad" title="Remove this camera">✕</button>
            </span>
          )}
        </div>
        <div className="relative">
          <div ref={playerEl} className="aspect-video overflow-hidden rounded-xl bg-black" />
          {tapToPlay && (
            <button onClick={() => { playLinked(tapToPlay.i, tapToPlay.t); setTapToPlay(null); }}
              className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 text-lg font-semibold text-ink">
              <span className="rounded-full bg-ball px-5 py-3 text-bg">▶ Play rally {tapToPlay.i + 1} ({fmtTime(list[tapToPlay.i]?.s ?? 0)})</span>
            </button>
          )}
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-medium">
            {rally ? <>Rally {cur + 1} · {fmtTime(rally.s)}–{fmtTime(rally.e)}
              {canStar && <button onClick={() => setHighlighting(true)} className="rounded-md border border-ball/50 px-2 py-0.5 text-xs font-semibold text-ball">★ Highlight</button>}
              <ShareRally gameId={game.id} rally={rally} title={`${game.title} · rally ${cur + 1}`} />
            </> : <span className="text-muted">Tap a rally to play it</span>}
          </span>
          <span className="text-xs text-muted">
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? <span className="text-bad">Save failed</span> : ''}
          </span>
        </div>
        <TimeBar clock={clock} onSeek={seekFree} onSkip={skip} />
        {mode === 'watch' || mode === 'box' ? (
          <div className="grid grid-cols-4 gap-2">
            <button className={btn} disabled={cur <= 0} onClick={() => go(cur - 1)}>◀ Prev</button>
            <button className={btn} disabled={!rally} onClick={() => go(cur)}>↺ Replay</button>
            <button className={btn} disabled={cur >= list.length - 1} onClick={() => go(cur + 1)}>Next ▶</button>
            <AutoplaySwitch on={autoplay} onChange={v => { setAutoplay(v); if (v && cur < 0) go(0); }} className="py-2.5 text-sm font-semibold" />
          </div>
        ) : mode === 'tag' ? (
          <>
            <p className="hidden text-xs text-muted lg:block">Tag while it plays: tap names (or press 1–9, 0, G / H for guests) as each touch happens. Space = play/pause.</p>
            {rallyList(listEl2, 'hidden min-h-[8.125rem] flex-1 lg:block', true)}
          </>
        ) : (
          <div className="space-y-2">
            {rally && rally.st !== 'bad' && (
              teamsReady && reviewServer ? (
                <div className="rounded-lg bg-raised px-2 py-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      🏐 <b>{name(reviewServer)}</b> serves{serverTeam(reviewServer) && <span className="text-muted"> · Team {serverTeam(reviewServer)!.toUpperCase()}</span>}
                      {rally.touches?.[0]?.k === 'serve' && <span className="text-good"> · confirmed</span>}
                    </span>
                    <button className="shrink-0 rounded-md border border-line px-2 py-1 text-xs" onClick={() => setPickServer(!pickServer)}>{pickServer ? 'Cancel' : 'Change'}</button>
                  </div>
                  {pickServer && view && (
                    <div className="mt-1.5 space-y-1">
                      {TEAMS.map(t => (
                        <div key={t} className="flex flex-wrap items-center gap-1 text-xs">
                          <span className="w-12 text-muted">Team {t.toUpperCase()}</span>
                          {view.state[t].pos.filter(p => p && !isGuest(p)).map(p => (
                            <button key={p} onClick={() => chooseServer(p)} className="rounded-md border border-line bg-surface px-2 py-1 font-semibold">{name(p)}</button>
                          ))}
                          {view.state[t].pos.some(isGuest) && (
                            <button onClick={() => chooseServer(`guest-${t}`)} className="rounded-md border border-line bg-surface px-2 py-1 text-muted">Guest {t.toUpperCase()}</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : !teamsReady && (
                <button onClick={openTeams} className="w-full rounded-lg border border-dashed border-line px-2 py-1.5 text-xs text-muted">
                  Set up the teams to confirm each rally's server while reviewing →
                </button>
              )
            )}
            {serveOptions && rally?.st !== 'bad' ? (
              <div className="grid grid-cols-[auto_1fr_1fr] gap-2">
                <button className={`${btn} text-bad`} onClick={() => mark('bad')}>✗ Not a rally</button>
                {serveOptions.map((o, i) => {
                  const chosen = rally?.touches?.[0]?.k === 'serve' ? rally.touches[0].p === o.p : i === 0;
                  return (
                    <button key={o.won} onClick={() => good(o.p, undefined, serveOptions.length > 1 ? o.won : undefined)}
                      className={`${btn} ${chosen ? 'border-good text-good' : 'text-ink'}`}>
                      {'cam' in o && o.cam ? '📷 ' : '✓ '}{name(o.p)} {serveOptions.length > 1 ? (o.again ? 'again' : '· side-out') : 'serves'}
                      <span className="ml-1 hidden text-[10px] opacity-60 lg:inline">{i === 0 ? 'Y' : 'U'}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button className={`${btn} text-bad`} disabled={!rally} onClick={() => mark('bad')}>✗ Not a rally</button>
                <button className={`${btn} text-good`} disabled={!rally} onClick={() => good()}>
                  ✓ Good{teamsReady && reviewServer ? ` · ${name(reviewServer)} serves` : ''}
                </button>
              </div>
            )}
            <div className="grid grid-cols-5 gap-2">
              <button className={btn} disabled={cur <= 0} onClick={() => go(cur - 1)}>◀</button>
              <button className={btn} disabled={!rally} onClick={setStart} title="Set start to now">Start ⇤</button>
              <button className={btn} onClick={add} title="Add a missed rally starting now">+ Add</button>
              <button className={btn} disabled={!rally} onClick={setEnd} title="Set end to now">⇥ End</button>
              <button className={btn} disabled={cur >= list.length - 1} onClick={() => go(cur + 1)}>▶</button>
            </div>
            <p className="hidden text-xs text-muted lg:block">
              Pause at the right moment and tap Start ⇤ / ⇥ End to fix a clip; + Add creates a missed rally at the current time.
              Keys: Y good · X not a rally · [ start · ] end · A add · ←/→ rally · , / . ∓5s.
            </p>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex shrink-0 gap-1 rounded-xl bg-surface p-1">
          {(canEdit ? ['watch', 'review', 'tag', 'box'] as const : ['watch', 'box'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setCur(-1); }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === m ? 'bg-raised text-ink' : 'text-muted'}`}>
              {m === 'watch' ? 'Watch' : m === 'review' ? 'Review' : m === 'tag' ? 'Tag' : 'Box score'}
              {m === 'review' && unchecked ? <span className="font-normal"> ({unchecked})</span> : null}
              {m === 'tag' && untagged ? <span className="font-normal"> ({untagged})</span> : null}
            </button>
          ))}
        </div>

        {mode === 'tag' && (
          <TouchTagger rally={rally} players={players ?? []} name={name} now={now} onDone={nextUntagged}
            playing={() => player.current?.getPlayerState() === 1}
            togglePlay={() => { const p = player.current; if (!p) return; if (p.getPlayerState() === 1) p.pauseVideo(); else { setAtSug(null); p.playVideo(); } }}
            onChange={(ts, end) => { const added = ts.length > (rally?.touches?.length ?? 0); setTouches(ts, end); if (added && !end && atSug !== null) resume(); }}
            sug={step && atSug !== null && atSug === pending ? { t: pending, i: pendingIdx, n: sugs.length } : null}
            onSkip={skipSug}
            serve={view && rally && !rally.touches?.length ? {
              p: isGuest(server(view.state)) ? `guest-${view.state.serving}` : server(view.state), t: sugs[0] ?? rally.s,
              why: view.saved ? 'as set on the court' : view.first ? 'first rally' : view.lastWinner ? `Team ${view.lastWinner.toUpperCase()} won the last rally` : "couldn't tell who won the last rally: check the court",
              choices: TEAMS.flatMap(t => view.state[t].pos).filter(p => !isGuest(p)),
            } : null}
            onServer={p => view && setCourt(makeServer(view.state, p), `server changed to ${name(p)}`)}
            wonBy={view && rally ? rallyWinner(view.state, rally) : null}
            needTeams={!teamsReady}
            onTeams={openTeams}
            sameTeam={sameTeamIn(game)}
            onPrev={() => go(cur - 1)} onNext={() => go(cur + 1)} hasPrev={cur > 0} hasNext={cur < list.length - 1} />
        )}

        {mode === 'tag' && (
          game.peaks?.length
            ? <label className="flex shrink-0 items-center gap-2 px-1 text-xs text-muted">
                <input type="checkbox" checked={step} onChange={e => setStep(e.target.checked)} className="accent-[#f5c518]" />
                Pause at AI-suggested touches (experimental)
              </label>
            : <AddSuggestions gameId={game.id} />
        )}

        {showCourt && (
          <details className="shrink-0 rounded-xl border border-line bg-surface px-2 py-1.5 lg:hidden">
            <summary className="cursor-pointer text-xs text-muted">
              Rotation{view ? <>{rally && scoreAt.get(rally) && <> · <b className="text-ink">A {scoreAt.get(rally)!.before.a}–{scoreAt.get(rally)!.before.b} B</b></>}: 🏐 <b className="text-ink">{name(server(view.state))}</b> serves for Team {view.state.serving.toUpperCase()}</> : teamsReady ? '' : ': teams not set up yet'}
            </summary>
            <div className="mx-auto mt-2 max-w-[17rem]">
              <RotationPanel view={view} setup={setup} name={name} photo={id => players?.find(p => p.id === id)?.photo} tagged={!!rally && isTagged(rally)} notRally={rally?.st === 'bad'} onChange={setCourt} onSetup={openTeams} onEditRally={openTeamsFrom}
              score={rally ? scoreAt.get(rally)?.before : undefined} missed={rally ? notCounted(liveRallies.indexOf(rally)) : 0} />
            </div>
          </details>
        )}

        {mode === 'review' && !game.reviewed && (
          <button className="shrink-0 rounded-lg bg-ball py-2 text-sm font-semibold text-bg"
            onClick={async () => { await updateGame(game.id, { reviewed: true }); logHistory(game.id, user, ['Finished review']).catch(() => {}); setMode('watch'); setCur(-1); }}>
            Finish review{unchecked ? ` (${unchecked} still unchecked)` : ''}
          </button>
        )}

        {mode === 'box' && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {sheet && sheet.length > 0 && (
              <div className="rounded-xl border border-line bg-surface px-3 py-2 text-center">
                <div className="font-display text-2xl font-bold tabular-nums">Team A {sheet[sheet.length - 1].after.a} – {sheet[sheet.length - 1].after.b} Team B</div>
                <p className="text-[11px] text-muted">
                  Score from the tags{setup?.score && (setup.score.a || setup.score.b) ? `, starting at ${setup.score.a}–${setup.score.b}` : ''}
                  {notCounted(sheet.length) ? ` · ${notCounted(sheet.length)} untagged ${notCounted(sheet.length) === 1 ? 'rally' : 'rallies'} not counted` : ''}
                </p>
              </div>
            )}
            {match && <MatchCard result={match} players={players ?? []} />}
            <BoxScore game={{ ...game, rallies }} players={players ?? []} />
            {canDelete && <RatingChanges game={game} />}
          </div>
        )}

        {rallyList(listEl, `${mode === 'box' ? 'hidden' : ''} ${mode === 'tag' ? 'lg:hidden' : ''} min-h-40 flex-1`)}
      </div>

      {showCourt && (
        <div className="hidden min-h-0 overflow-y-auto lg:block">
          <div className="rounded-xl border border-line bg-surface p-2">
            <RotationPanel view={view} setup={setup} name={name} photo={id => players?.find(p => p.id === id)?.photo} tagged={!!rally && isTagged(rally)} notRally={rally?.st === 'bad'} onChange={setCourt} onSetup={openTeams} onEditRally={openTeamsFrom}
              score={rally ? scoreAt.get(rally)?.before : undefined} missed={rally ? notCounted(liveRallies.indexOf(rally)) : 0} />
          </div>
        </div>
      )}
    </div>
  );
}

/** The live court for the rally being tagged: checked by the reviewer, fixed by dragging or rotating. */
function RotationPanel({ view, setup, name, photo, tagged, notRally, onChange, onSetup, onEditRally, score, missed }: {
  view: CourtView | null; setup: CourtSetup | null; name: (id?: string) => string; photo?: (id: string) => string | undefined; tagged: boolean; notRally?: boolean;
  score?: { a: number; b: number }; missed: number;  // score before this rally; earlier rallies left out of it
  onChange: (c: CourtState, what: string, manual?: boolean) => void; onSetup: () => void; onEditRally: () => void;
}) {
  if (!setupReady(setup)) return (
    <div className="space-y-2 p-1 text-sm">
      <p className="text-muted">Put both teams on the court before tagging: who starts at positions 1–6, the subs, and roles.</p>
      <button onClick={onSetup} className="w-full rounded-lg bg-ball py-2 font-semibold text-bg">Set up teams</button>
    </div>
  );
  const shown = view?.state ?? startCourt(setup);
  const status = notRally ? 'Marked "not a rally": no court' : !view ? 'Starting positions · pick a rally'
    : view.manual ? '✓ Changed by hand'
    : tagged ? '✓ Tagged' : 'Auto: check it matches the video';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-sm font-semibold">Rotation</span>
        <span className={`truncate text-[11px] ${view?.manual || tagged ? 'text-good' : 'text-muted'}`}>{status}</span>
      </div>
      {view && score && (
        <div className="rounded-lg bg-raised px-2 py-1.5 text-center">
          <div className="font-display text-xl font-bold tabular-nums">
            <span className={shown.serving === 'a' ? 'text-ball' : ''}>A {score.a}</span>
            <span className="mx-2 text-muted">–</span>
            <span className={shown.serving === 'b' ? 'text-ball' : ''}>{score.b} B</span>
          </div>
          <div className="text-[10px] text-muted">
            Score before this rally{missed > 0 ? ` · ${missed} earlier ${missed === 1 ? 'rally' : 'rallies'} not tagged, not counted` : ''}
          </div>
        </div>
      )}
      <Court c={shown} name={id => name(id)} photo={photo} controls={!!view}
        onChange={view ? (c, what) => onChange(c, what ?? 'changed the court') : undefined} />
      {view?.mismatch && (
        <button onClick={() => onChange(view.derived, 'undid the court changes', false)}
          className="w-full rounded-md border border-line px-2 py-1.5 text-xs text-muted">
          Undo changes: back to the rotation ({name(server(view.derived))} serving)
        </button>
      )}
      <p className="px-0.5 text-[11px] text-muted">
        Drag a sub onto a player (or tap one, then the other) to swap them. Changes apply from this rally on.
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-0.5 text-xs">
        {view && <button onClick={onEditRally} className="text-ball" title="Rotation or roles changed mid-set: re-enter the teams as they stand now">Edit teams from this rally</button>}
        <button onClick={onSetup} className="text-muted">Edit starting teams</button>
      </div>
    </div>
  );
}

/** Older games have no contact-sound data: read just the audio of the original file to add it. */
function AddSuggestions({ gameId }: { gameId: string }) {
  const [status, setStatus] = useState('');
  if (!detectorSupported()) return null;
  return (
    <div className="shrink-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <p className="text-muted">
        Turn on <b className="text-ink">suggested touches</b> for this game: pick the original video file. Only its sound
        is read (about a minute), nothing is uploaded.
      </p>
      <label className="mt-2 inline-block cursor-pointer rounded-lg bg-ball px-3 py-1.5 font-semibold text-bg">
        Choose video file
        <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden" onChange={async e => {
          const f = e.target.files?.[0];
          if (!f) return;
          setStatus('Listening for ball contacts…');
          try {
            const res = await runDetector(f, () => {}, undefined, true).result;
            await updateGame(gameId, { peaks: res.peaks });
            setStatus('');
          } catch (err) {
            setStatus('Failed: ' + (err as Error).message);
          }
        }} />
      </label>
      {status && <p className="mt-1 text-xs text-muted">{status}</p>}
    </div>
  );
}

// Box score columns: [header, tooltip, value from a player's counts]
type C = Record<StatKey, number>;
const hit = (c: C) => (c.attack ? `${Math.round(((c.kill - c.aerr - c.blocked) / c.attack) * 100)}%` : '–');
const BOX: [string, string, (c: C) => number | string][] = [
  ['PTS', 'Points: kills + aces + block points + set-over points', c => c.kill + c.ace + c.blockpt + c.setpt],
  ['K', 'Kills', c => c.kill],
  ['ATT', 'Attacks', c => c.attack],
  ['AE', 'Attack errors', c => c.aerr],
  ['BLKD', 'Times blocked', c => c.blocked],
  ['HIT', 'Hitting efficiency', hit],
  ['FB', 'Free balls sent over', c => c.free],
  ['SET', 'Sets', c => c.set],
  ['A', 'Assists', c => c.assist],
  ['SO', 'Set-over points: sets that went over and won the point', c => c.setpt],
  ['SQ', 'Set quality: average grade (good 3, OK 2, poor 1)', c => avgGrade(c.set3, c.set2, c.set1)],
  ['SA', 'Aces', c => c.ace],
  ['SV', 'Serves', c => c.serve],
  ['SE', 'Serve errors', c => c.serr],
  ['REC', 'Receives', c => c.receive],
  ['RE', 'Reception errors', c => c.rerr],
  ['DIG', 'Digs', c => c.dig],
  ['PASS', 'Pass rating: average grade of receives + digs (perfect 3, OK 2, poor 1)', c => avgGrade(c.pass3, c.pass2, c.pass1)],
  ['BLK', 'Block touches', c => c.block],
  ['BS', 'Block points', c => c.blockpt],
  ['ERR', 'All errors', c => c.serr + c.aerr + c.rerr + c.oerr],
];

/** Per-player stats for this game, from whatever rallies have been tagged so far. */
function BoxScore({ game, players }: { game: Game; players: Player[] }) {
  const live = game.rallies.filter(r => r.st !== 'bad');
  const tagged = live.filter(isTagged).length;
  const stats = computeStats([game]);
  const ids = Object.keys(stats);
  if (!tagged || !ids.length) return (
    <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
      No stats yet. Tag rallies in the <b className="text-ink">Tag</b> tab and the box score fills in.
    </div>
  );
  const counts = (id: string) => Object.fromEntries(Object.entries(stats[id]).map(([k, v]) => [k, v.length])) as C;
  const total = ids.reduce((t, id) => { const c = counts(id); (Object.keys(c) as StatKey[]).forEach(k => t[k] = (t[k] ?? 0) + c[k]); return t; }, {} as C);
  const rows = ids.map(id => ({ id, name: players.find(p => p.id === id)?.name ?? id, c: counts(id) }))
    .sort((a, b) => (BOX[0][2](b.c) as number) - (BOX[0][2](a.c) as number) || a.name.localeCompare(b.name));
  return (
    <div className="overflow-auto rounded-xl border border-line bg-surface">
      <p className="px-3 pt-2 text-xs text-muted">From {tagged} of {live.length} rallies tagged · guests not shown</p>
      <table className="w-full text-sm tabular-nums">
        <thead className="sticky top-0 bg-surface text-[11px] text-muted">
          <tr>
            <th className="sticky left-0 bg-surface px-3 py-2 text-left font-normal">Player</th>
            {BOX.map(([h, tip]) => <th key={h} title={tip} className="px-1.5 py-2 text-right font-normal">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, c }) => (
            <tr key={id} className="border-t border-line">
              <td className="sticky left-0 bg-surface px-3 py-1.5 font-medium whitespace-nowrap">
                {players.find(p => p.id === id)?.photo && <span className="clean-only mr-2 align-middle"><Avatar name={name} photo={players.find(p => p.id === id)?.photo} size={20} ring={0} /></span>}{name}
              </td>
              {BOX.map(([h, , f], i) => (
                <td key={h} className={`px-1.5 py-1.5 text-right ${i === 0 ? 'font-bold text-ball' : ''} ${f(c) === 0 ? 'text-muted/50' : ''}`}>{f(c)}</td>
              ))}
            </tr>
          ))}
          <tr className="border-t-2 border-line font-semibold">
            <td className="sticky left-0 bg-surface px-3 py-1.5">Total</td>
            {BOX.map(([h, , f]) => <td key={h} className="px-1.5 py-1.5 text-right">{f(total)}</td>)}
          </tr>
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] leading-relaxed text-muted">
        PTS points · K kills · ATT attacks · AE attack errors · BLKD times blocked · HIT hitting efficiency · FB free balls · SET sets · A assists · SO set-over points ·
        SQ set quality (1–3) · SA aces · SV serves · SE serve errors · REC receives · RE reception errors · DIG digs · PASS pass rating (1–3) ·
        BLK block touches · BS block points · ERR all errors
      </p>
    </div>
  );
}

const STRENGTHS = [0, 0.5, 1, 1.5, 2];
const ATTR_LABEL = Object.fromEntries(CATEGORIES.flatMap(c => c.attrs.map(([k, l]) => [k, l]))) as Record<string, string>;

/**
 * Admin: what this game does to everyone's ratings, with a strength per player, then apply / undo.
 * Strength scales how much this game counts for that player (stats and experience).
 */
function RatingChanges({ game }: { game: Game }) {
  const auth = useAuth();
  const user = auth?.user ?? null;
  const games = useGames();
  const { players } = usePlayers();
  const settings = useEngineSettings();
  const applied = !game.rating || game.rating.applied;
  const [weights, setWeights] = useState<Record<string, number>>(game.rating?.weights ?? {});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { setWeights(game.rating?.weights ?? {}); }, [JSON.stringify(game.rating?.weights)]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!games || !players) return null;

  const inGame = Object.keys(computeStats([game]));
  if (!inGame.length || !game.rallies.some(r => r.touches?.length && r.end)) return (
    <section className="rounded-xl border border-line bg-surface p-3 text-sm text-muted">
      <h2 className="font-semibold text-ink">Rating changes</h2>
      Tag rallies touch-by-touch to see how this game changes ratings.
    </section>
  );
  const w = (id: string) => weights[id] ?? 1;
  const full = Object.fromEntries(inGame.map(id => [id, w(id)]));
  const before = buildModel(games, settings, { gameId: game.id, weights: null });
  const after = buildModel(games, settings, { gameId: game.id, weights: full });
  const rate = (m: RatingModel, id: string) => {
    const p = players.find(x => x.id === id)!;
    const r = effectiveRatings(p, m);
    return { r, ovr: overall(r, p.positions[0] ?? 'OH') };
  };
  const rows = inGame.filter(id => players.some(p => p.id === id)).map(id => {
    const b = rate(before, id), a = rate(after, id);
    const attrs = Object.keys(a.r).map(k => ({ k, from: b.r[k] ?? 0, to: a.r[k] ?? 0 })).filter(x => x.from !== x.to);
    return { id, name: players.find(p => p.id === id)!.name, from: b.ovr, to: a.ovr, attrs };
  }).sort((x, y) => ((y.to ?? 0) - (y.from ?? 0)) - ((x.to ?? 0) - (x.from ?? 0)));
  const dirty = JSON.stringify(full) !== JSON.stringify(Object.fromEntries(inGame.map(id => [id, game.rating?.weights?.[id] ?? 1])));

  async function save(nextApplied: boolean) {
    setBusy('Saving…');
    await createBackup(`Before ${nextApplied ? (applied ? 'updating' : 'applying') : 'undoing'} "${game.title}" (${game.date})`,
      user?.email ?? '', players!, settings, games!);
    await setGameRating(game.id, nextApplied ? { applied: true, weights: full, by: auth.name } : { applied: false });
    const nm = (pid: string) => players!.find(p => p.id === pid)?.name ?? pid;
    const odd = Object.entries(full).filter(([, x]) => x !== 1).map(([pid, x]) => `${nm(pid)} ${x}×`);
    logHistory(game.id, user, [nextApplied ? `Applied to ratings${odd.length ? ` (${odd.join(', ')}; others 1×)` : ' (everyone 1×)'}` : 'Removed from ratings']).catch(() => {});
    setBusy('');
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Rating changes from this game</h2>
          <p className="text-xs text-muted">
            {applied ? (game.rating ? 'Applied: counts toward ratings.' : 'Counted at 1× (added before approvals).')
              : 'Not applied yet: ratings ignore this game until you apply it.'}
            {' '}Strength = how much this game counts for that player.
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${applied ? 'bg-good/20 text-good' : 'bg-ball/20 text-ball'}`}>{applied ? 'applied' : 'pending'}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted">Set all:</span>
        {STRENGTHS.map(x => (
          <button key={x} className="rounded-md border border-line px-2 py-0.5" onClick={() => setWeights(Object.fromEntries(inGame.map(id => [id, x])))}>{x}×</button>
        ))}
      </div>
      <ul className="mt-2 divide-y divide-line text-sm">
        {rows.map(row => {
          const d = (row.to ?? 0) - (row.from ?? 0);
          return (
            <li key={row.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <button className="min-w-0 flex-1 truncate text-left font-medium" onClick={() => setOpen(open === row.id ? null : row.id)}>
                  {row.name} <span className="text-xs text-muted">{open === row.id ? '▾' : '▸'} {row.attrs.length} attribute{row.attrs.length === 1 ? '' : 's'}</span>
                </button>
                <span className="tabular-nums">{row.from ?? '–'} → <b>{row.to ?? '–'}</b>
                  {d !== 0 && <span className={`ml-1 text-xs ${d > 0 ? 'text-good' : 'text-bad'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>}
                </span>
                <span className="flex gap-0.5">
                  {STRENGTHS.map(x => (
                    <button key={x} onClick={() => setWeights({ ...weights, [row.id]: x })}
                      className={`rounded px-1.5 py-0.5 text-[11px] ${w(row.id) === x ? 'bg-ball font-semibold text-bg' : 'bg-raised text-muted'}`}>{x}×</button>
                  ))}
                </span>
              </div>
              {open === row.id && (
                <div className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-muted sm:grid-cols-3">
                  {row.attrs.length ? row.attrs.map(a => (
                    <span key={a.k}>{ATTR_LABEL[a.k] ?? a.k}: {a.from} → <b className={a.to > a.from ? 'text-good' : 'text-bad'}>{a.to}</b></span>
                  )) : <span>No attribute changes.</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {(!applied || dirty) && (
          <button className="rounded-lg bg-ball px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40" disabled={!!busy} onClick={() => save(true)}>
            {busy || (applied ? 'Update strengths' : 'Apply to ratings')}
          </button>
        )}
        {applied && (
          <button className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-40" disabled={!!busy}
            onClick={() => { if (confirm('Stop counting this game toward ratings?')) save(false); }}>Undo (stop counting)</button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted">A backup of all ratings is saved automatically before each change (Admin → Ratings → Backups).</p>
    </section>
  );
}

/** Who changed what in this game, newest first. */
function HistoryDialog({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const list = useHistory(gameId, true);
  const fmt = (d?: Date) => d ? d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'just now';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="max-h-[80dvh] w-full max-w-lg overflow-hidden rounded-t-2xl border border-line bg-surface sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">Edit history</h2>
          <button onClick={onClose} className="text-muted">Close</button>
        </div>
        <div className="max-h-[calc(80dvh-3.5rem)] overflow-y-auto px-4 py-2">
          {list === null ? <p className="py-4 text-sm text-muted">Loading…</p>
            : !list.length ? <p className="py-4 text-sm text-muted">No edits recorded yet. Changes made from now on show up here.</p>
            : list.map(h => (
              <div key={h.id} className="border-b border-line py-2 last:border-0">
                <div className="flex justify-between gap-2 text-xs">
                  <b className="truncate">{h.name}</b>
                  <span className="shrink-0 text-muted">{fmt(h.at?.toDate())}</span>
                </div>
                <ul className="mt-1 space-y-0.5 text-sm text-muted">
                  {h.changes.map((c, i) => <li key={i}>• {c}</li>)}
                </ul>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/** Bookmark the whole rally to a player's profile (default: yourself). */
const POS_NAMES = ['back right', 'front right', 'front middle', 'front left', 'back left', 'back middle'];

/** First empty starting spot (positions 1 → 6, team A first unless told otherwise), else that team's subs. */
function nextSpot(c: CourtState, prefer: Team): string {
  for (const t of [prefer, prefer === 'a' ? 'b' : 'a'] as Team[]) {
    const i = c[t].pos.findIndex(p => !p);
    if (i >= 0) return `${t}.pos.${i}`;
  }
  return `${prefer}.bench.end`;
}

/** Set up the two teams for the first rally: tap a spot (1 → 6 goes automatically), then the player there. */
/** The game's video inside the team setup, opened at the first rally, to see who stands where. */
function SetupVideo({ youtubeId, offset, start, name }: { youtubeId: string; offset: number; start: number; name: string }) {
  const el = useRef<HTMLDivElement>(null);
  const p = useRef<YTPlayer | null>(null);
  useEffect(() => {
    if (!el.current) return;
    let dead = false;
    const host = document.createElement('div');
    el.current.replaceChildren(host);
    createPlayer(host, youtubeId).then(pl => {
      if (dead) { pl.destroy(); return; }
      p.current = withOffset(pl, () => offset);
      // show the first rally's opening frame: play a moment (a paused video shows no picture until it has
      // decoded one), then pause there
      p.current.seekTo(start, true);
      p.current.playVideo();
      setTimeout(() => { if (!dead) p.current?.pauseVideo(); }, 700);
    });
    return () => { dead = true; p.current?.destroy(); p.current = null; };
  }, [youtubeId, offset, start]);
  const b = 'rounded-md border border-line bg-raised px-2 py-1';
  const seek = (d: number) => { const q = p.current; if (q) q.seekTo(Math.max(0, q.getCurrentTime() + d), true); };
  return (
    <div className="space-y-1.5">
      <div ref={el} className="aspect-video overflow-hidden rounded-lg bg-black" />
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="mr-auto text-muted">🎥 {name}</span>
        <button className={b} onClick={() => { p.current?.seekTo(start, true); p.current?.playVideo(); }}>⏮ First rally</button>
        <button className={b} onClick={() => seek(-5)}>−5s</button>
        <button className={b} onClick={() => seek(-1)}>−1s</button>
        <button className={b} onClick={() => { const q = p.current; if (q) { if (q.getPlayerState() === 1) q.pauseVideo(); else q.playVideo(); } }}>⏯</button>
        <button className={b} onClick={() => seek(1)}>+1s</button>
        <button className={b} onClick={() => seek(5)}>+5s</button>
      </div>
    </div>
  );
}

function TeamsDialog({ game, players, onClose, video, fromRally }: {
  game: Game; players: Player[]; onClose: () => void;
  video: { youtubeId: string; offset: number; start: number; name: string };
  // re-enter the teams at a rally mid-set: starts from that rally's court, saves only from that rally on
  fromRally?: { label: string; state: CourtState; onSave: (c: CourtState) => void };
}) {
  const user = useAuth()?.user ?? null;
  const games = useGames();
  const blank: CourtSetup = { a: emptySide(), b: emptySide(), serving: 'a' };
  const initial = (): CourtSetup => (fromRally ? courtOnly(fromRally.state) : gameSetup(game) ?? blank);
  const [c, setC] = useState<CourtSetup>(() => tidy(initial()));
  const [target, setTarget] = useState<string>(() => nextSpot(initial(), 'a'));
  const [busy, setBusy] = useState(false);
  const name = (id: string) => id === 'guest' ? 'Guest' : players.find(p => p.id === id)?.name ?? id;
  const used = new Set(TEAMS.flatMap(t => [...c[t].pos, ...c[t].bench]).filter(p => p && p !== 'guest'));
  const prev = (games ?? []).filter(g => g.id !== game.id && setupReady(gameSetup(g)) && (g.date + g.title) <= (game.date + game.title))
    .sort((x, y) => (y.date + y.title).localeCompare(x.date + x.title))[0] ?? null;
  const tTeam = target.split('.')[0] as Team;
  const tSpot = target.split('.')[1] === 'pos' ? Number(target.split('.')[2]) : -1;
  const tPlayer = tSpot >= 0 ? c[tTeam].pos[tSpot] : '';
  const tSub = target.split('.')[1] === 'bench' && target.split('.')[2] !== 'end' ? Number(target.split('.')[2]) : -1;
  const tSubPlayer = tSub >= 0 ? c[tTeam].bench[tSub] ?? '' : '';

  const place = (id: string) => {
    const t = tTeam;
    const n: CourtSetup = { ...c, [t]: { ...c[t], pos: [...c[t].pos], bench: [...c[t].bench] } };
    if (tSpot >= 0) n[t].pos[tSpot] = id;
    else if (tSubPlayer) n[t].bench[tSub] = id;
    else n[t].bench.push(id);
    setC(tidy(n));
    setTarget(tSubPlayer ? `${t}.bench.end` : nextSpot(n, t));
  };
  const removeSub = () => {
    if (!tSubPlayer) return;
    setC(tidy({ ...c, [tTeam]: { ...c[tTeam], bench: c[tTeam].bench.filter((_, i) => i !== tSub) } }));
    setTarget(`${tTeam}.bench.end`);
  };
  const clearSpot = () => {
    if (tSpot < 0) return;
    setC(tidy({ ...c, [tTeam]: { ...c[tTeam], pos: c[tTeam].pos.map((p, i) => i === tSpot ? '' : p) } }));
  };
  // the extra middle must be on the bench; nobody starts subbed in for the libero
  function tidy(x: CourtSetup): CourtSetup {
    const fix = (sd: CourtSetup['a']) => {
      const { mb: mb0, lib, mid: _m, l6, l6front, l6serve, ...rest } = sd;
      // the libero starts on the bench: the middle standing in the libero's spot is the one they swap with
      let mb = mb0;
      if (lib && sd.bench.includes(lib) && !(mb && mb !== lib && (sd.bench.includes(mb) || sd.pos.includes(mb)))) {
        const o = sd.pos[sd.roles.indexOf('L')];
        mb = o && o !== lib ? o : undefined;
      }
      // a libero needs a 7th player (the libero plus both middles): six players means no libero
      const seven = sd.pos.filter(Boolean).length + sd.bench.length >= 7;
      if (mb && seven && (sd.bench.includes(mb) || sd.pos.includes(mb))) {
        // an extra middle (on the bench, or on court when editing mid-set): the team plays with a libero
        // (chosen, or whoever stands in the back-row middle spot)
        const l = lib && lib !== mb && (sd.pos.includes(lib) || sd.bench.includes(lib)) ? lib : likelyLibero({ ...sd, mb }) ?? '';
        return { ...rest, mb, ...(l ? { lib: l } : {}) };
      }
      if (!sd.pos.every(Boolean)) return rest;  // decide once all six are placed
      // no extra middle, so no libero: pick the libero-type player (Darius by default) if he's on court
      const pick = l6 !== undefined && (l6 === '' || sd.pos.includes(l6)) ? l6
        : sd.pos.find(p => BACK_COURT_PLAYERS.includes(p)) ?? '';
      return { ...rest, l6: pick, ...(pick && l6front ? { l6front: true } : {}), ...(pick && !l6front && l6serve ? { l6serve } : {}) };
    };
    return { ...x, a: fix(x.a), b: fix(x.b) };
  }
  const setMb = (t: Team, id: string | null) => setC(x => tidy({ ...x, [t]: { ...x[t], mb: id ?? undefined, ...(id && x[t].lib === id ? { lib: undefined } : {}) } }));
  // a sub who is the libero (starting on the bench while a middle plays in their place)
  const setLib = (t: Team, id: string | null) => setC(x => tidy({ ...x, [t]: { ...x[t], lib: id ?? undefined, mb: id ? undefined : x[t].mb } }));
  const setL6 = (t: Team, id: string, front: boolean, serve?: 'partner') => setC(x => tidy({ ...x, [t]: { ...x[t], l6: id, l6front: front, l6serve: serve } }));
  // the player opposite the back-court player (who he swaps with): the other middle, or the setter
  const partnerOf = (t: Team) => { const s = c[t], i = s.l6 ? s.pos.indexOf(s.l6) : -1; return i >= 0 ? s.pos[(i + 3) % 6] : ''; };
  const sixes = TEAMS.filter(t => !c[t].mb && c[t].pos.every(Boolean));  // teams without a libero
  const ok = setupReady(c);

  const save = async () => {
    if (fromRally) {  // a lineup change at this rally: saved on the rally, the starting teams stay as they are
      const { score: _s, ...lineup } = c;
      fromRally.onSave(assignMiddles(lineup));
      onClose();
      return;
    }
    setBusy(true);
    await updateGame(game.id, { court: c });
    const desc = (t: Team) => c[t].pos.map((p, i) => `${i + 1} ${name(p)}`).join(', ') + (c[t].bench.length ? `; subs ${c[t].bench.map(name).join(', ')}` : '');
    logHistory(game.id, user, [`Set the starting teams: A ${desc('a')} · B ${desc('b')} · Team ${c.serving.toUpperCase()} serves first`]).catch(() => {});
    onClose();
  };
  const chip = 'rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm font-semibold active:scale-[0.97]';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="max-h-[94dvh] w-full max-w-6xl overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 sm:rounded-2xl lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-5" onClick={e => e.stopPropagation()}>
        {/* left: the video with the court under it; right: names and settings */}
        <div className="mb-3 space-y-3 lg:mb-0">
          <SetupVideo {...video} />
          <p className="text-[11px] text-muted">Pause on the first serve: the server is at position 1. Then go round anticlockwise.</p>
          <div className="mx-auto w-full max-w-[17rem]">
            <Court c={c} name={name} photo={id => players.find(p => p.id === id)?.photo} allowEmpty target={target}
              onSlot={k => setTarget(k)} onChange={x => setC(tidy({ ...c, ...x }))} />
          </div>
        </div>
        <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">{fromRally ? `Teams from ${fromRally.label}` : 'Starting teams'}</h2>
            <p className="mt-0.5 text-sm text-muted">
              {fromRally
                ? 'Who stands where at this rally, after a change of rotation or roles. It applies from this rally on, and later rallies follow it; the starting teams stay as they are.'
                : 'Who stands where at the first rally.'} Positions go 1 → 6 anticlockwise from back right; 1 serves.
            </p>
          </div>
          {!fromRally && prev && <button className="shrink-0 rounded-md border border-line px-2 py-1 text-xs" onClick={() => { const { score: _s, ...rest } = gameSetup(prev)!; const x = tidy(rest); setC(x); setTarget(nextSpot(x, 'a')); }}>Copy from {prev.title}</button>}
        </div>
        <div className="mt-3">
          <div className="min-w-0 space-y-3">
            <div className="rounded-lg bg-raised px-3 py-2 text-sm">
              {tSpot >= 0
                ? <>Team <b>{tTeam.toUpperCase()}</b>, position <b>{tSpot + 1}</b> ({POS_NAMES[tSpot]}): {tPlayer ? <>now <b>{name(tPlayer)}</b>, tap someone to replace</> : 'tap who stands there'}</>
                : tSubPlayer ? <>Team <b>{tTeam.toUpperCase()}</b> sub <b>{name(tSubPlayer)}</b>: tap someone to replace, or</>
                : <>Team <b>{tTeam.toUpperCase()}</b> subs: tap players to add them (tap a sub on the left to change or remove it)</>}
              {tPlayer && <button className="ml-2 text-xs text-bad underline" onClick={clearSpot}>clear</button>}
              {tSubPlayer && <button className="ml-2 rounded-md border border-bad/50 px-2 py-0.5 text-xs text-bad" onClick={removeSub}>Remove from subs</button>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {players.filter(p => !used.has(p.id)).map(p => <button key={p.id} className={chip} onClick={() => place(p.id)}>{p.name}</button>)}
              <button className={`${chip} text-muted`} onClick={() => place('guest')}>Guest</button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {TEAMS.map(t => <button key={t} onClick={() => setTarget(`${t}.bench.end`)} className="rounded-md border border-line px-2 py-1">+ Team {t.toUpperCase()} sub</button>)}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">{fromRally ? 'Serving at this rally' : 'First serve'}</span>
              {TEAMS.map(t => (
                <button key={t} onClick={() => setC({ ...c, serving: t })}
                  className={`rounded-md border px-3 py-1 ${c.serving === t ? 'border-ball bg-ball/20 text-ball' : 'border-line text-muted'}`}>Team {t.toUpperCase()}</button>
              ))}
            </div>
            {!fromRally && <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">Score at this clip's first rally</span>
              {TEAMS.map(t => (
                <label key={t} className="flex items-center gap-1">
                  <span className="text-xs text-muted">{t.toUpperCase()}</span>
                  <input type="number" min={0} max={99} inputMode="numeric" value={c.score?.[t] ?? 0}
                    onChange={e => { const v = Math.max(0, Math.min(99, Number(e.target.value) || 0)); setC(x => ({ ...x, score: { a: x.score?.a ?? 0, b: x.score?.b ?? 0, [t]: v } })); }}
                    className="w-14 rounded-md border border-line bg-raised px-2 py-1 text-ink outline-none focus:border-ball" />
                </label>
              ))}
            </div>}
            <div className="space-y-1.5 rounded-lg border border-line p-2">
              <p className="text-xs text-muted">
                Role at position 1; the rest follow (shown on the court). A set starts with OH1 at 1. MB1 is the middle who
                starts the set at 3; MB2 is the other middle (the libero plays that spot). If the clip starts mid-set, pick what's at 1 now.
              </p>
              {TEAMS.map(t => {
                const k = Math.max(0, rotationOf(c[t].roles));
                const setK = (j: number) => setC(x => tidy({ ...x, [t]: { ...x[t], roles: rolesAt(j) } }));
                const sel = 'rounded-md border border-line bg-raised px-1.5 py-1 text-ink outline-none';
                const label = (j: number) => (j === 5 ? 'MB2 / L' : ROLE_NAMES[j]);
                return (
                  <div key={t} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="w-14 text-muted">Team {t.toUpperCase()}</span>
                    <span>Position 1</span>
                    {/* each role is always followed by the same one, so position 1 fixes the whole rotation */}
                    <select className={sel} value={k} onChange={e => setK(Number(e.target.value))}>
                      {[0, 1, 2, 3, 4, 5].map(j => <option key={j} value={j}>{label(j)}</option>)}
                    </select>
                    {k === 0 && <span className="text-muted">start of a set</span>}
                  </div>
                );
              })}
              <p className="text-[11px] text-muted">Players who swap spots mid-game swap roles; a sub takes the role of whoever they replace.</p>
            </div>
            {sixes.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-line p-2">
                <p className="text-xs text-muted">No extra middle marked: no libero, so that spot plays middle (two MBs).</p>
                {sixes.map(t => (
                  <div key={t} className="space-y-1 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-14 text-muted">Team {t.toUpperCase()}</span>
                      <span className="text-muted">Back-court player</span>
                      <select value={c[t].l6 ?? ''} onChange={e => setL6(t, e.target.value, !!c[t].l6front, c[t].l6serve)}
                        className="rounded-md border border-line bg-raised px-1.5 py-1 text-ink outline-none">
                        <option value="">None</option>
                        {c[t].pos.filter(p => p && p !== 'guest').map(p => <option key={p} value={p}>{name(p)}</option>)}
                      </select>
                    </div>
                    {c[t].l6 && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-[3.875rem]">
                        <span className="text-muted">Plays front court?</span>
                        {[false, true].map(f => (
                          <button key={String(f)} onClick={() => setL6(t, c[t].l6!, f, c[t].l6serve)}
                            className={`rounded-md border px-2 py-1 ${!!c[t].l6front === f ? 'border-ball bg-ball/20 text-ball' : 'border-line text-muted'}`}>
                            {f ? 'Yes (L/MB)' : `No: swaps with ${partnerOf(t) ? name(partnerOf(t)) : 'the player opposite'} at the front row`}
                          </button>
                        ))}
                      </div>
                    )}
                    {c[t].l6 && !c[t].l6front && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-[3.875rem]">
                        <span className="text-muted">When {partnerOf(t) ? name(partnerOf(t)) : 'his partner'} is at 1 to serve</span>
                        {([undefined, 'partner'] as const).map(v => (
                          <button key={v ?? 'l6'} onClick={() => setL6(t, c[t].l6!, false, v)}
                            className={`rounded-md border px-2 py-1 ${c[t].l6serve === v ? 'border-ball bg-ball/20 text-ball' : 'border-line text-muted'}`}>
                            {v ? `${partnerOf(t) ? name(partnerOf(t)) : 'Partner'} serves, then they swap` : `${name(c[t].l6!)} serves instead`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {TEAMS.some(t => c[t].bench.length > 0) && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted">
                  Is a sub the <b className="text-ink">extra middle</b> (MB) or the <b className="text-ink">libero</b> (L)? Either way the team plays
                  with a libero. Leave both off for ordinary subs.
                </p>
                {TEAMS.filter(t => c[t].bench.length).map(t => (
                  <div key={t} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="w-14 text-muted">Team {t.toUpperCase()}</span>
                    {[...new Set(c[t].bench)].map(p => {
                      const isMb = c[t].mb === p, isLib = c[t].lib === p;
                      const seg = (on: boolean) => `px-2 py-1 ${on ? 'bg-ball/20 text-ball' : 'text-muted'}`;
                      return (
                        <span key={p} className={`inline-flex items-center overflow-hidden rounded-md border ${isMb || isLib ? 'border-ball' : 'border-line'}`}>
                          <span className="px-2 py-1 text-ink">{name(p)}</span>
                          <button className={seg(isMb)} onClick={() => setMb(t, isMb ? null : p)}>MB</button>
                          {p !== 'guest' && <button className={seg(isLib)} onClick={() => setLib(t, isLib ? null : p)}>L</button>}
                        </span>
                      );
                    })}
                  </div>
                ))}
                {TEAMS.filter(t => c[t].mb).map(t => {
                  const start = startCourt(c)[t];
                  const benched = start.mid && start.lib ? [start.mid[0], start.mid[1], start.lib].find(p => start.bench.includes(p)) : undefined;
                  return (
                    <div key={t} className="space-y-1 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="w-14 text-muted">Team {t.toUpperCase()}</span>
                        <span className="text-muted">Libero</span>
                        <select value={c[t].lib ?? ''} onChange={e => setC(x => tidy({ ...x, [t]: { ...x[t], lib: e.target.value } }))}
                          className="rounded-md border border-line bg-raised px-1.5 py-1 text-ink outline-none">
                          {[...new Set([...c[t].pos, ...c[t].bench])].filter(p => p && p !== c[t].mb).map(p => <option key={p} value={p}>{name(p)}</option>)}
                        </select>
                      </div>
                      {start.mid ? (
                        <p className="text-[11px] text-muted">
                          {name(start.lib!)} plays for whichever middle ({name(start.mid[0])} or {name(start.mid[1])}) is in the back row. The middle
                          serves, and the libero comes back on when the team loses that serve.
                          {benched && <> At the first rally, <b className="text-ink">{name(benched)}</b> starts on the bench.</>}
                        </p>
                      ) : (
                        <p className="text-[11px] text-ball">Put the libero (or the other middle) in one of the two middle spots so the app knows who's who.</p>
                      )}
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted">Other subs: drag them in while tagging.</p>
              </div>
            )}
          </div>
        </div>
        {!ok && used.size > 0 && (
          <p className="mt-3 text-xs text-bad">
            Fill all six positions for both teams (use Guest for guests).
          </p>
        )}
        <p className="mt-3 text-[11px] text-muted">{fromRally ? 'Saving replaces this rally\'s court; the court panel\'s "Undo changes" goes back to the rotation.' : 'Changes here apply to every rally; subs and swaps you made by hand while tagging are kept from their rally on.'}</p>
        <div className="mt-2 flex gap-2">
          <button onClick={save} disabled={busy || !ok} className="flex-1 rounded-lg bg-ball py-2.5 font-semibold text-bg disabled:opacity-40">
            {busy ? 'Saving…' : fromRally ? 'Save from this rally on' : 'Save teams'}
          </button>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2.5">Cancel</button>
        </div>
        </div>
      </div>
    </div>
  );
}

