'use client';
import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { SignIn } from '../../../components/SignIn';
import { AccountApi, ApiClient, ApiFailure } from '../../../lib/game-api';
import { useSession } from '../../../lib/session';

/** An invite link: sign in if needed, join, and land in the campaign. */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const session = useSession();
  const accounts = useMemo(() => new AccountApi(new ApiClient(session.getToken)), [session.getToken]);
  const [result, setResult] = useState<{ ok: true; campaignId: string } | { ok: false; message: string } | null>(null);
  const signedIn = session.state.status === 'in';

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    accounts.acceptInvite(token).then(
      (r) => { if (live) { setResult({ ok: true, campaignId: r.campaignId }); window.location.replace(`/story/${r.campaignId}`); } },
      (e) => { if (live) setResult({ ok: false, message: e instanceof ApiFailure ? e.message : 'Something went wrong' }); },
    );
    return () => { live = false; };
  }, [signedIn, accounts, token]);

  if (session.state.status === 'loading') return <main className="home"><p className="muted">Loading…</p></main>;
  if (!signedIn) return <main className="home" data-testid="join"><p>You have been invited to a campaign. Sign in to join it.</p><SignIn heading="Sign in to join" /></main>;
  return (
    <main className="home" data-testid="join">
      {!result && <p role="status">Joining…</p>}
      {result?.ok && <p role="status">Joined. Taking you to the table…</p>}
      {result && !result.ok && <><p role="alert" className="notice" data-testid="join-error">{result.message}</p><Link href="/">Back to your campaigns</Link></>}
    </main>
  );
}
