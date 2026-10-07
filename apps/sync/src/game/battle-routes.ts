import type { ConcessionKind, ContributionInput, DangerRank, DifficultyRank } from '@quillquest/rules';
import type { Identity } from '../auth';
import type { BattleService, ClientLeadPatch } from './battles';
import { GameError } from './errors';

type Body = Record<string, unknown>;
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new GameError(400, 'BAD_INPUT', `${name} is required`);
  return v;
};

/** `/api/campaigns/:c/battles...`. Returns `undefined` when the path is not one of these. Every role check is made again in the rules. */
export async function handleBattles(svc: BattleService, campaign: string, actor: Identity, rest: string[], method: string, body: () => Promise<Body>): Promise<unknown | undefined> {
  const [a, id, action] = rest;
  if (a !== 'battles') return undefined;
  if (!id) {
    if (method !== 'POST') return undefined;
    const j = await body();
    return { battle: await svc.open(campaign, actor, {
      goal: str(j.goal, 'goal'), battleDanger: str(j.battleDanger, 'battleDanger'), difficulty: str(j.difficulty, 'difficulty') as DifficultyRank, dangerRank: str(j.dangerRank, 'dangerRank') as DangerRank,
      framingParagraphId: typeof j.framingParagraphId === 'string' && j.framingParagraphId ? j.framingParagraphId : null, leadCharacterId: str(j.leadCharacterId, 'leadCharacterId'),
    }) };
  }
  if (action === 'dice' && method === 'GET') return { dice: await svc.dice(campaign, actor, id) };
  if (method === 'PATCH' && action === 'lead') return { battle: await svc.editLead(campaign, actor, id, (await body()) as ClientLeadPatch) };
  if (method !== 'POST') return undefined;
  switch (action) {
    case 'declare': { const j = await body(); return { battle: await svc.declare(campaign, actor, id, {
      line: typeof j.line === 'string' ? j.line : '', type: j.type as ContributionInput['type'], target: typeof j.target === 'string' ? j.target : undefined,
      dangerRank: j.dangerRank as DangerRank, dangerText: typeof j.dangerText === 'string' ? j.dangerText : '', dangerKind: j.dangerKind as ContributionInput['dangerKind'], declaredMortal: j.declaredMortal === true,
    }) }; }
    case 'concede': return { battle: await svc.concedeContributor(campaign, actor, id) };
    case 'skip': return { battle: await svc.skip(campaign, actor, id, str((await body()).characterId, 'characterId')) };
    case 'set': { const j = await body(); return { battle: await svc.setBattle(campaign, actor, id, {
      difficulty: typeof j.difficulty === 'string' ? (j.difficulty as DifficultyRank) : undefined,
      dangers: j.dangers && typeof j.dangers === 'object' ? (j.dangers as Record<string, DangerRank>) : undefined,
    }) }; }
    case 'roll': return { battle: await svc.roll(campaign, actor, id) };
    case 'push': { const kind = (await body()).kind; if (kind !== 'standard' && kind !== 'conviction') throw new GameError(400, 'BAD_INPUT', 'kind is standard or conviction'); return { battle: await svc.push(campaign, actor, id, kind) }; }
    case 'answer': { const answer = (await body()).answer; if (answer !== 'withdraw' && answer !== 'stay') throw new GameError(400, 'BAD_INPUT', 'answer is withdraw or stay'); return { battle: await svc.answer(campaign, actor, id, answer) }; }
    case 'resolve-push': return { battle: await svc.resolvePush(campaign, actor, id, (await body()).force === true) };
    case 'concede-battle': return { battle: await svc.concedeBattle(campaign, actor, id, str((await body()).kind, 'kind') as ConcessionKind) };
    case 'beat': {
      const j = await body();
      const cost = j.cost && typeof j.cost === 'object' ? (j.cost as Body) : null;
      return { battle: await svc.beat(campaign, actor, id, {
        text: typeof j.text === 'string' ? j.text : '',
        ...(cost ? { cost: { text: typeof cost.text === 'string' ? cost.text : '', woundName: typeof cost.woundName === 'string' ? cost.woundName : undefined, woundLevel: cost.woundLevel as never, burdenName: typeof cost.burdenName === 'string' ? cost.burdenName : undefined } } : {}),
      }) };
    }
    case 'order': { const ids = (await body()).ids; if (!Array.isArray(ids)) throw new GameError(400, 'BAD_INPUT', 'ids must be a list'); return { battle: await svc.order(campaign, actor, id, ids.map(String)) }; }
    case 'stitch': return { battle: await svc.stitch(campaign, actor, id, { skipMissing: (await body()).skipMissing === true }) };
    case 'reveal': return { battle: await svc.reveal(campaign, actor, id) };
  }
  return undefined;
}
