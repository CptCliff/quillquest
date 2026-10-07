import { RuleViolation } from './errors';
import type { DiceSource } from './dice';
import {
  setCard, odds, worstWoundFor, type CardInput, type CardOdds, type DangerKind, type SetCard, type WoundLevel,
} from './card';
import { push as enginePush, resolve, type PushKind, type Roll } from './resolve';
import { CONVICTION_CAP, addBurden, convictionPush } from './conviction';
import { applyWound } from './wounds';
import { armorShift, magicShifts, woundShifts, type ThreatKind } from './modifiers';
import type { Character } from './character';
import type { Shift } from './shifts';
import type { Backing, DangerRank, DifficultyRank, RatedSkillRank, SkillRank } from './ranks';
import { DANGER_RANKS, DIFFICULTY_RANKS, dangerDie, difficultyDie, skillDie, dangerIndex } from './ranks';

/**
 * The life of a prompt card (Rules v4 3.2, 1.3; design plan 6). Pure: no clock, no storage, no network. The server rolls the
 * dice and keeps the records; every rule about who may do what, when, lives here so the UI and server never re-implement it.
 */

export type CardSpeed = 'quick' | 'big';
export type CardStatus = 'draft' | 'set' | 'rolled' | 'written' | 'conceded';
export interface FlowActor { id: string; role: 'player' | 'gm' }

export const CONCESSION_KINDS = [
  'surrender', 'escape', 'capture', 'disarmament', 'humiliation', 'loss of the objective', 'separation', 'injury',
  'forced agreement', 'lost reputation', 'a debt owed', 'a significant possession lost',
] as const;
export type ConcessionKind = (typeof CONCESSION_KINDS)[number];

export const MANUAL_SHIFT_SOURCES = ['helping', 'preparation', 'gear', 'magic'] as const;
export interface ManualShift { ladder: Shift['ladder']; delta: 1 | -1; source: (typeof MANUAL_SHIFT_SOURCES)[number]; reason: string }

export interface Written {
  outcomeParagraphId: string;
  /** Filled in by the server when it locks the prose; a retcon unlocks exactly these. */
  lockedParagraphIds: string[];
}

export interface PromptCard {
  id: string;
  actorId: string;
  characterId: string;
  /** The paragraph where the action was posted. The outcome must be at or after it. */
  anchorParagraphId: string | null;
  status: CardStatus;
  speed: CardSpeed;
  gmMarkedBig: boolean;
  want: string;
  risk: string;
  /** Belief id on the line, or null. */
  onTheLine: string | null;
  /** Another character the Danger falls on (character id), or null. */
  dangerTargetId: string | null;
  skillName: string;
  skillRank: RatedSkillRank;
  backingBeliefId: string | null;
  difficulty: DifficultyRank | null;
  danger: DangerRank | null;
  dangerText: string;
  dangerKind: DangerKind;
  declaredMortal: boolean;
  threat: ThreatKind | null;
  /** Keys chosen from suggestShifts, expanded server-side so provenance cannot be forged. */
  shiftKeys: string[];
  manualShifts: ManualShift[];
  appliedShifts: Shift[];
  set: SetCard | null;
  roll: Roll | null;
  concession: ConcessionKind | null;
  written: Written | null;
  retcons: number;
  revealed: boolean;
}

const deny = (code: string, message: string) => new RuleViolation(code, message);

export function classifyCard(c: Pick<PromptCard, 'onTheLine' | 'dangerTargetId' | 'characterId' | 'gmMarkedBig'>): CardSpeed {
  if (c.onTheLine || c.gmMarkedBig) return 'big';
  if (c.dangerTargetId && c.dangerTargetId !== c.characterId) return 'big';
  return 'quick';
}

export interface NewCardInput {
  id: string;
  actorId: string;
  characterId: string;
  anchorParagraphId: string | null;
  skill: { name: string; rank: RatedSkillRank };
  want?: string;
  risk?: string;
  onTheLine?: string | null;
  dangerTargetId?: string | null;
  backingBeliefId?: string | null;
}

export function newCard(i: NewCardInput): PromptCard {
  const card: PromptCard = {
    id: i.id, actorId: i.actorId, characterId: i.characterId, anchorParagraphId: i.anchorParagraphId,
    status: 'draft', speed: 'quick', gmMarkedBig: false,
    want: i.want ?? '', risk: i.risk ?? '', onTheLine: i.onTheLine ?? null, dangerTargetId: i.dangerTargetId ?? null,
    skillName: i.skill.name, skillRank: i.skill.rank, backingBeliefId: i.backingBeliefId ?? null,
    difficulty: null, danger: null, dangerText: '', dangerKind: i.onTheLine ? 'burden' : 'wound', declaredMortal: false, threat: null,
    shiftKeys: [], manualShifts: [], appliedShifts: [], set: null, roll: null, concession: null, written: null, retcons: 0, revealed: false,
  };
  return { ...card, speed: classifyCard(card) };
}

/** Skills come from the sheet. Anything not on it is attempted Untrained (Rules v4 3.3). */
export function resolveSkill(c: Character, name: string): { name: string; rank: RatedSkillRank } {
  const found = c.skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
  return found ? { name: found.name, rank: found.rank } : { name, rank: 'Untrained' };
}

// ---- shifts: suggested from the sheet, never invented by the client --------------------------------------------------

export interface ShiftCandidate { key: string; label: string; shifts: Shift[] }
export interface ShiftContext { threat?: ThreatKind | null; danger?: DangerRank | null }

const one = (ladder: Shift['ladder'], delta: 1 | -1, source: Shift['source'], reason: string): Shift => ({ ladder, delta, source, reason });

/** The shifts this character could claim. Judging which ones apply is the table's call; this only lists what the sheet supports. */
export function suggestShifts(c: Character, ctx: ShiftContext): ShiftCandidate[] {
  const out: ShiftCandidate[] = [];
  for (const t of c.traits) {
    const label = `${t.text} (${t.harmful ? 'harmful' : 'helpful'} Trait)`;
    if (t.harmful) {
      out.push({ key: `trait:${t.id}:skill`, label, shifts: [one('skill', -1, 'trait', t.text)] });
      out.push({ key: `trait:${t.id}:opposition`, label: `${label}, against the opposition`, shifts: [one('difficulty', 1, 'trait', t.text)] });
    } else {
      out.push({ key: `trait:${t.id}:skill`, label, shifts: [one('skill', 1, 'trait', t.text)] });
      out.push({ key: `trait:${t.id}:opposition`, label: `${label}, against the opposition`, shifts: [one('difficulty', -1, 'trait', t.text)] });
    }
  }
  for (const p of c.possessions) out.push({ key: `possession:${p.id}`, label: `${p.name} (possession)`, shifts: [one('skill', 1, 'possession', p.name)] });
  for (const w of c.wounds) {
    if (w.level !== 'Hurt' && w.level !== 'Wounded') continue;
    out.push({ key: `wound:${w.id}`, label: `${w.name} (${w.level})`, shifts: woundShifts(w.level, false, w.name) });
    if (w.level === 'Wounded') out.push({ key: `wound:${w.id}:strain`, label: `${w.name}, strained`, shifts: woundShifts(w.level, true, w.name) });
  }
  for (const [community, standing] of Object.entries(c.standing)) {
    if (standing === 'Respected') out.push({ key: `standing:${community}`, label: `Respected by ${community}`, shifts: [one('difficulty', -1, 'standing', `Respected: ${community}`)] });
    if (standing === 'Distrusted') out.push({ key: `standing:${community}`, label: `Distrusted by ${community}`, shifts: [one('difficulty', 1, 'standing', `Distrusted: ${community}`)] });
  }
  if (ctx.threat && ctx.danger) {
    const a = armorShift(c.armor, ctx.danger, ctx.threat, c.armorBroken);
    if (a) out.push({ key: 'armor', label: `${c.armor} armor`, shifts: [a] });
  }
  return out;
}

/** Expands chosen keys against the sheet and checks manual shifts. Throws if a key is not on offer. */
export function expandShifts(c: Character, ctx: ShiftContext, keys: string[], manual: ManualShift[]): { shifts: Shift[] } {
  const offered = new Map(suggestShifts(c, ctx).map((s) => [s.key, s]));
  const shifts: Shift[] = [];
  for (const key of keys) {
    const s = offered.get(key);
    if (!s) throw deny('SHIFT_NOT_OFFERED', `"${key}" is not a shift this character can claim`);
    shifts.push(...s.shifts);
  }
  for (const m of manual) {
    if (!MANUAL_SHIFT_SOURCES.includes(m.source)) throw deny('SHIFT_SOURCE', `A ${m.source} shift comes from the sheet, not by hand`);
    if (m.source === 'magic' && !c.tradition) throw deny('NO_TRADITION', 'Magic shifts need a tradition on the sheet');
    shifts.push({ ladder: m.ladder, delta: m.delta, source: m.source, reason: m.reason });
  }
  return { shifts };
}

// ---- editing and Set ---------------------------------------------------------------------------------------------------

export interface CardPatch {
  want?: string; risk?: string;
  onTheLine?: string | null; dangerTargetId?: string | null; backingBeliefId?: string | null;
  skill?: { name: string; rank: RatedSkillRank };
  difficulty?: DifficultyRank | null; danger?: DangerRank | null; dangerText?: string; dangerKind?: DangerKind; declaredMortal?: boolean;
  threat?: ThreatKind | null; shiftKeys?: string[]; manualShifts?: ManualShift[];
  gmMarkedBig?: boolean;
}
const RANK_FIELDS: (keyof CardPatch)[] = ['difficulty', 'danger'];
const GM_ONLY: (keyof CardPatch)[] = ['gmMarkedBig'];

function ownsCard(c: PromptCard, a: FlowActor) {
  return a.role === 'gm' || a.id === c.actorId;
}

/** Fill in a draft. The actor writes the card; ranks are theirs to propose on a quick roll and the GM's to set on a big one. */
export function editCard(card: PromptCard, actor: FlowActor, patch: CardPatch, sheet: Character): PromptCard {
  if (card.status !== 'draft') throw deny('NOT_DRAFT', 'Only a draft card can be edited; negotiate before the roll, never after');
  if (!ownsCard(card, actor)) throw deny('NOT_ALLOWED', 'That is not your card');
  for (const k of Object.keys(patch) as (keyof CardPatch)[]) {
    if (GM_ONLY.includes(k) && actor.role !== 'gm') throw deny('NOT_ALLOWED', 'Only the GM marks a roll as big');
  }
  const next: PromptCard = { ...card };
  const wantsRanks = RANK_FIELDS.some((k) => patch[k] !== undefined);
  if (wantsRanks && card.speed === 'big' && actor.role !== 'gm') throw deny('NOT_ALLOWED', 'On a big roll the GM sets the ranks');

  const hasBelief = (id: string | null | undefined) => id == null || sheet.beliefs.some((b) => b.id === id);
  if (!hasBelief(patch.onTheLine)) throw deny('NO_SUCH_BELIEF', 'That Belief is not on the sheet');
  if (!hasBelief(patch.backingBeliefId)) throw deny('NO_SUCH_BELIEF', 'That Belief is not on the sheet');

  if (patch.want !== undefined) next.want = patch.want;
  if (patch.risk !== undefined) next.risk = patch.risk;
  if (patch.onTheLine !== undefined) next.onTheLine = patch.onTheLine;
  if (patch.dangerTargetId !== undefined) next.dangerTargetId = patch.dangerTargetId;
  if (patch.backingBeliefId !== undefined) next.backingBeliefId = patch.backingBeliefId;
  if (patch.skill) { next.skillName = patch.skill.name; next.skillRank = patch.skill.rank; }
  if (patch.difficulty !== undefined) next.difficulty = patch.difficulty;
  if (patch.danger !== undefined) next.danger = patch.danger;
  if (patch.dangerText !== undefined) next.dangerText = patch.dangerText;
  if (patch.dangerKind !== undefined) next.dangerKind = patch.dangerKind;
  if (patch.declaredMortal !== undefined) next.declaredMortal = patch.declaredMortal;
  if (patch.threat !== undefined) next.threat = patch.threat;
  if (patch.shiftKeys !== undefined) next.shiftKeys = patch.shiftKeys;
  if (patch.manualShifts !== undefined) next.manualShifts = patch.manualShifts;
  if (patch.gmMarkedBig !== undefined) next.gmMarkedBig = patch.gmMarkedBig;

  // When a Belief is on the line the Danger is a Burden (Rules v4 3.2, 5.4).
  if (next.onTheLine) next.dangerKind = 'burden';
  else if (next.dangerKind === 'burden') next.dangerKind = 'wound';
  next.speed = classifyCard(next);
  return next;
}

function backingFor(card: PromptCard, sheet: Character): Backing {
  if (!card.backingBeliefId) return 'none';
  const b = sheet.beliefs.find((x) => x.id === card.backingBeliefId);
  if (!b) throw deny('NO_SUCH_BELIEF', 'That Belief is not on the sheet');
  // The Core Belief backs at Capable only when it is on the line; otherwise any relevant Belief backs at Trained.
  return b.isCore && card.onTheLine === b.id ? 'core' : 'belief';
}

function toInput(card: PromptCard, sheet: Character): { input: CardInput; shifts: Shift[] } {
  if (!card.want.trim()) throw deny('MISSING_FIELD', 'Write the Want: what the character wants and how they go about it');
  if (!card.risk.trim()) throw deny('MISSING_FIELD', 'Write the Risk: what failure feels like');
  if (!card.difficulty || !card.danger) throw deny('MISSING_FIELD', 'Name a Difficulty and a Danger');
  if (card.difficulty === 'Trivial') throw deny('BASE_DIFFICULTY', 'A Difficulty is named Simple to Mythic');
  const { shifts } = expandShifts(sheet, { threat: card.threat, danger: card.danger }, card.shiftKeys, card.manualShifts);
  const input: CardInput = {
    skill: card.skillRank,
    difficulty: card.difficulty,
    danger: card.danger,
    shifts,
    backing: backingFor(card, sheet),
    onTheLine: card.onTheLine,
    dangerKind: card.onTheLine ? 'burden' : card.dangerKind,
    declaredMortal: card.declaredMortal,
  };
  return { input, shifts };
}

export interface CardPreview { set: SetCard | null; odds: CardOdds | null; problems: string[] }

/** What Set would produce right now, or why it can't yet. Used to show odds words while the card is being filled in. */
export function previewCard(card: PromptCard, sheet: Character): CardPreview {
  try {
    const { input } = toInput(card, sheet);
    const set = setCard(input);
    return { set, odds: odds(set), problems: [] };
  } catch (e) {
    if (e instanceof RuleViolation) return { set: null, odds: null, problems: [e.message] };
    throw e;
  }
}

/** Closes Set: quick cards by the actor or GM; big cards by the GM. Severity is fixed here. */
export function closeSet(card: PromptCard, actor: FlowActor, sheet: Character): PromptCard {
  if (card.status !== 'draft') throw deny('NOT_DRAFT', 'Only a draft card can be Set');
  if (!ownsCard(card, actor)) throw deny('NOT_ALLOWED', 'That is not your card');
  const speed = classifyCard(card);
  if (speed === 'big' && actor.role !== 'gm') throw deny('NOT_ALLOWED', 'On a big roll the GM sets the card');
  const { input, shifts } = toInput(card, sheet);
  const set = setCard(input);
  return { ...card, speed, status: 'set', set, appliedShifts: shifts };
}

// ---- roll, push, concede -----------------------------------------------------------------------------------------------

export function rollCard(card: PromptCard, actor: FlowActor, dice: DiceSource): PromptCard {
  if (card.status !== 'set' || !card.set) throw deny('NOT_SET', 'The card must be Set before it is rolled');
  if (!ownsCard(card, actor)) throw deny('NOT_ALLOWED', 'That is not your card');
  return { ...card, status: 'rolled', roll: resolve(card.set, dice) };
}

export interface PushOptions { available: boolean; standard: boolean; conviction: boolean }
export function pushOptions(card: PromptCard, sheet: Character): PushOptions {
  const open = card.status === 'rolled' && !!card.roll && !card.roll.first.goal && card.roll.push === 'none';
  return { available: open, standard: open, conviction: open && sheet.conviction >= 1 };
}

export function pushCard(card: PromptCard, actor: FlowActor, kind: Exclude<PushKind, 'none'>, dice: DiceSource, sheet: Character): { card: PromptCard; character: Character } {
  if (card.status !== 'rolled' || !card.roll) throw deny('NOT_ROLLED', 'There is nothing to push');
  if (!ownsCard(card, actor)) throw deny('NOT_ALLOWED', 'That is not your card');
  if (kind === 'conviction') {
    const r = convictionPush(sheet, card.roll, dice);
    return { card: { ...card, roll: r.roll }, character: r.character };
  }
  return { card: { ...card, roll: enginePush(card.roll, 'standard', dice) }, character: sheet };
}

/** A player may concede at Set, or instead of pushing after a failed goal. A Danger that already hit still happens. */
export function concede(card: PromptCard, actor: FlowActor, kind: ConcessionKind): PromptCard {
  if (!ownsCard(card, actor)) throw deny('NOT_ALLOWED', 'That is not your card');
  if (!CONCESSION_KINDS.includes(kind)) throw deny('BAD_CONCESSION', `Choose one of: ${CONCESSION_KINDS.join(', ')}`);
  const beforeRoll = card.status === 'draft' || card.status === 'set';
  const afterFailure = card.status === 'rolled' && !!card.roll && !card.roll.first.goal && card.roll.push === 'none';
  if (!beforeRoll && !afterFailure) throw deny('CANNOT_CONCEDE', 'Concede at Set, or instead of pushing after a failed goal');
  return { ...card, status: 'conceded', concession: kind };
}

// ---- outcome prompts ---------------------------------------------------------------------------------------------------

export interface OutcomePrompt {
  headline: string;
  lines: string[];
  voice: ('flourish' | 'beliefSuccess' | 'roomToSpare')[];
  costLands: boolean;
  recheckNote?: string;
}

const VOICE_LINES = {
  flourish: 'Flourish: add one true detail that helps your character, in one sentence.',
  beliefSuccess: 'A Belief backed this roll and it succeeded: show the Belief moving forward in this scene.',
  roomToSpare: 'You do it with room to spare. What do you do with the room?',
} as const;

/** States what must be true, never finished prose (Rules v4 3.5-3.6). Rank words only; no dice. */
export function outcomePrompt(card: PromptCard, ctx: { targetName?: string } = {}): OutcomePrompt {
  const r = card.roll;
  if (!r) throw deny('NOT_ROLLED', 'No roll yet');
  const cost = (card.dangerText.trim().replace(/\.$/, '') || 'the declared cost');
  const headline = {
    cleanSuccess: 'Clean success. Write how you get it.',
    successWithCost: `Success, with the cost. Write how you get it; then the cost lands: ${cost}.`,
    failureNoCost: 'Failure, no cost. Write how it slips away and what changes.',
    failureWithCost: `Failure, and the cost lands: ${cost}. Write both.`,
  }[r.outcome];
  const voice: OutcomePrompt['voice'] = [];
  if (r.goal && r.flourish) voice.push('flourish');
  if (r.goal && r.beliefSuccess) voice.push('beliefSuccess');
  if (r.goal && r.roomToSpare) voice.push('roomToSpare');
  const lines: string[] = voice.map((v) => VOICE_LINES[v]);
  const onOther = r.dangerHit && card.dangerTargetId && card.dangerTargetId !== card.characterId;
  if (onOther) lines.push(`${ctx.targetName ?? 'The other character'} writes the cost that lands on their character.`);
  return {
    headline, lines, voice, costLands: r.dangerHit,
    recheckNote: r.push === 'standard' && r.recheck ? `You pushed: the Danger was checked again at ${r.recheck.rank}.` : undefined,
  };
}

// ---- written, costs, retcon --------------------------------------------------------------------------------------------

export function markWritten(card: PromptCard, actor: FlowActor, info: { outcomeParagraphId: string }): PromptCard {
  if (actor.id !== card.actorId) throw deny('NOT_ALLOWED', 'The acting writer writes the outcome');
  if (card.status !== 'rolled' && card.status !== 'conceded') throw deny('NOT_ROLLED', 'Roll the card (or concede) before writing the outcome');
  return { ...card, status: 'written', written: { outcomeParagraphId: info.outcomeParagraphId, lockedParagraphIds: [] } };
}

const WOUND_ORDER: WoundLevel[] = ['Hurt', 'Wounded', 'Critical', 'Mortal'];

export interface CostInput { woundId?: string; woundName?: string; woundLevel?: WoundLevel; burdenId?: string; burdenName?: string }

/**
 * Applies a landed cost to the acting character through the engine: a wound (named by the writer, never worse than the
 * severity fixed at Set) or a Burden (named after the roll). Costs on another character are theirs to write (M7).
 */
export function applyCosts(sheet: Character, card: PromptCard, cost: CostInput): Character {
  const r = card.roll;
  if (!r || !r.dangerHit) return sheet;
  if (card.dangerTargetId && card.dangerTargetId !== card.characterId) return sheet;
  if (card.dangerKind === 'burden' || card.onTheLine) {
    if (!cost.burdenName?.trim()) throw deny('NAME_BURDEN', 'Name the Burden: a short phrase for the lasting change');
    return addBurden(sheet, card.onTheLine!, { id: cost.burdenId ?? `burden-${card.id}`, name: cost.burdenName.trim(), about: card.risk });
  }
  if (card.dangerKind === 'wound') {
    const worst = worstWoundFor(card.set!.severity, 'wound', card.declaredMortal);
    if (!worst) return sheet; // Minor: a scare, lost time
    const level = cost.woundLevel ?? worst;
    if (WOUND_ORDER.indexOf(level) > WOUND_ORDER.indexOf(worst)) throw deny('WOUND_TOO_SEVERE', `That wound is worse than the ${card.set!.severity} Danger allows`);
    return applyWound(sheet, {
      id: cost.woundId ?? `wound-${card.id}`, name: cost.woundName?.trim() || `${level} wound`, level, declaredMortal: card.declaredMortal,
    }).character;
  }
  return sheet;
}

/** Undoes what a roll did to its character: the wound or Burden it added, and a spent Conviction token. Call before reopening. */
export function revertCosts(sheet: Character, card: PromptCard): Character {
  const woundId = `wound-${card.id}`;
  const burdenId = `burden-${card.id}`;
  const refund = card.roll?.push === 'conviction' ? 1 : 0;
  return {
    ...sheet,
    wounds: sheet.wounds.filter((w) => w.id !== woundId),
    burdens: sheet.burdens.filter((b) => b.id !== burdenId),
    conviction: Math.min(CONVICTION_CAP, sheet.conviction + refund),
  };
}

/** The GM reopens a written quick roll as a draft: ranks editable, dice gone. The server checks nothing was posted after it. */
export function reopenForRetcon(card: PromptCard, actor: FlowActor): PromptCard {
  if (actor.role !== 'gm') throw deny('NOT_ALLOWED', 'Only the GM can retcon a roll');
  if (card.status !== 'written') throw deny('NOT_WRITTEN', 'Only a written roll can be retconned');
  if (card.speed !== 'quick') throw deny('NOT_QUICK', 'Only a quick roll can be retconned; a big roll stands once written');
  return { ...card, status: 'draft', set: null, roll: null, written: null, concession: null, appliedShifts: [], revealed: false, retcons: card.retcons + 1 };
}

// ---- views: what players may see ---------------------------------------------------------------------------------------

interface DieView { sides: number; value: number }
export interface DiceView {
  skill: DieView; backing?: DieView; difficulty: DieView; danger: DieView & { rank: DangerRank }; kept: number;
  second?: { skill: DieView; backing?: DieView; difficulty: DieView; kept: number };
  recheck?: DieView & { rank: DangerRank };
}

/** The reveal view: the only place dice appear. */
export function diceView(r: Roll): DiceView {
  const c = r.card;
  const bSides = c.backing === 'core' ? 8 : c.backing === 'belief' ? 6 : null;
  const att = (a: Roll['first']) => ({
    skill: { sides: skillDie(c.skill), value: a.skillDie },
    ...(a.backingDie !== null && bSides ? { backing: { sides: bSides, value: a.backingDie } } : {}),
    difficulty: { sides: difficultyDie(c.difficulty), value: a.difficultyDie },
    kept: a.kept,
  });
  const first = att(r.first);
  return {
    ...first,
    danger: { rank: r.firstDanger.rank, sides: dangerDie(r.firstDanger.rank), value: r.firstDanger.die },
    ...(r.second ? { second: att(r.second) } : {}),
    ...(r.recheck ? { recheck: { rank: r.recheck.rank, sides: dangerDie(r.recheck.rank), value: r.recheck.die } } : {}),
  };
}

export interface PublicCard {
  id: string; status: CardStatus; speed: CardSpeed; actorId: string; characterId: string; anchorParagraphId: string | null;
  skillName: string; skillRank: SkillRank; want: string; risk: string; onTheLine: string | null; backingBeliefId: string | null;
  dangerTargetId: string | null; dangerText: string; dangerKind: DangerKind; declaredMortal: boolean; threat: ThreatKind | null;
  difficulty: DifficultyRank | null; danger: DangerRank | null;
  shiftKeys: string[]; manualShifts: ManualShift[]; shifts: { ladder: Shift['ladder']; delta: number; reason: string }[];
  /** Words only. Numeric chances never leave the server. */
  odds: { goal: string; danger: string } | null;
  backing: Backing | null; severity: DangerRank | null; worstWound: WoundLevel | null;
  outcome: Roll['outcome'] | null; goal: boolean | null; dangerHit: boolean | null;
  push: Roll['push'] | null; recheckRank: DangerRank | null;
  concession: ConcessionKind | null; written: Written | null; retcons: number; revealed: boolean;
  /** Present only after someone taps Reveal. */
  dice: DiceView | null;
}

/** What goes in the shared ledger: everything except dice and numeric odds. */
export function toPublicCard(card: PromptCard): PublicCard {
  const o = card.set ? odds(card.set) : null;
  const r = card.roll;
  return {
    id: card.id, status: card.status, speed: card.speed, actorId: card.actorId, characterId: card.characterId, anchorParagraphId: card.anchorParagraphId,
    skillName: card.skillName, skillRank: card.set ? card.set.skill : card.skillRank, want: card.want, risk: card.risk,
    onTheLine: card.onTheLine, backingBeliefId: card.backingBeliefId, dangerTargetId: card.dangerTargetId, dangerText: card.dangerText,
    dangerKind: card.dangerKind, declaredMortal: card.declaredMortal, threat: card.threat,
    difficulty: card.set ? card.set.difficulty : card.difficulty, danger: card.set ? card.set.danger : card.danger,
    shiftKeys: card.shiftKeys, manualShifts: card.manualShifts,
    shifts: card.appliedShifts.map((s) => ({ ladder: s.ladder, delta: s.delta, reason: s.reason })),
    odds: o ? { goal: o.goal.word, danger: o.danger.word } : null,
    backing: card.set?.backing ?? null, severity: card.set?.severity ?? null, worstWound: card.set?.worstWound ?? null,
    outcome: r?.outcome ?? null, goal: r?.goal ?? null, dangerHit: r?.dangerHit ?? null, push: r?.push ?? null, recheckRank: r?.recheck?.rank ?? null,
    concession: card.concession, written: card.written, retcons: card.retcons, revealed: card.revealed,
    dice: card.revealed && r ? diceView(r) : null,
  };
}


