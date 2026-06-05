import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { resolveDistrict } from '../../utils/districtResolver';
import { geocodeAddress } from '../geocode';
import { requireRole } from '../../middleware/auth';

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

// GET /dispatch/geography/codes/lookup/:code — single dispatch-code lookup for
// the CAD command bar (cadCommandParser "CODE 10-71"). The client calls this
// path (the bare /codes handler above doesn't match it), so without this route
// it routed to env.API and 404'd. Case-insensitive exact match; returns
// { found:false } (HTTP 200) on a miss so the command bar shows "not found".
geography.get('/codes/lookup/:code', async (c) => {
  try {
    const db = getDb(c.env);
    const raw = decodeURIComponent(c.req.param('code') || '').trim();
    if (!raw) return c.json({ found: false });
    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM dispatch_codes WHERE UPPER(code) = UPPER(?) AND COALESCE(active, 1) = 1', raw);
    if (!row) return c.json({ found: false });
    return c.json({ found: true, ...row });
  } catch (err) {
    console.error('GET /dispatch/geography/codes/lookup failed:', err);
    return c.json({ found: false });
  }
});

// GET /dispatch/geography/premise-alerts — active premise alerts by address
// (usePremiseAlerts.checkAddress), by coordinate proximity (checkCoords), or all
// active (BolosCard). The premise_alerts CRUD router is mounted at the separate
// /api/dispatch/premise-alerts path, but the client reads via THIS geography
// path — which routed to env.API and 404'd (no handler). Serve the read here.
// Always filtered to active + unexpired. flags is returned as the raw string the
// client's PremiseAlert type expects.
geography.get('/premise-alerts', async (c) => {
  try {
    const db = getDb(c.env);
    const address = (c.req.query('address') || '').trim();
    const lat = Number.parseFloat(c.req.query('lat') ?? '');
    const lng = Number.parseFloat(c.req.query('lng') ?? '');
    let where = "WHERE active = 1 AND (expires_at IS NULL OR expires_at >= datetime('now'))";
    const params: unknown[] = [];
    if (address.length >= 3) {
      where += ' AND UPPER(address) LIKE ?';
      params.push(`%${address.toUpperCase()}%`);
    } else if (Number.isFinite(lat) && Number.isFinite(lng)) {
      // ~0.003 deg ≈ 330 m proximity box.
      where += ' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?';
      params.push(lat - 0.003, lat + 0.003, lng - 0.003, lng + 0.003);
    }
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, address, latitude, longitude, alert_type, alert_level, title,
              description, flags, expires_at, active
       FROM premise_alerts ${where}
       ORDER BY alert_level = 'critical' DESC, alert_level = 'warning' DESC, created_at DESC
       LIMIT 50`,
      ...params,
    );
    return c.json(rows);
  } catch (err) {
    console.error('GET /dispatch/geography/premise-alerts failed:', err);
    return c.json([]);
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

// GET /dispatch/geography/premise-intel?lat=&lng=&radius=
// Point-based premise intelligence for the map "What's Here" tool: recent
// calls + incidents near a clicked location (cross-system map<->dispatch/RMS).
// Bounding-box filter on lat/lng (indexed), newest first. Best-effort — a
// query error degrades to empty so the popup still renders geography.
geography.get('/premise-intel', async (c) => {
  const lat = Number.parseFloat(c.req.query('lat') ?? '');
  const lng = Number.parseFloat(c.req.query('lng') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ calls: [], incidents: [], callCount: 0, incidentCount: 0 });
  // ~0.0025deg ≈ 275 m at this latitude.
  const r = Math.min(0.02, Math.max(0.0008, Number.parseFloat(c.req.query('radius') ?? '0.0025') || 0.0025));
  const db = getDb(c.env);
  try {
    const [calls, incidents] = await Promise.all([
      query<Record<string, unknown>>(db,
        `SELECT id, call_number, incident_type, priority, status, location_address, created_at
         FROM calls_for_service
         WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
         ORDER BY created_at DESC LIMIT 10`,
        lat - r, lat + r, lng - r, lng + r).catch(() => []),
      query<Record<string, unknown>>(db,
        `SELECT id, incident_number, incident_type, status, location_address, created_at
         FROM incidents
         WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
         ORDER BY created_at DESC LIMIT 10`,
        lat - r, lat + r, lng - r, lng + r).catch(() => []),
    ]);
    return c.json({ calls, incidents, callCount: calls.length, incidentCount: incidents.length });
  } catch (err) {
    console.error('GET /dispatch/geography/premise-intel failed:', err);
    return c.json({ calls: [], incidents: [], callCount: 0, incidentCount: 0 });
  }
});

// POST /dispatch/geography/backfill — repeatable geography repair.
// For every call + incident with an address: geocode if coordinates are
// missing, then re-run the canonical geofence (incorporated-beat-correct) and
// write the full Area>Section>Zone>Beat. Idempotent; safe to re-run. Admin-only.
// This is the systematic version of the one-time data repair (so stale rows can
// always be re-squared without manual SQL).
geography.post('/backfill', requireRole('admin', 'manager', 'supervisor'), async (c) => {
  const db = getDb(c.env);
  const out = {
    calls: { scanned: 0, geocoded: 0, geofenced: 0 },
    incidents: { scanned: 0, geocoded: 0, geofenced: 0 },
  };

  const coordOf = (latRaw: unknown, lngRaw: unknown): [number | null, number | null] => {
    const lat = latRaw != null && latRaw !== '' ? Number(latRaw) : null;
    const lng = lngRaw != null && lngRaw !== '' ? Number(lngRaw) : null;
    return [Number.isFinite(lat as number) ? (lat as number) : null, Number.isFinite(lng as number) ? (lng as number) : null];
  };

  try {
    // ── Calls ──
    const calls = await query<{ id: number; latitude: unknown; longitude: unknown; location_address: string | null }>(
      db, `SELECT id, latitude, longitude, location_address FROM calls_for_service WHERE location_address IS NOT NULL AND location_address != ''`);
    for (const row of calls) {
      out.calls.scanned++;
      let [lat, lng] = coordOf(row.latitude, row.longitude);
      if ((lat == null || lng == null) && row.location_address) {
        const g = await geocodeAddress(c.env, row.location_address).catch(() => null);
        if (g) { lat = g.lat; lng = g.lng; out.calls.geocoded++; await execute(db, 'UPDATE calls_for_service SET latitude=?, longitude=? WHERE id=?', lat, lng, row.id); }
      }
      if (lat == null || lng == null) continue;
      const d = await resolveDistrict(c.env, { lat, lng }).catch(() => null);
      if (!d || !d.beat_id) continue;
      await execute(db,
        `UPDATE calls_for_service SET sector_id=?, sector_name=?, zone_id=?, zone_name=?, beat_id=?, beat_name=?, beat_descriptor=?, dispatch_code=?, zone_beat=? WHERE id=?`,
        d.sector_id, d.sector_name, d.zone_id, d.zone_name, d.beat_id, d.beat_name, d.beat_descriptor, d.dispatch_code, d.zone_beat, row.id);
      await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', row.id);
      await execute(db, 'UPDATE calls_for_service_ext SET area_code=?, area_name=? WHERE id=?', d.area_code, d.area_name, row.id);
      out.calls.geofenced++;
    }

    // ── Incidents ──
    const incidents = await query<{ id: number; latitude: unknown; longitude: unknown; location_address: string | null }>(
      db, `SELECT id, latitude, longitude, location_address FROM incidents WHERE location_address IS NOT NULL AND location_address != ''`);
    for (const row of incidents) {
      out.incidents.scanned++;
      let [lat, lng] = coordOf(row.latitude, row.longitude);
      if ((lat == null || lng == null) && row.location_address) {
        const g = await geocodeAddress(c.env, row.location_address).catch(() => null);
        if (g) { lat = g.lat; lng = g.lng; out.incidents.geocoded++; await execute(db, 'UPDATE incidents SET latitude=?, longitude=? WHERE id=?', lat, lng, row.id); }
      }
      if (lat == null || lng == null) continue;
      const d = await resolveDistrict(c.env, { lat, lng }).catch(() => null);
      if (!d || !d.beat_id) continue;
      await execute(db,
        `UPDATE incidents SET sector_id=?, zone_id=?, beat_id=?, zone_beat=?, area_code=?, area_name=? WHERE id=?`,
        d.sector_id, d.zone_id, d.beat_id, d.zone_beat, d.area_code, d.area_name, row.id);
      out.incidents.geofenced++;
    }

    return c.json({ ok: true, ...out });
  } catch (err) {
    console.error('POST /dispatch/geography/backfill failed:', err);
    return c.json({ ok: false, error: (err as Error)?.message, ...out }, 500);
  }
});

export default geography;
