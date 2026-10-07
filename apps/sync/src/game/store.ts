import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Character, PromptCard } from '@quillquest/rules';

export interface OverrideEntry { at: string; gmId: string; action: 'retcon'; cardId: string }

/** Everything the game knows about one campaign. Dice live inside `cards[*].roll` and never leave the server unrevealed. */
export interface GameState {
  seq: number;
  cards: Record<string, PromptCard>;
  /** Card ids in creation order. */
  order: string[];
  characters: Record<string, Character>;
  /** user id -> character id */
  characterOf: Record<string, string>;
  overrides: OverrideEntry[];
}

export const emptyState = (): GameState => ({ seq: 0, cards: {}, order: [], characters: {}, characterOf: {}, overrides: [] });

export interface GameStore {
  load(campaign: string): Promise<GameState>;
  save(campaign: string, state: GameState): Promise<void>;
}

const safe = (c: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(c)) throw new Error(`bad campaign id: ${c}`);
  return c;
};

export class MemoryGameStore implements GameStore {
  private states = new Map<string, GameState>();
  async load(campaign: string) { return structuredClone(this.states.get(campaign) ?? emptyState()); }
  async save(campaign: string, state: GameState) { this.states.set(campaign, structuredClone(state)); }
}

export class FileGameStore implements GameStore {
  constructor(private dir: string) {}
  async load(campaign: string): Promise<GameState> {
    try {
      return JSON.parse(await readFile(join(this.dir, `${safe(campaign)}.game.json`), 'utf8')) as GameState;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
      throw e;
    }
  }
  async save(campaign: string, state: GameState) {
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${safe(campaign)}.game.json`);
    await writeFile(`${file}.tmp`, JSON.stringify(state));
    await rename(`${file}.tmp`, file);
  }
}
