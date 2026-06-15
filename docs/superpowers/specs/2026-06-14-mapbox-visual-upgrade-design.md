# Mapbox Visual Upgrade — Branded Basemap + Shared Markers

**Date:** 2026-06-14
**Status:** Approved (design)
**Scope:** Phase A+B of the map visual upgrade. Control-UI declutter (Phase C) is a deferred follow-up.

## Problem

Every map surface in the app (`MapPage`, `DispatchMiniMap`, `NavMapView`,
`SightingsMap`, `ForensicTrackMap`) renders a **stock Mapbox basemap**
(`mapbox://styles/mapbox/dark-v11` and friends) with **hand-rolled, per-surface
DOM markers**. Result: the maps look generic ("plain") and the markers are
visually inconsistent across surfaces ("messy"). Nothing on the map reflects the
pure-black / `#d4a017` gold Spillman theme used everywhere else in the app.

## Goals

1. **Branded basemap** across all five surfaces — pure-black land, near-black
   water (zero blue), muted roads with gold major arterials, decluttered POI
   labels, themed label typography.
2. **Consistent markers** across all five surfaces via a shared builder module.
3. **One shared seam** so the branding applies everywhere without rewriting each
   map, and survives runtime style switches (dark ↔ satellite ↔ light/print).

## Non-Goals (YAGNI)

- No Mapbox Studio custom style URL (runtime restyle only — no account/asset deps).
- No rewrite of MapPage's floating control overlays — that is **Phase C**, deferred.
- No new npm dependencies.

## Architecture

Two new shared modules under `client/src/utils/`, plus thin wiring per surface.

### 1. `mapboxBasemap.ts` — runtime basemap restyler

```ts
type BasemapVariant = 'dark' | 'satellite' | 'light';
export function applyRmpgBasemap(map: mapboxgl.Map, opts?: { variant?: BasemapVariant }): void;
```

- Runs on the map's `style.load` event (NOT `load`) so it re-applies every time
  the style is swapped.
- Walks the loaded style's layers and recolors by layer id/type. All
  `setPaintProperty` / `setLayoutProperty` calls are guarded (reuse the
  `mapboxSafeLayer.ts` defensive pattern) so a layer missing from a given stock
  style never throws.
- **Dark variant token map** (source of truth = `client/src/index.css` `:root`):
  - background / land → `#000000`; raised landuse → `#0b0b0b`
  - water → `#050608` (near-black, no blue)
  - roads: minor `#1a1a1a`, secondary `#262626`; motorway/trunk/primary casing
    `#d4a017` gold (thin)
  - admin / boundaries → `#232323`
  - road & place labels → gold `#d4a017` (major) / `#888888` (minor), `#000` halo
  - POI / noise labels → hidden (`visibility: none`)
- **Satellite variant** — leave imagery untouched; only restyle label/road
  overlays for legibility (gold roads, black halos).
- **Light variant** — minimal touch-ups for print legibility (used by the
  existing `printWithLightMaps` path); safe no-op if nothing applies.

### 2. `mapMarkers.ts` — shared marker builders

Pure functions returning a styled `HTMLElement` (no Mapbox coupling — caller wraps
in `new mapboxgl.Marker({ element })`). Themed once, reused everywhere.

```ts
buildUnitMarker(opts: { label?: string; status?: UnitStatus; heading?: number }): HTMLElement;
buildCallMarker(opts: { priority?: number | string; label?: string }): HTMLElement;
buildDotMarker(opts: { color?: string; size?: number; pulse?: boolean }): HTMLElement;
```

- Status → color mapping centralized (in-service green, busy/enroute gold,
  out-of-service neutral, etc.), pulled from theme tokens.
- Built with safe DOM methods (`createElement` + `textContent`, no `innerHTML`
  for user data) — matches the existing XSS-safe pattern in MapPage.
- Sizing/typography constants shared so every surface renders identical markers.

### 3. Per-surface wiring (thin)

For each of the five surfaces, in its map-init:

```ts
map.on('style.load', () => applyRmpgBasemap(map, { variant }));
```

and swap each surface's bespoke `createElement` marker block for the matching
`buildXMarker(...)` call. On `MapPage` the existing `setStyle` effect re-fires
`style.load`, so branding survives style switches with no extra code.

## Data Flow

`map init → style.load → applyRmpgBasemap walks layers → themed basemap`.
Markers: `surface data → buildXMarker() → new mapboxgl.Marker({ element })`.
No network, no state, no API changes. Purely client-side rendering.

## Error Handling

- Every paint/layout mutation in `applyRmpgBasemap` is wrapped so a missing or
  renamed stock layer is skipped silently (logged at debug only) — the restyler
  must never throw and blank the map.
- Marker builders are pure and total: missing/unknown status or priority falls
  back to a neutral default.

## Testing

- **vitest** for the pure marker builders (`buildUnitMarker` / `buildCallMarker` /
  `buildDotMarker`): correct status→color, priority→color, structure, and
  fallback behavior. (jsdom is fine — these return plain DOM nodes.)
- `applyRmpgBasemap` is integration-shaped (needs a live GL style); covered by
  manual verification in-browser across dark/satellite/light + the missing-layer
  guard making it safe.
- `npm run typecheck` (worker n/a) + `cd client && npx tsc --noEmit` + `npx vitest run` + `npx vite build`.
- Bump `CACHE_NAME` in `client/public/sw.js` (project rule — client change).

## Rollout

Feature branch → PR (per project PR-flow rule), CI runs pr-tests.yml, user merges,
deploy.yml ships Pages. No migrations, no Worker change, no secrets.
```

