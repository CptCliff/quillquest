# Interface design pass notes

## Built
- **`packages/layout`** (20 tests, including a 3,000-step random-operation check): the workspace as pure data. A layout is a tree of splits and tabbed groups of panels plus a hidden list.
  Operations: move a panel onto a group's centre (stack) or edge (new pane), dock to a whole-workspace edge, resize, activate, hide, show, normalise, presets (Classic, Reading, Writer's focus, Swap sides),
  `sanitize` and `validateLayout` (what the server accepts). No operation ever loses or duplicates a panel; normalising is idempotent.
- **Server**: migration `0005` (`layouts`, per account, campaign and device), `GET/PUT/DELETE /api/campaigns/:c/layout?device=wide|phone`. You can only touch your own; invalid layouts are refused (400/413);
  a player can never hold the Director panel nor a GM the Creation panel.
- **Visual system**: `app/tokens.css` (colour, type, space, radius, elevation, motion; light, dark, and a manual theme toggle remembered in the browser and applied before first paint), primitives (primary/secondary/quiet/danger buttons,
  cards, badges, fields), reduced-motion support. `tokens.test.ts` asserts WCAG contrast for every text, accent, focus, border and meaning pair in both themes, and that every writer's ink (the db PALETTE) is a visible line or dot on every surface once
  the dark theme's lift is applied. Text on an ink-coloured pill or caret label uses black or white, whichever reads better.
- **The dock** (`components/dock/`): tabs you drag to the left, right, top, bottom or centre of any pane; dividers you drag or use with the arrow keys (Shift for bigger steps, Home and End); a move menu on every group and a Layout menu
  (presets, show or hide panels, Reset). **Panels never remount when moved**: each panel renders once into its own container that is re-attached to its slot, so the editor, its text and scroll position survive. The info card is a panel that appears beside the
  Ledger and goes when closed. Saved layouts follow you across browsers; the phone keeps its own two-tab layout and never sees the wide arrangement. The old single divider width migrates into the default layout.
- **Accessibility**: skip link, landmarks, a visible focus ring from tokens, roving-tabindex tablists, labelled separators with value ranges, menus with arrow keys and Escape that returns focus, focus following a moved panel, an `aria-live` announcer for moves,
  reduced motion. Playwright runs **axe-core (WCAG 2 A/AA, pinned 4.13.0)** on the table (Ledger, Creation, Codex, Roster, Director), open menus, a battle card, the draft page, the dashboard and a phone screen, in light and dark: no violations.

## Decisions
- Layouts are saved half a second after the last change, and again when you leave. A server error never blocks the workspace: it falls back to the default.
- The Story panel can be moved and resized but never hidden. The info card is never saved.
- Dragging is mouse and pen only; on touch (and every device) the group menu moves panels. Floating windows, per-panel settings and multi-monitor pop-out are not built.

## Open
- Text colour for a writer's ink on arbitrary colours outside the palette (a player's preferred colour can be any hex) is not guaranteed to reach 3:1; the palette's colours are.
- The onboarding tour and empty-state copy were left out by choice.
