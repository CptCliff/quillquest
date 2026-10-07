'use client';
import { skillCardInfo, type Character } from '@quillquest/rules';
import { SheetBody, Tokens } from './Sheet';

export type OpenCard = { kind: 'character'; characterId: string } | { kind: 'skill'; characterId: string; skill: string };

/**
 * An info card (design plan 5.4): opens beside the text on a computer and as a bottom sheet on a phone (CSS decides).
 * A name shows the character; a Skill shows its rated rank and every shift the sheet could bring, with the reason.
 */
export function InfoCard({ card, characters, onClose, onSkill, onOpenSheet }: {
  card: OpenCard; characters: Record<string, Character>; onClose: () => void; onSkill: (characterId: string, skill: string) => void; onOpenSheet: (characterId: string) => void;
}) {
  const c = characters[card.characterId];
  if (!c) return null;
  if (card.kind === 'skill') {
    const info = skillCardInfo(c, card.skill);
    return (
      <aside className="infocard" role="dialog" aria-label={`${info.name}, ${c.name}`} data-testid="infocard" data-kind="skill">
        <header><strong data-testid="infocard-title">{info.name} · {info.rank}</strong><button type="button" aria-label="Close" data-testid="infocard-close" onClick={onClose}>×</button></header>
        <p>{c.name}'s {info.onSheet ? 'rated rank' : 'Skill is not on the sheet, so it is attempted'} <strong>{info.rank}</strong>.</p>
        {info.notes.length > 0 ? (
          <ul data-testid="skill-notes">
            {info.notes.map((n) => (
              <li key={`${n.reason}-${n.direction}`}>{info.rank}, shifted {n.direction} by {n.reason}: <strong>{n.result}</strong></li>
            ))}
          </ul>
        ) : <p className="muted">Nothing on the sheet shifts this Skill right now.</p>}
        <p className="muted">Which shifts apply is agreed at Set.</p>
      </aside>
    );
  }
  return (
    <aside className="infocard" role="dialog" aria-label={c.name} data-testid="infocard" data-kind="character">
      <header>
        <strong data-testid="infocard-title">{c.name}{c.left ? ' (left)' : ''}</strong> <Tokens n={c.conviction} />
        <button type="button" aria-label="Close" data-testid="infocard-close" onClick={onClose}>×</button>
      </header>
      <SheetBody c={c} onSkill={(s) => onSkill(c.id, s)} />
      <button type="button" data-testid="open-sheet" onClick={() => onOpenSheet(c.id)}>Open full sheet</button>
    </aside>
  );
}
