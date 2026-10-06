import { describe, expect, it } from 'vitest';
import { validateCreation } from '../src';
import { validCharacter } from './helpers';

const codes = (c = validCharacter(), o = {}) => validateCreation(c, o).map((p) => p.code);

describe('validateCreation', () => {
  it('passes a complete character', () => expect(codes()).toEqual([]));
  it('fails when the bad chapter is last', () => {
    const c = validCharacter();
    c.chapters = c.chapters.map((ch, i) => ({ ...ch, endsBadly: i === 2 }));
    expect(codes(c)).toContain('BAD_CHAPTER_POSITION');
  });
  it('fails when the bad chapter is first, or there is not exactly one', () => {
    const c = validCharacter();
    expect(codes({ ...c, chapters: c.chapters.map((ch, i) => ({ ...ch, endsBadly: i === 0 })) })).toContain('BAD_CHAPTER_POSITION');
    expect(codes({ ...c, chapters: c.chapters.map((ch) => ({ ...ch, endsBadly: false })) })).toContain('BAD_CHAPTER_COUNT');
  });
  it('fails with no Thread', () => {
    const c = { ...validCharacter(), threads: [] };
    expect(codes(c)).toEqual(expect.arrayContaining(['NO_THREAD', 'BAD_CHAPTER_THREAD']));
  });
  it('needs a harmful Trait from the bad chapter', () => {
    const c = validCharacter();
    c.traits = c.traits.map((t) => ({ ...t, harmful: false }));
    expect(codes(c)).toContain('BAD_CHAPTER_TRAIT');
  });
  it('needs a Capable Skill, and nothing above Expert', () => {
    const c = validCharacter();
    expect(codes({ ...c, skills: [{ name: 'Riding', rank: 'Trained' }] })).toContain('NO_CAPABLE_SKILL');
    expect(codes({ ...c, skills: [{ name: 'Swordplay', rank: 'Master' }] })).toContain('SKILL_OVER_EXPERT');
  });
  it('needs one each of Connection, Resource and Thread picks', () => {
    const c = validCharacter();
    expect(codes({ ...c, chapters: c.chapters.map((ch) => ({ ...ch, pick: 'connection' as const })) })).toContain('MISSING_PICK');
  });
  it('needs Connections to two other characters (fewer at a smaller table)', () => {
    const c = { ...validCharacter(), connections: [{ id: 'c1', text: 'Sella', withCharacterId: 'sella' }] };
    expect(codes(c)).toContain('CONNECTIONS');
    expect(codes(c, { otherCharacters: 1 })).not.toContain('CONNECTIONS');
  });
  it('needs two crossings, one touching a Belief', () => {
    const c = validCharacter();
    expect(codes({ ...c, crossings: c.crossings.slice(0, 1) })).toContain('CROSSINGS');
    expect(codes({ ...c, crossings: c.crossings.map((x) => ({ ...x, touchesBelief: false })) })).toContain('CROSSING_BELIEF');
  });
  it('needs three Beliefs with the worldview as Core, and three Instincts', () => {
    const c = validCharacter();
    expect(codes({ ...c, beliefs: c.beliefs.map((b) => ({ ...b, isCore: b.kind === 'objective' })) })).toContain('CORE_BELIEF');
    expect(codes({ ...c, beliefs: c.beliefs.slice(0, 2) })).toContain('BELIEFS');
    expect(codes({ ...c, instincts: c.instincts.slice(0, 2) })).toContain('INSTINCTS');
  });
  it('limits Traits, possessions and active Burdens', () => {
    const c = validCharacter();
    expect(codes({ ...c, traits: c.traits.slice(0, 2) })).toContain('TRAIT_COUNT');
    const four = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: 'x', story: 'y' }));
    expect(codes({ ...c, possessions: four })).toContain('POSSESSIONS');
    const burdens = [1, 2, 3].map((i) => ({ id: `u${i}`, beliefId: 'b1', name: 'n', about: 'a', status: 'active' as const }));
    expect(codes({ ...c, burdens })).toContain('BURDENS');
  });
});
