// Route-level regression test (Miniflare/workerd) proving GET /api/feature-flags
// is reachable by ANY authenticated role — unlike its admin/manager-only sibling
// GET /admin/system-settings, which shares the system_config table with
// plaintext secrets and cannot safely be opened up the same way.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import featureFlags from '../src/routes/featureFlags';

const app = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { user: { id: number; role: string; username: string }; userId: number };
}>();
app.use('*', async (c, next) => {
  // Non-admin role — the property under test is that this endpoint is NOT
  // role-gated beyond authMiddleware.
  c.set('user', { id: 42, role: 'officer', username: 'test-officer' });
  c.set('userId', 42);
  await next();
});
app.route('/api/feature-flags', featureFlags);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT NOT NULL,
    config_value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
});

describe('GET /api/feature-flags — open to any authenticated role', () => {
  it('returns 200 with fail-open defaults for a non-admin officer role', async () => {
    const res = await app.request('/api/feature-flags', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      feature_warrants: true,
      feature_fleet: true,
      feature_evidence: true,
      feature_patrol_checkpoints: true,
    });
  });

  it('reflects a saved 0 value for an officer role too', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db,
      `INSERT INTO system_config (config_key, config_value) VALUES ('feature_evidence', '0')`);

    const res = await app.request('/api/feature-flags', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, boolean>;
    expect(body.feature_evidence).toBe(false);
  });
});
