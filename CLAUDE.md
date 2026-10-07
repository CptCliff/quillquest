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
pnpm e2e         # Playwright, two real browsers; starts sync + web itself
```

## Status
- M1 rules engine: done (`packages/rules`). Open rule questions in `docs/m1-notes.md`.
- M2 live editor: done (`packages/story` edit policy, `apps/sync` enforcement, `apps/web` editor). `docs/m2-notes.md`.
- M3 rolls: done. The card lifecycle is `packages/rules/src/flow.ts`; the server rolls the dice and keeps the records
  (`apps/sync/src/game`); the browser reads a dice-free projection from the server-written `ledger` and `characters` Yjs maps.
  Locks are server-only. 25 story + 165 rules + 45 sync tests, 9 Playwright tests. Decisions, rule questions and gaps in
  `docs/m3-notes.md`.
- Next: M4 (accounts, Roster, info cards, Skill chips). It replaces the dev token and the seeded dev characters.

## Gotchas
- Dev only: identity is a signed token from `/api/dev-token`; M4 replaces it. Characters are seeded (`apps/sync/src/game/dev-characters.ts`).
- Dice are drawn on the server only. Never put dice, numeric odds or a roll's internals in the `ledger` map or a non-GM response; tests scan for it.
- The e2e dice route (`/api/dev/campaigns/:id/dice`) only mounts with `QUILLQUEST_DEV_DICE=1`.
- pnpm enforces a minimum release age. Don't exclude a package from it to pull in a brand-new release; pin an older one.
- Playwright runs the preinstalled Chromium (`/opt/pw-browsers`); don't run `playwright install`.
