'use client';
import type { ReactNode } from 'react';
import type { Character } from '@quillquest/rules';

export function Tokens({ n }: { n: number }) {
  return <span aria-label={`${n} Conviction`} data-testid="conviction">{'●'.repeat(n)}{'○'.repeat(Math.max(0, 3 - n))}</span>;
}

/** A character sheet, in words (design plan 5.4): everything the table is allowed to see, which is all of it. */
export function SheetBody({ c, onSkill, burdenExtra }: { c: Character; onSkill?: (skill: string) => void; burdenExtra?: (burdenId: string) => ReactNode }) {
  const burdens = c.burdens.filter((b) => b.status === 'active');
  return (
    <>
      <div data-testid="skills"><strong>Skills</strong>:{' '}
        {c.skills.length === 0 && 'none'}
        {c.skills.map((s, i) => (
          <span key={s.name}>{i > 0 && ' · '}
            {onSkill ? <button type="button" className="linklike" data-testid={`skill-${s.name}`} onClick={() => onSkill(s.name)}>{s.name} {s.rank}</button> : `${s.name} ${s.rank}`}
          </span>
        ))}
      </div>
      <div><strong>Beliefs</strong>: <ul>{c.beliefs.map((b) => <li key={b.id}>{b.isCore ? 'Core: ' : ''}{b.text}</li>)}</ul></div>
      {c.instincts.length > 0 && <div><strong>Instincts</strong>: {c.instincts.map((i) => i.text).join(' · ')}</div>}
      {c.traits.length > 0 && <div><strong>Traits</strong>: {c.traits.map((t) => t.text).join(' · ')}</div>}
      {c.possessions.length > 0 && <div><strong>Possessions</strong>: {c.possessions.map((p) => p.name).join(' · ')}</div>}
      {c.connections.length > 0 && <div><strong>Connections</strong>: {c.connections.map((x) => x.text).join(' · ')}</div>}
      <div data-testid="wounds"><strong>Wounds</strong>: {c.wounds.length ? c.wounds.map((w) => `${w.name} (${w.level})`).join(' · ') : 'none'}{c.collapsed ? ' · Collapsed' : ''}</div>
      <div data-testid="burdens"><strong>Burdens</strong>: {burdens.length ? '' : 'none'}</div>
      {burdens.map((b) => (
        <div key={b.id} className="burden" data-testid="burden"><span>{b.name}</span>{burdenExtra?.(b.id)}</div>
      ))}
    </>
  );
}
