# Desktop Launcher — Settings App (Phase 5 of 5, narrow scope) Design Spec

**Date**: 2026-07-20
**Status**: Approved for planning

## Purpose

Phase 5 of the 5-phase desktop-system program, brought forward ahead of
Phases 2–4 at the user's request. As originally scoped in Phase 1's spec,
Phase 5 is "an advanced Settings app that surfaces controls for everything
built in Phases 1–4" — **desktop-launcher-scoped**, not a general
account/voice/map settings unification (that broader "Windows Settings for
the whole app" idea was discussed and explicitly declined in favor of this
narrower scope; `SettingsPage.tsx`, `UserProfileModal.tsx`, and
`AdminPage.tsx` already cover account, security, voice, map, and admin
config well and are out of scope here).

Since only Phase 1 has shipped (Phase 2 is spec'd but unbuilt; Phases 3–4
aren't spec'd yet), this app ships with one fully functional category
(personalization, migrated from the existing
`DesktopWidgetSettingsPopover.tsx`) and two placeholder categories reserved
for Phase 2 and Phase 4 to fill in later.

## Non-goals

- No unification with `SettingsPage.tsx`, `UserProfileModal.tsx`, or
  `AdminPage.tsx` — those stay exactly as they are.
- No wallpaper upload or weather widget (Phase 3, unbuilt, unscoped here).
- No functional window-cycling or multi-monitor controls (Phase 2 content;
  placeholder only until that phase ships).
- No functional layout export/import or per-role templates (Phase 4
  content; placeholder only).
- No new D1 columns, no new API endpoints — every control reuses the exact
  same preference fields and save path (`PUT /api/preferences`, 800ms
  debounce) that `DesktopWidgetSettingsPopover.tsx` already uses via
  `DesktopPageInner`'s existing state and callbacks.
- Does not persist its own window position/size across sessions — always
  opens centered, matching the current popover's behavior (it doesn't
  persist position either).
- No new `NavFunction`/catalog entry, no windowing/iframe involvement —
  this is not a routed page (see Architecture).

## Architecture

`DesktopWidgetSettingsPopover.tsx` is replaced by a new
`DesktopSettingsApp.tsx`, rendered the same way its predecessor is today:
directly inside `DesktopPageInner` (`client/src/pages/DesktopPage.tsx`),
**not** as an iframe-windowed route. This is a deliberate constraint, not
an oversight: personalization state (`wallpaperId`, `accentId`, `layout`,
`widgets`, etc.) lives as React state inside `DesktopPageInner` itself. A
real windowed route would run in a separate same-origin iframe with no
access to that state short of building a new `postMessage` sync bridge —
real, ongoing complexity for a settings UI that has no need to exist
outside the desktop page it configures. Every other windowable app
(Records, Dispatch, etc.) is a real standalone SPA route with no
dependency on `/desktop`'s internal state, which is why the iframe model
works for them and doesn't here.

**Trigger**: today, `DesktopWidgetSettingsPopover` opens from exactly one
place — the desktop canvas's right-click context menu's "Widget settings"
item (`DesktopPage.tsx`, `ContextMenu` `items` array). This label becomes
"Settings" and continues to set the same `widgetSettingsOpen` boolean
state that gates rendering. No taskbar button exists for this today and
none is added by this phase.

**Visual treatment**: styled to be visually indistinguishable from a real
floating window — title bar, drag (via the existing `useDraggablePosition`
hook already used by `DesktopStickyNote.tsx`, not `FloatingWindow.tsx`'s
pointer-event drag logic, since that's iframe-window-specific), a resize
handle matching `FloatingWindow.tsx`'s existing corner-drag pattern, and a
close button. No minimize/maximize — out of scope for a settings dialog.

**Layout**: a fixed-size (e.g. 640×480) panel with a left-side category
sidebar and a right-side content panel, Windows-Settings-style.

## Components

`DesktopSettingsApp.tsx` (new file, `client/src/components/desktop/`),
props identical to `DesktopWidgetSettingsPopoverProps` today (no data-model
changes, see Non-goals) — this is a straight prop-preserving rename/rebuild
of the presentation layer:

```ts
export interface DesktopSettingsAppProps {
  widgets: DesktopWidgetState[];
  onToggleWidget: (id: string, enabled: boolean) => void;
  iconSize: 'small' | 'medium' | 'large';
  onIconSizeChange: (size: 'small' | 'medium' | 'large') => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  sortMode: 'manual' | 'alpha' | 'usage';
  onSortModeChange: (mode: 'manual' | 'alpha' | 'usage') => void;
  onSnapToGrid: () => void;
  wallpaperId: string;
  onWallpaperChange: (id: string) => void;
  accentId: string;
  onAccentChange: (id: string) => void;
  onResetToDefault: () => void;
  onClose: () => void;
}
```

**Categories** (local `activeCategory` state, default `'personalization'`):

1. **Personalization** — wallpaper preset picker (`DESKTOP_WALLPAPERS`) +
   accent color picker (`DESKTOP_ACCENTS`). Identical content to the
   popover's existing wallpaper/accent sections.
2. **Desktop & Icons** — icon size (small/medium/large), view mode
   (grid/list), sort mode (manual/alpha/usage) + "Snap to Grid" action,
   per-widget on/off toggles (the 7 entries in `ALL_WIDGETS`), and the
   destructive "Reset to Default" action (behind the same confirmation the
   popover already has). Identical content to the popover's remaining
   sections.
3. **Window Management** *(placeholder)* — static text: "Window cycling
   and multi-monitor placement are coming in a future phase," disabled/greyed
   category icon.
4. **Layout & Templates** *(placeholder)* — static text: "Layout
   export/import and per-role templates are coming in a future phase,"
   disabled/greyed category icon.

## Data Flow

Unchanged from today: `DesktopPageInner` owns all the state
(`wallpaperId`, `accentId`, `layout`, `widgets`) and the debounced
`PUT /api/preferences` save effect already in place. `DesktopSettingsApp`
only calls the same callback props the popover already calls
(`onWallpaperChange`, `onAccentChange`, `onIconSizeChange`, etc.) — it has
no state or persistence logic of its own beyond `activeCategory` (local,
ephemeral, resets to `'personalization'` every time the app is reopened).

## Error Handling

Unchanged — all mutations flow through `DesktopPageInner`'s existing
debounced save-with-non-blocking-toast-on-failure pattern. Nothing new to
handle here since no new data paths are introduced.

## Testing

- **Client** (Vitest): direct port of whatever component tests
  `DesktopWidgetSettingsPopover.tsx` has today (if any exist — verify
  during planning) plus new coverage for: category switching (clicking
  each sidebar item shows the right content panel), the two placeholder
  categories render their static text and don't call any callback props,
  drag repositions the panel, resize respects a sane minimum, close calls
  `onClose`. Every functional control (wallpaper/accent/icon-size/etc.)
  gets the same call-the-right-callback-with-the-right-value assertions
  the popover's tests already make.
- **Manual**: open Settings via the desktop right-click menu, switch
  between all 4 categories, change a wallpaper/accent/icon-size and
  confirm it visibly applies to the desktop behind the (still-open) Settings
  window, drag and resize the window, close it.

## Sequencing Note

Single-task scope — one new component replacing one existing component,
same props, same trigger, same data flow. No decomposition needed beyond
the implementation plan's usual step-by-step breakdown.
