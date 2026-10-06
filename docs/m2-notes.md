# Milestone 2 notes: live editor

What was built, what was decided, and what is still unverified. Rule questions go back into the rules/plan docs.

## Built
- `packages/story`: the edit policy as pure functions (`validateChange`, `lockThrough`) plus adapters that read ProseMirror
  JSON and a Yjs fragment into one document shape. 26 tests.
- `apps/sync`: a Hocuspocus server. Every inbound update is applied to a scratch copy and judged by the same policy; a breach
  closes the sender with `rejected:<codes>`. Dev-token identity, file-backed store, override log for GM lock changes, and
  cursor name/color taken from the verified identity. 14 tests, over real WebSockets.
- `apps/web`: Next + TipTap + Yjs. Per-writer ink on paragraphs and cursors, edits in others' paragraphs become suggestions
  with accept / reject / withdraw, locked prose refuses edits, draggable pane divider (remembered), tabbed phone layout.
  6 Playwright tests drive two or three real browsers.

## Decisions
1. **Suggestions use `@handlewithcare/prosemirror-suggest-changes` 0.1.8.** Its marks carry only an id, so the author rides in
   the id (`ilse.k3j9`) and the policy reads it from there. We run its `transformToSuggestionTransaction` ourselves in a
   TipTap `dispatchTransaction` hook, so suggesting applies only inside someone else's paragraph. Verified in two browsers:
   insert, delete-as-suggestion, accept, reject, withdraw.
2. **Ownership is per paragraph.** Two people in one paragraph is handled by suggestions, not shared ownership.
3. **A locked paragraph refuses content changes from everyone, GM included.** A retcon is two steps: the GM unlocks (logged),
   then the author edits. Locked paragraphs must always form an unbroken run from the start, so nothing can be inserted above
   locked prose and a retcon can only reopen the tail of the run. (Plan 3.3 says "from the start of the story through the
   outcome paragraph"; this makes it an invariant.)
4. **Enter inside someone else's or locked prose starts the writer's own paragraph after it** instead of splitting theirs.
5. **Identity is dev-only** (signed `{id, name, role, color}` from `/api/dev-token`). M4 replaces `authenticate`. User ids may
   not contain `.`, because that delimits suggestion ids.
6. **`next` is pinned to 16.3.8.** 16.4.0 was a few hours old and pnpm's `minimumReleaseAge` rejected it. pnpm offered to
   exclude it from the policy automatically; I declined and rebuilt the lockfile instead. Revisit once 16.4 has aged.

## Measured
`checkUpdate` on a 20,000-word story: about 26 ms per inbound update (it copies and reads the whole story each time).
Fine at table sizes. A 100,000-word campaign would be roughly 130 ms per keystroke, so before long campaigns the server
should validate only the paragraphs an update touched. Not done.

## Not verified / known gaps
- **Structural edits in others' paragraphs** (Backspace at a paragraph start, multi-paragraph paste or cut). The guard should
  refuse them (the policy sees the base text change), and the server would, but there is no browser test. The library's
  block-level insertion marks are not in the schema on purpose; whether y-prosemirror would sync them is untested.
- **Concurrent lock and edit.** If the GM locks a paragraph while its author is mid-sentence, the author's next update is
  rejected and their tab resets from the server, losing that unsent sentence. Honest but rough.
- A hostile browser tab (bypassing the UI) is tested at the Yjs level, not by driving a modified page.
- An author can forge a suggestion mark in their own paragraph; harmless, and the policy allows it.
- IME composition, undo/redo into locked prose, offline merge on reconnect: untested.
- Documents persist to a local file. Postgres arrives with M4.

## Rules and plan questions
- Should the GM be able to edit a locked paragraph in one step (an "unlock and fix" retcon), or is two steps right?
- Should a writer be able to suggest a paragraph split or join in someone else's prose, or is "start your own paragraph" enough?
- Should the dev "lock through here" button's real replacement (M3: locking when an outcome is written) also be server-driven,
  so a player's client never has to be trusted to say a roll resolved? The policy already assumes yes.
