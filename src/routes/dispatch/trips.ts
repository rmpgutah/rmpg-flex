// src/routes/dispatch/trips.ts
// Read API for unit_trips (Navigation trip logging). The engine writes trips
// server-side (gps.ts / calls.ts / extensions.ts); this exposes them to the
// dispatch board, the Navigation TRIPS drawer, the Map replay selector, and the
// audit Trip Log PDF.
import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute, executeBatch } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';
const trips = new Hono<Env>();

// GET /dispatch/trips?unit_id=&call_id=&from=&to=&limit=&include_noise=
//
// Noise filter (default ON): PATROL trips with distance_m < 50 (≈ 0.03 mi)
// AND duration_s < 180 are detector artifacts — instantaneous open/close
// from a single GPS fix or a momentary speed spike, not real drives. They
// flooded the TRIPS drawer with "0.0 mi · 0 m" rows that drowned out actual
// patrol legs. CALL_RESPONSE trips are NEVER filtered (a 0-mile response
// is still real dispatch audit data).
//
// Pass ?include_noise=1 to see them anyway (admin/debug). Active trips are
// always shown — distance/duration are 0 by definition until they close.
trips.get('/', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const { unit_id, call_id, from, to, limit, include_noise } = c.req.query();
    const where: string[] = [];
    const p: unknown[] = [];
    if (unit_id) { where.push('unit_id = ?'); p.push(Number(unit_id)); }
    if (call_id) { where.push('call_id = ?'); p.push(Number(call_id)); }
    if (from) { where.push('start_time >= ?'); p.push(from); }
    if (to) { where.push('start_time <= ?'); p.push(to); }
    if (include_noise !== '1') {
      where.push(`(
        status = 'active'
        OR trip_type != 'patrol'
        OR COALESCE(distance_m, 0) >= 50
        OR COALESCE(duration_s, 0) >= 180
      )`);
    }
    const sql = `SELECT id, unit_id, officer_id, vehicle_id, trip_type, status, call_id, call_number, call_type, prev_trip_id, start_time, start_lat, start_lng, start_mileage, end_time, end_lat, end_lng, end_mileage, close_reason, distance_m, max_speed, speed_sum, fix_count, max_lat_g, harsh_accel_count, harsh_brake_count, harsh_corner_count, stop_count, anchor_lat, anchor_lng, last_move_at, last_fix_ts, prev_lat, prev_lng, prev_mph, prev_bearing, duration_s, avg_speed, created_at, updated_at FROM unit_trips ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY start_time DESC LIMIT ?`;
    p.push(Math.min(Number(limit) || 100, 500));
    const rows = await query<Record<string, unknown>>(db, sql, ...p);
    return c.json(rows);
  } catch (e) {
    log.error('GET / failed', { src: 'src/routes/dispatch/trips.ts' }, e);
    return c.json({ error: 'Failed to list trips' }, 500);
  }
});

// GET /dispatch/trips/active — one+ active trip per unit (board badges)
trips.get('/active', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT id, unit_id, officer_id, vehicle_id, trip_type, status, call_id, call_number, call_type, prev_trip_id, start_time, start_lat, start_lng, start_mileage, end_time, end_lat, end_lng, end_mileage, close_reason, distance_m, max_speed, speed_sum, fix_count, max_lat_g, harsh_accel_count, harsh_brake_count, harsh_corner_count, stop_count, anchor_lat, anchor_lng, last_move_at, last_fix_ts, prev_lat, prev_lng, prev_mph, prev_bearing, duration_s, avg_speed, created_at, updated_at FROM unit_trips WHERE status = 'active' ORDER BY unit_id, start_time DESC LIMIT 200`);
    return c.json(rows);
  } catch (e) {
    log.error('GET /active failed', { src: 'src/routes/dispatch/trips.ts' }, e);
    return c.json({ error: 'Failed to list active trips' }, 500);
  }
});

// GET /dispatch/trips/score-trend?unit_id=&officer_id=&limit=20 — recent trips'
// harsh-event counts for a driving-score trend chart. Read-only, no new scoring
// persisted (the client derives the 0-100 score from these counts via
// tripDrivingScore() in client/src/pages/navigation/drivingScore.ts).
//
// Registered BEFORE the /:id param route below — Hono matches routes in
// registration order, and if /:id came first a request to /score-trend would
// match id="score-trend" instead (see test-workers/tripsScoreTrend.test.ts,
// which proves both the correct response shape AND that this route wins).
trips.get('/score-trend', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const unitId = c.req.query('unit_id');
    const officerId = c.req.query('officer_id');
    const limit = Math.min(Number(c.req.query('limit')) || 20, 100);
    if (!unitId && !officerId) return c.json({ error: 'unit_id or officer_id is required' }, 400);
    const where: string[] = ["status = 'closed'"];
    const params: (string | number)[] = [];
    if (unitId) { where.push('unit_id = ?'); params.push(Number(unitId)); }
    if (officerId) { where.push('officer_id = ?'); params.push(Number(officerId)); }
    const rows = await query<{ id: number; start_time: string; harsh_accel_count: number; harsh_brake_count: number; harsh_corner_count: number }>(
      db,
      `SELECT id, start_time, harsh_accel_count, harsh_brake_count, harsh_corner_count
       FROM unit_trips WHERE ${where.join(' AND ')} ORDER BY start_time DESC LIMIT ?`,
      ...params, limit);
    return c.json(rows);
  } catch (e) {
    log.error('GET /score-trend failed', { src: 'src/routes/dispatch/trips.ts' }, e);
    return c.json({ error: 'Failed to load score trend' }, 500);
  }
});

// GET /dispatch/trips/:id — trip + its breadcrumbs (for replay)
trips.get('/:id', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const trip = await queryFirst<Record<string, unknown>>(db, 'SELECT id, unit_id, officer_id, vehicle_id, trip_type, status, call_id, call_number, call_type, prev_trip_id, start_time, start_lat, start_lng, start_mileage, end_time, end_lat, end_lng, end_mileage, close_reason, distance_m, max_speed, speed_sum, fix_count, max_lat_g, harsh_accel_count, harsh_brake_count, harsh_corner_count, stop_count, anchor_lat, anchor_lng, last_move_at, last_fix_ts, prev_lat, prev_lng, prev_mph, prev_bearing, duration_s, avg_speed, created_at, updated_at FROM unit_trips WHERE id = ?', id);
    if (!trip) return c.json({ error: 'Not found' }, 404);
    const points = await query<Record<string, unknown>>(db,
      `SELECT latitude AS lat, longitude AS lng, accuracy, heading, speed, recorded_at AS time
       FROM gps_breadcrumbs WHERE trip_id = ? ORDER BY recorded_at ASC`,
      trip.id);
    return c.json({ ...trip, points });
  } catch (e) {
    log.error('GET /:id failed', { src: 'src/routes/dispatch/trips.ts' }, e);
    return c.json({ error: 'Failed to load trip' }, 500);
  }
});

// DELETE /dispatch/trips/:id — remove a falsely-detected trip record.
//
// Auto-detection can log spurious trips (GPS jumps, parking-lot creep before
// the noise filter existed), and those false rows pollute the audit Trip Log.
// Guarded per the CFS-delete lesson (PR #960): only privileged roles or the
// trip's own officer may delete, the deletion is written to audit_log, and the
// trip's gps_breadcrumbs are DETACHED (trip_id = NULL), never destroyed — the
// raw GPS history survives even if the trip grouping was wrong.
const TRIP_DELETE_ROLES = new Set(['admin', 'manager', 'supervisor', 'dispatcher']);

trips.delete('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid trip id' }, 400);

    const user = c.get('user') as Record<string, unknown> | undefined;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const userId = (user.user_id ?? user.userId ?? user.id) as number | undefined;
    const userRole = (user.role as string | undefined) ?? '';

    const trip = await queryFirst<{ id: number; officer_id: number | null; status: string; trip_type: string; start_time: string; distance_m: number | null }>(
      db, 'SELECT id, officer_id, status, trip_type, start_time, distance_m FROM unit_trips WHERE id = ?', id);
    if (!trip) return c.json({ error: 'Not found' }, 404);

    const isPrivileged = TRIP_DELETE_ROLES.has(userRole);
    const isOwner = trip.officer_id != null && trip.officer_id === userId;
    if (!isPrivileged && !isOwner) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    // Officers (non-privileged) may only delete PATROL trips auto-flagged as
    // false positives. CALL_RESPONSE and TRANSPORT trips are audit-critical
    // and require a supervisor/admin role.
    if (!isPrivileged && ['CALL_RESPONSE', 'call_response', 'TRANSPORT', 'transport'].includes(trip.trip_type)) {
      return c.json({ error: 'Call response and transport trips require supervisor or admin to delete', code: 'AUDIT_TRIP_PROTECTED' }, 403);
    }
    if (trip.status === 'active') {
      return c.json({ error: 'Cannot delete an active trip — end it first' }, 409);
    }

    // Atomic: detach breadcrumbs and delete the trip in a single batch so a
    // mid-flight Worker termination cannot orphan breadcrumbs or leave a
    // trip row with no GPS history.
    await executeBatch(db, [
      { sql: 'UPDATE gps_breadcrumbs SET trip_id = NULL WHERE trip_id = ?', bindings: [id] },
      { sql: 'DELETE FROM unit_trips WHERE id = ?', bindings: [id] },
    ]);

    try {
      await execute(db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        userId ?? null, 'DELETE', 'unit_trip', id,
        `Deleted ${trip.trip_type} trip #${id} (start ${trip.start_time}, ${((trip.distance_m ?? 0) / 1609.34).toFixed(2)} mi) as false record`);
    } catch (auditErr) {
      console.warn('audit_log insert failed for trip delete:', auditErr);
    }

    return c.json({ success: true });
  } catch (e) {
    log.error('DELETE /:id failed', { src: 'src/routes/dispatch/trips.ts' }, e);
    return c.json({ error: 'Failed to delete trip' }, 500);
  }
});

export default trips;
