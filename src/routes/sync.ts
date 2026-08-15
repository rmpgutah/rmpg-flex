import { Hono } from 'hono';
import { log } from '../utils/logger';
import { replayQueue } from '../utils/syncConflict';
import type { Bindings, Variables } from '../types';

const sync = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/sync/queue — pending/failed queue counts (admin)
sync.get('/queue', async (c) => {
  const db = c.env.DB;
  const [pending, failed, delivered] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'`).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) as count FROM sync_queue WHERE status = 'failed'`).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) as count FROM sync_queue WHERE status = 'delivered'`).first<{ count: number }>(),
  ]);
  return c.json({
    pending: pending?.count ?? 0,
    failed: failed?.count ?? 0,
    delivered: delivered?.count ?? 0,
  });
});

// GET /api/sync/conflicts — paginated conflict audit log (admin)
sync.get('/conflicts', async (c) => {
  const db = c.env.DB;
  const page = parseInt(c.req.query('page') ?? '1');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 200);
  const tableName = c.req.query('table');
  const offset = (page - 1) * limit;

  const whereClause = tableName ? 'WHERE table_name = ?' : '';
  const bindings = tableName ? [tableName, limit, offset] : [limit, offset];

  const rows = await db.prepare(
    `SELECT id, table_name, record_id, fz55_updated_at, cloud_updated_at,
            winning_source, resolved_at, sync_queue_id
     FROM sync_conflicts
     ${whereClause}
     ORDER BY resolved_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...bindings).all();

  return c.json({ conflicts: rows.results, page, limit });
});

// POST /api/sync/replay — manual trigger (admin/manager only)
sync.post('/replay', async (c) => {
  const user = c.get('user');
  if (!user || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const result = await replayQueue(c.env.DB, c.env.JWT_SECRET ?? '');
  log.info('manual sync replay triggered', { ...result, userId: user.id });
  return c.json(result);
});

export default sync;
