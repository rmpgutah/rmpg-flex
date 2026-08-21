import { Hono } from 'hono';
import type { Env } from '../../types';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';

const callTemplates = new Hono<Env>();

// ── Boot reconciler ──────────────────────────────────────────────────────────
let templatesEnsured = false;
async function ensureCallTemplatesTable(db: D1Database): Promise<void> {
  if (templatesEnsured) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS call_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL UNIQUE,
      default_priority TEXT NOT NULL DEFAULT 'P3',
      default_disposition TEXT,
      suggested_unit_count INTEGER NOT NULL DEFAULT 1,
      checklist_items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  // Seed with 15 common police templates if table is empty
  const existing = await queryFirst<{ cnt: number }>(db, 'SELECT COUNT(*) as cnt FROM call_templates');
  if ((existing?.cnt ?? 0) === 0) {
    const seeds = [
      { type: 'ALARM',            default_priority: 'P2', default_disposition: 'checked',       suggested_unit_count: 1, checklist_items: JSON.stringify(['Verify with monitoring company','Check all entry points','Contact property owner','Document response time']) },
      { type: 'TRAFFIC STOP',     default_priority: 'P3', default_disposition: 'citation',      suggested_unit_count: 1, checklist_items: JSON.stringify(['Run plate','Check license/insurance','Run driver history','Document outcome']) },
      { type: 'DOMESTIC',         default_priority: 'P1', default_disposition: 'report',        suggested_unit_count: 2, checklist_items: JSON.stringify(['Separate parties','Check for injuries','Take statements','Check for weapons','Child welfare check','Advise of rights']) },
      { type: 'FIGHT',            default_priority: 'P1', default_disposition: 'report',        suggested_unit_count: 2, checklist_items: JSON.stringify(['Secure scene','Check for injuries','Identify parties','Take statements','Check for weapons']) },
      { type: 'WELFARE CHECK',    default_priority: 'P2', default_disposition: 'checked',       suggested_unit_count: 1, checklist_items: JSON.stringify(['Attempt contact by phone first','Check with neighbors','Document entry method if forced','Medical eval if needed']) },
      { type: 'SUSPICIOUS PERSON',default_priority: 'P2', default_disposition: 'gone on arrival',suggested_unit_count: 1, checklist_items: JSON.stringify(['Get detailed description','Check area','Run subject if contacted','Document activity']) },
      { type: 'BURGLARY',         default_priority: 'P1', default_disposition: 'report',        suggested_unit_count: 2, checklist_items: JSON.stringify(['Secure perimeter','Check for suspects','Preserve crime scene','Contact property owner','Document point of entry','Take inventory of missing items']) },
      { type: 'ASSAULT',          default_priority: 'P1', default_disposition: 'report',        suggested_unit_count: 2, checklist_items: JSON.stringify(['Check for injuries','Request EMS if needed','Secure suspect','Take statements','Document injuries','Preserve evidence']) },
      { type: 'DUI',              default_priority: 'P2', default_disposition: 'arrest',        suggested_unit_count: 1, checklist_items: JSON.stringify(['Field sobriety test','Breathalyzer if available','Run plate/driver','Arrange tow if needed','Transport to booking']) },
      { type: 'MISSING PERSON',   default_priority: 'P1', default_disposition: 'located',       suggested_unit_count: 2, checklist_items: JSON.stringify(['Get description/photo','Last known location','Check social media','Notify supervisor','NCIC entry if warranted','Canvass area']) },
      { type: 'VANDALISM',        default_priority: 'P3', default_disposition: 'report',        suggested_unit_count: 1, checklist_items: JSON.stringify(['Document damage','Photograph evidence','Identify witnesses','Estimate damage value','Check for surveillance cameras']) },
      { type: 'NOISE COMPLAINT',  default_priority: 'P3', default_disposition: 'warning',       suggested_unit_count: 1, checklist_items: JSON.stringify(['Contact responsible party','Issue warning','Document response','Follow up if repeat']) },
      { type: 'TRESPASS',         default_priority: 'P2', default_disposition: 'trespass warning',suggested_unit_count: 1, checklist_items: JSON.stringify(['Verify property owner authorization','Document subject info','Issue trespass warning','Arrest if prior warning issued']) },
      { type: 'VEHICLE THEFT',    default_priority: 'P1', default_disposition: 'report',        suggested_unit_count: 1, checklist_items: JSON.stringify(['Get full vehicle description','Run plate','NCIC entry','Canvass for witnesses','Check surveillance cameras','Notify owner']) },
      { type: 'DISTURBANCE',      default_priority: 'P2', default_disposition: 'peace restored', suggested_unit_count: 2, checklist_items: JSON.stringify(['Assess situation on arrival','Separate parties','Take statements','Document outcome']) },
    ];

    const stmts = seeds.map(s =>
      db.prepare(
        `INSERT OR IGNORE INTO call_templates (type, default_priority, default_disposition, suggested_unit_count, checklist_items) VALUES (?, ?, ?, ?, ?)`
      ).bind(s.type, s.default_priority, s.default_disposition, s.suggested_unit_count, s.checklist_items)
    );
    await db.batch(stmts);
  }

  templatesEnsured = true;
}

// GET /api/dispatch/call-templates
callTemplates.get('/', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    await ensureCallTemplatesTable(db);

    const rows = await query<{
      id: number;
      type: string;
      default_priority: string;
      default_disposition: string | null;
      suggested_unit_count: number;
      checklist_items: string;
    }>(db, 'SELECT * FROM call_templates ORDER BY type ASC');

    const templates = rows.map(r => ({
      ...r,
      checklist_items: (() => { try { return JSON.parse(r.checklist_items); } catch { return []; } })(),
    }));

    return c.json(templates);
  } catch (err) {
    log.error('GET /dispatch/call-templates failed', {}, err as Error);
    return c.json({ error: 'Failed to get call templates' }, 500);
  }
});

// GET /api/dispatch/call-templates/:type
callTemplates.get('/:type', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    await ensureCallTemplatesTable(db);
    const type = (c.req.param('type') ?? '').toUpperCase();
    const row = await queryFirst<{
      id: number; type: string; default_priority: string;
      default_disposition: string | null; suggested_unit_count: number; checklist_items: string;
    }>(db, 'SELECT * FROM call_templates WHERE type = ?', type);

    if (!row) return c.json({ error: 'Template not found' }, 404);
    return c.json({ ...row, checklist_items: (() => { try { return JSON.parse(row.checklist_items); } catch { return []; } })() });
  } catch (err) {
    log.error('GET /dispatch/call-templates/:type failed', {}, err as Error);
    return c.json({ error: 'Failed to get template' }, 500);
  }
});

// PUT /api/dispatch/call-templates/:type (admin only — update a template)
callTemplates.put('/:type', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    await ensureCallTemplatesTable(db);
    const type = (c.req.param('type') ?? '').toUpperCase();
    const body = await c.req.json<Record<string, unknown>>();

    await execute(db,
      `UPDATE call_templates SET
        default_priority = COALESCE(?, default_priority),
        default_disposition = COALESCE(?, default_disposition),
        suggested_unit_count = COALESCE(?, suggested_unit_count),
        checklist_items = COALESCE(?, checklist_items),
        updated_at = datetime('now')
       WHERE type = ?`,
      body.default_priority ?? null,
      body.default_disposition ?? null,
      body.suggested_unit_count ?? null,
      body.checklist_items != null ? JSON.stringify(body.checklist_items) : null,
      type,
    );

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM call_templates WHERE type = ?', type);
    if (!updated) return c.json({ error: 'Template not found' }, 404);
    return c.json(updated);
  } catch (err) {
    log.error('PUT /dispatch/call-templates/:type failed', {}, err as Error);
    return c.json({ error: 'Failed to update template' }, 500);
  }
});

export { ensureCallTemplatesTable };
export default callTemplates;
