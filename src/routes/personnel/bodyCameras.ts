// ============================================================
// RMPG Flex — Body Cameras + Bodycam Videos (read + camera CRUD)
// ============================================================
// Two sibling sub-routers, mounted into the personnel router:
//   personnel.route('/body-cameras',     bodyCamerasRouter);
//   personnel.route('/bodycam-videos',   bodycamVideosRouter);
//
// Live D1 schema (confirmed 2026-05-27):
//   body_cameras    — 16 cols (PK id, FK officer_id → users.id,
//                     UNIQUE camera_id [hardware serial],
//                     make, model, firmware_version,
//                     storage_capacity_gb, status, condition,
//                     assigned_at, returned_at, notes,
//                     created_by, created_at, updated_at)
//
//   bodycam_videos  — 17 cols (PK id, FK camera_id → body_cameras.id,
//                     FK officer_id → users.id, title, file_path,
//                     file_size, duration_seconds, mime_type,
//                     recorded_at, case_number, classification,
//                     retention_status, notes, uploaded_by,
//                     created_at, updated_at)
//
// Both well under the D1 100-col-per-result cap, so SELECT * + JOIN
// columns is safe here (no LIST_VIEW_COLUMNS narrowing required).
//
// PR 1 scope: list, detail, and CRUD for body_cameras; list + the
// three placeholder reads (reviews/pending, redaction-requests,
// retention/report) for bodycam_videos. R2 chunked-upload + signed
// playback streaming land in PR 2.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';

// Roles that can see every officer's cameras/videos. Officers (and any
// other role not in this set) are scoped to officer_id = self. The
// supervisor split (read-all but not write) mirrors the spec: gear
// inventory mutations are an admin/manager action only.
const READ_ALL_ROLES = new Set(['admin', 'manager', 'supervisor']);
const WRITE_ROLES    = new Set(['admin', 'manager']);

// Columns a writer may set on a body_cameras row. Intentionally
// excludes id, created_by, created_at, updated_at — those are
// server-managed.
const CAMERA_EDITABLE: readonly string[] = [
  'officer_id', 'camera_id', 'make', 'model', 'firmware_version',
  'storage_capacity_gb', 'status', 'condition',
  'assigned_at', 'returned_at', 'notes',
];

type Actor = { id: number; role: string; full_name?: string };
function getActor(c: { get: (k: string) => unknown }): Actor | null {
  const u = c.get('user') as Actor | undefined;
  return u && typeof u.id === 'number' ? u : null;
}

// ────────────────────────────────────────────────────────────
// /body-cameras
// ────────────────────────────────────────────────────────────
const bodyCamerasRouter = new Hono<Env>();

bodyCamerasRouter.get('/', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const db = getDb(c.env);
    const sql = `
      SELECT bc.*, u.full_name AS officer_name
        FROM body_cameras bc
        LEFT JOIN users u ON u.id = bc.officer_id
       ${READ_ALL_ROLES.has(actor.role) ? '' : 'WHERE bc.officer_id = ?'}
       ORDER BY bc.camera_id`;
    const rows = READ_ALL_ROLES.has(actor.role)
      ? await query<Record<string, unknown>>(db, sql)
      : await query<Record<string, unknown>>(db, sql, actor.id);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/body-cameras failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

bodyCamerasRouter.get('/:id', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid id' }, 400);
    }

    const db = getDb(c.env);
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT bc.*, u.full_name AS officer_name
         FROM body_cameras bc
         LEFT JOIN users u ON u.id = bc.officer_id
        WHERE bc.id = ?`,
      id
    );
    if (!row) return c.json({ error: 'Body camera not found' }, 404);

    if (!READ_ALL_ROLES.has(actor.role) && Number(row.officer_id) !== actor.id) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    return c.json(row);
  } catch (err) {
    console.error('GET /personnel/body-cameras/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

bodyCamerasRouter.post('/', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!WRITE_ROLES.has(actor.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const officerId = Number(body.officer_id);
    const cameraId  = typeof body.camera_id === 'string' ? body.camera_id.trim() : '';
    if (!Number.isInteger(officerId) || officerId <= 0) {
      return c.json({ error: 'officer_id is required' }, 400);
    }
    if (!cameraId) {
      return c.json({ error: 'camera_id (hardware serial) is required' }, 400);
    }

    const db = getDb(c.env);
    // 409 instead of opaque SQLite UNIQUE failure — matches the
    // username-dedup pattern in personnel.ts POST.
    const dup = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM body_cameras WHERE camera_id = ?', cameraId
    );
    if (dup) {
      return c.json({ error: 'camera_id already in use', existing_id: dup.id }, 409);
    }

    const cols: string[] = ['created_by'];
    const vals: unknown[] = [actor.full_name || String(actor.id)];

    for (const key of CAMERA_EDITABLE) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        cols.push(key);
        const raw = body[key];
        vals.push(raw === '' ? null : raw);
      }
    }

    const placeholders = cols.map(() => '?').join(', ');
    const result = await execute(
      db,
      `INSERT INTO body_cameras (${cols.join(', ')}) VALUES (${placeholders})`,
      ...vals
    );
    const newId = result.meta?.last_row_id;
    if (!newId) return c.json({ error: 'Insert succeeded but no id returned' }, 500);

    const created = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT bc.*, u.full_name AS officer_name
         FROM body_cameras bc
         LEFT JOIN users u ON u.id = bc.officer_id
        WHERE bc.id = ?`,
      newId
    );
    return c.json(created, 201);
  } catch (err) {
    console.error('POST /personnel/body-cameras failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

bodyCamerasRouter.put('/:id', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!WRITE_ROLES.has(actor.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid id' }, 400);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number; camera_id: string }>(
      db, 'SELECT id, camera_id FROM body_cameras WHERE id = ?', id
    );
    if (!existing) return c.json({ error: 'Body camera not found' }, 404);

    // If camera_id is changing, defend the UNIQUE constraint with a 409.
    if (typeof body.camera_id === 'string' && body.camera_id.trim() !== existing.camera_id) {
      const dup = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM body_cameras WHERE camera_id = ? AND id != ?',
        body.camera_id.trim(), id
      );
      if (dup) {
        return c.json({ error: 'camera_id already in use', existing_id: dup.id }, 409);
      }
    }

    const setCols: string[] = [];
    const bindings: unknown[] = [];
    for (const key of CAMERA_EDITABLE) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        setCols.push(`${key} = ?`);
        const raw = body[key];
        bindings.push(raw === '' ? null : raw);
      }
    }
    if (setCols.length === 0) {
      return c.json({ error: 'No editable fields provided' }, 400);
    }
    setCols.push('updated_at = CURRENT_TIMESTAMP');

    const sql = `UPDATE body_cameras SET ${setCols.join(', ')} WHERE id = ?`;
    bindings.push(id);
    await execute(db, sql, ...bindings);

    const updated = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT bc.*, u.full_name AS officer_name
         FROM body_cameras bc
         LEFT JOIN users u ON u.id = bc.officer_id
        WHERE bc.id = ?`,
      id
    );
    return c.json(updated);
  } catch (err) {
    console.error('PUT /personnel/body-cameras/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// DELETE — hard delete. The schema declares FK bodycam_videos.camera_id
// → body_cameras.id without ON DELETE CASCADE, and D1 enforces FKs by
// default, so a naked DELETE on a camera with videos raises a foreign-
// key error. The client UI confirm reads "and all associated videos" —
// honor that expectation by deleting referencing videos in the same
// batch. (Hard delete here, not soft, because there's no `status` row
// to flip to 'terminated' and no audit table referencing this row.)
bodyCamerasRouter.delete('/:id', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!WRITE_ROLES.has(actor.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid id' }, 400);
    }

    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM body_cameras WHERE id = ?', id
    );
    if (!existing) return c.json({ error: 'Body camera not found' }, 404);

    await db.batch([
      db.prepare('DELETE FROM bodycam_videos WHERE camera_id = ?').bind(id),
      db.prepare('DELETE FROM body_cameras WHERE id = ?').bind(id),
    ]);

    return c.json({ ok: true, id });
  } catch (err) {
    console.error('DELETE /personnel/body-cameras/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ────────────────────────────────────────────────────────────
// /bodycam-videos
// ────────────────────────────────────────────────────────────
const bodycamVideosRouter = new Hono<Env>();

// Literal sub-paths MUST come before parametric /:id. Hono matches in
// registration order, so /reviews/pending would otherwise be parsed
// as id='reviews' and fall through to the :id handler.

bodycamVideosRouter.get('/reviews/pending', async (c) => {
  // PR 1 stub. A real review queue (assigned reviewers, due dates,
  // escalation) is PR 3+. The client reads `rev.count` — return a
  // shape that lets the badge logic resolve to 0 without throwing.
  return c.json({ count: 0, items: [] });
});

bodycamVideosRouter.get('/redaction-requests', async (c) => {
  // PR 1 stub. The client filters `red.data.filter(r => r.status === 'pending')`,
  // so the shape MUST include a top-level `data` array.
  return c.json({ data: [] });
});

bodycamVideosRouter.get('/retention/report', async (c) => {
  // Counts-only report computed live from bodycam_videos. The client
  // reads `total_expired` and `total_storage_gb`; the other fields
  // give the dashboard headroom to surface inventory totals without
  // a follow-up endpoint.
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{
      total: number;
      retained: number;
      total_expired: number;
      purged_this_month: number;
      total_bytes: number;
    }>(db, `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN retention_status = 'active'  THEN 1 ELSE 0 END) AS retained,
        SUM(CASE WHEN retention_status = 'expired' THEN 1 ELSE 0 END) AS total_expired,
        SUM(CASE
              WHEN retention_status = 'purged'
               AND updated_at >= strftime('%Y-%m-01', 'now')
              THEN 1 ELSE 0 END) AS purged_this_month,
        COALESCE(SUM(file_size), 0) AS total_bytes
      FROM bodycam_videos
    `);
    const totalBytes = Number(row?.total_bytes ?? 0);
    return c.json({
      total: Number(row?.total ?? 0),
      retained: Number(row?.retained ?? 0),
      total_expired: Number(row?.total_expired ?? 0),
      eligible_for_purge: Number(row?.total_expired ?? 0),
      purged_this_month: Number(row?.purged_this_month ?? 0),
      total_storage_gb: Math.round((totalBytes / 1e9) * 100) / 100,
    });
  } catch (err) {
    console.error('GET /personnel/bodycam-videos/retention/report failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

bodycamVideosRouter.get('/', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const { case_number } = c.req.query();
    const db = getDb(c.env);
    const where: string[] = [];
    const bindings: unknown[] = [];

    if (!READ_ALL_ROLES.has(actor.role)) {
      where.push('v.officer_id = ?');
      bindings.push(actor.id);
    }
    if (case_number) {
      where.push('v.case_number = ?');
      bindings.push(case_number);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
      SELECT v.*,
             u.full_name AS officer_name,
             c.camera_id AS camera_serial
        FROM bodycam_videos v
        LEFT JOIN users u        ON u.id = v.officer_id
        LEFT JOIN body_cameras c ON c.id = v.camera_id
       ${whereSql}
       ORDER BY v.recorded_at DESC, v.id DESC`;
    const rows = await query<Record<string, unknown>>(db, sql, ...bindings);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/bodycam-videos failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

bodycamVideosRouter.get('/:id', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid id' }, 400);
    }

    const db = getDb(c.env);
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT v.*,
              u.full_name AS officer_name,
              c.camera_id AS camera_serial
         FROM bodycam_videos v
         LEFT JOIN users u        ON u.id = v.officer_id
         LEFT JOIN body_cameras c ON c.id = v.camera_id
        WHERE v.id = ?`,
      id
    );
    if (!row) return c.json({ error: 'Video not found' }, 404);

    if (!READ_ALL_ROLES.has(actor.role) && Number(row.officer_id) !== actor.id) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    return c.json(row);
  } catch (err) {
    console.error('GET /personnel/bodycam-videos/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

export { bodyCamerasRouter, bodycamVideosRouter };
