import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const ask = (user = 'ilse') => GET(new Request(`http://localhost/api/dev-token?user=${user}`));
afterEach(() => vi.unstubAllEnvs());

describe('/api/dev-token (mints a token for any preset user, so it must be hard to reach)', () => {
  it('is not found unless dev auth is explicitly switched on', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('QUILLQUEST_DEV_AUTH', '');
    expect((await ask()).status).toBe(404);
  });
  it('is not found in production, even with the flag set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('QUILLQUEST_DEV_AUTH', '1');
    expect((await ask()).status).toBe(404);
  });
  it('mints a signed token for a preset user when switched on outside production, and refuses unknown users', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('QUILLQUEST_DEV_AUTH', '1');
    const ok = await ask('ilse');
    expect(ok.status).toBe(200);
    expect((await ok.json()).token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect((await ask('mallory')).status).toBe(400);
  });
});
