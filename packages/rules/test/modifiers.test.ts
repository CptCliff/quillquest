import { describe, expect, it } from 'vitest';
import { RuleViolation, addPracticedEffect, applyShifts, armorShift, magicShifts, opposedDifficulty, rungRank, woundShifts } from '../src';

describe('opposedDifficulty', () => {
  it('uses the opponent Skill on the same row', () => {
    expect(opposedDifficulty('Capable')).toBe('Demanding');
    expect(opposedDifficulty('Expert')).toBe('Hard');
    expect(opposedDifficulty('Untrained')).toBe('Simple');
  });
});

describe('armorShift', () => {
  it('Light stops Real and Serious weapon threats only', () => {
    const l = (d: never) => armorShift('light', d, 'blade') !== null;
    expect((['Minor', 'Real', 'Serious', 'Severe', 'Grave'] as const).map((d) => l(d as never))).toEqual([false, true, true, false, false]);
  });
  it('Heavy stops any blade, blow or arrow up to Grave', () => {
    for (const d of ['Minor', 'Real', 'Serious', 'Severe', 'Grave'] as const)
      for (const t of ['blade', 'blow', 'arrow'] as const) expect(armorShift('heavy', d, t)).not.toBeNull();
  });
  it('does nothing against fire, falls, drowning, poison or magic, or when broken or absent', () => {
    for (const t of ['fire', 'fall', 'drowning', 'poison', 'magic'] as const) expect(armorShift('heavy', 'Serious', t)).toBeNull();
    expect(armorShift('heavy', 'Serious', 'blade', true)).toBeNull();
    expect(armorShift('none', 'Serious', 'blade')).toBeNull();
  });
  it('Heavy armor against a Minor blow becomes a Skill-up through the edge rule', () => {
    const s = armorShift('heavy', 'Minor', 'blow')!;
    expect(applyShifts({ skill: 'Trained', difficulty: 'Ordinary', danger: 'Minor', shifts: [s] }).skill).toBe('Capable');
  });
});

describe('magic and wounds', () => {
  it('practiced lowers Difficulty; improvised raises both', () => {
    const r = applyShifts({ skill: 'Capable', difficulty: 'Hard', danger: 'Real', shifts: magicShifts('practiced') });
    expect(r.difficulty).toBe('Demanding');
    const i = applyShifts({ skill: 'Capable', difficulty: 'Hard', danger: 'Real', shifts: magicShifts('improvised') });
    expect([i.difficulty, i.danger]).toEqual(['Extraordinary', 'Serious']);
  });
  it('allows three practiced effects; a fourth must replace one', () => {
    let t = { source: 's', method: 'm', price: 'p', priceSeverities: ['a', 'b', 'c'] as [string, string, string], practicedEffects: [] as string[] };
    for (const e of ['Wall of Flame', 'Calm the Beasts', 'Ward']) t = addPracticedEffect(t, e);
    expect(() => addPracticedEffect(t, 'Fourth')).toThrow(RuleViolation);
    expect(addPracticedEffect(t, 'Fourth', 'Ward').practicedEffects).toEqual(['Wall of Flame', 'Calm the Beasts', 'Fourth']);
  });
  it('Hurt shifts the Skill down; a strained Wounded also shifts the Danger up', () => {
    expect(woundShifts('Hurt', true, 'ankle')).toHaveLength(1);
    expect(woundShifts('Wounded', true, 'ribs')).toHaveLength(2);
    expect(woundShifts('Wounded', false, 'ribs')).toHaveLength(1);
    expect(woundShifts('Critical', true, 'leg')).toEqual([]);
  });
  it('Wealth and Network rungs roll as Untrained..Master', () => {
    expect([0, 1, 2, 3, 4].map(rungRank)).toEqual(['Untrained', 'Trained', 'Capable', 'Expert', 'Master']);
  });
});
