import { describe, expect, it } from 'vitest';
import { RuleViolation, pushBattle, resolveBattle, scriptedDice, setBattle, type Contribution } from '../src';
import { validateCreation } from '../src';
import { card, validCharacter } from './helpers';

// Aric (Capable) leads against a Hard barricade with a Severe Danger (Rules v4 4.6).
const lead = card({ difficulty: 'Hard', danger: 'Severe', backing: 'belief' });
const sella: Contribution = { characterId: 'sella', type: 'open', dangerRank: 'Serious', dangerText: 'Wounded by return fire' };
const ilse: Contribution = { characterId: 'ilse', type: 'cover', target: 'aric', dangerRank: 'Real', dangerText: 'the fire spreads' };

describe('setBattle', () => {
  it('applies Open, Cover and Press, and gives every contributor their own Danger', () => {
    const s = setBattle('aric', lead, [sella, ilse]);
    expect(s.lead.difficulty).toBe('Demanding'); // Hard -> Demanding
    expect(s.lead.danger).toBe('Serious'); // Severe -> Serious
    expect(s.lead.severity).toBe('Serious');
    expect(s.dangers.map((d) => [d.characterId, d.rank, d.worstWound])).toEqual([['aric', 'Serious', 'Wounded'], ['sella', 'Serious', 'Wounded'], ['ilse', 'Real', 'Hurt']]);
    const p = setBattle('aric', lead, [{ characterId: 'x', type: 'press', dangerRank: 'Real', dangerText: '' }]);
    expect(p.lead.skill).toBe('Expert');
  });
  it('a Cover can lower another contributor\'s Danger', () => {
    const s = setBattle('aric', lead, [sella, { characterId: 'ilse', type: 'cover', target: 'sella', dangerRank: 'Real', dangerText: '' }]);
    expect(s.dangers.find((d) => d.characterId === 'sella')?.rank).toBe('Real');
  });
  it('caps contributions at two ranks per ladder', () => {
    const three = ['a', 'b', 'c'].map((id): Contribution => ({ characterId: id, type: 'open', dangerRank: 'Real', dangerText: '' }));
    expect(() => setBattle('aric', lead, three)).toThrow(/at most 2/);
    const covers = ['a', 'b', 'c'].map((id): Contribution => ({ characterId: id, type: 'cover', target: 'aric', dangerRank: 'Real', dangerText: '' }));
    expect(() => setBattle('aric', lead, covers)).toThrow(RuleViolation);
  });
  it('a Cover must name a target; withdrawn contributions leave the roll', () => {
    expect(() => setBattle('aric', lead, [{ ...ilse, target: undefined }])).toThrow(/names whose Danger/);
    const s = setBattle('aric', lead, [sella, { ...ilse, withdrawn: true }]);
    expect(s.lead.danger).toBe('Severe');
    expect(s.dangers.map((d) => d.characterId)).toEqual(['aric', 'sella']);
  });
});

describe('resolveBattle', () => {
  // Skill d8, backing d6, Difficulty d8 (Demanding), then Dangers: aric d8, sella d8, ilse d6.
  it('one roll against the Difficulty and each Danger separately', () => {
    const r = resolveBattle('aric', lead, [sella, ilse], scriptedDice([7, 2, 3, 3, 8, 4]));
    expect(r.goal).toBe(true);
    expect(r.dangers.map((d) => [d.characterId, d.hit])).toEqual([['aric', false], ['sella', true], ['ilse', false]]);
  });
});

describe('pushBattle', () => {
  const failed = () => resolveBattle('aric', lead, [sella, ilse], scriptedDice([2, 1, 8, 2, 8, 2])); // fails; aric avoids; sella hit; ilse avoids

  it('a hit Danger stands, and a standard push rechecks every avoided Danger one rank worse', () => {
    const f = failed();
    expect(f.goal).toBe(false);
    expect(f.dangers.map((d) => d.hit)).toEqual([false, true, false]);
    // New roll: skill 8, backing 1, Difficulty 1; recheck aric at Severe d10 (10: hit), ilse at Serious d8 (1: avoided).
    const p = pushBattle(f, 'standard', scriptedDice([8, 1, 1, 10, 1]));
    expect(p.goal).toBe(true);
    expect(p.dangers.map((d) => [d.hit, d.recheck?.rank])).toEqual([[true, 'Severe'], [true, undefined], [false, 'Serious']]);
    expect(p.dangers[0]?.severity).toBe('Serious'); // the worst cost stays as set
  });
  it('a contributor who withdraws takes their shift and Danger out; a Danger that already hit stands', () => {
    const f = failed();
    // Ilse withdraws: her Cover leaves (aric's Danger back to Severe, then Grave on recheck), no recheck for her.
    const p = pushBattle(f, 'standard', scriptedDice([8, 1, 1, 3]), ['ilse']);
    const ilseResult = p.dangers.find((d) => d.characterId === 'ilse')!;
    expect(ilseResult).toMatchObject({ withdrawn: true, hit: false });
    expect(ilseResult.recheck).toBeUndefined();
    expect(p.dangers[0]?.recheck?.rank).toBe('Grave');
    // Sella withdraws after being hit: the hit stands.
    const q = pushBattle(failed(), 'standard', scriptedDice([8, 1, 1, 3, 1]), ['sella']);
    expect(q.dangers.find((d) => d.characterId === 'sella')?.hit).toBe(true);
  });
  it('a Conviction push rechecks nothing', () => {
    const p = pushBattle(failed(), 'conviction', scriptedDice([8, 1, 1]));
    expect(p.dangers.every((d) => d.recheck === undefined)).toBe(true);
  });
  it('the lead cannot withdraw, a success cannot be pushed, and only one push is allowed', () => {
    expect(() => pushBattle(failed(), 'standard', scriptedDice([]), ['aric'])).toThrow(/lead cannot/);
    const won = resolveBattle('aric', lead, [sella], scriptedDice([8, 1, 1, 1, 1]));
    expect(() => pushBattle(won, 'standard', scriptedDice([]))).toThrow(/failed goal/);
    const once = pushBattle(failed(), 'conviction', scriptedDice([1, 1, 8]));
    expect(() => pushBattle(once, 'conviction', scriptedDice([]))).toThrow(/only once/);
  });
});

describe('creation with four chapters', () => {
  it('the bad chapter may be the second or third', () => {
    const c = validCharacter();
    c.chapters = [...c.chapters, { summary: 'Veteran years', endsBadly: false, pick: 'resource' }];
    expect(validateCreation(c)).toEqual([]);
    const third = { ...c, chapters: c.chapters.map((ch, i) => ({ ...ch, endsBadly: i === 2 })),
      threads: [{ ...c.threads[0]!, source: { type: 'chapter' as const, index: 2 } }],
      traits: c.traits.map((t) => (t.harmful ? { ...t, source: { type: 'chapter' as const, index: 2 } } : t)) };
    expect(validateCreation(third)).toEqual([]);
  });
});
