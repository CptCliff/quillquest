import { BACKING_DIE, type Backing } from './ranks';

/** An exact chance as a count of equally likely dice outcomes. */
export interface Chance {
  hits: number;
  total: number;
}
export const percent = (c: Chance): number => (c.hits * 100) / c.total;

function count(skillSides: number, backingSides: number | null, oppSides: number, win: (kept: number, opp: number) => boolean): Chance {
  let hits = 0;
  let total = 0;
  for (let s = 1; s <= skillSides; s++) {
    for (let b = backingSides ? 1 : 0; b <= (backingSides ?? 0); b++) {
      for (let o = 1; o <= oppSides; o++) {
        total++;
        if (win(Math.max(s, b), o)) hits++;
      }
    }
  }
  return { hits, total };
}

/** Goal: the kept die must strictly beat the Difficulty die. A tie goes to the opposition. */
export const goalChance = (skillSides: number, backingSides: number | null, difficultySides: number): Chance =>
  count(skillSides, backingSides, difficultySides, (k, o) => k > o);

/** Danger: a tie goes to the player, so the kept die avoids by matching or beating the Danger die. */
export const avoidChance = (skillSides: number, backingSides: number | null, dangerSides: number): Chance =>
  count(skillSides, backingSides, dangerSides, (k, o) => k >= o);

export const backingSides = (b: Backing): number | null => BACKING_DIE[b];

// Kept for the simple no-backing case.
export const chanceToBeat = (skillSides: number, difficultySides: number): number => percent(goalChance(skillSides, null, difficultySides)) / 100;
export const chanceToAvoid = (skillSides: number, dangerSides: number): number => percent(avoidChance(skillSides, null, dangerSides)) / 100;

export const GOAL_WORDS = ['Desperate', 'Long shot', 'Even', 'Favored', 'Sure bet'] as const;
export const DANGER_WORDS = ['Remote', 'Unlikely', 'Even', 'Likely', 'Near certain'] as const;
export type GoalWord = (typeof GOAL_WORDS)[number];
export type DangerWord = (typeof DANGER_WORDS)[number];

/**
 * Five 20-point bands, integer-exact (no float edge cases): under 20, 20-40, 40-60, 60-80, over 80.
 * A boundary value belongs to the band above it, except 80%, which is still the 60-80 band.
 */
function band(c: Chance): 0 | 1 | 2 | 3 | 4 {
  const h = c.hits * 5;
  if (h < c.total) return 0;
  if (h < 2 * c.total) return 1;
  if (h < 3 * c.total) return 2;
  if (h <= 4 * c.total) return 3;
  return 4;
}
export const goalWord = (c: Chance): GoalWord => GOAL_WORDS[band(c)]!;
/** Takes the chance the Danger LANDS. */
export const dangerWord = (c: Chance): DangerWord => DANGER_WORDS[band(c)]!;
