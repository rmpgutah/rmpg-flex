# GPS Tracking Hardening — Design

**Date**: 2026-07-23
**Status**: Approved for planning

## Problem

GPS tracking accuracy, refresh rate, and reliability need hardening across the pipeline: ingestion (`src/routes/dispatch/gps.ts`), delivery (client polling + WebSocket nudges), and rendering (Map + Dispatch page markers). An audit of the current code found:

- **Server ingestion validates only lat/lng range + null-island filtering.** Accuracy, speed, and heading are cast to numbers and persisted as-is with no bounds checking or jump rejection — all such filtering happens client-side only, in [useGpsTracking.ts](../../../client/src/hooks/useGpsTracking.ts), which a compromised or buggy client can simply not do.
- **Map UI polls units every 30s** ([MapboxMapPage.tsx:127](../../../client/src/pages/map/MapboxMapPage.tsx)) even though officer devices batch-report every 5s, so dispatchers can see positions up to 30s stale on top of transport latency.
- **No client-side marker interpolation** — positions teleport between polls instead of animating.
- **Stale-detection thresholds are duplicated** between `client/src/pages/map/utils/mapMarkers.ts` and `UnitStatusBoard.tsx` (2min amber / 5min gray), risking drift between the two surfaces.
- **No accuracy-radius or heading-rotation visualization** on unit markers, so dispatchers can't judge position confidence or direction of travel at a glance.
- **No GPS-specific rate limit** — GPS updates ride the generic per-user 600 req/300s limit, which isn't tuned to catch a runaway client loop hammering the single highest-frequency endpoint in the app.

## Goals

1. Reject or flag physically-impossible GPS data (bad accuracy/speed/heading, implausible speed-jumps) at the server, not just the client.
2. Bring live-map refresh cadence for unit positions down to ~5s to match device report frequency.
3. Make marker movement read as continuous (interpolated) rather than teleporting.
4. Give dispatchers at-a-glance confidence/staleness/direction cues on the map (accuracy ring, heading rotation, unified stale-color logic).
5. Add a GPS-specific abuse rate limit distinct from the app-wide generic limit.

## Non-goals

- Building a dedicated low-latency WebSocket position-push channel. The existing WS layer is explicitly best-effort ([useLiveSync.ts:100-111](../../../client/src/hooks/useLiveSync.ts)) due to a legacy/rewrite worker split; replacing polling with true push is a materially larger, separate effort and not needed to hit the 3-5s freshness target — a tightened poll interval is indistinguishable from push to a human dispatcher at this cadence.
- Changing the two GPS ingestion *sources* (Toughbook internal GPS vs mobile browser/app GPS) — both already converge on the same `QueuedPoint` shape and the same `POST /dispatch/gps` endpoint in [useGpsTracking.ts](../../../client/src/hooks/useGpsTracking.ts); this design only hardens what happens after a point reaches the server.
- Historical/analytical map layers (heatmap, speed violations, pursuit segments, trails) keep their current slower refresh cadences — this design only speeds up the live units layer.
- ClearPath GPS vendor integration (`src/routes/clearpathgps.ts`) is a separate third-party dashcam/device sync system, unrelated to officer position tracking, and out of scope.

## Architecture

```
[Officer device: Toughbook GPS | mobile GPS]
        │  (5s batch, existing client-side jitter/speed/accuracy filters — unchanged)
        ▼
POST /dispatch/gps  ──▶  [NEW] bounds validation (accuracy/speed/heading)
                         [NEW] server-side speed-jump check vs last breadcrumb
                         [NEW] GPS-specific rate limit
        │
        ▼
   gps_breadcrumbs (+ flagged_reason column)
        │
        ├─▶ existing side effects unchanged (units mirror, on-foot detection,
        │    auto status transitions, geofence, trip engine, emitAlert nudge)
        ▼
[Map / Dispatch pages]
   - units-layer poll: 30s → ~5s (NEW)
   - historical layers (heatmap/violations/pursuit/trails): unchanged cadence
   - WS nudge: unchanged (wake-and-poll only)
        │
        ▼
[Marker rendering]
   - [NEW] shared gpsStaleness util (dedupes mapMarkers.ts / UnitStatusBoard.tsx)
   - [NEW] CSS-transform interpolation between polls
   - [NEW] heading-rotated glyph + accuracy-radius ring (togglable)
```

## Components

### 1. Server-side ingestion hardening — `src/routes/dispatch/gps.ts`

- Extend the existing per-point validation loop (next to the current lat/lng/null-island checks) with bounds checks:
  - `accuracy`: valid range `0–2000` meters; out-of-range → null the field, keep the point (consistent with existing "drop what's bad, keep the point" pattern for other fields).
  - `speed`: valid range `0–60` m/s (~134 mph, generous enough to cover a vehicle pursuit); out-of-range → null the field.
  - `heading`: valid range `0–360`; out-of-range → null the field.
- Add a speed-jump check: using the unit's last known breadcrumb (already queried for on-foot/geofence logic in the existing handler), compute implied speed between the last point and the new one. If it exceeds ~60 m/s, set `flagged_reason = 'speed_jump'` on insert rather than rejecting the point outright — mirrors the client's existing 80 m/s rejection threshold as defense-in-depth, but errs toward keeping data (with a flag) over silently dropping it, since dispatchers may still want to see it.
- Migration `migrations/0197_gps_breadcrumbs_flagged_reason.sql`: `ALTER TABLE gps_breadcrumbs ADD COLUMN flagged_reason TEXT` (nullable, no backfill).
- New rate limit: 30 requests / 30s per unit (distinct key from the generic per-user 600/300s limit in `src/middleware/rateLimit.ts`), scoped specifically to `POST /dispatch/gps` since it's the highest-frequency endpoint in the app and the existing generic limit is explicitly tuned to not throttle GPS.

### 2. Map refresh cadence — `MapboxMapPage.tsx`, `DispatchPage.tsx`

- Split `MapboxMapPage`'s single `REFRESH_INTERVAL_MS` into two intervals: a fast one (~5s) for the units/live-position layer, and the existing slower ones (30-60s, unchanged) for heatmap/violations/pursuit/trails.
- `DispatchPage`'s adaptive polling (only active while a unit is in `MOVING_STATUSES`) keeps its existing skip-when-hidden/offline behavior; the active-poll interval drops to ~5s to match.
- No changes to `useLiveSync`/WS wiring — it remains a debounced "poll now" trigger only.

### 3. Client rendering hardening — `mapMarkers.ts`, `UnitStatusBoard.tsx`, new shared util

- New `client/src/utils/gpsStaleness.ts` exporting the shared stale-threshold logic (2min amber / 5min gray, matching current values) with a single source of truth; both `mapMarkers.ts`'s `getMapUnitGpsStaleness` and `UnitStatusBoard.tsx`'s `getGpsStaleStatus` are refactored to call it instead of duplicating the thresholds.
- Marker interpolation: on each units-layer poll, animate each `mapboxgl.Marker`'s position via CSS transform from its last rendered lat/lng to the new one over the poll interval, rather than snapping instantly. Skipped for large jumps (e.g. > some threshold distance) where an instant snap is more honest than a fake glide across an implausible distance.
- `buildUnitMarkerEl()` extended to optionally render:
  - A heading-rotated directional glyph, only applied when heading data is present and not null (server may have nulled implausible headings per component 1).
  - An accuracy-radius ring: a translucent circle sized in meters (converted to on-screen pixels at current map zoom), reflecting the point's reported accuracy. Rendered only when accuracy data is present.
  - Both are additive to the existing marker element, togglable (default on, but structured so they can be hidden if dispatchers find them cluttering a busy map — exact UI toggle mechanism left to implementation).

## Data flow / error handling

- Server validation failures degrade gracefully: a point with bad accuracy/speed/heading has just that field nulled, not the whole point dropped — consistent with existing behavior for other malformed fields in the same handler.
- A flagged speed-jump point is still stored and still flows through existing side effects (units mirror, on-foot detection, etc.) unchanged; `flagged_reason` is purely informational for now (no downstream behavior gated on it in this design — future work could use it to warn dispatchers or exclude from analytics).
- Rate-limited GPS requests return the existing rate-limit response shape used elsewhere in the app (429 with retry info), consistent with `src/middleware/rateLimit.ts`.
- Client-side, a marker with no accuracy/heading data simply omits the corresponding visual (ring/rotation) rather than rendering a default/fake value.

## Testing

- **Server**: new Miniflare test in `test-workers/` (following the existing pattern, e.g. `test-workers/health.test.ts`) covering: accuracy/speed/heading bounds rejection (field nulled, point still stored), speed-jump flagging, and the new GPS-specific rate limit triggering a 429.
- **Client**: no existing GPS-specific client test file; verify manually in-browser (dev server) on both Map and Dispatch pages: marker glide is smooth over the ~5s poll interval, stale color transitions at the 2min/5min thresholds render identically on both surfaces (proving the dedup worked), accuracy ring scales correctly across zoom levels, heading rotation matches direction of travel during a manual position change.
- **Typecheck**: `npm run typecheck` (Worker) and `cd client && npx tsc --noEmit` must pass, per existing CI gates.

## Rollout

- New migration `0197_gps_breadcrumbs_flagged_reason.sql` applied via the existing `scripts/apply-migration.sh` flow post-merge (per CLAUDE.md's migration-drift guidance), verified with `pragma_table_info('gps_breadcrumbs')`.
- No `_ext` table needed — `gps_breadcrumbs` is not one of the two capped tables (`calls_for_service`/`persons`) called out in CLAUDE.md's 100-column-cap gotcha.
- No new secrets/config; purely code + one additive migration.
