import type { Db } from '@quillquest/db';

export type Device = 'wide' | 'phone';

/** Where each person's workspace layout is kept: per campaign, per person, per form factor. Never readable by anyone else. */
export interface LayoutStore {
  get(campaign: string, userId: string, device: Device): Promise<unknown | null>;
  put(campaign: string, userId: string, device: Device, layout: unknown): Promise<void>;
  del(campaign: string, userId: string, device: Device): Promise<void>;
}

export class PgLayoutStore implements LayoutStore {
  constructor(private db: Db) {}
  get(c: string, u: string, d: Device) { return this.db.getLayout(c, u, d); }
  put(c: string, u: string, d: Device, l: unknown) { return this.db.saveLayout(c, u, d, l); }
  del(c: string, u: string, d: Device) { return this.db.deleteLayout(c, u, d); }
}

export class MemoryLayoutStore implements LayoutStore {
  private rows = new Map<string, unknown>();
  private key = (c: string, u: string, d: Device) => `${c}\u0000${u}\u0000${d}`;
  async get(c: string, u: string, d: Device) { return structuredClone(this.rows.get(this.key(c, u, d)) ?? null); }
  async put(c: string, u: string, d: Device, l: unknown) { this.rows.set(this.key(c, u, d), structuredClone(l)); }
  async del(c: string, u: string, d: Device) { this.rows.delete(this.key(c, u, d)); }
}
