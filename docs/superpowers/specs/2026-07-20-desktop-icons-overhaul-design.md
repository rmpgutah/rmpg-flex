# Desktop & Icons Overhaul — Design Spec

> Fourth feature build in the `/desktop` "Windows-style" system's 120-item planning
> program. Category: **Desktop & Icons** (per the Foundation-first order:
> Window Management → Taskbar → **Desktop & Icons** → Settings App →
> Personalization → Widgets → Search → Notifications → Records Explorer →
> Utility Apps → Start & Launcher → Accessibility). Follows
> `2026-07-20-desktop-taskbar-overhaul-design.md` (Taskbar, PR #2922).

## Current state

`client/src/components/desktop/DesktopIconGrid.tsx` already has: drag-to-reposition,
multi-select (ctrl/shift-click), grouping into labeled boxes with ungroup,
per-icon context menu (Open, Open in new browser tab, Group as..., Pin to
Taskbar/Unpin from Taskbar, Unpin-from-desktop). `DesktopSettingsApp.tsx`'s
"Desktop & Icons" category already has: widget toggles, icon size
(small/medium/large), view mode (grid/list), sort mode
(manual/alpha/usage) with a one-shot "Snap to Grid" button, and "Reset to
Default". `DesktopPage.tsx`'s empty-desktop right-click menu currently has
only two items: "Settings" and "New sticky note".

What's missing, scoped to four items:

1. Right-click Sort/View/Icon-size/Auto-arrange/Show-Hide shortcuts on the
   empty desktop (today these controls only live inside the Settings app).
2. A persistent **Auto-arrange** mode (today's "Snap to Grid" is a one-shot
   button, not a standing mode that governs where new icons land).
3. **Rename** an icon's desktop label.
4. **Show/Hide desktop icons** (hide the icon layer without unpinning
   anything, sticky notes/widgets/windows unaffected).

## Scope for this build

One chunk, all four together — they're small, mostly-independent additions
to the same two files (`DesktopIconGrid.tsx`, `DesktopPage.tsx`), so there's
little rework risk building them as a single plan.

## 1. Data model & storage

New file `client/src/utils/desktopIconPreferences.ts` — localStorage,
device-scoped, following the exact pattern of `snapPreference.ts`:

```ts
export function getIconLabelOverride(path: string): string | null
export function setIconLabelOverride(path: string, label: string): void
export function clearIconLabelOverride(path: string): void

export function isAutoArrangeEnabled(): boolean
export function setAutoArrangeEnabled(enabled: boolean): void

export function areIconsHidden(): boolean
export function setIconsHidden(hidden: boolean): void
```

Storage keys: `rmpg_desktop_icon_label_overrides` (JSON object,
`{ [path]: label }`), `rmpg_desktop_auto_arrange` (`'1'|'0'`, default off),
`rmpg_desktop_icons_hidden` (`'1'|'0'`, default off/shown).

These are deliberately **not** added to `DesktopLayout`
(`normalizeDesktopLayout.ts`, the D1-synced `desktop_layout_json`) — they are
per-device preferences, not cross-device layout state, consistent with how
every prior category in this program (Window Management, Taskbar) scoped
its own preferences. A renamed icon shows the override label only on the
desktop icon grid — Module Directory, the taskbar, and everywhere else
keep showing the nav catalog's canonical `label`.

## 2. Right-click Sort/View/Icon-size/Auto-arrange/Show-Hide on the empty desktop

`DesktopPage.tsx`'s empty-desktop `ContextMenu` (currently `Settings` /
`New sticky note`) gains, before those two existing items and separated by
`divider: true` entries (the existing `ContextMenuItem` type has no native
submenu support, so this is a flat list grouped visually by dividers, not a
nested menu):

- `Sort: Manual` / `Sort: Alphabetical` / `Sort: Most Used` — call the
  existing `handleSortModeChange`.
- `View: Grid` / `View: List` — call the existing `handleViewModeChange`.
- `Icon size: Small` / `Icon size: Medium` / `Icon size: Large` — call the
  existing `handleIconSizeChange`.
- `divider`
- One toggle item whose label reflects current state:
  `'Auto-arrange: On'` / `'Auto-arrange: Off'` — calls
  `setAutoArrangeEnabled(!isAutoArrangeEnabled())` then forces a re-render
  (same `forceRerender` tick pattern used throughout the Taskbar build for
  localStorage-backed toggles read outside React state).
- One toggle item: `'Hide icons'` / `'Show icons'` — calls
  `setIconsHidden(!areIconsHidden())` + `forceRerender`.
- `divider`
- existing `Settings` / `New sticky note` items, unchanged.

### Auto-arrange mechanics

New helper in `client/src/utils/desktopLayoutOps.ts`:

```ts
export function nextAutoArrangeSlot(
  occupied: Record<string, { x: number; y: number }>,
): { x: number; y: number }
```

Scans grid cells row-by-row (reusing this file's existing `GRID_COLS` (6),
`CELL_W` (96), `CELL_H` (96) constants and the `+20` origin offset already
used by `gridLayout`) and returns the first `{x, y}` cell not already
occupied by any position in `occupied` — filling gaps left by unpinned
icons, per your chosen behavior, rather than always appending after the
highest-indexed cell.

**Integration point** (grounding this in the actual code, not an
assumption): `DesktopPage.tsx` computes `pinnedIcons` from `favorites`, but
today there is no reconciliation step that assigns a grid position to a
favorite that has no entry in `layout.icons` — `DesktopIconGrid.tsx`
currently falls back to a hardcoded `{ x: 20, y: 20 }` for any such icon
(`positions[fn.path] ?? { x: 20, y: 20 }`), meaning two icons pinned after
the initial desktop load with no explicit position both render stacked at
the same spot. This build adds a `useEffect` in `DesktopPage.tsx`, keyed on
`pinnedIcons`, that appends a computed position to `layout.icons` for any
pinned path missing one:
- If auto-arrange is enabled: `nextAutoArrangeSlot(positions)`.
- If auto-arrange is disabled: the existing cascade behavior from
  `autoLayoutIcons` (continue the same row/column math from the last
  occupied index), preserving today's initial-load behavior for the
  ongoing case, not just at mount.

This is a small, self-contained fix to genuinely-missing reconciliation
logic that this build is already touching (the `positions` derivation and
`layout.icons` state) — not an expansion of scope beyond what "auto-arrange
governs where new icons land" already implies. Auto-arrange does **not**
retroactively move already-placed icons; it only governs where *newly
appearing* icons land.

## 3. Rename icons

Per-icon `ContextMenu` in `DesktopIconGrid.tsx` gains a **"Rename"** item,
inserted after "Open in new browser tab" and before "Pin to
Taskbar"/"Unpin from Taskbar". Clicking it swaps the icon's `<span>` label
for an auto-focused `<input>` (no `window.prompt` — an inline edit, matching
the desktop's existing direct-manipulation feel). Enter or blur commits via
`setIconLabelOverride(fn.path, trimmedValue)`; Escape cancels without
saving; committing an empty string calls `clearIconLabelOverride(fn.path)`
instead (reverting to the catalog's default label). Every place
`DesktopIconGrid.tsx` renders an icon's label switches from `fn.label` to
`getIconLabelOverride(fn.path) ?? fn.label`.

## 4. Show/Hide desktop icons

`DesktopPage.tsx` reads `areIconsHidden()` in its render: when true, neither
the icon grid nor the "No modules pinned yet" empty-state message render.
Sticky notes, widgets, and open windows are unaffected — this only hides
the icon layer, matching the classic Windows "Show desktop icons" toggle.
The toggle lives on the empty-desktop right-click menu only (§2) — no
Settings-app mirror, since a hidden desktop with icons off would make the
Settings-category checkbox itself hard to imagine reaching meaningfully
differently than the right-click toggle already does.

## 5. Testing approach

- `desktopIconPreferences.ts` — unit tests mirroring `snapPreference.test.ts`:
  defaults, persistence round-trip, `clearIconLabelOverride` reverting a
  path to no-override, auto-arrange and icons-hidden toggles.
- `desktopLayoutOps.ts` — unit tests for `nextAutoArrangeSlot`: fills a gap
  left by a removed icon rather than appending after the last occupied
  cell; falls back to the next linear cell when no gaps exist.
- `DesktopIconGrid.tsx` — extend existing tests: Rename item present;
  typing + Enter updates the rendered label and persists via
  `getIconLabelOverride`; Escape cancels without persisting; committing an
  empty value clears the override and reverts to the catalog label.
- `DesktopPage.tsx` — extend existing tests: empty-desktop right-click
  shows Sort/View/Icon-size/Auto-arrange/Show-Hide items, each calling the
  right handler; with auto-arrange on, a newly-favorited path (simulated
  via the `favorites` state) gets a position that fills a known gap rather
  than overlapping an existing icon; with icons hidden, the icon grid does
  not render but a sticky note does.

## Global constraints (carried from the project and prior desktop specs)

- All new preferences are `localStorage` (device-scoped), never D1/API —
  no new migration, no new column, and specifically NOT added to
  `DesktopLayout`/`desktop_layout_json`.
- All new chrome uses the project's CSS-variable-backed Tailwind tokens —
  never hardcoded hex.
- No new D1 migrations in this build.
- Rename overrides only affect the desktop icon grid's rendered label —
  Module Directory, the taskbar, and the nav catalog itself stay canonical.
