// Volleyball court with both teams' rotations: Team A on the top half, Team B on the bottom, net in the
// middle, subs on the left. Drag a name onto another to swap them (or tap one, then the other): roles stay
// with the spots, so swapped players swap roles and a sub takes over the role of the player they replace.
// "Keep roles" swaps instead move the players with their roles (for teams that stood in the wrong spots).
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ROLE_NAMES, TEAMS, placeSpecialists, roleAt, rotate, rotateBack, rotationOf, type CourtState, type Side, type Team } from '../lib/rotation';

/** Role label at spot i, telling the two outside hitters apart (OH1 / OH2). */
const roleLabel = (s: Side, i: number) => {
  const r = roleAt(s, i), k = rotationOf(s.roles);
  return r === 'OH' && k >= 0 ? ROLE_NAMES[(i + k) % 6] : r;  // OH1 / OH2 while the spots are in set order
};

// slot keys: "a.pos.0" (team A, position 1), "b.bench.2", "a.bench.end" (drop zone at the end of the bench)
type Where = { t: Team; list: 'pos' | 'bench'; i: number };
const parse = (k: string): Where => {
  const [t, list, i] = k.split('.');
  return { t: t as Team, list: list as Where['list'], i: i === 'end' ? -1 : Number(i) };
};
const get = (c: CourtState, w: Where) => (w.i < 0 ? '' : c[w.t][w.list][w.i] ?? '');

// screen spots (left %, top %) of positions 1–6; Team A faces down, so its right is the viewer's left
const SPOTS: Record<Team, [number, number][]> = {
  a: [[17, 13], [17, 38], [50, 38], [83, 38], [83, 13], [50, 13]],
  b: [[83, 87], [83, 62], [50, 62], [17, 62], [17, 87], [50, 87]],
};

/**
 * Swap the players at two slots (or move one to the end of a bench). keepRoles: two players on the same
 * team's court take their roles with them (otherwise each takes the role of the spot they move into).
 */
export function moveSlot(c: CourtState, from: string, to: string, allowEmpty: boolean, keepRoles = false): CourtState {
  if (from === to) return c;
  const a = parse(from), b = parse(to);
  const pa = get(c, a), pb = get(c, b);
  if (!pa && !pb) return c;
  if (!allowEmpty && a.list === 'pos' !== (b.list === 'pos') && (!pa || !pb)) return c;  // keep six on court
  const n: CourtState = { ...c, a: { ...c.a, pos: [...c.a.pos], bench: [...c.a.bench] }, b: { ...c.b, pos: [...c.b.pos], bench: [...c.b.bench] } };
  const put = (w: Where, v: string) => {
    if (w.i < 0) { if (v) n[w.t].bench.push(v); }
    else n[w.t][w.list][w.i] = v;
  };
  put(a, pb);
  put(b, pa);
  if (keepRoles && a.list === 'pos' && b.list === 'pos' && a.t === b.t) {
    const roles = [...n[a.t].roles];
    [roles[a.i], roles[b.i]] = [roles[b.i], roles[a.i]];
    n[a.t] = { ...n[a.t], roles };
  }
  for (const t of TEAMS) n[t].bench = n[t].bench.filter(Boolean);
  return n;
}

export function Court({ c, name, onChange, onSlot, target, allowEmpty = false, controls = false }: {
  c: CourtState;
  name: (id: string) => string;
  onChange?: (c: CourtState, what?: string) => void;  // what: a short description for the edit history
  onSlot?: (key: string) => void;   // setup: a tap picks the slot to fill instead of selecting it
  target?: string | null;           // highlighted slot (setup: the next one to fill)
  allowEmpty?: boolean;             // setup: spots may be empty
  controls?: boolean;               // rotate buttons + serving team toggle
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [keepRoles, setKeepRoles] = useState(false);
  const [ghost, setGhost] = useState<{ key: string; x: number; y: number } | null>(null);
  const press = useRef<{ key: string; x: number; y: number; moved: boolean } | null>(null);
  const editable = !!onChange;

  const drop = (from: string, to: string) => {
    const kept = keepRoles && from.split('.')[1] === 'pos' && to.split('.')[1] === 'pos' && from[0] === to[0];
    const n = moveSlot(c, from, to, allowEmpty, kept);
    const pa = get(c, parse(from)), pb = get(c, parse(to));
    if (n !== c) onChange?.(n, `swapped ${name(pa) || 'an empty spot'} and ${name(pb) || 'an empty spot'}${kept ? ' (kept their roles)' : ''}`);
  };
  const down = (e: ReactPointerEvent, key: string) => {
    if (!editable && !onSlot) return;
    press.current = { key, x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p || !editable || !get(c, parse(p.key))) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
    p.moved = true;
    setGhost({ key: p.key, x: e.clientX, y: e.clientY });
  };
  const up = (e: ReactPointerEvent) => {
    const p = press.current;
    press.current = null;
    setGhost(null);
    if (!p) return;
    if (p.moved) {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-slot]') as HTMLElement | null;
      if (el?.dataset.slot) drop(p.key, el.dataset.slot);
      setSelected(null);
      return;
    }
    if (onSlot) { onSlot(p.key); return; }
    // tap one name, then another, to swap them
    if (!selected) { if (get(c, parse(p.key))) setSelected(p.key); }
    else { if (selected !== p.key) drop(selected, p.key); setSelected(null); }
  };

  const token = (key: string, id: string, label: string, role?: string) => {
    const serving = key === `${c.serving}.pos.0`;
    const hl = target === key || selected === key;
    return (
      <div key={key} data-slot={key}
        onPointerDown={e => down(e, key)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { press.current = null; setGhost(null); }}
        className={`touch-none select-none rounded-md border px-1 py-0.5 text-center text-[11px] leading-tight
          ${hl ? 'border-court bg-court/25 ring-2 ring-court' : serving ? 'border-ball bg-ball/20 text-ball' : id ? 'border-line bg-raised' : 'border-dashed border-line text-muted'}
          ${editable || onSlot ? 'cursor-pointer' : ''} ${ghost?.key === key ? 'opacity-40' : ''}`}>
        <div className={`text-[9px] ${serving ? 'text-ball' : 'text-muted'}`}>{label}</div>
        <div className="truncate font-semibold">{id ? name(id) : onSlot ? 'tap' : '—'}</div>
        {role && <div className="text-[9px] text-muted">{role}</div>}
      </div>
    );
  };

  const bench = (t: Team) => (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="text-[10px] text-muted">{t.toUpperCase()} subs</div>
      {c[t].bench.map((id, i) => token(`${t}.bench.${i}`, id, 'sub', id === c[t].mb ? 'MB' : undefined))}
      <div data-slot={`${t}.bench.end`} onPointerDown={e => down(e, `${t}.bench.end`)} onPointerUp={up}
        className={`flex min-h-8 flex-1 items-center justify-center rounded-md border border-dashed text-center text-[10px] text-muted
          ${target === `${t}.bench.end` ? 'border-court bg-court/20' : 'border-line'}`}>
        {onSlot ? '+ sub' : ''}
      </div>
    </div>
  );

  // hand rotations follow the same libero / middle rules as automatic ones
  const setSide = (t: Team, s: Side, what: string) => onChange?.(placeSpecialists({ ...c, [t]: s }), what);

  return (
    <div className="select-none">
      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-1.5">
        <div className="flex flex-col justify-between gap-3">
          {bench('a')}
          {bench('b')}
        </div>
        <div className="relative aspect-[5/8] w-full rounded-md border-2 border-ink/60 bg-court/10">
          <div className="absolute inset-x-[-4px] top-1/2 border-t-[3px] border-ink" />
          <div className="absolute inset-x-0 top-[25%] border-t border-dashed border-ink/25" />
          <div className="absolute inset-x-0 top-[75%] border-t border-dashed border-ink/25" />
          <span className="absolute right-1.5 top-1 text-[11px] font-semibold text-muted">A</span>
          <span className="absolute bottom-1 right-1.5 text-[11px] font-semibold text-muted">B</span>
          {TEAMS.flatMap(t => c[t].pos.map((id, i) => (
            <div key={`${t}${i}`} className="absolute w-[31%] -translate-x-1/2 -translate-y-1/2" style={{ left: `${SPOTS[t][i][0]}%`, top: `${SPOTS[t][i][1]}%` }}>
              {token(`${t}.pos.${i}`, id, i === 0 && t === c.serving ? '1 · 🏐 serve' : String(i + 1), roleLabel(c[t], i))}
            </div>
          )))}
        </div>
      </div>
      {controls && editable && (
        <div className="mt-1.5 grid grid-cols-[auto_1fr_1fr] items-center gap-1 text-xs">
          <span className="text-muted">Swaps</span>
          {[false, true].map(keep => (
            <button key={String(keep)} onClick={() => setKeepRoles(keep)}
              title={keep ? 'Players keep their roles when they swap spots (e.g. the team stood in the wrong positions)' : 'Players take the role of the spot they move into'}
              className={`rounded-md border py-1 ${keepRoles === keep ? 'border-court bg-court/25 text-ink' : 'border-line text-muted'}`}>
              {keep ? 'Keep roles' : 'Change roles'}
            </button>
          ))}
          <span className="text-muted">Rotate</span>
          {TEAMS.map(t => (
            <div key={t} className="flex gap-1">
              <button className="flex-1 rounded-md border border-line bg-raised py-1" onClick={() => setSide(t, rotate(c[t]), `rotated team ${t.toUpperCase()}`)} title={`Rotate team ${t.toUpperCase()} (2 → 1)`}>↻ {t.toUpperCase()}</button>
              <button className="rounded-md border border-line bg-raised px-1.5 py-1 text-muted" onClick={() => setSide(t, rotateBack(c[t]), `rotated team ${t.toUpperCase()} back`)} title="Undo a rotation">↺</button>
            </div>
          ))}
          <span className="text-muted">Serving</span>
          {TEAMS.map(t => (
            <button key={t} onClick={() => onChange?.(placeSpecialists({ ...c, serving: t }), `team ${t.toUpperCase()} serving`)}
              className={`rounded-md border py-1 ${c.serving === t ? 'border-ball bg-ball/20 text-ball' : 'border-line text-muted'}`}>Team {t.toUpperCase()}</button>
          ))}
        </div>
      )}
      {ghost && (
        <div className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-1/2 rounded-md border border-ball bg-raised px-2 py-1 text-xs font-semibold shadow-lg"
          style={{ left: ghost.x, top: ghost.y }}>{name(get(c, parse(ghost.key)))}</div>
      )}
    </div>
  );
}
