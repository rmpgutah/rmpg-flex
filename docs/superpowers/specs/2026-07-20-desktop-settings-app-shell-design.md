# Desktop Settings App Shell — Design Spec

> Fifth feature build in the `/desktop` "Windows-style" system's 120-item planning
> program. Category: **Settings App** (per the Foundation-first order:
> Window Management → Taskbar → Desktop & Icons → **Settings App** →
> Personalization → Widgets → Search → Notifications → Records Explorer →
> Utility Apps → Start & Launcher → Accessibility). Follows the merged Taskbar
> overhaul (PR #2922) and the Desktop & Icons overhaul (PR #2924, pending
> merge at spec time).

## Current state

`client/src/components/desktop/DesktopSettingsApp.tsx` has a fixed sidebar of
5 categories (Personalization, Desktop & Icons, Window Management, Taskbar,
and a stubbed Layout & Templates — "coming in a future phase"). There is no
way to search across categories, no way to export/import the growing set of
localStorage-backed preferences this program keeps adding, only Desktop &
Icons has a "Reset to Default" action, and Settings can only be opened via
right-click → Settings or the launcher's quick actions — no keyboard
shortcut.

## Scope for this build

One chunk, all four gaps together:

1. Search across settings (jumps to the matching category)
2. Export/Import settings (device-scoped localStorage prefs only)
3. Reset per-category (in addition to Desktop & Icons' existing reset)
4. Global `Ctrl+,` keyboard shortcut to open Settings

## 1. Search across settings

New file `client/src/data/settingsSearchIndex.ts` — a small, hand-curated,
static array, **not** auto-generated from component introspection:

```ts
import type { CategoryId } from '../components/desktop/DesktopSettingsApp';

export interface SettingsSearchEntry {
  categoryId: CategoryId;
  keywords: string[];
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  { categoryId: 'personalization', keywords: ['wallpaper', 'accent', 'accent color', 'theme'] },
  { categoryId: 'desktop-icons', keywords: ['icon size', 'view', 'grid', 'list', 'sort', 'snap to grid', 'widgets', 'auto-arrange', 'hide icons', 'rename'] },
  { categoryId: 'window-management', keywords: ['window cycling', 'ctrl', 'snap to edge', 'multi-monitor', 'secondary monitor'] },
  { categoryId: 'taskbar', keywords: ['auto-hide', 'position', 'top', 'bottom', 'size', 'small', 'large', 'pin'] },
  { categoryId: 'layout-templates', keywords: ['layout', 'template', 'export layout', 'import layout'] },
];
```

(`CategoryId` needs to become an exported type from `DesktopSettingsApp.tsx`
if it isn't already — check the current file; it's currently a local
`type CategoryId = typeof CATEGORIES[number]['id']` that may need an
`export` keyword added.)

A search `<input>` renders above the category list in the sidebar. Typing
filters `SETTINGS_SEARCH_INDEX` entries whose `keywords` include a
case-insensitive substring match, producing a deduplicated list of matching
`categoryId`s rendered as clickable results directly under the search box
(replacing the category list while a non-empty query is present, matching
the pattern already used by the taskbar's launcher search — filtering the
list in place rather than opening a separate overlay). Clicking a result
sets `activeCategory` to that category and clears the search query.

This is a "jump to category" search, not a "jump to and highlight the exact
row" search — no new anchor/id/scroll-to mechanism is added to any
category's individual controls.

## 2. Export / Import settings

New file `client/src/utils/settingsExportImport.ts`:

```ts
export function exportSettings(): string
export function importSettings(json: string): { ok: boolean; error?: string }
```

`exportSettings()` reads every localStorage key this planning program has
introduced so far and serializes them into one JSON object (key → raw
string value, using `localStorage.getItem` directly so the export format
matches exactly what's stored — no re-parsing/re-serializing that could
silently normalize a value):

- `rmpg_desktop_snap_enabled` (Window Management)
- `rmpg_desktop_multi_monitor` (Window Management)
- `rmpg_desktop_pinned_apps`, `rmpg_desktop_taskbar_position`,
  `rmpg_desktop_taskbar_size`, `rmpg_desktop_taskbar_autohide` (Taskbar)
- `rmpg_desktop_icon_label_overrides`, `rmpg_desktop_auto_arrange`,
  `rmpg_desktop_icons_hidden` (Desktop & Icons)

Deliberately excludes `desktop_layout_json`, `desktop_wallpaper`,
`desktop_widgets_json`, `desktop_accent`, `desktop_notes_json` — those are
already D1-synced cross-device via the existing `/preferences` PUT in
`DesktopPage.tsx`; duplicating them into a manual export/import would create
two competing sync paths for the same data. This export is specifically for
the *device-scoped* localStorage preferences this program has been adding,
which have no other cross-device path today.

`importSettings(json)` parses the JSON, validates it's a plain object with
only string values, and on success writes every key back via
`localStorage.setItem` (silently skipping any key not in the known list
above, so an operator importing an old or foreign export file can't
pollute localStorage with arbitrary keys), returning `{ok: true}`. On
malformed JSON or a non-object shape, returns `{ok: false, error: '...'}`
without writing anything.

UI: two buttons in a new, always-visible section above the category list
(not inside any one category, since this isn't scoped to one feature area)
— "Export Settings" triggers a `Blob` + temporary `<a download="rmpg-desktop-settings.json">`
click; "Import Settings" opens a hidden `<input type="file" accept="application/json">`
and calls `importSettings` on the selected file's contents, showing a
one-line success/error message inline (no toast dependency — this
component doesn't currently use `ToastProvider`).

## 3. Reset per-category

Personalization, Window Management, and Taskbar each get their own "Reset
this category to default" button at the bottom of their panel (matching
Desktop & Icons' existing reset button's visual style — `border:
1px solid var(--sev-critical)`, confirm-before-acting via
`window.confirm`). Each reset only clears that category's own localStorage
keys:

- Personalization reset: `desktop_wallpaper`/`desktop_accent` back to
  `DEFAULT_WALLPAPER_ID`/`DEFAULT_ACCENT_ID` (calls the existing
  `onWallpaperChange`/`onAccentChange` props, same as manually clicking the
  default swatch).
- Window Management reset: `setSnapEnabled(true)` (the documented default)
  — does NOT attempt to revoke multi-monitor permission (browser
  permissions aren't revocable via JS; resetting the flag would just
  silently misrepresent actual browser-granted access).
- Taskbar reset: `setTaskbarPosition('bottom')`, `setTaskbarSize('small')`,
  `setTaskbarAutoHide(false)` — does NOT clear `rmpg_desktop_pinned_apps`
  (pinned apps are user content, not a "setting" in the same sense as a
  display preference; scope this reset to the three true settings only).

Desktop & Icons' existing "Reset to Default" is left untouched (it already
covers layout/widgets/wallpaper/accent/notes as a broader, pre-existing
action — this build does not change its scope, only adds the missing
per-category resets for the other three categories).

## 4. Global `Ctrl+,` shortcut

`DesktopPage.tsx` gains a `keydown` listener (added the same way the
existing `Ctrl+\`` window-cycling listener already works — check
`DesktopWindowSwitcher.tsx` or wherever that listener currently lives for
the established pattern) that calls `setWidgetSettingsOpen(true)` when
`e.ctrlKey && e.key === ','`, with `e.preventDefault()` to stop the browser
from doing anything comma-shortcut-related. No new preference — this is
always-on, matching how `Ctrl+\`` already works unconditionally.

## 5. Testing approach

- `settingsExportImport.ts` — unit tests: `exportSettings()` produces valid
  JSON containing exactly the expected keys and their current localStorage
  values; `importSettings()` round-trips (export → clear → import →
  re-export produces the same JSON); `importSettings()` rejects malformed
  JSON and non-object shapes without writing anything, returning
  `{ok:false}`.
- `DesktopSettingsApp.tsx` — extend existing tests: typing a search term
  (e.g. "auto-hide") filters to only the Taskbar category result; clicking
  a result switches `activeCategory` and clears the query; Export button
  triggers a download (test the underlying `exportSettings()` call, not
  the actual browser download mechanics); Import button reads a file and
  calls `importSettings`; each of the three new per-category "Reset"
  buttons clears only its own keys (verified by pre-seeding a different
  category's keys and asserting they're untouched after one category's
  reset).
- `DesktopPage.tsx` — extend existing tests: pressing `Ctrl+,` opens
  Settings (`widgetSettingsOpen` becomes true / the Settings panel renders).

## Global constraints (carried from the project and prior desktop specs)

- All settings covered by export/import/reset are `localStorage`
  (device-scoped) — this build does not touch D1, `/preferences`, or any
  API call, and does not add anything to `desktop_layout_json`.
- All new chrome uses the project's CSS-variable-backed Tailwind tokens —
  never hardcoded hex.
- No new D1 migrations in this build.
- Search is a "jump to category" mechanism only — no per-row anchors are
  added to any category's individual controls in this build.
