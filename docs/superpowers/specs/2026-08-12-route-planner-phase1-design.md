# Route Planner Phase 1 — Design Spec
**Date:** 2026-08-12
**Status:** Approved for implementation
**Author:** Rocky Mountain Protective Group

---

## Overview

Phase 1 upgrades the Process Server Route Planner from a straight-line geometric optimizer to a real road-network optimizer with traffic awareness, time-window enforcement, deadline-weighted stop ordering, historical dwell-time learning, and geocoding quality warnings. All six features compose on top of a single architectural change: replacing the Haversine distance matrix in `serveRouteOptimizer.ts` with a Mapbox Matrix API cost matrix.

**Problem being solved:**
- Route order does not reflect real drive times (one-way streets, highway access, turn restrictions are ignored)
- ETAs assume free-flow speed with zero dwell time, drifting 30–50% from reality by mid-shift
- Time-window constraints on location notes are displayed but never consumed by the optimizer
- Stops expiring within 24 hours are not preferentially sequenced — urgency is invisible to the solver
- No geocoding quality signal means officers drive to county centroids on bad addresses

---

## Architecture

### Data Flow

```
ServeRoutePlanner.tsx
  → POST /api/serve/route/optimize
        │
        ├─ 1. Geocode quality check (per stop, pre-flight)
        │      └─ flag low-confidence → return warnings, proceed
        │
        ├─ 2. Build cost matrix
        │      └─ Mapbox Matrix API (MAPBOX_SECRET_TOKEN)
        │           depart_at = shift start ISO8601 (traffic-aware)
        │
        ├─ 3. Apply time-window + deadline weights to cost matrix
        │      └─ location_notes serve_start/serve_end constraints
        │           deadline proximity coefficient per stop
        │           historical dwell-time per address_hash
        │
        ├─ 4. Run nearest-neighbor + 2-opt on weighted matrix
        │
        └─ 5. Return ordered stops + ETA per stop + geocode warnings
```

### New Infrastructure

| Item | Detail |
|------|--------|
| Worker secret | `MAPBOX_SECRET_TOKEN` — scopes: `matrix`, `directions`. Set via `wrangler secret put MAPBOX_SECRET_TOKEN`. Never exposed to the client bundle. |
| D1 migration | `0240_serve_dwell_times.sql` — new `serve_dwell_times` table |
| Modified files | `src/utils/serveRouteOptimizer.ts`, `src/routes/serve.ts`, `client/src/components/serve/ServeRoutePlanner.tsx` |
| No new routes | The existing `POST /api/serve/route` endpoint is extended in place |

### Mapbox Matrix API Constraints

- Maximum 25 sources × 25 destinations per call
- If stop count exceeds 25, chunk into overlapping 25-stop windows and merge
- Single-officer runs in practice will not exceed 25 stops; the guard prevents a silent 422 from Mapbox
- Endpoint: `POST https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic/`
- Parameters: `sources=all`, `destinations=all`, `depart_at={shiftStartISO}`, `access_token=MAPBOX_SECRET_TOKEN`
- Response field consumed: `duration_matrix[i][j]` — drive seconds from stop i to stop j

---

## Feature Specifications

### Feature 1 — Mapbox Matrix API Integration

**File:** `src/utils/serveRouteOptimizer.ts`

Replace the `haversineDistance()` matrix construction loop with an async `buildCostMatrix()` function:

```
buildCostMatrix(stops: ServeStop[], departAt: string, env: Env) → Promise<number[][]>
```

- Formats stop coordinates as `{longitude},{latitude}` pairs per Mapbox spec
- POSTs to the Matrix API with `MAPBOX_SECRET_TOKEN` from `env`
- Returns `duration_matrix` as the cost matrix (seconds, not meters)
- On API failure: falls back to Haversine distance matrix and attaches `matrixFallback: true` to the response so the client can surface a degraded-mode notice
- Unit test in `tests/serveRouteOptimizer.test.ts`: mock the Matrix API fetch, assert the returned matrix shape and that the 2-opt solver receives it

**Solver changes:** every `distance(a, b)` call in the nearest-neighbor seed and 2-opt swap evaluation is replaced with `costMatrix[a][b]`. No other solver logic changes.

---

### Feature 2 — Traffic-Aware ETA Baking

**File:** `src/utils/serveRouteOptimizer.ts`

The `departAt` parameter passed to `buildCostMatrix()` is the officer's shift start time as an ISO 8601 string (e.g., `2026-08-12T07:00:00-06:00`). Mapbox uses this to apply historical traffic patterns for that time of day and day of week.

**ETA computation:** after the solver produces a final stop order, ETAs are computed by walking the ordered path through the cost matrix:

```
eta[0] = departAt + travelTime(origin → stop[0]) + dwell[stop[0]]
eta[i] = eta[i-1] + travelTime(stop[i-1] → stop[i]) + dwell[stop[i]]
```

`departAt` is supplied by the client as part of the optimize request body. If omitted, the Worker defaults to `new Date().toISOString()` (current time).

---

### Feature 3 — Time-Window Constrained Stop Ordering

**File:** `src/utils/serveRouteOptimizer.ts`

After `buildCostMatrix()` returns, apply `applyTimeWindowPenalties()`:

```
applyTimeWindowPenalties(
  matrix: number[][],
  stops: ServeStop[],
  departAt: string
) → number[][]
```

- For each stop j that has a `location_note` with `serve_start` / `serve_end`
- Compute the projected arrival time at j for each possible predecessor i using `matrix[i][j]`
- If projected arrival falls outside the serve window, set `matrix[i][j] += WINDOW_PENALTY`
- `WINDOW_PENALTY` = `10 × max(matrix)` — large enough to make out-of-window orderings uncompetitive without making the problem infeasible

Stops with no location note constraint are unaffected (penalty = 0).

**Data source:** `location_notes` is already joined in the serve queue list query in `serve.ts`. The optimizer receives it as a field on each `ServeStop` object — no additional query needed.

---

### Feature 4 — Deadline-Weighted Priority Scoring

**File:** `src/utils/serveRouteOptimizer.ts`

Before the nearest-neighbor seed runs, compute a `deadlineCoefficient` per stop and apply it as a row multiplier on the cost matrix:

| Time to deadline | Coefficient | Effect |
|------------------|-------------|--------|
| > 72 hours | 1.0 | No change |
| 24–72 hours | 0.7 | Pulled earlier |
| < 24 hours | 0.4 | Strongly pulled earlier |
| Past deadline | 0.1 | Forced to front |

The coefficient scales the effective cost of visiting other stops before this one, biasing the nearest-neighbor seed toward urgency without overriding geometry on low-urgency stops.

```
adjustedCost[i][j] = matrix[i][j] × deadlineCoefficient(stops[j], now)
```

The 2-opt phase runs on `adjustedCost`, not raw `matrix`, so swap evaluations preserve the deadline bias throughout refinement.

---

### Feature 5 — Historical Dwell-Time Learning

#### Migration: `migrations/0240_serve_dwell_times.sql`

```sql
CREATE TABLE IF NOT EXISTS serve_dwell_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address_hash TEXT NOT NULL,
  defendant_type TEXT NOT NULL CHECK(defendant_type IN ('individual','business')),
  dwell_seconds INTEGER NOT NULL CHECK(dwell_seconds > 0 AND dwell_seconds < 7200),
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sdt_address ON serve_dwell_times(address_hash);
```

`address_hash` is SHA-256 of `UPPER(TRIM(street_number || ' ' || street_name || ', ' || city))` — normalized enough to match across minor OCR variants while avoiding PII storage of raw addresses.

#### Write path: `src/routes/serve.ts` — attempt logging endpoint

When `POST /api/serve/:id/attempt` receives an `arrivedAt` ISO timestamp in the body:

```
dwellSeconds = (attemptLoggedAt - arrivedAt) in seconds
if 30 < dwellSeconds < 7200:
  INSERT INTO serve_dwell_times (address_hash, defendant_type, dwell_seconds)
```

Bounds check (`> 30s`, `< 2h`) rejects GPS noise and forgotten-app sessions.

#### Read path: `src/utils/serveRouteOptimizer.ts`

Before `buildCostMatrix()`, query the 90-day median dwell time per stop:

```sql
SELECT address_hash, CAST(AVG(dwell_seconds) AS INTEGER) as median_dwell
FROM serve_dwell_times
WHERE address_hash IN (?, ?, ...)
  AND logged_at > datetime('now', '-90 days')
GROUP BY address_hash
```

Stops with no history default to: `individual` = 300 s (5 min), `business` = 600 s (10 min).

The `dwell[stop[i]]` values in the ETA formula (Feature 2) are sourced from this query result.

---

### Feature 6 — Geocoding Quality Gating (Soft Warning)

**File:** `src/utils/serveRouteOptimizer.ts` — `geocodeQualityScore(stop)`

| Condition | Quality |
|-----------|---------|
| `lat` + `lng` from point geocode (`geocode_source = 'point'`) | `high` |
| Coordinates from city/county centroid fallback (`geocode_source = 'centroid'`) | `low` |
| `lat` or `lng` is null | `none` |

**Optimize endpoint response shape:**

```json
{
  "orderedStops": [...],
  "etaPerStop": ["2026-08-12T07:14:00-06:00", ...],
  "matrixFallback": false,
  "geocodeWarnings": [
    {
      "jobId": 42,
      "defendant": "Jane Smith",
      "address": "Rural Route 4, Tooele County",
      "quality": "low"
    }
  ]
}
```

**Client: `client/src/components/serve/ServeRoutePlanner.tsx`**

If `geocodeWarnings.length > 0`, render a dismissible amber banner above the route list:

```
⚠ {N} stop(s) have unverified addresses — route generated but pins may be inaccurate.
[Stop name — address] [Verify →]   (one row per warning)
```

"Verify →" opens the existing serve job edit modal pre-focused on the address field. The route is fully usable without acting on the warning.

`geocode_source` is a new nullable column added to `serve_queue` via migration `0241_serve_queue_geocode_source.sql`. Intake writes `'point'` when the address resolves to a street-level result, `'centroid'` otherwise. Existing rows default to `null`, treated as `high` (benefit of the doubt — don't warn on every pre-existing job at once).

---

## Response Shape Changes

The existing `POST /api/serve/route` response is extended — no fields removed (backward compatible):

```typescript
interface OptimizeRouteResponse {
  orderedStops: ServeJob[];       // existing
  totalDistance: number;          // existing (now drive-time seconds, not meters)
  totalDuration: number;          // existing
  etaPerStop: string[];           // NEW — ISO timestamps
  matrixFallback: boolean;        // NEW — true if Mapbox call failed, Haversine used
  geocodeWarnings: {              // NEW — empty array if all stops clean
    jobId: number;
    defendant: string;
    address: string;
    quality: 'low' | 'none';
  }[];
}
```

---

## Database Migrations

| File | Purpose |
|------|---------|
| `migrations/0240_serve_dwell_times.sql` | New `serve_dwell_times` table + index |
| `migrations/0241_serve_queue_geocode_source.sql` | `geocode_source TEXT` column on `serve_queue` |

Both are idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` wrapped in the Worker boot reconciler pattern). Apply to live D1 `785de7ae` via `scripts/apply-migration.sh` after merge.

---

## Testing

| Test file | Coverage |
|-----------|---------|
| `tests/serveRouteOptimizer.test.ts` | Matrix API mock + fallback, deadline coefficient math, time-window penalty application, dwell-time ETA computation, traffic degradation detection |
| `tests/serveDwellTimes.test.ts` | Write path bounds check, read path median query, address hash normalization |
| `client/src/components/serve/__tests__/ServeRoutePlanner.clustering.test.ts` | Extend existing: geocode warning banner renders, dismiss works, verify link opens edit modal, traffic suggestion banner renders and dismisses |

All existing `serveRouteOptimizer` tests must remain green — the matrix input changes but the solver interface does not.

---

## Feature 7 — Mid-Shift Traffic Suggestion

### Overview

While an officer is working a route, real-world traffic conditions can degrade significantly from the conditions at shift start. Feature 7 detects this automatically and surfaces a non-intrusive suggestion to accept a re-optimized sequence for remaining stops.

### Data Flow

```
ServeRoutePlanner.tsx (active route)
  → poll every 10 min → POST /api/serve/route/traffic-check
        │
        ├─ Re-run Mapbox Matrix API with depart_at = now
        ├─ Compare new segment durations to original durations
        ├─ If total added time > 15 min OR any segment > 10 min added:
        │      re-optimize remaining stops with new matrix
        │      return degraded: true + new order + new ETAs
        └─ Return TrafficCheckResponse
```

### Request / Response

**`POST /api/serve/route/traffic-check`** — auth required

Request body:
```typescript
interface TrafficCheckRequest {
  remainingStops: RouteStop[];       // stops not yet completed this shift
  currentOrder: number[];            // jobId ordering of remainingStops
  currentPosition: { lat: number; lng: number };
  originalEtas: string[];            // ISO timestamps from route generation
  departAt: string;                  // original shift start (for comparison baseline)
}
```

Response:
```typescript
interface TrafficCheckResponse {
  degraded: boolean;
  addedMinutes: number;              // total minutes added vs original ETAs
  newOrder: RouteStop[];             // re-optimized remaining stop sequence
  newEtas: string[];                 // updated ETA per remaining stop
  degradedSegments: Array<{
    fromJobId: number;
    toJobId: number;
    addedSeconds: number;
  }>;
  matrixFallback: boolean;
}
```

### Server-Side Logic: `checkTrafficDegradation()`

New function in `src/utils/serveRouteOptimizer.ts`:

1. Prepend `currentPosition` as a virtual origin stop to `remainingStops`
2. Call `buildCostMatrix()` with `depart_at = new Date().toISOString()` (current traffic)
3. Compare new `matrix[i][j]` values against reconstructed original costs (derived from original ETAs delta)
4. Collect degraded segments: any pair where `newCost - originalCost > 600` (10 min)
5. Sum total added seconds across the planned path
6. If `totalAddedSeconds > 900` (15 min) or any degraded segment exists: re-run `optimizeRoute()` on remaining stops with new matrix
7. Return result

### Client: Polling + Suggestion Banner

`ServeRoutePlanner.tsx` — when `routeAccepted` state is true:

- `useEffect` with `setInterval(checkTraffic, 600_000)` (10 min)
- `checkTraffic` calls `apiFetch<TrafficCheckResponse>('/api/serve/route/traffic-check', { method: 'POST', body: ... })`
- If `response.degraded`, set `trafficSuggestion` state
- Render amber banner above the stop list:

```
⚠ Traffic has changed — route is now +{addedMinutes} min behind schedule.
[Accept Updated Route]  [Dismiss]
```

- "Accept Updated Route" replaces `orderedStops` + `etaPerStop` with `newOrder` + `newEtas` and clears the banner
- "Dismiss" clears the banner and resets the poll timer (next check in 10 min)
- If `matrixFallback: true` on the check response, suppress the banner (no reliable data to suggest on)
- Polling stops when all stops are marked completed (all `status` values are `'served'` or terminal)

---

## Deployment Checklist

- [ ] `wrangler secret put MAPBOX_SECRET_TOKEN` (prod)
- [ ] Add `MAPBOX_SECRET_TOKEN=sk.ey...` to `.dev.vars` (local)
- [ ] `scripts/apply-migration.sh migrations/0240_serve_dwell_times.sql`
- [ ] `scripts/apply-migration.sh migrations/0241_serve_queue_geocode_source.sql`
- [ ] Verify via `pragma_table_info('serve_dwell_times')` and `pragma_table_info('serve_queue')`
- [ ] Smoke test: generate a route in prod, confirm `etaPerStop` present, `matrixFallback: false`
- [ ] Confirm geocode warning banner appears for a known centroid-geocoded address
- [ ] Confirm traffic-check endpoint returns `degraded: false` under normal conditions

---

## Out of Scope (Phase 2)

- Live route resequencing on mid-shift job assignment
- Attempt failure auto-replan
- Cheapest insertion heuristic
- Route health indicator
- All remaining features 11–20
