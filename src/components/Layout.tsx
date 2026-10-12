import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { setTheme, useTheme } from '../lib/theme';

export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs><clipPath id="vr-ball"><circle cx="32" cy="32" r="29" /></clipPath></defs>
      <circle cx="32" cy="32" r="29" fill="#f5c518" />
      <g clipPath="url(#vr-ball)" fill="none" stroke="#2a6fdb" strokeWidth="5" strokeLinecap="round">
        {[0, 120, 240].map(r => <path key={r} d="M32 32C29 21 34 10 47 4" transform={`rotate(${r} 32 32)`} />)}
      </g>
    </svg>
  );
}

const tabs = [
  { to: '/', label: 'Home', icon: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/players', label: 'Players', icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 1a3 3 0 1 0 0-6M2 21c0-4 3-7 7-7s7 3 7 7M17 14c3 0 5 2.5 5 6' },
  { to: '/games', label: 'Games', icon: 'M4 5h16v12H4zM8 21h8M10 9l5 3-5 3z' },
];
const adminTab = { to: '/admin', label: 'Admin', icon: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z' };

function AccountMenu() {
  const { user, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const initial = (user?.displayName || user?.email || '?')[0].toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="Account"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-raised font-semibold ring-1 ring-line">
        {user?.photoURL
          ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          : initial}
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-xl shadow-black/50">
          <div className="border-b border-line px-4 py-3">
            <div className="truncate font-medium">{user?.displayName}</div>
            <div className="truncate text-sm text-muted">{user?.email}</div>
            {isAdmin && <span className="mt-1 inline-block rounded bg-ball/20 px-1.5 text-xs text-ball">admin</span>}
          </div>
          <ThemeSwitch />
          <button onClick={signOut} className="w-full px-4 py-3 text-left text-bad hover:bg-raised">Sign out</button>
        </div>
      )}
    </div>
  );
}

/** Classic (the original look) or Clean (the redesign), remembered on this device. */
function ThemeSwitch() {
  const t = useTheme();
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="mb-1.5 text-xs text-muted">Look</div>
      <div className="flex rounded-lg bg-raised p-0.5 text-sm">
        {(['clean', 'classic'] as const).map(k => (
          <button key={k} onClick={() => setTheme(k)}
            className={`flex-1 rounded-md py-1.5 ${t === k ? 'bg-ball font-semibold text-bg' : 'text-muted'}`}>
            {k === 'clean' ? 'Clean (new)' : 'Classic'}
          </button>
        ))}
      </div>
    </div>
  );
}

const NavIcon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    <path d={d} />
  </svg>
);

export function Layout() {
  const { isAdmin } = useAuth();
  const clean = useTheme() === 'clean';
  // the game page uses a wide two-column layout on big screens
  const wide = /^\/games\/(?!new$)[^/]+$/.test(useLocation().pathname);
  const all = [...tabs, ...(isAdmin ? [adminTab] : [])];
  return (
    <>
    {clean && (  // Clean, on big screens: a slim sidebar instead of the phone-style bottom bar
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-52 flex-col gap-1 border-r border-line bg-bg px-3 py-4 lg:flex">
        <div className="mb-4 flex items-center gap-2 px-2"><Logo /><span className="font-display text-lg font-bold">VolleyRate</span></div>
        {all.map(t => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>
            {({ isActive }) => <><span className={isActive ? 'text-ball' : ''}><NavIcon d={t.icon} /></span>{t.label}</>}
          </NavLink>
        ))}
      </aside>
    )}
    <div className={`mx-auto flex min-h-dvh flex-col ${wide ? 'max-w-7xl' : 'max-w-3xl'} ${clean ? 'lg:pl-52 lg:max-w-none' : ''}`}>
      <div className={clean ? `mx-auto flex w-full flex-1 flex-col ${wide ? 'max-w-7xl' : 'max-w-3xl'}` : 'contents'}>
      <header className="safe-top sticky top-0 z-10 border-b border-line/60 bg-bg/90 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-4">
          <span className={clean ? 'contents lg:hidden' : 'contents'}>
            <Logo />
            <span className="font-display text-xl font-bold tracking-wide">{clean ? 'VolleyRate' : 'VOLLEYRATE'}</span>
          </span>
          <div className="ml-auto"><AccountMenu /></div>
        </div>
      </header>
      <main className={`flex-1 px-4 pb-28 pt-4 ${clean ? "lg:pb-10" : ""}`}>
        <Outlet />
      </main>
      <nav className={`safe-bottom fixed inset-x-0 bottom-0 z-10 border-t border-line/60 bg-bg/95 backdrop-blur ${clean ? 'lg:hidden' : ''}`}>
        <div className="mx-auto flex max-w-3xl">
          {all.map(t => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 pt-2 text-[11px] font-medium ${isActive ? 'text-ball' : 'text-muted'}`}
            >
              <NavIcon d={t.icon} />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      </div>
    </div>
    </>
  );
}
