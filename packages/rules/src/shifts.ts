import { RuleViolation } from './errors';
import {
  DANGER_RANKS,
  DIFFICULTY_RANKS,
  SKILL_RANKS,
  dangerIndex,
  difficultyIndex,
  skillIndex,
  type DangerRank,
  type DifficultyRank,
  type SkillRank,
} from './ranks';

export type Ladder = 'skill' | 'difficulty' | 'danger';
export type ShiftSource =
  | 'trait' | 'wound' | 'helping' | 'preparation' | 'gear' | 'possession' | 'armor' | 'standing' | 'magic'
  | 'press' | 'open' | 'cover' | 'other';

/** One rank of movement. delta +1 moves the rank UP its ladder, -1 DOWN: "Skill up" is {skill, +1}; "Danger down" is {danger, -1}. */
export interface Shift {
  ladder: Ladder;
  delta: 1 | -1;
  source: ShiftSource;
  reason: string;
}

export const BATTLE_SOURCES: readonly ShiftSource[] = ['press', 'open', 'cover'];
export const BATTLE_CAP = 2;

export interface ShiftInput {
  skill: SkillRank;
  difficulty: DifficultyRank;
  danger: DangerRank;
  shifts: Shift[];
  /** Battle rolls lift the one-helper limit and cap contribution shifts at two per ladder. */
  battle?: boolean;
}

export interface ShiftedRanks {
  skill: SkillRank;
  difficulty: DifficultyRank;
  danger: DangerRank;
  /** Ranks lost off the ends of the Skill and Difficulty ladders (past Hampered/Peerless, Trivial/Mythic). */
  lost: { skill: number; difficulty: number };
  /** Danger shifts that could not move Danger past Minor or Grave and moved the Skill the other way instead. */
  edgeConverted: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Turns rated ranks plus shifts into the final ladder positions (Rules v4 3.9).
 * Shifts stack. The edge rule is applied to the NET Danger movement, so order never matters:
 * armor (-1) and a strained wound (+1) on a Minor Danger cancel instead of leaking a Skill shift.
 */
export function applyShifts(input: ShiftInput): ShiftedRanks {
  const { shifts, battle = false } = input;
  const s0 = skillIndex(input.skill);
  const d0 = difficultyIndex(input.difficulty);
  if (s0 < 1 || s0 > 5) throw new RuleViolation('BASE_SKILL', `A rated Skill runs Untrained to Master, not ${input.skill}`);
  if (d0 < 1) throw new RuleViolation('BASE_DIFFICULTY', 'A Difficulty is named Simple to Mythic; Trivial is reached only by shifts');

  const ladders: Ladder[] = ['skill', 'difficulty', 'danger'];
  for (const ladder of ladders) {
    const on = shifts.filter((x) => x.ladder === ladder);
    if (on.filter((x) => x.source === 'preparation').length > 1)
      throw new RuleViolation('PREPARATION_LIMIT', `One preparation shift per ladder (${ladder})`);
    const contributed = on.filter((x) => BATTLE_SOURCES.includes(x.source)).length;
    if (battle && contributed > BATTLE_CAP) throw new RuleViolation('BATTLE_CAP', `At most ${BATTLE_CAP} contribution shifts on the ${ladder} ladder`);
  }
  if (!battle && shifts.filter((x) => x.source === 'helping').length > 1)
    throw new RuleViolation('HELPER_LIMIT', 'One helper per roll, except in a battle roll');

  const net = (ladder: Ladder) => shifts.filter((x) => x.ladder === ladder).reduce((n, x) => n + x.delta, 0);
  let skillDelta = net('skill');
  const dangerTarget = dangerIndex(input.danger) + net('danger');
  let edgeConverted = 0;
  let dangerIdx = dangerTarget;
  if (dangerTarget < 0) {
    skillDelta += -dangerTarget; // armor against a Minor threat shifts the Skill up
    edgeConverted = -dangerTarget;
    dangerIdx = 0;
  } else if (dangerTarget > DANGER_RANKS.length - 1) {
    const over = dangerTarget - (DANGER_RANKS.length - 1);
    skillDelta -= over; // a strained wound against a Grave Danger shifts the Skill down
    edgeConverted = over;
    dangerIdx = DANGER_RANKS.length - 1;
  }

  const sTarget = s0 + skillDelta;
  const dTarget = d0 + net('difficulty');
  const sIdx = clamp(sTarget, 0, SKILL_RANKS.length - 1);
  const diffIdx = clamp(dTarget, 0, DIFFICULTY_RANKS.length - 1);
  return {
    skill: SKILL_RANKS[sIdx]!,
    difficulty: DIFFICULTY_RANKS[diffIdx]!,
    danger: DANGER_RANKS[dangerIdx]!,
    lost: { skill: Math.abs(sTarget - sIdx), difficulty: Math.abs(dTarget - diffIdx) },
    edgeConverted,
  };
}
