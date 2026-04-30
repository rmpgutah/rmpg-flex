# Phase 5 — ALPR (License Plate Recognition) Design

**Date:** 2026-04-29
**Status:** Design — locked decisions captured below; ready for implementation planning.
**Continuation of:** Phase 0–4 dashcam-AI work (already shipped). ALPR is item #11 from [docs/plans/2026-04-29-roadmap-75-enhancements.md](2026-04-29-roadmap-75-enhancements.md).
**Author:** Co-designed with chzamo@rmpgutah.us via the brainstorming skill.

---

## Locked design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Use case | **Hot-hit + 1-year history** | Maximum operational utility; investigative search across months. Heaviest legal exposure accepted. |
| Inference topology | **Pure edge (Jetson)** | Real-time alerts; offline-resilient; bandwidth-economical (~30 MB/cruiser/day). Works with the existing Phase-0 edge runner. |
| Access control | **Trust-but-verify with review queue** | All officers can search; lookback >30 days creates a supervisor review-queue entry with required justification text. |
| OCR engine | **fast-plate-ocr (Apache 2.0)** + YOLO-NAS plate detector | License-clean; explicitly avoid OpenALPR (AGPL) — would force open-sourcing all of Flex. |
| Image retention | 90 days | Plate-crop JPEGs stored for verification. Metadata kept 1 year. |
| Evidence chaining | Hot hits only | Routine reads (5k/cruiser/day) would explode the chain to ~1.8M entries/year that no one would audit. |
| Hot-hit alert recipients | Officer in unit + on-shift dispatcher + nearest unit (within 1 mi) | Officer needs awareness; dispatcher needs the broader picture; nearest unit may need to assist. |

---

## Architecture overview

```
┌───────────────────────────────────────────────────────────┐
│ JETSON ORIN NANO (per cruiser)                            │
│                                                           │
│   front camera ──▶ YOLO plate detector ──▶ crop region    │
│                          │                                │
│                          ▼                                │
│                  fast-plate-ocr ──▶ plate text + conf     │
│                          │                                │
│                          ▼                                │
│             local hotlist cache (refreshed every 5m)      │
│                          │                                │
│            ┌─────────────┴─────────────┐                  │
│            ▼                           ▼                  │
│      MATCH (hot hit)            NO MATCH (routine)        │
│            │                           │                  │
│            ▼                           ▼                  │
│      POST immediately           batch every 30s           │
│      /api/alpr/reads            /api/alpr/reads           │
│      (HMAC, urgent=true)                                  │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
┌───────────────────────────────────────────────────────────┐
│ FLEX SERVER                                               │
│                                                           │
│   /api/alpr/reads  ──▶ alpr_reads (1-year retention)      │
│        │                                                  │
│        ├─▶ store plate-crop JPEG via storageAdapter       │
│        │     (90-day retention)                           │
│        │                                                  │
│        ├─▶ if is_hot_hit:                                 │
│        │     - record evidence_hashes entry (signed)      │
│        │     - WebSocket broadcast 'alpr_hot_hit'         │
│        │     - fanout: officer / dispatcher / nearest     │
│        │                                                  │
│        └─▶ if NOT hot_hit: just persist                   │
│                                                           │
│   /api/alpr/hotlist  ──▶ aggregated from:                 │
│        bolos + warrants + stolen_vehicles + alpr_hotlist  │
│        (operator-defined). 5-min cache.                   │
│                                                           │
│   /api/alpr/search  ──▶ alpr_search_audit                 │
│        + alpr_review_queue if lookback > 30 days          │
└───────────────────────────────────────────────────────────┘
```

---

## Data model

Four new tables + a small extension to `driving_events`. All migrations land in `server/src/models/database.ts` using the established `db.prepare(...).run()` pattern.

### `alpr_reads` — every plate read, hot or not

```sql
CREATE TABLE IF NOT EXISTS alpr_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER,
  officer_id INTEGER,
  device_id TEXT,
  plate TEXT NOT NULL,            -- normalized: uppercase, alphanumeric only
  state TEXT,                     -- inferred from plate format; nullable
  confidence REAL,                -- 0.0..1.0 from OCR
  latitude REAL,
  longitude REAL,
  heading REAL,
  speed_mph REAL,
  read_at TEXT NOT NULL,          -- ISO timestamp from edge
  frame_object_key TEXT,          -- file:// or s3:// to plate crop JPEG
  source TEXT NOT NULL DEFAULT 'flex_ai',
  is_hot_hit INTEGER DEFAULT 0,
  hit_type TEXT,                  -- 'bolo' | 'warrant' | 'stolen' | 'user_list' | NULL
  hit_reference_id INTEGER,       -- FK to bolos / warrants / stolen / alpr_hotlist
  hit_reference_table TEXT,       -- which table the FK points to
  raw_json TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_alpr_reads_plate ON alpr_reads(plate, read_at);
CREATE INDEX idx_alpr_reads_unit_time ON alpr_reads(unit_id, read_at);
CREATE INDEX idx_alpr_reads_hot_hit ON alpr_reads(is_hot_hit, read_at)
  WHERE is_hot_hit = 1;
CREATE INDEX idx_alpr_reads_geo ON alpr_reads(latitude, longitude, read_at);
CREATE INDEX idx_alpr_reads_time ON alpr_reads(read_at);  -- retention purge
```

Estimated size: ~5,000 reads/cruiser/day × 15 cruisers × 365 days ≈ 27 M rows/year. SQLite with proper indexes handles that fine; queries against `plate` index return in <50ms.

### `alpr_hotlist` — operator-defined plates of interest

```sql
CREATE TABLE IF NOT EXISTS alpr_hotlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT NOT NULL,
  state TEXT,
  reason TEXT NOT NULL,           -- free text, displayed on hit
  severity TEXT NOT NULL DEFAULT 'warning',
                                   -- 'info' | 'warning' | 'alert' | 'critical'
  added_by_user_id INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at TEXT,                -- NULL = no expiry
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

CREATE INDEX idx_alpr_hotlist_plate ON alpr_hotlist(plate)
  WHERE is_active = 1;
```

### `alpr_search_audit` — every search query

```sql
CREATE TABLE IF NOT EXISTS alpr_search_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  searched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  query_plate TEXT,
  query_lookback_days INTEGER,
  query_geo_bounds TEXT,          -- JSON {minLat, maxLat, minLng, maxLng}
  query_unit_id INTEGER,
  results_count INTEGER,
  justification TEXT,             -- required when lookback > 30
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX idx_alpr_search_audit_user_time ON alpr_search_audit(user_id, searched_at);
CREATE INDEX idx_alpr_search_audit_lookback ON alpr_search_audit(query_lookback_days, searched_at);
```

### `alpr_review_queue` — supervisor review for deep-history searches

```sql
CREATE TABLE IF NOT EXISTS alpr_review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_audit_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
                                   -- 'pending' | 'approved' | 'flagged'
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reviewer_user_id INTEGER,
  reviewed_at TEXT,
  reviewer_notes TEXT,
  FOREIGN KEY (search_audit_id) REFERENCES alpr_search_audit(id)
);

CREATE INDEX idx_alpr_review_queue_status ON alpr_review_queue(status, created_at)
  WHERE status = 'pending';
```

### `driving_events` extension

Add `'alpr_hit'` as a valid `event_type` so hot-hits surface in the existing AAR replay timeline alongside FCW/LDW/impact events. No schema change needed — just an addition to the validator in `dashcamAiIngest.ts`.

---

## Edge inference pipeline

New module: `edge/flex_edge/alpr.py`

### Pipeline stages

```python
# Per video frame (running at 5 fps when cruiser is moving > 5 mph)
1. YOLO-NAS detector — detect plate-shaped bounding boxes (~30ms on Orin Nano)
2. For each detection with confidence > 0.6:
   a. Crop the plate region
   b. fast-plate-ocr → plate text + per-character confidence
   c. Normalize: uppercase, strip non-alphanumeric
   d. Local dedup: skip if same plate seen within last 60s
   e. Hot-list match (local cache):
      - if match: package urgent payload, POST immediately
      - if no match: append to batch buffer
3. Every 30s: flush batch buffer to /api/alpr/reads
```

### Hot-list sync

```python
# Every 5 minutes
GET /api/alpr/hotlist  # returns {plates: [{plate, severity, reference}], etag}
# Cache locally as a Python set for O(1) membership check
# Etag-based cache: server returns 304 if unchanged → no re-download
```

### Bandwidth estimate

| Activity | Per cruiser/day |
|---|---|
| Routine reads (~5,000 × 50 KB JPEG + 200 B JSON) | ~250 MB |
| Hot-hit reads (~5 × 50 KB JPEG + 500 B JSON) | <1 MB |
| Hotlist sync (288 polls × 1-5 KB compressed) | <2 MB |
| **Total** | **~250 MB/day** |

Within the 10 GB/mo Verizon BizFleet plan budget per cruiser.

### CPU/GPU budget on Jetson

| Pipeline | Load |
|---|---|
| YOLO-NAS detector @ 5 fps | ~15% TensorRT engine util |
| fast-plate-ocr per detection | ~3 ms per crop |
| Existing FCW/LDW/DMS (Phase 1) | ~40% GPU |
| **Total when ALPR enabled** | **~60% GPU util** — fits |

---

## Server routes

All under `/api/alpr/*`, JWT-authenticated. Edge upload also accepts HMAC via the existing `dashcam-ai` pattern (router-level query-token promotion for `?token=` from edge clients without Authorization header capability).

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/alpr/reads` | POST | HMAC | Edge ingest (single hot-hit OR batch of routine reads) |
| `/api/alpr/hotlist` | GET | JWT or HMAC | Aggregated hotlist for edge sync; ETag-cached |
| `/api/alpr/hotlist` | POST | JWT (admin/manager/supervisor) | Add operator plate to `alpr_hotlist` |
| `/api/alpr/hotlist/:id` | DELETE | JWT (admin/manager/supervisor) | Soft-delete entry (`is_active=0`) |
| `/api/alpr/hotlist` | GET (different params) | JWT | Operator-facing list view |
| `/api/alpr/search` | POST | JWT | Search reads; auto-creates audit + review-queue if lookback>30 |
| `/api/alpr/hits/recent` | GET | JWT | Recent hot-hits across fleet (for dashboard) |
| `/api/alpr/review-queue` | GET | JWT (supervisor+) | Pending review entries |
| `/api/alpr/review-queue/:id` | POST | JWT (supervisor+) | Approve / flag with notes |
| `/api/alpr/heatmap` | GET | JWT | Geo-aggregated read counts for map visualization |

### Key route behaviors

**`POST /api/alpr/reads`** — accepts a JSON payload from the edge:
```json
{
  "reads": [
    {
      "plate": "ABC123",
      "state": "UT",
      "confidence": 0.92,
      "latitude": 40.7608,
      "longitude": -111.8910,
      "heading": 270,
      "speed_mph": 35,
      "read_at": "2026-04-29T18:23:45Z",
      "device_id": "jetson-12",
      "unit_id": 12,
      "officer_id": 42,
      "is_hot_hit": true,
      "hit_type": "stolen",
      "hit_reference_id": 9871,
      "frame_base64": "<base64 jpeg of plate crop>"
    }
  ]
}
```

For each read:
1. Decode + store the JPEG via `storageAdapter` (date/unit/plate-{id}.jpg pattern)
2. Insert into `alpr_reads`
3. If `is_hot_hit`:
   - Append to `evidence_hashes` (signed, per Phase 4)
   - WebSocket broadcast `data_changed` with `module='alpr'` `entity='hot_hit'`
   - Lookup nearest unit via `units` GPS within 1 mi; include in broadcast payload
4. Return `{accepted: N, hot_hit_alerted: M}`

**`POST /api/alpr/search`** — accepts:
```json
{
  "plate": "ABC123",         // optional — partial match supported with %
  "lookback_days": 90,
  "unit_id": 12,             // optional
  "geo_bounds": {            // optional
    "min_lat": 40.7, "max_lat": 40.8,
    "min_lng": -111.95, "max_lng": -111.80
  },
  "limit": 100,
  "offset": 0,
  "justification": "Investigating suspect vehicle from case 2026-IA-0042"
}
```

Server:
1. Validates `lookback_days > 30` requires non-empty `justification`
2. Inserts row into `alpr_search_audit`
3. If `lookback_days > 30`: also inserts into `alpr_review_queue` (status=pending)
4. Returns search results AND the new audit_id (so client can show "you'll see this in the review queue") plus matching reads

---

## Client UX

### New page: `client/src/pages/AlprPage.tsx` at `/alpr`

Three tabs:

1. **Search** — plate field, date range, geo bounds (map-draw), unit/officer filters, justification text area (required when lookback>30 — UI enforces). Results in table with map preview + plate-crop thumbnail per row.
2. **Recent hot hits** — last 24h fleet-wide, grouped by hit type (warrant/stolen/etc.), one-click drill-down to the read.
3. **Heatmap** — Google Maps overlay of read density (last 7 days by default), useful for situational awareness.

### Real-time hot-hit alert

`useLiveSync('alpr', refresh, { entities: ['hot_hit'] })` on:
- Officer's MDT (matching unit_id) — full-screen "HOT HIT — STOLEN" banner with audio alert
- DispatchPage — toast at top of the call list
- DashcamAiPage — same toast

Banner includes: plate, state, hit type (stolen/warrant/BOLO), reason, last-known location of the originating record (e.g. stolen-vehicle owner address), photo of subject if BOLO has one.

### Admin tabs (extends `AdminPage.tsx`)

Two new tabs in the **Compliance** category (alongside the existing Evidence Chain tab from PR #402):

1. **ALPR Hotlist** (`AdminAlprHotlistTab.tsx`) — CRUD operator-defined plates; expiry date pickers; severity dropdown.
2. **ALPR Review Queue** (`AdminAlprReviewQueueTab.tsx`) — pending entries from `alpr_review_queue`; supervisor sees query plate, lookback days, requesting officer, justification text, results count; approve / flag with notes.

### MenuBar entries

- Add **ALPR Console** under existing dashcam-AI menu group → routes to `/alpr`

---

## Hot list composition

The `GET /api/alpr/hotlist` aggregator query:

```sql
-- Active operator-defined entries
SELECT plate, state, severity, reason, 'user_list' AS source_table, id AS source_id
FROM alpr_hotlist
WHERE is_active = 1
  AND (expires_at IS NULL OR expires_at > datetime('now', 'localtime'))

UNION ALL

-- Active stolen vehicles
SELECT license_plate AS plate, plate_state AS state,
       'critical' AS severity,
       'Stolen vehicle — ' || stolen_at AS reason,
       'stolen' AS source_table, id AS source_id
FROM stolen_vehicles
WHERE status = 'active'
  AND license_plate IS NOT NULL

UNION ALL

-- Active warrants where vehicle plate is recorded
SELECT v.license_plate AS plate, v.plate_state AS state,
       CASE WHEN w.severity = 'felony' THEN 'critical' ELSE 'alert' END AS severity,
       'Felony warrant — ' || w.subject_name AS reason,
       'warrant' AS source_table, w.id AS source_id
FROM warrants w
JOIN persons p ON w.person_id = p.id
JOIN person_vehicles pv ON pv.person_id = p.id
JOIN vehicles v ON v.id = pv.vehicle_id
WHERE w.status = 'active'
  AND v.license_plate IS NOT NULL

UNION ALL

-- Active BOLOs where vehicle is part of the BOLO
SELECT bv.license_plate AS plate, bv.plate_state AS state,
       'alert' AS severity,
       'BOLO — ' || b.subject_name AS reason,
       'bolo' AS source_table, b.id AS source_id
FROM bolos b
JOIN bolo_vehicles bv ON bv.bolo_id = b.id
WHERE b.status = 'active'
  AND bv.license_plate IS NOT NULL;
```

(Exact column names will be reconciled with current schema during implementation; some of `bolo_vehicles`, `person_vehicles` may need to be added if not present.)

### ETag for cache efficiency

The aggregated hotlist response is small (~5-50 KB) but polled every 5 min by every device. ETag computed as SHA-256 of the sorted JSON; edge devices cache-with-etag → 304 Not Modified saves bandwidth when nothing changed.

---

## Retention + purge

New cron in `server/src/utils/alprRetentionPurger.ts` runs daily:

```typescript
// 1-year metadata retention
DELETE FROM alpr_reads
WHERE read_at < datetime('now', '-365 days', 'localtime')
  AND is_hot_hit = 0;  // hot hits never auto-purge — they're evidence

// 90-day image retention (just clears frame_object_key + deletes file;
// row stays so the read can still appear in search with "image expired")
UPDATE alpr_reads
SET frame_object_key = NULL
WHERE read_at < datetime('now', '-90 days', 'localtime')
  AND frame_object_key IS NOT NULL;

// Then the orphaned files are GC'd by walking the storage dir
```

Hot hits NEVER auto-purge — they're potential evidence. Manual deletion requires admin + audit log entry.

Audit + review queue have their own retention: 7 years (compliance / FOIA).

---

## Search + review queue UX (key flows)

### Officer doing a recent search (lookback=7d)

1. Officer types plate "ABC123" on AlprPage → search button
2. Server inserts `alpr_search_audit` row, lookback_days=7
3. No review-queue entry (lookback ≤ 30)
4. Returns matching reads → table renders with map markers + crop thumbnails

### Officer doing a deep-history search (lookback=180d)

1. Officer types plate, picks "last 6 months" → justification textarea appears, marked required
2. Officer types "Investigating burglary pattern, suspect vehicle seen 2026-01-12"
3. Submit → `alpr_search_audit` row inserted; `alpr_review_queue` row inserted with status=pending
4. UI shows: "Search complete. This deep-history query will appear in the supervisor review queue."
5. Results render normally — search isn't blocked

### Supervisor clearing the queue

1. Supervisor opens Admin → Compliance → ALPR Review Queue
2. Pending entries: requesting officer, query plate, lookback, justification text, results count, time
3. For each entry: **Approve** (default; one-click) or **Flag** (opens notes textarea, status=flagged)
4. Flagged entries surface in officer's record for coaching / IA review

---

## Testing strategy

### Server (TDD throughout, ~30 unit tests)

- `alprPlateNormalizer.ts` — pure function tests (uppercase, strip whitespace, alphanumeric only)
- `alprHotlistAggregator.ts` — tests against in-memory DB seeded with bolos/warrants/stolen/user-list
- `alprSearchAudit.ts` — verifies audit row creation, review-queue creation when lookback>30
- `alprRetentionPurger.ts` — verifies hot hits survive, routine reads age out, images expire at 90d
- Route tests: ingest accepts hot+routine, search enforces justification, review queue gating

### Edge (Python, ~10 unit tests)

- `alpr.py` plate normalization
- Hot-list cache freshness logic
- Local dedup (60s window)

### Manual smoke

1. Configure secrets, start simulator with synthetic plates
2. Add operator hotlist entry for test plate
3. Verify hot-hit lands in `alpr_reads` AND triggers WebSocket alert
4. Run search, verify audit row + (if deep) review queue entry
5. Verify retention purge removes old reads but keeps hot hits

---

## Effort estimate

| Phase | Component | Effort |
|---|---|---|
| 5.1 | Server schema + migrations + types | ½ day |
| 5.2 | Server routes (ingest, hotlist, search, queue) + tests | 2 days |
| 5.3 | Hotlist aggregator + ETag cache | ½ day |
| 5.4 | Edge `flex_edge/alpr.py` module + hotlist sync + tests | 2 days |
| 5.5 | Client AlprPage (search + heatmap + recent hits) | 2 days |
| 5.6 | Hot-hit alert banner + WebSocket fanout | ½ day |
| 5.7 | Admin tabs (Hotlist + Review Queue) | 1 day |
| 5.8 | Retention purge cron | ½ day |
| 5.9 | Documentation (SOP, CLAUDE.md gotcha, API docs) | ½ day |
| **Total** | | **~9 dev-days** |

Plus on-Jetson tuning (false-positive thresholds, region of interest, frame rate tuning per camera) — typically 1-2 weeks of soak time on a pilot vehicle.

---

## Risks + open questions

1. **State-level plate recognition accuracy is limited.** fast-plate-ocr returns a confidence-weighted character sequence; state inference is heuristic (Utah plates have specific format). For now we record state when we can guess it confidently; we don't block matching on state. **Risk:** plate "ABC123" from another state could trigger a hit on a Utah hotlist entry. **Mitigation:** display state alongside plate text; require state match when confidence high; show alert anyway when low.

2. **Real-world false-positive rate on Jetson is unknown** until pilot data exists. Initial threshold: confidence > 0.75 to log a read; > 0.85 to fire a hot-hit alert. Tune during pilot.

3. **Hotlist staleness window.** Edge polls every 5 min; a stolen-vehicle alert added now won't reach the cruiser for up to 5 min. **Mitigation:** server-side WebSocket push of new hotlist entries to edge devices for sub-second urgency. Phase 5 v2 if measured to matter.

4. **Storage growth assumes the bandwidth budget holds.** If officers are in dense plate-traffic environments (highway patrol scenarios), reads/cruiser/day could 10× to 50,000. **Mitigation:** local 60s dedup is the primary lever; tune up to 5 min for highway scenarios.

5. **The 1-year retention is the legal posture you've chosen.** The SOP needs updating to specify FOIA response time, redaction procedure for non-evidence reads, and access-log retention (7 years). Will update [docs/evidence-handling-sop.md](evidence-handling-sop.md) — or possibly a sibling doc for ALPR specifically.

6. **NCIC stolen-vehicle source is currently manual** (operators add to `stolen_vehicles` table). Real-time NCIC sync is roadmap item #47 — orthogonal to ALPR; ALPR works with whatever's in `stolen_vehicles`.

7. **License-plate-state OCR confusion** — Wyoming's bucking-bronco plates and similar artistic plates degrade OCR. Common across all ALPR systems, not unique to us. Confidence threshold mitigates.

---

## What this PR (the design) is and isn't

**This document IS:**
- A locked-decision architecture record
- A scope contract between brainstorming and implementation
- A reference for the implementation-plan PR that follows

**This document IS NOT:**
- An implementation. Code lands in a series of PRs (one per pipeline stage above).
- An SOP. Will write `docs/alpr-handling-sop.md` after the system is built and the pilot reveals operational realities.
- A commitment to ship in any specific order. Phase 5.1 → 5.9 is one valid sequence; others (e.g. ship the search UX before the edge runner using simulated reads) work too.

---

## Next step (per the brainstorming skill)

Hand off to `writing-plans` skill to create a detailed implementation plan from this design.
