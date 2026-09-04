import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
const adminSettings = new Hono<Env>();

// Every write below checks admin|manager, but the reads did not — so any
// authenticated account (including client_viewer, which readOnlyRoleGuard
// only blocks from writes) could read org-wide configuration.
function forbidUnlessRole(c: any, ...roles: string[]): Response | null {
  const actor = c.get('user') as { role?: string } | undefined;
  if (!actor?.role || !roles.includes(actor.role)) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return null;
}

// Defense-in-depth for GET /values, which must stay readable to every role
// (DocumentWriterPage consumes it at runtime). system_settings holds no
// secret-shaped keys today; this makes sure that if one is ever added it
// isn't handed to every logged-in user. Mirrors admin.ts's SECRET_KEY_PATTERN.
const SECRET_KEY_PATTERN = /_(api_key|access_key|access_key_id|secret|secret_access_key|token|password|client_secret|app_key|key_id|webhook_url|webhook_token)$/i;

// GET /api/admin/settings — all settings, grouped by category
adminSettings.get('/', async (c) => {
  // Full rows incl. metadata — only AdminSettingsTab consumes this.
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      'SELECT * FROM system_settings ORDER BY category, ui_order');
    const grouped: Record<string, Record<string, unknown>[]> = {};
    for (const r of rows) {
      const cat = (r.category as string) || 'general';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(r);
    }
    return c.json({ categories: Object.keys(grouped).sort(), settings: grouped });
  } catch (err) {
    log.error('GET / failed', { src: 'src/routes/adminSettings.ts' }, err); return c.json({ error: 'Failed to fetch settings' }, 500); }
});

// GET /api/admin/settings/values — flat key-value map for runtime consumption
adminSettings.get('/values', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ key: string; value: string | null; default_value: string | null }>(db,
      'SELECT key, value, default_value FROM system_settings');
    const values: Record<string, unknown> = {};
    for (const r of rows) {
      // Deliberately NOT role-gated (see SECRET_KEY_PATTERN note above) —
      // every role needs runtime config, so redact rather than deny.
      if (SECRET_KEY_PATTERN.test(r.key)) continue;
      const raw = r.value ?? r.default_value;
      // Auto-coerce booleans and numbers
      if (raw === 'true') values[r.key] = true;
      else if (raw === 'false') values[r.key] = false;
      else if (raw != null && Number.isFinite(Number(raw)) && raw !== '') values[r.key] = Number(raw);
      else values[r.key] = raw;
    }
    return c.json(values);
  } catch (err) {
    log.error('GET /values failed', { src: 'src/routes/adminSettings.ts' }, err); return c.json({ error: 'Failed to fetch setting values' }, 500); }
});

// GET /api/admin/settings/:key — single setting
adminSettings.get('/:key', async (c) => {
  const denied = forbidUnlessRole(c, 'admin', 'manager');
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const key = c.req.param('key');
    const row = await queryFirst<Record<string, unknown>>(db,
      'SELECT * FROM system_settings WHERE key = ?', key);
    if (!row) return c.json({ error: 'Setting not found' }, 404);
    return c.json(row);
  } catch (err) {
    log.error('GET /:key failed', { src: 'src/routes/adminSettings.ts' }, err); return c.json({ error: 'Failed to fetch setting' }, 500); }
});

// PUT /api/admin/settings/:key — update a single setting
adminSettings.put('/:key', async (c) => {
  try {
    const actor = (c as any).var?.user;
    if (!actor || !['admin', 'manager'].includes(actor.role)) return c.json({ error: 'Admin or manager required' }, 403);
    const db = getDb(c.env);
    const key = c.req.param('key');
    const body = await c.req.json<{ value: string | number | boolean }>();
    if (body.value === undefined) return c.json({ error: 'value required' }, 400);

    const existing = await queryFirst<Record<string, unknown>>(db,
      'SELECT * FROM system_settings WHERE key = ?', key);
    if (!existing) return c.json({ error: 'Setting not found' }, 404);

    await execute(db,
      'UPDATE system_settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?',
      String(body.value), key);
    return c.json({ success: true, key, value: String(body.value) });
  } catch (err) {
    log.error('PUT /:key failed', { src: 'src/routes/adminSettings.ts' }, err); return c.json({ error: 'Failed to update setting' }, 500); }
});

// PUT /api/admin/settings — batch update multiple settings
adminSettings.put('/', async (c) => {
  try {
    const actor = (c as any).var?.user;
    if (!actor || !['admin', 'manager'].includes(actor.role)) return c.json({ error: 'Admin or manager required' }, 403);
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, string | number | boolean>>();
    if (!body || Object.keys(body).length === 0) return c.json({ error: 'No settings provided' }, 400);

    const stmts = Object.entries(body).map(([key, value]) =>
      db.prepare('UPDATE system_settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?')
        .bind(String(value), key)
    );
    await db.batch(stmts);
    return c.json({ success: true, updated: Object.keys(body).length });
  } catch (err) {
    log.error('PUT / failed', { src: 'src/routes/adminSettings.ts' }, err); return c.json({ error: 'Failed to update settings' }, 500); }
});

// POST /api/admin/settings/reset — reset all settings to defaults
adminSettings.post('/reset', async (c) => {
  try {
    const actor = (c as any).var?.user;
    if (!actor || !['admin', 'manager'].includes(actor.role)) return c.json({ error: 'Admin or manager required' }, 403);
    const db = getDb(c.env);
    await execute(db, 'UPDATE system_settings SET value = NULL, updated_at = datetime(\'now\')');
    return c.json({ success: true, message: 'All settings reset to defaults' });
  } catch (err) {
    log.error('POST /reset failed', { src: 'src/routes/adminSettings.ts' }, err); return c.json({ error: 'Failed to reset settings' }, 500); }
});

export default adminSettings;
