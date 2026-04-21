# Utah Roads Import — Design (v1)

**Date:** 2026-04-20
**Status:** Approved, ready for implementation plan
**Scope:** Statewide import of UGRC SGID Utah Roads dataset into `server/data/rmpg-flex.db` for future address-range geocoding and 911 ESN routing.

## Goals

- Land the Utah Roads attribute + geometry data in SQLite, statewide (~1M segments).
- Ship the address-range interpolation primitive as a tested pure function.
- Defer the geocoding HTTP endpoint until a concrete caller exists.

## Non-goals (v1)

- `GET /api/roads/geocode` endpoint
- Reverse geocode (lat/lng → segment) and any R-tree spatial index
- Map rendering of the road network
- Auto-sync with UGRC publishing cadence
- County-level filtering (statewide chosen)

## Architecture

A one-shot Node script (`server/scripts/import-utah-roads.ts`) is run manually on the VPS after deploy. The script reads the local CSV (attributes) and GeoJSON (geometry) downloads, populates two new SQLite tables, and exits. Schema is defined in `server/src/models/database.ts` so a fresh dev DB has empty tables ready without running the importer.

The importer is **not** wired into server boot. The server treats the new tables as read-only data; nothing in the request path queries them in v1.

## Schema

Added to `server/src/models/database.ts` via the existing `db.prepare('CREATE TABLE IF NOT EXISTS …').run()` pattern (per Gotcha #42, no bulk-execute).

### `roads`
One row per road segment, attributes only.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `utah_road_unique_id` | TEXT UNIQUE NOT NULL | Import key for `INSERT OR IGNORE` |
| `unique_id` | TEXT | UGRC `UniqueID` |
| `full_name` | TEXT | `FullName` |
| `street_name` | TEXT | Normalized: uppercase, strip `.`, collapse whitespace |
| `pre_dir` | TEXT | |
| `post_type` | TEXT | |
| `post_dir` | TEXT | |
| `left_from` / `left_to` | INTEGER | Address range, left side |
| `right_from` / `right_to` | INTEGER | Address range, right side |
| `parity_left` / `parity_right` | TEXT | `O`, `E`, `B`, or null |
| `postal_community_left` / `_right` | TEXT | |
| `zip_left` / `zip_right` | TEXT | |
| `esn_left` / `esn_right` | TEXT | 911 routing |
| `msag_community_left` / `_right` | TEXT | |
| `one_way` | TEXT | |
| `posted_speed` | INTEGER | |
| `dot_functional_class` | TEXT | |
| `county_left` / `county_right` | TEXT | |

Indexes:
- `(street_name, postal_community_left)`
- `(zip_left)`
- `(esn_left)`
- `(esn_right)`

### `road_segments_geom`
Geometry sidecar, lazy-loaded.

| Column | Type | Notes |
|---|---|---|
| `utah_road_unique_id` | TEXT PRIMARY KEY | FK to `roads(utah_road_unique_id)` |
| `geom_json` | TEXT NOT NULL | MultiLineString coords as JSON: `[[[lng,lat],…],…]` |

No spatial index in v1.

## Import script

Path: `server/scripts/import-utah-roads.ts`. Run manually:

```
npx tsx server/scripts/import-utah-roads.ts \
  --csv /path/to/UtahRoads_*.csv \
  --geojson /path/to/UtahRoads_*.geojson
  [--db /opt/rmpg-flex/server/data/rmpg-flex.db]
```

### Flow

1. Open the DB (path defaults to `server/data/rmpg-flex.db`, overridable via `--db`).
2. Ensure tables exist (re-runs the same `CREATE TABLE IF NOT EXISTS` literals as `database.ts`).
3. **Pass 1 — CSV → `roads`:**
   - Stream with `csv-parse`.
   - Wrap inserts in a single `db.transaction(() => {…})()`.
   - `INSERT OR IGNORE` on `utah_road_unique_id`.
   - Normalize `street_name` at insert time.
   - Log every 50k rows: `[roads] 250000 inserted, 12s elapsed`.
4. **Pass 2 — GeoJSON → `road_segments_geom`:**
   - Stream with `stream-json`'s `streamArray` over `features`.
   - Pre-load existing `roads` keys into a `Set<string>` (~16MB for 1M strings) to skip orphans without per-row `SELECT`.
   - For each feature, `JSON.stringify` `geometry.coordinates`, `INSERT OR IGNORE`.
   - Log every 50k rows.
5. Print summary: rows inserted vs skipped per table, total duration, DB file size delta.

### Idempotency

Re-running with the same source files is a no-op (all `INSERT OR IGNORE`).

### Dependencies

Add to `server/package.json`:
- `csv-parse`
- `stream-json`

Both small, well-maintained.

## Geocode helper (pure function)

Path: `server/src/utils/addressRange.ts`. No DB access, no API surface.

```ts
export function interpolateAlongRange(
  houseNumber: number,
  fromAddr: number,
  toAddr: number,
): number;  // 0..1 fraction along the segment, clamped

export function parityMatches(
  houseNumber: number,
  parity: 'O' | 'E' | 'B' | string | null,
): boolean;

export function normalizeStreetName(raw: string): string;
```

### Behavior

- `interpolateAlongRange`: handles ascending and descending ranges, clamps out-of-range, returns `0` if endpoints are equal (no divide-by-zero).
- `parityMatches`: `O` → odd only, `E` → even only, `B` or null → always true.
- `normalizeStreetName`: uppercase, strip `.`, collapse whitespace. Directionals and post-types untouched.

### Tests

Vitest at `server/src/utils/__tests__/addressRange.test.ts`:
- Normal interpolation (100 in 0–200 → 0.5)
- Descending range (100 in 200–0 → 0.5)
- Out-of-range clamp (300 in 0–200 → 1.0)
- Equal endpoints (100 in 100–100 → 0.0)
- Parity edge cases (odd/even/B/null)
- Normalization round-trip (`"S. Main St."` and `"south main street"` → `"S MAIN ST"`)

## Deploy / operations

1. PR contains: schema additions in `database.ts`, `addressRange.ts` + tests, `import-utah-roads.ts`, two new `server/` deps, this design doc.
2. `bash deploy/deploy.sh` ships code; tables auto-created at next service start.
3. One-time manual import on VPS:
   ```
   scp ~/Downloads/UtahRoads_*.csv root@194.113.64.90:/tmp/
   scp ~/Downloads/UtahRoads_*.geojson root@194.113.64.90:/tmp/
   ssh root@194.113.64.90
   cd /opt/rmpg-flex && npx tsx server/scripts/import-utah-roads.ts \
     --csv /tmp/UtahRoads_*.csv --geojson /tmp/UtahRoads_*.geojson
   rm /tmp/UtahRoads_*
   ```
4. Verify:
   ```
   sqlite3 server/data/rmpg-flex.db \
     "SELECT COUNT(*) FROM roads; SELECT COUNT(*) FROM road_segments_geom;"
   ```
   Expect ~1M / ~1M.
5. No service restart required.

## Risks

- **DB grows ~300MB.** Accepted (statewide scope).
- **GeoJSON parse runtime.** 887MB streamed parse: estimate 5–15min one-shot. Acceptable.
- **Husky pre-push runs full server vitest.** `addressRange` tests are pure-function and fast.
- **Gotcha #42** (literal-exec substring): irrelevant — all DDL via `db.prepare().run()`.
- **Gotcha #43** (parallel worktree deploys): standard care; deploy from a single workspace.

## Success criteria

- `roads` and `road_segments_geom` populated with statewide UGRC data on the VPS.
- `npx tsc --noEmit` clean in `server/`.
- `addressRange` vitest passes locally and in pre-push hook.
- Re-running the importer is a no-op.

## Dry run results

**Date:** 2026-04-20
**Platform:** macOS darwin 25.2.0, local dev (worktree `modest-haslett-ea2ab4`)
**Source files:**
- CSV: `~/Downloads/UtahRoads_1295850999259225145.csv` (144 MB, 412,065 data rows)
- GeoJSON: `~/Downloads/UtahRoads_3660517298827247026.geojson` (887 MB)

### Result: BLOCKED — importer bug

The CSV ingestion phase finished in 6.6s but produced only **82 inserted / 412,064 skipped** against a throwaway DB (no prior rows). The geom phase then loaded only 82 keys for its orphan filter, meaning essentially every feature in the 887MB GeoJSON would be classified as an orphan. Run was aborted before completing the geom stream.

### Root cause

`server/scripts/import-utah-roads.ts:94` uses the `??` (nullish-coalescing) fallback:

```ts
utah_road_unique_id: rec.UtahRoadUniqueID ?? rec.UniqueID ?? null,
```

`csv-parse` with `columns: true` yields **empty strings** (`""`) for blank cells, not `null`/`undefined`. `??` only falls through on `null`/`undefined`, so `"" ?? rec.UniqueID` evaluates to `""`. In the real UGRC CSV, the `UtahRoadUniqueID` column is empty for **411,915 of 412,065 rows** (only 232 populated):

```
awk … non-empty: 232  empty: 411915
```

Every row with an empty `UtahRoadUniqueID` gets inserted with `utah_road_unique_id = ""`; the UNIQUE constraint then rejects all subsequent empty-keyed rows via `INSERT OR IGNORE`, yielding the ~82 distinct populated keys plus one empty-string winner.

The GeoJSON features appear to use `UniqueID` (not `UtahRoadUniqueID`) as their stable join key — see `props.UtahRoadUniqueID ?? props.UniqueID` in `importGeoJson()` — confirming that `UniqueID` is the actual primary identifier for the Utah UGRC dataset, and `UtahRoadUniqueID` is a rarely-populated secondary field.

### Partial numbers from the aborted run

- `roads` rows: **82**
- `road_segments_geom` rows: **0** (geom phase killed after `loaded 82 road keys for orphan filter`)
- CSV runtime: **6.6s**
- Geom runtime: n/a (aborted)
- Orphans count: n/a (aborted)
- DB file size at abort: **52 KB**
- Sample MAIN query: returned **0 rows** — none of the 82 inserted rows are in SLC.

### Required fix before retrying

Change line 94 from `??` to `||`, or explicitly treat empty string as missing:

```ts
utah_road_unique_id: (rec.UtahRoadUniqueID || rec.UniqueID) ?? null,
// or:
utah_road_unique_id: rec.UtahRoadUniqueID?.trim() || rec.UniqueID || null,
```

The same `??` pattern appears on lines 95, 107–119 for other fallback columns (`postal_community_*`, `zip_*`, `dot_functional_class`) and should be audited — those fields will also default to `""` instead of the documented fallback column, which may not fail INSERTs but will silently break downstream geocoder lookups on `postal_community_left` / `zip_left`.

### Action

Reopen the importer task, apply the fix, re-run the dry run. Source files confirmed intact at `~/Downloads/UtahRoads_*.{csv,geojson}`.
