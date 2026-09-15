// test-workers/intelLikeFallbackEscape.test.ts
//
// intel.ts's `/search` and intelAi.ts's suggestion helper both fall back to a
// LIKE query against `persons` when the intel_index FTS5 table is
// unavailable. Both used `ESCAPE '\'` inside a JS template literal — but `\'`
// is a JS string escape for a bare `'`, so the string SQLite actually
// received was `ESCAPE ''` (an EMPTY escape character), which SQLite rejects
// outright ("ESCAPE expression must be a single character"). That error was
// caught and swallowed, so the fallback silently returned zero results on
// every call, indistinguishable from "no matches." Fixed by writing `\\'`
// so the JS string carries one literal backslash through to SQL.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import intel from '../src/routes/intel';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-analyst' });
  c.set('userId', 1);
  await next();
});
app.route('/api/intel', intel);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  // intel_index (FTS5) is deliberately NOT created, so the MATCH query
  // throws "no such table" and the handler falls through to the LIKE path.
  await execute(db, `CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT
  )`);
  await execute(db, `INSERT INTO persons (first_name, last_name) VALUES ('Zippy', 'Fallbacktest')`);
});

describe('GET /api/intel/search — LIKE fallback when intel_index is unavailable', () => {
  it('returns the matching person instead of silently swallowing the SQL error', async () => {
    const res = await app.request('/api/intel/search?q=Zippy', { method: 'GET' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { results: Array<{ type: string; label: string }> };
    expect(body.results.find((r) => r.type === 'person' && r.label.includes('Fallbacktest'))).toBeTruthy();
  });
});
