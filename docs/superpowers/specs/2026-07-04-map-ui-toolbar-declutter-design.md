# Map UI & Portal Redesign — Phase 3: Toolbar Declutter

**Date:** 2026-07-04
**Status:** Approved for planning

## Context

Phase 1 (structural refactor, PR #2583) and Phase 2 (steel-blue theme pass,
PR #2586) shipped. This is Phase 3 of the 4-phase Map UI/portal redesign
program (see `docs/superpowers/specs/2026-07-03-map-ui-portal-redesign-design.md`):
structural refactor → theme pass → **UX declutter** → feature wiring.

`MapboxMapPage.tsx` currently exposes ~85 icon buttons/toggles across two flat
rows: a sidebar-footer quick-actions row (~17 toggles: beats, terrain,
isochrone, self-position, breadcrumbs, daylight, geofence alerts, auto-pan P1,
P1 audio, coord grid, weather radar, GPU overlay, refresh) and a separate
"Advanced Map Tools" toolbar (heatmap, traffic, clustering, satellite peek,
measure dropdown, draw dropdown, GL Draw). All controls have identical visual
weight regardless of how often they're used or how safety-critical they are.

## Goals

- Reorganize the sidebar-footer quick-actions row and the Advanced Map Tools
  toolbar into 5 categorized dropdown groups: **Overlays**, **Analysis**,
  **Drawing & Measure**, **Alerts & Safety**, **View**.
- Reuse the existing dropdown-menu pattern already present in the file (the
  measure/draw dropdowns use this pattern today) rather than introducing a
  new UI primitive.
- Keep safety-critical toggles (P1 audio, geofence alerts, auto-pan P1) one
  click reachable at all times — never nested inside a submenu that requires
  an extra click to discover, since burying them would be a safety regression
  disguised as a UX improvement.

## Non-goals

- No new features, no wiring of orphan panels (Phase 4).
- No theme/color changes (Phase 2 already done).
- No change to any toggle's underlying behavior/state — this is purely a
  layout/grouping reorganization of controls that already exist and work.
- No changes to the sidebar's UNITS/CALLS tabs — those stay as-is.

## Design

### Grouping

| Group | Contents | Rationale |
|---|---|---|
| **Overlays** | beats, terrain, isochrone, self-position, breadcrumbs, daylight, coord grid, weather radar, GPU overlay | Passive visual layers toggled occasionally, not moment-to-moment |
| **Analysis** | heatmap, traffic, clustering | Data-density/pattern tools, used together during situational analysis |
| **Drawing & Measure** | measure dropdown, draw dropdown, GL Draw | Already grouped today — relocate as a unit, no internal changes |
| **Alerts & Safety** | P1 audio, auto-pan P1, geofence alerts | Safety-critical — kept as a permanently-visible row, NOT a dropdown, so there's no extra click between an officer and a safety toggle |
| **View** | satellite peek, 3D buildings, map style selector | Visual presentation controls |

### Layout

Each of Overlays/Analysis/Drawing-Measure/View becomes a single dropdown
button (icon + chevron) that expands a small panel of its member toggles,
mirroring the existing measure/draw dropdown pattern (`showMeasureMenu`/
`showDrawMenu` state + conditional-render panel). Alerts & Safety stays a
flat, always-visible row of 3 icon buttons — same as today, just visually
separated/labeled as its own section rather than interleaved with the rest.

### State

No new state shapes needed — every toggle's existing `useState`/hook-derived
`enabled`/`toggle()` stays exactly as-is. Only new state: one `showXMenu`
boolean per new dropdown group (4 groups × 1 boolean each), following the
existing `showMeasureMenu`/`showDrawMenu`/`showStyleMenu` naming convention
already in the file.

## Testing

- `cd client && npx tsc --noEmit` after each group's extraction.
- Manual browser verification: confirm every one of the ~85 controls is still
  reachable and functions identically (same toggle behavior, same visual
  on/off state), just relocated into its new group's dropdown. Confirm the 3
  Alerts & Safety toggles remain visible without opening any menu.
- No new automated tests required — this is a pure JSX reorganization with no
  new logic; existing hook-level tests (`MapCore.test.ts`, etc.) are
  unaffected since no hook code changes.
