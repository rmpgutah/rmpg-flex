// src/routes/dispatch/trips.ts
// Read API for unit_trips (Navigation trip logging). The engine writes trips
// server-side (gps.ts / calls.ts / extensions.ts); this exposes them to the
// dispatch board, the Navigation TRIPS drawer, the Map replay selector, and the
// audit Trip Log PDF.
import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';

const trips = new Hono<Env>();

// GET /dispatch/trips?unit_id=&call_id=&from=&to=&limit=
trips.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { unit_id, call_id, from, to, limit } = c.req.query();
    const where: string[] = [];
    const p: unknown[] = [];
    if (unit_id) { where.push('unit_id = ?'); p.push(Number(unit_id)); }
    if (call_id) { where.push('call_id = ?'); p.push(Number(call_id)); }
    if (from) { where.push('start_time >= ?'); p.push(from); }
    if (to) { where.push('start_time <= ?'); p.push(to); }
    const sql = `SELECT id, unit_id, officer_id, vehicle_id, trip_type, status, call_id, call_number, call_type, prev_trip_id, start_time, start_lat, start_lng, start_mileage, end_time, end_lat, end_lng, end_mileage, close_reason, distance_m, max_speed, speed_sum, fix_count, max_lat_g, harsh_accel_count, harsh_brake_count, harsh_corner_count, stop_count, anchor_lat, anchor_lng, last_move_at, last_fix_ts, prev_lat, prev_lng, prev_mph, prev_bearing, duration_s, avg_speed, created_at, updated_at FROM unit_trips ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY start_time DESC LIMIT ?`;
    p.push(Math.min(Number(limit) || 100, 500));
    const rows = await query<Record<string, unknown>>(db, sql, ...p);
    return c.json(rows);
  } catch (e) {
    return c.json({ error: 'Failed to list trips' }, 500);
  }
});

// GET /dispatch/trips/active — one+ active trip per unit (board badges)
trips.get('/active', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT id, unit_id, officer_id, vehicle_id, trip_type, status, call_id, call_number, call_type, prev_trip_id, start_time, start_lat, start_lng, start_mileage, end_time, end_lat, end_lng, end_mileage, close_reason, distance_m, max_speed, speed_sum, fix_count, max_lat_g, harsh_accel_count, harsh_brake_count, harsh_corner_count, stop_count, anchor_lat, anchor_lng, last_move_at, last_fix_ts, prev_lat, prev_lng, prev_mph, prev_bearing, duration_s, avg_speed, created_at, updated_at FROM unit_trips WHERE status = 'active' ORDER BY unit_id, start_time DESC`);
    return c.json(rows);
  } catch (e) {
    return c.json({ error: 'Failed to list active trips' }, 500);
  }
});

// GET /dispatch/trips/:id — trip + its breadcrumbs (for replay)
trips.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const trip = await queryFirst<Record<string, unknown>>(db, 'SELECT id, unit_id, officer_id, vehicle_id, trip_type, status, call_id, call_number, call_type, prev_trip_id, start_time, start_lat, start_lng, start_mileage, end_time, end_lat, end_lng, end_mileage, close_reason, distance_m, max_speed, speed_sum, fix_count, max_lat_g, harsh_accel_count, harsh_brake_count, harsh_corner_count, stop_count, anchor_lat, anchor_lng, last_move_at, last_fix_ts, prev_lat, prev_lng, prev_mph, prev_bearing, duration_s, avg_speed, created_at, updated_at FROM unit_trips WHERE id = ?', id);
    if (!trip) return c.json({ error: 'Not found' }, 404);
    const points = await query<Record<string, unknown>>(db,
      `SELECT latitude AS lat, longitude AS lng, accuracy, heading, speed, recorded_at AS time
       FROM gps_breadcrumbs WHERE unit_id = ? AND recorded_at >= ? ${trip.end_time ? 'AND recorded_at <= ?' : ''} ORDER BY recorded_at ASC`,
      trip.unit_id, trip.start_time, ...(trip.end_time ? [trip.end_time] : []));
    return c.json({ ...trip, points });
  } catch (e) {
    return c.json({ error: 'Failed to load trip' }, 500);
  }
});

export default trips;
