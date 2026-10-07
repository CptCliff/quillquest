import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { Db } from '@quillquest/db';
import type { Identity } from './auth';
import { DevProvider } from './auth/dev';
import { buildAuthFromEnv, verifyToken } from './auth/env';
import type { AuthProvider } from './auth/types';
import { PgDirectory, StaticDirectory, type Directory } from './directory';
import { PgDocumentStore, PgGameStore } from './game/pg-stores';
import { checkUpdate, extractSyncUpdate } from './enforce';
import { FileStore, type DocumentStore } from './store';
import { QueuedDice, type DiceProvider } from './game/dice';
import { HocuspocusDocPort } from './game/docport';
import { handleGameRequest } from './game/routes';
import { campaignOf, draftOwner, isGmDoc } from './game/docnames';
import { DirectorService } from './game/director';
import { GameService } from './game/service';
import { MemorySuggestionLog, PgSuggestionLog, type SuggestionLog } from './game/suggestions';
import { providerFromEnv, type LlmProvider } from './llm';
import { FakeMailer, mailerFromEnv, type Mailer } from './mail';
import { BattleService } from './game/battles';
import { Notifier } from './notify/notifier';
import { MemoryLayoutStore, PgLayoutStore } from './game/layouts';
import { MemoryNotifyStore, PgNotifyStore, type NotifyStore } from './notify/store';
import { FileGameStore, MemoryGameStore, type GameStore } from './game/store';

export interface SyncServerOptions {
  store: DocumentStore;
  /** Secret for the default dev provider, used when no `auth.providers` are given (tests, local dev). */
  secret?: string;
  port?: number;
  quiet?: boolean;
  /** How long to batch writes to the store (ms). Tests use a small value. */
  debounceMs?: number;
  /**
   * Who may connect. With a database, roles and colors come from memberships and the account routes are mounted; without
   * one, everyone is a member of every campaign with the role their dev token claims (tests and quick local runs only).
   */
  auth?: { providers?: AuthProvider[]; directory?: Directory; db?: Db };
  /** The game (cards, rolls, characters). Defaults to an in-memory store and random dice. */
  /** The language model behind the Claude assistant. Omitted means "not configured": its routes answer 501. */
  llm?: LlmProvider | null;
  /**
   * Async play (design plan 10). Without a mailer nothing is emailed and the rest of the game is unchanged. `devRoutes` mounts the routes that
   * read the fake outbox and move the notifier's clock (tests and browser runs only). Periodic jobs (mail batches, push windows, stalled-card
   * reminders) run every `intervalMs`; null turns the timer off (tests call the jobs themselves).
   */
  mail?: { mailer?: Mailer | null; publicUrl?: string; store?: NotifyStore; batchMs?: number; devRoutes?: boolean; intervalMs?: number | null };
  game?: { store?: GameStore; dice?: DiceProvider; /** Dev only: mounts the route that queues the next dice. */ devDice?: boolean; suggestions?: SuggestionLog };
}

/**
 * An update that broke the edit policy closes the sender's connection. The close code does not survive the trip to the
 * client (it arrives as 1000), so the reason string is the signal: it starts with this prefix and lists the violations.
 * The browser resets its local copy when it sees it.
 */
export const REJECTED_PREFIX = 'rejected:';
const REJECTED_CODE = 4403;

/** Why the server closed a socket because the person's standing in the campaign changed (they left). The browser rebuilds its session. */
export const MEMBERSHIP_CHANGED = 'membership-changed';

export function createSyncServer(opts: SyncServerOptions) {
  const dice = opts.game?.dice ?? new QueuedDice();
  const db = opts.auth?.db;
  const providers = opts.auth?.providers ?? [new DevProvider(opts.secret ?? 'dev-secret')];
  const directory = opts.auth?.directory ?? (db ? new PgDirectory(db) : new StaticDirectory());
  let game: ((req: IncomingMessage, res: ServerResponse) => Promise<boolean>) | null = null;
  const server = new Server({
    port: opts.port ?? 0,
    quiet: opts.quiet ?? true,
    stopOnSignals: false,
    debounce: opts.debounceMs ?? 500,
    maxDebounce: (opts.debounceMs ?? 500) * 10,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      // Who they are comes from a verified token; what they may do comes from their membership. Nothing the client says
      // about itself is trusted, and a stranger to the campaign never gets the document.
      const claims = await verifyToken(providers, token);
      if (db) await db.ensureProfile(claims.userId, claims.name ?? claims.email, claims.color, claims.email);
      const identity = await directory.resolve(claims, campaignOf(documentName));
      if (!identity) throw new Error('not a member of this campaign');
      // A solo draft is private: only its author may open it. The GM and the other players are strangers to it.
      const owner = draftOwner(documentName);
      if (owner && owner !== identity.id) throw new Error('not your draft');
      // The GM's notes are the GM's alone, and no one else is told they exist.
      if (isGmDoc(documentName) && identity.role !== 'gm') throw new Error('not allowed');
      // A member who left may still read the story. Hocuspocus drops every write on a read-only connection (its normal sync
      // handshake still works), so there is nothing for us to reject, and rejecting would only make their browser reconnect forever.
      if (identity.left) connectionConfig.readOnly = true;
      return { identity: identity satisfies Identity };
    },

    async onLoadDocument({ document, documentName }) {
      const saved = await opts.store.load(documentName);
      if (saved) Y.applyUpdate(document, saved);
      return document;
    },

    async onStoreDocument({ document, documentName }) {
      await opts.store.save(documentName, Y.encodeStateAsUpdate(document));
    },

    // The game API: JSON under /api/. Anything else gets Hocuspocus's normal answer.
    async onRequest({ request, response }) {
      if (game && (await game(request, response))) return Promise.reject(undefined); // handled: skip the default reply
    },

    async beforeHandleMessage({ update, document, context }) {
      const identity = context.identity as Identity;
      const inner = extractSyncUpdate(update);
      if (!inner) return;
      const { violations } = checkUpdate(document, inner, identity);
      if (violations.length) {
        const codes = [...new Set(violations.map((v) => v.code))].join(',');
        throw Object.assign(new Error(`rejected: ${codes}`), { code: REJECTED_CODE, reason: `${REJECTED_PREFIX}${codes}`.slice(0, 120) });
      }
    },

    // Cursor name and color come from the verified identity, so nobody can impersonate another writer's ink.
    async beforeHandleAwareness({ states, context }) {
      const identity = context.identity as Identity | undefined;
      if (!identity) return;
      for (const state of states.values()) state.user = { id: identity.id, name: identity.name, color: identity.color };
    },
  });
  // Async play: who is waiting on whom, and the mail that tells them when they are away.
  const mailer = opts.mail?.mailer ?? null;
  const notifyStore = opts.mail?.store ?? (db ? new PgNotifyStore(db) : new MemoryNotifyStore());
  let clockOffset = 0;
  const presence = (campaign: string): ReadonlySet<string> => {
    const ids = new Set<string>();
    server.hocuspocus.documents.get(campaign)?.connections.forEach((_entry, conn) => {
      const id = (conn.context as { identity?: Identity } | undefined)?.identity?.id;
      if (id) ids.add(id);
    });
    return ids;
  };
  const notifier = mailer ? new Notifier({ store: notifyStore, mailer, presence, publicUrl: opts.mail?.publicUrl ?? 'http://localhost:3000', batchMs: opts.mail?.batchMs, now: () => new Date(Date.now() + clockOffset) }) : null;
  const service = new GameService({
    store: opts.game?.store ?? (db ? new PgGameStore(db) : new MemoryGameStore()),
    dice,
    docs: new HocuspocusDocPort(server.hocuspocus),
    now: () => new Date(Date.now() + clockOffset),
    notify: notifier ? (campaign, userId, n) => { void notifier.notify(campaign, userId, n).catch(() => undefined); } : undefined,
    gmOf: db ? async (campaign) => (await db.listMembers(campaign)).find((m) => m.role === 'gm')?.userId ?? null : undefined,
  });
  const layoutStore = new MemoryLayoutStore();
  const docs = new HocuspocusDocPort(server.hocuspocus);
  const director = new DirectorService(service, { llm: opts.llm ?? null, log: (opts.game?.suggestions ?? (db ? new PgSuggestionLog(db) : new MemorySuggestionLog())), docs });
  const battles = new BattleService(service, { dice, docs, now: () => Date.now() + clockOffset });
  /** The periodic jobs. Each is safe to run at any time. */
  const jobs = async () => ({ mail: notifier ? await notifier.tick() : null, pushes: await battles.tick(), stalls: await service.checkStalls() });
  const timer = opts.mail?.intervalMs === null ? null : setInterval(() => { void jobs().catch((e) => console.error('background job failed', e)); }, opts.mail?.intervalMs ?? 30_000);
  timer?.unref();
  const stop = server.destroy.bind(server);
  server.destroy = async () => { if (timer) clearInterval(timer); return stop(); };
  /** Closes a person's live connections to one campaign; they reconnect and are authenticated afresh (as read-only if they left). */
  const dropConnections = (campaign: string, userId: string) => {
    server.hocuspocus.documents.get(campaign)?.connections.forEach((_entry, conn) => {
      if ((conn.context as { identity?: Identity } | undefined)?.identity?.id === userId) conn.close({ code: 1000, reason: MEMBERSHIP_CHANGED });
    });
  };
  game = (req, res) => handleGameRequest(req, res, { service, director, battles, layouts: db ? new PgLayoutStore(db) : layoutStore, notifyStore: notifier ? notifyStore : undefined, dev: opts.mail?.devRoutes && mailer instanceof FakeMailer ? { mail: { sent: () => mailer.sent, advance: (ms) => { clockOffset += ms; }, tick: jobs } } : undefined, dice, providers, directory, db, devDice: opts.game?.devDice ?? false, onMembershipChange: dropConnections });
  return Object.assign(server, { game: service, director, battles, notifier, jobs, mailer });
}

// Run directly: `pnpm --filter @quillquest/sync dev`
if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  const port = Number(env.PORT ?? 1234);
  const { providers, devAuth } = buildAuthFromEnv(env);
  const production = env.NODE_ENV === 'production';
  let db: Db | undefined;
  if (env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const { createDb, migrate } = await import('@quillquest/db');
    const { pgSql } = await import('@quillquest/db/pg');
    const sql = pgSql(new pg.Pool({ connectionString: env.DATABASE_URL }));
    await migrate(sql);
    db = createDb(sql);
  } else if (env.QUILLQUEST_DEV_PGLITE === '1' && !production) {
    // Zero-setup local Postgres, in process. Never in production.
    const { PGlite } = await import('@electric-sql/pglite');
    const { createDb, migrate } = await import('@quillquest/db');
    const { pgliteSql } = await import('@quillquest/db/pglite');
    const sql = pgliteSql(new PGlite(env.QUILLQUEST_PGLITE_DIR));
    await migrate(sql);
    db = createDb(sql);
  } else if (production) {
    throw new Error('DATABASE_URL is required in production');
  }
  const dir = env.DATA_DIR ?? './data';
  const server = createSyncServer({
    store: db ? new PgDocumentStore(db) : new FileStore(dir), port, quiet: false,
    auth: { providers, db },
    llm: providerFromEnv(env, production),
    mail: { mailer: mailerFromEnv(env, production), publicUrl: env.QUILLQUEST_PUBLIC_URL, devRoutes: devAuth && env.QUILLQUEST_DEV_MAIL === '1' },
    game: { store: db ? undefined : new FileGameStore(dir), devDice: devAuth && env.QUILLQUEST_DEV_DICE === '1' },
  });
  await server.listen();
}
