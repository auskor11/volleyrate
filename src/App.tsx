import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { Admin } from './pages/Admin';
import { Loading, Login, NotMember } from './pages/Gate';
import { Home } from './pages/Home';
import { AddGame, Games } from './pages/Games';
import { GameView } from './pages/GameView';
import { PlayerDetail, Players } from './pages/Players';

function Routed() {
  const { user, member, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Login />;
  if (!member) return <NotMember />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="players" element={<Players />} />
        <Route path="players/:id" element={<PlayerDetail />} />
        <Route path="games" element={<Games />} />
        <Route path="games/new" element={<AddGame />} />
        <Route path="games/:id" element={<GameView />} />
        <Route path="admin" element={<Admin />} />
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
