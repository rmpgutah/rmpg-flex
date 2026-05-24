import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';

const geography = new Hono<Env>();

// GET /dispatch/geography/tree
geography.get('/tree', async (c) => {
  try {
    const db = getDb(c.env);
    const areas = await query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_areas ORDER BY sort_order');
    for (const area of areas) {
      (area as any).sectors = await query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_sectors WHERE area_id = ? ORDER BY sort_order', area.id);
      for (const sector of (area as any).sectors) {
        (sector as any).zones = await query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_zones WHERE sector_id = ? ORDER BY sort_order', sector.id);
        for (const zone of (sector as any).zones) {
          (zone as any).beats = await query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_beats WHERE zone_id = ? ORDER BY sort_order', zone.id);
        }
      }
    }
    return c.json(areas);
  } catch (err) {
    return c.json({ error: 'Failed to get geography' }, 500);
  }
});

// GET /dispatch/geography/codes
geography.get('/codes', async (c) => {
  try {
    const db = getDb(c.env);
    const codes = await query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_codes ORDER BY code');
    return c.json(codes);
  } catch (err) {
    return c.json({ error: 'Failed to get codes' }, 500);
  }
});

// GET /dispatch/districts
geography.get('/districts', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        ds.id AS sector_id,
        ds.sector_code,
        ds.sector_name,
        ds.color AS sector_color,
        dz.id AS zone_db_id,
        dz.zone_code AS zone_id,
        dz.zone_name,
        db.id AS beat_db_id,
        db.beat_code AS beat_id,
        db.beat_name,
        db.beat_descriptor,
        db.dispatch_code,
        da.id AS area_id,
        da.area_name,
        da.area_code
      FROM dispatch_beats db
      JOIN dispatch_zones dz ON dz.id = db.zone_id
      JOIN dispatch_sectors ds ON ds.id = dz.sector_id
      JOIN dispatch_areas da ON da.id = ds.area_id
      WHERE db.active = 1 AND dz.active = 1 AND ds.active = 1
      ORDER BY da.sort_order, ds.sort_order, dz.sort_order, db.sort_order
    `);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed' }, 500);
  }
});

export default geography;
