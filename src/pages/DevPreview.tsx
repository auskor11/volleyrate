// Development-only: renders cards and a detail view with sample data (no sign-in needed).
import { MemoryRouter } from 'react-router-dom';
import { GamePlayer } from './GameView';
import { GamesList } from './Games';
import { Highlights } from './Players';
import devSample from './devSample.json';
import { AttrBar, PlayerCard } from '../components/PlayerCard';
import type { Player } from '../lib/data';
import { CATEGORIES, categoryScore } from '../lib/ratings';

const r = (base: number) => Object.fromEntries(
  CATEGORIES.flatMap(c => c.attrs.map(([k], i) => [k, Math.min(99, Math.max(30, base + ((k.length * 7 + i * 5) % 17) - 8))])));

const sample: Player[] = [
  { id: 'a', name: 'Sample Setter', number: 11, positions: ['S', 'OH'], ratings: r(84) },
  { id: 'b', name: 'Sample Middle', number: 5, positions: ['MB', 'OH'], ratings: r(74) },
  { id: 'c', name: 'Sample Libero', number: 10, positions: ['L', 'S'], ratings: r(63) },
  { id: 'd', name: 'New Player', number: null, positions: ['OPP'], ratings: {} },
];

export function DevPreview() {
  const p = sample[0];
  return (
    <MemoryRouter>
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        <PlayerCard player={p} size="lg" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {sample.map(s => <PlayerCard key={s.id} player={s} />)}
        </div>
        {CATEGORIES.slice(0, 3).map(c => (
          <section key={c.key} className="rounded-xl border border-line bg-surface p-4">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-lg font-semibold">{c.label}</h2>
              <span className="font-display text-2xl font-bold">{Math.round(categoryScore(p.ratings, c.key, p.positions[0])!)}</span>
            </div>
            {c.attrs.map(([k, label]) => <AttrBar key={k} label={label} value={p.ratings[k]} />)}
          </section>
        ))}
      </div>
    </MemoryRouter>
  );
}

// Sample game on a public YouTube test video (saving fails here: no sign-in).
export function DevGame() {
  // real Game 2-3 rally times + contact sounds, on a public sample video (saving fails: no sign-in)
  const rallies = devSample.rallies.map(([s, e]) => ({ s, e, st: 'auto' as const, as: s, ae: e }));
  return (
    <MemoryRouter initialEntries={[`/${location.search}`]}>
      <div className="mx-auto max-w-7xl px-4 pb-28 pt-[4.5rem]">
        <GamePlayer canDelete samplePlayers={['Alex', 'Ben', 'Chris', 'Dana', 'Eli', 'Finn', 'Gabe', 'Hana', 'Ivan', 'Jo']
          .map((n, i) => ({ id: n.toLowerCase().replace(' ', '-'), name: n, number: [1, 11, 5, 83, 10, 81, 4, 9, 8, 17][i], positions: ['OH'], ratings: {} }))} game={{
          id: 'dev', title: 'Sample game', date: '2026-09-26', youtubeId: 'M7lc1UVf-VE', duration: 1340,
          rallies, reviewed: false, createdBy: 'dev', peaks: devSample.peaks,
          angles: [{ id: 'back1', name: 'Back', kind: 'back', behind: 'a', youtubeId: 'aqz-KE-bpKQ', offset: 5, sync: { matched: 120, total: 400 } }],
          court: location.search.includes('noteams') ? undefined : {
            a: { pos: ['alex', 'ben', 'chris', 'dana', 'eli', 'jo'], roles: ['OH', 'S', 'MB', 'OH', 'OPP', 'L'], bench: ['ivan'], mb: 'ivan' },
            b: { pos: ['finn', 'gabe', 'hana', 'guest', 'guest', 'guest'], roles: ['OH', 'S', 'MB', 'OH', 'OPP', 'L'], bench: [] },
            serving: 'a',
          } }} />
      </div>
    </MemoryRouter>
  );
}

export function DevGames() {
  const g = (id: string, title: string, date: string, n: number, reviewed = true) =>
    ({ id, title, date, youtubeId: 'M7lc1UVf-VE', duration: 2000, reviewed, createdBy: 'dev',
       rallies: Array.from({ length: n }, (_, i) => ({ s: i * 20, e: i * 20 + 8, st: 'auto' as const })) });
  const games = [g('a', 'Game 1', '2026-09-26', 143), g('b', 'Game 2-3', '2026-09-26', 79), g('c', 'Game 1', '2026-10-03', 60, false),
    g('d', 'Scrimmage vs NUS', '2026-10-10', 90, false), g('e', 'Game 2', '2026-10-03', 55)];
  return <MemoryRouter><div className="mx-auto max-w-3xl p-4"><GamesList games={games} /></div></MemoryRouter>;
}

export function DevHighlights() {
  const h = (id: string, s: number, e: number, note: string) => ({ id, playerId: 'samuel', gameId: 'g', youtubeId: 'M7lc1UVf-VE',
    title: 'Sample game', date: '2026-09-26', s, e, note, by: 'x', byName: 'Alex' });
  return <MemoryRouter><div className="mx-auto max-w-3xl p-4">
    <Highlights playerId="jo" name="Jo" sample={[h('a', 40, 44, 'first'), h('b', 100, 104, 'second'), h('c', 200, 204, 'third')]} />
  </div></MemoryRouter>;
}
