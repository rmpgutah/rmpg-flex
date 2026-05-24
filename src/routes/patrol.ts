// ============================================================
// RMPG Flex — Patrol (Cloudflare Worker)
// ============================================================
// Checkpoints + scans + breaks + tour verifications.
// Phase 1 RMS port — MVP scope covers the daily officer workflow.
//
// Migration: 0034_patrol.sql.
//
// Endpoints (19 MVP of 31 legacy):
//   GET    /checkpoints                     list (filter by property/active)
//   GET    /checkpoints/property/:propertyId
//   GET    /checkpoints/map                 lat/lng-only for map view
//   GET    /checkpoints/:id/instructions    special_instructions only
//   POST   /checkpoints                     admin/manager/supervisor
//   PUT    /checkpoints/:id
//   DELETE /checkpoints/:id
//   POST   /checkpoints/:id/archive
//   POST   /checkpoints/:id/unarchive
//   POST   /scan                            officer logs scan (auto on_time/late)
//   GET    /scans                           filter by officer/checkpoint/date
//   GET    /compliance                      property/officer roll-up
//   GET    /exceptions                      late + missed scans
//   GET    /shift-summary                   officer's scans + breaks for date
//   POST   /breaks/start
//   POST   /breaks/end
//   GET    /breaks                          filter by officer/date
//   POST   /verify-tour                     supervisor sign-off
//   GET    /verifications
//
// Deferred (analytics-heavy, can layer later):
//   - /optimize-route, /coverage-heatmap, /coverage/analysis
//   - /log/generate, /scans/export (PDF/CSV bulk export)
//   - /scan/:scanId/create-incident, /scan/:scanId/weather
//   - /efficiency, /time-tracking, /compliance/by-officer
//   - /breaks/summary, /proximity-check
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const pt = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

const SCAN_STATUSES = new Set(['on_time', 'late', 'missed']);
const BREAK_TYPES = new Set(['break', 'meal', 'rest']);

// ─────────────────────────────────────────────────────────────
// Static / specific paths first (Hono trie still prefers literals,
// but explicit ordering documents the contract).
// ─────────────────────────────────────────────────────────────

// GET /checkpoints/map
pt.get('/checkpoints/map', async (c) => {
  const propertyId = c.req.query('property_id');
  const where: string[] = ['is_active = 1', 'latitude IS NOT NULL', 'longitude IS NOT NULL'];
  const args: any[] = [];
  if (propertyId) { where.push('property_id = ?'); args.push(parseInt(propertyId, 10)); }
  const rows = await query(
    getDb(c.env),
    `SELECT id, property_id, name, latitude, longitude, sequence_order
       FROM patrol_checkpoints WHERE ${where.join(' AND ')} ORDER BY sequence_order`,
    ...args,
  );
  return c.json(rows);
});

// GET /checkpoints/property/:propertyId
pt.get('/checkpoints/property/:propertyId', async (c) => {
  const propertyId = parseInt(c.req.param('propertyId'), 10);
  if (isNaN(propertyId)) return c.json({ error: 'Invalid propertyId' }, 400);
  const includeArchived = c.req.query('include_archived') === '1';
  const sql = `SELECT * FROM patrol_checkpoints WHERE property_id = ?
               ${includeArchived ? '' : 'AND is_active = 1'}
               ORDER BY sequence_order ASC, id ASC`;
  return c.json(await query(getDb(c.env), sql, propertyId));
});

// GET /checkpoints/:id/instructions
pt.get('/checkpoints/:id/instructions', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await queryFirst<{ id: number; name: string; special_instructions: string; location_description: string }>(
    getDb(c.env),
    'SELECT id, name, special_instructions, location_description FROM patrol_checkpoints WHERE id = ?',
    id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

// GET /checkpoints
pt.get('/checkpoints', async (c) => {
  const propertyId = c.req.query('property_id');
  const includeArchived = c.req.query('include_archived') === '1';
  const where: string[] = [];
  const args: any[] = [];
  if (propertyId) { where.push('property_id = ?'); args.push(parseInt(propertyId, 10)); }
  if (!includeArchived) where.push('is_active = 1');
  const sql = `SELECT * FROM patrol_checkpoints
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY property_id, sequence_order, id LIMIT 1000`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

// POST /checkpoints
pt.post('/checkpoints', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.property_id || !body.name) {
    return c.json({ error: 'property_id and name required' }, 400);
  }
  const r = await execute(
    getDb(c.env),
    `INSERT INTO patrol_checkpoints (
       property_id, assigned_officer_id, name, description, location_description,
       special_instructions, latitude, longitude, qr_code, sequence_order,
       scan_required_interval_minutes, is_active
     ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?)`,
    body.property_id, body.assigned_officer_id ?? null, body.name, body.description ?? null,
    body.location_description ?? null, body.special_instructions ?? null,
    body.latitude ?? null, body.longitude ?? null, body.qr_code ?? null,
    body.sequence_order ?? 0, body.scan_required_interval_minutes ?? 60,
    body.is_active === false ? 0 : 1,
  );
  return c.json({ success: true, id: r.meta.last_row_id }, 201);
});

// PUT /checkpoints/:id
pt.put('/checkpoints/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const allowed = [
    'property_id', 'assigned_officer_id', 'name', 'description', 'location_description',
    'special_instructions', 'latitude', 'longitude', 'qr_code', 'sequence_order',
    'scan_required_interval_minutes', 'is_active',
  ];
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) {
    if (!(k in body)) continue;
    sets.push(`${k} = ?`);
    args.push(k === 'is_active' ? (body[k] ? 1 : 0) : body[k]);
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  args.push(id);
  await execute(getDb(c.env), `UPDATE patrol_checkpoints SET ${sets.join(', ')} WHERE id = ?`, ...args);
  return c.json({ success: true });
});

// DELETE /checkpoints/:id
pt.delete('/checkpoints/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await execute(getDb(c.env), 'DELETE FROM patrol_checkpoints WHERE id = ?', id);
  return c.json({ success: true });
});

// POST /checkpoints/:id/archive
pt.post('/checkpoints/:id/archive', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await execute(
    getDb(c.env),
    `UPDATE patrol_checkpoints SET is_active = 0, archived_at = datetime('now','localtime') WHERE id = ?`,
    id,
  );
  return c.json({ success: true });
});

// POST /checkpoints/:id/unarchive
pt.post('/checkpoints/:id/unarchive', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  await execute(
    getDb(c.env),
    `UPDATE patrol_checkpoints SET is_active = 1, archived_at = NULL WHERE id = ?`,
    id,
  );
  return c.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
// Scans
// ─────────────────────────────────────────────────────────────

// POST /scan — officer logs a checkpoint scan. Auto-classifies
// status as 'on_time' or 'late' based on last scan + interval.
pt.post('/scan', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.checkpoint_id) return c.json({ error: 'checkpoint_id required' }, 400);
  const db = getDb(c.env);

  const cp = await queryFirst<{ scan_required_interval_minutes: number; is_active: number }>(
    db, 'SELECT scan_required_interval_minutes, is_active FROM patrol_checkpoints WHERE id = ?', body.checkpoint_id,
  );
  if (!cp) return c.json({ error: 'Checkpoint not found' }, 404);
  if (!cp.is_active) return c.json({ error: 'Checkpoint is archived' }, 400);

  // Classify on_time/late by comparing minutes-since-last-scan to interval.
  const last = await queryFirst<{ scanned_at: string }>(
    db, 'SELECT scanned_at FROM patrol_scans WHERE checkpoint_id = ? ORDER BY id DESC LIMIT 1', body.checkpoint_id,
  );
  let status = 'on_time';
  if (last?.scanned_at) {
    const lastMs = new Date(last.scanned_at.replace(' ', 'T')).getTime();
    const minutesSince = (Date.now() - lastMs) / 60000;
    if (minutesSince > cp.scan_required_interval_minutes * 1.5) status = 'late';
  }
  if (body.status && SCAN_STATUSES.has(body.status)) status = body.status; // explicit override

  const r = await execute(
    db,
    `INSERT INTO patrol_scans (checkpoint_id, officer_id, latitude, longitude, notes, status, weather_json)
     VALUES (?,?,?,?,?,?,?)`,
    body.checkpoint_id, user.id, body.latitude ?? null, body.longitude ?? null,
    body.notes ?? null, status, body.weather_json ? JSON.stringify(body.weather_json) : null,
  );
  return c.json({ success: true, id: r.meta.last_row_id, status }, 201);
});

// GET /scans
pt.get('/scans', async (c) => {
  const officerId = c.req.query('officer_id');
  const checkpointId = c.req.query('checkpoint_id');
  const propertyId = c.req.query('property_id');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const where: string[] = [];
  const args: any[] = [];
  if (officerId) { where.push('s.officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (checkpointId) { where.push('s.checkpoint_id = ?'); args.push(parseInt(checkpointId, 10)); }
  if (propertyId) { where.push('cp.property_id = ?'); args.push(parseInt(propertyId, 10)); }
  if (from) { where.push('s.scanned_at >= ?'); args.push(from); }
  if (to) { where.push('s.scanned_at <= ?'); args.push(to); }
  const sql = `
    SELECT s.*, cp.name AS checkpoint_name, cp.property_id, u.full_name AS officer_name
      FROM patrol_scans s
      LEFT JOIN patrol_checkpoints cp ON cp.id = s.checkpoint_id
      LEFT JOIN users u ON u.id = s.officer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.scanned_at DESC LIMIT 500`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

// GET /compliance — per-property scan rate over a window
pt.get('/compliance', async (c) => {
  const propertyId = c.req.query('property_id');
  const days = parseInt(c.req.query('days') || '7', 10);
  const args: any[] = [days];
  let where = '';
  if (propertyId) { where = 'AND cp.property_id = ?'; args.push(parseInt(propertyId, 10)); }
  const rows = await query<any>(
    getDb(c.env),
    `SELECT cp.id, cp.name, cp.property_id,
            COUNT(s.id) AS scans,
            SUM(CASE WHEN s.status='on_time' THEN 1 ELSE 0 END) AS on_time,
            SUM(CASE WHEN s.status='late' THEN 1 ELSE 0 END) AS late,
            SUM(CASE WHEN s.status='missed' THEN 1 ELSE 0 END) AS missed
       FROM patrol_checkpoints cp
       LEFT JOIN patrol_scans s
         ON s.checkpoint_id = cp.id
        AND s.scanned_at >= datetime('now','localtime','-' || ? || ' days')
       WHERE cp.is_active = 1 ${where}
       GROUP BY cp.id, cp.name, cp.property_id
       ORDER BY cp.property_id, cp.sequence_order`,
    ...args,
  );
  return c.json({
    days,
    checkpoints: rows.map((r) => ({
      ...r,
      on_time_pct: r.scans ? Math.round((r.on_time / r.scans) * 10000) / 100 : 0,
    })),
  });
});

// GET /exceptions — late / missed scans needing attention
pt.get('/exceptions', async (c) => {
  const days = parseInt(c.req.query('days') || '3', 10);
  const rows = await query(
    getDb(c.env),
    `SELECT s.*, cp.name AS checkpoint_name, cp.property_id, u.full_name AS officer_name
       FROM patrol_scans s
       LEFT JOIN patrol_checkpoints cp ON cp.id = s.checkpoint_id
       LEFT JOIN users u ON u.id = s.officer_id
       WHERE s.status IN ('late','missed')
         AND s.scanned_at >= datetime('now','localtime','-' || ? || ' days')
       ORDER BY s.scanned_at DESC LIMIT 200`,
    days,
  );
  return c.json(rows);
});

// GET /shift-summary — single officer's scans + breaks for a date
pt.get('/shift-summary', async (c) => {
  const officerId = parseInt(c.req.query('officer_id') || '0', 10);
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  if (!officerId) return c.json({ error: 'officer_id required' }, 400);
  const db = getDb(c.env);
  const scans = await query<any>(
    db,
    `SELECT s.*, cp.name AS checkpoint_name FROM patrol_scans s
       LEFT JOIN patrol_checkpoints cp ON cp.id = s.checkpoint_id
       WHERE s.officer_id = ? AND date(s.scanned_at) = ?
       ORDER BY s.scanned_at ASC`,
    officerId, date,
  );
  const breaks = await query(
    db,
    `SELECT * FROM patrol_breaks WHERE officer_id = ? AND shift_date = ? ORDER BY break_start ASC`,
    officerId, date,
  );
  return c.json({ officer_id: officerId, date, scans, breaks, scan_count: scans.length });
});

// ─────────────────────────────────────────────────────────────
// Breaks
// ─────────────────────────────────────────────────────────────

// POST /breaks/start
pt.post('/breaks/start', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const body = await c.req.json<any>().catch(() => ({}));
  const breakType = BREAK_TYPES.has(body.break_type) ? body.break_type : 'break';
  const today = new Date().toISOString().slice(0, 10);
  const r = await execute(
    getDb(c.env),
    `INSERT INTO patrol_breaks (officer_id, shift_date, break_start, break_type)
     VALUES (?,?, datetime('now','localtime'), ?)`,
    user.id, body.shift_date ?? today, breakType,
  );
  return c.json({ success: true, id: r.meta.last_row_id }, 201);
});

// POST /breaks/end — close the most-recent open break for this officer.
// duration_minutes is computed in SQL to keep the clock authoritative.
pt.post('/breaks/end', async (c) => {
  const user = c.get('user') as { id: number } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const db = getDb(c.env);
  const open = await queryFirst<{ id: number; break_start: string }>(
    db,
    `SELECT id, break_start FROM patrol_breaks
       WHERE officer_id = ? AND break_end IS NULL
       ORDER BY id DESC LIMIT 1`,
    user.id,
  );
  if (!open) return c.json({ error: 'No open break to end' }, 404);
  await execute(
    db,
    `UPDATE patrol_breaks
       SET break_end = datetime('now','localtime'),
           duration_minutes = (julianday(datetime('now','localtime')) - julianday(break_start)) * 1440
     WHERE id = ?`,
    open.id,
  );
  return c.json({ success: true, id: open.id });
});

// GET /breaks
pt.get('/breaks', async (c) => {
  const officerId = c.req.query('officer_id');
  const date = c.req.query('date');
  const where: string[] = [];
  const args: any[] = [];
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (date) { where.push('shift_date = ?'); args.push(date); }
  const sql = `SELECT * FROM patrol_breaks ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY break_start DESC LIMIT 200`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

// ─────────────────────────────────────────────────────────────
// Tour verifications
// ─────────────────────────────────────────────────────────────

// POST /verify-tour — supervisor approves a tour. Snapshots total +
// on-time scan counts from patrol_scans for the (officer,date) pair.
pt.post('/verify-tour', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.officer_id || !body.tour_date) {
    return c.json({ error: 'officer_id and tour_date required' }, 400);
  }
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);
  const totals = await queryFirst<{ total: number; on_time: number }>(
    db,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='on_time' THEN 1 ELSE 0 END) AS on_time
       FROM patrol_scans WHERE officer_id = ? AND date(scanned_at) = ?`,
    body.officer_id, body.tour_date,
  );
  const status = body.status === 'rejected' ? 'rejected' : 'approved';
  // Upsert via INSERT OR REPLACE on the UNIQUE(officer_id, tour_date).
  const r = await execute(
    db,
    `INSERT INTO patrol_tour_verifications
       (officer_id, tour_date, verified_by, verified_at, status, notes, total_scans, on_time_scans)
     VALUES (?,?,?, datetime('now','localtime'), ?, ?, ?, ?)
     ON CONFLICT(officer_id, tour_date) DO UPDATE SET
       verified_by = excluded.verified_by,
       verified_at = excluded.verified_at,
       status = excluded.status,
       notes = excluded.notes,
       total_scans = excluded.total_scans,
       on_time_scans = excluded.on_time_scans,
       updated_at = datetime('now','localtime')`,
    body.officer_id, body.tour_date, user?.id ?? null, status, body.notes ?? null,
    totals?.total ?? 0, totals?.on_time ?? 0,
  );
  return c.json({ success: true, id: r.meta.last_row_id, status, totals });
});

// GET /verifications
pt.get('/verifications', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const officerId = c.req.query('officer_id');
  const where: string[] = [];
  const args: any[] = [];
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  const sql = `SELECT v.*, o.full_name AS officer_name, vb.full_name AS verified_by_name
                 FROM patrol_tour_verifications v
                 LEFT JOIN users o ON o.id = v.officer_id
                 LEFT JOIN users vb ON vb.id = v.verified_by
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY v.tour_date DESC LIMIT 200`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

export default pt;
