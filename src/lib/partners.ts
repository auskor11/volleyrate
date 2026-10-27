// Who plays well with whom: set → kill connections, and each pair's record as teammates and as opponents.
import { isGuest, rallyResult, type Game } from './games';
import { sameTeamIn } from './stats';
import { gameSetup, startCourt, teamOf, type Team } from './rotation';
import { matchRatings } from './gameRating';

export interface Partners {
  assists: Record<string, Record<string, number>>;  // setter → hitter → kills set up
  together: Record<string, Record<string, { games: number; won: number }>>;  // p → teammate → record
  against: Record<string, Record<string, { games: number; won: number }>>;   // p → opponent → p's record
}

export function partners(games: Game[]): Partners {
  const out: Partners = { assists: {}, together: {}, against: {} };
  for (const g of games) {
    const same = sameTeamIn(g);
    for (const r of g.rallies) {
      if (r.st === 'bad') continue;
      const res = rallyResult(r, same);
      if (res?.good && res.label === 'Kill' && res.assist && !isGuest(res.assist) && !isGuest(res.who)) {
        const a = (out.assists[res.assist] ??= {});
        a[res.who] = (a[res.who] ?? 0) + 1;
      }
    }
    // records need the team setup (who was on which side) and a winner
    const setup = gameSetup(g), m = matchRatings(g);
    if (!setup || !m?.winner) continue;
    const court = startCourt(setup);
    const teams = new Map<string, Team>();
    for (const row of m.rows) { const t = teamOf(court, row.id); if (t) teams.set(row.id, t); }
    for (const [p, tp] of teams) for (const [q, tq] of teams) {
      if (p === q) continue;
      const book = tp === tq ? out.together : out.against;
      const x = ((book[p] ??= {})[q] ??= { games: 0, won: 0 });
      x.games++; if (tp === m.winner) x.won++;
    }
  }
  return out;
}
