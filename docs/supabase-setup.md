# Connecting a Supabase project

Quillquest uses **Supabase Auth** for sign-in (email link and Google) and **plain Postgres** for its data. The code is written
to Supabase's documented behavior and tested against tokens I generate locally, but **it has not yet been run against a real
Supabase project**. Follow this once, then try the checklist at the end. Until then, treat sign-in as unverified.

## 1. Create the project
1. Create a project at supabase.com. Note the **Project URL** (`https://<ref>.supabase.co`) and the **anon (public) key**.
2. **Settings > Database**: copy the connection string. Use the one for the privileged `postgres` role. The sync server must
   connect with a role that bypasses row-level security; the browser never connects to the database at all.
3. **Settings > API** (or JWT Keys): see which signing method your project uses.
   - Newer projects publish asymmetric keys (a JWKS). Nothing to copy: the server finds them from `SUPABASE_URL`.
   - Older projects use a shared secret (HS256). Copy the **JWT secret**.

## 2. Turn on sign-in
**Authentication > Providers**
- **Email**: enabled (magic link). Disable "Confirm email" only if you want to; links work either way.
- **Google**: create an OAuth client in Google Cloud (Web application). Add the authorized redirect URI
  `https://<ref>.supabase.co/auth/v1/callback`. Paste its client id and secret into Supabase.

**Authentication > URL Configuration**
- Site URL: your web app's address.
- Redirect URLs: add `https://<your-web-app>/auth/callback` (and `http://localhost:3000/auth/callback` for local work).

## 3. Configure the apps
**Sync server** (`apps/sync`):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the privileged Postgres connection string from step 1 |
| `SUPABASE_URL` | `https://<ref>.supabase.co` (names the token issuer and where its keys are published) |
| `SUPABASE_JWT_SECRET` | only for HS256 projects |
| `PORT` | e.g. `1234` |

The server applies its migrations on start (or run `DATABASE_URL=... pnpm --filter @quillquest/db migrate`). It **refuses to
start** in production if `QUILLQUEST_DEV_AUTH` is set, if neither Supabase variable is set, or if `DATABASE_URL` is missing.

**Web app** (`apps/web`):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | the Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key (safe to expose; it can do nothing here, see below) |
| `NEXT_PUBLIC_SYNC_URL` | the sync server's WebSocket address, e.g. `wss://sync.example.com` |
| `SYNC_HTTP_URL` | the sync server's HTTPS address (the web app proxies `/api/...` to it) |

Do **not** set `NEXT_PUBLIC_DEV_AUTH` or `QUILLQUEST_DEV_AUTH` anywhere that is not your own machine.

## Why the anon key is harmless
Every table has row-level security enabled with **no policies**, so Supabase's `anon` and `authenticated` roles (which the
API exposes by default) can read and write nothing. All data goes through the sync server, which checks your membership in the
campaign on every connection and every request. The role in a token is never trusted: it comes from your membership row.

## Try it (the part only you can do)
1. Open the web app. You should see **Email me a link** and **Continue with Google**, and no dev sign-in list.
2. Sign in with an email link. You should land on the dashboard, signed in.
3. Create a campaign; open its Director tab; create an invite link.
4. In a private window, open the link, sign in as a second account (Google, if you set it up), and confirm you land at the table.
5. Write in both windows and confirm you see each other's colored cursors.
6. Leave the campaign as the second account: you should be taken to the dashboard, and re-opening the table should be read-only.

If sign-in loops or the table says "Not your table" for a member, check the server log first: a rejected token logs the reason
(`invalid sign-in`), and a wrong `SUPABASE_URL` is the most likely cause (the issuer must match exactly).

## Hosting notes
- The sync server holds long-lived WebSocket connections, so it needs a host that allows them (not a serverless function).
- One sync process per deployment for now: the per-campaign lock that orders game actions is in memory.
- A WebSocket authenticates once when it connects. A Supabase token lasts about an hour, but an open table keeps working past
  that; the next reconnect uses a fresh token. Leaving a campaign closes your sockets at once.
