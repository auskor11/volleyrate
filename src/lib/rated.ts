import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { usePlayers, type Player } from './data';
import { useGames } from './games';
import { DEFAULT_SETTINGS, buildModel, effectiveRatings, type EngineSettings, type RatingModel } from './engine';
import type { Ratings } from './ratings';

// ratings = starting + stats; base = starting; prev = ratings before the latest session (`since` = its date)
export type RatedPlayer = Player & { base: Ratings; prev: Ratings; since?: string };

const settingsRef = () => doc(db, 'config', 'ratingsEngine');

/** How strongly stats move ratings (Admin → Ratings). */
export function useEngineSettings(): EngineSettings {
  const [s, setS] = useState<EngineSettings>(DEFAULT_SETTINGS);
  useEffect(() => onSnapshot(settingsRef(), d => setS({ ...DEFAULT_SETTINGS, ...(d.exists() ? d.data() : {}) }), () => {}), []);
  return s;
}

export const saveEngineSettings = (s: EngineSettings) => setDoc(settingsRef(), s);

/** Players with live, stats-adjusted ratings (plus the model, for explaining the numbers). */
export function useRatedPlayers(override?: EngineSettings): { players: RatedPlayer[] | null; model: RatingModel | null; error: string | null } {
  const { players, error } = usePlayers();
  const games = useGames();
  const saved = useEngineSettings();
  const settings = override ?? saved;
  const key = JSON.stringify(settings);
  const model = useMemo(() => (games ? buildModel(games, settings) : null), [games, key]);  // eslint-disable-line react-hooks/exhaustive-deps
  // the same model without the latest session's games: what ratings were before last Saturday
  const latest = model?.taggedGames.at(-1)?.date;
  const before = useMemo(() => (games && latest ? buildModel(games.filter(g => g.date < latest), settings) : null), [games, key, latest]);  // eslint-disable-line react-hooks/exhaustive-deps
  // only players who played that session get a change (anyone else's would just be recency weights shifting)
  const played = useMemo(() => new Set((model?.taggedGames ?? []).filter(g => g.date === latest)
    .flatMap(g => g.rallies.flatMap(r => (r.touches ?? []).map(t => t.p)))), [model, latest]);
  const rated = useMemo(() => (players && model
    ? players.map(p => {
        const ratings = effectiveRatings(p, model);
        return { ...p, base: p.ratings, ratings,
          prev: !played.has(p.id) ? ratings : before ? effectiveRatings(p, before) : p.ratings, ...(latest ? { since: latest } : {}) };
      })
    : null), [players, model, before, latest, played]);
  return { players: rated, model, error };
}
