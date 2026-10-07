import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MemoryStore } from '../src/store';
import { REJECTED_PREFIX } from '../src/server';
import { GM, ILSE, SELLA, addParagraph, api, attrs, connect, para, startServer, waitFor } from './helpers';

const open: { destroy(): void | Promise<void> }[] = [];
const track = <T extends { destroy(): void | Promise<void> }>(x: T) => (open.push(x), x);
afterEach(async () => { while (open.length) await open.pop()!.destroy(); });

const C = 'campaign-1';
const base = `/api/campaigns/${C}`;
const DICE_KEYS = ['skillDie', 'backingDie', 'difficultyDie', 'kept', '"hits"', '"total"', '"value"', '"sides"'];
const noDice = (v: unknown) => { const s = typeof v === 'string' ? v : JSON.stringify(v); for (const k of DICE_KEYS) expect(s, k).not.toContain(k); };

async function table() {
  const s = await startServer();
  track({ destroy: () => s.server.destroy() });
  const ilse = track(await connect(s.url, ILSE));
  const gm = track(await connect(s.url, GM));
  // Ilse has already written two paragraphs when she opens a card.
  addParagraph(ilse.fragment, attrs('p1', 'ilse'), 'I reach the wall.');
  addParagraph(ilse.fragment, attrs('p2', 'ilse'), 'I climb.');
  await waitFor(() => gm.fragment.length === 2);
  const call = (who: typeof ILSE | null, method: string, path: string, body?: unknown, token?: string) => api(s.http, who, method, `${base}${path}`, body, token);
  const ledger = (c: { doc: Y.Doc }) => c.doc.getMap('ledger');
  return { ...s, ilse, gm, call, ledger };
}

describe('authentication and shape', () => {
  it('refuses requests without a valid sign-in', async () => {
    const t = await table();
    expect((await t.call(null, 'GET', '/me')).status).toBe(401);
    expect((await t.call(null, 'GET', '/me', undefined, 'garbage')).status).toBe(401);
    const forged = Buffer.from(JSON.stringify({ ...ILSE, role: 'gm' })).toString('base64url') + '.bogus';
    expect((await t.call(null, 'POST', '/cards', { skillName: 'Climb' }, forged)).status).toBe(401);
  });
  it('answers unknown routes, bad bodies, bad campaign ids and oversized bodies with the right status', async () => {
    const t = await table();
    expect((await t.call(ILSE, 'GET', '/nope')).status).toBe(404);
    expect((await t.call(ILSE, 'POST', '/cards', '{not json')).status).toBe(400);
    expect((await t.call(ILSE, 'POST', '/cards', {})).status).toBe(400); // skillName required
    expect((await api(t.http, ILSE, 'GET', '/api/campaigns/bad%20id/me')).status).toBe(400);
    expect((await t.call(ILSE, 'POST', '/cards', { skillName: 'x'.repeat(70_000) })).status).toBe(413);
  });
  it('leaves non-API requests to Hocuspocus', async () => {
    const t = await table();
    const res = await fetch(t.http);
    expect(await res.text()).toContain('Welcome');
  });
  it('mounts the dev-dice route only when asked', async () => {
    const t = await table();
    expect((await api(t.http, null, 'POST', `/api/dev/campaigns/${C}/dice`, { values: [1] })).status).toBe(200);
    const off = await startServer(new MemoryStore(), { devDice: false });
    track({ destroy: () => off.server.destroy() });
    expect((await api(off.http, null, 'POST', `/api/dev/campaigns/${C}/dice`, { values: [1] })).status).toBe(404);
  });
});

describe('a quick roll over HTTP, watched by another client', () => {
  it('opens, rolls, reveals, writes and locks; dice appear only after Reveal', async () => {
    const t = await table();
    const me = await t.call(ILSE, 'GET', '/me');
    expect(me.json.character.name).toBe('Ilse');
    await waitFor(() => t.ledger(t.gm).size === 0 && !!t.gm.doc.getMap('characters').get('ilse-pc')); // the sheet is published to the table

    const made = await t.call(ILSE, 'POST', '/cards', { skillName: 'Climb', anchorParagraphId: 'p1', want: 'Climb the wall', risk: 'I twist an ankle' });
    expect(made.status).toBe(200);
    const id = made.json.card.id;
    await t.call(ILSE, 'PATCH', `/cards/${id}`, { difficulty: 'Demanding', danger: 'Serious', dangerKind: 'other', dangerText: 'I twist an ankle', shiftKeys: ['possession:ilse-pos1'] });
    const pre = await t.call(ILSE, 'GET', `/cards/${id}/preview`);
    expect(pre.json.problems).toEqual([]);
    expect(pre.json.odds).toEqual({ goal: 'Even', danger: 'Unlikely' }); // the possession lifts Capable to Expert: 55% goal, 35% Danger
    expect(pre.json.candidates.map((c: { key: string }) => c.key)).toContain('possession:ilse-pos1');

    await api(t.http, null, 'POST', `/api/dev/campaigns/${C}/dice`, { values: [5, 3, 7] }); // Expert d10 vs Demanding d8 vs Serious d8
    const rolled = await t.call(ILSE, 'POST', `/cards/${id}/roll`);
    expect(rolled.json.card).toMatchObject({ status: 'rolled', outcome: 'successWithCost' });
    noDice(rolled.text);
    await waitFor(() => (t.ledger(t.gm).get(id) as { status: string } | undefined)?.status === 'rolled');
    noDice(t.ledger(t.gm).toJSON()); // what every client can read
    noDice(t.ledger(t.ilse).toJSON());
    expect((await t.call(ILSE, 'GET', `/cards/${id}/prompt`)).json.prompt.headline).toContain('Success, with the cost');

    // GM sees dice at once; a player does not.
    expect((await t.call(ILSE, 'GET', `/cards/${id}/dice`)).status).toBe(403);
    const gmDice = await t.call(GM, 'GET', `/cards/${id}/dice`);
    expect(gmDice.json.dice).toMatchObject({ skill: { sides: 10, value: 5 }, danger: { sides: 8, value: 7 } });

    // Anyone may reveal; then the table can read them.
    await t.call(SELLA, 'POST', `/cards/${id}/reveal`);
    await waitFor(() => !!(t.ledger(t.ilse).get(id) as { dice: unknown } | undefined)?.dice);
    expect((t.ledger(t.ilse).get(id) as { dice: { kept: number } }).dice.kept).toBe(5);

    // The outcome is written; the server locks the prose and the author's own client is refused.
    const w = await t.call(ILSE, 'POST', `/cards/${id}/written`, { outcomeParagraphId: 'p2' });
    expect(w.status).toBe(200);
    await waitFor(() => (para(t.gm.fragment, 0).getAttribute('locked') as unknown) === true && (para(t.gm.fragment, 1).getAttribute('locked') as unknown) === true);
    (para(t.ilse.fragment, 1).get(0) as Y.XmlText).insert(0, 'Cheating. ');
    await waitFor(() => t.ilse.closes.some((x) => x.reason.startsWith(REJECTED_PREFIX)));

    // A new paragraph after the locked run is fine, and the GM can retcon only until something builds on the outcome.
    const retcon = await t.call(GM, 'POST', `/cards/${id}/retcon`);
    expect(retcon.status).toBe(200);
    await waitFor(() => (para(t.gm.fragment, 1).getAttribute('locked') as unknown) === false);
    expect((await t.call(GM, 'GET', `/cards/${id}/dice`)).status).toBe(409); // dice gone with the reopened card
  });
});

describe('permission matrix', () => {
  it('every card route refuses the wrong role or the wrong player', async () => {
    const t = await table();
    const made = await t.call(ILSE, 'POST', '/cards', { skillName: 'Climb', anchorParagraphId: 'p1', want: 'w', risk: 'r' });
    const id = made.json.card.id;
    await t.call(ILSE, 'PATCH', `/cards/${id}`, { difficulty: 'Demanding', danger: 'Serious', dangerKind: 'other' });

    const expectStatus = async (who: typeof ILSE, method: string, path: string, body: unknown, status: number) =>
      expect((await t.call(who, method, path, body)).status, `${who.id} ${method} ${path}`).toBe(status);

    await expectStatus(GM, 'POST', '/cards', { skillName: 'Climb' }, 403); // the GM opens no cards
    await expectStatus(SELLA, 'PATCH', `/cards/${id}`, { want: 'x' }, 403);
    await expectStatus(SELLA, 'POST', `/cards/${id}/set`, undefined, 403);
    await expectStatus(SELLA, 'POST', `/cards/${id}/roll`, undefined, 403);
    await expectStatus(SELLA, 'POST', `/cards/${id}/concede`, { kind: 'surrender' }, 403);
    await expectStatus(ILSE, 'POST', `/cards/${id}/concede`, { kind: 'a made up kind' }, 400);
    await expectStatus(ILSE, 'POST', `/cards/${id}/push`, { kind: 'standard' }, 409); // nothing to push yet
    await expectStatus(ILSE, 'POST', `/cards/${id}/push`, { kind: 'wild' }, 400);
    await expectStatus(ILSE, 'POST', `/cards/${id}/reveal`, undefined, 409); // not rolled
    await expectStatus(ILSE, 'POST', `/cards/${id}/retcon`, undefined, 403);
    await expectStatus(GM, 'POST', `/cards/${id}/retcon`, undefined, 409); // not written
    await expectStatus(ILSE, 'GET', `/cards/${id}/dice`, undefined, 403);
    await expectStatus(GM, 'GET', `/cards/${id}/dice`, undefined, 409); // no roll yet
    await expectStatus(ILSE, 'GET', `/cards/c999/preview`, undefined, 404);
    await expectStatus(SELLA, 'POST', `/cards/${id}/written`, { outcomeParagraphId: 'p2' }, 403);
    await expectStatus(SELLA, 'POST', `/characters/ilse-pc/burdens/x/lay-down`, { kind: 'trait', text: 't' }, 403);
  });

  it('a big card is Set by the GM only, and a draft big card cannot be rolled by its player', async () => {
    const t = await table();
    const made = await t.call(ILSE, 'POST', '/cards', { skillName: 'Sneak', anchorParagraphId: 'p1', want: 'w', risk: 'r', onTheLine: 'ilse-core' });
    const id = made.json.card.id;
    expect(made.json.card.speed).toBe('big');
    expect((await t.call(ILSE, 'PATCH', `/cards/${id}`, { difficulty: 'Hard' })).status).toBe(403);
    expect((await t.call(GM, 'PATCH', `/cards/${id}`, { difficulty: 'Hard', danger: 'Serious', dangerText: 'a Burden' })).status).toBe(200);
    expect((await t.call(ILSE, 'POST', `/cards/${id}/roll`)).status).toBe(409);
    expect((await t.call(ILSE, 'POST', `/cards/${id}/set`)).status).toBe(403);
    expect((await t.call(GM, 'POST', `/cards/${id}/set`)).json.card.status).toBe('set');
  });
});

describe('discarding a draft card', () => {
  it('the owner (or the GM, to tidy up) drops an unset draft and it leaves the ledger; another player cannot', async () => {
    const t = await table();
    const card = (await t.call(ILSE, 'POST', '/cards', { skillName: 'Climb', anchorParagraphId: 'p1', want: 'Cross the roof', risk: 'I slip' })).json.card;
    await waitFor(() => t.ledger(t.gm).has(card.id));
    expect((await t.call(SELLA, 'DELETE', `/cards/${card.id}`)).status).toBe(403);
    expect((await t.call(ILSE, 'DELETE', `/cards/${card.id}`)).status).toBe(200);
    await waitFor(() => !t.ledger(t.gm).has(card.id));
    expect((await t.call(ILSE, 'DELETE', `/cards/${card.id}`)).status).toBe(404);
  });
});

describe('one open draft per player', () => {
  it('a second card is refused until the first is set or discarded', async () => {
    const t = await table();
    const first = (await t.call(ILSE, 'POST', '/cards', { skillName: 'Climb', anchorParagraphId: 'p1' })).json.card;
    const again = await t.call(ILSE, 'POST', '/cards', { skillName: 'Climb', anchorParagraphId: 'p2' });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('DRAFT_OPEN');
    expect((await t.call(GM, 'DELETE', `/cards/${first.id}`)).status).toBe(200); // the GM can tidy a stray draft
    expect((await t.call(ILSE, 'POST', '/cards', { skillName: 'Climb', anchorParagraphId: 'p2' })).status).toBe(200);
  });
});
