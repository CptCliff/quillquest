import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { AuthError, type AuthProvider, type Claims } from './types';

export interface SupabaseConfig {
  /** `${SUPABASE_URL}/auth/v1` */
  issuer: string;
  audience?: string;
  /** Legacy projects sign with a shared secret (HS256). */
  jwtSecret?: string;
  /** Newer projects sign with asymmetric keys published as a JWKS. */
  jwksUrl?: string;
}

const ASYMMETRIC = ['ES256', 'RS256', 'EdDSA'];

/**
 * Verifies a Supabase Auth access token. The algorithm is taken from the token header only to pick which configured key
 * to use, and then pinned: an HS256 token is only ever checked against the secret and an asymmetric one only against the
 * JWKS, so a token signed with a public key as an HMAC secret (algorithm confusion) and `alg: none` are both refused.
 * A token must name a user (`sub`) and carry the `authenticated` role, which keeps the anon key out.
 */
export class SupabaseProvider implements AuthProvider {
  readonly name = 'supabase';
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private secret?: Uint8Array;

  constructor(private cfg: SupabaseConfig) {
    if (cfg.jwksUrl) this.jwks = createRemoteJWKSet(new URL(cfg.jwksUrl));
    if (cfg.jwtSecret) this.secret = new TextEncoder().encode(cfg.jwtSecret);
  }

  async verify(token: string): Promise<Claims> {
    let alg: string | undefined;
    try { alg = decodeProtectedHeader(token).alg; } catch { throw new AuthError('not a token'); }
    const opts = { issuer: this.cfg.issuer, audience: this.cfg.audience ?? 'authenticated', clockTolerance: 5 };
    try {
      let payload;
      if (alg === 'HS256' && this.secret) ({ payload } = await jwtVerify(token, this.secret, { ...opts, algorithms: ['HS256'] }));
      else if (alg && ASYMMETRIC.includes(alg) && this.jwks) ({ payload } = await jwtVerify(token, this.jwks, { ...opts, algorithms: [alg] }));
      else throw new AuthError('unsupported token');
      if (!payload.sub) throw new AuthError('the token names no user');
      if (payload.role !== 'authenticated') throw new AuthError('not a signed-in user');
      return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
    } catch (e) {
      throw e instanceof AuthError ? e : new AuthError('invalid sign-in');
    }
  }
}
