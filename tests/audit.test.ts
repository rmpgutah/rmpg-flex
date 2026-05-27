// ============================================================
// /api/audit/* smoke tests — first Worker test suite in this repo.
// ============================================================
// The Worker has had no test runner since the CF rehoming (CLAUDE.md
// flags it as Phase 2 tech debt). These tests use a hand-rolled D1
// double rather than @cloudflare/vitest-pool-workers because:
//   - Routes don't depend on the Workers runtime (no DO, no R2, no
//     Container) — only on D1's prepare/bind/all/first/run chain
//     and Hono routing
//   - vitest-pool-workers + miniflare would add ~40MB of devDeps for
//     coverage we can get with ~80 lines of fakes
//   - When a real Worker-runtime test is needed (WebSocket, DO,
//     PDF_TOOLS), that's its own PR; this lays the vitest foundation.
//
// Goal: verify response SHAPE matches what client/src/pages/AuditLogPage.tsx
// consumes (interfaces AuditLogEntry, AuditStats, the IndexStats and
// ComplianceReport ad-hoc types). Not goal: verify SQL correctness —
// that's covered by the actual D1 behind production.
// ============================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import audit from '../src/routes/audit';
import type { Env } from '../src/types';

// ── Tiny D1 double ──────────────────────────────────────────
// Pattern-matches SQL prefixes to canned results. Real handlers
// compose SQL dynamically (WHERE clauses, LIMIT/OFFSET), so we
// only match on a leading substring + return a fixed shape. The
// goal is *shape* validation, not query validation.
type CannedRow = Record<string, unknown>;
function makeFakeDb(canned: { match: RegExp; rows: CannedRow[] }[]) {
  function resultsFor(sql: string): CannedRow[] {
    for (const c of canned) if (c.match.test(sql)) return c.rows;
    return [];
  }
  const db = {
    prepare(sql: string) {
      let stored = sql;
      const stmt: {
        bind: (..._args: unknown[]) => typeof stmt;
        all: <T = unknown>() => Promise<{ results: T[] }>;
        first: <T = unknown>() => Promise<T | null>;
        run: () => Promise<{ meta: { changes: number; last_row_id: number } }>;
      } = {
        bind: (..._args: unknown[]) => stmt,
        all: async <T = unknown>() => ({ results: resultsFor(stored) as T[] }),
        first: async <T = unknown>() => (resultsFor(stored)[0] as T) ?? null,
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
      };
      return stmt;
    },
  };
  return db as unknown as D1Database;
}

// ── Test harness ────────────────────────────────────────────
// Wraps the audit router behind a middleware that injects a fake
// authenticated user — the actual JWT verification middleware
// (src/middleware/auth.ts) is mounted at the app level in
// src/index.ts, not inside the audit sub-router, so we can stub
// the resulting `user` context variable directly.
function buildApp(role: 'admin' | 'manager' | 'officer', db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role, full_name: 'Test User' });
    // Bindings are normally injected by the Workers runtime; in tests
    // we attach via the env passthrough on app.request below.
    await next();
  });
  app.route('/api/audit', audit);
  // Hono's app.request takes an env arg that becomes c.env inside the
  // request — that's how we get DB into the handler.
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db });
}

describe('/api/audit', () => {
  describe('role gate', () => {
    it('rejects non-admin/non-manager with 403', async () => {
      const request = buildApp('officer', makeFakeDb([]));
      const res = await request('/api/audit/logs');
      expect(res.status).toBe(403);
      const body = await res.json() as { code: string };
      expect(body.code).toBe('FORBIDDEN');
    });

    it('admin can access', async () => {
      const request = buildApp('admin', makeFakeDb([
        { match: /SELECT COUNT\(\*\) as total FROM audit_log/, rows: [{ total: 0 }] },
        { match: /SELECT al\.id/, rows: [] },
      ]));
      const res = await request('/api/audit/logs');
      expect(res.status).toBe(200);
    });

    it('manager can access', async () => {
      const request = buildApp('manager', makeFakeDb([
        { match: /SELECT COUNT\(\*\) as total FROM audit_log/, rows: [{ total: 0 }] },
        { match: /SELECT al\.id/, rows: [] },
      ]));
      const res = await request('/api/audit/logs');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /logs', () => {
    it('returns { data, pagination } matching AuditLogEntry shape', async () => {
      const row = {
        id: 42, user_id: 7, action: 'user_login', entity_type: 'user',
        entity_id: '7', details: 'login from MDT', ip_address: '10.0.0.1',
        created_at: '2026-05-27T14:00:00Z',
        user_name: 'Officer Smith', badge_number: 'B042', user_role: 'officer',
      };
      const request = buildApp('admin', makeFakeDb([
        { match: /COUNT\(\*\) as total FROM audit_log/, rows: [{ total: 1 }] },
        { match: /SELECT al\.id/, rows: [row] },
      ]));
      const res = await request('/api/audit/logs?page=1&limit=50');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: { total: number; totalPages: number; page: number; limit: number } };
      expect(body.data).toHaveLength(1);
      expect(body.pagination).toEqual({ page: 1, limit: 50, total: 1, totalPages: 1 });
      // Verify every field AuditLogPage's AuditLogEntry interface reads
      const r = body.data[0] as Record<string, unknown>;
      for (const key of [
        'id', 'user_id', 'action', 'entity_type', 'entity_id',
        'details', 'ip_address', 'created_at',
        'user_name', 'badge_number', 'user_role',
      ]) expect(r).toHaveProperty(key);
    });

    it('caps limit at 100000 (handler-side guard)', async () => {
      const request = buildApp('admin', makeFakeDb([
        { match: /COUNT\(\*\) as total FROM audit_log/, rows: [{ total: 0 }] },
        { match: /SELECT al\.id/, rows: [] },
      ]));
      const res = await request('/api/audit/logs?limit=999999999');
      expect(res.status).toBe(200);
      const body = await res.json() as { pagination: { limit: number } };
      expect(body.pagination.limit).toBeLessThanOrEqual(100000);
    });
  });

  describe('GET /stats', () => {
    it('returns AuditStats shape', async () => {
      const request = buildApp('admin', makeFakeDb([
        { match: /COUNT\(\*\) as total FROM audit_log\s*$/, rows: [{ total: 1234 }] },
        { match: /date\(created_at\) = date\('now'\)/, rows: [{ total: 17 }] },
        { match: /GROUP BY action ORDER BY count DESC/, rows: [{ action: 'user_login', count: 800 }] },
        { match: /GROUP BY u\.full_name/, rows: [{ user_name: 'Smith', badge_number: 'B042', count: 300 }] },
      ]));
      const res = await request('/api/audit/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { totalEntries: number; entriesToday: number; topActions: unknown[]; topUsers: unknown[] };
      expect(body.totalEntries).toBe(1234);
      expect(body.entriesToday).toBe(17);
      expect(Array.isArray(body.topActions)).toBe(true);
      expect(Array.isArray(body.topUsers)).toBe(true);
    });
  });

  describe('GET /compliance-report', () => {
    it('returns { compliant, gaps, generated_at, ... } with sane defaults', async () => {
      const request = buildApp('admin', makeFakeDb([
        // Default canned: nothing matches → empty arrays + 0 counts
        { match: /GROUP BY day/, rows: [] },
      ]));
      const res = await request('/api/audit/compliance-report?days=7');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        compliant: boolean;
        gaps: { date: string; expected: number; actual: number }[];
        generated_at: string;
        report_period_days: number;
      };
      expect(typeof body.compliant).toBe('boolean');
      expect(Array.isArray(body.gaps)).toBe(true);
      expect(body.report_period_days).toBe(7);
      // With zero audit rows, every day is a gap → not compliant
      expect(body.compliant).toBe(false);
      expect(body.gaps.length).toBe(7);
      // ISO timestamp roughly = now
      expect(Date.parse(body.generated_at)).toBeGreaterThan(0);
    });

    it('caps days at 90', async () => {
      const request = buildApp('admin', makeFakeDb([
        { match: /GROUP BY day/, rows: [] },
      ]));
      const res = await request('/api/audit/compliance-report?days=9999');
      expect(res.status).toBe(200);
      const body = await res.json() as { report_period_days: number; gaps: unknown[] };
      expect(body.report_period_days).toBe(90);
      expect(body.gaps.length).toBeLessThanOrEqual(90);
    });
  });

  describe('GET /index-stats', () => {
    it('returns total_entries + estimated_size_mb (admin or manager)', async () => {
      const request = buildApp('manager', makeFakeDb([
        { match: /SELECT COUNT\(\*\) as count FROM audit_log\s*$/, rows: [{ count: 100 }] },
        { match: /MIN\(created_at\) as oldest/, rows: [{ oldest: '2026-01-01T00:00:00Z' }] },
        { match: /MAX\(created_at\) as newest/, rows: [{ newest: '2026-05-27T00:00:00Z' }] },
        { match: /COUNT\(DISTINCT action\)/, rows: [{ count: 12 }] },
        { match: /COUNT\(DISTINCT entity_type\)/, rows: [{ count: 8 }] },
        { match: /COUNT\(DISTINCT user_id\)/, rows: [{ count: 5 }] },
        { match: /AVG\(LENGTH/, rows: [{ avg_bytes: 200 }] },
      ]));
      const res = await request('/api/audit/index-stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { total_entries: number; estimated_size_mb: number };
      expect(body.total_entries).toBe(100);
      expect(typeof body.estimated_size_mb).toBe('number');
      expect(body.estimated_size_mb).toBeGreaterThanOrEqual(0);
    });
  });
});
