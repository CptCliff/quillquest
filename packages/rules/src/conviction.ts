import { push, type Roll } from './resolve';
import type { DiceSource } from './dice';
import { RuleViolation } from './errors';
import type { Burden, Character, Trait } from './character';

export const CONVICTION_CAP = 3;
export const BURDEN_LIMIT = 2;

export type ConvictionReason =
  | { kind: 'belief'; beliefId: string; note: string }
  | { kind: 'instinct' | 'trait' | 'other'; note: string };

export interface ConvictionEvent {
  characterId: string;
  beliefId: string | null;
  kind: ConvictionReason['kind'] | 'burdenLaidDown';
  note: string;
  delta: number;
}

/** Adds a token. Cap 3; one per Belief per session. (Laying down a Burden uses layDownBurden, which skips the per-Belief limit.) */
export function awardConviction(c: Character, reason: ConvictionReason): { character: Character; event: ConvictionEvent } {
  if (c.conviction >= CONVICTION_CAP) throw new RuleViolation('CONVICTION_CAP', `A character holds at most ${CONVICTION_CAP} Conviction`);
  let beliefs = c.beliefs;
  let beliefId: string | null = null;
  if (reason.kind === 'belief') {
    const b = c.beliefs.find((x) => x.id === reason.beliefId);
    if (!b) throw new RuleViolation('NO_SUCH_BELIEF', `No Belief ${reason.beliefId}`);
    if (b.convictionEarnedThisSession) throw new RuleViolation('BELIEF_ALREADY_EARNED', 'One Conviction per Belief per session');
    beliefs = c.beliefs.map((x) => (x.id === b.id ? { ...x, convictionEarnedThisSession: true } : x));
    beliefId = b.id;
  }
  return {
    character: { ...c, conviction: c.conviction + 1, beliefs },
    event: { characterId: c.id, beliefId, kind: reason.kind, note: reason.note, delta: 1 },
  };
}

export type ConvictionUse = 'push' | 'takeDanger';
export function spendConviction(c: Character, _use: ConvictionUse): Character {
  if (c.conviction < 1) throw new RuleViolation('NO_CONVICTION', 'Spending Conviction needs a token');
  return { ...c, conviction: c.conviction - 1 };
}

/** New session: Beliefs may earn Conviction again. */
export const startSession = (c: Character): Character => ({ ...c, beliefs: c.beliefs.map((b) => ({ ...b, convictionEarnedThisSession: false })) });

export interface BurdenInput { id: string; name: string; about: string }
export function addBurden(c: Character, beliefId: string, input: BurdenInput): Character {
  if (!c.beliefs.some((b) => b.id === beliefId)) throw new RuleViolation('NO_SUCH_BELIEF', `No Belief ${beliefId}`);
  if (c.burdens.filter((b) => b.status === 'active').length >= BURDEN_LIMIT)
    throw new RuleViolation('BURDEN_LIMIT', 'A third Burden forces the player to lay one down or rewrite the related Belief first');
  const burden: Burden = { id: input.id, beliefId, name: input.name, about: input.about, status: 'active' };
  return { ...c, burdens: [...c.burdens, burden] };
}

export type BurdenOutcome = { kind: 'trait'; traitId: string; text: string } | { kind: 'beliefRewrite'; text: string };

/**
 * A Burden tested at real cost is laid down. It always earns Conviction, past the one-per-Belief limit
 * (the cap of 3 still applies: at the cap the token is simply not gained). It leaves a Trait or a rewritten Belief.
 */
export function layDownBurden(c: Character, burdenId: string, outcome: BurdenOutcome): { character: Character; event: ConvictionEvent } {
  const burden = c.burdens.find((b) => b.id === burdenId);
  if (!burden || burden.status !== 'active') throw new RuleViolation('NO_ACTIVE_BURDEN', `No active Burden ${burdenId}`);
  let traits = c.traits;
  let beliefs = c.beliefs;
  if (outcome.kind === 'trait') {
    const trait: Trait = { id: outcome.traitId, text: outcome.text, harmful: false, source: { type: 'burden' } };
    traits = [...c.traits, trait];
  } else {
    beliefs = c.beliefs.map((b) => (b.id === burden.beliefId ? { ...b, text: outcome.text } : b));
  }
  const gained = c.conviction < CONVICTION_CAP ? 1 : 0;
  return {
    character: {
      ...c, traits, beliefs, conviction: c.conviction + gained,
      burdens: c.burdens.map((b) => (b.id === burdenId ? { ...b, status: 'laidDown', outcome: outcome.kind } : b)),
    },
    event: { characterId: c.id, beliefId: burden.beliefId, kind: 'burdenLaidDown', note: burden.name, delta: gained },
  };
}

/** A Conviction push: spends a token (must hold one), then pushes with no Danger recheck. */
export function convictionPush(c: Character, roll: Roll, dice: DiceSource): { character: Character; roll: Roll } {
  const spent = spendConviction(c, 'push'); // check the token before any die is thrown
  return { character: spent, roll: push(roll, 'conviction', dice) };
}
