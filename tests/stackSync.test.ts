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
  // Use a named variable so closures can access _rows/_executions with correct types
  // (TypeScript infers `this` as {} inside nested object literals, losing those props).
  const stub = {
    _rows: rows,
    _executions: [] as { sql: string; bindings: unknown[] }[],
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          return {
            async first<T>() {
              const result = (stub._rows[callIndex++] ?? [])[0] ?? null;
              stub._executions.push({ sql, bindings });
              return result as T | null;
            },
            async all<T>() {
              const result = stub._rows[callIndex++] ?? [];
              stub._executions.push({ sql, bindings });
              return { results: result as T[] };
            },
            async run() {
              stub._executions.push({ sql, bindings });
              callIndex++;
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return stub as unknown as D1Database;
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
