import {
  acceptProposal, addWorldFact, objectToPick, offerChapter, pickChapterGrants, beginPlay, chooseHook, chooseOutput, confirmCrossing, declineCrossing, finishCreation, gmResolveGrant, overrideCheck,
  pickOrigin, postChapter, postOrigin, proposeCrossing, proposeSkill, proposeTrait, withdrawVote, setBeliefs, setCapital, setInstincts, setVeteran, setWorldFact,
  startingBurden, swapGrant, type ChapterOutput, type CreationActor, type CreationWorld,
} from '@quillquest/rules';
import type { StoryDoc } from '@quillquest/story';
import type { Identity } from '../auth';
import { GameError } from './errors';

type Body = Record<string, unknown>;
export interface CreationCtx { story: StoryDoc; now: string }

const bad = (m: string): never => { throw new GameError(400, 'BAD_INPUT', m); };
/** A missing field in plain words for the person at the table ("paragraphId" is "the paragraph"). */
const WORDS: Record<string, string> = {
  paragraphId: 'a paragraph', summary: 'a one-line summary', text: 'a line of text', skill: 'a Skill', trait: 'a Trait', connection: 'a Connection',
  fromConnection: 'your Connection to them', toConnection: 'their Connection to you', toCharacterId: 'who to cross paths with', threadId: 'a Thread', beliefId: 'a Belief', name: 'a name', reason: 'a reason',
};
const missing = (k: string): string => `Fill in ${WORDS[k] ?? k.replace(/Id$/, '').replace(/([A-Z])/g, ' $1').toLowerCase()} first`;
const s = (b: Body, k: string): string => (typeof b[k] === 'string' && (b[k] as string).length ? (b[k] as string) : bad(missing(k)));
const os = (b: Body, k: string): string | undefined => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
const n = (b: Body, k: string): number => (Number.isInteger(b[k]) ? (b[k] as number) : bad(`${k} must be a whole number`));
const flag = (b: Body, k: string): boolean => b[k] === true;
const list = (b: Body, k: string): unknown[] => (Array.isArray(b[k]) ? (b[k] as unknown[]) : bad(`${k} must be a list`));
const obj = (v: unknown, name: string): Body => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Body) : bad(`${name} must be an object`));
const part = (b: Body): 'skill' | 'trait' => (b.part === 'skill' || b.part === 'trait' ? b.part : bad('part is skill or trait'));

/** Posting a paragraph means naming one of your own that is in the story. Nothing locks: locks belong to rolls. */
function ownParagraph(story: StoryDoc, id: string, userId: string): string {
  const p = story.find((x) => x.paragraphId === id);
  if (!p) throw new GameError(400, 'NO_SUCH_PARAGRAPH', 'That paragraph is not in the story');
  if (p.authorId !== userId) throw new GameError(400, 'NOT_YOUR_PARAGRAPH', 'Name a paragraph you wrote');
  return id;
}

function output(b: Body): ChapterOutput {
  const o = obj(b.output, 'output');
  const text = s(o, 'text');
  if (o.kind === 'connection') return { kind: 'connection', text, withCharacterId: os(o, 'withCharacterId') };
  if (o.kind === 'thread') return { kind: 'thread', text };
  if (o.kind === 'resource' && (o.raise === 'wealth' || o.raise === 'network')) return { kind: 'resource', text, raise: o.raise };
  return bad('output is a connection, a thread, or a resource that raises wealth or network');
}

const OBJECT_CHAR = '￼';
const proseOf = (p: StoryDoc[number]) => p.cells.map((c) => c.ch).filter((c) => c !== OBJECT_CHAR).join('');

type Handler = (w: CreationWorld, a: CreationActor, b: Body, ctx: CreationCtx, who: Identity) => CreationWorld;

/** Creation actions that name a paragraph of the story. */
export const PARAGRAPH_ACTIONS = new Set(['origin-post', 'chapter', 'crossing']);

export const ACTIONS: Record<string, Handler> = {
  'world-fact': (w, a, b) => setWorldFact(w, a, s(b, 'text')),
  veteran: (w, a, b) => setVeteran(w, a, flag(b, 'veteran')),
  'origin-post': (w, a, b, c, who) => postOrigin(w, a, { paragraphId: ownParagraph(c.story, s(b, 'paragraphId'), who.id) }),
  'origin-picks': (w, a, b) => pickOrigin(w, a, { skill: s(b, 'skill'), connection: s(b, 'connection') }),
  chapter: (w, a, b, c, who) => postChapter(w, a, { paragraphId: ownParagraph(c.story, s(b, 'paragraphId'), who.id), summary: s(b, 'summary'), endsBadly: flag(b, 'endsBadly'), testedBelief: flag(b, 'testedBelief') }),
  'propose-skill': (w, a, b) => proposeSkill(w, a, { characterId: s(b, 'characterId'), chapter: n(b, 'chapter'), skill: s(b, 'skill'), mode: b.mode === 'raise' ? 'raise' : 'new' }),
  'propose-trait': (w, a, b) => proposeTrait(w, a, { characterId: s(b, 'characterId'), chapter: n(b, 'chapter'), trait: s(b, 'trait') }),
  accept: (w, a, b) => acceptProposal(w, a, { characterId: s(b, 'characterId'), chapter: n(b, 'chapter'), part: part(b), proposalId: s(b, 'proposalId') }),
  withdraw: (w, a, b) => withdrawVote(w, a, { characterId: s(b, 'characterId'), chapter: n(b, 'chapter'), part: part(b) }),
  'gm-resolve': (w, a, b) => gmResolveGrant(w, a, { characterId: s(b, 'characterId'), chapter: n(b, 'chapter'), part: part(b), proposalId: os(b, 'proposalId'), value: os(b, 'value') }),
  'chapter-offer': (w, a, b, c, who) => {
    const chapter = n(b, 'chapter');
    const mine = Object.values(w.characters).find((x) => x.ownerId === who.id && !x.left);
    const para = mine ? c.story.find((x) => x.paragraphId === w.creation[mine.id]?.chapters[chapter]?.paragraphId) : undefined;
    const adapted = b.adapted === undefined ? undefined : { skills: list(obj(b.adapted, 'adapted'), 'skills').map(String), traits: list(obj(b.adapted, 'adapted'), 'traits').map(String) };
    return offerChapter(w, a, { chapter, prose: para ? proseOf(para) : '', adapted });
  },
  'chapter-pick': (w, a, b) => pickChapterGrants(w, a, {
    chapter: n(b, 'chapter'), skill: os(b, 'skill'), raise: flag(b, 'raise'), skillOwn: flag(b, 'skillOwn'), trait: os(b, 'trait'), traitOwn: flag(b, 'traitOwn'),
  }),
  'chapter-object': (w, a, b) => objectToPick(w, a, { characterId: s(b, 'characterId'), chapter: n(b, 'chapter'), part: part(b) }),
  swap: (w, a, b) => swapGrant(w, a, { chapter: n(b, 'chapter'), part: part(b) }),
  output: (w, a, b) => chooseOutput(w, a, { chapter: n(b, 'chapter'), output: output(b) }),
  fact: (w, a, b) => addWorldFact(w, a, { chapter: n(b, 'chapter'), text: s(b, 'text'), community: os(b, 'community') }),
  crossing: (w, a, b, c, who) => proposeCrossing(w, a, {
    toCharacterId: s(b, 'toCharacterId'), fromChapter: n(b, 'fromChapter'), toChapter: n(b, 'toChapter'), paragraphId: ownParagraph(c.story, s(b, 'paragraphId'), who.id),
    touchesBelief: flag(b, 'touchesBelief'), fromConnection: s(b, 'fromConnection'), toConnection: s(b, 'toConnection'), thread: os(b, 'thread'),
  }),
  'crossing-confirm': (w, a, b) => confirmCrossing(w, a, { proposalId: s(b, 'proposalId') }),
  'crossing-decline': (w, a, b) => declineCrossing(w, a, { proposalId: s(b, 'proposalId') }),
  capital: (w, a, b) => setCapital(w, a, {
    standing: Object.fromEntries(Object.entries(obj(b.standing ?? {}, 'standing')).map(([k, v]) => [k, String(v)])),
    possessions: list(b, 'possessions').map((p) => ({ name: String(obj(p, 'possession').name ?? ''), story: String((p as Body).story ?? '') })),
  }),
  beliefs: (w, a, b) => setBeliefs(w, a, list(b, 'beliefs').map((x) => { const o = obj(x, 'belief'); return { kind: o.kind as never, text: String(o.text ?? '') }; })),
  instincts: (w, a, b) => setInstincts(w, a, list(b, 'instincts').map(String)),
  hook: (w, a, b) => chooseHook(w, a, { threadId: s(b, 'threadId') }),
  burden: (w, a, b) => startingBurden(w, a, { beliefId: s(b, 'beliefId'), name: s(b, 'name') }),
  finish: (w, a) => finishCreation(w, a),
  override: (w, a, b, c) => overrideCheck(w, a, { characterId: s(b, 'characterId'), reason: s(b, 'reason'), at: c.now }),
  begin: (w, a) => beginPlay(w, a),
};
