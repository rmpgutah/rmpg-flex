import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';
import { resolveDistrict } from '../../utils/districtResolver';

const geography = new Hono<Env>();

// GET /dispatch/geography/tree
//
// Naive nested loop (6 areas × 5 sectors × 10 zones × 2.5 beats) issued
// ~1100 D1 queries per request and 500'd against the Workers subrequest /
// CPU budget. Rewrite: 4 flat SELECTs in parallel (one per table) + JS-side
// O(N) grouping by parent_id. Total query count goes 1100 → 4 regardless
// of fleet size.
geography.get('/tree', async (c) => {
  try {
    const db = getDb(c.env);
    const [areas, sectors, zones, beats] = await Promise.all([
      query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_areas ORDER BY sort_order'),
      query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_sectors ORDER BY area_id, sort_order'),
      query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_zones ORDER BY sector_id, sort_order'),
      query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_beats ORDER BY zone_id, sort_order'),
    ]);

    // Group children by parent_id once — O(N) per table.
    const beatsByZone = new Map<unknown, Record<string, unknown>[]>();
    for (const b of beats) {
      const list = beatsByZone.get(b.zone_id) || [];
      list.push(b);
      beatsByZone.set(b.zone_id, list);
    }
    const zonesBySector = new Map<unknown, Record<string, unknown>[]>();
    for (const z of zones) {
      (z as any).beats = beatsByZone.get(z.id) || [];
      const list = zonesBySector.get(z.sector_id) || [];
      list.push(z);
      zonesBySector.set(z.sector_id, list);
    }
    const sectorsByArea = new Map<unknown, Record<string, unknown>[]>();
    for (const s of sectors) {
      (s as any).zones = zonesBySector.get(s.id) || [];
      const list = sectorsByArea.get(s.area_id) || [];
      list.push(s);
      sectorsByArea.set(s.area_id, list);
    }
    const areaIds = new Set(areas.map((a) => a.id));
    for (const area of areas) {
      (area as any).sectors = sectorsByArea.get(area.id) || [];
    }
    // Sectors whose area_id points at no surviving area would otherwise vanish
    // from the tree — surface them so the Geography page can still render them.
    const unassigned_sectors = sectors.filter((s) => !areaIds.has(s.area_id));

    // Shape MUST be { areas, unassigned_sectors } — the client GeographyTree
    // type and GeographyPage read `tree.areas`. Returning a bare array here
    // (the prior bug) made `tree.areas` undefined and threw on first access.
    return c.json({ areas, unassigned_sectors });
  } catch (err) {
    console.error('GET /dispatch/geography/tree failed:', err);
    return c.json({ error: 'Failed to get geography', detail: (err as Error)?.message }, 500);
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

// GET /dispatch/geography/districts/identify?lat=..&lng=..
//
// GPS → district lookup. Ray-casts the point against beat.geojson (served
// from R2 via the geofence util), then hydrates the full Sector/Zone/Beat
// hierarchy + names. The client's useDistrictIdentify expects a flat object
// with a `found` boolean; a miss returns { found: false } (HTTP 200) so the
// UI silently falls back to manual dropdown selection.
geography.get('/districts/identify', async (c) => {
  try {
    const lat = Number.parseFloat(c.req.query('lat') ?? '');
    const lng = Number.parseFloat(c.req.query('lng') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ found: false, error: 'lat and lng are required' }, 400);
    }

    const district = await resolveDistrict(c.env, { lat, lng });
    if (!district) return c.json({ found: false });

    return c.json({ found: true, ...district });
  } catch (err) {
    console.error('GET /dispatch/geography/districts/identify failed:', err);
    return c.json({ found: false, error: 'identify failed' }, 500);
  }
});

export default geography;
