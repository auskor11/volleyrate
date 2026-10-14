import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { Loading } from './pages/Gate';
import { Home } from './pages/Home';
import { AddGame, Games } from './pages/Games';
import { PlayerDetail, Players } from './pages/Players';
import { LatestSession, Session } from './pages/Session';

// the two biggest pages download only when opened
const GameView = lazy(() => import('./pages/GameView').then(m => ({ default: m.GameView })));
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const later = (el: React.ReactNode) => <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>{el}</Suspense>;

function Routed() {
  // no sign-in wall: guests watch; signing in (and an admin's OK) unlocks reviewing and tagging
  const { loading, isAdmin, isPlayer } = useAuth();
  if (loading) return <Loading />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="players" element={<Players />} />
        <Route path="players/:id" element={<PlayerDetail />} />
        <Route path="games" element={<Games />} />
        <Route path="games/new" element={isPlayer ? <AddGame /> : <Navigate to="/games" replace />} />
        <Route path="games/:id" element={later(<GameView />)} />
        <Route path="sessions" element={<LatestSession />} />
        <Route path="sessions/:date" element={<Session />} />
        <Route path="admin" element={isAdmin ? later(<Admin />) : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routed />
      </BrowserRouter>
    </AuthProvider>
  );
}
