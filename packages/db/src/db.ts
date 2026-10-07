import { createHash, randomBytes } from 'node:crypto';
import { isHexColor, pickColor } from './colors';
import { DbError, isForeignKeyViolation, isUniqueViolation, type Sql } from './sql';

export interface Profile { userId: string; displayName: string; preferredColor: string | null }
export interface Campaign { id: string; title: string; gmUserId: string }
export interface Member { campaignId: string; userId: string; role: 'gm' | 'player'; color: string; left: boolean; displayName: string }
export interface CampaignSummary { id: string; title: string; role: 'gm' | 'player'; color: string; left: boolean }
export type InviteStatus = 'open' | 'used' | 'revoked' | 'expired';
export interface InviteInfo { id: string; createdAt: Date; expiresAt: Date; status: InviteStatus; acceptedBy: string | null }

export interface DbOptions { now?: () => Date }

const WEEK = 7 * 24 * 60 * 60 * 1000;
const RETRIES = 6;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

type Row = Record<string, unknown>;
const member = (r: Row): Member => ({
  campaignId: r.campaign_id as string, userId: r.user_id as string, role: r.role as 'gm' | 'player', color: r.color as string,
  left: r.left_at != null, displayName: r.display_name as string,
});

const MEMBER_SQL = `select m.campaign_id, m.user_id, m.role, m.color, m.left_at, p.display_name
  from memberships m join profiles p on p.user_id = m.user_id`;

/** Every account, campaign, membership and invite fact. Pure data access: no HTTP, no identity provider. */
export function createDb(sql: Sql, opts: DbOptions = {}) {
  const now = () => opts.now?.() ?? new Date();

  async function profileIn(q: Sql, userId: string): Promise<Profile | null> {
    const r = (await q.query<Row>('select user_id, display_name, preferred_color from profiles where user_id = $1', [userId])).rows[0];
    return r ? { userId: r.user_id as string, displayName: r.display_name as string, preferredColor: (r.preferred_color as string | null) ?? null } : null;
  }

  async function getMemberIn(q: Sql, campaignId: string, userId: string): Promise<Member | null> {
    const r = (await q.query<Row>(`${MEMBER_SQL} where m.campaign_id = $1 and m.user_id = $2`, [campaignId, userId])).rows[0];
    return r ? member(r) : null;
  }

  /** Seats a player (or re-seats a leaver) with a free color. Caller supplies the transaction. */
  async function seatPlayer(tx: Sql, campaignId: string, userId: string): Promise<{ member: Member; joined: boolean }> {
    const camp = (await tx.query('select 1 from campaigns where id = $1', [campaignId])).rows[0];
    if (!camp) throw new DbError('NOT_FOUND', 'No such campaign');
    const profile = await profileIn(tx, userId);
    if (!profile) throw new DbError('NO_PROFILE', 'Set up your profile first');
    const existing = await getMemberIn(tx, campaignId, userId);
    if (existing && !existing.left) return { member: existing, joined: false };
    const taken = (await tx.query<{ color: string }>('select color from memberships where campaign_id = $1 and left_at is null', [campaignId])).rows.map((r) => r.color);
    const color = pickColor(taken, profile.preferredColor);
    if (existing) await tx.query('update memberships set left_at = null, color = $3, joined_at = $4 where campaign_id = $1 and user_id = $2', [campaignId, userId, color, now()]);
    else await tx.query(`insert into memberships (campaign_id, user_id, role, color, joined_at) values ($1, $2, 'player', $3, $4)`, [campaignId, userId, color, now()]);
    return { member: (await getMemberIn(tx, campaignId, userId))!, joined: true };
  }

  /** A concurrent join can take the color we picked; the unique index says so, and we pick again. */
  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (!isUniqueViolation(e) || i >= RETRIES) throw e; }
    }
  }

  return {
    // ---- profiles ----------------------------------------------------------------------------------------------------
    async upsertProfile(userId: string, p: { displayName: string; preferredColor?: string | null }): Promise<void> {
      const name = p.displayName.trim();
      if (name.length < 1 || name.length > 40) throw new DbError('BAD_INPUT', 'A display name is 1 to 40 characters');
      if (p.preferredColor != null && !isHexColor(p.preferredColor)) throw new DbError('BAD_INPUT', 'A color looks like #1d4ed8');
      await sql.query(
        `insert into profiles (user_id, display_name, preferred_color) values ($1, $2, $3)
         on conflict (user_id) do update set display_name = excluded.display_name,
           preferred_color = coalesce($3, profiles.preferred_color), updated_at = now()`,
        [userId, name, p.preferredColor?.toLowerCase() ?? null],
      );
    },
    /** First sign-in: a profile named from a name or an email, never overwriting one the person already chose. */
    async ensureProfile(userId: string, hint?: string | null, preferredColor?: string | null): Promise<void> {
      const name = (hint?.split('@')[0]?.trim() || 'Player').slice(0, 40);
      const color = isHexColor(preferredColor) ? preferredColor.toLowerCase() : null;
      await sql.query('insert into profiles (user_id, display_name, preferred_color) values ($1, $2, $3) on conflict (user_id) do nothing', [userId, name, color]);
    },
    getProfile: (userId: string) => profileIn(sql, userId),

    // ---- campaigns and members ---------------------------------------------------------------------------------------
    async createCampaign(i: { title: string; gmUserId: string }): Promise<Campaign> {
      const title = i.title.trim();
      if (title.length < 1 || title.length > 80) throw new DbError('BAD_INPUT', 'A campaign title is 1 to 80 characters');
      const id = randomBytes(8).toString('base64url');
      await sql.transaction(async (tx) => {
        const profile = await profileIn(tx, i.gmUserId);
        if (!profile) throw new DbError('NO_PROFILE', 'Set up your profile first');
        await tx.query('insert into campaigns (id, title, gm_user_id) values ($1, $2, $3)', [id, title, i.gmUserId]);
        await tx.query(`insert into memberships (campaign_id, user_id, role, color, joined_at) values ($1, $2, 'gm', $3, $4)`, [id, i.gmUserId, pickColor([], profile.preferredColor), now()]);
      });
      return { id, title, gmUserId: i.gmUserId };
    },
    async getCampaign(id: string): Promise<Campaign | null> {
      const r = (await sql.query<Row>('select id, title, gm_user_id from campaigns where id = $1', [id])).rows[0];
      return r ? { id: r.id as string, title: r.title as string, gmUserId: r.gm_user_id as string } : null;
    },
    getMember: (campaignId: string, userId: string) => getMemberIn(sql, campaignId, userId),
    async listMembers(campaignId: string): Promise<Member[]> {
      return (await sql.query<Row>(`${MEMBER_SQL} where m.campaign_id = $1 order by m.joined_at, m.user_id`, [campaignId])).rows.map(member);
    },
    async listCampaignsFor(userId: string): Promise<CampaignSummary[]> {
      const rows = (await sql.query<Row>(
        `select c.id, c.title, m.role, m.color, m.left_at from memberships m join campaigns c on c.id = m.campaign_id
         where m.user_id = $1 order by c.created_at, c.id`, [userId])).rows;
      return rows.map((r) => ({ id: r.id as string, title: r.title as string, role: r.role as 'gm' | 'player', color: r.color as string, left: r.left_at != null }));
    },
    async addPlayer(campaignId: string, userId: string): Promise<Member> {
      return withRetry(() => sql.transaction(async (tx) => (await seatPlayer(tx, campaignId, userId)).member));
    },
    async leave(campaignId: string, userId: string): Promise<void> {
      const m = await getMemberIn(sql, campaignId, userId);
      if (!m) throw new DbError('NOT_A_MEMBER', 'You are not in this campaign');
      if (m.role === 'gm') throw new DbError('GM_CANNOT_LEAVE', 'The GM cannot leave their own campaign');
      if (m.left) return;
      await sql.query('update memberships set left_at = $3 where campaign_id = $1 and user_id = $2', [campaignId, userId, now()]);
    },

    // ---- invites -----------------------------------------------------------------------------------------------------
    /** Returns the token once. Only its hash is stored. */
    async createInvite(campaignId: string, createdBy: string, ttlMs = WEEK): Promise<{ id: string; token: string; expiresAt: Date }> {
      const m = await getMemberIn(sql, campaignId, createdBy);
      if (!m || m.left || m.role !== 'gm') throw new DbError('NOT_GM', 'Only the GM can invite players');
      const id = randomBytes(6).toString('base64url');
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now().getTime() + ttlMs);
      await sql.query('insert into invites (id, campaign_id, token_hash, created_by, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)', [id, campaignId, hash(token), createdBy, now(), expiresAt]);
      return { id, token, expiresAt };
    },
    async listInvites(campaignId: string): Promise<InviteInfo[]> {
      const rows = (await sql.query<Row>('select id, created_at, expires_at, revoked_at, accepted_by, accepted_at from invites where campaign_id = $1 order by created_at desc, id', [campaignId])).rows;
      return rows.map((r) => {
        const expiresAt = new Date(r.expires_at as string);
        const status: InviteStatus = r.accepted_at ? 'used' : r.revoked_at ? 'revoked' : expiresAt <= now() ? 'expired' : 'open';
        return { id: r.id as string, createdAt: new Date(r.created_at as string), expiresAt, status, acceptedBy: (r.accepted_by as string | null) ?? null };
      });
    },
    async revokeInvite(campaignId: string, inviteId: string): Promise<void> {
      const r = await sql.query('update invites set revoked_at = coalesce(revoked_at, $3) where id = $1 and campaign_id = $2', [inviteId, campaignId, now()]);
      if (r.rowCount === 0) throw new DbError('NOT_FOUND', 'No such invite');
    },
    /** Single use. The same account accepting again is a no-op; anyone else is told it is used. */
    async acceptInvite(token: string, userId: string): Promise<{ campaignId: string; status: 'joined' | 'already-member' }> {
      return withRetry(() => sql.transaction(async (tx) => {
        const inv = (await tx.query<Row>('select id, campaign_id, expires_at, revoked_at, accepted_by from invites where token_hash = $1 for update', [hash(token)])).rows[0];
        if (!inv) throw new DbError('NOT_FOUND', 'That invite link is not valid');
        const campaignId = inv.campaign_id as string;
        if (inv.accepted_by === userId) return { campaignId, status: 'already-member' as const };
        if (inv.accepted_by) throw new DbError('INVITE_USED', 'That invite has already been used');
        if (inv.revoked_at) throw new DbError('INVITE_REVOKED', 'That invite was cancelled');
        if (new Date(inv.expires_at as string) <= now()) throw new DbError('INVITE_EXPIRED', 'That invite has expired');
        const seat = await seatPlayer(tx, campaignId, userId);
        await tx.query('update invites set accepted_by = $2, accepted_at = $3 where id = $1', [inv.id, userId, now()]);
        return { campaignId, status: seat.joined ? ('joined' as const) : ('already-member' as const) };
      }));
    },

    // ---- snapshots (game records and the shared document) ------------------------------------------------------------
    async loadGameState(campaignId: string): Promise<unknown | null> {
      const r = (await sql.query<{ state: unknown }>('select state from game_state where campaign_id = $1', [campaignId])).rows[0];
      return r ? r.state : null;
    },
    async saveGameState(campaignId: string, state: unknown): Promise<void> {
      try {
        await sql.query(`insert into game_state (campaign_id, state) values ($1, $2::jsonb) on conflict (campaign_id) do update set state = excluded.state, updated_at = now()`, [campaignId, JSON.stringify(state)]);
      } catch (e) { if (isForeignKeyViolation(e)) throw new DbError('NOT_FOUND', 'No such campaign'); throw e; }
    },
    async loadDocument(campaignId: string): Promise<Uint8Array | null> {
      const r = (await sql.query<{ state: Uint8Array }>('select state from documents where campaign_id = $1', [campaignId])).rows[0];
      return r ? new Uint8Array(r.state) : null;
    },
    async saveDocument(campaignId: string, state: Uint8Array): Promise<void> {
      try {
        await sql.query(`insert into documents (campaign_id, state) values ($1, $2) on conflict (campaign_id) do update set state = excluded.state, updated_at = now()`, [campaignId, state]);
      } catch (e) { if (isForeignKeyViolation(e)) throw new DbError('NOT_FOUND', 'No such campaign'); throw e; }
    },
  };
}
export type Db = ReturnType<typeof createDb>;
