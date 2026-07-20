# Map Tab Visual Consistency & Dock Reorganization

**Date:** 2026-07-20
**Status:** Approved, pending implementation plan

## Context

Following the Map tab docked-panes redesign (PR #2859) and its follow-up fix (PR #2861),
a three-angle audit (visual/styling consistency, hook/feature completeness, dock
organization/findability) surfaced 38 grounded findings across six categories. The user
selected two of those categories to act on now:

- **D — Visual consistency**: the docked layout introduced a new styling convention
  (token-backed surfaces, 2px radius, `PanelTitleBar` headers), but five older floating
  tool panels and `MultiStopRoutePanel` still use an older convention, now sitting
  directly next to the new docks.
- **E — Dock organization**: the toggle taxonomy built during the redesign has real
  findability problems — an oversized "Boundaries" section (14 items), unclear tool
  naming, and items filed in sections that don't match how they're actually used.

Two items required investigation before design (both resolved with the user):
- The three drawing tools (Draw Shapes / GL Draw / Draw Geofence) are **not**
  redundant — each does something genuinely different (quick session-only shapes vs.
  precision vertex-editing vs. backend-persisted named geofence zones). Keep all
  three, rename for clarity.
- Measure and Ruler **are** redundant — Measure (distance + area) is a strict superset
  of Ruler (distance only, a separate implementation). Ruler is removed.

## Non-goals

This spec covers **only** categories D and E from the audit. The following findings
were explicitly **not** selected and must not be touched by this work, even where they
sit in the same file or section being edited here:
- **Category A (real bugs)**: `MinimapControl`'s `fixed`-positioning overlap with the
  Right Dock; the duplicate "Beats"/"Beat Boundaries" toggle pair (two different data
  sources, confusingly similar labels — this spec reorganizes *around* the duplicate,
  it does not merge or fix it); the dead `(G)` keyboard shortcut hint; the
  `MultiStopRoutePanel`/dock breakpoint mismatch (768px vs. 1024px); the "Bookmarks"
  naming collision between the dock item and the toolbar item; `SpeedGraphOverlay`'s
  silent empty state.
- **Category B (orphaned features)**: `GpsHud`, `UnifiedMapLegend`,
  `MapboxDispatchConnections`, `MapDiagnosticsOverlay`, the snapshot gallery,
  `useMapOptimization`, `useMapInfoPanel`, `useMapPrintExport` — none of these get a
  UI entry point in this pass.
- **Category C (dead code cleanup)** and **Category F (error handling / logging /
  type-cast cleanup)** — untouched.

No new capability is added anywhere in this spec — every change either restyles
existing UI, renames/relocates existing toggle entries, or removes one confirmed-
redundant tool (Ruler). The underlying map behavior each toggle controls is unchanged.

## Design

### D1. Restyle five legacy floating tool panels

`BufferRingTool.tsx`, `AnnotationTool.tsx`, `NavOverlayTool.tsx`, `DrawGeofenceTool.tsx`,
`GpsReplayTool.tsx` currently share an older convention: `className="tactical-dark
border border-surface-raised rounded p-3 ... shadow-lg"`, hand-rolled header rows, and
text-button (`"Done"`/`"Close"`/`"Cancel"`) or `✕`-glyph close controls.

Target convention, matching `MapTopToolbar.tsx`/`DockSection.tsx`/the new docks:
- Outer container: `bg-surface-raised/95 border border-border-default backdrop-blur-sm`,
  `style={{ borderRadius: 2 }}` (not `rounded`, which renders 4px and isn't caught by
  the app's `!important` 2px override — that override only covers `rounded-lg/xl/2xl/3xl/md`).
- Header: replace the hand-rolled title row with the existing `PanelTitleBar` component
  (`client/src/components/PanelTitleBar.tsx`), already used elsewhere in this app
  (`MapOverlaysPanel` used it before being deleted; `DispatchToolPanel`, dead code, also
  uses it) — same title/icon/status-LED/close-button pattern, no new component needed.
- Close control: `PanelTitleBar`'s built-in `onClose` prop (renders a Lucide `X`),
  replacing whatever bespoke close affordance each panel currently has.

This is a pure restyle — no prop interface, state, or map-drawing logic changes in any
of these five files. `RulerTool.tsx` is deleted, not restyled (see E2).

### D2. Rewrite `MultiStopRoutePanel` off inline styles

Currently 100% CSS-in-JS (`style={{}}`) with `const GOLD = '#d4a017'` and `const
PANEL_BG = 'rgba(10,10,10,0.96)'` (pure black, contradicting the Blue & Silver "navy
not black" rule and the retired gold accent). Convert to the same token classes as D1
(`bg-surface-raised/95`, `border-border-default`, 2px radius) and drop the two
hardcoded constants. This file's actual routing-queue logic (unit selection, stop
list, optimize call) is unchanged.

### D3. Fix scattered hardcoded hex in live code paths

- `MapboxMapPage.tsx` — Measure dropdown's active-state color (`text-[#3b82f6]`) →
  `text-brand-gold-500`, matching the Draw dropdown's already-correct token two lines
  away in the same file.
- `MapboxMapPage.tsx` — Active Route Panel's ETA text color (`text-[#22c55e]`) → a
  token consistent with its tokenized siblings in the same panel.

Colors inside the `mapLeftDockSections`/`mapRightDockSections` config array (the ~30
hex values identifying each toggle's on-canvas layer color) are **not** touched — those
plausibly mirror real per-layer paint colors, a defensible reason to hardcode, and are
explicitly called out in CLAUDE.md as a known, large, separately-tracked cleanup tail.

### D4. Normalize the z-index scale

Current live scale: docks/status bar `z-20`, most floating-tool wrappers `z-30`,
self-positioned panels `z-40`. Three components use unexplained outliers:
`MultiStopRoutePanel` (`z-[1001]`), `UnifiedMapLegend` (`z-[900]` — dead code, not
touched by this spec since it's category B, but noted for completeness),
`StreetViewLightbox` (`z-[3000]`). Renumber `MultiStopRoutePanel` into the existing
20/30/40 scale (`z-30`, matching its sibling floating tools) as part of its D2 rewrite.
`StreetViewLightbox`'s `z-[3000]` is a legitimate full-screen modal that must render
above everything — leave it as the deliberate outlier it is.

### D5. Loading-indicator visibility

- `DockSection.tsx`'s `DockToggleRow` loading state (a 6×6px pulsing dot appended after
  the label) — used by ~10 layer toggles — gets a slightly larger, more noticeable
  treatment (e.g. a small spinner icon instead of a static dot, or a dimmed/skeleton
  row state), while staying compact enough for a 220px-wide dock column.
- `SpeedAnalyticsPanel.tsx`'s `text-[8px]` "loading…" string increases to a legible
  size (e.g. `text-[10px]`, matching the app's other small-text conventions) or gets an
  icon treatment consistent with the dock fix above.

### E1. Rename the three drawing tools

No functional change — only `label`/`description` text in the relevant
`mapRightDockSections` entries:
- `draw` ("Draw Shapes") → **"Quick Draw"**, description clarifies "session-only —
  not saved" to differentiate from the geofence tool.
- `gl-draw` ("GL Draw") → **"Draw & Edit"**, description clarifies "vertex editing —
  select and reshape existing shapes."
- `draw-geofence` ("Draw Geofence") → **"Create Geofence Zone"**, description
  clarifies "saves a named alert/exclusion zone."

### E2. Remove Ruler

Delete `RulerTool.tsx` and its `__tests__` file, remove the `ruler` entry from
`mapRightDockSections`, remove the `activeFloatingTool === 'ruler'` mount block and the
`RulerTool` import from `MapboxMapPage.tsx`. Measure (already present, does distance +
area) is the sole remaining measurement tool going forward.

### E3. Merge "Point-to-Point Route" into Dispatch Tools, next to Directions

`nav-overlay` ("Point-to-Point Route" — draw a route between two typed coordinates)
currently lives in the Right Dock's Analysis section; `directions` ("Directions" —
live point-to-point routing engine) lives in Dispatch Tools. Move `nav-overlay` to sit
immediately after `directions` in Dispatch Tools. Rename `directions` to **"Live
Directions"** and `nav-overlay` to **"Manual Route"** so the distinction (routing
engine vs. typed-coordinate route) is explicit rather than implied by two
near-identical labels.

### E4. Move "Response Time by Beat" into Historical Analysis

Currently filed under Boundaries despite its own description already saying
"(historical)". Move the `response-time` entry into the Historical Analysis section,
alongside Crime Heatmap / Call History / Speed Heatmap / Speed Violations / Pursuit
Tracks — all thematically the same kind of content.

### E5. Move "Identify" into Dispatch Tools

`identify` ("click the map for place/district info") is a routine lookup action, not a
diagnostic/dev tool. Move it out of Diagnostics into Dispatch Tools, alongside Places
Search (a similar "look something up on the map" action). Diagnostics keeps Feature
Inspector and Map Match Trace only — both genuinely dev/technical tools.

### E6. Move "GPU Overlay" into Diagnostics

`deck` ("GPU Overlay: Deck.gl accelerated") is a rendering-backend switch with no
directly visible effect for the end user — closer in kind to Feature Inspector than to
its current Terrain & 3D section-mates (which are all visually obvious map chrome:
terrain, buildings, day/night, projection, atmosphere). Move into Diagnostics.

### E7. Split "Boundaries" into two sections

Current Boundaries section has 14 items (far more than any other section) after the
static entries (Beat Boundaries, Coverage Gaps, Response Time [moving out per E4],
Safety Zones, Response Zones) plus 3 dynamic district-hierarchy items plus 6 dynamic
GeoJSON items. Split into:
- **Administrative Boundaries**: Beat Boundaries, the "Beats" GeoJSON duplicate (left
  as-is per Non-goals), all `district-*` items (Area/Sector/Zone), all `geo-*` items
  (State Boundary, Counties, Municipalities, Highways, Places).
- **Risk & Coverage**: Coverage Gaps, Safety Zones, Response Zones (isochrone). (Only
  3 static items post-split, but this is intentional — it's a distinct analytical
  category from administrative geometry, not padding for its own sake.)

### E8. Split "Analysis" into two sections

After E2 (Ruler removed) and E3 (nav-overlay moved out), Analysis has 8 remaining
items. Split into:
- **Measurement & Marking**: Measure, Buffer Ring, Annotations.
- **Drawing & Tracking**: Quick Draw, Draw & Edit, Create Geofence Zone, GPS Replay,
  Speed Analytics Panel.

### E9. Elevate the three safety-critical toggles

P1 Audio Alert, Auto-Pan P1, and Geofence Zones (all in Live Conditions) get a distinct
visual treatment — a colored left-border accent on their `DockToggleRow` (not present
on ordinary toggles) — and the Live Conditions `DockSection` becomes permanently
expanded (its accordion collapse control is removed for this one section only; the
other four Left Dock sections and all three Right Dock sections keep their normal
collapsible behavior). This keeps these three settings glanceable at all times without
reintroducing a duplicate access point elsewhere (e.g. the Top Toolbar), which is
exactly the kind of redundancy the original redesign eliminated.

## Files touched

- Restyled: `client/src/pages/map/components/BufferRingTool.tsx`,
  `AnnotationTool.tsx`, `NavOverlayTool.tsx`, `DrawGeofenceTool.tsx`,
  `GpsReplayTool.tsx`, `MultiStopRoutePanel.tsx`
- Deleted: `client/src/pages/map/components/RulerTool.tsx` +
  `__tests__/RulerTool.test.tsx` (if present)
- Modified: `client/src/pages/map/components/DockSection.tsx` (loading-indicator
  treatment, optional non-collapsible-section support for E9)
- Modified: `client/src/pages/map/components/SpeedAnalyticsPanel.tsx` (loading text size)
- Modified: `client/src/pages/map/MapboxMapPage.tsx` (all `mapLeftDockSections`/
  `mapRightDockSections` re-bucketing and renames from E1, E3–E8; Ruler removal
  wiring from E2; the two hardcoded-hex fixes from D3)

No changes to any hook, any map-layer logic, or any file outside
`client/src/pages/map/`.

## Risks

- **Scope discipline against adjacent bugs.** Several Non-goal items (duplicate Beats,
  Bookmarks naming collision, MinimapControl overlap) live in the exact sections/files
  this spec touches. The implementation plan must be explicit that these are seen and
  deliberately not fixed here, so a future contributor doesn't assume they were missed.
- **`PanelTitleBar` prop compatibility.** D1 assumes `PanelTitleBar` (already used
  elsewhere in the app) can absorb all five panels' existing header content (title text,
  optional status indicator, close button) without needing new props — this should be
  confirmed against the component's actual interface during planning, not assumed.
- **E9's non-collapsible section is a new interaction pattern** for `DockSection` (every
  other section is collapsible) — worth a quick explicit confirmation in the
  implementation plan that this is implemented as an opt-out flag on the shared
  component (e.g. `collapsible?: boolean`, default `true`) rather than a one-off fork.
