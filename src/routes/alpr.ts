// ============================================================
// ALPR Leaks Route — API endpoints for ALPR data
// ============================================================

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const router = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * GET /api/alpr/summary
 * Returns aggregated ALPR hit statistics from the database.
 */
router.get('/summary', async (c) => {
  const db = c.env.DB;
  try {
    // Check if table exists, create if not
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS alpr_hits (
          id INTEGER PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE,
          system_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          make TEXT,
          model TEXT,
          color TEXT,
          license_plate TEXT NOT NULL,
          jpeg_data BLOB,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    const stats = await db
      .prepare(
        `SELECT 
          COUNT(*) as total_hits,
          COUNT(DISTINCT license_plate) as unique_plates,
          COUNT(DISTINCT system_id) as active_systems,
          COUNT(DISTINCT make) as vehicle_makes
        FROM alpr_hits`
      )
      .first<{
        total_hits: number;
        unique_plates: number;
        active_systems: number;
        vehicle_makes: number;
      }>();

    return c.json(stats || { total_hits: 0, unique_plates: 0, active_systems: 0, vehicle_makes: 0 });
  } catch (err) {
    console.error('[ALPR] Summary query failed:', err);
    return c.json({ error: 'Failed to fetch summary' }, 500);
  }
});

/**
 * GET /api/alpr/hits?limit=50&offset=0
 * Returns paginated ALPR hits with optional filtering.
 */
router.get('/hits', async (c) => {
  const db = c.env.DB;
  const limit = Math.min(parseInt(c.query('limit') || '50'), 500);
  const offset = Math.max(parseInt(c.query('offset') || '0'), 0);
  const plate = c.query('plate');
  const system = c.query('system');

  try {
    let query = `SELECT id, uuid, system_id, timestamp, make, model, color, license_plate 
                 FROM alpr_hits WHERE 1=1`;
    const params: any[] = [];

    if (plate) {
      query += ` AND license_plate LIKE ?`;
      params.push(`%${plate}%`);
    }
    if (system) {
      query += ` AND system_id = ?`;
      params.push(system);
    }

    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = db.prepare(query);
    let bound = stmt;
    for (const param of params) {
      bound = bound.bind(param);
    }

    const hits = await bound.all<any>();
    return c.json({ hits: hits.results || [], count: hits.results?.length || 0 });
  } catch (err) {
    console.error('[ALPR] Hits query failed:', err);
    return c.json({ error: 'Failed to fetch hits' }, 500);
  }
});

/**
 * GET /api/alpr/hits/:uuid/image
 * Returns the JPEG image for a specific ALPR hit.
 */
router.get('/hits/:uuid/image', async (c) => {
  const db = c.env.DB;
  const uuid = c.req.param('uuid');

  try {
    const hit = await db
      .prepare(`SELECT jpeg_data FROM alpr_hits WHERE uuid = ?`)
      .bind(uuid)
      .first<{ jpeg_data: ArrayBuffer | null }>();

    if (!hit || !hit.jpeg_data) {
      return c.json({ error: 'Image not found' }, 404);
    }

    // Convert ArrayBuffer to Uint8Array and return as JPEG
    const buffer = new Uint8Array(hit.jpeg_data);
    return c.body(buffer, 200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000',
    });
  } catch (err) {
    console.error('[ALPR] Image fetch failed:', err);
    return c.json({ error: 'Failed to fetch image' }, 500);
  }
});

/**
 * GET /api/alpr/systems
 * Returns list of monitored ALPR systems and their activity status.
 */
router.get('/systems', async (c) => {
  const db = c.env.DB;

  try {
    const systems = await db
      .prepare(
        `SELECT system_id, COUNT(*) as hit_count, MAX(timestamp) as last_hit
         FROM alpr_hits
         GROUP BY system_id
         ORDER BY last_hit DESC`
      )
      .all<any>();

    return c.json(systems.results || []);
  } catch (err) {
    console.error('[ALPR] Systems query failed:', err);
    return c.json({ error: 'Failed to fetch systems' }, 500);
  }
});

/**
 * POST /api/alpr/hits
 * Admin endpoint: Record a new ALPR hit manually or via collector.
 * Requires admin auth (enforced by router registration).
 */
router.post('/hits', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<any>();

  try {
    const { uuid, system_id, make, model, color, license_plate, jpeg_data } = body;

    if (!uuid || !system_id || !license_plate) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    const result = await db
      .prepare(
        `INSERT INTO alpr_hits (uuid, system_id, timestamp, make, model, color, license_plate, jpeg_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uuid) DO UPDATE SET timestamp = excluded.timestamp`
      )
      .bind(uuid, system_id, new Date().toISOString(), make, model, color, license_plate, jpeg_data || null)
      .run();

    return c.json({ success: true, id: result?.meta?.last_row_id });
  } catch (err: any) {
    console.error('[ALPR] Insert failed:', err);
    if (err.message?.includes('UNIQUE')) {
      return c.json({ error: 'Hit already exists' }, 409);
    }
    return c.json({ error: 'Failed to record hit' }, 500);
  }
});

export default router;
