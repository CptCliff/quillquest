const SYNC_HTTP = process.env.SYNC_HTTP_URL ?? 'http://localhost:1234';

/** @type {import('next').NextConfig} */
export default {
  // The workspace packages ship TypeScript source.
  transpilePackages: ['@quillquest/story', '@quillquest/sync', '@quillquest/rules', '@quillquest/prompts'],
  reactStrictMode: false, // the editor and provider own sockets; strict mode's double mount would open two
  // The game API lives in the sync server; proxying it keeps the browser on one origin (no CORS).
  async rewrites() {
    return [
      { source: '/api/me', destination: `${SYNC_HTTP}/api/me` },
      { source: '/api/me/:path*', destination: `${SYNC_HTTP}/api/me/:path*` },
      { source: '/api/invites/:path*', destination: `${SYNC_HTTP}/api/invites/:path*` },
      { source: '/api/campaigns/:path*', destination: `${SYNC_HTTP}/api/campaigns/:path*` },
      { source: '/api/dev/:path*', destination: `${SYNC_HTTP}/api/dev/:path*` },
    ];
  },
};
