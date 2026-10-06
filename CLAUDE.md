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
- M1 rules engine: done (`packages/rules`, 113 tests). Open rule questions in `docs/m1-notes.md`.
- M2 live editor: done. `packages/story` is the edit policy (shared by browser and server), `apps/sync` is the Hocuspocus
  server that enforces it on every update, `apps/web` is the Next + TipTap + Yjs workspace. 26 + 14 unit/integration tests,
  6 Playwright tests. Decisions, measurements and unverified gaps in `docs/m2-notes.md`.
- Next: M3 (rolls). The lock trigger there is the real caller of `lockThrough`; the dev lock buttons go away.

## Gotchas
- Dev only: identity is a signed token from `/api/dev-token`; M4 replaces it.
- pnpm enforces a minimum release age. Don't exclude a package from it to pull in a brand-new release; pin an older one.
- Playwright runs the preinstalled Chromium (`/opt/pw-browsers`); don't run `playwright install`.
