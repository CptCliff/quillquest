import { newCharacter, type Character } from '@quillquest/rules';

/**
 * DEV ONLY. Until character creation (M5), each preset user gets a ready-made character so cards have Skills, Beliefs and
 * gear to draw on. Replace this one function when real characters exist.
 */
export function seedDevCharacter(userId: string): Character | null {
  const base = (name: string): Character => ({ ...newCharacter(`${userId}-pc`, name), origin: 'Dev character (seeded)' });
  const belief = (kind: 'objective' | 'relationship' | 'worldview', id: string, text: string) => ({ id: `${userId}-${id}`, kind, text, isCore: kind === 'worldview', convictionEarnedThisSession: false });
  const trait = (id: string, text: string, harmful = false) => ({ id: `${userId}-${id}`, text, harmful, source: { type: 'other' as const } });
  switch (userId) {
    case 'ilse':
      return {
        ...base('Ilse'),
        skills: [{ name: 'Climb', rank: 'Capable' }, { name: 'Sneak', rank: 'Expert' }, { name: 'Persuade', rank: 'Trained' }],
        beliefs: [belief('objective', 'obj', 'Expose the duke before the council meets'), belief('relationship', 'rel', 'I will not leave Sella behind'), belief('worldview', 'core', 'Oaths outlast the people who swear them')],
        instincts: [{ id: 'ilse-i1', text: 'Check the exits' }],
        traits: [trait('t1', 'Steady Hands'), trait('t2', 'Haunted by the siege', true)],
        possessions: [{ id: 'ilse-pos1', name: "Father's Sword", story: 'carried through the Border War; the duke wants it back' }],
        armor: 'light', standing: { 'Royal Army': 'Respected', Cathedral: 'Distrusted' },
      };
    case 'sella':
      return {
        ...base('Sella'),
        skills: [{ name: 'Swordplay', rank: 'Expert' }, { name: 'Ride', rank: 'Capable' }, { name: 'Lore', rank: 'Trained' }],
        beliefs: [belief('objective', 'obj', 'Hold the barricade until the wagons clear'), belief('relationship', 'rel', 'Ilse is the only one who tells me the truth'), belief('worldview', 'core', 'A debt unpaid is a chain you wear')],
        instincts: [{ id: 'sella-i1', text: 'Sit facing the door' }],
        traits: [trait('t1', 'Scarred Veteran'), trait('t2', 'Cannot Back Down', true)],
        armor: 'heavy',
      };
    case 'rook':
      return {
        ...base('Rook'),
        skills: [{ name: 'Lockpicking', rank: 'Expert' }, { name: 'Streetwise', rank: 'Capable' }, { name: 'Bluff', rank: 'Trained' }],
        beliefs: [belief('objective', 'obj', 'Clear my sister\'s name'), belief('relationship', 'rel', 'The Wren owes me and knows it'), belief('worldview', 'core', 'Everyone has a price, and I have not met mine')],
        instincts: [{ id: 'rook-i1', text: 'Count the guards' }],
        traits: [trait('t1', 'Light Fingers'), trait('t2', 'Owes the Wrens', true)],
      };
    default:
      return null;
  }
}
