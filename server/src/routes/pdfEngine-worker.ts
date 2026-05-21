// PDF Engine routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/d1Helpers';

const ALL_FORMS = [
  'call','person','vehicle','warrant','evidence','fleet','personnel','property','citation',
  'incident_blank','person_blank','vehicle_blank','property_blank','citation_blank','field_interview_blank',
  'affidavit_service','affidavit_non_service','service_log',
  'patrol_tracking','invoice','proposal','bolo','warrant_summary',
] as const;
type FormKey = typeof ALL_FORMS[number];

const CONFIG_KEY = 'pdf.v2.enabled_forms';

async function readFlags(db: D1Db): Promise<Record<string, boolean>> {
  const row = await db.prepare(
    "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'pdf_engine' AND is_active = 1"
  ).get(CONFIG_KEY) as { config_value?: string } | undefined;
  const stored: Record<string, boolean> = row?.config_value ? JSON.parse(row.config_value) : {};
  const result: Record<string, boolean> = {};
  for (const f of ALL_FORMS) result[f] = Boolean(stored[f]);
  return result;
}

async function writeFlags(db: D1Db, flags: Record<string, boolean>): Promise<void> {
  const now = localNow();
  await db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'pdf_engine'").run(CONFIG_KEY);
  await db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'pdf_engine', 0, 1, ?, ?)"
  ).run(CONFIG_KEY, JSON.stringify(flags), now, now);
}

export function mountPdfEngineRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  api.get('/flags', async (c) => {
    const db = new D1Db(c.env.DB);
    return c.json(await readFlags(db));
  });

  api.put('/flags/:form', requireRole('admin'), async (c) => {
    const form = c.req.param('form') as FormKey;
    if (!ALL_FORMS.includes(form)) return c.json({ error: 'unknown form' }, 400);
    const body = await c.req.json() as { enabled?: boolean };
    const enabled = Boolean(body?.enabled);
    const db = new D1Db(c.env.DB);
    const flags = await readFlags(db);
    const previous = flags[form];
    flags[form] = enabled;
    await writeFlags(db, flags);
    return c.json({ success: true, form, enabled });
  });

  api.put('/revert-all', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const flags = await readFlags(db);
    const changed = Object.keys(flags).filter(k => flags[k]);
    const reset: Record<string, boolean> = {};
    for (const f of ALL_FORMS) reset[f] = false;
    await writeFlags(db, reset);
    return c.json({ success: true, revertedForms: changed });
  });

  app.route('/api/pdf-engine', api);
}
