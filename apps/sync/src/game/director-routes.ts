import { NPC_FIELDS, type NpcField, type NominationKind } from '@quillquest/rules';
import { PLAYER_KINDS, GM_KINDS, type SuggestionKind } from '@quillquest/prompts';
import type { Identity } from '../auth';
import type { DirectorService } from './director';
import { GameError } from './errors';

type Body = Record<string, unknown>;
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new GameError(400, 'BAD_INPUT', `${name} is required`);
  return v;
};
const KINDS: readonly string[] = [...PLAYER_KINDS, ...GM_KINDS];

/**
 * The Director and Claude routes under `/api/campaigns/:c/`. Returns `undefined` when the path is not one of these, so the caller can
 * go on matching. Every GM-only route is checked again inside the service: this file is only the shape of the HTTP calls.
 */
export async function handleDirector(svc: DirectorService, campaign: string, actor: Identity, rest: string[], method: string, body: () => Promise<Body>): Promise<unknown | undefined> {
  const [a, b, c] = rest;
  if (a === 'director' && method === 'GET' && !b) return svc.overview(campaign, actor);
  if (a === 'settings' && method === 'PUT') {
    const j = await body();
    return svc.setSettings(campaign, actor, {
      themes: typeof j.themes === 'string' ? j.themes : undefined,
      faces: Array.isArray(j.faces) ? j.faces.map(String) : undefined,
      cap: typeof j.cap === 'number' ? j.cap : undefined,
    });
  }
  if (a === 'session' && b === 'start' && method === 'POST') return svc.startSession(campaign, actor);

  if (a === 'conviction' && method === 'POST') {
    const j = await body();
    if (b === 'nominate') return svc.nominate(campaign, actor, { characterId: str(j.characterId, 'characterId'), kind: str(j.kind, 'kind') as NominationKind, beliefId: typeof j.beliefId === 'string' ? j.beliefId : undefined, note: typeof j.note === 'string' ? j.note : '' });
    if (b === 'award') {
      if (typeof j.nominationId === 'string') return svc.awardNomination(campaign, actor, j.nominationId);
      const kind = str(j.kind, 'kind') as NominationKind;
      const note = typeof j.note === 'string' ? j.note : '';
      return svc.awardDirect(campaign, actor, { characterId: str(j.characterId, 'characterId'), reason: kind === 'belief' ? { kind, beliefId: str(j.beliefId, 'beliefId'), note } : { kind, note } });
    }
    if (b === 'decline') return svc.declineNomination(campaign, actor, str(j.nominationId, 'nominationId'));
  }

  if (a === 'npcs') {
    if (!b && method === 'POST') return svc.createNpc(campaign, actor, { name: str((await body()).name, 'name') });
    if (b && !c && method === 'PATCH') {
      const j = await body();
      return svc.editNpc(campaign, actor, b, {
        name: typeof j.name === 'string' ? j.name : undefined, notes: typeof j.notes === 'string' ? j.notes : undefined,
        beliefs: Array.isArray(j.beliefs) ? j.beliefs.map(String) : undefined,
        skills: Array.isArray(j.skills) ? j.skills.map((s: Body) => ({ name: String(s.name ?? ''), rank: s.rank as never })) : undefined,
      });
    }
    if (b && c === 'reveal' && method === 'POST') {
      const field = str((await body()).field, 'field');
      if (!NPC_FIELDS.includes(field as NpcField)) throw new GameError(400, 'BAD_INPUT', `field is one of: ${NPC_FIELDS.join(', ')}`);
      return svc.revealNpcField(campaign, actor, b, field as NpcField);
    }
  }

  if (a === 'llm' && b && method === 'POST') {
    if (!KINDS.includes(b)) throw new GameError(404, 'NOT_FOUND', 'No such request');
    return svc.ask(campaign, actor, b as SuggestionKind, await body());
  }
  if (a === 'suggestions') {
    if (!b && method === 'GET') return { suggestions: await svc.listSuggestions(campaign, actor) };
    if (b && c === 'status' && method === 'POST') { await svc.setSuggestionStatus(campaign, actor, b, str((await body()).status, 'status') as never); return { updated: true }; }
  }
  return undefined;
}
