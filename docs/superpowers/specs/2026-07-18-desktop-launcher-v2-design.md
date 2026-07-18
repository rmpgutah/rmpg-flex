# Desktop Launcher v2 — Enhancements Design Spec

**Date**: 2026-07-18
**Status**: Approved for planning
**Builds on**: [2026-07-18-desktop-launcher-design.md](2026-07-18-desktop-launcher-design.md) (v1, shipped — `/desktop` route, icon grid, taskbar, 4 widgets, wallpaper, in-page windows)

## Purpose

Pull the next slice out of v1's "Enhancement Backlog" — Organization, Widgets,
Personalization, and Productivity — to make the existing `/desktop` launcher
more capable for day-to-day officer use: icon grouping, new live widgets,
personal accent color, sticky notes, and a command bar with real actions.

## Non-goals (this pass)

- **Weather widget** — needs a new external API integration; out of scope,
  revisit separately.
- **Custom wallpaper upload** — needs R2 storage plumbing; out of scope,
  revisit separately.
- **Power-user backlog items** — Alt+Tab window cycling, export/import layout
  JSON, per-role default templates, expanding the windowable set beyond
  `POPOUT_PAGES` — all deferred to a future pass.
- **Folder nesting** — grouping is a single flat labeled cluster; a group
  cannot contain another group.
- **"New Case" command-bar action** — `CaseManagementPage.tsx` has no
  URL-param creation trigger today (unlike Dispatch/Incidents); adding one is
  out of scope here.
- **Multi-surface drag-to-open** — only one source (person rows in
  `PersonsTab.tsx`) wired to one target (the Records icon) this pass, not an
  audit of every draggable-card opportunity.

## Data Model & Persistence

Extends the same `user_preferences` D1 columns v1 introduced, plus two new
ones (`migrations/0193_desktop_v2.sql`):

```sql
ALTER TABLE user_preferences ADD COLUMN desktop_accent TEXT;       -- preset id, default 'default'
ALTER TABLE user_preferences ADD COLUMN desktop_notes_json TEXT;   -- [{id,x,y,width,height,text,color}, ...]
```

**`desktop_layout_json`** changes shape from a flat icon-position array to:

```ts
{
  icons: [{ path: string; x: number; y: number }];
  groups: [{ id: string; label: string; x: number; y: number; w: number; h: number; memberPaths: string[] }];
  iconSize: 'small' | 'medium' | 'large';
  sortMode: 'manual' | 'alpha' | 'usage';
}
```

A normalizer in the loader treats any already-saved flat array (v1's shape)
as `{ icons: oldArray, groups: [], iconSize: 'medium', sortMode: 'manual' }`
— no migration of existing row data needed, just a read-time upgrade.

**`desktop_widgets_json`** changes shape from an ordered on/off string array
to freeform per-widget state:

```ts
[{ id: string; x: number; y: number; on: boolean; opacity: number; blur: number }]
```

Same read-time normalizer: an old string array becomes this shape with
default positions (stacked top-right, matching v1's fixed layout) and
`opacity: 1, blur: 0`.

Both normalizers are pure functions, unit-tested directly (old shape in, new
shape out) — no Worker changes needed since `PUT /api/preferences` already
stores/returns these columns as opaque strings (per v1's `PREF_COLUMNS`
generic-reflection pattern in `src/routes/stubs.ts`).

**Accent color** does not touch the app-wide Blue & Silver theme. It swaps
only the desktop-shell-scoped tokens that already exist for this purpose —
`--desktop-shell-accent` / `--desktop-shell-accent-shadow`
([client/src/styles/theme-palettes.css:104-105](../../../client/src/styles/theme-palettes.css)) —
via an inline style override scoped to the `/desktop` page root. The rest of
the app's `--brand-gold`/`--brand-blue` tokens are untouched.

## Components

All new files under `client/src/components/desktop/` (and
`client/src/components/desktop/widgets/`), following v1's structure:

### Organization

- **Grouping**: extend the existing multi-select (shift/ctrl-click, already
  used for bulk actions elsewhere) on `DesktopIconGrid.tsx`. Right-click with
  2+ icons selected adds a "Group as..." entry to the existing
  `ContextMenu.tsx` invocation, prompting a label and creating a `group`
  entry containing those icons' current positions rendered as a soft-bordered
  labeled region behind them. Right-click a group's border/label →
  "Ungroup" removes the group entry (icons keep their positions).
- **`DesktopIconGrid.tsx`** gains an `iconSize` prop (`small`/`medium`/`large`
  — scales icon + label size and grid cell spacing) and a list-view mode
  (same click/drag/drop-target behavior, rendered as compact rows instead of
  a free-form canvas grid). Both toggle from a new control in the taskbar's
  settings popover.
- **Sort modes**: `sortMode: 'alpha'` re-lays-out icons alphabetically by
  label into grid cells; `'usage'` sorts by frequency already tracked in
  `loadRecent()` (no new tracking); `'manual'` is today's free-drag behavior
  (default, unchanged).
- **Snap-arrange**: one taskbar-settings button that recomputes every icon's
  `{x,y}` onto the nearest grid cell using pure math over current positions —
  no new state, just a bulk position rewrite.
- **Reset to default**: taskbar-settings action that clears
  `desktop_layout_json`, `desktop_widgets_json`, `desktop_accent`, and
  `desktop_notes_json` back to v1's first-load defaults, behind a confirm
  dialog (destructive to a personal layout, not to any underlying data).
- **Bulk-pin**: `ModuleDirectoryPage.tsx` gains a "select multiple" mode
  (checkbox per row) that stars all selected modules in one
  `saveFavorites()` call instead of one star-click at a time.

### Widgets

- **`DesktopShiftTimerWidget.tsx`**: polls the same
  `GET /personnel/time/mine/active` `DesktopClockWidget` already uses;
  renders elapsed on-duty time as a live-ticking duration. No new endpoint.
- **`DesktopPinnedCallTicker.tsx`**: a horizontally-scrolling ticker of the
  officer's favorited/pinned active calls, sourced from the same dispatch
  data already powering the Ops Summary widget's `activeCalls` badge.
- **`DesktopMiniMapWidget.tsx`**: a real Mapbox GL instance (per the chosen
  option, not a static preview) reusing the existing
  `client/src/utils/mapboxBasemap.ts` styling seam, showing nearby units and
  the officer's own position at small scale. Mounts/unmounts its GL context
  cleanly on widget toggle-off so multiple open/close cycles don't leak
  contexts — this is the heaviest single item in this pass (second live map
  render alongside the main Map/Dispatch surfaces).
- **Freeform widget layout**: `DesktopWidgetPanel.tsx`'s fixed top-right
  vertical stack becomes canvas-positioned panels, each with a small drag
  handle in its own title bar reusing `DesktopIconGrid`'s existing
  pointer-drag math. Position persists per-widget in `desktop_widgets_json`.
- **Per-widget opacity/blur**: right-click a widget → context menu gains an
  opacity slider and a blur toggle, writing to that widget's `opacity`/`blur`
  fields, applied via inline `style={{opacity, backdropFilter}}`.

### Personalization

- **`desktopAccents.ts`** (new data file, mirrors `desktopWallpapers.ts`
  pattern): ~5 curated presets (default silver/blue, amber, teal, crimson,
  forest), each just a `{id, label, accentRgb, shadowRgb}` pair swapped into
  `--desktop-shell-accent`/`--desktop-shell-accent-shadow`. Picker lives in
  the taskbar settings popover alongside wallpaper selection.
- **`DESKTOP_WALLPAPERS`** gains a few more seasonal/precinct-branded preset
  entries (still CSS-variable-backed, no new mechanism — same
  `getWallpaper()`/`DEFAULT_WALLPAPER_ID` contract as v1).

### Productivity

- **`DesktopStickyNote.tsx`**: freeform draggable + resizable text note,
  own color (from the same accent swatch set), persisted in
  `desktop_notes_json`. Created via right-click empty canvas → "New sticky
  note"; deleted via its own close control.
- **Command bar actions**: the existing ⌘K/Ctrl+K launcher
  (`DesktopTaskbar.tsx`) gains 3 fixed actions above the fuzzy module search
  results:
  - **Clock In / Clock Out** (shown based on current active-shift state) —
    calls `POST /personnel/time/clock-in` or `.../clock-out` with
    `{officer_id}`, the exact pattern already used in
    `PersonnelPage.tsx:1077`; toasts success/failure (409 "already clocked
    in" etc. surfaced as-is).
  - **New Call** — navigates to `/dispatch?newCall=1`, an existing
    cross-page convention already read by `DispatchPage.tsx`.
  - **New Incident** — navigates to `/incidents?newIncident=1`, same
    existing convention read by `IncidentsPage.tsx`.
- **Drag person → Records icon**: the person row in
  `PersonsTab.tsx` (line ~718) gains `draggable` + `onDragStart` setting a
  `dataTransfer` payload `{type:'person', id, name}`. The Records desktop
  icon (`path === '/records'` in `POPOUT_PAGES`) gains an `onDrop` handler
  that opens a `FloatingWindow` at `/records?personId=<id>`.
  `RecordsPage.tsx` gains a small mount-time effect reading `personId` from
  the query string and auto-selecting that person in `PersonsTab`, mirroring
  the `newCall`/`newIncident` query-param convention already established.

Right-click behavior additions route through the existing generic
`ContextMenu.tsx` — no new context-menu component.

## Role Visibility

Unchanged from v1 — inherits the shared catalog's
`CLIENT_VIEWER_BLOCKED`/`CONTRACT_MANAGER_BLOCKED`/`adminOnly` rules. No new
access-control surface introduced by any feature in this pass.

## Error Handling

- All new layout mutations (grouping, icon size/sort, widget drag, sticky
  notes) go through the same debounced (~800ms) `PUT /api/preferences` +
  non-blocking toast-on-failure pattern v1 established — local state is
  never lost on a failed save.
- A `personId` query param that doesn't resolve to a real person (stale/bad
  id): `RecordsPage` falls back to its normal unfiltered view instead of
  erroring.
- Mini-map widget: on Mapbox load/style failure, shows the same inline retry
  affordance `FloatingWindow` already uses for iframe failures, rather than a
  blank widget.
- Command-bar Clock In/Out actions surface the same error bodies
  (`PersonnelPage`'s existing 409/404 handling) as a toast — no new error
  paths introduced.

## Testing

- **Client** (Vitest + `@testing-library/react`): coverage per new/changed
  component — group create/ungroup, icon-size/list-view toggle, sort-mode
  re-layout math, snap-arrange math, bulk-pin, freeform widget drag
  persistence, opacity/blur application, accent-swatch application,
  sticky-note CRUD, command-bar action dispatch (mocked `apiFetch`), and the
  person-row-drag → Records-drop handler. Plus direct unit tests for the two
  layout-normalizer pure functions (old shape in, new shape out).
- **Worker**: extend the existing `test-workers/desktopPreferences.test.ts`
  smoke test to cover the two new columns (`desktop_accent`,
  `desktop_notes_json`) round-tripping through `PUT`/`GET /api/preferences`.
- **Manual**: dev-server browser check for every drag/drop interaction
  (grouping, widget dragging, sticky notes, person-onto-icon drop) and the
  mini-map widget's mount/unmount lifecycle (toggle it on/off repeatedly,
  confirm no console warnings about leaked WebGL contexts).
- **Post-merge**: apply `0193_desktop_v2.sql` directly to live D1 (per the
  `continue-on-error` migration gotcha in CLAUDE.md), verify via
  `pragma_table_info('user_preferences')`.

## Sequencing Note

This spec covers 13 distinct features across 4 categories — larger than v1's
single-threaded plan. The implementation plan should split this into
independently-committable tasks (mirroring v1's per-task-and-commit
granularity) and is expected to land as several smaller PRs rather than one
mega-PR, grouped roughly by category (Organization → Widgets →
Personalization → Productivity), since each category is independently
shippable and testable.
