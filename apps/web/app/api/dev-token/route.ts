import { signDevToken } from '@quillquest/sync/auth';
import { DEV_USERS } from '../../../lib/dev-users';

/** Dev only: mints a signed identity for one of the preset users. M4 replaces this with real sign-in. */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') return new Response('not available', { status: 404 });
  const user = DEV_USERS.find((u) => u.id === new URL(req.url).searchParams.get('user'));
  if (!user) return new Response('unknown user', { status: 400 });
  const secret = process.env.QUILLQUEST_DEV_SECRET ?? 'dev-secret';
  return Response.json({
    identity: user,
    token: signDevToken(user, secret),
    syncUrl: process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234',
  });
}
