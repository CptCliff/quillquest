import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeMailer, MailError, ResendMailer, mailerFromEnv } from '../src/mail';
import { Notifier } from '../src/notify/notifier';
import { MemoryNotifyStore } from '../src/notify/store';

const servers: Server[] = [];
afterEach(() => { while (servers.length) servers.pop()!.close(); });

function setup() {
  const store = new MemoryNotifyStore();
  store.emails.set('ilse', 'ilse@example.com');
  store.titles.set('c1', 'The Border War');
  const mailer = new FakeMailer();
  const clock = { t: new Date('2026-10-07T12:00:00Z').getTime() };
  const present = new Set<string>();
  const n = new Notifier({ store, mailer, presence: () => present, publicUrl: 'https://play.example.com/', now: () => new Date(clock.t) });
  return { store, mailer, clock, present, n, advance: (ms: number) => { clock.t += ms; } };
}
const note = (text: string, link = '/story/c1?card=c1', extra = {}) => ({ kind: 'card', text, link, ...extra });

describe('the notifier', () => {
  it('waits two minutes and combines everything into one email with links that go straight to each thing', async () => {
    const t = setup();
    await t.n.notify('c1', 'ilse', note('Your battle contribution is waiting', '/story/c1?battle=b1'));
    t.advance(30_000);
    await t.n.notify('c1', 'ilse', note('It is your turn', '/story/c1?para=p9'));
    t.advance(89_000); // 119 s after the first
    expect(await t.n.tick()).toEqual({ sent: 0, dropped: 0 });
    t.advance(1_000);
    expect(await t.n.tick()).toEqual({ sent: 2, dropped: 0 });
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0]).toMatchObject({ to: 'ilse@example.com', subject: 'The Border War: 2 things are waiting on you' });
    expect(t.mailer.sent[0]!.text).toContain('- Your battle contribution is waiting\n  https://play.example.com/story/c1?battle=b1');
    expect(t.mailer.sent[0]!.text).toContain('https://play.example.com/story/c1?para=p9');
    expect(await t.n.tick()).toEqual({ sent: 0, dropped: 0 }); // sent once
  });
  it('a single message uses it as the subject', async () => {
    const t = setup();
    await t.n.notify('c1', 'ilse', note('Your Danger landed: write your cost'));
    t.advance(120_000);
    await t.n.tick();
    expect(t.mailer.sent[0]!.subject).toBe('The Border War: Your Danger landed: write your cost');
  });
  it('never emails someone who has the campaign open; they can see it', async () => {
    const t = setup();
    await t.n.notify('c1', 'ilse', note('A card'));
    t.present.add('ilse');
    t.advance(120_000);
    expect(await t.n.tick()).toEqual({ sent: 0, dropped: 1 });
    expect(t.mailer.sent).toHaveLength(0);
  });
  it('honours preferences: off queues nothing; a digest waits a day', async () => {
    const t = setup();
    await t.store.setMode('c1', 'ilse', 'off');
    expect(await t.n.notify('c1', 'ilse', note('x'))).toBe(false);
    await t.store.setMode('c1', 'ilse', 'digest');
    await t.n.notify('c1', 'ilse', note('later'));
    t.advance(23 * 3_600_000);
    await t.n.tick();
    expect(t.mailer.sent).toHaveLength(0);
    t.advance(3_600_000);
    await t.n.tick();
    expect(t.mailer.sent).toHaveLength(1);
    await t.n.notify('c1', 'ilse', note('switched off after queuing'));
    await t.store.setMode('c1', 'ilse', 'off');
    t.advance(86_400_000);
    expect((await t.n.tick()).dropped).toBe(1);
    expect(t.mailer.sent).toHaveLength(1);
  });
  it('sends nothing to someone with no address, and one failure only delays the message', async () => {
    const t = setup();
    await t.n.notify('c1', 'nomail', note('x'));
    t.advance(120_000);
    expect(await t.n.tick()).toEqual({ sent: 0, dropped: 1 });
    await t.n.notify('c1', 'ilse', note('retry me'));
    t.advance(120_000);
    t.mailer.failNext = 1;
    expect(await t.n.tick()).toEqual({ sent: 0, dropped: 0 });
    expect(await t.n.tick()).toEqual({ sent: 1, dropped: 0 });
    expect(t.mailer.sent).toHaveLength(1);
  });
  it('a dedupe key sends a reminder once, and people in other campaigns get their own email', async () => {
    const t = setup();
    expect(await t.n.notify('c1', 'ilse', note('Waiting 2 days', '/x', { dedupeKey: 'stall:c1' }))).toBe(true);
    expect(await t.n.notify('c1', 'ilse', note('Waiting 2 days', '/x', { dedupeKey: 'stall:c1' }))).toBe(false);
    t.store.titles.set('c2', 'Another');
    await t.n.notify('c2', 'ilse', note('Elsewhere'));
    t.advance(120_000);
    await t.n.tick();
    expect(t.mailer.sent.map((m) => m.subject).sort()).toEqual(['Another: Elsewhere', 'The Border War: Waiting 2 days']);
  });
});

describe('mail providers', () => {
  async function stub(status: number) {
    const seen: { path: string; body: any; headers: Record<string, unknown> }[] = [];
    const s = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => { seen.push({ path: req.url!, body: JSON.parse(raw), headers: req.headers }); res.writeHead(status, { 'content-type': 'application/json' }); res.end('{}'); });
    });
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    servers.push(s);
    return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
  }
  it('Resend: posts the message with the key, and a refusal is a MailError that does not echo the key', async () => {
    const ok = await stub(200);
    await new ResendMailer({ apiKey: 're_secret', from: 'Quillquest <play@example.com>', baseUrl: ok.url }).send({ to: 'a@b.co', subject: 'S', text: 'T' });
    expect(ok.seen[0]).toMatchObject({ path: '/emails', body: { from: 'Quillquest <play@example.com>', to: ['a@b.co'], subject: 'S', text: 'T' } });
    expect(ok.seen[0]!.headers.authorization).toBe('Bearer re_secret');
    const bad = await stub(422);
    const e = await new ResendMailer({ apiKey: 're_secret', from: 'x', baseUrl: bad.url }).send({ to: 'a@b.co', subject: 'S', text: 'T' }).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(MailError);
    expect((e as Error).message).not.toContain('re_secret');
    await expect(new ResendMailer({ apiKey: 'k', from: 'x', baseUrl: 'http://127.0.0.1:1' }).send({ to: 'a@b.co', subject: 'S', text: 'T' })).rejects.toBeInstanceOf(MailError);
  });
  it('is chosen from the environment: unset means none; fake and log are refused in production; missing settings are named', () => {
    expect(mailerFromEnv({}, false)).toBeNull();
    expect(mailerFromEnv({ QUILLQUEST_MAIL: 'fake' }, false)?.name).toBe('fake');
    expect(mailerFromEnv({ QUILLQUEST_MAIL: 'log' }, false)?.name).toBe('log');
    expect(() => mailerFromEnv({ QUILLQUEST_MAIL: 'fake' }, true)).toThrow(/production/);
    expect(() => mailerFromEnv({ QUILLQUEST_MAIL: 'resend' }, false)).toThrow(/RESEND_API_KEY/);
    expect(mailerFromEnv({ QUILLQUEST_MAIL: 'resend', RESEND_API_KEY: 'k', QUILLQUEST_MAIL_FROM: 'a@b.co' }, false)?.name).toBe('resend');
    expect(() => mailerFromEnv({ QUILLQUEST_MAIL: 'smtp' }, false)).toThrow(/Unknown/);
  });
});
