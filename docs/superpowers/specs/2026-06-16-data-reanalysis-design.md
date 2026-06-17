# Data Reanalysis — Design Spec
**Date:** 2026-06-16  
**Status:** Approved  
**Scope:** Admin-triggered backfill of footage clips, ALPR confidence correction, and analytics lakehouse replay

---

## 1. Overview

Three independent admin-triggered pipelines that backfill and correct historical data across the three main storage layers (footage, ALPR, analytics). Each runs on demand via a dedicated endpoint. Results flow into the existing FlexCam, PlateLog, and Analytics pages automatically as processing completes.

**Trigger model:** Admin presses a button — no automatic catch-up. Paginated (200–500 rows per call); admin continues until `has_more` is false.

---

## 2. Architecture

### 2.1 New Endpoints (all `requireRole('admin')`)

| Method | Path | Pipeline | Returns |
|--------|------|----------|---------|
| `POST` | `/api/flexcam/backfill` | Footage backfill | `{ queued, skipped, errors, has_more, job_id }` |
| `POST` | `/api/alpr/backfill-confidence` | ALPR confidence fix | `{ corrected, skipped, has_more, next_cursor, job_id }` |
| `POST` | `/api/analytics/replay` | Iceberg replay | `{ replayed, has_more, next_cursor, job_id }` |
| `GET`  | `/api/admin/reanalysis/status` | Last-run stats (all 3) | Polled every 5 s by UI |

`backfill-confidence` and `replay` live in a new file `src/routes/reanalysis.ts`, mounted under `/api/admin` in `src/index.ts`. Footage backfill (`/api/flexcam/backfill`) is added to the existing `src/routes/flexcam.ts`.

### 2.2 New D1 Table — `job_runs`

Tracks each admin-triggered invocation for live progress display.

```sql
-- migrations/0127_job_runs.sql
CREATE TABLE IF NOT EXISTS job_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type     TEXT NOT NULL,
  -- 'footage_backfill' | 'alpr_confidence' | 'analytics_replay'
  status       TEXT NOT NULL DEFAULT 'running',
  -- 'running' | 'complete' | 'failed'
  total        INTEGER DEFAULT 0,
  processed    INTEGER DEFAULT 0,
  skipped      INTEGER DEFAULT 0,
  errors       INTEGER DEFAULT 0,
  error_detail TEXT,
  started_by   INTEGER,   -- user_id
  started_at   TEXT DEFAULT (datetime('now')),
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_type ON job_runs(job_type, id DESC);
```

Each button press inserts a new row at start, updates it with final counts at end. The status endpoint returns the latest row per job type.

### 2.3 New Route File

`src/routes/reanalysis.ts` — mounts `POST /backfill-confidence` and `POST /replay`, exports a Hono app mounted at `/api/admin` in `src/index.ts` behind the existing auth middleware.

---

## 3. Pipeline 1 — Footage Backfill

**Endpoint:** `POST /api/flexcam/backfill`  
**File:** `src/routes/flexcam.ts` (new handler, added after existing routes)

### 3.1 Logic

1. Check `flexcam_enabled = 'true'` in `system_config` — return `503` if not set.
2. Insert a `job_runs` row (`job_type='footage_backfill'`, `status='running'`).
3. Run the following query (batch of 200):

```sql
SELECT ut.id, ut.unit_id, ut.start_time, ut.end_time
FROM unit_trips ut
LEFT JOIN footage_requests fr ON fr.trip_id = CAST(ut.id AS TEXT)
WHERE ut.status = 'closed'
  AND fr.id IS NULL
  AND ut.start_time IS NOT NULL
  AND ut.end_time IS NOT NULL
  AND ut.end_time > datetime('now', '-120 days')
ORDER BY ut.id DESC
LIMIT 200
```

4. For each trip row:
   - Look up `cpg_device_mappings WHERE unit_id=? AND is_active=1 LIMIT 1`
   - If no mapping → `skipped++`
   - Parse `start_time` / `end_time` to epoch ms; if `toTs - fromTs < 80_000` → `skipped++`
   - Call `enqueueFootage(env, { assetId, unitId, cpgDeviceId, tripId, fromTs, toTs, reason: 'trip_auto', channels: ['outside'] })` — idempotent on (asset, from, to, reason)
   - On success → `queued++`; on throw → `errors++`, log message

5. `has_more`: query one extra row (LIMIT 201) to detect whether more trips exist without fetching them.
6. Update `job_runs` row: `status='complete'`, counts, `finished_at`.
7. Return `{ queued, skipped, errors, has_more, job_id }`.

### 3.2 Result Visibility

Queued requests appear immediately on the existing FlexCam page (`/api/flexcam/footage?status=fulfilling`). The per-minute cron converts them to clips over the following minutes with no further action needed.

### 3.3 Constraints

- Capped at 200 trips per invocation to stay within Worker CPU budget.
- Trips older than 120 days are excluded (ClearPath device retention window).
- `enqueueFootage` is idempotent — safe to run the same batch twice.
- If `flexcam_enabled` is not set, the endpoint returns `503` with a message explaining the required config key.

---

## 4. Pipeline 2 — ALPR Confidence Correction

**Endpoint:** `POST /api/alpr/backfill-confidence`  
**File:** `src/routes/reanalysis.ts`

### 4.1 The Bug

The footage path (`src/utils/footage/footageAlpr.ts:150`) and edge path (`src/routes/alpr.ts:1091`) store the raw model confidence directly (e.g., Workers AI emits 0.99 → stored as 0.99). The on-scene path correctly calls `trustScore()`, which hard-caps any single read at **0.84** — one tick below the 0.85 auto-accept gate. Footage and edge captures bypassed this cap, causing some rows to show false 100% confidence and potentially auto-accept.

### 4.2 Correction Formula

Since footage/edge ALPR is always a single-image read (no consensus possible), the correct stored value is:

```
corrected_confidence = MIN(stored_confidence, 0.84)
```

This is exactly what `trustScore()` would have produced for a single read. We cannot reconstruct the original raw value if it was already overwritten, but `MIN(·, 0.84)` is the safe conservative bound.

### 4.3 Logic

Accept an optional `?cursor=N` query param (last processed `vehicle_sightings.id`) to support pagination.

1. Insert a `job_runs` row.
2. Query `vehicle_sightings`:

```sql
SELECT id, plate, confidence
FROM vehicle_sightings
WHERE source IN ('footage', 'edge')
  AND confidence > 0.84
  AND id > ?   -- cursor, default 0
ORDER BY id ASC
LIMIT 500
```

3. For each row:
   - `corrected = Math.min(row.confidence, 0.84)`
   - `UPDATE vehicle_sightings SET confidence=? WHERE id=?`
   - Look up any linked `alpr_captures` row via a join on `vehicle_sightings.id` (the exact FK column name — `sighting_id`, `vehicle_sighting_id`, or similar — must be confirmed by reading `alpr_captures` schema during implementation before writing the UPDATE). Update `plate_confidence` to the same capped value.
   - `corrected++`

4. Write one `audit_log` entry per batch:
   - `action = 'CONFIDENCE_BACKFILL'`
   - `detail = JSON.stringify({ corrected, id_range: [first, last], cursor })`

5. `has_more`: query one extra row (LIMIT 501) to detect remaining work.
6. `next_cursor` = `id` of the last processed row.
7. Update `job_runs`, return `{ corrected, skipped: 0, has_more, next_cursor, job_id }`.

### 4.4 Review Status

`review_status` on `alpr_captures` is **not changed**. If a capture was auto-accepted under the buggy high confidence, that decision is in the audit trail. Retrospective un-accepting would mutate verified intel — affected captures are surfaced to the review queue for human decision instead.

---

## 5. Pipeline 3 — Analytics Replay

**Endpoint:** `POST /api/analytics/replay`  
**File:** `src/routes/reanalysis.ts`

### 5.1 Scope

Two datasets replayed (others deferred due to volume):

| Source (D1) | Target (Iceberg) | Reason |
|-------------|------------------|--------|
| `vehicle_sightings` | `default.alpr_reads` | Core ALPR history; most likely to have gaps |
| `audit_log` | `default.flex_events` | Compliance/audit trail |

GPS breadcrumbs, CFS, citations, incidents deferred — those tables are large and the analytics routes query them from D1 directly for trend queries.

### 5.2 Pre-condition Check

Before emitting anything, the endpoint calls the internal analytics health check:
- If `R2_ANALYTICS_WAREHOUSE` or `R2_SQL_TOKEN` are not bound → return `503` with message: `"Analytics warehouse not provisioned — set R2_ANALYTICS_WAREHOUSE and R2_SQL_TOKEN first"`.

### 5.3 Logic

Accept `?cursor_sightings=N&cursor_audit=N` for independent pagination of the two datasets.

1. Insert a `job_runs` row.
2. Query `vehicle_sightings` batch (500 rows, `id > cursor_sightings`, ASC):
   ```sql
   SELECT id, plate, state, confidence, source, lat, lng, created_at, unit_id
   FROM vehicle_sightings WHERE id > ? ORDER BY id ASC LIMIT 500
   ```
   Map each row to an `alpr_reads` Iceberg event and call `env.ANALYTICS.sendBatch(events)` (one Pipelines call for the whole batch, not 500 individual calls).

3. Query `audit_log` batch (500 rows, `id > cursor_audit`, ASC):
   ```sql
   SELECT id, action, entity_type, entity_id, user_id, detail, created_at
   FROM audit_log WHERE id > ? ORDER BY id ASC LIMIT 500
   ```
   Map each row to a `flex_events` event and call `env.EVENTS.sendBatch(events)`.

4. `has_more`: either dataset still has rows beyond the cursor.
5. `next_cursor_sightings`, `next_cursor_audit` = last `id` processed in each dataset.
6. Update `job_runs`, return `{ replayed, has_more, next_cursor_sightings, next_cursor_audit, job_id }`.

### 5.4 Duplicate Handling

Pipelines is append-only with no built-in dedup. If some events were emitted before a gap, replay will produce duplicate rows in Iceberg. For operational trend queries (volume, counts, coverage) this is tolerable. The admin UI shows a persistent warning on the replay card:

> _"Replay appends to the warehouse. If data was partially emitted previously, counts in the Analytics dashboard may be slightly inflated."_

---

## 6. Admin UI

**Placement:** New `"Reanalysis"` tab in `client/src/pages/admin/AdminPage.tsx` alongside the existing ClearPath GPS / settings tabs.

**New component:** `client/src/pages/admin/AdminReanalysisTab.tsx`

### 6.1 Layout

Three stacked cards, one per pipeline. Each card:
- Title + one-line description
- Last-run stats (from `GET /api/admin/reanalysis/status`) — timestamp, counts
- Run button; label changes to `"Continue (more remaining)"` when `has_more: true`
- Live count update while polling (every 5 s while `job_runs.status = 'running'`)

The ALPR Confidence Fix card includes an extra line of copy:
> _"Sets footage and edge plate confidence to ≤ 0.84 (the honest single-read cap). Does not change review status."_

The Analytics Replay card includes the duplicate warning described in §5.4.

### 6.2 Polling

`useEffect` polls `GET /api/admin/reanalysis/status` every 5 s while any job shows `status='running'`. Stops on `'complete'` or `'failed'`. Cursor state is kept in component state — no page reload needed between batch continuations.

### 6.3 Status Endpoint Response Shape

```json
{
  "footage_backfill": {
    "job_id": 12, "status": "complete", "processed": 47,
    "skipped": 12, "errors": 0, "has_more": false,
    "started_at": "2026-06-16T20:14:00Z", "finished_at": "2026-06-16T20:14:03Z"
  },
  "alpr_confidence": { ... },
  "analytics_replay": { ... }
}
```

---

## 7. Migration

**File:** `migrations/0127_job_runs.sql`

```sql
CREATE TABLE IF NOT EXISTS job_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running',
  total        INTEGER DEFAULT 0,
  processed    INTEGER DEFAULT 0,
  skipped      INTEGER DEFAULT 0,
  errors       INTEGER DEFAULT 0,
  error_detail TEXT,
  started_by   INTEGER,
  started_at   TEXT DEFAULT (datetime('now')),
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_type ON job_runs(job_type, id DESC);
```

Apply to live D1 (`785de7ae`) directly after merge — deploy pipeline is `continue-on-error`.

---

## 8. Files Changed / Created

| File | Change |
|------|--------|
| `migrations/0127_job_runs.sql` | New — job tracking table |
| `src/routes/reanalysis.ts` | New — ALPR confidence + analytics replay endpoints + `GET /status` |
| `src/routes/flexcam.ts` | Add `POST /backfill` handler |
| `src/index.ts` | Mount `reanalysisRouter` at `/api/admin` |
| `client/src/pages/admin/AdminReanalysisTab.tsx` | New — three-card UI |
| `client/src/pages/admin/AdminPage.tsx` | Add Reanalysis tab |

---

## 9. Resolved (originally "Known Limitations")

All five original limitations were resolved in the implementation:

| Original limitation | Resolution |
|---------------------|------------|
| Duplicate Iceberg rows on re-run | `analytics_replayed_at` column on every source table; replay skips rows already marked — safe to run multiple times (mig 0128) |
| Silent skips for units without camera mapping | Footage backfill returns `skipped_units: [{unit_id, trip_id}]`; UI shows expandable list; stored in `job_runs.skipped_detail` |
| Raw confidence unrecoverable | `original_confidence` on `vehicle_sightings` + `original_plate_confidence` on `alpr_captures`; stored before the `MIN(·,0.84)` correction (mig 0128) |
| GPS / CFS / citations / incidents not replayed | All four added to the replay pipeline (6 datasets total: sightings, audit_log, gps_breadcrumbs, calls_for_service, citations, incidents) |
| Fixed batch size caps | Configurable via `system_config` keys `reanalysis_footage_batch` / `reanalysis_confidence_batch` / `reanalysis_replay_batch`; defaults raised to 500 / 1000 / 1000 |
