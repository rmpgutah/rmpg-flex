// ============================================================
// /api/patrol/mileage/* + /api/patrol/trip-log/generate smoke tests
// ============================================================
// Hand-rolled D1 double (same pattern as tests/audit.test.ts).
// Focus is on the SHAPE of responses the client consumes, the
// role gate on /fix, and the chain-rewrite delta math (the
// central invariant of the whole feature).
// ============================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import patrolMileage from '../src/routes/patrolMileage';
import type { Env } from '../src/types';

type Row = Record<string, unknown>;

// ── Tiny D1 double ──────────────────────────────────────────
// Pattern-matches SQL substrings to canned results. Each match
// arm has an optional `times` count; once exhausted, the next
// matching arm fires. This lets us express "first call returns
// nothing, second call returns the row" — essential for the
// tiered lookups in /suggest and /chain.
function makeFakeDb(canned: { match: RegExp; rows: Row[]; times?: number }[]) {
  const counters = canned.map((c) => c.times ?? Infinity);
  function resultsFor(sql: string): Row[] {
    for (let i = 0; i < canned.length; i++) {
      if (canned[i].match.test(sql) && counters[i] > 0) {
        counters[i]--;
        return canned[i].rows;
      }
    }
    return [];
  }
  const db = {
    prepare(sql: string) {
      let stored = sql;
      const stmt = {
        bind: (..._a: unknown[]) => stmt,
        all: async () => ({ results: resultsFor(stored) }),
        first: async () => resultsFor(stored)[0] ?? null,
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
      };
      return stmt;
    },
    batch: async (_statements: unknown[]) => [
      { meta: { changes: 0, last_row_id: 0 } },
    ],
  };
  return db as unknown as D1Database;
}

function buildApp(role: 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher', db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 7, username: 'tester', role, full_name: 'Test User' });
    await next();
  });
  app.route('/api/patrol', patrolMileage);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db });
}

describe('/api/patrol/mileage/suggest', () => {
  it('400s when neither officer_id nor unit_id is given', async () => {
    const app = buildApp('officer', makeFakeDb([]));
    const res = await app('/api/patrol/mileage/suggest');
    expect(res.status).toBe(400);
  });

  it('returns the officer_unit anchor when present', async () => {
    const app = buildApp('officer', makeFakeDb([
      {
        match: /FROM mileage_anchor WHERE scope_key = \?/,
        rows: [{ current_mileage: 92589.9, offset_miles: 0, last_entry_at: '2026-06-04 16:46:00' }],
      },
    ]));
    const res = await app('/api/patrol/mileage/suggest?officer_id=7&unit_id=3');
    expect(res.status).toBe(200);
    const body = await res.json() as { suggested_mileage: number; source: string; scope_key: string };
    expect(body.suggested_mileage).toBe(92589.9);
    expect(body.source).toBe('officer_unit');
    expect(body.scope_key).toBe('officer_unit:7:3');
  });

  it('falls back to officer-only when officer_unit has no anchor', async () => {
    const app = buildApp('officer', makeFakeDb([
      // First arm: officer_unit miss (times: 1).
      { match: /FROM mileage_anchor WHERE scope_key = \?/, rows: [], times: 1 },
      // Second arm: officer hit (times: 1, fires on the second call).
      {
        match: /FROM mileage_anchor WHERE scope_key = \?/,
        rows: [{ current_mileage: 80000, offset_miles: 0.4, last_entry_at: '2026-06-01 12:00:00' }],
        times: 1,
      },
    ]));
    const res = await app('/api/patrol/mileage/suggest?officer_id=7&unit_id=3');
    const body = await res.json() as { source: string; suggested_mileage: number; offset_miles: number };
    expect(body.source).toBe('officer');
    expect(body.suggested_mileage).toBe(80000);
    // Critical invariant: the +0.4 admin-correction offset is returned so
    // the UI can show "future entries pre-adjusted by +0.4 mi".
    expect(body.offset_miles).toBe(0.4);
  });

  it('returns null when no anchor exists for any scope', async () => {
    const app = buildApp('officer', makeFakeDb([
      { match: /FROM mileage_anchor/, rows: [] },
    ]));
    const res = await app('/api/patrol/mileage/suggest?officer_id=7&unit_id=3');
    const body = await res.json() as { suggested_mileage: null; source: string };
    expect(body.suggested_mileage).toBeNull();
    expect(body.source).toBe('none');
  });
});

describe('/api/patrol/mileage/chain', () => {
  it('returns annotated chain rows + the matching anchor', async () => {
    const app = buildApp('admin', makeFakeDb([
      // Anchor lookup (fires first).
      {
        match: /FROM mileage_anchor WHERE scope_key = \?/,
        rows: [{ current_mileage: 92607, offset_miles: 0, last_entry_at: '2026-06-04 18:21:00' }],
        times: 1,
      },
      // Chain rows from calls_for_service.
      {
        match: /FROM calls_for_service c/,
        rows: [
          { id: 1, call_number: 'CFS26-00040', starting_mileage: 92589.9, ending_mileage: 92595.1, cleared_at: '2026-06-04 16:46:00' },
          { id: 2, call_number: 'CFS26-00042', starting_mileage: 92595.1, ending_mileage: 92601.8, cleared_at: '2026-06-04 17:28:00' },
        ],
        times: 1,
      },
      // mileage_audit lookup (fires once per chain row, 2 calls).
      { match: /FROM mileage_audit ma/, rows: [], times: 5 },
    ]));
    const res = await app('/api/patrol/mileage/chain?officer_id=7&unit_id=3&from=2026-06-04&to=2026-06-04');
    expect(res.status).toBe(200);
    const body = await res.json() as { anchor: { current_mileage: number } | null; rows: Array<{ id: number; starting_mileage: number; ending_mileage: number; audit_count: number }> };
    expect(body.anchor?.current_mileage).toBe(92607);
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0].ending_mileage).toBe(92595.1);
    expect(body.rows[0].audit_count).toBe(0);
  });
});

describe('/api/patrol/mileage/fix', () => {
  it('rejects non-admin/manager/supervisor with 403', async () => {
    const app = buildApp('officer', makeFakeDb([]));
    const res = await app('/api/patrol/mileage/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_table: 'calls_for_service', entry_id: 1, field: 'ending_mileage',
        after_value: 92595.0, reason: 'misread odometer', propagate_chain: true,
        scope: { officer_id: 7, unit_id: 3 },
      }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects fix without a reason (audit trail integrity)', async () => {
    const app = buildApp('admin', makeFakeDb([
      { match: /SELECT starting_mileage, ending_mileage/, rows: [{ starting_mileage: 92589.9, ending_mileage: 92595.1, call_number: 'CFS26-00040', assigned_unit_ids: '[3]', cleared_at: '2026-06-04 16:46:00', closed_at: null, created_at: '2026-06-04 16:32:00' }] },
    ]));
    const res = await app('/api/patrol/mileage/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_table: 'calls_for_service', entry_id: 1, field: 'ending_mileage',
        after_value: 92595.0, reason: '', propagate_chain: true,
        scope: { officer_id: 7, unit_id: 3 },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('REASON_REQUIRED');
  });

  it('rejects fix when after_value === before_value (no-op)', async () => {
    const app = buildApp('admin', makeFakeDb([
      { match: /SELECT starting_mileage, ending_mileage/, rows: [{ starting_mileage: 92589.9, ending_mileage: 92595.1, call_number: 'CFS26-00040', assigned_unit_ids: '[3]', cleared_at: '2026-06-04 16:46:00', closed_at: null, created_at: '2026-06-04 16:32:00' }] },
    ]));
    const res = await app('/api/patrol/mileage/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_table: 'calls_for_service', entry_id: 1, field: 'ending_mileage',
        after_value: 92595.1, reason: 'no change', propagate_chain: true,
        scope: { officer_id: 7, unit_id: 3 },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NO_DELTA');
  });

  it('happy path: admin applies fix and gets the expected delta + cascade count', async () => {
    const app = buildApp('admin', makeFakeDb([
      // The bad row.
      {
        match: /SELECT starting_mileage, ending_mileage/,
        rows: [{ starting_mileage: 92589.9, ending_mileage: 92595.1, call_number: 'CFS26-00040', assigned_unit_ids: '[3]', cleared_at: '2026-06-04 16:46:00', closed_at: null, created_at: '2026-06-04 16:32:00' }],
      },
      // The cascade lookup — two later rows in the same scope.
      {
        match: /COALESCE\(cleared_at, closed_at, created_at\) >/,
        rows: [
          { id: 2, starting_mileage: 92595.1, ending_mileage: 92601.8 },
          { id: 3, starting_mileage: 92601.8, ending_mileage: 92607 },
        ],
      },
    ]));
    const res = await app('/api/patrol/mileage/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_table: 'calls_for_service', entry_id: 1, field: 'ending_mileage',
        after_value: 92595.0,  // -0.1 mi from 92595.1
        reason: 'Officer re-read the dash odometer',
        scope: { officer_id: 7, unit_id: 3 },
        propagate_chain: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      fix: { before: number; after: number; delta: number };
      cascade: { count: number; rewrote_starting: number; rewrote_ending: number };
    };
    expect(body.success).toBe(true);
    expect(body.fix.before).toBe(92595.1);
    expect(body.fix.after).toBe(92595.0);
    // The user's example: 91205.6 -> 91205.0; this is the same arithmetic.
    expect(body.fix.delta).toBeCloseTo(-0.1, 5);
    // Two subsequent rows were rewritten, both starting and ending shifted.
    expect(body.cascade.count).toBe(2);
    expect(body.cascade.rewrote_ending).toBe(2);
    expect(body.cascade.rewrote_starting).toBe(2);
  });
});

describe('/api/patrol/trip-log/generate', () => {
  it('returns a populated payload with RESPONSE rows for the scope', async () => {
    const app = buildApp('admin', makeFakeDb([
      // Officer name lookup
      { match: /SELECT full_name FROM users WHERE id = \?/, rows: [{ full_name: 'OFFICER 1' }] },
      // Unit call_sign lookup
      { match: /SELECT call_sign FROM units WHERE id = \?/, rows: [{ call_sign: '12-Adam' }] },
      // CFS chain rows
      {
        match: /FROM calls_for_service c/,
        rows: [
          { id: 1, call_number: 'CFS26-00040', dispatched_at: '2026-06-04 16:32:00', enroute_at: '2026-06-04 16:33:00', onscene_at: '2026-06-04 16:36:00', cleared_at: '2026-06-04 16:46:00', closed_at: null, starting_mileage: 92589.9, ending_mileage: 92595.1, assigned_unit_ids: '[3]', unit_call_signs: '12-Adam' },
          { id: 2, call_number: 'CFS26-00042', dispatched_at: '2026-06-04 17:05:00', enroute_at: '2026-06-04 17:06:00', onscene_at: '2026-06-04 17:10:00', cleared_at: '2026-06-04 17:28:00', closed_at: null, starting_mileage: 92595.1, ending_mileage: 92601.8, assigned_unit_ids: '[3]', unit_call_signs: '12-Adam' },
        ],
      },
      // gps_breadcrumbs lookups — empty (no PATROL rows, that's fine).
      { match: /FROM gps_breadcrumbs/, rows: [] },
    ]));
    const res = await app('/api/patrol/trip-log/generate?officer_id=7&unit_id=3&from=2026-06-04&to=2026-06-04');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      meta: { officer_name: string; unit_call_sign: string; trips_logged: number };
      rows: Array<{ type: string; call_number: string; mileage_from: number; mileage_to: number; distance_mi: number }>;
      totals: { distance_mi: number };
    };
    expect(body.meta.officer_name).toBe('OFFICER 1');
    expect(body.meta.unit_call_sign).toBe('12-Adam');
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0].type).toBe('RESPONSE');
    expect(body.rows[0].mileage_from).toBe(92589.9);
    expect(body.rows[0].mileage_to).toBe(92595.1);
    // 5.2 mi (92595.1 - 92589.9) — the per-row distance is the chain
    // segment, not the cumulative.
    expect(body.rows[0].distance_mi).toBeCloseTo(5.2, 1);
    expect(body.totals.distance_mi).toBeCloseTo(11.9, 1);
  });

  it('400s when no scope is given', async () => {
    const app = buildApp('admin', makeFakeDb([]));
    const res = await app('/api/patrol/trip-log/generate');
    expect(res.status).toBe(400);
  });
});
