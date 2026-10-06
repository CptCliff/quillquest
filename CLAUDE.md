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
```

## Status
M1 (rules engine) is implemented in `packages/rules` with 113 tests: ranks and dice, exact odds and words, shifts and the
edge rule, Set, resolve, push, battle rolls, wounds and healing, armor, Conviction and Burdens, magic, creation checks.
Open rule questions are in `docs/m1-notes.md`. Next: M2 (live editor).
