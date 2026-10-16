import { DevProvider } from './dev';
import { SupabaseProvider } from './supabase';
import { TailnetProvider, type TailnetConfig } from './tailnet';
import { AuthError, type AuthProvider, type Claims } from './types';

export interface AuthSetup { providers: AuthProvider[]; devAuth: boolean; /** Present when sign-in through the Tailscale proxy is switched on. */ tailnet?: TailnetConfig }

/**
 * Chooses providers from the environment. The dev provider needs an explicit flag and is refused outright in production,
 * because anyone holding its secret could mint a token for any user.
 */
export function buildAuthFromEnv(env: Record<string, string | undefined>): AuthSetup {
  const production = env.NODE_ENV === 'production';
  const devAuth = env.QUILLQUEST_DEV_AUTH === '1';
  if (production && devAuth) throw new Error('QUILLQUEST_DEV_AUTH must not be set in production');
  const providers: AuthProvider[] = [];
  if (env.SUPABASE_URL || env.SUPABASE_JWT_SECRET) {
    if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL is required: it names the token issuer and where the signing keys are published');
    const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
    providers.push(new SupabaseProvider({ issuer: base, jwksUrl: `${base}/.well-known/jwks.json`, jwtSecret: env.SUPABASE_JWT_SECRET }));
  }
  let tailnet: TailnetConfig | undefined;
  if (env.QUILLQUEST_AUTH_TAILNET === '1') {
    if (!env.QUILLQUEST_SESSION_SECRET) throw new Error('QUILLQUEST_SESSION_SECRET is required for QUILLQUEST_AUTH_TAILNET=1 (32 or more random characters)');
    if (!env.QUILLQUEST_PROXY_SECRET || env.QUILLQUEST_PROXY_SECRET.length < 16) throw new Error('QUILLQUEST_PROXY_SECRET is required for QUILLQUEST_AUTH_TAILNET=1 (16 or more random characters, shared with the proxy)');
    providers.push(new TailnetProvider(env.QUILLQUEST_SESSION_SECRET));
    tailnet = { secret: env.QUILLQUEST_SESSION_SECRET, proxySecret: env.QUILLQUEST_PROXY_SECRET, allow: (env.QUILLQUEST_TAILNET_ALLOW ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) };
  }
  if (devAuth) providers.push(new DevProvider(env.QUILLQUEST_DEV_SECRET ?? 'dev-secret'));
  if (providers.length === 0) throw new Error('Configure Supabase (SUPABASE_URL, and SUPABASE_JWT_SECRET for HS256 projects), QUILLQUEST_AUTH_TAILNET=1, or set QUILLQUEST_DEV_AUTH=1 for local development');
  return { providers, devAuth, ...(tailnet ? { tailnet } : {}) };
}

/** The first provider that accepts the token wins. */
export async function verifyToken(providers: AuthProvider[], token: string): Promise<Claims> {
  for (const p of providers) {
    try { return await p.verify(token); } catch { /* try the next */ }
  }
  throw new AuthError('invalid sign-in');
}
