import { describe, expect, it } from 'vitest';
import { RuleViolation, convictionPush, newCharacter, push, resolve, scriptedDice, setCard } from '../src';
import { card } from './helpers';

// Capable (d8) vs Demanding (d8) vs Serious (d8): dice order is Skill, Difficulty, Danger.
const set = (over = {}) => setCard(card({ dangerKind: 'other', ...over }));

describe('resolve: ties and outcomes', () => {
  it('a tie against Difficulty fails; a tie against Danger avoids', () => {
    const r = resolve(set(), scriptedDice([5, 5, 5]));
    expect(r.goal).toBe(false);
    expect(r.dangerHit).toBe(false);
    expect(r.outcome).toBe('failureNoCost');
  });
  it('the Danger lands only when the opposition beats the kept die', () => {
    expect(resolve(set(), scriptedDice([5, 3, 6])).outcome).toBe('successWithCost');
    expect(resolve(set(), scriptedDice([2, 6, 2])).outcome).toBe('failureNoCost');
    expect(resolve(set(), scriptedDice([2, 6, 2])).dangerHit).toBe(false);
    expect(resolve(set(), scriptedDice([2, 6, 8])).outcome).toBe('failureWithCost');
    expect(resolve(set(), scriptedDice([8, 1, 1])).outcome).toBe('cleanSuccess');
  });
  it('backing rolls a second die and keeps the better one', () => {
    // Skill d8 = 2, backing d6 = 6, Difficulty d8 = 4, Danger d8 = 6: kept 6 beats 4 and ties 6.
    const r = resolve(set({ backing: 'belief' }), scriptedDice([2, 6, 4, 6]));
    expect(r.first.kept).toBe(6);
    expect(r.goal).toBe(true);
    expect(r.dangerHit).toBe(false);
    expect(r.beliefSuccess).toBe(true);
  });
  it('Flourish: the kept die shows its top face', () => {
    expect(resolve(set(), scriptedDice([8, 1, 1])).flourish).toBe(true);
    expect(resolve(set(), scriptedDice([7, 1, 1])).flourish).toBe(false);
    // A d6 backing die can carry the flourish when it is the kept die.
    expect(resolve(set({ backing: 'belief' }), scriptedDice([3, 6, 1, 1])).flourish).toBe(true);
    // No flourish on a failed goal.
    expect(resolve(set(), scriptedDice([8, 8, 1])).flourish).toBe(false);
  });
  it('Room to spare: the kept die beats the Difficulty die by 4 or more', () => {
    expect(resolve(set(), scriptedDice([6, 2, 1])).roomToSpare).toBe(true);
    expect(resolve(set(), scriptedDice([5, 2, 1])).roomToSpare).toBe(false);
  });
});

describe('push', () => {
  const failedClean = () => resolve(set({ danger: 'Severe' }), scriptedDice([2, 6, 8])); // fails goal; d10 Danger die 8 > 2: hit
  const failedAvoided = () => resolve(set({ danger: 'Severe' }), scriptedDice([4, 6, 3])); // fails goal, Danger avoided

  it('a hit Danger survives a push, even if the retry succeeds', () => {
    const p = push(failedClean(), 'standard', scriptedDice([8, 1]));
    expect(p.goal).toBe(true);
    expect(p.dangerHit).toBe(true);
    expect(p.recheck).toBeUndefined();
    expect(p.outcome).toBe('successWithCost');
  });
  it('a standard push rechecks an avoided Danger one rank worse and the worst cost stays as set', () => {
    const first = resolve(setCard(card({ danger: 'Severe' })), scriptedDice([4, 6, 3]));
    expect(first.dangerHit).toBe(false);
    // Retry: Skill 8, Difficulty 1, then the Grave d12 recheck lands (12 > 8).
    const p = push(first, 'standard', scriptedDice([8, 1, 12]));
    expect(p.recheck?.rank).toBe('Grave');
    expect(p.dangerHit).toBe(true);
    expect(p.severity).toBe('Severe');
    expect(p.worstWound).toBe('Critical');
  });
  it('a standard push at Grave rechecks at Grave', () => {
    const first = resolve(setCard(card({ danger: 'Grave', declaredMortal: true })), scriptedDice([4, 6, 3]));
    expect(push(first, 'standard', scriptedDice([8, 1, 5])).recheck?.rank).toBe('Grave');
  });
  it('a Conviction push never rechecks', () => {
    const p = push(failedAvoided(), 'conviction', scriptedDice([8, 1]));
    expect(p.recheck).toBeUndefined();
    expect(p.dangerHit).toBe(false);
    expect(p.outcome).toBe('cleanSuccess');
  });
  it('a second push is rejected, and so is pushing a success', () => {
    const p = push(failedAvoided(), 'conviction', scriptedDice([2, 6]));
    expect(() => push(p, 'standard', scriptedDice([8, 1, 1]))).toThrow(/only once/);
    expect(() => push(resolve(set(), scriptedDice([8, 1, 1])), 'standard', scriptedDice([1, 1, 1]))).toThrow(RuleViolation);
  });
  it('convictionPush spends a token, and fails before throwing any die when there is none', () => {
    const c = { ...newCharacter('a', 'A'), conviction: 1 };
    const r = convictionPush(c, failedAvoided(), scriptedDice([8, 1]));
    expect(r.character.conviction).toBe(0);
    const dice = scriptedDice([8, 1]);
    expect(() => convictionPush(r.character, failedAvoided(), dice)).toThrow(/token/);
    expect(dice.remaining()).toBe(2);
  });
});
