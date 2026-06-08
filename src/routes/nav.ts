import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const nav = new Hono<Env>();

// ── Types ────────────────────────────────────────────────────
interface RoutePoint {
  lat: number;
  lng: number;
  ts: string; // ISO timestamp
  speed?: number;
  heading?: number;
}

interface TripStartBody {
  start_lat: number;
  start_lng: number;
  start_accuracy?: number;
  start_location?: string;
  vehicle_id?: number;
  purpose?: string;
  device_type?: string;
}

interface TripUpdateBody {
  route_points: RoutePoint[];
  current_lat: number;
  current_lng: number;
  current_speed?: number;
}

interface TripEndBody {
  end_lat: number;
  end_lng: number;
  end_accuracy?: number;
  end_location?: string;
  distance_miles?: number;
  max_speed_mph?: number;
  route_points?: RoutePoint[];
  notes?: string;
}

// ── Helpers ──────────────────────────────────────────────────

/** Haversine distance in miles between two lat/lng points */
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Compute total distance along a route point array (miles) */
function routeDistance(points: RoutePoint[]): number {
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    dist += haversineMiles(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return dist;
}

// ── GET /nav/trip/current — active/pending trip for this user ─
nav.get('/trip/current', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const trip = await queryFirst<Record<string, unknown>>(db,
      `SELECT ntl.*, fv.vehicle_number, fv.make, fv.model, fv.plate_number,
              u.call_sign as unit_call_sign,
              cfs.call_number, cfs.incident_type as call_type,
              cfs.priority as call_priority, cfs.location_address as call_location
       FROM nav_trip_log ntl
       LEFT JOIN fleet_vehicles fv ON ntl.vehicle_id = fv.id
       LEFT JOIN units u ON ntl.unit_id = u.id
       LEFT JOIN calls_for_service cfs ON ntl.call_id = cfs.id
       WHERE ntl.officer_id = ? AND ntl.status IN ('pending','active')
       ORDER BY ntl.start_time DESC LIMIT 1`,
      userId);
    if (!trip) return c.json({ trip: null });
    if (trip.route_points && typeof trip.route_points === 'string') {
      try { trip.route_points = JSON.parse(trip.route_points as string); } catch { trip.route_points = []; }
    }
    return c.json({ trip });
  } catch (err) {
    console.error('[nav] GET /trip/current failed:', err);
    return c.json({ error: 'Failed to fetch current trip' }, 500);
  }
});

// ── POST /nav/trip/start — start a trip (auto-detected or manual)
nav.post('/trip/start', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<TripStartBody>();

    if (!body.start_lat || !body.start_lng) {
      return c.json({ error: 'start_lat and start_lng required' }, 400);
    }

    // Cancel any existing pending trips for this user
    await execute(db,
      `UPDATE nav_trip_log SET status = 'cancelled', updated_at = datetime('now','localtime')
       WHERE officer_id = ? AND status = 'pending'`, userId);

    // Prevent duplicate active trips
    const existing = await queryFirst<{ id: number }>(db,
      `SELECT id FROM nav_trip_log WHERE officer_id = ? AND status = 'active' LIMIT 1`, userId);
    if (existing) {
      return c.json({ error: 'Active trip already exists', trip_id: existing.id }, 409);
    }

    // Determine vehicle: explicit > take-home > unit assignment
    let vehicleId = body.vehicle_id || null;
    let unitId: number | null = null;
    if (!vehicleId) {
      const user = await queryFirst<{ take_home_vehicle_id: number | null }>(db,
        'SELECT take_home_vehicle_id FROM users WHERE id = ?', userId);
      if (user?.take_home_vehicle_id) vehicleId = user.take_home_vehicle_id;
    }
    // Look up unit
    const unit = await queryFirst<{ id: number; call_sign: string }>(db,
      'SELECT id, call_sign FROM units WHERE officer_id = ? LIMIT 1', userId);
    if (unit) unitId = unit.id;

    // Auto-detect vehicle from unit if still unknown
    if (!vehicleId && unitId) {
      const veh = await queryFirst<{ id: number }>(db,
        'SELECT id FROM fleet_vehicles WHERE assigned_unit_id = ? LIMIT 1', unitId);
      if (veh) vehicleId = veh.id;
    }

    // Auto-detect active dispatch call from the unit
    let callId: number | null = null;
    if (unitId) {
      const activeCall = await queryFirst<{ current_call_id: number | null }>(db,
        'SELECT current_call_id FROM units WHERE id = ?', unitId);
      if (activeCall?.current_call_id) callId = activeCall.current_call_id;
    }

    const result = await execute(db,
      `INSERT INTO nav_trip_log
       (officer_id, vehicle_id, unit_id, call_id, start_lat, start_lng, start_accuracy,
        start_location, start_time, status, detected_by, purpose, device_type, route_points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), 'pending', 'auto',
               ?, ?, '[]')`,
      userId, vehicleId, unitId, callId,
      body.start_lat, body.start_lng, body.start_accuracy ?? null,
      body.start_location ?? null,
      body.purpose ?? 'patrol', body.device_type ?? null);

    const tripId = Number(result.meta.last_row_id);
    return c.json({ success: true, trip_id: tripId, status: 'pending' }, 201);
  } catch (err) {
    console.error('[nav] POST /trip/start failed:', err);
    return c.json({ error: 'Failed to start trip' }, 500);
  }
});

// ── PUT /nav/trip/:id/confirm — confirm a pending trip as active
nav.put('/trip/:id/confirm', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const tripId = Number(c.req.param('id'));
    if (!tripId || isNaN(tripId)) return c.json({ error: 'Invalid trip id' }, 400);

    const trip = await queryFirst<{ id: number; officer_id: number; status: string }>(db,
      'SELECT id, officer_id, status FROM nav_trip_log WHERE id = ?', tripId);
    if (!trip) return c.json({ error: 'Trip not found' }, 404);
    if (trip.officer_id !== userId) return c.json({ error: 'Not authorized' }, 403);
    if (trip.status !== 'pending') return c.json({ error: `Trip is ${trip.status}, not pending` }, 400);

    await execute(db,
      `UPDATE nav_trip_log SET status = 'active', updated_at = datetime('now','localtime')
       WHERE id = ?`, tripId);

    return c.json({ success: true, status: 'active' });
  } catch (err) {
    console.error('[nav] PUT /trip/:id/confirm failed:', err);
    return c.json({ error: 'Failed to confirm trip' }, 500);
  }
});

// ── PUT /nav/trip/:id/update — append route breadcrumbs
nav.put('/trip/:id/update', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const tripId = Number(c.req.param('id'));
    if (!tripId || isNaN(tripId)) return c.json({ error: 'Invalid trip id' }, 400);

    const body = await c.req.json<TripUpdateBody>();
    const trip = await queryFirst<{ id: number; officer_id: number; status: string; route_points: string | null }>(db,
      'SELECT id, officer_id, status, route_points FROM nav_trip_log WHERE id = ?', tripId);
    if (!trip) return c.json({ error: 'Trip not found' }, 404);
    if (trip.officer_id !== userId) return c.json({ error: 'Not authorized' }, 403);
    if (trip.status !== 'active' && trip.status !== 'pending') {
      return c.json({ error: `Trip is ${trip.status}` }, 400);
    }

    let existingPoints: RoutePoint[] = [];
    if (trip.route_points && typeof trip.route_points === 'string') {
      try { existingPoints = JSON.parse(trip.route_points); } catch { existingPoints = []; }
    }

    const merged = [...existingPoints, ...(body.route_points || [])];
    // Keep at most 1000 points to prevent bloat
    const trimmed = merged.length > 1000 ? merged.slice(merged.length - 1000) : merged;
    const distance = routeDistance(trimmed);
    const maxSpeed = Math.max(
      body.current_speed ?? 0,
      ...trimmed.map((p) => p.speed ?? 0),
      0,
    );

    await execute(db,
      `UPDATE nav_trip_log
       SET route_points = ?, distance_miles = ?, max_speed_mph = CASE WHEN ? > COALESCE(max_speed_mph, 0) THEN ? ELSE max_speed_mph END,
           updated_at = datetime('now','localtime')
       WHERE id = ?`,
      JSON.stringify(trimmed), distance, maxSpeed, maxSpeed, tripId);

    return c.json({ success: true, point_count: trimmed.length, distance_miles: Math.round(distance * 100) / 100 });
  } catch (err) {
    console.error('[nav] PUT /trip/:id/update failed:', err);
    return c.json({ error: 'Failed to update trip' }, 500);
  }
});

// ── PUT /nav/trip/:id/end — end a trip
nav.put('/trip/:id/end', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const tripId = Number(c.req.param('id'));
    if (!tripId || isNaN(tripId)) return c.json({ error: 'Invalid trip id' }, 400);

    const body = await c.req.json<TripEndBody>();
    const trip = await queryFirst<{ id: number; officer_id: number; status: string; route_points: string | null; start_time: string }>(db,
      'SELECT id, officer_id, status, route_points, start_time FROM nav_trip_log WHERE id = ?', tripId);
    if (!trip) return c.json({ error: 'Trip not found' }, 404);
    if (trip.officer_id !== userId) return c.json({ error: 'Not authorized' }, 403);
    if (trip.status !== 'active' && trip.status !== 'pending') {
      return c.json({ error: `Trip is ${trip.status}` }, 400);
    }

    // Calculate final distance
    let finalDistance = body.distance_miles ?? 0;
    if (body.route_points && body.route_points.length > 0) {
      finalDistance = routeDistance(body.route_points);
    }

    // Duration
    const startTime = new Date(trip.start_time.replace(' ', 'T') + (trip.start_time.includes('Z') ? '' : 'Z'));
    const endTime = new Date();
    const durationSec = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

    await execute(db,
      `UPDATE nav_trip_log
       SET status = 'completed', end_lat = ?, end_lng = ?, end_accuracy = ?,
           end_location = ?, end_time = datetime('now','localtime'),
           distance_miles = ?, max_speed_mph = COALESCE(?, max_speed_mph),
           duration_seconds = ?, route_points = COALESCE(?, route_points),
           notes = COALESCE(?, notes), updated_at = datetime('now','localtime')
       WHERE id = ?`,
      body.end_lat ?? null, body.end_lng ?? null, body.end_accuracy ?? null,
      body.end_location ?? null,
      finalDistance > 0 ? finalDistance : null,
      body.max_speed_mph ?? null,
      durationSec > 0 ? durationSec : null,
      body.route_points ? JSON.stringify(body.route_points) : null,
      body.notes ?? null,
      tripId);

    return c.json({ success: true, distance_miles: Math.round(finalDistance * 100) / 100, duration_seconds: durationSec });
  } catch (err) {
    console.error('[nav] PUT /trip/:id/end failed:', err);
    return c.json({ error: 'Failed to end trip' }, 500);
  }
});

// ── PUT /nav/trip/:id/cancel — cancel a pending/false-start trip
nav.put('/trip/:id/cancel', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const tripId = Number(c.req.param('id'));
    if (!tripId || isNaN(tripId)) return c.json({ error: 'Invalid trip id' }, 400);

    const trip = await queryFirst<{ id: number; officer_id: number; status: string }>(db,
      'SELECT id, officer_id, status FROM nav_trip_log WHERE id = ?', tripId);
    if (!trip) return c.json({ error: 'Trip not found' }, 404);
    if (trip.officer_id !== userId) return c.json({ error: 'Not authorized' }, 403);
    if (trip.status !== 'pending') return c.json({ error: `Trip is ${trip.status}, not pending` }, 400);

    await execute(db,
      `UPDATE nav_trip_log SET status = 'cancelled', updated_at = datetime('now','localtime')
       WHERE id = ?`, tripId);

    return c.json({ success: true });
  } catch (err) {
    console.error('[nav] PUT /trip/:id/cancel failed:', err);
    return c.json({ error: 'Failed to cancel trip' }, 500);
  }
});

// ── GET /nav/trip/history — trip history for this user
nav.get('/trip/history', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const limit = Math.min(Number(c.req.query('limit') || '50'), 200);
    const offset = Number(c.req.query('offset') || '0');
    const status = c.req.query('status'); // optional filter

    let whereClause = 'WHERE ntl.officer_id = ?';
    const params: unknown[] = [userId];
    if (status) {
      whereClause += ' AND ntl.status = ?';
      params.push(status);
    }

    const rows = await query<Record<string, unknown>>(db,
      `SELECT ntl.id, ntl.vehicle_id, ntl.unit_id, ntl.call_id,
              ntl.start_lat, ntl.start_lng,
              ntl.start_location, ntl.start_time, ntl.end_lat, ntl.end_lng,
              ntl.end_location, ntl.end_time, ntl.distance_miles, ntl.max_speed_mph,
              ntl.duration_seconds, ntl.status, ntl.detected_by, ntl.purpose,
              ntl.device_type, ntl.notes, ntl.created_at,
              fv.vehicle_number, fv.make, fv.model, fv.plate_number,
              u.call_sign as unit_call_sign,
              cfs.call_number, cfs.incident_type as call_type
       FROM nav_trip_log ntl
       LEFT JOIN fleet_vehicles fv ON ntl.vehicle_id = fv.id
       LEFT JOIN units u ON ntl.unit_id = u.id
       LEFT JOIN calls_for_service cfs ON ntl.call_id = cfs.id
       ${whereClause}
       ORDER BY ntl.start_time DESC
       LIMIT ? OFFSET ?`,
      ...params, limit, offset);
    return c.json({ trips: rows });
  } catch (err) {
    console.error('[nav] GET /trip/history failed:', err);
    return c.json({ error: 'Failed to fetch trip history' }, 500);
  }
});

// ── GET /nav/trip/:id — single trip with route points
nav.get('/trip/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const tripId = Number(c.req.param('id'));
    if (!tripId || isNaN(tripId)) return c.json({ error: 'Invalid trip id' }, 400);

    const trip = await queryFirst<Record<string, unknown>>(db,
      `SELECT ntl.*, fv.vehicle_number, fv.make, fv.model, fv.plate_number,
              u.call_sign as unit_call_sign,
              cfs.call_number, cfs.incident_type as call_type,
              cfs.priority as call_priority, cfs.location_address as call_location
       FROM nav_trip_log ntl
       LEFT JOIN fleet_vehicles fv ON ntl.vehicle_id = fv.id
       LEFT JOIN units u ON ntl.unit_id = u.id
       LEFT JOIN calls_for_service cfs ON ntl.call_id = cfs.id
       WHERE ntl.id = ? AND ntl.officer_id = ?`,
      tripId, userId);
    if (!trip) return c.json({ error: 'Trip not found' }, 404);
    if (trip.route_points && typeof trip.route_points === 'string') {
      try { trip.route_points = JSON.parse(trip.route_points as string); } catch { trip.route_points = []; }
    }
    return c.json({ trip });
  } catch (err) {
    console.error('[nav] GET /trip/:id failed:', err);
    return c.json({ error: 'Failed to fetch trip' }, 500);
  }
});

// ── GET /nav/trip/check-take-home — whether user has a take-home vehicle
nav.get('/trip/check-take-home', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;

    const user = await queryFirst<{ has_take_home: number; take_home_vehicle_id: number | null }>(
      db, 'SELECT has_take_home, take_home_vehicle_id FROM users WHERE id = ?', userId);

    const hasTakeHome = user?.has_take_home === 1 && user?.take_home_vehicle_id != null;

    return c.json({ take_home: !!hasTakeHome, vehicle_id: user?.take_home_vehicle_id ?? null });
  } catch (err) {
    console.error('[nav] GET /trip/check-take-home failed:', err);
    return c.json({ error: 'Failed to check take-home status' }, 500);
  }
});

// ── GET /nav/vehicle-take-home — take-home status (client contract) ──
// The client (useNavTripDetection) calls this path and reads `has_take_home`.
// It is the same data as /trip/check-take-home but under the path + key the
// client expects; without it the request 404s and take-home officers (no unit)
// can never start a trip. The proxy routes the whole /api/nav/* prefix here.
nav.get('/vehicle-take-home', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;

    const user = await queryFirst<{ has_take_home: number; take_home_vehicle_id: number | null }>(
      db, 'SELECT has_take_home, take_home_vehicle_id FROM users WHERE id = ?', userId);

    const hasTakeHome = user?.has_take_home === 1 && user?.take_home_vehicle_id != null;

    return c.json({ has_take_home: hasTakeHome, vehicle_id: user?.take_home_vehicle_id ?? null });
  } catch (err) {
    console.error('[nav] GET /vehicle-take-home failed:', err);
    return c.json({ error: 'Failed to check take-home status' }, 500);
  }
});

export default nav;
