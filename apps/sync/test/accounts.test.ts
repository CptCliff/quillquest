import { afterEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import { createDb, migrate, type Db } from '@quillquest/db';
import { pgliteSql } from '@quillquest/db/pglite';
import type { Identity } from '../src/auth';
import { createSyncServer, REJECTED_PREFIX } from '../src/server';
import { PgDocumentStore } from '../src/game/pg-stores';
import { addParagraph, api, attrs, connect, para, SECRET, textOf, waitFor } from './helpers';

// The first PGlite start in a process compiles its WASM build, which can take several seconds.
vi.setConfig({ testTimeout: 30_000 });

const user = (id: string, name: string, color: string, role: 'player' | 'gm' = 'player'): Identity => ({ id, name, role, color });
const GM = user('gm1', 'GM', '#15803d', 'gm');
const ILSE = user('ilse', 'Ilse', '#c2410c');
const SELLA = user('sella', 'Sella', '#1d4ed8');
const ROOK = user('rook', 'Rook', '#7e22ce');
const STRANGER = user('stranger', 'Stranger', '#444444');

const open: { destroy(): void | Promise<void> }[] = [];
const track = <T extends { destroy(): void | Promise<void> }>(x: T) => (open.push(x), x);
afterEach(async () => { while (open.length) await open.pop()!.destroy(); });

async function boot(pg = new PGlite(), db?: Db) {
  const sql = pgliteSql(pg);
  await migrate(sql);
  const d = db ?? createDb(sql);
  const server = createSyncServer({ store: new PgDocumentStore(d), secret: SECRET, port: 0, debounceMs: 20, auth: { db: d }, game: { devDice: true } });
  await server.listen();
  track({ destroy: () => server.destroy() });
  return { server, db: d, pg, http: `http://127.0.0.1:${server.address.port}`, ws: server.webSocketURL };
}
type Booted = Awaited<ReturnType<typeof boot>>;
const call = (b: Booted, who: Identity | null, method: string, path: string, body?: unknown) => api(b.http, who, method, path, body);

/** A GM with a campaign and the given players already joined by invite. */
async function table(...players: Identity[]) {
  const b = await boot();
  const made = await call(b, GM, 'POST', '/api/campaigns', { title: 'The Border War' });
  const id: string = made.json.campaign.id;
  for (const p of players) {
    const inv = await call(b, GM, 'POST', `/api/campaigns/${id}/invites`);
    const acc = await call(b, p, 'POST', '/api/invites/accept', { token: inv.json.invite.token });
    expect(acc.status, `${p.id} joins`).toBe(200);
  }
  return { ...b, id };
}

describe('sign-in and profiles', () => {
  it('refuses requests without a valid token', async () => {
    const b = await boot();
    expect((await call(b, null, 'GET', '/api/me')).status).toBe(401);
    expect((await api(b.http, null, 'GET', '/api/me', undefined, 'garbage')).status).toBe(401);
  });
  it('makes a profile on first sign-in, named from the token, and lets people change it', async () => {
    const b = await boot();
    const me = await call(b, ILSE, 'GET', '/api/me');
    expect(me.json).toMatchObject({ userId: 'ilse', profile: { displayName: 'Ilse', preferredColor: '#c2410c' }, campaigns: [] });
    const upd = await call(b, ILSE, 'PUT', '/api/me/profile', { displayName: 'Ilse the Bold', preferredColor: '#0e7490' });
    expect(upd.json.profile).toMatchObject({ displayName: 'Ilse the Bold', preferredColor: '#0e7490' });
    expect((await call(b, ILSE, 'PUT', '/api/me/profile', { displayName: '' })).status).toBe(400);
    expect((await call(b, ILSE, 'PUT', '/api/me/profile', { displayName: 'x', preferredColor: 'red' })).status).toBe(400);
  });
});

describe('campaigns and roles', () => {
  it('creating a campaign makes the creator its GM; it appears in their list', async () => {
    const b = await boot();
    const made = await call(b, GM, 'POST', '/api/campaigns', { title: 'The Border War' });
    expect(made.status).toBe(200);
    const list = (await call(b, GM, 'GET', '/api/me')).json.campaigns;
    expect(list).toEqual([expect.objectContaining({ id: made.json.campaign.id, title: 'The Border War', role: 'gm', left: false })]);
    expect((await call(b, GM, 'POST', '/api/campaigns', { title: '' })).status).toBe(400);
    expect((await call(b, GM, 'POST', '/api/campaigns', {})).status).toBe(400);
  });

  it('the role comes from the membership, never from the token', async () => {
    const t = await table(ILSE);
    // Ilse's token CLAIMS to be a GM. It changes nothing.
    const liar = { ...ILSE, role: 'gm' as const };
    expect((await call(t, liar, 'GET', `/api/campaigns/${t.id}/invites`)).status).toBe(403);
    expect((await call(t, liar, 'POST', `/api/campaigns/${t.id}/invites`)).status).toBe(403);
    // And the real GM's token claiming to be a player does not demote them.
    expect((await call(t, { ...GM, role: 'player' }, 'GET', `/api/campaigns/${t.id}/invites`)).status).toBe(200);
  });

  it('a non-member cannot call any campaign route, and cannot open the document', async () => {
    const t = await table(ILSE);
    for (const [m, p] of [['GET', '/me'], ['GET', '/members'], ['POST', '/cards'], ['POST', '/leave'], ['GET', '/invites'], ['GET', '/cards/c1/preview']] as const)
      expect((await call(t, STRANGER, m, `/api/campaigns/${t.id}${p}`, m === 'POST' ? { skillName: 'x' } : undefined)).status, `${m} ${p}`).toBe(403);
    await expect(connect(t.ws, STRANGER, t.id)).rejects.toThrow();
  });

  it('membership is per campaign: a member of one is a stranger to another', async () => {
    const a = await table(ILSE);
    const other = await call(a, SELLA, 'POST', '/api/campaigns', { title: 'Elsewhere' });
    expect((await call(a, ILSE, 'GET', `/api/campaigns/${other.json.campaign.id}/me`)).status).toBe(403);
    await expect(connect(a.ws, ILSE, other.json.campaign.id)).rejects.toThrow();
  });
});

describe('invites', () => {
  it('shows a token once, joins a player, and lists status without the token', async () => {
    const t = await table();
    const inv = await call(t, GM, 'POST', `/api/campaigns/${t.id}/invites`);
    expect(inv.json.invite.token.length).toBeGreaterThanOrEqual(32);
    const listed = await call(t, GM, 'GET', `/api/campaigns/${t.id}/invites`);
    expect(listed.json.invites).toEqual([expect.objectContaining({ id: inv.json.invite.id, status: 'open' })]);
    expect(listed.text).not.toContain(inv.json.invite.token);
    const acc = await call(t, ILSE, 'POST', '/api/invites/accept', { token: inv.json.invite.token });
    expect(acc.json).toEqual({ campaignId: t.id, status: 'joined' });
    expect((await call(t, ILSE, 'POST', '/api/invites/accept', { token: inv.json.invite.token })).json.status).toBe('already-member');
    expect((await call(t, SELLA, 'POST', '/api/invites/accept', { token: inv.json.invite.token })).status).toBe(409); // single use
    expect((await call(t, GM, 'GET', `/api/campaigns/${t.id}/invites`)).json.invites[0].status).toBe('used');
  });
  it('can be revoked; a bogus token is not found; only the GM manages invites', async () => {
    const t = await table(ILSE);
    const inv = await call(t, GM, 'POST', `/api/campaigns/${t.id}/invites`);
    expect((await call(t, ILSE, 'DELETE', `/api/campaigns/${t.id}/invites/${inv.json.invite.id}`)).status).toBe(403);
    expect((await call(t, GM, 'DELETE', `/api/campaigns/${t.id}/invites/${inv.json.invite.id}`)).status).toBe(200);
    expect((await call(t, SELLA, 'POST', '/api/invites/accept', { token: inv.json.invite.token })).status).toBe(410);
    expect((await call(t, SELLA, 'POST', '/api/invites/accept', { token: 'nope-nope-nope' })).status).toBe(404);
    expect((await call(t, SELLA, 'POST', '/api/invites/accept', {})).status).toBe(400);
    expect((await call(t, GM, 'DELETE', `/api/campaigns/${t.id}/invites/nothing`)).status).toBe(404);
  });
});

describe('three accounts in one campaign', () => {
  it('each sees all three sheets, owned by their players, with distinct ink colors', async () => {
    const t = await table(ILSE, SELLA, ROOK);
    const clients = await Promise.all([ILSE, SELLA, ROOK, GM].map((u) => connect(t.ws, u, t.id)));
    clients.forEach((c) => track(c));
    for (const c of clients) await waitFor(() => Object.keys(c.doc.getMap('characters').toJSON()).length === 3);
    for (const c of clients) {
      const sheets = Object.values(c.doc.getMap('characters').toJSON()) as { ownerId: string; name: string; skills: { name: string }[] }[];
      expect(sheets.map((s) => s.ownerId).sort()).toEqual(['ilse', 'rook', 'sella']);
      expect(sheets.find((s) => s.ownerId === 'sella')!.name).toBe('Sella');
      expect(new Set(sheets.map((s) => s.skills.map((k) => k.name).join())).size).toBe(3); // three different starters
    }
    const members = (await call(t, ROOK, 'GET', `/api/campaigns/${t.id}/members`)).json.members as { color: string; role: string }[];
    expect(members).toHaveLength(4);
    expect(new Set(members.map((m) => m.color.toLowerCase())).size).toBe(4);
    expect(members.filter((m) => m.role === 'gm')).toHaveLength(1);
  });
  it('the awareness name and ink come from the membership, not from anything the client says', async () => {
    const t = await table(ILSE, SELLA);
    const a = track(await connect(t.ws, ILSE, t.id));
    const b = track(await connect(t.ws, SELLA, t.id));
    a.provider.setAwarenessField('user', { id: 'sella', name: 'Definitely Sella', color: '#000000' }); // an impostor
    await waitFor(() => [...b.provider.awareness!.getStates().values()].some((s) => s.user?.id === 'ilse'));
    const seen = [...b.provider.awareness!.getStates().values()].map((s) => s.user).filter((u) => u?.id === 'ilse');
    expect(seen[0]).toMatchObject({ id: 'ilse', name: 'Ilse' });
  });
});

describe('leaving', () => {
  it('a player who leaves keeps reading but cannot write; their sheet stays, marked left', async () => {
    const t = await table(ILSE, SELLA);
    const ilse = track(await connect(t.ws, ILSE, t.id));
    const sella = track(await connect(t.ws, SELLA, t.id));
    addParagraph(ilse.fragment, attrs('p1', 'ilse'), 'Before I left.');
    await waitFor(() => sella.fragment.length === 1);

    expect((await call(t, ILSE, 'POST', `/api/campaigns/${t.id}/leave`)).status).toBe(200);
    await waitFor(() => (sella.doc.getMap('characters').get('ilse-pc') as { left?: boolean } | undefined)?.left === true);
    expect((await call(t, ILSE, 'GET', `/api/campaigns/${t.id}/members`)).json.members.find((m: { userId: string }) => m.userId === 'ilse').left).toBe(true);

    // Still readable over HTTP, but nothing mutates.
    expect((await call(t, ILSE, 'GET', `/api/campaigns/${t.id}/me`)).status).toBe(200);
    expect((await call(t, ILSE, 'POST', `/api/campaigns/${t.id}/cards`, { skillName: 'Climb' })).json.error.code).toBe('LEFT');

    // A fresh connection reads the story but a write is refused and changes nothing.
    const gone = track(await connect(t.ws, ILSE, t.id));
    await waitFor(() => gone.fragment.length === 1);
    expect(textOf(para(gone.fragment, 0))).toBe('Before I left.');
    (para(gone.fragment, 0).get(0) as Y.XmlText).insert(0, 'Sneaky. ');
    await new Promise((r) => setTimeout(r, 300));
    expect(textOf(para(sella.fragment, 0))).toBe('Before I left.');
  });
  it('the GM cannot leave; a non-member cannot; a former member rejoins with a new invite', async () => {
    const t = await table(ILSE);
    expect((await call(t, GM, 'POST', `/api/campaigns/${t.id}/leave`)).status).toBe(409);
    expect((await call(t, STRANGER, 'POST', `/api/campaigns/${t.id}/leave`)).status).toBe(403);
    await call(t, ILSE, 'POST', `/api/campaigns/${t.id}/leave`);
    const inv = await call(t, GM, 'POST', `/api/campaigns/${t.id}/invites`);
    expect((await call(t, ILSE, 'POST', '/api/invites/accept', { token: inv.json.invite.token })).json.status).toBe('joined');
    expect((await call(t, ILSE, 'POST', `/api/campaigns/${t.id}/cards`, { skillName: 'Climb' })).status).toBe(200);
    const c = track(await connect(t.ws, ILSE, t.id));
    await waitFor(() => (c.doc.getMap('characters').get('ilse-pc') as { left?: boolean } | undefined)?.left === false);
  });
});

describe('a roll in a real campaign, and what survives a restart', () => {
  it('rolls with a real membership, and the story, ledger and sheets are all still there after the server restarts', async () => {
    const pg = new PGlite();
    const b1 = await boot(pg);
    const made = await call(b1, GM, 'POST', '/api/campaigns', { title: 'Persistent' });
    const id = made.json.campaign.id;
    const inv = await call(b1, GM, 'POST', `/api/campaigns/${id}/invites`);
    await call(b1, ILSE, 'POST', '/api/invites/accept', { token: inv.json.invite.token });
    const ilse = await connect(b1.ws, ILSE, id);
    addParagraph(ilse.fragment, attrs('p1', 'ilse'), 'I reach the wall.');
    await waitFor(() => b1.server.hocuspocus.getDocumentsCount() === 1);
    const card = await call(b1, ILSE, 'POST', `/api/campaigns/${id}/cards`, { skillName: 'Climb', anchorParagraphId: 'p1', want: 'Climb', risk: 'Fall' });
    expect(card.status).toBe(200);
    await new Promise((r) => setTimeout(r, 120));
    ilse.destroy();
    await b1.server.destroy();
    open.length = 0;

    const b2 = await boot(pg, b1.db); // same database, new server
    const again = track(await connect(b2.ws, ILSE, id));
    await waitFor(() => again.fragment.length === 1);
    expect(textOf(para(again.fragment, 0))).toBe('I reach the wall.');
    const cards = await call(b2, ILSE, 'GET', `/api/campaigns/${id}/me`); // opening the campaign republishes the ledger
    expect(cards.status).toBe(200);
    await waitFor(() => Object.keys(again.doc.getMap('ledger').toJSON()).length === 1);
    expect(Object.values(again.doc.getMap('ledger').toJSON())[0]).toMatchObject({ want: 'Climb', status: 'draft' });
    expect(Object.keys(again.doc.getMap('characters').toJSON())).toEqual(['ilse-pc']);
  });
});

describe('writing as a joined member', () => {
  it('editing rules still hold: no editing another member\'s paragraph', async () => {
    const t = await table(ILSE, SELLA);
    const ilse = track(await connect(t.ws, ILSE, t.id));
    const sella = track(await connect(t.ws, SELLA, t.id));
    addParagraph(ilse.fragment, attrs('p1', 'ilse'), 'Mine.');
    await waitFor(() => sella.fragment.length === 1);
    (para(sella.fragment, 0).get(0) as Y.XmlText).insert(0, 'HACK ');
    await waitFor(() => sella.closes.some((c) => c.reason.startsWith(REJECTED_PREFIX)));
    expect(textOf(para(ilse.fragment, 0))).toBe('Mine.');
  });
});

