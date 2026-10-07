import {
  RuleViolation, forcedNext, joinSpotlight, leaveSpotlight, passSpotlight, takeSpotlight, toPublicBattle, publicNpc, addCreatingCharacter, addReadyCharacter, applyCosts, canRoll, draftProblems, endCheck, importDraft, classifyCard, closeSet as flowCloseSet, concede, diceView, editCard, expandShifts, layDownBurden,
  markWritten, outcomePrompt, previewCard, pushCard, pushOptions, reopenForRetcon, resolveSkill, revertCosts, rollCard, suggestShifts, toPublicCard,
  newCard, type BurdenOutcome, type CardPatch, type Character, type ConcessionKind, type CostInput, type DiceView, type FlowActor,
  type CanonEntry, type PublicBattle, type ConvictionLogEntry, type CreationState, type PublicNpc, type CreationWorld, type Draft, type OutcomePrompt, type PromptCard, type PublicCard, type ShiftCandidate,
} from '@quillquest/rules';
import { lockThrough, type StoryDoc } from '@quillquest/story';
import type { Identity } from '../auth';
import type { DiceProvider } from './dice';
import { GameError } from './errors';
import { link } from '../notify/links';
import type { Notice } from '../notify/notifier';
import { ACTIONS, PARAGRAPH_ACTIONS } from './creation';
import { draftName } from './docnames';
import { seedDevCharacter } from './dev-characters';
import type { GameState, GameStore } from './store';

/** The campaign document, as the game sees it. The Hocuspocus version writes to the live Yjs doc; tests use a fake. */
export interface DocPort {
  story(campaign: string): Promise<StoryDoc>;
  setLocked(campaign: string, paragraphIds: string[], locked: boolean): Promise<void>;
  /** Adds paragraphs to the end of the shared story, each authored by the person given, and returns their new ids. */
  appendParagraphs(campaign: string, items: { authorId: string; text: string }[]): Promise<string[]>;
  /** Writes the public projection: ledger entries (no dice), the open-table character sheets, and session-zero progress. */
  publish(campaign: string, projection: Projection): Promise<void>;
  /** A player's private solo draft, read for import. */
  draft(campaign: string, userId: string): Promise<StoryDoc>;
  /** Copies the whole draft to the end of the shared story as the player's own paragraphs, under the new ids in `map`. */
  copyDraft(campaign: string, userId: string, map: Record<string, string>): Promise<void>;
}

export interface Projection {
  ledger: Record<string, LedgerEntry>;
  characters: Record<string, Character>;
  creation: Record<string, CreationState>;
  canon: Record<string, CanonEntry>;
  /** Only what the GM has revealed of each NPC. */
  npcs: Record<string, PublicNpc>;
  convictionLog: Record<string, ConvictionLogEntry>;
  battles: Record<string, PublicBattle>;
  campaign: { phase: GameState['phase']; crossings: GameState['proposals']; overrides: GameState['checkOverrides']; themes: string; spotlight: { holder: string | null; players: string[]; due: string | null } };
}

export type LedgerEntry = PublicCard & { seq: number };

/** Tells someone the story is waiting on them (queued; the notifier decides whether and when to email). Never throws into a game action. */
export type NotifyFn = (campaign: string, userId: string, n: Notice) => void;
export interface GameDeps {
  store: GameStore; dice: DiceProvider; docs: DocPort; now?: () => Date;
  notify?: NotifyFn;
  /** The campaign's GM, when the game state has not yet seen them act. */
  gmOf?: (campaign: string) => Promise<string | null>;
}

export interface CreateCardInput {
  anchorParagraphId?: string | null;
  skillName: string;
  want?: string; risk?: string;
  onTheLine?: string | null; dangerTargetId?: string | null; backingBeliefId?: string | null;
}

/** The patch a client may send: the Skill is named, never rated; the sheet decides the rank. */
export type ClientPatch = Omit<CardPatch, 'skill'> & { skillName?: string };

export interface WrittenInput extends CostInput { outcomeParagraphId: string }

const world = (s: GameState): CreationWorld => ({ phase: s.phase, characters: s.characters, creation: s.creation, canon: s.canon, proposals: s.proposals, overrides: s.checkOverrides, seq: s.wseq });
const adopt = (s: GameState, w: CreationWorld) => {
  s.phase = w.phase; s.characters = w.characters; s.creation = w.creation; s.canon = w.canon; s.proposals = w.proposals; s.checkOverrides = w.overrides; s.wseq = w.seq;
};

const asFlow = (i: Identity): FlowActor => ({ id: i.id, role: i.role });

export class GameService {
  private chains = new Map<string, Promise<unknown>>();
  constructor(private d: GameDeps) {}

  /** One mutation at a time per campaign; a failure leaves nothing behind (state is cloned and only saved on success). */
  async mutate<T>(campaign: string, actor: Identity, fn: (s: GameState) => Promise<T> | T): Promise<T> {
    const prev = this.chains.get(campaign) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(async () => {
      const state = await this.d.store.load(campaign);
      this.prepare(state, actor);
      const out = await fn(state);
      await this.d.store.save(campaign, state);
      await this.publish(campaign, state);
      return out;
    });
    this.chains.set(campaign, next);
    return next;
  }

  async read<T>(campaign: string, actor: Identity, fn: (s: GameState) => Promise<T> | T): Promise<T> {
    const prev = this.chains.get(campaign) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(async () => {
      const state = await this.d.store.load(campaign);
      this.prepare(state, actor);
      return fn(state);
    });
    this.chains.set(campaign, next);
    return next;
  }

  /** Before any action: the actor has a character, the GM is known, and the spotlight lists exactly the players at the table. */
  private prepare(s: GameState, actor: Identity) {
    this.ensureCharacter(s, actor);
    if (actor.role === 'gm' && actor.id !== 'system') s.gmId = actor.id;
    let sp = s.spotlight;
    for (const c of Object.values(s.characters)) {
      if (!c.ownerId) continue;
      sp = c.left ? leaveSpotlight(sp, c.ownerId) : joinSpotlight(sp, c.ownerId);
    }
    s.spotlight = sp;
  }

  /** The campaign's GM: the one the game has seen act, or whoever the directory says. */
  async gmId(campaign: string, s?: GameState): Promise<string | null> {
    return s?.gmId ?? (await this.d.gmOf?.(campaign)) ?? null;
  }

  /** Every campaign with saved game state (for periodic jobs). */
  campaigns(): Promise<string[]> { return this.d.store.campaigns(); }
  /** A short signature of a battle's declarations, so a re-declaration after a change can notify the GM again. */
  sig(b: { contributions: { characterId: string; status: string; line: string }[] }): string {
    return b.contributions.map((c) => `${c.characterId}:${c.status}:${c.line.length}`).join('|');
  }

  /** Queue a message for someone. Fire and forget: a mail problem must never break a game action. */
  tell(campaign: string, userId: string | null | undefined, n: Notice) {
    if (!userId || !this.d.notify) return;
    try { this.d.notify(campaign, userId, n); } catch { /* notifications are best effort */ }
  }
  async tellGm(campaign: string, s: GameState, n: Notice) { this.tell(campaign, await this.gmId(campaign, s), n); }

  /** Every player has a character from their first visit: a blank one in creation, or (preset dev users only) a ready-made sheet. */
  private ensureCharacter(s: GameState, actor: Identity) {
    if (actor.role === 'gm' || s.characterOf[actor.id]) return;
    const preset = seedDevCharacter(actor.id);
    const w = preset ? addReadyCharacter(world(s), preset) : addCreatingCharacter(world(s), { userId: actor.id, name: actor.name });
    adopt(s, w);
    s.characterOf[actor.id] = `${actor.id}-pc`;
  }

  private card(s: GameState, id: string): PromptCard {
    const c = s.cards[id];
    if (!c) throw new GameError(404, 'NO_CARD', 'No such card');
    return c;
  }
  private mustBeReady(s: GameState, characterId: string) {
    if (!canRoll(world(s), characterId)) throw new GameError(409, 'NOT_READY', 'Finish creating your character first (or ask the GM to override the check)');
  }
  private sheet(s: GameState, characterId: string): Character {
    const c = s.characters[characterId];
    if (!c) throw new GameError(404, 'NO_CHARACTER', 'No such character');
    return c;
  }

  async publish(campaign: string, state?: GameState) {
    const s = state ?? (await this.d.store.load(campaign));
    const ledger: Record<string, LedgerEntry> = {};
    s.order.forEach((id, i) => { ledger[id] = { ...toPublicCard(s.cards[id]!), seq: i }; });
    await this.d.docs.publish(campaign, {
      ledger, characters: s.characters, creation: s.creation,
      canon: Object.fromEntries(s.canon.map((e) => [e.id, e])),
      npcs: Object.fromEntries(Object.values(s.npcs).flatMap((n) => { const p = publicNpc(n); return p ? [[n.id, p]] : []; })),
      convictionLog: Object.fromEntries(s.convictionLog.map((e) => [e.id, e])),
      battles: Object.fromEntries(Object.values(s.battles).map((b) => [b.id, toPublicBattle(b)])),
      campaign: { phase: s.phase, crossings: s.proposals, overrides: s.checkOverrides, themes: s.themes, spotlight: { holder: s.spotlight.holder, players: s.spotlight.players, due: forcedNext(s.spotlight) } },
    });
  }

  // ---- cards ------------------------------------------------------------------------------------------------------

  createCard(campaign: string, actor: Identity, input: CreateCardInput): Promise<PublicCard> {
    return this.mutate(campaign, actor, async (s) => {
      if (actor.role === 'gm') throw new GameError(403, 'GM_HAS_NO_CHARACTER', 'Cards are opened by the acting player');
      const sheet = this.sheet(s, s.characterOf[actor.id]!);
      if (input.anchorParagraphId) {
        const story = await this.d.docs.story(campaign);
        if (!story.some((p) => p.paragraphId === input.anchorParagraphId)) throw new GameError(400, 'NO_SUCH_PARAGRAPH', 'That paragraph is not in the story');
      }
      const id = `c${++s.seq}`;
      let card = newCard({ id, actorId: actor.id, characterId: sheet.id, anchorParagraphId: input.anchorParagraphId ?? null, skill: resolveSkill(sheet, input.skillName) });
      card = editCard(card, asFlow(actor), {
        want: input.want, risk: input.risk, onTheLine: input.onTheLine ?? null, dangerTargetId: this.target(s, input.dangerTargetId), backingBeliefId: input.backingBeliefId ?? null,
      }, sheet);
      s.cards[id] = card;
      s.order.push(id);
      await this.watchBig(campaign, s, card);
      return toPublicCard(card);
    });
  }

  /** A big card whose Want and Risk are filled is ready for the GM to Set: tell them once, and remember since when it has waited. */
  private async watchBig(campaign: string, s: GameState, card: PromptCard) {
    const key = `card:${card.id}`;
    if (card.speed !== 'big' || card.status !== 'draft' || !card.want.trim() || !card.risk.trim() || s.waits[key]) return;
    s.waits[key] = (this.d.now?.() ?? new Date()).getTime();
    await this.tellGm(campaign, s, { kind: 'set', text: `${s.characters[card.characterId]?.name ?? 'A player'}'s ${card.skillName} roll is ready for you to Set.`, link: link.card(campaign, card.id), dedupeKey: `set:${card.id}` });
  }

  /** A Danger that landed on someone else's character is theirs to write. */
  private costNotice(campaign: string, s: GameState, card: PromptCard) {
    if (!card.roll?.dangerHit || !card.dangerTargetId || card.dangerTargetId === card.characterId) return;
    const target = s.characters[card.dangerTargetId];
    this.tell(campaign, target?.ownerId, { kind: 'cost', text: `A Danger from ${s.characters[card.characterId]?.name ?? 'someone'}'s roll landed on ${target?.name}: write your cost.`, link: link.card(campaign, card.id), dedupeKey: `cost:${card.id}:${card.roll.push}` });
  }

  private target(s: GameState, id: string | null | undefined): string | null {
    if (id == null) return null;
    if (!s.characters[id]) throw new GameError(400, 'NO_SUCH_CHARACTER', 'That character is not in this campaign');
    return id;
  }

  editCard(campaign: string, actor: Identity, cardId: string, patch: ClientPatch): Promise<PublicCard> {
    return this.mutate(campaign, actor, (s) => {
      const card = this.card(s, cardId);
      const sheet = this.sheet(s, card.characterId);
      const { skillName, ...rest } = patch;
      const flowPatch: CardPatch = { ...rest };
      if (skillName !== undefined) flowPatch.skill = resolveSkill(sheet, skillName);
      if (flowPatch.dangerTargetId !== undefined) flowPatch.dangerTargetId = this.target(s, flowPatch.dangerTargetId);
      const next = editCard(card, asFlow(actor), flowPatch, sheet);
      s.cards[cardId] = next;
      return this.watchBig(campaign, s, next).then(() => toPublicCard(next));
    });
  }

  /** Odds in words and the problems that stop Set, plus the shifts this character could claim. No dice, no numbers. */
  preview(campaign: string, actor: Identity, cardId: string): Promise<{ problems: string[]; odds: { goal: string; danger: string } | null; candidates: Pick<ShiftCandidate, 'key' | 'label'>[] }> {
    return this.read(campaign, actor, (s) => {
      const card = this.card(s, cardId);
      const sheet = this.sheet(s, card.characterId);
      const p = previewCard(card, sheet);
      return {
        problems: p.problems,
        odds: p.odds ? { goal: p.odds.goal.word, danger: p.odds.danger.word } : null,
        candidates: suggestShifts(sheet, { threat: card.threat, danger: card.danger }).map(({ key, label }) => ({ key, label })),
      };
    });
  }

  closeSet(campaign: string, actor: Identity, cardId: string): Promise<PublicCard> {
    return this.mutate(campaign, actor, (s) => {
      const card = this.card(s, cardId);
      const next = flowCloseSet(card, asFlow(actor), this.sheet(s, card.characterId));
      s.cards[cardId] = next;
      delete s.waits[`card:${cardId}`];
      return toPublicCard(next);
    });
  }

  /** A quick draft is Set and rolled in one tap by its writer. A big card must be Set by the GM first, so the player can still concede. */
  roll(campaign: string, actor: Identity, cardId: string): Promise<PublicCard> {
    return this.mutate(campaign, actor, (s) => {
      let card = this.card(s, cardId);
      const sheet = this.sheet(s, card.characterId);
      // Ownership first: someone else's card is not theirs to roll, and they shouldn't learn its state either way.
      if (actor.role !== 'gm' && actor.id !== card.actorId) throw new GameError(403, 'NOT_ALLOWED', 'That is not your card');
      this.mustBeReady(s, card.characterId);
      if (card.status === 'draft') {
        if (classifyCard(card) === 'big' || actor.id !== card.actorId)
          throw new GameError(409, 'NOT_SET', 'The card must be Set before it is rolled');
        card = flowCloseSet(card, asFlow(actor), sheet);
      }
      const next = rollCard(card, asFlow(actor), this.d.dice.forCampaign(campaign));
      s.cards[cardId] = next;
      delete s.waits[`card:${cardId}`];
      this.costNotice(campaign, s, next);
      return toPublicCard(next);
    });
  }

  push(campaign: string, actor: Identity, cardId: string, kind: 'standard' | 'conviction'): Promise<PublicCard> {
    return this.mutate(campaign, actor, (s) => {
      const card = this.card(s, cardId);
      const sheet = this.sheet(s, card.characterId);
      this.mustBeReady(s, card.characterId);
      if (!['standard', 'conviction'].includes(kind)) throw new GameError(400, 'BAD_PUSH', 'Push is standard or conviction');
      const r = pushCard(card, asFlow(actor), kind, this.d.dice.forCampaign(campaign), sheet);
      s.cards[cardId] = r.card;
      s.characters[card.characterId] = r.character;
      this.costNotice(campaign, s, r.card);
      return toPublicCard(r.card);
    });
  }

  concede(campaign: string, actor: Identity, cardId: string, kind: ConcessionKind): Promise<PublicCard> {
    return this.mutate(campaign, actor, (s) => {
      const next = concede(this.card(s, cardId), asFlow(actor), kind);
      s.cards[cardId] = next;
      return toPublicCard(next);
    });
  }

  /** Any player may reveal a rolled card's dice; from then on everyone sees them. */
  reveal(campaign: string, actor: Identity, cardId: string): Promise<PublicCard> {
    return this.mutate(campaign, actor, (s) => {
      const card = this.card(s, cardId);
      if (!card.roll) throw new GameError(409, 'NOT_ROLLED', 'There are no dice to reveal yet');
      const next = { ...card, revealed: true };
      s.cards[cardId] = next;
      return toPublicCard(next);
    });
  }

  /** The GM always sees the dice, revealed or not. */
  dice(campaign: string, actor: Identity, cardId: string): Promise<DiceView> {
    return this.read(campaign, actor, (s) => {
      if (actor.role !== 'gm') throw new GameError(403, 'GM_ONLY', 'Only the GM can see dice before they are revealed');
      const card = this.card(s, cardId);
      if (!card.roll) throw new GameError(409, 'NOT_ROLLED', 'There are no dice yet');
      return diceView(card.roll);
    });
  }

  /** What to write next, and which pushes are open: derived from the engine, in words. */
  prompt(campaign: string, actor: Identity, cardId: string): Promise<{ prompt: OutcomePrompt | null; push: { available: boolean; standard: boolean; conviction: boolean } }> {
    return this.read(campaign, actor, (s) => {
      const card = this.card(s, cardId);
      const sheet = this.sheet(s, card.characterId);
      const target = card.dangerTargetId ? s.characters[card.dangerTargetId]?.name : undefined;
      return { prompt: card.roll ? outcomePrompt(card, { targetName: target }) : null, push: pushOptions(card, sheet) };
    });
  }

  /**
   * The writer says which paragraph is the outcome. The game checks it, applies the landed cost to the character, and locks
   * the story from its start through that paragraph.
   */
  written(campaign: string, actor: Identity, cardId: string, input: WrittenInput): Promise<PublicCard> {
    return this.mutate(campaign, actor, async (s) => {
      const card = this.card(s, cardId);
      if (actor.id !== card.actorId) throw new GameError(403, 'NOT_ALLOWED', 'The acting writer writes the outcome');
      const story = await this.d.docs.story(campaign);
      const at = story.findIndex((p) => p.paragraphId === input.outcomeParagraphId);
      const para = story[at];
      if (!para) throw new GameError(400, 'NO_SUCH_PARAGRAPH', 'That paragraph is not in the story');
      if (para.authorId !== actor.id) throw new GameError(400, 'NOT_YOUR_PARAGRAPH', 'The outcome is a paragraph you wrote');
      if (para.locked) throw new GameError(400, 'ALREADY_LOCKED', 'That prose is already locked');
      const anchor = card.anchorParagraphId ? story.findIndex((p) => p.paragraphId === card.anchorParagraphId) : -1;
      if (anchor >= 0 && at < anchor) throw new GameError(400, 'BEFORE_THE_ACTION', 'The outcome comes at or after the action it resolves');

      const marked = markWritten(card, asFlow(actor), { outcomeParagraphId: input.outcomeParagraphId });
      const sheet = this.sheet(s, card.characterId);
      const updated = applyCosts(sheet, marked, input); // may refuse (unnamed Burden, a third Burden, a worse wound than allowed)
      const toLock = lockThrough(story, input.outcomeParagraphId).filter((id) => !story.find((p) => p.paragraphId === id)!.locked);
      await this.d.docs.setLocked(campaign, toLock, true);
      s.characters[card.characterId] = updated;
      const next = { ...marked, written: { outcomeParagraphId: input.outcomeParagraphId, lockedParagraphIds: toLock } };
      s.cards[cardId] = next;
      return toPublicCard(next);
    });
  }

  /** GM only, quick rolls only, and only while nothing has been posted after the outcome. Undoes the roll and unlocks its run. */
  retcon(campaign: string, actor: Identity, cardId: string): Promise<PublicCard> {
    return this.mutate(campaign, actor, async (s) => {
      const card = this.card(s, cardId);
      if (actor.role !== 'gm') throw new GameError(403, 'NOT_ALLOWED', 'Only the GM can retcon a roll');
      const reopened = reopenForRetcon(card, asFlow(actor)); // validates status and speed
      const story = await this.d.docs.story(campaign);
      const at = story.findIndex((p) => p.paragraphId === card.written!.outcomeParagraphId);
      if (at >= 0 && at < story.length - 1) throw new GameError(409, 'BUILT_ON', 'A later post builds on this outcome, so it can no longer be retconned');
      await this.d.docs.setLocked(campaign, card.written!.lockedParagraphIds.filter((id) => story.some((p) => p.paragraphId === id)), false);
      s.characters[card.characterId] = revertCosts(this.sheet(s, card.characterId), card);
      s.cards[cardId] = reopened;
      s.overrides.push({ at: (this.d.now?.() ?? new Date()).toISOString(), gmId: actor.id, action: 'retcon', cardId });
      return toPublicCard(reopened);
    });
  }

  // ---- stalls --------------------------------------------------------------------------------------------------------------

  /** Run on a timer: when something has waited longer than the GM's limit, remind the GM once (they may Set it, skip someone, or pass the spotlight). */
  async checkStalls(): Promise<number> {
    let reminded = 0;
    for (const campaign of await this.d.store.campaigns()) {
      const state = await this.d.store.load(campaign);
      if (!state.stallHours || !Object.keys(state.waits).length) continue;
      const nowMs = (this.d.now?.() ?? new Date()).getTime();
      const gm = await this.gmId(campaign, state);
      for (const [key, since] of Object.entries(state.waits)) {
        const [kind, id] = key.split(':') as ['card' | 'battle', string];
        const live = kind === 'card' ? state.cards[id]?.status === 'draft' : state.battles[id]?.status === 'declaring';
        if (!live || nowMs - since < state.stallHours * 3_600_000) continue;
        const hours = Math.floor((nowMs - since) / 3_600_000);
        this.tell(campaign, gm, { kind: 'stall', text: `A ${kind === 'card' ? 'card' : 'battle'} has been waiting ${hours} hours. You may Set it, skip the person you are waiting on, or pass the spotlight.`, link: kind === 'card' ? link.card(campaign, id) : link.battle(campaign, id), dedupeKey: `stall:${key}` });
        reminded++;
      }
    }
    return reminded;
  }

  // ---- the spotlight ------------------------------------------------------------------------------------------------------

  /** The holder passes the spotlight to another player (the GM may pass from anyone); the new holder is told, and so is anyone now due. */
  passSpotlight(campaign: string, actor: Identity, to: string): Promise<{ holder: string | null }> {
    return this.mutate(campaign, actor, async (s) => {
      s.spotlight = passSpotlight(s.spotlight, asFlow(actor), to);
      await this.spotlightNotices(campaign, s);
      return { holder: s.spotlight.holder };
    });
  }
  takeSpotlight(campaign: string, actor: Identity): Promise<{ holder: string | null }> {
    return this.mutate(campaign, actor, (s) => { s.spotlight = takeSpotlight(s.spotlight, asFlow(actor)); return { holder: s.spotlight.holder }; });
  }
  private async spotlightNotices(campaign: string, s: GameState) {
    const holder = s.spotlight.holder;
    const story = await this.d.docs.story(campaign);
    const last = story.at(-1)?.paragraphId ?? null;
    const n = s.spotlight.players.length;
    if (holder && holder !== s.gmId) this.tell(campaign, holder, { kind: 'spotlight', text: 'The spotlight has passed to you: it is your turn to write.', link: link.story(campaign, last), dedupeKey: `spot:${s.spotlight.leftOut[holder] ?? 0}:${holder}:${n}:${story.length}` });
    const due = forcedNext(s.spotlight);
    if (due && due !== holder) this.tell(campaign, due, { kind: 'spotlight', text: 'You have been left out for two rounds: you get the next post.', link: link.story(campaign, last), dedupeKey: `due:${due}:${s.spotlight.leftOut[due]}` });
  }

  // ---- membership --------------------------------------------------------------------------------------------------

  /** A player joined (or came back): they get a character, and it is no longer marked as left. */
  async onJoin(campaign: string, actor: Identity): Promise<void> {
    await this.mutate(campaign, actor, (s) => {
      const id = s.characterOf[actor.id];
      if (id && s.characters[id]) s.characters[id] = { ...s.characters[id]!, left: false, name: s.characters[id]!.name };
    });
  }

  /** A player left: their character stays in the roster, marked as having left. */
  async onLeave(campaign: string, actor: Identity): Promise<void> {
    await this.mutate(campaign, actor, (s) => {
      const id = s.characterOf[actor.id];
      if (id && s.characters[id]) s.characters[id] = { ...s.characters[id]!, left: true };
    });
  }

  // ---- characters --------------------------------------------------------------------------------------------------

  /** Opening the campaign creates (dev) and publishes your character, so the table's Roster shows it from the first visit. */
  me(campaign: string, actor: Identity): Promise<{ character: Character | null }> {
    return this.mutate(campaign, actor, (s) => ({ character: s.characters[s.characterOf[actor.id] ?? ''] ?? null }));
  }

  layDownBurden(campaign: string, actor: Identity, characterId: string, burdenId: string, outcome: BurdenOutcome): Promise<Character> {
    return this.mutate(campaign, actor, (s) => {
      const sheet = this.sheet(s, characterId);
      if (actor.role !== 'gm' && s.characterOf[actor.id] !== characterId) throw new GameError(403, 'NOT_ALLOWED', 'Only the character\'s player (or the GM) lays down a Burden');
      const r = layDownBurden(sheet, burdenId, outcome);
      s.characters[characterId] = r.character;
      return r.character;
    });
  }
  // ---- session zero ------------------------------------------------------------------------------------------------

  /** One creation step by the acting player (or the GM). The rules decide; this only supplies the story and the clock. */
  creationAct(campaign: string, actor: Identity, action: string, body: Record<string, unknown>): Promise<{ done: true }> {
    const handler = ACTIONS[action];
    if (!handler) throw new GameError(404, 'NOT_FOUND', 'No such creation step');
    return this.mutate(campaign, actor, async (s) => {
      const story = PARAGRAPH_ACTIONS.has(action) ? await this.d.docs.story(campaign) : [];
      const next = handler(world(s), asFlow(actor), body, { story, now: (this.d.now?.() ?? new Date()).toISOString() }, actor);
      adopt(s, next);
      if (action === 'chapter') {
        const mine = s.characterOf[actor.id];
        const n = s.creation[mine ?? '']?.chapters.length ?? 0;
        for (const c of Object.values(s.characters)) if (c.ownerId && !c.left && c.ownerId !== actor.id)
          this.tell(campaign, c.ownerId, { kind: 'grant', text: `${s.characters[mine!]?.name ?? 'A player'} posted a chapter: propose a Skill and a Trait.`, link: link.tab(campaign, 'create'), dedupeKey: `grant:${mine}:${n}:${c.ownerId}` });
      }
      return { done: true as const };
    });
  }

  /** The end-of-creation check for any character at the table: what is still missing, in words. */
  creationCheck(campaign: string, actor: Identity, characterId: string): Promise<{ passed: boolean; problems: { code: string; message: string }[] }> {
    return this.read(campaign, actor, (s) => {
      if (!s.creation[characterId]) throw new GameError(404, 'NO_CHARACTER', 'No such character');
      return endCheck(world(s), characterId);
    });
  }

  private draftOf(s: GameState, actor: Identity): Draft {
    if (actor.role === 'gm') throw new GameError(403, 'GM_HAS_NO_CHARACTER', 'Drafts are for players');
    return s.drafts[actor.id] ?? { veteran: false, origin: null, chapters: [] };
  }

  draftGet(campaign: string, actor: Identity): Promise<{ draft: Draft; problems: string[] }> {
    return this.read(campaign, actor, (s) => { const d = this.draftOf(s, actor); return { draft: d, problems: draftProblems(d) }; });
  }

  /** Saves the tracker for a solo draft: which paragraphs of the private draft are the Origin and the chapters. */
  draftSave(campaign: string, actor: Identity, input: Draft): Promise<{ draft: Draft; problems: string[] }> {
    return this.mutate(campaign, actor, async (s) => {
      this.draftOf(s, actor);
      const prose = await this.d.docs.draft(campaign, actor.id);
      const has = (id: string) => prose.some((p) => p.paragraphId === id);
      const ids = [...(input.origin ? [input.origin.paragraphId] : []), ...input.chapters.map((c) => c.paragraphId)];
      if (ids.some((id) => !has(id))) throw new GameError(400, 'NO_SUCH_PARAGRAPH', 'A marked paragraph is not in your draft');
      if (new Set(ids).size !== ids.length) throw new GameError(400, 'BAD_INPUT', 'Each paragraph can mark only one step');
      if (input.chapters.length > 4) throw new GameError(400, 'BAD_INPUT', 'At most four chapters');
      s.drafts[actor.id] = input;
      return { draft: input, problems: draftProblems(input) };
    });
  }

  /** Brings the draft to the table: its prose is copied into the shared story as the player's own, and its chapters are posted. */
  draftImport(campaign: string, actor: Identity): Promise<{ done: true }> {
    return this.mutate(campaign, actor, async (s) => {
      const d = this.draftOf(s, actor);
      const prose = await this.d.docs.draft(campaign, actor.id);
      const map = Object.fromEntries(prose.map((p) => [p.paragraphId, `p${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`]));
      adopt(s, importDraft(world(s), asFlow(actor), d, map)); // validates everything before the story is touched
      await this.d.docs.copyDraft(campaign, actor.id, map);
      return { done: true as const };
    });
  }
}

