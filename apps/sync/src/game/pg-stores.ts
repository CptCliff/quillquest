import type { Db } from '@quillquest/db';
import type { DocumentStore } from '../store';
import { campaignOf, draftOwner, isGmDoc } from './docnames';
import { emptyState, normalizeState, type GameState, type GameStore } from './store';

/** Game records in Postgres, one JSON row per campaign. */
export class PgGameStore implements GameStore {
  constructor(private db: Db) {}
  async load(campaign: string): Promise<GameState> {
    const raw = (await this.db.loadGameState(campaign)) as Partial<GameState> | null;
    return raw ? normalizeState(raw) : emptyState();
  }
  async save(campaign: string, state: GameState): Promise<void> {
    await this.db.saveGameState(campaign, state);
  }
}

/** The shared story document in Postgres, as one Yjs snapshot per campaign; a player's solo draft goes in its own private table. */
export class PgDocumentStore implements DocumentStore {
  constructor(private db: Db) {}
  load(name: string) {
    if (isGmDoc(name)) return this.db.loadGmDocument(campaignOf(name));
    const owner = draftOwner(name);
    return owner ? this.db.loadDraft(campaignOf(name), owner) : this.db.loadDocument(name);
  }
  save(name: string, state: Uint8Array) {
    if (isGmDoc(name)) return this.db.saveGmDocument(campaignOf(name), state);
    const owner = draftOwner(name);
    return owner ? this.db.saveDraft(campaignOf(name), owner, state) : this.db.saveDocument(name, state);
  }
}
