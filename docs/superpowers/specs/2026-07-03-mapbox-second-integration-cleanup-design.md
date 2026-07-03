# Mapbox Second-Integration Cleanup + Real Gaps

**Date:** 2026-07-03
**Status:** Approved — ready for implementation
**Delivery:** split into 2 PRs (see Delivery below)

## Background

Yesterday's [2026-07-02 spec](2026-07-02-mapbox-integration-gaps-design.md) audited
the `useMapbox*.ts` hook family + `src/routes/mapbox.ts` server proxy and found it
"mature" — Directions, Matrix, Isochrone, Map Matching, Geocoding, Tilequery, Static
Images all work when called. That's true, but it only checked whether the API
capability *functions*, not whether the corresponding hook is actually mounted into
any page a user sees.

Today's audit checked the second question and found: a separate, newer integration
(`useMap*.ts` hooks, no "box", built 2026-06-27 + `client/src/services/mapboxApiService.ts`)
independently re-implements several of the same features and **is** the one wired
into `MapboxMapPage.tsx` today. The older `useMapbox*.ts` versions of those same
features were never mounted anywhere and have zero importers. Two parallel stacks
exist for the same capabilities; only one is visible to users.

This spec: (1) removes the confirmed-dead half of the older stack, (2) wires up the
genuinely-missing features that neither stack covers, (3) leaves alone what the
2026-07-02 spec already fixed correctly (already merged, PR #2544).

## Part 1 — Delete confirmed-dead duplicate hooks

Verified zero importers (`grep` by exact function name across `client/src`, not just
file path) **and** a confirmed live replacement elsewhere:

| Dead hook | Live replacement | Where |
|---|---|---|
| `useMapboxTraffic.ts` | `useMapTraffic.ts` | `MapboxMapPage.tsx` — diffed line-by-line, functionally identical (same `mapbox://mapbox.mapbox-traffic-v1` tileset, same congestion color match); the live one adds a casing layer and is the cleaner rewrite |
| `useMapboxHeatmap.ts` | `useMapHeatmap.ts` | `MapboxMapPage.tsx` |
| `useMapboxMapMatching.ts` | `useMapMatchTrace.ts` | `MapboxMapPage.tsx` |
| `useMapboxIsochrone.ts` | inline `mapboxApiService.mapboxIsochrone()` + `toggleIsochrone` | `MapboxMapPage.tsx` |
| `useMapboxMatrix.ts` | inline `mapboxApiService.findNearestUnits()` | `MapboxMapPage.tsx` |
| `useMapboxStaticMap.ts` | `useMapSnapshot.ts` (uses `mapboxApiService.mapboxStaticImageUrl`) | referenced for PDF/report map images |
| `useMapboxRoutes.ts` | `useMapRouting.ts` | `DispatchMiniMap.tsx` / `MapboxMiniMap.tsx` unit→call routing |
| `useMapboxGeocode.ts` | inline `MapboxGeocoder` plugin | `MapboxMapPage.tsx` |

**Explicitly NOT deleted** (verified live/intentional, re-confirmed against
yesterday's spec + git history):
- `useMapboxBoundaries.ts` — live, powers jurisdiction lookup on Warrants/Properties
  (`JurisdictionLookup.tsx`, built in PR #2544). Different purpose than RMPG's beat
  system by design (its own header comment says so).
- `useMapboxSearchBox.ts` — fixed in PR #2544, intentionally headless ("for custom
  search panels" per its own header comment), not meant to have a map-page toggle.
- `useMapboxDraw.ts` — live, wired into `MapboxMapPage.tsx` (`glDraw`).
- `useMapboxTilequery.ts`, `useMapboxIncidents.ts`, `useMapboxCoverageGaps.ts`,
  `useMapboxSafetyZones.ts`, `useMapboxHistoryCalls.ts`, `useMapboxRepeatAddresses.ts`
  — genuine gaps, built in Part 2 below.

## Part 2 — Build the real gaps

All new overlays register in the existing `MapOverlaysPanel` group structure on
`MapboxMapPage.tsx` (`tactical`/`history`/`tools` groups already exist with icons
pre-imported for exactly this: `Shield`, `AlertTriangle`, `History`, `MapPin`).

### 2a. Incidents layer

**Bug found:** `useMapboxIncidents.ts` does `Array.isArray(data) ? data : []` on
the response from `GET /api/incidents?days=&limit=`, but that route returns
`{ data: [...], pagination: {...} }` (confirmed by reading `src/routes/incidents.ts`
— its own code comment warns about this exact envelope). The hook would silently
render zero incidents forever.

**Fix:**
- Client: read `data?.data` instead of assuming a bare array; drop the unsupported
  `days` query param (server has no date filter on `/api/incidents`, only
  `status`/`officer_id`/`page`/`limit` — passing `days` is a harmless no-op, but
  don't imply filtering that doesn't happen; use `limit` only, sorted by
  `created_at DESC` server-side already).
- Verify `incidents` table actually has non-null `latitude`/`longitude` on a
  meaningful fraction of live rows before shipping (the hook already filters rows
  missing coordinates, so worst case is a sparse layer, not a crash).
- Wire a "Incidents" toggle into the `tactical` group, calling `fetchIncidents()`
  on enable.

### 2b. Coverage Gaps layer

Fully self-contained (grid computation client-side, only dependency is the
already-live `GET /dispatch/units`). No server work needed.

- Wire a "Coverage Gaps" toggle into the `tactical` group.
- On enable, call `computeCoverage(map.getBounds())` using the current viewport;
  recompute on `moveend` while the layer is active (debounced, since it's an
  O(cells × units) scan) so panning the map keeps the overlay accurate.

### 2c. Safety Zones layer

Endpoint already live (`GET /dispatch/heatmap?mode=risk`, verified in
`src/routes/dispatch/aggregates.ts`). No server work needed.

- Wire a "Safety Zones" toggle into the `tactical` group.

### 2d. History Calls layer

Endpoint already live (`GET /dispatch/history-map`, verified in
`src/routes/dispatch/aggregates.ts`, supports `days`/`limit`/`status`/`types`/
`priority` filters). No server work needed.

- Wire a "Call History" toggle into the `history` group, with a simple days-back
  control (default 30, matching the hook's default) rather than exposing every
  filter param — status/type/priority filtering can be a follow-up if requested.

### 2e. Tilequery ("Identify") tool

`DispatchToolPanel.tsx` (geocode+isochrone+matrix+tilequery tabs) exists fully
built but has zero importers anywhere — nobody mounts it. Three of its four tabs
(geocode, isochrone, matrix) would duplicate features already live via the
`useMap*`/`mapboxApiService` stack. Mounting the whole panel would ship three
redundant UIs.

**Decision:** do not mount `DispatchToolPanel.tsx`. Instead, build one small
standalone "Identify" click-tool using only `useMapboxTilequery.ts` (the one tab
that has no live equivalent anywhere) — click the map, get back place/district/
sector info at that point via the Mapbox Tilequery API.

- Wire an "Identify" toggle into the `tools` group. When active, a map click calls
  `tilequeryQuery(lng, lat)`; show the result in a small popup at the click point
  (reuse the existing popup styling conventions in `MapboxMapPage.tsx`, not a new
  component).
- `DispatchToolPanel.tsx` stays as unreferenced dead code for this PR — flagging it
  for a follow-up cleanup task rather than deleting it now, since deleting a
  fully-built component is a separate, lower-urgency decision than deleting the
  8 zero-value duplicate hooks in Part 1.

### 2f. Repeat Addresses layer (needs new backend route)

**Gap:** `useMapboxRepeatAddresses.ts` calls `GET /dispatch/repeat-addresses`,
which does not exist anywhere in `src/routes/dispatch/`.

**New route** — add to `src/routes/dispatch/aggregates.ts` (bare `/api/dispatch`
mount, consistent with `/heatmap` and `/history-map` already there):

```
GET /dispatch/repeat-addresses?days=30&min_count=3&limit=200
```

- Group `calls_for_service` rows by normalized `location_address` (or rounded
  lat/lng where address is null) within the `days` window.
- `HAVING COUNT(*) >= min_count`, `ORDER BY COUNT(*) DESC LIMIT limit`.
- Return shape matching the hook's expectation:
  `{ addresses: [{ address, latitude, longitude, count, ...}], total }`.
- Follows the existing `parseUtcMs`/D1-timestamp conventions already in
  `aggregates.ts` for date filtering.
- Apply the migration-less route directly (no schema change — this is a read-only
  aggregate query over existing columns).

- Client: wire a "Repeat Addresses" toggle into the `history` group once the route
  exists.

## Delivery

Two PRs to keep review scope sane:

1. **Cleanup PR** — delete the 8 dead hooks (Part 1). Zero behavior change (nothing
   imports them), low-risk, fast to review.
2. **Features PR** — Part 2a-2f: fix Incidents envelope bug, wire 5 new overlay
   toggles, add the `repeat-addresses` backend route. One PR since they share the
   same `layerGroups` useMemo edit in `MapboxMapPage.tsx` and reviewing that diff
   in pieces would be more confusing than reviewing it whole.

## Testing

- Worker: typecheck (no test harness exists yet per CLAUDE.md); manual
  `wrangler d1 execute --local` sanity query for the new `repeat-addresses` SQL
  before wiring the client to it.
- Client: typecheck + existing vitest suite (no new component logic complex enough
  to warrant new tests beyond what exists — these are toggle wires over
  already-tested hooks, except the Incidents envelope fix which is a one-line
  logic change worth a quick manual check).
- Manual verification via `npm run dev` + Chrome preview on `/map`:
  1. Toggle each of the 5 new overlays on/off, confirm they render and clear
     cleanly (no orphaned Mapbox layers/sources left after toggle-off).
  2. Confirm Incidents layer shows real clustered points (not empty).
  3. Confirm Coverage Gaps recomputes on pan while active.
  4. Confirm Repeat Addresses returns real repeat-call clusters for a known busy
     property.
  5. Confirm the cleanup PR's deletions don't break `npx tsc --noEmit` (no stray
     imports anywhere — already verified none exist).

## Out of scope

- Mounting `DispatchToolPanel.tsx` — flagged as dead code, left for a future
  decision (delete vs. repurpose for Identify-only use).
- Status/type/priority filter UI for the History Calls layer — ships with a
  days-back control only; richer filtering is a follow-up if requested.
- Any change to `useMapboxBoundaries.ts`, `useMapboxSearchBox.ts`,
  `useMapboxDraw.ts` — all confirmed live/correct as-is.
- Re-auditing the rest of the ~50 `useMapbox*` surface named in yesterday's spec —
  this pass only covers hooks touched by today's "fix all Mapbox functions"
  request; Directions/Optimization/PMTiles etc. were not re-checked since nothing
  today suggested they're broken.
