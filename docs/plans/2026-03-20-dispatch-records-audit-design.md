# Dispatch, Records & Incidents — Comprehensive Audit Fix Design

**Date:** 2026-03-20
**Approach:** B — Schema Migration + Code Updates

## Problem Statement

Deep audit of the dispatch, records, and incidents systems revealed structural data integrity issues, race conditions, performance bottlenecks, and missing constraints that can cause real operational problems in a police CAD/RMS environment.

## Critical Findings

### Data Integrity (HIGH)
1. **`assigned_unit_ids` stored as JSON TEXT** — race conditions cause silent unit loss during concurrent dispatch
2. **Missing cascade deletes** — deleting calls/units/users leaves orphaned records across 5+ tables
3. **No optimistic locking** — concurrent incident edits silently overwrite each other
4. **Evidence numbering not unique** — duplicate evidence numbers possible across incidents
5. **Transaction result validation missing** — delete operations report success even on rollback

### Performance (MEDIUM)
6. **N+1 queries** — dispatch unit broadcast loop executes per-unit queries instead of batch
7. **Missing composite indexes** — common filter combinations (status+priority, officer+status) do full scans
8. **Unbounded exports** — 50K row export can exhaust memory

### Validation (LOW-MEDIUM)
9. **No coordinate validation** — lat/lng accept values outside valid ranges
10. **No date format validation** — date fields accept arbitrary strings
11. **Archived records leak** — incident-linked persons/vehicles show archived records without indication

## Design

### Phase 1: Schema Migration

#### New Junction Table
```sql
CREATE TABLE IF NOT EXISTS call_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  assigned_at TEXT DEFAULT (datetime('now')),
  unassigned_at TEXT,
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  UNIQUE(call_id, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_call_units_call ON call_units(call_id);
CREATE INDEX IF NOT EXISTS idx_call_units_unit ON call_units(unit_id);
```

#### Cascade Delete Additions (table recreation required for SQLite)
- `units.current_call_id` → `ON DELETE SET NULL`
- `incidents.call_id` → `ON DELETE SET NULL`
- `gps_breadcrumbs.unit_id` → `ON DELETE CASCADE`
- `gps_breadcrumbs.officer_id` → `ON DELETE SET NULL`
- `evidence.incident_id` → `ON DELETE CASCADE`

#### New Composite Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_cfs_status_priority ON calls_for_service(status, priority);
CREATE INDEX IF NOT EXISTS idx_units_officer_status ON units(officer_id, status);
CREATE INDEX IF NOT EXISTS idx_gps_unit_timestamp ON gps_breadcrumbs(unit_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_incidents_location ON incidents(location_address);
```

#### Evidence Uniqueness
```sql
-- Add unique constraint on (incident_id, evidence_number)
```

#### Data Migration
- Parse all existing `assigned_unit_ids` JSON and populate `call_units`
- Keep `assigned_unit_ids` column temporarily for backward compat verification
- Remove column in follow-up release after validation

### Phase 2: Dispatch Route Updates

**Files:** `server/src/routes/dispatch/callActions.ts`, `calls.ts`, `callLifecycle.ts`

- Replace `JSON.parse(assigned_unit_ids)` with `SELECT unit_id FROM call_units WHERE call_id = ?`
- Unit dispatch: `INSERT INTO call_units (call_id, unit_id) VALUES (?, ?)` inside transaction
- Unit unassign: `UPDATE call_units SET unassigned_at = ? WHERE call_id = ? AND unit_id = ?`
- Batch unit queries: single `IN()` query replacing per-unit loop
- All reads/writes of unit assignments inside `db.transaction()`

### Phase 3: Records & Incidents Hardening

**Files:** `server/src/routes/records.ts`, `incidents.ts`

- Add transaction result validation on delete operations (check `.changes > 0`)
- Add coordinate validation: lat [-90, 90], lng [-180, 180]
- Add date format validation (ISO 8601 or YYYY-MM-DD)
- Add `updated_at` optimistic locking on incident PUT (compare version before write)

### Phase 4: Performance Fixes

- Batch unit queries in callActions dispatch broadcast loop
- Composite indexes (covered in Phase 1)
- Export pagination: limit to 10K rows per request with cursor-based pagination

### Phase 5: Client Updates

**File:** `client/src/pages/dispatch/DispatchPage.tsx`

- Update to consume `assigned_units` array from API (already-resolved unit objects)
- Remove client-side `JSON.parse(assigned_unit_ids)` patterns
- Update WebSocket handlers for new broadcast shape

## Out of Scope
- SSN encryption at rest (needs key management design)
- Evidence chain-of-custody restructuring (append-only table is separate effort)
- Zod validation library (keep hand-written validation)
- Full DispatchPage.tsx component decomposition (separate effort)

## Risks
- **Production data migration**: `call_units` population from JSON must handle malformed data gracefully
- **SQLite table recreation**: CASCADE changes require CREATE→COPY→DROP→RENAME pattern
- **Concurrent deploy**: Old clients may still send `assigned_unit_ids` — server should accept both during transition
