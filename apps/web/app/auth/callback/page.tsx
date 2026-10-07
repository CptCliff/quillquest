'use client';
import { useEffect } from 'react';
import { useSession } from '../../../lib/session';

/** Supabase sends people back here after the email link or Google. Its client reads the code; we just wait for the session. */
export default function AuthCallback() {
  const { state } = useSession();
  useEffect(() => {
    if (state.status === 'in') window.location.replace('/');
    if (state.status === 'out') {
      const t = setTimeout(() => window.location.replace('/'), 4000); // the code exchange can take a moment
      return () => clearTimeout(t);
    }
  }, [state.status]);
  return <main className="home"><p role="status">Signing you in…</p></main>;
}
