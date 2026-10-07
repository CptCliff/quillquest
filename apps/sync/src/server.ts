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
import { GameService } from './game/service';
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
  game?: { store?: GameStore; dice?: DiceProvider; /** Dev only: mounts the route that queues the next dice. */ devDice?: boolean };
}

/**
 * An update that broke the edit policy closes the sender's connection. The close code does not survive the trip to the
 * client (it arrives as 1000), so the reason string is the signal: it starts with this prefix and lists the violations.
 * The browser resets its local copy when it sees it.
 */
export const REJECTED_PREFIX = 'rejected:';
const REJECTED_CODE = 4403;

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
      if (db) await db.ensureProfile(claims.userId, claims.name ?? claims.email, claims.color);
      const identity = await directory.resolve(claims, documentName);
      if (!identity) throw new Error('not a member of this campaign');
      if (identity.left) connectionConfig.readOnly = true; // a member who left may still read the story
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
      if (identity.left) throw Object.assign(new Error('rejected: LEFT'), { code: REJECTED_CODE, reason: `${REJECTED_PREFIX}LEFT` });
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
  const service = new GameService({
    store: opts.game?.store ?? (db ? new PgGameStore(db) : new MemoryGameStore()),
    dice,
    docs: new HocuspocusDocPort(server.hocuspocus),
  });
  game = (req, res) => handleGameRequest(req, res, { service, dice, providers, directory, db, devDice: opts.game?.devDice ?? false });
  return Object.assign(server, { game: service });
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
    game: { store: db ? undefined : new FileGameStore(dir), devDice: devAuth && env.QUILLQUEST_DEV_DICE === '1' },
  });
  await server.listen();
}
