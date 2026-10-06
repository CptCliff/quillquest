import { newCharacter, type Character, type CardInput, type Shift } from '../src';

export const card = (over: Partial<CardInput> = {}): CardInput => ({
  skill: 'Capable', difficulty: 'Demanding', danger: 'Serious', shifts: [], backing: 'none', dangerKind: 'wound', ...over,
});
export const shift = (ladder: Shift['ladder'], delta: 1 | -1, source: Shift['source'] = 'other'): Shift => ({ ladder, delta, source, reason: 'test' });

/** A character who passes validateCreation. */
export function validCharacter(): Character {
  return {
    ...newCharacter('aric', 'Aric'),
    origin: 'A border farm.',
    chapters: [
      { summary: 'Squire', endsBadly: false, pick: 'connection' },
      { summary: 'Soldier; the siege went wrong', endsBadly: true, pick: 'thread' },
      { summary: 'Merchant guard', endsBadly: false, pick: 'resource' },
    ],
    skills: [{ name: 'Swordplay', rank: 'Capable' }, { name: 'Riding', rank: 'Trained' }],
    beliefs: [
      { id: 'b1', kind: 'objective', text: 'Expose the duke before the council meets', isCore: false, convictionEarnedThisSession: false },
      { id: 'b2', kind: 'relationship', text: 'I will not leave Ilse behind', isCore: false, convictionEarnedThisSession: false },
      { id: 'b3', kind: 'worldview', text: 'Oaths outlast the people who swear them', isCore: true, convictionEarnedThisSession: false },
    ],
    instincts: [{ id: 'i1', text: 'Check exits' }, { id: 'i2', text: 'Sit facing the door' }, { id: 'i3', text: 'Count the guards' }],
    traits: [
      { id: 't1', text: 'Disciplined', harmful: false, source: { type: 'chapter', index: 0 } },
      { id: 't2', text: 'Haunted by the siege', harmful: true, source: { type: 'chapter', index: 1 } },
      { id: 't3', text: 'Reads a ledger', harmful: false, source: { type: 'chapter', index: 2 } },
    ],
    connections: [{ id: 'c1', text: 'Sella', withCharacterId: 'sella' }, { id: 'c2', text: 'Ilse', withCharacterId: 'ilse' }],
    threads: [{ id: 'th1', text: 'The captain wants him silenced', source: { type: 'chapter', index: 1 } }],
    crossings: [
      { withCharacterId: 'sella', myChapter: 1, theirChapter: 0, touchesBelief: true },
      { withCharacterId: 'ilse', myChapter: 2, theirChapter: 1, touchesBelief: false },
    ],
  };
}
