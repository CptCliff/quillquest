import { RuleViolation } from './errors';
import { DANGER_RANKS, dangerIndex, type DangerRank } from './ranks';
import type { DiceSource } from './dice';
import { BATTLE_CAP, type Shift } from './shifts';
import { setCard, worstWoundFor, type CardInput, type DangerKind, type SetCard, type WoundLevel } from './card';
import { checkDanger, throwAttempt, type Attempt, type DangerCheck, type PushKind } from './resolve';
import { worseDanger } from './ranks';

export type ContributionType = 'press' | 'open' | 'cover';

export interface Contribution {
  characterId: string;
  type: ContributionType;
  /** Cover: whose Danger drops a rank (the lead or another contributor). */
  target?: string;
  /** The contributor's own Danger: helping in battle is never free. */
  dangerRank: DangerRank;
  dangerText: string;
  dangerKind?: DangerKind;
  declaredMortal?: boolean;
  /** Withdrawn contributors' shift and Danger leave the roll. Concession at Set is the same thing. */
  withdrawn?: boolean;
}

export interface BattleDanger {
  characterId: string;
  rank: DangerRank;
  severity: DangerRank;
  worstWound: WoundLevel | null;
}
export interface SetBattle { lead: SetCard; leadId: string; dangers: BattleDanger[] }

const clamp = (n: number) => Math.min(DANGER_RANKS.length - 1, Math.max(0, n));

/**
 * Applies contributions (Press: lead Skill up; Open: Difficulty down; Cover: a character's Danger down), capped at two
 * per ladder, then closes Set for the lead and every contributor. The edge rule is applied to the lead's own Danger,
 * where it can move the lead's Skill; a Cover on a contributor's Danger already at Minor is simply lost.
 */
export function setBattle(leadId: string, lead: CardInput, contributions: Contribution[]): SetBattle {
  const active = contributions.filter((c) => !c.withdrawn);
  const shifts: Shift[] = [...lead.shifts];
  const coverOn = new Map<string, number>();
  const count = { press: 0, open: 0 };
  for (const c of active) {
    if (c.type === 'press') { count.press++; shifts.push({ ladder: 'skill', delta: 1, source: 'press', reason: `${c.characterId} presses` }); }
    else if (c.type === 'open') { count.open++; shifts.push({ ladder: 'difficulty', delta: -1, source: 'open', reason: `${c.characterId} opens` }); }
    else {
      if (!c.target) throw new RuleViolation('COVER_TARGET', 'A Cover names whose Danger it lowers');
      coverOn.set(c.target, (coverOn.get(c.target) ?? 0) + 1);
    }
  }
  if (count.press > BATTLE_CAP || count.open > BATTLE_CAP || [...coverOn.values()].some((n) => n > BATTLE_CAP))
    throw new RuleViolation('BATTLE_CAP', `Contributions shift any one ladder at most ${BATTLE_CAP} ranks`);
  for (let i = 0; i < (coverOn.get(leadId) ?? 0); i++) shifts.push({ ladder: 'danger', delta: -1, source: 'cover', reason: 'covered' });

  const set = setCard({ ...lead, shifts, battle: true });
  const dangers: BattleDanger[] = [{ characterId: leadId, rank: set.danger, severity: set.severity, worstWound: set.worstWound }];
  for (const c of active) {
    const rank = DANGER_RANKS[clamp(dangerIndex(c.dangerRank) - (coverOn.get(c.characterId) ?? 0))]!;
    dangers.push({ characterId: c.characterId, rank, severity: rank, worstWound: worstWoundFor(rank, c.dangerKind ?? 'wound', c.declaredMortal) });
  }
  return { lead: set, leadId, dangers };
}

export interface BattleDangerResult {
  characterId: string;
  withdrawn: boolean;
  first: DangerCheck;
  recheck?: DangerCheck;
  /** Final: a hit at any point stands. */
  hit: boolean;
  severity: DangerRank;
  worstWound: WoundLevel | null;
}

export interface BattleRoll {
  leadId: string;
  leadInput: CardInput;
  contributions: Contribution[];
  set: SetBattle;
  first: Attempt;
  push: PushKind;
  second?: Attempt;
  goal: boolean;
  dangers: BattleDangerResult[];
}

/** One roll against the Difficulty and each Danger separately. Dice order: Skill, backing, Difficulty, then each Danger (lead first, then contributors in order). */
export function resolveBattle(leadId: string, leadInput: CardInput, contributions: Contribution[], dice: DiceSource): BattleRoll {
  const set = setBattle(leadId, leadInput, contributions);
  const first = throwAttempt(set.lead, dice);
  const dangers: BattleDangerResult[] = set.dangers.map((d) => {
    const first1 = checkDanger(first.kept, d.rank, dice);
    return { characterId: d.characterId, withdrawn: false, first: first1, hit: first1.hit, severity: d.severity, worstWound: d.worstWound };
  });
  return { leadId, leadInput, contributions, set, first, push: 'none', goal: first.goal, dangers };
}

/**
 * Push for the lead. Before a standard push each contributor may withdraw: their shift and Danger leave the roll
 * (a Danger that already hit still stands). A standard push rechecks every remaining avoided Danger one rank worse;
 * a Conviction push rechecks none.
 */
export function pushBattle(roll: BattleRoll, kind: Exclude<PushKind, 'none'>, dice: DiceSource, withdrawals: string[] = []): BattleRoll {
  if (roll.push !== 'none') throw new RuleViolation('ALREADY_PUSHED', 'A roll may be pushed only once');
  if (roll.first.goal) throw new RuleViolation('NOTHING_TO_PUSH', 'Push is only for a failed goal');
  if (withdrawals.includes(roll.leadId)) throw new RuleViolation('LEAD_CANNOT_WITHDRAW', 'The lead cannot withdraw');
  const contributions = roll.contributions.map((c) => (withdrawals.includes(c.characterId) ? { ...c, withdrawn: true } : c));
  const set = setBattle(roll.leadId, roll.leadInput, contributions);
  const second = throwAttempt(set.lead, dice);
  const dangers: BattleDangerResult[] = roll.dangers.map((prev) => {
    const gone = withdrawals.includes(prev.characterId) || prev.withdrawn;
    if (prev.first.hit || gone || kind === 'conviction') return { ...prev, withdrawn: gone };
    const now = set.dangers.find((d) => d.characterId === prev.characterId)!;
    const recheck = checkDanger(second.kept, worseDanger(now.rank), dice);
    return { ...prev, recheck, hit: recheck.hit };
  });
  return { ...roll, contributions, set, push: kind, second, goal: second.goal, dangers };
}

