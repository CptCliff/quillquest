import {
  awardDirect, awardNomination, declineNomination, editNpc, newNpc, nominate, publicNpc, revealField, startTableSession,
  type ConvictionReason, type DirectorWorld, type NpcField, type NominationKind, type Npc,
} from '@quillquest/rules';
import { buildRequest, kindsFor, parseAnswer, type Draft, type Input, type ParseContext, type SuggestionKind } from '@quillquest/prompts';
import type { StoryDoc } from '@quillquest/story';
import type { Identity } from '../auth';
import type { LlmProvider } from '../llm';
import { GameError } from './errors';
import type { DocPort, GameService } from './service';
import type { GameState } from './store';
import type { Suggestion, SuggestionLog, SuggestionStatus } from './suggestions';

const SCENE_WORDS = 3000;
const OBJECT_CHAR = '￼';
const CACHE_MS = 10 * 60_000;

const dworld = (s: GameState): DirectorWorld => ({ characters: s.characters, nominations: s.nominations, log: s.convictionLog, sessionNo: s.sessionNo, seq: s.dseq });
const adopt = (s: GameState, w: DirectorWorld) => { s.characters = w.characters; s.nominations = w.nominations; s.convictionLog = w.log; s.sessionNo = w.sessionNo; s.dseq = w.seq; };

const gmOnly = (a: Identity) => { if (a.role !== 'gm') throw new GameError(403, 'GM_ONLY', 'Only the GM can do that'); };
const textOf = (p: StoryDoc[number]) => p.cells.map((c) => c.ch).filter((c) => c !== OBJECT_CHAR).join('');
/** The last ~3,000 words of the story, as plain text. */
export function recentText(story: StoryDoc, words = SCENE_WORDS): string {
  const all = story.map(textOf).join('\n').split(/\s+/).filter(Boolean);
  return all.slice(-words).join(' ');
}
const body = (b: Record<string, unknown>, k: string): string => (typeof b[k] === 'string' && (b[k] as string).trim() ? (b[k] as string) : (() => { throw new GameError(400, 'BAD_INPUT', `${k} is required`); })());

export interface DirectorDeps { llm: LlmProvider | null; log: SuggestionLog; docs: DocPort; now?: () => Date }
export interface AskResult { suggestion: { id: string; kind: SuggestionKind; draft: Draft; cached?: boolean }; remaining: number }

/** The GM's tools and the Claude assistant. Hidden NPC fields and the GM's data never leave this service except to the GM. */
export class DirectorService {
  private cache = new Map<string, { at: number; id: string; draft: Draft }>();
  constructor(private game: GameService, private d: DirectorDeps) {}

  private at() { return (this.d.now?.() ?? new Date()).toISOString(); }

  // ---- the GM's overview ---------------------------------------------------------------------------------------------

  overview(campaign: string, actor: Identity) {
    gmOnly(actor);
    return this.game.read(campaign, actor, async (s) => ({
      nominations: s.nominations, npcs: Object.values(s.npcs),
      settings: { themes: s.themes, faces: s.faces, cap: s.llmCap, sessionNo: s.sessionNo, used: await this.d.log.count(campaign, s.sessionNo), configured: this.d.llm !== null },
    }));
  }

  setSettings(campaign: string, actor: Identity, patch: { themes?: string; faces?: string[]; cap?: number }) {
    gmOnly(actor);
    return this.game.mutate(campaign, actor, (s) => {
      if (patch.themes !== undefined) { if (patch.themes.length > 500) throw new GameError(400, 'BAD_INPUT', 'Keep the themes under 500 characters'); s.themes = patch.themes.trim(); }
      if (patch.faces !== undefined) {
        if (patch.faces.length !== 0 && (patch.faces.length !== 6 || patch.faces.some((f) => !f.trim() || f.length > 100))) throw new GameError(400, 'BAD_INPUT', 'The Burden faces are six short lines (or none)');
        s.faces = patch.faces.map((f) => f.trim());
      }
      if (patch.cap !== undefined) { if (!Number.isInteger(patch.cap) || patch.cap < 0 || patch.cap > 500) throw new GameError(400, 'BAD_INPUT', 'The cap is a whole number from 0 to 500'); s.llmCap = patch.cap; }
      return { themes: s.themes, faces: s.faces, cap: s.llmCap };
    });
  }

  startSession(campaign: string, actor: Identity) {
    gmOnly(actor);
    return this.game.mutate(campaign, actor, (s) => { adopt(s, startTableSession(dworld(s))); return { sessionNo: s.sessionNo }; });
  }

  // ---- Conviction ------------------------------------------------------------------------------------------------------

  nominate(campaign: string, actor: Identity, b: { characterId: string; kind: NominationKind; beliefId?: string; note: string }) {
    if (actor.role === 'gm') throw new GameError(403, 'NOT_ALLOWED', 'Players nominate; the GM awards');
    return this.game.mutate(campaign, actor, (s) => { adopt(s, nominate(dworld(s), actor.id, b)); return { nominations: s.nominations.filter((n) => n.nominatedBy === actor.id) }; });
  }
  awardNomination(campaign: string, actor: Identity, nominationId: string) {
    gmOnly(actor);
    return this.game.mutate(campaign, actor, (s) => { adopt(s, awardNomination(dworld(s), actor.id, nominationId, this.at())); return { conviction: s.convictionLog.length }; });
  }
  declineNomination(campaign: string, actor: Identity, nominationId: string) {
    gmOnly(actor);
    return this.game.mutate(campaign, actor, (s) => { adopt(s, declineNomination(dworld(s), nominationId)); return { declined: true }; });
  }
  awardDirect(campaign: string, actor: Identity, a: { characterId: string; reason: ConvictionReason }) {
    gmOnly(actor);
    return this.game.mutate(campaign, actor, (s) => { adopt(s, awardDirect(dworld(s), actor.id, a, this.at())); return { conviction: s.characters[a.characterId]!.conviction }; });
  }

  // ---- NPCs ------------------------------------------------------------------------------------------------------------

  private npc(s: GameState, id: string): Npc {
    const n = s.npcs[id];
    if (!n) throw new GameError(404, 'NO_NPC', 'No such NPC');
    return n;
  }
  createNpc(campaign: string, actor: Identity, a: { name: string }) {
    gmOnly(actor);
    return this.game.mutate(campaign, actor, (s) => { const n = newNpc(`npc-${++s.dseq}`, a.name); s.npcs[n.id] = n; return n; });
  }
  editNpc(campaign: string, actor: Identity, id: string, patch: Parameters<typeof editNpc>[1]) {
    gmOnly(actor);
    return this.game.mutate(campaign, actor, (s) => (s.npcs[id] = editNpc(this.npc(s, id), patch)));
  }
  revealNpcField(campaign: string, actor: Identity, id: string, field: NpcField) {
    gmOnly(actor);
    return this.game.mutate(campaign, actor, (s) => (s.npcs[id] = revealField(this.npc(s, id), field)));
  }

  // ---- the Claude assistant --------------------------------------------------------------------------------------------

  /**
   * One request to the model. The role gate comes first; then the per-session cap; then a prompt built only from what this kind may see;
   * then the answer is parsed strictly (one retry), logged as a Suggestion, and returned as a draft. Nothing here changes the game.
   */
  async ask(campaign: string, actor: Identity, kind: SuggestionKind, params: Record<string, unknown>): Promise<AskResult> {
    if (!kindsFor(actor.role).includes(kind)) throw new GameError(403, 'NOT_ALLOWED', 'That request is not available to you');
    if (!this.d.llm) throw new GameError(501, 'NOT_CONFIGURED', 'The Claude assistant is not set up on this server');
    const prepared = await this.game.read(campaign, actor, async (s) => ({
      input: await this.inputFor(campaign, actor, kind, params, s), parse: this.parseContext(kind, actor, s), sessionNo: s.sessionNo, cap: s.llmCap,
    }));
    const key = kind === 'skillMatch' ? `${campaign}|${actor.id}|${(prepared.input as { sentence: string }).sentence}|${(prepared.parse.skills ?? []).join(',')}` : null;
    const hit = key ? this.cache.get(key) : undefined;
    if (hit && Date.now() - hit.at < CACHE_MS) return { suggestion: { id: hit.id, kind, draft: hit.draft, cached: true }, remaining: Math.max(prepared.cap - (await this.d.log.count(campaign, prepared.sessionNo)), 0) };

    const used = await this.d.log.count(campaign, prepared.sessionNo);
    if (used >= prepared.cap) throw new GameError(429, 'CAP_REACHED', 'This session\'s Claude limit has been reached. The GM can raise it in the Director tab.');
    const request = buildRequest(prepared.input, actor.role);
    const log = (output: unknown, status?: SuggestionStatus) => this.d.log.add({ campaignId: campaign, userId: actor.id, kind, input: prepared.input, output, sessionNo: prepared.sessionNo, provider: this.d.llm!.name, status });

    let last = 'The answer was not usable';
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try { text = (await this.d.llm.complete(request)).text; } catch (e) {
        await log({ error: e instanceof Error ? e.message : 'failed' }, 'failed');
        throw new GameError(502, 'LLM_UNAVAILABLE', 'The Claude assistant could not be reached. Try again in a moment.');
      }
      const parsed = parseAnswer(kind, text, prepared.parse);
      if (parsed.ok) {
        const row = await log(parsed.draft);
        if (key) this.cache.set(key, { at: Date.now(), id: row.id, draft: parsed.draft });
        return { suggestion: { id: row.id, kind, draft: parsed.draft }, remaining: Math.max(prepared.cap - used - 1, 0) };
      }
      last = parsed.error;
    }
    await log({ error: last }, 'failed');
    throw new GameError(502, 'BAD_ANSWER', 'The assistant gave an answer the game could not use. Try again.');
  }

  private parseContext(kind: SuggestionKind, actor: Identity, s: GameState): ParseContext {
    if (kind === 'skillMatch') return { skills: this.mySkills(s, actor.id) };
    if (kind === 'oracle') return { faces: 6 };
    return {};
  }
  private mySkills(s: GameState, userId: string): string[] {
    return (s.characters[s.characterOf[userId] ?? '']?.skills ?? []).map((k) => k.name);
  }

  /** Builds one kind's input from the server's own records. Player kinds read nothing the table cannot already see. */
  private async inputFor(campaign: string, actor: Identity, kind: SuggestionKind, params: Record<string, unknown>, s: GameState): Promise<Input> {
    const themes = s.themes;
    switch (kind) {
      case 'skillMatch': {
        if (actor.role === 'gm') throw new GameError(403, 'GM_HAS_NO_CHARACTER', 'Skill matching is for a player\'s own character');
        const sentence = body(params, 'sentence').slice(0, 400);
        return { kind, themes, sentence, skills: this.mySkills(s, actor.id) };
      }
      case 'beliefCheck':
        return { kind, themes, belief: { kind: body(params, 'kind'), text: body(params, 'text').slice(0, 400) } };
      case 'grant': {
        const characterId = body(params, 'characterId');
        const chapter = Number(params.chapter);
        const st = s.creation[characterId]?.chapters[chapter];
        if (!st) throw new GameError(404, 'NO_SUCH_CHAPTER', 'No such chapter');
        const others = Object.values(s.characters).filter((c) => c.ownerId && !c.left && c.id !== characterId).map((c) => c.ownerId);
        if (!others.includes(actor.id)) throw new GameError(403, 'NOT_ALLOWED', 'Only the other players suggest grants');
        const story = await this.d.docs.story(campaign);
        const para = story.find((p) => p.paragraphId === st.paragraphId);
        return { kind, themes, chapterProse: para ? textOf(para).slice(0, 4000) : st.summary, endsBadly: st.endsBadly };
      }
      case 'beliefChallenge': {
        const c = s.characters[body(params, 'characterId')];
        if (!c) throw new GameError(404, 'NO_CHARACTER', 'No such character');
        const beliefs = typeof params.beliefId === 'string' ? c.beliefs.filter((b) => b.id === params.beliefId) : c.beliefs;
        if (!beliefs.length) throw new GameError(404, 'NO_SUCH_BELIEF', 'No such Belief');
        return { kind, themes, scene: recentText(await this.d.docs.story(campaign)), canon: s.canon.map((e) => e.text),
          character: { name: c.name, beliefs: beliefs.map((b) => ({ text: b.text, isCore: b.isCore })), burdens: c.burdens.filter((b) => b.status === 'active').map((b) => b.name) } };
      }
      case 'danger': {
        const card = s.cards[body(params, 'cardId')];
        if (!card) throw new GameError(404, 'NO_CARD', 'No such card');
        const belief = card.onTheLine ? s.characters[card.characterId]?.beliefs.find((b) => b.id === card.onTheLine)?.text ?? null : null;
        return { kind, themes, scene: recentText(await this.d.docs.story(campaign)), card: { want: card.want, risk: card.risk, onTheLine: belief } };
      }
      case 'npcLine': {
        const n = this.npc(s, body(params, 'npcId'));
        return { kind, themes, scene: recentText(await this.d.docs.story(campaign)), npc: { name: n.name, skills: n.skills.map((k) => `${k.name} ${k.rank}`), beliefs: n.beliefs, notes: n.notes } };
      }
      case 'oracle':
        if (s.faces.length !== 6) throw new GameError(409, 'NO_FACES', 'Write the campaign\'s six Burden faces in the Director settings first');
        return { kind, themes, scene: recentText(await this.d.docs.story(campaign)), faces: s.faces };
    }
  }

  /** The GM sees every suggestion; a player sees only their own. */
  listSuggestions(campaign: string, actor: Identity): Promise<Suggestion[]> {
    return this.d.log.list(campaign, actor.role === 'gm' ? {} : { userId: actor.id });
  }
  async setSuggestionStatus(campaign: string, actor: Identity, id: string, status: SuggestionStatus): Promise<void> {
    if (!['used', 'edited', 'dismissed'].includes(status)) throw new GameError(400, 'BAD_INPUT', 'status is used, edited or dismissed');
    const mine = (await this.listSuggestions(campaign, actor)).some((x) => x.id === id);
    if (!mine || !(await this.d.log.setStatus(campaign, id, status))) throw new GameError(404, 'NOT_FOUND', 'No such suggestion');
  }
}
