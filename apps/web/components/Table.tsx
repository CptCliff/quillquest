'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { needsAttention, type CanonEntry, type Character, type ConvictionLogEntry, type CreationState, type PublicBattle, type PublicNpc, type Skill } from '@quillquest/rules';
import { ApiFailure, type AccountApi, type GameApi, type LedgerCard } from '../lib/game-api';
import { useYMap } from '../lib/use-ymap';
import { InfoCard, type OpenCard } from './InfoCard';
import { NotesPane, type NotesTab, type ZeroState } from './NotesPane';
import { SpotlightBar, type SpotlightState } from './SpotlightBar';
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
  const creation = useYMap<CreationState>(doc.getMap('creation'));
  const canon = useYMap<CanonEntry>(doc.getMap('canon'));
  const campaignMap = useYMap<unknown>(doc.getMap('campaign'));
  const npcs = useYMap<PublicNpc>(doc.getMap('npcs'));
  const convictionLog = useYMap<ConvictionLogEntry>(doc.getMap('convictionLog'));
  const battles = useYMap<PublicBattle>(doc.getMap('battles'));
  const zero = useMemo<ZeroState>(() => ({
    creation, canon, npcs, convictionLog, battles, phase: (campaignMap.phase as string | undefined) ?? 'sessionZero',
    crossings: (campaignMap.crossings as ZeroState['crossings'] | undefined) ?? [], overrides: (campaignMap.overrides as ZeroState['overrides'] | undefined) ?? [],
  }), [creation, canon, npcs, convictionLog, battles, campaignMap]);
  const spotlight = campaignMap.spotlight as SpotlightState | undefined;
  const cards = useMemo(() => Object.values(ledger).sort((a, b) => a.seq - b.seq), [ledger]);
  const mine = useMemo(() => Object.values(characters).find((c) => c.ownerId === me.id) ?? null, [characters, me.id]);
  const battleAttention = Object.values(battles).some((b) => {
    if (b.status === 'written') return false;
    const mineRow = b.contributions.find((c) => c.actorId === me.id);
    const myChar = b.lead.actorId === me.id ? b.lead.characterId : mineRow?.characterId;
    if (me.role === 'gm') return (b.status === 'declaring' && b.waitingOn.length === 0) || b.status === 'set' || (b.status === 'rolled' && b.beatsWritten.length > 0);
    if (!myChar) return false;
    if (b.status === 'declaring') return (b.lead.actorId === me.id && !b.lead.ready) || mineRow?.status === 'open';
    if (b.push) return b.push.waiting.includes(myChar);
    if (b.status === 'rolled' || b.status === 'conceded') return !b.beatsWritten.includes(myChar);
    return false;
  });
  const attention = !me.left && (cards.some((c) => needsAttention(c, { id: me.id, role: me.role })) || battleAttention);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [split, setSplit] = useState(62);
  const [tab, setTab] = useState<'story' | 'notes'>('story');
  const [notesTab, setNotesTab] = useState<NotesTab>('ledger');
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [focusSheet, setFocusSheet] = useState<string | null>(null);
  const dragging = useRef(false);

  // Deep links from email: ?tab=, ?card=, ?battle=, ?para=. Open the right pane and highlight the thing, once it has loaded.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tabParam = q.get('tab');
    const wanted = q.get('battle') ? `battle-${q.get('battle')}` : q.get('card') ? `card-${q.get('card')}` : null;
    const para = q.get('para');
    if (tabParam && ['ledger', 'create', 'codex', 'roster', 'director'].includes(tabParam)) { setNotesTab(tabParam as NotesTab); setTab('notes'); }
    if (wanted) { setNotesTab('ledger'); setTab('notes'); }
    if (para) setTab('story');
    if (!wanted && !para) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = wanted ? document.getElementById(wanted) : document.querySelector<HTMLElement>(`.story p[data-paragraph-id="${CSS.escape(para!)}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.dataset.focus = 'true'; clearInterval(timer); }
      else if (++tries > 40) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setSplit(loadSplit()), []);

  // Names and inks for every member, connected or not (paragraph tags and colors).
  const [members, setMembers] = useState<Record<string, { name: string; color: string }>>({});
  const names = useMemo(() => Object.fromEntries(Object.entries(members).map(([id, m]) => [id, m.name])), [members]);
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

  // Claude's half of the Skill chip. Players only (the GM has no sheet); any failure, cap or "not set up" simply means no suggestion.
  const suggestSkill = useCallback(async (sentence: string): Promise<string | null> => {
    if (latest.current.mine === null) return null;
    try { const r = await game.ask('skillMatch', { sentence }); return (r.suggestion.draft as { skill: string | null }).skill; } catch { return null; }
  }, [game]);

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
            onOpenAuthor={openAuthor} onChipInfo={chipInfo} onChipRoll={chipRoll} onSuggest={me.role === 'gm' || me.left ? undefined : suggestSkill} lookupInk={lookupInk} inkVersion={inkVersion} />
        </section>
        <div className="divider" role="separator" aria-orientation="vertical" aria-label="Resize panes" data-testid="divider"
          onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }} />
        <section className="notes-pane" aria-label="Notes pane">
          {openCard && <InfoCard card={openCard} characters={characters} onClose={() => setOpenCard(null)}
            onSkill={(characterId, skill) => setOpenCard({ kind: 'skill', characterId, skill })} onOpenSheet={openSheet} />}
          <NotesPane tab={notesTab} onTab={setNotesTab} cards={cards} characters={characters} me={me} game={game} accounts={accounts} campaign={campaign}
            editor={editor} onNotice={onNotice} openCharacter={(id) => setOpenCard({ kind: 'character', characterId: id })}
            openSkill={(characterId, skill) => setOpenCard({ kind: 'skill', characterId, skill })} focusSheet={focusSheet} attention={attention} zero={zero}
            onLeft={() => window.location.assign('/')} />
        </section>
      </main>
      <SpotlightBar spotlight={spotlight} me={me} names={names} game={game} onNotice={onNotice} />
    </div>
  );
}
