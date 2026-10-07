import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { SupabaseProvider } from '../src/auth/supabase';
import { DevProvider } from '../src/auth/dev';
import { buildAuthFromEnv } from '../src/auth/env';
import { signDevToken } from '../src/auth';

const ISSUER = 'https://proj.supabase.co/auth/v1';
const SECRET = 'a-very-long-supabase-jwt-secret-for-tests-only';
const key = new TextEncoder().encode(SECRET);

let server: Server;
let jwksUrl: string;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  const other = await generateKeyPair('ES256');
  privateKey = pair.privateKey; otherKey = other.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  server = createServer((_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  jwksUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/jwks.json`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const hs = (claims: Record<string, unknown> = {}, o: { aud?: string; iss?: string; exp?: string | number } = {}) =>
  new SignJWT({ role: 'authenticated', email: 'ilse@example.com', ...claims })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('user-1').setIssuer(o.iss ?? ISSUER).setAudience(o.aud ?? 'authenticated')
    .setIssuedAt().setExpirationTime(o.exp ?? '1h').sign(key);
const es = (k: CryptoKey, claims: Record<string, unknown> = {}) =>
  new SignJWT({ role: 'authenticated', ...claims }).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject('user-2')
    .setIssuer(ISSUER).setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(k);
const unsigned = () => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none', typ: 'JWT' })}.${b({ sub: 'attacker', role: 'authenticated', aud: 'authenticated', iss: ISSUER, exp: 4102444800 })}.`;
};

describe('SupabaseProvider (HS256 project secret)', () => {
  const p = () => new SupabaseProvider({ issuer: ISSUER, jwtSecret: SECRET });
  it('accepts a valid session token and returns the user id and email', async () => {
    expect(await p().verify(await hs())).toEqual({ userId: 'user-1', email: 'ilse@example.com' });
  });
  it('rejects expired, wrong-audience, wrong-issuer and badly signed tokens', async () => {
    await expect(p().verify(await hs({}, { exp: Math.floor(Date.now() / 1000) - 3600 }))).rejects.toThrow();
    await expect(p().verify(await hs({}, { aud: 'somebody-else' }))).rejects.toThrow();
    await expect(p().verify(await hs({}, { iss: 'https://evil.example/auth/v1' }))).rejects.toThrow();
    const wrong = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setIssuer(ISSUER).setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode('another-secret-another-secret-another'));
    await expect(p().verify(wrong)).rejects.toThrow();
  });
  it('rejects an unsigned token, garbage, and a tampered payload', async () => {
    await expect(p().verify(unsigned())).rejects.toThrow();
    await expect(p().verify('not.a.jwt')).rejects.toThrow();
    await expect(p().verify('')).rejects.toThrow();
    const [h, , s] = (await hs()).split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'attacker', role: 'authenticated', aud: 'authenticated', iss: ISSUER, exp: 4102444800 })).toString('base64url')}.${s}`;
    await expect(p().verify(forged)).rejects.toThrow();
  });
  it('rejects the anon key and any token without a user', async () => {
    const anon = await new SignJWT({ role: 'anon' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setAudience('authenticated').setExpirationTime('10y').sign(key);
    await expect(p().verify(anon)).rejects.toThrow();
    const noSub = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setAudience('authenticated').setExpirationTime('1h').sign(key);
    await expect(p().verify(noSub)).rejects.toThrow(/user/i);
    await expect(p().verify(await hs({ role: 'service_role' }))).rejects.toThrow();
  });
});

describe('SupabaseProvider (asymmetric keys from JWKS)', () => {
  const p = () => new SupabaseProvider({ issuer: ISSUER, jwksUrl });
  it('accepts a token signed by the project key', async () => {
    expect(await p().verify(await es(privateKey))).toMatchObject({ userId: 'user-2' });
  });
  it('rejects a token signed by some other key, even with the right kid', async () => {
    await expect(p().verify(await es(otherKey))).rejects.toThrow();
  });
  it('is not fooled by algorithm confusion: an HS256 token is refused when only a JWKS is configured', async () => {
    await expect(p().verify(await hs())).rejects.toThrow();
  });
  it('with both configured, each algorithm takes its own path', async () => {
    const both = new SupabaseProvider({ issuer: ISSUER, jwksUrl, jwtSecret: SECRET });
    expect((await both.verify(await hs())).userId).toBe('user-1');
    expect((await both.verify(await es(privateKey))).userId).toBe('user-2');
    await expect(both.verify(unsigned())).rejects.toThrow();
  });
});

describe('DevProvider', () => {
  const dev = new DevProvider('s3cret');
  it('accepts a token it signed and carries the claimed name and color', async () => {
    const t = signDevToken({ id: 'ilse', name: 'Ilse', role: 'player', color: '#c2410c' }, 's3cret');
    expect(await dev.verify(t)).toMatchObject({ userId: 'ilse', name: 'Ilse', color: '#c2410c', role: 'player' });
  });
  it('rejects another secret, a forged role, and garbage', async () => {
    const t = signDevToken({ id: 'ilse', name: 'Ilse', role: 'player', color: '#c2410c' }, 'other');
    await expect(dev.verify(t)).rejects.toThrow();
    const forged = `${Buffer.from(JSON.stringify({ id: 'ilse', name: 'I', role: 'gm', color: '#000000' })).toString('base64url')}.bogus`;
    await expect(dev.verify(forged)).rejects.toThrow();
    await expect(dev.verify('garbage')).rejects.toThrow();
  });
});

describe('buildAuthFromEnv: the dev provider can never reach production', () => {
  const supa = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_JWT_SECRET: SECRET };
  it('uses only Supabase in production', () => {
    const a = buildAuthFromEnv({ NODE_ENV: 'production', ...supa });
    expect(a.providers.map((p) => p.name)).toEqual(['supabase']);
    expect(a.devAuth).toBe(false);
  });
  it('refuses to start in production with dev auth switched on', () => {
    expect(() => buildAuthFromEnv({ NODE_ENV: 'production', QUILLQUEST_DEV_AUTH: '1', ...supa })).toThrow(/production/i);
  });
  it('refuses to start in production with no real provider configured', () => {
    expect(() => buildAuthFromEnv({ NODE_ENV: 'production' })).toThrow(/Supabase/i);
  });
  it('dev auth needs an explicit flag; outside production it can run alongside Supabase', () => {
    expect(() => buildAuthFromEnv({})).toThrow(/QUILLQUEST_DEV_AUTH|SUPABASE/);
    const a = buildAuthFromEnv({ QUILLQUEST_DEV_AUTH: '1', QUILLQUEST_DEV_SECRET: 'x' });
    expect(a.providers.map((p) => p.name)).toEqual(['dev']);
    expect(a.devAuth).toBe(true);
    const both = buildAuthFromEnv({ QUILLQUEST_DEV_AUTH: '1', ...supa });
    expect(both.providers.map((p) => p.name)).toEqual(['supabase', 'dev']);
  });
  it('requires a way to check Supabase tokens: a JWT secret or a JWKS (the URL gives the JWKS)', () => {
    expect(() => buildAuthFromEnv({ NODE_ENV: 'production', SUPABASE_URL: 'https://proj.supabase.co' })).not.toThrow(); // JWKS from the URL
    expect(() => buildAuthFromEnv({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: SECRET })).toThrow(/SUPABASE_URL/);
  });
});
