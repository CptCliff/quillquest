import { RuleViolation } from './errors';
import { BACKING_DIE, dangerDie, difficultyDie, skillDie, worseDanger, type DangerRank } from './ranks';
import type { DiceSource } from './dice';
import type { SetCard, WoundLevel } from './card';

export type PushKind = 'none' | 'standard' | 'conviction';
export type OutcomeKind = 'cleanSuccess' | 'successWithCost' | 'failureNoCost' | 'failureWithCost';

/** One throw of the Skill (and backing) against a Difficulty die. */
export interface Attempt {
  skillDie: number;
  backingDie: number | null;
  difficultyDie: number;
  /** The better of the Skill and backing dice. */
  kept: number;
  goal: boolean;
  /** The kept die shows the highest face its die has. */
  flourish: boolean;
  /** The kept die beats the Difficulty die by 4 or more (goal succeeded). */
  roomToSpare: boolean;
}

export interface DangerCheck {
  rank: DangerRank;
  die: number;
  hit: boolean;
}

export interface Roll {
  card: SetCard;
  first: Attempt;
  firstDanger: DangerCheck;
  push: PushKind;
  second?: Attempt;
  /** Set only by a standard push after an avoided Danger. */
  recheck?: DangerCheck;
  // Final state (after any push):
  goal: boolean;
  dangerHit: boolean;
  severity: DangerRank;
  worstWound: WoundLevel | null;
  flourish: boolean;
  roomToSpare: boolean;
  beliefSuccess: boolean;
  outcome: OutcomeKind;
}

/** Dice are drawn in a fixed order: Skill, backing (if any), Difficulty. Danger dice follow where a check needs one. */
export function throwAttempt(card: SetCard, dice: DiceSource): Attempt {
  const sSides = skillDie(card.skill);
  const bSides = BACKING_DIE[card.backing];
  const s = dice.d(sSides);
  const b = bSides ? dice.d(bSides) : null;
  const diff = dice.d(difficultyDie(card.difficulty));
  const kept = Math.max(s, b ?? 0);
  const goal = kept > diff;
  // A flourish needs the kept value to be a top face on the die that produced it (either die, if they tie).
  const flourish = goal && (s === kept && s === sSides || (b !== null && b === kept && b === bSides));
  return { skillDie: s, backingDie: b, difficultyDie: diff, kept, goal, flourish, roomToSpare: goal && kept - diff >= 4 };
}

export function checkDanger(kept: number, rank: DangerRank, dice: DiceSource): DangerCheck {
  const die = dice.d(dangerDie(rank));
  return { rank, die, hit: kept < die }; // a tie avoids
}

function finish(base: Omit<Roll, 'goal' | 'dangerHit' | 'flourish' | 'roomToSpare' | 'beliefSuccess' | 'outcome' | 'severity' | 'worstWound'>): Roll {
  const last = base.second ?? base.first;
  const goal = last.goal;
  const dangerHit = base.firstDanger.hit || (base.recheck?.hit ?? false);
  const outcome: OutcomeKind = goal ? (dangerHit ? 'successWithCost' : 'cleanSuccess') : dangerHit ? 'failureWithCost' : 'failureNoCost';
  return {
    ...base,
    goal,
    dangerHit,
    severity: base.card.severity,
    worstWound: base.card.worstWound,
    flourish: last.flourish,
    roomToSpare: last.roomToSpare,
    beliefSuccess: goal && base.card.backing !== 'none',
    outcome,
  };
}

/** Rolls Skill (backing keeps the better) against the Difficulty and the Danger. Ties: opposition wins the goal, player wins the Danger. */
export function resolve(card: SetCard, dice: DiceSource): Roll {
  const first = throwAttempt(card, dice);
  const firstDanger = checkDanger(first.kept, card.danger, dice);
  return finish({ card, first, firstDanger, push: 'none' });
}

/**
 * One retry after a failed goal, against the same Difficulty. A Danger that hit stands.
 * Standard: an avoided Danger is rechecked one rank worse (never past Grave); the worst cost stays as set.
 * Conviction: no recheck. (Spending the token is spendConviction's job; see convictionPush.)
 */
export function push(roll: Roll, kind: Exclude<PushKind, 'none'>, dice: DiceSource): Roll {
  if (roll.push !== 'none') throw new RuleViolation('ALREADY_PUSHED', 'A roll may be pushed only once');
  if (roll.first.goal) throw new RuleViolation('NOTHING_TO_PUSH', 'Push is only for a failed goal');
  const second = throwAttempt(roll.card, dice);
  let recheck: DangerCheck | undefined;
  if (kind === 'standard' && !roll.firstDanger.hit) recheck = checkDanger(second.kept, worseDanger(roll.card.danger), dice);
  return finish({ card: roll.card, first: roll.first, firstDanger: roll.firstDanger, push: kind, second, recheck });
}
