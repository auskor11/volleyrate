import { Logo } from '../components/Layout';
import { useAuth } from '../lib/auth';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo className="h-20 w-20" />
      <h1 className="mt-4 font-display text-4xl font-bold tracking-wide">VOLLEYRATE</h1>
      <p className="mt-1 text-muted">Yappy's Bakery · player ratings & game film</p>
      <div className="mt-10 w-full max-w-xs">{children}</div>
    </div>
  );
}

export function Login() {
  const { signIn, error } = useAuth();
  return (
    <Shell>
      <button
        onClick={signIn}
        className="flex w-full items-center justify-center gap-3 rounded-xl bg-ink px-4 py-3.5 font-semibold text-bg active:scale-[0.98]"
      >
        <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z" />
          <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6a24 24 0 0 0 0 21.4z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.3-8.7 2.3-6.3 0-11.7-4.1-13.5-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z" />
        </svg>
        Sign in with Google
      </button>
      {error && <p className="mt-4 text-sm text-bad">{error}</p>}
      <p className="mt-6 text-xs text-muted">Use the Google account on the team list.</p>
    </Shell>
  );
}

export function NotMember() {
  const { user, signOut, error } = useAuth();
  return (
    <Shell>
      <div className="rounded-xl border border-line bg-surface p-4 text-left text-sm">
        <p className="font-semibold">You're not on the team list yet</p>
        <p className="mt-1 text-muted">
          Signed in as <span className="text-ink">{user?.email}</span>. Ask Austin to add this email, or sign in with
          the account you gave for the roster.
        </p>
        {error && <p className="mt-2 text-bad">{error}</p>}
      </div>
      <button onClick={signOut} className="mt-4 w-full rounded-xl border border-line px-4 py-3 font-semibold">
        Use a different account
      </button>
    </Shell>
  );
}

export function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Logo className="h-12 w-12 animate-spin [animation-duration:2s]" />
    </div>
  );
}
