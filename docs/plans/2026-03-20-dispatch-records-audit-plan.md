# Dispatch, Records & Incidents Audit Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical data integrity issues, race conditions, and performance bottlenecks across dispatch, records, and incidents systems.

**Architecture:** Database schema migration (new junction table, cascade deletes, composite indexes) → server route updates to use junction table → records/incidents hardening (transaction validation, optimistic locking, input validation) → client updates to consume resolved unit arrays.

**Tech Stack:** SQLite (better-sqlite3), Express/TypeScript, React/TypeScript

---

### Task 1: Create `call_units` Junction Table & Composite Indexes

**Files:**
- Modify: `server/src/models/database.ts:81` (inside `createTables()`)
- Modify: `server/src/models/database.ts:4217` (inside `createIndexes()`)

**Step 1: Add call_units table to createTables()**

After the `units` table definition (line ~195), add:

```sql
CREATE TABLE IF NOT EXISTS call_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  assigned_at TEXT DEFAULT (datetime('now','localtime')),
  unassigned_at TEXT,
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  UNIQUE(call_id, unit_id)
);
```

**Step 2: Add composite indexes to createIndexes()**

Add at end of `createIndexes()`:

```sql
CREATE INDEX IF NOT EXISTS idx_call_units_call ON call_units(call_id);
CREATE INDEX IF NOT EXISTS idx_call_units_unit ON call_units(unit_id);
CREATE INDEX IF NOT EXISTS idx_cfs_status_priority ON calls_for_service(status, priority);
CREATE INDEX IF NOT EXISTS idx_units_officer_status ON units(officer_id, status);
CREATE INDEX IF NOT EXISTS idx_gps_unit_timestamp ON gps_breadcrumbs(unit_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_incidents_location ON incidents(location_address);
```

**Step 3: Add data migration in migrateSchema()**

Add at end of `migrateSchema()` (after line ~1330):

```typescript
// ── CALL_UNITS migration — populate from assigned_unit_ids JSON ──────
try {
  const hasCallUnits = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='call_units'").get();
  if (hasCallUnits) {
    const alreadyMigrated = db.prepare('SELECT COUNT(*) as cnt FROM call_units').get() as any;
    if (alreadyMigrated.cnt === 0) {
      console.log('[Migration] Populating call_units from assigned_unit_ids JSON...');
      const calls = db.prepare("SELECT id, assigned_unit_ids FROM calls_for_service WHERE assigned_unit_ids IS NOT NULL AND assigned_unit_ids != '[]'").all() as any[];
      const insertStmt = db.prepare('INSERT OR IGNORE INTO call_units (call_id, unit_id) VALUES (?, ?)');
      let migrated = 0;
      for (const call of calls) {
        try {
          const unitIds = JSON.parse(call.assigned_unit_ids);
          if (Array.isArray(unitIds)) {
            for (const uid of unitIds) {
              if (typeof uid === 'number' && !isNaN(uid)) {
                // Only insert if unit exists
                const unitExists = db.prepare('SELECT id FROM units WHERE id = ?').get(uid);
                if (unitExists) {
                  insertStmt.run(call.id, uid);
                  migrated++;
                }
              }
            }
          }
        } catch { /* skip malformed JSON */ }
      }
      console.log(`[Migration] Migrated ${migrated} call-unit assignments to call_units table`);
    }
  }
} catch (e) {
  console.warn('[Migration] call_units migration error (non-fatal):', (e as Error).message);
}
```

**Step 4: Verify migration runs**

Run: `cd server && npx tsx src/index.ts` (briefly, check console for migration log)
Expected: `[Migration] Populating call_units from assigned_unit_ids JSON...` and count

**Step 5: Commit**

```bash
git add server/src/models/database.ts
git commit -m "feat(db): add call_units junction table, composite indexes, and data migration"
```

---

### Task 2: Add Helper Functions for call_units Access

**Files:**
- Create: `server/src/utils/callUnits.ts`

**Step 1: Create call_units utility module**

```typescript
import { getDb } from '../models/database';

/** Get all active (non-unassigned) unit IDs for a call */
export function getCallUnitIds(callId: number): number[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT unit_id FROM call_units WHERE call_id = ? AND unassigned_at IS NULL'
  ).all(callId) as { unit_id: number }[];
  return rows.map(r => r.unit_id);
}

/** Get full unit objects for a call (with officer details) */
export function getCallUnitsDetailed(callId: number): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone,
      c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
    FROM call_units cu
    JOIN units u ON cu.unit_id = u.id
    LEFT JOIN users usr ON u.officer_id = usr.id
    LEFT JOIN calls_for_service c ON u.current_call_id = c.id
    WHERE cu.call_id = ? AND cu.unassigned_at IS NULL
  `).all(callId);
}

/** Assign units to a call (inside an existing transaction context) */
export function assignUnitsToCall(callId: number, unitIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO call_units (call_id, unit_id) VALUES (?, ?)'
  );
  for (const uid of unitIds) {
    stmt.run(callId, uid);
  }
}

/** Unassign a unit from a call (soft — sets unassigned_at) */
export function unassignUnitFromCall(callId: number, unitId: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE call_units SET unassigned_at = datetime('now','localtime') WHERE call_id = ? AND unit_id = ? AND unassigned_at IS NULL"
  ).run(callId, unitId);
}

/** Unassign ALL units from a call (for clear/close/archive) */
export function unassignAllUnitsFromCall(callId: number): number[] {
  const db = getDb();
  const unitIds = getCallUnitIds(callId);
  db.prepare(
    "UPDATE call_units SET unassigned_at = datetime('now','localtime') WHERE call_id = ? AND unassigned_at IS NULL"
  ).run(callId);
  return unitIds;
}

/** Batch-fetch units for multiple calls (eliminates N+1) */
export function getUnitsForCalls(callIds: number[]): Record<number, any[]> {
  if (callIds.length === 0) return {};
  const db = getDb();
  const placeholders = callIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT cu.call_id, u.id, u.call_sign, u.status, u.officer_id,
      usr.full_name as officer_name, usr.badge_number
    FROM call_units cu
    JOIN units u ON cu.unit_id = u.id
    LEFT JOIN users usr ON u.officer_id = usr.id
    WHERE cu.call_id IN (${placeholders}) AND cu.unassigned_at IS NULL
  `).all(...callIds) as any[];

  const result: Record<number, any[]> = {};
  for (const cid of callIds) result[cid] = [];
  for (const row of rows) {
    result[row.call_id]?.push(row);
  }
  return result;
}
```

**Step 2: Commit**

```bash
git add server/src/utils/callUnits.ts
git commit -m "feat(dispatch): add call_units utility functions for junction table access"
```

---

### Task 3: Update callActions.ts — Dispatch Route

**Files:**
- Modify: `server/src/routes/dispatch/callActions.ts:1-12` (imports)
- Modify: `server/src/routes/dispatch/callActions.ts:68-163` (dispatch endpoint)
- Modify: `server/src/routes/dispatch/callActions.ts:166-263` (assign-unit endpoint)
- Modify: `server/src/routes/dispatch/callActions.ts:265-338` (unassign-unit endpoint)

**Step 1: Add import**

At line 12 of callActions.ts, add:
```typescript
import { getCallUnitIds, assignUnitsToCall, unassignUnitFromCall, getCallUnitsDetailed } from '../../utils/callUnits';
```

**Step 2: Update dispatch endpoint (POST /calls/:id/dispatch)**

Replace lines 86-105 (the JSON.parse + allUnits + transaction UPDATE) with:

```typescript
    const now = localNow();

    // Transaction: update call + assign units + update unit statuses atomically
    const dispatchTx = db.transaction(() => {
      // Assign units via junction table (idempotent — INSERT OR IGNORE)
      assignUnitsToCall(call.id, unit_ids);

      // Update call status
      db.prepare(`
        UPDATE calls_for_service SET
          status = CASE WHEN status = 'pending' THEN 'dispatched' ELSE status END,
          dispatched_at = COALESCE(dispatched_at, ?),
          dispatcher_id = COALESCE(dispatcher_id, ?)
        WHERE id = ?
      `).run(now, req.user!.userId, call.id);

      // Update each unit status
      for (const unitId of unit_ids) {
        db.prepare(`
          UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ?
          WHERE id = ? AND (current_call_id IS NULL OR current_call_id = ?)
        `).run(call.id, now, unitId, call.id);

        // Log activity
        const unit = db.prepare('SELECT call_sign FROM units WHERE id = ?').get(unitId) as any;
        db.prepare(`
          INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (?, 'unit_dispatched', 'unit', ?, ?, ?)
        `).run(req.user!.userId, unitId, `Dispatched ${unit?.call_sign || unitId} to ${call.call_number}`, req.ip || 'unknown');
      }

      // Keep assigned_unit_ids in sync for backward compatibility
      const allUnitIds = getCallUnitIds(call.id);
      db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
        .run(JSON.stringify(allUnitIds), call.id);
    });
    dispatchTx();
```

**Step 3: Update assign-unit endpoint (POST /calls/:id/assign-unit)**

Replace lines 203-228 (JSON.parse + currentUnits + transaction) with:

```typescript
    const now = localNow();

    // Transaction: assign unit via junction table + update statuses
    const assignTx = db.transaction(() => {
      assignUnitsToCall(call.id, [Number(unit_id)]);

      db.prepare(`
        UPDATE calls_for_service SET
          status = CASE WHEN status = 'pending' THEN 'dispatched' ELSE status END,
          dispatched_at = COALESCE(dispatched_at, ?)
        WHERE id = ?
      `).run(now, call.id);

      db.prepare(`
        UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ?
        WHERE id = ? AND (current_call_id IS NULL OR current_call_id = ?)
      `).run(call.id, now, unit_id, call.id);

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'unit_dispatched', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `Assigned ${unit.call_sign} to ${call.call_number}`, req.ip || 'unknown');

      // Keep assigned_unit_ids in sync
      const allUnitIds = getCallUnitIds(call.id);
      db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
        .run(JSON.stringify(allUnitIds), call.id);
    });
    assignTx();
```

**Step 4: Update unassign-unit endpoint (POST /calls/:id/unassign-unit)**

Replace lines 290-303 (unassignTx body with JSON.parse) with:

```typescript
    const unassignTx = db.transaction(() => {
      // Remove unit from junction table
      unassignUnitFromCall(call.id, Number(unit_id));

      // Update unit: set status to available and clear current_call_id
      db.prepare(`
        UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ?
        WHERE id = ? AND current_call_id = ?
      `).run(now, unit_id, call.id);

      // Log activity
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'unit_unassigned', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `Removed ${unit.call_sign} from ${call.call_number}`, req.ip || 'unknown');

      // Keep assigned_unit_ids in sync
      const allUnitIds = getCallUnitIds(call.id);
      db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
        .run(JSON.stringify(allUnitIds), call.id);
    });
    unassignTx();
```

**Step 5: Update status change — free units on clear/close (lines ~494-508)**

Replace the JSON.parse block with:

```typescript
      // If cleared, closed, cancelled, or archived, free up units
      if (['cleared', 'closed', 'cancelled', 'archived'].includes(status)) {
        const unitIds = getCallUnitIds(call.id);
        for (const unitId of unitIds) {
          const result = db.prepare(`
            UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?
          `).run(now, unitId, call.id);
          if (result.changes > 0) freedUnitIds.push(unitId);
        }
        // Mark all as unassigned in junction table
        unassignAllUnitsFromCall(call.id);
      }
```

Add import for `unassignAllUnitsFromCall` to the imports line.

**Step 6: Update revert status — re-dispatch units (lines ~623-638)**

Replace the JSON.parse block with:

```typescript
      if (['cleared', 'closed'].includes(call.status)) {
        // Get unit IDs from junction table (including recently unassigned)
        const unitIds = db.prepare(
          'SELECT unit_id FROM call_units WHERE call_id = ? ORDER BY assigned_at DESC'
        ).all(call.id).map((r: any) => r.unit_id);

        for (const unitId of unitIds) {
          const prevUnitStatus = previousStatus === 'onscene' ? 'onscene' : previousStatus === 'enroute' ? 'enroute' : 'dispatched';
          const result = db.prepare(`
            UPDATE units SET status = ?, current_call_id = ?, last_status_change = ?
            WHERE id = ? AND (current_call_id IS NULL OR current_call_id = ?)
          `).run(prevUnitStatus, call.id, now, unitId, call.id);
          if (result.changes > 0) {
            revertedUnitIds.push(unitId);
            // Re-activate in junction table
            db.prepare("UPDATE call_units SET unassigned_at = NULL WHERE call_id = ? AND unit_id = ?")
              .run(call.id, unitId);
          }
        }
      }
```

**Step 7: Update serve queue officer lookup (line ~1183)**

Replace:
```typescript
      const unitIds = JSON.parse(call.assigned_unit_ids || '[]');
```
With:
```typescript
      const unitIds = getCallUnitIds(call.id);
```

**Step 8: Batch unit broadcast queries (lines ~130-140)**

Replace the per-unit broadcast loop with batch query:

```typescript
    // Broadcast individual unit updates — batch query instead of N+1
    const updatedUnits = getCallUnitsDetailed(call.id);
    for (const unitData of updatedUnits) {
      if (unit_ids.includes(unitData.id)) {
        broadcastUnitUpdate({ action: 'unit_status_changed', unit: unitData });
      }
    }
```

**Step 9: Commit**

```bash
git add server/src/routes/dispatch/callActions.ts
git commit -m "refactor(dispatch): replace assigned_unit_ids JSON with call_units junction table in callActions"
```

---

### Task 4: Update callLifecycle.ts — Archive/Unarchive Routes

**Files:**
- Modify: `server/src/routes/dispatch/callLifecycle.ts:1-10` (imports)
- Modify: `server/src/routes/dispatch/callLifecycle.ts:70-80` (bulk archive)
- Modify: `server/src/routes/dispatch/callLifecycle.ts:119-127` (single archive)
- Modify: `server/src/routes/dispatch/callLifecycle.ts:185-195` (unarchive)

**Step 1: Add import**

```typescript
import { getCallUnitIds, unassignAllUnitsFromCall } from '../../utils/callUnits';
```

**Step 2: Replace all JSON.parse blocks in archive/unarchive**

Bulk archive (line ~76):
```typescript
        // Free up any assigned units
        const unitIds = getCallUnitIds(call.id);
        for (const unitId of unitIds) {
          freeUnitStmt.run(now, unitId, call.id);
        }
        unassignAllUnitsFromCall(call.id);
```

Single archive (line ~121):
```typescript
        const unitIds = getCallUnitIds(call.id);
        for (const unitId of unitIds) {
          db.prepare(`UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?`)
            .run(now, unitId, call.id);
        }
        unassignAllUnitsFromCall(call.id);
```

Unarchive (line ~191):
```typescript
        const unitIds = db.prepare('SELECT unit_id FROM call_units WHERE call_id = ?').all(call.id).map((r: any) => r.unit_id);
```

**Step 3: Commit**

```bash
git add server/src/routes/dispatch/callLifecycle.ts
git commit -m "refactor(dispatch): use call_units junction table in lifecycle routes"
```

---

### Task 5: Update calls.ts — GET Call Detail with Resolved Units

**Files:**
- Modify: `server/src/routes/dispatch/calls.ts:1-12` (imports)
- Modify: `server/src/routes/dispatch/calls.ts:525-535` (GET /:id detail)
- Modify: `server/src/routes/dispatch/calls.ts:875-880` (duplicate check)

**Step 1: Add import**

```typescript
import { getCallUnitIds, getCallUnitsDetailed, getUnitsForCalls } from '../../utils/callUnits';
```

**Step 2: Update GET /:id to include resolved units**

After fetching the call (around line 525), replace the JSON.parse block:

```typescript
    // Get assigned units from junction table with full details
    const assignedUnits = getCallUnitsDetailed(Number(req.params.id));
    const response = { ...call, assigned_units: assignedUnits };
    res.json(response);
```

**Step 3: Update any other JSON.parse references in calls.ts**

Line ~877 (duplicate check):
```typescript
      const unitIds = getCallUnitIds(call.id);
```

**Step 4: Commit**

```bash
git add server/src/routes/dispatch/calls.ts
git commit -m "refactor(dispatch): return resolved unit objects from call detail endpoint"
```

---

### Task 6: Update aggregates.ts

**Files:**
- Modify: `server/src/routes/dispatch/aggregates.ts:277`

**Step 1: Replace assigned_unit_ids usage**

Find the line:
```typescript
db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
```

Add import and use `getCallUnitIds` if reading, or keep the sync write if it's a write-back operation.

**Step 2: Commit**

```bash
git add server/src/routes/dispatch/aggregates.ts
git commit -m "refactor(dispatch): update aggregates to use call_units"
```

---

### Task 7: Records Hardening — Transaction Validation & Input Validation

**Files:**
- Modify: `server/src/routes/records.ts:574-597` (delete person)
- Modify: `server/src/routes/records.ts:935` (delete vehicle)
- Modify: `server/src/routes/records.ts:1354` (delete evidence)
- Modify: `server/src/routes/records.ts:1611` (delete property)

**Step 1: Add transaction result validation to person delete**

Replace lines 583-592:

```typescript
    let deleted = false;
    const deleteTx = db.transaction(() => {
      db.prepare('DELETE FROM incident_persons WHERE person_id = ?').run(person.id);
      db.prepare('UPDATE vehicles_records SET owner_person_id = NULL WHERE owner_person_id = ?').run(person.id);
      const result = db.prepare('DELETE FROM persons WHERE id = ?').run(person.id);
      deleted = result.changes > 0;
    });
    deleteTx();

    if (!deleted) {
      res.status(500).json({ error: 'Failed to delete person record' });
      return;
    }

    auditLog(req, 'person_deleted', 'person', person.id, `Deleted person record #${person.id}`);
    res.json({ message: 'Person deleted' });
```

**Step 2: Apply same pattern to vehicle, evidence, and property delete endpoints**

Each should check `result.changes > 0` before responding success.

**Step 3: Add coordinate validation helper**

Add to `server/src/middleware/sanitize.ts` or inline:

```typescript
export function validateCoordinates(lat: any, lng: any): string | null {
  if (lat != null) {
    const n = Number(lat);
    if (isNaN(n) || n < -90 || n > 90) return 'Invalid latitude (must be -90 to 90)';
  }
  if (lng != null) {
    const n = Number(lng);
    if (isNaN(n) || n < -180 || n > 180) return 'Invalid longitude (must be -180 to 180)';
  }
  if ((lat != null && lng == null) || (lat == null && lng != null)) {
    return 'Both latitude and longitude must be provided together';
  }
  return null;
}
```

**Step 4: Add date validation helper**

```typescript
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
export function validateDateField(val: any, fieldName: string): string | null {
  if (val == null || val === '') return null;
  if (typeof val !== 'string' || !ISO_DATE_RE.test(val)) {
    return `Invalid ${fieldName} format (use YYYY-MM-DD or ISO 8601)`;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return `Invalid ${fieldName} date value`;
  return null;
}
```

**Step 5: Apply coordinate validation to records.ts person/vehicle create/update**

In person create (around line 460), before the INSERT, add:
```typescript
    const coordErr = validateCoordinates(latitude, longitude);
    if (coordErr) { res.status(400).json({ error: coordErr }); return; }
```

**Step 6: Commit**

```bash
git add server/src/routes/records.ts server/src/middleware/sanitize.ts
git commit -m "fix(records): add transaction validation, coordinate and date input validation"
```

---

### Task 8: Incidents Hardening — Optimistic Locking

**Files:**
- Modify: `server/src/routes/incidents.ts:450-510` (PUT /:id)

**Step 1: Add optimistic locking to incident PUT**

After line 453 (fetching the incident), add version check:

```typescript
    // Optimistic locking: if client sends updated_at, verify it matches
    const clientUpdatedAt = req.body.updated_at;
    if (clientUpdatedAt && clientUpdatedAt !== incident.updated_at) {
      res.status(409).json({
        error: 'This incident has been modified by another user. Please refresh and try again.',
        code: 'CONFLICT',
        server_updated_at: incident.updated_at,
      });
      return;
    }
```

Ensure the UPDATE query always sets `updated_at`:
```typescript
    // Always update the timestamp
    iFields.push('updated_at = ?');
    iValues.push(localNow());
```

**Step 2: Add coordinate validation to incident PUT**

After line 481 (destructuring body), add:
```typescript
    const coordErr = validateCoordinates(latitude, longitude);
    if (coordErr) { res.status(400).json({ error: coordErr }); return; }
```

**Step 3: Commit**

```bash
git add server/src/routes/incidents.ts
git commit -m "fix(incidents): add optimistic locking and coordinate validation"
```

---

### Task 9: Client — Update dispatchMappers.ts

**Files:**
- Modify: `client/src/pages/dispatch/utils/dispatchMappers.ts:24-31`

**Step 1: Update mapDbCall to prefer resolved assigned_units array**

Replace lines 24-31:

```typescript
  // assigned_units — prefer pre-resolved array from server, fall back to parsing assigned_unit_ids
  let assignedUnits: string[] = [];
  if (row.assigned_units && Array.isArray(row.assigned_units)) {
    // Server now returns resolved unit objects
    assignedUnits = row.assigned_units.map((u: any) => u.call_sign || String(u.id || u));
  } else if (row.assigned_unit_ids) {
    try {
      const parsed = JSON.parse(row.assigned_unit_ids);
      assignedUnits = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch { /* ignore */ }
  }
```

**Step 2: Commit**

```bash
git add client/src/pages/dispatch/utils/dispatchMappers.ts
git commit -m "feat(client): support resolved unit objects from server dispatch API"
```

---

### Task 10: Client — Update offlineRouter.ts (Electron)

**Files:**
- Modify: `client/src/services/offlineRouter.ts:191,222,247,274,295,323`

**Step 1: Keep offline router compatible**

The offline router uses its own local SQLite and still needs `assigned_unit_ids` as JSON string. No changes needed here — the offline DB schema will continue using JSON, and the mapper handles both formats now.

**Step 2: Verify no compile errors**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit (if any changes)**

```bash
git add client/src/services/offlineRouter.ts
git commit -m "chore(offline): verify offline router compatibility with call_units migration"
```

---

### Task 11: Build & Smoke Test

**Step 1: Build client**

Run: `cd client && npx vite build`
Expected: Build succeeds with no errors

**Step 2: Start server**

Run: `cd server && npx tsx src/index.ts`
Expected: `Database initialized successfully` with migration logs, no errors

**Step 3: Verify call_units table exists**

```bash
cd server && npx tsx -e "
  const { initDatabase, getDb } = require('./src/models/database');
  initDatabase();
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as cnt FROM call_units').get();
  console.log('call_units rows:', count);
  const schema = db.prepare(\"SELECT sql FROM sqlite_master WHERE name='call_units'\").get();
  console.log('Schema:', schema);
"
```

**Step 4: Commit final**

```bash
git add -A
git commit -m "feat: comprehensive dispatch/records/incidents audit fixes

- Add call_units junction table replacing assigned_unit_ids JSON
- Migrate existing JSON data to junction table
- Add composite indexes for common query patterns
- Fix race conditions in unit dispatch/unassign
- Add transaction result validation on delete operations
- Add optimistic locking on incident updates
- Add coordinate and date input validation
- Batch unit queries to eliminate N+1 patterns
- Keep backward compatibility via assigned_unit_ids sync"
```

---

## Summary of All Changes

| File | Change |
|------|--------|
| `server/src/models/database.ts` | New `call_units` table, composite indexes, data migration |
| `server/src/utils/callUnits.ts` | **NEW** — helper functions for junction table access |
| `server/src/routes/dispatch/callActions.ts` | Replace JSON.parse with call_units queries, batch broadcasts |
| `server/src/routes/dispatch/callLifecycle.ts` | Replace JSON.parse with call_units in archive/unarchive |
| `server/src/routes/dispatch/calls.ts` | Return resolved unit objects, use getCallUnitIds |
| `server/src/routes/dispatch/aggregates.ts` | Update assigned_unit_ids reference |
| `server/src/routes/records.ts` | Transaction validation on deletes, input validation |
| `server/src/routes/incidents.ts` | Optimistic locking, coordinate validation |
| `server/src/middleware/sanitize.ts` | validateCoordinates, validateDateField helpers |
| `client/src/pages/dispatch/utils/dispatchMappers.ts` | Support resolved units + JSON fallback |
