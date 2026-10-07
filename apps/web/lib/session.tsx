'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { devAuthEnabled, supabase } from './supabase';

const DEV_KEY = 'qq.dev.user';
const read = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* private window */ } };

export type SessionState = { status: 'loading' } | { status: 'out' } | { status: 'in'; userId: string; email?: string };

export interface Session {
  state: SessionState;
  /** A fresh access token for the sync server (refreshed by Supabase; minted on demand in dev). */
  getToken(): Promise<string>;
  signInWithEmail(email: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signInDev(userId: string): void;
  signOut(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = (): Session => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession needs a SessionProvider');
  return s;
};

/**
 * Who is signed in. With a Supabase project configured, sessions are Supabase's (email link or Google). Otherwise, and only
 * when NEXT_PUBLIC_DEV_AUTH=1, a dev session picks a preset user. Neither exists in a deployment that sets neither.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const devToken = useRef<{ token: string; at: number } | null>(null);

  useEffect(() => {
    const sb = supabase();
    if (sb) {
      sb.auth.getSession().then(({ data }) => {
        const u = data.session?.user;
        setState(u ? { status: 'in', userId: u.id, email: u.email ?? undefined } : { status: 'out' });
      });
      const { data } = sb.auth.onAuthStateChange((_e, session) => {
        setState(session?.user ? { status: 'in', userId: session.user.id, email: session.user.email ?? undefined } : { status: 'out' });
      });
      return () => data.subscription.unsubscribe();
    }
    if (devAuthEnabled()) {
      // `?as=ilse` picks a dev user straight from a link; handy for demos and tests.
      const as = new URLSearchParams(window.location.search).get('as');
      if (as) write(DEV_KEY, as);
      const id = read(DEV_KEY);
      setState(id ? { status: 'in', userId: id } : { status: 'out' });
      return;
    }
    setState({ status: 'out' });
  }, []);

  const getToken = useCallback(async () => {
    const sb = supabase();
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (!data.session) throw new Error('not signed in');
      return data.session.access_token;
    }
    const id = read(DEV_KEY);
    if (!id || !devAuthEnabled()) throw new Error('not signed in');
    const cached = devToken.current;
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.token;
    const res = await fetch(`/api/dev-token?user=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('dev sign-in failed');
    const { token } = await res.json();
    devToken.current = { token, at: Date.now() };
    return token as string;
  }, []);

  const session = useMemo<Session>(() => ({
    state,
    getToken,
    async signInWithEmail(email) {
      const sb = supabase();
      if (!sb) throw new Error('Email sign-in is not configured');
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (error) throw error;
    },
    async signInWithGoogle() {
      const sb = supabase();
      if (!sb) throw new Error('Google sign-in is not configured');
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } });
      if (error) throw error;
    },
    signInDev(userId) {
      write(DEV_KEY, userId);
      devToken.current = null;
      setState({ status: 'in', userId });
    },
    async signOut() {
      const sb = supabase();
      if (sb) await sb.auth.signOut();
      write(DEV_KEY, null);
      devToken.current = null;
      setState({ status: 'out' });
    },
  }), [state, getToken]);

  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}
