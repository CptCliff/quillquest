import type { Db } from '@quillquest/db';
import type { DocumentStore } from '../store';
import { emptyState, type GameState, type GameStore } from './store';

/** Game records in Postgres, one JSON row per campaign. */
export class PgGameStore implements GameStore {
  constructor(private db: Db) {}
  async load(campaign: string): Promise<GameState> {
    return ((await this.db.loadGameState(campaign)) as GameState | null) ?? emptyState();
  }
  async save(campaign: string, state: GameState): Promise<void> {
    await this.db.saveGameState(campaign, state);
  }
}

/** The shared story document in Postgres, as one Yjs snapshot per campaign. */
export class PgDocumentStore implements DocumentStore {
  constructor(private db: Db) {}
  load(name: string) { return this.db.loadDocument(name); }
  save(name: string, state: Uint8Array) { return this.db.saveDocument(name, state); }
}
