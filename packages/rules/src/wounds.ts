import { RuleViolation } from './errors';
import type { WoundLevel } from './card';
import type { Armor, Character, Wound } from './character';

export const WOUND_SLOTS = { Hurt: 2, Wounded: 2, Critical: 1 } as const;
const LADDER: WoundLevel[] = ['Hurt', 'Wounded', 'Critical', 'Mortal'];

export interface WoundInput {
  id: string;
  name: string;
  level: WoundLevel;
  isExhaustion?: boolean;
  /** Mortal only comes from a Danger declared Mortal at Set (Grave). Escalation from a full Critical needs no declaration. */
  declaredMortal?: boolean;
}
export interface WoundResult {
  character: Character;
  /** Where the wound landed, or 'Collapsed' when exhaustion overflowed. */
  placed: WoundLevel | 'Collapsed';
  escalated: boolean;
  /** An escalated wound is renamed by its player (Bruised Ribs -> Cracked Ribs). */
  needsRename: boolean;
}

const filled = (c: Character, level: WoundLevel) => c.wounds.filter((w) => w.level === level).length;

/** Fills slots and escalates to the next open rung. Armor is already applied at Set, so it is not consulted here. */
export function applyWound(c: Character, input: WoundInput): WoundResult {
  const exhaustion = input.isExhaustion ?? false;
  if (input.level === 'Mortal') {
    if (!input.declaredMortal) throw new RuleViolation('MORTAL_NOT_DECLARED', 'Mortal comes only from a Danger declared Mortal at Set, or from a full Critical');
    return add(c, { id: input.id, level: 'Mortal', name: input.name, isExhaustion: exhaustion }, 'Mortal', false);
  }
  let level: WoundLevel = input.level;
  let escalated = false;
  while (level !== 'Mortal' && filled(c, level) >= WOUND_SLOTS[level]) {
    level = LADDER[LADDER.indexOf(level) + 1]!;
    escalated = true;
  }
  if (exhaustion && (level === 'Critical' || level === 'Mortal')) {
    // Exhaustion stops at Collapsed.
    return { character: { ...c, collapsed: true }, placed: 'Collapsed', escalated: true, needsRename: false };
  }
  return add(c, { id: input.id, level, name: input.name, isExhaustion: exhaustion, needsRename: escalated || undefined }, level, escalated);
}

function add(c: Character, wound: Wound, placed: WoundLevel, escalated: boolean): WoundResult {
  return { character: { ...c, wounds: [...c.wounds, wound] }, placed, escalated, needsRename: escalated };
}

/** rest: Hurt (or any exhaustion) clears. treatment: Wounded -> Hurt. recovery: Critical -> Wounded. stabilize: Mortal -> Critical. safeNight: clears Collapsed. */
export type HealKind = 'rest' | 'treatment' | 'recovery' | 'stabilize' | 'safeNight';

export interface HealResult { character: Character; change: 'cleared' | 'stepped' | 'uncollapsed'; newLevel?: WoundLevel }

export function heal(c: Character, woundId: string | null, kind: HealKind): HealResult {
  if (kind === 'safeNight') {
    if (!c.collapsed) throw new RuleViolation('NOT_COLLAPSED', 'Only Collapsed clears with a safe night');
    return { character: { ...c, collapsed: false }, change: 'uncollapsed' };
  }
  const w = c.wounds.find((x) => x.id === woundId);
  if (!w) throw new RuleViolation('NO_SUCH_WOUND', `No wound ${woundId}`);
  const wrong = () => new RuleViolation('WRONG_HEAL_KIND', `${kind} does not heal a ${w.level} wound${w.isExhaustion ? ' (exhaustion)' : ''}`);

  if (kind === 'rest') {
    if (!(w.isExhaustion || w.level === 'Hurt') || w.level === 'Critical' || w.level === 'Mortal') throw wrong();
    return { character: { ...c, wounds: c.wounds.filter((x) => x.id !== w.id) }, change: 'cleared' };
  }
  const step: Record<string, WoundLevel | undefined> = { treatment: w.level === 'Wounded' ? 'Hurt' : undefined, recovery: w.level === 'Critical' ? 'Wounded' : undefined, stabilize: w.level === 'Mortal' ? 'Critical' : undefined };
  const to = step[kind];
  if (!to || w.isExhaustion) throw wrong();
  if (filled(c, to) >= WOUND_SLOTS[to as keyof typeof WOUND_SLOTS])
    throw new RuleViolation('NO_OPEN_SLOT', `No open ${to} slot; heal the ${to} wounds first`);
  const stepped: Wound = { ...w, level: to, needsRename: to === 'Wounded' || to === 'Critical' ? true : w.needsRename };
  return { character: { ...c, wounds: c.wounds.map((x) => (x.id === w.id ? stepped : x)) }, change: 'stepped', newLevel: to };
}

/** Break armor to ignore one wound entirely; it is lost until repaired. */
export function breakArmor(c: Character): Character {
  if (c.armor === 'none') throw new RuleViolation('NO_ARMOR', 'No armor to break');
  if (c.armorBroken) throw new RuleViolation('ARMOR_BROKEN', 'Armor is already broken');
  return { ...c, armorBroken: true };
}
export const repairArmor = (c: Character): Character => ({ ...c, armorBroken: false });

export type { Armor };
