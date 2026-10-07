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
});
