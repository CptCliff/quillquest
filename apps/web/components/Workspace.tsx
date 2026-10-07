'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { StoryEditor, type Me } from './StoryEditor';
import { NotesPane } from './NotesPane';

const REJECTED_PREFIX = 'rejected:';
const SPLIT_KEY = 'qq.split';

interface Connection { doc: Y.Doc; provider: HocuspocusProvider; me: Me; token: string }

function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= 25 && v <= 80 ? v : 62;
  } catch { return 62; }
}

export function Workspace({ campaign, userId }: { campaign: string; userId: string }) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [status, setStatus] = useState('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [split, setSplit] = useState(62);
  const [tab, setTab] = useState<'story' | 'notes'>('story');
  const [peers, setPeers] = useState<{ key: number; name: string; color: string }[]>([]);
  const dragging = useRef(false);

  useEffect(() => setSplit(loadSplit()), []);

  // One connection per (campaign, user, epoch). A rejected update bumps the epoch, which rebuilds everything from the server's copy.
  useEffect(() => {
    let alive = true;
    const doc = new Y.Doc();
    let provider: HocuspocusProvider | null = null;
    (async () => {
      const res = await fetch(`/api/dev-token?user=${encodeURIComponent(userId)}`);
      if (!res.ok || !alive) return setStatus('sign-in failed');
      const { identity, token, syncUrl } = await res.json();
      provider = new HocuspocusProvider({
        url: syncUrl, name: campaign, document: doc, token,
        onStatus: ({ status }) => alive && setStatus(status),
        onAuthenticationFailed: () => alive && setStatus('sign-in failed'),
        onClose: ({ event }) => {
          if (alive && event.reason?.startsWith(REJECTED_PREFIX)) {
            setNotice('The server refused one of your edits, so your copy was refreshed from the table.');
            setEpoch((e) => e + 1);
          }
        },
      });
      // Everyone present, including this tab: awareness is keyed by client, and the local state carries no id.
      const track = () => alive && setPeers([...(provider!.awareness?.getStates().entries() ?? [])].flatMap(([key, s]) => (s.user?.name ? [{ key, name: s.user.name, color: s.user.color }] : [])));
      provider.awareness?.on('change', track);
      track();
      if (alive) setConn({ doc, provider, me: identity, token });
    })();
    return () => { alive = false; provider?.destroy(); doc.destroy(); setConn(null); setEditor(null); };
  }, [campaign, userId, epoch]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const main = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSplit(Math.min(80, Math.max(25, ((e.clientX - main.left) / main.width) * 100)));
  }, []);
  const endDrag = () => {
    dragging.current = false;
    try { localStorage.setItem(SPLIT_KEY, String(split)); } catch { /* remembered widths are a nicety */ }
  };

  return (
    <div className="app" data-testid="workspace" data-status={status}>
      <header>
        <strong>Quillquest</strong>
        <span className="muted">{campaign}</span>
        {conn && <span className="pill" data-testid="me" style={{ background: conn.me.color }}>{conn.me.name}{conn.me.role === 'gm' ? ' · GM' : ''}</span>}
        <span className="muted" data-testid="status">{status}</span>
        <span className="peers" data-testid="peers">
          {peers.map((p) => <span key={p.key} className="dot" title={p.name} style={{ background: p.color }} />)}
        </span>
      </header>
      {notice && <div role="status" className="notice" data-testid="notice">{notice}</div>}
      <nav className="tabs" aria-label="Panes">
        <button aria-pressed={tab === 'story'} onClick={() => setTab('story')}>Story</button>
        <button aria-pressed={tab === 'notes'} onClick={() => setTab('notes')}>Notes</button>
      </nav>
      <main data-tab={tab} style={{ ['--split' as string]: `${split}%` }} onPointerMove={onPointerMove} onPointerUp={endDrag}>
        <section className="story-pane" aria-label="Story pane">
          {conn ? (
            <StoryEditor key={`${conn.me.id}-${epoch}`} doc={conn.doc} provider={conn.provider} me={conn.me} onEditor={setEditor} onNotice={setNotice} />
          ) : (
            <p className="muted">Connecting…</p>
          )}
        </section>
        <div className="divider" role="separator" aria-orientation="vertical" aria-label="Resize panes" data-testid="divider"
          onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }} />
        <section className="notes-pane" aria-label="Notes pane">
          {conn && <NotesPane key={`${conn.me.id}-${epoch}`} doc={conn.doc} me={conn.me} token={conn.token} campaign={campaign} editor={editor} onNotice={setNotice} />}
        </section>
      </main>
    </div>
  );
}
