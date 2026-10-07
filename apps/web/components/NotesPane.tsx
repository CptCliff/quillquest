'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import type { Character } from '@quillquest/rules';
import { GameApi, type LedgerCard } from '../lib/game-api';
import { useYMap } from '../lib/use-ymap';
import { Ledger } from './Ledger';
import { Roster } from './Roster';
import { SuggestionsPanel } from './SuggestionsPanel';
import type { Me } from './StoryEditor';

type Tab = 'ledger' | 'codex' | 'roster' | 'director';

/** The Notes pane (design plan 5.2): Ledger and Roster are live; Codex and Director arrive in M6. */
export function NotesPane({ doc, me, token, campaign, editor, onNotice }: { doc: Y.Doc; me: Me; token: string; campaign: string; editor: Editor | null; onNotice: (m: string) => void }) {
  const [tab, setTab] = useState<Tab>('ledger');
  const api = useMemo(() => new GameApi(campaign, token), [campaign, token]);
  const ledger = useYMap<LedgerCard>(doc.getMap('ledger'));
  const characters = useYMap<Character>(doc.getMap('characters'));
  // Opening the campaign creates (dev) and publishes your character.
  useEffect(() => { api.me().catch(() => undefined); }, [api]);
  const cards = Object.values(ledger).sort((a, b) => a.seq - b.seq);
  const mine = characters[`${me.id}-pc`] ?? null;
  const waiting = cards.some((c) => c.status === 'draft' && c.speed === 'big' && me.role === 'gm');
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'ledger', label: waiting ? 'Ledger •' : 'Ledger', show: true },
    { id: 'codex', label: 'Codex', show: true },
    { id: 'roster', label: 'Roster', show: true },
    { id: 'director', label: 'Director', show: me.role === 'gm' },
  ];
  return (
    <>
      <div className="note-tabs" role="tablist" aria-label="Notes">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'ledger' && (
        <>
          <Ledger cards={cards} character={mine} env={{ api, me, characters, editor, onNotice }} />
          {editor && <SuggestionsPanel editor={editor} userId={me.id} />}
        </>
      )}
      {tab === 'roster' && <Roster characters={characters} me={me} api={api} onNotice={onNotice} />}
      {tab === 'codex' && <p className="muted">The Canon and the Conviction log arrive with the Director tools (M6).</p>}
      {tab === 'director' && <p className="muted">Beliefs board, NPCs and the Claude assistant arrive in M6.</p>}
    </>
  );
}
