import type { Mailer } from '../mail';
import type { NotifyStore, QueuedNotification } from './store';

export interface NotifierDeps {
  store: NotifyStore;
  mailer: Mailer;
  /** User ids with the campaign open right now. Nobody is emailed while they do (design plan 10). */
  presence: (campaign: string) => ReadonlySet<string>;
  /** Origin that links start from, e.g. https://play.example.com */
  publicUrl: string;
  now?: () => Date;
  /** Messages wait this long and combine, so a busy scene sends one email, not ten. Default two minutes. */
  batchMs?: number;
  /** A daily digest waits this long. */
  digestMs?: number;
}

export interface Notice { kind: string; text: string; link: string; dedupeKey?: string }

/**
 * Who the story is waiting on, and telling them when they are away. Messages queue per person and campaign; `tick()` (run on an interval,
 * or by tests with a clock they control) sends each person one combined email once their oldest message has waited long enough.
 * A person with the campaign open gets nothing: they can see it. A person who chose "off" is never queued.
 */
export class Notifier {
  private now: () => Date;
  constructor(private d: NotifierDeps) { this.now = d.now ?? (() => new Date()); }

  async notify(campaign: string, userId: string, n: Notice): Promise<boolean> {
    if ((await this.d.store.mode(campaign, userId)) === 'off') return false;
    return this.d.store.enqueue({ campaignId: campaign, userId, ...n }, this.now());
  }

  async tick(): Promise<{ sent: number; dropped: number }> {
    const batchMs = this.d.batchMs ?? 120_000;
    const digestMs = this.d.digestMs ?? 24 * 60 * 60_000;
    const groups = new Map<string, QueuedNotification[]>();
    for (const n of await this.d.store.pending()) {
      const key = `${n.campaignId}\u0000${n.userId}`;
      groups.set(key, [...(groups.get(key) ?? []), n]);
    }
    let sent = 0; let dropped = 0;
    for (const items of groups.values()) {
      const { campaignId, userId } = items[0]!;
      const ids = items.map((i) => i.id);
      const mode = await this.d.store.mode(campaignId, userId);
      if (mode === 'off' || this.d.presence(campaignId).has(userId)) { await this.d.store.markSent(ids); dropped += ids.length; continue; }
      const wait = mode === 'digest' ? digestMs : batchMs;
      if (this.now().getTime() - items[0]!.createdAt.getTime() < wait) continue;
      const to = await this.d.store.email(userId);
      if (!to) { await this.d.store.markSent(ids); dropped += ids.length; continue; }
      const title = await this.d.store.campaignTitle(campaignId);
      const lines = items.map((i) => `- ${i.text}\n  ${this.d.publicUrl.replace(/\/$/, '')}${i.link}`);
      try {
        await this.d.mailer.send({
          to,
          subject: items.length === 1 ? `${title}: ${items[0]!.text}` : `${title}: ${items.length} things are waiting on you`,
          text: `${title}\n\n${lines.join('\n')}\n\nYou are getting this because the story is waiting on you. Change how often in the campaign's notification settings.`,
        });
      } catch { continue; } // stays queued; the next tick tries again
      await this.d.store.markSent(ids);
      sent += ids.length;
    }
    return { sent, dropped };
  }
}
