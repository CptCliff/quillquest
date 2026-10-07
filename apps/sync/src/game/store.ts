import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BattleCard, CanonEntry, CheckOverride, Character, ConvictionLogEntry, CreationState, CrossingProposal, Draft, Nomination, Npc, PromptCard, Spotlight } from '@quillquest/rules';

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
  /** Session zero: the campaign's phase, each character's creation progress, the Canon, crossing proposals, and logged check overrides. */
  phase: 'sessionZero' | 'playing';
  creation: Record<string, CreationState>;
  canon: CanonEntry[];
  proposals: CrossingProposal[];
  checkOverrides: CheckOverride[];
  /** Counter for ids made by the creation rules. */
  wseq: number;
  /** Solo-draft trackers by user id. The draft prose itself is a private document; this is only its bookkeeping. */
  drafts: Record<string, Draft>;
  /** The GM's table (M6). NPC sheets keep their hidden fields here and nowhere else; only revealed fields are ever published. */
  npcs: Record<string, Npc>;
  nominations: Nomination[];
  convictionLog: ConvictionLogEntry[];
  /** Counter for ids made by the Director rules. */
  dseq: number;
  /** Which session of play this is; Beliefs earn Conviction again each session, and the Claude call cap is per session. */
  sessionNo: number;
  /** Themes to handle lightly or leave out (public: every prompt carries them). */
  themes: string;
  /** The campaign's six table-written Burden faces (GM only). */
  faces: string[];
  /** Claude calls allowed per session; 0 turns the assistant off. */
  llmCap: number;
  /** Battle cards (M7). Each keeps its roll, so this is server-only; the public map carries words. */
  battles: Record<string, BattleCard>;
  /** The spotlight: whose post is next. */
  spotlight: Spotlight;
  /** Minutes contributors have to withdraw when the lead pushes a battle. */
  pushWindowMinutes: number;
  /** Hours a card or battle may wait before the GM is reminded; 0 turns reminders off. */
  stallHours: number;
  /** When the table started waiting on something: key `card:<id>` or `battle:<id>` -> epoch ms. */
  waits: Record<string, number>;
  /** The campaign's GM, learned from the first GM request. */
  gmId: string | null;
}

export const emptyState = (): GameState => ({
  seq: 0, cards: {}, order: [], characters: {}, characterOf: {}, overrides: [],
  phase: 'sessionZero', creation: {}, canon: [], proposals: [], checkOverrides: [], wseq: 0, drafts: {},
  npcs: {}, nominations: [], convictionLog: [], dseq: 0, sessionNo: 1, themes: '', faces: [], llmCap: 30,
  battles: {}, spotlight: { players: [], holder: null, leftOut: {} }, pushWindowMinutes: 10, stallHours: 0, waits: {}, gmId: null,
});

/**
 * Fills in what older records lack. A campaign saved before M5 is already being played: its characters are ready and its
 * phase is `playing`, so nothing changes for a table that began before session zero existed.
 */
export function normalizeState(raw: Partial<GameState>): GameState {
  const base = { ...emptyState(), ...raw } as GameState;
  if (!raw.phase) {
    base.phase = 'playing';
    for (const id of Object.keys(base.characters)) {
      base.creation[id] ??= { status: 'ready', veteran: false, origin: { paragraphId: null, skill: null, connection: null }, chapters: [], swapUsed: false, hookThreadId: null, burdenChosen: false, standingPrompts: [] };
    }
  }
  return base;
}

export interface GameStore {
  load(campaign: string): Promise<GameState>;
  save(campaign: string, state: GameState): Promise<void>;
  /** Every campaign with saved game state, for the periodic jobs (push windows, stalled-card reminders). */
  campaigns(): Promise<string[]>;
}

const safe = (c: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(c)) throw new Error(`bad campaign id: ${c}`);
  return c;
};

export class MemoryGameStore implements GameStore {
  private states = new Map<string, GameState>();
  /** Tests start tables already in play; a real table starts in session zero. */
  constructor(private opts: { phase?: GameState['phase'] } = {}) {}
  async load(campaign: string) { return structuredClone(this.states.get(campaign) ?? { ...emptyState(), phase: this.opts.phase ?? 'sessionZero' }); }
  async save(campaign: string, state: GameState) { this.states.set(campaign, structuredClone(state)); }
  async campaigns() { return [...this.states.keys()]; }
}

export class FileGameStore implements GameStore {
  constructor(private dir: string) {}
  async load(campaign: string): Promise<GameState> {
    try {
      return normalizeState(JSON.parse(await readFile(join(this.dir, `${safe(campaign)}.game.json`), 'utf8')) as Partial<GameState>);
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
  async campaigns() {
    try { return (await readdir(this.dir)).filter((f) => f.endsWith('.game.json')).map((f) => f.slice(0, -'.game.json'.length)); } catch { return []; }
  }
}
