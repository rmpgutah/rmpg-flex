# Mapbox Integration Gap Fixes

**Date:** 2026-07-02
**Status:** Approved — ready for implementation
**Delivery:** 1 PR

---

## Overview

RMPG Flex already has a mature Mapbox integration — Directions, Matrix, Isochrone,
Map Matching, Optimization v1, Geocoding v5 (forward/reverse), Tilequery, Static
Images, PMTiles vector tiles, and GL JS core are all fully wired (server proxy in
[`src/routes/mapbox.ts`](../../src/routes/mapbox.ts) + ~50 client hooks under
`client/src/hooks/useMapbox*.ts`). An audit found the request to "add all potential
Mapbox integrations" doesn't hold up — most of the surface is already built, and one
commonly-suggested addition (a standalone traffic-incidents API) doesn't exist as a
Mapbox product. This spec covers the three real gaps found: a broken hook, an
unverified feature, and one genuinely new capability.

## Scope

### 1. Fix the Search Box hook (bug fix)

**Problem:** [`useMapboxSearchBox.ts`](../../client/src/hooks/useMapboxSearchBox.ts)
calls `apiFetch('/mapbox/geocode/forward?...')`, but the real server route is
`GET /api/mapbox/geocode` (no `/forward` suffix) — every call 404s and the hook
silently returns an empty result set. The hook also sends `country` and `proximity`
query params that the server route ignores.

**Fix:**
- Server: extend `GET /api/mapbox/geocode` in `src/routes/mapbox.ts` to forward
  `proximity` (lng,lat) and `country` params to the upstream Mapbox Geocoding v5
  call (both are already-supported Geocoding v5 params — this is passthrough only,
  no new upstream capability).
- Client: point `useMapboxSearchBox.ts` at `/mapbox/geocode` instead of
  `/mapbox/geocode/forward`, and pass `proximity`/`country` through as query params.
- No new dependency. Stays on the existing token-protected server-proxy pattern
  rather than pulling in the unused `@mapbox/search-js-react` package referenced
  only in a comment.

### 2. Verify the traffic congestion layer (verification, not new code)

**Problem:** [`useMapboxTraffic.ts`](../../client/src/hooks/useMapboxTraffic.ts)
adds the `mapbox.mapbox-traffic-v1` vector tileset but wraps `addSource`/`addLayer`
in a try/catch that only `console.warn`s on failure — silent even if the account
tier lacks traffic tile access. Nobody would notice today if this layer is dead.

**Fix:**
- Start the dev server, enable the traffic layer on a map page, and check
  Network/Console for a real 200 with vector tile payloads vs. a swallowed
  403/404.
- If it works: no code change needed, just confirmation.
- If it's silently failing: surface that status to the UI — e.g. disable the
  traffic toggle control with a tooltip explaining the account lacks access —
  instead of a toggle that looks live but renders nothing.

There is no separate "traffic incidents" API to build against — Mapbox does not
sell a standalone accidents/construction/closures feed. The congestion tileset is
the full extent of what Mapbox offers here.

### 3. Jurisdiction/county lookup via Boundaries API (new, gated feature)

**Problem:** Beat/zone/sector assignment is already a fully custom system —
RMPG's own geofence polygons stored in D1 (`dispatch_sectors`/`_zones`/`_beats`,
719 beats), resolved via `identifyBeat()` in
[`src/utils/geofence.ts`](../../src/utils/geofence.ts) and
[`src/utils/districtResolver.ts`](../../src/utils/districtResolver.ts). Mapbox's
Boundaries API only knows generic administrative boundaries (city/county/state/
zip/congressional district) — it cannot replace or feed the beat system, and this
spec does not attempt that.

What it's useful for instead: resolving which **county/municipality** an address
falls in, for cross-jurisdiction handoffs on cases, warrants, and properties.

**Access is unconfirmed** — Boundaries API is a paid Mapbox add-on and there is no
local token to test against. The first implementation step is a live call against
the production token (via `wrangler secret` / existing `MAPBOX_ACCESS_TOKEN`
config) to confirm access before building UI on top of it.

**Fix:**
- New server route `GET /api/mapbox/boundaries?lng=&lat=` in `src/routes/mapbox.ts`,
  following the same shape as the existing `/tilequery` route. Calls Mapbox
  Boundaries API for the coordinate, returns county/municipality/zip/place.
- Gated with the existing `notConfigured()` helper
  ([`src/utils/notConfigured.ts`](../../src/utils/notConfigured.ts)) — same pattern
  used for `ROBOFLOW_API_KEY`/`FLEETIO_*`. If the token 403s on Boundaries, the
  route returns `{ ok: false, skipped: true, code: 'not_configured' }` (HTTP 200)
  rather than crashing or returning a scary 503.
- New client hook `useMapboxBoundaries.ts`, mirroring the existing
  `useMapboxTilequery.ts` hook shape (loading/error/data state, `available` flag
  sourced from the `not_configured` response).
- UI: a "Jurisdiction" lookup control on Cases, Warrants, and Properties detail
  panels — shows resolved county/municipality, or an honest "unavailable" badge
  if the account lacks Boundaries access. Not wired into dispatch/beat UI.

## Testing

- No Worker test suite exists yet (typecheck-only per CI) — add a smoke test for
  the new `/mapbox/boundaries` route alongside the existing route file if a
  Worker test harness is touched, otherwise rely on manual verification per
  `CLAUDE.md`'s stated gap.
- Manual verification via `client/npm run dev` + Chrome preview:
  1. Search Box hook returns real geocoding results (not empty array).
  2. Traffic layer either renders congestion-colored lines or the toggle is
     disabled with a clear reason.
  3. Boundaries lookup returns a real county/municipality for a known address,
     or a clean "unavailable" state if the account lacks access.

## Out of scope

- Any change to the beat/zone/sector dispatch system.
- Geocoding v6 batch, GeoJSON clustering, Datasets API, Styles API, Tileset
  Management API, Navigation SDK — audited and judged low-value or inapplicable
  to a web-only CAD (see audit notes below), not part of this PR.
- Building a live traffic-incidents feed — no such Mapbox product exists.

## Audit notes (for reference)

Full inventory from the pre-design audit: Directions v5, Matrix v1, Isochrone v1,
Map Matching v5, Optimization v1, Geocoding v5 (fwd/rev), Tilequery v4, Static
Images, PMTiles vector tiles, built-in styles, and telemetry opt-out are all fully
implemented and working. Geocoding v6 exists partially in `mapboxRouting.ts`
(newer search endpoints) but isn't a gap worth closing separately. 3D buildings
are referenced (`addMapbox3DBuildings()`) but terrain/fog/globe projection are
unused — judged low value for a 2D tactical/dispatch map and left alone.
