# Map Tab Layout Redesign — Docked Panes

**Date:** 2026-07-19
**Status:** Approved, pending implementation plan

## Context

`MapboxMapPage.tsx` (2018 lines, `client/src/pages/map/`) currently renders its ~50
tools/toggles as a mix of a horizontal toolbar (with dropdown groups), floating panels
positioned absolutely over the map canvas, and a bottom status/legend strip. There's no
fixed structural hierarchy — everything competes for the same visual space, and the
arrangement doesn't reflect how it's actually used by two different audiences
(dispatchers at a desk, officers on MDT laptops).

This redesign restructures the Map tab's **layout only** — not its visual language.
Colors, radius (2px), and the tactical-dark map surface rule are untouched; this reuses
the existing Blue & Silver design tokens throughout. Nothing is added, removed, or
demoted in capability — every one of the ~50 existing toggles/tools stays equally
reachable, just organized into a fixed structure instead of a flat list.

**Discoveries during design:**
- The codebase already has a `layerGroups` data structure (`MapboxMapPage.tsx:1025-1108`,
  type `LayerGroup[]`) grouping most toggles into 4 categories (`live`, `analysis`,
  `base`, `dispatch-tools`) for an existing Layers Panel. This redesign does **not**
  reuse those 4 groups as-is — they don't match the taxonomy validated below — but the
  underlying per-toggle data (id, label, color, description, active state, onToggle) is
  reused verbatim; only the grouping and rendering location changes.
- The page also already has a **Units/Calls roster panel** (`MapboxMapPage.tsx:1279-1332`)
  — a 280px tabbed sidebar ("UNITS (n)" / "CALLS (n)") with a scrollable roster list,
  currently docked left and toggleable via `sidebarOpen`. This is a separate, larger
  panel than "legend + counts" and gets its own dock in the new structure (see below)
  rather than being folded into Info & Tools.

## Non-goals

- No new visual style, colors, or theme changes — this is structural only.
- No app-wide changes — scoped entirely to the Map tab (`client/src/pages/map/` and
  `MapboxMapPage.tsx`). `NavMapView.tsx`, `DispatchMiniMap`, and other map surfaces are
  untouched.
- No pruning or demotion — every existing toggle stays equally reachable in the new
  structure. Nothing moves behind an "Advanced" section.
- No incremental/flagged rollout — this ships as one PR that replaces the current
  layout wholesale (explicit choice, accepting the risk of a large single change to a
  high-traffic surface).

## Design

### Structure: Docked Panes

Six regions, always present at ≥1024px viewport width:

1. **Top toolbar** (slim, full width, sits above everything else): address search, then
   map chrome — Scale Bar, Fullscreen, Minimap — then Bookmarks and Capture Snapshot
   (export). These are the controls least tied to any "layer" and most tied to the
   viewport itself.
2. **Roster dock** (far-left, ~280px): the existing Units/Calls tabbed roster panel,
   moved as-is into a dock slot — same toggle-open/closed behavior (`sidebarOpen`),
   same tab/list content and component internals, just repositioned to sit at the
   far-left edge instead of overlapping the map.
3. **Left dock — "Layers"**: everything that toggles a map overlay/layer on or off.
   Sits between the Roster dock and the map canvas.
4. **Right dock — "Info & Tools"**: dispatch workflow tools, analysis panels, and
   diagnostics — things you *open* or *read*, not layers you toggle.
5. **Map canvas**: fills the remaining space between the docks.
6. **Bottom status bar** (slim, full width, below the map): the existing unit-status
   color-key counts + GPS fix count + calls count strip (`MapboxMapPage.tsx:~1975-2000`)
   — stays exactly as it is today, outside the dock/tray system, since it's compact,
   always-glanceable chrome rather than a "layer" or a "tool." Not affected by the
   responsive breakpoint below.

The Layers dock and Info & Tools dock are collapsible section-by-section
(accordion-style, matching the existing `LayerGroup`-driven panel's current collapse
behavior) — this redesign changes what's grouped where and where the group renders,
not the interaction pattern of expanding a section. The Roster dock keeps its existing
open/closed toggle (not accordion sections) since that's how it already behaves today.

### Left Dock — Layers (5 sections)

Every item below is an existing entry in the current `layerGroups` array (or, for
`district-*`/`geo-*`, a dynamically-generated entry from `districtHierarchy`/
`geoJsonLayers` configs) — same id, label, color, description, active state, and
`onToggle`, just re-bucketed and re-rendered in the new dock instead of the old 4-group
panel.

| Section | Items (by current `id`) |
|---|---|
| **Live Conditions** | `traffic`, `weather`, `p1audio`, `autopan`, `geofences` |
| **Units & Calls** | `breadcrumbs`, `clustering`, `incidents`, `repeat-addresses`, `selfpos` |
| **Historical Analysis** | `heatmap`, `call-history`, `speed-heatmap`, `speed-violations`, `pursuit-segments` |
| **Boundaries** | `beats`, `district-*` (all), `geo-*` (all), `coverage-gaps`, `response-time`, `safety-zones`, `isochrone` |
| **Terrain & 3D** | `terrain`, `buildings`, `daylight`, `projection`, `atmosphere`, `grid`, `deck`, `orbit` |

Placement calls worth stating explicitly (to remove ambiguity for the implementation
plan):
- `p1audio` and `autopan` are alerting *behavior* tied to live call activity, not a
  drawn overlay — grouped with Live Conditions rather than Units & Calls.
- `orbit` (cinematic camera animation) is a view/camera control, not a dispatch
  workflow tool — moved from the current `dispatch-tools` group into Terrain & 3D
  alongside the other camera/projection controls (`projection`, `atmosphere`).
- `district-*` and `geo-*` are boundary/reference overlays (district hierarchy,
  statewide GeoJSON overlays like property markers) — grouped with Boundaries.

### Right Dock — Info & Tools (3 sections)

Unlike the Left Dock, most of this content is **not** in `layerGroups` today — it's
separate always-rendered or floating components. This section lists the existing
component each dock section hosts, not toggle ids. (The Units/Calls roster now lives
in its own dock — see Structure above.)

**Correction from an earlier draft of this spec:** there is currently no live legend
on the Map tab. `UnifiedMapLegend.tsx` exists in the codebase but isn't imported or
rendered anywhere (confirmed dead — `client/src/pages/map/_ORPHANS.md` lists it as the
intended successor to two other dead legend components, and a repo-wide import search
found zero live usages). Per this redesign's non-goals (reorganize only, don't add new
capability), reviving it is **out of scope** — there's a three-section Right Dock
below, not four; no "Status" section, since there's nothing live to relocate into one.

| Section | Contents |
|---|---|
| **Dispatch Tools** | `directions`, `places`, `bookmarks`, `optimize` (multi-stop route planner) toggles, plus the existing `MapboxDispatchConnections` component |
| **Analysis** | `speed-analytics` (opens the existing `SpeedAnalyticsPanel`), `gps-replay` (opens the existing `GpsReplayTool`), `ruler`, `buffer-ring`, `annotation`, `draw-geofence` (each opens its existing floating tool component — `RulerTool`, `BufferRingTool`, `AnnotationTool`, `DrawGeofenceTool`) |
| **Diagnostics** | `identify`, `inspect` (Feature Inspector), `mapmatch` (Map Match Trace), plus the existing `MapDiagnosticsOverlay` component |

Note: items in Analysis and some in Dispatch Tools don't render their content *inside*
the dock — clicking them still opens the existing floating tool panel/component (e.g.
`RulerTool`, `GpsReplayTool`) over the map, exactly as today. Only the *toggle button*
moves into the dock; the tool's own UI is unchanged. This preserves each tool
component's existing internal implementation and tests — this redesign only moves
where its launcher renders, not how the tool itself works.

`snapshot` (Capture Snapshot / export) lives in the **top toolbar**, not a dock — it's
a viewport action, not a layer or a workflow tool.

### Responsive behavior

Below **1024px** viewport width (Tailwind `lg` breakpoint), all three docks collapse
into a single **bottom tabbed tray** with three tabs — "Roster," "Layers," and "Info &
Tools" — mirroring the same content as the desktop docks (the Roster tab reuses the
existing units/calls tabbed-list component unchanged). The tray is closed by default;
tapping a tab slides it up over the bottom of the map. The map canvas gets full width
in this mode. Above 1024px, all three docks are always visible in their fixed
positions (no user-facing toggle to hide them at desktop width).

### Component structure

New files under `client/src/pages/map/components/`:
- `MapTopToolbar.tsx` — search + map chrome + bookmarks + snapshot
- `MapRosterDock.tsx` — wraps the existing Units/Calls tabbed roster markup
  (`MapboxMapPage.tsx:1279-1332`) moved out into its own component, behavior unchanged
- `MapLeftDock.tsx` — the 5-section Layers dock (desktop width)
- `MapRightDock.tsx` — the 3-section Info & Tools dock (desktop width)
- `MapBottomTray.tsx` — the collapsed three-tab tray (narrow width), reusing the same
  section-rendering logic as the dock components rather than duplicating it (e.g. a
  shared `DockSection` presentational component the docks and the tray both render,
  and `MapRosterDock` itself reused verbatim as the tray's Roster tab content)

`MapboxMapPage.tsx` keeps all of its existing state/hooks exactly as they are — this
redesign only changes the JSX that renders each toggle's control, not the state or
logic behind it. The `layerGroups` array (or a re-bucketed equivalent under a new name,
since the grouping changes) still supplies the underlying toggle data; only its
consumer changes from the old single Layers Panel to the new dock/tray components.

### Rollout

One PR, full replacement — no feature flag, no incremental panel-by-panel migration.
Given the scale (five new components, every existing toggle re-plumbed, a new
responsive breakpoint), the implementation plan should still land this as multiple
small, testable commits/tasks internally — "one PR" describes the merge unit, not a
single undifferentiated change.

## Risks

- **Scale/regression risk**: ~50 toggles being re-plumbed in one page is a lot of
  surface area for something to be missed or mis-categorized. Mitigated by: reusing
  the exact same per-toggle data (id/label/color/description/active/onToggle) rather
  than rewriting toggle logic, and by this spec's explicit id-level section mapping
  above removing categorization guesswork from the implementation phase.
- **No incremental rollback**: since this is a big-bang single-PR replacement (explicit
  choice), a bug found post-merge means reverting the whole layout change, not a
  smaller piece of it. Accepted per the rollout decision above.
- **Existing floating-tool components** (`RulerTool`, `BufferRingTool`, `GpsReplayTool`,
  etc.) have their own existing tests (`client/src/pages/map/components/__tests__/`).
  Since only their *launcher* moves (not their internals), those tests should need no
  changes — worth confirming during implementation rather than assuming.
