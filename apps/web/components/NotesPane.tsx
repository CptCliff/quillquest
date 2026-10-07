'use client';
import type { Editor } from '@tiptap/core';
import type { Character } from '@quillquest/rules';
import type { AccountApi, GameApi, LedgerCard } from '../lib/game-api';
import { Ledger } from './Ledger';
import { Roster } from './Roster';
import { SuggestionsPanel } from './SuggestionsPanel';
import type { Me } from './StoryEditor';
import { TablePanel } from './TablePanel';

export type NotesTab = 'ledger' | 'codex' | 'roster' | 'director';

/** The Notes pane (design plan 5.2): Ledger and Roster are live; the GM's tab holds the table and invites; Codex arrives in M6. */
export function NotesPane({ tab, onTab, cards, characters, me, game, accounts, campaign, editor, onNotice, openCharacter, openSkill, focusSheet, attention, onLeft }: {
  tab: NotesTab; onTab: (t: NotesTab) => void; cards: LedgerCard[]; characters: Record<string, Character>; me: Me; game: GameApi; accounts: AccountApi;
  campaign: string; editor: Editor | null; onNotice: (m: string) => void; openCharacter: (characterId: string) => void;
  openSkill: (characterId: string, skill: string) => void; focusSheet: string | null; attention: boolean; onLeft: () => void;
}) {
  const mine = Object.values(characters).find((c) => c.ownerId === me.id) ?? null;
  const tabs: { id: NotesTab; label: string; show: boolean }[] = [
    { id: 'ledger', label: attention ? 'Ledger •' : 'Ledger', show: true },
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
      {tab === 'roster' && <Roster characters={characters} me={me} api={game} accounts={accounts} campaign={campaign} onNotice={onNotice} onSkill={openSkill} onLeft={onLeft} focus={focusSheet} />}
      {tab === 'codex' && <p className="muted">The Canon and the Conviction log arrive with the Director tools (M6).</p>}
      {tab === 'director' && me.role === 'gm' && <TablePanel accounts={accounts} campaign={campaign} onNotice={onNotice} />}
    </>
  );
}
