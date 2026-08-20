# Toughbook FZ-55 UI Format — Design Spec

**Date:** 2026-08-13
**Status:** Approved
**Branch:** `claude/toughbook-fz55-ui-format-d390be`

## Problem

Officers using the Panasonic Toughbook FZ-55 as a CAD terminal experience
system-wide UI issues: sidebar/content overlap, modal buttons falling below the
visible viewport, table columns overflowing, panel headers collapsing into
content, and dropdowns rendering under modals. The FZ-55 runs at three effective
viewport sizes depending on hardware revision and Windows DPI scaling:

| Config | Native resolution | Windows scaling | Effective viewport |
|---|---|---|---|
| FZ-55 Mk1 (older) | 1366×768 | 100% | 1366×768 |
| FZ-55 Mk1/Mk2 | 1920×1080 | 125% | 1536×864 |
| FZ-55 Mk2 (native) | 1920×1080 | 100% | 1920×1080 |

All three configs must be fixed. The FZ-55 also has a capacitive touchscreen
used by officers wearing gloves — touch target sizing is part of this fix.

## Approach

**Device-class detection + scoped CSS (Approach B).**

A `useDeviceClass()` hook stamps `device-fz55` on `<html>` when running on FZ-55
hardware. All layout fixes live under `.device-fz55` selectors in a dedicated
stylesheet. Layout.tsx reads the hook for the two structural decisions that
require JS (sidebar default state, modal max-height enforcement). Everything else
is pure CSS — no per-component changes required.

## Architecture

### 1. Detection Hook — `client/src/hooks/useDeviceClass.ts`

Runs once on mount. Detection fires when **all three** conditions are true:

1. `navigator.maxTouchPoints > 0` — touchscreen present
2. `screen.width` in [1300, 1960] AND `screen.height` in [700, 1120] — covers all
   three FZ-55 viewport configs; excludes phones (too small) and 4K monitors (too large)
3. `!/Mobi|Android/i.test(navigator.userAgent)` — not a mobile/tablet UA

Re-evaluates on `window.resize` (handles external monitor connection mid-shift).

Stamps `document.documentElement.classList.add('device-fz55')` synchronously on
first match. Removes on mismatch (monitor disconnect). Returns `{ isFz55: boolean }`.

Layout.tsx imports this hook at its root — one call, app-wide effect.

### 2. Layout Structural Changes — `client/src/components/Layout.tsx` + `Sidebar.tsx`

**Sidebar default state:**
- Current behavior: sidebar expands at `lg` (1024px) and above.
- FZ-55 behavior: when `isFz55` is true, sidebar defaults to collapsed icon-rail
  mode (48px wide) regardless of viewport width. Officers toggle it open explicitly.
- Rationale: at 1366×768 or 1536×864, a 240px expanded sidebar leaves the content
  panel too narrow for CAD data. Icon-rail mode preserves all navigation access
  at 48px cost.

**Main content scroll containment:**
- Enforce `height: 100%` chain: `<html>` → `#root` → Layout shell → content pane.
- Content pane gets `overflow-y: auto` so tall pages scroll within the viewport
  rather than pushing buttons below the visible area.
- Existing `height: 100dvh` on `html, body, #root` in `index.css` already covers
  the outer shell — this adds the inner content pane link.

**Modal max-height:**
- Modal inner scroll containers get `max-h-[90dvh]` + `overflow-y: auto` applied
  via the shared modal wrapper when `isFz55` is true.
- Prevents Save/Cancel buttons from falling below the 768px effective viewport at
  125% Windows scaling.

### 3. CSS Fixes — `client/src/styles/fz55.css`

Imported once at the top of `client/src/index.css` (after `theme-palettes.css`,
before Tailwind layers). All rules scoped under `.device-fz55`.

#### Touch targets
```css
.device-fz55 button,
.device-fz55 a,
.device-fz55 [role="button"],
.device-fz55 input,
.device-fz55 select,
.device-fz55 textarea {
  min-height: 44px;
  min-width: 44px;
}

.device-fz55 button:has(svg:only-child),
.device-fz55 [role="button"]:has(svg:only-child) {
  padding: 10px;
}
```
WCAG 2.5.5 / Apple HIG gloved-hand minimum. Icon-only buttons get padding to
fill the 44px target without changing visual footprint.

#### Sidebar icon rail
```css
.device-fz55 .sidebar-rail {
  width: 48px;
  min-width: 48px;
}

.device-fz55 .sidebar-rail button {
  width: 48px;
  height: 48px;
}
```
Rail icon buttons hit the 44px minimum with 2px to spare. Tooltip labels
remain accessible via hover/focus (unchanged from current implementation).

#### Tables
```css
.device-fz55 .table-wrapper,
.device-fz55 [class*="overflow-x-auto"] {
  overflow-x: auto;
  max-width: 100%;
}
```
Columns scroll horizontally rather than overflowing the viewport. Row density
(`11px` / `py-[2px]`) is unchanged — data presentation standard holds.

#### Panel headers
```css
.device-fz55 [class*="PanelTitleBar"],
.device-fz55 [data-panel-header] {
  flex-shrink: 0;
}
```
Title bars never collapse under a flex parent that's running out of vertical
space. Fixes the "header disappears into content" overlap class.

#### Z-index stacking ladder
```css
.device-fz55 .sidebar-overlay  { z-index: 40; }
.device-fz55 .sidebar          { z-index: 50; }
.device-fz55 [role="dialog"]   { z-index: 60; }
.device-fz55 [role="tooltip"]  { z-index: 65; }
.device-fz55 .toast-container  { z-index: 70; }
```
Eliminates the sidebar-over-modal and dropdown-under-modal overlap classes.
Values chosen to not conflict with the existing Tailwind z-index scale
(`z-10`=10 through `z-50`=50 in Tailwind; `.device-fz55` ladder starts at 40
and uses explicit px values to override Tailwind classes where needed).

## Files Touched

| File | Change |
|---|---|
| `client/src/hooks/useDeviceClass.ts` | **New** — detection hook |
| `client/src/styles/fz55.css` | **New** — scoped CSS fixes |
| `client/src/index.css` | Add `@import './styles/fz55.css'` |
| `client/src/components/Layout.tsx` | Mount `useDeviceClass`, pass `isFz55` to sidebar + modal logic |
| `client/src/components/Sidebar.tsx` | Accept `defaultCollapsed` prop; use it when `isFz55` |

## Testing

- **Unit:** `useDeviceClass` hook — mock `screen`, `navigator`, `window.resize`;
  assert class is added/removed correctly across the three viewport configs.
- **Visual:** Open the app in a browser devtools device emulation set to
  1366×768 with touch enabled. Verify: sidebar defaults collapsed, no horizontal
  overflow, modal buttons visible, no z-index overlaps on Dispatch/Admin pages.
- **Full suite:** `cd client && npx vitest run` — no new failures.

## Out of Scope

- Per-page hex migration (covered by separate audit program)
- iOS/mobile layout (separate mobile shell)
- Kiosk OS (Linux buildroot — separate program)
- External monitor auto-detect beyond class removal on resize
