# Mapbox Optimization V2 Async Engine — Phase 1 Design

**Date:** 2026-08-17  
**Branch:** feature branch off `main`  
**Scope:** Phase 1 of a two-phase Mapbox API expansion. Introduces the Optimization V2 async engine as a shared foundation powering three CAD workflows: serve runs, patrol beat planning, and multi-unit dispatch optimization. Phase 2 (Search Box v6, Address Autofill, Boundaries v4, batch geocoding) is a separate spec.

---

## Background

The existing `/api/mapbox/optimization` proxy calls `/optimized-trips/v1/` — a synchronous, single-vehicle trip-ordering endpoint. RMPG has Optimization V2 access, which is a completely different async endpoint (`/optimized-trips/v2/`) supporting multi-vehicle routing, time windows, vehicle shift constraints, driver breaks, vehicle capacities, and soft/strict service-time windows. V2 is a proper VRP (Vehicle Routing Problem) solver, not a TSP.

The V2 API protocol is async: `POST` to submit returns a Mapbox-assigned UUID (202 Accepted); `GET /{id}` polls until the solution appears (200 OK). Jobs can stay in `processing` state for several seconds, requiring D1-backed persistence and client-side polling.

---

## Section 1: Data Model

### New D1 table: `mapbox_optimization_v2_jobs`

Migration file: `0254_mapbox_optimization_v2_jobs.sql`

```sql
CREATE TABLE IF NOT EXISTS mapbox_optimization_v2_jobs (
  id           TEXT PRIMARY KEY,          -- Mapbox-assigned UUID
  job_type     TEXT NOT NULL,             -- 'serve_run' | 'patrol_beat' | 'multi_unit_dispatch'
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'complete' | 'error'
  problem_json TEXT NOT NULL,             -- submitted V2 problem document
  solution_json TEXT,                     -- null until complete
  ref_id       INTEGER,                   -- serve_routes.id for serve_run; null otherwise
  created_by   INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  error_message TEXT                      -- set on status='error'
);

CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_type    ON mapbox_optimization_v2_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_user    ON mapbox_optimization_v2_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_opt_v2_jobs_status  ON mapbox_optimization_v2_jobs(status);
```

### Integration invariant: serve_routes write-back

When a `serve_run` job reaches `complete`, the `GET /:jobId` handler writes the ordered stop sequence back to `serve_routes.optimized_order_json` (the row identified by `ref_id`). `ServePage` reads that column unchanged — transparent V2 upgrade with zero changes to the read path.

---

## Section 2: Worker Routes

### Route file: `src/routes/mapboxOptimizationV2.ts`

Mounted at `/api/mapbox/optimization-v2` in `src/index.ts` (auth required, `client_viewer` role excluded).

| Method | Path | Min role | Description |
|---|---|---|---|
| `POST /submit` | supervisor | Accepts typed params by `job_type`, builds V2 problem doc, submits to Mapbox, inserts D1 row, returns `{job_id, status}` |
| `GET /:jobId` | officer | Polls Mapbox if status non-terminal, updates D1, triggers serve_routes write-back on first completion, returns `{job_id, status, solution}` |
| `GET /` | supervisor | Lists jobs — admin/manager see all; supervisor/officer see own |

**Unset token behavior:** `503 { code: 'not_configured' }` — consistent with all other optional integrations in this codebase.

**Mapbox 401 on submit:** `503 { code: 'optimization_v2_unauthorized' }` — token lacks Optimization V2 scope.

**Mapbox 422:** `400` with upstream `message` forwarded — malformed problem document from a builder.

**Poll timeout:** job stays `processing` > 5 minutes → set `status = 'error'`, `error_message = 'timed_out'`. Client shows "Optimization timed out — try with fewer stops."

**Dropped stops:** V2 solutions include a `dropped.services` array when the optimizer can't fit a stop. These are surfaced as amber per-stop warnings, not errors — the route is valid for the included stops.

---

## Section 3: Problem Builders

### File: `src/utils/mapboxOptimizationV2.ts`

Pure functions — no side effects, no I/O. The route handler does D1 reads and Mapbox HTTP; the builders do data transformation only. This makes each builder independently unit-testable with fixture data.

All three builders return a V2 problem document conforming to:
```json
{ "version": 1, "locations": [...], "vehicles": [...], "services": [...] }
```

### `buildServeRunProblem`

```
buildServeRunProblem(
  items: ServeStop[],         // from serve_queue rows with recipient_lat/lng
  officer: UnitRow,           // current GPS = vehicle start/end location
  shiftStart: string,         // ISO 8601
  shiftEnd: string,           // ISO 8601
): V2ProblemDocument
```

- Each serve stop → one `service` entry with `duration` (estimated dwell time from priority) and `service_times` derived from `serve_queue.time_window` / `deadline` (soft windows — a late arrival incurs a penalty but doesn't drop the stop)
- Vehicle routing profile: `mapbox/driving-traffic`
- Objective: `min-schedule-completion-time`

### `buildPatrolBeatProblem`

```
buildPatrolBeatProblem(
  beats: BeatRow[],           // dispatch_beats rows — centroid from min/max lat/lng
  units: UnitRow[],           // available units with current GPS
  shiftStart: string,
  shiftEnd: string,
): V2ProblemDocument
```

- Each beat centroid → one location + one service entry (patrol visit, no duration constraint)
- Each unit → one vehicle with `earliest_start` / `latest_end` = shift window; `start_location` = current GPS
- Routing profile: `mapbox/driving`
- Objective: `min-total-travel-duration` (minimize total drive time across the fleet)

### `buildDispatchProblem`

```
buildDispatchProblem(
  calls: CallRow[],           // open calls_for_service with incident_lat/lng
  units: UnitRow[],           // units where status IN ('available', 'on_scene')
): V2ProblemDocument
```

- Each open call → one service with `duration` estimated from call priority (Priority 1 = 30 min, Priority 2 = 20 min, Priority 3 = 10 min)
- Each eligible unit → one vehicle; start location = current GPS
- Routing profile: `mapbox/driving-traffic`
- Objective: `min-schedule-completion-time` (get to calls fastest)

---

## Section 4: Client-Side Hook & UI

### `client/src/utils/mapboxOptimizationV2.ts`

Typed submit wrappers for the three job types plus a raw `pollOptimizationJob(jobId)` function. No polling logic here.

### `client/src/hooks/useOptimizationV2.ts`

```ts
interface UseOptimizationV2 {
  submit(params: ServeRunParams | PatrolBeatParams | DispatchParams): Promise<void>
  status: 'idle' | 'pending' | 'processing' | 'complete' | 'error'
  solution: OptimizationV2Solution | null
  elapsedMs: number
  error: string | null
  reset(): void
}
```

Polling: `setInterval` at 3 s, clears on unmount or terminal state (`complete` / `error`). On poll error, surfaces immediately — no silent retry loop.

### UI touch points

**1. `ServePage` — "Optimize Route" button upgrade**

Replace the existing call to `/api/mapbox/optimization` (v1) with the new V2 submit. Show an inline elapsed-time indicator while polling (`Optimizing… 4s`). On completion the route display re-renders automatically (reads `serve_routes.optimized_order_json` which the GET handler already wrote back). Additive: show per-stop ETAs from V2's `stop.eta` field, and an amber badge on stops where the optimizer arrived outside the requested time window.

**2. `DispatchPage` — "Optimize Assignments" button**

Supervisor/admin only (role-gated in the component). Appears in the units panel header. Submits a `multi_unit_dispatch` problem for all eligible units vs open calls. On completion shows an assignment overlay: each unit gets an ordered list of calls in recommended sequence. Dispatcher can accept (writes `units.current_call_id` and call assignments) or dismiss. Never auto-applies — human confirms.

**3. `MapPage` — `PatrolBeatPlannerModal`**

Supervisor+ only. New toolbar button ("Beat Planner"). Officer selects: available units (checkboxes from live units), shift start/end, and which beats to cover. Submits patrol_beat problem. While polling, shows a spinner. On completion draws each unit's assigned beat sequence as a color-coded route line per unit on the map (one color per unit, matching the unit's existing dispatch color).

---

## Section 5: Testing

### `tests/mapboxOptimizationV2.test.ts` (Node/Vitest)

Unit tests for all three problem builders using fixture data. No HTTP calls. Assertions:
- Output has required `version: 1`, `locations`, `vehicles`, `services` fields
- `serve_run`: `service_times` present when `time_window` is set; absent when not
- `patrol_beat`: vehicle count matches input unit count; location count matches beat count
- `dispatch`: only `available`/`on_scene` units become vehicles; priority-derived durations match

### `test-workers/mapboxOptimizationV2.test.ts` (Miniflare)

Smoke tests for the three Worker routes:
- `POST /submit` with mocked Mapbox → returns `{job_id, status: 'pending'}`, D1 row created
- `GET /:jobId` with completed Mapbox mock → returns solution, `serve_routes` row updated for serve_run type
- Unset `MAPBOX_ACCESS_TOKEN` → `503 { code: 'not_configured' }`
- `client_viewer` role → `403`

### Client: `useOptimizationV2` hook

Tested with `msw` mocking the poll sequence: `pending` response × 2 → `complete` with fixture solution. Assert `status` transitions, `elapsedMs` increments, `solution` set on completion, interval cleared on unmount.

---

## Out of scope for Phase 1

- Phase 2 APIs: Search Box v6, Address Autofill, Boundaries v4 upgrade, batch geocoding, POI search
- The existing v1 `/api/mapbox/optimization` endpoint is **not removed** — it stays as a fallback until Phase 2 formally retires it
- No cron-based job polling — client polls; if no client is watching, jobs remain in D1 with their last status until next GET

---

## Files changed

| File | Action |
|---|---|
| `migrations/0254_mapbox_optimization_v2_jobs.sql` | New |
| `src/utils/mapboxOptimizationV2.ts` | New |
| `src/routes/mapboxOptimizationV2.ts` | New |
| `src/index.ts` | Mount new router + auth guard |
| `client/src/utils/mapboxOptimizationV2.ts` | New |
| `client/src/hooks/useOptimizationV2.ts` | New |
| `client/src/pages/ServePage.tsx` | Edit — replace v1 call, add per-stop ETAs |
| `client/src/pages/DispatchPage.tsx` | Edit — add "Optimize Assignments" button |
| `client/src/pages/MapPage.tsx` | Edit — add "Beat Planner" toolbar button |
| `client/src/components/PatrolBeatPlannerModal.tsx` | New |
| `tests/mapboxOptimizationV2.test.ts` | New |
| `test-workers/mapboxOptimizationV2.test.ts` | New |
