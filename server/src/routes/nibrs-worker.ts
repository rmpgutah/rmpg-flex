// ============================================================
// RMPG Flex — NIBRS (Hono / D1 port)
// Hono port of server/src/routes/nibrs.ts.
//   GET  /api/nibrs/codes                bundled
//   GET  /api/nibrs/codes/offenses       offense list (filterable)
//   GET  /api/nibrs/codes/{locations,weapons,biases,properties,loss-types}
//   POST /api/nibrs/export?from=&to=     flat-file or dryRun JSON
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
import { buildNibrsExport } from '../worker-middleware/nibrsFlatFile';

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const EXPORT_ROLES = ['admin', 'manager', 'supervisor'] as const;

export function mountNibrsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /codes — bundled response for client dropdowns
  api.get('/codes', requireRole(...READ_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const [offenses, locations, weapons, biases, properties, lossTypes] = await Promise.all([
        db.prepare('SELECT * FROM nibrs_offense_codes WHERE active = 1 ORDER BY ucr_group, code').all(),
        db.prepare('SELECT * FROM nibrs_location_codes ORDER BY code').all(),
        db.prepare('SELECT * FROM nibrs_weapon_codes ORDER BY code').all(),
        db.prepare('SELECT * FROM nibrs_bias_codes ORDER BY code').all(),
        db.prepare('SELECT * FROM nibrs_property_descriptions ORDER BY code').all(),
        db.prepare('SELECT * FROM nibrs_property_loss_types ORDER BY code').all(),
      ]);
      return c.json({ offenses, locations, weapons, biases, properties, lossTypes });
    } catch (err) {
      console.error('[nibrs] codes bundle error', err);
      return c.json({ error: 'Failed to load NIBRS codes', code: 'NIBRS_ALL_ERR' }, 500);
    }
  });

  // GET /codes/offenses?group=A|B&active=1
  api.get('/codes/offenses', requireRole(...READ_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const group = (c.req.query('group') || '').toUpperCase();
      const activeOnly = c.req.query('active') !== '0';
      const wheres: string[] = [];
      const params: any[] = [];
      if (group === 'A' || group === 'B') {
        wheres.push('ucr_group = ?');
        params.push(group);
      }
      if (activeOnly) wheres.push('active = 1');
      const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
      const rows = await db.prepare(`SELECT * FROM nibrs_offense_codes ${where} ORDER BY ucr_group, code`).all(...params);
      return c.json(rows);
    } catch (err) {
      console.error('[nibrs] offenses error', err);
      return c.json({ error: 'Failed to list NIBRS offenses', code: 'NIBRS_LIST_ERR' }, 500);
    }
  });

  const simpleList = (table: string, code: string) => async (c: any) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`SELECT * FROM ${table} ORDER BY code`).all();
      return c.json(rows);
    } catch (err) {
      console.error(`[nibrs] ${table} error`, err);
      return c.json({ error: `Failed to list ${table}`, code }, 500);
    }
  };
  api.get('/codes/locations',  requireRole(...READ_ROLES), simpleList('nibrs_location_codes', 'NIBRS_LOC_ERR'));
  api.get('/codes/weapons',    requireRole(...READ_ROLES), simpleList('nibrs_weapon_codes', 'NIBRS_WEAPON_ERR'));
  api.get('/codes/biases',     requireRole(...READ_ROLES), simpleList('nibrs_bias_codes', 'NIBRS_BIAS_ERR'));
  api.get('/codes/properties', requireRole(...READ_ROLES), simpleList('nibrs_property_descriptions', 'NIBRS_PROP_ERR'));
  api.get('/codes/loss-types', requireRole(...READ_ROLES), simpleList('nibrs_property_loss_types', 'NIBRS_LOSS_ERR'));

  // POST /export — flat-file or dry-run JSON
  api.post('/export', requireRole(...EXPORT_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user') as JwtPayload;
      const fromStr = c.req.query('from') || '';
      const toStr = c.req.query('to') || '';
      const fromDate = new Date(fromStr || '1970-01-01');
      const toDate = new Date(toStr || new Date().toISOString());
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return c.json({ error: 'Invalid from/to date (use YYYY-MM-DD)', code: 'NIBRS_BAD_DATES' }, 400);
      }
      if (toDate < fromDate) {
        return c.json({ error: 'to must be >= from', code: 'NIBRS_DATE_ORDER' }, 400);
      }

      const dryRun = c.req.query('dryRun') === '1';
      const force = c.req.query('force') === '1' && user.role === 'admin';
      const env = c.env as Env & { NIBRS_AGENCY_ORI?: string };

      const result = await buildNibrsExport(db, env, {
        fromDate, toDate, enforceValidation: !force,
      });

      if (dryRun) {
        return c.json({
          from: fromStr, to: toStr,
          included: result.included,
          excluded: result.excluded,
          totalSegments: result.totalSegments,
          force,
        });
      }

      const filename = `nibrs-${fromStr || 'start'}-to-${toStr || 'now'}.dat`;
      return new Response(result.content, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-NIBRS-Included-Count': String(result.included.length),
          'X-NIBRS-Excluded-Count': String(result.excluded.length),
          'X-NIBRS-Segment-Count': String(result.totalSegments),
        },
      });
    } catch (err) {
      console.error('[nibrs] export error', err);
      return c.json({ error: 'NIBRS export failed', code: 'NIBRS_EXPORT_ERR' }, 500);
    }
  });

  app.route('/api/nibrs', api);
}
