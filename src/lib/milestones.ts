// Milestones: career totals passing set marks (50 kills, 10 Saturdays, 5 MVPs, …), with the Saturday each was reached.
import { useMemo } from 'react';
import { seasonTable, type SeasonRow } from './season';
import { useGames, type Game } from './games';

export const MILESTONES: { key: string; label: string; icon: string; marks: number[]; v: (r: SeasonRow) => number }[] = [
  { key: 'kill', label: 'kills', icon: '💥', marks: [25, 50, 100, 250, 500], v: r => r.n.kill ?? 0 },
  { key: 'ace', label: 'aces', icon: '🎯', marks: [10, 25, 50, 100, 200], v: r => r.n.ace ?? 0 },
  { key: 'assist', label: 'assists', icon: '🤝', marks: [25, 50, 100, 250, 500], v: r => r.n.assist ?? 0 },
  { key: 'blockpt', label: 'block points', icon: '🧱', marks: [5, 10, 25, 50, 100], v: r => r.n.blockpt ?? 0 },
  { key: 'dig', label: 'digs', icon: '🛡', marks: [25, 50, 100, 250, 500], v: r => r.n.dig ?? 0 },
  { key: 'mvps', label: 'MVPs', icon: '👑', marks: [1, 5, 10, 25, 50], v: r => r.mvps },
  { key: 'games', label: 'games', icon: '🏐', marks: [10, 25, 50, 100, 200], v: r => r.games },
  { key: 'sessions', label: 'Saturdays', icon: '📅', marks: [5, 10, 25, 50, 100], v: r => r.sessions },
];

/** "1 MVP", "50 kills". */
export const markText = (r: { mark: number; label: string }) => `${r.mark} ${r.mark === 1 ? r.label.replace(/s$/, '') : r.label}`;

export interface Reached { player: string; key: string; mark: number; date: string; label: string; icon: string }
export interface Progress { key: string; label: string; icon: string; value: number; next: number | null; prev: number }

/** Every milestone reached, oldest first, and each player's current totals. */
export function milestones(games: Game[]): { reached: Reached[]; totals: Record<string, SeasonRow> } {
  const dates = [...new Set(games.map(g => g.date))].sort();
  const totals: Record<string, SeasonRow> = {};
  const reached: Reached[] = [];
  for (const d of dates) {
    for (const r of seasonTable(games.filter(g => g.date === d))) {
      const before = totals[r.id];
      const after: SeasonRow = before ? {
        ...before, sessions: before.sessions + r.sessions, games: before.games + r.games, mvps: before.mvps + r.mvps,
        n: Object.fromEntries([...new Set([...Object.keys(before.n), ...Object.keys(r.n)])].map(k => [k, (before.n[k as keyof typeof before.n] ?? 0) + (r.n[k as keyof typeof r.n] ?? 0)])) as SeasonRow['n'],
      } : r;
      for (const m of MILESTONES) {
        const a = before ? m.v(before) : 0, b = m.v(after);
        for (const mark of m.marks) if (a < mark && b >= mark) reached.push({ player: r.id, key: m.key, mark, date: d, label: m.label, icon: m.icon });
      }
      totals[r.id] = after;
    }
  }
  return { reached, totals };
}

export function progressOf(row: SeasonRow | undefined): Progress[] {
  return MILESTONES.map(m => {
    const value = row ? m.v(row) : 0;
    const next = m.marks.find(x => x > value) ?? null;
    const prev = [...m.marks].reverse().find(x => x <= value) ?? 0;
    return { key: m.key, label: m.label, icon: m.icon, value, next, prev };
  });
}

export function useMilestones() {
  const games = useGames();
  return useMemo(() => (games ? milestones(games) : null), [games]);
}
