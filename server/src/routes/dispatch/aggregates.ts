import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate, broadcastUnitUpdate, broadcastPanic } from '../../utils/websocket';
import { generateCallNumber } from '../../utils/caseNumbers';
import { localNow } from '../../utils/timeUtils';
import { reverseGeocodeAddress } from '../../utils/geocode';
import { identifyBeat } from '../../utils/geofence';
import { escapeLike } from '../../middleware/sanitize';
import { auditLog } from '../../utils/auditLogger';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// GET /api/dispatch/heatmap - Aggregated call locations for heat map display
// Query params: days (int), mode ('all'|'risk'|'type'), type (incident_type filter)
router.get('/heatmap', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const mode = (req.query.mode as string) || 'all';
    const typeFilter = req.query.type as string | undefined;

    const validModes = ['all', 'risk', 'type'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}` });
      return;
    }

    if (typeFilter && (typeof typeFilter !== 'string' || typeFilter.length > 100)) {
      res.status(400).json({ error: 'Invalid type filter' });
      return;
    }

    const cutoff = `-${days}`;

    if (mode === 'risk') {
      // Risk-weighted: only calls with risk flags, weighted by severity
      const points = db.prepare(`
        SELECT
          ROUND(latitude, 3) as latitude,
          ROUND(longitude, 3) as longitude,
          COUNT(*) as count,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 3 ELSE 0 END
            + CASE WHEN domestic_violence = 1 THEN 2 ELSE 0 END
            + CASE WHEN injuries_reported = 1 THEN 2 ELSE 0 END
            + CASE WHEN alcohol_involved = 1 THEN 1 ELSE 0 END
            + CASE WHEN drugs_involved = 1 THEN 1 ELSE 0 END
          ) as risk_weight,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END) as weapons_count,
          SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_count,
          SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injuries_count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', 'localtime', ? || ' days')
          AND (weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0'
               OR domestic_violence = 1 OR injuries_reported = 1
               OR alcohol_involved = 1 OR drugs_involved = 1)
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY risk_weight DESC
        LIMIT 300
      `).all(cutoff);
      return res.json(points);
    }

    if (mode === 'type' && typeFilter) {
      // Filtered by specific incident type
      const points = db.prepare(`
        SELECT
          ROUND(latitude, 3) as latitude,
          ROUND(longitude, 3) as longitude,
          COUNT(*) as count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', 'localtime', ? || ' days')
          AND incident_type = ?
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY count DESC
        LIMIT 200
      `).all(cutoff, typeFilter);
      return res.json(points);
    }

    // Default: all calls with enriched metadata for click info
    const points = db.prepare(`
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        COUNT(*) as count,
        GROUP_CONCAT(DISTINCT incident_type) as incident_types,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1_count,
        SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END) as weapons_count,
        SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_count,
        SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injuries_count
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', ? || ' days')
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      ORDER BY count DESC
      LIMIT 200
    `).all(cutoff);

    res.json(points);
  } catch (error: any) {
    console.error('[Dispatch] heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/heatmap/types - Available incident types for heatmap filter
router.get('/heatmap/types', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const types = db.prepare(`
      SELECT incident_type, COUNT(*) as count
      FROM calls_for_service
      WHERE incident_type IS NOT NULL AND incident_type != ''
        AND created_at >= datetime('now', 'localtime', '-90 days')
      GROUP BY incident_type
      ORDER BY count DESC
      LIMIT 50
    `).all();
    res.json(types);
  } catch (error: any) {
    console.error('[Dispatch] heatmap types error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get heatmap types' });
  }
});

// GET /api/dispatch/queue - Active dispatch queue
router.get('/queue', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const calls = db.prepare(`
      SELECT c.*, p.name as property_name, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.status IN ('pending', 'dispatched', 'enroute', 'onscene')
      ORDER BY
        CASE c.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END,
        c.created_at ASC
    `).all();

    res.json(calls);
  } catch (error: any) {
    console.error('[Dispatch] get queue error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/stats - Current dispatch statistics
router.get('/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const callsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY status
    `).all();

    const callsByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY priority
    `).all();

    const unitsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM units GROUP BY status
    `).all();

    const activeCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene')
    `).get() as any;

    const todayTotal = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    const avgResponseTime = db.prepare(`
      SELECT AVG(
        (julianday(onscene_at) - julianday(created_at)) * 24 * 60
      ) as avg_minutes
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    res.json({
      activeCalls: activeCalls.count,
      todayTotal: todayTotal.count,
      avgResponseMinutes: avgResponseTime.avg_minutes ? Math.round(avgResponseTime.avg_minutes * 10) / 10 : null,
      callsByStatus,
      callsByPriority,
      unitsByStatus,
    });
  } catch (error: any) {
    console.error('[Dispatch] get stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/panic - Emergency PANIC button
// Broadcasts audible alert to all connected users
router.post('/panic', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { latitude, longitude, message } = req.body;

    // Validate panic input
    if (message !== undefined && message !== null) {
      if (typeof message !== 'string' || message.length > 500) {
        res.status(400).json({ error: 'Message must be a string of 500 characters or less' });
        return;
      }
    }

    const user = db.prepare('SELECT id, full_name, badge_number, role FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const now = localNow();

    // ── Reverse-geocode officer GPS → address (with fallback) ──
    // Must happen BEFORE the transaction since it's async
    let locationAddress = latitude != null && longitude != null && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
      ? `GPS: ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
      : 'Unknown location';

    if (latitude != null && longitude != null) {
      try {
        const addr = await reverseGeocodeAddress(Number(latitude), Number(longitude));
        if (addr) locationAddress = addr;
      } catch { /* keep GPS fallback */ }
    }

    // ── All DB writes in a single transaction for atomicity ──
    const callNumber = generateCallNumber(db);
    const description = `PANIC ALARM — Officer ${user.full_name} (Badge: ${user.badge_number || 'N/A'}) triggered emergency alert.${message ? ' Message: ' + message : ''}`;

    const panicTx = db.transaction(() => {
      // Log the panic alert to activity log
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'panic_alert', 'user', ?, ?, ?)
      `).run(
        user.id,
        user.id,
        `PANIC ALERT triggered by ${user.full_name} (${user.badge_number || 'N/A'})${message ? ': ' + message : ''}`,
        req.ip || 'unknown'
      );

      // Auto-create "Officer Assist — Panic Alarm" dispatch call
      const callResult = db.prepare(`
        INSERT INTO calls_for_service (
          call_number, incident_type, priority, status,
          caller_name, location_address, latitude, longitude,
          description, source, dispatcher_id,
          weapons_involved, created_at, dispatched_at
        ) VALUES (?, 'officer_assist', 'P1', 'dispatched',
          ?, ?, ?, ?,
          ?, 'panic', ?,
          'unknown', ?, ?)
      `).run(
        callNumber,
        user.full_name,
        locationAddress,
        latitude ?? null,
        longitude ?? null,
        description,
        user.id,
        now,
        now,
      );

      const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?')
        .get(callResult.lastInsertRowid) as any;
      if (!call) throw new Error('Failed to retrieve auto-created panic call');

      // Auto-assign officer's unit to the call
      const unit = db.prepare('SELECT id, call_sign FROM units WHERE officer_id = ?')
        .get(user.id) as any;

      if (unit) {
        db.prepare('UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?')
          .run('dispatched', call.id, now, unit.id);

        const unitIds = JSON.stringify([unit.id]);
        db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
          .run(unitIds, call.id);
      }

      // Log call creation
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_created', 'call', ?, ?, ?)
      `).run(user.id, call.id, `PANIC auto-created ${callNumber}: officer_assist`, req.ip || 'unknown');

      return { call, unit };
    });

    const { call, unit } = panicTx();

    // ── Broadcasts happen AFTER transaction commits ──
    if (unit) {
      broadcastUnitUpdate({ action: 'unit_status_changed', unit: { ...unit, status: 'dispatched', current_call_id: call.id } });
    }

    broadcastPanic({
      user_id: user.id,
      user_name: user.full_name,
      badge_number: user.badge_number,
      role: user.role,
      message: message || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      triggered_at: now,
      call_number: callNumber,
      call_id: call.id,
      location_address: locationAddress,
      unit_call_sign: unit?.call_sign || null,
    });

    const enrichedCall = db.prepare(`
      SELECT c.*, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.id = ?
    `).get(call.id);

    broadcastDispatchUpdate({ action: 'call_created', call: enrichedCall || call });

    auditLog(req, 'panic_activated' as any, 'call' as any, call.id, `PANIC alert by ${user.full_name} (${user.badge_number || 'N/A'}) — call ${callNumber} created`);

    res.json({
      success: true,
      message: 'Panic alert sent — dispatch call created',
      call_number: callNumber,
      call_id: call.id,
    });
  } catch (error: any) {
    console.error('[Dispatch] panic alert error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/premise-history - Premise history lookup
// Returns prior calls at or near a given address.
router.get('/premise-history', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { address } = req.query;

    if (!address || typeof address !== 'string' || address.length < 3) {
      res.status(400).json({ error: 'Address must be at least 3 characters' });
      return;
    }

    if (address.length > 300) {
      res.status(400).json({ error: 'Address must be 300 characters or less' });
      return;
    }

    const searchTerm = `%${escapeLike(String(address))}%`;

    // Find prior calls at this address (fuzzy match on location_address)
    const calls = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status, c.disposition,
        c.location_address, c.created_at, c.cleared_at,
        c.weapons_involved, c.domestic_violence, c.injuries_reported,
        c.alcohol_involved, c.drugs_involved, c.description
      FROM calls_for_service c
      WHERE c.location_address LIKE ? ESCAPE '\\'
      ORDER BY c.created_at DESC
      LIMIT 20
    `).all(searchTerm) as any[];

    // Determine if there are hazardous warnings
    const warningTypes: string[] = [];
    for (const call of calls) {
      if (call.weapons_involved && call.weapons_involved !== 'None' && !warningTypes.includes('ARMED'))
        warningTypes.push('ARMED');
      if (call.domestic_violence && !warningTypes.includes('DV'))
        warningTypes.push('DV');
      if (call.injuries_reported && !warningTypes.includes('INJURIES'))
        warningTypes.push('INJURIES');
      if (call.alcohol_involved && !warningTypes.includes('ALCOHOL'))
        warningTypes.push('ALCOHOL');
      if (call.drugs_involved && !warningTypes.includes('DRUGS'))
        warningTypes.push('DRUGS');
    }

    // Check for high-risk incident types in history
    const highRiskTypes = ['shooting', 'shots_fired', 'armed', 'barricade', 'hostage', 'hazmat', 'officer_assist'];
    for (const call of calls) {
      const itype = (call.incident_type || '').toLowerCase();
      if (highRiskTypes.some(t => itype.includes(t)) && !warningTypes.includes('HIGH_RISK_HISTORY'))
        warningTypes.push('HIGH_RISK_HISTORY');
    }

    // Also check property hazard notes if we can match a property
    let propertyHazard: string | null = null;
    try {
      const prop = db.prepare(`
        SELECT hazard_notes FROM properties WHERE address LIKE ? ESCAPE '\\' AND hazard_notes IS NOT NULL LIMIT 1
      `).get(searchTerm) as any;
      if (prop?.hazard_notes) {
        propertyHazard = prop.hazard_notes;
        if (!warningTypes.includes('PROPERTY_HAZARD')) warningTypes.push('PROPERTY_HAZARD');
      }
    } catch { /* properties table may not have hazard_notes */ }

    res.json({
      calls,
      total: calls.length,
      hasWarnings: warningTypes.length > 0,
      warningTypes,
      propertyHazard,
    });
  } catch (error: any) {
    console.error('[Dispatch] premise history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/safety-screen - Officer Safety Auto-Screening
// Searches persons and warrants by name to detect active warrants, caution flags, criminal history.
router.get('/safety-screen', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name } = req.query;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.json({ persons: [], directWarrantHits: [], hasWarnings: false });
    }

    if (name.length > 200) {
      res.status(400).json({ error: 'Name must be 200 characters or less' });
      return;
    }

    const searchName = name.trim();

    // Split into possible first/last name parts
    const parts = searchName.split(/[\s,]+/).filter(Boolean);

    // ── Search persons table ──
    let personRows: any[] = [];
    if (parts.length >= 2) {
      // Try both orderings: "first last" and "last, first"
      personRows = db.prepare(`
        SELECT * FROM persons
        WHERE (first_name LIKE ? ESCAPE '\\' AND last_name LIKE ? ESCAPE '\\')
           OR (first_name LIKE ? ESCAPE '\\' AND last_name LIKE ? ESCAPE '\\')
           OR (first_name || ' ' || last_name LIKE ? ESCAPE '\\')
        LIMIT 10
      `).all(
        `%${escapeLike(parts[0])}%`, `%${escapeLike(parts[1])}%`,
        `%${escapeLike(parts[1])}%`, `%${escapeLike(parts[0])}%`,
        `%${escapeLike(searchName)}%`
      );
    } else if (parts.length === 1) {
      personRows = db.prepare(`
        SELECT * FROM persons
        WHERE first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\'
        LIMIT 10
      `).all(`%${escapeLike(parts[0])}%`, `%${escapeLike(parts[0])}%`);
    }

    // Enrich each person with warrants and criminal history
    const persons = personRows.map((person: any) => {
      const warrants = db.prepare(`
        SELECT w.* FROM warrants w
        WHERE w.status = 'active'
          AND w.subject_person_id = ?
      `).all(person.id);

      const criminalHistory = db.prepare(`
        SELECT * FROM criminal_history WHERE person_id = ? ORDER BY charge_date DESC LIMIT 10
      `).all(person.id);

      return { person, warrants, criminalHistory };
    });

    // ── Search warrants directly by subject name (via persons join) ──
    let directWarrantHits: any[] = [];
    if (parts.length >= 2) {
      directWarrantHits = db.prepare(`
        SELECT w.*, p.first_name AS subject_first_name, p.last_name AS subject_last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
          AND ((p.first_name LIKE ? ESCAPE '\\' AND p.last_name LIKE ? ESCAPE '\\')
            OR (p.first_name LIKE ? ESCAPE '\\' AND p.last_name LIKE ? ESCAPE '\\'))
        LIMIT 10
      `).all(
        `%${escapeLike(parts[0])}%`, `%${escapeLike(parts[1])}%`,
        `%${escapeLike(parts[1])}%`, `%${escapeLike(parts[0])}%`
      );
    } else if (parts.length === 1) {
      directWarrantHits = db.prepare(`
        SELECT w.*, p.first_name AS subject_first_name, p.last_name AS subject_last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
          AND (p.first_name LIKE ? ESCAPE '\\' OR p.last_name LIKE ? ESCAPE '\\')
        LIMIT 10
      `).all(`%${escapeLike(parts[0])}%`, `%${escapeLike(parts[0])}%`);
    }

    // Deduplicate warrant hits (already found via person enrichment)
    const personWarrantIds = new Set(
      persons.flatMap(p => p.warrants.map((w: any) => w.id))
    );
    const uniqueDirectWarrants = directWarrantHits.filter(
      (w: any) => !personWarrantIds.has(w.id)
    );

    // Determine if any warnings exist
    const hasWarnings =
      persons.some(p =>
        p.warrants.length > 0 ||
        p.person.caution_flags ||
        p.person.is_sex_offender ||
        p.person.has_criminal_history
      ) ||
      uniqueDirectWarrants.length > 0;

    res.json({
      persons,
      directWarrantHits: uniqueDirectWarrants,
      hasWarnings,
    });
  } catch (error: any) {
    console.error('[Dispatch] safety screen error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/districts - List all 3-tier dispatch districts
router.get('/districts', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const districts = db.prepare('SELECT * FROM dispatch_districts ORDER BY section_id, zone_id, beat_id LIMIT 5000').all();
    res.json(districts);
  } catch (error: any) {
    console.error('[Dispatch] districts list error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/districts/lookup - Lookup 3-tier by zone_id + beat_id
router.get('/districts/lookup', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { zone_id, beat_id } = req.query;

    if (!zone_id || typeof zone_id !== 'string' || zone_id.length > 50) {
      res.status(400).json({ error: 'zone_id is required (max 50 chars)' });
      return;
    }

    if (beat_id && (typeof beat_id !== 'string' || beat_id.length > 50)) {
      res.status(400).json({ error: 'beat_id must be 50 characters or less' });
      return;
    }

    let district: any;
    if (beat_id) {
      district = db.prepare(
        'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
      ).get(zone_id, beat_id);
    } else {
      // Return first matching zone entry
      district = db.prepare(
        'SELECT * FROM dispatch_districts WHERE zone_id = ? LIMIT 1'
      ).get(zone_id);
    }

    if (!district) {
      res.json({ found: false });
      return;
    }

    res.json({ found: true, district });
  } catch (error: any) {
    console.error('[Dispatch] district lookup error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/districts/identify - Identify district from GPS coordinates
router.get('/districts/identify', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      res.status(400).json({ error: 'lat and lng are required' });
      return;
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90 ||
        !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      res.status(400).json({ error: 'lat must be -90..90, lng must be -180..180' });
      return;
    }

    const beat = identifyBeat(latNum, lngNum);
    if (!beat) {
      res.json({ found: false });
      return;
    }

    // Lookup dispatch_districts table for rich names
    const district = db.prepare(
      'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
    ).get(beat.city_code, beat.district_letter) as any;

    if (district) {
      res.json({
        found: true,
        section_id: district.section_id,
        zone_id: district.zone_name,
        beat_id: `${district.beat_name} — ${district.beat_descriptor || ''}`.trim(),
        dispatch_code: district.dispatch_code,
        section_name: district.section_name,
        zone_name: district.zone_name,
        beat_name: district.beat_name,
        beat_descriptor: district.beat_descriptor,
      });
    } else {
      // Fallback to raw geofence data
      res.json({
        found: true,
        section_id: beat.district_letter,
        zone_id: `${beat.city} ${beat.district_letter}${beat.beat_number}`,
        beat_id: beat.beat_id,
      });
    }
  } catch (error: any) {
    console.error('[Dispatch] district identify error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
