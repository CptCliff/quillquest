import { randomBytes } from 'node:crypto';
import type { Db, NotifyMode, QueuedNotification } from '@quillquest/db';

export type { NotifyMode, QueuedNotification };
export interface NewNotification { campaignId: string; userId: string; kind: string; text: string; link: string; dedupeKey?: string }

/** Where queued messages, addresses and preferences live. Postgres in production; memory for tests and no-database runs. */
export interface NotifyStore {
  email(userId: string): Promise<string | null>;
  mode(campaign: string, userId: string): Promise<NotifyMode>;
  setMode(campaign: string, userId: string, mode: NotifyMode): Promise<void>;
  enqueue(n: NewNotification, at: Date): Promise<boolean>;
  pending(): Promise<QueuedNotification[]>;
  markSent(ids: string[]): Promise<void>;
  campaignTitle(campaign: string): Promise<string>;
}

export class PgNotifyStore implements NotifyStore {
  constructor(private db: Db) {}
  email(userId: string) { return this.db.getEmail(userId); }
  mode(c: string, u: string) { return this.db.getNotifyMode(c, u); }
  setMode(c: string, u: string, m: NotifyMode) { return this.db.setNotifyMode(c, u, m); }
  async enqueue(n: NewNotification) { return (await this.db.queueNotification(n)) !== null; }
  pending() { return this.db.pendingNotifications(); }
  markSent(ids: string[]) { return this.db.markNotificationsSent(ids); }
  async campaignTitle(campaign: string) { return (await this.db.getCampaign(campaign))?.title ?? 'Quillquest'; }
}

export class MemoryNotifyStore implements NotifyStore {
  emails = new Map<string, string>();
  modes = new Map<string, NotifyMode>();
  titles = new Map<string, string>();
  private rows: (QueuedNotification & { dedupeKey?: string; sent: boolean })[] = [];
  async email(userId: string) { return this.emails.get(userId) ?? null; }
  async mode(c: string, u: string) { return this.modes.get(`${c}|${u}`) ?? 'immediate'; }
  async setMode(c: string, u: string, m: NotifyMode) { this.modes.set(`${c}|${u}`, m); }
  async enqueue(n: NewNotification, at: Date) {
    if (n.dedupeKey && this.rows.some((r) => r.campaignId === n.campaignId && r.userId === n.userId && r.dedupeKey === n.dedupeKey)) return false;
    this.rows.push({ id: randomBytes(6).toString('base64url'), campaignId: n.campaignId, userId: n.userId, kind: n.kind, text: n.text, link: n.link, createdAt: at, dedupeKey: n.dedupeKey, sent: false });
    return true;
  }
  async pending() { return this.rows.filter((r) => !r.sent).map(({ dedupeKey: _d, sent: _s, ...r }) => r); }
  async markSent(ids: string[]) { for (const r of this.rows) if (ids.includes(r.id)) r.sent = true; }
  async campaignTitle(campaign: string) { return this.titles.get(campaign) ?? 'Quillquest'; }
}
