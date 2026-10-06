import { describe, expect, it } from 'vitest';
import { RuleViolation, applyShifts } from '../src';
import { shift } from './helpers';

const base = { skill: 'Capable', difficulty: 'Demanding', danger: 'Serious' } as const;

describe('applyShifts', () => {
  it('stacks: a Trait, a tool and preparation take Untrained to Expert', () => {
    const r = applyShifts({ skill: 'Untrained', difficulty: 'Hard', danger: 'Real',
      shifts: [shift('skill', 1, 'trait'), shift('skill', 1, 'gear'), shift('skill', 1, 'preparation')] });
    expect(r.skill).toBe('Expert');
  });
  it('moves Difficulty and Danger independently', () => {
    const r = applyShifts({ ...base, shifts: [shift('difficulty', -1), shift('danger', 1)] });
    expect([r.difficulty, r.danger]).toEqual(['Ordinary', 'Severe']);
  });
  it('allows only one preparation shift per ladder, but one per ladder is fine', () => {
    expect(() => applyShifts({ ...base, shifts: [shift('skill', 1, 'preparation'), shift('skill', 1, 'preparation')] })).toThrow(RuleViolation);
    expect(() => applyShifts({ ...base, shifts: [shift('skill', 1, 'preparation'), shift('difficulty', -1, 'preparation')] })).not.toThrow();
  });
  it('allows one helper per roll, except in a battle roll', () => {
    const two = [shift('skill', 1, 'helping'), shift('skill', 1, 'helping')];
    expect(() => applyShifts({ ...base, shifts: two })).toThrow(/One helper/);
    expect(() => applyShifts({ ...base, shifts: two, battle: true })).not.toThrow();
  });
  it('caps battle contributions at two ranks per ladder', () => {
    const three = [shift('skill', 1, 'press'), shift('skill', 1, 'press'), shift('skill', 1, 'press')];
    expect(() => applyShifts({ ...base, shifts: three, battle: true })).toThrow(/At most 2/);
    expect(() => applyShifts({ ...base, shifts: three.slice(0, 2), battle: true })).not.toThrow();
  });
  it('edge rule: armor against a Minor threat shifts the Skill up', () => {
    const r = applyShifts({ ...base, danger: 'Minor', shifts: [shift('danger', -1, 'armor')] });
    expect(r.danger).toBe('Minor');
    expect(r.skill).toBe('Expert');
    expect(r.edgeConverted).toBe(1);
  });
  it('edge rule: a strained wound against a Grave Danger shifts the Skill down', () => {
    const r = applyShifts({ ...base, danger: 'Grave', shifts: [shift('danger', 1, 'wound')] });
    expect(r.danger).toBe('Grave');
    expect(r.skill).toBe('Trained');
  });
  it('edge rule uses the net Danger movement, so order never matters', () => {
    const r = applyShifts({ ...base, danger: 'Minor', shifts: [shift('danger', -1, 'armor'), shift('danger', 1, 'wound')] });
    expect([r.skill, r.danger, r.edgeConverted]).toEqual(['Capable', 'Minor', 0]);
  });
  it('shifts past Hampered/Peerless and Trivial/Mythic are lost', () => {
    const lowEnd = applyShifts({ skill: 'Untrained', difficulty: 'Simple', danger: 'Real',
      shifts: [shift('skill', -1), shift('skill', -1), shift('difficulty', -1), shift('difficulty', -1)] });
    expect([lowEnd.skill, lowEnd.difficulty, lowEnd.lost]).toEqual(['Hampered', 'Trivial', { skill: 1, difficulty: 1 }]);
    const top = applyShifts({ skill: 'Master', difficulty: 'Mythic', danger: 'Real',
      shifts: [shift('skill', 1), shift('skill', 1), shift('skill', 1), shift('difficulty', 1)] });
    expect([top.skill, top.difficulty, top.lost]).toEqual(['Peerless', 'Mythic', { skill: 1, difficulty: 1 }]);
  });
  it('rejects ranks that exist only through shifts as a base', () => {
    expect(() => applyShifts({ skill: 'Heroic', difficulty: 'Hard', danger: 'Real', shifts: [] } as never)).toThrow(/rated Skill/);
    expect(() => applyShifts({ skill: 'Capable', difficulty: 'Trivial', danger: 'Real', shifts: [] })).toThrow(/Trivial/);
  });
});
