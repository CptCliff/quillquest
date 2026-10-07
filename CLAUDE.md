# Quillquest — project instructions

Browser app for co-writing a narrative step-die RPG. Design: `docs/design-plan.md`. Rules: `docs/rules-v4.md`
(these are text extractions of the original Claude docs; tables are flattened — fix formatting as you touch them).

## Standing rules
- Read both docs before any change. Where they disagree, Rules v4 governs.
- The rules engine (`packages/rules`) is the source of truth; UI and server code never re-implement a rule.
- Pure functions, no I/O; randomness comes in through an injected dice source.
- Write or update tests before code; run the full suite before finishing.
- Use rank words in anything a player sees; dice appear only in the reveal view and in tests.
- Never send GM-only data to a player route; add a server test for every new route.
- Claude prompts live in `packages/prompts` with fixed test cases.
- One milestone per session (M1 rules engine → M7), starting in plan mode.

## Commands
```
pnpm install
pnpm test        # vitest, all packages
pnpm typecheck
pnpm e2e         # Playwright, real browsers; starts sync (with in-process PGlite) + web itself
TEST_DATABASE_URL=postgres://... pnpm --filter @quillquest/db test   # the db suite on a real Postgres
```

## Status
- M1 rules engine: done (`packages/rules`). Open rule questions in `docs/m1-notes.md`.
- M2 live editor: done (`packages/story` edit policy, `apps/sync` enforcement, `apps/web` editor). `docs/m2-notes.md`.
- M3 rolls: done. The card lifecycle is `packages/rules/src/flow.ts`; the server rolls the dice; the browser reads a dice-free
  projection from the server-written `ledger` and `characters` Yjs maps. Locks are server-only. `docs/m3-notes.md`.
- M4 accounts and roster: done, **except that real Supabase sign-in has never been run** (`docs/supabase-setup.md`). Accounts,
  campaigns, memberships, invites and colors are in Postgres (`packages/db`); the sync server checks membership on every
  connection and route and takes the role from the membership, never the token. Info cards and Skill chips are in the web app.
  `docs/m4-notes.md`.
- Test counts: 25 story, 180 rules, 24 db, 76 sync, 3 web, 15 Playwright.
- Next: M5 (session zero: character creation). It replaces the starter characters.

## Gotchas
- Dev sign-in is a signed token from `/api/dev-token`, only with `QUILLQUEST_DEV_AUTH=1` (and `NEXT_PUBLIC_DEV_AUTH=1` for the web list). It must never be set in production; the server refuses to start if it is. Real sign-in is Supabase.
- Characters are starter templates for now (`apps/sync/src/game/dev-characters.ts`); M5 replaces them.
- Row-level security is on with no policies: all data access goes through the sync server. Never expose a table to the browser.
- A test of row security must use one dedicated connection: a `pg` Pool drops a connection after an error, silently losing `SET ROLE`.
- TipTap builds extensions once. Callbacks passed to an extension must read refs, not capture state.
- The database tests run on PGlite by default; set `TEST_DATABASE_URL` to run the same suite on a real Postgres.
- Dice are drawn on the server only. Never put dice, numeric odds or a roll's internals in the `ledger` map or a non-GM response; tests scan for it.
- The e2e dice route (`/api/dev/campaigns/:id/dice`) only mounts with `QUILLQUEST_DEV_DICE=1`.
- pnpm enforces a minimum release age. Don't exclude a package from it to pull in a brand-new release; pin an older one.
- Playwright runs the preinstalled Chromium (`/opt/pw-browsers`); don't run `playwright install`.
