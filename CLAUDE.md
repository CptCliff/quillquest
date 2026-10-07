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
- M5 session zero: done. Creation is pure rules in `packages/rules/src/creation-flow.ts`; the server sequences it
  (`apps/sync/src/game/creation.ts`, `GameService.creationAct`) and publishes public `creation`, `canon` and `campaign` Yjs maps. Characters
  are `creating` or `ready`; a character still creating cannot roll (409 NOT_READY) until its check passes or the GM overrides (logged).
  Solo drafts are private documents `<campaign>~draft~<user>` (own table `draft_documents`). `docs/m5-notes.md`.
- M6 Director and Claude: done. `packages/rules/src/director.ts` (NPC reveal, Conviction nominations and log), `packages/prompts` (seven request kinds, role gate, strict parsers),
  `apps/sync/src/game/director.ts` + `director-routes.ts`, swappable model providers in `apps/sync/src/llm` (`QUILLQUEST_LLM=anthropic|openai-compat|fake|none`, see `docs/llm-providers.md`),
  GM notes document `<campaign>~gm`, suggestion log and per-session cap. `docs/m6-notes.md`.
- M7 battle, async, phone: done. `packages/rules/src/battle-flow.ts` and `spotlight.ts`, `apps/sync/src/game/battles.ts` + `battle-routes.ts`, the Mailer (`QUILLQUEST_MAIL=resend|log|fake|none`, `docs/mail-providers.md`),
  `apps/sync/src/notify/` (batching, presence, preferences, deep links), a 30-second background job (mail, push windows, stalls), public `battles` map. `docs/m7-notes.md`.
- M9 chapter library: done. `packages/rules/src/chapter-library.ts` (24 original templates, keyword matcher), `offerChapter`/`pickChapterGrants`/`objectToPick` in `creation-flow.ts`, steps `chapter-offer|pick|object`, adapt via the `grant` kind with `adapt: true`. A writer's own pick applies at once; anyone else can object. `docs/m9-notes.md`.
- Interface design pass: done. `packages/layout` (the dock model), saved layouts (`layouts` table, `/layout` routes), design tokens and themes (`app/tokens.css`), the dock (`components/dock/`), and an axe-core accessibility audit in Playwright. `docs/m8-notes.md`.
- Test counts: 25 story, 20 layout, 299 rules, 16 prompts, 31 db, 142 sync, 16 web, 38 Playwright (the dock drag test is occasionally flaky).
- All seven milestones and the design pass are done. Next: playtest, real Supabase sign-in, and a real mail and model key.

## Gotchas
- Dev sign-in is a signed token from `/api/dev-token`, only with `QUILLQUEST_DEV_AUTH=1` (and `NEXT_PUBLIC_DEV_AUTH=1` for the web list). It must never be set in production; the server refuses to start if it is. Real sign-in is Supabase.
- Preset dev users (ilse, sella, rook) have ready-made sheets (`apps/sync/src/game/dev-characters.ts`); every other new player starts blank and in creation. Mira, Tobin and Wren are dev users for creation tests.
- A campaign saved before M5 is read as already `playing` with ready characters (`normalizeState`).
- A paragraph is "posted" by naming it; creation steps never lock prose. Cloned Yjs elements cannot be read until integrated: read the original's attributes first.
- Hidden NPC fields live only in server game state; the `npcs` map carries revealed fields. Never add GM data to a published map or a player prompt; tests scan for sentinel strings.
- Playwright runs the sync server with `QUILLQUEST_LLM=fake`, `QUILLQUEST_MAIL=fake` and `QUILLQUEST_DEV_MAIL=1`. Fake providers are refused in production. Tests move the notifier's clock through `/api/dev/mail/advance`.
- A battle's roll lives in game state only; the `battles` map is words. Battle and card deep links are `?battle=`/`?card=` and the card elements carry `id=battle-<id>` / `card-<id>`.
- The background job's `system` actor must never become `gmId` (guarded in `prepare`).
- The Director panel holds a second editor (GM notes); scope story selectors to `.story-pane .story`.
- Panels never remount when moved: they live in persistent containers (`PanelHost`/`Slot`). Don't render a panel's content inside the dock tree itself. Colours come from `app/tokens.css`; `tokens.test.ts` must stay green. Pin `@axe-core/playwright`; run `pnpm e2e` for the audit.
- Row-level security is on with no policies: all data access goes through the sync server. Never expose a table to the browser.
- A test of row security must use one dedicated connection: a `pg` Pool drops a connection after an error, silently losing `SET ROLE`.
- TipTap builds extensions once. Callbacks passed to an extension must read refs, not capture state.
- The database tests run on PGlite by default; set `TEST_DATABASE_URL` to run the same suite on a real Postgres.
- Dice are drawn on the server only. Never put dice, numeric odds or a roll's internals in the `ledger` map or a non-GM response; tests scan for it.
- The e2e dice route (`/api/dev/campaigns/:id/dice`) only mounts with `QUILLQUEST_DEV_DICE=1`.
- pnpm enforces a minimum release age. Don't exclude a package from it to pull in a brand-new release; pin an older one.
- Playwright runs the preinstalled Chromium (`/opt/pw-browsers`); don't run `playwright install`.
