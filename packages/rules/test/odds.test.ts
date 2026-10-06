import { describe, expect, it } from 'vitest';
import {
  DANGER_RANKS, DIFFICULTY_RANKS, RATED_SKILL_RANKS, SKILL_RANKS, avoidChance, chanceToAvoid, chanceToBeat, dangerDie, dangerWord,
  difficultyDie, goalChance, goalWord, odds, percent, setCard, skillDie, type Backing,
} from '../src';
import { card } from './helpers';

// Rules v4 Appendix A, copied verbatim. Rows: Skill Hampered..Peerless.
const GOAL: Record<string, number[]> = {
  Hampered: [12, 8, 6, 5, 4, 3, 2], Untrained: [38, 25, 19, 15, 12, 9, 8], Trained: [58, 42, 31, 25, 21, 16, 12],
  Capable: [69, 56, 44, 35, 29, 22, 18], Expert: [75, 65, 55, 45, 38, 28, 22], Master: [79, 71, 62, 54, 46, 34, 28],
  Heroic: [84, 78, 72, 66, 59, 47, 38], Peerless: [88, 82, 78, 72, 68, 58, 48],
};
const AVOID: Record<string, number[]> = {
  Hampered: [38, 25, 19, 15, 12], Untrained: [62, 42, 31, 25, 21], Trained: [75, 58, 44, 35, 29], Capable: [81, 69, 56, 45, 38],
  Expert: [85, 75, 65, 55, 46], Master: [88, 79, 71, 62, 54], Heroic: [91, 84, 78, 72, 66], Peerless: [92, 88, 82, 78, 72],
};

describe('odds tables match Rules v4 Appendix A', () => {
  // The appendix rounds half-to-even (12.5 -> 12, 37.5 -> 38), so exact values sit within half a point of it.
  for (const skill of SKILL_RANKS) {
    it(`goal chances for ${skill}`, () => {
      DIFFICULTY_RANKS.slice(1).forEach((diff, i) => {
        const p = percent(goalChance(skillDie(skill), null, difficultyDie(diff)));
        expect(Math.abs(p - GOAL[skill]![i]!), `${skill} vs ${diff}: ${p}`).toBeLessThanOrEqual(0.5);
      });
    });
    it(`avoid chances for ${skill}`, () => {
      DANGER_RANKS.forEach((danger, i) => {
        const p = percent(avoidChance(skillDie(skill), null, dangerDie(danger)));
        expect(Math.abs(p - AVOID[skill]![i]!), `${skill} vs ${danger}: ${p}`).toBeLessThanOrEqual(0.5);
      });
    });
  }
});

describe('odds(card)', () => {
  it('Capable vs Demanding = 44% goal; vs Serious = 56% avoid', () => {
    const o = odds(setCard(card({ dangerKind: 'other' })));
    expect(Math.round(percent(o.goal))).toBe(44);
    expect(Math.round(percent(o.avoid))).toBe(56);
  });
  it('shows words for goal and Danger', () => {
    const o = odds(setCard(card({ dangerKind: 'other' })));
    expect(o.goal.word).toBe('Even'); // 43.75%
    expect(o.danger.word).toBe('Even'); // lands 43.75%
  });
  it('simple helpers agree with the exact counts', () => {
    expect(Math.round(chanceToBeat(8, 8) * 100)).toBe(44);
    expect(Math.round(chanceToAvoid(8, 8) * 100)).toBe(56);
  });
  it('a tie fails the goal but avoids the Danger', () => {
    expect(chanceToBeat(1, 1)).toBe(0);
    expect(chanceToAvoid(1, 1)).toBe(1);
  });
});

describe('odds words', () => {
  const c = (hits: number) => ({ hits, total: 100 });
  it('goal bands: under 20 Desperate, 20-40 Long shot, 40-60 Even, 60-80 Favored, over 80 Sure bet', () => {
    expect([19, 20, 39, 40, 59, 60, 80, 81].map((h) => goalWord(c(h)))).toEqual(
      ['Desperate', 'Long shot', 'Long shot', 'Even', 'Even', 'Favored', 'Favored', 'Sure bet']);
  });
  it('Danger bands run the same way on the chance it lands', () => {
    expect([19, 20, 40, 60, 80, 81].map((h) => dangerWord(c(h)))).toEqual(['Remote', 'Unlikely', 'Even', 'Likely', 'Likely', 'Near certain']);
  });
});

describe('backing', () => {
  it('Trained backing on a Capable Skill adds about 10-15 points against Simple..Demanding, then tapers', () => {
    // Plan 4.4 says "roughly 10-15 points across the table". The exact figures: 15.6, 12.2, 9.1 for Simple..Demanding,
    // then 7.3, 6.1, 4.6, 3.6 up to Mythic. The claim only holds near the Skill's own row; see the M1 notes.
    const gain = (diff: (typeof DIFFICULTY_RANKS)[number]) =>
      percent(goalChance(skillDie('Capable'), 6, difficultyDie(diff))) - percent(goalChance(skillDie('Capable'), null, difficultyDie(diff)));
    for (const diff of DIFFICULTY_RANKS.slice(1, 4)) {
      expect(gain(diff), diff).toBeGreaterThanOrEqual(9);
      expect(gain(diff), diff).toBeLessThanOrEqual(16);
    }
    expect(gain('Mythic')).toBeLessThan(5);
  });
  it('backing helps against Danger too, and never changes ranks', () => {
    const b: Backing[] = ['none', 'belief', 'core'];
    const avoid = b.map((x) => percent(odds({ skill: 'Capable', difficulty: 'Demanding', danger: 'Serious', backing: x }).avoid));
    expect(avoid[1]!).toBeGreaterThan(avoid[0]!);
    expect(avoid[2]!).toBeGreaterThan(avoid[1]!);
  });
  it('rated ranks list has no shifted-only rows', () => {
    expect(RATED_SKILL_RANKS).toEqual(['Untrained', 'Trained', 'Capable', 'Expert', 'Master']);
  });
});
