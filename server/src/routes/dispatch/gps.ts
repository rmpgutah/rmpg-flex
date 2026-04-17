import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { broadcastUnitUpdate, broadcastAlert } from '../../utils/websocket';
import { reverseGeocodeDetailed } from '../../utils/geocode';
import { localNow } from '../../utils/timeUtils';
import { auditLog } from '../../utils/auditLogger';

// GPS source priority — higher number wins
const GPS_SOURCE_PRIORITY: Record<string, number> = {
  browser_desktop: 1,
  browser: 1,       // legacy fallback
  browser_mobile: 2,
  clearpathgps: 3,
  owntracks: 4,     // phone background GPS — most reliable, always-on
  traccar: 4,       // alternative background tracker
};
const GPS_STALE_MS = 30_000; // 30 seconds — stale source can be overridden by lower priority

/** Ray-casting point-in-polygon test */
function pointInPolygon(lat: number, lng: number, polygon: { lat: number; lng: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    if ((yi > lng) !== (yj > lng) && lat < (xj - xi) * (lng - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const router = Router();

// Fix 19: Ensure index on gps_breadcrumbs(call_sign, recorded_at) for trail queries
try {
  const db = getDb();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_unit_recorded
    ON gps_breadcrumbs(unit_id, recorded_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_call_sign_recorded
    ON gps_breadcrumbs(call_sign, recorded_at)`).run();
} catch (err) { console.error('[GPS] Index creation skipped (table may not exist yet):', err instanceof Error ? err.message : err); }

// Fix 16: Validate call_sign parameter format
function isValidCallSign(callSign: string): boolean {
  return typeof callSign === 'string' && callSign.length >= 1 && callSign.length <= 50 && /^[A-Za-z0-9\-_]+$/.test(callSign);
}

// Fix 22: Validate coordinate ranges
function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// POST /api/dispatch/gps - Batch GPS position update from officer
// Accepts either a single point or an array of points collected at ~1-second intervals.
// Updates the unit's live position (latest point only), bulk-inserts all breadcrumbs,
// and broadcasts the latest position via WebSocket.
//
// Body formats:
//   Single (legacy):  { latitude, longitude, accuracy, heading, speed }
//   Batch (v4.3+):    { points: [{ lat, lng, accuracy, heading, speed, timestamp }] }
router.post('/gps', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    // ── Normalize input: single point or batch ──
    interface GpsPoint {
      lat: number;
      lng: number;
      accuracy: number | null;
      heading: number | null;
      speed: number | null;
      timestamp: string | null;
    }

    let points: GpsPoint[];
    let pointsReceived = 0;

    if (Array.isArray(req.body?.points) && req.body.points.length > 0) {
      // Batch format: { points: [...] }
      pointsReceived = req.body.points.length;
      // Validate each point has the expected shape before processing
      const rawPoints = req.body.points.slice(0, 60); // Cap at 60 points per request
      for (const pt of rawPoints) {
        if (pt === null || typeof pt !== 'object' || Array.isArray(pt)) {
          res.status(400).json({ error: 'Each point must be an object with lat/lng', code: 'EACH_POINT_MUST_BE' });
          return;
        }
      }
      points = rawPoints.filter((pt: any) => pt.lat != null && pt.lng != null).map((pt: any) => ({
        lat: Number(pt.lat),
        lng: Number(pt.lng),
        accuracy: pt.accuracy != null ? Number(pt.accuracy) : null,
        heading: pt.heading != null ? Number(pt.heading) : null,
        speed: pt.speed != null ? Number(pt.speed) : null,
        timestamp: typeof pt.timestamp === 'string' && pt.timestamp.length <= 50 ? pt.timestamp : null,
      }));
    } else if (req.body.latitude != null && req.body.longitude != null) {
      // Legacy single-point format
      const lat = Number(req.body.latitude);
      const lng = Number(req.body.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        res.status(400).json({ error: 'latitude and longitude must be valid numbers', code: 'LATITUDE_AND_LONGITUDE_MUST' });
        return;
      }
      points = [{
        lat,
        lng,
        accuracy: req.body.accuracy != null ? Number(req.body.accuracy) : null,
        heading: req.body.heading != null ? Number(req.body.heading) : null,
        speed: req.body.speed != null ? Number(req.body.speed) : null,
        timestamp: null,
      }];
    } else {
      res.status(400).json({ error: 'latitude/longitude or points[] required', code: 'LATITUDELONGITUDE_OR_POINTS_REQUIRED' });
      return;
    }

    // Validate: at least one point with valid coordinates
    const validPoints = points.filter(
      (p) => p.lat != null && p.lng != null &&
        p.lat >= -90 && p.lat <= 90 &&
        p.lng >= -180 && p.lng <= 180
    );

    if (validPoints.length === 0) {
      res.status(400).json({ error: 'No valid GPS points provided', code: 'NO_VALID_GPS_POINTS' });
      return;
    }

    // Find unit assigned to current user — auto-create if none exists.
    // GPS tracking is mandatory for ALL logged-in users, so every user
    // needs a unit entry to store their position and broadcast updates.
    let unit = db.prepare('SELECT id, call_sign, status FROM units WHERE officer_id = ?').get(req.user!.userId) as any;
    if (!unit) {
      // Wrap check-then-insert in a transaction to prevent TOCTOU race
      const ensureUnit = db.transaction((userId: number) => {
        // Re-check inside transaction
        const existing = db.prepare('SELECT id, call_sign, status FROM units WHERE officer_id = ?').get(userId) as any;
        if (existing) return existing;

        const userInfo = db.prepare('SELECT badge_number, username, full_name FROM users WHERE id = ?').get(userId) as any;
        const callSign = userInfo?.badge_number || userInfo?.username || `P-${userId}`;

        const csConflict = db.prepare('SELECT id FROM units WHERE call_sign = ?').get(callSign) as any;
        const finalCallSign = csConflict ? `${callSign}-${userId}` : callSign;

        try {
          db.prepare(`INSERT INTO units (call_sign, officer_id, status) VALUES (?, ?, 'available')`).run(finalCallSign, userId);
        } catch (insertErr: any) {
          if (!insertErr.message?.includes('UNIQUE constraint')) throw insertErr;
        }
        return db.prepare('SELECT id, call_sign, status FROM units WHERE officer_id = ?').get(userId) as any;
      });

      unit = ensureUnit(req.user!.userId);
      if (!unit) {
        res.status(500).json({ error: 'Failed to create or find unit', code: 'FAILED_TO_CREATE_OR' });
        return;
      }
      console.log(`[GPS] Auto-created unit "${unit.call_sign}" for user ${req.user!.userId}`);

      // Audit log: auto-created unit
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'unit_auto_created', 'unit', ?, ?, ?)
      `).run(
        req.user!.userId,
        unit.id,
        `Auto-created unit "${unit.call_sign}" via GPS tracking`,
        req.ip || 'unknown',
      );
    }

    // GPS tracking is mandatory for ALL logged-in users regardless of status.
    // Previously off_duty units were skipped — now we always record breadcrumbs.

    // ── Use the LATEST point for live unit position and broadcast ──
    const latest = validPoints[validPoints.length - 1];

    // ── GPS Source Priority Check ──
    // Determine incoming source: phone GPS > desktop WiFi
    const allowedDeviceTypes = ['mobile', 'desktop'];
    const rawDeviceType = typeof req.body.device_type === 'string' ? req.body.device_type : 'desktop';
    const deviceType = allowedDeviceTypes.includes(rawDeviceType) ? rawDeviceType : 'desktop';
    const gpsSource = deviceType === 'mobile' ? 'browser_mobile' : 'browser_desktop';
    const incomingPriority = GPS_SOURCE_PRIORITY[gpsSource] ?? 1;

    // Check current unit's GPS source and freshness
    const currentGps = db.prepare('SELECT gps_source, gps_updated_at FROM units WHERE id = ?').get(unit.id) as any;
    const currentPriority = GPS_SOURCE_PRIORITY[currentGps?.gps_source] ?? 0;
    const updatedAtMs = currentGps?.gps_updated_at ? new Date(currentGps.gps_updated_at).getTime() : NaN;
    const currentAge = !isNaN(updatedAtMs)
      ? Date.now() - updatedAtMs
      : Infinity; // no previous update or invalid date → always accept

    // Update live position only if: incoming priority >= current, OR current source is stale
    const shouldUpdateLive = incomingPriority >= currentPriority || currentAge > GPS_STALE_MS;

    if (shouldUpdateLive) {
      db.prepare(`
        UPDATE units SET latitude = ?, longitude = ?, gps_source = ?, gps_updated_at = ?
        WHERE id = ?
      `).run(latest.lat, latest.lng, gpsSource, localNow(), unit.id);
    }

    // Fetch full unit info for broadcast (always needed for breadcrumb metadata)
    const updated = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number,
        c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      WHERE u.id = ?
    `).get(unit.id) as any;

    // ── Bulk-insert all breadcrumb points in a single transaction ──
    // Breadcrumbs are ALWAYS recorded regardless of priority — both sessions contribute trail data
    const insertStmt = db.prepare(`
      INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number, current_call_id, current_call_number, current_call_type,
        road_name, nearest_intersection, gps_source, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        NULL, NULL, ?,
        COALESCE(?, datetime('now','localtime')))
    `);

    const insertMany = db.transaction((pts: GpsPoint[]) => {
      for (const pt of pts) {
        insertStmt.run(
          unit.id, req.user!.userId, pt.lat, pt.lng,
          pt.accuracy, pt.heading, pt.speed,
          updated?.status ?? unit.status, updated?.call_sign ?? unit.call_sign,
          updated?.officer_name ?? null, updated?.badge_number ?? null,
          updated?.current_call_id ?? null, updated?.call_number ?? null, updated?.current_call_type ?? null,
          gpsSource,
          pt.timestamp ?? null,
        );
      }
    });

    insertMany(validPoints);

    // Compute speed in MPH from latest point (m/s → mph)
    const latestSpeedMph = latest.speed != null && Number.isFinite(latest.speed)
      ? Math.round(latest.speed * 2.23694 * 10) / 10
      : null;

    // Broadcast ONLY when live position was actually updated (avoids flickering on dispatch map)
    if (shouldUpdateLive) {
      broadcastUnitUpdate({
        action: 'unit_position_update',
        unit: { ...updated, speed_mph: latestSpeedMph },
      });
    }

    // ── Check geofences for the latest point ──
    try {
      const geofences = db.prepare('SELECT * FROM geofences WHERE is_active = 1').all() as any[];
      for (const fence of geofences) {
        let coords: any;
        try {
          coords = JSON.parse(fence.polygon_coords);
        } catch (parseErr) {
          console.error(`[GPS] Skipping geofence ${fence.id} — invalid polygon_coords JSON:`, parseErr instanceof Error ? parseErr.message : parseErr);
          continue;
        }
        if (!Array.isArray(coords) || coords.length < 3) continue;
        if (pointInPolygon(latest.lat, latest.lng, coords)) {
          // Broadcast geofence entry alert — frontend deduplicates
          if (fence.alert_on_enter) {
            broadcastAlert({
              type: 'geofence:alert',
              unit: unit.call_sign,
              geofence_id: fence.id,
              geofence_name: fence.name,
              zone_type: fence.zone_type,
              action: 'enter',
            });
          }
        }
      }
    } catch (geoErr) { console.error('[GPS] Geofence check error (non-critical):', geoErr instanceof Error ? geoErr.message : geoErr); }

    // ── Speed Alert — broadcast when unit exceeds threshold ──
    const SPEED_ALERT_MPH = 80;
    const SPEED_PURSUIT_MPH = 100;
    if (latestSpeedMph != null && latestSpeedMph >= SPEED_ALERT_MPH) {
      const severity = latestSpeedMph >= SPEED_PURSUIT_MPH ? 'critical' : 'warning';
      const label = latestSpeedMph >= SPEED_PURSUIT_MPH ? 'PURSUIT SPEED' : 'HIGH SPEED';
      broadcastAlert({
        type: 'speed:alert',
        severity,
        unit: updated?.call_sign || unit.call_sign,
        unit_id: unit.id,
        speed_mph: latestSpeedMph,
        label,
        latitude: latest.lat,
        longitude: latest.lng,
        officer_name: updated?.officer_name || null,
        current_call_number: updated?.call_number || null,
      });
    }

    const pointsCapped = pointsReceived > 60 ? pointsReceived - 60 : 0;
    const pointsInvalid = points.length - validPoints.length;
    res.json({
      ok: true,
      unit_id: unit.id,
      call_sign: unit.call_sign,
      inserted: validPoints.length,
      pointsReceived,
      pointsCapped,
      pointsInvalid,
    });

    // ── Async geocode: reverse-geocode the latest point, then backfill the batch ──
    // Runs after the response is sent so it doesn't slow down the GPS endpoint.
    // NOTE: Rate limiting — each GPS batch triggers at most ONE reverse geocode call.
    // With ~10s batch intervals per unit, this stays well within Google Maps quota.
    (async () => {
      try {
        const geo = await reverseGeocodeDetailed(latest.lat, latest.lng);
        if (!geo || (!geo.road_name && !geo.nearest_intersection)) return;

        // Update all points in this batch that were just inserted (last N for this unit).
        // Use subquery because better-sqlite3 doesn't compile with SQLITE_ENABLE_UPDATE_DELETE_LIMIT.
        db.prepare(`
          UPDATE gps_breadcrumbs
          SET road_name = ?, nearest_intersection = ?
          WHERE id IN (
            SELECT id FROM gps_breadcrumbs
            WHERE unit_id = ? AND road_name IS NULL
            ORDER BY id DESC LIMIT ?
          )
        `).run(geo.road_name, geo.nearest_intersection, unit.id, validPoints.length);
      } catch (err) {
        console.error('[GPS] Geocode backfill error:', err instanceof Error ? err.message : err);
      }
    })();
  } catch (error: any) {
    console.error('[GPS] update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update', code: 'GPS_UPDATE_ERROR' });
  }
});

// GET /api/dispatch/gps/my-unit - Get current user's assigned unit
router.get('/gps/my-unit', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare(`
      SELECT u.id, u.call_sign, u.status, u.latitude, u.longitude
      FROM units u WHERE u.officer_id = ?
    `).get(req.user!.userId) as any;

    res.json(unit || null);
  } catch (error: any) {
    console.error('[GPS] get my unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get my unit', code: 'GPS_GET_MY_UNIT' });
  }
});

// GET /api/dispatch/gps/trail/:unitId - Get GPS breadcrumb trail for a unit
// Also applies the same starburst-prevention filters as /trails.
router.get('/gps/trail/:unitId', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unitId = parseInt(req.params.unitId as string, 10);
    if (isNaN(unitId)) { res.status(400).json({ error: 'Invalid unit ID', code: 'INVALID_UNIT_ID' }); return; }
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 72);

    // Fix 15: LIMIT on trail queries to prevent huge responses
    const rows = db.prepare(`
      SELECT latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number,
        current_call_id, current_call_number, current_call_type,
        recorded_at
      FROM gps_breadcrumbs
      WHERE unit_id = ? AND recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY recorded_at ASC
      LIMIT 10000
    `).all(unitId, hours) as any[];

    // ── Filter: accuracy gate + jump detection + stationary collapse ──
    const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 6_371_000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const MAX_ACCURACY = 150;
    const MAX_SPEED    = 80;
    const MIN_DISTANCE = 3;
    const filtered: any[] = [];

    for (const row of rows) {
      if (row.accuracy != null && row.accuracy > MAX_ACCURACY) continue;

      if (filtered.length === 0) {
        filtered.push(row);
        continue;
      }

      const prev = filtered[filtered.length - 1];
      const dist = haversineM(prev.latitude, prev.longitude, row.latitude, row.longitude);

      if (dist < MIN_DISTANCE) continue;

      const rowTime = new Date(row.recorded_at).getTime();
      const prevTime = new Date(prev.recorded_at).getTime();
      if (isNaN(rowTime) || isNaN(prevTime)) continue; // skip points with invalid timestamps
      const dtSec = Math.max((rowTime - prevTime) / 1000, 0.5);
      if (dist / dtSec > MAX_SPEED) continue;

      filtered.push(row);
    }

    // Fix 17: Cache headers for frequently-accessed positions
    res.set('Cache-Control', 'private, max-age=5');
    // Fix 20: Return proper error codes
    res.json(filtered);
  } catch (error: any) {
    console.error('[GPS] trail error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'GPS_TRAIL_ERROR' });
  }
});

// GET /api/dispatch/gps/trails - Get breadcrumb trails for all active units
// Applies server-side filtering to eliminate starburst artifacts caused by
// WiFi-triangulation jumps stored in the database (pre-v4.3 data).
router.get('/gps/trails', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 72);

    // Haversine distance in meters between two lat/lng pairs
    const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 6_371_000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Use SQLite's datetime() for the cutoff so the format matches
    // recorded_at's DEFAULT (datetime('now','localtime') → "YYYY-MM-DD HH:MM:SS").
    // Fix 15: LIMIT on trail queries to prevent huge responses
    const rows = db.prepare(`
      /* Uses idx: gps_breadcrumbs(unit_id, recorded_at) */
      SELECT b.unit_id, b.call_sign, b.latitude, b.longitude, b.accuracy,
        b.heading, b.speed, b.unit_status, b.officer_name, b.badge_number,
        b.current_call_number, b.current_call_type, b.recorded_at,
        b.road_name, b.nearest_intersection
      FROM gps_breadcrumbs b
      JOIN units u ON b.unit_id = u.id
      WHERE b.recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY b.unit_id, b.recorded_at ASC
      LIMIT 50000
    `).all(hours) as any[];

    // ── Group by unit, then filter each trail to remove starburst artifacts ──
    // Three filters applied per-unit:
    //   1. Accuracy gate: skip points with accuracy > 150m (WiFi triangulation)
    //   2. Distance collapse: skip points <3m from last accepted (GPS drift)
    //   3. Jump detection: skip points implying > 80 m/s (~179 mph) — WiFi teleportation
    const MAX_ACCURACY = 150;   // meters — reject WiFi-triangulated junk
    const MAX_SPEED    = 80;    // m/s (~179 mph) — reject impossible jumps
    const MIN_DISTANCE = 3;     // meters — collapse stationary GPS drift

    const trails: Record<number, { unit_id: number; call_sign: string; officer_name: string; badge_number: string; points: any[] }> = {};

    for (const row of rows) {
      if (!trails[row.unit_id]) {
        trails[row.unit_id] = {
          unit_id: row.unit_id,
          call_sign: row.call_sign,
          officer_name: row.officer_name || '',
          badge_number: row.badge_number || '',
          points: [],
        };
      }

      // ── Accuracy gate ──
      if (row.accuracy != null && row.accuracy > MAX_ACCURACY) continue;

      const pt = {
        lat: row.latitude,
        lng: row.longitude,
        accuracy: row.accuracy,
        heading: row.heading,
        speed: row.speed,
        status: row.unit_status,
        call_number: row.current_call_number,
        call_type: row.current_call_type,
        time: row.recorded_at,
        road_name: row.road_name || null,
        intersection: row.nearest_intersection || null,
      };

      const trailPts = trails[row.unit_id].points;

      if (trailPts.length === 0) {
        trailPts.push(pt);
        continue;
      }

      const prev = trailPts[trailPts.length - 1];
      const dist = haversineM(prev.lat, prev.lng, pt.lat, pt.lng);

      // ── Collapse stationary duplicates ──
      if (dist < MIN_DISTANCE) continue;

      // ── Jump detection: check implied speed between consecutive accepted points ──
      const prevTime = new Date(prev.time).getTime();
      const curTime  = new Date(pt.time).getTime();
      if (isNaN(prevTime) || isNaN(curTime)) continue; // skip points with invalid timestamps
      const dtSec    = Math.max((curTime - prevTime) / 1000, 0.5); // floor at 0.5s to avoid /0

      if (dist / dtSec > MAX_SPEED) continue; // impossible jump — skip

      trailPts.push(pt);
    }

    // Fix 17: Cache headers
    res.set('Cache-Control', 'private, max-age=5');
    const result = Object.values(trails);
    res.json(result);
  } catch (error: any) {
    console.error('[GPS] trails error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'GPS_TRAILS_ERROR' });
  }
});

// GET /api/dispatch/gps/dwell-times - Calculate how long each active unit has been stationary
// Walks back through recent breadcrumbs to find when position last changed by >50m.
router.get('/gps/dwell-times', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Get all active units with a known position
    const units = db.prepare(`
      SELECT id, call_sign, latitude, longitude, status
      FROM units
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND status != 'off_duty'
    
      LIMIT 1000
    `).all() as Array<{ id: number; call_sign: string; latitude: number; longitude: number; status: string }>;

    if (units.length === 0) {
      res.json([]);
      return;
    }

    const THRESHOLD_M = 50; // meters — movement threshold

    // Haversine distance in meters
    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Fix N+1: fetch breadcrumbs for all active units in a single grouped query.
    // ROW_NUMBER window partitions by unit_id, limited to 100 per unit.
    const unitIds = units.map(u => u.id);
    if (unitIds.length === 0) { res.json([]); return; }
    const placeholders = unitIds.map(() => '?').join(',');
    const allBreadcrumbs = db.prepare(`
      SELECT unit_id, latitude, longitude, recorded_at
      FROM (
        SELECT unit_id, latitude, longitude, recorded_at,
          ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY id DESC) as rn
        FROM gps_breadcrumbs
        WHERE unit_id IN (${placeholders})
      )
      WHERE rn <= 100
      ORDER BY unit_id, rn ASC
    
      LIMIT 1000
    `).all(...unitIds) as Array<{ unit_id: number; latitude: number; longitude: number; recorded_at: string }>;

    // Group breadcrumbs by unit_id
    const breadcrumbsByUnit = new Map<number, Array<{ latitude: number; longitude: number; recorded_at: string }>>();
    for (const bc of allBreadcrumbs) {
      let arr = breadcrumbsByUnit.get(bc.unit_id);
      if (!arr) { arr = []; breadcrumbsByUnit.set(bc.unit_id, arr); }
      arr.push(bc);
    }

    // Use SQLite localtime for consistent Mountain Time "now" comparison
    const dbNow = db.prepare(`SELECT datetime('now','localtime') as now`).get() as any;
    const nowLocal = dbNow?.now || localNow();

    const results: Array<{ call_sign: string; latitude: number; longitude: number; dwell_minutes: number; status: string }> = [];

    for (const unit of units) {
      const breadcrumbs = breadcrumbsByUnit.get(unit.id);
      if (!breadcrumbs || breadcrumbs.length === 0) continue;

      // Latest position from unit table
      const latestLat = unit.latitude;
      const latestLng = unit.longitude;

      // Walk backwards to find first breadcrumb where position changed by >50m
      let lastMovedAt: string | null = null;
      for (const bc of breadcrumbs) {
        const dist = haversine(latestLat, latestLng, bc.latitude, bc.longitude);
        if (dist > THRESHOLD_M) {
          lastMovedAt = bc.recorded_at;
          break;
        }
      }

      // If no movement found in last 100 breadcrumbs, use the oldest breadcrumb time
      if (!lastMovedAt && breadcrumbs.length > 0) {
        lastMovedAt = breadcrumbs[breadcrumbs.length - 1].recorded_at;
      }

      if (!lastMovedAt) continue;

      // Compare using Mountain Time consistent timestamps (recorded_at is localtime, nowLocal is localtime)
      const movedAtMs = new Date(lastMovedAt).getTime();
      const nowMs = new Date(nowLocal).getTime();
      const dwellMinutes = Math.round((nowMs - movedAtMs) / 60000);

      // Only include units dwelling > 5 min
      if (dwellMinutes >= 5) {
        results.push({
          call_sign: unit.call_sign,
          latitude: latestLat,
          longitude: latestLng,
          dwell_minutes: dwellMinutes,
          status: unit.status,
        });
      }
    }

    res.set('Cache-Control', 'private, max-age=30');
    res.json(results);
  } catch (error: any) {
    console.error('[GPS] dwell-times error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'GPS_DWELL_ERROR' });
  }
});

// DELETE /api/dispatch/gps/breadcrumbs/cleanup - Purge old breadcrumb data
router.delete('/gps/breadcrumbs/cleanup', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(90, parseInt(req.query.days as string, 10) || 7));

    // Use SQLite datetime() to match the stored format (datetime('now','localtime'))
    const result = db.prepare(
      `DELETE FROM gps_breadcrumbs WHERE recorded_at < datetime('now', 'localtime', '-' || ? || ' days')`
    ).run(days);
    auditLog(req, 'DELETE', 'unit', 0, `Purged ${result.changes} GPS breadcrumbs older than ${days} days`);
    res.json({ deleted: result.changes });
  } catch (error: any) {
    console.error('[GPS] breadcrumb cleanup error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to breadcrumb cleanup', code: 'GPS_BREADCRUMB_CLEANUP_ERROR' });
  }
});

// GET /api/dispatch/gps/units-with-trails — Units with their most recent trail data
router.get('/gps/units-with-trails', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 72);
    const hoursStr = `-${hours} hours`;

    const units = db.prepare(`
      SELECT u.id, u.call_sign, u.status, u.officer_id, usr.full_name as officer_name,
        (SELECT COUNT(*) FROM gps_breadcrumbs b WHERE b.unit_id = u.id AND b.recorded_at >= datetime('now','localtime', ?)) as trail_points,
        (SELECT b.latitude FROM gps_breadcrumbs b WHERE b.unit_id = u.id ORDER BY b.recorded_at DESC LIMIT 1) as last_lat,
        (SELECT b.longitude FROM gps_breadcrumbs b WHERE b.unit_id = u.id ORDER BY b.recorded_at DESC LIMIT 1) as last_lng,
        (SELECT b.recorded_at FROM gps_breadcrumbs b WHERE b.unit_id = u.id ORDER BY b.recorded_at DESC LIMIT 1) as last_seen
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.status != 'off_duty'
      ORDER BY u.call_sign
    `).all(hoursStr);

    res.json(units);
  } catch (error: any) {
    console.error('[GPS] units-with-trails error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to units-with-trails', code: 'GPS_UNITSWITHTRAILS_ERROR' });
  }
});

// ═════════════════════════════════════════════════════════════
// OwnTracks / Traccar Webhook — Background GPS from iPhone/Android
// ═════════════════════════════════════════════════════════════
// Separate router mounted WITHOUT JWT auth in index.ts.
// Uses own bearer token from system_config 'owntracks_webhook_token'.
// ═════════════════════════════════════════════════════════════
export const owntracksWebhookRouter = Router();

// Handle all OwnTracks POST paths:
//   /api/dispatch/gps/owntracks           (direct)
//   /owntracks                             (short path)
//   /owntracks/:user/:device               (OwnTracks appends /{user}/{device})
const owntracksHandler = (req: Request, res: Response) => {
  try {
    const db = getDb();

    // ── Auth: accept Bearer token OR HTTP Basic Auth (OwnTracks sends Basic) ──
    const authHeader = req.headers.authorization || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (authHeader.startsWith('Basic ')) {
      // OwnTracks sends Basic auth — password field is the token
      try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
        // Format: "username:password" — we use the password as the token
        const colonIdx = decoded.indexOf(':');
        token = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
      } catch { /* invalid base64 */ }
    }
    if (!token) {
      res.status(401).json({ error: 'Authentication required — use Basic auth (password = webhook token) or Bearer token' });
      return;
    }

    // Check token against system_config
    const storedRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'owntracks_webhook_token' AND is_active = 1 LIMIT 1"
    ).get() as { config_value?: string } | undefined;
    if (!storedRow?.config_value) {
      res.status(403).json({ error: 'OwnTracks webhook not configured — set token in Admin → Integrations' });
      return;
    }

    if (token !== storedRow.config_value) {
      res.status(403).json({ error: 'Invalid webhook token' });
      return;
    }

    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.json([]); // OwnTracks expects empty array on non-location messages
      return;
    }

    // ── Determine payload format ──
    let lat: number, lng: number, accuracy: number | null = null, heading: number | null = null;
    let speed: number | null = null, battery: number | null = null;
    let trackerId: string = '', timestamp: string | null = null;
    let source: string = 'owntracks';

    if (body._type === 'location' || (body.lat && body.lon)) {
      // OwnTracks format
      lat = Number(body.lat);
      lng = Number(body.lon);
      accuracy = body.acc != null ? Number(body.acc) : null;
      speed = body.vel != null ? Number(body.vel) / 3.6 : null; // km/h → m/s
      heading = body.cog != null ? Number(body.cog) : null;
      battery = body.batt != null ? Number(body.batt) : null;
      trackerId = body.tid || '';
      timestamp = body.tst ? new Date(body.tst * 1000).toISOString() : null;
      source = 'owntracks';
    } else if (body.latitude != null && body.longitude != null) {
      // Traccar / generic format
      lat = Number(body.latitude);
      lng = Number(body.longitude);
      accuracy = body.accuracy != null ? Number(body.accuracy) : null;
      speed = body.speed != null ? Number(body.speed) : null; // already m/s
      heading = body.course != null ? Number(body.course) : (body.bearing != null ? Number(body.bearing) : null);
      trackerId = body.id || body.deviceId || '';
      timestamp = body.deviceTime || body.fixTime || body.serverTime || null;
      source = 'traccar';
    } else {
      // Not a location message — OwnTracks sends transitions, waypoints, etc.
      res.json([]);
      return;
    }

    if (!isValidCoordinate(lat, lng)) {
      res.status(400).json({ error: 'Invalid coordinates' });
      return;
    }

    // ── Map tracker ID to unit ──
    // Look up unit by call_sign matching the tracker ID, or by owntracks_tid column
    let unit = db.prepare(
      "SELECT id, call_sign, status, officer_id FROM units WHERE call_sign = ? OR call_sign LIKE ?"
    ).get(trackerId, `%${trackerId}`) as any;

    if (!unit) {
      // Try the owntracks_tid mapping table
      const mapping = db.prepare(
        "SELECT unit_id FROM owntracks_device_map WHERE tracker_id = ? LIMIT 1"
      ).get(trackerId) as any;
      if (mapping) {
        unit = db.prepare('SELECT id, call_sign, status, officer_id FROM units WHERE id = ?').get(mapping.unit_id);
      }
    }

    if (!unit) {
      res.status(404).json({ error: `No unit mapped to tracker ID "${trackerId}". Add mapping in Admin or set call_sign to match.` });
      return;
    }

    const now = localNow();
    const gpsSource = source;
    const incomingPriority = GPS_SOURCE_PRIORITY[gpsSource] ?? 4;

    // GPS source priority check
    const currentGps = db.prepare('SELECT gps_source, gps_updated_at FROM units WHERE id = ?').get(unit.id) as any;
    const currentPriority = GPS_SOURCE_PRIORITY[currentGps?.gps_source] ?? 0;
    const updatedAtMs = currentGps?.gps_updated_at ? new Date(currentGps.gps_updated_at).getTime() : NaN;
    const currentAge = !isNaN(updatedAtMs) ? Date.now() - updatedAtMs : Infinity;
    const shouldUpdateLive = incomingPriority >= currentPriority || currentAge > GPS_STALE_MS;

    if (shouldUpdateLive) {
      db.prepare('UPDATE units SET latitude = ?, longitude = ?, gps_source = ?, gps_updated_at = ? WHERE id = ?')
        .run(lat, lng, gpsSource, now, unit.id);
    }

    // Fetch full unit for broadcast
    const updated = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number
      FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.id = ?
    `).get(unit.id) as any;

    // Insert breadcrumb
    db.prepare(`
      INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number, gps_source, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')))
    `).run(
      unit.id, unit.officer_id, lat, lng, accuracy, heading, speed,
      updated?.status || unit.status, updated?.call_sign || unit.call_sign,
      updated?.officer_name || null, updated?.badge_number || null,
      gpsSource, timestamp,
    );

    // Broadcast
    const speedMph = speed != null && Number.isFinite(speed) ? Math.round(speed * 2.23694 * 10) / 10 : null;
    if (shouldUpdateLive) {
      broadcastUnitUpdate({ action: 'unit_position_update', unit: { ...updated, speed_mph: speedMph } });
    }

    // Speed alert
    if (speedMph != null && speedMph >= 80) {
      broadcastAlert({
        type: 'speed:alert',
        severity: speedMph >= 100 ? 'critical' : 'warning',
        label: speedMph >= 100 ? 'PURSUIT SPEED' : 'HIGH SPEED',
        unit: updated?.call_sign || unit.call_sign,
        unit_id: unit.id,
        speed_mph: speedMph,
        latitude: lat, longitude: lng,
        officer_name: updated?.officer_name || null,
      });
    }

    // OwnTracks expects empty JSON array response
    res.json([]);
  } catch (error: any) {
    console.error('[GPS] OwnTracks webhook error:', error?.message || error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

const owntracksWebhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // allow webhook bursts while limiting abuse
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OwnTracks webhook requests, please try again later.' },
});

owntracksWebhookRouter.post('/owntracks', owntracksWebhookLimiter, owntracksHandler);
owntracksWebhookRouter.post('/owntracks/:user', owntracksWebhookLimiter, owntracksHandler);
owntracksWebhookRouter.post('/owntracks/:user/:device', owntracksWebhookLimiter, owntracksHandler);
owntracksWebhookRouter.post('/', owntracksWebhookLimiter, owntracksHandler);                    // /owntracks (mounted at /owntracks)
owntracksWebhookRouter.post('/:user', owntracksWebhookLimiter, owntracksHandler);               // /owntracks/:user
owntracksWebhookRouter.post('/:user/:device', owntracksWebhookLimiter, owntracksHandler);       // /owntracks/:user/:device

export default router;
