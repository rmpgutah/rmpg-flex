# Map Tab Hardening & Modernization — Design

**Date:** 2026-07-26
**Status:** Approved (design), pending implementation plan
**Branch:** `claude/map-tab-ui-icons-c436d4`

## Problem

The Map tab is functionally deep but presentationally dated and hard to navigate.
Concretely, as measured in the current tree:

- [`MapboxMapPage.tsx`](../../../client/src/pages/map/MapboxMapPage.tsx) is 1,893 lines and
  orchestrates ~60 hooks. Roughly 120 of those lines are the same
  `{ id, label, active, onToggle }` object literal retyped across ten separate
  section arrays.
- **55 layer toggles** live in 10 dock sections (Live Conditions, Units & Calls,
  Historical Analysis, Administrative Boundaries, Risk & Coverage, Terrain & 3D,
  Dispatch Tools, Measurement & Marking, Drawing & Tracking, Diagnostics).
  **46 are hand-written literals; 9 are generated at runtime** — the Administrative
  Boundaries section is `.map()`ed from `HIERARCHY_CONFIGS` (3 entries, in
  [`useDistrictHierarchyLayers.ts:33`](../../../client/src/hooks/useDistrictHierarchyLayers.ts:33))
  and `GEO_LAYER_CONFIGS` (6 entries, in
  [`useGeoJsonLayers.ts`](../../../client/src/hooks/useGeoJsonLayers.ts)), producing ids of
  the form `district-<id>` and `geo-<id>`.
- **Three labels are computed, not static:** `Crime Heatmap (Live|Historical)`,
  `Projection: <mode>`, and `Atmosphere: <preset>` interpolate live state into the
  label text.
- Four toggles hardcode `#d4a017`, which CLAUDE.md **bans** in the blue-silver block:
  it fails WCAG AA on navy (4.50 / 3.57 / 5.41) and is the worst match to
  `--sev-warn #f59e0b`, making decorative gold confusable with a real alert.
- Toggles render as a 6 px colored dot plus a text label
  ([`DockSection.tsx`](../../../client/src/pages/map/components/DockSection.tsx)).
  **There are no per-layer icons anywhere.**
- There is no way to search, filter, favorite, or see at a glance which layers are
  currently active. A collapsed section hides its own active state.
- Toggle rows have no `focus-visible` treatment and no switch semantics, so they are
  effectively unreachable by keyboard.
- [`MapTopToolbar.tsx`](../../../client/src/pages/map/components/MapTopToolbar.tsx) is six
  icon buttons plus a raw unstyled `<select>` for basemap choice.
- Unit markers use a single hardcoded inline SVG glyph with a literal `#0d1520`
  ([`mapMarkers.ts:72`](../../../client/src/pages/map/utils/mapMarkers.ts:72)), which escapes
  the theme system.
- [`MapBottomTray.tsx`](../../../client/src/pages/map/components/MapBottomTray.tsx) (the
  sub-1024 px path) reuses the desktop rows verbatim, so a touchscreen user gets 11 px
  labels and ~24 px targets.

## Audience

All four audiences are in scope and were confirmed as such:

| Audience | Context | Implication |
|---|---|---|
| Dispatcher | Desktop, mouse + keyboard, large monitor | Maximum density, keyboard shortcuts |
| Officer | Toughbook touchscreen, in-vehicle, gloves, glare | 44 px targets, high contrast, `.tactical-dark` |
| Officer | Phone, one-handed | Bottom tray must be genuinely usable, not a squeezed dock |
| Supervisor | Post-hoc review | Replay, breadcrumbs, coverage timeline, snapshot/PDF export |

The dispatcher and Toughbook cases pull in opposite directions on density. That
conflict is resolved by making density an explicit, switchable mode rather than a
breakpoint side effect.

## Decisions

1. **Layer registry over ad-hoc arrays.** A single declarative source of truth for all
   43 layers. Chosen over restyling in place because every findability feature
   (search, favorites, active-layers summary, legend) would otherwise need bespoke
   wiring against ten separate arrays. Chosen over a command-palette-first rebuild
   because a persistent dock is the only design that serves a moving-vehicle
   Toughbook user, who cannot type.
2. **Density: auto-detect with manual override.** Default from the `(pointer: coarse)`
   media query, overridable by an explicit toolbar control, persisted through the
   existing [`mapPreferences.ts`](../../../client/src/utils/mapPreferences.ts).
3. **Icons: `lucide-react`, curated per layer.** Already the app's icon library — no new
   dependency, consistent stroke weight, tree-shaken. One hand-picked icon per
   registry entry.
4. **No new dependencies** in any phase.
5. **Phased PRs, foundation first.** Each PR independently reviewable and safe to stop
   after. PR 1 intentionally ships no visible change; this cost was raised explicitly
   and accepted.

## Architecture

### Seam 1 — `client/src/pages/map/config/layerRegistry.ts`

```ts
export interface MapLayerDef {
  id: string;                 // stable id, matches the page's toggle binding
  label: string;              // may be overridden per-render by a binding
  icon: LucideIcon;
  group: MapLayerGroup;       // one of the 10 existing section titles
  colorVar: string;           // CSS variable name, never a literal hex
  description: string;
  pinned?: boolean;           // safety-critical: renders the left-border accent
  capability?: string;        // reserved for future role gating; unused in PR 1
}
```

**Dynamic entries.** The registry is not purely static. The Administrative Boundaries
group's 9 entries are derived at module load from the same `HIERARCHY_CONFIGS` and
`GEO_LAYER_CONFIGS` arrays the page already consumes, so the registry cannot drift from
them. Only presentation metadata absent from those configs — icon and `colorVar` — is
supplied by the registry, keyed by config id.

**Label overrides.** Three toggles interpolate live state into their label. A binding
may therefore supply an optional `label` that wins over the registry's static one; the
registry value remains the fallback and the searchable/canonical name.

`MapboxMapPage` continues to own *state* — `active`, `onToggle`, `loading`, `error`,
and any label override — and binds it to registry entries through a `useLayerBindings()`
adapter that produces the `DockToggleItem[]` the renderers already consume. Presentation
metadata moves out of the page; behavior stays in it.

Three renderers over one source: `MapLeftDock` (desktop), `MapBottomTray` (mobile), and
the new active-layers summary. `UnifiedMapLegend` becomes a fourth in PR 4.

### Seam 2 — `MapDensityContext`

`'compact' | 'touch'`, exposed via `useMapDensity()`. Default resolves from
`(pointer: coarse)`; an explicit user override wins and persists. Because density is a
context value rather than a `lg:` class, the mobile tray and the desktop dock share one
sizing implementation instead of diverging.

| Token | compact | touch |
|---|---|---|
| Row min height | `py-1.5` (~24 px) | `min-h-[44px]` |
| Label size | 11 px | 13 px |
| Icon size | 14 px | 18 px |

### Non-goals

- **Mapbox paint properties keep their literal hex.** Per CLAUDE.md, `var()` blanks a
  Mapbox GL map, and `MAP_PALETTE` in
  [`mapboxBasemap.ts`](../../../client/src/utils/mapboxBasemap.ts) is deliberately fixed
  across all four themes. The hex cleanup in PR 1 applies only to DOM-rendered glyphs
  in `mapMarkers.ts` and to component-level fallbacks, never to paint modules. The
  `audit-hex.mjs` classifier already encodes this distinction by path.
- No changes to `.tactical-dark`'s intentionally near-black fixed values.
- No role-based layer gating (the `capability` field is reserved, not implemented).

## Phases

### PR 1 — Foundation & hardening

No visible feature change. This is the enabling refactor.

- Extract all 55 toggles into `layerRegistry.ts` — 46 static entries plus the 9
  derived Administrative Boundaries entries; `MapboxMapPage` sheds ~120 lines.
- Add `MapDensityContext` + `useMapDensity()`, persisted through the existing generic
  `loadMapPref` / `saveMapPref` helpers in `mapPreferences.ts` (no new storage
  plumbing needed).
- Rewrite `DockToggleRow`: leading lucide icon, density-aware sizing, `role="switch"`
  with `aria-checked`, and a real `focus-visible` ring.
- Replace every raw hex in the toggle data with a theme variable, including the four
  banned `#d4a017` uses. Route `#0d1520` (`mapMarkers.ts`) and the `#ef4444`
  `--sev-critical` fallback through theme variables.

**Tests:** registry↔page completeness (every bound toggle id resolves to exactly one
registry entry; every entry has an icon and a `colorVar`); a guard that no registry
entry carries a literal hex; density hook resolution and override precedence;
`DockToggleRow` switch semantics and focus behavior.

### PR 1b — Style-reload safety audit *(independent; can land before or after PR 1)*

There are **37** `map.addSource` call sites across the map tree and only 17 files use
the `whenStyleReady` guard from
[`safeAddSource.ts`](../../../client/src/pages/map/utils/safeAddSource.ts). Auditing all
37 is its own reviewable unit of work and was deliberately split out of PR 1 — bundling
a 37-site audit into the registry refactor would make the registry diff unreviewable.
Each fix re-adds sources in their original order to preserve z-order.

### PR 2 — Findability

- Filter box in the dock header, filtering across all groups, navigable with `↑`/`↓`
  and `Enter`.
- Favorites (pin) and Recents, persisted, surfaced as a synthetic top group.
- **Active Layers bar**: a count chip opening a popover that lists every active layer
  with an individual dismiss control, plus Clear All.
- Collapsed group headers carry an active-count badge, so a collapsed section can
  never hide active state.
- The mobile tray inherits all of the above with no additional work, because it renders
  from the same registry.

### PR 3 — Map functions & on-map icons

- Marker system: unit glyphs varying by type and status, call pins by priority, a
  selected-state halo, and styled clusters with counts — replacing the single
  hardcoded glyph.
- A unified themed popup component, dismissible with Escape.
- Toolbar rebuild: replace the raw `<select>` with a styled basemap picker including
  thumbnails; group buttons with tooltips; add the density toggle; add a `?` shortcuts
  overlay wired to the existing `useMapKeyboardShortcuts` hook.
- Performance: memoize the derived section arrays and guard layer add/remove churn when
  many layers toggle in quick succession.

### PR 4 — Polish

- Dock and tray expand/collapse transitions plus marker enter animation, all gated on
  `prefers-reduced-motion`.
- `UnifiedMapLegend` reads the registry instead of maintaining its own parallel list.
- Standardized empty, loading, and error states across dock sections.

## Risks

| Risk | Mitigation |
|---|---|
| The 55-toggle registry extraction is a hand-written 1:1 mapping and could silently drop or mis-bind a layer — most acutely the 9 runtime-derived boundary entries. | Keep the extraction mechanical (no behavior edits in the same commit); derive the boundary entries from the same config arrays the page uses so they cannot drift; gate with the completeness test, landing in the same PR. |
| Density changes could regress the dispatcher's information density. | `compact` remains the desktop default and matches current sizing exactly; `touch` is additive. |
| Theme-variable routing could hit a variable that is undefined in one of the four theme blocks, silently dropping the color. | Follow the existing `accentTokens.test.ts` theme-block-completeness pattern for any new variable. |
| A style-reload fix could change layer z-order. | Audit only; each fix re-adds in the original order and is verified in the browser preview. |

## Verification

Each PR must pass, before it is considered done:

- `npm run typecheck` (Worker) — expected clean
- `cd client && npx tsc --noEmit` — expected clean
- `cd client && npx vitest run` — **full suite**, not targeted runs
- `cd client && npx vite build`
- Browser verification of the Map tab at desktop and mobile viewports, in both density
  modes, with a screenshot attached to the PR.

The client baseline is clean as of 2026-07-24 (0 typecheck errors, 443 files /
3,101 tests passing), so any failure is caused by the change and is a hard stop.
