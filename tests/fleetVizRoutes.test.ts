// ============================================================
// /api/fleet-viz/* — schema-drift regression
// ============================================================
// Several /api/fleet-viz routes were 500ing because their SQL still
// targeted columns/tables that don't exist on live D1:
//   • `fleet_maintenance.maintenance_date`  (real col: service_date)
//   • `fleet_maintenance.maintenance_type`  (real col: service_type)
//   • `gps_breadcrumbs.lat/lng/ts`          (real cols: latitude/longitude/recorded_at)
//   • `officers`                            (no such table; use `users`)
//   • `cad_units`                           (no such table; use `units`)
//   • `fleet_fuel_log.driver_id`            (no such col; only driver_name TEXT)
//
// These tests capture the SQL emitted by each handler and assert the
// dead identifiers are gone, so a future re-introduction fails CI
// instead of waiting for a runtime 500 in the Fleet Insights UI.
// ============================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import viz from '../src/routes/fleetViz';
import type { Env } from '../src/types';

// A D1 stub that records every prepared SQL string so the test can
// assert what the handler actually queried. Different from the shared
// `recordingDb` helper, which only captures `.run()` (we need .all/.first
// here because every fleet-viz read uses those).
//
// `.first()` returns `{}` (truthy empty record) by default so handlers
// that do `if (!row) return 404` don't bail before reaching their
// follow-up SELECTs. Pass per-SQL canned rows for `.all()` results.
function inspectingDb(canned: { match: RegExp; rows: Record<string, unknown>[] }[] = []) {
  const queries: string[] = [];
  const resultsFor = (sql: string): Record<string, unknown>[] => {
    for (const c of canned) if (c.match.test(sql)) return c.rows;
    return [];
  };
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      const stmt: {
        bind: (..._args: unknown[]) => typeof stmt;
        all: <T = unknown>() => Promise<{ results: T[] }>;
        first: <T = unknown>() => Promise<T | null>;
        run: () => Promise<{ meta: { changes: number; last_row_id: number } }>;
      } = {
        bind: (..._args: unknown[]) => stmt,
        all: async <T = unknown>() => ({ results: resultsFor(sql) as T[] }),
        first: async <T = unknown>() => (resultsFor(sql)[0] ?? {}) as T | null,
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, queries };
}

function buildApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role: 'admin', full_name: 'Test User' });
    await next();
  });
  app.route('/api/fleet-viz', viz);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db });
}

describe('/api/fleet-viz schema-drift regression', () => {
  it('GET /kpi — references service_date, NOT maintenance_date', async () => {
    const { db, queries } = inspectingDb();
    const res = await buildApp(db)('/api/fleet-viz/kpi');
    expect(res.status).toBe(200);
    const all = queries.join('\n');
    expect(all).toContain('service_date');
    expect(all).not.toContain('maintenance_date');
  });

  it('GET /dossier/:id — uses service_date / service_type, NOT maintenance_*', async () => {
    const { db, queries } = inspectingDb();
    const res = await buildApp(db)('/api/fleet-viz/dossier/1');
    expect([200, 404]).toContain(res.status);
    const all = queries.join('\n');
    // The fix routes WHERE / ORDER BY against service_date and service_type.
    // `maintenance_date AS alias` is allowed (preserves the client JSON
    // contract), but the dead identifiers must not appear as column reads.
    expect(all).toMatch(/WHERE[^]*service_date\s*>=/);
    expect(all).toMatch(/ORDER BY service_date/);
    expect(all).toContain('service_type');
    expect(all).not.toMatch(/WHERE[^]*maintenance_date\s*>=/);
    expect(all).not.toMatch(/ORDER BY maintenance_date/);
    // The dossier SELECT no longer requests `status` — that column doesn't
    // exist on live fleet_maintenance, and it was the third drift hit.
    expect(all).not.toMatch(/SELECT[^]*\bstatus\b[^]*FROM fleet_maintenance/);
  });

  it('GET /fleet-map — reads latitude/longitude/recorded_at, NOT lat/lng/ts', async () => {
    const { db, queries } = inspectingDb();
    const res = await buildApp(db)('/api/fleet-viz/fleet-map');
    expect(res.status).toBe(200);
    const all = queries.join('\n');
    expect(all).toContain('gps_breadcrumbs');
    expect(all).toContain('latitude');
    expect(all).toContain('longitude');
    expect(all).toContain('recorded_at');
    // The fix must drop the bare-identifier subqueries. We allow
    // `lat`/`lng`/`gps_ts` as ALIASES (they appear in `AS lat` / `AS lng`
    // / `AS gps_ts` so the client contract is preserved) but the bare
    // SELECT/ORDER BY references must be gone.
    expect(all).not.toMatch(/SELECT\s+lat\s+FROM\s+gps_breadcrumbs/i);
    expect(all).not.toMatch(/SELECT\s+lng\s+FROM\s+gps_breadcrumbs/i);
    expect(all).not.toMatch(/ORDER BY ts\b/);
  });

  it('GET /calls-per-gallon — uses users + units (not officers / cad_units / driver_id)', async () => {
    const { db, queries } = inspectingDb();
    const res = await buildApp(db)('/api/fleet-viz/calls-per-gallon');
    expect(res.status).toBe(200);
    const all = queries.join('\n');
    expect(all).toContain('FROM fleet_fuel_log');
    expect(all).toContain('FROM units');
    expect(all).toContain('JOIN users');
    expect(all).toContain('driver_name');
    expect(all).not.toContain('FROM officers');
    expect(all).not.toContain('FROM cad_units');
    expect(all).not.toContain('driver_id');
  });
});
