import { describe, expect, it } from 'vitest';
import { CHAPTER_LIBRARY, matchTemplates, templateById } from '../src';

describe('chapter library', () => {
  it('has unique ids and enough to choose from in every template', () => {
    expect(new Set(CHAPTER_LIBRARY.map((t) => t.id)).size).toBe(CHAPTER_LIBRARY.length);
    expect(CHAPTER_LIBRARY.length).toBeGreaterThanOrEqual(20);
    for (const t of CHAPTER_LIBRARY) {
      expect(t.skills.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.traits.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.harmfulTraits.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.keywords.length, t.id).toBeGreaterThanOrEqual(4);
      expect(t.outputs.connection.length, t.id).toBeGreaterThanOrEqual(1);
      expect(t.outputs.resource.length, t.id).toBeGreaterThanOrEqual(1);
      expect(t.outputs.thread.length, t.id).toBeGreaterThanOrEqual(1);
      for (const s of [...t.skills, ...t.traits, ...t.harmfulTraits]) expect(s.length, `${t.id}: ${s}`).toBeLessThanOrEqual(60);
    }
  });
  it('borrows no lifepath names from the game it is inspired by', () => {
    const banned = /burning wheel|lifepath|born\s+(noble|peasant)/i;
    expect(JSON.stringify(CHAPTER_LIBRARY)).not.toMatch(banned);
  });
  it('matches a chapter to the template its words point at', () => {
    const [best] = matchTemplates('I stood the north gate for six winters, checking carts and toll papers, and learned to read every traveller.', 'Gate guard at the border');
    expect(best!.template.id).toBe('gate-warden');
    expect(best!.tier).toBe('close');
  });
  it('is partial for one hint and none for prose that matches nothing; ties are broken by id so it is deterministic', () => {
    expect(matchTemplates('There was a boat.', '')[0]!.tier).toBe('partial');
    const none = matchTemplates('Zzz qqq xxx', '');
    expect(none[0]!.tier).toBe('none');
    expect(matchTemplates('Zzz qqq xxx', '').map((m) => m.template.id)).toEqual(none.map((m) => m.template.id));
    expect(templateById('smith')?.name).toMatch(/Smith/);
  });

  describe('reads the role, not just the words', () => {
    const top = (prose: string, summary = '') => matchTemplates(prose, summary)[0]!;
    it('a smuggler who is only the object of a verb does not make the writer a smuggler', () => {
      expect(top('I was the guard on the gate who caught a smuggler\'s cart at dawn.').template.id).toBe('gate-warden');
      expect(matchTemplates('I caught a smuggler\'s cart.').find((m) => m.template.id === 'smuggler')!.score).toBeLessThan(1);
    });
    it('a role named after "I was a", "as a" or "served" counts for more than a passing mention', () => {
      const role = matchTemplates('I served as a healer in the plague wards.').find((m) => m.template.id === 'hospitaller')!;
      const passing = matchTemplates('I passed a healer in the street.').find((m) => m.template.id === 'hospitaller')!;
      expect(role.score).toBeGreaterThan(passing.score);
      expect(role.tier).toBe('close');
    });
    it('"forged" documents are not smithing, and "forge" the workshop still is', () => {
      const docs = matchTemplates('I used a forged pass to cross the river.');
      expect(docs.find((m) => m.template.id === 'smith')!.score).toBeLessThan(1);
      expect(docs[0]!.template.id).not.toBe('smith');
      expect(top('I worked the forge and learned to hammer iron as an apprentice.').template.id).toBe('smith');
    });
    it('a field medic is a healer, not a farmhand', () => {
      expect(top('I was a field medic, stitching soldiers back together between battles.').template.id).toBe('hospitaller');
    });
    it('multi-word keywords match as phrases', () => {
      expect(matchTemplates('I ran a black market stall behind the docks.').find((m) => m.template.id === 'smuggler')!.score).toBeGreaterThanOrEqual(1);
    });
  });
});
