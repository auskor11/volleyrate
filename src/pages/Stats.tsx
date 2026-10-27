// Season leaderboards and attendance, for any range of Saturdays.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGames, type Game } from '../lib/games';
import { usePlayers } from '../lib/data';
import { attendance, grade, rate, seasonTable, type SeasonRow } from '../lib/season';
import { fmtDay } from '../lib/history';
import { Avatar } from '../components/Avatar';

type Range = 'all' | 'last1' | 'last3' | `m:${string}`;
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const one = (x: number | null) => (x === null ? '–' : x.toFixed(1));

interface Col { key: string; label: string; title: string; v: (r: SeasonRow) => number | null; fmt?: (x: number | null) => string }
const COLS: Col[] = [
  { key: 'sessions', label: 'Sat', title: 'Saturdays played', v: r => r.sessions },
  { key: 'games', label: 'GP', title: 'Games played', v: r => r.games },
  { key: 'rating', label: 'GR', title: 'Average game rating (0–10)', v: r => r.rating, fmt: one },
  { key: 'mvps', label: '👑', title: 'MVPs', v: r => r.mvps },
  { key: 'kill', label: 'K', title: 'Kills', v: r => r.n.kill ?? 0 },
  { key: 'killpct', label: 'K%', title: 'Kills per attack (10+ attacks)', v: r => rate(r.n.kill ?? 0, r.n.attack ?? 0, 10), fmt: pct },
  { key: 'eff', label: 'EFF', title: 'Hitting efficiency: (kills − errors − blocked) ÷ attacks (10+ attacks)', v: r => rate((r.n.kill ?? 0) - (r.n.aerr ?? 0) - (r.n.blocked ?? 0), r.n.attack ?? 0, 10), fmt: pct },
  { key: 'ace', label: 'ACE', title: 'Aces', v: r => r.n.ace ?? 0 },
  { key: 'servein', label: 'SV%', title: 'Serves in (10+ serves)', v: r => rate((r.n.serve ?? 0) - (r.n.serr ?? 0), r.n.serve ?? 0, 10), fmt: pct },
  { key: 'blockpt', label: 'BLK', title: 'Block points', v: r => r.n.blockpt ?? 0 },
  { key: 'assist', label: 'AST', title: 'Assists', v: r => r.n.assist ?? 0 },
  { key: 'dig', label: 'DIG', title: 'Digs', v: r => r.n.dig ?? 0 },
  { key: 'pass', label: 'PASS', title: 'Average pass grade, 1–3 (5+ graded)', v: r => grade(r.n, 'pass'), fmt: x => (x === null ? '–' : x.toFixed(2)) },
  { key: 'rec', label: 'RE%', title: 'Receive errors per receive (10+ receives)', v: r => rate(r.n.rerr ?? 0, r.n.receive ?? 0, 10), fmt: pct },
];
const LOWER_IS_BETTER = new Set(['rec']);

export function Stats() {
  const games = useGames();
  const { players } = usePlayers();
  const [range, setRange] = useState<Range>('all');
  const [tab, setTab] = useState<'leaders' | 'attendance'>('leaders');
  const [sort, setSort] = useState('rating');
  const dates = useMemo(() => [...new Set((games ?? []).map(g => g.date))].sort().reverse(), [games]);
  const months = [...new Set(dates.map(d => d.slice(0, 7)))];
  const inRange = useMemo(() => (games ?? []).filter(g =>
    range === 'all' ? true : range === 'last1' ? g.date === dates[0] : range === 'last3' ? dates.slice(0, 3).includes(g.date) : g.date.startsWith(range.slice(2))), [games, range, dates]);
  const table = useMemo(() => seasonTable(inRange).filter(r => players?.some(p => p.id === r.id)), [inRange, players]);
  if (!games || !players) return null;
  const name = (id: string) => players.find(p => p.id === id)?.name ?? id;
  const photo = (id: string) => players.find(p => p.id === id)?.photo;
  const col = COLS.find(c => c.key === sort)!;
  const rows = [...table].sort((a, b) => {
    const x = col.v(a), y = col.v(b);
    if (x === null) return 1; if (y === null) return -1;
    return (LOWER_IS_BETTER.has(col.key) ? x - y : y - x) || name(a.id).localeCompare(name(b.id));
  });
  const chip = (on: boolean) => `shrink-0 rounded-full border px-3 py-1 text-sm ${on ? 'border-ball bg-ball text-bg' : 'border-line text-muted'}`;
  const tiles: [string, Col][] = [['Kills', COLS[4]], ['Aces', COLS[7]], ['Blocks', COLS[9]], ['Assists', COLS[10]], ['Digs', COLS[11]], ['Game rating', COLS[2]]];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">Stats</h1>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button className={chip(range === 'all')} onClick={() => setRange('all')}>All time</button>
        <button className={chip(range === 'last3')} onClick={() => setRange('last3')}>Last 3 Saturdays</button>
        <button className={chip(range === 'last1')} onClick={() => setRange('last1')}>Last Saturday</button>
        {months.map(m => (
          <button key={m} className={chip(range === `m:${m}`)} onClick={() => setRange(`m:${m}`)}>
            {new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
          </button>
        ))}
      </div>
      <div className="flex gap-1 rounded-xl bg-surface p-1">
        {(['leaders', 'attendance'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === t ? 'bg-raised text-ink' : 'text-muted'}`}>
            {t === 'leaders' ? 'Leaderboards' : 'Attendance'}
          </button>
        ))}
      </div>

      {tab === 'leaders' ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {tiles.map(([label, c]) => {
              const best = [...table].filter(r => (c.v(r) ?? 0) > 0).sort((a, b) => (c.v(b) ?? 0) - (c.v(a) ?? 0))[0];
              return (
                <div key={label} className="rounded-xl border border-line bg-surface p-3">
                  <div className="text-xs text-muted">{label}</div>
                  {best ? (
                    <Link to={`/players/${best.id}`} className="mt-1 flex items-center gap-2">
                      <Avatar name={name(best.id)} photo={photo(best.id)} size={24} ring={0} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{name(best.id)}</span>
                      <span className="font-display text-xl font-bold text-ball">{(c.fmt ?? String)(c.v(best))}</span>
                    </Link>
                  ) : <div className="mt-1 text-sm text-muted">–</div>}
                </div>
              );
            })}
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">Player</th>
                  {COLS.map(c => (
                    <th key={c.key} title={c.title} className="px-2 py-2 text-right font-medium">
                      <button onClick={() => setSort(c.key)} className={sort === c.key ? 'text-ball' : ''}>{c.label}{sort === c.key ? (LOWER_IS_BETTER.has(c.key) ? ' ▲' : ' ▼') : ''}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="sticky left-0 bg-surface px-3 py-1.5 whitespace-nowrap">
                      <Link to={`/players/${r.id}`} className="flex items-center gap-2 font-medium">
                        <Avatar name={name(r.id)} photo={photo(r.id)} size={22} ring={0} />{name(r.id)}
                      </Link>
                    </td>
                    {COLS.map(c => <td key={c.key} className={`px-2 py-1.5 text-right ${sort === c.key ? 'font-semibold text-ink' : 'text-muted'}`}>{(c.fmt ?? String)(c.v(r))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Tap a column to sort. Percentages need 10+ tries in the range; pass grades 5+. Hover a heading for what it means.</p>
        </>
      ) : <Attendance games={inRange} name={name} photo={photo} known={id => players.some(p => p.id === id)} />}
    </div>
  );
}

function Attendance({ games, name, photo, known }: { games: Game[]; name: (id: string) => string; photo: (id: string) => string | undefined; known: (id: string) => boolean }) {
  const { dates, played, streaks } = attendance(games);
  const people = Object.keys(played).filter(known)
    .sort((a, b) => Object.keys(played[b]).length - Object.keys(played[a]).length || name(a).localeCompare(name(b)));
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-muted">
            <th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">Player</th>
            <th className="px-2 py-2 text-right font-medium" title="Saturdays played">Sat</th>
            <th className="px-2 py-2 text-right font-medium" title="Saturdays in a row, up to the latest">Streak</th>
            <th className="px-2 py-2 text-right font-medium" title="Longest run of Saturdays in a row">Best</th>
            {dates.map(d => <th key={d} className="px-1.5 py-2 text-center font-medium whitespace-nowrap"><Link to={`/sessions/${d}`}>{fmtDay(d)}</Link></th>)}
          </tr>
        </thead>
        <tbody>
          {people.map(p => (
            <tr key={p} className="border-t border-line">
              <td className="sticky left-0 bg-surface px-3 py-1.5 whitespace-nowrap">
                <Link to={`/players/${p}`} className="flex items-center gap-2 font-medium"><Avatar name={name(p)} photo={photo(p)} size={22} ring={0} />{name(p)}</Link>
              </td>
              <td className="px-2 text-right">{Object.keys(played[p]).length}/{dates.length}</td>
              <td className="px-2 text-right">{streaks[p].current ? `🔥 ${streaks[p].current}` : '–'}</td>
              <td className="px-2 text-right text-muted">{streaks[p].best}</td>
              {dates.map(d => (
                <td key={d} className="px-1.5 text-center" title={played[p][d] ? `${played[p][d]} game${played[p][d] === 1 ? '' : 's'}` : 'Not there'}>
                  {played[p][d] ? <span className="inline-block h-2.5 w-2.5 rounded-full bg-good" /> : <span className="inline-block h-2.5 w-2.5 rounded-full bg-line" />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
