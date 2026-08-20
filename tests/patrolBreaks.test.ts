// ============================================================
// POST /api/patrol/breaks/start — idempotency regression tests
// ============================================================
// Hand-rolled D1 double (same pattern as tests/patrolMileage.test.ts).
//
// The INSERT used to be unconditional, so a double-clicked "Break" button
// created two patrol_breaks rows with break_end IS NULL. /breaks/end closes
// only the most-recent open break, so the EARLIER duplicate could never be
// closed by anything and stayed open forever, skewing break/time tracking.
//
// Live data before the fix contained exactly that signature: ids 3/4
// (2026-07-04 04:18:21 / :23) and 10/11 (2026-07-29 21:26:43 / :45).
//
// These tests pin that a second start while a break is already open does NOT
// insert, and returns the existing break instead.
// ============================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import patrol from '../src/routes/patrol';
import type { Env } from '../src/types';

type Row = Record<string, unknown>;

/** D1 double that records every SQL string it is asked to run. */
function makeFakeDb(canned: { match: RegExp; rows: Row[] }[]) {
  const executed: string[] = [];
  function resultsFor(sql: string): Row[] {
    for (const c of canned) if (c.match.test(sql)) return c.rows;
    return [];
  }
  const db = {
    prepare(sql: string) {
      executed.push(sql);
      const stmt = {
        bind: (..._a: unknown[]) => stmt,
        all: async () => ({ results: resultsFor(sql) }),
        first: async () => resultsFor(sql)[0] ?? null,
        run: async () => ({ meta: { changes: 1, last_row_id: 99 } }),
      };
      return stmt;
    },
    batch: async (_s: unknown[]) => [{ meta: { changes: 0, last_row_id: 0 } }],
  };
  return { db: db as unknown as D1Database, executed };
}

function buildApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 7, username: 'tester', role: 'officer', full_name: 'Test User' });
    await next();
  });
  app.route('/api/patrol', patrol);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db });
}

const startReq = { method: 'POST', body: JSON.stringify({ break_type: 'break' }) };
const inserts = (executed: string[]) =>
  executed.filter((s) => /INSERT INTO patrol_breaks/i.test(s));

describe('POST /api/patrol/breaks/start', () => {
  it('inserts a new break when the officer has none open', async () => {
    const { db, executed } = makeFakeDb([
      // No open break for this officer.
      { match: /SELECT id, break_start, break_type FROM patrol_breaks/, rows: [] },
      // Read-back of the row just created.
      { match: /SELECT break_start FROM patrol_breaks WHERE id = \?/, rows: [{ break_start: '2026-07-31 10:00:00' }] },
    ]);
    const res = await buildApp(db)('/api/patrol/breaks/start', startReq);

    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; already_open: boolean; break_start?: string };
    expect(body.already_open).toBe(false);
    expect(body.id).toBe(99);
    // Canonical server clock, not a device-local fallback.
    expect(body.break_start).toBe('2026-07-31 10:00:00');
    expect(inserts(executed)).toHaveLength(1);
  });

  it('does NOT insert a second row when a break is already open', async () => {
    const { db, executed } = makeFakeDb([
      {
        match: /SELECT id, break_start, break_type FROM patrol_breaks/,
        rows: [{ id: 42, break_start: '2026-07-31 09:30:00', break_type: 'meal' }],
      },
    ]);
    const res = await buildApp(db)('/api/patrol/breaks/start', startReq);

    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; already_open: boolean; break_start: string; break_type: string };
    expect(body.already_open).toBe(true);
    // The caller gets the EXISTING break back, not a new one.
    expect(body.id).toBe(42);
    expect(body.break_start).toBe('2026-07-31 09:30:00');
    expect(body.break_type).toBe('meal');
    // The actual regression guard: zero INSERTs on the duplicate call.
    expect(inserts(executed)).toHaveLength(0);
  });

  // ── Stale-break window ──────────────────────────────────────────────
  // The idempotency guard is time-scoped. Without the window, an officer who
  // forgot to press End left a row open forever, and every later "start"
  // returned that abandoned row — permanently blocking the Break button.
  // Live D1 had 7 such rows for officer 1 (oldest 2026-06-09).
  it('scopes the open-break lookup to a recent window', async () => {
    const { db, executed } = makeFakeDb([
      { match: /SELECT id, break_start, break_type FROM patrol_breaks/, rows: [] },
      { match: /SELECT break_start FROM patrol_breaks WHERE id = \?/, rows: [{ break_start: '2026-07-31 10:00:00' }] },
    ]);
    await buildApp(db)('/api/patrol/breaks/start', startReq);

    const lookup = executed.find((s) => /SELECT id, break_start, break_type FROM patrol_breaks/.test(s));
    expect(lookup).toBeDefined();
    // The bound window is what stops an abandoned row blocking the button.
    expect(lookup).toMatch(/break_start >= datetime\('now', \?\)/);
  });

  it('starts a NEW break when the only open row is older than the window', async () => {
    // The fake returns [] for the windowed lookup, which is what live D1 does
    // once the stale row falls outside `datetime('now', '-12 hours')`.
    const { db, executed } = makeFakeDb([
      { match: /SELECT id, break_start, break_type FROM patrol_breaks/, rows: [] },
      { match: /SELECT break_start FROM patrol_breaks WHERE id = \?/, rows: [{ break_start: '2026-07-31 10:00:00' }] },
    ]);
    const res = await buildApp(db)('/api/patrol/breaks/start', startReq);

    expect(res.status).toBe(201);
    expect((await res.json() as { already_open: boolean }).already_open).toBe(false);
    // A stale row must NOT suppress the insert — that was the regression.
    expect(inserts(executed)).toHaveLength(1);
  });

  it('rejects an unauthenticated start', async () => {
    const { db } = makeFakeDb([]);
    const app = new Hono<Env>();
    app.route('/api/patrol', patrol);
    const res = await app.request('/api/patrol/breaks/start', startReq, { DB: db });
    expect(res.status).toBe(401);
  });
});
