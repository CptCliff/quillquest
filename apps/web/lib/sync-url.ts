/**
 * Where the browser opens its live-editing socket. NEXT_PUBLIC_SYNC_URL names it outright (local development, or a sync server on
 * its own address). When it is unset or "auto" the socket goes through the same address the page came from, under /collab, which is
 * how the self-hosted setup reaches it behind one proxy without baking an address into the build.
 */
export function syncUrl(): string {
  const set = process.env.NEXT_PUBLIC_SYNC_URL;
  if (set && set !== 'auto') return set;
  if (typeof window === 'undefined') return 'ws://localhost:1234';
  if (!set && process.env.NODE_ENV !== 'production') return 'ws://localhost:1234';
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/collab`;
}
