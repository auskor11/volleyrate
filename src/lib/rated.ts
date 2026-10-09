import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { usePlayers, type Player } from './data';
import { useGames } from './games';
import { DEFAULT_SETTINGS, buildModel, effectiveRatings, type EngineSettings, type RatingModel } from './engine';
import type { Ratings } from './ratings';

export type RatedPlayer = Player & { base: Ratings };  // ratings = starting + stats; base = starting

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
  const rated = useMemo(() => (players && model
    ? players.map(p => ({ ...p, base: p.ratings, ratings: effectiveRatings(p, model) }))
    : null), [players, model]);
  return { players: rated, model, error };
}
