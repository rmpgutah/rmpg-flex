// ============================================================
// RMPG Flex — business_visits routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/businessVisits.ts. Append-only
// patrol log for officer drop-ins / premise checks at a business
// location. officer_id is always taken from the JWT, never the
// request body, to prevent spoofing.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { auditLog } from '../worker-middleware/auditLogger';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

export function mountBusinessVisitsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  let schemaReady = false;
  async function ensureSchema(db: D1Db): Promise<void> {
    if (schemaReady) return;
    try {
      await db.prepare(`CREATE TABLE IF NOT EXISTS business_visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id INTEGER NOT NULL,
        officer_id INTEGER NOT NULL,
        latitude REAL,
        longitude REAL,
        notes TEXT,
        visit_at TEXT DEFAULT (datetime('now','localtime'))
      )`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_business_visits_business_visit_at ON business_visits(business_id, visit_at)`).run();
      schemaReady = true;
    } catch { /* non-fatal */ }
  }

  // GET /api/business-visits/:businessId?since=YYYY-MM-DD&limit=N
  // Most recent first; default LIMIT 50, capped at 200.
  api.get('/:businessId',
    requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer', 'client_viewer', 'human_resources', 'contract_manager'),
    async (c) => {
      try {
        const db = new D1Db(c.env.DB);
        await ensureSchema(db);
        const businessId = paramNum(c.req.param('businessId'));
        const since = (c.req.query('since') || '').trim();
        const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);

        const params: any[] = [businessId];
        let where = 'business_id = ?';
        if (since) { where += ' AND visit_at >= ?'; params.push(since); }
        params.push(limit);

        const rows = await db.prepare(`
          SELECT * FROM business_visits
          WHERE ${where}
          ORDER BY visit_at DESC
          LIMIT ?
        `).all(...params);
        return c.json(rows);
      } catch (err: any) {
        return c.json({ error: 'Failed to load business visits', code: 'LOAD_BUSINESS_VISITS_ERROR', detail: err?.message }, 500);
      }
    },
  );

  // POST /api/business-visits — log a visit. officer_id comes from JWT only.
  api.post('/',
    requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
    async (c) => {
      try {
        const db = new D1Db(c.env.DB);
        await ensureSchema(db);
        const user = c.get('user');
        if (!user?.userId) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);

        const body = await c.req.json<any>();
        const { business_id, latitude, longitude, notes } = body || {};
        if (!business_id) return c.json({ error: 'business_id required', code: 'BUSINESS_ID_REQUIRED' }, 400);

        const biz = await db.prepare('SELECT id FROM businesses WHERE id = ?').get(business_id);
        if (!biz) return c.json({ error: 'Business not found', code: 'BUSINESS_NOT_FOUND' }, 404);

        const result = await db.prepare(`
          INSERT INTO business_visits (business_id, officer_id, latitude, longitude, notes)
          VALUES (?, ?, ?, ?, ?)
        `).run(business_id, user.userId, latitude ?? null, longitude ?? null, notes || null);

        const row = await db.prepare('SELECT * FROM business_visits WHERE id = ?').get(Number(result.meta.last_row_id));
        await auditLog(db, c, 'CREATE', 'business_visit', Number(result.meta.last_row_id),
          `Logged visit to business ${business_id}`);

        try {
          const { broadcastDispatchUpdate } = await import('../worker-middleware/websocket');
          broadcastDispatchUpdate({ action: 'business_visits_updated', business_id });
        } catch { /* non-fatal */ }

        return c.json(row, 201);
      } catch (err: any) {
        return c.json({ error: 'Failed to log business visit', code: 'LOG_BUSINESS_VISIT_ERROR', detail: err?.message }, 500);
      }
    },
  );

  app.route('/api/business-visits', api);
}
