import type { RatedSkillRank } from './ranks';
import type { WoundLevel } from './card';

export type Armor = 'none' | 'light' | 'heavy';
export type BeliefKind = 'objective' | 'relationship' | 'worldview';
export type GrantPick = 'connection' | 'resource' | 'thread';

export interface Skill { name: string; rank: RatedSkillRank }
export interface Belief { id: string; kind: BeliefKind; text: string; isCore: boolean; convictionEarnedThisSession: boolean }
export interface Instinct { id: string; text: string }
export type TraitSource = { type: 'chapter'; index: number } | { type: 'burden' | 'scar' | 'arcReview' | 'possession' | 'other' };
export interface Trait { id: string; text: string; harmful: boolean; source: TraitSource }
export interface Burden {
  id: string; beliefId: string; name: string; about: string;
  status: 'active' | 'laidDown'; outcome?: 'trait' | 'beliefRewrite';
}
export interface Wound { id: string; level: WoundLevel; name: string; isExhaustion: boolean; needsRename?: boolean }
export interface Chapter { summary: string; endsBadly: boolean; pick: GrantPick }
export interface Connection { id: string; text: string; withCharacterId?: string }
export type ThreadSource = { type: 'chapter'; index: number } | { type: 'crossing' | 'origin' | 'play' };
export interface Thread { id: string; text: string; source: ThreadSource }
export interface Crossing { withCharacterId: string; myChapter: number; theirChapter: number; touchesBelief: boolean }
export interface Possession { id: string; name: string; story: string }
export interface Tradition { source: string; method: string; price: string; priceSeverities: [string, string, string]; practicedEffects: string[] }

export const WEALTH_RUNGS = ['Scraping by', 'Comfortable', 'Prosperous', 'Rich', 'Fortune-scale'] as const;
export const NETWORK_RUNGS = ['A few contacts', 'A circle of acquaintances', 'Well connected', 'Known across the region', 'Reaches the powerful'] as const;
/** Wealth and Network rungs roll as Untrained..Master. */
export const RUNG_RANKS = ['Untrained', 'Trained', 'Capable', 'Expert', 'Master'] as const satisfies readonly RatedSkillRank[];
export const rungRank = (rung: number): RatedSkillRank => RUNG_RANKS[Math.min(Math.max(rung, 0), 4)]!;

export interface Character {
  id: string;
  name: string;
  origin: string;
  chapters: Chapter[];
  skills: Skill[];
  beliefs: Belief[];
  instincts: Instinct[];
  traits: Trait[];
  burdens: Burden[];
  /** Conviction tokens, 0-3. */
  conviction: number;
  connections: Connection[];
  threads: Thread[];
  crossings: Crossing[];
  possessions: Possession[];
  /** Wealth and Network rungs 0-4; both start at the second rung (1). */
  wealthRung: number;
  networkRung: number;
  standing: Record<string, 'Distrusted' | 'Unknown' | 'Known' | 'Respected'>;
  tradition: Tradition | null;
  armor: Armor;
  armorBroken: boolean;
  wounds: Wound[];
  /** Exhaustion has overflowed: can't act until a safe night's rest. */
  collapsed: boolean;
}

export const newCharacter = (id: string, name: string): Character => ({
  id, name, origin: '', chapters: [], skills: [], beliefs: [], instincts: [], traits: [], burdens: [],
  conviction: 1, connections: [], threads: [], crossings: [], possessions: [],
  wealthRung: 1, networkRung: 1, standing: {}, tradition: null,
  armor: 'none', armorBroken: false, wounds: [], collapsed: false,
});
