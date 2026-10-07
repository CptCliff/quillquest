import type { IncomingMessage, ServerResponse } from 'node:http';
import { DbError, type Db } from '@quillquest/db';
import { RuleViolation, CONCESSION_KINDS, type BurdenOutcome, type ConcessionKind } from '@quillquest/rules';
import type { Identity } from '../auth';
import { verifyToken } from '../auth/env';
import type { AuthProvider, Claims } from '../auth/types';
import type { Directory } from '../directory';
import type { DiceProvider } from './dice';
import { GameError } from './errors';
import type { ClientPatch, CreateCardInput, GameService, WrittenInput } from './service';
import type { DirectorService } from './director';
import { handleDirector } from './director-routes';
import type { BattleService } from './battles';
import { handleBattles } from './battle-routes';
import { defaultLayout, sanitize, validateLayout } from '@quillquest/layout';
import type { Device, LayoutStore } from './layouts';
import type { Notifier } from '../notify/notifier';
import type { NotifyStore } from '../notify/store';

export interface RouteOptions {
  service: GameService;
  director: DirectorService;
  battles: BattleService;
  /** Notification preferences and the dev mail routes need these; absent without a mail setup. */
  notifyStore?: NotifyStore;
  layouts?: LayoutStore;
  dev?: { mail?: { sent: () => unknown[]; advance: (ms: number) => void; tick: () => Promise<unknown> } };
  dice: DiceProvider;
  providers: AuthProvider[];
  directory: Directory;
  /** Present when accounts are backed by Postgres; the account and invite routes need it. */
  db?: Db;
  devDice: boolean;
  /** Called when someone's membership changes while they may be connected (they left), so their live sockets can be dropped. */
  onMembershipChange?: (campaign: string, userId: string) => void;
}

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

/** Rule breaches are conflicts, except being told you may not act at all, or sending something malformed. */
const ruleStatus = (e: RuleViolation) => (e.code === 'NOT_ALLOWED' ? 403 : e.code === 'BAD_INPUT' ? 400 : 409);

const DB_STATUS: Record<string, number> = {
  BAD_INPUT: 400, NOT_FOUND: 404, NO_PROFILE: 409, NOT_GM: 403, NOT_A_MEMBER: 403, GM_CANNOT_LEAVE: 409,
  INVITE_USED: 409, INVITE_REVOKED: 410, INVITE_EXPIRED: 410,
};

async function identify(req: IncomingMessage, o: RouteOptions): Promise<Claims> {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) throw new GameError(401, 'NO_TOKEN', 'Sign in first');
  try {
    return await verifyToken(o.providers, h.slice(7));
  } catch {
    throw new GameError(401, 'BAD_TOKEN', 'Your sign-in is not valid');
  }
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new GameError(400, 'BAD_INPUT', `${name} is required`);
  return v;
};
const optStr = (v: unknown) => (typeof v === 'string' ? v : undefined);
const needDb = (o: RouteOptions): Db => {
  if (!o.db) throw new GameError(501, 'NOT_CONFIGURED', 'Accounts are not configured on this server');
  return o.db;
};

/**
 * Handles `/api/...`. Returns false for anything else so the server can answer normally.
 * Every route authenticates the caller; a campaign route also requires membership, and the role comes from the membership,
 * never from the token. Dice never appear except on the GM's dice route.
 */
export async function handleGameRequest(req: IncomingMessage, res: ServerResponse, o: RouteOptions): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;
  try {
    const parts = url.pathname.split('/').filter(Boolean); // api, ...
    const method = req.method ?? 'GET';
    const ok = (body: unknown) => (send(res, 200, body), true);

    // Dev only: queue the next dice. Never mounted in production.
    if (parts[1] === 'dev' && parts[2] === 'campaigns' && parts[4] === 'dice' && method === 'POST') {
      if (!o.devDice) throw new GameError(404, 'NOT_FOUND', 'No such route');
      const values = (await readJson(req)).values;
      if (!Array.isArray(values) || !values.every((v) => Number.isInteger(v))) throw new GameError(400, 'BAD_INPUT', 'values must be a list of integers');
      o.dice.queue(parts[3]!, values as number[]);
      return ok({ queued: values.length });
    }

    // Dev only: read the fake mailer's outbox, move the notifier's clock, and run a tick. Never mounted unless asked for.
    if (parts[1] === 'dev' && parts[2] === 'mail') {
      if (!o.dev?.mail) throw new GameError(404, 'NOT_FOUND', 'No such route');
      if (method === 'GET' && !parts[3]) return ok({ sent: o.dev.mail.sent() });
      if (method === 'POST' && parts[3] === 'advance') { o.dev.mail.advance(Number((await readJson(req)).ms) || 0); return ok({ advanced: true }); }
      if (method === 'POST' && parts[3] === 'tick') return ok({ result: await o.dev.mail.tick() });
      throw new GameError(404, 'NOT_FOUND', 'No such route');
    }

    const claims = await identify(req, o);
    if (o.db) await o.db.ensureProfile(claims.userId, claims.name ?? claims.email, claims.color);

    // ---- account routes (no campaign yet) --------------------------------------------------------------------------
    if (parts[1] === 'me' && parts.length === 2 && method === 'GET') {
      const db = needDb(o);
      return ok({ userId: claims.userId, email: claims.email ?? null, profile: await db.getProfile(claims.userId), campaigns: await db.listCampaignsFor(claims.userId) });
    }
    if (parts[1] === 'me' && parts[2] === 'profile' && method === 'PUT') {
      const db = needDb(o);
      const b = await readJson(req);
      await db.upsertProfile(claims.userId, { displayName: str(b.displayName, 'displayName'), preferredColor: optStr(b.preferredColor) ?? null });
      return ok({ profile: await db.getProfile(claims.userId) });
    }
    if (parts[1] === 'campaigns' && parts.length === 2 && method === 'POST') {
      const db = needDb(o);
      const c = await db.createCampaign({ title: str((await readJson(req)).title, 'title'), gmUserId: claims.userId });
      return ok({ campaign: { id: c.id, title: c.title } });
    }
    if (parts[1] === 'invites' && parts[2] === 'accept' && method === 'POST') {
      const db = needDb(o);
      const joined = await db.acceptInvite(str((await readJson(req)).token, 'token'), claims.userId);
      const actor = await o.directory.resolve(claims, joined.campaignId);
      if (actor) await o.service.onJoin(joined.campaignId, actor);
      return ok(joined);
    }

    // ---- campaign routes ---------------------------------------------------------------------------------------------
    if (parts[1] !== 'campaigns' || !parts[2]) throw new GameError(404, 'NOT_FOUND', 'No such route');
    const campaign = parts[2];
    if (!CAMPAIGN.test(campaign)) throw new GameError(400, 'BAD_CAMPAIGN', 'Bad campaign id');
    const actor: Identity | null = await o.directory.resolve(claims, campaign);
    if (!actor) throw new GameError(403, 'NOT_A_MEMBER', 'You are not in this campaign');
    if (actor.left && method !== 'GET') throw new GameError(403, 'LEFT', 'You have left this campaign; you can still read it');
    const svc = o.service;
    const rest = parts.slice(3);

    if (rest[0] === 'members' && method === 'GET') {
      const members = await needDb(o).listMembers(campaign);
      return ok({ members: members.map((m) => ({ userId: m.userId, displayName: m.displayName, color: m.color, role: m.role, left: m.left })) });
    }
    if (rest[0] === 'leave' && method === 'POST') {
      await needDb(o).leave(campaign, actor.id);
      await svc.onLeave(campaign, actor);
      o.onMembershipChange?.(campaign, actor.id);
      return ok({ left: true });
    }
    if (rest[0] === 'invites') {
      const db = needDb(o);
      if (actor.role !== 'gm') throw new GameError(403, 'GM_ONLY', 'Only the GM manages invites');
      if (rest.length === 1 && method === 'POST') {
        const inv = await db.createInvite(campaign, actor.id);
        return ok({ invite: { id: inv.id, token: inv.token, expiresAt: inv.expiresAt } });
      }
      if (rest.length === 1 && method === 'GET') return ok({ invites: await db.listInvites(campaign) });
      if (rest.length === 2 && method === 'DELETE') { await db.revokeInvite(campaign, rest[1]!); return ok({ revoked: true }); }
    }

    if (rest[0] === 'me' && method === 'GET') return ok(await svc.me(campaign, actor));

    const battled = await handleBattles(o.battles, campaign, actor, rest, method, () => readJson(req));
    if (battled !== undefined) return ok(battled);

    if (rest[0] === 'spotlight' && method === 'POST') {
      if (rest[1] === 'pass') return ok(await svc.passSpotlight(campaign, actor, str((await readJson(req)).to, 'to')));
      if (rest[1] === 'take') return ok(await svc.takeSpotlight(campaign, actor));
    }
    // Each person's workspace layout. You can only ever read or change your own, and the Director panel is never in a player's.
    if (rest[0] === 'layout' && !rest[1]) {
      if (!o.layouts) throw new GameError(501, 'NOT_CONFIGURED', 'Saved layouts are not set up on this server');
      const device = url.searchParams.get('device');
      if (device !== 'wide' && device !== 'phone') throw new GameError(400, 'BAD_INPUT', 'device is wide or phone');
      const role = actor.role;
      if (method === 'GET') {
        const saved = await o.layouts.get(campaign, actor.id, device as Device);
        const v = saved ? validateLayout(saved) : null;
        return ok({ layout: v?.ok ? sanitize(v.layout, role) : defaultLayout(role), saved: !!v?.ok });
      }
      if (method === 'PUT') {
        const v = validateLayout((await readJson(req)).layout, role);
        if (!v.ok) throw new GameError(400, 'BAD_LAYOUT', v.error);
        await o.layouts.put(campaign, actor.id, device as Device, v.layout);
        return ok({ layout: v.layout });
      }
      if (method === 'DELETE') { await o.layouts.del(campaign, actor.id, device as Device); return ok({ layout: defaultLayout(role), saved: false }); }
    }
    if (rest[0] === 'prefs') {
      if (!o.notifyStore) throw new GameError(501, 'NOT_CONFIGURED', 'Notifications are not set up on this server');
      if (method === 'GET') return ok({ mode: await o.notifyStore.mode(campaign, actor.id), hasEmail: !!(await o.notifyStore.email(actor.id)) });
      if (method === 'PUT') {
        const mode = (await readJson(req)).mode;
        if (mode !== 'immediate' && mode !== 'digest' && mode !== 'off') throw new GameError(400, 'BAD_INPUT', 'mode is immediate, digest or off');
        await o.notifyStore.setMode(campaign, actor.id, mode);
        return ok({ mode });
      }
    }

    const handled = await handleDirector(o.director, campaign, actor, rest, method, () => readJson(req));
    if (handled !== undefined) return ok(handled);

    // Session zero. `POST /creation/:step` runs one step; the rules say whether it is allowed.
    if (rest[0] === 'creation') {
      if (rest[1] === 'check' && rest[2] && method === 'GET') return ok(await svc.creationCheck(campaign, actor, rest[2]));
      if (rest[1] && rest.length === 2 && method === 'POST') return ok(await svc.creationAct(campaign, actor, rest[1], await readJson(req)));
    }
    if (rest[0] === 'draft') {
      if (rest.length === 1 && method === 'GET') return ok(await svc.draftGet(campaign, actor));
      if (rest.length === 1 && method === 'PUT') {
        const b = await readJson(req);
        const chapters = Array.isArray(b.chapters) ? b.chapters : [];
        const origin = b.origin && typeof b.origin === 'object' ? { paragraphId: str((b.origin as Record<string, unknown>).paragraphId, 'origin.paragraphId') } : null;
        return ok(await svc.draftSave(campaign, actor, {
          veteran: b.veteran === true, origin,
          chapters: chapters.map((c: Record<string, unknown>) => ({ paragraphId: str(c.paragraphId, 'paragraphId'), summary: typeof c.summary === 'string' ? c.summary : '', endsBadly: c.endsBadly === true, testedBelief: c.testedBelief === true })),
        }));
      }
      if (rest[1] === 'import' && method === 'POST') return ok(await svc.draftImport(campaign, actor));
    }

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
      if (cardId && !action && method === 'DELETE') return ok(await svc.discard(campaign, actor, cardId));
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
    else if (e instanceof RuleViolation) send(res, ruleStatus(e), { error: { code: e.code, message: e.message } });
    else if (e instanceof DbError) send(res, DB_STATUS[e.code] ?? 400, { error: { code: e.code, message: e.message } });
    else {
      console.error('game route failed', e);
      send(res, 500, { error: { code: 'INTERNAL', message: 'Something went wrong' } });
    }
    return true;
  }
}
