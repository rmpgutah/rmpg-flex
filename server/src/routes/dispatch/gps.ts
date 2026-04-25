import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { broadcastUnitUpdate, broadcastAlert, broadcastDispatchUpdate } from '../../utils/websocket';
import { reverseGeocodeDetailed } from '../../utils/geocode';
import { localNow } from '../../utils/timeUtils';
import { auditLog } from '../../utils/auditLogger';
import { identifyBeat } from '../../utils/geofence';

// Server-side dedup for Dispatcher Brain geofence-breach broadcasts.
// Map key = call_sign; value = last-broadcast-at (ms). 3min matches
// the client-side rule cooldown so the WS channel isn't spammed on
// every GPS tick while a unit is out of beat.
const GEOFENCE_BREACH_CD_MS = 3 * 60_000;
const lastGeofenceBreachAt = new Map<string, number>();

// GPS source priority — higher number wins
// GPS source priority (higher = dominant). OwnTracks is the designated
// authoritative source for officer tracking; everything else is a fallback.
const GPS_SOURCE_PRIORITY: Record<string, number> = {
  browser_desktop: 1,
  browser: 1,       // legacy fallback
  offline_desktop: 1, // queued breadcrumbs replayed from Electron offline cache
  browser_mobile: 2,
  clearpathgps: 3,
  traccar: 4,       // alternative background tracker
  owntracks: 5,     // ★ DOMINANT — phone background GPS, declared authoritative
};

// Per-source dominance window. When the *currently stored* source is one
// of these, a lower-priority source can only override after this much
// silence. iOS routinely suspends OwnTracks for 1-5 minutes between
// Significant Location updates while in a pocket, so a 30s threshold
// would let the dispatch console's browser GPS hijack the unit's
// position any time the officer's phone briefly slept. The 5-minute
// floor outlasts ordinary suspension cycles while still allowing
// graceful fallback if the phone genuinely dies.
const GPS_DOMINANCE_WINDOW_SEC: Record<string, number> = {
  owntracks: 300,    // 5 min — OwnTracks is dominant; nothing displaces it for 5 min
  traccar: 300,      // 5 min — same treatment for the other background tracker
  clearpathgps: 120, // 2 min — vehicle tracker is fairly reliable, slightly shorter window
};
// Default for sources not in the map above (browser, offline_desktop, etc).
const GPS_STALE_MS = 30_000;
const GPS_STALE_SEC = Math.floor(GPS_STALE_MS / 1000);

/**
 * Atomically update a unit's live GPS position if — and only if — the
 * incoming source out-ranks (or ties) the stored source, OR the stored
 * source has been silent longer than its dominance window. Runs as a
 * single UPDATE statement so two concurrent writers cannot both pass a
 * TOCTOU check and clobber each other: the gate runs under the same
 * row lock as the write.
 *
 * Dominance windows protect high-priority sources (OwnTracks, Traccar)
 * from being briefly displaced by lower-priority browser sources during
 * normal iOS background-suspension cycles. See GPS_DOMINANCE_WINDOW_SEC.
 *
 * Returns true if the row was updated, false if suppressed by the gate.
 */
function updateUnitGpsIfHigherPriority(
  unitId: number,
  lat: number,
  lng: number,
  source: string,
  nowLocal: string,
): boolean {
  const db = getDb();
  const incomingPriority = GPS_SOURCE_PRIORITY[source] ?? 0;

  // The priority ladder + per-source dominance windows are encoded
  // directly in SQL so the comparison happens atomically with the write.
  // Same-or-higher priority always wins; lower priority only wins when
  // the stored source has been silent past its window.
  const info = db.prepare(`
    UPDATE units
    SET latitude = ?, longitude = ?, gps_source = ?, gps_updated_at = ?
    WHERE id = ?
      AND (
        gps_updated_at IS NULL
        OR COALESCE(CASE gps_source
             WHEN 'owntracks' THEN 5
             WHEN 'traccar' THEN 4
             WHEN 'clearpathgps' THEN 3
             WHEN 'browser_mobile' THEN 2
             WHEN 'browser_desktop' THEN 1
             WHEN 'browser' THEN 1
             WHEN 'offline_desktop' THEN 1
             ELSE 0
           END, 0) <= ?
        OR (strftime('%s','now') - strftime('%s', datetime(gps_updated_at))) >
           CASE gps_source
             WHEN 'owntracks'    THEN 300   -- 5 min dominance
             WHEN 'traccar'      THEN 300   -- 5 min dominance
             WHEN 'clearpathgps' THEN 120   -- 2 min dominance
             ELSE 30                        -- default 30s
           END
      )
  `).run(lat, lng, source, nowLocal, unitId, incomingPriority);
  return Number(info?.changes ?? 0) > 0;
}

// Re-export so other modules can read the dominance windows / priority
// for telemetry, dashboards, etc. without re-deriving them.
export { GPS_SOURCE_PRIORITY, GPS_DOMINANCE_WINDOW_SEC, GPS_STALE_SEC };

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

    // ── GPS Source Priority Check (atomic) ──
    // Determine incoming source: phone GPS > desktop WiFi.
    const allowedDeviceTypes = ['mobile', 'desktop'];
    const rawDeviceType = typeof req.body.device_type === 'string' ? req.body.device_type : 'desktop';
    const deviceType = allowedDeviceTypes.includes(rawDeviceType) ? rawDeviceType : 'desktop';
    const gpsSource = deviceType === 'mobile' ? 'browser_mobile' : 'browser_desktop';

    // Priority check happens inside the UPDATE's WHERE clause so two
    // concurrent writers cannot both pass a read-then-write TOCTOU.
    const shouldUpdateLive = updateUnitGpsIfHigherPriority(
      unit.id, latest.lat, latest.lng, gpsSource, localNow()
    );

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
    // Normalize `recorded_at` to localtime format at write time so downstream
    // reads don't have to cope with the ISO-UTC/localtime mix. `datetime(?, 'localtime')`
    // parses either input form and emits "YYYY-MM-DD HH:MM:SS" consistently.
    const insertStmt = db.prepare(`
      INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number, current_call_id, current_call_number, current_call_type,
        road_name, nearest_intersection, gps_source, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        NULL, NULL, ?,
        COALESCE(datetime(?, 'localtime'), datetime('now','localtime')))
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

      // Dispatcher Brain geofence-breach emitter (Phase 3). Only runs
      // when the unit has an assigned_beat configured; compares the
      // identified beat at the latest GPS position against the
      // expected beat, broadcasts unit_outside_beat with dedup.
      try {
        const assignedBeat: string | null = (updated as any)?.assigned_beat ?? null;
        const callSign: string | null = (updated as any)?.call_sign ?? null;
        if (assignedBeat && callSign) {
          const identified = identifyBeat(latest.lat, latest.lng);
          const actualBeat = identified?.beat_code ?? null;
          const outOfBeat = actualBeat !== assignedBeat;
          if (outOfBeat) {
            const last = lastGeofenceBreachAt.get(callSign) ?? 0;
            if (Date.now() - last >= GEOFENCE_BREACH_CD_MS) {
              lastGeofenceBreachAt.set(callSign, Date.now());
              broadcastDispatchUpdate({
                action: 'unit_outside_beat',
                call_sign: callSign,
                beat: assignedBeat,
                current_beat: actualBeat,
              });
            }
          } else {
            // Back in beat — clear the dedup stamp so a later breach
            // fires immediately rather than waiting out the cooldown.
            lastGeofenceBreachAt.delete(callSign);
          }
        }
      } catch (err: any) {
        // Geofence lookup failures are non-fatal — better to lose a
        // spoken warning than to 500 on a GPS update.
        console.error('[GPS] geofence-breach check failed:', err?.message ?? err);
      }
    }

    // ── Speed violation detection ──
    try {
      const latestSpeedMph = latest.speed != null ? latest.speed * 2.23694 : 0;
      let speedLimitMph = 80;

      // Check if point falls within any active speed zone
      const speedZones = db.prepare('SELECT * FROM speed_zones WHERE is_active = 1').all() as any[];
      for (const zone of speedZones) {
        let zoneCoords: any;
        try {
          zoneCoords = JSON.parse(zone.polygon_coords);
        } catch {
          continue;
        }
        if (!Array.isArray(zoneCoords) || zoneCoords.length < 3) continue;

        // Check active_hours window if defined
        if (zone.active_hours) {
          try {
            const windows = JSON.parse(zone.active_hours) as Array<{ start_hour: number; start_min: number; end_hour: number; end_min: number }>;
            const now = new Date(localNow());
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const inWindow = windows.some((w) => {
              const startMin = w.start_hour * 60 + w.start_min;
              const endMin = w.end_hour * 60 + w.end_min;
              if (startMin <= endMin) {
                return currentMinutes >= startMin && currentMinutes < endMin;
              }
              // Overnight window (e.g. 22:00 - 06:00)
              return currentMinutes >= startMin || currentMinutes < endMin;
            });
            if (!inWindow) continue;
          } catch {
            // If active_hours JSON is invalid, treat zone as always active
          }
        }

        if (pointInPolygon(latest.lat, latest.lng, zoneCoords)) {
          speedLimitMph = Math.min(speedLimitMph, zone.speed_limit_mph);
        }
      }

      if (latestSpeedMph > speedLimitMph) {
        const overageMph = latestSpeedMph - speedLimitMph;
        const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19);

        // Check for an active (unacknowledged) violation for this unit within last 60 seconds
        const existing = db.prepare(`
          SELECT id, speed_mph, overage_mph, duration_seconds, recorded_at
          FROM speed_violations
          WHERE unit_id = ? AND acknowledged_by IS NULL AND recorded_at >= ?
          ORDER BY id DESC LIMIT 1
        `).get(unit.id, sixtySecondsAgo) as any;

        if (existing) {
          // Extend existing violation: update duration and keep max speed values
          const elapsedSec = Math.round((Date.now() - new Date(existing.recorded_at).getTime()) / 1000);
          db.prepare(`
            UPDATE speed_violations
            SET speed_mps = MAX(speed_mps, ?),
                speed_mph = MAX(speed_mph, ?),
                overage_mph = MAX(overage_mph, ?),
                duration_seconds = ?,
                latitude = ?, longitude = ?
            WHERE id = ?
          `).run(
            latest.speed ?? 0, latestSpeedMph, overageMph,
            Math.max(existing.duration_seconds, elapsedSec),
            latest.lat, latest.lng, existing.id,
          );
        } else {
          // Insert new violation
          db.prepare(`
            INSERT INTO speed_violations (
              unit_id, officer_id, call_sign, officer_name, badge_number,
              speed_mps, speed_mph, speed_limit_mph, overage_mph,
              latitude, longitude, current_call_id, current_call_number, recorded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
          `).run(
            unit.id, req.user!.userId,
            updated?.call_sign ?? unit.call_sign,
            updated?.officer_name ?? null,
            updated?.badge_number ?? null,
            latest.speed ?? 0, latestSpeedMph, speedLimitMph, overageMph,
            latest.lat, latest.lng,
            updated?.current_call_id ?? null,
            updated?.call_number ?? null,
          );

          // Broadcast speed violation alert
          broadcastAlert({
            type: 'speed_violation',
            unit: updated?.call_sign ?? unit.call_sign,
            officer_name: updated?.officer_name ?? null,
            badge_number: updated?.badge_number ?? null,
            speed_mph: Math.round(latestSpeedMph),
            speed_limit_mph: speedLimitMph,
            overage_mph: Math.round(overageMph),
            latitude: latest.lat,
            longitude: latest.lng,
          });
        }
      }
    } catch (speedErr) {
      console.error('[GPS] Speed violation check error (non-critical):', speedErr instanceof Error ? speedErr.message : speedErr);
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
    // Cap at 8760h (1 year) to match client-side BREADCRUMB_HOUR_PRESETS.
    // Previously 72h — truncated everything beyond 3 days even when client asked for 7d+.
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 8760);

    // Fix 15: LIMIT on trail queries to prevent huge responses
    // Raised 10K→100K to allow dense OwnTracks trails (1 Hz = ~3600/hr/unit)
    // to survive multi-day ranges. Server-side filters still collapse stationary
    // points, so typical payload stays well under this cap.
    const rows = db.prepare(`
      SELECT latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number,
        current_call_id, current_call_number, current_call_type,
        recorded_at
      FROM gps_breadcrumbs
      WHERE unit_id = ? AND recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY recorded_at ASC
      LIMIT 100000
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
    // Cap at 8760h (1 year) to match client-side BREADCRUMB_HOUR_PRESETS.
    // Previously 72h — silently truncated multi-day preset selections.
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 8760);

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
      LIMIT 500000
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
        accel_mps2: null as number | null,
        is_hard_brake: false,
        is_rapid_accel: false,
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

      // ── Acceleration calculation ──
      if (trailPts.length >= 1 && prev.speed != null && pt.speed != null) {
        const accel = (pt.speed - prev.speed) / dtSec;
        pt.accel_mps2 = Math.round(accel * 100) / 100;
        pt.is_hard_brake = accel < -4;
        pt.is_rapid_accel = accel > 3;
      }

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

// ═══════════════════════════════════════════════════════════════════════
// SPEED VIOLATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/dispatch/gps/speed-violations — List speed violations with filters
router.get('/gps/speed-violations', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 24, 1), 168);
    const officerId = req.query.officer_id ? parseInt(req.query.officer_id as string, 10) : null;
    const unacknowledged = req.query.unacknowledged as string;

    const conditions: string[] = [
      `sv.recorded_at >= datetime('now','localtime','-${hours} hours')`
    ];
    const params: any[] = [];

    if (officerId && !isNaN(officerId)) {
      conditions.push('sv.officer_id = ?');
      params.push(officerId);
    }
    if (unacknowledged === 'true') {
      conditions.push('sv.acknowledged_by IS NULL');
    } else if (unacknowledged === 'false') {
      conditions.push('sv.acknowledged_by IS NOT NULL');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT sv.*, u.full_name as ack_by_name
      FROM speed_violations sv
      LEFT JOIN users u ON sv.acknowledged_by = u.id
      ${whereClause}
      ORDER BY sv.recorded_at DESC
      LIMIT 500
    `).all(...params);

    res.json(rows);
  } catch (error: any) {
    console.error('[GPS] speed-violations error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch speed violations', code: 'GPS_SPEED_VIOLATIONS_ERROR' });
  }
});

// PATCH /api/dispatch/gps/speed-violations/:id/acknowledge — Acknowledge a speed violation
router.patch('/gps/speed-violations/:id/acknowledge', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid violation ID', code: 'INVALID_ID' });
      return;
    }

    const notes = req.body.notes ? String(req.body.notes).slice(0, 500) : null;

    const result = db.prepare(`
      UPDATE speed_violations
      SET acknowledged_by = ?, acknowledged_at = datetime('now','localtime'), notes = COALESCE(?, notes)
      WHERE id = ? AND acknowledged_by IS NULL
    `).run(req.user!.userId, notes, id);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Violation not found or already acknowledged', code: 'NOT_FOUND_OR_ACKNOWLEDGED' });
      return;
    }

    auditLog(req, 'ACKNOWLEDGE', 'speed_violation', id, null, { notes });
    res.json({ ok: true });
  } catch (error: any) {
    console.error('[GPS] speed-violation acknowledge error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to acknowledge speed violation', code: 'GPS_SPEED_ACK_ERROR' });
  }
});

// GET /api/dispatch/gps/speed-stats — Aggregated speed statistics per officer
router.get('/gps/speed-stats', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 168);
    const officerId = req.query.officer_id ? parseInt(req.query.officer_id as string, 10) : null;
    const hoursStr = `-${hours} hours`;

    let officerFilter = '';
    const params: any[] = [hoursStr];
    if (officerId && !isNaN(officerId)) {
      officerFilter = 'AND b.officer_id = ?';
      params.push(officerId);
    }

    // Main aggregate query
    const stats = db.prepare(`
      SELECT
        b.officer_id,
        u.full_name as officer_name,
        u.badge_number,
        un.call_sign,
        COUNT(*) as points_count,
        MAX(b.speed * 2.23694) as max_speed_mph,
        AVG(b.speed * 2.23694) as avg_speed_mph,
        SUM(CASE WHEN b.speed * 2.23694 > 80 THEN 1 ELSE 0 END) as points_over_limit,
        (SELECT COUNT(*) FROM speed_violations sv
         WHERE sv.officer_id = b.officer_id
         AND sv.recorded_at >= datetime('now','localtime', ?)) as violations_count
      FROM gps_breadcrumbs b
      LEFT JOIN users u ON b.officer_id = u.id
      LEFT JOIN units un ON b.unit_id = un.id
      WHERE b.recorded_at >= datetime('now','localtime', ?)
        AND b.speed IS NOT NULL AND b.speed > 0.2
        ${officerFilter}
      GROUP BY b.officer_id
      ORDER BY max_speed_mph DESC
    `).all(hoursStr, ...params);

    // Secondary query for p95 speed per officer
    const result = (stats as any[]).map((s: any) => {
      let p95_speed_mph = null;
      if (s.officer_id && s.points_count > 0) {
        const p95Params: any[] = [hoursStr, s.officer_id];
        const speeds = db.prepare(`
          SELECT speed * 2.23694 as speed_mph
          FROM gps_breadcrumbs
          WHERE recorded_at >= datetime('now','localtime', ?)
            AND officer_id = ?
            AND speed IS NOT NULL AND speed > 0.2
          ORDER BY speed DESC
        `).all(...p95Params) as any[];
        const p95Index = Math.floor(speeds.length * 0.05);
        if (speeds.length > 0) {
          p95_speed_mph = speeds[Math.min(p95Index, speeds.length - 1)].speed_mph;
        }
      }
      return { ...s, p95_speed_mph };
    });

    res.json(result);
  } catch (error: any) {
    console.error('[GPS] speed-stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch speed stats', code: 'GPS_SPEED_STATS_ERROR' });
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

    // ── Auth: accept Bearer token, HTTP Basic Auth (OwnTracks default),
    //         or ?token= query string (simpler OwnTracks setup) ──
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
    } else if (typeof req.query.token === 'string' && req.query.token.length > 0) {
      // Query-string auth — easier to configure in OwnTracks (just append
      // ?token=xxx to the URL instead of setting username/password).
      token = req.query.token;
    } else if (typeof req.headers['x-limit-u'] === 'string' && typeof req.headers['x-limit-d'] === 'string') {
      // OwnTracks-mode quirk: in HTTP mode without Basic auth, OT may send
      // X-Limit-U (user) and X-Limit-D (device) headers. We don't trust
      // these as auth alone — but if a token query is also present, accept.
      // (Falls through; left as no-op if no token is also present.)
    }
    if (!token) {
      res.status(401).json({
        error: 'Authentication required',
        hint: 'Set Basic auth in OwnTracks (password = webhook token), use a Bearer header, or append ?token=YOUR_TOKEN to the URL. Get the token from Admin \u2192 Integrations \u2192 OwnTracks.',
      });
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
      // Auto-register as a pending device. The phone will keep posting;
      // each post bumps seen_count + last_seen_at so admins can see
      // which devices are live. Breadcrumbs are NOT stored until an
      // admin claims the device (see /api/admin/owntracks-pending).
      // This turns first-boot setup from "edit SQL" to "click once".
      try {
        db.prepare(`
          INSERT INTO owntracks_pending_devices
            (tracker_id, last_lat, last_lng, last_payload, seen_count)
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT(tracker_id) DO UPDATE SET
            last_lat      = excluded.last_lat,
            last_lng      = excluded.last_lng,
            last_payload  = excluded.last_payload,
            last_seen_at  = datetime('now','localtime'),
            seen_count    = seen_count + 1
        `).run(trackerId, lat, lng, JSON.stringify(body).slice(0, 1000));
      } catch (e: any) {
        console.error('[GPS] pending device register failed:', e?.message || e);
      }
      // 202 Accepted — phone treats 2xx as success and keeps posting.
      // Body is the empty array OwnTracks expects so it doesn't log an error.
      res.status(202).json([]);
      return;
    }

    const now = localNow();
    const gpsSource = source;

    // Priority check happens inside the UPDATE's WHERE clause — atomic.
    const shouldUpdateLive = updateUnitGpsIfHigherPriority(unit.id, lat, lng, gpsSource, now);

    // Fetch full unit for broadcast
    const updated = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number
      FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.id = ?
    `).get(unit.id) as any;

    // Insert breadcrumb — normalize recorded_at to localtime format at write time.
    // See matching comment in the browser-GPS insert above.
    db.prepare(`
      INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number, gps_source, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(datetime(?, 'localtime'), datetime('now','localtime')))
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

// Rate limit OwnTracks GPS webhook.
// Key by :user/:device URL params when present so each officer's phone has
// its own bucket — critical when multiple officers share a corporate NAT/VPN
// egress IP (naive IP keying would let one noisy device starve the rest).
// Fall back to IP (IPv6 /64-masked via ipKeyGenerator) for the bare /owntracks
// path with no params. 300/min = 5 req/sec per device, generous for tactical
// pursuit streams while still catching runaway devices.
const owntracksWebhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,            // 5 req/sec per device
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const user = typeof req.params.user === 'string' ? req.params.user : '';
    const device = typeof req.params.device === 'string' ? req.params.device : '';
    if (user || device) return `owntracks:device:${user}/${device}`;
    return `owntracks:ip:${ipKeyGenerator(req.ip || '')}`;
  },
  message: { error: 'Too many OwnTracks webhook requests, please try again later.' },
});

owntracksWebhookRouter.post('/owntracks', owntracksWebhookLimiter, owntracksHandler);
owntracksWebhookRouter.post('/owntracks/:user', owntracksWebhookLimiter, owntracksHandler);
owntracksWebhookRouter.post('/owntracks/:user/:device', owntracksWebhookLimiter, owntracksHandler);
owntracksWebhookRouter.post('/', owntracksWebhookLimiter, owntracksHandler);                    // /owntracks (mounted at /owntracks)
owntracksWebhookRouter.post('/:user', owntracksWebhookLimiter, owntracksHandler);               // /owntracks/:user
owntracksWebhookRouter.post('/:user/:device', owntracksWebhookLimiter, owntracksHandler);       // /owntracks/:user/:device
// ═══════════════════════════════════════════════════════════════════════
// SPEED ZONES CRUD
// ═══════════════════════════════════════════════════════════════════════

// GET /api/dispatch/gps/speed-zones — List all speed zones
router.get('/gps/speed-zones', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM speed_zones ORDER BY name').all();
    res.json(rows);
  } catch (error: any) {
    console.error('[GPS] speed-zones list error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch speed zones', code: 'GPS_SPEED_ZONES_ERROR' });
  }
});

// POST /api/dispatch/gps/speed-zones — Create a new speed zone
router.post('/gps/speed-zones', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, speed_limit_mph, polygon_coords, zone_type, active_hours } = req.body;

    if (!name || speed_limit_mph == null || !polygon_coords) {
      res.status(400).json({ error: 'name, speed_limit_mph, and polygon_coords are required', code: 'MISSING_FIELDS' });
      return;
    }

    // Validate polygon_coords is a valid JSON array with >= 3 points
    let coords: any[];
    try {
      coords = typeof polygon_coords === 'string' ? JSON.parse(polygon_coords) : polygon_coords;
      if (!Array.isArray(coords) || coords.length < 3) {
        res.status(400).json({ error: 'polygon_coords must be an array with at least 3 points', code: 'INVALID_POLYGON' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'polygon_coords must be valid JSON', code: 'INVALID_JSON' });
      return;
    }

    const coordsStr = typeof polygon_coords === 'string' ? polygon_coords : JSON.stringify(polygon_coords);

    const result = db.prepare(`
      INSERT INTO speed_zones (name, speed_limit_mph, polygon_coords, zone_type, active_hours, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      String(name),
      Number(speed_limit_mph),
      coordsStr,
      zone_type ? String(zone_type) : 'custom',
      active_hours ? String(active_hours) : null,
      req.user!.userId
    );

    auditLog(req, 'CREATE', 'speed_zone', Number(result.lastInsertRowid), null, { name, speed_limit_mph });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('[GPS] speed-zones create error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to create speed zone', code: 'GPS_SPEED_ZONE_CREATE_ERROR' });
  }
});

// PUT /api/dispatch/gps/speed-zones/:id — Update a speed zone
router.put('/gps/speed-zones/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid zone ID', code: 'INVALID_ID' });
      return;
    }

    const { name, speed_limit_mph, polygon_coords, zone_type, active_hours, is_active } = req.body;

    // Build dynamic SET clause for partial update
    const sets: string[] = [];
    const params: any[] = [];

    if (name !== undefined) { sets.push('name = ?'); params.push(String(name)); }
    if (speed_limit_mph !== undefined) { sets.push('speed_limit_mph = ?'); params.push(Number(speed_limit_mph)); }
    if (polygon_coords !== undefined) {
      // Validate polygon_coords
      let coords: any[];
      try {
        coords = typeof polygon_coords === 'string' ? JSON.parse(polygon_coords) : polygon_coords;
        if (!Array.isArray(coords) || coords.length < 3) {
          res.status(400).json({ error: 'polygon_coords must be an array with at least 3 points', code: 'INVALID_POLYGON' });
          return;
        }
      } catch {
        res.status(400).json({ error: 'polygon_coords must be valid JSON', code: 'INVALID_JSON' });
        return;
      }
      sets.push('polygon_coords = ?');
      params.push(typeof polygon_coords === 'string' ? polygon_coords : JSON.stringify(polygon_coords));
    }
    if (zone_type !== undefined) { sets.push('zone_type = ?'); params.push(String(zone_type)); }
    if (active_hours !== undefined) { sets.push('active_hours = ?'); params.push(active_hours ? String(active_hours) : null); }
    if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0); }

    if (sets.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS' });
      return;
    }

    params.push(id);
    const result = db.prepare(`UPDATE speed_zones SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Speed zone not found', code: 'NOT_FOUND' });
      return;
    }

    auditLog(req, 'UPDATE', 'speed_zone', id, null, { fields: Object.keys(req.body) });
    res.json({ ok: true });
  } catch (error: any) {
    console.error('[GPS] speed-zones update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update speed zone', code: 'GPS_SPEED_ZONE_UPDATE_ERROR' });
  }
});

// DELETE /api/dispatch/gps/speed-zones/:id — Delete a speed zone (admin only)
router.delete('/gps/speed-zones/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid zone ID', code: 'INVALID_ID' });
      return;
    }

    const result = db.prepare('DELETE FROM speed_zones WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Speed zone not found', code: 'NOT_FOUND' });
      return;
    }

    auditLog(req, 'DELETE', 'speed_zone', id, null, null);
    res.json({ ok: true });
  } catch (error: any) {
    console.error('[GPS] speed-zones delete error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to delete speed zone', code: 'GPS_SPEED_ZONE_DELETE_ERROR' });
  }
});

// GET /api/dispatch/gps/pursuit-segments — Auto-detect high-speed pursuit sequences
// Scans breadcrumbs for consecutive points where speed >= 60 mph (26.8 m/s).
// Groups them into segments per unit with distance, duration, and speed stats.
router.get('/gps/pursuit-segments', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 72);
    const unitIdFilter = req.query.unit_id ? parseInt(req.query.unit_id as string, 10) : null;

    const PURSUIT_SPEED_MPS = 26.8; // ~60 mph
    const MIN_POINTS = 3;

    // Haversine distance in meters
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

    let query = `
      SELECT unit_id, call_sign, latitude, longitude, speed, heading, recorded_at
      FROM gps_breadcrumbs
      WHERE recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND speed IS NOT NULL AND speed > 0
    `;
    const params: any[] = [hours];

    if (unitIdFilter != null && !isNaN(unitIdFilter)) {
      query += ' AND unit_id = ?';
      params.push(unitIdFilter);
    }

    query += ' ORDER BY unit_id, recorded_at ASC LIMIT 50000';

    const rows = db.prepare(query).all(...params) as any[];

    // Group by unit
    const byUnit: Record<number, any[]> = {};
    for (const row of rows) {
      if (!byUnit[row.unit_id]) byUnit[row.unit_id] = [];
      byUnit[row.unit_id].push(row);
    }

    const segments: any[] = [];

    for (const [unitIdStr, points] of Object.entries(byUnit)) {
      const unitId = parseInt(unitIdStr, 10);
      let currentSegment: any[] = [];

      const flushSegment = () => {
        if (currentSegment.length >= MIN_POINTS) {
          let totalDistM = 0;
          let maxSpeed = 0;
          let speedSum = 0;

          for (let i = 0; i < currentSegment.length; i++) {
            const p = currentSegment[i];
            const speedMps = p.speed || 0;
            if (speedMps > maxSpeed) maxSpeed = speedMps;
            speedSum += speedMps;
            if (i > 0) {
              const prev = currentSegment[i - 1];
              totalDistM += haversineM(prev.latitude, prev.longitude, p.latitude, p.longitude);
            }
          }

          segments.push({
            unit_id: unitId,
            call_sign: currentSegment[0].call_sign,
            start_time: currentSegment[0].recorded_at,
            end_time: currentSegment[currentSegment.length - 1].recorded_at,
            point_count: currentSegment.length,
            max_speed_mph: Math.round(maxSpeed * 2.23694 * 10) / 10,
            avg_speed_mph: Math.round((speedSum / currentSegment.length) * 2.23694 * 10) / 10,
            distance_miles: Math.round((totalDistM / 1609.344) * 100) / 100,
            points: currentSegment.map(p => ({
              lat: p.latitude,
              lng: p.longitude,
              speed: p.speed,
              heading: p.heading,
              time: p.recorded_at,
            })),
          });
        }
        currentSegment = [];
      };

      for (const pt of points) {
        if (pt.speed >= PURSUIT_SPEED_MPS) {
          currentSegment.push(pt);
        } else {
          flushSegment();
        }
      }
      // Flush any trailing segment
      flushSegment();
    }

    res.set('Cache-Control', 'private, max-age=10');
    res.json(segments);
  } catch (error: any) {
    console.error('[GPS] pursuit-segments error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to detect pursuit segments', code: 'GPS_PURSUIT_SEGMENTS_ERROR' });
  }
});

// GET /api/dispatch/gps/speed-heatmap — Grid-based speed aggregation for heatmap rendering
// Groups breadcrumbs into lat/lng grid cells and returns average/max speed per cell.
router.get('/gps/speed-heatmap', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 72);
    const gridSize = Math.min(Math.max(parseFloat(req.query.grid_size as string) || 0.002, 0.0005), 0.01);

    const rows = db.prepare(`
      SELECT
        ROUND(latitude / ? ) * ? AS grid_lat,
        ROUND(longitude / ?) * ? AS grid_lng,
        AVG(speed * 2.23694) AS avg_speed,
        MAX(speed * 2.23694) AS max_speed,
        COUNT(*) AS point_count
      FROM gps_breadcrumbs
      WHERE recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND speed IS NOT NULL AND speed > 0.2
      GROUP BY grid_lat, grid_lng
      HAVING point_count >= 3
      ORDER BY avg_speed DESC
      LIMIT 5000
    `).all(gridSize, gridSize, gridSize, gridSize, hours) as any[];

    const result = rows.map(r => ({
      grid_lat: r.grid_lat,
      grid_lng: r.grid_lng,
      avg_speed: Math.round(r.avg_speed * 10) / 10,
      max_speed: Math.round(r.max_speed * 10) / 10,
      point_count: r.point_count,
    }));

    res.set('Cache-Control', 'private, max-age=30');
    res.json(result);
  } catch (error: any) {
    console.error('[GPS] speed-heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to generate speed heatmap', code: 'GPS_SPEED_HEATMAP_ERROR' });
  }
});

// GET /api/dispatch/gps/zone-speed-stats — Speed statistics per dispatch beat
// Classifies breadcrumbs into dispatch beats using point-in-polygon and aggregates speed stats.
router.get('/gps/zone-speed-stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 72);

    // Load beats with polygon data, joined with zone and sector names
    const beats = db.prepare(`
      SELECT b.id AS beat_id, b.name AS beat_name, b.code AS beat_code,
             b.polygon_coords,
             z.name AS zone_name, s.name AS sector_name
      FROM dispatch_beats b
      LEFT JOIN dispatch_zones z ON b.zone_id = z.id
      LEFT JOIN dispatch_sectors s ON z.sector_id = s.id
      WHERE b.polygon_coords IS NOT NULL AND b.polygon_coords != ''
    `).all() as any[];

    // Parse polygon coords for each beat
    const beatPolygons: { beat: any; polygon: { lat: number; lng: number }[] }[] = [];
    for (const beat of beats) {
      try {
        const coords = JSON.parse(beat.polygon_coords);
        if (Array.isArray(coords) && coords.length >= 3) {
          beatPolygons.push({ beat, polygon: coords });
        }
      } catch { /* skip beats with invalid polygon data */ }
    }

    // Fetch breadcrumbs
    const breadcrumbs = db.prepare(`
      SELECT latitude, longitude, speed
      FROM gps_breadcrumbs
      WHERE recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND speed IS NOT NULL AND speed > 0.2
      ORDER BY recorded_at DESC
      LIMIT 50000
    `).all(hours) as any[];

    // Classify each breadcrumb into a beat and aggregate
    const beatStats: Record<number, { speeds: number[]; beat: any }> = {};

    for (const bc of breadcrumbs) {
      for (const { beat, polygon } of beatPolygons) {
        if (pointInPolygon(bc.latitude, bc.longitude, polygon)) {
          if (!beatStats[beat.beat_id]) {
            beatStats[beat.beat_id] = { speeds: [], beat };
          }
          beatStats[beat.beat_id].speeds.push(bc.speed * 2.23694); // m/s -> mph
          break; // point can only be in one beat
        }
      }
    }

    // Calculate stats per beat
    const result = Object.values(beatStats).map(({ speeds, beat }) => {
      speeds.sort((a, b) => a - b);
      const sum = speeds.reduce((s, v) => s + v, 0);
      const p95Idx = Math.min(Math.floor(speeds.length * 0.95), speeds.length - 1);

      return {
        beat_id: beat.beat_id,
        beat_name: beat.beat_name,
        beat_code: beat.beat_code,
        zone_name: beat.zone_name,
        sector_name: beat.sector_name,
        avg_speed_mph: Math.round((sum / speeds.length) * 10) / 10,
        max_speed_mph: Math.round(speeds[speeds.length - 1] * 10) / 10,
        p95_speed_mph: Math.round(speeds[p95Idx] * 10) / 10,
        point_count: speeds.length,
      };
    });

    res.set('Cache-Control', 'private, max-age=30');
    res.json(result);
  } catch (error: any) {
    console.error('[GPS] zone-speed-stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to generate zone speed stats', code: 'GPS_ZONE_SPEED_STATS_ERROR' });
  }
});

// GET /api/dispatch/gps/coverage-timeline — Beat coverage over time intervals
// Shows how many unique units visited each beat per time interval, plus average speed.
router.get('/gps/coverage-timeline', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = Math.min(Math.max(parseInt(req.query.hours as string, 10) || 8, 1), 72);
    const intervalMin = Math.min(Math.max(parseInt(req.query.interval as string, 10) || 30, 10), 120);

    // Load beats with polygon data
    const beats = db.prepare(`
      SELECT b.id AS beat_id, b.name AS beat_name, b.code AS beat_code, b.polygon_coords
      FROM dispatch_beats b
      WHERE b.polygon_coords IS NOT NULL AND b.polygon_coords != ''
    `).all() as any[];

    const beatPolygons: { beatId: number; beatName: string; beatCode: string; polygon: { lat: number; lng: number }[] }[] = [];
    for (const beat of beats) {
      try {
        const coords = JSON.parse(beat.polygon_coords);
        if (Array.isArray(coords) && coords.length >= 3) {
          beatPolygons.push({ beatId: beat.beat_id, beatName: beat.beat_name, beatCode: beat.beat_code, polygon: coords });
        }
      } catch { /* skip */ }
    }

    // Fetch breadcrumbs with unit_id and timestamp
    const breadcrumbs = db.prepare(`
      SELECT unit_id, latitude, longitude, speed, recorded_at
      FROM gps_breadcrumbs
      WHERE recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY recorded_at ASC
      LIMIT 50000
    `).all(hours) as any[];

    // Build time intervals
    const now = new Date();
    const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const intervalMs = intervalMin * 60 * 1000;
    const intervals: { start: string; end: string; beats: Record<number, { unit_ids: Set<number>; speeds: number[] }> }[] = [];

    for (let t = startTime.getTime(); t < now.getTime(); t += intervalMs) {
      intervals.push({
        start: new Date(t).toISOString(),
        end: new Date(t + intervalMs).toISOString(),
        beats: {},
      });
    }

    // Classify each breadcrumb into an interval and beat
    for (const bc of breadcrumbs) {
      const bcTime = new Date(bc.recorded_at).getTime();
      const intervalIdx = Math.floor((bcTime - startTime.getTime()) / intervalMs);
      if (intervalIdx < 0 || intervalIdx >= intervals.length) continue;

      const interval = intervals[intervalIdx];

      for (const { beatId, polygon } of beatPolygons) {
        if (pointInPolygon(bc.latitude, bc.longitude, polygon)) {
          if (!interval.beats[beatId]) {
            interval.beats[beatId] = { unit_ids: new Set(), speeds: [] };
          }
          interval.beats[beatId].unit_ids.add(bc.unit_id);
          if (bc.speed != null && bc.speed > 0.2) {
            interval.beats[beatId].speeds.push(bc.speed * 2.23694);
          }
          break;
        }
      }
    }

    // Format response
    const result = intervals.map(interval => ({
      start: interval.start,
      end: interval.end,
      beats: Object.entries(interval.beats).map(([beatIdStr, data]) => {
        const beatId = parseInt(beatIdStr, 10);
        const beatInfo = beatPolygons.find(b => b.beatId === beatId);
        const avgSpeed = data.speeds.length > 0
          ? Math.round((data.speeds.reduce((s, v) => s + v, 0) / data.speeds.length) * 10) / 10
          : 0;
        return {
          beat_id: beatId,
          beat_name: beatInfo?.beatName || '',
          beat_code: beatInfo?.beatCode || '',
          unique_units: data.unit_ids.size,
          avg_speed_mph: avgSpeed,
        };
      }),
    }));

    res.set('Cache-Control', 'private, max-age=60');
    res.json({ intervals: result, total_beats: beatPolygons.length });
  } catch (error: any) {
    console.error('[GPS] coverage-timeline error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to generate coverage timeline', code: 'GPS_COVERAGE_TIMELINE_ERROR' });
  }
});

export default router;
