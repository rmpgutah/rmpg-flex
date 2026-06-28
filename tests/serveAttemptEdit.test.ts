// ============================================================
// PUT /process-server/:queueId/attempt/:attemptId — smoke tests
// ============================================================
// Verifies the new attempt-edit endpoint contract:
//   - allowed-field whitelist (rejects unknown fields silently, not 500s)
//   - disposition_code derivation overrides any caller-supplied `result`
//   - parent serve_queue.status recompute fires only when result changed
//   - notes-only edits don't touch parent status
//   - 404 when attempt doesn't belong to the named queue row
// ============================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import sv from '../src/routes/serve';
import type { Env } from '../src/types';

// Stateful fake D1 that tracks the in-memory state of one serve_queue
// row + its serve_attempts so the recompute path is observable. Mirrors
// just enough of D1's prepare/bind/all/first/run chain for these tests —
// the audit.test.ts fakes are read-only and would let recompute writes
// vanish into the void.
function buildStatefulDb(initial: {
  queue: { id: number; status: string; attempt_count: number; max_attempts: number };
  attempts: Array<{
    id: number; serve_queue_id: number; attempt_number: number;
    attempt_at: string; result: string | null; disposition_code: string | null;
    notes: string | null; latitude: number | null; longitude: number | null;
    officer_id: number | null; attempt_type: string | null;
  }>;
}) {
  const state = JSON.parse(JSON.stringify(initial)) as typeof initial;

  function exec(sql: string, args: unknown[]): unknown {
    // columnExists probe — return one row when disposition_code is asked for.
    if (/pragma_table_info|sqlite_master/i.test(sql)) {
      // Caller is columnExists() — always say yes (mig 0143 applied).
      return [{ name: 'disposition_code' }];
    }
    // SELECT id, result, attempt_number FROM serve_attempts WHERE id = ? AND serve_queue_id = ?
    if (/SELECT id, result, attempt_number FROM serve_attempts/i.test(sql)) {
      const [id, qid] = args as [number, number];
      const a = state.attempts.find((x) => x.id === id && x.serve_queue_id === qid);
      return a ? [a] : [];
    }
    // SELECT attempt_count, max_attempts, status FROM serve_queue WHERE id = ?
    if (/SELECT attempt_count, max_attempts, status FROM serve_queue/i.test(sql)) {
      const [qid] = args as [number];
      return state.queue.id === qid ? [state.queue] : [];
    }
    // SELECT result, disposition_code ... ORDER BY attempt_at DESC LIMIT 1
    if (/ORDER BY attempt_at DESC/i.test(sql) && /SELECT result, disposition_code/i.test(sql)) {
      const sorted = [...state.attempts].sort((a, b) => b.attempt_at.localeCompare(a.attempt_at));
      return sorted.length ? [sorted[0]] : [];
    }
    // UPDATE serve_attempts SET ... WHERE id = ?
    if (/^UPDATE serve_attempts SET/i.test(sql.trim())) {
      const setClause = sql.match(/SET ([^]*?) WHERE id/i)?.[1] ?? '';
      const fields = setClause.split(',').map((s) => s.trim().split('=')[0].trim());
      const id = args[args.length - 1] as number;
      const target = state.attempts.find((x) => x.id === id);
      if (target) {
        fields.forEach((f, i) => { (target as any)[f] = args[i]; });
      }
      return [];
    }
    // UPDATE serve_queue SET status = ?, updated_at = ... WHERE id = ?
    if (/^UPDATE serve_queue SET status/i.test(sql.trim())) {
      const [newStatus, qid] = args as [string, number];
      if (state.queue.id === qid) state.queue.status = newStatus;
      return [];
    }
    return [];
  }

  const db = {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const stmt: any = {
        bind: (...a: unknown[]) => { boundArgs = a; return stmt; },
        all: async () => ({ results: exec(sql, boundArgs) }),
        first: async () => {
          const r = exec(sql, boundArgs) as unknown[];
          return r.length ? r[0] : null;
        },
        run: async () => {
          exec(sql, boundArgs);
          return { meta: { changes: 1, last_row_id: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, state };
}

function buildApp(db: D1Database, role: 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher' = 'officer') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 99, username: 'tester', role, full_name: 'Test User' });
    await next();
  });
  app.route('/api/process-server', sv);
  return (path: string, init?: RequestInit) =>
    app.request(path, init, { DB: db });
}

const baseAttempt = {
  id: 100,
  serve_queue_id: 1,
  attempt_number: 1,
  attempt_at: '2026-06-22 10:00:00',
  result: 'no_answer' as string | null,
  disposition_code: null as string | null,
  notes: 'first attempt',
  latitude: null,
  longitude: null,
  officer_id: 7,
  attempt_type: 'failed',
};

describe('PUT /api/process-server/:queueId/attempt/:attemptId', () => {
  it('updates notes without touching parent status', async () => {
    const { db, state } = buildStatefulDb({
      queue: { id: 1, status: 'attempted', attempt_count: 1, max_attempts: 3 },
      attempts: [{ ...baseAttempt }],
    });
    const req = buildApp(db);
    const res = await req('/api/process-server/1/attempt/100', {
      method: 'PUT',
      body: JSON.stringify({ notes: 'corrected: door was answered' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.queue_status_recomputed).toBeNull();
    expect(state.attempts[0].notes).toBe('corrected: door was answered');
    expect(state.queue.status).toBe('attempted'); // untouched
  });

  it('recomputes parent status when result changes from no_answer to served', async () => {
    const { db, state } = buildStatefulDb({
      queue: { id: 1, status: 'attempted', attempt_count: 1, max_attempts: 3 },
      attempts: [{ ...baseAttempt }],
    });
    const req = buildApp(db);
    const res = await req('/api/process-server/1/attempt/100', {
      method: 'PUT',
      body: JSON.stringify({ result: 'served' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.queue_status_recomputed).toEqual({ status: 'served' });
    expect(state.queue.status).toBe('served');
    expect(state.attempts[0].result).toBe('served');
  });

  it('derives result from disposition_code and overrides caller-supplied result', async () => {
    const { db, state } = buildStatefulDb({
      queue: { id: 1, status: 'attempted', attempt_count: 1, max_attempts: 3 },
      attempts: [{ ...baseAttempt }],
    });
    const req = buildApp(db);
    // PS/05.01 = Personal Service — In Hand → result=served, queueOutcome=served
    const res = await req('/api/process-server/1/attempt/100', {
      method: 'PUT',
      body: JSON.stringify({
        disposition_code: 'PS/05.01',
        result: 'other',  // ignored — disposition_code wins
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(state.attempts[0].disposition_code).toBe('PS/05.01');
    expect(state.attempts[0].result).toBe('served');
    expect(state.queue.status).toBe('served');
  });

  it('rejects unknown disposition_code with 400', async () => {
    const { db } = buildStatefulDb({
      queue: { id: 1, status: 'attempted', attempt_count: 1, max_attempts: 3 },
      attempts: [{ ...baseAttempt }],
    });
    const req = buildApp(db);
    const res = await req('/api/process-server/1/attempt/100', {
      method: 'PUT',
      body: JSON.stringify({ disposition_code: 'PS/99.99' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when attempt does not belong to the named queue row', async () => {
    const { db } = buildStatefulDb({
      queue: { id: 1, status: 'attempted', attempt_count: 1, max_attempts: 3 },
      attempts: [{ ...baseAttempt, serve_queue_id: 999 }],   // wrong parent
    });
    const req = buildApp(db);
    const res = await req('/api/process-server/1/attempt/100', {
      method: 'PUT',
      body: JSON.stringify({ notes: 'x' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
  });

  it('rejects dispatcher role (read-only)', async () => {
    const { db } = buildStatefulDb({
      queue: { id: 1, status: 'attempted', attempt_count: 1, max_attempts: 3 },
      attempts: [{ ...baseAttempt }],
    });
    const req = buildApp(db, 'dispatcher');
    const res = await req('/api/process-server/1/attempt/100', {
      method: 'PUT',
      body: JSON.stringify({ notes: 'x' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when no editable fields supplied', async () => {
    const { db } = buildStatefulDb({
      queue: { id: 1, status: 'attempted', attempt_count: 1, max_attempts: 3 },
      attempts: [{ ...baseAttempt }],
    });
    const req = buildApp(db);
    const res = await req('/api/process-server/1/attempt/100', {
      method: 'PUT',
      body: JSON.stringify({ photo_ids: ['p1', 'p2'] }),   // not in whitelist
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
