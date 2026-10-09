import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// sample-data design preview, only in `npm run dev`
const DevPreview = import.meta.env.DEV && location.pathname.startsWith('/__preview')
  ? lazy(() => import('./pages/DevPreview').then(m => ({ default: location.pathname === '/__preview/game' ? m.DevGame : location.pathname === '/__preview/games' ? m.DevGames : location.pathname === '/__preview/highlights' ? m.DevHighlights : m.DevPreview })))
  : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {DevPreview ? <Suspense><DevPreview /></Suspense> : <App />}
  </StrictMode>,
)
