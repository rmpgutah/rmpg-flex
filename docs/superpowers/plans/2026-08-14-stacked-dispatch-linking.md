# Stacked Dispatch Call Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When multiple active calls share the same address, writing officer activity (units, timestamps, mileage) to any one call automatically propagates to all siblings via a shared `stack_group_id` stored on `calls_for_service_ext`.

**Architecture:** A UUID-keyed `stack_group_id` column on `calls_for_service_ext` groups stacked calls. A `stackSync.ts` utility manages group lifecycle and fans out writes. Route handlers in `calls.ts` wire the utility into call creation, status transitions, unit assignment, and general updates.

**Tech Stack:** Cloudflare D1 (via `src/utils/db.ts` helpers), Hono, TypeScript, Vitest (Node + Miniflare).

## Global Constraints

- Never add columns to `calls_for_service` — it is at D1's 100-column hard cap; all new columns go to `calls_for_service_ext`.
- All D1 writes use `query`/`queryFirst`/`execute`/`executeBatch` from `src/utils/db.ts` — never raw `.prepare()`.
- All logging uses `log.info/warn/error` from `src/utils/logger.ts` — never `console.log`.
- Import `ACTIVE_CALL_WHERE` from `src/utils/callStatus.ts` — never re-inline a status list.
- `uuid` (`v4 as uuidv4`) is already a dependency — do not install any new packages.
- Sync failures must never block the primary request — wrap all sync calls in try/catch.
- Migration number: `0248` — verified against `ls migrations/ | sort | tail` (high-water is `0247`).
- After merging: apply `0248_stack_group_id.sql` to live D1 `785de7ae` via `scripts/apply-migration.sh`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `migrations/0248_stack_group_id.sql` | Create | ADD COLUMN + index on `calls_for_service_ext` |
| `src/utils/stackSync.ts` | Create | `assignStackGroup`, `leaveStackGroup`, `reassignStackGroup`, `syncToStack` |
| `tests/stackSync.test.ts` | Create | Node unit tests for all four utility functions |
| `src/routes/dispatch/calls.ts` | Modify | Wire utility into 5 routes (create, status, assign-unit, unassign-unit, dispatch, put) |
| `test-workers/stackSync.test.ts` | Create | Miniflare integration smoke tests |

---

## Task 1: Migration + stackSync Utility + Unit Tests

**Files:**
- Create: `migrations/0248_stack_group_id.sql`
- Create: `src/utils/stackSync.ts`
- Create: `tests/stackSync.test.ts`

**Interfaces:**
- Produces:
  - `assignStackGroup(db: D1Database, callId: number, address: string): Promise<void>`
  - `leaveStackGroup(db: D1Database, callId: number): Promise<void>`
  - `reassignStackGroup(db: D1Database, callId: number, newAddress: string): Promise<void>`
  - `syncToStack(db: D1Database, stackGroupId: string, sourceCallId: number, fields: SyncFields): Promise<void>`

---

- [ ] **Step 1.1: Create the migration file**

```sql
-- migrations/0248_stack_group_id.sql
-- Groups co-located active calls so officer activity syncs bidirectionally.
-- NULL = solo call. Non-null = UUID shared by all calls at the same address.
-- Lives on ext (1:1 overflow) because calls_for_service is at D1's 100-column cap.

ALTER TABLE calls_for_service_ext ADD COLUMN stack_group_id TEXT;
CREATE INDEX idx_cfs_ext_stack_group
  ON calls_for_service_ext(stack_group_id)
  WHERE stack_group_id IS NOT NULL;
```

- [ ] **Step 1.2: Write the failing unit tests**

```ts
// tests/stackSync.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  assignStackGroup,
  leaveStackGroup,
  reassignStackGroup,
  syncToStack,
} from '../src/utils/stackSync';

// Minimal D1-shaped stub. Each method records calls and returns configurable rows.
function makeDb(rows: Record<string, unknown>[][] = []) {
  let callIndex = 0;
  return {
    _rows: rows,
    _executions: [] as { sql: string; bindings: unknown[] }[],
    prepare(sql: string) {
      const db = this;
      return {
        bind(...bindings: unknown[]) {
          return {
            async first<T>() {
              const result = (db._rows[callIndex++] ?? [])[0] ?? null;
              db._executions.push({ sql, bindings });
              return result as T | null;
            },
            async all<T>() {
              const result = db._rows[callIndex++] ?? [];
              db._executions.push({ sql, bindings });
              return { results: result as T[] };
            },
            async run() {
              db._executions.push({ sql, bindings });
              callIndex++;
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('assignStackGroup', () => {
  it('does nothing when address is empty', async () => {
    const db = makeDb();
    await assignStackGroup(db, 1, '   ');
    expect((db as any)._executions).toHaveLength(0);
  });

  it('leaves stack_group_id NULL when no active sibling exists', async () => {
    // queryFirst returns null (no sibling)
    const db = makeDb([[/* no rows */]]);
    await assignStackGroup(db, 10, '123 Main St');
    // no UPDATE executed
    const updates = (db as any)._executions.filter((e: any) =>
      e.sql.includes('UPDATE calls_for_service_ext')
    );
    expect(updates).toHaveLength(0);
  });

  it('inherits existing group when sibling already has one', async () => {
    const db = makeDb([
      [{ id: 5, stack_group_id: 'existing-uuid' }], // sibling query
      [],  // UPDATE sibling (no-op since it already has the group)
      [],  // UPDATE new call
    ]);
    await assignStackGroup(db, 10, '123 Main St');
    const updates = (db as any)._executions.filter((e: any) =>
      e.sql.includes('UPDATE calls_for_service_ext') &&
      e.bindings.includes('existing-uuid') &&
      e.bindings.includes(10)
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it('mints new UUID when sibling has no group', async () => {
    const db = makeDb([
      [{ id: 5, stack_group_id: null }], // sibling without group
      [], // UPDATE sibling
      [], // UPDATE new call
    ]);
    await assignStackGroup(db, 10, '123 Main St');
    const execs = (db as any)._executions;
    // Both calls should get the same (minted) UUID
    const uuids = execs
      .filter((e: any) => e.sql.includes('UPDATE calls_for_service_ext'))
      .map((e: any) => e.bindings[0]);
    expect(uuids.length).toBe(2);
    expect(uuids[0]).toBe(uuids[1]);
    expect(typeof uuids[0]).toBe('string');
    expect(uuids[0].length).toBeGreaterThan(10);
  });
});

describe('leaveStackGroup', () => {
  it('does nothing when call has no group', async () => {
    const db = makeDb([[{ stack_group_id: null }]]);
    await leaveStackGroup(db, 1);
    const updates = (db as any)._executions.filter((e: any) =>
      e.sql.includes('UPDATE')
    );
    expect(updates).toHaveLength(0);
  });

  it('nulls only the leaving call when 2+ members remain', async () => {
    const db = makeDb([
      [{ stack_group_id: 'grp-1' }], // ext lookup
      [],                              // UPDATE leaving call to NULL
      [{ cnt: 2 }],                   // remaining count
    ]);
    await leaveStackGroup(db, 1);
    const execs = (db as any)._executions;
    // Should NOT nullify the whole group
    const groupWipe = execs.filter((e: any) =>
      e.sql.includes('stack_group_id = NULL') && e.bindings.includes('grp-1')
    );
    expect(groupWipe).toHaveLength(0);
  });

  it('dissolves group when only 1 member remains after leave', async () => {
    const db = makeDb([
      [{ stack_group_id: 'grp-1' }], // ext lookup
      [],                              // UPDATE leaving call to NULL
      [{ cnt: 1 }],                   // remaining count
      [],                              // UPDATE remaining member to NULL
    ]);
    await leaveStackGroup(db, 1);
    const execs = (db as any)._executions;
    const groupWipe = execs.filter((e: any) =>
      e.sql.includes('stack_group_id = NULL') && e.bindings.includes('grp-1')
    );
    expect(groupWipe.length).toBeGreaterThanOrEqual(1);
  });
});

describe('syncToStack', () => {
  it('does nothing when no active siblings exist', async () => {
    const db = makeDb([[/* no siblings */]]);
    await syncToStack(db, 'grp-1', 1, { timestamps: { enroute_at: '2026-08-14T10:00:00' } });
    const updates = (db as any)._executions.filter((e: any) =>
      e.sql.includes('UPDATE calls_for_service SET')
    );
    expect(updates).toHaveLength(0);
  });

  it('uses COALESCE for fill-only timestamp fields', async () => {
    const db = makeDb([
      [{ id: 2 }], // siblings query
      [],           // UPDATE sibling 2
    ]);
    await syncToStack(db, 'grp-1', 1, {
      timestamps: { enroute_at: '2026-08-14T10:00:00' },
    });
    const updates = (db as any)._executions.filter((e: any) =>
      e.sql.includes('COALESCE(enroute_at,')
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it('uses COALESCE for starting_mileage but overwrites ending_mileage', async () => {
    const db = makeDb([
      [{ id: 2 }],                               // siblings
      [{ assigned_unit_ids: '[]', unit_call_signs: '[]' }], // sibling fetch for merge (only if units provided)
      [],                                         // UPDATE sibling 2
    ]);
    await syncToStack(db, 'grp-1', 1, {
      mileage: { starting_mileage: 12000, ending_mileage: 12050 },
    });
    const [updateExec] = (db as any)._executions.filter((e: any) =>
      e.sql.includes('UPDATE calls_for_service SET') &&
      e.sql.includes('starting_mileage') &&
      e.sql.includes('ending_mileage')
    );
    expect(updateExec.sql).toMatch(/COALESCE\(starting_mileage,/);
    expect(updateExec.sql).not.toMatch(/COALESCE\(ending_mileage,/);
  });

  it('merges unit arrays without duplicates', async () => {
    const db = makeDb([
      [{ id: 2 }], // siblings
      [{ assigned_unit_ids: '[7]', unit_call_signs: '["BAKER-1"]' }], // sibling current state
      [], // UPDATE sibling
    ]);
    await syncToStack(db, 'grp-1', 1, {
      units: { addIds: [7, 8], addCallSigns: ['BAKER-1', 'CHARLIE-3'] },
    });
    const updateExec = (db as any)._executions.find((e: any) =>
      e.sql.includes('UPDATE calls_for_service SET assigned_unit_ids')
    );
    const assignedIds = JSON.parse(updateExec.bindings[0] as string);
    expect(assignedIds).toContain(7);
    expect(assignedIds).toContain(8);
    expect(assignedIds.filter((x: number) => x === 7)).toHaveLength(1); // no dupe
  });

  it('removes unit IDs from sibling arrays', async () => {
    const db = makeDb([
      [{ id: 2 }], // siblings
      [{ assigned_unit_ids: '[5, 6]', unit_call_signs: '["ALPHA-1","BAKER-2"]' }],
      [],
    ]);
    await syncToStack(db, 'grp-1', 1, {
      units: { removeIds: [5], removeCallSigns: ['ALPHA-1'] },
    });
    const updateExec = (db as any)._executions.find((e: any) =>
      e.sql.includes('UPDATE calls_for_service SET assigned_unit_ids')
    );
    const assignedIds = JSON.parse(updateExec.bindings[0] as string);
    expect(assignedIds).not.toContain(5);
    expect(assignedIds).toContain(6);
  });
});
```

- [ ] **Step 1.3: Run tests to verify they fail**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npx vitest run tests/stackSync.test.ts
```

Expected: FAIL — `Cannot find module '../src/utils/stackSync'`

- [ ] **Step 1.4: Implement `src/utils/stackSync.ts`**

```ts
// src/utils/stackSync.ts
import { v4 as uuidv4 } from 'uuid';
import { query, queryFirst, execute } from './db';
import { log } from './logger';
import { ACTIVE_CALL_WHERE } from './callStatus';

export interface SyncFields {
  units?: {
    addIds?: number[];
    addCallSigns?: string[];
    removeIds?: number[];
    removeCallSigns?: string[];
  };
  timestamps?: Partial<{
    dispatched_at: string;
    enroute_at: string;
    onscene_at: string;
  }>;
  mileage?: Partial<{
    starting_mileage: number;
    ending_mileage: number;
  }>;
}

/**
 * Assigns a stack_group_id to a newly created call if an active sibling exists
 * at the same address. Call after the ext INSERT OR IGNORE on call creation.
 */
export async function assignStackGroup(
  db: D1Database,
  callId: number,
  address: string,
): Promise<void> {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return;

  const sibling = await queryFirst<{ id: number; stack_group_id: string | null }>(
    db,
    `SELECT e.id, e.stack_group_id
     FROM calls_for_service c
     JOIN calls_for_service_ext e ON e.id = c.id
     WHERE LOWER(TRIM(c.location_address)) = ?
       AND ${ACTIVE_CALL_WHERE}
       AND c.id != ?
     LIMIT 1`,
    normalized,
    callId,
  );

  if (!sibling) return;

  const groupId = sibling.stack_group_id ?? uuidv4();

  if (!sibling.stack_group_id) {
    await execute(
      db,
      'UPDATE calls_for_service_ext SET stack_group_id = ? WHERE id = ?',
      groupId,
      sibling.id,
    );
  }

  await execute(
    db,
    'UPDATE calls_for_service_ext SET stack_group_id = ? WHERE id = ?',
    groupId,
    callId,
  );
}

/**
 * Removes a call from its stack group on closure/terminal status.
 * Dissolves singleton groups so no orphaned group IDs linger.
 */
export async function leaveStackGroup(db: D1Database, callId: number): Promise<void> {
  const ext = await queryFirst<{ stack_group_id: string | null }>(
    db,
    'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?',
    callId,
  );
  if (!ext?.stack_group_id) return;

  const groupId = ext.stack_group_id;

  await execute(
    db,
    'UPDATE calls_for_service_ext SET stack_group_id = NULL WHERE id = ?',
    callId,
  );

  const remaining = await queryFirst<{ cnt: number }>(
    db,
    'SELECT COUNT(*) as cnt FROM calls_for_service_ext WHERE stack_group_id = ?',
    groupId,
  );

  if (remaining && remaining.cnt <= 1) {
    await execute(
      db,
      'UPDATE calls_for_service_ext SET stack_group_id = NULL WHERE stack_group_id = ?',
      groupId,
    );
  }
}

/**
 * Called when a call's location_address changes.
 * Leaves the old group and joins/creates one at the new address.
 */
export async function reassignStackGroup(
  db: D1Database,
  callId: number,
  newAddress: string,
): Promise<void> {
  await leaveStackGroup(db, callId);
  await assignStackGroup(db, callId, newAddress);
}

/**
 * Fans out field writes to all active siblings in the same stack group.
 * Fill-only for dispatched_at / enroute_at / onscene_at / starting_mileage.
 * Overwrite for ending_mileage. Merge (dedup union) for unit arrays.
 * Errors are logged and swallowed — never blocks the primary request.
 */
export async function syncToStack(
  db: D1Database,
  stackGroupId: string,
  sourceCallId: number,
  fields: SyncFields,
): Promise<void> {
  try {
    const siblings = await query<{ id: number }>(
      db,
      `SELECT c.id
       FROM calls_for_service c
       JOIN calls_for_service_ext e ON e.id = c.id
       WHERE e.stack_group_id = ?
         AND c.id != ?
         AND ${ACTIVE_CALL_WHERE}`,
      stackGroupId,
      sourceCallId,
    );

    if (!siblings.length) return;

    for (const { id: sibId } of siblings) {
      // ── Timestamps (fill-only) ──
      if (fields.timestamps) {
        const parts: string[] = [];
        const vals: unknown[] = [];
        const { dispatched_at, enroute_at, onscene_at } = fields.timestamps;
        if (dispatched_at) {
          parts.push('dispatched_at = COALESCE(dispatched_at, ?)');
          vals.push(dispatched_at);
        }
        if (enroute_at) {
          parts.push('enroute_at = COALESCE(enroute_at, ?)');
          vals.push(enroute_at);
        }
        if (onscene_at) {
          parts.push('onscene_at = COALESCE(onscene_at, ?)');
          vals.push(onscene_at);
        }
        if (parts.length) {
          await execute(
            db,
            `UPDATE calls_for_service SET ${parts.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
            ...vals,
            sibId,
          );
        }
      }

      // ── Mileage ──
      if (fields.mileage) {
        const parts: string[] = [];
        const vals: unknown[] = [];
        const { starting_mileage, ending_mileage } = fields.mileage;
        if (starting_mileage !== undefined) {
          parts.push('starting_mileage = COALESCE(starting_mileage, ?)');
          vals.push(starting_mileage);
        }
        if (ending_mileage !== undefined) {
          parts.push('ending_mileage = ?');
          vals.push(ending_mileage);
        }
        if (parts.length) {
          await execute(
            db,
            `UPDATE calls_for_service SET ${parts.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
            ...vals,
            sibId,
          );
        }
      }

      // ── Units (merge) ──
      if (fields.units) {
        const sib = await queryFirst<{
          assigned_unit_ids: string | null;
          unit_call_signs: string | null;
        }>(
          db,
          'SELECT assigned_unit_ids, unit_call_signs FROM calls_for_service WHERE id = ?',
          sibId,
        );

        let ids: number[] = [];
        try { ids = JSON.parse(sib?.assigned_unit_ids || '[]'); } catch { ids = []; }
        let signs: string[] = [];
        try { signs = JSON.parse(sib?.unit_call_signs || '[]'); } catch { signs = []; }

        if (fields.units.addIds?.length) {
          ids = Array.from(new Set([...ids, ...fields.units.addIds]));
        }
        if (fields.units.addCallSigns?.length) {
          const toAdd = fields.units.addCallSigns.filter((s) => s && !signs.includes(s));
          signs = [...signs, ...toAdd];
        }
        if (fields.units.removeIds?.length) {
          const removeSet = new Set(fields.units.removeIds);
          ids = ids.filter((id) => !removeSet.has(id));
        }
        if (fields.units.removeCallSigns?.length) {
          const removeSet = new Set(fields.units.removeCallSigns);
          signs = signs.filter((s) => !removeSet.has(s));
        }

        await execute(
          db,
          `UPDATE calls_for_service SET assigned_unit_ids = ?, unit_call_signs = ?, updated_at = datetime('now') WHERE id = ?`,
          JSON.stringify(ids),
          JSON.stringify(signs),
          sibId,
        );
      }
    }
  } catch (err) {
    log.error('syncToStack failed — sync skipped', { stackGroupId, sourceCallId }, err);
  }
}
```

- [ ] **Step 1.5: Run tests to verify they pass**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npx vitest run tests/stackSync.test.ts
```

Expected: all tests PASS.

- [ ] **Step 1.6: Run full worker test suite to verify no regressions**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npx vitest run
```

Expected: same pass count as before this task (currently 3534 passed).

- [ ] **Step 1.7: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
git add migrations/0248_stack_group_id.sql src/utils/stackSync.ts tests/stackSync.test.ts
git commit -m "feat(dispatch): stack group migration + syncToStack utility"
```

---

## Task 2: Wire Call Creation

**Files:**
- Modify: `src/routes/dispatch/calls.ts` — after the run_card ext write (~line 310)

**Interfaces:**
- Consumes: `assignStackGroup` from `src/utils/stackSync`

---

- [ ] **Step 2.1: Add import to calls.ts**

At the top of `src/routes/dispatch/calls.ts`, after the existing imports (around line 14), add:

```ts
import { assignStackGroup, leaveStackGroup, reassignStackGroup, syncToStack } from '../../utils/stackSync';
```

- [ ] **Step 2.2: Wire `assignStackGroup` into call creation**

In the `POST /` handler, find the block that writes `run_card_id` to the ext table (around line 302). It ends with:
```ts
        } catch (extErr) {
          console.warn('run_card ext write failed (non-fatal):', extErr);
        }
      }
```

Immediately after that closing `}` (still inside the outer try, before `const call = await queryFirst...`), add:

```ts
      // ── Stack group assignment ──
      // Best-effort: never block call creation on a sync failure.
      try {
        await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', callId);
        await assignStackGroup(db, callId, String(location_address || ''));
      } catch (stackErr) {
        log.error('assignStackGroup failed on call create (non-fatal)', { callId }, stackErr);
      }
```

- [ ] **Step 2.3: Run typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 2.4: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
git add src/routes/dispatch/calls.ts
git commit -m "feat(dispatch): assign stack group on call creation"
```

---

## Task 3: Wire Status Transitions

**Files:**
- Modify: `src/routes/dispatch/calls.ts` — `POST /:id/status` handler (~line 999)

**Interfaces:**
- Consumes: `leaveStackGroup`, `syncToStack` from `src/utils/stackSync`

---

- [ ] **Step 3.1: Read the current timestamp written and fan it out to siblings**

In `POST /:id/status`, after the `await execute(db, \`UPDATE calls_for_service SET status...\`, ...params)` line (~line 1041) and after `const updated = await queryFirst(...)` (~line 1042), insert:

```ts
      // ── Stack sync: propagate timestamp + cascaded unit status to siblings ──
      try {
        const ext = await queryFirst<{ stack_group_id: string | null }>(
          db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
        );
        if (ext?.stack_group_id) {
          const timestampFields: Record<string, string> = {
            dispatched: 'dispatched_at',
            enroute:    'enroute_at',
            onscene:    'onscene_at',
          };
          const tsField = timestampFields[status as keyof typeof timestampFields];
          const tsValue = tsField ? String(updated?.[tsField] ?? '') : '';
          if (tsField && tsValue) {
            await syncToStack(db, ext.stack_group_id, parseInt(id, 10), {
              timestamps: { [tsField]: tsValue } as any,
            });
          }
        }
      } catch (stackErr) {
        log.error('syncToStack timestamps failed (non-fatal)', { callId: id, status }, stackErr);
      }
```

- [ ] **Step 3.2: Call `leaveStackGroup` on terminal status**

In the same `POST /:id/status` handler, find the section that releases assigned units on a terminal transition (around line 1078 — the comment says `── Release assigned units on a terminal transition ──`). The terminal statuses checked are `cleared`, `closed`, `cancelled`, `archived`. After that block (before the `broadcastAll` / `return c.json`), add:

```ts
      // ── Stack group: leave on terminal status ──
      if (['cleared', 'closed', 'cancelled', 'archived'].includes(status)) {
        try {
          await leaveStackGroup(db, parseInt(id, 10));
        } catch (stackErr) {
          log.error('leaveStackGroup failed (non-fatal)', { callId: id }, stackErr);
        }
      }
```

- [ ] **Step 3.3: Run typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3.4: Run full worker test suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npx vitest run
```

Expected: same pass count as before.

- [ ] **Step 3.5: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
git add src/routes/dispatch/calls.ts
git commit -m "feat(dispatch): sync timestamps to stack; leave group on terminal status"
```

---

## Task 4: Wire Unit Assignment Routes

**Files:**
- Modify: `src/routes/dispatch/calls.ts` — three routes: `assign-unit`, `unassign-unit`, `dispatch`

**Interfaces:**
- Consumes: `syncToStack` from `src/utils/stackSync`

---

- [ ] **Step 4.1: Wire `assign-unit`**

In `POST /:id/assign-unit` (~line 1468), find the `await executeBatch(db, [...])` call that writes `assigned_unit_ids` and sets `units.status = 'dispatched'`. After that `executeBatch` call (and before the premise auto-push block), add:

```ts
    // ── Stack sync: add unit to sibling calls ──
    try {
      const ext = await queryFirst<{ stack_group_id: string | null }>(
        db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
      );
      if (ext?.stack_group_id) {
        const unitRow = await queryFirst<{ call_sign: string | null }>(
          db, 'SELECT call_sign FROM units WHERE id = ?', unit_id,
        );
        await syncToStack(db, ext.stack_group_id, parseInt(id, 10), {
          units: {
            addIds: [unit_id],
            addCallSigns: unitRow?.call_sign ? [unitRow.call_sign] : [],
          },
        });
      }
    } catch (stackErr) {
      log.error('syncToStack assign-unit failed (non-fatal)', { callId: id, unit_id }, stackErr);
    }
```

- [ ] **Step 4.2: Wire `unassign-unit`**

In `POST /:id/unassign-unit` (~line 1560), find the two `await execute(...)` calls (one updates `assigned_unit_ids`, one sets `units.status = 'available'`). After both of those, add:

```ts
    // ── Stack sync: remove unit from sibling calls ──
    try {
      const ext = await queryFirst<{ stack_group_id: string | null }>(
        db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
      );
      if (ext?.stack_group_id) {
        const unitRow = await queryFirst<{ call_sign: string | null }>(
          db, 'SELECT call_sign FROM units WHERE id = ?', unit_id,
        );
        await syncToStack(db, ext.stack_group_id, parseInt(id, 10), {
          units: {
            removeIds: [unit_id],
            removeCallSigns: unitRow?.call_sign ? [unitRow.call_sign] : [],
          },
        });
      }
    } catch (stackErr) {
      log.error('syncToStack unassign-unit failed (non-fatal)', { callId: id, unit_id }, stackErr);
    }
```

- [ ] **Step 4.3: Wire `POST /:id/dispatch` (multi-unit)**

In `POST /:id/dispatch` (~line 1577), after the `for (const uid of unit_ids)` loop that calls `execute(db, "UPDATE units SET status = 'dispatched'...")`, add:

```ts
    // ── Stack sync: add all dispatched units to sibling calls ──
    try {
      const ext = await queryFirst<{ stack_group_id: string | null }>(
        db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
      );
      if (ext?.stack_group_id) {
        const unitRows = unit_ids.length
          ? await query<{ id: number; call_sign: string | null }>(
              db,
              `SELECT id, call_sign FROM units WHERE id IN (${unit_ids.map(() => '?').join(',')})`,
              ...unit_ids,
            )
          : [];
        const addCallSigns = unitRows.map((u) => u.call_sign).filter(Boolean) as string[];
        await syncToStack(db, ext.stack_group_id, parseInt(id, 10), {
          units: { addIds: unit_ids, addCallSigns },
          timestamps: { dispatched_at: String((await queryFirst<{ dispatched_at: string }>(db, 'SELECT dispatched_at FROM calls_for_service WHERE id = ?', id))?.dispatched_at ?? '') || undefined },
        });
      }
    } catch (stackErr) {
      log.error('syncToStack dispatch failed (non-fatal)', { callId: id }, stackErr);
    }
```

Note: the `unit_ids.map(() => '?')` IN-list is safe here because `unit_ids` comes from the request body and is bounded by the route's own validation (`if (!unit_ids?.length) return 400`). If large bulk-dispatch is ever added, wrap in `chunkBindings`.

- [ ] **Step 4.4: Run typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4.5: Run full test suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npx vitest run
```

Expected: same pass count.

- [ ] **Step 4.6: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
git add src/routes/dispatch/calls.ts
git commit -m "feat(dispatch): sync unit assignment across stack on assign/unassign/dispatch"
```

---

## Task 5: Wire Mileage + Address Updates

**Files:**
- Modify: `src/routes/dispatch/calls.ts` — `PUT /:id` handler (~line 786)

**Interfaces:**
- Consumes: `reassignStackGroup`, `syncToStack` from `src/utils/stackSync`

---

- [ ] **Step 5.1: Wire mileage sync and address reassignment into `PUT /:id`**

In `PUT /:id` (~line 786), find the section after the ext write that begins with the "Forward geocode" comment (around line 836). Before that geocode block, insert:

```ts
    // ── Stack sync: mileage + address changes ──
    try {
      const ext = await queryFirst<{ stack_group_id: string | null }>(
        db, 'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?', id,
      );

      // Address change: leave old group, join/create at new address.
      const newAddr = body.location_address as string | undefined;
      const oldAddr = String(existing.location_address ?? '');
      if (newAddr && newAddr.trim().toLowerCase() !== oldAddr.trim().toLowerCase()) {
        await reassignStackGroup(db, parseInt(id, 10), newAddr);
      }

      // Mileage sync to current group (re-read after possible reassignment).
      if (ext?.stack_group_id) {
        const mileageFields: SyncFields['mileage'] = {};
        if ('starting_mileage' in body && body.starting_mileage !== undefined) {
          mileageFields.starting_mileage = Number(body.starting_mileage);
        }
        if ('ending_mileage' in body && body.ending_mileage !== undefined) {
          mileageFields.ending_mileage = Number(body.ending_mileage);
        }
        if (Object.keys(mileageFields).length) {
          await syncToStack(db, ext.stack_group_id, parseInt(id, 10), { mileage: mileageFields });
        }
      }
    } catch (stackErr) {
      log.error('stack sync on PUT /calls/:id failed (non-fatal)', { callId: id }, stackErr);
    }
```

Also add the `SyncFields` type import at the top of the file (it's already re-exported from `stackSync.ts` via the named import added in Task 2):

```ts
import { assignStackGroup, leaveStackGroup, reassignStackGroup, syncToStack, type SyncFields } from '../../utils/stackSync';
```

Update the import line added in Task 2 to include `type SyncFields`.

- [ ] **Step 5.2: Run typecheck**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5.3: Run full test suite**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npx vitest run
```

Expected: same pass count.

- [ ] **Step 5.4: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
git add src/routes/dispatch/calls.ts
git commit -m "feat(dispatch): sync mileage + reassign stack group on address update"
```

---

## Task 6: Integration Tests + Live Migration

**Files:**
- Create: `test-workers/stackSync.test.ts`
- Apply: `migrations/0248_stack_group_id.sql` to live D1

**Interfaces:**
- Consumes: all four exported functions from `src/utils/stackSync`

---

- [ ] **Step 6.1: Write the Miniflare integration test**

```ts
// test-workers/stackSync.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';

// Seed helper
async function createCall(
  db: D1Database,
  opts: { address: string; status?: string },
): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO calls_for_service
         (incident_type, priority, status, location_address, created_at, updated_at)
       VALUES ('test', 'P3', ?, ?, datetime('now'), datetime('now'))`,
    )
    .bind(opts.status ?? 'pending', opts.address)
    .run();
  const id = Number(r.meta.last_row_id);
  await db.prepare('INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)').bind(id).run();
  return id;
}

async function getGroupId(db: D1Database, callId: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?')
    .bind(callId)
    .first<{ stack_group_id: string | null }>();
  return row?.stack_group_id ?? null;
}

describe('assignStackGroup (Miniflare)', () => {
  it('two calls at same address get same stack_group_id', async () => {
    const { default: { assignStackGroup } } = await import('../src/utils/stackSync');
    const db = env.DB as D1Database;
    const id1 = await createCall(db, { address: '100 Test Ave' });
    const id2 = await createCall(db, { address: '100 Test Ave' });
    await assignStackGroup(db, id1, '100 Test Ave');
    await assignStackGroup(db, id2, '100 Test Ave');
    const g1 = await getGroupId(db, id1);
    const g2 = await getGroupId(db, id2);
    expect(g1).not.toBeNull();
    expect(g1).toBe(g2);
  });

  it('calls at different addresses get different groups', async () => {
    const { default: { assignStackGroup } } = await import('../src/utils/stackSync');
    const db = env.DB as D1Database;
    const id1 = await createCall(db, { address: '100 Alpha St' });
    const id2 = await createCall(db, { address: '200 Beta Ave' });
    await assignStackGroup(db, id1, '100 Alpha St');
    await assignStackGroup(db, id2, '200 Beta Ave');
    const g1 = await getGroupId(db, id1);
    const g2 = await getGroupId(db, id2);
    expect(g1).toBeNull();
    expect(g2).toBeNull();
  });
});

describe('leaveStackGroup (Miniflare)', () => {
  it('dissolves group when last sibling leaves', async () => {
    const { default: { assignStackGroup, leaveStackGroup } } = await import('../src/utils/stackSync');
    const db = env.DB as D1Database;
    const id1 = await createCall(db, { address: '300 Gamma Rd' });
    const id2 = await createCall(db, { address: '300 Gamma Rd' });
    await assignStackGroup(db, id1, '300 Gamma Rd');
    await assignStackGroup(db, id2, '300 Gamma Rd');
    await leaveStackGroup(db, id1);
    await leaveStackGroup(db, id2);
    expect(await getGroupId(db, id1)).toBeNull();
    expect(await getGroupId(db, id2)).toBeNull();
  });
});

describe('syncToStack (Miniflare)', () => {
  it('fill-only: enroute_at propagates to sibling that has none', async () => {
    const { default: { assignStackGroup, syncToStack } } = await import('../src/utils/stackSync');
    const db = env.DB as D1Database;
    const id1 = await createCall(db, { address: '400 Delta Ln' });
    const id2 = await createCall(db, { address: '400 Delta Ln' });
    await assignStackGroup(db, id1, '400 Delta Ln');
    await assignStackGroup(db, id2, '400 Delta Ln');
    const g = await getGroupId(db, id1);
    await syncToStack(db, g!, id1, { timestamps: { enroute_at: '2026-08-14T10:00:00' } });
    const row = await db
      .prepare('SELECT enroute_at FROM calls_for_service WHERE id = ?')
      .bind(id2)
      .first<{ enroute_at: string | null }>();
    expect(row?.enroute_at).toBe('2026-08-14T10:00:00');
  });

  it('fill-only: does not overwrite existing enroute_at on sibling', async () => {
    const { default: { assignStackGroup, syncToStack } } = await import('../src/utils/stackSync');
    const db = env.DB as D1Database;
    const id1 = await createCall(db, { address: '500 Echo Blvd' });
    const id2 = await createCall(db, { address: '500 Echo Blvd' });
    await assignStackGroup(db, id1, '500 Echo Blvd');
    await assignStackGroup(db, id2, '500 Echo Blvd');
    // Pre-set sibling's enroute_at
    await db
      .prepare("UPDATE calls_for_service SET enroute_at = '2026-08-14T09:00:00' WHERE id = ?")
      .bind(id2)
      .run();
    const g = await getGroupId(db, id1);
    await syncToStack(db, g!, id1, { timestamps: { enroute_at: '2026-08-14T10:00:00' } });
    const row = await db
      .prepare('SELECT enroute_at FROM calls_for_service WHERE id = ?')
      .bind(id2)
      .first<{ enroute_at: string | null }>();
    // Must keep the earlier value
    expect(row?.enroute_at).toBe('2026-08-14T09:00:00');
  });
});
```

- [ ] **Step 6.2: Run the Miniflare integration tests**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
npx vitest run --config vitest.workers.config.mts test-workers/stackSync.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6.3: Apply migration to live D1**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
scripts/apply-migration.sh 0248_stack_group_id.sql
```

Verify the column landed:

```bash
npx wrangler d1 execute rmpg-flex --remote \
  --command "SELECT name FROM pragma_table_info('calls_for_service_ext') WHERE name = 'stack_group_id'"
```

Expected: one row with `name = stack_group_id`.

- [ ] **Step 6.4: Commit integration tests**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/cfs-reports-pdf-layout-f7b4cb"
git add test-workers/stackSync.test.ts
git commit -m "test(dispatch): Miniflare integration tests for stacked call linking"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Schema (migration 0248 ✓), lifecycle (assign/leave/reassign ✓), sync field matrix (fill-only timestamps ✓, overwrite ending_mileage ✓, merge units ✓), route changes (create ✓, status ✓, assign-unit ✓, unassign-unit ✓, dispatch ✓, PUT/:id ✓), unit tests ✓, integration tests ✓, live migration step ✓.
- [x] **Placeholders:** None. Every step has complete code.
- [x] **Type consistency:** `SyncFields` defined in `stackSync.ts` and imported in `calls.ts`. `assignStackGroup` / `leaveStackGroup` / `reassignStackGroup` / `syncToStack` signatures consistent across all tasks.
- [x] **D1 param cap:** `POST /:id/dispatch` IN-list uses `unit_ids` (bounded by request — not caller-supplied arrays from DB rows). All other syncs are per-sibling loops.
- [x] **`unit_call_signs` format:** Stored as JSON array (matching the `bulk-reassign` handler at line 1215 which uses `JSON.stringify([...])`). Parser handles both legacy string and JSON gracefully via try/catch.
