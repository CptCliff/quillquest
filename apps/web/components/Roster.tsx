'use client';
import { useState } from 'react';
import type { Character } from '@quillquest/rules';
import { ApiFailure, type AccountApi, type GameApi } from '../lib/game-api';
import { SheetBody, Tokens } from './Sheet';
import type { Me } from './StoryEditor';

function LayDown({ character, burdenId, api, onNotice }: { character: Character; burdenId: string; api: GameApi; onNotice: (m: string) => void }) {
  const [kind, setKind] = useState<'trait' | 'beliefRewrite'>('trait');
  const [text, setText] = useState('');
  const go = async () => {
    try { await api.layDown(character.id, burdenId, { kind, text }); setText(''); } catch (e) { onNotice(e instanceof ApiFailure ? e.message : 'Something went wrong'); }
  };
  return (
    <div className="row">
      <select aria-label="What it leaves" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        <option value="trait">It becomes a Trait</option><option value="beliefRewrite">Rewrite the Belief</option>
      </select>
      <input aria-label="Text" placeholder={kind === 'trait' ? 'The new Trait' : 'The rewritten Belief'} value={text} onChange={(e) => setText(e.target.value)} />
      <button data-testid="lay-down" disabled={!text.trim()} onClick={go}>Lay down</button>
    </div>
  );
}

/** Open table: everyone sees every player character's full sheet (design plan 5.4). */
export function Roster({ characters, me, api, accounts, campaign, onNotice, onSkill, onLeft, focus }: {
  characters: Record<string, Character>; me: Me; api: GameApi; accounts: AccountApi; campaign: string;
  onNotice: (m: string) => void; onSkill: (characterId: string, skill: string) => void; onLeft: () => void; focus?: string | null;
}) {
  const list = Object.values(characters);
  const leave = () => {
    if (!window.confirm('Leave this campaign? You will still be able to read the story, but not write in it.')) return;
    accounts.leave(campaign).then(onLeft, (e) => onNotice(e instanceof ApiFailure ? e.message : 'Something went wrong'));
  };
  return (
    <section aria-label="Roster" data-testid="roster">
      {list.length === 0 && <p className="muted">No characters yet.</p>}
      {list.map((c) => {
        const mine = c.ownerId === me.id;
        return (
          <article key={c.id} className={`sheet${focus === c.id ? ' focus' : ''}`} data-testid="sheet" data-character={c.id} ref={(el) => { if (el && focus === c.id) el.scrollIntoView({ block: 'nearest' }); }}>
            <h3>{c.name}{c.left ? ' (left)' : ''} <Tokens n={c.conviction} /></h3>
            <SheetBody c={c} onSkill={(s) => onSkill(c.id, s)}
              burdenExtra={mine || me.role === 'gm' ? (id) => <LayDown character={c} burdenId={id} api={api} onNotice={onNotice} /> : undefined} />
          </article>
        );
      })}
      {me.role !== 'gm' && !me.left && <button type="button" data-testid="leave" onClick={leave}>Leave this campaign</button>}
    </section>
  );
}
