import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Actor } from '@quillquest/story';

/** Who is connected. M4 replaces `authenticate` with Supabase sign-in; the rest of the server only sees this shape. */
export interface Identity extends Actor {
  name: string;
  /** The writer's ink color. */
  color: string;
  /** The member has left the campaign: they may read the story but not change it. */
  left?: boolean;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

/** Dev-only: a signed {id, name, role, color}. Never ship: anyone with the secret can mint a GM. */
export function signDevToken(identity: Identity, secret: string): string {
  const body = b64(JSON.stringify(identity));
  return `${body}.${sign(body, secret)}`;
}

export function authenticate(token: string, secret: string): Identity {
  const [body, mac] = token.split('.');
  if (!body || !mac) throw new Error('malformed token');
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error('bad signature');
  const id = JSON.parse(Buffer.from(body, 'base64url').toString()) as Identity;
  if (!/^[A-Za-z0-9_-]+$/.test(id.id)) throw new Error('user ids may not contain dots or spaces'); // dots delimit suggestion ids
  if (id.role !== 'player' && id.role !== 'gm') throw new Error('bad role');
  return id;
}
