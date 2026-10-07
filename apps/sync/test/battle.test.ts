import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MemoryStore } from '../src/store';
import { FakeMailer } from '../src/mail';
import { MemoryNotifyStore } from '../src/notify/store';
import { type Identity } from '../src/auth';
import { GM, ILSE, SELLA, addParagraph, api, attrs, connect, startServer, textOf, waitFor, type Client } from './helpers';

const open: { destroy(): void | Promise<void> }[] = [];
const track = <T extends { destroy(): void | Promise<void> }>(x: T) => (open.push(x), x);
afterEach(async () => { while (open.length) await open.pop()!.destroy(); });

const ROOK: Identity = { id: 'rook', name: 'Rook', role: 'player', color: '#7e22ce' };
const MIRA: Identity = { id: 'mira', name: 'Mira', role: 'player', color: '#0e7490' };
const C = 'campaign-1';
const base = `/api/campaigns/${C}`;

/** A GM and four players. Mira is never connected, so she is the offline one. */
async function table() {
  const mailer = new FakeMailer();
  const store = new MemoryNotifyStore();
  for (const id of ['gm1', 'ilse', 'sella', 'rook', 'mira']) store.emails.set(id, `${id}@example.com`);
  store.titles.set(C, 'The Border War');
  const s = await startServer(new MemoryStore(), { devDice: true }, null, { mailer, store, publicUrl: 'https://play.example.com', intervalMs: null, devRoutes: true });
  track({ destroy: () => s.server.destroy() });
  const gm = track(await connect(s.url, GM));
  const clients: Record<string, Client> = { ilse: track(await connect(s.url, ILSE)), sella: track(await connect(s.url, SELLA)), rook: track(await connect(s.url, ROOK)) };
  const call = (who: Identity | null, method: string, path: string, body?: unknown) => api(s.http, who, method, `${base}${path}`, body);
  for (const p of [ILSE, SELLA, ROOK, MIRA]) await call(p, 'GET', '/me');
  await call(GM, 'GET', '/director');
  addParagraph(gm.fragment, attrs('frame', 'gm1'), 'The captain\'s men hold the barricade.');
  await waitFor(() => clients.ilse!.fragment.length === 1);
  const dice = (values: number[]) => api(s.http, null, 'POST', `/api/dev/campaigns/${C}/dice`, { values });
  const mail = {
    sent: async () => (await api(s.http, null, 'GET', '/api/dev/mail')).json.sent as { to: string; subject: string; text: string }[],
    advance: (ms: number) => api(s.http, null, 'POST', '/api/dev/mail/advance', { ms }),
    tick: () => api(s.http, null, 'POST', '/api/dev/mail/tick', {}),
  };
  return { ...s, gm, clients, call, dice, mail, mailer };
}
type T = Awaited<ReturnType<typeof table>>;

async function opened(t: T) {
  const r = await t.call(GM, 'POST', '/battles', { goal: 'Take the barricade', battleDanger: 'I am cut down at the gap', difficulty: 'Hard', dangerRank: 'Severe', framingParagraphId: 'frame', leadCharacterId: 'ilse-pc' });
  expect(r.status).toBe(200);
  return r.json.battle.id as string;
}
async function declared(t: T) {
  const id = await opened(t);
  expect((await t.call(ILSE, 'PATCH', `/battles/${id}/lead`, { want: 'Break the line', risk: 'I fall at the gap', skillName: 'Climb' })).status).toBe(200);
  expect((await t.call(SELLA, 'POST', `/battles/${id}/declare`, { line: 'Sella opens the flank', type: 'open', dangerRank: 'Serious', dangerText: 'Wounded by return fire' })).status).toBe(200);
  expect((await t.call(MIRA, 'POST', `/battles/${id}/declare`, { line: 'Mira charges the gap', type: 'press', dangerRank: 'Serious', dangerText: 'Cut in the melee' })).status).toBe(200);
  expect((await t.call(ROOK, 'POST', `/battles/${id}/declare`, { line: 'Rook fires the wagon', type: 'cover', target: 'ilse-pc', dangerRank: 'Real', dangerText: 'The fire spreads' })).status).toBe(200);
  return id;
}
const publicBattle = (c: Client, id: string) => c.doc.getMap('battles').get(id) as any;

describe('who may do what in a battle', () => {
  it('only the GM opens, sets, rolls, orders and stitches; only contributors declare; only the lead pushes', async () => {
    const t = await table();
    const asPlayer: [string, string, unknown][] = [['POST', '/battles', { goal: 'x', battleDanger: 'y', difficulty: 'Hard', dangerRank: 'Severe', leadCharacterId: 'ilse-pc' }]];
    for (const [m, p, b] of asPlayer) expect((await t.call(ILSE, m, p, b)).status).toBe(403);
    const id = await declared(t);
    for (const [path, body] of [['set', {}], ['roll', {}], ['order', { ids: ['sella-pc', 'mira-pc', 'rook-pc'] }], ['stitch', {}], ['skip', { characterId: 'sella-pc' }]] as const) {
      expect((await t.call(SELLA, 'POST', `/battles/${id}/${path}`, body)).status, path).toBe(403);
      expect((await t.call(null, 'POST', `/battles/${id}/${path}`, body)).status, `${path} signed out`).toBe(401);
    }
    expect((await t.call(GM, 'POST', `/battles/${id}/declare`, { line: 'x', type: 'open', dangerRank: 'Real', dangerText: 'y' })).status).toBe(403);
    expect((await t.call(ILSE, 'POST', `/battles/${id}/declare`, { line: 'x', type: 'open', dangerRank: 'Real', dangerText: 'y' })).status).toBe(403); // the lead has the main card
    expect((await t.call(SELLA, 'PATCH', `/battles/${id}/lead`, { want: 'x' })).status).toBe(403);
    expect((await t.call(ILSE, 'POST', `/battles/${id}/roll`)).status).toBe(403);
    expect((await t.call(GM, 'POST', '/battles/nope/roll')).status).toBe(404);
    expect((await t.call(ILSE, 'GET', `/battles/${id}/dice`)).status).toBe(403);
  });
  it('the table sees words only: no dice in the public map, before or after the roll, until someone reveals', async () => {
    const t = await table();
    const id = await declared(t);
    await t.call(GM, 'POST', `/battles/${id}/set`, {});
    await t.dice([1, 8, 1, 1, 1, 1]);
    expect((await t.call(GM, 'POST', `/battles/${id}/roll`)).status).toBe(200);
    await waitFor(() => publicBattle(t.clients.sella!, id)?.status === 'rolled');
    const pb = publicBattle(t.clients.sella!, id);
    expect(pb.odds.goal).toMatch(/Desperate|Long shot|Even|Favored|Sure bet/);
    expect(pb.result.goal).toBe(false);
    expect(JSON.stringify(pb)).not.toMatch(/skillDie|difficultyDie|"kept"|"die"|"value"|"sides"/);
    expect(pb.dice).toBeNull();
    const dice = (await t.call(GM, 'GET', `/battles/${id}/dice`)).json.dice;
    expect(dice.attempt.skill.value).toBe(1);
    expect((await t.call(SELLA, 'POST', `/battles/${id}/reveal`)).status).toBe(200);
    await waitFor(() => !!publicBattle(t.clients.ilse!, id).dice);
  });
});

describe('a four-player battle', () => {
  it('declares, sets, rolls, pushes with a withdrawal, writes beats and stitches them into one post in each writer\'s ink', async () => {
    const t = await table();
    const id = await declared(t);
    await waitFor(() => publicBattle(t.clients.ilse!, id)?.waitingOn.length === 0);
    await t.call(GM, 'POST', `/battles/${id}/set`, {});
    // Skill d10 (Mira presses), Difficulty d8 (Sella opens), then one Danger die for each of the four.
    await t.dice([1, 8, 1, 1, 1, 1]);
    await t.call(GM, 'POST', `/battles/${id}/roll`);
    // The lead pushes; the contributors are asked. Sella withdraws; Mira and Rook stay, so the window closes at once.
    expect((await t.call(ILSE, 'POST', `/battles/${id}/push`, { kind: 'standard' })).json.battle.status).toBe('pushing');
    expect((await t.call(SELLA, 'POST', `/battles/${id}/answer`, { answer: 'withdraw' })).status).toBe(200);
    expect((await t.call(ILSE, 'POST', `/battles/${id}/answer`, { answer: 'stay' })).status).toBe(403); // the lead cannot withdraw
    await t.dice([8, 1, 1, 1, 1]); // second Skill and Difficulty, then rechecks for Ilse, Mira and Rook (Sella's Danger left)
    await t.call(MIRA, 'POST', `/battles/${id}/answer`, { answer: 'stay' });
    const done = await t.call(ROOK, 'POST', `/battles/${id}/answer`, { answer: 'stay' });
    expect(done.json.battle.status).toBe('rolled');
    expect(done.json.battle.result).toMatchObject({ goal: true, push: 'standard' });
    expect(done.json.battle.result.dangers.find((d: any) => d.characterId === 'sella-pc')).toMatchObject({ withdrawn: true });
    // Beats: one to three sentences each.
    const beat = (who: Identity, text: string) => t.call(who, 'POST', `/battles/${id}/beat`, { text });
    expect((await beat(ILSE, 'x. y. z. w.')).status).toBe(409);
    expect((await beat(ILSE, 'Ilse breaks the line. The barricade falls.')).status).toBe(200);
    expect((await t.call(GM, 'POST', `/battles/${id}/stitch`, {})).json.error.code).toBe('BEATS_PENDING');
    await beat(SELLA, 'Sella\'s archers pin the flank.'); await beat(MIRA, 'Mira charges the gap.'); await beat(ROOK, 'Rook fires the wagon; smoke fills the street.');
    expect((await t.call(GM, 'POST', `/battles/${id}/order`, { ids: ['rook-pc', 'mira-pc', 'sella-pc'] })).status).toBe(200);
    const stitched = await t.call(GM, 'POST', `/battles/${id}/stitch`, {});
    expect(stitched.json.battle.status).toBe('written');
    await waitFor(() => t.gm.fragment.length === 5);
    const paras = t.gm.fragment.toArray() as Y.XmlElement[];
    expect(paras.slice(1).map((p) => [p.getAttribute('authorId'), textOf(p)])).toEqual([
      ['ilse', 'Ilse breaks the line. The barricade falls.'], ['rook', 'Rook fires the wagon; smoke fills the street.'], ['mira', 'Mira charges the gap.'], ['sella', 'Sella\'s archers pin the flank.'],
    ]);
    expect(paras.slice(1).every((p) => String(p.getAttribute('locked')) === 'true')).toBe(true);
  });
  it('a Danger that landed needs its cost written, and the wound goes on the sheet through the engine', async () => {
    const t = await table();
    const id = await declared(t);
    await t.call(GM, 'POST', `/battles/${id}/set`, {});
    await t.dice([1, 8, 1, 8, 1, 1]); // goal fails; Sella's Danger lands
    await t.call(GM, 'POST', `/battles/${id}/roll`);
    await t.call(ILSE, 'POST', `/battles/${id}/concede-battle`, { kind: 'surrender' });
    const beat = (who: Identity, body: unknown) => t.call(who, 'POST', `/battles/${id}/beat`, body);
    await beat(ILSE, { text: 'Ilse falls back.' }); await beat(MIRA, { text: 'Mira holds.' }); await beat(ROOK, { text: 'Rook runs.' });
    await beat(SELLA, { text: 'Sella is shot.' });
    expect((await t.call(GM, 'POST', `/battles/${id}/stitch`, {})).json.error.code).toBe('COST_PENDING');
    await beat(SELLA, { text: 'Sella is shot.', cost: { text: 'A bolt takes her in the shoulder.', woundName: 'Bolt in the shoulder', woundLevel: 'Wounded' } });
    expect((await t.call(GM, 'POST', `/battles/${id}/stitch`, {})).status).toBe(200);
    await waitFor(() => (t.clients.ilse!.doc.getMap('characters').get('sella-pc') as any).wounds.length === 1);
    expect((t.clients.ilse!.doc.getMap('characters').get('sella-pc') as any).wounds[0]).toMatchObject({ name: 'Bolt in the shoulder', level: 'Wounded' });
  });
  it('a push window that runs out resolves by itself, so one slow contributor cannot stall the table', async () => {
    const t = await table();
    const id = await declared(t);
    await t.call(GM, 'PUT', '/settings', { pushWindowMinutes: 5 });
    await t.call(GM, 'POST', `/battles/${id}/set`, {});
    await t.dice([1, 8, 1, 1, 1, 1]);
    await t.call(GM, 'POST', `/battles/${id}/roll`);
    await t.call(ILSE, 'POST', `/battles/${id}/push`, { kind: 'standard' });
    expect((await t.call(GM, 'POST', `/battles/${id}/resolve-push`, {})).json.error.code).toBe('PUSH_NOT_READY');
    await t.mail.advance(5 * 60_000);
    await t.dice([8, 1, 1, 1, 1, 1]);
    const jobs = (await t.mail.tick()).json.result;
    expect(jobs.pushes).toBe(1);
    await waitFor(() => publicBattle(t.clients.ilse!, id)?.status === 'rolled');
  });
  it('the lead may spend Conviction instead: no window, no recheck', async () => {
    const t = await table();
    const id = await declared(t);
    await t.call(GM, 'POST', `/battles/${id}/set`, {});
    await t.dice([1, 8, 1, 1, 1, 1]);
    await t.call(GM, 'POST', `/battles/${id}/roll`);
    await t.dice([8, 1]);
    const r = await t.call(ILSE, 'POST', `/battles/${id}/push`, { kind: 'conviction' });
    expect(r.json.battle).toMatchObject({ status: 'rolled', result: { push: 'conviction', goal: true } });
    await waitFor(() => (t.clients.sella!.doc.getMap('characters').get('ilse-pc') as any).conviction === 0);
  });
});

describe('async play: who the story is waiting on, and the email', () => {
  it('an offline player gets one batched email, after the wait, with a link that goes straight to the battle; people with the table open get none', async () => {
    const t = await table();
    const id = await opened(t);
    await t.mail.tick();
    expect(await t.mail.sent()).toEqual([]); // too soon
    await t.mail.advance(2 * 60_000);
    await t.mail.tick();
    const sent = await t.mail.sent();
    expect(sent.map((m) => m.to)).toEqual(['mira@example.com']); // Ilse, Sella and Rook have the campaign open
    expect(sent[0]!.subject).toBe('The Border War: A battle opens: Take the barricade. Declare your contribution.');
    expect(sent[0]!.text).toContain(`https://play.example.com/story/${C}?battle=${id}`);
    await t.mail.tick();
    expect(await t.mail.sent()).toHaveLength(1); // sent once
  });
  it('tells the GM, and only the GM, when everyone has declared; the GM is not emailed while they have the table open', async () => {
    const t = await table();
    const id = await opened(t);
    await t.call(ILSE, 'PATCH', `/battles/${id}/lead`, { want: 'w', risk: 'r', skillName: 'Climb' });
    for (const [who, type] of [[SELLA, 'open'], [ROOK, 'press'], [MIRA, 'press']] as const) await t.call(who, 'POST', `/battles/${id}/declare`, { line: 'a', type, dangerRank: 'Real', dangerText: 'b' });
    await t.mail.advance(2 * 60_000);
    await t.mail.tick();
    expect((await t.mail.sent()).map((m) => m.to)).toEqual(['mira@example.com']); // the GM is connected: they can see it
    // The GM closes the table, someone concedes and re-declares, and now the GM is away when it is ready again.
    t.gm.destroy();
    await new Promise((r) => setTimeout(r, 300));
    await t.call(MIRA, 'POST', `/battles/${id}/concede`);
    await t.mail.advance(2 * 60_000);
    await t.mail.tick();
    const gmMail = (await t.mail.sent()).filter((m) => m.to === 'gm1@example.com');
    expect(gmMail).toHaveLength(1);
    expect(gmMail[0]!.subject).toContain('is ready for you to Set');
    expect(gmMail[0]!.text).toContain(`?battle=${id}`);
  });
  it('notification preferences: off means no email; a digest waits a day', async () => {
    const t = await table();
    expect((await t.call(MIRA, 'GET', '/prefs')).json).toEqual({ mode: 'immediate', hasEmail: true });
    expect((await t.call(MIRA, 'PUT', '/prefs', { mode: 'sometimes' })).status).toBe(400);
    expect((await t.call(MIRA, 'PUT', '/prefs', { mode: 'off' })).status).toBe(200);
    await opened(t);
    await t.mail.advance(2 * 60_000);
    await t.mail.tick();
    expect(await t.mail.sent()).toEqual([]);
    await t.call(MIRA, 'PUT', '/prefs', { mode: 'digest' });
    await opened(t);
    await t.mail.advance(2 * 60_000);
    await t.mail.tick();
    expect(await t.mail.sent()).toEqual([]);
    await t.mail.advance(24 * 3_600_000);
    await t.mail.tick();
    expect((await t.mail.sent()).map((m) => m.to)).toEqual(['mira@example.com']);
  });
  it('reminds the GM once when a battle has waited too long', async () => {
    const t = await table();
    await t.call(GM, 'PUT', '/settings', { stallHours: 24 });
    const id = await opened(t);
    t.gm.destroy();
    for (const c of Object.values(t.clients)) c.destroy();
    await new Promise((r) => setTimeout(r, 300));
    await t.mail.advance(25 * 3_600_000);
    expect((await t.mail.tick()).json.result.stalls).toBe(1);
    await t.mail.advance(2 * 60_000);
    await t.mail.tick();
    const gmMail = (await t.mail.sent()).filter((m) => m.to === 'gm1@example.com');
    expect(gmMail).toHaveLength(1);
    expect(gmMail[0]!.text).toContain(`?battle=${id}`);
    expect((await t.mail.tick()).json.result.stalls).toBe(1); // still waiting, but the reminder is deduped: no second email
    await t.mail.advance(2 * 60_000);
    await t.mail.tick();
    expect((await t.mail.sent()).filter((m) => m.to === 'gm1@example.com')).toHaveLength(1);
  });
});

describe('the spotlight', () => {
  it('the holder passes it; the new holder is told; the GM may take it; a left-out player is due', async () => {
    const t = await table();
    await waitFor(() => (t.clients.ilse!.doc.getMap('campaign').get('spotlight') as any)?.players.length === 4);
    const sp = () => t.clients.ilse!.doc.getMap('campaign').get('spotlight') as any;
    const first = sp().holder;
    expect(['ilse', 'sella', 'rook', 'mira']).toContain(first);
    const holder = { ilse: ILSE, sella: SELLA, rook: ROOK, mira: MIRA }[first as 'ilse']!;
    const other = [ILSE, SELLA, ROOK, MIRA].find((p) => p.id !== first)!;
    expect((await t.call(other, 'POST', '/spotlight/pass', { to: other.id })).status).toBeGreaterThanOrEqual(400); // not your turn
    expect((await t.call(holder, 'POST', '/spotlight/pass', { to: other.id })).status).toBe(200);
    await waitFor(() => sp().holder === other.id);
    expect((await t.call(holder, 'POST', '/spotlight/pass', { to: 'ilse' })).status).toBe(409);
    expect((await t.call(other, 'POST', '/spotlight/take')).status).toBe(403);
    expect((await t.call(GM, 'POST', '/spotlight/take')).status).toBe(200);
    await waitFor(() => sp().holder === 'gm1');
    expect((await t.call(GM, 'POST', '/spotlight/pass', { to: 'mira' })).status).toBe(200);
    await t.mail.advance(2 * 60_000);
    await t.mail.tick();
    expect((await t.mail.sent()).some((m) => m.to === 'mira@example.com' && m.text.includes('spotlight has passed to you'))).toBe(true);
  });
});
