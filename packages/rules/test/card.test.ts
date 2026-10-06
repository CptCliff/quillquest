import { describe, expect, it } from 'vitest';
import { RuleViolation, odds, percent, recheckOdds, setCard } from '../src';
import { card, shift } from './helpers';

describe('setCard', () => {
  it('fixes severity from the final Danger rank, after armor and shifts', () => {
    const s = setCard(card({ danger: 'Severe', shifts: [shift('danger', -1, 'armor')] }));
    expect(s.severity).toBe('Serious');
    expect(s.worstWound).toBe('Wounded');
  });
  it('maps each Danger rank to its worst wound', () => {
    const w = (danger: never) => setCard(card({ danger, declaredMortal: true })).worstWound;
    expect(['Minor', 'Real', 'Serious', 'Severe', 'Grave'].map((d) => w(d as never))).toEqual([null, 'Hurt', 'Wounded', 'Critical', 'Mortal']);
  });
  it('rejects a Grave wound Danger unless declared Mortal', () => {
    expect(() => setCard(card({ danger: 'Grave' }))).toThrow(RuleViolation);
    expect(setCard(card({ danger: 'Grave', declaredMortal: true })).worstWound).toBe('Mortal');
  });
  it('a Grave Burden or social Danger needs no Mortal declaration', () => {
    expect(setCard(card({ danger: 'Grave', dangerKind: 'other' })).worstWound).toBeNull();
    expect(setCard(card({ danger: 'Grave', dangerKind: 'burden', onTheLine: 'b3', backing: 'core' })).worstWound).toBeNull();
  });
  it('a Belief on the line makes the Danger a Burden', () => {
    expect(() => setCard(card({ onTheLine: 'b1', backing: 'belief' }))).toThrow(/Burden/);
  });
  it('the Core Belief backs only when on the line', () => {
    expect(() => setCard(card({ backing: 'core', dangerKind: 'burden' }))).toThrow(/on the line/);
  });
  it('a hit past Grave stays Grave when a wound strain pushes it over', () => {
    const s = setCard(card({ danger: 'Grave', declaredMortal: true, shifts: [shift('danger', 1, 'wound')] }));
    expect(s.danger).toBe('Grave');
    expect(s.skill).toBe('Trained');
  });
});

describe('recheckOdds', () => {
  it('a standard push from Severe rechecks at Grave odds', () => {
    const s = setCard(card({ danger: 'Severe' }));
    expect(percent(recheckOdds(s).avoid)).toBeLessThan(percent(odds(s).avoid));
    expect(recheckOdds(s).avoid).toEqual(odds({ ...s, danger: 'Grave' }).avoid);
  });
  it('a push at Grave checks again at Grave', () => {
    const s = setCard(card({ danger: 'Grave', declaredMortal: true }));
    expect(recheckOdds(s).avoid).toEqual(odds(s).avoid);
  });
});
