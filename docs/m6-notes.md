# Milestone 6 notes: Director and Claude

## Built
- **`packages/prompts`** (15 tests): seven request kinds (challenge prompts, sharpen Danger, NPC line, Burden oracle, Skill match, grant ideas, Belief check), the role gate
  (`kindsFor`: players get Skill match, grants and Belief checks only), prompt builders that read only the fields their kind declares, and strict answer parsers. Fixed test cases
  include a golden prompt and sentinel tests proving a player prompt never carries GM notes or hidden NPC fields.
- **`packages/rules/src/director.ts`** (11 tests): NPC sheets with per-field reveal and `publicNpc` (hidden fields are never copied), Conviction nominations (not your own moment),
  awards through the existing `awardConviction`, the Conviction log, and a new-session reset.
- **DB**: migration `0003` (`gm_documents`, `suggestions`), row security on with no policies. Also run on Postgres 16.
- **Server**: provider interface with Anthropic, OpenAI-compatible and fake providers (`docs/llm-providers.md`); `DirectorService`; routes under `/api/campaigns/:c/` for the GM overview, settings,
  session start, Conviction, NPCs, `/llm/:kind`, `/suggestions`; the GM notes document `<campaign>~gm` (GM only); public maps `npcs` (revealed fields only) and `convictionLog`; `themes` in the `campaign` map.
  25 new server tests, including a permission matrix and checks that no published map or player prompt contains hidden data.
- **Web**: the Director tab (Beliefs board, pending cards, Conviction awards and nominations, NPC roster, oracle, GM notes, override log, Claude log, settings), the Codex tab (Canon and Conviction log),
  revealed NPCs and "Nominate a moment" in the Roster, "Ideas from Claude" on grant cards, "Check my Beliefs", and the dashed Skill chip for paraphrases. 3 new Playwright tests.

## Decisions
- Cap is per campaign and per session, counts failed calls, and is held in the suggestion log. A repeated Skill-match sentence is served from a 10-minute memory without counting.
- A model answer gets one retry; then a clear error (502) and a logged `failed` row.
- Bad input from a client is now 400 for rule `BAD_INPUT` (was 409).
- Only the GM may ask for challenge prompts, sharpen Danger, NPC lines and the oracle (Section 9.2).

## Not built / open
- The Burden oracle's result is a draft in the Director tab; delivering it to the acting player's card as a prompt is not built.
- Retcon overrides are not shown in the Director's override log (only creation-check overrides are published).
- The shared Notes scratch document, battle rolls and email (M7). Live calls to real models were not run (no key here); the provider request and response shapes are tested against a stub server.
- A player who leaves keeps their nominations; a nomination for a character who has left is refused.
- Pane resizing and rearranging remain a wish for the design pass.
