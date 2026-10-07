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
