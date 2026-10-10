import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { FIXTURES, checkAuth, checkLlm, checkMail, render } from '../src/doctor';
import { FakeMailer } from '../src/mail';
import { FakeProvider, LlmError, type LlmProvider } from '../src/llm';

describe('doctor: the model', () => {
  it('asks every kind of question and reports each parse; the fake model passes them all', async () => {
    const checks = await checkLlm(new FakeProvider());
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBe(FIXTURES.length + 1);
    expect(render(checks)).toContain('grant (adapt a template)');
  });
  it('fails the kinds a weak model answers badly, and a model that errors, and says it is not configured when unset', async () => {
    const babbler: LlmProvider = { name: 'babbler', complete: async () => ({ text: 'Sure! Here you go.' }) };
    const bad = await checkLlm(babbler);
    expect(bad.filter((c) => !c.ok).length).toBe(FIXTURES.length);
    const down: LlmProvider = { name: 'down', complete: async () => { throw new LlmError('503'); } };
    expect((await checkLlm(down)).find((c) => c.name === 'oracle')?.detail).toContain('503');
    expect((await checkLlm(null))[0]).toMatchObject({ ok: false });
  });
});

describe('doctor: mail', () => {
  it('sends one test message only when asked', async () => {
    const mailer = new FakeMailer();
    await checkMail(mailer);
    expect(mailer.sent).toHaveLength(0);
    const checks = await checkMail(mailer, 'me@example.com');
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(mailer.sent).toEqual([expect.objectContaining({ to: 'me@example.com' })]);
  });
  it('reports a refusal from the service', async () => {
    const refusing = { name: 'resend', send: async () => { throw new Error('403 domain not verified'); } };
    expect((await checkMail(refusing, 'me@example.com')).find((c) => c.name === 'test message')).toMatchObject({ ok: false, detail: '403 domain not verified' });
  });
});

describe('doctor: sign-in', () => {
  const serve = async (body: unknown, status = 200) => {
    const server = createServer((_req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
  };
  it('passes with published keys, fails with none and no secret, and flags dev switches', async () => {
    const good = await serve({ keys: [{ kty: 'EC' }] });
    const web = { NEXT_PUBLIC_SUPABASE_URL: 'x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'y' };
    expect((await checkAuth({ SUPABASE_URL: good.url, ...web })).every((c) => c.ok)).toBe(true);
    good.close();
    const none = await serve({ keys: [] });
    expect((await checkAuth({ SUPABASE_URL: none.url, ...web })).find((c) => c.name === 'signing keys')?.ok).toBe(false);
    expect((await checkAuth({ SUPABASE_URL: none.url, SUPABASE_JWT_SECRET: 's', ...web })).find((c) => c.name === 'signing keys')?.ok).toBe(true);
    none.close();
    const dev = await checkAuth({ SUPABASE_URL: 'http://127.0.0.1:1', QUILLQUEST_DEV_AUTH: '1' });
    expect(dev.find((c) => c.name === 'QUILLQUEST_DEV_AUTH is off')?.ok).toBe(false);
    expect(dev.find((c) => c.name === 'signing keys')?.ok).toBe(false);
    expect((await checkAuth({}))[0]).toMatchObject({ ok: false });
  });
});
