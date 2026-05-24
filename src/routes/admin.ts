import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const admin = new Hono<Env>();

// GET /admin/config
admin.get('/config', async (c) => {
  try {
    const db = getDb(c.env);
    const config = await query<Record<string, unknown>>(db, 'SELECT * FROM system_config');
    const result: Record<string, string> = {};
    for (const row of config) result[String(row.key)] = String(row.value ?? '');
    return c.json(result);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /admin/call-templates
admin.get('/call-templates', async (c) => {
  try {
    const db = getDb(c.env);
    const templates = await query<Record<string, unknown>>(db, 'SELECT * FROM call_templates ORDER BY name');
    return c.json(templates);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /admin/clients
admin.get('/clients', async (c) => {
  try {
    const db = getDb(c.env);
    const clients = await query<Record<string, unknown>>(db, 'SELECT * FROM clients ORDER BY name');
    return c.json(clients);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

export default admin;

// Stub admin endpoints
admin.get('/shift-stats', (c) => c.json([]));
admin.get('/upcoming-court-dates', (c) => c.json([]));
admin.get('/expiring-certifications', (c) => c.json([]));
admin.get('/google-maps-config', (c) => c.json({}));
admin.get('/config/branding', (c) => c.json([]));
