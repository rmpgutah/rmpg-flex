// Route-level regression tests (Miniflare/workerd) for the Admin → System Config
// wiring defects fixed in Phase 0. See
// docs/superpowers/specs/2026-07-25-admin-system-tab-wiring-design.md
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import admin from '../src/routes/admin';

const app = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { user: { id: number; role: string; username: string }; userId: number };
}>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-admin' });
  c.set('userId', 1);
  await next();
});
app.route('/api/admin', admin);

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

describe('PUT /api/admin/system-settings — category round-trip', () => {
  it('files saved settings under category=system_settings so config-items reads them back', async () => {
    const saveRes = await app.request('/api/admin/system-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agency_ori: 'UT0190000', records_retention_years: '7' }),
    }, env as unknown as Record<string, unknown>);
    expect(saveRes.status).toBe(200);

    // The admin tab reloads through this endpoint, grouped by category.
    const readRes = await app.request('/api/admin/config-items', {}, env as unknown as Record<string, unknown>);
    expect(readRes.status).toBe(200);
    const grouped = await readRes.json() as Record<string, Array<{ config_key: string; config_value: string }>>;

    const settings = grouped.system_settings ?? [];
    expect(settings.map((r) => r.config_key).sort()).toEqual(['agency_ori', 'records_retention_years']);
    expect(settings.find((r) => r.config_key === 'agency_ori')!.config_value).toBe('UT0190000');

    // And must NOT leak into the untyped 'general' bucket.
    expect((grouped.general ?? []).map((r) => r.config_key)).not.toContain('agency_ori');
  });

  it('overwrites rather than accumulating rows when the same key is saved twice', async () => {
    await app.request('/api/admin/system-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_archive_days: '90' }),
    }, env as unknown as Record<string, unknown>);
    await app.request('/api/admin/system-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_archive_days: '120' }),
    }, env as unknown as Record<string, unknown>);

    const readRes = await app.request('/api/admin/config-items', {}, env as unknown as Record<string, unknown>);
    const grouped = await readRes.json() as Record<string, Array<{ config_key: string; config_value: string }>>;
    const rows = (grouped.system_settings ?? []).filter((r) => r.config_key === 'auto_archive_days');
    expect(rows).toHaveLength(1);
    expect(rows[0].config_value).toBe('120');
  });
});
