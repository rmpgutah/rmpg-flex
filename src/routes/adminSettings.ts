import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const adminSettings = new Hono<Env>();

// GET /api/admin/settings — all settings, grouped by category
adminSettings.get('/', async (c) => {
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
  } catch (err) { return c.json({ error: 'Failed to fetch settings' }, 500); }
});

// GET /api/admin/settings/values — flat key-value map for runtime consumption
adminSettings.get('/values', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ key: string; value: string | null; default_value: string | null }>(db,
      'SELECT key, value, default_value FROM system_settings');
    const values: Record<string, unknown> = {};
    for (const r of rows) {
      const raw = r.value ?? r.default_value;
      // Auto-coerce booleans and numbers
      if (raw === 'true') values[r.key] = true;
      else if (raw === 'false') values[r.key] = false;
      else if (raw != null && !isNaN(Number(raw)) && raw !== '') values[r.key] = Number(raw);
      else values[r.key] = raw;
    }
    return c.json(values);
  } catch (err) { return c.json({ error: 'Failed to fetch setting values' }, 500); }
});

// GET /api/admin/settings/:key — single setting
adminSettings.get('/:key', async (c) => {
  try {
    const db = getDb(c.env);
    const key = c.req.param('key');
    const row = await queryFirst<Record<string, unknown>>(db,
      'SELECT * FROM system_settings WHERE key = ?', key);
    if (!row) return c.json({ error: 'Setting not found' }, 404);
    return c.json(row);
  } catch (err) { return c.json({ error: 'Failed to fetch setting' }, 500); }
});

// PUT /api/admin/settings/:key — update a single setting
adminSettings.put('/:key', async (c) => {
  try {
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
  } catch (err) { return c.json({ error: 'Failed to update setting' }, 500); }
});

// PUT /api/admin/settings — batch update multiple settings
adminSettings.put('/', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, string | number | boolean>>();
    if (!body || Object.keys(body).length === 0) return c.json({ error: 'No settings provided' }, 400);

    const stmt = db.prepare(
      'UPDATE system_settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?');
    const batch: Promise<unknown>[] = [];
    for (const [key, value] of Object.entries(body)) {
      batch.push(stmt.bind(String(value), key).run());
    }
    await Promise.all(batch);
    return c.json({ success: true, updated: Object.keys(body).length });
  } catch (err) { return c.json({ error: 'Failed to update settings' }, 500); }
});

// POST /api/admin/settings/reset — reset all settings to defaults
adminSettings.post('/reset', async (c) => {
  try {
    const db = getDb(c.env);
    await execute(db, 'UPDATE system_settings SET value = NULL, updated_at = datetime(\'now\')');
    return c.json({ success: true, message: 'All settings reset to defaults' });
  } catch (err) { return c.json({ error: 'Failed to reset settings' }, 500); }
});

export default adminSettings;
