'use client';
import { useState } from 'react';
import type { Character, CreationState, PublicNpc } from '@quillquest/rules';
import { StepForm } from './Forms';
import { useAct } from './Ledger';
import { NotifyPrefs } from './NotifyPrefs';
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
export function Roster({ characters, creation, npcs, me, api, accounts, campaign, onNotice, onSkill, onLeft, focus }: {
  characters: Record<string, Character>; creation: Record<string, CreationState>; npcs: Record<string, PublicNpc>; me: Me; api: GameApi; accounts: AccountApi; campaign: string;
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
            <h3>{c.name}{c.left ? ' (left)' : ''} {creation[c.id]?.status === 'creating' && <span className="badge" data-testid="creating-badge" title="Still making their character">creating</span>} <Tokens n={c.conviction} /></h3>
            {me.role !== 'gm' && !me.left && !mine && !c.left && <Nominate character={c} api={api} onNotice={onNotice} />}
            <SheetBody c={c} onSkill={(s) => onSkill(c.id, s)}
              burdenExtra={mine || me.role === 'gm' ? (id) => <LayDown character={c} burdenId={id} api={api} onNotice={onNotice} /> : undefined} />
          </article>
        );
      })}
      {Object.keys(npcs).length > 0 && (
        <>
          <h3>People you have met</h3>
          {Object.values(npcs).map((n) => (
            <article key={n.id} className="sheet" data-testid="npc-public" data-npc={n.id}>
              <h3>{n.name ?? 'Someone'}</h3>
              {n.skills && <div data-testid="npc-public-skills"><strong>Skills</strong>: {n.skills.map((s) => `${s.name} ${s.rank}`).join(' · ') || 'none'}</div>}
              {n.beliefs && <div data-testid="npc-public-beliefs"><strong>Beliefs</strong>: {n.beliefs.join(' · ') || 'none'}</div>}
              {n.notes !== undefined && <div data-testid="npc-public-notes"><strong>Notes</strong>: {n.notes}</div>}
            </article>
          ))}
        </>
      )}
      {!me.left && <NotifyPrefs game={api} onNotice={onNotice} />}
      {me.role !== 'gm' && !me.left && <button type="button" data-testid="leave" onClick={leave}>Leave this campaign</button>}
    </section>
  );
}

/** Any player may nominate another player's moment for Conviction; the GM decides. */
function Nominate({ character, api, onNotice }: { character: Character; api: GameApi; onNotice: (m: string) => void }) {
  const { busy, run } = useAct(onNotice);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="linklike" data-testid="nominate-open" onClick={() => setOpen(true)}>Nominate a moment for Conviction</button>;
  return (
    <StepForm testId={`nominate-${character.id}`} label="Nominate" run={run} busy={busy}
      fields={[
        { key: 'kind', label: 'It paid for', kind: 'select', options: [{ value: 'belief', label: 'A Belief' }, { value: 'instinct', label: 'An Instinct' }, { value: 'trait', label: 'A harmful Trait' }, { value: 'other', label: 'Something else' }] },
        { key: 'beliefId', label: 'Which Belief', kind: 'select', options: character.beliefs.map((b) => ({ value: b.id, label: b.text })) },
        { key: 'note', label: 'What happened' },
      ]}
      submit={async (v) => { await api.nominate({ characterId: character.id, kind: String(v.kind), beliefId: v.kind === 'belief' ? String(v.beliefId) : undefined, note: String(v.note) }); setOpen(false); onNotice('Nominated. The GM will decide.'); }} />
  );
}
