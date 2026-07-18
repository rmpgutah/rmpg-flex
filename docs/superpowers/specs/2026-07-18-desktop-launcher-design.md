# Desktop Launcher — Design Spec

**Date**: 2026-07-18
**Status**: Approved for planning

## Purpose

A personal, per-officer "computer desktop" home base — pinned app icons on a
free-form canvas, live widgets, a taskbar with search, and in-page draggable
windows for a curated set of modules — reached at a new opt-in route
(`/desktop`), never opened automatically on login. Login continues to land on
`DashboardPage` at `/` exactly as it does today
([client/src/App.tsx:531](../../../client/src/App.tsx)).

## Non-goals (v1)

- Not a replacement for the existing post-login `DashboardPage`.
- Not a "multi-desktop / spaces" system.
- Not arbitrary wallpaper image upload (preset backgrounds only).
- Not windowing for all 142 routes — only the existing curated
  `POPOUT_PAGES` subset (~18 modules) is eligible for in-page windows.
- Not a literal enumerated list of 50 shipped features — see the phased
  enhancement backlog below instead.

## Architecture

### Routing

New lazy-loaded route `DesktopPage.tsx` at `/desktop`, added to
`client/src/App.tsx` alongside existing routes, plus a new "Desktop" entry in
the main sidebar nav. No change to the `/` route or login redirect behavior.

### Shared catalog extraction

`NAV_CATEGORIES` (module list: path, label, icon, description, F-key
shortcut, `badgeKey`, role-visibility flags) currently lives inline in
[`ModuleDirectoryPage.tsx`](../../../client/src/pages/ModuleDirectoryPage.tsx).
Extract it to `client/src/data/navCatalog.ts` (pure data + the
`CLIENT_VIEWER_BLOCKED`/`CONTRACT_MANAGER_BLOCKED`/`adminOnly` role-visibility
rules). Both `ModuleDirectoryPage` and the new `DesktopPage` import from this
single source of truth. This is a refactor done in service of the new
feature — it must not change `ModuleDirectoryPage`'s existing behavior
(covered by a regression test, see Testing below).

Favorites (`rmpg_nav_favorites`, localStorage) and Recent (`rmpg_nav_recent`,
sessionStorage) are reused as-is — a module starred in either
`ModuleDirectoryPage` or the desktop shows up in both. "Pinned to desktop" =
"favorited"; there is no separate pin concept.

## Data Model & Persistence

Two different lifetimes for two different kinds of state:

**Permanent, cross-device** — extends the existing D1 `user_preferences`
table (fixed-column, dynamic-SET-clause pattern already used by
[`src/routes/stubs.ts`](../../../src/routes/stubs.ts)):

```sql
-- migrations/0192_desktop_layout.sql
ALTER TABLE user_preferences ADD COLUMN desktop_layout_json TEXT;   -- [{path, x, y}, ...] icon grid positions
ALTER TABLE user_preferences ADD COLUMN desktop_wallpaper TEXT;     -- named preset id, default 'blue-silver-default'
ALTER TABLE user_preferences ADD COLUMN desktop_widgets_json TEXT;  -- ['clock','ops-summary','notifications','quick-access'] with on/off + order
```

`PUT /api/preferences` must be checked for a hardcoded column allowlist in its
SET-clause builder — if one exists, add the three new keys; if it reflects
submitted body keys generically, no route change is needed.

First-load default (no saved `desktop_layout_json`): auto-populate the icon
grid from current favorites in insertion order, default wallpaper preset, all
four widgets on. Layout changes save via a debounced (~800ms) `PUT` — no
explicit save button. A failed save is non-blocking: toast + silent retry,
keeping the in-progress drag in local state so the user never loses work.

**Ephemeral, per-browser-tab** — which in-page windows are currently open,
their position/size/minimized state, stored in `sessionStorage` (mirrors how
`rmpg_nav_recent` already uses sessionStorage for "what was I doing" rather
than a permanent setting). Resets on a fresh session; does not sync
cross-device.

## Components

All new, under `client/src/components/desktop/`:

- **`DesktopWindowManager.tsx`** — context + reducer owning the open-window
  array: `{ id, path, title, x, y, width, height, zIndex, minimized,
  maximized }`. Exposes `openWindow(path)`, `closeWindow(id)`,
  `focusWindow(id)`, `moveResize(id, ...)`.
- **`FloatingWindow.tsx`** — OS-style window chrome: draggable title bar
  (pointer-events, clamped to viewport), corner/edge resize handles,
  minimize/maximize/close, click-to-focus raises `zIndex`. Body is
  `<iframe src={path}>` — same-origin, so the existing localStorage JWT
  carries over automatically. **Zero changes required to any of the 142
  existing page components** — each window is a fully isolated mini-copy of
  the app, the same trick `windowManager.ts` already uses for real
  `window.open()` pop-outs, just drawn on the desktop canvas instead of a
  separate OS window.
- **`DesktopIconGrid.tsx`** — full-bleed canvas, icons freely positioned via
  simple pointer-events drag math (no drag library needed at this scale, max
  ~20-40 icons). Single-click on a `POPOUT_PAGES`-eligible icon opens a
  `FloatingWindow`; single-click on any other catalog icon navigates the SPA
  in place (today's `ModuleDirectoryPage` behavior, unchanged). A small badge
  visually distinguishes "opens as a window" icons from "navigates away"
  icons.
- **`DesktopTaskbar.tsx`** — bottom, full-width. Left: Start-style
  catalog/search launcher (⌘K/Ctrl+K overlay, reuses the fuzzy-match logic
  extracted alongside the catalog). Center: one button per currently-open
  window (including minimized) — click focuses or restores. Right: clock,
  notifications bell with unread count, wallpaper/settings quick-access.
- **`DesktopWidgets.tsx`** — renders the four v1 widgets as floating panels
  on the canvas (not a side rail):
  - *Clock & Shift* — current date/time (America/Denver) + active shift
    status/duration if clocked in.
  - *Live Ops Summary* — reuses the same `badgeKey` counts already powering
    Module Directory badges (`activeCalls`, `openCases`, `activeWarrants`,
    `pendingServe`).
  - *Notifications feed* — same data source as the existing notifications
    inbox.
  - *Quick-Access strip* — mirrors Module Directory's Recent + Favorites
    lists.
  Each widget is togglable on/off, order persisted in `desktop_widgets_json`.
- **`DesktopWallpaper.tsx`** — thin wrapper applying a named CSS-variable-driven
  background preset (no hardcoded hex, per the Blue & Silver theming rule). A
  handful of presets at v1 (solid tones + 1-2 subtle patterns).

Right-click on empty canvas or an icon opens the existing generic
`ContextMenu.tsx` component with actions: for icons — "Open in window" (if
eligible) / "Open in new browser tab" (existing `windowManager.ts` real
pop-out) / "Unpin" / "Rename shortcut" (local label override); for empty
canvas — "Change wallpaper" / "Widget settings".

## Windowing Scope & Guardrails

Only the existing `POPOUT_PAGES` list
([client/src/utils/windowManager.ts](../../../client/src/utils/windowManager.ts))
is eligible for in-page windows — a vetted ~18-module set (Dispatch, Map,
Incidents, Records, Personnel, Warrants, Cases, Evidence, etc.). This avoids
auditing all 142 routes for "what if I'm mounted in a small iframe" behavior.

Soft-cap concurrent open windows (toast warning past 6) — a perf/sanity
nicety since each open window is a live iframe, not a hard block.

Keyboard: `Esc` closes/blurs the focused window.

## Role Visibility

Inherits directly from the shared catalog's existing
`CLIENT_VIEWER_BLOCKED`/`CONTRACT_MANAGER_BLOCKED`/`adminOnly` rules — no new
access-control surface. A module hidden from a role in Module Directory is
equally hidden from that role's desktop icon catalog.

## Error Handling

- Layout save failure: non-blocking toast + retry, drag state preserved
  locally.
- Zero-favorites first-time state: empty-canvas prompt to star modules from
  Module Directory, or right-click the canvas to open a catalog picker
  directly.
- Iframe load failure (e.g. transient network blip): the `FloatingWindow`
  shows a small inline retry affordance rather than a blank frame.

## Testing

- Client: `npx vitest run` coverage for the catalog extraction (regression —
  confirm `ModuleDirectoryPage` behavior is unchanged post-refactor) and the
  new `DesktopIconGrid`/`DesktopTaskbar`/`DesktopWidgets`/`FloatingWindow`
  components (render, pin/unpin, drag-reposition state, window open/close/
  focus/minimize).
- Worker: smoke test for the new `desktop_layout_json`/`desktop_wallpaper`/
  `desktop_widgets_json` fields round-tripping through `PUT /api/preferences`
  (per CLAUDE.md, no broader Worker test suite exists yet — this follows the
  "add a smoke test in the same PR" convention).
- Manual: dev-server browser preview for drag interactions, window
  drag/resize/minimize/restore, and wallpaper rendering under the
  always-dark Blue & Silver theme.
- Post-merge: apply `0192_desktop_layout.sql` directly to live D1 (per the
  `continue-on-error` migration gotcha) and verify via `pragma_table_info`.

## Enhancement Backlog (phased, not v1)

Grouped so future PRs can pull from it incrementally rather than shipping
everything in one mega-PR:

- **Organization**: desktop folders/groups, multiple desktop "spaces", icon
  size/list-view toggle, alphabetical/usage auto-sort, bulk-pin from Module
  Directory, snap-arrange icons, "reset to default" one-click.
- **Widgets**: weather (needs an external API — none currently integrated),
  mini-map widget, shift-timer countdown, pinned-call ticker, custom
  drag-arrangeable widget layout.
- **Personalization**: custom wallpaper upload (R2-backed), accent-color
  picker beyond Blue & Silver, per-widget transparency/blur, seasonal or
  precinct-branded presets.
- **Productivity**: desktop sticky-notes widget, quick-launch "run command"
  bar, drag-a-record-onto-icon actions (e.g. drop a person card onto Records
  to open their file).
- **Power-user**: per-role default desktop templates (admin sets a default
  layout for new dispatchers), export/import layout JSON, multi-monitor–aware
  window/pop-out placement, offline-cached widget data, Alt+Tab-style window
  cycling, expanding the windowable set beyond `POPOUT_PAGES` once individual
  pages are audited for iframe-safe mounting.
