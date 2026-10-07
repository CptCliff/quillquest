'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { AccountApi, ApiClient, ApiFailure, GameApi } from '../lib/game-api';
import { useSession } from '../lib/session';
import { SignIn } from './SignIn';
import type { Me } from './StoryEditor';
import { DraftTable } from './DraftTable';
import { Table } from './Table';

const REJECTED_PREFIX = 'rejected:';
const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234';

interface Connection { doc: Y.Doc; provider: HocuspocusProvider }

/**
 * Gets you to the table: signed in, a member of this campaign, then a live connection. The role and ink come from your
 * membership, which the server decides; this only shows what it says.
 */
export function Workspace({ campaign, draft = false }: { campaign: string; draft?: boolean }) {
  const session = useSession();
  const client = useMemo(() => new ApiClient(session.getToken), [session.getToken]);
  const accounts = useMemo(() => new AccountApi(client), [client]);
  const game = useMemo(() => new GameApi(campaign, client), [campaign, client]);
  const signedIn = session.state.status === 'in';
  const userId = session.state.status === 'in' ? session.state.userId : null;

  const [me, setMe] = useState<Me | null>(null);
  const [title, setTitle] = useState('');
  const [gate, setGate] = useState<'checking' | 'denied' | 'error'>('checking');
  const [conn, setConn] = useState<Connection | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [status, setStatus] = useState('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [peers, setPeers] = useState<{ key: number; name: string; color: string }[]>([]);
  const resets = useRef<number[]>([]);

  // Who am I in this campaign? 403 means I am not a member.
  useEffect(() => {
    if (!signedIn || !userId) return;
    let live = true;
    Promise.all([accounts.members(campaign), accounts.me()]).then(([m, mine]) => {
      if (!live) return;
      const row = m.members.find((x) => x.userId === userId);
      if (!row) return setGate('denied');
      setTitle(mine.campaigns.find((c) => c.id === campaign)?.title ?? '');
      setMe({ id: row.userId, name: row.displayName, color: row.color, role: row.role, left: row.left });
    }, (e) => live && setGate(e instanceof ApiFailure && e.status === 403 ? 'denied' : 'error'));
    return () => { live = false; };
  }, [signedIn, userId, accounts, campaign, epoch]);

  // One connection per (campaign, member, epoch). A rejected update bumps the epoch and rebuilds from the server's copy.
  useEffect(() => {
    if (!me) return;
    let alive = true;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: SYNC_URL, name: draft && me ? `${campaign}~draft~${me.id}` : campaign, document: doc, token: () => session.getToken(),
      onStatus: ({ status }) => alive && setStatus(status),
      onAuthenticationFailed: () => alive && setGate('denied'),
      onClose: ({ event }) => {
        if (alive && event.reason === 'membership-changed') { setEpoch((e) => e + 1); return; } // you left: reload who you are, reconnect read-only
        if (alive && event.reason?.startsWith(REJECTED_PREFIX)) {
          // Rebuild from the server's copy, but never in a tight loop: three resets within ten seconds means something is wrong.
          const now = Date.now();
          resets.current = [...resets.current.filter((t) => now - t < 10_000), now];
          if (resets.current.length > 3) { setStatus('disconnected'); setNotice('Your connection keeps being refused. Reload the page; if it persists, tell your GM.'); return; }
          setNotice('The server refused one of your edits, so your copy was refreshed from the table.');
          setEpoch((e) => e + 1);
        }
      },
    });
    const track = () => alive && setPeers([...(provider.awareness?.getStates().entries() ?? [])].flatMap(([key, s]) => (s.user?.name ? [{ key, name: s.user.name, color: s.user.color }] : [])));
    provider.awareness?.on('change', track);
    track();
    setConn({ doc, provider });
    return () => { alive = false; provider.destroy(); doc.destroy(); setConn(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, campaign, epoch, draft]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  if (session.state.status === 'loading') return <main className="home"><p className="muted">Loading…</p></main>;
  if (!signedIn) return <main className="home"><SignIn heading="Sign in to join the table" /></main>;
  if (gate === 'denied') return <main className="home" data-testid="denied"><h1>Not your table</h1><p>You are not a member of this campaign. Ask its GM for an invite link.</p><Link href="/">Your campaigns</Link></main>;
  if (gate === 'error') return <main className="home"><p role="alert" className="notice">Could not open this campaign. Try again in a moment.</p><Link href="/">Your campaigns</Link></main>;
  if (!me || !conn) return <main className="home"><p className="muted">Connecting…</p></main>;
  if (draft) return <DraftTable key={`${me.id}-${epoch}`} doc={conn.doc} provider={conn.provider} me={me} campaign={campaign} title={title} status={status} game={game} onNotice={setNotice} notice={notice} />;
  return <Table key={`${me.id}-${epoch}`} doc={conn.doc} provider={conn.provider} me={me} title={title} campaign={campaign} status={status}
    peers={peers} game={game} accounts={accounts} onNotice={setNotice} notice={notice} />;
}
