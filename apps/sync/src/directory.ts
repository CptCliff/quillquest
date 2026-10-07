import type { Db } from '@quillquest/db';
import type { Claims } from './auth/types';
import type { Identity } from './auth';

/** Who is this person in this campaign? The answer, not the token, decides what they may do. */
export interface Directory {
  /** Null means "not a member": no document, no routes. */
  resolve(claims: Claims, campaign: string): Promise<Identity | null>;
}

/** Dev and tests with no database: everyone is a member of every campaign, with the role their dev token claims. */
export class StaticDirectory implements Directory {
  async resolve(c: Claims): Promise<Identity | null> {
    if (!c.role) return null;
    return { id: c.userId, name: c.name ?? c.userId, role: c.role, color: c.color ?? '#444444' };
  }
}

/** Real accounts: role, ink color and display name come from the membership row. A token's own role claim is ignored. */
export class PgDirectory implements Directory {
  constructor(private db: Db) {}
  async resolve(c: Claims, campaign: string): Promise<Identity | null> {
    const m = await this.db.getMember(campaign, c.userId);
    return m ? { id: m.userId, name: m.displayName, role: m.role, color: m.color, left: m.left } : null;
  }
}
