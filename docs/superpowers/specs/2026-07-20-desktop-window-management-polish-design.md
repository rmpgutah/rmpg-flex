# Desktop Launcher — Window Management Polish (Phase 2 of 5) Design Spec

**Date**: 2026-07-20
**Status**: Approved for planning
**Builds on**: [2026-07-19-desktop-launcher-windowable-apps-expansion-design.md](2026-07-19-desktop-launcher-windowable-apps-expansion-design.md) (Phase 1, shipped)

## Purpose

Phase 2 of the 5-phase desktop-system program: window-management polish for
the `/desktop` launcher — the full "Window Management" category from the
120-function desktop planning pass (2026-07-20, not a repo file — published
as a standalone reviewable list), split into two chunks. **This spec is
Chunk A**: window cycling and
multi-monitor placement (the two items named in Phase 1's backlog) plus five
smaller items that round out everyday window handling — snap-left/right,
Show Desktop, always-on-top pin, per-window opacity, and remembered window
position. **Chunk B** (virtual desktops/Spaces, window tabs/grouping, a
full Snap Layouts picker) is deliberately excluded — each is large enough to
warrant its own spec, tracked separately.

Two items (cycling, multi-monitor) are scoped to what's actually achievable
inside a browser tab — neither is a literal port of the OS feature it's
named after; see their subsections for why.

## Non-goals

- Chunk B (virtual desktops/Spaces, window tabs/grouping, Snap Layouts
  picker) — separate specs, each large enough to stand alone.
- Phase 3 (wallpaper upload, weather widget), Phase 4 (layout export/import,
  per-role templates) — separate specs.
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
- A D1-synced remembered-window-position preference — see Section F below
  for why that's deliberately sessionStorage-only, same reasoning.
- Global settings for always-on-top, per-window opacity, or remembered
  position — these are per-window/automatic, not the kind of thing that
  needs an on/off toggle in Settings.

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

**Permission UX**: a new "Multi-Monitor" control in the existing
`DesktopSettingsApp.tsx`'s "Window Management" category (a placeholder
today — this spec is what fills it in) with an "Enable secondary-monitor
pop-outs" button. Renders nothing when the API isn't supported (Safari,
Firefox) rather than showing a disabled control — there's nothing
actionable to show those users. (Note: the original draft of this spec
referenced `DesktopWidgetSettingsPopover.tsx`; that component was deleted
and replaced by `DesktopSettingsApp.tsx` in the Phase 5 work that shipped
while this spec sat unbuilt — updated here to the current component.)

**Placement change**: `openDetachedWindow()` calls
`getSecondaryScreenBounds()`; when non-null, it centers the new window
within those bounds instead of the current screen's
`window.screen.width`/`height`. When null (the common case — unsupported,
ungranted, or single-screen), behavior is byte-identical to today: zero
regression risk for anyone who never opts in.

## C. Snap-Left / Snap-Right

Dragging a window's title bar within 24px of the left or right edge of the
desktop's usable area (full viewport height minus the 48px taskbar) shows a
translucent snap-zone preview covering that half of the screen. Releasing
the drag there resizes and repositions the window to fill exactly that
half — `x: 0` or `x: viewportWidth/2`, `y: 0`, `width: viewportWidth/2`,
`height: viewportHeight - 48`, via the existing `moveResize` action.

**Un-snap on drag-away**: `FloatingWindow.tsx` keeps a local
`preSnapBounds` ref (not persisted — a transient drag-interaction detail,
not saved window state). The moment a snap is applied, the window's bounds
*before* snapping are captured there. If the user then drags the title bar
of a currently-snapped window more than a small threshold away from the
edge, the window restores to `preSnapBounds` before continuing the drag
normally (matching the real OS "grab and pull away to un-snap" feel).
Whether a window is currently snapped is tracked the same way — a local
ref, not a new `DesktopWindowState` field — since it's derivable at any
moment from comparing current bounds to the edge zones, not state that
needs to survive a reload.

## D. Show Desktop

A new taskbar button (far right, matching the real OS convention of a
small sliver at the end of the taskbar) minimizes every currently
non-minimized window at once. Clicking it again restores only the windows
*that click* minimized — not ones the user had already minimized by hand
before clicking Show Desktop.

**New context actions** on `DesktopWindowManagerContextValue`:
`minimizeAll(): void` and `restoreAll(): void`. `DesktopTaskbar.tsx` tracks
which action to offer next via a local `autoMinimizedIds: string[]` piece
of state — `minimizeAll()` snapshots the currently-open (non-minimized)
window IDs into it and minimizes them; `restoreAll()` un-minimizes exactly
those IDs and clears the snapshot. The button's icon/tooltip swaps between
"Show Desktop" and "Show Windows" based on whether the snapshot is
non-empty.

## E. Always-On-Top Pin

`DesktopWindowState` gains `alwaysOnTop: boolean` (default `false`) and a
new context action `toggleAlwaysOnTop(id: string): void`, implemented
identically to the existing `toggleMaximize` (read `windowsRef.current`,
map, `commit`). A new pin-icon button joins the title bar's existing
minimize/maximize/close cluster in `FloatingWindow.tsx`.

**Rendering**: pinned windows must always render above unpinned ones,
regardless of normal focus-based z-index. `WindowLayer`
(`DesktopPage.tsx`) sorts windows before rendering so `alwaysOnTop`
windows come last in DOM order (later DOM order + equal-or-higher z-index
wins the stack) — concretely, pinned windows get a z-index offset of
`+10000` added on top of their existing focus-assigned `zIndex`, so a
pinned-but-unfocused window still outranks every non-pinned window, while
focus order *within* the pinned set and *within* the unpinned set both
keep working exactly as they do today.

## F. Per-Window Opacity

`DesktopWindowState` gains `opacity: number` (default `1`, range `0.3`–`1`
— never fully transparent, a window at true 0 opacity would be
undiscoverable and unclosable) and a new context action
`setWindowOpacity(id: string, opacity: number): void`, same
read-map-commit pattern as the other per-window mutators.

**UX**: right-clicking a window's title bar opens a small context menu
(reusing the existing generic `ContextMenu.tsx` component, the same one
the desktop canvas and widgets already use) with an opacity slider —
visually and behaviorally matching the widget panel's existing per-widget
opacity control, applied here to windows instead of widgets.

## G. Remembered Window Position

Today, `openWindow` always computes a fresh cascade position
(`x: 80 + offset, y: 60 + offset`) for a brand-new window at a given path,
ignoring where that path's window was last positioned. This adds a small
`sessionStorage`-backed map, `rmpg_desktop_window_positions` — 
`Record<path, { x: number; y: number; width: number; height: number }>` —
updated on every `moveResize` call for the window matching that path.
`openWindow` checks this map first when creating a new window for a path;
if an entry exists, it's used instead of the cascade default.

**Deliberately session-scoped, not synced to the server** like
`desktop_layout_json`/wallpaper/accent: remembering "where I last put the
Records window" is a convenience for the current browser tab, not account
state worth a cross-device round trip, and avoids touching
`user_preferences` at all for this item (still near D1's 100-column cap,
per CLAUDE.md).

## Data Model

The multi-monitor on/off preference is **localStorage-only**
(`rmpg_desktop_multi_monitor`), not a new `user_preferences` D1 column. A
multi-monitor rig is a property of the physical device an officer is
sitting at, not their account — syncing it would mean a dispatcher's
3-monitor desk preference silently following them to a single-screen MDT
login, which is actively wrong. This also avoids a new migration against
`user_preferences`, which is already near D1's 100-column cap (CLAUDE.md's
documented constraint). No schema changes in this phase at all.

`DesktopWindowState` (`DesktopWindowManager.tsx`) gains three fields for
Sections E–F: `alwaysOnTop: boolean`, `opacity: number`. (Section G's
remembered positions live in their own separate `sessionStorage` key,
`rmpg_desktop_window_positions`, not on `DesktopWindowState` itself — a
closed window has no `DesktopWindowState` to hold that data on.) Both new
fields default such that existing sessionStorage-persisted window entries
from before this change deserialize safely — `alwaysOnTop` and `opacity`
simply read as `undefined` on old entries, and every read site treats
`undefined` the same as the documented default (`false` / `1`), so no
migration or normalizer function is needed for this JSON shape, unlike the
`desktop_layout_json`/`desktop_widgets_json` v1→v2 change.

## Error Handling

- `getScreenDetails()` rejects (user denies the permission prompt, or the
  browser blocks it for policy reasons): caught, treated identically to
  "unsupported" — `getSecondaryScreenBounds()` returns `null`, pop-outs
  fall back to current-screen centering, no error surfaced to the user
  (denying a permission isn't an error state).
- Window cycling: if `windows` is empty when Ctrl+\` fires, the listener
  no-ops (nothing to show, nothing to cycle).
- Snap zones: if the desktop viewport is narrower than the window's
  `MIN_WIDTH`-equivalent (360px per half), snapping is skipped entirely —
  a snapped half narrower than the window can legibly render is worse than
  no snap.
- Show Desktop: clicking it with zero open windows no-ops (nothing to
  minimize).
- Opacity: `setWindowOpacity` clamps its input to the `0.3`–`1` range
  regardless of what the slider (or any future caller) passes, so no
  invalid value can ever reach render.
- Remembered position: a stale/corrupt `rmpg_desktop_window_positions`
  entry (e.g. positioning a window fully off-screen after a browser resize)
  is not specially validated — the existing `moveResize`
  bounds-clamping logic already prevents negative `x`/`y`, and a window
  landing partially off-screen is a pre-existing, unrelated condition this
  spec doesn't need to newly solve.

## Testing

- **Client** (Vitest): `DesktopWindowSwitcher` cycling logic — index
  advance/wrap in both directions, minimized-window inclusion, Ctrl-release
  commit — via simulated keyboard events. `multiMonitor.ts`'s
  `getSecondaryScreenBounds()` against a mocked `ScreenDetails` object
  (multi-screen granted, single-screen, ungranted, unsupported — all four
  collapse to the right return value). `openDetachedWindow()` placement
  test verifying it consumes secondary-screen bounds when available and is
  unchanged when not.
- **Section C** (snap): unit tests for the pure edge-detection/bounds-
  computation logic (given a drag position and viewport size, does it
  return a snap-preview rectangle or `null`), and for restore-to-
  `preSnapBounds` on drag-away.
- **Section D** (Show Desktop): `minimizeAll` only minimizes non-minimized
  windows and records exactly those IDs; `restoreAll` restores exactly the
  recorded IDs and leaves anything the user had manually minimized alone;
  clicking with zero open windows no-ops.
- **Section E** (always-on-top): a pinned-but-unfocused window's effective
  render z-index exceeds every unfocused *and* focused unpinned window's;
  focus order is preserved within each of the two bands.
- **Section F** (opacity): `setWindowOpacity` clamps below `0.3` and above
  `1`; the slider control calls it with the right window id.
- **Section G** (remembered position): opening a path with no prior entry
  falls back to the existing cascade; opening a path with a prior entry
  uses it instead; `moveResize` on an open window updates the
  `sessionStorage` map for its path.
- **Manual, with a disclosed limitation**: real multi-monitor placement
  behavior can only be confirmed on actual multi-monitor hardware — neither
  an automated test nor this session's environment can verify it
  end-to-end. Same category of gap as the iframe permission-grant checks
  from Phase 1; flag for a human to confirm on a real multi-monitor rig
  before treating this fully verified. Drag-based interactions (snap,
  always-on-top drag-reflow, remembered-position capture) are exercised via
  pure-function/unit tests rather than simulated pointer-drag sequences,
  matching how the existing drag/resize code in this file is already
  tested.

## Sequencing Note

Sections A–G are independent of each other (different files or additive
fields with no cross-section coupling) and should land as separate
implementation tasks/commits, in any order. The one soft dependency: 
Section B's Settings-app wiring and the info line mentioned for Section A
both touch `DesktopSettingsApp.tsx`'s "Window Management" category, so
those two tasks should be sequenced one after the other (not necessarily
first) to avoid a merge conflict on the same JSX block — everything else
can interleave freely.
