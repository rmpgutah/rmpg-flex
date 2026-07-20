# Desktop Taskbar Overhaul — Design Spec

> Third feature build in the `/desktop` "Windows-style" system's 120-item planning
> program. Category: **Taskbar** (per the user-directed Foundation-first order:
> Window Management → **Taskbar** → Desktop & Icons → Settings App →
> Personalization → Widgets → Search → Notifications → Records Explorer →
> Utility Apps → Start & Launcher → Accessibility). Follows
> `2026-07-20-desktop-window-management-polish-design.md` (Window Management,
> merged as PR #2915).

## Current state

`client/src/components/desktop/DesktopTaskbar.tsx` already has: an app
launcher button with fuzzy search across the nav catalog (`icons`/`catalog`
props), a flat list of open-window buttons (`windows.map(...)`), a Show
Desktop button, a notification bell with unread count polling, and a clock
with duty-status quick actions. What it lacks, relative to a real Windows
taskbar: pinned/favorite apps, window grouping for multiple windows of the
same app, right-click context menus (jump lists) on taskbar buttons, and any
taskbar customization (auto-hide, position, size).

## Scope for this build

One chunk, covering all four gaps together — they share the same taskbar
button component, so splitting them risks rework:

1. Pinned/favorite apps
2. Window grouping + click-to-cycle
3. Right-click context menus (jump lists) on taskbar buttons
4. Taskbar customization (auto-hide, position, size) via the existing
   desktop Settings app

## 1. Data model & storage

New file `client/src/utils/taskbarPreferences.ts` — localStorage,
device-scoped, no D1 sync and no migration, following the exact pattern
already established by `client/src/utils/snapPreference.ts` (try/catch,
silent failure, `localStorage.getItem`/`setItem`, module-level
`STORAGE_KEY` constant):

```ts
export function getPinnedApps(): string[]
export function pinApp(path: string): void
export function unpinApp(path: string): void
export function isAppPinned(path: string): boolean

export type TaskbarPosition = 'bottom' | 'top';
export function getTaskbarPosition(): TaskbarPosition
export function setTaskbarPosition(position: TaskbarPosition): void

export type TaskbarSize = 'small' | 'large';
export function getTaskbarSize(): TaskbarSize
export function setTaskbarSize(size: TaskbarSize): void

export function isTaskbarAutoHideEnabled(): boolean
export function setTaskbarAutoHide(enabled: boolean): void
```

Storage keys: `rmpg_desktop_pinned_apps` (JSON array of nav-catalog paths,
order preserved — pin appends to the end, unpin removes by value),
`rmpg_desktop_taskbar_position` (`'bottom'|'top'`, default `'bottom'`),
`rmpg_desktop_taskbar_size` (`'small'|'large'`, default `'small'`, matching
the taskbar's current 48px/11px-text density), `rmpg_desktop_taskbar_autohide`
(`'1'|'0'`, default off — `'0'`/absent).

`DesktopTaskbar.tsx` merges `getPinnedApps()` (resolved to `NavFunction`
objects via the existing `catalog` prop, by path) with the live `windows`
array into one ordered render list:
- A path that is pinned AND has no open window → a "not running" launcher
  button (click opens it).
- A path with 1 open window (pinned or not) → a normal window button
  (click focuses it).
- A path with 2+ open windows → a **grouped** button (see §3).

Order: pinned apps first (in pin order), then any running-but-unpinned
windows, in their existing `windows` array order (unchanged from today).

## 2. Pinning entry points & naming

To avoid clashing with `DesktopIconGrid.tsx`'s existing "Unpin" item (which
means "remove from the desktop icon grid" — an unrelated, older concept),
every new taskbar-pin action is labeled **"Pin to Taskbar"** /
**"Unpin from Taskbar"**, never bare "Pin"/"Unpin".

Four entry points, each adding one `ContextMenu` item that calls
`pinApp(fn.path)` / `unpinApp(fn.path)` (toggled via `isAppPinned(fn.path)`):

- **`DesktopIconGrid.tsx`** — append to the existing per-icon `items={[...]}`
  array (the `ContextMenu` wrapper already exists here for "Open"/"Unpin"/etc).
- **`DesktopTaskbar.tsx` launcher search results** — currently plain
  `<button>` rows with no right-click; wrap each in `ContextMenu`.
- **A running window's taskbar button** — currently a plain `<button>`;
  wrap in `ContextMenu` with `Pin to Taskbar`/`Unpin from Taskbar`, `Close`,
  and (for grouped buttons only) `Close all` — see §3.
- **`ModuleDirectoryPage.tsx`** tiles — no context menu exists here today;
  this is the first one added, wrapping each tile's existing clickable
  element.

All four write through the same `taskbarPreferences.ts` functions, so
pin state is consistent regardless of entry point. `DesktopTaskbar.tsx`
re-reads `getPinnedApps()` on a window-focus/storage-driven refresh
(matching how other desktop preference reads already refresh — see
`isSnapEnabled()`'s call-site pattern) rather than needing a live event bus.

## 3. Window grouping & cycling

When 2+ open windows share the same `path`:

- The taskbar renders **one button** for the group, labeled with the app
  name, with a small numeric badge (e.g. `2`) in the corner — visually
  modeled on the existing unread-count badge on the notification bell
  (`absolute -top-1 -right-1`, small rounded pill).
- **Click cycles focus** through the group: each click focuses the next
  window in the group (ordered by the windows array's existing order,
  i.e. by open-order/id), wrapping around after the last one. This does
  not use hover-thumbnails/previews (no OS-level window capture available
  in a plain HTML taskbar) — just sequential focus-cycling, matching the
  chosen "click cycles" behavior.
- The group button's `ContextMenu` gets: `Close` (closes the
  currently-focused window in the group), `Close all` (closes every window
  in the group), and the pin toggle (applies to the app path, not an
  individual window instance).
- Pinned-but-not-running placeholder buttons never group — there is only
  ever one such button per unopened pinned path — so grouping logic keys
  off the `windows` array only, grouped by `path`.

## 4. Taskbar customization (Settings app)

New **"Taskbar"** category added to `DesktopSettingsApp.tsx`'s existing
`CATEGORIES` array, alongside `personalization` / `desktop-icons` /
`window-management` / `layout-templates` (same list-item pattern, own icon
— e.g. `PanelBottom` from lucide-react):

- **Auto-hide** (checkbox) — when enabled, the taskbar slides fully
  off-screen (translateY) except for a thin ~4px hover-strip at the
  relevant screen edge; mouseenter on that strip re-shows the bar, mouse
  leaving the bar (after a short delay, avoiding flicker) hides it again.
- **Position** (bottom/top toggle) — moves the 48px bar to
  `top: 0`/`bottom: 0`. `DesktopPage.tsx`'s layout (the floating-window
  layer's usable bounds, the icon grid's usable bounds, and any
  `TASKBAR_HEIGHT`-style constants referenced elsewhere — e.g.
  `FloatingWindow.tsx`'s `TASKBAR_HEIGHT = 48` used for maximize/snap
  math) must read the live position/size settings rather than assuming
  "always at the bottom" going forward.
- **Size** (small/large toggle) — small keeps today's 48px height/11px
  text/current icon sizes; large uses a taller bar (e.g. 56px) with
  proportionally larger buttons/icons/text. This is a rendering-only
  change (no stored pixel values beyond the enum) — `DesktopTaskbar.tsx`
  derives concrete pixel constants from the `'small'|'large'` enum
  internally.

## 5. Testing approach

- `taskbarPreferences.ts` — unit tests mirroring the existing
  `snapPreference.test.ts` shape: default values, persistence round-trip,
  pin/unpin ordering, silent failure when `localStorage` throws.
- `DesktopTaskbar.tsx` — extend its existing test file: a pinned-but-not-
  running app renders a launcher-style button; a running-but-unpinned app
  still renders as today; 2+ windows of the same path render one grouped
  button with the correct count badge and cycle focus on repeated clicks;
  each context-menu item (pin/unpin/close/close-all) calls the right
  handler.
- `DesktopIconGrid.tsx`, `ModuleDirectoryPage.tsx`, and the launcher
  search-result rows — one test per entry point confirming "Pin to
  Taskbar"/"Unpin from Taskbar" appears correctly and calls
  `pinApp`/`unpinApp`.
- `DesktopSettingsApp.tsx` — extend its existing tests for the new
  Taskbar category's three controls, following the same pattern used for
  the Window Management category's controls.
- `DesktopPage.tsx` / `FloatingWindow.tsx` layout math — a test (or, where
  a real browser layout is genuinely needed, a documented manual-check
  caveat consistent with this session's established pattern) confirming
  window/icon-grid bounds and the snap/maximize math adjust correctly
  when position and size settings change.

## Global constraints (carried from the project and prior desktop specs)

- All new preferences are `localStorage` (device-scoped), never D1/API —
  no new migration, no new column.
- All new chrome uses the project's CSS-variable-backed Tailwind tokens
  (`var(--surface-raised)`, `var(--brand-400)`, `var(--rmpg-400)`, etc.) —
  never hardcoded hex.
- No new D1 migrations in this build.
- "Pin to Taskbar"/"Unpin from Taskbar" wording is mandatory and must never
  be shortened to bare "Pin"/"Unpin" anywhere, to avoid confusion with the
  desktop icon grid's pre-existing, unrelated "Unpin" (remove-from-desktop)
  action.
