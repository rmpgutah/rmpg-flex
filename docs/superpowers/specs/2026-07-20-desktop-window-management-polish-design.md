# Desktop Launcher — Window Management Polish (Phase 2 of 5) Design Spec

**Date**: 2026-07-20
**Status**: Approved for planning
**Builds on**: [2026-07-19-desktop-launcher-windowable-apps-expansion-design.md](2026-07-19-desktop-launcher-windowable-apps-expansion-design.md) (Phase 1, shipped)

## Purpose

Phase 2 of the 5-phase desktop-system program: window-management polish for
the `/desktop` launcher. Covers the two items named in Phase 1's backlog —
Alt+Tab-style window cycling and multi-monitor-aware placement — scoped to
what's actually achievable inside a browser tab (neither item is a literal
port of the OS feature it's named after; see the two subsections below for
why).

## Non-goals

- Phase 3 (wallpaper upload, weather widget), Phase 4 (layout export/import,
  per-role templates), Phase 5 (advanced Settings app) — separate specs.
- True global OS-level Alt+Tab interception — not possible from a normal
  browser tab (the OS captures it before it reaches any webpage); an
  Electron-only `globalShortcut` version was considered and explicitly
  rejected in favor of a browser-portable shortcut everyone gets.
- Multi-monitor placement for the in-desktop floating panels
  (`FloatingWindow.tsx`) — a browser tab, and everything absolutely-positioned
  inside it, can only ever render on the single monitor that tab's window
  currently occupies. Multi-monitor placement applies only to the existing
  real `window.open()`-based pop-out mechanism (`openDetachedWindow` in
  `windowManager.ts`), which spawns genuine separate OS windows that *can*
  be placed on a specific screen.
- A D1-synced multi-monitor preference — see Data Model below for why this
  is deliberately localStorage-only.

## A. Window Cycling (Ctrl+\`)

**Shortcut**: `Ctrl+\`` (backtick) cycles forward through open desktop
windows; `Ctrl+Shift+\`` reverses. Chosen specifically because it's not
reserved by any major OS or browser (unlike literal Alt+Tab, which never
reaches the page) — the same "cycle app windows" pattern VS Code and Slack
already use for this exact reason.

**Scope**: active only while `/desktop` is mounted (the floating windows
this cycles only exist there) — a keydown/keyup listener attached in
`DesktopPage.tsx`'s effect scope, not a site-wide global.

**Behavior**: holding Ctrl and pressing `` ` `` shows a centered overlay
listing every open window — icon (resolved via a new
`getWindowIconByPath` helper alongside the existing `getWindowConfigByPath`
in `windowManager.ts`) + title, MRU-ordered (most-recently-focused first,
matching real Alt+Tab), **including minimized windows** — with one entry
highlighted. Each further `` ` `` press (Ctrl still held) advances the
highlight by one, wrapping at the ends; `Shift` reverses direction.
Releasing Ctrl commits: calls the existing `focusWindow(id)` on the
highlighted window, which already handles un-minimizing. Releasing without
ever advancing (a bare Ctrl+\` tap) just focuses the next-most-recent
window, matching the familiar single-tap Alt+Tab behavior.

**New component**: `DesktopWindowSwitcher.tsx`, mounted inside
`DesktopPage.tsx` as a sibling to the existing `WindowLayer`. Owns local
`cycling: boolean` / `highlightIndex: number` state — no new fields needed
on `DesktopWindowManagerContextValue` beyond reading `windows` and calling
the existing `focusWindow`.

## B. Multi-Monitor Pop-Out Placement

**What this actually is**: the browser's Window Management API
(`window.getScreenDetails()`) lets a page enumerate connected physical
screens and open a *new* `window.open()` window targeting a specific one's
bounds. It does not — and cannot — let an in-page floating panel span onto
a second monitor. This feature therefore extends the existing real pop-out
mechanism only: the top-bar "Open in new window" button
(`Layout.tsx`), Module Directory's pop-out icon, and the incident/record
detached-window helpers — everything that already routes through
`openDetachedWindow()` in `windowManager.ts`.

**New file**: `client/src/utils/multiMonitor.ts` — feature-detects support
(`'getScreenDetails' in window`), requests the permission (must be
triggered by a user gesture per the API's own requirement — satisfied by
the settings button below), caches the granted `ScreenDetails` object, and
exposes `getSecondaryScreenBounds(): { left, top, width, height } | null`
(returns `null` on unsupported browsers, ungranted permission, or a
single-screen setup — every one of those collapses to "no secondary
screen," so callers don't need to distinguish the reason).

**Permission UX**: a new "Multi-Monitor" section in the existing Desktop
Settings popover (`DesktopWidgetSettingsPopover.tsx`) with an "Enable
secondary-monitor pop-outs" button. The section renders `null` entirely
when the API isn't supported (Safari, Firefox) rather than showing a
disabled control — there's nothing actionable to show those users.

**Placement change**: `openDetachedWindow()` calls
`getSecondaryScreenBounds()`; when non-null, it centers the new window
within those bounds instead of the current screen's
`window.screen.width`/`height`. When null (the common case — unsupported,
ungranted, or single-screen), behavior is byte-identical to today: zero
regression risk for anyone who never opts in.

## Data Model

The multi-monitor on/off preference is **localStorage-only**
(`rmpg_desktop_multi_monitor`), not a new `user_preferences` D1 column. A
multi-monitor rig is a property of the physical device an officer is
sitting at, not their account — syncing it would mean a dispatcher's
3-monitor desk preference silently following them to a single-screen MDT
login, which is actively wrong. This also avoids a new migration against
`user_preferences`, which is already near D1's 100-column cap (CLAUDE.md's
documented constraint). No schema changes in this phase at all.

## Error Handling

- `getScreenDetails()` rejects (user denies the permission prompt, or the
  browser blocks it for policy reasons): caught, treated identically to
  "unsupported" — `getSecondaryScreenBounds()` returns `null`, pop-outs
  fall back to current-screen centering, no error surfaced to the user
  (denying a permission isn't an error state).
- Window cycling: if `windows` is empty when Ctrl+\` fires, the listener
  no-ops (nothing to show, nothing to cycle).

## Testing

- **Client** (Vitest): `DesktopWindowSwitcher` cycling logic — index
  advance/wrap in both directions, minimized-window inclusion, Ctrl-release
  commit — via simulated keyboard events. `multiMonitor.ts`'s
  `getSecondaryScreenBounds()` against a mocked `ScreenDetails` object
  (multi-screen granted, single-screen, ungranted, unsupported — all four
  collapse to the right return value). `openDetachedWindow()` placement
  test verifying it consumes secondary-screen bounds when available and is
  unchanged when not.
- **Manual, with a disclosed limitation**: real multi-monitor placement
  behavior can only be confirmed on actual multi-monitor hardware — neither
  an automated test nor this session's environment can verify it
  end-to-end. Same category of gap as the iframe permission-grant checks
  from Phase 1; flag for a human to confirm on a real multi-monitor rig
  before treating this fully verified.

## Sequencing Note

Sections A and B are fully independent (different files, no shared state)
and should land as two separate implementation tasks/commits, in either
order.
