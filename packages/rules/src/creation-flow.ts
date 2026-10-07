// Session zero as pure functions (Rules v4 7; design plan 7). Every call takes a world and returns a new one,
// or throws a RuleViolation. The server only sequences these calls and saves; the UI never re-implements a check.
import { RuleViolation } from './errors';
import { RATED_SKILL_RANKS, skillIndex, type RatedSkillRank } from './ranks';
import { newCharacter, type BeliefKind, type Character, type GrantPick } from './character';
import { validateCreation, type CreationProblem } from './creation';

export interface CreationActor { id: string; role: 'gm' | 'player' }

export type CanonSource = { type: 'gm' } | { type: 'chapter'; characterId: string; index: number };
export interface CanonEntry { id: string; kind: 'worldFact'; text: string; authorId: string; source: CanonSource; community?: string }

export interface SkillProposal { id: string; by: string; accepts: string[]; skill: string; mode: 'new' | 'raise' }
export interface TraitProposal { id: string; by: string; accepts: string[]; trait: string }
export interface SkillApplied { by: GrantBy; name: string; mode: 'new' | 'raise'; fromRank: RatedSkillRank | null; toRank: RatedSkillRank }
export interface TraitApplied { by: GrantBy; text: string; traitId: string }
export type GrantBy = 'other-player' | 'majority' | 'gm';
export interface GrantSlot<P, A> { proposals: P[]; applied: A | null; reopened?: boolean }

export type ChapterOutput =
  | { kind: 'connection'; text: string; withCharacterId?: string }
  | { kind: 'resource'; text: string; raise: 'wealth' | 'network' }
  | { kind: 'thread'; text: string };

export interface ChapterState {
  index: number; paragraphId: string; summary: string; endsBadly: boolean; testedBelief: boolean;
  skill: GrantSlot<SkillProposal, SkillApplied>; trait: GrantSlot<TraitProposal, TraitApplied>;
  output: ChapterOutput | null; factId: string | null;
}
export interface OriginState { paragraphId: string | null; skill: string | null; connection: string | null }
export interface CreationState {
  status: 'creating' | 'ready'; veteran: boolean; origin: OriginState; chapters: ChapterState[];
  swapUsed: boolean; hookThreadId: string | null; burdenChosen: boolean; standingPrompts: string[];
}
export interface CrossingProposal {
  id: string; from: string; to: string; fromChapter: number; toChapter: number; paragraphId: string; touchesBelief: boolean;
  fromConnection: string; toConnection: string; thread?: string; status: 'pending' | 'confirmed' | 'declined';
}
export interface CheckOverride { gmId: string; characterId: string; reason: string; at: string; problems: CreationProblem[] }
export interface CreationWorld {
  phase: 'sessionZero' | 'playing';
  characters: Record<string, Character>;
  creation: Record<string, CreationState>;
  canon: CanonEntry[];
  proposals: CrossingProposal[];
  overrides: CheckOverride[];
  seq: number;
}

export const emptyWorld = (): CreationWorld => ({ phase: 'sessionZero', characters: {}, creation: {}, canon: [], proposals: [], overrides: [], seq: 0 });
const blankState = (status: CreationState['status']): CreationState => ({
  status, veteran: false, origin: { paragraphId: null, skill: null, connection: null }, chapters: [], swapUsed: false, hookThreadId: null, burdenChosen: false, standingPrompts: [],
});

const no = (code: string, message: string): never => { throw new RuleViolation(code, message); };
const text = (s: string | undefined, what: string): string => { const t = (s ?? '').trim(); return t || no('BAD_INPUT', `${what} cannot be blank`); };
const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---------- world plumbing ----------
type W = CreationWorld;
const nextId = (w: W, prefix: string): [W, string] => [{ ...w, seq: w.seq + 1 }, `${prefix}${w.seq + 1}`];
const charOf = (w: W, actor: CreationActor): Character => Object.values(w.characters).find((c) => c.ownerId === actor.id && !c.left) ?? no('NO_CHARACTER', 'You have no character here');
const sheetOf = (w: W, id: string): Character => w.characters[id] ?? no('NO_CHARACTER', 'No such character');
const stateOf = (w: W, id: string): CreationState => w.creation[id] ?? no('NO_CHARACTER', 'No such character');
const put = (w: W, c: Character, s?: CreationState): W => ({ ...w, characters: { ...w.characters, [c.id]: c }, creation: s ? { ...w.creation, [c.id]: s } : w.creation });
const players = (w: W) => Object.values(w.characters).filter((c) => c.ownerId && !c.left);

/** User ids of the other players at the table. */
export const othersOf = (w: W, characterId: string): string[] => players(w).filter((c) => c.id !== characterId).map((c) => c.ownerId!);
/** More than half of the other players. */
export const majorityOf = (others: number): number => Math.floor(others / 2) + 1;
export const canRoll = (w: W, characterId: string): boolean => w.creation[characterId]?.status !== 'creating';

function paragraphUsed(w: W, id: string): boolean {
  return Object.values(w.creation).some((s) => s.origin.paragraphId === id || s.chapters.some((c) => c.paragraphId === id)) || w.proposals.some((p) => p.paragraphId === id && p.status !== 'declined');
}
const claimParagraph = (w: W, id: string) => { text(id, 'The paragraph'); if (paragraphUsed(w, id)) no('PARAGRAPH_USED', 'That paragraph is already used for another step'); };

// ---------- joining ----------
export function addCreatingCharacter(w: W, p: { userId: string; name: string }): W {
  const id = `${p.userId}-pc`;
  if (w.characters[id]) return w;
  return put(w, { ...newCharacter(id, p.name), ownerId: p.userId }, blankState('creating'));
}
export function addReadyCharacter(w: W, c: Character): W {
  return put(w, c, blankState('ready'));
}

// ---------- step 0: the table's world fact ----------
export function setWorldFact(w: W, actor: CreationActor, t: string): W {
  if (actor.role !== 'gm') no('NOT_ALLOWED', 'Only the GM writes the world fact');
  const body = text(t, 'The world fact');
  const at = w.canon.findIndex((e) => e.source.type === 'gm');
  if (at >= 0) return { ...w, canon: w.canon.map((e, i) => (i === at ? { ...e, text: body } : e)) };
  const [w2, id] = nextId(w, 'canon-');
  return { ...w2, canon: [...w2.canon, { id, kind: 'worldFact', text: body, authorId: actor.id, source: { type: 'gm' } }] };
}

// ---------- step 1: origin ----------
export function postOrigin(w: W, actor: CreationActor, a: { paragraphId: string }): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  if (s.origin.paragraphId) no('ORIGIN_DONE', 'The Origin is already posted');
  claimParagraph(w, a.paragraphId);
  return put(w, c, { ...s, origin: { ...s.origin, paragraphId: a.paragraphId } });
}
export function pickOrigin(w: W, actor: CreationActor, a: { skill: string; connection: string }): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  if (s.origin.skill) no('ORIGIN_DONE', 'The Origin picks are already made');
  const skill = text(a.skill, 'The Skill'); const connection = text(a.connection, 'The Connection');
  const [w2, id] = nextId(w, 'conn-');
  const withSkill = c.skills.some((k) => eq(k.name, skill)) ? c.skills : [...c.skills, { name: skill, rank: 'Trained' as const }];
  return put(w2, { ...c, skills: withSkill, connections: [...c.connections, { id, text: connection }] }, { ...s, origin: { ...s.origin, skill, connection } });
}
export function setVeteran(w: W, actor: CreationActor, veteran: boolean): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  if (s.chapters.length) no('CHAPTERS_STARTED', 'Choose veteran before posting chapters');
  return put(w, c, { ...s, veteran });
}

// ---------- step 2: life chapters ----------
const emptySlot = <P, A>(): GrantSlot<P, A> => ({ proposals: [], applied: null });
export function postChapter(w: W, actor: CreationActor, a: { paragraphId: string; summary: string; endsBadly: boolean; testedBelief?: boolean }): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  if (!s.origin.paragraphId) no('ORIGIN_FIRST', 'Post the Origin first');
  const max = s.veteran ? 4 : 3;
  if (s.chapters.length >= max) no('CHAPTERS_FULL', `No more than ${max} chapters`);
  const summary = text(a.summary, 'The summary');
  if (summary.length > 140) no('BAD_INPUT', 'Keep the summary to one line');
  claimParagraph(w, a.paragraphId);
  const index = s.chapters.length;
  if (a.endsBadly) {
    if (s.chapters.some((x) => x.endsBadly)) no('BAD_CHAPTER_COUNT', 'Only one chapter ends badly');
    if (index < 1 || index > max - 2) no('BAD_CHAPTER_POSITION', 'The bad chapter is never the first or the most recent');
  }
  const ch: ChapterState = { index, paragraphId: a.paragraphId, summary, endsBadly: a.endsBadly, testedBelief: !!a.testedBelief, skill: emptySlot(), trait: emptySlot(), output: null, factId: null };
  return put(w, { ...c, chapters: [...c.chapters, { summary, endsBadly: a.endsBadly }] }, { ...s, chapters: [...s.chapters, ch] });
}

// ---------- grant cards ----------
type Part = 'skill' | 'trait';
function grantCtx(w: W, characterId: string, chapter: number) {
  const c = sheetOf(w, characterId); const s = stateOf(w, characterId);
  const ch = s.chapters[chapter] ?? no('NO_SUCH_CHAPTER', 'No such chapter');
  return { c, s, ch };
}
const asGrantor = (w: W, actor: CreationActor, characterId: string): number => {
  if (actor.role === 'gm') no('NOT_ALLOWED', 'Only the other players propose grants');
  const others = othersOf(w, characterId);
  if (!others.includes(actor.id)) no('NOT_ALLOWED', 'Only the other players propose grants');
  return others.length;
};
const setSlot = (s: CreationState, chapter: number, part: Part, slot: GrantSlot<never, never> | GrantSlot<SkillProposal, SkillApplied> | GrantSlot<TraitProposal, TraitApplied>): CreationState =>
  ({ ...s, chapters: s.chapters.map((x) => (x.index === chapter ? { ...x, [part]: slot } : x)) });

/** 'tied' once every other player has voted and nobody has a majority; the GM breaks it. */
export function slotState(slot: GrantSlot<{ accepts: string[] }, unknown>, others: number): 'applied' | 'open' | 'tied' {
  if (slot.applied) return 'applied';
  const voters = new Set(slot.proposals.flatMap((p) => p.accepts));
  if (slot.proposals.length >= 2 && voters.size >= others && !slot.proposals.some((p) => p.accepts.length >= majorityOf(others))) return 'tied';
  return 'open';
}

function applySkill(c: Character, p: { skill: string; mode: 'new' | 'raise' }, by: GrantBy): { c: Character; applied: SkillApplied } {
  const have = c.skills.find((k) => eq(k.name, p.skill));
  if (p.mode === 'raise') {
    if (!have) no('NO_SUCH_SKILL', 'There is no such Skill to raise');
    if (skillIndex(have!.rank) >= skillIndex('Expert')) no('SKILL_CAP', 'Starting Skills cap at Expert');
    const toRank = RATED_SKILL_RANKS[RATED_SKILL_RANKS.indexOf(have!.rank) + 1]!;
    return { c: { ...c, skills: c.skills.map((k) => (k === have ? { ...k, rank: toRank } : k)) }, applied: { by, name: have!.name, mode: 'raise', fromRank: have!.rank, toRank } };
  }
  if (have) no('SKILL_EXISTS', 'That Skill is already on the sheet');
  return { c: { ...c, skills: [...c.skills, { name: p.skill.trim(), rank: 'Trained' }] }, applied: { by, name: p.skill.trim(), mode: 'new', fromRank: null, toRank: 'Trained' } };
}
function checkSkillProposal(c: Character, skill: string, mode: 'new' | 'raise') { applySkill(c, { skill, mode }, 'gm'); }

function applyTrait(w: W, c: Character, chapter: ChapterState, t: string, by: GrantBy): { w: W; c: Character; applied: TraitApplied } {
  const [w2, id] = nextId(w, 'trait-');
  return { w: w2, c: { ...c, traits: [...c.traits, { id, text: t, harmful: chapter.endsBadly, source: { type: 'chapter', index: chapter.index } }] }, applied: { by, text: t, traitId: id } };
}

function commit(w: W, characterId: string, chapter: number, part: Part, slot: GrantSlot<SkillProposal, SkillApplied> & GrantSlot<TraitProposal, TraitApplied>, others: number, winner?: string, by?: GrantBy): W {
  const { c, s, ch } = grantCtx(w, characterId, chapter);
  const win = winner ? slot.proposals.find((p) => p.id === winner) : slot.proposals.find((p) => p.accepts.length >= majorityOf(others));
  if (!win) return put(w, c, setSlot(s, chapter, part, slot));
  const who: GrantBy = by ?? (others === 1 ? 'other-player' : 'majority');
  if (part === 'skill') {
    const r = applySkill(c, win as SkillProposal, who);
    return put(w, r.c, setSlot(s, chapter, part, { ...slot, applied: r.applied } as never));
  }
  const r = applyTrait(w, c, ch, (win as unknown as TraitProposal).trait, who);
  return put(r.w, r.c, setSlot(s, chapter, part, { ...slot, applied: r.applied } as never));
}

function propose(w: W, actor: CreationActor, characterId: string, chapter: number, part: Part, build: (id: string) => SkillProposal | TraitProposal): W {
  const others = asGrantor(w, actor, characterId);
  const { ch } = grantCtx(w, characterId, chapter);
  const slot = ch[part] as GrantSlot<SkillProposal | TraitProposal, unknown>;
  if (slot.applied) no('GRANT_APPLIED', 'That grant is already settled');
  const [w2, id] = nextId(w, 'gp-');
  const next = { ...slot, proposals: [...slot.proposals.filter((p) => !(p.by === actor.id && p.accepts.length === 1)).map((p) => ({ ...p, accepts: p.accepts.filter((u) => u !== actor.id) })).filter((p) => p.accepts.length), build(id)] };
  return commit(w2, characterId, chapter, part, next as never, others);
}

export function proposeSkill(w: W, actor: CreationActor, a: { characterId: string; chapter: number; skill: string; mode: 'new' | 'raise' }): W {
  asGrantor(w, actor, a.characterId);
  const { c, ch } = grantCtx(w, a.characterId, a.chapter);
  if (ch.skill.applied) no('GRANT_APPLIED', 'That grant is already settled');
  const skill = text(a.skill, 'The Skill');
  checkSkillProposal(c, skill, a.mode);
  return propose(w, actor, a.characterId, a.chapter, 'skill', (id) => ({ id, by: actor.id, accepts: [actor.id], skill, mode: a.mode }));
}
export function proposeTrait(w: W, actor: CreationActor, a: { characterId: string; chapter: number; trait: string }): W {
  asGrantor(w, actor, a.characterId);
  grantCtx(w, a.characterId, a.chapter);
  const trait = text(a.trait, 'The Trait');
  return propose(w, actor, a.characterId, a.chapter, 'trait', (id) => ({ id, by: actor.id, accepts: [actor.id], trait }));
}

export function acceptProposal(w: W, actor: CreationActor, a: { characterId: string; chapter: number; part: Part; proposalId: string }): W {
  const others = asGrantor(w, actor, a.characterId);
  const { ch } = grantCtx(w, a.characterId, a.chapter);
  const slot = ch[a.part] as GrantSlot<SkillProposal & TraitProposal, unknown>;
  if (slot.applied) no('GRANT_APPLIED', 'That grant is already settled');
  if (!slot.proposals.some((p) => p.id === a.proposalId)) no('NO_SUCH_PROPOSAL', 'No such proposal');
  // One vote per player: moving to another proposal withdraws the old vote (and an unsupported proposal falls away).
  const proposals = slot.proposals
    .map((p) => ({ ...p, accepts: p.id === a.proposalId ? [...new Set([...p.accepts, actor.id])] : p.accepts.filter((u) => u !== actor.id) }))
    .filter((p) => p.accepts.length);
  return commit(w, a.characterId, a.chapter, a.part, { ...slot, proposals } as never, others);
}

/** Take back your own vote on a grant (a mistaken proposal): a proposal nobody else backs falls away with it. */
export function withdrawVote(w: W, actor: CreationActor, a: { characterId: string; chapter: number; part: Part }): W {
  const others = asGrantor(w, actor, a.characterId);
  const { ch } = grantCtx(w, a.characterId, a.chapter);
  const slot = ch[a.part] as GrantSlot<SkillProposal & TraitProposal, unknown>;
  if (slot.applied) no('GRANT_APPLIED', 'That grant is already settled');
  if (!slot.proposals.some((p) => p.accepts.includes(actor.id))) no('NO_VOTE', 'You have no vote on this grant to withdraw');
  const proposals = slot.proposals.map((p) => ({ ...p, accepts: p.accepts.filter((u) => u !== actor.id) })).filter((p) => p.accepts.length);
  return commit(w, a.characterId, a.chapter, a.part, { ...slot, proposals } as never, others);
}

export function gmResolveGrant(w: W, actor: CreationActor, a: { characterId: string; chapter: number; part: Part; proposalId?: string; value?: string }): W {
  if (actor.role !== 'gm') no('NOT_ALLOWED', 'Only the GM resolves a grant');
  const { c, ch } = grantCtx(w, a.characterId, a.chapter);
  const slot = ch[a.part] as GrantSlot<SkillProposal & TraitProposal, unknown>;
  if (slot.applied) no('GRANT_APPLIED', 'That grant is already settled');
  const others = othersOf(w, a.characterId).length;
  if (a.proposalId) {
    if (!slot.proposals.some((p) => p.id === a.proposalId)) no('NO_SUCH_PROPOSAL', 'No such proposal');
    return commit(w, a.characterId, a.chapter, a.part, slot as never, others, a.proposalId, 'gm');
  }
  const value = text(a.value, 'The grant');
  const [w2, id] = nextId(w, 'gp-');
  const mode = a.part === 'skill' && c.skills.some((k) => eq(k.name, value)) ? 'raise' : 'new';
  const p = a.part === 'skill' ? ({ id, by: actor.id, accepts: [], skill: value, mode } as SkillProposal) : ({ id, by: actor.id, accepts: [], trait: value } as TraitProposal);
  return commit(w2, a.characterId, a.chapter, a.part, { ...slot, proposals: [...slot.proposals, p] } as never, others, id, 'gm');
}

/** One swap per character for the whole of creation: reopens a granted Skill or Trait for new proposals. */
export function swapGrant(w: W, actor: CreationActor, a: { chapter: number; part: Part }): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  if (s.swapUsed) no('SWAP_USED', 'The swap is already spent');
  const ch = s.chapters[a.chapter] ?? no('NO_SUCH_CHAPTER', 'No such chapter');
  const applied = ch[a.part].applied;
  if (!applied) no('NOTHING_TO_SWAP', 'That grant has not been applied');
  let sheet = c;
  if (a.part === 'skill') {
    const k = applied as SkillApplied;
    sheet = { ...c, skills: k.mode === 'new' ? c.skills.filter((x) => !eq(x.name, k.name)) : c.skills.map((x) => (eq(x.name, k.name) ? { ...x, rank: k.fromRank! } : x)) };
  } else sheet = { ...c, traits: c.traits.filter((t) => t.id !== (applied as TraitApplied).traitId) };
  return put(w, sheet, { ...setSlot(s, a.chapter, a.part, { proposals: [], applied: null, reopened: true }), swapUsed: true });
}

// ---------- chapter output ----------
export function chooseOutput(w: W, actor: CreationActor, a: { chapter: number; output: ChapterOutput }): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  const ch = s.chapters[a.chapter] ?? no('NO_SUCH_CHAPTER', 'No such chapter');
  if (ch.output) no('OUTPUT_CHOSEN', 'This chapter already has its output');
  const body = text(a.output.text, 'The output');
  if (ch.endsBadly && a.output.kind !== 'thread') no('BAD_CHAPTER_THREAD', 'The bad chapter must leave a Thread');
  const [w2, id] = nextId(w, 'out-');
  const pick: GrantPick = a.output.kind;
  let sheet: Character = { ...c, chapters: c.chapters.map((x, i) => (i === a.chapter ? { ...x, pick } : x)) };
  if (a.output.kind === 'connection') sheet = { ...sheet, connections: [...sheet.connections, { id, text: body, ...(a.output.withCharacterId ? { withCharacterId: a.output.withCharacterId } : {}) }] };
  else if (a.output.kind === 'thread') sheet = { ...sheet, threads: [...sheet.threads, { id, text: body, source: { type: 'chapter', index: a.chapter } }] };
  else {
    const k = a.output.raise === 'wealth' ? 'wealthRung' : 'networkRung';
    sheet = { ...sheet, [k]: Math.min(sheet[k] + 1, 4) };
  }
  return put(w2, sheet, { ...s, chapters: s.chapters.map((x) => (x.index === a.chapter ? { ...x, output: { ...a.output, text: body } } : x)) });
}

// ---------- world facts ----------
export function addWorldFact(w: W, actor: CreationActor, a: { chapter: number; text: string; community?: string }): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  const ch = s.chapters[a.chapter] ?? no('NO_SUCH_CHAPTER', 'No such chapter');
  if (ch.factId) no('FACT_EXISTS', 'This chapter already has its world fact');
  const body = text(a.text, 'The fact');
  const [w2, id] = nextId(w, 'canon-');
  const community = a.community?.trim();
  const entry: CanonEntry = { id, kind: 'worldFact', text: body, authorId: actor.id, source: { type: 'chapter', characterId: c.id, index: a.chapter }, ...(community ? { community } : {}) };
  const prompts = community && !s.standingPrompts.includes(community) ? [...s.standingPrompts, community] : s.standingPrompts;
  return { ...put(w2, c, { ...s, standingPrompts: prompts, chapters: s.chapters.map((x) => (x.index === a.chapter ? { ...x, factId: id } : x)) }), canon: [...w2.canon, entry] };
}

// ---------- crossings ----------
export function proposeCrossing(w: W, actor: CreationActor, a: { toCharacterId: string; fromChapter: number; toChapter: number; paragraphId: string; touchesBelief: boolean; fromConnection: string; toConnection: string; thread?: string }): W {
  const me = charOf(w, actor);
  if (a.toCharacterId === me.id) no('BAD_INPUT', 'Cross paths with someone else');
  const other = sheetOf(w, a.toCharacterId);
  const ms = stateOf(w, me.id); const os = stateOf(w, other.id);
  if (!ms.chapters[a.fromChapter] || !os.chapters[a.toChapter]) no('NO_SUCH_CHAPTER', 'No such chapter');
  if (me.crossings.length >= 2 || other.crossings.length >= 2) no('CROSSINGS_FULL', 'Two crossings each is the limit');
  claimParagraph(w, a.paragraphId);
  const fromConnection = text(a.fromConnection, 'The Connection'); const toConnection = text(a.toConnection, 'The Connection');
  const [w2, id] = nextId(w, 'x-');
  const thread = a.thread?.trim();
  return { ...w2, proposals: [...w2.proposals, { id, from: me.id, to: other.id, fromChapter: a.fromChapter, toChapter: a.toChapter, paragraphId: a.paragraphId, touchesBelief: a.touchesBelief, fromConnection, toConnection, ...(thread ? { thread } : {}), status: 'pending' }] };
}
function pending(w: W, actor: CreationActor, proposalId: string): CrossingProposal {
  const p = w.proposals.find((x) => x.id === proposalId) ?? no('NO_SUCH_PROPOSAL', 'No such proposal');
  if (p.status !== 'pending') no('BAD_STATE', 'That crossing is already settled');
  if (sheetOf(w, p.to).ownerId !== actor.id) no('NOT_ALLOWED', 'Only the other player answers a crossing');
  return p;
}
const setStatus = (w: CreationWorld, id: string, status: CrossingProposal['status']): W => ({ ...w, proposals: w.proposals.map((x) => (x.id === id ? { ...x, status } : x)) });
export function declineCrossing(w: W, actor: CreationActor, a: { proposalId: string }): W {
  const p = pending(w, actor, a.proposalId);
  return setStatus(w, p.id, 'declined');
}
export function confirmCrossing(w: W, actor: CreationActor, a: { proposalId: string }): W {
  const p = pending(w, actor, a.proposalId);
  const from = sheetOf(w, p.from); const to = sheetOf(w, p.to);
  if (from.crossings.length >= 2 || to.crossings.length >= 2) no('CROSSINGS_FULL', 'Two crossings each is the limit');
  let w2 = w;
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) { const [n, id] = nextId(w2, 'xc-'); w2 = n; ids.push(id); }
  const shared = (id: string) => (p.thread ? [{ id, text: p.thread, source: { type: 'crossing' as const } }] : []);
  const nf: Character = { ...from, connections: [...from.connections, { id: ids[0]!, text: p.fromConnection, withCharacterId: to.id }], threads: [...from.threads, ...shared(ids[2]!)], crossings: [...from.crossings, { withCharacterId: to.id, myChapter: p.fromChapter, theirChapter: p.toChapter, touchesBelief: p.touchesBelief }] };
  const nt: Character = { ...to, connections: [...to.connections, { id: ids[1]!, text: p.toConnection, withCharacterId: from.id }], threads: [...to.threads, ...shared(ids[3]!)], crossings: [...to.crossings, { withCharacterId: from.id, myChapter: p.toChapter, theirChapter: p.fromChapter, touchesBelief: p.touchesBelief }] };
  return setStatus(put(put(w2, nf), nt), p.id, 'confirmed');
}

// ---------- steps 5-8: capital, beliefs, instincts, hook ----------
const STANDING = ['Distrusted', 'Unknown', 'Known', 'Respected'];
export function setCapital(w: W, actor: CreationActor, a: { standing: Record<string, string>; possessions: { name: string; story: string }[] }): W {
  const c = charOf(w, actor);
  if (a.possessions.length > 3) no('TOO_MANY_POSSESSIONS', 'At most three significant possessions');
  for (const v of Object.values(a.standing)) if (!STANDING.includes(v)) no('BAD_INPUT', 'Standing is Distrusted, Unknown, Known or Respected');
  let w2 = w;
  const possessions = a.possessions.map((p) => { const [n, id] = nextId(w2, 'poss-'); w2 = n; return { id, name: text(p.name, 'The possession'), story: text(p.story, 'The possession\'s story') }; });
  return put(w2, { ...c, standing: a.standing as Character['standing'], possessions });
}
export function setBeliefs(w: W, actor: CreationActor, beliefs: { kind: BeliefKind; text: string }[]): W {
  const c = charOf(w, actor);
  if (beliefs.map((b) => b.kind).sort().join(',') !== 'objective,relationship,worldview') no('BAD_INPUT', 'Three Beliefs: an objective, a relationship and a worldview');
  return put(w, { ...c, beliefs: beliefs.map((b) => ({ id: `${c.id}-b-${b.kind}`, kind: b.kind, text: text(b.text, 'The Belief'), isCore: b.kind === 'worldview', convictionEarnedThisSession: false })) });
}
export function setInstincts(w: W, actor: CreationActor, instincts: string[]): W {
  const c = charOf(w, actor);
  if (instincts.length !== 3) no('BAD_INPUT', 'Three Instincts');
  return put(w, { ...c, instincts: instincts.map((t, i) => ({ id: `${c.id}-i-${i}`, text: text(t, 'The Instinct') })) });
}
export function chooseHook(w: W, actor: CreationActor, a: { threadId: string }): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  if (!c.threads.some((t) => t.id === a.threadId)) no('NO_SUCH_THREAD', 'Pick one of your own Threads');
  return put(w, c, { ...s, hookThreadId: a.threadId });
}
/** A bad chapter that tested a Belief lets the writer start play with one Burden on it. */
export function startingBurden(w: W, actor: CreationActor, a: { beliefId: string; name: string }): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  if (!s.chapters.some((x) => x.endsBadly && x.testedBelief)) no('NO_TESTED_BELIEF', 'Only a bad chapter that tested a Belief gives a starting Burden');
  if (s.burdenChosen) no('BURDEN_CHOSEN', 'The starting Burden is already chosen');
  if (!c.beliefs.some((b) => b.id === a.beliefId)) no('NO_SUCH_BELIEF', 'Set your Beliefs first, then pick one');
  const [w2, id] = nextId(w, 'burden-');
  return put(w2, { ...c, burdens: [...c.burdens, { id, beliefId: a.beliefId, name: text(a.name, 'The Burden'), about: '', status: 'active' }] }, { ...s, burdenChosen: true });
}

// ---------- the end-of-creation check and Begin play ----------
export function endCheck(w: W, characterId: string): { passed: boolean; problems: CreationProblem[] } {
  const c = sheetOf(w, characterId); const s = stateOf(w, characterId);
  const problems: CreationProblem[] = [];
  const bad = (code: string, message: string) => problems.push({ code, message });
  if (!s.origin.paragraphId) bad('ORIGIN_UNPOSTED', 'Post the Origin paragraph');
  if (!s.origin.skill || !s.origin.connection) bad('ORIGIN_PICKS', 'Pick the Origin Skill and Connection');
  problems.push(...validateCreation(c, { otherCharacters: Math.min(2, othersOf(w, characterId).length) }));
  for (const ch of s.chapters) {
    if (!ch.skill.applied || !ch.trait.applied) bad('GRANT_PENDING', `Chapter ${ch.index + 1} still waits on its Skill and Trait`);
    if (!ch.output) bad('OUTPUT_PENDING', `Chapter ${ch.index + 1} still needs its output`);
  }
  if (!s.hookThreadId || !c.threads.some((t) => t.id === s.hookThreadId)) bad('HOOK', 'Pick the Thread you start play with');
  return { passed: problems.length === 0, problems };
}
export function finishCreation(w: W, actor: CreationActor): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  if (s.status === 'ready') no('ALREADY_READY', 'This character is already ready');
  if (!endCheck(w, c.id).passed) no('CHECK_FAILED', 'The end-of-creation check has not passed');
  return put(w, c, { ...s, status: 'ready' });
}
export function overrideCheck(w: W, actor: CreationActor, a: { characterId: string; reason: string; at: string }): W {
  if (actor.role !== 'gm') no('NOT_ALLOWED', 'Only the GM overrides the check');
  const reason = text(a.reason, 'The reason');
  const s = stateOf(w, a.characterId);
  const problems = endCheck(w, a.characterId).problems;
  return { ...w, creation: { ...w.creation, [a.characterId]: { ...s, status: 'ready' } }, overrides: [...w.overrides, { gmId: actor.id, characterId: a.characterId, reason, at: a.at, problems }] };
}
export function beginPlay(w: W, actor: CreationActor): W {
  if (actor.role !== 'gm') no('NOT_ALLOWED', 'Only the GM begins play');
  if (w.phase === 'playing') no('ALREADY_PLAYING', 'Play has already begun');
  const present = players(w);
  if (!present.length || present.some((c) => w.creation[c.id]?.status !== 'ready')) no('NOT_READY', 'Every character must be ready first');
  return { ...w, phase: 'playing' };
}

// ---------- solo drafts ----------
export interface DraftChapter { paragraphId: string; summary: string; endsBadly: boolean; testedBelief?: boolean }
export interface Draft { veteran: boolean; origin: { paragraphId: string } | null; chapters: DraftChapter[] }
export function draftProblems(d: Draft): string[] {
  const out: string[] = [];
  if (!d.origin) out.push('Write the Origin and mark its paragraph');
  const n = d.chapters.length;
  if (d.veteran ? n !== 4 : n !== 3) out.push(d.veteran ? 'Four Life Chapters are needed for a veteran' : 'Three Life Chapters are needed (four for a veteran)');
  const bad = d.chapters.flatMap((c, i) => (c.endsBadly ? [i] : []));
  if (bad.length !== 1) out.push('Exactly one chapter must end badly');
  else if (bad[0]! < 1 || bad[0]! > n - 2) out.push('The chapter that ends badly is not the first or the most recent');
  if (d.chapters.some((c) => !c.summary.trim())) out.push('Every chapter needs a one-line summary');
  return out;
}
/** Post a finished draft into the shared story. `paragraphMap` maps each draft paragraph id to its new id in the shared story. */
export function importDraft(w: W, actor: CreationActor, d: Draft, paragraphMap: Record<string, string>): W {
  const c = charOf(w, actor); const s = stateOf(w, c.id);
  if (w.phase !== 'sessionZero') no('SESSION_ZERO_ONLY', 'Drafts are brought in during session zero');
  if (s.origin.paragraphId || s.chapters.length) no('ALREADY_STARTED', 'This character already has chapters posted');
  const problems = draftProblems(d);
  if (problems.length) no('DRAFT_INCOMPLETE', problems[0]!);
  const map = (id: string) => paragraphMap[id] ?? no('BAD_INPUT', 'A draft paragraph has no place in the story');
  const origin = map(d.origin!.paragraphId);
  const chapters = d.chapters.map((ch) => ({ ...ch, paragraphId: map(ch.paragraphId) }));
  let out = setVeteran(w, actor, d.veteran);
  out = postOrigin(out, actor, { paragraphId: origin });
  for (const ch of chapters) out = postChapter(out, actor, ch);
  return out;
}
