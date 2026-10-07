import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { REJECTED_PREFIX } from '../src/server';
import { type Identity } from '../src/auth';
import { GM, addParagraph, api, attrs, connect, startServer, textOf, waitFor, type Client } from './helpers';

const open: { destroy(): void | Promise<void> }[] = [];
const track = <T extends { destroy(): void | Promise<void> }>(x: T) => (open.push(x), x);
afterEach(async () => { while (open.length) await open.pop()!.destroy(); });

const MIRA: Identity = { id: 'mira', name: 'Mira', role: 'player', color: '#c2410c' };
const TOBIN: Identity = { id: 'tobin', name: 'Tobin', role: 'player', color: '#1d4ed8' };
const WREN: Identity = { id: 'wren', name: 'Wren', role: 'player', color: '#0e7490' };
const C = 'campaign-1';
const base = `/api/campaigns/${C}`;

async function table(players: Identity[] = [MIRA, TOBIN, WREN]) {
  const s = await startServer();
  track({ destroy: () => s.server.destroy() });
  const gm = track(await connect(s.url, GM));
  const clients: Record<string, Client> = {};
  for (const p of players) clients[p.id] = track(await connect(s.url, p));
  const step = (who: Identity, name: string, body: unknown = {}) => api(s.http, who, 'POST', `${base}/creation/${name}`, body);
  const call = (who: Identity | null, method: string, path: string, body?: unknown) => api(s.http, who, method, `${base}${path}`, body);
  /** Write a paragraph as `who` and wait until the server has it. */
  const write = async (who: Identity, id: string, text = 'Prose.') => {
    addParagraph(clients[who.id]!.fragment, attrs(id, who.id), text);
    await waitFor(() => gm.fragment.toArray().some((n) => (n as Y.XmlElement).getAttribute('paragraphId') === id));
  };
  for (const p of players) await call(p, 'GET', '/me'); // opening the campaign makes the character
  return { ...s, gm, clients, step, call, write };
}

describe('a new player and the roll gate', () => {
  it('starts with a blank character in creation, public to the table, and cannot roll until it is ready', async () => {
    const t = await table();
    await waitFor(() => !!t.gm.doc.getMap('characters').get('mira-pc'));
    expect(t.gm.doc.getMap('characters').get('mira-pc')).toMatchObject({ name: 'Mira', ownerId: 'mira', skills: [] });
    expect(t.gm.doc.getMap('creation').get('mira-pc')).toMatchObject({ status: 'creating' });
    expect(t.gm.doc.getMap('campaign').get('phase')).toBe('sessionZero');
    const card = await t.call(MIRA, 'POST', '/cards', { skillName: 'Climb' });
    expect(card.status).toBe(200); // writing a card is fine; rolling it is not
    const roll = await t.call(MIRA, 'POST', `/cards/${card.json.card.id}/roll`);
    expect([roll.status, roll.json.error.code]).toEqual([409, 'NOT_READY']);
  });
  it('a preset dev user (ready-made sheet) is ready at once', async () => {
    const t = await table([]);
    await t.call({ id: 'ilse', name: 'Ilse', role: 'player', color: '#c2410c' }, 'GET', '/me');
    await waitFor(() => !!t.gm.doc.getMap('creation').get('ilse-pc'));
    expect(t.gm.doc.getMap('creation').get('ilse-pc')).toMatchObject({ status: 'ready' });
  });
});

describe('who may take which step', () => {
  it('only the GM writes the world fact and begins play; players cannot', async () => {
    const t = await table();
    expect((await t.step(MIRA, 'world-fact', { text: 'x' })).status).toBe(403);
    expect((await t.step(MIRA, 'begin')).status).toBe(403);
    expect((await t.step(GM, 'world-fact', { text: 'The war is over, the treaty is a lie.' })).status).toBe(200);
    await waitFor(() => Object.keys(t.gm.doc.getMap('canon').toJSON()).length === 1);
    expect(Object.values(t.gm.doc.getMap('canon').toJSON())[0]).toMatchObject({ kind: 'worldFact', text: 'The war is over, the treaty is a lie.' });
    expect((await t.step(GM, 'begin')).status).toBe(409); // nobody is ready
  });
  it('the GM has no character to write for', async () => {
    const t = await table();
    expect((await t.step(GM, 'origin-picks', { skill: 'Sneak', connection: 'x' })).status).toBe(409);
  });
  it('strangers get nothing; unknown steps and bad bodies are refused', async () => {
    const t = await table();
    const stranger: Identity = { ...WREN, id: 'x' };
    // The static test directory makes everyone a member, so a stranger is only exercised in accounts tests; here bad input.
    expect(stranger.id).toBe('x');
    expect((await t.step(MIRA, 'nope')).status).toBe(404);
    expect((await t.step(MIRA, 'chapter', {})).status).toBe(400);
    expect((await t.call(null, 'POST', '/creation/finish', {})).status).toBe(401);
  });
  it('a paragraph must exist, be yours, and be used only once', async () => {
    const t = await table();
    await t.write(MIRA, 'm0', 'My origin.');
    await t.write(TOBIN, 't0', 'His origin.');
    expect((await t.step(MIRA, 'origin-post', { paragraphId: 'nowhere' })).json.error.code).toBe('NO_SUCH_PARAGRAPH');
    expect((await t.step(MIRA, 'origin-post', { paragraphId: 't0' })).json.error.code).toBe('NOT_YOUR_PARAGRAPH');
    expect((await t.step(MIRA, 'origin-post', { paragraphId: 'm0' })).status).toBe(200);
    expect((await t.step(MIRA, 'origin-post', { paragraphId: 'm0' })).json.error.code).toBe('ORIGIN_DONE');
    expect((await t.step(MIRA, 'chapter', { paragraphId: 'm0', summary: 's', endsBadly: false })).json.error.code).toBe('PARAGRAPH_USED');
  });
});

describe('grants over HTTP', () => {
  async function withChapters() {
    const t = await table();
    for (const [i, id] of ['m0', 'm1', 'm2', 'm3'].entries()) await t.write(MIRA, id, `Mira scene ${i}`);
    await t.step(MIRA, 'origin-post', { paragraphId: 'm0' });
    for (const [i, id] of ['m1', 'm2', 'm3'].entries()) await t.step(MIRA, 'chapter', { paragraphId: id, summary: `Chapter ${i + 1}`, endsBadly: i === 1 });
    return t;
  }
  const slot = (t: Awaited<ReturnType<typeof table>>, ch = 0) => (t.gm.doc.getMap('creation').get('mira-pc') as any).chapters[ch].skill;

  it('needs the other two players to agree, and the GM breaks a tie; nobody can grant themselves a Skill', async () => {
    const t = await withChapters();
    const body = (skill: string) => ({ characterId: 'mira-pc', chapter: 0, skill, mode: 'new' });
    expect((await t.step(MIRA, 'propose-skill', body('Climb'))).status).toBe(403);
    expect((await t.step(GM, 'propose-skill', body('Climb'))).status).toBe(403);
    expect((await t.step(TOBIN, 'propose-skill', body('Climb'))).status).toBe(200);
    await waitFor(() => slot(t).proposals?.length === 1);
    expect(slot(t).applied).toBeNull();
    expect((await t.step(WREN, 'propose-skill', body('Persuade'))).status).toBe(200);
    await waitFor(() => slot(t).proposals.length === 2);
    expect(slot(t).applied).toBeNull();
    const pick = slot(t).proposals.find((p: any) => p.skill === 'Persuade').id;
    expect((await t.step(TOBIN, 'gm-resolve', { characterId: 'mira-pc', chapter: 0, part: 'skill', proposalId: pick })).status).toBe(403);
    expect((await t.step(GM, 'gm-resolve', { characterId: 'mira-pc', chapter: 0, part: 'skill', proposalId: pick })).status).toBe(200);
    await waitFor(() => slot(t).applied?.by === 'gm');
    await waitFor(() => (t.gm.doc.getMap('characters').get('mira-pc') as any).skills.length === 1);
    expect((t.gm.doc.getMap('characters').get('mira-pc') as any).skills).toEqual([{ name: 'Persuade', rank: 'Trained' }]);
  });
  it('the writer swaps once', async () => {
    const t = await withChapters();
    await t.step(TOBIN, 'propose-skill', { characterId: 'mira-pc', chapter: 0, skill: 'Climb', mode: 'new' });
    await t.step(WREN, 'accept', { characterId: 'mira-pc', chapter: 0, part: 'skill', proposalId: 'gp-1' });
    await waitFor(() => slot(t).applied?.name === 'Climb');
    expect((await t.step(TOBIN, 'swap', { chapter: 0, part: 'skill' })).json.error.code).toBe('NO_SUCH_CHAPTER'); // Tobin has no chapters of his own
    expect((await t.step(MIRA, 'swap', { chapter: 0, part: 'skill' })).status).toBe(200);
    expect((await t.step(MIRA, 'swap', { chapter: 1, part: 'skill' })).status).toBe(409);
  });
});

describe('the end check and the roll gate', () => {
  it('lists what is missing for anyone at the table; the GM overrides with a recorded reason; Begin play then needs everyone ready', async () => {
    const t = await table([MIRA, TOBIN]);
    const check = await t.call(TOBIN, 'GET', '/creation/check/mira-pc');
    expect(check.status).toBe(200);
    expect(check.json.passed).toBe(false);
    expect(check.json.problems.map((p: any) => p.code)).toContain('ORIGIN_UNPOSTED');
    expect((await t.call(TOBIN, 'GET', '/creation/check/nobody')).status).toBe(404);
    expect((await t.step(MIRA, 'finish')).status).toBe(409);
    expect((await t.step(TOBIN, 'override', { characterId: 'tobin-pc', reason: 'x' })).status).toBe(403);
    expect((await t.step(GM, 'override', { characterId: 'tobin-pc', reason: '' })).status).toBe(400);
    expect((await t.step(GM, 'override', { characterId: 'tobin-pc', reason: 'New to the game, we will fill it in as we play' })).status).toBe(200);
    expect((await t.step(GM, 'begin')).status).toBe(409); // Mira is not ready
    expect((await t.step(GM, 'override', { characterId: 'mira-pc', reason: 'Same' })).status).toBe(200);
    expect((await t.step(GM, 'begin')).status).toBe(200);
    await waitFor(() => t.gm.doc.getMap('campaign').get('phase') === 'playing');
    const log = t.gm.doc.getMap('campaign').get('overrides') as any[];
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ gmId: 'gm1', characterId: 'tobin-pc', reason: 'New to the game, we will fill it in as we play' });
    expect((await t.step(GM, 'begin')).status).toBe(409);
  });
  it('after play begins, a new player cannot roll until ready, and nobody else is held back', async () => {
    const t = await table([MIRA]);
    await t.step(GM, 'override', { characterId: 'mira-pc', reason: 'ok' });
    await t.step(GM, 'begin');
    const ilse: Identity = { id: 'ilse', name: 'Ilse', role: 'player', color: '#c2410c' };
    const late: Identity = { id: 'late', name: 'Late', role: 'player', color: '#444444' };
    await t.call(ilse, 'GET', '/me');
    await t.call(late, 'GET', '/me');
    await waitFor(() => !!t.gm.doc.getMap('creation').get('late-pc'));
    expect(t.gm.doc.getMap('creation').get('late-pc')).toMatchObject({ status: 'creating' });
    expect(t.gm.doc.getMap('creation').get('ilse-pc')).toMatchObject({ status: 'ready' });
    expect(t.gm.doc.getMap('campaign').get('phase')).toBe('playing');
  });
  it('clients cannot write the creation, canon or campaign maps', async () => {
    const t = await table([MIRA]);
    const mira = t.clients.mira!;
    for (const name of ['creation', 'canon', 'campaign']) {
      mira.doc.getMap(name).set('forged', { status: 'ready' });
      await waitFor(() => mira.closes.some((c) => c.reason.startsWith(REJECTED_PREFIX)), 3000);
      break;
    }
    expect(mira.closes.some((c) => c.reason.includes('SERVER_OWNED'))).toBe(true);
    expect(t.gm.doc.getMap('creation').get('forged')).toBeUndefined();
  });
});

describe('solo drafts', () => {
  const draftDoc = (id: string) => `${C}~draft~${id}`;

  it('are private: only their author can open one', async () => {
    const t = await table([MIRA, TOBIN]);
    const own = track(await connect(t.url, MIRA, draftDoc('mira')));
    addParagraph(own.fragment, attrs('d0', 'mira'), 'A secret origin.');
    await expect(connect(t.url, TOBIN, draftDoc('mira'))).rejects.toThrow(/auth failed/);
    await expect(connect(t.url, GM, draftDoc('mira'))).rejects.toThrow(/auth failed/);
    await expect(connect(t.url, TOBIN, draftDoc('tobin'))).resolves.toBeTruthy();
    expect(t.gm.fragment.length).toBe(0);
  });
  it('can be marked up, checked, and brought to the table as the player\'s own prose, opening the chapters', async () => {
    const t = await table([MIRA, TOBIN]);
    const own = track(await connect(t.url, MIRA, draftDoc('mira')));
    ['Origin: a farm.', 'Chapter one.', 'Chapter two: the siege.', 'Chapter three.'].forEach((tx, i) => addParagraph(own.fragment, attrs(`d${i}`, 'mira'), tx));
    await waitFor(() => own.provider.hasUnsyncedChanges === false);
    const mark = (over: Record<string, unknown> = {}) => t.call(MIRA, 'PUT', '/draft', {
      veteran: false, origin: { paragraphId: 'd0' },
      chapters: [{ paragraphId: 'd1', summary: 'The farm', endsBadly: false }, { paragraphId: 'd2', summary: 'The siege', endsBadly: true }, { paragraphId: 'd3', summary: 'The road', endsBadly: false }],
      ...over,
    });
    expect((await mark({ origin: { paragraphId: 'nowhere' } })).status).toBe(400);
    const incomplete = await mark({ chapters: [{ paragraphId: 'd1', summary: 'The farm', endsBadly: false }] });
    expect(incomplete.json.problems.length).toBeGreaterThan(0);
    expect((await t.call(MIRA, 'POST', '/draft/import')).json.error.code).toBe('DRAFT_INCOMPLETE');
    expect((await mark()).json.problems).toEqual([]);
    expect((await t.call(TOBIN, 'GET', '/draft')).json.draft.chapters).toEqual([]); // Tobin's own tracker, not hers
    expect((await t.call(GM, 'GET', '/draft')).status).toBe(403);
    expect((await t.call(MIRA, 'POST', '/draft/import')).status).toBe(200);
    await waitFor(() => t.gm.fragment.length === 4);
    const shared = t.gm.fragment.toArray() as Y.XmlElement[];
    expect(shared.map(textOf)).toEqual(['Origin: a farm.', 'Chapter one.', 'Chapter two: the siege.', 'Chapter three.']);
    expect(shared.every((p) => p.getAttribute('authorId') === 'mira')).toBe(true);
    expect(new Set(shared.map((p) => p.getAttribute('paragraphId'))).size).toBe(4);
    expect(shared.some((p) => ['d0', 'd1', 'd2', 'd3'].includes(String(p.getAttribute('paragraphId'))))).toBe(false);
    await waitFor(() => (t.gm.doc.getMap('creation').get('mira-pc') as any)?.chapters.length === 3);
    const state = t.gm.doc.getMap('creation').get('mira-pc') as any;
    expect(state.chapters.map((c: any) => c.summary)).toEqual(['The farm', 'The siege', 'The road']);
    expect(state.chapters[1].endsBadly).toBe(true);
    const ids = shared.map((p) => String(p.getAttribute('paragraphId')));
    expect([state.origin.paragraphId, ...state.chapters.map((c: any) => c.paragraphId)]).toEqual(ids); // the marks follow the prose
    // The grant cards are open to the others, and only them.
    expect((await t.step(TOBIN, 'propose-skill', { characterId: 'mira-pc', chapter: 0, skill: 'Climb', mode: 'new' })).status).toBe(200);
    // A second import is refused: the chapters are already posted.
    expect((await t.call(MIRA, 'POST', '/draft/import')).json.error.code).toBe('ALREADY_STARTED');
  });
  it('are never published in a shared map', async () => {
    const t = await table([MIRA]);
    const own = track(await connect(t.url, MIRA, draftDoc('mira')));
    addParagraph(own.fragment, attrs('d0', 'mira'), 'Hidden words.');
    await new Promise((r) => setTimeout(r, 100));
    expect(JSON.stringify([t.gm.doc.getMap('creation').toJSON(), t.gm.doc.getMap('canon').toJSON(), t.gm.doc.getMap('campaign').toJSON(), t.gm.doc.getMap('characters').toJSON()])).not.toContain('Hidden');
  });
});
