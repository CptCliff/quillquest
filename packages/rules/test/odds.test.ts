import { describe, expect, it } from 'vitest';
import { chanceToAvoid, chanceToBeat, difficultyDie, dangerDie, skillDie } from '../src';

const pct = (x: number) => Math.round(x * 100);

describe('ranks to dice', () => {
  it('maps each ladder row to its die', () => {
    expect(skillDie('Capable')).toBe(8);
    expect(difficultyDie('Demanding')).toBe(8);
    expect(dangerDie('Serious')).toBe(8);
    expect(dangerDie('Minor')).toBe(4);
    expect(dangerDie('Grave')).toBe(12);
  });
});

describe('odds (Rules v4 Appendix A)', () => {
  it('Capable vs Demanding = 44% goal', () => {
    expect(pct(chanceToBeat(skillDie('Capable'), difficultyDie('Demanding')))).toBe(44);
  });
  it('Capable vs Serious = 56% avoid', () => {
    expect(pct(chanceToAvoid(skillDie('Capable'), dangerDie('Serious')))).toBe(56);
  });
  it('a tie fails the goal but avoids the Danger', () => {
    expect(chanceToBeat(1, 1)).toBe(0);
    expect(chanceToAvoid(1, 1)).toBe(1);
  });
});
