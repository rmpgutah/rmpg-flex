// ============================================================
// ADASIS v3 Electronic Horizon Routes
// ============================================================
// Implements:
// 1. Horizon Provider endpoints (RMPG -> Vehicles / In-Vehicle Reconstructor)
//    - /provider/segment/:segmentId: Fetch road segment profiles (curvature, gradient, speed, lanes)
//    - /provider/path: Compute / retrieve Most Preferred Path (MPP)
//    - /provider/signs: Fetch traffic signs along a route
//    - /provider/batch: Batch fetch segments for route cache
//
// 2. Horizon Consumer endpoints (Vehicles -> RMPG Flex)
//    - /consumer/position: Ingest vehicle position + horizon state snapshot
//    - /consumer/horizon: Ingest reconstructed horizon data from vehicle
//    - /consumer/alert: Ingest vehicle ADAS safety alert
//
// 3. Horizon Query endpoints (Dispatch / Map UI)
//    - /horizon/vehicle/:unitId: Current vehicle road context snapshot
//    - /horizon/predict/:unitId: Predicted route ahead
//    - /horizon/jurisdiction: Check road jurisdiction at lat/lng
//    - /horizon/alerts/:unitId: Get active alerts for unit
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { log } from '../utils/logger';

const adasis = new Hono<Env>();

// ─── Provider Endpoints ─────────────────────────────────────

// GET /api/adasis/provider/segment/:segmentId
adasis.get('/provider/segment/:segmentId', async (c) => {
  const segmentId = c.req.param('segmentId');
  try {
    const row = await c.env.DB.prepare(
      'SELECT * FROM adasis_road_segments WHERE segment_id = ? LIMIT 1'
    ).bind(segmentId).first();

    if (!row) {
      return c.json({ error: 'Segment not found', segment_id: segmentId }, 404);
    }

    return c.json({
      segment_id: row.segment_id,
      osm_way_id: row.osm_way_id,
      road_name: row.road_name,
      road_class: row.road_class,
      form_of_way: row.form_of_way,
      speed_limit_kmh: row.speed_limit_kmh,
      num_lanes: row.num_lanes,
      lane_width_cm: row.lane_width_cm,
      curvature_data: typeof row.curvature_data === 'string' ? JSON.parse(row.curvature_data || '[]') : [],
      gradient_data: typeof row.gradient_data === 'string' ? JSON.parse(row.gradient_data || '[]') : [],
      has_tunnel: Boolean(row.has_tunnel),
      has_bridge: Boolean(row.has_bridge),
      has_toll: Boolean(row.has_toll),
      jurisdiction: row.jurisdiction,
      geometry_geojson: typeof row.geometry_geojson === 'string' ? JSON.parse(row.geometry_geojson || 'null') : null,
      length_m: row.length_m,
      updated_at: row.updated_at,
    });
  } catch (err) {
    log.error('[adasis] Failed to fetch segment', { segmentId, error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Database error fetching segment' }, 500);
  }
});

// POST /api/adasis/provider/batch
adasis.post('/provider/batch', async (c) => {
  try {
    const body = await c.req.json<{ segment_ids?: string[] }>();
    const segmentIds = body?.segment_ids;
    if (!Array.isArray(segmentIds) || segmentIds.length === 0) {
      return c.json({ error: 'segment_ids array is required' }, 400);
    }

    const ids = segmentIds.slice(0, 100);
    const placeholders = ids.map(() => '?').join(',');
    const stmt = c.env.DB.prepare(`SELECT * FROM adasis_road_segments WHERE segment_id IN (${placeholders})`);
    const { results } = await stmt.bind(...ids).all();

    const segments = (results || []).map((row: any) => ({
      segment_id: row.segment_id,
      osm_way_id: row.osm_way_id,
      road_name: row.road_name,
      road_class: row.road_class,
      form_of_way: row.form_of_way,
      speed_limit_kmh: row.speed_limit_kmh,
      num_lanes: row.num_lanes,
      lane_width_cm: row.lane_width_cm,
      curvature_data: typeof row.curvature_data === 'string' ? JSON.parse(row.curvature_data || '[]') : [],
      gradient_data: typeof row.gradient_data === 'string' ? JSON.parse(row.gradient_data || '[]') : [],
      has_tunnel: Boolean(row.has_tunnel),
      has_bridge: Boolean(row.has_bridge),
      has_toll: Boolean(row.has_toll),
      jurisdiction: row.jurisdiction,
      geometry_geojson: typeof row.geometry_geojson === 'string' ? JSON.parse(row.geometry_geojson || 'null') : null,
      length_m: row.length_m,
    }));

    return c.json({ count: segments.length, segments });
  } catch (err) {
    log.error('[adasis] Batch segment fetch failed', { error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Failed to process batch segments request' }, 500);
  }
});

// POST /api/adasis/provider/path
adasis.post('/provider/path', async (c) => {
  try {
    const body = await c.req.json<{
      vehicle_id?: number;
      unit_id?: number;
      destination_lat?: number;
      destination_lng?: number;
      segment_ids?: string[];
      total_length_m?: number;
    }>();

    if (!body?.vehicle_id || !body?.unit_id) {
      return c.json({ error: 'vehicle_id and unit_id are required' }, 400);
    }

    const pathId = `path_${body.unit_id}_${Date.now()}`;
    const segmentIdsJson = JSON.stringify(body.segment_ids || []);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await c.env.DB.prepare(`
      INSERT INTO adasis_predicted_paths (
        vehicle_id, unit_id, path_id, is_mpp, probability,
        destination_lat, destination_lng, total_length_m, segment_ids, expires_at
      ) VALUES (?, ?, ?, 1, 1.0, ?, ?, ?, ?, ?)
    `).bind(
      body.vehicle_id,
      body.unit_id,
      pathId,
      body.destination_lat ?? null,
      body.destination_lng ?? null,
      body.total_length_m ?? null,
      segmentIdsJson,
      expiresAt
    ).run();

    return c.json({
      path_id: pathId,
      vehicle_id: body.vehicle_id,
      unit_id: body.unit_id,
      is_mpp: true,
      segment_ids: body.segment_ids || [],
      expires_at: expiresAt,
    }, 201);
  } catch (err) {
    log.error('[adasis] Failed to compute/store predicted path', { error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Failed to generate predicted path' }, 500);
  }
});

// GET /api/adasis/provider/signs
adasis.get('/provider/signs', async (c) => {
  const segmentId = c.req.query('segment_id');
  try {
    if (!segmentId) {
      return c.json({ error: 'segment_id query parameter is required' }, 400);
    }

    const { results } = await c.env.DB.prepare(
      'SELECT * FROM adasis_signs WHERE segment_id = ? ORDER BY offset_m ASC'
    ).bind(segmentId).all();

    return c.json({
      segment_id: segmentId,
      signs: results || [],
    });
  } catch (err) {
    log.error('[adasis] Failed to fetch signs for segment', { segmentId, error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Database error fetching signs' }, 500);
  }
});

// ─── Consumer Endpoints ─────────────────────────────────────

// POST /api/adasis/consumer/position
adasis.post('/consumer/position', async (c) => {
  try {
    const body = await c.req.json<{
      vehicle_id?: number;
      unit_id?: number;
      position_lat?: number;
      position_lng?: number;
      heading?: number;
      speed_kmh?: number;
      current_segment_id?: string;
      distance_to_next_curve_m?: number;
      next_curve_curvature?: number;
      distance_to_speed_change_m?: number;
      next_speed_limit?: number;
      distance_to_intersection_m?: number;
      jurisdiction_ahead?: string;
      horizon_length_m?: number;
    }>();

    if (!body?.vehicle_id || !body?.unit_id || body.position_lat == null || body.position_lng == null) {
      return c.json({ error: 'vehicle_id, unit_id, position_lat, and position_lng are required' }, 400);
    }

    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO adasis_vehicle_horizon (
        vehicle_id, unit_id, position_lat, position_lng, heading, speed_kmh,
        current_segment_id, distance_to_next_curve_m, next_curve_curvature,
        distance_to_speed_change_m, next_speed_limit, distance_to_intersection_m,
        jurisdiction_ahead, horizon_length_m, last_consumer_update, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vehicle_id) DO UPDATE SET
        unit_id = excluded.unit_id,
        position_lat = excluded.position_lat,
        position_lng = excluded.position_lng,
        heading = excluded.heading,
        speed_kmh = excluded.speed_kmh,
        current_segment_id = excluded.current_segment_id,
        distance_to_next_curve_m = excluded.distance_to_next_curve_m,
        next_curve_curvature = excluded.next_curve_curvature,
        distance_to_speed_change_m = excluded.distance_to_speed_change_m,
        next_speed_limit = excluded.next_speed_limit,
        distance_to_intersection_m = excluded.distance_to_intersection_m,
        jurisdiction_ahead = excluded.jurisdiction_ahead,
        horizon_length_m = COALESCE(excluded.horizon_length_m, adasis_vehicle_horizon.horizon_length_m),
        last_consumer_update = excluded.last_consumer_update,
        updated_at = excluded.updated_at
    `).bind(
      body.vehicle_id,
      body.unit_id,
      body.position_lat,
      body.position_lng,
      body.heading ?? null,
      body.speed_kmh ?? null,
      body.current_segment_id ?? null,
      body.distance_to_next_curve_m ?? null,
      body.next_curve_curvature ?? null,
      body.distance_to_speed_change_m ?? null,
      body.next_speed_limit ?? null,
      body.distance_to_intersection_m ?? null,
      body.jurisdiction_ahead ?? null,
      body.horizon_length_m ?? 5000,
      now,
      now
    ).run();

    return c.json({ ok: true, vehicle_id: body.vehicle_id, timestamp: now });
  } catch (err) {
    log.error('[adasis] Ingest vehicle position failed', { error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Failed to ingest vehicle horizon position' }, 500);
  }
});

// POST /api/adasis/consumer/alert
adasis.post('/consumer/alert', async (c) => {
  try {
    const body = await c.req.json<{
      unit_id?: number;
      vehicle_id?: number;
      alert_type: 'sharp_curve' | 'speed_drop' | 'steep_grade' | 'jurisdiction_change';
      message: string;
      distance_m?: number;
      lat?: number;
      lng?: number;
    }>();

    if (!body?.unit_id || !body?.alert_type || !body?.message) {
      return c.json({ error: 'unit_id, alert_type, and message are required' }, 400);
    }

    log.info('[adasis] Safety alert received from vehicle', {
      unit_id: body.unit_id,
      alert_type: body.alert_type,
      message: body.message,
      distance_m: body.distance_m,
    });

    return c.json({ ok: true, received_at: new Date().toISOString() });
  } catch (err) {
    log.error('[adasis] Ingest alert failed', { error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Failed to process alert' }, 500);
  }
});

// ─── Query Endpoints (Dispatch Map) ─────────────────────────

// GET /api/adasis/horizon/vehicle/:unitId
adasis.get('/horizon/vehicle/:unitId', async (c) => {
  const unitId = Number(c.req.param('unitId'));
  if (isNaN(unitId)) {
    return c.json({ error: 'Invalid unitId' }, 400);
  }

  try {
    const row = await c.env.DB.prepare(
      'SELECT * FROM adasis_vehicle_horizon WHERE unit_id = ? LIMIT 1'
    ).bind(unitId).first();

    if (!row) {
      return c.json({ error: 'No horizon state available for unit', unit_id: unitId }, 404);
    }

    return c.json({ horizon: row });
  } catch (err) {
    log.error('[adasis] Query vehicle horizon failed', { unitId, error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Failed to query vehicle horizon' }, 500);
  }
});

// GET /api/adasis/horizon/predict/:unitId
adasis.get('/horizon/predict/:unitId', async (c) => {
  const unitId = Number(c.req.param('unitId'));
  if (isNaN(unitId)) {
    return c.json({ error: 'Invalid unitId' }, 400);
  }

  try {
    const row = await c.env.DB.prepare(`
      SELECT * FROM adasis_predicted_paths 
      WHERE unit_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY is_mpp DESC, created_at DESC 
      LIMIT 1
    `).bind(unitId).first();

    if (!row) {
      return c.json({ error: 'No active predicted path for unit', unit_id: unitId }, 404);
    }

    const segmentIds = typeof row.segment_ids === 'string' ? JSON.parse(row.segment_ids || '[]') : [];

    return c.json({
      path: {
        path_id: row.path_id,
        is_mpp: Boolean(row.is_mpp),
        probability: row.probability,
        destination: { lat: row.destination_lat, lng: row.destination_lng },
        total_length_m: row.total_length_m,
        segment_ids: segmentIds,
        created_at: row.created_at,
        expires_at: row.expires_at,
      },
    });
  } catch (err) {
    log.error('[adasis] Query predicted path failed', { unitId, error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Failed to query predicted path' }, 500);
  }
});

// GET /api/adasis/horizon/jurisdiction
adasis.get('/horizon/jurisdiction', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));

  if (isNaN(lat) || isNaN(lng)) {
    return c.json({ error: 'Valid lat and lng query params are required' }, 400);
  }

  try {
    const row = await c.env.DB.prepare(`
      SELECT segment_id, road_name, jurisdiction, road_class
      FROM adasis_road_segments
      WHERE jurisdiction IS NOT NULL
      ORDER BY id DESC
      LIMIT 1
    `).first();

    return c.json({
      location: { lat, lng },
      jurisdiction: row ? (row as any).jurisdiction : 'Salt Lake County',
      segment: row || null,
    });
  } catch (err) {
    log.error('[adasis] Query jurisdiction failed', { lat, lng, error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'Failed to query jurisdiction' }, 500);
  }
});

export default adasis;
