// ============================================================
// RMPG Flex — business_visits (Cloudflare Worker)
// ============================================================
// Append-only patrol log for officer drop-ins / premise checks
// at a business location. officer_id is ALWAYS taken from the
// JWT, never the request body, to prevent spoofing.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { broadcastAll } from '../ws';

const businessVisits = new Hono<Env>();

// GET /api/business-visits/:businessId?since=YYYY-MM-DD&limit=N
// Most recent first; default LIMIT 50, capped at 200.
businessVisits.get('/:businessId', async (c) => {
  try {
    const db = getDb(c.env);
    const businessId = parseInt(c.req.param('businessId'), 10);
    const since = (c.req.query('since') || '').trim();
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);

    let rows;
    if (since) {
      rows = await query<Record<string, unknown>>(
        db,
        `SELECT * FROM business_visits
         WHERE business_id = ? AND visit_at >= ?
         ORDER BY visit_at DESC LIMIT ?`,
        businessId, since, limit,
      );
    } else {
      rows = await query<Record<string, unknown>>(
        db,
        `SELECT * FROM business_visits
         WHERE business_id = ?
         ORDER BY visit_at DESC LIMIT ?`,
        businessId, limit,
      );
    }
    return c.json(rows);
  } catch (err) {
    return c.json({
      error: 'Failed to load business visits',
      code: 'LOAD_BUSINESS_VISITS_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// POST /api/business-visits — log a visit. officer_id from JWT only.
businessVisits.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json<{
      business_id: number; latitude?: number; longitude?: number; notes?: string;
    }>();
    const { business_id, latitude, longitude, notes } = body || ({} as never);
    if (!business_id) return c.json({ error: 'business_id required' }, 400);

    const biz = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM businesses WHERE id = ?', business_id,
    );
    if (!biz) return c.json({ error: 'Business not found' }, 404);

    const result = await execute(
      db,
      `INSERT INTO business_visits
         (business_id, officer_id, latitude, longitude, notes)
       VALUES (?, ?, ?, ?, ?)`,
      business_id, userId, latitude ?? null, longitude ?? null, notes ?? null,
    );

    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM business_visits WHERE id = ?', Number(result.meta.last_row_id),
    );

    broadcastAll('business_update', {
      action: 'business_visits_updated', business_id,
    });

    return c.json(row, 201);
  } catch (err) {
    return c.json({
      error: 'Failed to log business visit',
      code: 'LOG_BUSINESS_VISIT_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default businessVisits;
