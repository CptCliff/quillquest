'use client';
import type { Editor } from '@tiptap/core';
import type { PanelId } from '@quillquest/layout';
import type { CanonEntry, CheckOverride, Character, ConvictionLogEntry, CreationState, CrossingProposal, PublicBattle, PublicNpc } from '@quillquest/rules';
import type { AccountApi, GameApi, LedgerCard } from '../lib/game-api';
import { Battles } from './Battles';
import { Creation } from './Creation';
import { Director } from './Director';
import { Ledger } from './Ledger';
import { Roster } from './Roster';
import { SessionZero } from './SessionZero';
import { SuggestionsPanel } from './SuggestionsPanel';
import type { Me } from './StoryEditor';
import { TablePanel } from './TablePanel';

export type NotesTab = 'ledger' | 'create' | 'zero' | 'codex' | 'roster' | 'director';

/** Session-zero state from the server-written maps. */
export interface ZeroState { creation: Record<string, CreationState>; canon: Record<string, CanonEntry>; phase: string; crossings: CrossingProposal[]; overrides: CheckOverride[]; npcs: Record<string, PublicNpc>; convictionLog: Record<string, ConvictionLogEntry>; battles: Record<string, PublicBattle> }

/** What each tab says: an attention dot on the Ledger when a card needs you, and on Creation while your character is being made. */
export function panelLabels(me: Me, attention: boolean, creating: boolean, zeroReady = false): Record<PanelId, string> {
  return { story: 'Story', ledger: attention ? 'Ledger •' : 'Ledger', create: creating ? 'Creation •' : 'Creation', zero: zeroReady ? 'Session zero •' : 'Session zero', codex: 'Codex', roster: 'Roster', director: 'Director', info: 'Card' };
}

/**
 * The content of one of the table's notes panels (design plan 5.2). Where it is shown (which pane, which tab, left or right or below)
 * is the dock's business, not this component's.
 */
export function NotesPanel({ panel: tab, cards, characters, me, game, accounts, campaign, editor, onNotice, openCharacter, openSkill, focusSheet, onLeft, zero }: {
  panel: PanelId; cards: LedgerCard[]; characters: Record<string, Character>; me: Me; game: GameApi; accounts: AccountApi;
  campaign: string; editor: Editor | null; onNotice: (m: string) => void; openCharacter: (characterId: string) => void;
  openSkill: (characterId: string, skill: string) => void; focusSheet: string | null; onLeft: () => void; zero: ZeroState;
}) {
  const mine = Object.values(characters).find((c) => c.ownerId === me.id) ?? null;
  return (
    <>
      {tab === 'ledger' && (
        <>
          <Battles battles={zero.battles} characters={characters} me={me} game={game} onNotice={onNotice} />
          <Ledger cards={cards} character={me.left ? null : mine} env={{ api: game, me, characters, editor, onNotice, openCharacter, phase: zero.phase }} />
          {editor && <SuggestionsPanel editor={editor} userId={me.id} />}
        </>
      )}
      {tab === 'create' && <Creation me={me} characters={characters} creation={zero.creation} crossings={zero.crossings} phase={zero.phase} game={game} editor={editor} onNotice={onNotice} campaign={campaign} />}
      {tab === 'roster' && <Roster characters={characters} creation={zero.creation} npcs={zero.npcs} me={me} api={game} accounts={accounts} campaign={campaign} onNotice={onNotice} onSkill={openSkill} onLeft={onLeft} focus={focusSheet} />}
      {tab === 'codex' && (
        <section aria-label="Canon" data-testid="canon">
          <h3>Canon</h3>
          {Object.keys(zero.canon).length === 0 && <p className="muted">Nothing is established yet. Facts the table agrees on in session zero appear here.</p>}
          <ul>{Object.values(zero.canon).map((e) => <li key={e.id} data-testid="canon-entry">{e.text}</li>)}</ul>
          <h3>Conviction log</h3>
          {Object.keys(zero.convictionLog).length === 0 && <p className="muted">No Conviction has been awarded yet.</p>}
          <ul data-testid="codex-conviction">{Object.values(zero.convictionLog).map((e) => <li key={e.id} data-testid="codex-conviction-entry">{characters[e.characterId]?.name ?? e.characterId}: {e.note}</li>)}</ul>
        </section>
      )}
      {tab === 'zero' && me.role === 'gm' && (
        <SessionZero game={game} characters={characters} creation={zero.creation} canon={zero.canon} phase={zero.phase} overrides={zero.overrides} onNotice={onNotice} />
      )}
      {tab === 'director' && me.role === 'gm' && (
        <>
          <Director game={game} characters={characters} cards={cards} convictionLog={zero.convictionLog} overrides={zero.overrides} me={me} campaign={campaign} editor={editor} onNotice={onNotice} />
          <TablePanel accounts={accounts} campaign={campaign} onNotice={onNotice} />
        </>
      )}
    </>
  );
}
