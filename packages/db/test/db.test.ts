import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbError, PALETTE, migrate, pickColor } from '../src';
import { freshDb, withUsers, type Harness } from './harness';

let h: Harness;
beforeAll(async () => { h = await freshDb(); await withUsers(h, 'gm', 'ilse', 'sella', 'rook', 'wren', 'stranger'); });
afterAll(() => h.close());
const fails = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e, `expected ${code}`).toBeInstanceOf(DbError);
  expect((e as DbError).code).toBe(code);
};

describe('migrations', () => {
  it('are idempotent and recorded', async () => {
    await migrate(h.sql);
    await migrate(h.sql);
    const { rows } = await h.sql.query<{ name: string }>('select name from schema_migrations order by name');
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
  });
});

describe('profiles', () => {
  it('upserts a display name and a preferred color, and rejects bad input', async () => {
    await h.db.upsertProfile('wren', { displayName: 'Wren', preferredColor: '#0E7490' });
    expect(await h.db.getProfile('wren')).toMatchObject({ userId: 'wren', displayName: 'Wren', preferredColor: '#0e7490' });
    await h.db.upsertProfile('wren', { displayName: 'Wren the Quick' });
    expect((await h.db.getProfile('wren'))?.displayName).toBe('Wren the Quick');
    expect((await h.db.getProfile('wren'))?.preferredColor).toBe('#0e7490'); // an update without a color keeps it
    await fails(h.db.upsertProfile('x', { displayName: '' }), 'BAD_INPUT');
    await fails(h.db.upsertProfile('x', { displayName: 'a'.repeat(41) }), 'BAD_INPUT');
    await fails(h.db.upsertProfile('x', { displayName: 'X', preferredColor: 'red' }), 'BAD_INPUT');
    expect(await h.db.getProfile('nobody')).toBeNull();
  });
  it('ensureProfile creates once and never overwrites a chosen name', async () => {
    await h.db.ensureProfile('newbie', 'newbie@example.com');
    expect((await h.db.getProfile('newbie'))?.displayName).toBe('newbie');
    await h.db.upsertProfile('newbie', { displayName: 'Chosen' });
    await h.db.ensureProfile('newbie', 'newbie@example.com');
    expect((await h.db.getProfile('newbie'))?.displayName).toBe('Chosen');
  });
});

describe('campaigns and colors', () => {
  it('creating a campaign makes the creator its one GM, with a color', async () => {
    const c = await h.db.createCampaign({ title: 'The Border War', gmUserId: 'gm' });
    expect(c.id).toMatch(/^[A-Za-z0-9_-]{6,64}$/);
    expect(await h.db.getMember(c.id, 'gm')).toMatchObject({ role: 'gm', displayName: 'Gm', left: false });
    expect((await h.db.getMember(c.id, 'gm'))?.color).toMatch(/^#[0-9a-f]{6}$/);
    await fails(h.db.createCampaign({ title: '', gmUserId: 'gm' }), 'BAD_INPUT');
    await fails(h.db.createCampaign({ title: 'x', gmUserId: 'ghost' }), 'NO_PROFILE');
  });
  it('the database itself refuses a second GM', async () => {
    const c = await h.db.createCampaign({ title: 'Two GMs', gmUserId: 'gm' });
    await expect(h.pg.query(`insert into memberships (campaign_id, user_id, role, color) values ($1, 'ilse', 'gm', '#111111')`, [c.id])).rejects.toThrow(/duplicate|unique/i);
  });
  it('players get distinct colors; a free preferred color is honored, a taken one is nudged to the nearest free', async () => {
    const c = await h.db.createCampaign({ title: 'Colors', gmUserId: 'gm' });
    const gmColor = (await h.db.getMember(c.id, 'gm'))!.color;
    await h.db.upsertProfile('ilse', { displayName: 'Ilse', preferredColor: '#112233' });
    const a = await h.db.addPlayer(c.id, 'ilse');
    expect(a.color).toBe('#112233');
    await h.db.upsertProfile('sella', { displayName: 'Sella', preferredColor: '#112233' }); // taken
    const b = await h.db.addPlayer(c.id, 'sella');
    expect(b.color).not.toBe('#112233');
    await h.db.upsertProfile('ilse', { displayName: 'Ilse', preferredColor: '#c2410c' });
    const all = (await h.db.listMembers(c.id)).map((m) => m.color.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain(gmColor.toLowerCase());
  });
  it('the database refuses a duplicate color among active members, case-insensitively', async () => {
    const c = await h.db.createCampaign({ title: 'Dup', gmUserId: 'gm' });
    const gmColor = (await h.db.getMember(c.id, 'gm'))!.color;
    await expect(h.pg.query(`insert into memberships (campaign_id, user_id, role, color) values ($1, 'ilse', 'player', $2)`, [c.id, gmColor.toUpperCase()])).rejects.toThrow(/duplicate|unique/i);
  });
  it('concurrent joins all succeed with distinct colors', async () => {
    const c = await h.db.createCampaign({ title: 'Crowd', gmUserId: 'gm' });
    const ids = ['ilse', 'sella', 'rook', 'wren', 'stranger'];
    const got = await Promise.all(ids.map((u) => h.db.addPlayer(c.id, u)));
    expect(new Set(got.map((m) => m.color.toLowerCase())).size).toBe(ids.length);
  });
  it('a campaign past the palette still gets unique colors', async () => {
    const c = await h.db.createCampaign({ title: 'Huge', gmUserId: 'gm' });
    for (let i = 0; i < PALETTE.length + 3; i++) {
      await h.db.upsertProfile(`bulk${i}`, { displayName: `Bulk ${i}` });
      await h.db.addPlayer(c.id, `bulk${i}`);
    }
    const colors = (await h.db.listMembers(c.id)).map((m) => m.color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });
  it('joining twice is a no-op; a non-existent campaign or user is refused', async () => {
    const c = await h.db.createCampaign({ title: 'Twice', gmUserId: 'gm' });
    const a = await h.db.addPlayer(c.id, 'ilse');
    const b = await h.db.addPlayer(c.id, 'ilse');
    expect(b).toEqual(a);
    await fails(h.db.addPlayer('nope-nope', 'ilse'), 'NOT_FOUND');
    await fails(h.db.addPlayer(c.id, 'ghost'), 'NO_PROFILE');
  });
  it('lists a user\'s campaigns with their role and color', async () => {
    const c = await h.db.createCampaign({ title: 'Mine', gmUserId: 'gm' });
    await h.db.addPlayer(c.id, 'rook');
    const mine = await h.db.listCampaignsFor('rook');
    expect(mine).toContainEqual(expect.objectContaining({ id: c.id, title: 'Mine', role: 'player', left: false }));
    expect((await h.db.listCampaignsFor('gm')).find((x) => x.id === c.id)?.role).toBe('gm');
  });
});

describe('leaving', () => {
  it('a player can leave and is then marked left; their color is freed and they can rejoin', async () => {
    const c = await h.db.createCampaign({ title: 'Leavers', gmUserId: 'gm' });
    const before = await h.db.addPlayer(c.id, 'sella');
    await h.db.leave(c.id, 'sella');
    expect(await h.db.getMember(c.id, 'sella')).toMatchObject({ left: true });
    await h.db.upsertProfile('rook', { displayName: 'Rook', preferredColor: before.color });
    expect((await h.db.addPlayer(c.id, 'rook')).color).toBe(before.color); // the freed color is available
    const back = await h.db.addPlayer(c.id, 'sella');
    expect(back.left).toBe(false);
    expect(back.color.toLowerCase()).not.toBe(before.color.toLowerCase()); // rook has it now
  });
  it('the GM cannot leave their own campaign; a non-member cannot leave', async () => {
    const c = await h.db.createCampaign({ title: 'Stay', gmUserId: 'gm' });
    await fails(h.db.leave(c.id, 'gm'), 'GM_CANNOT_LEAVE');
    await fails(h.db.leave(c.id, 'stranger'), 'NOT_A_MEMBER');
  });
});

describe('invites', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  it('shows the token once and stores only its hash', async () => {
    const c = await h.db.createCampaign({ title: 'Invites', gmUserId: 'gm' });
    const inv = await h.db.createInvite(c.id, 'gm');
    expect(inv.token.length).toBeGreaterThanOrEqual(32);
    const { rows } = await h.pg.query<{ token_hash: string }>('select token_hash from invites where id = $1', [inv.id]);
    expect(rows[0]!.token_hash).toBe(sha(inv.token));
    expect(JSON.stringify((await h.pg.query('select * from invites where id = $1', [inv.id])).rows)).not.toContain(inv.token);
    const listed = await h.db.listInvites(c.id);
    expect(JSON.stringify(listed)).not.toContain(inv.token);
    expect(listed[0]).toMatchObject({ id: inv.id, status: 'open' });
  });
  it('accepting joins the campaign as a player; the same account again is a no-op', async () => {
    const c = await h.db.createCampaign({ title: 'Accept', gmUserId: 'gm' });
    const inv = await h.db.createInvite(c.id, 'gm');
    expect(await h.db.acceptInvite(inv.token, 'ilse')).toMatchObject({ campaignId: c.id, status: 'joined' });
    expect((await h.db.getMember(c.id, 'ilse'))?.role).toBe('player');
    expect(await h.db.acceptInvite(inv.token, 'ilse')).toMatchObject({ campaignId: c.id, status: 'already-member' });
    expect((await h.db.listInvites(c.id))[0]!.status).toBe('used');
  });
  it('is single-use: another account is refused', async () => {
    const c = await h.db.createCampaign({ title: 'Single', gmUserId: 'gm' });
    const inv = await h.db.createInvite(c.id, 'gm');
    await h.db.acceptInvite(inv.token, 'ilse');
    await fails(h.db.acceptInvite(inv.token, 'sella'), 'INVITE_USED');
  });
  it('expires, can be revoked, and an unknown token is not found', async () => {
    const c = await h.db.createCampaign({ title: 'Lifecycle', gmUserId: 'gm' });
    const old = await h.db.createInvite(c.id, 'gm', 60_000);
    h.clock.now = new Date(h.clock.now.getTime() + 61_000);
    await fails(h.db.acceptInvite(old.token, 'ilse'), 'INVITE_EXPIRED');
    const fresh = await h.db.createInvite(c.id, 'gm');
    await h.db.revokeInvite(c.id, fresh.id);
    await fails(h.db.acceptInvite(fresh.token, 'ilse'), 'INVITE_REVOKED');
    await fails(h.db.acceptInvite('definitely-not-a-token', 'ilse'), 'NOT_FOUND');
    h.clock.now = new Date('2026-10-07T12:00:00Z');
  });
  it('only the GM of that campaign can revoke; the campaign must match', async () => {
    const a = await h.db.createCampaign({ title: 'A', gmUserId: 'gm' });
    const b = await h.db.createCampaign({ title: 'B', gmUserId: 'gm' });
    const inv = await h.db.createInvite(a.id, 'gm');
    await fails(h.db.revokeInvite(b.id, inv.id), 'NOT_FOUND');
  });
  it('a former member who accepts a new invite rejoins', async () => {
    const c = await h.db.createCampaign({ title: 'Rejoin', gmUserId: 'gm' });
    await h.db.addPlayer(c.id, 'wren');
    await h.db.leave(c.id, 'wren');
    const inv = await h.db.createInvite(c.id, 'gm');
    expect(await h.db.acceptInvite(inv.token, 'wren')).toMatchObject({ status: 'joined' });
    expect((await h.db.getMember(c.id, 'wren'))?.left).toBe(false);
  });
});

describe('row-level security: deny by default', () => {
  it('a Supabase-style authenticated session reads and writes nothing, even with table grants', async () => {
    const c = await h.db.createCampaign({ title: 'Secret', gmUserId: 'gm' });
    await h.pg.exec(`
      do $$ begin if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
      grant usage on schema public to authenticated;
      grant all on all tables in schema public to authenticated;
    `);
    await h.pg.exec('set role authenticated');
    try {
      for (const t of ['profiles', 'campaigns', 'memberships', 'invites', 'game_state', 'documents']) {
        const { rows } = await h.pg.query(`select * from ${t}`);
        expect(rows, t).toEqual([]);
      }
      await expect(h.pg.query(`insert into campaigns (id, title, gm_user_id) values ('hax-hax', 'x', 'gm')`)).rejects.toThrow(/row-level security/i);
      await expect(h.pg.query(`update memberships set role = 'gm' where campaign_id = $1`, [c.id])).resolves.toMatchObject({ affectedRows: 0 });
    } finally {
      await h.pg.exec('reset role');
    }
  });
});

describe('snapshots', () => {
  it('round-trips game state and a document, replacing on save', async () => {
    const c = await h.db.createCampaign({ title: 'Snaps', gmUserId: 'gm' });
    expect(await h.db.loadGameState(c.id)).toBeNull();
    await h.db.saveGameState(c.id, { seq: 1, cards: { c1: { want: 'x' } } });
    await h.db.saveGameState(c.id, { seq: 2, cards: {} });
    expect(await h.db.loadGameState(c.id)).toEqual({ seq: 2, cards: {} });
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await h.db.saveDocument(c.id, bytes);
    expect(await h.db.loadDocument(c.id)).toEqual(bytes);
    expect(await h.db.loadDocument('nope-nope')).toBeNull();
  });
});

describe('pickColor', () => {
  it('honors a free preferred color, ignores case, and nudges a taken one to the nearest free palette color', () => {
    expect(pickColor([], '#ABCDEF')).toBe('#abcdef');
    expect(pickColor(['#abcdef'], '#ABCDEF')).not.toBe('#abcdef');
    const near = pickColor([PALETTE[0]!], PALETTE[0]!);
    expect(PALETTE).toContain(near);
    expect(near).not.toBe(PALETTE[0]);
  });
  it('without a preference takes the first free palette color, and never repeats', () => {
    const taken: string[] = [];
    for (let i = 0; i < PALETTE.length + 10; i++) taken.push(pickColor(taken, null));
    expect(new Set(taken).size).toBe(taken.length);
    expect(taken[0]).toBe(PALETTE[0]);
  });
});
