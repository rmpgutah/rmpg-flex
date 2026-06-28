// ============================================================
// Audit-log query scoped to a vehicle.
//
// Used by the v2 Fleet UI's Activity tab to render a chronological
// feed of who-changed-what for a single vehicle. Read-only; no auth
// elevation beyond the standard authMiddleware.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

interface AuditRow {
  id: number;
  action: string;
  details: string | null;
  created_at: string;
  user_id: number | null;
}

const route = new Hono<Env>();

route.get('/:id', async (c) => {
  const idRaw = c.req.param('id');
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: 'invalid vehicle id' }, 400);
  }
  const limitRaw = Number(c.req.query('limit') ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 100);
  const db = getDb(c.env);
  const rows = await query<AuditRow>(
    db,
    `SELECT id, action, details, created_at, user_id
     FROM audit_log
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    'vehicle', id, limit,
  );
  return c.json({ rows });
});

export default route;
