import { describe, expect, it } from 'vitest';
import { RuleViolation, applyWound, breakArmor, heal, newCharacter, repairArmor, type Character, type WoundLevel } from '../src';

let n = 0;
const hit = (c: Character, level: WoundLevel, extra: object = {}) => applyWound(c, { id: `w${++n}`, name: `${level} wound`, level, ...extra });
const wounded = (levels: WoundLevel[]) => levels.reduce((c, l) => hit(c, l, { declaredMortal: l === 'Mortal' }).character, newCharacter('a', 'A'));

describe('applyWound', () => {
  it('fills slots at the named level', () => {
    const r = hit(newCharacter('a', 'A'), 'Hurt');
    expect(r.placed).toBe('Hurt');
    expect(r.escalated).toBe(false);
  });
  it('a Hurt with full Hurt and Wounded rows becomes Critical', () => {
    const c = wounded(['Hurt', 'Hurt', 'Wounded', 'Wounded']);
    const r = hit(c, 'Hurt');
    expect(r.placed).toBe('Critical');
    expect(r.escalated).toBe(true);
    expect(r.needsRename).toBe(true);
    expect(r.character.wounds.at(-1)?.needsRename).toBe(true);
  });
  it('a full Hurt row escalates to an open Wounded slot', () => {
    expect(hit(wounded(['Hurt', 'Hurt']), 'Hurt').placed).toBe('Wounded');
  });
  it('escalation from a full Critical slot is Mortal', () => {
    const c = wounded(['Critical']);
    expect(hit(c, 'Critical').placed).toBe('Mortal');
  });
  it('Mortal needs a declaration', () => {
    expect(() => hit(newCharacter('a', 'A'), 'Mortal')).toThrow(RuleViolation);
    expect(hit(newCharacter('a', 'A'), 'Mortal', { declaredMortal: true }).placed).toBe('Mortal');
  });
  it('exhaustion never passes Collapsed', () => {
    const c = wounded(['Hurt', 'Hurt', 'Wounded', 'Wounded']);
    const r = hit(c, 'Hurt', { isExhaustion: true });
    expect(r.placed).toBe('Collapsed');
    expect(r.character.collapsed).toBe(true);
    expect(r.character.wounds).toHaveLength(4);
    expect(r.character.wounds.some((w) => w.level === 'Critical' || w.level === 'Mortal')).toBe(false);
  });
  it('exhaustion fills Hurt and Wounded like any wound', () => {
    expect(hit(newCharacter('a', 'A'), 'Hurt', { isExhaustion: true }).character.wounds[0]?.isExhaustion).toBe(true);
  });
  it('is pure: the input character is untouched', () => {
    const c = newCharacter('a', 'A');
    hit(c, 'Hurt');
    expect(c.wounds).toHaveLength(0);
  });
});

describe('heal', () => {
  const one = (level: WoundLevel, extra: object = {}) => {
    const r = hit(newCharacter('a', 'A'), level, { declaredMortal: true, ...extra });
    return { c: r.character, id: r.character.wounds[0]!.id };
  };
  it('Hurt clears with rest', () => {
    const { c, id } = one('Hurt');
    expect(heal(c, id, 'rest').character.wounds).toHaveLength(0);
  });
  it('Wounded needs treatment, and becomes Hurt', () => {
    const { c, id } = one('Wounded');
    expect(() => heal(c, id, 'rest')).toThrow(RuleViolation);
    expect(heal(c, id, 'treatment').character.wounds[0]?.level).toBe('Hurt');
  });
  it('Critical recovers to Wounded and is renamed; Mortal stabilizes to Critical', () => {
    const crit = one('Critical');
    const r = heal(crit.c, crit.id, 'recovery');
    expect(r.character.wounds[0]).toMatchObject({ level: 'Wounded', needsRename: true });
    const mortal = one('Mortal');
    expect(heal(mortal.c, mortal.id, 'stabilize').character.wounds[0]?.level).toBe('Critical');
    expect(() => heal(mortal.c, mortal.id, 'recovery')).toThrow(RuleViolation);
  });
  it('exhaustion clears with rest, and Collapsed with a safe night', () => {
    const { c, id } = one('Wounded', { isExhaustion: true });
    expect(heal(c, id, 'rest').character.wounds).toHaveLength(0);
    expect(() => heal(c, id, 'treatment')).toThrow(RuleViolation);
    expect(heal({ ...c, collapsed: true }, null, 'safeNight').character.collapsed).toBe(false);
    expect(() => heal(c, null, 'safeNight')).toThrow(RuleViolation);
  });
  it('refuses to step a wound into a full row', () => {
    const c = wounded(['Hurt', 'Hurt', 'Wounded']);
    const id = c.wounds.find((w) => w.level === 'Wounded')!.id;
    expect(() => heal(c, id, 'treatment')).toThrow(/open Hurt slot/);
  });
});

describe('armor', () => {
  it('breaks once and repairs', () => {
    const c = { ...newCharacter('a', 'A'), armor: 'light' as const };
    const broken = breakArmor(c);
    expect(broken.armorBroken).toBe(true);
    expect(() => breakArmor(broken)).toThrow(RuleViolation);
    expect(repairArmor(broken).armorBroken).toBe(false);
    expect(() => breakArmor(newCharacter('a', 'A'))).toThrow(RuleViolation);
  });
});
