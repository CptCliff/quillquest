'use client';
import type { Editor } from '@tiptap/core';
import type { CanonEntry, CheckOverride, Character, ConvictionLogEntry, CreationState, CrossingProposal, PublicNpc } from '@quillquest/rules';
import type { AccountApi, GameApi, LedgerCard } from '../lib/game-api';
import { Creation } from './Creation';
import { Director } from './Director';
import { Ledger } from './Ledger';
import { Roster } from './Roster';
import { SessionZero } from './SessionZero';
import { SuggestionsPanel } from './SuggestionsPanel';
import type { Me } from './StoryEditor';
import { TablePanel } from './TablePanel';

export type NotesTab = 'ledger' | 'create' | 'codex' | 'roster' | 'director';

/** Session-zero state from the server-written maps. */
export interface ZeroState { creation: Record<string, CreationState>; canon: Record<string, CanonEntry>; phase: string; crossings: CrossingProposal[]; overrides: CheckOverride[]; npcs: Record<string, PublicNpc>; convictionLog: Record<string, ConvictionLogEntry> }

/** The Notes pane (design plan 5.2): Ledger and Roster are live; the GM's tab holds the table and invites; Codex arrives in M6. */
export function NotesPane({ tab, onTab, cards, characters, me, game, accounts, campaign, editor, onNotice, openCharacter, openSkill, focusSheet, attention, onLeft, zero }: {
  tab: NotesTab; onTab: (t: NotesTab) => void; cards: LedgerCard[]; characters: Record<string, Character>; me: Me; game: GameApi; accounts: AccountApi;
  campaign: string; editor: Editor | null; onNotice: (m: string) => void; openCharacter: (characterId: string) => void;
  openSkill: (characterId: string, skill: string) => void; focusSheet: string | null; attention: boolean; onLeft: () => void; zero: ZeroState;
}) {
  const mine = Object.values(characters).find((c) => c.ownerId === me.id) ?? null;
  const tabs: { id: NotesTab; label: string; show: boolean }[] = [
    { id: 'ledger', label: attention ? 'Ledger •' : 'Ledger', show: true },
    { id: 'create', label: me.role === 'gm' || zero.creation[mine?.id ?? '']?.status !== 'creating' ? 'Creation' : 'Creation •', show: me.role !== 'gm' },
    { id: 'codex', label: 'Codex', show: true },
    { id: 'roster', label: 'Roster', show: true },
    { id: 'director', label: me.role === 'gm' ? 'Director' : '', show: me.role === 'gm' },
  ];
  return (
    <>
      <div className="note-tabs" role="tablist" aria-label="Notes">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} onClick={() => onTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'ledger' && (
        <>
          <Ledger cards={cards} character={me.left ? null : mine} env={{ api: game, me, characters, editor, onNotice, openCharacter }} />
          {editor && <SuggestionsPanel editor={editor} userId={me.id} />}
        </>
      )}
      {tab === 'create' && <Creation me={me} characters={characters} creation={zero.creation} crossings={zero.crossings} phase={zero.phase} game={game} editor={editor} onNotice={onNotice} campaign={campaign} />}
      {tab === 'roster' && <Roster characters={characters} creation={zero.creation} npcs={zero.npcs} me={me} api={game} accounts={accounts} campaign={campaign} onNotice={onNotice} onSkill={openSkill} onLeft={onLeft} focus={focusSheet} />}
      {tab === 'codex' && (
        <section aria-label="Canon" data-testid="canon">
          <h3>Canon</h3>
          {Object.keys(zero.canon).length === 0 && <p className="muted">Nothing is established yet. The full Codex and the Conviction log arrive with the Director tools (M6).</p>}
          <ul>{Object.values(zero.canon).map((e) => <li key={e.id} data-testid="canon-entry">{e.text}</li>)}</ul>
          <h3>Conviction log</h3>
          {Object.keys(zero.convictionLog).length === 0 && <p className="muted">No Conviction has been awarded yet.</p>}
          <ul data-testid="codex-conviction">{Object.values(zero.convictionLog).map((e) => <li key={e.id} data-testid="codex-conviction-entry">{characters[e.characterId]?.name ?? e.characterId}: {e.note}</li>)}</ul>
        </section>
      )}
      {tab === 'director' && me.role === 'gm' && (
        <>
          <Director game={game} characters={characters} cards={cards} convictionLog={zero.convictionLog} overrides={zero.overrides} me={me} campaign={campaign} onNotice={onNotice} />
          <SessionZero game={game} characters={characters} creation={zero.creation} canon={zero.canon} phase={zero.phase} overrides={zero.overrides} onNotice={onNotice} />
          <TablePanel accounts={accounts} campaign={campaign} onNotice={onNotice} />
        </>
      )}
    </>
  );
}
