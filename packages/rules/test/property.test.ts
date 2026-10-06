import { describe, expect, it } from 'vitest';
import { odds, percent, resolve, seededDice, setCard, push } from '../src';
import { card } from './helpers';

const N = 100_000;

/** Across 100,000 seeded rolls, measured results land within 1 point of the computed odds (plan 4.4). */
describe('property: measured rates match computed odds', () => {
  const cases = [
    { name: 'Capable vs Demanding, Serious', input: card({ dangerKind: 'other' }) },
    { name: 'Untrained vs Hard, Real, belief backing', input: card({ skill: 'Untrained', difficulty: 'Hard', danger: 'Real', backing: 'belief', dangerKind: 'wound' }) },
    { name: 'Master vs Extraordinary, Grave, core backing', input: card({ skill: 'Master', difficulty: 'Extraordinary', danger: 'Grave', backing: 'core', dangerKind: 'burden', onTheLine: 'b3' }) },
  ];
  for (const { name, input } of cases) {
    it(name, () => {
      const set = setCard(input);
      const dice = seededDice(20261006);
      let goals = 0, hits = 0;
      for (let i = 0; i < N; i++) {
        const r = resolve(set, dice);
        if (r.goal) goals++;
        if (r.dangerHit) hits++;
      }
      const o = odds(set);
      expect(Math.abs((goals / N) * 100 - percent(o.goal))).toBeLessThan(1);
      expect(Math.abs((hits / N) * 100 - percent(o.danger))).toBeLessThan(1);
    });
  }

  it('a standard push raises the chance an avoided Danger lands to the recheck odds', () => {
    const set = setCard(card({ dangerKind: 'other' })); // Serious
    const dice = seededDice(7);
    let tried = 0, landed = 0;
    for (let i = 0; i < N * 2; i++) {
      const r = resolve(set, dice);
      if (r.goal || r.dangerHit) continue; // push only after a failed goal with the Danger avoided
      tried++;
      if (push(r, 'standard', dice).recheck?.hit) landed++;
    }
    const expected = 100 - percent(odds({ ...set, danger: 'Severe' }).avoid);
    expect(Math.abs((landed / tried) * 100 - expected)).toBeLessThan(1);
  });
});
