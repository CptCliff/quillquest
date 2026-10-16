import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncUrl } from './sync-url';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const page = (protocol: string, host: string) => vi.stubGlobal('window', { location: { protocol, host } });

describe('where the browser opens its live socket', () => {
  it('uses the address it is given outright', () => {
    vi.stubEnv('NEXT_PUBLIC_SYNC_URL', 'wss://sync.example.com');
    page('https:', 'play.example.com');
    expect(syncUrl()).toBe('wss://sync.example.com');
  });
  it('in a production build with nothing set, goes through the page\'s own address under /collab, secure when the page is', () => {
    vi.stubEnv('NODE_ENV', 'production');
    page('https:', 'quillquest.tail1234.ts.net');
    expect(syncUrl()).toBe('wss://quillquest.tail1234.ts.net/collab');
    page('http:', 'localhost:8080');
    expect(syncUrl()).toBe('ws://localhost:8080/collab');
    vi.stubEnv('NEXT_PUBLIC_SYNC_URL', 'auto');
    expect(syncUrl()).toBe('ws://localhost:8080/collab');
  });
  it('in development with nothing set, keeps the local server', () => {
    vi.stubEnv('NODE_ENV', 'development');
    page('http:', 'localhost:3000');
    expect(syncUrl()).toBe('ws://localhost:1234');
  });
});
