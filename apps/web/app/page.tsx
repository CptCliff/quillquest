'use client';
import { Dashboard } from '../components/Dashboard';
import { SignIn } from '../components/SignIn';
import { useSession } from '../lib/session';

export default function Home() {
  const { state } = useSession();
  if (state.status === 'loading') return <main className="home"><p className="muted">Loading…</p></main>;
  if (state.status === 'out') return <main className="home"><SignIn /></main>;
  return <Dashboard />;
}
