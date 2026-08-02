import { describe, it, expect } from 'vitest';
import { collectDailyReport, isEmpty } from '../src/utils/dailyReport/collect';

/** Records every SQL string + bindings, returns canned rows per table. */
function makeDb(rowsByTable: Record<string, unknown[]>) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const ctx = { sql, bindings: [] as unknown[] };
      const stmt = {
        bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
        async all<T>(): Promise<{ results: T[] }> {
          calls.push(ctx);
          const table = Object.keys(rowsByTable).find((t) => new RegExp(`FROM ${t}\\b`).test(sql));
          return { results: (table ? rowsByTable[table] : []) as T[] };
        },
      };
      return stmt;
    },
  } as unknown as Parameters<typeof collectDailyReport>[0];
  return { db, calls };
}

const EMPTY = {};

describe('collectDailyReport', () => {
  it('reports an empty day as empty', async () => {
    const { db } = makeDb(EMPTY);
    const data = await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    expect(data.date).toBe('2026-07-18');
    expect(isEmpty(data)).toBe(true);
  });

  it('carries rows into the right sections', async () => {
    const { db } = makeDb({
      calls_for_service: [{
        call_number: 'C-1', received_at: '2026-07-18 20:00:00', incident_type: 'ALARM',
        priority: 2, location_address: '123 Main', disposition: 'CLEARED',
        status: 'CLOSED', unit_call_signs: '1A1', responding_officer: 'Zamora',
      }],
      fleet_fuel_log: [{
        vehicle_label: 'Unit 1', fuel_date: '2026-07-18 10:00:00', gallons: 12.5,
        total_cost: 50, odometer: 94590, station: 'Maverik',
      }],
    });
    const data = await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    expect(data.operations.calls).toHaveLength(1);
    expect(data.operations.calls[0].call_number).toBe('C-1');
    expect(data.fleet.fuel).toHaveLength(1);
    expect(isEmpty(data)).toBe(false);
  });

  it('binds Denver day bounds in D1 format, never date()', async () => {
    const { db, calls } = makeDb(EMPTY);
    await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      // A stub that filtered in TS would pass regardless — pin the real SQL.
      expect(c.sql).not.toMatch(/\bdate\s*\(/i);
      expect(c.bindings).toContain('2026-07-18 06:00:00');
      expect(c.bindings).toContain('2026-07-19 06:00:00');
    }
  });

  it('never selects * from calls_for_service (100-column cap)', async () => {
    const { db, calls } = makeDb(EMPTY);
    await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    const cfs = calls.filter((c) => /FROM calls_for_service\b/.test(c.sql));
    expect(cfs.length).toBeGreaterThan(0);
    for (const c of cfs) expect(c.sql).not.toMatch(/SELECT\s+\*|SELECT\s+\w+\.\*/i);
  });

  it('never joins through the empty call_units table', async () => {
    const { db, calls } = makeDb(EMPTY);
    await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    for (const c of calls) expect(c.sql).not.toMatch(/\bcall_units\b/);
  });
});
