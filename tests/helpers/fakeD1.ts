// ============================================================
// Reusable in-memory D1 test doubles.
// ============================================================
// Extracted from tests/audit.test.ts so future Worker tests
// (warrants, etc.) can reuse the same lightweight fakes instead
// of @cloudflare/vitest-pool-workers + miniflare. See the header
// of tests/audit.test.ts for the rationale.
//
// `D1Database` is the global type from @cloudflare/workers-types
// (no import needed — matches how audit.test.ts references it).
// ============================================================

// ── Tiny D1 double ──────────────────────────────────────────
// Pattern-matches SQL prefixes to canned results. Real handlers
// compose SQL dynamically (WHERE clauses, LIMIT/OFFSET), so we
// only match on a leading substring + return a fixed shape. The
// goal is *shape* validation, not query validation.
export type CannedRow = Record<string, unknown>;

export function makeFakeDb(canned: { match: RegExp; rows: CannedRow[] }[]) {
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

// ── Recording D1 double ─────────────────────────────────────
// Same shape as makeFakeDb for reads, but captures every
// prepared statement and its bound args so tests can assert on
// the SQL + params a handler executed. `.run()` reports a
// successful single-row mutation (changes:1, incrementing
// last_row_id) so write paths look like a real INSERT/UPDATE.
export function recordingDb(canned: { match: RegExp; rows: CannedRow[] }[] = []) {
  const calls: { sql: string; args: unknown[] }[] = [];
  const resultsFor = (sql: string) => canned.find((c) => c.match.test(sql))?.rows ?? [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt: any = {
        bind: (...a: unknown[]) => { args = a; return stmt; },
        all: async () => ({ results: resultsFor(sql) }),
        first: async () => resultsFor(sql)[0] ?? null,
        run: async () => { calls.push({ sql, args }); return { meta: { changes: 1, last_row_id: calls.length } }; },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, calls };
}
