# Milestone 4 notes: accounts and roster

What was built, what was decided, what broke along the way, and what is unverified.

## Built
- `packages/db`: migrations and typed data access for profiles, campaigns, memberships, invites, and snapshots of the game
  state and story document. One GM per campaign and unique ink colors among active members are enforced by the database
  itself. Invite tokens are stored hashed only. Row-level security is on with no policies. 24 tests, run on PGlite **and on a
  real Postgres 16.15** (twice).
- `apps/sync`: auth providers (Supabase JWT with `jose`; a flagged dev provider), a directory that resolves your role, ink and
  name from your membership, membership checks on every connection and route, the account routes (profile, create campaign,
  invites, join, leave, members), starter characters on join, read-only connections for members who left, connection cut on
  leave, and Postgres-backed game and document stores. 76 tests (15 of them JWT attacks).
- `packages/rules`: the Skill-chip matcher, Skill info card notes, the attention rule, and `ownerId` on characters. 15 new tests.
- `apps/web`: sign-in (email link, Google, flagged dev list), dashboard with profile and ink, campaign creation, `/join/<token>`,
  info cards for names and Skill chips (side panel; bottom sheet on a phone), Skill chips in the story, the GM's table and
  invite panel, Leave, and the Notes-tab attention dot. 15 Playwright tests drive real browsers, 6 of them new.

## Decisions
1. **The role is never read from a token.** Roles and colors come from the membership row. A token claiming to be a GM changes
   nothing (tested over HTTP and in the browser suite).
2. **Supabase as designed, invite links only** (your choices). Email invites wait for M7's mail service.
3. **The dev provider cannot reach production:** it needs `QUILLQUEST_DEV_AUTH=1`, and the server refuses to start when that is
   set under `NODE_ENV=production`. The web's dev-token route 404s unless the same flag is set, and always in production.
4. **Rejecting a left member's writes is Hocuspocus's job.** A read-only connection drops their updates but still completes the
   sync handshake. My first version rejected any update from a left member, which made their browser reconnect forever (below).
5. **Leaving cuts the member's live sockets at once** (`membership-changed`), so they cannot keep writing on the connection
   they already had; the browser rebuilds and reconnects read-only.
6. **Starter characters are temporary** (until M5): the first three players get the Ilse, Sella and Rook templates, then a blank
   sheet. Preset dev users keep their old sheets so earlier tests are unchanged.
7. **Skill chips are code-only** and fire on the sentence you are in, in your own unlocked paragraph, and never roll by
   themselves. A sentence with no Skill name or inflection of one gets no chip ("I creep past the guards" is Claude's job in M6).
8. **Dismissing a chip lasts until the sentence changes.**

## Bugs found while building (worth knowing)
- **Reconnect loop for a member who left.** The sync server rejected the harmless update every client sends in its handshake;
  the browser reset and reconnected, forever. Fixed by relying on the read-only connection, plus a cap in the browser: three
  forced resets in ten seconds stops and says so.
- **A stale closure in the editor.** TipTap builds an extension once, so the chip's "open info" callback kept the value of "my
  character" from before it had loaded, and did nothing. The same flaw affected the author-name tap. Callbacks now read refs.
- **A test harness that fooled a row-security check.** `pg`'s connection pool throws a connection away after an error, which
  silently dropped a `SET ROLE` and ran the next statement as the superuser, making "deny by default" look broken. The
  migration was right (confirmed by hand in `psql`); the test now uses one dedicated connection.
- **Missing proxy rules:** the web app only proxied `/api/campaigns/*`, so `/api/me` and `/api/invites/*` never reached the server.

## Rules and plan questions
- **Joining and the Core Belief / characters:** plan 9.1 says a leaver's character "stays as an NPC the GM can retire". There is
  no NPC concept until M6, so it stays as a player sheet marked "(left)". Is that enough until then?
- **Invite lifetime and use:** one week, one use. Is that right, or should a GM be able to make a reusable "table link"?
- **Colors:** a preferred ink is honored if free, else the nearest free palette color. Plan 9.1 says the app "adjusts colors so
  no two writers share one"; does a writer expect to be able to pick a new ink after joining? (It applies to future joins only today.)

## Not verified / known gaps
- **Real Supabase is not tested** (see `docs/supabase-setup.md`): the email link, the Google flow, the callback page, token
  refresh, and the exact claims of your project's tokens. JWT verification itself is tested with generated keys, including
  expired, wrong audience or issuer, wrong signature, unsigned, the anon key, and algorithm confusion.
- **A WebSocket authenticates once, when it connects.** A session revoked in Supabase keeps an open table working until it
  reconnects (about an hour at most with a normal token refresh). Leaving a campaign is cut immediately; being removed by a GM is not built.
- **The GM cannot remove a player**, change the campaign title, or delete a campaign. There is no account deletion.
- **A display-name change** updates paragraph tags and the member list, not the name already on a starter character.
- **The join link carries the token in its address**, so it is in browser history; it works once, which limits the harm.
- **The `/auth/callback` page** waits for Supabase's client to read the code and falls back to the home page after four seconds.
- **Not exercised in a browser:** the real sign-in screens (only the dev list), the Notes-tab dot for the GM's big-roll case, and
  the Roster on a phone.
- **One sync process** (the per-campaign ordering lock is in memory) and the story document is saved as one snapshot, as in M2.
- Chips look at one paragraph's text, so a paragraph containing someone else's suggestion can match against suggested text.
