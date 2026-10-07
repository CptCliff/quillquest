# Milestone 7 notes: battle, async, phone

## Built
- **Rules** (`battle-flow.ts` 24 tests, `spotlight.ts` 4): the battle lifecycle over the existing battle maths: the GM opens it (goal, battle Danger, Difficulty), the lead fills the main card with the existing `editCard`,
  each other player declares Press/Open/Cover with their own Danger (caps checked on declare), concede/skip, the GM Sets Difficulty and every Danger at once, the GM rolls, the lead pushes (a standard push opens a
  withdraw-or-stay window; a Conviction push spends a token and rechecks nothing), beats of one to three sentences, costs through `applyWound`/`addBurden`, and the stitched post (lead, contributions in the GM's order, then costs).
  The spotlight: holder, pass, GM takes any post, and a left-out rule (two rounds = twice the number of players in passes).
- **DB**: migration `0004` (email, notification preferences, a durable queue). Also run on Postgres 16.
- **Server**: `BattleService` and routes under `/api/campaigns/:c/battles`; public `battles` map (words only, dice only after a reveal); stitching appends one server-written paragraph per beat in each writer's ink and locks through the last;
  mail providers (`resend`, `log`, `fake`), `Notifier` (batching, presence, preferences, dedupe), the spotlight routes, stall reminders, an automatic close for expired push windows, deep links, dev mail routes. 20 new server tests.
- **Web**: battle cards in the Ledger (lead card, contribution card, set/roll/stitch controls for the GM, the push window with one-tap Withdraw/Stay, beats and costs), a spotlight bar, notification preferences in the Roster,
  deep links (`?battle=`, `?card=`, `?para=`, `?tab=`) that open the right pane and highlight the target, and a phone pass (44px targets, no sideways scroll). 3 new Playwright tests, including a phone-viewport run.

## Decisions
- A beat is one to three sentences per participant; a Danger that landed adds a cost line (and a wound or Burden name) written by that player. The post is the beats first, then the cost lines.
- The push window is GM-set minutes (default 10). It closes when everyone has answered, when it runs out (the background job), or when the GM forces it.
- The spotlight is a list of players, not characters; the GM can hold it without being on the list.
- "Presence" means a live connection to the campaign document. People with the table open are not emailed.

## Open rule questions and gaps
- **What "costs" in the stitched post means** (Rules v4 4.5 says "then the costs"): built as each player's own cost line. A different reading would have the software write the cost.
- **The left-out threshold** is two rounds = 2 x players in passes; Rules v4 says only "two rounds".
- **GM ordering of beats**: the API supports it (`/order`); the UI stitches in declared order for now.
- **Opposed and social rolls** pulling an NPC's rank (design plan 6.4) are not built. Neither is the borrowed-viewpoint veto, nor the shared Notes scratch document.
- **Real email** was not sent (no key here). Presence is per campaign document; a person with only the Director's private notes open would still be emailed.
- Pane rearranging remains a wish for the design pass.
