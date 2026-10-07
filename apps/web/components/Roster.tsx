'use client';
import { useState } from 'react';
import type { Character } from '@quillquest/rules';
import { ApiFailure, type GameApi } from '../lib/game-api';
import type { Me } from './StoryEditor';

function Tokens({ n }: { n: number }) {
  return <span aria-label={`${n} Conviction`} data-testid="conviction">{'●'.repeat(n)}{'○'.repeat(Math.max(0, 3 - n))}</span>;
}

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
export function Roster({ characters, me, api, onNotice }: { characters: Record<string, Character>; me: Me; api: GameApi; onNotice: (m: string) => void }) {
  const list = Object.values(characters);
  if (list.length === 0) return <p className="muted">No characters yet.</p>;
  return (
    <section aria-label="Roster" data-testid="roster">
      {list.map((c) => {
        const mine = c.id === `${me.id}-pc`;
        const burdens = c.burdens.filter((b) => b.status === 'active');
        return (
          <article key={c.id} className="sheet" data-testid="sheet" data-character={c.id}>
            <h3>{c.name} <Tokens n={c.conviction} /></h3>
            <div><strong>Skills</strong>: {c.skills.map((s) => `${s.name} ${s.rank}`).join(' · ') || 'none'}</div>
            <div><strong>Beliefs</strong>: <ul>{c.beliefs.map((b) => <li key={b.id}>{b.isCore ? 'Core: ' : ''}{b.text}</li>)}</ul></div>
            {c.traits.length > 0 && <div><strong>Traits</strong>: {c.traits.map((t) => t.text).join(' · ')}</div>}
            {c.possessions.length > 0 && <div><strong>Possessions</strong>: {c.possessions.map((p) => p.name).join(' · ')}</div>}
            <div data-testid="wounds"><strong>Wounds</strong>: {c.wounds.length ? c.wounds.map((w) => `${w.name} (${w.level})`).join(' · ') : 'none'}{c.collapsed ? ' · Collapsed' : ''}</div>
            <div data-testid="burdens"><strong>Burdens</strong>: {burdens.length ? '' : 'none'}</div>
            {burdens.map((b) => (
              <div key={b.id} className="burden" data-testid="burden">
                <span>{b.name}</span>
                {(mine || me.role === 'gm') && <LayDown character={c} burdenId={b.id} api={api} onNotice={onNotice} />}
              </div>
            ))}
          </article>
        );
      })}
    </section>
  );
}
