// ============================================================
// RMPG Flex — Map Safety Analysis Endpoints
// ============================================================
// Officer safety analysis for the CAD/RMS map system.
// Provides threat assessments, approach routes, corridor analysis,
// unit exposure tracking, perimeter checks, and more.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { broadcast, broadcastAlert } from '../utils/websocket';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

// Fix 23: Input validation helpers
function validateLatLng(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'lat must be between -90 and 90';
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'lng must be between -180 and 180';
  return null;
}

// Fix 24: Validate callSign format
function isValidCallSign(callSign: string): boolean {
  return typeof callSign === 'string' && callSign.length >= 1 && callSign.length <= 50 && /^[A-Za-z0-9\-_.]+$/.test(callSign);
}

// Fix 29: Structured error response helper
function safetyError(res: Response, status: number, message: string, code: string) {
  res.status(status).json({ error: message, code });
}

// Fix 27: Request timing for performance monitoring
function logSafetyTiming(label: string, startMs: number) {
  const elapsed = Date.now() - startMs;
  if (elapsed > 500) {
    console.warn(`[MapSafety:Perf] ${label} took ${elapsed}ms`);
  }
}

// Fix 28: Simple in-memory cache for safety assessments
const safetyCache = new Map<string, { data: any; expiry: number }>();
const SAFETY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedAssessment(key: string): any | null {
  const entry = safetyCache.get(key);
  if (entry && entry.expiry > Date.now()) return entry.data;
  if (entry) safetyCache.delete(key);
  return null;
}

function setCachedAssessment(key: string, data: any) {
  // Evict old entries if cache grows too large
  if (safetyCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of safetyCache) {
      if (v.expiry < now) safetyCache.delete(k);
    }
  }
  safetyCache.set(key, { data, expiry: Date.now() + SAFETY_CACHE_TTL });
}

// ─── Haversine Distance (meters) ─────────────────────────────
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Point-to-line-segment distance (meters) ─────────────────
function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return haversineMeters(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return haversineMeters(px, py, ax + t * dx, ay + t * dy);
}

// ─── Cardinal direction from point A to point B ──────────────
function cardinalDirection(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  const dLat = toLat - fromLat;
  const dLng = toLng - fromLng;
  const angle = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized < 22.5 || normalized >= 337.5) return 'N';
  if (normalized < 67.5) return 'NE';
  if (normalized < 112.5) return 'E';
  if (normalized < 157.5) return 'SE';
  if (normalized < 202.5) return 'S';
  if (normalized < 247.5) return 'SW';
  if (normalized < 292.5) return 'W';
  return 'NW';
}

// ─── Quadrant for a point relative to center ─────────────────
function quadrant(centerLat: number, centerLng: number, lat: number, lng: number): 'NE' | 'NW' | 'SE' | 'SW' {
  const north = lat >= centerLat;
  const east = lng >= centerLng;
  if (north && east) return 'NE';
  if (north && !east) return 'NW';
  if (!north && east) return 'SE';
  return 'SW';
}

// ─── Solar calculation helpers (Salt Lake City) ──────────────
const SLC_LAT = 40.7608;
const SLC_LNG = -111.8910;

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

function solarTimes(date: Date): { sunrise: Date; sunset: Date } {
  const lat = SLC_LAT;
  const doy = dayOfYear(date);
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  // Approximate solar declination
  const declination = toRad(-23.44 * Math.cos(toRad((360 / 365) * (doy + 10))));
  const latRad = toRad(lat);

  // Hour angle
  const cosHa = (Math.sin(toRad(-0.83)) - Math.sin(latRad) * Math.sin(declination)) /
    (Math.cos(latRad) * Math.cos(declination));
  const ha = toDeg(Math.acos(Math.max(-1, Math.min(1, cosHa))));

  // Solar noon (approximate for Mountain Time UTC-7)
  const solarNoon = 12 - SLC_LNG / 15 + 7; // rough offset
  const sunriseHour = solarNoon - ha / 15;
  const sunsetHour = solarNoon + ha / 15;

  const sunrise = new Date(date);
  sunrise.setHours(Math.floor(sunriseHour), Math.round((sunriseHour % 1) * 60), 0, 0);
  const sunset = new Date(date);
  sunset.setHours(Math.floor(sunsetHour), Math.round((sunsetHour % 1) * 60), 0, 0);

  return { sunrise, sunset };
}

// ─── Bounding box for radius queries ─────────────────────────
function boundingBox(lat: number, lng: number, radiusM: number) {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng,
  };
}

// ─── Mountain Time hour helper ───────────────────────────────
function mountainHour(): { hour: number; dayOfWeek: number } {
  const now = new Date();
  const mt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  return { hour: mt.getHours(), dayOfWeek: mt.getDay() };
}

// ─── Operational roles ───────────────────────────────────────
const OP_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const CMD_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher'] as const;

// ═════════════════════════════════════════════════════════════
// 1. GET /threat-assessment/:lat/:lng
// ═════════════════════════════════════════════════════════════
router.get(
  '/threat-assessment/:lat/:lng',
  requireRole(...OP_ROLES),
  (req: Request, res: Response) => {
    const startMs = Date.now();
    try {
      const db = getDb();
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      // Fix 23: Full coordinate validation
      const coordErr = validateLatLng(lat, lng);
      if (isNaN(lat) || isNaN(lng) || coordErr) {
        safetyError(res, 400, coordErr || 'Invalid coordinates', 'INVALID_COORDS');
        return;
      }

      // Fix 28: Check cache for same location
      const cacheKey = `threat:${lat.toFixed(3)},${lng.toFixed(3)}`;
      const cached = getCachedAssessment(cacheKey);
      if (cached) {
        res.set('X-Cache', 'HIT');
        res.json(cached);
        return;
      }

      let score = 0;
      const factors: string[] = [];
      const recommendations: string[] = [];

      // Bounding box for 500m
      const bb = boundingBox(lat, lng, 500);

      // --- Calls within 500m in last 180 days ---
      // Use SQLite datetime for consistent Mountain Time comparison
      const cutoff180 = db.prepare(`SELECT datetime('now','localtime','-180 days') as v`).get() as any;
      const cutoff90 = db.prepare(`SELECT datetime('now','localtime','-90 days') as v`).get() as any;
      const cutoff180Val = cutoff180?.v;
      const cutoff90Val = cutoff90?.v;

      const nearbyCalls = db.prepare(`
        SELECT latitude, longitude, weapons_involved, domestic_violence, injuries_reported,
               alcohol_involved, drugs_involved, incident_type, created_at
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
          AND created_at >= datetime('now','localtime','-180 days')
      
        LIMIT 1000
      `).all(bb.minLat, bb.maxLat, bb.minLng, bb.maxLng) as any[];

      // Filter to actual 500m radius and separate 90-day window
      let weaponCalls90 = 0;
      let dvCalls = 0;
      let injuryCalls = 0;
      let drugCalls = 0;

      for (const call of nearbyCalls) {
        if (!call.latitude || !call.longitude) continue;
        const dist = haversineMeters(lat, lng, call.latitude, call.longitude);
        if (dist > 500) continue;

        const within90 = call.created_at >= cutoff90Val;

        if (call.weapons_involved && within90) {
          weaponCalls90++;
          score += 8;
        }
        if (call.domestic_violence) {
          dvCalls++;
          score += 5;
        }
        if (call.injuries_reported) {
          injuryCalls++;
          score += 4;
        }
        if (call.drugs_involved) {
          drugCalls++;
          score += 3;
        }
      }

      if (weaponCalls90 > 0) {
        factors.push(`Weapons reported at this location ${weaponCalls90} time(s) in 90 days`);
        recommendations.push(`Weapons reported at this location ${weaponCalls90} time(s) in 90 days — approach with caution`);
      }
      if (dvCalls > 0) {
        factors.push(`${dvCalls} domestic violence call(s) within 500m`);
        recommendations.push('DV history — be prepared for volatile subjects');
      }
      if (injuryCalls > 0) {
        factors.push(`${injuryCalls} call(s) with injuries reported within 500m`);
      }
      if (drugCalls > 0) {
        factors.push(`${drugCalls} drug-related call(s) within 500m`);
        recommendations.push('Drug activity in area — watch for paraphernalia and impaired subjects');
      }

      // --- Active warrants nearby ---
      const warrants = db.prepare(`
        SELECT id, subject_name FROM warrants
        WHERE status = 'active'
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
      
        LIMIT 1000
      `).all(bb.minLat, bb.maxLat, bb.minLng, bb.maxLng) as any[];

      let activeWarrantsNearby = 0;
      for (const w of warrants) {
        if (haversineMeters(lat, lng, w.latitude, w.longitude) <= 500) {
          activeWarrantsNearby++;
          score += 10;
        }
      }
      if (activeWarrantsNearby > 0) {
        factors.push(`${activeWarrantsNearby} active warrant(s) within 500m`);
        recommendations.push(`${activeWarrantsNearby} active warrant(s) within 500m — verify subjects on scene`);
      }

      // --- Prior officer-involved incidents (within 365 days) ---
      const officerIncidents = db.prepare(`
        SELECT COUNT(*) as cnt FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
          AND created_at >= datetime('now','localtime','-365 days')
          AND (incident_type LIKE '%officer%assault%' OR incident_type LIKE '%assault%officer%'
               OR incident_type LIKE '%resist%' OR incident_type LIKE '%obstruct%')
      `).get(bb.minLat, bb.maxLat, bb.minLng, bb.maxLng) as any;

      const officerAssaults = officerIncidents?.cnt || 0;
      if (officerAssaults > 0) {
        score += officerAssaults * 15;
        factors.push(`${officerAssaults} prior officer assault/resistance incident(s) at this location`);
        recommendations.push('History of officer assault at location — request backup before contact');
      }

      // --- Time of day ---
      const { hour, dayOfWeek } = mountainHour();
      if (hour >= 22 || hour < 6) {
        score += 10;
        factors.push('Nighttime hours (22:00-06:00)');
        recommendations.push('High-crime time window — maintain situational awareness');
      }
      if ((dayOfWeek === 5 && hour >= 18) || (dayOfWeek === 6) || (dayOfWeek === 0 && hour < 6)) {
        score += 5;
        factors.push('Weekend night period');
      }

      // Cap score at 100
      score = Math.min(score, 100);

      let threat_level: 'low' | 'moderate' | 'high' | 'critical';
      if (score <= 25) threat_level = 'low';
      else if (score <= 50) threat_level = 'moderate';
      else if (score <= 75) threat_level = 'high';
      else threat_level = 'critical';

      if (recommendations.length === 0) {
        recommendations.push('No significant safety concerns identified for this location');
      }

      const result = { threat_level, score, factors, recommendations };
      // Fix 28: Cache the assessment
      setCachedAssessment(cacheKey, result);
      // Fix 36: Audit logging on safety data reads
      auditLog(req, 'safety_read', 'threat_assessment', 0, `Threat assessment at ${lat.toFixed(4)},${lng.toFixed(4)}: ${threat_level} (${score})`);
      logSafetyTiming('threat-assessment', startMs);
      res.json(result);
    } catch (err: any) {
      console.error('Threat assessment error:', err);
      // Fix 26: Proper error messages
      safetyError(res, 500, 'Failed to compute threat assessment', 'THREAT_ASSESSMENT_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 2. GET /approach-routes/:lat/:lng
// ═════════════════════════════════════════════════════════════
router.get(
  '/approach-routes/:lat/:lng',
  requireRole(...OP_ROLES),
  (req: Request, res: Response) => {
    const startMs = Date.now();
    try {
      const db = getDb();
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      // Fix 23: Full coordinate validation
      const coordErr = validateLatLng(lat, lng);
      if (isNaN(lat) || isNaN(lng) || coordErr) {
        safetyError(res, 400, coordErr || 'Invalid coordinates', 'INVALID_COORDS');
        return;
      }

      const bb = boundingBox(lat, lng, 200);

      // Find cross streets from nearby calls
      const crossStreets = db.prepare(`
        SELECT DISTINCT cross_street, latitude, longitude, incident_type,
               weapons_involved, domestic_violence
        FROM calls_for_service
        WHERE cross_street IS NOT NULL AND cross_street != ''
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
        ORDER BY created_at DESC
        LIMIT 20
      `).all(bb.minLat, bb.maxLat, bb.minLng, bb.maxLng) as any[];

      // Find flagged persons nearby — use bounding box from nearby calls to limit scope
      const nearbyPersons = db.prepare(`
        SELECT DISTINCT p.id, p.first_name, p.last_name, p.caution_flags
        FROM persons p
        JOIN call_persons cp ON cp.person_id = p.id
        JOIN calls_for_service c ON c.id = cp.call_id
        WHERE p.caution_flags IS NOT NULL AND p.caution_flags != ''
          AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
          AND c.latitude BETWEEN ? AND ?
          AND c.longitude BETWEEN ? AND ?
        LIMIT 50
      `).all(bb.minLat, bb.maxLat, bb.minLng, bb.maxLng) as any[];

      // Aggregate threat direction — where did the most dangerous calls come from?
      const bbWide = boundingBox(lat, lng, 500);
      const dangerousCalls = db.prepare(`
        SELECT latitude, longitude FROM calls_for_service
        WHERE ((weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' AND weapons_involved != 'None') OR domestic_violence = 1 OR injuries_reported = 1)
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
      
        LIMIT 1000
      `).all(bbWide.minLat, bbWide.maxLat, bbWide.minLng, bbWide.maxLng) as any[];

      // Compute threat centroid
      const directionCounts: Record<string, number> = {};
      for (const c of dangerousCalls) {
        const dist = haversineMeters(lat, lng, c.latitude, c.longitude);
        if (dist > 500 || dist < 10) continue;
        const dir = cardinalDirection(lat, lng, c.latitude, c.longitude);
        directionCounts[dir] = (directionCounts[dir] || 0) + 1;
      }

      // Build approaches — recommend approaching from opposite of threat direction
      const directions = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'] as const;
      const opposites: Record<string, string> = {
        N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', NW: 'SE', SE: 'NW', SW: 'NE',
      };

      const approaches = directions.map((dir) => {
        const risk_notes: string[] = [];
        const threatFromDir = directionCounts[dir] || 0;
        if (threatFromDir > 0) {
          risk_notes.push(`${threatFromDir} dangerous call(s) reported to the ${dir}`);
        }

        // Find cross streets in this direction
        const streetsInDir = crossStreets.filter((cs: any) => {
          return cardinalDirection(lat, lng, cs.latitude, cs.longitude) === dir;
        });
        const cross_street = streetsInDir.length > 0 ? streetsInDir[0].cross_street : '';

        return { direction: dir, cross_street, risk_notes };
      });

      // Sort: least risky approach first
      approaches.sort((a, b) => a.risk_notes.length - b.risk_notes.length);

      // Nearby hazards
      const nearby_hazards: string[] = [];
      for (const p of nearbyPersons) {
        if (p.caution_flags) {
          nearby_hazards.push(`Flagged person: ${p.first_name} ${p.last_name} — ${p.caution_flags}`);
        }
      }

      logSafetyTiming('approach-routes', startMs);
      res.json({ approaches, nearby_hazards: nearby_hazards.slice(0, 10) });
    } catch (err: any) {
      console.error('Approach routes error:', err);
      safetyError(res, 500, 'Failed to compute approach routes', 'APPROACH_ROUTES_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 3. GET /corridor-analysis
// ═════════════════════════════════════════════════════════════
router.get(
  '/corridor-analysis',
  requireRole(...OP_ROLES),
  (req: Request, res: Response) => {
    const startMs = Date.now();
    try {
      const db = getDb();
      const lat1 = parseFloat(req.query.lat1 as string);
      const lng1 = parseFloat(req.query.lng1 as string);
      const lat2 = parseFloat(req.query.lat2 as string);
      const lng2 = parseFloat(req.query.lng2 as string);

      if ([lat1, lng1, lat2, lng2].some(isNaN)) {
        safetyError(res, 400, 'Invalid coordinates — provide lat1, lng1, lat2, lng2', 'MISSING_COORDS');
        return;
      }
      // Fix 23: Validate all coordinate ranges
      const err1 = validateLatLng(lat1, lng1);
      const err2 = validateLatLng(lat2, lng2);
      if (err1 || err2) {
        safetyError(res, 400, err1 || err2 || 'Invalid coordinates', 'INVALID_COORDS');
        return;
      }
      // Fix 30: Haversine distance capping — skip if corridor > 50km
      const corridorDist = haversineMeters(lat1, lng1, lat2, lng2);
      if (corridorDist > 50_000) {
        safetyError(res, 400, 'Corridor too long (max 50km)', 'CORRIDOR_TOO_LONG');
        return;
      }

      const cutoff90 = new Date(Date.now() - 90 * 86_400_000).toISOString();

      // Bounding box that covers the entire corridor + 300m buffer
      const allLats = [lat1, lat2];
      const allLngs = [lng1, lng2];
      const bbCorr = {
        minLat: Math.min(...allLats) - 300 / 111_320,
        maxLat: Math.max(...allLats) + 300 / 111_320,
        minLng: Math.min(...allLngs) - 300 / (111_320 * Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180)),
        maxLng: Math.max(...allLngs) + 300 / (111_320 * Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180)),
      };

      const calls = db.prepare(`
        SELECT latitude, longitude, incident_type, priority, weapons_involved,
               domestic_violence, injuries_reported
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
          AND created_at >= ?
      
        LIMIT 1000
      `).all(bbCorr.minLat, bbCorr.maxLat, bbCorr.minLng, bbCorr.maxLng, cutoff90) as any[];

      // Break corridor into ~10 segments
      const SEGMENT_COUNT = 10;
      const segments: any[] = [];
      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const t0 = i / SEGMENT_COUNT;
        const t1 = (i + 1) / SEGMENT_COUNT;
        const sLat = lat1 + (lat2 - lat1) * t0;
        const sLng = lng1 + (lng2 - lng1) * t0;
        const eLat = lat1 + (lat2 - lat1) * t1;
        const eLng = lng1 + (lng2 - lng1) * t1;

        const segCalls: any[] = [];
        for (const call of calls) {
          const dist = pointToSegmentDistance(call.latitude, call.longitude, sLat, sLng, eLat, eLng);
          if (dist <= 300) segCalls.push(call);
        }

        // Top incident types
        const typeCounts: Record<string, number> = {};
        for (const c of segCalls) {
          const t = c.incident_type || 'Unknown';
          typeCounts[t] = (typeCounts[t] || 0) + 1;
        }
        const top_incident_types = Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([type]) => type);

        // Risk score for segment
        let risk_score = 0;
        for (const c of segCalls) {
          risk_score += c.weapons_involved ? 8 : 0;
          risk_score += c.domestic_violence ? 5 : 0;
          risk_score += c.injuries_reported ? 4 : 0;
          risk_score += (c.priority === '1' || c.priority === 1) ? 3 : 0;
        }

        segments.push({
          start_lat: sLat,
          start_lng: sLng,
          end_lat: eLat,
          end_lng: eLng,
          call_count: segCalls.length,
          risk_score: Math.min(risk_score, 100),
          top_incident_types,
        });
      }

      const total_calls = segments.reduce((s, seg) => s + seg.call_count, 0);
      let highest_risk_segment = 0;
      let maxRisk = 0;
      segments.forEach((seg, i) => {
        if (seg.risk_score > maxRisk) {
          maxRisk = seg.risk_score;
          highest_risk_segment = i;
        }
      });

      logSafetyTiming('corridor-analysis', startMs);
      res.json({ segments, total_calls, highest_risk_segment });
    } catch (err: any) {
      console.error('Corridor analysis error:', err);
      safetyError(res, 500, 'Failed to compute corridor analysis', 'CORRIDOR_ANALYSIS_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 4. GET /unit-exposure/:callSign
// ═════════════════════════════════════════════════════════════
router.get(
  '/unit-exposure/:callSign',
  requireRole(...OP_ROLES),
  (req: Request, res: Response) => {
    const startMs = Date.now();
    try {
      const db = getDb();
      const callSign = req.params.callSign;
      // Fix 24: Validate callSign format
      if (!isValidCallSign(callSign)) {
        safetyError(res, 400, 'Invalid call sign format (alphanumeric, hyphens, underscores, 1-50 chars)', 'INVALID_CALL_SIGN');
        return;
      }

      // Look up unit_id for this call_sign to query by indexed column
      const unitRow = db.prepare('SELECT id FROM units WHERE call_sign = ?').get(callSign) as any;
      if (!unitRow) {
        res.json({
          call_sign: callSign,
          high_risk_minutes: 0, moderate_risk_minutes: 0, safe_minutes: 0,
          longest_exposure_minutes: 0, current_zone: 'safe', breadcrumb_count: 0,
        });
        return;
      }

      // Get today's breadcrumbs using recorded_at (actual GPS timestamp) and SQLite localtime
      const breadcrumbs = db.prepare(`
        SELECT latitude, longitude, speed, recorded_at FROM gps_breadcrumbs
        WHERE unit_id = ? AND recorded_at >= datetime('now','localtime','start of day')
        ORDER BY recorded_at ASC
      
        LIMIT 1000
      `).all(unitRow.id) as any[];

      if (breadcrumbs.length === 0) {
        res.json({
          call_sign: callSign,
          high_risk_minutes: 0,
          moderate_risk_minutes: 0,
          safe_minutes: 0,
          longest_exposure_minutes: 0,
          current_zone: 'safe',
          breadcrumb_count: 0,
        });
        return;
      }

      // Fix 25: LIMIT on safety-zone queries
      // Load recent high-risk areas — locations with weapon/DV/injury calls in 90 days
      const dangerousAreas = db.prepare(`
        SELECT latitude, longitude, weapons_involved, domestic_violence, injuries_reported
        FROM calls_for_service
        WHERE ((weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' AND weapons_involved != 'None') OR domestic_violence = 1 OR injuries_reported = 1)
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now','localtime','-90 days')
        LIMIT 5000
      `).all() as any[];

      let highRiskMs = 0;
      let moderateRiskMs = 0;
      let safeMs = 0;
      let longestExposureMs = 0;
      let currentExposureMs = 0;
      let currentZone: 'high' | 'moderate' | 'safe' = 'safe';

      for (let i = 0; i < breadcrumbs.length; i++) {
        const bc = breadcrumbs[i];
        if (!bc.latitude || !bc.longitude) continue;

        // Time delta to next breadcrumb (or 60s if last)
        let deltaMs = 60_000;
        if (i < breadcrumbs.length - 1) {
          const next = new Date(breadcrumbs[i + 1].recorded_at).getTime();
          const curr = new Date(bc.recorded_at).getTime();
          deltaMs = Math.min(next - curr, 300_000); // Cap at 5 min gap
        }

        // Check proximity to dangerous areas
        let zone: 'high' | 'moderate' | 'safe' = 'safe';
        for (const area of dangerousAreas) {
          const dist = haversineMeters(bc.latitude, bc.longitude, area.latitude, area.longitude);
          if (dist <= 200 && area.weapons_involved) { zone = 'high'; break; }
          if (dist <= 300) { zone = zone === 'high' ? 'high' : 'moderate'; }
        }

        if (zone === 'high') {
          highRiskMs += deltaMs;
          currentExposureMs += deltaMs;
        } else if (zone === 'moderate') {
          moderateRiskMs += deltaMs;
          currentExposureMs += deltaMs;
        } else {
          safeMs += deltaMs;
          longestExposureMs = Math.max(longestExposureMs, currentExposureMs);
          currentExposureMs = 0;
        }

        // Track current zone (last breadcrumb)
        if (i === breadcrumbs.length - 1) {
          currentZone = zone;
        }
      }
      longestExposureMs = Math.max(longestExposureMs, currentExposureMs);

      res.json({
        call_sign: callSign,
        high_risk_minutes: Math.round(highRiskMs / 60_000),
        moderate_risk_minutes: Math.round(moderateRiskMs / 60_000),
        safe_minutes: Math.round(safeMs / 60_000),
        longest_exposure_minutes: Math.round(longestExposureMs / 60_000),
        current_zone: currentZone,
        breadcrumb_count: breadcrumbs.length,
      });
      logSafetyTiming('unit-exposure', startMs);
    } catch (err: any) {
      console.error('Unit exposure error:', err);
      safetyError(res, 500, 'Failed to compute unit exposure', 'UNIT_EXPOSURE_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 5. GET /perimeter-check/:lat/:lng
// ═════════════════════════════════════════════════════════════
router.get(
  '/perimeter-check/:lat/:lng',
  requireRole(...OP_ROLES),
  (req: Request, res: Response) => {
    const startMs = Date.now();
    try {
      const db = getDb();
      const lat = parseFloat(req.params.lat);
      const lng = parseFloat(req.params.lng);
      // Fix 23: Full coordinate validation
      const coordErr = validateLatLng(lat, lng);
      if (isNaN(lat) || isNaN(lng) || coordErr) {
        safetyError(res, 400, coordErr || 'Invalid coordinates', 'INVALID_COORDS');
        return;
      }

      // Fix 31: Bounding box pre-filter to optimize perimeter check
      const bb = boundingBox(lat, lng, 10_000); // 10km radius
      // Get active units with GPS, pre-filtered by bounding box
      const units = db.prepare(`
        SELECT id, call_sign, status, latitude, longitude FROM units
        WHERE status NOT IN ('off_duty', 'out_of_service')
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
      
        LIMIT 1000
      `).all(bb.minLat, bb.maxLat, bb.minLng, bb.maxLng) as any[];

      const quadrants: Record<string, { units: number; nearest_distance_m: number; unit_names: string[] }> = {
        NE: { units: 0, nearest_distance_m: Infinity, unit_names: [] },
        NW: { units: 0, nearest_distance_m: Infinity, unit_names: [] },
        SE: { units: 0, nearest_distance_m: Infinity, unit_names: [] },
        SW: { units: 0, nearest_distance_m: Infinity, unit_names: [] },
      };

      let total_units_nearby = 0;

      for (const unit of units) {
        const dist = haversineMeters(lat, lng, unit.latitude, unit.longitude);
        if (dist > 10_000) continue; // Only consider units within 10km

        const q = quadrant(lat, lng, unit.latitude, unit.longitude);
        quadrants[q].units++;
        quadrants[q].unit_names.push(unit.call_sign);
        quadrants[q].nearest_distance_m = Math.min(quadrants[q].nearest_distance_m, Math.round(dist));
        total_units_nearby++;
      }

      // Clean up Infinity
      for (const q of Object.values(quadrants)) {
        if (q.nearest_distance_m === Infinity) q.nearest_distance_m = -1;
      }

      const coverage_gaps: string[] = [];
      for (const [dir, data] of Object.entries(quadrants)) {
        if (data.units === 0) coverage_gaps.push(dir);
      }

      // Recommended staging
      let recommended_staging = 'No coverage gaps detected';
      if (coverage_gaps.length > 0) {
        recommended_staging = `Stage units to cover ${coverage_gaps.join(', ')} quadrant(s)`;
      }

      logSafetyTiming('perimeter-check', startMs);
      res.json({
        quadrants,
        coverage_gaps,
        total_units_nearby,
        recommended_staging,
      });
    } catch (err: any) {
      console.error('Perimeter check error:', err);
      safetyError(res, 500, 'Failed to compute perimeter check', 'PERIMETER_CHECK_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 6. GET /shift-risk-summary
// ═════════════════════════════════════════════════════════════
router.get(
  '/shift-risk-summary',
  requireRole(...OP_ROLES),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { hour } = mountainHour();

      // Determine shift and build SQLite-compatible shift start expression
      let shift_name: string;
      let shiftStartExpr: string;
      if (hour >= 6 && hour < 14) {
        shift_name = 'Day Shift (06:00-14:00)';
        // Today at 06:00 localtime
        shiftStartExpr = `datetime(date('now','localtime') || ' 06:00:00')`;
      } else if (hour >= 14 && hour < 22) {
        shift_name = 'Swing Shift (14:00-22:00)';
        // Today at 14:00 localtime
        shiftStartExpr = `datetime(date('now','localtime') || ' 14:00:00')`;
      } else {
        shift_name = 'Graveyard Shift (22:00-06:00)';
        if (hour < 6) {
          // Yesterday at 22:00 localtime
          shiftStartExpr = `datetime(date('now','localtime','-1 day') || ' 22:00:00')`;
        } else {
          // Today at 22:00 localtime
          shiftStartExpr = `datetime(date('now','localtime') || ' 22:00:00')`;
        }
      }

      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' AND weapons_involved != 'None' THEN 1 ELSE 0 END) as weapon_calls,
          SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_calls,
          SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injury_calls,
          SUM(CASE WHEN drugs_involved = 1 THEN 1 ELSE 0 END) as drug_calls
        FROM calls_for_service
        WHERE created_at >= ${shiftStartExpr}
      `).get() as any;

      const warrantCount = db.prepare(`
        SELECT COUNT(*) as cnt FROM warrants WHERE status = 'active'
      `).get() as any;

      // Check officers currently in risk zones
      const dangerousAreasShift = db.prepare(`
        SELECT latitude, longitude FROM calls_for_service
        WHERE weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' AND weapons_involved != 'None'
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now','localtime','-90 days')
      
        LIMIT 1000
      `).all() as any[];

      const activeUnits = db.prepare(`
        SELECT call_sign, latitude, longitude FROM units
        WHERE status NOT IN ('off_duty', 'out_of_service')
          AND latitude IS NOT NULL AND longitude IS NOT NULL
      
        LIMIT 1000
      `).all() as any[];

      let officers_in_risk_zones = 0;
      for (const unit of activeUnits) {
        for (const area of dangerousAreasShift) {
          if (haversineMeters(unit.latitude, unit.longitude, area.latitude, area.longitude) <= 300) {
            officers_in_risk_zones++;
            break;
          }
        }
      }

      // Trend — compare this shift to average of last 7 days' same-type shifts
      // 7 days * 3 shifts per day = 21 shift periods for proper per-shift average
      const prevStats = db.prepare(`
        SELECT COUNT(*) as cnt FROM calls_for_service
        WHERE ((weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' AND weapons_involved != 'None') OR domestic_violence = 1 OR injuries_reported = 1)
          AND created_at >= datetime('now','localtime','-7 days')
      `).get() as any;

      const currentFlagged = (stats.weapon_calls || 0) + (stats.dv_calls || 0) + (stats.injury_calls || 0);
      const avgPerShift = (prevStats.cnt || 0) / 21;
      let trend: 'increasing' | 'stable' | 'decreasing';
      if (currentFlagged > avgPerShift * 1.3) trend = 'increasing';
      else if (currentFlagged < avgPerShift * 0.7) trend = 'decreasing';
      else trend = 'stable';

      const alerts: string[] = [];
      if (stats.weapon_calls > 0) alerts.push(`${stats.weapon_calls} weapon call(s) this shift`);
      if (officers_in_risk_zones > 0) alerts.push(`${officers_in_risk_zones} officer(s) currently in high-risk zones`);
      if (trend === 'increasing') alerts.push('Flagged calls trending above average');

      res.json({
        shift_name,
        weapon_calls: stats.weapon_calls || 0,
        dv_calls: stats.dv_calls || 0,
        injury_calls: stats.injury_calls || 0,
        drug_calls: stats.drug_calls || 0,
        active_warrants: warrantCount.cnt || 0,
        officers_in_risk_zones,
        trend,
        alerts,
      });
    } catch (err: any) {
      console.error('Shift risk summary error:', err);
      safetyError(res, 500, 'Failed to compute shift risk summary', 'SHIFT_RISK_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 7. POST /safety-alert
// ═════════════════════════════════════════════════════════════
const VALID_ALERT_TYPES = [
  'shots_fired', 'officer_down', 'pursuit', 'hazmat', 'armed_subject',
  'barricaded', 'hostage', 'bomb_threat', 'active_shooter', 'missing_officer',
] as const;

router.post(
  '/safety-alert',
  requireRole(...CMD_ROLES),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { type, lat, lng, details, radius_m } = req.body;

      if (!type || !VALID_ALERT_TYPES.includes(type)) {
        res.status(400).json({ error: `Invalid alert type. Must be one of: ${VALID_ALERT_TYPES.join(', ')}` });
        return;
      }
      if (lat == null || lng == null) {
        res.status(400).json({ error: 'lat and lng are required', code: 'LAT_AND_LNG_ARE' });
        return;
      }
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) ||
          latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
        res.status(400).json({ error: 'lat must be between -90 and 90, lng between -180 and 180', code: 'LAT_MUST_BE_BETWEEN' });
        return;
      }

      // Fix 34: Sanitize alert description text
      const sanitizedDetails = typeof details === 'string'
        ? details.replace(/<[^>]*>/g, '').substring(0, 500)
        : '';
      // Fix 46: Validate alert_radius is reasonable (max 10000m)
      const safeRadius = Math.max(100, Math.min(10000, Number(radius_m) || 500));

      const now = localNow();
      const result = db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user?.userId ?? null,
        'broadcast_sent',
        'safety_alert',
        type, // Use the alert type as entity_id for meaningful identification
        JSON.stringify({ type, lat: latNum, lng: lngNum, details: sanitizedDetails, radius_m: safeRadius }),
        req.ip || 'unknown',
        now,
      );

      const alertData = {
        alert_id: Number(result.lastInsertRowid),
        type,
        lat: latNum,
        lng: lngNum,
        details: sanitizedDetails,
        radius_m: safeRadius,
        issued_by: req.user?.fullName || req.user?.username || 'Unknown',
        created_at: now,
      };

      // Broadcast to all connected clients on the alerts channel
      broadcastAlert(alertData);
      // Also broadcast on dispatch channel for dispatch page
      broadcast('dispatch', 'safety:broadcast', alertData);

      // Fix 35: Return created alert ID in safety-alert response
      // Fix 36: Audit logging
      auditLog(req, 'safety_alert_broadcast', 'safety_alert', Number(result.lastInsertRowid),
        `Safety alert: ${type} at ${latNum.toFixed(4)},${lngNum.toFixed(4)}`);
      res.json({ success: true, alert_id: Number(result.lastInsertRowid), alert: alertData });
    } catch (err: any) {
      console.error('Safety alert error:', err);
      safetyError(res, 500, 'Failed to issue safety alert', 'SAFETY_ALERT_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// DELETE /safety-alert/:id — Remove a safety alert
// ═════════════════════════════════════════════════════════════
router.delete(
  '/safety-alert/:id',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        safetyError(res, 400, 'Invalid alert ID', 'INVALID_ALERT_ID');
        return;
      }
      const result = db.prepare('DELETE FROM activity_log WHERE id = ? AND entity_type = ?').run(id, 'safety_alert');
      if (result.changes === 0) {
        safetyError(res, 404, 'Safety alert not found', 'SAFETY_ALERT_NOT_FOUND');
        return;
      }
      auditLog(req, 'DELETE', 'safety_alert', id, `Deleted safety alert #${id}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error('Delete safety alert error:', err);
      safetyError(res, 500, 'Failed to delete safety alert', 'DELETE_SAFETY_ALERT_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 8. GET /repeat-offender-map
// ═════════════════════════════════════════════════════════════
router.get(
  '/repeat-offender-map',
  requireRole(...OP_ROLES),
  (req: Request, res: Response) => {
    try {
      const db = getDb();

      // Find persons linked to 3+ calls via call_persons or call_subjects
      // Try call_persons first — fall back gracefully if table doesn't exist
      let offenders: any[] = [];

      try {
        offenders = db.prepare(`
          SELECT
            p.id as person_id,
            p.first_name,
            p.last_name,
            p.caution_flags,
            COUNT(cp.call_id) as call_count,
            MAX(c.created_at) as last_incident_date,
            c.latitude as last_lat,
            c.longitude as last_lng
          FROM persons p
          JOIN call_persons cp ON cp.person_id = p.id
          JOIN calls_for_service c ON c.id = cp.call_id
          WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
          GROUP BY p.id
          HAVING call_count >= 3
          ORDER BY call_count DESC
          LIMIT 50
        `).all();
      } catch {
        // call_persons may not exist — try via a broader approach
        // Look for persons with caution flags as a fallback
        offenders = db.prepare(`
          SELECT
            id as person_id,
            first_name,
            last_name,
            caution_flags,
            0 as call_count,
            NULL as last_incident_date,
            NULL as last_lat,
            NULL as last_lng
          FROM persons
          WHERE caution_flags IS NOT NULL AND caution_flags != ''
          ORDER BY id DESC
          LIMIT 50
        `).all();
      }

      const result = offenders.map((o: any) => ({
        person_id: o.person_id,
        name: `${o.first_name || ''} ${o.last_name || ''}`.trim(),
        call_count: o.call_count,
        last_location: o.last_lat && o.last_lng ? { lat: o.last_lat, lng: o.last_lng } : null,
        caution_flags: o.caution_flags ? (typeof o.caution_flags === 'string' ? o.caution_flags.split(',').map((f: string) => f.trim()) : []) : [],
        last_incident_date: o.last_incident_date || null,
      }));

      res.json({ offenders: result });
    } catch (err: any) {
      console.error('Repeat offender map error:', err);
      safetyError(res, 500, 'Failed to query repeat offenders', 'REPEAT_OFFENDER_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 9. GET /lighting-conditions
// ═════════════════════════════════════════════════════════════
router.get(
  '/lighting-conditions',
  requireRole(...OP_ROLES),
  (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const mt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
      const { sunrise, sunset } = solarTimes(mt);

      // Twilight is ~30 minutes before sunrise / after sunset
      const twilightBefore = new Date(sunrise.getTime() - 30 * 60_000);
      const twilightAfter = new Date(sunset.getTime() + 30 * 60_000);

      const nowMs = mt.getTime();
      let condition: 'daylight' | 'twilight' | 'darkness';
      let minutes_to_transition: number;
      let next_transition: string;
      let tactical_note: string;

      if (nowMs >= sunrise.getTime() && nowMs < sunset.getTime()) {
        condition = 'daylight';
        minutes_to_transition = Math.round((sunset.getTime() - nowMs) / 60_000);
        next_transition = 'sunset';
        tactical_note = 'Good visibility — standard patrol operations';
      } else if (nowMs >= twilightBefore.getTime() && nowMs < sunrise.getTime()) {
        condition = 'twilight';
        minutes_to_transition = Math.round((sunrise.getTime() - nowMs) / 60_000);
        next_transition = 'sunrise';
        tactical_note = 'Reduced visibility — use caution in unlit areas, subjects harder to identify';
      } else if (nowMs >= sunset.getTime() && nowMs < twilightAfter.getTime()) {
        condition = 'twilight';
        minutes_to_transition = Math.round((twilightAfter.getTime() - nowMs) / 60_000);
        next_transition = 'twilight_end';
        tactical_note = 'Fading light — transition to night operations, activate spotlights';
      } else {
        condition = 'darkness';
        // Next transition is twilight before tomorrow's sunrise
        const tomorrowSunrise = new Date(sunrise);
        if (nowMs > sunset.getTime()) {
          tomorrowSunrise.setDate(tomorrowSunrise.getDate() + 1);
        }
        const tomorrowTwilight = new Date(tomorrowSunrise.getTime() - 30 * 60_000);
        minutes_to_transition = Math.round((tomorrowTwilight.getTime() - nowMs) / 60_000);
        if (minutes_to_transition < 0) minutes_to_transition += 24 * 60;
        next_transition = 'twilight_start';
        tactical_note = 'Darkness — use flashlights, maintain cover, be aware of ambush potential in unlit areas';
      }

      const formatTime = (d: Date) => {
        const h = d.getHours();
        const m = d.getMinutes();
        const ampm = h >= 12 ? 'PM' : 'AM';
        return `${((h % 12) || 12)}:${String(m).padStart(2, '0')} ${ampm}`;
      };

      res.json({
        condition,
        minutes_to_transition,
        next_transition,
        tactical_note,
        sunrise: formatTime(sunrise),
        sunset: formatTime(sunset),
      });
    } catch (err: any) {
      console.error('Lighting conditions error:', err);
      safetyError(res, 500, 'Failed to compute lighting conditions', 'LIGHTING_ERROR');
    }
  },
);

// ═════════════════════════════════════════════════════════════
// 10. GET /coverage-gaps
// ═════════════════════════════════════════════════════════════
router.get(
  '/coverage-gaps',
  requireRole(...OP_ROLES),
  (_req: Request, res: Response) => {
    try {
      const db = getDb();

      // Salt Lake City jurisdiction bounds
      const LAT_MIN = 40.70;
      const LAT_MAX = 40.82;
      const LNG_MIN = -111.95;
      const LNG_MAX = -111.83;
      const CELL_SIZE = 0.0045; // ~500m in latitude degrees

      // Get active units
      const units = db.prepare(`
        SELECT call_sign, latitude, longitude FROM units
        WHERE status NOT IN ('off_duty', 'out_of_service')
          AND latitude IS NOT NULL AND longitude IS NOT NULL
      
        LIMIT 1000
      `).all() as any[];

      const gaps: any[] = [];
      let total_cells = 0;
      let covered_cells = 0;

      for (let lat = LAT_MIN; lat < LAT_MAX; lat += CELL_SIZE) {
        for (let lng = LNG_MIN; lng < LNG_MAX; lng += CELL_SIZE) {
          total_cells++;
          const cellLat = lat + CELL_SIZE / 2;
          const cellLng = lng + CELL_SIZE / 2;

          let nearestDist = Infinity;
          let nearestUnit = '';

          for (const unit of units) {
            const dist = haversineMeters(cellLat, cellLng, unit.latitude, unit.longitude);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestUnit = unit.call_sign;
            }
          }

          if (nearestDist <= 2000) {
            covered_cells++;
          } else {
            gaps.push({
              lat: Math.round(cellLat * 10000) / 10000,
              lng: Math.round(cellLng * 10000) / 10000,
              nearest_unit_distance_m: nearestDist === Infinity ? -1 : Math.round(nearestDist),
              nearest_unit: nearestUnit || 'none',
            });
          }
        }
      }

      const coverage_percent = total_cells > 0 ? Math.round((covered_cells / total_cells) * 100) : 0;

      res.json({
        gaps: gaps.slice(0, 200), // Limit response size
        coverage_percent,
        total_cells,
        covered_cells,
      });
    } catch (err: any) {
      console.error('Coverage gaps error:', err);
      safetyError(res, 500, 'Failed to compute coverage gaps', 'COVERAGE_GAPS_ERROR');
    }
  },
);

export default router;
