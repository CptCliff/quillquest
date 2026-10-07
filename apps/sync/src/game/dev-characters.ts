import { newCharacter, type Character } from '@quillquest/rules';

/**
 * Dev only. The preset dev users (Ilse, Sella, Rook) keep ready-made sheets so earlier tests and demos work without replaying
 * session zero. Everyone else starts with a blank character and creates it (M5).
 */
type Template = (id: (s: string) => string) => Partial<Character>;

const trait = (id: string, text: string, harmful = false) => ({ id, text, harmful, source: { type: 'other' as const } });

const TEMPLATES: Record<'ilse' | 'sella' | 'rook', Template> = {
  ilse: (k) => ({
    skills: [{ name: 'Climb', rank: 'Capable' }, { name: 'Sneak', rank: 'Expert' }, { name: 'Persuade', rank: 'Trained' }],
    beliefs: [
      { id: k('obj'), kind: 'objective', text: 'Expose the duke before the council meets', isCore: false, convictionEarnedThisSession: false },
      { id: k('rel'), kind: 'relationship', text: 'I will not leave Sella behind', isCore: false, convictionEarnedThisSession: false },
      { id: k('core'), kind: 'worldview', text: 'Oaths outlast the people who swear them', isCore: true, convictionEarnedThisSession: false },
    ],
    instincts: [{ id: k('i1'), text: 'Check the exits' }],
    traits: [trait(k('t1'), 'Steady Hands'), trait(k('t2'), 'Haunted by the siege', true)],
    possessions: [{ id: k('pos1'), name: "Father's Sword", story: 'carried through the Border War; the duke wants it back' }],
    armor: 'light',
    standing: { 'Royal Army': 'Respected', Cathedral: 'Distrusted' },
  }),
  sella: (k) => ({
    skills: [{ name: 'Swordplay', rank: 'Expert' }, { name: 'Ride', rank: 'Capable' }, { name: 'Lore', rank: 'Trained' }],
    beliefs: [
      { id: k('obj'), kind: 'objective', text: 'Hold the barricade until the wagons clear', isCore: false, convictionEarnedThisSession: false },
      { id: k('rel'), kind: 'relationship', text: 'Ilse is the only one who tells me the truth', isCore: false, convictionEarnedThisSession: false },
      { id: k('core'), kind: 'worldview', text: 'A debt unpaid is a chain you wear', isCore: true, convictionEarnedThisSession: false },
    ],
    instincts: [{ id: k('i1'), text: 'Sit facing the door' }],
    traits: [trait(k('t1'), 'Scarred Veteran'), trait(k('t2'), 'Cannot Back Down', true)],
    armor: 'heavy',
  }),
  rook: (k) => ({
    skills: [{ name: 'Lockpicking', rank: 'Expert' }, { name: 'Streetwise', rank: 'Capable' }, { name: 'Bluff', rank: 'Trained' }],
    beliefs: [
      { id: k('obj'), kind: 'objective', text: "Clear my sister's name", isCore: false, convictionEarnedThisSession: false },
      { id: k('rel'), kind: 'relationship', text: 'The Wren owes me and knows it', isCore: false, convictionEarnedThisSession: false },
      { id: k('core'), kind: 'worldview', text: 'Everyone has a price, and I have not met mine', isCore: true, convictionEarnedThisSession: false },
    ],
    instincts: [{ id: k('i1'), text: 'Count the guards' }],
    traits: [trait(k('t1'), 'Light Fingers'), trait(k('t2'), 'Owes the Wrens', true)],
  }),
};

function build(userId: string, name: string, key: keyof typeof TEMPLATES | null): Character {
  const base: Character = { ...newCharacter(`${userId}-pc`, name), ownerId: userId, origin: 'Ready-made dev character' };
  return key ? { ...base, ...TEMPLATES[key]((s) => `${userId}-${s}`) } : base;
}

/** The preset dev users keep the sheets they always had (ids like `ilse-pc`), so earlier tests and demos are unchanged. */
export function seedDevCharacter(userId: string): Character | null {
  return userId in TEMPLATES ? build(userId, userId[0]!.toUpperCase() + userId.slice(1), userId as keyof typeof TEMPLATES) : null;
}
