import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { broadcastUnitUpdate } from '../../utils/websocket';
import { reverseGeocodeDetailed } from '../../utils/geocode';
import { localNow } from '../../utils/timeUtils';

// GPS source priority — higher number wins
const GPS_SOURCE_PRIORITY: Record<string, number> = {
  browser_desktop: 1,
  browser: 1,       // legacy fallback
  browser_mobile: 2,
  clearpathgps: 3,
};
const GPS_STALE_MS = 30_000; // 30 seconds — stale source can be overridden by lower priority

const router = Router();

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
      points = req.body.points.slice(0, 60); // Cap at 60 points per request
    } else if (req.body.latitude != null && req.body.longitude != null) {
      // Legacy single-point format
      points = [{
        lat: req.body.latitude,
        lng: req.body.longitude,
        accuracy: req.body.accuracy ?? null,
        heading: req.body.heading ?? null,
        speed: req.body.speed ?? null,
        timestamp: null,
      }];
    } else {
      res.status(400).json({ error: 'latitude/longitude or points[] required' });
      return;
    }

    // Validate: at least one point with finite, in-range coordinates
    // isFinite() rejects NaN and Infinity which would pass the range checks
    const validPoints = points.filter(
      (p) => typeof p.lat === 'number' && typeof p.lng === 'number' &&
        isFinite(p.lat) && isFinite(p.lng) &&
        p.lat >= -90 && p.lat <= 90 &&
        p.lng >= -180 && p.lng <= 180
    );

    if (validPoints.length === 0) {
      res.status(400).json({ error: 'No valid GPS points provided' });
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
        res.status(500).json({ error: 'Failed to create or find unit' });
        return;
      }
      console.log(`[GPS] Auto-created unit "${unit.call_sign}" for user ${req.user!.userId}`);

      // Audit log: auto-created unit
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, 'unit_auto_created', 'unit', ?, ?, ?, ?)
      `).run(
        req.user!.userId,
        unit.id,
        `Auto-created unit "${unit.call_sign}" via GPS tracking`,
        req.ip || 'unknown',
        localNow(),
      );
    }

    // GPS tracking is mandatory for ALL logged-in users regardless of status.
    // Previously off_duty units were skipped — now we always record breadcrumbs.

    // ── Use the LATEST point for live unit position and broadcast ──
    const latest = validPoints[validPoints.length - 1];

    // ── GPS Source Priority Check ──
    // Determine incoming source: phone GPS > desktop WiFi
    const deviceType = req.body.device_type || 'desktop';
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

    // Broadcast ONLY when live position was actually updated (avoids flickering on dispatch map)
    if (shouldUpdateLive) {
      broadcastUnitUpdate({ action: 'unit_position_update', unit: updated });
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
      } catch (err: any) {
        console.error('[GPS] Geocode backfill error:', err instanceof Error ? err.message : err);
      }
    })();
  } catch (error: any) {
    console.error('GPS update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('Get my unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/gps/trail/:unitId - Get GPS breadcrumb trail for a unit
// Also applies the same starburst-prevention filters as /trails.
router.get('/gps/trail/:unitId', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rawUnitId = String(req.params.unitId);
    const unitId = parseInt(rawUnitId, 10);
    if (isNaN(unitId) || unitId < 1 || String(unitId) !== rawUnitId) {
      res.status(400).json({ error: 'Invalid unit ID' });
      return;
    }
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 72);

    const rows = db.prepare(`
      SELECT latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number,
        current_call_id, current_call_number, current_call_type,
        recorded_at
      FROM gps_breadcrumbs
      WHERE unit_id = ? AND recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY recorded_at ASC
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

    res.json(filtered);
  } catch (error: any) {
    console.error('GPS trail error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    const rows = db.prepare(`
      SELECT b.unit_id, b.call_sign, b.latitude, b.longitude, b.accuracy,
        b.heading, b.speed, b.unit_status, b.officer_name, b.badge_number,
        b.current_call_number, b.current_call_type, b.recorded_at,
        b.road_name, b.nearest_intersection
      FROM gps_breadcrumbs b
      JOIN units u ON b.unit_id = u.id
      WHERE b.recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY b.unit_id, b.recorded_at ASC
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

    res.json(Object.values(trails));
  } catch (error: any) {
    console.error('GPS trails error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    res.json({ deleted: result.changes });
  } catch (error: any) {
    console.error('Breadcrumb cleanup error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
