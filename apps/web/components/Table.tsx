'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { phoneOrder, setActive, showPanel, hidePanel, type PanelId } from '@quillquest/layout';
import { needsAttention, type CanonEntry, type Character, type ConvictionLogEntry, type CreationState, type PublicBattle, type PublicNpc, type Skill } from '@quillquest/rules';
import { ApiFailure, type AccountApi, type GameApi, type LedgerCard } from '../lib/game-api';
import { useMediaQuery } from '../lib/use-media-query';
import { useYMap } from '../lib/use-ymap';
import { readableOn } from '../lib/color';
import { Dock, activePanels } from './dock/Dock';
import { LayoutMenu } from './dock/LayoutMenu';
import { PanelHost, Slot } from './dock/PanelHost';
import { useLayout } from './dock/useLayout';
import { InfoCard, type OpenCard } from './InfoCard';
import { NotesPanel, panelLabels, type ZeroState } from './NotesPane';
import { SpotlightBar, type SpotlightState } from './SpotlightBar';
import { StoryEditor, type Me } from './StoryEditor';
import { Glossary } from './Glossary';
import { ThemeToggle } from './ThemeToggle';

const NOTES_PANELS: PanelId[] = ['ledger', 'create', 'zero', 'codex', 'roster', 'director'];

/**
 * The table (design plan 5). Story and the notes panels (Ledger, Creation, Codex, Roster, Director, and the open info card) are panels in a
 * workspace each person arranges: drag a tab, resize a divider, or use the Layout menu. On a phone they are two tabs, Story and Notes.
 */
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
  const creating = me.role !== 'gm' && zero.creation[mine?.id ?? '']?.status === 'creating';
  // The GM's Session zero tab gets a dot when every character is ready and play can begin.
  const players = Object.values(characters).filter((c) => c.ownerId && !c.left);
  const zeroReady = me.role === 'gm' && zero.phase !== 'playing' && players.length > 0 && players.every((c) => zero.creation[c.id]?.status === 'ready');
  const labels = useMemo(() => panelLabels(me, attention, creating, zeroReady), [me, attention, creating, zeroReady]);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [focusSheet, setFocusSheet] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [phoneTab, setPhoneTab] = useState<'story' | 'notes'>('story');
  const [phoneNote, setPhoneNote] = useState<PanelId>('ledger');

  const phone = useMediaQuery('(max-width: 760px)');
  const { layout, update, reset } = useLayout(game, me.role, phone ? 'phone' : 'wide');
  const phoneList = useMemo(() => phoneOrder(layout, me.role), [layout, me.role]);
  const phoneActive = phoneList.includes(phoneNote) ? phoneNote : (phoneList[0] ?? 'ledger');

  /** Bring a panel forward wherever it lives (or show it first), and on a phone switch to the Notes tab. */
  const activate = useCallback((panel: PanelId) => {
    if (panel === 'story') { setPhoneTab('story'); return; }
    update((l) => (l.hidden.includes(panel) ? showPanel(l, panel) : setActive(l, panel)), { save: false });
    setPhoneNote(panel); setPhoneTab('notes');
  }, [update]);
  const announce = useCallback((m: string) => setAnnouncement(m), []);
  useEffect(() => { if (!announcement) return; const t = setTimeout(() => setAnnouncement(''), 5000); return () => clearTimeout(t); }, [announcement]);

  // The info card is a panel on a wide screen (a tab beside the Ledger that appears and goes) and a bottom sheet on a phone.
  useEffect(() => {
    if (phone) return;
    update((l) => (openCard ? showPanel(l, 'info') : hidePanel(l, 'info')), { save: false });
  }, [openCard, phone, update]);

  // A GM who opens a table still in session zero lands on that tab (once, unless an email link asked for another).
  const openedZero = useRef(false);
  const touched = useRef(false); // the person has already clicked or typed: never yank them to another tab
  useEffect(() => {
    const mark = () => { touched.current = true; };
    window.addEventListener('pointerdown', mark, true); window.addEventListener('keydown', mark, true);
    return () => { window.removeEventListener('pointerdown', mark, true); window.removeEventListener('keydown', mark, true); };
  }, []);
  useEffect(() => {
    if (openedZero.current || me.role !== 'gm' || campaignMap.phase !== 'sessionZero') return;
    if (touched.current) { openedZero.current = true; return; }
    openedZero.current = true;
    if (new URLSearchParams(window.location.search).get('tab')) return;
    update((l) => (l.hidden.includes('zero') ? showPanel(l, 'zero') : setActive(l, 'zero')), { save: false });
    setPhoneNote('zero');
  }, [campaignMap.phase, me.role, update]);

  // Deep links from email: ?tab=, ?card=, ?battle=, ?para=. Open the right panel and highlight the thing, once it has loaded.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tabParam = q.get('tab') as PanelId | null;
    const wanted = q.get('battle') ? `battle-${q.get('battle')}` : q.get('card') ? `card-${q.get('card')}` : null;
    const para = q.get('para');
    if (tabParam && NOTES_PANELS.includes(tabParam)) activate(tabParam);
    if (wanted) activate('ledger');
    if (para) { activate('story'); update((l) => setActive(l, 'story'), { save: false }); }
    if (!wanted && !para) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = wanted ? document.getElementById(wanted) : document.querySelector<HTMLElement>(`.story p[data-paragraph-id="${CSS.escape(para!)}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.dataset.focus = 'true'; clearInterval(timer); }
      else if (++tries > 40) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const openSheet = (characterId: string) => { activate('roster'); setFocusSheet(characterId); setOpenCard(null); };
  const chipInfo = useCallback((skill: string) => { const m = latest.current.mine; if (m) setOpenCard({ kind: 'skill', characterId: m.id, skill }); }, []);
  const chipRoll = useCallback((skill: string, paragraphId: string | null) => {
    game.createCard({ skillName: skill, anchorParagraphId: paragraphId }).then(
      () => activate('ledger'),
      (e) => onNotice(e instanceof ApiFailure ? e.message : 'Something went wrong'),
    );
  }, [game, onNotice, activate]);

  // Claude's half of the Skill chip. Players only (the GM has no sheet); any failure, cap or "not set up" simply means no suggestion.
  const suggestSkill = useCallback(async (sentence: string): Promise<string | null> => {
    if (latest.current.mine === null) return null;
    try { const r = await game.ask('skillMatch', { sentence }); return (r.suggestion.draft as { skill: string | null }).skill; } catch { return null; }
  }, [game]);

  // What each panel shows. Only the panels in view are built; a panel keeps its place (and its state) while it is dragged about.
  const mounted: PanelId[] = phone ? ['story', phoneActive] : activePanels(layout);
  const panels: Partial<Record<PanelId, ReactNode>> = {};
  for (const p of mounted) {
    panels[p] = p === 'story' ? (
      <section className="story-pane" aria-label="Story pane">
        <StoryEditor doc={doc} provider={provider} me={me} onEditor={setEditor} onNotice={onNotice} mySkills={mySkills}
          onOpenAuthor={openAuthor} onChipInfo={chipInfo} onChipRoll={chipRoll} onSuggest={me.role === 'gm' || me.left ? undefined : suggestSkill} lookupInk={lookupInk} inkVersion={inkVersion} />
      </section>
    ) : p === 'info' ? (openCard && <InfoCard card={openCard} characters={characters} onClose={() => setOpenCard(null)}
      onSkill={(characterId, skill) => setOpenCard({ kind: 'skill', characterId, skill })} onOpenSheet={openSheet} />)
      : <NotesPanel panel={p} cards={cards} characters={characters} me={me} game={game} accounts={accounts} campaign={campaign}
        editor={editor} onNotice={onNotice} openCharacter={(id) => setOpenCard({ kind: 'character', characterId: id })}
        openSkill={(characterId, skill) => setOpenCard({ kind: 'skill', characterId, skill })} focusSheet={focusSheet} zero={zero}
        onLeft={() => window.location.assign('/')} />;
  }

  return (
    <div className="app" data-testid="workspace" data-status={status}>
      <a className="skip-link" href="#main">Skip to the table</a>
      <header>
        <Link href="/" aria-label="Your campaigns">←</Link>
        <strong>{title || 'Quillquest'}</strong>
        <span className="pill" data-testid="me" style={{ background: me.color, color: readableOn(me.color) }}>{me.name}{me.role === 'gm' ? ' · GM' : ''}</span>
        <span className="muted" data-testid="status" role="status">{status}</span>
        <Glossary />
        <ThemeToggle />
        {!phone && <LayoutMenu layout={layout} role={me.role} labels={labels} onChange={(fn, msg) => { update(fn); if (msg) announce(msg); }} onReset={() => { void reset(); announce('Layout reset to the default'); }} />}
        <span className="peers" data-testid="peers">{peers.map((p) => <span key={p.key} className="dot" title={p.name} style={{ background: p.color }} />)}</span>
      </header>
      {me.left && <div role="status" className="notice" data-testid="left-banner">You left this campaign. You can read the story, but not change it.</div>}
      {notice && <div role="status" className="notice" data-testid="notice">{notice}</div>}
      <PanelHost panels={panels} mounted={mounted}>
        {phone ? (
          <>
            <nav className="tabs" aria-label="Panes">
              <button aria-pressed={phoneTab === 'story'} onClick={() => setPhoneTab('story')}>Story</button>
              <button aria-pressed={phoneTab === 'notes'} data-testid="phone-notes-tab" onClick={() => { setPhoneTab('notes'); if (creating && phoneList.includes('create')) setPhoneNote('create'); }}>{creating ? 'Notes: create your character •' : attention ? 'Notes •' : 'Notes'}</button>
            </nav>
            <main id="main" data-tab={phoneTab} tabIndex={-1}>
              <div className="phone-story"><Slot panel="story" /></div>
              <section className="notes-pane" aria-label="Notes pane">
                {openCard && <InfoCard card={openCard} characters={characters} onClose={() => setOpenCard(null)}
                  onSkill={(characterId, skill) => setOpenCard({ kind: 'skill', characterId, skill })} onOpenSheet={openSheet} />}
                <div className="note-tabs" role="tablist" aria-label="Notes">
                  {phoneList.map((p) => <button key={p} role="tab" aria-selected={p === phoneActive} data-testid={`tab-${p}`} onClick={() => setPhoneNote(p)}>{labels[p]}</button>)}
                </div>
                <Slot panel={phoneActive} />
              </section>
            </main>
          </>
        ) : (
          <main id="main" className="dock-main" tabIndex={-1}>
            <Dock layout={layout} labels={labels} onChange={(fn, msg) => { update(fn); if (msg) announce(msg); }} />
          </main>
        )}
      </PanelHost>
      <SpotlightBar spotlight={spotlight} me={me} names={names} game={game} onNotice={onNotice} />
      <div className="visually-hidden" role="status" aria-live="polite" data-testid="announcer">{announcement}</div>
    </div>
  );
}
