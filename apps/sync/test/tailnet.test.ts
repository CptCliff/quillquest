import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { buildAuthFromEnv, verifyToken } from '../src/auth/env';
import { TailnetProvider, issueTailnetToken, tailnetIdentity, type TailnetConfig } from '../src/auth/tailnet';
import { startServer } from './helpers';

const SECRET = 'a-long-session-secret-for-tests-0123456789';
const cfg = (over: Partial<TailnetConfig> = {}): TailnetConfig => ({ secret: SECRET, proxySecret: 'proxy-secret-xyz', allow: [], ...over });
const headers = (over: Record<string, string> = {}) => ({ 'x-quillquest-proxy': 'proxy-secret-xyz', 'tailscale-user-login': 'Wren@Example.com', 'tailscale-user-name': 'Wren Vale', ...over });

describe('tailnet identity from the proxy headers', () => {
  it('reads who Tailscale says is calling, with a stable id that never contains the address', () => {
    const a = tailnetIdentity(headers(), cfg())!;
    expect(a).toMatchObject({ email: 'wren@example.com', name: 'Wren Vale' });
    expect(a.userId).toMatch(/^ts-[0-9a-f]{32}$/);
    expect(tailnetIdentity(headers({ 'tailscale-user-login': 'WREN@example.com' }), cfg())!.userId).toBe(a.userId);
    expect(tailnetIdentity(headers({ 'tailscale-user-login': 'other@example.com' }), cfg())!.userId).not.toBe(a.userId);
  });
  it('refuses a call that did not come through the proxy, or that names nobody', () => {
    expect(tailnetIdentity(headers({ 'x-quillquest-proxy': 'wrong' }), cfg())).toBeNull();
    const { 'x-quillquest-proxy': _gone, ...bare } = headers();
    expect(tailnetIdentity(bare, cfg())).toBeNull();
    expect(tailnetIdentity({ 'x-quillquest-proxy': 'proxy-secret-xyz' }, cfg())).toBeNull();
    expect(tailnetIdentity(headers({ 'tailscale-user-login': '' }), cfg())).toBeNull();
  });
  it('honours an allowlist of logins, case-insensitively', () => {
    expect(tailnetIdentity(headers(), cfg({ allow: ['wren@example.com', 'mira@example.com'] }))).not.toBeNull();
    expect(tailnetIdentity(headers({ 'tailscale-user-login': 'stranger@example.com' }), cfg({ allow: ['wren@example.com'] }))).toBeNull();
  });
  it('falls back to the login for a name, and tolerates an encoded name', () => {
    expect(tailnetIdentity(headers({ 'tailscale-user-name': '' }), cfg())!.name).toBe('wren@example.com');
    expect(tailnetIdentity(headers({ 'tailscale-user-name': '=?utf-8?q?Zo=C3=AB?=' }), cfg())!.name.length).toBeGreaterThan(0);
  });
});

describe('the tailnet session token', () => {
  it('is issued for an identity and verified by the provider', async () => {
    const id = tailnetIdentity(headers(), cfg())!;
    const token = await issueTailnetToken(SECRET, id);
    const claims = await new TailnetProvider(SECRET).verify(token);
    expect(claims).toMatchObject({ userId: id.userId, email: 'wren@example.com', name: 'Wren Vale' });
  });
  it('rejects a token signed with another secret, an expired one, one for another audience, and garbage', async () => {
    const id = tailnetIdentity(headers(), cfg())!;
    const provider = new TailnetProvider(SECRET);
    await expect(provider.verify(await issueTailnetToken('another-secret-another-secret-another', id))).rejects.toThrow();
    await expect(provider.verify(await issueTailnetToken(SECRET, id, -10))).rejects.toThrow();
    const wrongAud = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(id.userId).setIssuer('quillquest-tailnet').setAudience('someone-else').setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    await expect(provider.verify(wrongAud)).rejects.toThrow();
    await expect(provider.verify('garbage')).rejects.toThrow();
  });
  it('refuses a short secret', () => {
    expect(() => new TailnetProvider('short')).toThrow(/at least 32/);
  });
});

describe('configuring it from the environment', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'x' };
  it('needs a session secret and a proxy secret, and produces a provider and the route settings', () => {
    expect(() => buildAuthFromEnv({ ...base, QUILLQUEST_AUTH_TAILNET: '1' })).toThrow(/QUILLQUEST_SESSION_SECRET/);
    expect(() => buildAuthFromEnv({ ...base, QUILLQUEST_AUTH_TAILNET: '1', QUILLQUEST_SESSION_SECRET: SECRET })).toThrow(/QUILLQUEST_PROXY_SECRET/);
    const setup = buildAuthFromEnv({ ...base, QUILLQUEST_AUTH_TAILNET: '1', QUILLQUEST_SESSION_SECRET: SECRET, QUILLQUEST_PROXY_SECRET: 'p'.repeat(16), QUILLQUEST_TAILNET_ALLOW: 'A@x.com, b@x.com ' });
    expect(setup.tailnet).toMatchObject({ allow: ['a@x.com', 'b@x.com'] });
    expect(setup.providers.map((p) => p.name)).toEqual(['tailnet']);
  });
  it('can sit beside Supabase, and is off unless asked for', async () => {
    const both = buildAuthFromEnv({ ...base, SUPABASE_URL: 'https://x.supabase.co', QUILLQUEST_AUTH_TAILNET: '1', QUILLQUEST_SESSION_SECRET: SECRET, QUILLQUEST_PROXY_SECRET: 'p'.repeat(16) });
    expect(both.providers.map((p) => p.name).sort()).toEqual(['supabase', 'tailnet']);
    expect(buildAuthFromEnv({ ...base, SUPABASE_URL: 'https://x.supabase.co' }).tailnet).toBeUndefined();
    const token = await issueTailnetToken(SECRET, { userId: 'ts-' + 'a'.repeat(32), email: 'a@x.com', name: 'A' });
    await expect(verifyToken(buildAuthFromEnv({ ...base, SUPABASE_URL: 'https://x.supabase.co' }).providers, token)).rejects.toThrow();
  });
  it('is refused with the dev provider in production, as before', () => {
    expect(() => buildAuthFromEnv({ ...base, QUILLQUEST_DEV_AUTH: '1', QUILLQUEST_AUTH_TAILNET: '1', QUILLQUEST_SESSION_SECRET: SECRET, QUILLQUEST_PROXY_SECRET: 'p'.repeat(16) })).toThrow(/dev/i);
  });
});

describe('POST /api/auth/tailnet', () => {
  const boot = async (over: Partial<TailnetConfig> = {}) => {
    const s = await startServer(undefined, undefined, undefined, undefined, { providers: [new TailnetProvider(SECRET)], tailnet: cfg(over) });
    return s;
  };
  const post = (s: Awaited<ReturnType<typeof boot>>, h: Record<string, string>) => fetch(`${s.http}/api/auth/tailnet`, { method: 'POST', headers: h });

  it('gives a token to someone who came through the proxy as an allowed login, and not otherwise', async () => {
    const s = await boot({ allow: ['wren@example.com'] });
    try {
      const ok = await post(s, headers());
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body).toMatchObject({ email: 'wren@example.com', name: 'Wren Vale' });
      expect(body.userId).toMatch(/^ts-/);
      expect((await post(s, headers({ 'x-quillquest-proxy': 'nope' }))).status).toBe(403);
      expect((await post(s, headers({ 'tailscale-user-login': 'stranger@example.com' }))).status).toBe(403);
      expect((await post(s, {})).status).toBe(403);
      const me = await fetch(`${s.http}/api/campaigns/table-1/me`, { headers: { Authorization: `Bearer ${body.token}` } });
      expect(me.status).not.toBe(401); // the game API accepts the token (membership is another matter)
    } finally { await s.server.destroy(); }
  });
  it('does not exist when the server is not in tailnet mode', async () => {
    const s = await startServer();
    try { expect((await fetch(`${s.http}/api/auth/tailnet`, { method: 'POST', headers: headers() })).status).toBe(404); } finally { await s.server.destroy(); }
  });
});
