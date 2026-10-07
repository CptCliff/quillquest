# M5 notes: session zero

## What was built
- **Rules** (`packages/rules/src/creation-flow.ts`, 60 tests): origin, chapters, grant cards, the swap, chapter outputs, world facts, crossings,
  capital, Beliefs, Instincts, hook, starting Burden, the end check (reuses `validateCreation`, adds origin/grant/output/hook checks), Begin play,
  the roll gate, and solo-draft import. Every call is a pure function over a `CreationWorld`; the server and the UI never re-implement a check.
- **Server**: game state gained `phase`, per-character `creation`, `canon`, crossing `proposals`, logged `checkOverrides`, and draft `drafts`.
  One route family, `POST /api/campaigns/:c/creation/:step`, plus `GET .../creation/check/:characterId` and `GET/PUT .../draft`, `POST .../draft/import`.
  Public maps `creation`, `canon`, `campaign` are server-owned (clients cannot write them).
- **Drafts**: private Yjs documents named `<campaign>~draft~<user>`, in table `draft_documents` (migration 0002, row security on). Only the author may open one;
  the GM and other players are refused. Importing copies the whole draft to the shared story as the player's own paragraphs under new ids and posts the marked chapters.
- **Web**: a Creation tab (checklist, a form per step, crossing confirmations, grant cards for the others), GM tools in the Director tab
  (world fact, who is ready and why not, tie-breaks, logged override, Begin play), a draft page at `/draft/:campaign`, a read-only Canon list in the Codex tab, a "creating" badge on the Roster.

## Decisions
- Late joiners create their character mid-campaign; only they are held back from rolling. The GM override is the way through.
- Old campaigns are read as `playing` with ready characters. Preset dev users keep ready-made sheets, so no skip route was needed.
- Grants: the proposer counts as agreeing; a strict majority of the *other* players applies a proposal (with two players, the other player's proposal applies at once);
  a tie is broken by the GM, who may also enter a grant outright. A raise lifts a Skill one rank, never past Expert. The bad chapter's Trait is harmful and its output must be a Thread.
- Crossings are symmetric and need the other player's confirmation; each player makes at most two; one shared Thread at most.
- A paragraph can be used for one step only. Posting never locks prose.

## Open rule questions (for the rules owner)
- **Crossings and the Canon**: the plan said one Canon entry per crossing; the rules layer only writes the GM's fact and one per chapter. Crossing scenes live in the story.
- **A player leaves mid-grant**: their character is excluded from "other players", so the majority threshold shrinks; open proposals by them stay. Unspecified in Rules v4.
- **Can the GM propose grants?** Built as no (only other players), with the GM's own entry as the tiebreak/override.
- **Burden at creation** counts toward the limit of two; its oracle is not built.
- **Veteran** is chosen before the first chapter; it cannot change afterwards.

## Not built (deliberately)
Claude suggestions on grant cards and the Belief check (M6), the owner's veto of borrowed viewpoints, the Burden oracle, the full Codex, NPCs, email.

## Interface wish (from the user, for the design pass)
Players should be able to **resize and rearrange** the window panes. Today the Story/Notes divider resizes and remembers its width; swapping sides, docking and moving tabs between panes are not built.

## Verification
25 story, 240 rules, 25 db (also on a real Postgres 16, including row security on `draft_documents`), 91 sync, 3 web, 18 Playwright (three new: a GM and three
players complete session zero and then roll; a late joiner is held back until ready or overridden; a solo draft is marked up, brought to the table, and opens grant cards).
