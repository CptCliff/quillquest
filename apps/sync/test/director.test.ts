import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store';
import { type Identity } from '../src/auth';
import { FakeProvider, LlmError } from '../src/llm';
import { GM, ILSE, SELLA, addParagraph, api, attrs, connect, startServer, textOf, waitFor, type Client } from './helpers';
import * as Y from 'yjs';

const open: { destroy(): void | Promise<void> }[] = [];
const track = <T extends { destroy(): void | Promise<void> }>(x: T) => (open.push(x), x);
afterEach(async () => { while (open.length) await open.pop()!.destroy(); });

const MIRA: Identity = { id: 'mira', name: 'Mira', role: 'player', color: '#0e7490' };
const TOBIN: Identity = { id: 'tobin', name: 'Tobin', role: 'player', color: '#be123c' };
const C = 'campaign-1';
const base = `/api/campaigns/${C}`;
const SECRET_FIELD = 'SENTINEL-hidden-beliefs-5521';
const SECRET_NOTES = 'SENTINEL-npc-notes-8830';
const GM_NOTES = 'SENTINEL-gm-notes-1177';

async function table(withLlm = true) {
  const fake = new FakeProvider();
  const s = await startServer(new MemoryStore(), { devDice: true, playing: true }, withLlm ? fake : null);
  track({ destroy: () => s.server.destroy() });
  const gm = track(await connect(s.url, GM));
  const ilse = track(await connect(s.url, ILSE));
  const sella = track(await connect(s.url, SELLA));
  const call = (who: Identity | null, method: string, path: string, body?: unknown) => api(s.http, who, method, `${base}${path}`, body);
  await call(ILSE, 'GET', '/me'); await call(SELLA, 'GET', '/me');
  await waitFor(() => !!ilse.doc.getMap('characters').get('sella-pc'));
  return { ...s, fake, gm, ilse, sella, call };
}
type T = Awaited<ReturnType<typeof table>>;
const everything = (c: Client) => JSON.stringify(['ledger', 'characters', 'creation', 'canon', 'campaign', 'npcs', 'convictionLog'].map((m) => c.doc.getMap(m).toJSON()));

describe('GM-only routes: the permission matrix', () => {
  it('a player gets 403 on every one of them, the GM gets through, and a stranger gets 401', async () => {
    const t = await table();
    const npc = (await t.call(GM, 'POST', '/npcs', { name: 'Captain Aldous' })).json;
    expect(npc.id).toMatch(/^npc-/);
    const routes: [string, string, unknown][] = [
      ['GET', '/director', undefined], ['PUT', '/settings', { cap: 10 }], ['POST', '/session/start', {}],
      ['POST', '/conviction/award', { characterId: 'ilse-pc', kind: 'other', note: 'x' }], ['POST', '/conviction/decline', { nominationId: 'nom-1' }],
      ['POST', '/npcs', { name: 'X' }], ['PATCH', `/npcs/${npc.id}`, { notes: 'x' }], ['POST', `/npcs/${npc.id}/reveal`, { field: 'name' }],
      ['POST', '/llm/beliefChallenge', { characterId: 'ilse-pc' }], ['POST', '/llm/danger', { cardId: 'c1' }], ['POST', '/llm/npcLine', { npcId: npc.id }], ['POST', '/llm/oracle', {}],
    ];
    for (const [method, path, body] of routes) {
      const r = await t.call(ILSE, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(JSON.stringify(r.json), `${method} ${path}`).not.toContain('Aldous');
      expect((await t.call(null, method, path, body)).status, `${method} ${path} (no sign-in)`).toBe(401);
    }
    expect((await t.call(GM, 'GET', '/director')).status).toBe(200);
    expect((await t.call(GM, 'POST', '/conviction/nominate', { characterId: 'ilse-pc', kind: 'other', note: 'x' })).status).toBe(403); // players nominate
  });
});

describe('NPCs: hidden fields never leave the server until revealed', () => {
  it('the table sees nothing, then exactly the revealed fields; the GM sees all', async () => {
    const t = await table();
    const made = (await t.call(GM, 'POST', '/npcs', { name: 'Captain Aldous' })).json;
    await t.call(GM, 'PATCH', `/npcs/${made.id}`, { beliefs: [SECRET_FIELD], notes: SECRET_NOTES, skills: [{ name: 'Swordplay', rank: 'Expert' }] });
    const gmView = (await t.call(GM, 'GET', '/director')).json;
    expect(gmView.npcs[0]).toMatchObject({ name: 'Captain Aldous', notes: SECRET_NOTES, revealedFields: [] });
    await new Promise((r) => setTimeout(r, 150));
    for (const c of [t.ilse, t.sella]) { expect(everything(c)).not.toContain('SENTINEL'); expect(everything(c)).not.toContain('Aldous'); }
    expect((await t.call(GM, 'POST', `/npcs/${made.id}/reveal`, { field: 'beliefs' })).status).toBe(200);
    await waitFor(() => !!t.ilse.doc.getMap('npcs').get(made.id));
    expect(t.ilse.doc.getMap('npcs').get(made.id)).toMatchObject({ name: null, revealed: ['beliefs'], beliefs: [SECRET_FIELD] });
    expect(everything(t.ilse)).not.toContain(SECRET_NOTES);
    expect(everything(t.ilse)).not.toContain('Aldous');
    expect((await t.call(GM, 'POST', `/npcs/${made.id}/reveal`, { field: 'name' })).status).toBe(200);
    await waitFor(() => (t.sella.doc.getMap('npcs').get(made.id) as any)?.name === 'Captain Aldous');
    expect(everything(t.sella)).not.toContain(SECRET_NOTES);
    expect((await t.call(GM, 'POST', `/npcs/${made.id}/reveal`, { field: 'secrets' })).status).toBe(400);
    expect((await t.call(GM, 'POST', '/npcs/npc-999/reveal', { field: 'name' })).status).toBe(404);
    expect((await t.call(GM, 'PATCH', `/npcs/${made.id}`, { skills: [{ name: 'x', rank: 'Godlike' }] })).status).toBe(400);
  });
  it('the Director data never rides in any published map, whatever the GM does', async () => {
    const t = await table();
    await t.call(GM, 'PUT', '/settings', { faces: ['Old debt', 'A rival', 'Hunger', 'A secret', 'A promise', 'Weather'], cap: 5 });
    await t.call(GM, 'POST', '/npcs', { name: 'Hidden One' });
    await new Promise((r) => setTimeout(r, 150));
    expect(everything(t.ilse)).not.toContain('Old debt');
    expect(everything(t.ilse)).not.toContain('Hidden One');
    expect(JSON.stringify((await t.call(ILSE, 'GET', '/suggestions')).json)).toBe('{"suggestions":[]}');
  });
});

describe('Conviction', () => {
  it('a player nominates, the GM awards, the log is public, and the sheet shows the token', async () => {
    const t = await table();
    const note = 'Ilse gave up the lead to save Sella';
    expect((await t.call(SELLA, 'POST', '/conviction/nominate', { characterId: 'ilse-pc', kind: 'belief', beliefId: 'ilse-obj', note })).status).toBe(200);
    expect((await t.call(ILSE, 'POST', '/conviction/nominate', { characterId: 'ilse-pc', kind: 'other', note: 'me' })).json.error.code).toBe('OWN_MOMENT');
    const nom = (await t.call(GM, 'GET', '/director')).json.nominations;
    expect(nom).toEqual([expect.objectContaining({ characterId: 'ilse-pc', nominatedBy: 'sella', note, status: 'open' })]);
    expect((await t.call(GM, 'POST', '/conviction/award', { nominationId: nom[0].id })).status).toBe(200);
    await waitFor(() => Object.keys(t.sella.doc.getMap('convictionLog').toJSON()).length === 1);
    expect(Object.values(t.sella.doc.getMap('convictionLog').toJSON())[0]).toMatchObject({ characterId: 'ilse-pc', note, delta: 1, awardedBy: 'gm1', nominatedBy: 'sella' });
    await waitFor(() => (t.sella.doc.getMap('characters').get('ilse-pc') as any).conviction === 2);
    expect((await t.call(GM, 'POST', '/conviction/award', { nominationId: nom[0].id })).status).toBe(409); // already settled
    expect((await t.call(GM, 'POST', '/conviction/award', { characterId: 'ilse-pc', kind: 'belief', beliefId: 'ilse-obj', note: 'again' })).json.error.code).toBe('BELIEF_ALREADY_EARNED');
    expect((await t.call(GM, 'POST', '/conviction/award', { characterId: 'sella-pc', kind: 'trait', note: 'Her harmful Trait cost her' })).status).toBe(200);
  });
  it('declining closes a nomination; a new session lets Beliefs earn again', async () => {
    const t = await table();
    await t.call(SELLA, 'POST', '/conviction/nominate', { characterId: 'ilse-pc', kind: 'other', note: 'x' });
    const id = (await t.call(GM, 'GET', '/director')).json.nominations[0].id;
    expect((await t.call(GM, 'POST', '/conviction/decline', { nominationId: id })).status).toBe(200);
    expect((await t.call(GM, 'GET', '/director')).json.nominations[0].status).toBe('declined');
    await t.call(GM, 'POST', '/conviction/award', { characterId: 'ilse-pc', kind: 'belief', beliefId: 'ilse-obj', note: 'first' });
    expect((await t.call(GM, 'POST', '/session/start')).json.sessionNo).toBe(2);
    expect((await t.call(GM, 'POST', '/conviction/award', { characterId: 'ilse-pc', kind: 'belief', beliefId: 'ilse-obj', note: 'second session' })).status).toBe(200);
  });
});

describe('the Claude assistant', () => {
  it('is not configured unless the server has a provider', async () => {
    const t = await table(false);
    const r = await t.call(ILSE, 'POST', '/llm/skillMatch', { sentence: 'I creep past the guards.' });
    expect([r.status, r.json.error.code]).toEqual([501, 'NOT_CONFIGURED']);
    expect((await t.call(GM, 'GET', '/director')).json.settings.configured).toBe(false);
  });
  it('players may ask for Skill match, grants and Belief checks; the GM kinds are refused; the GM has no character to match', async () => {
    const t = await table();
    const sm = await t.call(ILSE, 'POST', '/llm/skillMatch', { sentence: 'I creep past the guards.' });
    expect(sm.status).toBe(200);
    expect(sm.json.suggestion).toMatchObject({ kind: 'skillMatch', draft: { skill: 'Climb' } }); // the fake picks the first Skill on Ilse's sheet
    const bc = await t.call(ILSE, 'POST', '/llm/beliefCheck', { kind: 'objective', text: 'Expose the duke' });
    expect(bc.json.suggestion).toMatchObject({ kind: 'beliefCheck', draft: { conviction: true, action: false } });
    for (const k of ['beliefChallenge', 'danger', 'npcLine', 'oracle']) expect((await t.call(ILSE, 'POST', `/llm/${k}`, {})).status, k).toBe(403);
    expect((await t.call(ILSE, 'POST', '/llm/nonsense', {})).status).toBe(404);
    expect((await t.call(GM, 'POST', '/llm/skillMatch', { sentence: 'x' })).json.error.code).toBe('GM_HAS_NO_CHARACTER');
    expect((await t.call(ILSE, 'POST', '/llm/skillMatch', {})).status).toBe(400);
  });
  it('the GM kinds work, with the scene, Beliefs, a card and an NPC; the oracle waits for its six faces', async () => {
    const t = await table();
    addParagraph(t.ilse.fragment, attrs('p1', 'ilse'), 'I reach the wall and the captain watches.');
    await waitFor(() => t.gm.fragment.length === 1);
    const card = (await t.call(ILSE, 'POST', '/cards', { skillName: 'Climb', anchorParagraphId: 'p1', want: 'Cross the roof', risk: 'I slip' })).json.card;
    const npc = (await t.call(GM, 'POST', '/npcs', { name: 'Captain Aldous' })).json;
    const ch = await t.call(GM, 'POST', '/llm/beliefChallenge', { characterId: 'ilse-pc', beliefId: 'ilse-core' });
    expect(ch.json.suggestion.draft.prompts.length).toBeGreaterThan(0);
    const prompt = t.fake.calls.at(-1)!.user;
    expect(prompt).toContain('Oaths outlast the people who swear them');
    expect(prompt).toContain('the captain watches');
    expect((await t.call(GM, 'POST', '/llm/danger', { cardId: card.id })).json.suggestion.draft.options[0]).toMatchObject({ rank: 'Serious' });
    expect((await t.call(GM, 'POST', '/llm/npcLine', { npcId: npc.id })).json.suggestion.draft.line).toBeTruthy();
    expect((await t.call(GM, 'POST', '/llm/oracle', {})).json.error.code).toBe('NO_FACES');
    await t.call(GM, 'PUT', '/settings', { faces: ['Old debt', 'A rival', 'Hunger', 'A secret', 'A promise', 'Weather'] });
    expect((await t.call(GM, 'POST', '/llm/oracle', {})).json.suggestion.draft).toMatchObject({ face: 2 });
    expect((await t.call(GM, 'POST', '/llm/danger', { cardId: 'nope' })).status).toBe(404);
  });
  it('grant suggestions come from a chapter\'s prose, for the other players only', async () => {
    const t = await table();
    const mira = track(await connect(t.url, MIRA));
    const tobin = track(await connect(t.url, TOBIN));
    await t.call(MIRA, 'GET', '/me'); await t.call(TOBIN, 'GET', '/me');
    for (const [id, text] of [['m0', 'My origin.'], ['m1', 'I held the barricade for three nights.']] as [string, string][]) { addParagraph(mira.fragment, attrs(id, 'mira'), text); }
    await waitFor(() => t.gm.fragment.length === 2);
    await t.call(MIRA, 'POST', '/creation/origin-post', { paragraphId: 'm0' });
    await t.call(MIRA, 'POST', '/creation/chapter', { paragraphId: 'm1', summary: 'The siege', endsBadly: false });
    void tobin;
    const ask = (who: Identity) => t.call(who, 'POST', '/llm/grant', { characterId: 'mira-pc', chapter: 0 });
    expect((await ask(TOBIN)).json.suggestion.draft).toEqual({ skills: ['Siegecraft', 'Endure'], traits: ['Sleeps Lightly', 'Counts Every Exit'] });
    expect(t.fake.calls.at(-1)!.user).toContain('I held the barricade for three nights.');
    expect((await ask(MIRA)).status).toBe(403); // not for your own chapter
    expect((await t.call(TOBIN, 'POST', '/llm/grant', { characterId: 'mira-pc', chapter: 5 })).status).toBe(404);
  });
  it('a player request never carries GM notes, hidden NPC fields or settings, even when they exist', async () => {
    const t = await table();
    const notes = track(await connect(t.url, GM, `${C}~gm`));
    addParagraph(notes.fragment, attrs('n1', 'gm1'), GM_NOTES);
    const npc = (await t.call(GM, 'POST', '/npcs', { name: 'Aldous' })).json;
    await t.call(GM, 'PATCH', `/npcs/${npc.id}`, { beliefs: [SECRET_FIELD], notes: SECRET_NOTES });
    await t.call(GM, 'PUT', '/settings', { themes: 'cruelty to animals', faces: ['Old debt', 'A rival', 'Hunger', 'A secret', 'A promise', 'Weather'] });
    await t.call(ILSE, 'POST', '/llm/skillMatch', { sentence: 'I climb.' });
    await t.call(ILSE, 'POST', '/llm/beliefCheck', { kind: 'objective', text: 'Expose the duke' });
    expect(t.fake.calls.length).toBe(2);
    for (const c of t.fake.calls) {
      expect(JSON.stringify(c)).not.toContain('SENTINEL');
      expect(JSON.stringify(c)).not.toContain('Old debt');
      expect(c.system).toContain('Handle lightly or leave out: cruelty to animals'); // the themes do ride in every prompt
    }
  });
  it('logs every answer; the GM reads all of them, a player only their own, and only the owner (or GM) can update one', async () => {
    const t = await table();
    const mine = (await t.call(ILSE, 'POST', '/llm/beliefCheck', { kind: 'objective', text: 'a' })).json.suggestion;
    const gms = (await t.call(GM, 'POST', '/llm/oracle', {})).json; // no faces: not logged
    expect(gms.error.code).toBe('NO_FACES');
    await t.call(SELLA, 'POST', '/llm/beliefCheck', { kind: 'objective', text: 'b' });
    const all = (await t.call(GM, 'GET', '/suggestions')).json.suggestions;
    expect(all.map((s: any) => [s.userId, s.kind, s.status, s.provider])).toEqual([['sella', 'beliefCheck', 'shown', 'fake'], ['ilse', 'beliefCheck', 'shown', 'fake']]);
    expect((await t.call(ILSE, 'GET', '/suggestions')).json.suggestions.map((s: any) => s.userId)).toEqual(['ilse']);
    expect((await t.call(SELLA, 'POST', `/suggestions/${mine.id}/status`, { status: 'used' })).status).toBe(404);
    expect((await t.call(ILSE, 'POST', `/suggestions/${mine.id}/status`, { status: 'dismissed' })).status).toBe(200);
    expect((await t.call(ILSE, 'POST', `/suggestions/${mine.id}/status`, { status: 'failed' })).status).toBe(400);
    expect((await t.call(GM, 'GET', '/suggestions')).json.suggestions.find((s: any) => s.id === mine.id).status).toBe('dismissed');
  });
  it('is capped per session; the GM raises the cap or starts a new session; a repeated Skill sentence is answered from memory', async () => {
    const t = await table();
    await t.call(GM, 'PUT', '/settings', { cap: 2 });
    const ask = (text: string) => t.call(ILSE, 'POST', '/llm/beliefCheck', { kind: 'objective', text });
    expect((await ask('one')).json.remaining).toBe(1);
    expect((await ask('two')).json.remaining).toBe(0);
    const third = await ask('three');
    expect([third.status, third.json.error.code]).toEqual([429, 'CAP_REACHED']);
    expect((await t.call(GM, 'GET', '/director')).json.settings).toMatchObject({ cap: 2, used: 2 });
    await t.call(GM, 'POST', '/session/start');
    expect((await ask('three')).status).toBe(200);
    await t.call(GM, 'PUT', '/settings', { cap: 0 });
    expect((await ask('four')).status).toBe(429); // 0 turns the assistant off
    await t.call(GM, 'PUT', '/settings', { cap: 50 });
    const before = t.fake.calls.length;
    const s1 = await t.call(ILSE, 'POST', '/llm/skillMatch', { sentence: 'I creep past the guards.' });
    const s2 = await t.call(ILSE, 'POST', '/llm/skillMatch', { sentence: 'I creep past the guards.' });
    expect(t.fake.calls.length).toBe(before + 1);
    expect(s2.json.suggestion).toMatchObject({ id: s1.json.suggestion.id, cached: true });
    expect((await t.call(GM, 'PUT', '/settings', { cap: -1 })).status).toBe(400);
    expect((await t.call(GM, 'PUT', '/settings', { faces: ['only one'] })).status).toBe(400);
  });
  it('uses only a valid answer: one retry on rubbish, then a clear error that is still logged and counted', async () => {
    const t = await table();
    t.fake.queue('Sorry, I cannot do that.', '{"skill": "Lockpicking"}'); // neither is acceptable (not JSON; not on the sheet)
    const r = await t.call(ILSE, 'POST', '/llm/skillMatch', { sentence: 'I pick the lock.' });
    expect([r.status, r.json.error.code]).toEqual([502, 'BAD_ANSWER']);
    expect(t.fake.calls.length).toBe(2);
    t.fake.queue('garbage', '{"conviction": true, "action": true, "fix": null}'); // the retry succeeds
    expect((await t.call(ILSE, 'POST', '/llm/beliefCheck', { kind: 'objective', text: 'x' })).json.suggestion.draft).toEqual({ conviction: true, action: true, fix: null });
    t.fake.queue(new LlmError('model offline'));
    const down = await t.call(ILSE, 'POST', '/llm/beliefCheck', { kind: 'objective', text: 'y' });
    expect([down.status, down.json.error.code]).toEqual([502, 'LLM_UNAVAILABLE']);
    const log = (await t.call(GM, 'GET', '/suggestions')).json.suggestions;
    expect(log.map((s: any) => s.status)).toEqual(['failed', 'shown', 'failed']);
    expect(JSON.stringify(log[0].output)).toContain('model offline');
  });
});

describe('the GM\'s private notes document', () => {
  it('only the GM can open it; it is not in the shared story, and it is saved', async () => {
    const t = await table();
    const store = (t as unknown as { store: MemoryStore }).store;
    const notes = track(await connect(t.url, GM, `${C}~gm`));
    addParagraph(notes.fragment, attrs('n1', 'gm1'), GM_NOTES);
    await expect(connect(t.url, ILSE, `${C}~gm`)).rejects.toThrow(/auth failed/);
    await expect(connect(t.url, SELLA, `${C}~gm`)).rejects.toThrow(/auth failed/);
    await waitFor(() => store.docs.has(`${C}~gm`));
    expect(t.gm.fragment.length).toBe(0);
    expect(textOf(notes.fragment.get(0) as Y.XmlElement)).toBe(GM_NOTES);
    expect(everything(t.ilse)).not.toContain('SENTINEL');
  });
});
