# One image recipe, two targets: `sync` (the game server) and `web` (the Next.js app). Build from the repository root:
#   docker build -f deploy/Dockerfile --target sync -t quillquest-sync .
# The workspace packages ship TypeScript source, so both run through the same installed workspace.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

FROM base AS sync
ENV NODE_ENV=production
ENV PORT=1234
EXPOSE 1234
USER node
CMD ["pnpm", "--filter", "@quillquest/sync", "exec", "tsx", "src/server.ts"]

FROM base AS web
# These two are public by design (they end up in the browser). Leave them empty if you sign in through Tailscale only.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
# NEXT_PUBLIC_SYNC_URL is deliberately unset: in production the browser reaches the sync server through the same address as the page, under /collab.
RUN pnpm --filter @quillquest/web build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["pnpm", "--filter", "@quillquest/web", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
