import { randomBytes } from 'node:crypto';
import type { Db, Suggestion, SuggestionStatus } from '@quillquest/db';

export type { Suggestion, SuggestionStatus };
export interface NewSuggestion { campaignId: string; userId: string; kind: string; input: unknown; output: unknown; sessionNo: number; provider: string; status?: SuggestionStatus }

/** Every Claude answer is logged (design plan 8.3). The log also counts a session's calls against the GM's cap. */
export interface SuggestionLog {
  add(s: NewSuggestion): Promise<Suggestion>;
  list(campaign: string, opts?: { userId?: string; limit?: number }): Promise<Suggestion[]>;
  count(campaign: string, sessionNo: number): Promise<number>;
  /** Returns false when there is no such suggestion in this campaign. */
  setStatus(campaign: string, id: string, status: SuggestionStatus): Promise<boolean>;
}

export class PgSuggestionLog implements SuggestionLog {
  constructor(private db: Db) {}
  add(s: NewSuggestion) { return this.db.addSuggestion(s); }
  list(campaign: string, opts?: { userId?: string; limit?: number }) { return this.db.listSuggestions(campaign, opts); }
  count(campaign: string, sessionNo: number) { return this.db.countSuggestions(campaign, sessionNo); }
  async setStatus(campaign: string, id: string, status: SuggestionStatus) {
    try { await this.db.setSuggestionStatus(campaign, id, status); return true; } catch (e) { if ((e as { code?: string }).code === 'NOT_FOUND') return false; throw e; }
  }
}

export class MemorySuggestionLog implements SuggestionLog {
  private rows: Suggestion[] = [];
  async add(s: NewSuggestion) {
    const row: Suggestion = { id: randomBytes(8).toString('base64url'), campaignId: s.campaignId, userId: s.userId, kind: s.kind, input: structuredClone(s.input), output: structuredClone(s.output), status: s.status ?? 'shown', sessionNo: s.sessionNo, provider: s.provider, createdAt: new Date() };
    this.rows.push(row);
    return row;
  }
  async list(campaign: string, opts: { userId?: string; limit?: number } = {}) {
    return this.rows.filter((r) => r.campaignId === campaign && (!opts.userId || r.userId === opts.userId)).reverse().slice(0, opts.limit ?? 100).map((r) => structuredClone(r));
  }
  async count(campaign: string, sessionNo: number) { return this.rows.filter((r) => r.campaignId === campaign && r.sessionNo === sessionNo).length; }
  async setStatus(campaign: string, id: string, status: SuggestionStatus) {
    const r = this.rows.find((x) => x.id === id && x.campaignId === campaign);
    if (!r) return false;
    r.status = status;
    return true;
  }
}
