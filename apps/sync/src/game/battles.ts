import {
  answerPush, applyBattleCost, battleCosts, battleDiceView, concedeBattle, concedeContributor, declareContribution, editLead, openBattle, orderBeats, pushReady,
  requestPush, resolvePush, resolveSkill, rollBattle, setBattleCard, skipContributor, stitchBattle, toPublicBattle, waitingOn, writeBeat,
  type BattleCard, type Beat, type ConcessionKind, type ContributionInput, type CardPatch, type DangerRank, type DifficultyRank, type FlowActor, type PublicBattle,
} from '@quillquest/rules';
import { lockThrough } from '@quillquest/story';
import type { Identity } from '../auth';
import { link } from '../notify/links';
import type { DiceProvider } from './dice';
import { GameError } from './errors';
import type { DocPort, GameService } from './service';
import type { GameState } from './store';

const asFlow = (i: Identity): FlowActor => ({ id: i.id, role: i.role });
const SYSTEM: FlowActor = { id: 'system', role: 'gm' };

export interface BattleDeps { dice: DiceProvider; docs: DocPort; now?: () => number }
export type ClientLeadPatch = Omit<CardPatch, 'skill'> & { skillName?: string };

/** The battle roll (design plan 6.3): one card, one roll, everyone's own Danger. The rules are in `@quillquest/rules`; this sequences them and tells people. */
export class BattleService {
  constructor(private game: GameService, private d: BattleDeps) {}
  private now() { return this.d.now?.() ?? Date.now(); }

  private battle(s: GameState, id: string): BattleCard {
    const b = s.battles[id];
    if (!b) throw new GameError(404, 'NO_BATTLE', 'No such battle');
    return b;
  }
  private owner(s: GameState, characterId: string): string | undefined { return s.characters[characterId]?.ownerId; }
  private name(s: GameState, characterId: string): string { return s.characters[characterId]?.name ?? characterId; }
  private put(s: GameState, b: BattleCard): PublicBattle { s.battles[b.id] = b; return toPublicBattle(b); }

  // ---- opening and declaring ------------------------------------------------------------------------------------------

  open(campaign: string, actor: Identity, a: { goal: string; battleDanger: string; difficulty: DifficultyRank; dangerRank: DangerRank; framingParagraphId?: string | null; leadCharacterId: string }) {
    return this.game.mutate(campaign, actor, async (s) => {
      const lead = s.characters[a.leadCharacterId];
      if (!lead?.ownerId || lead.left) throw new GameError(404, 'NO_CHARACTER', 'The lead must be a player\'s character at the table');
      if (a.framingParagraphId) {
        const story = await this.d.docs.story(campaign);
        if (!story.some((p) => p.paragraphId === a.framingParagraphId)) throw new GameError(400, 'NO_SUCH_PARAGRAPH', 'That paragraph is not in the story');
      }
      const others = Object.values(s.characters).filter((c) => c.ownerId && !c.left && c.id !== lead.id).map((c) => ({ characterId: c.id, actorId: c.ownerId! }));
      const id = `b${++s.dseq}`;
      const b = openBattle(asFlow(actor), { id, goal: a.goal, battleDanger: a.battleDanger, difficulty: a.difficulty, dangerRank: a.dangerRank, framingParagraphId: a.framingParagraphId ?? null, lead: { characterId: lead.id, actorId: lead.ownerId }, others });
      s.waits[`battle:${id}`] = this.now();
      this.game.tell(campaign, lead.ownerId, { kind: 'battle', text: `You lead the battle: ${b.goal}. Fill in your card.`, link: link.battle(campaign, id), dedupeKey: `open:${id}:${lead.ownerId}` });
      for (const o of others) this.game.tell(campaign, o.actorId, { kind: 'battle', text: `A battle opens: ${b.goal}. Declare your contribution.`, link: link.battle(campaign, id), dedupeKey: `open:${id}:${o.actorId}` });
      return this.put(s, b);
    });
  }

  editLead(campaign: string, actor: Identity, id: string, patch: ClientLeadPatch) {
    return this.game.mutate(campaign, actor, (s) => {
      const b = this.battle(s, id);
      const sheet = s.characters[b.lead.characterId]!;
      const { skillName, ...rest } = patch;
      const flowPatch: CardPatch = { ...rest };
      if (skillName !== undefined) flowPatch.skill = resolveSkill(sheet, skillName);
      return this.put(s, editLead(b, asFlow(actor), flowPatch, sheet));
    });
  }

  /** After a declaration, a concession or a skip: if nobody is left to declare, the GM is next. */
  private async readyForSet(campaign: string, s: GameState, b: BattleCard) {
    if (b.status === 'declaring' && waitingOn(b).length === 0) {
      await this.game.tellGm(campaign, s, { kind: 'battle', text: `Everyone has declared: the battle "${b.goal}" is ready for you to Set.`, link: link.battle(campaign, b.id), dedupeKey: `ready:${b.id}:${this.game.sig(b)}` });
    }
  }

  declare(campaign: string, actor: Identity, id: string, input: ContributionInput) {
    return this.game.mutate(campaign, actor, async (s) => {
      const b = declareContribution(this.battle(s, id), asFlow(actor), input);
      await this.readyForSet(campaign, s, b);
      return this.put(s, b);
    });
  }
  concedeContributor(campaign: string, actor: Identity, id: string) {
    return this.game.mutate(campaign, actor, async (s) => {
      const b = concedeContributor(this.battle(s, id), asFlow(actor));
      await this.readyForSet(campaign, s, b);
      return this.put(s, b);
    });
  }
  skip(campaign: string, actor: Identity, id: string, characterId: string) {
    return this.game.mutate(campaign, actor, async (s) => {
      const b = skipContributor(this.battle(s, id), asFlow(actor), characterId);
      await this.readyForSet(campaign, s, b);
      return this.put(s, b);
    });
  }

  // ---- Set, Roll ---------------------------------------------------------------------------------------------------------

  setBattle(campaign: string, actor: Identity, id: string, adjust: { difficulty?: DifficultyRank; dangers?: Record<string, DangerRank> }) {
    return this.game.mutate(campaign, actor, (s) => {
      const b = setBattleCard(this.battle(s, id), asFlow(actor), s.characters, adjust);
      delete s.waits[`battle:${id}`];
      return this.put(s, b);
    });
  }

  roll(campaign: string, actor: Identity, id: string) {
    return this.game.mutate(campaign, actor, (s) => {
      const b = rollBattle(this.battle(s, id), asFlow(actor), this.d.dice.forCampaign(campaign));
      this.announceRoll(campaign, s, b);
      return this.put(s, b);
    });
  }

  /** Everyone writes a beat; whoever's Danger landed is told to write their cost. */
  private announceRoll(campaign: string, s: GameState, b: BattleCard) {
    const landed = new Set(battleCosts(b).map((c) => c.characterId));
    const everyone = [{ characterId: b.lead.characterId, actorId: b.lead.actorId }, ...b.contributions.filter((c) => c.status !== 'skipped')];
    for (const p of everyone) {
      const cost = landed.has(p.characterId);
      this.game.tell(campaign, p.actorId, {
        kind: cost ? 'cost' : 'battle', link: link.battle(campaign, b.id), dedupeKey: `beat:${b.id}:${p.actorId}:${b.roll?.push ?? 'none'}`,
        text: cost ? `Your Danger landed in the battle "${b.goal}": write your beat and your cost.` : `The battle "${b.goal}" has been rolled: write your beat.`,
      });
    }
  }

  // ---- push, withdrawals --------------------------------------------------------------------------------------------------

  push(campaign: string, actor: Identity, id: string, kind: 'standard' | 'conviction') {
    return this.game.mutate(campaign, actor, (s) => {
      const b = this.battle(s, id);
      if (kind !== 'standard' && kind !== 'conviction') throw new GameError(400, 'BAD_INPUT', 'kind is standard or conviction');
      const r = requestPush(b, asFlow(actor), kind, { now: this.now(), windowMs: s.pushWindowMinutes * 60_000, dice: this.d.dice.forCampaign(campaign), sheet: s.characters[b.lead.characterId]! });
      if (r.character) s.characters[b.lead.characterId] = r.character;
      if (r.battle.status === 'pushing') {
        for (const c of r.battle.contributions.filter((x) => x.status === 'declared'))
          this.game.tell(campaign, c.actorId, { kind: 'battle', text: `The lead is pushing the battle "${b.goal}": withdraw or stay.`, link: link.battle(campaign, b.id), dedupeKey: `push:${b.id}:${c.actorId}` });
      } else this.announceRoll(campaign, s, r.battle);
      return this.put(s, r.battle);
    });
  }

  answer(campaign: string, actor: Identity, id: string, answer: 'withdraw' | 'stay') {
    return this.game.mutate(campaign, actor, (s) => {
      let b = answerPush(this.battle(s, id), asFlow(actor), answer);
      if (pushReady(b, this.now())) { b = resolvePush(b, SYSTEM, this.d.dice.forCampaign(campaign), this.now()); this.announceRoll(campaign, s, b); }
      return this.put(s, b);
    });
  }

  /** The lead or GM closes the window when it is ready; the GM may force it early. */
  resolvePush(campaign: string, actor: Identity, id: string, force: boolean) {
    return this.game.mutate(campaign, actor, (s) => {
      const b = resolvePush(this.battle(s, id), asFlow(actor), this.d.dice.forCampaign(campaign), this.now(), { force });
      this.announceRoll(campaign, s, b);
      return this.put(s, b);
    });
  }

  /** Run on a timer: push windows that have run out resolve, so a slow contributor cannot stall the table. */
  async tick(): Promise<number> {
    let resolved = 0;
    for (const campaign of await this.game.campaigns()) {
      await this.game.mutate(campaign, { id: 'system', name: 'system', role: 'gm', color: '#000000' }, (s) => {
        for (const b of Object.values(s.battles)) {
          if (!pushReady(b, this.now())) continue;
          const next = resolvePush(b, SYSTEM, this.d.dice.forCampaign(campaign), this.now());
          this.announceRoll(campaign, s, next);
          this.put(s, next);
          resolved++;
        }
      });
    }
    return resolved;
  }

  concedeBattle(campaign: string, actor: Identity, id: string, kind: ConcessionKind) {
    return this.game.mutate(campaign, actor, (s) => this.put(s, concedeBattle(this.battle(s, id), asFlow(actor), kind)));
  }

  // ---- beats and the stitched post ---------------------------------------------------------------------------------------

  beat(campaign: string, actor: Identity, id: string, a: { text: string; cost?: Beat['cost'] }) {
    return this.game.mutate(campaign, actor, (s) => this.put(s, writeBeat(this.battle(s, id), asFlow(actor), a)));
  }
  order(campaign: string, actor: Identity, id: string, ids: string[]) {
    return this.game.mutate(campaign, actor, (s) => this.put(s, orderBeats(this.battle(s, id), asFlow(actor), ids)));
  }

  /** Stitches the beats into one Story post, in each writer's ink, locks the prose through it, and applies the costs that landed. */
  stitch(campaign: string, actor: Identity, id: string, opts: { skipMissing?: boolean }) {
    return this.game.mutate(campaign, actor, async (s) => {
      const b = this.battle(s, id);
      const r = stitchBattle(b, asFlow(actor), opts);
      for (const c of battleCosts(r.battle)) {
        const cost = b.beats[c.characterId]?.cost;
        s.characters[c.characterId] = applyBattleCost(s.characters[c.characterId]!, r.battle, c.characterId, { woundName: cost?.woundName, woundLevel: cost?.woundLevel, burdenName: cost?.burdenName });
      }
      if (r.post.length) {
        const ids = await this.d.docs.appendParagraphs(campaign, r.post.map((p) => ({ authorId: p.actorId, text: p.text })));
        const story = await this.d.docs.story(campaign);
        const toLock = lockThrough(story, ids.at(-1)!).filter((pid) => !story.find((p) => p.paragraphId === pid)!.locked);
        await this.d.docs.setLocked(campaign, toLock, true);
      }
      return this.put(s, r.battle);
    });
  }

  // ---- reveal ------------------------------------------------------------------------------------------------------------

  /** Any player may reveal the dice of a rolled battle; from then on everyone sees them. */
  reveal(campaign: string, actor: Identity, id: string) {
    return this.game.mutate(campaign, actor, (s) => {
      const b = this.battle(s, id);
      if (!b.roll) throw new GameError(409, 'NOT_ROLLED', 'There are no dice to reveal yet');
      return this.put(s, { ...b, revealed: true });
    });
  }
  dice(campaign: string, actor: Identity, id: string) {
    return this.game.read(campaign, actor, (s) => {
      if (actor.role !== 'gm') throw new GameError(403, 'GM_ONLY', 'Only the GM can see dice before they are revealed');
      return battleDiceView(this.battle(s, id));
    });
  }
}
