import { RuleViolation } from './errors';
import { DIFFICULTY_RANKS, dangerIndex, skillIndex, type DangerRank, type DifficultyRank, type SkillRank } from './ranks';
import type { Armor, Tradition } from './character';
import type { Shift } from './shifts';

/** Opponent's Skill sets the Difficulty on the same row (Capable -> Demanding, Expert -> Hard). */
export const opposedDifficulty = (rank: SkillRank): DifficultyRank => DIFFICULTY_RANKS[skillIndex(rank)]!;

export type ThreatKind = 'blade' | 'blow' | 'arrow' | 'fire' | 'fall' | 'drowning' | 'poison' | 'magic' | 'other';
const WEAPON_THREATS: ThreatKind[] = ['blade', 'blow', 'arrow'];

/**
 * Light armor stops Real and Serious weapon threats; Heavy stops any blade, blow or arrow up to Grave.
 * Neither helps against fire, falls, drowning, poison or magic. Broken armor does nothing.
 * Returns the Danger-down shift, or null. (The edge rule in applyShifts turns it into a Skill-up against Minor.)
 */
export function armorShift(armor: Armor, danger: DangerRank, threat: ThreatKind, broken = false): Shift | null {
  if (armor === 'none' || broken || !WEAPON_THREATS.includes(threat)) return null;
  if (armor === 'light') {
    const d = dangerIndex(danger);
    if (d !== 1 && d !== 2) return null;
  }
  return { ladder: 'danger', delta: -1, source: 'armor', reason: `${armor} armor against a ${threat}` };
}

export type MagicEffect = 'practiced' | 'improvised';
/** Practiced: Difficulty down. Improvised: Difficulty and Danger both up. */
export function magicShifts(effect: MagicEffect): Shift[] {
  if (effect === 'practiced') return [{ ladder: 'difficulty', delta: -1, source: 'magic', reason: 'practiced effect' }];
  return [
    { ladder: 'difficulty', delta: 1, source: 'magic', reason: 'improvised effect' },
    { ladder: 'danger', delta: 1, source: 'magic', reason: 'improvised effect' },
  ];
}

export const MAX_PRACTICED = 3;
/** Up to three practiced effects; a fourth replaces one the player gives up. */
export function addPracticedEffect(t: Tradition, effect: string, replacing?: string): Tradition {
  if (t.practicedEffects.length >= MAX_PRACTICED) {
    if (!replacing || !t.practicedEffects.includes(replacing))
      throw new RuleViolation('PRACTICED_LIMIT', 'A fourth practiced effect replaces one the player gives up');
    return { ...t, practicedEffects: t.practicedEffects.map((e) => (e === replacing ? effect : e)) };
  }
  return { ...t, practicedEffects: [...t.practicedEffects, effect] };
}

/** Hurt and Wounded shift the related Skill down; a Wounded strain shifts the Danger up. Critical impairment is the GM's call, so it is not automatic. */
export function woundShifts(level: 'Hurt' | 'Wounded' | 'Critical' | 'Mortal', strained: boolean, name: string): Shift[] {
  if (level !== 'Hurt' && level !== 'Wounded') return [];
  const out: Shift[] = [{ ladder: 'skill', delta: -1, source: 'wound', reason: `${level}: ${name}` }];
  if (level === 'Wounded' && strained) out.push({ ladder: 'danger', delta: 1, source: 'wound', reason: `strained ${name}` });
  return out;
}
