import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { authenticate, type Identity } from './auth';
import { checkUpdate, extractSyncUpdate } from './enforce';
import { FileStore, type DocumentStore } from './store';
import { QueuedDice, type DiceProvider } from './game/dice';
import { HocuspocusDocPort } from './game/docport';
import { handleGameRequest } from './game/routes';
import { GameService } from './game/service';
import { FileGameStore, MemoryGameStore, type GameStore } from './game/store';

export interface SyncServerOptions {
  store: DocumentStore;
  /** Dev token secret. M4 replaces token verification entirely. */
  secret: string;
  port?: number;
  quiet?: boolean;
  /** How long to batch writes to the store (ms). Tests use a small value. */
  debounceMs?: number;
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
  let game: ((req: IncomingMessage, res: ServerResponse) => Promise<boolean>) | null = null;
  const server = new Server({
    port: opts.port ?? 0,
    quiet: opts.quiet ?? true,
    stopOnSignals: false,
    debounce: opts.debounceMs ?? 500,
    maxDebounce: (opts.debounceMs ?? 500) * 10,

    async onAuthenticate({ token }) {
      // Identity comes from the signed token only. Nothing the client says about itself is trusted.
      return { identity: authenticate(token, opts.secret) satisfies Identity };
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
  const service = new GameService({
    store: opts.game?.store ?? new MemoryGameStore(),
    dice,
    docs: new HocuspocusDocPort(server.hocuspocus),
  });
  game = (req, res) => handleGameRequest(req, res, { service, dice, secret: opts.secret, devDice: opts.game?.devDice ?? false });
  return Object.assign(server, { game: service });
}

// Run directly: `pnpm --filter @quillquest/sync dev`
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 1234);
  const secret = process.env.QUILLQUEST_DEV_SECRET ?? 'dev-secret';
  const dir = process.env.DATA_DIR ?? './data';
  const server = createSyncServer({
    store: new FileStore(dir), secret, port, quiet: false,
    game: { store: new FileGameStore(dir), devDice: process.env.QUILLQUEST_DEV_DICE === '1' },
  });
  await server.listen();
}
