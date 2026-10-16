// Sign-in for a table that lives on a Tailscale network (docs/self-hosting.md). `tailscale serve` puts a verified
// identity on each request it forwards (Tailscale-User-Login, Tailscale-User-Name). The browser asks for a session token here,
// and from then on the token, not the header, is what every request and socket carries: the same shape as any other provider.
//
// Trust: those headers mean nothing unless the request really came through `tailscale serve`. Two things keep that true:
// the sync server is only reachable on the private Docker network, and the proxy in front of it adds a shared secret
// (X-Quillquest-Proxy) that a caller who bypassed the proxy would not know.
import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { AuthError, type AuthProvider, type Claims } from './types';

const ISSUER = 'quillquest-tailnet';
const AUDIENCE = 'quillquest';

export interface TailnetConfig {
  /** Signs the session tokens this server issues. At least 32 characters. */
  secret: string;
  /** Shared with the proxy; a request without it did not come through the proxy. */
  proxySecret: string;
  /** Logins (lower case) allowed in. Empty means everyone who can reach the server over the tailnet. */
  allow: string[];
}
export interface TailnetIdentity { userId: string; email: string; name: string }

const key = (secret: string) => new TextEncoder().encode(secret);
const same = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Tailscale may send a name as an RFC 2047 encoded word; decode the common case and fall back to the raw text. */
function decodeName(raw: string): string {
  const m = /^=\?utf-8\?q\?(.*)\?=$/i.exec(raw.trim());
  if (!m) return raw.trim();
  try { return decodeURIComponent(m[1]!.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, '%$1')); } catch { return raw.trim(); }
}

/** Who Tailscale says is calling, or null when the request did not come through the proxy or the login is not allowed. */
export function tailnetIdentity(headers: Record<string, string | string[] | undefined>, cfg: TailnetConfig): TailnetIdentity | null {
  if (!same(first(headers['x-quillquest-proxy']), cfg.proxySecret)) return null;
  const login = first(headers['tailscale-user-login']).trim().toLowerCase();
  if (!login) return null;
  if (cfg.allow.length && !cfg.allow.includes(login)) return null;
  const name = decodeName(first(headers['tailscale-user-name'])) || login;
  // A stable id that is safe in document names and never contains the address.
  return { userId: `ts-${createHash('sha256').update(login).digest('hex').slice(0, 32)}`, email: login, name };
}

export async function issueTailnetToken(secret: string, id: TailnetIdentity, ttlSeconds = 12 * 3600): Promise<string> {
  return new SignJWT({ email: id.email, name: id.name })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(id.userId).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds).sign(key(secret));
}

export class TailnetProvider implements AuthProvider {
  readonly name = 'tailnet';
  constructor(private secret: string) {
    if (secret.length < 32) throw new Error('QUILLQUEST_SESSION_SECRET must be at least 32 characters');
  }
  async verify(token: string): Promise<Claims> {
    try {
      const { payload } = await jwtVerify(token, key(this.secret), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'], clockTolerance: 5 });
      if (!payload.sub) throw new Error('no subject');
      return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined, name: typeof payload.name === 'string' ? payload.name : undefined };
    } catch (e) {
      throw new AuthError(e instanceof Error ? e.message : 'invalid tailnet token');
    }
  }
}
