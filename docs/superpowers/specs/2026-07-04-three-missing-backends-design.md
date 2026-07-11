# Three missing admin/ops backends — design

Date: 2026-07-04

## Context

A broken-functionality audit (post PR #2579) found three client features with
complete UI but no backing server routes/tables:

1. `AdminCourtLookupsTab.tsx` — editable dropdown categories for Court Tracker.
2. `FleetExpensesTab.tsx` — per-vehicle expense tracking.
3. `ScrapersTab.tsx` / `AdminWarrantScrapersTab.tsx` — warrant-source scraper
   ops controls.

A fourth item raised during scoping — 3 rows missing from live `fleet_vehicles`
(autoincrement high-water 4, only 1 row present, no `audit_log` DELETE entry)
— was investigated and closed with **no code change**: the app's own
`DELETE /api/fleet/:id` route ([`src/routes/fleet.ts:1299`](../../../src/routes/fleet.ts))
already soft-deletes (`status='archived'`, `archived_at` set, never a hard
delete), so the loss happened via a raw DB-level operation outside the app.
D1 Time Travel restore is whole-database (not per-table) and this wrangler
version can't inspect a historical bookmark without doing a full restore
first — rolling back the entire live CAD/RMS DB to recover 3 vehicle rows is
not an acceptable trade. No migration/route work follows from this item.

Each of the three remaining items ships as its own PR, its own migration
(where needed), and its own route file changes — no shared code between them
beyond common `src/utils/db.ts` helpers.

---

## 1. Court Lookups CRUD

### Schema

New migration, next free prefix (check `ls migrations | tail` at build time —
was `0169` as of this design):

```sql
CREATE TABLE IF NOT EXISTS court_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  display_label TEXT,
  meta TEXT,
  display_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_court_lookups_category ON court_lookups(category, display_order);
```

Matches the client's `Lookup` interface field-for-field
([`AdminCourtLookupsTab.tsx`](../../../client/src/pages/admin/AdminCourtLookupsTab.tsx)).
No seed data — categories are created implicitly by inserting the first row
(the client already does this via `addCategory()`).

### Routes (`src/routes/court.ts`, mounted under existing `/api/court`)

- `GET /lookups/categories` → `SELECT category, COUNT(*) as count FROM court_lookups GROUP BY category ORDER BY category`
- `GET /lookups?category=X&includeInactive=true` → filtered list, ordered by `display_order`
- `POST /lookups` → insert (category + value required)
- `PUT /lookups/:id` → partial update (matches client's partial-`draft` PUT pattern, e.g. `{is_active}`-only toggles)
- `DELETE /lookups/:id` → hard delete (per the client's own confirm-dialog copy: "Existing court events... will keep their value as free text" — no FK to preserve)

Auth: mounted under `/api/court`, which already requires auth. Write ops
(`POST`/`PUT`/`DELETE`) additionally require `admin` role, matching this
tab's placement under `AdminPage`.

---

## 2. Fleet Expenses CRUD

### Schema

```sql
CREATE TABLE IF NOT EXISTS fleet_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'registration','tolls','parking','car_wash','tickets','towing','permits',
    'insurance','equipment','decals_wraps','storage','roadside_assistance',
    'inspection','electronics','accessories','misc'
  )),
  amount REAL NOT NULL,
  vendor TEXT,
  description TEXT,
  odometer_reading INTEGER,
  recurring INTEGER NOT NULL DEFAULT 0,
  recurring_frequency TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fleet_expenses_vehicle ON fleet_expenses(vehicle_id, expense_date);
```

`CHECK` constraint mirrors `FleetExpenseCategory` in `client/src/types.ts` —
adding a category later needs a migration, matching this repo's convention
elsewhere (e.g. `warrant_scraper_config.source_type`).

### Routes (`src/routes/fleet.ts`)

- `GET /:vehicleId/expenses` → list, newest first
- `POST /:vehicleId/expenses` → insert
- `PUT /expenses/:id` → update
- `DELETE /expenses/:id` → hard delete (financial line-item corrections; no
  downstream FK)

Auth: gated the same way as this file's other mutating routes — the
`MANAGER_ROLES` set already checked by the top-of-file write gate
(`fleet.ts:26-29`) covers `POST/PUT/DELETE` automatically; no new middleware
needed.

---

## 3. Warrant Scraper Ops (list, health, trigger, reset-circuit, bulk)

### Reality check vs. the original ask

The original ask described only `trigger`/`reset-circuit` as missing. Actual
state: **the entire `/api/warrants/scrapers*` surface is unbuilt** — `GET /`,
`GET /health`, and `POST /bulk` (consumed by the *other*, already-existing
`AdminWarrantScrapersTab.tsx`) are equally absent. Scope expands to cover
both client tabs off one shared backend, per your "minimal real version"
call — no run-history table, no percentile latency, no A–F health grades
this round.

### Schema (small addition, no new table)

```sql
ALTER TABLE warrant_scraper_config ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0;
```

`circuit_broken` is derived at request time by feeding `consecutive_errors`
into the existing pure `isCircuitOpen()` in
[`src/utils/warrantSources/resilience.ts`](../../../src/utils/warrantSources/resilience.ts)
(threshold 5) — no new column needed for the flag itself.

### Routes (new `src/routes/scrapers.ts`, mounted at `/api/warrants/scrapers`)

- `GET /` → union of `warrant_scraper_config` rows (Utah + legacy counties)
  and `national_warrant_sources` rows (the federated multi-state pull),
  normalized into the client's `ScraperSource` shape. `metrics_24h` ships as
  a zeroed/null placeholder block (`total_runs: 0`, `health_grade: null`,
  etc.) — documented in the response as not-yet-computed rather than faked.
- `GET /health` → rollup counts (`healthy`/`degraded`/`failed`/
  `circuit_broken`/`total`) derived from the same union, no separate query.
- `POST /:key/trigger` → looks up the source by key across both tables,
  runs it on-demand: Utah key → `runUtahWarrantScan(db)`; any other
  configured/enabled key → the matching adapter via `getEnabledAdapters` +
  the scraped-source leg of `runScan.ts`. Synchronous within the request
  (single-source runs are bounded; no queue needed).
- `POST /:key/reset-circuit` → `UPDATE warrant_scraper_config SET
  consecutive_errors = 0 WHERE source_name = ?` (or the `national_warrant_sources`
  equivalent — needs its own `consecutive_errors` column added by the same
  migration, since it currently has none).
- `POST /bulk` → `{source_keys: string[], enabled: boolean}` → bulk
  `enabled` toggle across both tables (backs `AdminWarrantScrapersTab`).

Auth: admin-only for `trigger`/`reset-circuit`/`bulk` (operational controls);
`GET` routes require auth only, matching the rest of `/api/warrants`.

### Out of scope (documented, not silently dropped)

- `scraper_runs` history table, percentile latency, health-grade computation,
  WebSocket `scraper_events` fan-out — the client types describe these but
  building them is a follow-up PR if the ops team wants the full dashboard
  back.
