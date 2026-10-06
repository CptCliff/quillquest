import { RuleViolation } from './errors';
import {
  BACKING_DIE,
  DANGER_RANKS,
  dangerDie,
  difficultyDie,
  skillDie,
  worseDanger,
  type Backing,
  type DangerRank,
  type DifficultyRank,
  type RatedSkillRank,
  type SkillRank,
} from './ranks';
import { avoidChance, dangerWord, goalChance, goalWord, type Chance, type DangerWord, type GoalWord } from './odds';
import { applyShifts, type Shift, type ShiftedRanks } from './shifts';

export type WoundLevel = 'Hurt' | 'Wounded' | 'Critical' | 'Mortal';
/** wound: costs a wound on the ladder; burden: a lasting change (Belief on the line); other: social, material, time. */
export type DangerKind = 'wound' | 'burden' | 'other';

/** What the table has agreed before Set closes. */
export interface CardInput {
  skill: RatedSkillRank;
  difficulty: DifficultyRank;
  danger: DangerRank;
  shifts: Shift[];
  backing: Backing;
  /** Id of the Belief on the line, or null. If set, the Danger is a Burden. */
  onTheLine?: string | null;
  dangerKind: DangerKind;
  /** A Grave wound is only Mortal when declared at Set. */
  declaredMortal?: boolean;
  battle?: boolean;
}

/** A card after Set closes: final ranks, and the worst cost fixed for good. */
export interface SetCard {
  skill: SkillRank;
  difficulty: DifficultyRank;
  danger: DangerRank;
  backing: Backing;
  onTheLine: string | null;
  dangerKind: DangerKind;
  /** Severity: the Danger rank at the end of Set. Pushes change odds, never this. */
  severity: DangerRank;
  /** The worst wound that can land (wound Dangers only). */
  worstWound: WoundLevel | null;
  adjustments: ShiftedRanks;
}

const WORST_WOUND: Record<DangerRank, WoundLevel | null> = {
  Minor: null,
  Real: 'Hurt',
  Serious: 'Wounded',
  Severe: 'Critical',
  Grave: 'Mortal',
};

/** Worst wound for a final Danger rank. Grave means Mortal, which must be declared at Set. */
export function worstWoundFor(rank: DangerRank, kind: DangerKind, declaredMortal = false): WoundLevel | null {
  if (kind !== 'wound') return null;
  const worst = WORST_WOUND[rank];
  if (worst === 'Mortal' && !declaredMortal)
    throw new RuleViolation('MORTAL_NOT_DECLARED', 'A Grave wound Danger is Mortal and must be declared Mortal at Set; death is always telegraphed');
  return worst;
}

/** Closes Set: applies shifts, checks the card, fixes severity. */
export function setCard(input: CardInput): SetCard {
  const onTheLine = input.onTheLine ?? null;
  if (input.backing === 'core' && !onTheLine)
    throw new RuleViolation('CORE_NOT_ON_LINE', 'The Core Belief backs a roll only when it is on the line');
  if (onTheLine && input.dangerKind !== 'burden')
    throw new RuleViolation('BELIEF_DANGER_IS_BURDEN', 'When a Belief is on the line, the Danger is a Burden');
  if (input.backing === 'core' && input.dangerKind !== 'burden')
    throw new RuleViolation('BELIEF_DANGER_IS_BURDEN', 'When the Core Belief backs a roll, the Danger is a Burden');

  const adj = applyShifts(input);
  return {
    skill: adj.skill,
    difficulty: adj.difficulty,
    danger: adj.danger,
    backing: input.backing,
    onTheLine,
    dangerKind: input.dangerKind,
    severity: adj.danger,
    worstWound: worstWoundFor(adj.danger, input.dangerKind, input.declaredMortal),
    adjustments: adj,
  };
}

export interface CardOdds {
  goal: Chance & { word: GoalWord };
  /** Chance the Danger avoids (player escapes). */
  avoid: Chance;
  /** Chance the Danger lands, with its word. */
  danger: Chance & { word: DangerWord };
}

/** Exact odds for a Set card, counting backing and every shift. */
export function odds(card: Pick<SetCard, 'skill' | 'difficulty' | 'danger' | 'backing'>): CardOdds {
  const b = BACKING_DIE[card.backing];
  const goal = goalChance(skillDie(card.skill), b, difficultyDie(card.difficulty));
  const avoid = avoidChance(skillDie(card.skill), b, dangerDie(card.danger));
  const lands: Chance = { hits: avoid.total - avoid.hits, total: avoid.total };
  return { goal: { ...goal, word: goalWord(goal) }, avoid, danger: { ...lands, word: dangerWord(lands) } };
}

/** Odds of a standard push's recheck: the Danger one rank worse (never past Grave). */
export function recheckOdds(card: Pick<SetCard, 'skill' | 'difficulty' | 'danger' | 'backing'>): CardOdds {
  return odds({ ...card, danger: worseDanger(card.danger) });
}

export { DANGER_RANKS };
