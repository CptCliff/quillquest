'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { needsAttention, type Character, type Skill } from '@quillquest/rules';
import { ApiFailure, type AccountApi, type GameApi, type LedgerCard } from '../lib/game-api';
import { useYMap } from '../lib/use-ymap';
import { InfoCard, type OpenCard } from './InfoCard';
import { NotesPane, type NotesTab } from './NotesPane';
import { StoryEditor, type Me } from './StoryEditor';

const SPLIT_KEY = 'qq.split';
function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= 25 && v <= 80 ? v : 62;
  } catch { return 62; }
}

/** The two-pane table (design plan 5): Story on the left, Notes on the right, info cards beside them or as a sheet on a phone. */
export function Table({ doc, provider, me, title, campaign, status, peers, game, accounts, onNotice, notice }: {
  doc: Y.Doc; provider: HocuspocusProvider; me: Me; title: string; campaign: string; status: string;
  peers: { key: number; name: string; color: string }[]; game: GameApi; accounts: AccountApi; onNotice: (m: string) => void; notice: string | null;
}) {
  const ledger = useYMap<LedgerCard>(doc.getMap('ledger'));
  const characters = useYMap<Character>(doc.getMap('characters'));
  const cards = useMemo(() => Object.values(ledger).sort((a, b) => a.seq - b.seq), [ledger]);
  const mine = useMemo(() => Object.values(characters).find((c) => c.ownerId === me.id) ?? null, [characters, me.id]);
  const attention = !me.left && cards.some((c) => needsAttention(c, { id: me.id, role: me.role }));

  const [editor, setEditor] = useState<Editor | null>(null);
  const [split, setSplit] = useState(62);
  const [tab, setTab] = useState<'story' | 'notes'>('story');
  const [notesTab, setNotesTab] = useState<NotesTab>('ledger');
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [focusSheet, setFocusSheet] = useState<string | null>(null);
  const dragging = useRef(false);
  useEffect(() => setSplit(loadSplit()), []);

  // Names and inks for every member, connected or not (paragraph tags and colors).
  const [members, setMembers] = useState<Record<string, { name: string; color: string }>>({});
  const [inkVersion, setInkVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => accounts.members(campaign).then((r) => {
      if (!live) return;
      setMembers(Object.fromEntries(r.members.map((m) => [m.userId, { name: m.displayName, color: m.color }])));
      setInkVersion((v) => v + 1);
    }, () => undefined);
    load();
    const t = setInterval(load, 10_000);
    provider.awareness?.on('change', load);
    return () => { live = false; clearInterval(t); provider.awareness?.off('change', load); };
  }, [accounts, campaign, provider]);

  // The editor is built once, so its callbacks must read the latest sheets through refs, not capture them.
  const latest = useRef({ mine, characters, members });
  latest.current = { mine, characters, members };
  const mySkills = useCallback((): Skill[] => latest.current.mine?.skills ?? [], []);
  const lookupInk = useCallback((id: string) => latest.current.members[id], []);

  const openAuthor = useCallback((userId: string) => {
    const c = Object.values(latest.current.characters).find((x) => x.ownerId === userId);
    if (c) setOpenCard({ kind: 'character', characterId: c.id });
  }, []);
  const openSheet = (characterId: string) => { setNotesTab('roster'); setFocusSheet(characterId); setTab('notes'); setOpenCard(null); };
  const chipInfo = useCallback((skill: string) => { const m = latest.current.mine; if (m) setOpenCard({ kind: 'skill', characterId: m.id, skill }); }, []);
  const chipRoll = useCallback((skill: string, paragraphId: string | null) => {
    game.createCard({ skillName: skill, anchorParagraphId: paragraphId }).then(
      () => { setNotesTab('ledger'); setTab('notes'); },
      (e) => onNotice(e instanceof ApiFailure ? e.message : 'Something went wrong'),
    );
  }, [game, onNotice]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSplit(Math.min(80, Math.max(25, ((e.clientX - box.left) / box.width) * 100)));
  }, []);
  const endDrag = () => {
    dragging.current = false;
    try { localStorage.setItem(SPLIT_KEY, String(split)); } catch { /* remembered widths are a nicety */ }
  };

  return (
    <div className="app" data-testid="workspace" data-status={status}>
      <header>
        <Link href="/" aria-label="Your campaigns">←</Link>
        <strong>{title || 'Quillquest'}</strong>
        <span className="pill" data-testid="me" style={{ background: me.color }}>{me.name}{me.role === 'gm' ? ' · GM' : ''}</span>
        <span className="muted" data-testid="status">{status}</span>
        <span className="peers" data-testid="peers">{peers.map((p) => <span key={p.key} className="dot" title={p.name} style={{ background: p.color }} />)}</span>
      </header>
      {me.left && <div role="status" className="notice" data-testid="left-banner">You left this campaign. You can read the story, but not change it.</div>}
      {notice && <div role="status" className="notice" data-testid="notice">{notice}</div>}
      <nav className="tabs" aria-label="Panes">
        <button aria-pressed={tab === 'story'} onClick={() => setTab('story')}>Story</button>
        <button aria-pressed={tab === 'notes'} data-testid="phone-notes-tab" onClick={() => setTab('notes')}>{attention ? 'Notes •' : 'Notes'}</button>
      </nav>
      <main data-tab={tab} style={{ ['--split' as string]: `${split}%` }} onPointerMove={onPointerMove} onPointerUp={endDrag}>
        <section className="story-pane" aria-label="Story pane">
          <StoryEditor doc={doc} provider={provider} me={me} onEditor={setEditor} onNotice={onNotice} mySkills={mySkills}
            onOpenAuthor={openAuthor} onChipInfo={chipInfo} onChipRoll={chipRoll} lookupInk={lookupInk} inkVersion={inkVersion} />
        </section>
        <div className="divider" role="separator" aria-orientation="vertical" aria-label="Resize panes" data-testid="divider"
          onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }} />
        <section className="notes-pane" aria-label="Notes pane">
          {openCard && <InfoCard card={openCard} characters={characters} onClose={() => setOpenCard(null)}
            onSkill={(characterId, skill) => setOpenCard({ kind: 'skill', characterId, skill })} onOpenSheet={openSheet} />}
          <NotesPane tab={notesTab} onTab={setNotesTab} cards={cards} characters={characters} me={me} game={game} accounts={accounts} campaign={campaign}
            editor={editor} onNotice={onNotice} openCharacter={(id) => setOpenCard({ kind: 'character', characterId: id })}
            openSkill={(characterId, skill) => setOpenCard({ kind: 'skill', characterId, skill })} focusSheet={focusSheet} attention={attention}
            onLeft={() => window.location.assign('/')} />
        </section>
      </main>
    </div>
  );
}
