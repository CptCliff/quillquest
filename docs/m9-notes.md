# M9 — the chapter library (session-zero speed-up)

Why: the first four-agent playtest never got a player through creation. Every Life Chapter waited on a Skill and a Trait proposed and agreed by the other players (about 14 proposals each), and the GM had to override the check.

## What it does
- `packages/rules/src/chapter-library.ts`: 24 original chapter templates in six walks of life. Each has a name, prompt, keywords, Skills, Traits, harmful Traits (for the bad chapter) and example Outputs. `matchTemplates(prose, summary)` is a pure keyword matcher: two or more keyword hits is `close`, one is `partial`, none is `none`. Deterministic; no AI. The content is original (the idea is borrowed from lifepath systems, the text is not).
- `creation-flow.ts`: `offerChapter` (server computes the offer from the chapter's own prose, optionally with an AI-adapted list), `pickChapterGrants` (the writer picks a Skill and/or Trait from the offer, or in their own words; applies at once with `by: 'self'`), `objectToPick` (any other player undoes a self-pick; the slot reopens to the old proposal/agree flow and the writer keeps their swap).
- One self-chosen raise to Capable (the Origin Skill, Trained to Capable) per character: `CreationState.selfRaiseUsed`, undone by an objection.
- Server steps: `chapter-offer`, `chapter-pick`, `chapter-object` (`apps/sync/src/game/creation.ts`). The AI adaptation reuses the `grant` request kind (`adapt: true`, own chapter only; counts against the session cap and is logged). It returns up to three Skills and three Traits; the writer still picks.
- Web: `ChapterOffer` in `Creation.tsx`; "Object" on the other players' grant cards. The old grant cards remain for "no close match" and after an objection.

## Notes
- Offers are words only; they ride in the public `creation` map.
- Not built: GM-extensible library, importing other lifepaths, scoring beyond keywords.

## Round-2 playtest fixes
- Outputs can no longer strand the end check: once every chapter is posted, `chooseOutput` refuses a kind that leaves no way to cover Connection, Resource and Thread (`OUTPUT_UNREACHABLE`); the output form shows what is still needed.
- A reopened grant (after an objection) cannot be re-picked by the writer (`GRANT_REOPENED`); the others propose.
- Forms that save a sheet field come back showing the saved values; "Still to do" re-reads after every action.
- Roll card: Set needs a Difficulty and a Danger, Roll/Set/Discard errors show on the card, an unset draft can be discarded (`DELETE /cards/:id`, owner or GM); the published `ledger` map now drops cards the game no longer has.
- Battle dice reveal is words, not JSON. On phones the Notes tab says "create your character" while creating.

## Round-3 playtest fixes
- The silent Roll no-op was a race: saving a field on blur marked the card busy, which disabled Roll in the middle of the click that blurred the field. Field saves no longer set busy, and edits and actions share one queue per card.
- Save-style forms (`keep`) keep what was typed; the crossing form says who it is waiting for; "Take my picks"; the self-pick form is hidden while the others are proposing.
- One open draft per player (`DRAFT_OPEN`); the GM can discard any draft (Ledger and Director); Director Set needs a Difficulty and a Danger.
- Plain "Fill in a paragraph first" instead of "paragraphId is required"; theme button no longer squeezed out of the header.
- Not done: glossary for jargon, a GM "Session zero" tab (it sits at the bottom of Director), matcher by role rather than keyword, duplicate pending crossings, whether rolls should be allowed before Begin play.

## Glossary and the session-zero rule
- Roll cards cannot be opened until the GM begins play (`SESSION_ZERO`, 409); the Ledger says why. Tests that need a table in play seed it (`MemoryGameStore({ phase: 'playing' })`, e2e `createTable` begins play for the preset users).
- `apps/web/lib/glossary.ts` is the one list of words (wording follows Rules v4, no dice or numbers; `glossary.test.ts` checks). `Term` is a tappable word in headings and help text (never inside a form label); `Glossary` is the "Words" dialog in the table header, with a filter, Escape to close and focus returned.
- Terms are used in the Creation headings, the draft card's help line, odds, Concede and the Spotlight bar; the Conviction pips now read "n of 3".

## The GM's Session zero tab
- Session zero (world fact, who is ready and why not, tie-breaks, the logged override, Begin play) is now its own panel `zero` (GM only; `packages/layout`), second in the GM's notes group instead of the bottom of the Director tab. A GM who opens a table still in session zero lands on it, once, unless they have already clicked or typed or an email link named a tab. The tab gets a dot when every character is ready and play can begin; the Director keeps the Claude assistant, NPCs, Conviction and the invites.
- A saved layout from before the panel gains it as a hidden panel (the Layout menu shows it); players never get it, on read or write.
