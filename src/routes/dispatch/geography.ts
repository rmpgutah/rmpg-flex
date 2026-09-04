import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { resolveDistrict } from '../../utils/districtResolver';
import { geocodeAddress } from '../geocode';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';
import { PMTiles, type Source, type RangeResponse } from 'pmtiles';
import { lngLatToTile, neighborTiles } from '../../utils/osm/tileGeometry';
import { nearestMaxspeedInTile, type SpeedLimitHit } from '../../utils/osm/speedLimitLookup';

import { dbErrorResponse } from '../../utils/dbErrors';
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
      (z as Record<string, unknown>).beats = beatsByZone.get(z.id) || [];
      const list = zonesBySector.get(z.sector_id) || [];
      list.push(z);
      zonesBySector.set(z.sector_id, list);
    }
    const sectorsByArea = new Map<unknown, Record<string, unknown>[]>();
    for (const s of sectors) {
      (s as Record<string, unknown>).zones = zonesBySector.get(s.id) || [];
      const list = sectorsByArea.get(s.area_id) || [];
      list.push(s);
      sectorsByArea.set(s.area_id, list);
    }
    const areaIds = new Set(areas.map((a) => a.id));
    for (const area of areas) {
      (area as Record<string, unknown>).sectors = sectorsByArea.get(area.id) || [];
    }
    // Sectors whose area_id points at no surviving area would otherwise vanish
    // from the tree — surface them so the Geography page can still render them.
    const unassigned_sectors = sectors.filter((s) => !areaIds.has(s.area_id));

    // Shape MUST be { areas, unassigned_sectors } — the client GeographyTree
    // type and GeographyPage read `tree.areas`. Returning a bare array here
    // (the prior bug) made `tree.areas` undefined and threw on first access.
    return c.json({ areas, unassigned_sectors });
  } catch (err) {
    log.error('GET /dispatch/geography/tree failed', {}, err);
    return dbErrorResponse(c, err, 'Failed to get geography');
  }
});

// GET /dispatch/geography/codes
geography.get('/codes', async (c) => {
  try {
    const db = getDb(c.env);
    const codes = await query<Record<string, unknown>>(db, 'SELECT * FROM dispatch_codes ORDER BY code');
    return c.json(codes);
  } catch (err) {
    log.error('GET /codes failed', { src: 'src/routes/dispatch/geography.ts' }, err);
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
    log.error('GET /dispatch/geography/codes/lookup failed', {}, err);
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
geography.get('/premise-alerts', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin', 'client_viewer'), async (c) => {
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
    log.error('GET /dispatch/geography/premise-alerts failed', {}, err);
    return c.json([]);
  }
});

// GET /dispatch/districts
//
// Field-naming note: `sector_id`/`area_id` are the numeric dispatch_sectors.id
// / dispatch_areas.id row keys. `zone_id`/`beat_id` are NOT numeric row keys —
// they're the human-readable zone_code/beat_code strings. Their numeric PKs
// are separately exposed as `zone_db_id`/`beat_db_id`/`sector_db_id`. This
// asymmetry (same `_id` suffix, different semantics per field) already caused
// one production crash from a consumer assuming all four were the same kind
// of value (see client/src/hooks/useDistrictLookup.ts's normalizeSectorId).
// Existing consumers depend on this exact shape — do not rename sector_id/
// zone_id/beat_id without auditing every consumer first.
geography.get('/districts', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        ds.id AS sector_id,
        ds.id AS sector_db_id,
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
    log.error('GET /districts failed', { src: 'src/routes/dispatch/geography.ts' }, err);
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
    log.error('GET /dispatch/geography/districts/identify failed', {}, err);
    return c.json({ found: false, error: 'identify failed' }, 500);
  }
});

// GET /dispatch/geography/premise-intel?lat=&lng=&radius=
// Point-based premise intelligence for the map "What's Here" tool: recent
// calls + incidents near a clicked location (cross-system map<->dispatch/RMS).
// Bounding-box filter on lat/lng (indexed), newest first. Best-effort — a
// query error degrades to empty so the popup still renders geography.
geography.get('/premise-intel', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
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
    log.error('GET /dispatch/geography/premise-intel failed', {}, err);
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
    log.error('POST /dispatch/geography/backfill failed', {}, err);
    return c.json({ ok: false, error: (err as Error)?.message, ...out }, 500);
  }
});

// ── Geography CRUD (areas/sectors/zones/beats) ──────────────────

const GEO_TABLES: Record<string, { table: string; parentCol?: string; codeCol: string; nameCol: string }> = {
  areas:   { table: 'dispatch_areas',   codeCol: 'area_code',   nameCol: 'area_name' },
  sectors: { table: 'dispatch_sectors', codeCol: 'sector_code', nameCol: 'sector_name', parentCol: 'area_id' },
  zones:   { table: 'dispatch_zones',   codeCol: 'zone_code',   nameCol: 'zone_name',   parentCol: 'sector_id' },
  beats:   { table: 'dispatch_beats',   codeCol: 'beat_code',   nameCol: 'beat_name',   parentCol: 'zone_id' },
};

for (const [path, meta] of Object.entries(GEO_TABLES)) {
  geography.post(`/${path}`, requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = getDb(c.env);
      const body = await c.req.json<Record<string, unknown>>();
      if (!body[meta.codeCol] || !body[meta.nameCol]) return c.json({ error: `${meta.codeCol} and ${meta.nameCol} required` }, 400);
      if (meta.parentCol && !body[meta.parentCol]) return c.json({ error: `${meta.parentCol} required` }, 400);
      const cols = [meta.codeCol, meta.nameCol, 'active'];
      const vals: unknown[] = [body[meta.codeCol], body[meta.nameCol], 1];
      const ph = ['?', '?', '?'];
      if (meta.parentCol) { cols.splice(2, 0, meta.parentCol); vals.splice(2, 0, body[meta.parentCol]); ph.splice(2, 0, '?'); }
      const result = await execute(db, `INSERT INTO ${meta.table} (${cols.join(', ')}, created_at) VALUES (${ph.join(', ')}, datetime('now'))`, ...vals);
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (err) {
      log.error('POST /backfill failed', { src: 'src/routes/dispatch/geography.ts' }, err); return c.json({ error: 'Failed to create' }, 500); }
  });

  geography.delete(`/${path}/:id`, requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = getDb(c.env);
      const id = c.req.param('id');
      const result = await execute(db, `DELETE FROM ${meta.table} WHERE id = ?`, id);
      if ((result.meta.changes ?? 0) === 0) return c.json({ error: 'Not found' }, 404);
      return c.json({ success: true });
    } catch (err) {
      log.error('POST /backfill failed', { src: 'src/routes/dispatch/geography.ts' }, err); return c.json({ error: 'Failed to delete' }, 500); }
  });

  // PUT /:id — edit a geography row. This handler was MISSING: the Geography
  // editor saves via PUT /dispatch/geography/{tier}s/{id}, but only POST (create)
  // and DELETE existed, so every edit 404'd ("Save failed: ... status 404").
  // Body keys are allowlisted against the table's REAL columns (PRAGMA) so it is
  // injection-safe and tolerant of each tier's different field set + live schema
  // drift. `meta.table` is a hardcoded constant, not user input, so interpolating
  // it into the PRAGMA/UPDATE is safe.
  geography.put(`/${path}/:id`, requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = getDb(c.env);
      const id = c.req.param('id');
      const body = await c.req.json<Record<string, unknown>>();
      const colsInfo = await query<{ name: string }>(db, `PRAGMA table_info(${meta.table})`);
      const valid = new Set(colsInfo.map((r) => r.name));
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (k === 'id' || k === 'created_at' || k === 'updated_at') continue;
        if (valid.has(k)) { sets.push(`${k} = ?`); vals.push(v); }
      }
      if (sets.length === 0) return c.json({ error: 'No updatable fields' }, 400);
      if (valid.has('updated_at')) sets.push("updated_at = datetime('now')");
      vals.push(id);
      await execute(db, `UPDATE ${meta.table} SET ${sets.join(', ')} WHERE id = ?`, ...vals);
      return c.json({ success: true });
    } catch (err) {
      log.error('POST /backfill failed', { src: 'src/routes/dispatch/geography.ts' }, err); return c.json({ error: 'Failed to update' }, 500); }
  });
}

// GET /dispatch/geography/zone-allocation — per-zone unit counts for patrol balancing.
geography.get('/zone-allocation', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT dz.id AS zone_id, dz.zone_code, dz.zone_name,
              COUNT(u.id) AS unit_count
       FROM dispatch_zones dz
       LEFT JOIN dispatch_beats db2 ON db2.zone_id = dz.id
       LEFT JOIN units u ON u.assigned_beat = db2.beat_code AND u.status NOT IN ('off_duty','out_of_service')
       WHERE dz.active = 1
       GROUP BY dz.id ORDER BY dz.zone_code`);
    return c.json(rows);
  } catch (err) {
    log.error('dispatch GET /geography zone-summary failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json([]);
  }
});

// ── Posted speed limit at a point ───────────────────────────────────────────
// GET /dispatch/geography/road-speed?lat=&lng=  ->  { limitMph, roadName, ... }
//
// Reads the osm-traffic PMTiles archive from R2 and returns the nearest way
// carrying a maxspeed tag. This replaces a direct browser call to
// overpass-api.de (a volunteer-run service whose fair-use policy excludes
// production traffic) with RMPG's own data.
//
// EVERY failure mode degrades to 200 { limitMph: null }. This backs a drive-mode
// HUD readout: "we don't know" and "there is no posted limit" are the same
// operational answer, and neither justifies an error the caller must handle.

/** Zoom of the maxspeed category in config/osm-layers.json. */
const ROAD_SPEED_Z = 13;
/** Source-layer name inside osm-traffic.pmtiles (the OSM group name). */
const ROAD_SPEED_LAYER = 'traffic';
/**
 * Ignore a "nearest" road farther than this. At z13 a tile is ~4.9 km wide, so
 * without a cap the lookup would confidently report a highway a suburb away.
 */
const ROAD_SPEED_MAX_M = 60;

class RoadSpeedR2Source implements Source {
  constructor(private bucket: R2Bucket, private key: string) {}
  getKey() { return this.key; }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, { range: { offset, length } });
    if (!obj) throw new Error(`archive not found: ${this.key}`);
    return { data: await obj.arrayBuffer() };
  }
}

geography.get('/road-speed', async (c) => {
  const latRaw = c.req.query('lat');
  const lngRaw = c.req.query('lng');
  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  if (latRaw == null || lngRaw == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng are required numbers' }, 400);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return c.json({ error: 'lat/lng out of range' }, 400);
  }

  const miss = { limitMph: null, roadName: null, distanceM: null, source: 'osm' as const };

  try {
    const archive = new PMTiles(
      new RoadSpeedR2Source(c.env.MAP_DATA, 'tiles/osm-traffic.pmtiles'),
    );

    const center = lngLatToTile(lng, lat, ROAD_SPEED_Z);
    // A point near a tile edge can have its nearest road in the next tile over,
    // so search the neighbours too and take the global minimum.
    const candidates = [center, ...neighborTiles(center.x, center.y, ROAD_SPEED_Z)];

    let best: SpeedLimitHit | null = null;
    for (const t of candidates) {
      let tile;
      try {
        tile = await archive.getZxy(ROAD_SPEED_Z, t.x, t.y);
      } catch {
        // Missing archive or unreadable tile — treat as no data here.
        continue;
      }
      if (!tile || !tile.data) continue;

      const hit = nearestMaxspeedInTile(
        new Uint8Array(tile.data as ArrayBuffer),
        ROAD_SPEED_Z, t.x, t.y, lng, lat, ROAD_SPEED_LAYER,
      );
      if (hit && (best == null || hit.distanceM < best.distanceM)) best = hit;
    }

    if (!best || best.distanceM > ROAD_SPEED_MAX_M) return c.json(miss);

    return c.json(
      {
        limitMph: best.limitMph,
        roadName: best.roadName,
        distanceM: Math.round(best.distanceM),
        source: 'osm' as const,
      },
      200,
      // The archive is a static extract, so a coordinate's answer only changes
      // when the extract is rebuilt — hence the 24h TTL. `private` (not
      // `public`) because this route sits behind JWT auth: `public` would let
      // a shared/proxy cache store a response served under a user's
      // credentials, even though the payload itself (a posted speed limit) is
      // not sensitive.
      { 'Cache-Control': 'private, max-age=86400' },
    );
  } catch (err) {
    log.error('road-speed lookup failed', { lat, lng }, err as Error);
    return c.json(miss);
  }
});

// ── GET /dispatch/geography/beat-coverage ──────────────────────
// For each beat, returns unit count, active call count, and
// avg response time in the last 24 h. coverage_status:
//   'covered'   ≥1 available unit assigned
//   'undermanned' ≥1 unit but all are busy / assigned to calls
//   'uncovered'  0 units assigned
geography.get('/beat-coverage', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    // Beat-level unit counts (grouped by assigned_beat)
    const unitRows = await query<{ beat: string; unit_count: number; available_count: number }>(
      db,
      `SELECT
         COALESCE(assigned_beat, 'Unzoned') AS beat,
         COUNT(*) AS unit_count,
         SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available_count
       FROM units
       WHERE status NOT IN ('off_duty','out_of_service')
       GROUP BY assigned_beat`,
    );
    // Active call counts per beat. CFS geography columns are beat_id /
    // zone_beat / zone_name (there is no `beat` or `zone` column).
    const callRows = await query<{ beat: string; call_count_active: number }>(
      db,
      `SELECT
         COALESCE(beat_id, zone_beat, zone_name, 'Unzoned') AS beat,
         COUNT(*) AS call_count_active
       FROM calls_for_service
       WHERE COALESCE(status,'') NOT IN ('closed','cleared','cancelled','canceled','archived','completed')
       GROUP BY beat`,
    );
    // Avg response time per beat in last 24 h (dispatched_at → onscene_at;
    // there are no dispatch_time / on_scene_time columns).
    const respRows = await query<{ beat: string; avg_response_time_24h: number | null }>(
      db,
      `SELECT
         COALESCE(beat_id, zone_beat, zone_name, 'Unzoned') AS beat,
         AVG(
           (julianday(onscene_at) - julianday(dispatched_at)) * 1440
         ) AS avg_response_time_24h
       FROM calls_for_service
       WHERE onscene_at IS NOT NULL
         AND dispatched_at IS NOT NULL
         AND created_at >= datetime('now', '-24 hours')
       GROUP BY beat`,
    );

    // Build lookup maps
    const callMap = new Map<string, number>();
    for (const r of callRows) callMap.set(r.beat, r.call_count_active);
    const respMap = new Map<string, number | null>();
    for (const r of respRows) respMap.set(r.beat, r.avg_response_time_24h);

    const result = unitRows.map((r) => {
      let coverage_status: 'covered' | 'undermanned' | 'uncovered';
      if (r.unit_count === 0) {
        coverage_status = 'uncovered';
      } else if (r.available_count === 0) {
        coverage_status = 'undermanned';
      } else {
        coverage_status = 'covered';
      }
      const avgResp = respMap.get(r.beat) ?? null;
      return {
        beat: r.beat,
        unit_count: r.unit_count,
        call_count_active: callMap.get(r.beat) ?? 0,
        avg_response_time_24h: avgResp != null ? Math.round(avgResp * 10) / 10 : null,
        coverage_status,
      };
    });

    return c.json(result);
  } catch (err) {
    log.error('[geography] GET /beat-coverage failed', {}, err);
    return c.json({ error: 'Beat coverage unavailable' }, 500);
  }
});

// ── GET /dispatch/geography/incident-heatmap ────────────────────
// Returns lat/lng/weight/incident_type for all calls in the last
// N hours (default 24, max 168). Used by Mapbox heatmap layer.
geography.get('/incident-heatmap', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const hours = Math.min(168, Math.max(1, parseInt(c.req.query('hours') || '24', 10) || 24));
  try {
    const db = getDb(c.env);
    const rows = await query<{
      latitude: number | null;
      longitude: number | null;
      incident_type: string | null;
      priority: string | null;
    }>(
      db,
      `SELECT latitude, longitude, incident_type, priority
       FROM calls_for_service
       WHERE latitude IS NOT NULL
         AND longitude IS NOT NULL
         AND created_at >= datetime('now', '-' || ? || ' hours')`,
      hours,
    );
    // Weight by priority: critical=3, high=2, others=1
    const heatmap = rows
      .filter((r) => r.latitude != null && r.longitude != null)
      .map((r) => {
        const p = (r.priority ?? '').toLowerCase();
        const weight = p === 'critical' || p === '1' ? 3
          : p === 'high' || p === '2' ? 2 : 1;
        return {
          latitude: r.latitude as number,
          longitude: r.longitude as number,
          weight,
          incident_type: r.incident_type ?? 'Unknown',
        };
      });
    return c.json({ hours, count: heatmap.length, points: heatmap });
  } catch (err) {
    log.error('[geography] GET /incident-heatmap failed', { hours }, err);
    return c.json({ error: 'Heatmap data unavailable' }, 500);
  }
});

export default geography;
