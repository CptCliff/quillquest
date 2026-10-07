'use client';
import { useState } from 'react';
import { DEV_USERS } from '../lib/dev-users';
import { useSession } from '../lib/session';
import { devAuthEnabled, supabaseConfigured } from '../lib/supabase';

/** Email link and Google when a Supabase project is configured; a preset-user list only with NEXT_PUBLIC_DEV_AUTH=1. */
export function SignIn({ heading = 'Sign in to Quillquest' }: { heading?: string }) {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = async (fn: () => Promise<void>) => { setError(null); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); } };
  const real = supabaseConfigured();
  const dev = devAuthEnabled();
  return (
    <section className="signin" data-testid="signin" aria-label="Sign in">
      <h1>{heading}</h1>
      {real && (
        <>
          {sent ? (
            <p role="status">Check your email for a sign-in link.</p>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); guard(async () => { await session.signInWithEmail(email); setSent(true); }); }}>
              <label className="field"><span>Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
              <button type="submit">Email me a link</button>
            </form>
          )}
          <p className="muted">or</p>
          <button type="button" onClick={() => guard(() => session.signInWithGoogle())}>Continue with Google</button>
        </>
      )}
      {dev && (
        <div className="dev-signin" data-testid="dev-signin">
          <p className="muted">Dev sign-in (this server has dev auth switched on).</p>
          <ul>{DEV_USERS.map((u) => (
            <li key={u.id}><button type="button" data-testid={`dev-as-${u.id}`} onClick={() => session.signInDev(u.id)} style={{ borderColor: u.color }}>{u.name}</button></li>
          ))}</ul>
        </div>
      )}
      {!real && !dev && <p className="muted">Sign-in is not configured for this deployment yet.</p>}
      {error && <p role="alert" className="notice">{error}</p>}
    </section>
  );
}
