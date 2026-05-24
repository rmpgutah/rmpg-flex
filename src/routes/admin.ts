import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const admin = new Hono<Env>();

// GET /admin/config
// Returns flat key/value map from system_config + the structured
// `dispositions` array DispatchPage and DispositionPrompt expect.
// Dispositions come from system_config rows where key starts with
// 'disposition.' (each value is JSON {code, description, color?}),
// falling back to a baked-in common set so the Clear-call dropdown
// is never empty even on a fresh database.
admin.get('/config', async (c) => {
  try {
    const db = getDb(c.env);
    const config = await query<Record<string, unknown>>(db, 'SELECT * FROM system_config');
    const result: Record<string, any> = {};
    const customDispositions: any[] = [];
    for (const row of config) {
      const key = String(row.key);
      const value = String(row.value ?? '');
      // Disposition rows live under the 'disposition.<code>' namespace
      // so we can keep the flat key/value schema while still allowing
      // the client to consume them as a typed array.
      if (key.startsWith('disposition.')) {
        try {
          const parsed = JSON.parse(value);
          customDispositions.push({
            code: parsed.code,
            description: parsed.description,
            color: parsed.color,
            is_active: parsed.is_active !== false,
            // Keep `config_value` for backward-compat with the existing
            // client mapping that JSON.parses each row.
            config_value: value,
          });
        } catch { /* malformed row — skip */ }
      } else {
        result[key] = value;
      }
    }

    // Baked-in defaults so the dropdown is never empty on a fresh
    // database. Custom rows above OVERRIDE these by code (admin can
    // tweak description/color in system_config without losing the
    // built-in roster).
    const defaults = [
      { code: 'Report Taken',     description: 'Report Taken' },
      { code: 'Unfounded',        description: 'Unfounded' },
      { code: 'GOA',              description: 'Gone on Arrival' },
      { code: 'Referred',         description: 'Referred to other agency' },
      { code: 'No Action',        description: 'No Action Required' },
      { code: 'Arrest',           description: 'Arrest Made' },
      { code: 'Warning',          description: 'Warning Issued' },
      { code: 'Citation',         description: 'Citation Issued' },
      { code: 'Trespass Warning', description: 'Trespass Warning Issued' },
      { code: 'Civil Matter',     description: 'Civil Matter — No Action' },
      { code: 'Resolved',         description: 'Resolved on Scene' },
      { code: 'Transported',      description: 'Subject Transported' },
      { code: 'False Alarm',      description: 'False Alarm' },
      { code: 'Cancelled',        description: 'Call Cancelled' },
    ];
    const overrideCodes = new Set(customDispositions.map((d) => d.code));
    const merged = [
      ...customDispositions,
      ...defaults
        .filter((d) => !overrideCodes.has(d.code))
        .map((d) => ({
          ...d,
          is_active: true,
          config_value: JSON.stringify(d),
        })),
    ];

    result.dispositions = merged;
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
