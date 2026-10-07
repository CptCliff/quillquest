import type { IncomingMessage, ServerResponse } from 'node:http';
import { RuleViolation, CONCESSION_KINDS, type BurdenOutcome, type ConcessionKind } from '@quillquest/rules';
import { authenticate, type Identity } from '../auth';
import type { DiceProvider } from './dice';
import { GameError } from './errors';
import type { ClientPatch, CreateCardInput, GameService, WrittenInput } from './service';

export interface RouteOptions { service: GameService; dice: DiceProvider; secret: string; devDice: boolean }

const CAMPAIGN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY = 64 * 1024;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new GameError(413, 'TOO_LARGE', 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new GameError(400, 'BAD_JSON', 'The request body is not a JSON object');
  }
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

/** Rule breaches are conflicts, except being told you may not act at all. */
function statusFor(e: RuleViolation): number {
  return e.code === 'NOT_ALLOWED' ? 403 : 409;
}

function who(req: IncomingMessage, secret: string): Identity {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) throw new GameError(401, 'NO_TOKEN', 'Sign in first');
  try {
    return authenticate(h.slice(7), secret);
  } catch {
    throw new GameError(401, 'BAD_TOKEN', 'Your sign-in is not valid');
  }
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new GameError(400, 'BAD_INPUT', `${name} is required`);
  return v;
};
const optStr = (v: unknown) => (typeof v === 'string' ? v : undefined);

/**
 * Handles `/api/campaigns/:id/...`. Returns false for anything else so the server can answer normally.
 * Every route authenticates, takes the role from the signed token, and never returns dice except the GM's dice route.
 */
export async function handleGameRequest(req: IncomingMessage, res: ServerResponse, o: RouteOptions): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;
  try {
    const parts = url.pathname.split('/').filter(Boolean); // api, campaigns, :c, ...
    const method = req.method ?? 'GET';

    // Dev only: queue the next dice. Never mounted in production.
    if (parts[1] === 'dev' && parts[2] === 'campaigns' && parts[4] === 'dice' && method === 'POST') {
      if (!o.devDice) throw new GameError(404, 'NOT_FOUND', 'No such route');
      const body = await readJson(req);
      const values = body.values;
      if (!Array.isArray(values) || !values.every((v) => Number.isInteger(v))) throw new GameError(400, 'BAD_INPUT', 'values must be a list of integers');
      o.dice.queue(parts[3]!, values as number[]);
      return send(res, 200, { queued: values.length }), true;
    }

    if (parts[1] !== 'campaigns' || !parts[2]) throw new GameError(404, 'NOT_FOUND', 'No such route');
    const campaign = parts[2];
    if (!CAMPAIGN.test(campaign)) throw new GameError(400, 'BAD_CAMPAIGN', 'Bad campaign id');
    const actor = who(req, o.secret);
    const svc = o.service;
    const rest = parts.slice(3);
    const ok = (body: unknown) => (send(res, 200, body), true);

    if (rest[0] === 'me' && method === 'GET') return ok(await svc.me(campaign, actor));

    if (rest[0] === 'cards') {
      if (rest.length === 1 && method === 'POST') {
        const b = await readJson(req);
        const input: CreateCardInput = {
          skillName: str(b.skillName, 'skillName'), anchorParagraphId: optStr(b.anchorParagraphId) ?? null, want: optStr(b.want), risk: optStr(b.risk),
          onTheLine: optStr(b.onTheLine) ?? null, dangerTargetId: optStr(b.dangerTargetId) ?? null, backingBeliefId: optStr(b.backingBeliefId) ?? null,
        };
        return ok({ card: await svc.createCard(campaign, actor, input) });
      }
      const cardId = rest[1];
      const action = rest[2];
      if (cardId && !action && method === 'PATCH') return ok({ card: await svc.editCard(campaign, actor, cardId, (await readJson(req)) as ClientPatch) });
      if (cardId && action === 'preview' && method === 'GET') return ok(await svc.preview(campaign, actor, cardId));
      if (cardId && action === 'prompt' && method === 'GET') return ok(await svc.prompt(campaign, actor, cardId));
      if (cardId && action === 'dice' && method === 'GET') return ok({ dice: await svc.dice(campaign, actor, cardId) });
      if (cardId && method === 'POST') {
        if (action === 'set') return ok({ card: await svc.closeSet(campaign, actor, cardId) });
        if (action === 'roll') return ok({ card: await svc.roll(campaign, actor, cardId) });
        if (action === 'reveal') return ok({ card: await svc.reveal(campaign, actor, cardId) });
        if (action === 'retcon') return ok({ card: await svc.retcon(campaign, actor, cardId) });
        if (action === 'push') {
          const kind = (await readJson(req)).kind;
          if (kind !== 'standard' && kind !== 'conviction') throw new GameError(400, 'BAD_INPUT', 'kind is standard or conviction');
          return ok({ card: await svc.push(campaign, actor, cardId, kind) });
        }
        if (action === 'concede') {
          const kind = (await readJson(req)).kind;
          if (!CONCESSION_KINDS.includes(kind as ConcessionKind)) throw new GameError(400, 'BAD_INPUT', `kind is one of: ${CONCESSION_KINDS.join(', ')}`);
          return ok({ card: await svc.concede(campaign, actor, cardId, kind as ConcessionKind) });
        }
        if (action === 'written') {
          const b = await readJson(req);
          const input: WrittenInput = {
            outcomeParagraphId: str(b.outcomeParagraphId, 'outcomeParagraphId'), woundName: optStr(b.woundName), burdenName: optStr(b.burdenName),
            woundLevel: optStr(b.woundLevel) as WrittenInput['woundLevel'],
          };
          return ok({ card: await svc.written(campaign, actor, cardId, input) });
        }
      }
    }

    if (rest[0] === 'characters' && rest[2] === 'burdens' && rest[4] === 'lay-down' && method === 'POST') {
      const b = await readJson(req);
      const outcome: BurdenOutcome = b.kind === 'beliefRewrite'
        ? { kind: 'beliefRewrite', text: str(b.text, 'text') }
        : { kind: 'trait', traitId: `trait-${rest[3]}`, text: str(b.text, 'text') };
      return ok({ character: await svc.layDownBurden(campaign, actor, rest[1]!, rest[3]!, outcome) });
    }

    throw new GameError(404, 'NOT_FOUND', 'No such route');
  } catch (e) {
    if (e instanceof GameError) send(res, e.status, { error: { code: e.code, message: e.message } });
    else if (e instanceof RuleViolation) send(res, statusFor(e), { error: { code: e.code, message: e.message } });
    else {
      console.error('game route failed', e);
      send(res, 500, { error: { code: 'INTERNAL', message: 'Something went wrong' } });
    }
    return true;
  }
}
