# Stacked Dispatch Call Linking

**Date:** 2026-08-14  
**Status:** Approved — pending implementation  
**Branch:** `claude/stacked-dispatch-linking-294623`

---

## Overview

When multiple active calls exist at the same address ("stacked calls"), officer activity written to any one call automatically propagates to all siblings in the stack. This eliminates duplicate data entry and ensures every call in a stack reflects a consistent operational picture.

**What syncs bidirectionally across a stack:**
- Unit assignment (`assigned_unit_ids`, `unit_call_signs`)
- Timestamps (`dispatched_at`, `enroute_at`, `onscene_at`)
- Mileage (`starting_mileage`, `ending_mileage`)

**What does NOT sync:**
- Call status (each call clears independently)
- Narrative / notes
- Persons, vehicles, businesses linked to the call
- Disposition, incident type, priority, or any other call-specific fields

---

## Schema Change

**Migration: `0248_stack_group_id.sql`**

```sql
ALTER TABLE calls_for_service_ext ADD COLUMN stack_group_id TEXT;
CREATE INDEX idx_cfs_ext_stack_group
  ON calls_for_service_ext(stack_group_id)
  WHERE stack_group_id IS NOT NULL;
```

One nullable `TEXT` column on `calls_for_service_ext` (the 1:1 overflow table — base `calls_for_service` is at the D1 100-column hard cap). A UUID string shared by all calls in the same stack. `NULL` = solo call (not stacked).

---

## Stack Group Lifecycle

**Active status set** (same filter the client uses for the stacked badge):  
`status IN ('pending', 'dispatched', 'enroute', 'onscene', 'on_hold')`

| Event | Action |
|---|---|
| **Call created** | Query ext for any active sibling with the same `location_address` (trimmed, case-insensitive). If found and sibling has a group: assign sibling's `stack_group_id` to new call's ext row. If found but sibling has no group: mint a new UUID, assign to both. If none found: leave `stack_group_id = NULL`. |
| **Address updated** | Leave old group (dissolve if ≤1 member remains). Re-run creation logic against new address. |
| **Call closed / cleared / cancelled / merged / archived** | Set `stack_group_id = NULL` on the closing call. If exactly one member remains in the group, set their `stack_group_id = NULL` too — no singleton groups. |

---

## Sync Field Matrix

Fan-out runs after the primary write succeeds, via `syncToStack()`. A sync failure never blocks the primary response — wrapped in try/catch + `log.error` and degrades gracefully.

| Field | Table | Sync Behavior |
|---|---|---|
| `assigned_unit_ids` | `calls_for_service` | **Merge** — union of JSON arrays, deduplicated by unit ID |
| `unit_call_signs` | `calls_for_service` | **Merge** — append new call sign if absent |
| `dispatched_at` | `calls_for_service` | **Fill-only** — `COALESCE(existing, new_value)` |
| `enroute_at` | `calls_for_service` | **Fill-only** — `COALESCE(existing, new_value)` |
| `onscene_at` | `calls_for_service` | **Fill-only** — `COALESCE(existing, new_value)` |
| `starting_mileage` | `calls_for_service` | **Fill-only** — `COALESCE(existing, new_value)` |
| `ending_mileage` | `calls_for_service` | **Overwrite** — most recent write wins |

**Unit `current_call_id`:** Stays on the call the unit was actually dispatched to. Siblings receive the unit in their `assigned_unit_ids` (informational — they show who is working the scene) but the unit's own status lifecycle (cleared, available, etc.) is tied to their primary call. This prevents double-clearing a unit.

---

## New Utility: `src/utils/stackSync.ts`

Four exported async functions. All D1 writes use `queryInChunks` / `db.batch()` to respect the 100-bound-parameter cap.

```ts
assignStackGroup(db: D1Database, callId: number, address: string): Promise<void>
// Called on call creation. Finds or mints a stack_group_id for the call.

leaveStackGroup(db: D1Database, callId: number): Promise<void>
// Called on call closure. Dissolves singleton groups.

reassignStackGroup(db: D1Database, callId: number, newAddress: string): Promise<void>
// Called on address update. Leaves old group, assigns new one.

syncToStack(
  db: D1Database,
  stackGroupId: string,
  sourceCallId: number,
  fields: {
    units?: { ids: number[]; callSigns: string[] };
    timestamps?: Partial<Pick<CfsRow, 'dispatched_at' | 'enroute_at' | 'onscene_at'>>;
    mileage?: Partial<Pick<CfsRow, 'starting_mileage' | 'ending_mileage'>>;
  }
): Promise<void>
// Fans out field writes to all siblings in the stack group.
// Uses fill-only semantics for timestamps and starting_mileage.
// Uses merge semantics for unit arrays.
// Uses overwrite semantics for ending_mileage.
```

---

## Route Changes

### `src/routes/dispatch/calls.ts`

**`POST /dispatch/calls` (call creation)**
After inserting the ext row: `await assignStackGroup(db, newCallId, locationAddress)`.

**`POST /dispatch/calls/:id/status`**
- After writing `dispatched_at` / `enroute_at` / `onscene_at`: read `stack_group_id` from ext; if set, call `syncToStack(...)` with the relevant timestamps and updated unit arrays.
- On terminal status (`cleared / closed / cancelled / merged / archived`): call `leaveStackGroup(db, callId)`.

**`PUT /dispatch/calls/:id`** (general call update)
- If `location_address` changed: call `reassignStackGroup(db, callId, newAddress)`.
- If `starting_mileage` or `ending_mileage` changed: call `syncToStack(...)` with mileage fields.

**Unit assignment paths** (wherever `assigned_unit_ids` is written)
After updating the source call: read `stack_group_id`; if set, call `syncToStack(...)` with merged unit arrays.

---

## Error Handling

- All `syncToStack` calls are fire-and-degrade: wrapped in try/catch, errors logged via `log.error` with `{ stackGroupId, sourceCallId }`, never thrown.
- `assignStackGroup` and `leaveStackGroup` failures are logged but do not fail the primary operation.
- A sync that partially succeeds (some siblings updated, some failed) is acceptable — the next write to any call in the stack will fill remaining gaps via the fill-only semantics.

---

## Testing

**Worker unit tests (`tests/stackSync.test.ts`)**
- `assignStackGroup`: no active sibling → NULL; active sibling with group → inherits; active sibling without group → mints and assigns to both; multiple active siblings → all share one group.
- `leaveStackGroup`: leaving a two-member group → singleton dissolved; leaving a three-member group → remaining two keep the group.
- `syncToStack`: timestamps fill-only (does not overwrite); `ending_mileage` overwrites; unit arrays merge and deduplicate.

**Integration smoke test (`test-workers/stackSync.test.ts`)**
- Create two calls at the same address → both get same `stack_group_id`.
- Status update on call A → `enroute_at` propagated to call B.
- Unit dispatched to call A → appears in `assigned_unit_ids` of call B.
- Call A cleared → call A loses group, call B becomes solo (NULL).

---

## Implementation Order

1. Migration `0248_stack_group_id.sql`
2. `src/utils/stackSync.ts` — utility functions + unit tests
3. Wire `assignStackGroup` into call creation (`POST /dispatch/calls`)
4. Wire `leaveStackGroup` into call status terminal transitions
5. Wire `syncToStack` into status handler (timestamps + units)
6. Wire `syncToStack` into general update handler (mileage)
7. Wire `reassignStackGroup` into address update path
8. Integration tests
9. Apply migration to live D1 via `scripts/apply-migration.sh`
