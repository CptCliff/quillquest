# Milestone 3 notes: rolls

What was built, what was decided, and what is still unverified. Rule questions go back into the rules/plan docs.

## Built
- `packages/rules/src/flow.ts`: the card lifecycle as pure functions (draft, set, rolled, written or conceded): quick vs big,
  who may act at each step, shift suggestions and provenance, outcome prompt wording (Rules v4 3.5-3.6), push options,
  concession, landed costs, retcon (and undoing a retcon'd roll's costs), and the public view of a card. 52 tests.
- `apps/sync/src/game/`: a store (memory and file), dice sources, the service that sequences the flow, JSON routes under
  `/api/campaigns/:id/...`, and a document port that writes the live Yjs doc. 38 tests (service, real HTTP with Yjs clients,
  stores). The server rolls every die.
- `apps/web`: Notes pane tabs, the Ledger (new roll, draft form, Set, Roll, push, concede, outcome prompt, Reveal, "outcome
  written", past rolls, GM Retcon) and a Roster. 4 new two-and-three-browser Playwright tests (9 in all).

## Decisions
1. **Dice never leave the server unrevealed.** Cards and character sheets reach the browser as read-only Yjs maps (`ledger`,
   `characters`) written by the server. A card in the map carries rank words and odds words only. The GM reads dice through a
   GM-only route; Reveal copies them into the map. Tests scan the ledger map and every non-GM response for dice.
2. **Clients cannot write those maps**, and cannot create any other top-level type: the sync server rejects the update
   (`SERVER_OWNED`). Declared maps are read explicitly because a root type that arrives in an update is untyped until declared.
3. **Locks are server-only.** `packages/story` now refuses every client change to a lock, the GM's included (M2 let the GM flip
   it). The game locks "start of story through the outcome paragraph" when the writer marks the outcome written, and a retcon
   unlocks exactly that run. The M2 override log moved into game state.
4. **A quick draft is Set and rolled in one tap by its writer. A big card must be Set by the GM first**, so the player can still
   concede after seeing the odds (Rules v4 6.5). After Set, the player (or the GM, for a stalled player) rolls.
5. **Shifts cannot be forged.** The client names keys from the sheet's suggestion list (`trait:t1:skill`, `armor`, ...); the
   server expands them. Only helping, preparation, gear and magic (with a tradition) can be claimed by hand.
6. **Skills are read from the sheet**, never sent by the client. A Skill not on the sheet is attempted Untrained.
7. **Retcon (6.1):** GM only, quick rolls only, and only while no paragraph follows the outcome. It undoes what the roll did to
   the character (the wound or Burden it added, a Conviction push's token) and logs an override.
8. **Opening the campaign publishes your character.** `GET /me` is a mutation, so the Roster shows everyone from the first visit,
   and it republishes the ledger, which heals the projection after a crash (see gaps).
9. **Characters are seeded dev data** (`game/dev-characters.ts`: Ilse, Sella, Rook) until M5. One function to replace.

## Rules and plan questions
- **Core Belief that is relevant but not on the line.** Rules 5.1 says the Core backs at Capable "only when it is on the line".
  I read the rest of the sentence as: otherwise it backs like any relevant Belief, at Trained. Is that intended?
- **Who rolls a big card after Set?** The rules say "Roll" without a subject for big rolls. I let the acting player (or the GM).
- **Conceding after a push** is refused (6.5 says "instead of pushing"). Is a concession after a pushed failure meant to be allowed?
- **A Danger that already hit, then concession:** the cost still lands (6.5), and the writer names the wound or Burden when
  writing the defeat. A concession before any roll costs nothing.
- **A Danger on another character** only makes the roll big and names who writes the cost. The cost is not applied to them (see gaps).
- **Who names a lesser wound?** Rules 6.1 says the GM may name a lesser one; here the writer names it, never worse than the
  severity fixed at Set. The GM's "sharpening line" is not built.

## Not verified / known gaps
- **Costs on another character** (a Danger that lands on someone else, Cover, taking an ally's Danger) are not applied and the
  target's own confirmation is not built. Deferred to M7 with battle rolls and notifications.
- **A failure between steps of "outcome written"** (lock applied, then the game state fails to save) would leave prose locked
  with the card unwritten. The order is: check, compute the cost, lock, save. Low odds, but not transactional.
- **Single server process only.** The per-campaign mutex is in memory.
- **Restart behavior** is tested at the store level, not by restarting the whole stack.
- **Not exercised in a browser:** manual shifts, the Mortal declaration checkbox, Conviction push, the phone layout of the
  Ledger, and a roll opened with no paragraph written yet (it opens with no anchor).
- **Conviction can only be spent here.** Awards are the GM's (M6). It rises only by laying down a Burden.
- **No Skill chips** (M4): a roll opens from the "New roll" button.
- **The dev-dice route** is unauthenticated by design and only mounts when the server starts with `QUILLQUEST_DEV_DICE=1`.
