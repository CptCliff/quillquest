// The life of a battle card (Rules v4 4; design plan 6.3). Pure: the server supplies dice, sheets and the clock.
// The battle maths (Set, Roll, push) lives in battle.ts; this file decides who may do what, and when.
import { RuleViolation } from './errors';
import { DANGER_RANKS, DIFFICULTY_RANKS, skillDie, difficultyDie, dangerDie, type DangerRank, type DifficultyRank } from './ranks';
import { BATTLE_CAP } from './shifts';
import { odds, worstWoundFor, type DangerKind, type WoundLevel } from './card';
import { pushBattle, resolveBattle, setBattle, type BattleRoll, type Contribution, type ContributionType, type SetBattle } from './battle';
import { CONCESSION_KINDS, cardInput, editCard, newCard, type CardPatch, type ConcessionKind, type CostInput, type FlowActor, type PromptCard } from './flow';
import { addBurden, spendConviction } from './conviction';
import { applyWound } from './wounds';
import type { Character } from './character';
import type { CardInput } from './card';
import type { DiceSource } from './dice';
import type { PushKind } from './resolve';

const no = (code: string, message: string): never => { throw new RuleViolation(code, message); };
const nonBlank = (s: string | undefined, what: string): string => (s?.trim() ? s.trim() : no('BAD_INPUT', `${what} cannot be blank`));

export type BattleStatus = 'declaring' | 'set' | 'rolled' | 'pushing' | 'written' | 'conceded';
export type ContributionStatus = 'open' | 'declared' | 'withdrawn' | 'skipped';
export interface BattleContribution {
  characterId: string; actorId: string; status: ContributionStatus;
  line: string; type: ContributionType | null; target: string | null;
  dangerRank: DangerRank | null; dangerText: string; dangerKind: DangerKind; declaredMortal: boolean;
}
export interface Beat { actorId: string; text: string; cost?: { text: string; woundName?: string; woundLevel?: WoundLevel; burdenName?: string } }
export interface PushWindow { kind: 'standard'; answers: Record<string, 'withdraw' | 'stay'>; deadline: number }

export interface BattleCard {
  id: string;
  status: BattleStatus;
  goal: string; battleDanger: string; framingParagraphId: string | null;
  lead: PromptCard;
  contributions: BattleContribution[];
  /** What Set froze: the lead's engine input and the active contributions. The roll and pushes are computed from this. */
  frozen: { leadInput: CardInput; contributions: Contribution[] } | null;
  set: SetBattle | null;
  roll: BattleRoll | null;
  revealed: boolean;
  push: PushWindow | null;
  concession: ConcessionKind | null;
  beats: Record<string, Beat>;
  order: string[] | null;
  stitched: boolean;
}

const active = (b: BattleCard) => b.contributions.filter((c) => c.status === 'declared');
const asContribution = (c: BattleContribution): Contribution => ({
  characterId: c.characterId, type: c.type!, ...(c.target ? { target: c.target } : {}), dangerRank: c.dangerRank!, dangerText: c.dangerText, dangerKind: c.dangerKind, declaredMortal: c.declaredMortal,
});
export const waitingOn = (b: BattleCard): string[] => b.contributions.filter((c) => c.status === 'open').map((c) => c.characterId);
const isGm = (a: FlowActor) => a.role === 'gm';
const leadActor = (b: BattleCard, a: FlowActor) => a.id === b.lead.actorId;

// ---------- opening and declaring ----------
export function openBattle(actor: FlowActor, a: {
  id: string; goal: string; battleDanger: string; difficulty: DifficultyRank; dangerRank: DangerRank; framingParagraphId: string | null;
  lead: { characterId: string; actorId: string }; others: { characterId: string; actorId: string }[];
}): BattleCard {
  if (!isGm(actor)) no('NOT_ALLOWED', 'Only the GM opens a battle');
  if (!DIFFICULTY_RANKS.includes(a.difficulty) || a.difficulty === 'Trivial') no('BAD_INPUT', 'The opposition\'s Difficulty is Simple to Mythic');
  if (!DANGER_RANKS.includes(a.dangerRank)) no('BAD_INPUT', 'Name a real Danger rank');
  const goal = nonBlank(a.goal, 'The goal'); const danger = nonBlank(a.battleDanger, 'The battle\'s Danger');
  const base = newCard({ id: `${a.id}-lead`, actorId: a.lead.actorId, characterId: a.lead.characterId, anchorParagraphId: a.framingParagraphId, skill: { name: '', rank: 'Untrained' } });
  const lead: PromptCard = { ...base, speed: 'big', gmMarkedBig: true, difficulty: a.difficulty, danger: a.dangerRank, dangerText: danger };
  return {
    id: a.id, status: 'declaring', goal, battleDanger: danger, framingParagraphId: a.framingParagraphId, lead,
    contributions: a.others.map((o) => ({ characterId: o.characterId, actorId: o.actorId, status: 'open', line: '', type: null, target: null, dangerRank: null, dangerText: '', dangerKind: 'wound', declaredMortal: false })),
    frozen: null, set: null, roll: null, revealed: false, push: null, concession: null, beats: {}, order: null, stitched: false,
  };
}

/** The lead fills the main card (Want, Risk, a Belief, the Skill, shifts). The ranks are the GM's. */
export function editLead(b: BattleCard, actor: FlowActor, patch: CardPatch, sheet: Character): BattleCard {
  if (b.status !== 'declaring') no('NOT_DECLARING', 'The battle is past declaring');
  if (!isGm(actor) && !leadActor(b, actor)) no('NOT_ALLOWED', 'Only the lead fills the main card');
  return { ...b, lead: editCard(b.lead, actor, patch, sheet) };
}

export interface ContributionInput { line: string; type: ContributionType; target?: string; dangerRank: DangerRank; dangerText: string; dangerKind?: DangerKind; declaredMortal?: boolean }

export function declareContribution(b: BattleCard, actor: FlowActor, i: ContributionInput): BattleCard {
  const mine = b.contributions.find((c) => c.actorId === actor.id);
  if (!mine || isGm(actor)) return no('NOT_ALLOWED', 'You are not a contributor to this battle');
  if (b.status !== 'declaring') no('NOT_DECLARING', 'The battle is past declaring');
  if (mine.status === 'withdrawn' || mine.status === 'skipped') no('NOT_ALLOWED', 'You have left this battle');
  const line = nonBlank(i.line, 'Say what your character does');
  const dangerText = nonBlank(i.dangerText, 'Name your own Danger');
  if (!['press', 'open', 'cover'].includes(i.type)) no('BAD_INPUT', 'A contribution is Press, Open or Cover');
  if (!DANGER_RANKS.includes(i.dangerRank)) no('BAD_INPUT', 'Name a real Danger rank');
  let target: string | null = null;
  if (i.type === 'cover') {
    const others = b.contributions.filter((c) => c.characterId !== mine.characterId && (c.status === 'open' || c.status === 'declared')).map((c) => c.characterId);
    if (!i.target || i.target === mine.characterId || ![b.lead.characterId, ...others].includes(i.target)) no('COVER_TARGET', 'A Cover names the lead or another contributor');
    target = i.target!;
  }
  const next: BattleContribution = { ...mine, status: 'declared', line, type: i.type, target, dangerRank: i.dangerRank, dangerText, dangerKind: i.dangerKind ?? 'wound', declaredMortal: !!i.declaredMortal };
  const contributions = b.contributions.map((c) => (c === mine ? next : c));
  const live = contributions.filter((c) => c.status === 'declared');
  const count = (f: (c: BattleContribution) => boolean) => live.filter(f).length;
  const covers = new Map<string, number>();
  live.filter((c) => c.type === 'cover').forEach((c) => covers.set(c.target!, (covers.get(c.target!) ?? 0) + 1));
  if (count((c) => c.type === 'press') > BATTLE_CAP || count((c) => c.type === 'open') > BATTLE_CAP || [...covers.values()].some((n) => n > BATTLE_CAP))
    no('BATTLE_CAP', `Contributions shift any one ladder at most ${BATTLE_CAP} ranks`);
  return { ...b, contributions };
}

/** A contributor concedes: their contribution and their Danger go with them. After Set, the battle goes back to be set again. */
export function concedeContributor(b: BattleCard, actor: FlowActor): BattleCard {
  const mine = b.contributions.find((c) => c.actorId === actor.id);
  if (!mine || isGm(actor)) return no('NOT_ALLOWED', 'You are not a contributor to this battle');
  if (b.status !== 'declaring' && b.status !== 'set') no('NOT_DECLARING', 'Concede at Set, or withdraw when a push is offered');
  return reopenSet({ ...b, contributions: b.contributions.map((c) => (c === mine ? { ...c, status: 'withdrawn' } : c)) });
}
const reopenSet = (b: BattleCard): BattleCard => (b.status === 'set' ? { ...b, status: 'declaring', set: null, frozen: null } : b);

/** The GM moves on without someone who has not declared. */
export function skipContributor(b: BattleCard, actor: FlowActor, characterId: string): BattleCard {
  if (!isGm(actor)) no('NOT_ALLOWED', 'Only the GM skips a contributor');
  const c = b.contributions.find((x) => x.characterId === characterId) ?? no('NO_SUCH_CONTRIBUTOR', 'No such contributor');
  if (c.status === 'declared') no('ALREADY_DECLARED', 'They have declared; ask them to concede instead');
  return { ...b, contributions: b.contributions.map((x) => (x === c ? { ...x, status: 'skipped' } : x)) };
}

// ---------- Set, Roll ----------
export interface SetAdjust { difficulty?: DifficultyRank; dangers?: Record<string, DangerRank> }

export function setBattleCard(b: BattleCard, actor: FlowActor, sheets: Record<string, Character>, adjust: SetAdjust = {}): BattleCard {
  if (!isGm(actor)) no('NOT_ALLOWED', 'Only the GM sets a battle');
  if (b.status !== 'declaring') no('NOT_DECLARING', 'The battle is past declaring');
  if (waitingOn(b).length) no('NOT_ALL_DECLARED', 'Everyone must declare, concede, or be skipped first');
  if (adjust.difficulty && (!DIFFICULTY_RANKS.includes(adjust.difficulty) || adjust.difficulty === 'Trivial')) no('BAD_INPUT', 'Name a Difficulty from Simple to Mythic');
  for (const r of Object.values(adjust.dangers ?? {})) if (!DANGER_RANKS.includes(r)) no('BAD_INPUT', 'Name a real Danger rank');
  if (!b.lead.skillName) no('MISSING_FIELD', 'The lead chooses a Skill first');
  const sheet = sheets[b.lead.characterId] ?? no('NO_CHARACTER', 'No such character');
  const lead: PromptCard = { ...b.lead, difficulty: adjust.difficulty ?? b.lead.difficulty, danger: adjust.dangers?.[b.lead.characterId] ?? b.lead.danger };
  const contributions = b.contributions.map((c) => (c.status === 'declared' && adjust.dangers?.[c.characterId] ? { ...c, dangerRank: adjust.dangers[c.characterId]! } : c));
  const leadInput = cardInput(lead, sheet).input;
  const live = contributions.filter((c) => c.status === 'declared').map(asContribution);
  const set = setBattle(lead.characterId, leadInput, live);
  return { ...b, status: 'set', lead, contributions, frozen: { leadInput, contributions: live }, set };
}

export function rollBattle(b: BattleCard, actor: FlowActor, dice: DiceSource): BattleCard {
  if (!isGm(actor)) no('NOT_ALLOWED', 'Only the GM rolls a battle');
  if (b.status !== 'set' || !b.frozen) no('NOT_SET', 'Set the battle before it is rolled');
  const roll = resolveBattle(b.lead.characterId, b.frozen!.leadInput, b.frozen!.contributions, dice);
  return { ...b, status: 'rolled', roll };
}

// ---------- push, withdrawals, concession ----------
export function requestPush(b: BattleCard, actor: FlowActor, kind: Exclude<PushKind, 'none'>, o: { now: number; windowMs: number; dice: DiceSource; sheet: Character }): { battle: BattleCard; character: Character | null } {
  if (b.status !== 'rolled' || !b.roll) no('NOT_ROLLED', 'There is nothing to push');
  if (!leadActor(b, actor)) no('NOT_ALLOWED', 'Only the lead pushes');
  if (b.roll!.push !== 'none') no('ALREADY_PUSHED', 'A roll may be pushed only once');
  if (b.roll!.first.goal) no('NOTHING_TO_PUSH', 'Push is only for a failed goal');
  if (kind === 'conviction') {
    const character = spendConviction(o.sheet, 'push');
    return { battle: { ...b, roll: pushBattle(b.roll!, 'conviction', o.dice) }, character };
  }
  if (!active(b).length) return { battle: { ...b, roll: pushBattle(b.roll!, 'standard', o.dice) }, character: null };
  return { battle: { ...b, status: 'pushing', push: { kind: 'standard', answers: {}, deadline: o.now + o.windowMs } }, character: null };
}

export function answerPush(b: BattleCard, actor: FlowActor, answer: 'withdraw' | 'stay'): BattleCard {
  if (b.status !== 'pushing' || !b.push) no('NOT_PUSHING', 'No push is waiting on you');
  const mine = active(b).find((c) => c.actorId === actor.id);
  if (!mine || isGm(actor)) no('NOT_ALLOWED', 'Only a contributor answers a push');
  if (answer !== 'withdraw' && answer !== 'stay') no('BAD_INPUT', 'Withdraw or stay');
  return { ...b, push: { ...b.push!, answers: { ...b.push!.answers, [mine!.characterId]: answer } } };
}

export function pushReady(b: BattleCard, now: number): boolean {
  if (b.status !== 'pushing' || !b.push) return false;
  return now >= b.push.deadline || active(b).every((c) => b.push!.answers[c.characterId]);
}

export function resolvePush(b: BattleCard, actor: FlowActor, dice: DiceSource, now: number, opts: { force?: boolean } = {}): BattleCard {
  if (b.status !== 'pushing' || !b.push || !b.roll) no('NOT_PUSHING', 'No push is waiting');
  if (!isGm(actor) && !leadActor(b, actor)) no('NOT_ALLOWED', 'Only the lead or the GM resolves a push');
  if (!pushReady(b, now) && !(isGm(actor) && opts.force)) no('PUSH_NOT_READY', 'Contributors are still deciding whether to withdraw');
  const withdrawals = Object.entries(b.push!.answers).filter(([, a]) => a === 'withdraw').map(([id]) => id);
  const roll = pushBattle(b.roll!, 'standard', dice, withdrawals);
  return { ...b, status: 'rolled', push: null, roll, contributions: b.contributions.map((c) => (withdrawals.includes(c.characterId) ? { ...c, status: 'withdrawn' } : c)) };
}

/** The lead concedes at Set, or instead of pushing after a failed goal. A Danger that already hit still happens. */
export function concedeBattle(b: BattleCard, actor: FlowActor, kind: ConcessionKind): BattleCard {
  if (!leadActor(b, actor)) no('NOT_ALLOWED', 'Only the lead concedes the battle');
  if (!CONCESSION_KINDS.includes(kind)) no('BAD_INPUT', `Choose one of: ${CONCESSION_KINDS.join(', ')}`);
  const before = b.status === 'declaring' || b.status === 'set';
  const afterFailure = b.status === 'rolled' && !!b.roll && !b.roll.first.goal && b.roll.push === 'none';
  if (!before && !afterFailure) no('CANNOT_CONCEDE', 'Concede at Set, or instead of pushing after a failed goal');
  return { ...b, status: 'conceded', concession: kind, push: null };
}

// ---------- beats, costs, the stitched post ----------
const participants = (b: BattleCard): { characterId: string; actorId: string }[] => [
  { characterId: b.lead.characterId, actorId: b.lead.actorId }, ...b.contributions.filter((c) => c.status !== 'skipped').map((c) => ({ characterId: c.characterId, actorId: c.actorId })),
];
const sentences = (t: string) => t.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length;

export function writeBeat(b: BattleCard, actor: FlowActor, a: { text: string; cost?: Beat['cost'] }): BattleCard {
  if (b.status !== 'rolled' && b.status !== 'conceded') no('NOT_ROLLED', 'Roll the battle (and settle any push) before writing a beat');
  const mine = participants(b).find((p) => p.actorId === actor.id);
  if (!mine || isGm(actor)) return no('NOT_ALLOWED', 'You are not in this battle');
  const text = nonBlank(a.text, 'The beat');
  if (text.length > 600 || sentences(text) > 3) no('BEAT_LENGTH', 'A beat is one to three sentences');
  if (a.cost && (!a.cost.text.trim() || a.cost.text.length > 300)) no('BEAT_LENGTH', 'A cost line is a sentence or two');
  return { ...b, beats: { ...b.beats, [mine.characterId]: { actorId: actor.id, text, ...(a.cost ? { cost: { ...a.cost, text: a.cost.text.trim() } } : {}) } } };
}

const contributorIds = (b: BattleCard): string[] => {
  const ids = b.contributions.filter((c) => c.status !== 'skipped').map((c) => c.characterId);
  const order = (b.order ?? []).filter((id) => ids.includes(id));
  return [...order, ...ids.filter((id) => !order.includes(id))];
};

/** The GM chooses the order the contributions appear in the stitched post (the lead is always first). */
export function orderBeats(b: BattleCard, actor: FlowActor, ids: string[]): BattleCard {
  if (!isGm(actor)) no('NOT_ALLOWED', 'Only the GM orders the beats');
  const have = contributorIds(b);
  if (ids.length !== have.length || !have.every((id) => ids.includes(id))) no('BAD_INPUT', 'List every contributor once');
  return { ...b, order: ids };
}

export interface BattleCostDue { characterId: string; severity: DangerRank; worstWound: WoundLevel | null }
/** Which characters' Dangers landed (and were not withdrawn): each one has a cost to write. */
export function battleCosts(b: BattleCard): BattleCostDue[] {
  if (!b.roll) return [];
  return b.roll.dangers.filter((d) => d.hit && !d.withdrawn).map((d) => ({ characterId: d.characterId, severity: d.severity, worstWound: d.worstWound }));
}

export interface PostItem { characterId: string; actorId: string; text: string; kind: 'beat' | 'cost' }

/** The beats in order (lead, then contributions in the GM's order), then the cost lines of Dangers that landed. */
export function postOf(b: BattleCard): PostItem[] {
  const order = [b.lead.characterId, ...contributorIds(b)];
  const landed = battleCosts(b).map((c) => c.characterId);
  const post: PostItem[] = order.flatMap((id) => (b.beats[id] ? [{ characterId: id, actorId: b.beats[id]!.actorId, text: b.beats[id]!.text, kind: 'beat' as const }] : []));
  for (const id of order) {
    const beat = b.beats[id];
    if (beat?.cost && landed.includes(id)) post.push({ characterId: id, actorId: beat.actorId, text: beat.cost.text, kind: 'cost' });
  }
  return post;
}

/** One Story post: the lead's beat, then each contribution in the GM's order, then the costs. Each item keeps its writer. */
export function stitchBattle(b: BattleCard, actor: FlowActor, opts: { skipMissing?: boolean } = {}): { battle: BattleCard; post: PostItem[] } {
  if (!isGm(actor)) no('NOT_ALLOWED', 'Only the GM stitches the post');
  if ((b.status !== 'rolled' && b.status !== 'conceded') || b.stitched) no('NOT_ROLLED', 'There is no finished battle to stitch');
  const order = [b.lead.characterId, ...contributorIds(b)];
  const missing = order.filter((id) => !b.beats[id]);
  if (missing.length && !opts.skipMissing) no('BEATS_PENDING', 'Every player writes a beat first (or the GM leaves a missing one out)');
  const costs = battleCosts(b);
  if (costs.some((c) => b.beats[c.characterId] && !b.beats[c.characterId]!.cost)) no('COST_PENDING', 'A Danger that landed needs its cost written');
  const post = postOf(b);
  return { battle: { ...b, status: 'written', stitched: true }, post };
}

const WOUND_ORDER: WoundLevel[] = ['Hurt', 'Wounded', 'Critical', 'Mortal'];

/** Applies one character's landed cost through the engine: a wound never worse than its severity, or the lead's Burden. Avoided Dangers cost nothing. */
export function applyBattleCost(sheet: Character, b: BattleCard, characterId: string, cost: CostInput): Character {
  const d = b.roll?.dangers.find((x) => x.characterId === characterId);
  if (!d || !d.hit || d.withdrawn) return sheet;
  const isLead = characterId === b.lead.characterId;
  const c = b.contributions.find((x) => x.characterId === characterId);
  const kind: DangerKind = isLead ? (b.lead.onTheLine ? 'burden' : b.lead.dangerKind) : (c?.dangerKind ?? 'wound');
  if (kind === 'burden' && isLead && b.lead.onTheLine) {
    if (!cost.burdenName?.trim()) no('NAME_BURDEN', 'Name the Burden: a short phrase for the lasting change');
    return addBurden(sheet, b.lead.onTheLine, { id: cost.burdenId ?? `burden-${b.id}`, name: cost.burdenName!.trim(), about: b.lead.risk });
  }
  if (kind !== 'wound') return sheet;
  const mortal = isLead ? b.lead.declaredMortal : !!c?.declaredMortal;
  const worst = d.worstWound ?? worstWoundFor(d.severity, 'wound', mortal);
  if (!worst) return sheet;
  const level = cost.woundLevel ?? worst;
  if (WOUND_ORDER.indexOf(level) > WOUND_ORDER.indexOf(worst)) no('WOUND_TOO_SEVERE', `That wound is worse than the ${d.severity} Danger allows`);
  return applyWound(sheet, { id: cost.woundId ?? `wound-${b.id}-${characterId}`, name: cost.woundName?.trim() || `${level} wound`, level, declaredMortal: mortal }).character;
}

// ---------- views ----------
export interface PublicBattle {
  id: string; status: BattleStatus; goal: string; battleDanger: string; framingParagraphId: string | null;
  lead: { characterId: string; actorId: string; skillName: string; want: string; risk: string; onTheLine: string | null; ready: boolean };
  contributions: { characterId: string; actorId: string; status: ContributionStatus; line: string; type: ContributionType | null; target: string | null; dangerRank: DangerRank | null; dangerText: string }[];
  waitingOn: string[];
  odds: { goal: string; dangers: { characterId: string; word: string }[] } | null;
  result: { goal: boolean; push: PushKind; dangers: { characterId: string; hit: boolean; withdrawn: boolean }[] } | null;
  push: { kind: 'standard'; waiting: string[]; answers: Record<string, 'withdraw' | 'stay'>; deadline: number } | null;
  beatsWritten: string[];
  /** The written beats, once the post is stitched; before that they are private to their writers' cards. */
  post: PostItem[] | null;
  concession: ConcessionKind | null;
  dice: BattleDiceView | null;
}

export function toPublicBattle(b: BattleCard): PublicBattle {
  const lead = b.lead;
  return {
    id: b.id, status: b.status, goal: b.goal, battleDanger: b.battleDanger, framingParagraphId: b.framingParagraphId,
    lead: { characterId: lead.characterId, actorId: lead.actorId, skillName: lead.skillName, want: lead.want, risk: lead.risk, onTheLine: lead.onTheLine, ready: !!(lead.skillName && lead.want.trim() && lead.risk.trim()) },
    contributions: b.contributions.map((c) => ({ characterId: c.characterId, actorId: c.actorId, status: c.status, line: c.line, type: c.type, target: c.target, dangerRank: c.dangerRank, dangerText: c.dangerText })),
    waitingOn: waitingOn(b),
    odds: b.set ? { goal: odds(b.set.lead).goal.word, dangers: b.set.dangers.map((d) => ({ characterId: d.characterId, word: odds({ ...b.set!.lead, danger: d.rank }).danger.word })) } : null,
    result: b.roll ? { goal: b.roll.goal, push: b.roll.push, dangers: b.roll.dangers.map((d) => ({ characterId: d.characterId, hit: d.hit, withdrawn: d.withdrawn })) } : null,
    push: b.push ? { kind: b.push.kind, waiting: active(b).filter((c) => !b.push!.answers[c.characterId]).map((c) => c.characterId), answers: b.push.answers, deadline: b.push.deadline } : null,
    beatsWritten: Object.keys(b.beats),
    post: b.stitched ? postOf(b) : null,
    concession: b.concession,
    dice: b.revealed && b.roll ? battleDiceView(b) : null,
  };
}

interface DieView { sides: number; value: number }
export interface BattleDiceView {
  attempt: { skill: DieView; backing?: DieView; difficulty: DieView; kept: number };
  second?: { skill: DieView; backing?: DieView; difficulty: DieView; kept: number };
  dangers: { characterId: string; rank: DangerRank; sides: number; value: number; recheck?: { rank: DangerRank; sides: number; value: number } }[];
}

/** The reveal view: the only place a battle's dice appear. */
export function battleDiceView(b: BattleCard): BattleDiceView {
  if (!b.roll || !b.set) return no('NOT_ROLLED', 'There are no dice yet');
  const r = b.roll;
  const bs = (s: { backing: string }) => (s.backing === 'core' ? 8 : s.backing === 'belief' ? 6 : null);
  const att = (a: BattleRoll['first'], s: SetBattle['lead']) => ({
    skill: { sides: skillDie(s.skill), value: a.skillDie },
    ...(a.backingDie !== null && bs(s) ? { backing: { sides: bs(s)!, value: a.backingDie } } : {}),
    difficulty: { sides: difficultyDie(s.difficulty), value: a.difficultyDie }, kept: a.kept,
  });
  return {
    attempt: att(r.first, b.set.lead),
    ...(r.second ? { second: att(r.second, r.set.lead) } : {}),
    dangers: r.dangers.map((d) => ({
      characterId: d.characterId, rank: d.first.rank, sides: dangerDie(d.first.rank), value: d.first.die,
      ...(d.recheck ? { recheck: { rank: d.recheck.rank, sides: dangerDie(d.recheck.rank), value: d.recheck.die } } : {}),
    })),
  };
}
