import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { validateParamId, validateParamIdMiddleware, escapeLike } from '../../middleware/sanitize';
import { generateCallNumber, generateCaseNumber } from '../../utils/caseNumbers';
import { sendCsv } from '../../utils/csvExport';
import { localNow, localToday } from '../../utils/timeUtils';
import { geocodeCallIfNeeded } from '../../utils/geocode';
import { identifyBeat } from '../../utils/geofence';
import { broadcast, broadcastDispatchUpdate } from '../../utils/websocket';
import { createNotificationForRoles } from '../notifications';
import { auditLog } from '../../utils/auditLogger';
import { computeRiskScore } from '../../utils/riskScoring';
import { createServeQueueFromCall } from '../../utils/serveQueueLinker';
import { analyzeCall, isAIAvailable } from '../../utils/groqAI';
import { buildThreatContext } from '../../utils/threatContext';
import { findNearestUnits } from '../../utils/proximityAlerts';

// ── Upgrade 1: Priority score calculation ──
// Higher scores = more urgent. Used for sorting the dispatch queue.
function calculatePriorityScore(priority: string, incidentType: string, flags: {
  weapons_involved?: any; domestic_violence?: any; injuries_reported?: any;
  felony_in_progress?: any; officer_safety_caution?: any; mental_health_crisis?: any;
}): number {
  const priorityBase: Record<string, number> = { P1: 400, P2: 300, P3: 200, P4: 100 };
  let score = priorityBase[priority] || 100;

  // Upgrade 2: Incident type severity bonuses
  const highSeverityTypes = new Set([
    'shooting', 'shots_fired', 'officer_assist', 'armed_robbery', 'barricade',
    'hostage', 'pursuit', 'active_shooter', 'bomb_threat', 'kidnapping',
  ]);
  const medSeverityTypes = new Set([
    'assault', 'robbery', 'domestic_dispute', 'burglary', 'dui_dwi',
    'medical_emergency', 'overdose', 'fire', 'hazmat',
  ]);
  const itype = (incidentType || '').toLowerCase();
  if (highSeverityTypes.has(itype)) score += 80;
  else if (medSeverityTypes.has(itype)) score += 40;

  // Upgrade 3: Flag-based score modifiers
  if (flags.weapons_involved && flags.weapons_involved !== 'None' && flags.weapons_involved !== '') score += 60;
  if (flags.domestic_violence) score += 30;
  if (flags.injuries_reported) score += 40;
  if (flags.felony_in_progress) score += 50;
  if (flags.officer_safety_caution) score += 35;
  if (flags.mental_health_crisis) score += 20;

  return score;
}

// ── Upgrade 4: Address normalization for duplicate detection ──
function normalizeAddress(addr: string): string {
  return addr
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\bST\b/g, 'STREET')
    .replace(/\bAVE\b/g, 'AVENUE')
    .replace(/\bBLVD\b/g, 'BOULEVARD')
    .replace(/\bDR\b/g, 'DRIVE')
    .replace(/\bLN\b/g, 'LANE')
    .replace(/\bCT\b/g, 'COURT')
    .replace(/\bPL\b/g, 'PLACE')
    .replace(/\bRD\b/g, 'ROAD')
    .replace(/\bN\b/g, 'NORTH')
    .replace(/\bS\b/g, 'SOUTH')
    .replace(/\bE\b/g, 'EAST')
    .replace(/\bW\b/g, 'WEST')
    .replace(/[.,#]/g, '')
    .trim();
}

// ── Upgrade 5: Estimated response time based on priority ──
function estimatedResponseMinutes(priority: string): number {
  const estimates: Record<string, number> = { P1: 5, P2: 10, P3: 20, P4: 45 };
  return estimates[priority] || 30;
}


// ── PSO Service Window helpers (shared with callActions.ts) ──
type ServiceWindow = 'early_morning' | 'daytime' | 'evening';

function classifyServiceWindow(isoTimestamp: string): { window: ServiceWindow; isWeekend: boolean } {
  const d = new Date(isoTimestamp);
  const mt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  const hour = mt.getHours();
  const day = mt.getDay();
  const isWeekend = day === 0 || day === 6;
  let window: ServiceWindow;
  if (hour >= 6 && hour < 9) window = 'early_morning';
  else if (hour >= 9 && hour < 18) window = 'daytime';
  else if (hour >= 18 && hour < 21) window = 'evening';
  else window = hour < 6 ? 'early_morning' : 'evening';
  return { window, isWeekend };
}

/** Safely coerce a value to SQLite integer boolean (1/0).
 *  Handles string "false"/"0" correctly (JS truthy would be wrong). */
function toBoolInt(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'string') return val === 'false' || val === '0' || val === '' ? 0 : 1;
  return val ? 1 : 0;
}

const router = Router();

// Fix 52: Add index on calls_for_service(latitude, longitude, created_at) for map queries
try {
  const db = getDb();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_calls_lat_lng_created
    ON calls_for_service(latitude, longitude, created_at)`).run();
} catch (err) { console.error('[Calls] Index creation skipped (table may not exist yet):', err instanceof Error ? err.message : err); }

// GET /api/dispatch/calls - List calls with filters
router.get('/calls', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      status,
      priority,
      startDate,
      endDate,
      propertyId,
      search,
      archived,
      page = '1',
      limit = '50',
    } = req.query;

    // Validate enum query filters (status supports comma-separated values)
    const VALID_CALL_STATUSES = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
    const statusList = status ? String(status).split(',').map(s => s.trim()).filter(Boolean) : [];
    if (statusList.length > 0 && statusList.some(s => !VALID_CALL_STATUSES.includes(s))) {
      res.status(400).json({ error: 'Invalid status filter', code: 'INVALID_STATUS_FILTER' });
      return;
    }
    const VALID_CALL_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
    if (priority && !VALID_CALL_PRIORITIES.includes((priority as string).toUpperCase())) {
      res.status(400).json({ error: 'Invalid priority filter', code: 'INVALID_PRIORITY_FILTER' });
      return;
    }
    if (propertyId) {
      const pid = parseInt(String(propertyId), 10);
      if (isNaN(pid) || pid < 1) { res.status(400).json({ error: 'Invalid propertyId', code: 'INVALID_PROPERTYID' }); return; }
    }

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (statusList.length === 1) {
      whereClause += ' AND c.status = ?';
      params.push(statusList[0]);
    } else if (statusList.length > 1) {
      whereClause += ` AND c.status IN (${statusList.map(() => '?').join(',')})`;
      params.push(...statusList);
    }
    if (priority) {
      whereClause += ' AND c.priority = ?';
      params.push(priority);
    }
    if (startDate) {
      whereClause += ' AND c.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND c.created_at <= ?';
      params.push(endDate);
    }
    if (propertyId) {
      whereClause += ' AND c.property_id = ?';
      params.push(propertyId);
    }
    if (search) {
      whereClause += " AND (c.call_number LIKE ? ESCAPE '\\' OR c.incident_type LIKE ? ESCAPE '\\' OR c.location_address LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')";
      const s = `%${escapeLike(String(search))}%`;
      params.push(s, s, s, s);
    }

    // Archive filter: exclude archived calls by default, include only when requested
    if (archived === 'true') {
      whereClause += " AND c.status = 'archived'";
    } else if (archived !== 'all') {
      whereClause += " AND c.status != 'archived'";
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limit as string, 10)) || 100000));
    const offset = (pageNum - 1) * limitNum;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM calls_for_service c ${whereClause}`).get(...params) as any;

    const calls = db.prepare(`
      SELECT c.*, p.name as property_name, u.full_name as dispatcher_name,
        cl.name as client_name,
        (SELECT i.incident_number FROM incidents i WHERE i.call_id = c.id ORDER BY i.id DESC LIMIT 1) as incident_number,
        (SELECT COUNT(*) FROM call_persons cp
          JOIN persons per ON cp.person_id = per.id
          WHERE cp.call_id = c.id
            AND per.flags IS NOT NULL
            AND per.flags LIKE '%ACTIVE_WARRANT%') as has_active_warrant
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      ${whereClause}
      ORDER BY
        ${archived === 'true'
          ? 'c.call_number DESC'
          : "COALESCE(c.priority_score, CASE c.priority WHEN 'P1' THEN 400 WHEN 'P2' THEN 300 WHEN 'P3' THEN 200 WHEN 'P4' THEN 100 END) DESC, c.created_at DESC"
        }
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    // Strip caller PII for roles that shouldn't see it (contract_manager)
    const callerPiiRoles = new Set(['admin', 'manager', 'supervisor', 'officer', 'dispatcher']);
    const showCallerPii = callerPiiRoles.has(req.user?.role || '');
    const safeCalls = showCallerPii
      ? calls
      : (calls as any[]).map(({ caller_name, caller_phone, caller_address, ...rest }) => rest);

    const total = countRow?.total ?? 0;
    res.json({
      data: safeCalls,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: limitNum > 0 ? Math.ceil(total / limitNum) : 0,
      },
    });
  } catch (error: any) {
    console.error('Get calls error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get calls', code: 'GET_CALLS_ERROR' });
  }
});

// POST /api/dispatch/calls - Create new call for service
// Supports optional historical fields: created_at, status, dispatched_at, enroute_at,
// onscene_at, cleared_at, closed_at, disposition — for entering past records.
router.post('/calls', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      incident_type, priority, caller_name, caller_phone, caller_relationship, caller_address,
      location_address, property_id, latitude, longitude, description, notes, source,
      cross_street, location_building, location_floor, location_room, zone_beat,
      sector_id, zone_id, beat_id, dispatch_code: requestDispatchCode,
      weapons_involved, injuries_reported, num_subjects, num_victims,
      subject_description, vehicle_description, direction_of_travel,
      scene_safety, weather_conditions, lighting_conditions,
      alcohol_involved, drugs_involved, domestic_violence,
      supervisor_notified, le_notified, le_agency, le_case_number,
      damage_estimate, damage_description, responding_officer, action_taken,
      contract_id,
      // Extended operational flags
      mental_health_crisis, juvenile_involved, felony_in_progress, officer_safety_caution,
      k9_requested, ems_requested, fire_requested, hazmat,
      gang_related, evidence_collected, body_camera_active, photos_taken,
      trespass_issued, vehicle_pursuit, foot_pursuit,
      // PSO Client Request fields
      pso_service_type, pso_authorization, pso_requestor_name,
      pso_requestor_phone, pso_requestor_email, pso_billing_code,
      pso_attempt_number: createAttemptNumber,
      // Process Service fields
      process_service_type, process_served_to, process_served_address,
      process_attempts, process_served_at, process_service_result,
      client_id: requestClientId,
      // Historical entry fields (optional)
      created_at: customCreatedAt,
      status: customStatus,
      dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, archived_at,
      disposition: customDisposition,
    } = req.body;

    if (!incident_type || !priority || !location_address) {
      res.status(400).json({ error: 'incident_type, priority, and location_address are required', code: 'MISSING_FIELDS' });
      return;
    }

    // Upgrade 6: Validate location_address minimum length
    if (String(location_address).trim().length < 3) {
      res.status(400).json({ error: 'location_address must be at least 3 characters', code: 'ADDRESS_TOO_SHORT' });
      return;
    }

    // Upgrade 7: Validate incident_type is not empty after trim
    if (!String(incident_type).trim()) {
      res.status(400).json({ error: 'incident_type cannot be blank', code: 'INCIDENT_TYPE_BLANK' });
      return;
    }

    // Upgrade 8: Validate caller_phone format if provided
    if (caller_phone && !/^[\d\s\-\+\(\)\.]{7,20}$/.test(String(caller_phone))) {
      res.status(400).json({ error: 'Invalid caller phone format', code: 'INVALID_CALLER_PHONE' });
      return;
    }

    // Upgrade 9: Validate source enum if provided
    const VALID_SOURCES = ['phone', 'radio', 'walk_in', 'online', 'alarm', 'officer_initiated', 'patrol', 'panic', 'dispatch', 'email', 'app', 'other'];
    if (source && !VALID_SOURCES.includes(source)) {
      res.status(400).json({ error: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}`, code: 'INVALID_SOURCE' });
      return;
    }

    // Fix 50: Validate latitude/longitude when creating calls
    if (latitude != null && (isNaN(Number(latitude)) || Math.abs(Number(latitude)) > 90)) {
      res.status(400).json({ error: 'Invalid latitude value (must be between -90 and 90)', code: 'INVALID_LAT' });
      return;
    }
    if (longitude != null && (isNaN(Number(longitude)) || Math.abs(Number(longitude)) > 180)) {
      res.status(400).json({ error: 'Invalid longitude value (must be between -180 and 180)', code: 'INVALID_LNG' });
      return;
    }
    if (req.body.num_subjects != null && (isNaN(Number(req.body.num_subjects)) || Number(req.body.num_subjects) < 0)) {
      res.status(400).json({ error: 'Invalid num_subjects value', code: 'INVALID_NUMSUBJECTS_VALUE' });
      return;
    }
    if (req.body.num_victims != null && (isNaN(Number(req.body.num_victims)) || Number(req.body.num_victims) < 0)) {
      res.status(400).json({ error: 'Invalid num_victims value', code: 'INVALID_NUMVICTIMS_VALUE' });
      return;
    }

    // Fix 54: Validate priority values (P1-P4)
    const normalizedPriority = String(priority).toUpperCase();
    const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
    if (!VALID_PRIORITIES.includes(normalizedPriority)) {
      res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`, code: 'INVALID_PRIORITY' });
      return;
    }

    // Max length validation
    if (location_address && String(location_address).length > 500) {
      res.status(400).json({ error: 'Location address too long (max 500 chars)', code: 'FIELD_TOO_LONG' });
      return;
    }
    if (description && String(description).length > 10000) {
      res.status(400).json({ error: 'Description too long (max 10000 chars)', code: 'FIELD_TOO_LONG' });
      return;
    }

    // Fix 51: Normalize incident_type for consistent heatmap grouping (trim, lowercase)
    const normalizedIncidentType = String(incident_type || '').trim().toLowerCase().replace(/\s+/g, '_');

    // Generate call number: YY-CFS#####
    const callNumber = generateCallNumber(db);

    // Auto-generate case number for every dispatch call
    const INCIDENT_TO_CASE_TYPE: Record<string, string> = {
      theft: 'theft', burglary: 'burglary', robbery: 'criminal', assault: 'assault', battery: 'assault',
      vandalism: 'criminal', criminal_mischief: 'criminal', drug_activity: 'narcotics', weapons_offense: 'criminal',
      fraud_forgery: 'fraud', kidnapping: 'criminal', arson: 'criminal', sexual_assault: 'criminal',
      stalking: 'criminal', identity_theft: 'fraud', criminal_trespass: 'criminal', shoplifting: 'theft',
      auto_theft: 'theft', criminal_threat: 'criminal', prostitution: 'criminal',
      trespass: 'disorder', disturbance: 'disorder', noise_complaint: 'disorder', loitering: 'disorder',
      panhandling: 'disorder', domestic_dispute: 'domestic', prowler: 'disorder', harassment: 'disorder',
      traffic_accident: 'accident', hit_and_run: 'accident', dui_dwi: 'traffic', parking_violation: 'traffic',
      traffic_hazard: 'traffic', abandoned_vehicle: 'traffic', reckless_driving: 'traffic', traffic_stop: 'traffic',
      medical_emergency: 'medical', overdose: 'medical', mental_health_crisis: 'medical',
      fire: 'fire', fire_alarm: 'fire', hazmat: 'fire',
      death_investigation: 'death', missing_person: 'missing_person', juvenile_runaway: 'juvenile',
      alarm_response: 'security', access_control: 'security', patrol_check: 'security', lock_unlock: 'security',
      property_damage: 'property', lost_found: 'property',
      daily_activity: 'admin', special_event: 'admin', training_exercise: 'admin',
    };
    const caseType = INCIDENT_TO_CASE_TYPE[normalizedIncidentType] || 'general';
    const caseNumber = generateCaseNumber(db, caseType);

    // Determine status — allow historical entries to set any valid status
    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
    const status = customStatus && validStatuses.includes(customStatus) ? customStatus : 'pending';

    // Auto-resolve client_id, lat/lng, and address from property if not provided
    let resolvedClientId = requestClientId || null;
    let resolvedLat = latitude != null ? Number(latitude) : null;
    let resolvedLng = longitude != null ? Number(longitude) : null;
    let resolvedAddress = location_address;
    if (property_id) {
      const prop = db.prepare('SELECT client_id, latitude, longitude, address, name, gate_code, alarm_code, access_instructions, hazard_notes FROM properties WHERE id = ?').get(property_id) as any;
      if (prop) {
        if (!resolvedClientId) resolvedClientId = prop.client_id;
        // Auto-fill coordinates from property if not explicitly provided
        if (resolvedLat == null && prop.latitude != null) resolvedLat = Number(prop.latitude);
        if (resolvedLng == null && prop.longitude != null) resolvedLng = Number(prop.longitude);
        // Auto-fill address from property if not explicitly provided
        if (!resolvedAddress && prop.address) resolvedAddress = prop.address;
        // Auto-populate description with property details for dispatch reference
        if (!description && (prop.gate_code || prop.alarm_code || prop.access_instructions || prop.hazard_notes)) {
          const details: string[] = [];
          if (prop.gate_code) details.push(`Gate: ${prop.gate_code}`);
          if (prop.alarm_code) details.push(`Alarm: ${prop.alarm_code}`);
          if (prop.access_instructions) details.push(`Access: ${prop.access_instructions}`);
          if (prop.hazard_notes) details.push(`HAZARD: ${prop.hazard_notes}`);
          req.body.description = details.join(' | ');
        }
      }
    }

    // ── Auto-fill Beat / Zone / Sector from GPS coordinates + 3-Tier dispatch districts ──
    let autoZoneBeat = zone_beat || null;
    let autoSectionId = sector_id || null;
    let autoZoneId = zone_id || null;
    let autoBeatId = beat_id || null;
    let autoDispatchCode: string | null = requestDispatchCode || null;
    let autoSectionName: string | null = null;
    let autoZoneName: string | null = null;
    let autoBeatName: string | null = null;
    let autoBeatDescriptor: string | null = null;
    if (resolvedLat != null && resolvedLng != null) {
      try {
        const beat = identifyBeat(resolvedLat, resolvedLng);
        if (beat) {
          if (!autoZoneBeat) autoZoneBeat = beat.beat_code;

          // Look up 3-tier geography for richer naming
          const district = db.prepare(`
            SELECT db2.beat_code, db2.beat_name, db2.beat_descriptor,
                   dz.zone_code, dz.zone_name, ds.sector_code, ds.sector_name
            FROM dispatch_beats db2
            JOIN dispatch_zones dz ON dz.id = db2.zone_id
            JOIN dispatch_sectors ds ON ds.id = dz.sector_id
            WHERE db2.beat_code = ? LIMIT 1
          `).get(beat.beat_code) as any;

          if (district) {
            if (!autoSectionId) autoSectionId = district.sector_code;
            if (!autoZoneId) autoZoneId = district.zone_code;
            if (!autoBeatId) autoBeatId = district.beat_code;
            autoDispatchCode = district.beat_code;
            autoSectionName = district.sector_name;
            autoZoneName = district.zone_name;
            autoBeatName = district.beat_name;
            autoBeatDescriptor = district.beat_descriptor;
          } else {
            // Geofence found a polygon but no exact dispatch_beats row
            // (typically unincorporated, or beat_code drift). Fall back to
            // looking up the zone by city_code suffix (e.g. geofence
            // city_code="MUR" → zone_code "SL1-MUR"). Writes canonical
            // sector + zone; leaves beat null for dispatcher to pick.
            try {
              const zoneMatch = db.prepare(`
                SELECT dz.zone_code, dz.zone_name, ds.sector_code, ds.sector_name
                FROM dispatch_zones dz
                JOIN dispatch_sectors ds ON ds.id = dz.sector_id
                WHERE dz.zone_code LIKE ? ESCAPE '\\' LIMIT 1
              `).get(`%-${beat.city_code}`) as any;
              if (zoneMatch) {
                if (!autoSectionId) autoSectionId = zoneMatch.sector_code;
                if (!autoZoneId) autoZoneId = zoneMatch.zone_code;
                autoSectionName = zoneMatch.sector_name;
                autoZoneName = zoneMatch.zone_name;
              }
            } catch { /* skip */ }
            if (!autoZoneBeat) autoZoneBeat = beat.beat_code;
          }
        }
      } catch (geoErr) { console.error('[Calls] Geofence lookup error (non-critical):', geoErr instanceof Error ? geoErr.message : geoErr); }
    }

    // If S/Z/B are set but dispatch_code wasn't resolved (no GPS), look up geography tables
    if (autoSectionId && autoZoneId && autoBeatId && !autoDispatchCode) {
      try {
        const districtMatch = db.prepare(`
          SELECT db2.beat_code, db2.beat_name, db2.beat_descriptor,
                 dz.zone_code, dz.zone_name, ds.sector_code, ds.sector_name
          FROM dispatch_beats db2
          JOIN dispatch_zones dz ON dz.id = db2.zone_id
          JOIN dispatch_sectors ds ON ds.id = dz.sector_id
          WHERE ds.sector_code = ? AND dz.zone_code = ? AND db2.beat_code = ? LIMIT 1
        `).get(autoSectionId, autoZoneId, autoBeatId) as any;
        if (districtMatch) {
          // beat_code is already in chart format ("SL1-SLC/A").
          autoDispatchCode = districtMatch.beat_code;
          if (!autoSectionName) autoSectionName = districtMatch.sector_name;
          if (!autoZoneName) autoZoneName = districtMatch.zone_name;
          if (!autoBeatName) autoBeatName = districtMatch.beat_name;
          if (!autoBeatDescriptor) autoBeatDescriptor = districtMatch.beat_descriptor;
        } else {
          autoDispatchCode = `${autoSectionId}-${autoZoneId}/${autoBeatId}`;
        }
      } catch {
        autoDispatchCode = `${autoSectionId}-${autoZoneId}/${autoBeatId}`;
      }
    }

    // Auto-generate dispatch code if not provided and section/zone/beat are available
    if (!autoDispatchCode && (autoSectionId || autoZoneId)) {
      autoDispatchCode = [autoSectionId, autoZoneId, autoBeatId].filter(Boolean).join('-') || null;
    }

    // Upgrade 10: Calculate priority score for queue sorting
    const priorityScore = calculatePriorityScore(normalizedPriority, normalizedIncidentType, {
      weapons_involved, domestic_violence, injuries_reported,
      felony_in_progress, officer_safety_caution, mental_health_crisis,
    });

    // Upgrade 11: Duplicate call detection — warn if open call at same address within last hour
    let duplicateWarning: { call_number: string; incident_type: string; created_at: string } | null = null;
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const normalizedAddr = normalizeAddress(String(location_address));
      const nearbyCall = db.prepare(`
        SELECT call_number, incident_type, created_at, location_address
        FROM calls_for_service
        WHERE status NOT IN ('cleared','closed','cancelled','archived')
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 50
      `).all(oneHourAgo) as any[];
      // Check if any nearby call matches normalized address
      for (const nc of nearbyCall) {
        if (normalizeAddress(nc.location_address || '') === normalizedAddr) {
          duplicateWarning = { call_number: nc.call_number, incident_type: nc.incident_type, created_at: nc.created_at };
          break;
        }
      }
    } catch { /* non-fatal */ }

    // Upgrade 12: Estimated response time based on priority
    const estResponseMinutes = estimatedResponseMinutes(normalizedPriority);

    // Transaction: insert call + activity log atomically
    const createCallTx = db.transaction(() => {
      // Use named parameters to guarantee column/value alignment
      const callData: Record<string, any> = {
        call_number: callNumber,
        case_number: caseNumber,
        incident_type: normalizedIncidentType,
        priority: normalizedPriority,
        status,
        caller_name: caller_name || null,
        caller_phone: caller_phone || null,
        caller_relationship: caller_relationship || null,
        caller_address: caller_address || null,
        location_address: resolvedAddress,
        property_id: property_id || null,
        latitude: resolvedLat ?? null,
        longitude: resolvedLng ?? null,
        description: req.body.description || description || null,
        notes: notes || null,
        source: source || 'phone',
        dispatcher_id: req.user!.userId,
        cross_street: cross_street || null,
        location_building: location_building || null,
        location_floor: location_floor || null,
        location_room: location_room || null,
        zone_beat: autoZoneBeat,
        sector_id: autoSectionId,
        zone_id: autoZoneId,
        beat_id: autoBeatId,
        dispatch_code: autoDispatchCode,
        sector_name: autoSectionName,
        zone_name: autoZoneName,
        beat_name: autoBeatName,
        beat_descriptor: autoBeatDescriptor,
        weapons_involved: (weapons_involved && weapons_involved !== 'None') ? weapons_involved : null,
        injuries_reported: toBoolInt(injuries_reported),
        num_subjects: num_subjects ?? null,
        num_victims: num_victims ?? null,
        subject_description: subject_description || null,
        vehicle_description: vehicle_description || null,
        direction_of_travel: direction_of_travel || null,
        scene_safety: scene_safety || null,
        weather_conditions: weather_conditions || null,
        lighting_conditions: lighting_conditions || null,
        alcohol_involved: toBoolInt(alcohol_involved),
        drugs_involved: toBoolInt(drugs_involved),
        domestic_violence: toBoolInt(domestic_violence),
        supervisor_notified: toBoolInt(supervisor_notified),
        le_notified: toBoolInt(le_notified),
        le_agency: (le_agency && le_agency !== 'None') ? le_agency : null,
        le_case_number: le_case_number || null,
        damage_estimate: damage_estimate ?? null,
        damage_description: damage_description || null,
        responding_officer: responding_officer || null,
        action_taken: action_taken || null,
        mental_health_crisis: toBoolInt(mental_health_crisis),
        juvenile_involved: toBoolInt(juvenile_involved),
        felony_in_progress: toBoolInt(felony_in_progress),
        officer_safety_caution: toBoolInt(officer_safety_caution),
        k9_requested: toBoolInt(k9_requested),
        ems_requested: toBoolInt(ems_requested),
        fire_requested: toBoolInt(fire_requested),
        hazmat: toBoolInt(hazmat),
        gang_related: toBoolInt(gang_related),
        evidence_collected: toBoolInt(evidence_collected),
        body_camera_active: toBoolInt(body_camera_active),
        photos_taken: toBoolInt(photos_taken),
        trespass_issued: toBoolInt(trespass_issued),
        vehicle_pursuit: toBoolInt(vehicle_pursuit),
        foot_pursuit: toBoolInt(foot_pursuit),
        pso_service_type: pso_service_type || null,
        pso_authorization: pso_authorization || null,
        pso_requestor_name: pso_requestor_name || null,
        pso_requestor_phone: pso_requestor_phone || null,
        pso_requestor_email: pso_requestor_email || null,
        pso_billing_code: pso_billing_code || null,
        pso_attempt_number: createAttemptNumber ?? 1,
        process_service_type: process_service_type || null,
        process_served_to: process_served_to || null,
        process_served_address: process_served_address || null,
        process_attempts: process_attempts || null,
        process_served_at: process_served_at || null,
        process_service_result: process_service_result || null,
        contract_id: contract_id || null,
        client_id: resolvedClientId,
        priority_score: priorityScore,
        received_at: customCreatedAt || localNow(),
        created_at: customCreatedAt || localNow(),
        dispatched_at: dispatched_at || null,
        enroute_at: enroute_at || null,
        onscene_at: onscene_at || null,
        cleared_at: cleared_at || null,
        closed_at: closed_at || null,
        archived_at: archived_at || null,
        disposition: customDisposition || null,
      };
      const cols = Object.keys(callData);
      const placeholders = cols.map(c => '@' + c).join(', ');
      const result = db.prepare(
        `INSERT INTO calls_for_service (${cols.join(', ')}) VALUES (${placeholders})`
      ).run(callData);

      const call = (db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(Number(result.lastInsertRowid)) as any) || { id: Number(result.lastInsertRowid) };

      // Create a corresponding case record for bidirectional linkage
      const caseNow = customCreatedAt || localNow();
      const caseResult = db.prepare(`
        INSERT INTO cases (case_number, title, case_type, status, priority, summary, linked_calls, created_by, created_at, updated_at, opened_date)
        VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        caseNumber,
        `${(normalizedIncidentType || '').replace(/_/g, ' ').toUpperCase()} — ${location_address || 'Unknown location'}`,
        caseType,
        normalizedPriority === 'P1' ? 'critical' : normalizedPriority === 'P2' ? 'high' : 'normal',
        description || null,
        JSON.stringify([call.id]),
        req.user!.userId, caseNow, caseNow, localToday(),
      );

      // Back-link case_id to the call
      db.prepare('UPDATE calls_for_service SET case_id = ? WHERE id = ?').run(caseResult.lastInsertRowid, call.id);
      call.case_id = caseResult.lastInsertRowid;

      // Log activity
      const isHistorical = !!customCreatedAt;
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_created', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `${isHistorical ? 'Historical entry: ' : 'Created '}${callNumber} (Case ${caseNumber}): ${normalizedIncidentType}`, req.ip || 'unknown');

      return call;
    });
    const call = createCallTx();

    // If no coordinates were provided, geocode the address asynchronously
    geocodeCallIfNeeded(call.id, location_address, latitude, longitude);

    // Find nearest units (sync)
    let nearestUnits: any[] = [];
    try {
      if (call.latitude && call.longitude) {
        nearestUnits = findNearestUnits(call.latitude, call.longitude, 3);
      }
    } catch { /* non-critical */ }

    // Broadcast to dispatch channel (immediate, threat context added async below)
    broadcastDispatchUpdate({ action: 'call_created', call, nearestUnits });

    // Build threat context asynchronously and broadcast enrichment if available
    buildThreatContext({
      locationAddress: call.location_address,
      latitude: call.latitude,
      longitude: call.longitude,
      callId: call.id,
    }).then((ctx) => {
      if (ctx.briefingSummary) {
        broadcastDispatchUpdate({
          action: 'call_created',
          call,
          threatContext: {
            threatLevel: ctx.threatLevel,
            briefingSummary: ctx.briefingSummary,
            premiseHistoryCount: ctx.premiseHistory.totalCalls,
            activeWarrantCount: ctx.activeWarrants.length,
          },
          nearestUnits,
        });
      }
    }).catch(() => { /* non-critical */ });

    // Notify dispatch/supervisors of new call
    createNotificationForRoles(
      ['admin', 'manager', 'supervisor', 'dispatcher'],
      'dispatch', `New Call: ${call.call_number}`,
      `${call.incident_type} — ${call.location_address || 'No address'}`,
      'call', call.id, 'normal', 'dispatch.call_created', req.user!.userId,
    );

    // P1 emergency: extra critical notification to all sworn + dispatch
    if (call.priority === 'P1') {
      createNotificationForRoles(
        ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'],
        'dispatch', `🚨 P1 EMERGENCY: ${call.call_number}`,
        `${call.incident_type} — ${call.location_address || 'No address'}`,
        'call', call.id, 'critical', 'dispatch.call_priority_p1', req.user!.userId,
      );
    }

    // Auto-send to serve queue for PSO / process service calls
    if (['pso_client_request', 'process_service'].includes(normalizedIncidentType)) {
      try {
        const newCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id) as any;
        const serveJobId = createServeQueueFromCall(db, newCall, req.user!.userId);
        if (serveJobId) {
          broadcast('serve', 'serve_created', { id: serveJobId, call_id: call.id });
        }
      } catch (serveErr) {
        console.error('[Dispatch] Auto-send to serve queue failed (non-fatal):', serveErr instanceof Error ? serveErr.message : serveErr);
      }
    }

    // Upgrade 13: Include duplicate warning and estimated response time in response
    const response: any = { ...call, estimated_response_minutes: estResponseMinutes };
    if (duplicateWarning) {
      response._duplicate_warning = {
        message: `Possible duplicate: active call ${duplicateWarning.call_number} (${duplicateWarning.incident_type}) at same address created at ${duplicateWarning.created_at}`,
        existing_call: duplicateWarning,
      };
    }

    res.status(201).json(response);

    // Non-blocking AI analysis on new call
    if (isAIAvailable()) {
      const existingFlags: string[] = [];
      if (call.weapons_involved) existingFlags.push('weapons_involved');
      if (call.domestic_violence) existingFlags.push('domestic_violence');
      if (call.mental_health_crisis) existingFlags.push('mental_health_crisis');
      if (call.felony_in_progress) existingFlags.push('felony_in_progress');
      if (call.officer_safety_caution) existingFlags.push('officer_safety_caution');
      if (call.hazmat) existingFlags.push('hazmat');
      if (call.gang_related) existingFlags.push('gang_related');

      analyzeCall({
        incident_type: call.incident_type,
        description: call.description || undefined,
        notes: call.notes || undefined,
        location_address: call.location_address || undefined,
        existing_flags: existingFlags,
      }).then((analysis) => {
        if (analysis && analysis.confidence > 0.7 && analysis.safetyBriefing) {
          broadcastDispatchUpdate({
            action: 'ai_analysis',
            call_id: call.id,
            call_number: call.call_number,
            analysis,
          });
        }
      }).catch((err) => {
        console.error('AI analysis error (create):', err?.message || err);
      });
    }
  } catch (error: any) {
    console.error('Create call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to create call', code: 'CREATE_CALL_ERROR' });
  }
});

// GET /api/dispatch/calls/export - Export calls as CSV
router.get('/calls/export', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, priority, startDate, endDate } = req.query;

    // Validate export query params
    if (status && typeof status === 'string' && status.length > 50) {
      res.status(400).json({ error: 'Invalid status filter', code: 'INVALID_STATUS' }); return;
    }
    if (startDate && typeof startDate === 'string' && isNaN(new Date(startDate).getTime())) {
      res.status(400).json({ error: 'Invalid startDate', code: 'INVALID_START_DATE' }); return;
    }
    if (endDate && typeof endDate === 'string' && isNaN(new Date(endDate).getTime())) {
      res.status(400).json({ error: 'Invalid endDate', code: 'INVALID_END_DATE' }); return;
    }

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND c.status = ?';
      params.push(status);
    }
    if (priority) {
      whereClause += ' AND c.priority = ?';
      params.push(priority);
    }
    if (startDate) {
      whereClause += ' AND c.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND c.created_at <= ?';
      params.push(endDate);
    }

    const rows = db.prepare(`
      SELECT c.call_number, c.incident_type, c.priority, c.status, c.caller_name,
        c.location_address, c.description, c.source, c.disposition, c.created_at, c.cleared_at
      FROM calls_for_service c
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT 50000
    `).all(...params);

    sendCsv(res, 'calls_export.csv', [
      { key: 'call_number', header: 'Call Number' },
      { key: 'incident_type', header: 'Incident Type' },
      { key: 'priority', header: 'Priority' },
      { key: 'status', header: 'Status' },
      { key: 'caller_name', header: 'Caller Name' },
      { key: 'location_address', header: 'Location Address' },
      { key: 'description', header: 'Description' },
      { key: 'source', header: 'Source' },
      { key: 'disposition', header: 'Disposition' },
      { key: 'created_at', header: 'Created At' },
      { key: 'cleared_at', header: 'Cleared At' },
    ], rows);
  } catch (error: any) {
    console.error('Export calls error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to export calls', code: 'EXPORT_CALLS_ERROR' });
  }
});

// GET /api/dispatch/calls/check-duplicate - Check for active calls at same/similar address
router.get('/calls/check-duplicate', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { address } = req.query;
    if (!address || typeof address !== 'string' || address.length < 3) {
      res.json({ duplicates: [], count: 0 });
      return;
    }

    // Normalize: uppercase, strip extra spaces, trim
    const normalized = (address as string).toUpperCase().replace(/\s+/g, ' ').trim();

    // Find active calls (not cleared/closed/cancelled/archived) at the same address
    const duplicates = db.prepare(`
      SELECT id, call_number, incident_type, priority, status, location_address, created_at
      FROM calls_for_service
      WHERE status NOT IN ('cleared','closed','cancelled','archived')
        AND UPPER(REPLACE(location_address, '  ', ' ')) LIKE ? ESCAPE '\\'
      ORDER BY created_at DESC
      LIMIT 5
    `).all(`%${escapeLike(normalized)}%`) as any[];

    res.json({ duplicates, count: duplicates.length });
  } catch (error: any) {
    console.error('Duplicate check error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to duplicate check', code: 'DUPLICATE_CHECK_ERROR' });
  }
});

// GET /api/dispatch/calls/active — Shortcut for dispatched+enroute+onscene+pending+open calls
router.get('/calls/active', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT c.*, u.full_name as dispatcher_name, p.name as property_name,
        cl.name as client_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      WHERE c.status IN ('dispatched', 'enroute', 'onscene', 'pending', 'open')
      ORDER BY
        COALESCE(c.priority_score, CASE c.priority WHEN 'P1' THEN 400 WHEN 'P2' THEN 300 WHEN 'P3' THEN 200 WHEN 'P4' THEN 100 END) DESC,
        c.created_at DESC
      LIMIT 200
    `).all();
    res.json(rows);
  } catch (error: any) {
    console.error('Active calls error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get active calls', code: 'ACTIVE_CALLS_ERROR' });
  }
});

// GET /api/dispatch/calls/:id - Get single call with details
// NOTE: \\d+ constraint ensures this doesn't shadow named routes like /calls/search, /calls/active, /calls/stats/*
router.get('/calls/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare(`
      SELECT c.*, p.name as property_name, p.address as property_address,
        p.gate_code, p.alarm_code, p.emergency_contact, p.post_orders, p.hazard_notes,
        u.full_name as dispatcher_name,
        cl.name as client_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      WHERE c.id = ?
    `).get(req.params.id) as any;

    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    // Fill geography parents from beat_id when the call was saved with only a
    // beat selected (auto-lookup skipped because lat/lng wasn't used).
    if (call.beat_id && (!call.sector_name || !call.zone_name || !call.beat_descriptor)) {
      try {
        const parents = db.prepare(`
          SELECT db.beat_descriptor, dz.zone_name, ds.sector_name, da.area_name
          FROM dispatch_beats db
          LEFT JOIN dispatch_zones dz ON db.zone_id = dz.id
          LEFT JOIN dispatch_sectors ds ON dz.sector_id = ds.id
          LEFT JOIN dispatch_areas da ON ds.area_id = da.id
          WHERE db.beat_code = ?
          LIMIT 1
        `).get(call.beat_id) as any;
        if (parents) {
          if (!call.sector_name) call.sector_name = parents.sector_name || '';
          if (!call.zone_name) call.zone_name = parents.zone_name || '';
          if (!call.beat_descriptor) call.beat_descriptor = parents.beat_descriptor || '';
          if (!call.area_name) call.area_name = parents.area_name || '';
        }
      } catch (joinErr) {
        (req as any).log?.warn?.({ err: joinErr }, 'geography parent lookup failed');
      }
    }

    // Get assigned units with officer info
    let assignedUnits: any[] = [];
    try {
      const parsed = JSON.parse(call.assigned_unit_ids || '[]');
      const unitIds = (Array.isArray(parsed) ? parsed : []).filter((id: any) => typeof id === 'number' && !isNaN(id));
      if (unitIds.length > 0) {
        const placeholders = unitIds.map(() => '?').join(',');
        assignedUnits = db.prepare(`
          SELECT u.*, usr.full_name as officer_name, usr.badge_number
          FROM units u
          LEFT JOIN users usr ON u.officer_id = usr.id
          WHERE u.id IN (${placeholders})
        
          LIMIT 1000
        `).all(...unitIds);
      }
    } catch (parseErr) { console.error(`[Calls] Failed to parse assigned_unit_ids for call ${call.id}:`, parseErr instanceof Error ? parseErr.message : parseErr); }

    // Get related incidents
    const incidents = db.prepare(`
      SELECT id, incident_number, incident_type, status, created_at
      FROM incidents WHERE call_id = ?
    
      LIMIT 1000
    `).all(call.id);

    // Get activity log for this call
    const activity = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'call' AND al.entity_id = ?
      ORDER BY al.created_at DESC
    
      LIMIT 1000
    `).all(call.id);

    // Attach visit history for PSO calls
    let visit_history: any[] = [];
    if (call.incident_type === 'pso_client_request') {
      visit_history = db.prepare('SELECT * FROM call_visit_history WHERE call_id = ? ORDER BY visit_number ASC').all(call.id) as any[];
    }

    // Surface the first linked incident number on the call object for display
    const firstIncidentNumber = (incidents as any[]).length > 0 ? (incidents as any[])[0].incident_number : null;

    res.json({
      ...call,
      incident_number: call.incident_number || firstIncidentNumber,
      assigned_units: assignedUnits,
      related_incidents: incidents,
      activity,
      visit_history,
    });
  } catch (error: any) {
    console.error('Get call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get call', code: 'GET_CALL_ERROR' });
  }
});

// PUT /api/dispatch/calls/:id - Update call
router.put('/calls/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    const {
      incident_type, priority, status, caller_name, caller_phone, caller_relationship,
      location_address, property_id, latitude, longitude, description, notes, disposition,
      cross_street, location_building, location_floor, location_room,
      weapons_involved, injuries_reported, num_subjects,
      subject_description, vehicle_description, direction_of_travel,
      case_number, case_id,
      source, caller_address, zone_beat, sector_id, zone_id, beat_id, responding_officer, secondary_type,
      contact_method, scene_safety, weather_conditions, lighting_conditions,
      num_victims, alcohol_involved, drugs_involved, domestic_violence,
      supervisor_notified, le_notified, le_agency, le_case_number,
      damage_estimate, damage_description, action_taken,
      starting_mileage, ending_mileage,
      // Extended operational flags
      mental_health_crisis, juvenile_involved, felony_in_progress, officer_safety_caution,
      k9_requested, ems_requested, fire_requested, hazmat,
      gang_related, evidence_collected, body_camera_active, photos_taken,
      trespass_issued, vehicle_pursuit, foot_pursuit,
      // PSO Client Request fields
      pso_service_type, pso_authorization, pso_requestor_name,
      pso_requestor_phone, pso_requestor_email, pso_billing_code,
      pso_attempt_number,
      // Process Service fields
      process_service_type, process_served_to, process_served_address,
      process_attempts, process_served_at, process_service_result,
      contract_id,
      client_id: updateClientId,
    } = req.body;

    // Auto-resolve client_id from property if property changes
    let resolvedUpdateClientId = updateClientId;
    if (resolvedUpdateClientId === undefined && property_id !== undefined && property_id) {
      const prop = db.prepare('SELECT client_id FROM properties WHERE id = ?').get(property_id) as any;
      if (prop) resolvedUpdateClientId = prop.client_id;
    }

    // ── Auto-fill Beat / Zone / Sector when coords change + 3-Tier lookup ──
    let autoZoneBeat = zone_beat;
    let autoSectionId = sector_id;
    let autoZoneId = zone_id;
    let autoBeatId = beat_id;
    const effectiveLat = latitude !== undefined ? latitude : call.latitude;
    const effectiveLng = longitude !== undefined ? longitude : call.longitude;
    if (effectiveLat && effectiveLng && (latitude !== undefined || (!call.beat_id && !call.zone_id))) {
      try {
        const beat = identifyBeat(Number(effectiveLat), Number(effectiveLng));
        if (beat) {
          if (autoZoneBeat === undefined && !call.zone_beat) autoZoneBeat = beat.beat_code;

          // Look up 3-tier geography for richer naming
          const district = db.prepare(`
            SELECT db2.beat_code, db2.beat_name, db2.beat_descriptor,
                   dz.zone_code, dz.zone_name, ds.sector_code, ds.sector_name
            FROM dispatch_beats db2
            JOIN dispatch_zones dz ON dz.id = db2.zone_id
            JOIN dispatch_sectors ds ON ds.id = dz.sector_id
            WHERE db2.beat_code = ? LIMIT 1
          `).get(beat.beat_code) as any;

          if (district) {
            if (autoBeatId === undefined && !call.beat_id) autoBeatId = district.beat_code;
            if (autoZoneId === undefined && !call.zone_id) autoZoneId = district.zone_code;
            if (autoSectionId === undefined && !call.sector_id) autoSectionId = district.sector_code;
          } else {
            // Fallback: look up zone by city_code suffix (see POST path).
            try {
              const zoneMatch = db.prepare(`
                SELECT dz.zone_code, ds.sector_code
                FROM dispatch_zones dz
                JOIN dispatch_sectors ds ON ds.id = dz.sector_id
                WHERE dz.zone_code LIKE ? ESCAPE '\\' LIMIT 1
              `).get(`%-${beat.city_code}`) as any;
              if (zoneMatch) {
                if (autoZoneId === undefined && !call.zone_id) autoZoneId = zoneMatch.zone_code;
                if (autoSectionId === undefined && !call.sector_id) autoSectionId = zoneMatch.sector_code;
              }
            } catch { /* skip */ }
          }

          // If coords explicitly changed, always update beat data
          if (latitude !== undefined) {
            if (autoZoneBeat === undefined) autoZoneBeat = beat.beat_code;
            if (district) {
              autoBeatId = autoBeatId !== undefined ? autoBeatId : district.beat_code;
              autoZoneId = autoZoneId !== undefined ? autoZoneId : district.zone_code;
              autoSectionId = autoSectionId !== undefined ? autoSectionId : district.sector_code;
            }
          }
        }
      } catch (geoErr) { console.error('[Calls] Geofence lookup error (non-critical):', geoErr instanceof Error ? geoErr.message : geoErr); }
    }

    // Validate priority if being updated
    if (priority !== undefined) {
      const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
      if (!VALID_PRIORITIES.includes(String(priority).toUpperCase())) {
        res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`, code: 'INVALID_PRIORITY' });
        return;
      }
    }

    // Upgrade 14: Validate status transitions — prevent illegal backward transitions
    if (status !== undefined) {
      const VALID_CALL_STATUSES = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived', 'on_hold'];
      if (!VALID_CALL_STATUSES.includes(status)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_CALL_STATUSES.join(', ')}`, code: 'INVALID_STATUS' });
        return;
      }
      // Prevent backward transitions from terminal states via direct PUT
      // God Mode: admin bypass — can change status from archived
      const TERMINAL_STATUSES = ['archived'];
      if (TERMINAL_STATUSES.includes(call.status) && status !== 'closed') {
        if (req.user?.role !== 'admin') {
          res.status(400).json({
            error: `Cannot change status from '${call.status}' to '${status}' via update. Use the unarchive endpoint instead.`,
            code: 'INVALID_STATUS_TRANSITION',
          });
          return;
        } else {
          auditLog(req, 'ADMIN_OVERRIDE', 'call', call.id, `Admin God Mode: bypassed archived status transition (${call.status} -> ${status})`);
        }
      }
    }

    // Upgrade 15: Track status_changed_at on every status change
    if (status !== undefined && status !== call.status) {
      // Will be added to updates below
    }

    // Upgrade 16: Validate location_address if being updated
    if (location_address !== undefined && String(location_address).trim().length < 3) {
      res.status(400).json({ error: 'location_address must be at least 3 characters', code: 'ADDRESS_TOO_SHORT' });
      return;
    }

    // Max length validation
    if (location_address && String(location_address).length > 500) {
      res.status(400).json({ error: 'Location address too long (max 500 chars)', code: 'FIELD_TOO_LONG' });
      return;
    }
    if (description && String(description).length > 10000) {
      res.status(400).json({ error: 'Description too long (max 10000 chars)', code: 'FIELD_TOO_LONG' });
      return;
    }

    // Build dynamic SET clause so we only update provided fields
    const updates: string[] = [];
    const params: any[] = [];
    const addField = (col: string, val: any) => {
      if (val !== undefined) { updates.push(`${col} = ?`); params.push(val === '' ? null : val); }
    };

    addField('incident_type', incident_type);
    addField('priority', priority ? String(priority).toUpperCase() : priority);
    addField('status', status);
    addField('caller_name', caller_name);
    addField('caller_phone', caller_phone);
    addField('caller_relationship', caller_relationship);
    addField('location_address', location_address);
    addField('property_id', property_id);
    // Detect address change with no explicit coords — clear stale lat/lng + beat
    // so the async geocoder repopulates them and broadcasts a fresh call_updated.
    // Without this, the map marker stays at the old location forever (gotcha:
    // updated.latitude/longitude flow into geocodeCallIfNeeded below and cause
    // it to bail when the row already has coords).
    const addressChanged =
      location_address !== undefined &&
      location_address !== null &&
      String(location_address).trim() !== String(call.location_address || '').trim();
    const explicitCoordsProvided =
      (latitude !== undefined && latitude !== null && latitude !== '') ||
      (longitude !== undefined && longitude !== null && longitude !== '');
    const shouldRegeocode = addressChanged && !explicitCoordsProvided;

    // Protect lat/lng from being wiped — only update if a real numeric value is provided
    if (latitude !== undefined && latitude !== null && latitude !== '') {
      updates.push('latitude = ?'); params.push(Number(latitude));
    } else if (shouldRegeocode) {
      updates.push('latitude = NULL');
    }
    if (longitude !== undefined && longitude !== null && longitude !== '') {
      updates.push('longitude = ?'); params.push(Number(longitude));
    } else if (shouldRegeocode) {
      updates.push('longitude = NULL');
      // Also clear beat/zone/sector so the geocode callback recomputes them
      // from the new coords (otherwise dispatch routing stays on the old beat).
      updates.push('beat_id = NULL', 'zone_id = NULL', 'sector_id = NULL', 'zone_beat = NULL');
    }
    addField('description', description);
    addField('notes', notes);
    addField('disposition', disposition);
    addField('cross_street', cross_street);
    addField('location_building', location_building);
    addField('location_floor', location_floor);
    addField('location_room', location_room);
    addField('weapons_involved', weapons_involved === 'None' ? null : weapons_involved);
    addField('injuries_reported', injuries_reported !== undefined ? toBoolInt(injuries_reported) : undefined);
    addField('num_subjects', num_subjects);
    addField('subject_description', subject_description);
    addField('vehicle_description', vehicle_description);
    addField('direction_of_travel', direction_of_travel);
    addField('source', source);
    addField('caller_address', caller_address);
    addField('zone_beat', autoZoneBeat);
    addField('sector_id', autoSectionId);
    addField('zone_id', autoZoneId);
    addField('beat_id', autoBeatId);

    // Auto-resolve dispatch_code + district names from S/Z/B IDs
    const finalSectionId = autoSectionId !== undefined ? autoSectionId : call.sector_id;
    const finalZoneId = autoZoneId !== undefined ? autoZoneId : call.zone_id;
    const finalBeatId = autoBeatId !== undefined ? autoBeatId : call.beat_id;
    if (finalSectionId && finalZoneId && finalBeatId) {
      try {
        const districtMatch = db.prepare(`
          SELECT db2.beat_code, db2.beat_name, db2.beat_descriptor,
                 dz.zone_code, dz.zone_name, ds.sector_code, ds.sector_name
          FROM dispatch_beats db2
          JOIN dispatch_zones dz ON dz.id = db2.zone_id
          JOIN dispatch_sectors ds ON ds.id = dz.sector_id
          WHERE ds.sector_code = ? AND dz.zone_code = ? AND db2.beat_code = ? LIMIT 1
        `).get(finalSectionId, finalZoneId, finalBeatId) as any;
        if (districtMatch) {
          // beat_code is already in chart format ("SL1-SLC/A").
          addField('dispatch_code', districtMatch.beat_code);
          addField('sector_name', districtMatch.sector_name);
          addField('zone_name', districtMatch.zone_name);
          addField('beat_name', districtMatch.beat_name);
          addField('beat_descriptor', districtMatch.beat_descriptor);
        } else {
          addField('dispatch_code', `${finalSectionId}-${finalZoneId}/${finalBeatId}`);
        }
      } catch {
        addField('dispatch_code', `${finalSectionId}-${finalZoneId}/${finalBeatId}`);
      }
    } else if ((finalSectionId || finalZoneId) && !call.dispatch_code) {
      // Auto-generate dispatch code from available S/Z/B when not all three are present
      const code = [finalSectionId, finalZoneId, finalBeatId].filter(Boolean).join('-');
      if (code) addField('dispatch_code', code);
    }

    addField('responding_officer', responding_officer);
    addField('secondary_type', secondary_type);
    addField('contact_method', contact_method);
    addField('scene_safety', scene_safety);
    addField('weather_conditions', weather_conditions);
    addField('lighting_conditions', lighting_conditions);
    addField('num_victims', num_victims);
    addField('alcohol_involved', alcohol_involved !== undefined ? toBoolInt(alcohol_involved) : undefined);
    addField('drugs_involved', drugs_involved !== undefined ? toBoolInt(drugs_involved) : undefined);
    addField('domestic_violence', domestic_violence !== undefined ? toBoolInt(domestic_violence) : undefined);
    addField('supervisor_notified', supervisor_notified !== undefined ? toBoolInt(supervisor_notified) : undefined);
    addField('le_notified', le_notified !== undefined ? toBoolInt(le_notified) : undefined);
    addField('le_agency', le_agency === 'None' ? null : le_agency);
    addField('le_case_number', le_case_number);
    addField('case_number', case_number);
    addField('case_id', case_id);
    addField('damage_estimate', damage_estimate);
    addField('damage_description', damage_description);
    addField('action_taken', action_taken);
    addField('starting_mileage', starting_mileage);
    addField('ending_mileage', ending_mileage);
    // Extended operational flags
    addField('mental_health_crisis', mental_health_crisis !== undefined ? toBoolInt(mental_health_crisis) : undefined);
    addField('juvenile_involved', juvenile_involved !== undefined ? toBoolInt(juvenile_involved) : undefined);
    addField('felony_in_progress', felony_in_progress !== undefined ? toBoolInt(felony_in_progress) : undefined);
    addField('officer_safety_caution', officer_safety_caution !== undefined ? toBoolInt(officer_safety_caution) : undefined);
    addField('k9_requested', k9_requested !== undefined ? toBoolInt(k9_requested) : undefined);
    addField('ems_requested', ems_requested !== undefined ? toBoolInt(ems_requested) : undefined);
    addField('fire_requested', fire_requested !== undefined ? toBoolInt(fire_requested) : undefined);
    addField('hazmat', hazmat !== undefined ? toBoolInt(hazmat) : undefined);
    addField('gang_related', gang_related !== undefined ? toBoolInt(gang_related) : undefined);
    addField('evidence_collected', evidence_collected !== undefined ? toBoolInt(evidence_collected) : undefined);
    addField('body_camera_active', body_camera_active !== undefined ? toBoolInt(body_camera_active) : undefined);
    addField('photos_taken', photos_taken !== undefined ? toBoolInt(photos_taken) : undefined);
    addField('trespass_issued', trespass_issued !== undefined ? toBoolInt(trespass_issued) : undefined);
    addField('vehicle_pursuit', vehicle_pursuit !== undefined ? toBoolInt(vehicle_pursuit) : undefined);
    addField('foot_pursuit', foot_pursuit !== undefined ? toBoolInt(foot_pursuit) : undefined);
    // PSO Client Request fields
    addField('pso_service_type', pso_service_type);
    addField('pso_authorization', pso_authorization);
    addField('pso_requestor_name', pso_requestor_name);
    addField('pso_requestor_phone', pso_requestor_phone);
    addField('pso_requestor_email', pso_requestor_email);
    addField('pso_billing_code', pso_billing_code);
    addField('pso_attempt_number', pso_attempt_number);
    // Process Service fields
    addField('process_service_type', process_service_type);
    addField('process_served_to', process_served_to);
    addField('process_served_address', process_served_address);
    addField('process_attempts', process_attempts !== undefined ? (isNaN(Number(process_attempts)) ? null : Number(process_attempts)) : undefined);
    addField('process_served_at', process_served_at);
    addField('process_service_result', process_service_result);
    addField('contract_id', contract_id);
    addField('client_id', resolvedUpdateClientId);

    // ── Admin/Manager timeline override: allow editing dispatch timestamps ──
    if (['admin', 'manager'].includes(req.user?.role || '')) {
      const { dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, created_at: created_at_override, received_at } = req.body;
      const isValidIso = (v: any) => typeof v === 'string' && v.length >= 10 && !isNaN(new Date(v).getTime());
      if (received_at !== undefined) { if (received_at === null || received_at === '') { updates.push('received_at = NULL'); } else if (isValidIso(received_at)) { addField('received_at', received_at); } }
      if (dispatched_at !== undefined) { if (dispatched_at === null || dispatched_at === '') { updates.push('dispatched_at = NULL'); } else if (isValidIso(dispatched_at)) { addField('dispatched_at', dispatched_at); } }
      if (enroute_at !== undefined) { if (enroute_at === null || enroute_at === '') { updates.push('enroute_at = NULL'); } else if (isValidIso(enroute_at)) { addField('enroute_at', enroute_at); } }
      if (onscene_at !== undefined) { if (onscene_at === null || onscene_at === '') { updates.push('onscene_at = NULL'); } else if (isValidIso(onscene_at)) { addField('onscene_at', onscene_at); } }
      if (cleared_at !== undefined) { if (cleared_at === null || cleared_at === '') { updates.push('cleared_at = NULL'); } else if (isValidIso(cleared_at)) { addField('cleared_at', cleared_at); } }
      if (closed_at !== undefined) { if (closed_at === null || closed_at === '') { updates.push('closed_at = NULL'); } else if (isValidIso(closed_at)) { addField('closed_at', closed_at); } }
      if (created_at_override !== undefined && isValidIso(created_at_override)) { addField('created_at', created_at_override); }
    }

    // Upgrade 17: Track status_changed_at on every status change
    if (status !== undefined && status !== call.status) {
      updates.push('status_changed_at = ?');
      params.push(localNow());
    }

    // Upgrade 18: Recalculate priority_score when priority or flags change
    const effectivePriority = (priority !== undefined ? String(priority).toUpperCase() : call.priority) || 'P3';
    const effectiveType = (incident_type !== undefined ? incident_type : call.incident_type) || '';
    const updatedScore = calculatePriorityScore(effectivePriority, effectiveType, {
      weapons_involved: weapons_involved !== undefined ? weapons_involved : call.weapons_involved,
      domestic_violence: domestic_violence !== undefined ? domestic_violence : call.domestic_violence,
      injuries_reported: injuries_reported !== undefined ? injuries_reported : call.injuries_reported,
      felony_in_progress: felony_in_progress !== undefined ? felony_in_progress : call.felony_in_progress,
      officer_safety_caution: officer_safety_caution !== undefined ? officer_safety_caution : call.officer_safety_caution,
      mental_health_crisis: mental_health_crisis !== undefined ? mental_health_crisis : call.mental_health_crisis,
    });
    if (updatedScore !== (call.priority_score || 0)) {
      updates.push('priority_score = ?');
      params.push(updatedScore);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(localNow());
    params.push(req.params.id);
    db.prepare(`UPDATE calls_for_service SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Propagate case_number to all related calls in the chain (parent + siblings)
    if (case_number !== undefined) {
      try {
        const now = localNow();
        // Update children (calls that have this call as parent)
        db.prepare('UPDATE calls_for_service SET case_number = ?, updated_at = ? WHERE parent_call_id = ? AND id != ?')
          .run(case_number || null, now, call.id, call.id);
        // Update parent (if this call has a parent)
        if (call.parent_call_id) {
          db.prepare('UPDATE calls_for_service SET case_number = ?, updated_at = ? WHERE id = ?')
            .run(case_number || null, now, call.parent_call_id);
          // Update siblings (other children of the same parent)
          db.prepare('UPDATE calls_for_service SET case_number = ?, updated_at = ? WHERE parent_call_id = ? AND id != ?')
            .run(case_number || null, now, call.parent_call_id, call.id);
        }
      } catch { /* non-critical — best effort propagation */ }
    }

    // Upgrade 19: Detailed activity log showing what changed
    const changedFields = updates.filter(u => !u.includes('updated_at') && !u.includes('priority_score') && !u.includes('status_changed_at')).map(u => u.split(' = ')[0]);
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_updated', 'call', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated call ${call.call_number}: ${changedFields.join(', ')} (${changedFields.length} field(s))`, req.ip || 'unknown');

    // Return the full enriched row (same JOINs as GET /calls/:id) so the client gets
    // computed fields like property_name, client_name, dispatcher_name, incident_number
    const updated = db.prepare(`
      SELECT c.*, p.name as property_name, p.address as property_address,
        u.full_name as dispatcher_name,
        cl.name as client_name,
        (SELECT i.incident_number FROM incidents i WHERE i.call_id = c.id ORDER BY i.id DESC LIMIT 1) as incident_number,
        (SELECT COUNT(*) FROM call_persons cp
          JOIN persons per ON cp.person_id = per.id
          WHERE cp.call_id = c.id
            AND per.flags IS NOT NULL
            AND per.flags LIKE '%ACTIVE_WARRANT%') as has_active_warrant
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      WHERE c.id = ?
    `).get(req.params.id) as any;

    // If location changed but no coordinates provided, geocode asynchronously
    if (location_address && latitude == null && longitude == null) {
      geocodeCallIfNeeded(updated.id, location_address, updated.latitude, updated.longitude);
    }

    broadcastDispatchUpdate({ action: 'call_updated', call: updated });

    res.json(updated);

    // Non-blocking AI analysis when narrative (description/notes) changed
    const narrativeChanged =
      (description !== undefined && description !== call.description) ||
      (notes !== undefined && notes !== call.notes);

    if (narrativeChanged && isAIAvailable()) {
      const existingFlags: string[] = [];
      if (updated.weapons_involved) existingFlags.push('weapons_involved');
      if (updated.domestic_violence) existingFlags.push('domestic_violence');
      if (updated.mental_health_crisis) existingFlags.push('mental_health_crisis');
      if (updated.felony_in_progress) existingFlags.push('felony_in_progress');
      if (updated.officer_safety_caution) existingFlags.push('officer_safety_caution');
      if (updated.hazmat) existingFlags.push('hazmat');
      if (updated.gang_related) existingFlags.push('gang_related');

      analyzeCall({
        incident_type: updated.incident_type,
        description: updated.description || undefined,
        notes: updated.notes || undefined,
        location_address: updated.location_address || undefined,
        existing_flags: existingFlags,
      }).then((analysis) => {
        if (analysis && analysis.confidence > 0.7 && analysis.safetyBriefing) {
          broadcastDispatchUpdate({
            action: 'ai_analysis',
            call_id: updated.id,
            call_number: updated.call_number,
            analysis,
          });
        }
      }).catch((err) => {
        console.error('AI analysis error (update):', err?.message || err);
      });
    }
  } catch (error: any) {
    console.error('Update call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update call', code: 'UPDATE_CALL_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/redispatch - Re-dispatch creates a NEW linked call
router.post('/calls/:id/redispatch', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const parentCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!parentCall) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    // Allow re-dispatch on PSO and process_service calls
    if (!['pso_client_request', 'process_service'].includes(parentCall.incident_type)) {
      res.status(400).json({ error: 'Re-dispatch is only available for PSO Client Request and Process Service calls', code: 'REDISPATCH_TYPE_INVALID' });
      return;
    }

    // Only allow re-dispatch on completed/inactive calls
    if (!['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(parentCall.status)) {
      res.status(400).json({ error: 'Call must be cleared, closed, cancelled, on hold, or archived to re-dispatch', code: 'CALL_MUST_BE_INACTIVE' });
      return;
    }

    const now = localNow();
    const currentAttempt = parentCall.pso_attempt_number || 1;
    const newAttempt = currentAttempt + 1;

    // Find the root call in the chain (trace back through parent_call_id)
    let rootCallId = parentCall.id;
    let rootCallNumber = parentCall.call_number;
    if (parentCall.parent_call_id) {
      const rootCall = db.prepare('SELECT id, call_number FROM calls_for_service WHERE id = ?').get(parentCall.parent_call_id) as any;
      if (rootCall) { rootCallId = rootCall.id; rootCallNumber = rootCall.call_number; }
    }

    // Snapshot current visit into visit history for the parent call
    let assignedCallSigns: string[] = [];
    try {
      const parsedIds = JSON.parse(parentCall.assigned_unit_ids || '[]');
      const unitIds = (Array.isArray(parsedIds) ? parsedIds : []).filter((id: any) => typeof id === 'number' && !isNaN(id));
      if (unitIds.length) {
        const units = db.prepare(`SELECT call_sign FROM units WHERE id IN (${unitIds.map(() => '?').join(',')}) LIMIT 100`).all(...unitIds) as any[];
        assignedCallSigns = units.map((u: any) => u.call_sign).filter(Boolean);
      }
    } catch (parseErr) { console.error(`[Calls] Failed to parse assigned_unit_ids for redispatch:`, parseErr instanceof Error ? parseErr.message : parseErr); }

    const attemptTime = parentCall.onscene_at || parentCall.cleared_at || parentCall.closed_at || now;
    const { window: timeWindow, isWeekend } = classifyServiceWindow(attemptTime);

    // Save visit history snapshot
    db.prepare(`
      INSERT INTO call_visit_history
        (call_id, visit_number, status, dispatched_at, enroute_at, onscene_at, cleared_at, closed_at,
         assigned_units, responding_vehicle_id, starting_mileage, ending_mileage, disposition, note, created_by, created_at,
         time_window, is_weekend)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parentCall.id, currentAttempt, parentCall.status,
      parentCall.dispatched_at, parentCall.enroute_at, parentCall.onscene_at, parentCall.cleared_at, parentCall.closed_at,
      JSON.stringify(assignedCallSigns), parentCall.responding_vehicle_id || null,
      parentCall.starting_mileage ?? null, parentCall.ending_mileage ?? null,
      parentCall.disposition || null, null, req.user?.fullName || 'Dispatch', now,
      timeWindow, isWeekend ? 1 : 0
    );

    // Generate new call number
    const year = new Date().getFullYear().toString().slice(-2);
    const lastCall = db.prepare(`SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1`).get(`${year}-CFS%`) as any;
    let nextSeq = 1;
    if (lastCall?.call_number) {
      const parsed = parseInt(lastCall.call_number.replace(`${year}-CFS`, ''), 10);
      if (!isNaN(parsed)) nextSeq = parsed + 1;
    }
    const newCallNumber = `${year}-CFS${String(nextSeq).padStart(5, '0')}`;

    const { scheduled_note } = req.body || {};
    const ordinal = (n: number) => { const s = ['th','st','nd','rd']; const v = n%100; return n + (v>=11&&v<=13 ? 'th' : (s[n%10]||s[0])); };
    const noteText = scheduled_note
      ? `Re-dispatch from ${parentCall.call_number} — ${ordinal(newAttempt)} attempt. Note: ${scheduled_note}`
      : `Re-dispatch from ${parentCall.call_number} — ${ordinal(newAttempt)} attempt`;

    const initialNotes = JSON.stringify([{
      id: String(Date.now()),
      author: req.user?.fullName || 'Dispatch',
      text: noteText,
      timestamp: now,
    }]);

    // Create the NEW call linked to parent — copy ALL relevant fields
    const result = db.prepare(`
      INSERT INTO calls_for_service (
        call_number, incident_type, priority, status, source,
        caller_name, caller_phone, caller_relationship, caller_address,
        location_address, property_id, client_id, latitude, longitude,
        cross_street, location_building, location_floor, location_room,
        description, notes, parent_call_id, pso_attempt_number,
        pso_requestor_name, pso_requestor_phone, pso_requestor_email,
        pso_service_type, pso_billing_code, pso_authorization,
        pso_service_windows,
        process_service_type, process_served_to, process_served_address,
        dispatch_code, sector_id, sector_name, zone_id, zone_name,
        beat_id, beat_name, beat_descriptor, contract_id,
        num_subjects, num_victims, direction_of_travel,
        subject_description, vehicle_description,
        scene_safety, weather_conditions, lighting_conditions,
        injuries_reported, alcohol_involved, domestic_violence, drugs_involved,
        weapons_involved, mental_health_crisis, juvenile_involved,
        felony_in_progress, officer_safety_caution, gang_related,
        k9_requested, ems_requested, fire_requested, hazmat,
        case_number, le_agency, le_case_number, le_notified,
        secondary_type, contact_method, tags,
        dispatcher_id, created_at, updated_at, received_at
      ) VALUES (
        ?, ?, ?, 'pending', ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )
    `).run(
      newCallNumber, parentCall.incident_type, parentCall.priority, parentCall.source || 'dispatch',
      parentCall.caller_name, parentCall.caller_phone, parentCall.caller_relationship, parentCall.caller_address,
      parentCall.location_address, parentCall.property_id, parentCall.client_id, parentCall.latitude, parentCall.longitude,
      parentCall.cross_street, parentCall.location_building, parentCall.location_floor, parentCall.location_room,
      parentCall.description, initialNotes, rootCallId, newAttempt,
      parentCall.pso_requestor_name, parentCall.pso_requestor_phone, parentCall.pso_requestor_email,
      parentCall.pso_service_type, parentCall.pso_billing_code, parentCall.pso_authorization,
      parentCall.pso_service_windows,
      parentCall.process_service_type, parentCall.process_served_to, parentCall.process_served_address,
      parentCall.dispatch_code, parentCall.sector_id, parentCall.sector_name, parentCall.zone_id, parentCall.zone_name,
      parentCall.beat_id, parentCall.beat_name, parentCall.beat_descriptor, parentCall.contract_id,
      parentCall.num_subjects, parentCall.num_victims, parentCall.direction_of_travel,
      parentCall.subject_description, parentCall.vehicle_description,
      parentCall.scene_safety, parentCall.weather_conditions, parentCall.lighting_conditions,
      parentCall.injuries_reported, parentCall.alcohol_involved, parentCall.domestic_violence, parentCall.drugs_involved,
      parentCall.weapons_involved, parentCall.mental_health_crisis, parentCall.juvenile_involved,
      parentCall.felony_in_progress, parentCall.officer_safety_caution, parentCall.gang_related,
      parentCall.k9_requested, parentCall.ems_requested, parentCall.fire_requested, parentCall.hazmat,
      parentCall.case_number, parentCall.le_agency, parentCall.le_case_number, parentCall.le_notified,
      parentCall.secondary_type, parentCall.contact_method, parentCall.tags,
      req.user!.userId, now, now, now
    );

    const newCallId = result.lastInsertRowid;

    // Copy linked persons from parent call
    try {
      const parentPersons = db.prepare('SELECT person_id, role, notes FROM call_persons WHERE call_id = ?').all(parentCall.id) as any[];
      const insertPerson = db.prepare('INSERT INTO call_persons (call_id, person_id, role, notes) VALUES (?, ?, ?, ?)');
      for (const p of parentPersons) {
        try { insertPerson.run(newCallId, p.person_id, p.role, p.notes); } catch { /* skip duplicates */ }
      }
    } catch (e) { console.error('[Calls] Copy linked persons for redispatch:', e instanceof Error ? e.message : e); }

    // Copy linked vehicles from parent call
    try {
      const parentVehicles = db.prepare('SELECT vehicle_id, role, notes FROM call_vehicles WHERE call_id = ?').all(parentCall.id) as any[];
      const insertVehicle = db.prepare('INSERT INTO call_vehicles (call_id, vehicle_id, role, notes) VALUES (?, ?, ?, ?)');
      for (const v of parentVehicles) {
        try { insertVehicle.run(newCallId, v.vehicle_id, v.role, v.notes); } catch { /* skip duplicates */ }
      }
    } catch (e) { console.error('[Calls] Copy linked vehicles for redispatch:', e instanceof Error ? e.message : e); }

    // Mark parent call with a back-link note
    let parentNotes: any[] = [];
    try { parentNotes = JSON.parse(parentCall.notes || '[]'); } catch { parentNotes = []; }
    parentNotes.push({
      id: String(Date.now() + 1),
      author: 'System',
      text: `Re-dispatched → new call ${newCallNumber}`,
      timestamp: now,
    });
    db.prepare('UPDATE calls_for_service SET notes = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(parentNotes), now, parentCall.id);

    // Activity log for both calls
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_redispatched', 'call', ?, ?, ?)
    `).run(req.user!.userId, parentCall.id, `Re-dispatched → ${newCallNumber} (${ordinal(newAttempt)} attempt)`, req.ip || 'unknown');

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_created_from_redispatch', 'call', ?, ?, ?)
    `).run(req.user!.userId, newCallId, `Created from re-dispatch of ${parentCall.call_number} (${ordinal(newAttempt)} attempt)`, req.ip || 'unknown');

    // Auto-send to serve queue if applicable
    try {
      const newCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(newCallId) as any;
      if (newCall) createServeQueueFromCall(db, newCall, req.user!.userId);
    } catch (e) { console.error('[Calls] Auto-send to serve queue error:', e instanceof Error ? e.message : e); }

    const newCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(newCallId) as any;
    // Collect full chain for response
    const chainCalls = db.prepare(`
      SELECT id, call_number, status, pso_attempt_number, created_at, cleared_at, disposition, parent_call_id
      FROM calls_for_service WHERE id = ? OR parent_call_id = ? ORDER BY pso_attempt_number ASC, id ASC
    `).all(rootCallId, rootCallId) as any[];

    broadcastDispatchUpdate({ action: 'call_created', call: newCall });
    broadcastDispatchUpdate({ action: 'call_updated', call: parentCall }); // update parent notes

    res.status(201).json({
      ...newCall,
      chain: chainCalls,
      parent_call_number: parentCall.call_number,
    });
  } catch (error: any) {
    console.error('Re-dispatch call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to re-dispatch call', code: 'REDISPATCH_CALL_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/undo-redispatch - Undo a return visit (delete child, restore parent)
router.post('/calls/:id/undo-redispatch', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const childCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!childCall) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    if (!childCall.parent_call_id) {
      res.status(400).json({ error: 'This call is not a re-dispatch — it has no parent call', code: 'NOT_A_REDISPATCH' });
      return;
    }

    // Only allow undo on pending/new calls that haven't been worked yet
    if (!['pending'].includes(childCall.status) && req.user?.role !== 'admin') {
      res.status(400).json({ error: 'Can only undo a return visit that is still pending. Once dispatched, it cannot be undone.', code: 'CHILD_NOT_PENDING' });
      return;
    }
    if (req.user?.role === 'admin' && !['pending'].includes(childCall.status)) {
      auditLog(req, 'ADMIN_OVERRIDE', 'call', childCall.id, `Admin God Mode: bypassed pending-only undo-redispatch restriction (status: ${childCall.status})`);
    }

    const parentCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(childCall.parent_call_id) as any;
    if (!parentCall) {
      res.status(404).json({ error: 'Parent call not found', code: 'PARENT_NOT_FOUND' });
      return;
    }

    const now = localNow();

    const undoTx = db.transaction(() => {
      // Delete the child call's related records
      db.prepare('DELETE FROM call_persons WHERE call_id = ?').run(childCall.id);
      db.prepare('DELETE FROM call_vehicles WHERE call_id = ?').run(childCall.id);
      db.prepare('DELETE FROM call_units WHERE call_id = ?').run(childCall.id);
      db.prepare('DELETE FROM serve_queue WHERE call_id = ?').run(childCall.id);

      // Delete the child call itself
      db.prepare('DELETE FROM calls_for_service WHERE id = ?').run(childCall.id);

      // Remove the last visit history entry for the parent (the snapshot created during redispatch)
      const lastVisit = db.prepare(
        'SELECT id FROM call_visit_history WHERE call_id = ? ORDER BY visit_number DESC LIMIT 1'
      ).get(parentCall.id) as any;
      if (lastVisit) {
        db.prepare('DELETE FROM call_visit_history WHERE id = ?').run(lastVisit.id);
      }

      // Remove the "Re-dispatched → new call" note from parent
      let parentNotes: any[] = [];
      try { parentNotes = JSON.parse(parentCall.notes || '[]'); } catch { parentNotes = []; }
      parentNotes = parentNotes.filter((n: any) => !n.text?.includes(`Re-dispatched → new call ${childCall.call_number}`));
      parentNotes.push({
        id: String(Date.now()),
        author: req.user?.fullName || 'System',
        text: `Return visit ${childCall.call_number} was undone`,
        timestamp: now,
      });
      db.prepare('UPDATE calls_for_service SET notes = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(parentNotes), now, parentCall.id);

      // Activity log
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'undo_redispatch', 'call', ?, ?, ?)
      `).run(req.user!.userId, parentCall.id, `Undid return visit ${childCall.call_number} for ${parentCall.call_number}`, req.ip || 'unknown');
    });
    undoTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(parentCall.id) as any;
    broadcastDispatchUpdate({ action: 'call_deleted', call: { id: childCall.id, call_number: childCall.call_number } });
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });

    res.json({ success: true, parent: updated, deleted_call: childCall.call_number });
  } catch (error: any) {
    console.error('Undo redispatch error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to undo return visit', code: 'UNDO_REDISPATCH_ERROR' });
  }
});

// GET /api/dispatch/calls/:id/visit-history - Get visit history for a PSO call
router.get('/calls/:id/visit-history', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, incident_type FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }
    const history = db.prepare('SELECT * FROM call_visit_history WHERE call_id = ? ORDER BY visit_number ASC').all(req.params.id);
    res.json(history);
  } catch (error: any) {
    console.error('Visit history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to visit history', code: 'VISIT_HISTORY_ERROR' });
  }
});

// GET /api/dispatch/calls/:id/pso-compliance - Check PSO service window compliance
router.get('/calls/:id/pso-compliance', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, incident_type, pso_service_windows, pso_attempt_number, pso_72hr_deadline, created_at FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }
    if (call.incident_type !== 'pso_client_request') {
      res.status(400).json({ error: 'Not a PSO call', code: 'NOT_A_PSO_CALL' });
      return;
    }

    let windows = { early_morning: false, daytime: false, evening: false, weekend: false };
    if (call.pso_service_windows) {
      try { windows = JSON.parse(call.pso_service_windows); } catch (parseErr) { console.error('[Calls] Failed to parse PSO service windows:', parseErr instanceof Error ? parseErr.message : parseErr); }
    }

    const compliant = windows.early_morning && windows.daytime && windows.evening && windows.weekend;

    // Calculate 72-hour deadline from call creation
    const createdAt = new Date(call.created_at);
    const deadline72hr = new Date(createdAt.getTime() + 72 * 60 * 60 * 1000);
    const now = new Date();
    const hoursRemaining = Math.max(0, (deadline72hr.getTime() - now.getTime()) / (60 * 60 * 1000));

    // Get visit history with time windows
    const visits = db.prepare('SELECT visit_number, time_window, is_weekend, onscene_at, cleared_at, disposition FROM call_visit_history WHERE call_id = ? ORDER BY visit_number ASC').all(req.params.id);

    res.json({
      compliant,
      windows,
      missing: [
        ...(!windows.early_morning ? ['6AM-9AM attempt'] : []),
        ...(!windows.daytime ? ['9AM-6PM attempt'] : []),
        ...(!windows.evening ? ['6PM-9PM attempt'] : []),
        ...(!windows.weekend ? ['weekend attempt'] : []),
      ],
      attempt_number: call.pso_attempt_number || 1,
      deadline_72hr: deadline72hr.toISOString(),
      hours_remaining: Math.round(hoursRemaining * 10) / 10,
      visits,
    });
  } catch (error: any) {
    console.error('PSO compliance check error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to pso compliance check', code: 'PSO_COMPLIANCE_CHECK_ERROR' });
  }
});

// ── Feature 3: Call tag system ──────────────────────────────────────
const VALID_CALL_TAGS = ['domestic', 'weapons', 'officer_safety', 'juvenile', 'mental_health', 'gang', 'drugs', 'dv_restraining_order', 'hazmat', 'barricade'];

// PUT /api/dispatch/calls/:id/tags - Update tags on a call
router.put('/calls/:id/tags', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }

    const { tags } = req.body;
    if (!Array.isArray(tags)) { res.status(400).json({ error: 'tags must be an array', code: 'TAGS_MUST_BE_AN' }); return; }

    // Validate each tag
    const validTags = tags.filter((t: string) => VALID_CALL_TAGS.includes(t));

    db.prepare('UPDATE calls_for_service SET tags = ? WHERE id = ?').run(JSON.stringify(validTags), call.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: { ...call, tags: JSON.stringify(validTags) } });

    res.json({ success: true, tags: validTags });
  } catch (error: any) {
    console.error('Update call tags error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update call tags', code: 'UPDATE_CALL_TAGS_ERROR' });
  }
});

// ── Feature 5: Shift handoff notes ─────────────────────────────────
// GET /api/dispatch/shift-handoff - Get current handoff notes
router.get('/shift-handoff', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT config_value FROM system_config WHERE config_key = 'shift_handoff_notes' ORDER BY updated_at DESC LIMIT 1").get() as any;
    const notes = row ? JSON.parse(row.config_value) : { text: '', updated_by: '', updated_at: '' };
    res.json(notes);
  } catch (error: any) {
    console.error('Get shift handoff error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get shift handoff', code: 'GET_SHIFT_HANDOFF_ERROR' });
  }
});

// PUT /api/dispatch/shift-handoff - Save handoff notes
router.put('/shift-handoff', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { text } = req.body;
    const now = localNow();
    const value = JSON.stringify({
      text: text || '',
      updated_by: req.user?.fullName || 'Unknown',
      updated_by_id: req.user?.userId,
      updated_at: now,
    });

    // Upsert
    const existing = db.prepare("SELECT id FROM system_config WHERE config_key = 'shift_handoff_notes'").get() as any;
    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ?, updated_at = ? WHERE id = ?").run(value, now, existing.id);
    } else {
      db.prepare("INSERT INTO system_config (config_key, config_value, category, updated_at) VALUES ('shift_handoff_notes', ?, 'dispatch', ?)").run(value, now);
    }

    broadcastDispatchUpdate({ action: 'shift_handoff_updated', notes: JSON.parse(value) });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Save shift handoff error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to save shift handoff', code: 'SAVE_SHIFT_HANDOFF_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 20: POST /api/dispatch/calls/bulk-status — Bulk status update
// ═══════════════════════════════════════════════════════════
router.post('/calls/bulk-status', requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_ids, status, disposition } = req.body;

    if (!call_ids || !Array.isArray(call_ids) || call_ids.length === 0) {
      res.status(400).json({ error: 'call_ids array is required', code: 'CALLIDS_REQUIRED' });
      return;
    }
    // God Mode: admin bypass
    if (req.user?.role !== 'admin' && call_ids.length > 200) {
      res.status(400).json({ error: 'Cannot update more than 200 calls at once', code: 'TOO_MANY_CALLS' });
      return;
    }
    if (!status) {
      res.status(400).json({ error: 'status is required', code: 'STATUS_REQUIRED' });
      return;
    }

    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'INVALID_STATUS' });
      return;
    }

    // Upgrade 21: Disposition required for clearing/closing in bulk
    // (Falls back to each call's existing disposition if not provided in bulk request)
    const requiresDisposition = ['cleared', 'closed'].includes(status);
    // No longer rejecting — will inherit from existing call.disposition per call

    const now = localNow();
    const timestampField: Record<string, string> = {
      dispatched: 'dispatched_at', enroute: 'enroute_at', onscene: 'onscene_at',
      cleared: 'cleared_at', closed: 'closed_at',
    };
    const tsField = timestampField[status];

    let updatedCount = 0;
    const bulkTx = db.transaction(() => {
      for (const callId of call_ids) {
        const id = parseInt(String(callId), 10);
        if (isNaN(id) || id < 1) continue;

        const call = db.prepare('SELECT id, call_number, status, disposition FROM calls_for_service WHERE id = ?').get(id) as any;
        if (!call || call.status === 'archived') continue;

        // For clear/close, require a disposition (from request or existing on call)
        const resolvedDisposition = disposition || call.disposition;
        if (requiresDisposition && !resolvedDisposition) continue; // skip calls without disposition

        let updateSql = `UPDATE calls_for_service SET status = ?, status_changed_at = ?, updated_at = ?`;
        const updateParams: any[] = [status, now, now];

        if (tsField) {
          updateSql += `, ${tsField} = COALESCE(${tsField}, ?)`;
          updateParams.push(now);
        }
        if (resolvedDisposition) {
          updateSql += `, disposition = ?`;
          updateParams.push(resolvedDisposition);
        }
        updateSql += ` WHERE id = ?`;
        updateParams.push(id);

        db.prepare(updateSql).run(...updateParams);

        // Upgrade 22: Free units when bulk-clearing/closing
        if (['cleared', 'closed', 'cancelled'].includes(status)) {
          const fullCall = db.prepare('SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?').get(id) as any;
          let unitIds: number[] = [];
          try { unitIds = JSON.parse(fullCall?.assigned_unit_ids || '[]'); } catch { /* ignore */ }
          for (const unitId of unitIds) {
            db.prepare(`UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?`)
              .run(now, unitId, id);
          }
        }

        updatedCount++;
      }

      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'bulk_status_update', 'call', 0, ?, ?)`).run(
        req.user!.userId, `Bulk status update: ${updatedCount} call(s) set to ${status}`, req.ip || 'unknown');
    });
    bulkTx();

    broadcastDispatchUpdate({ action: 'calls_bulk_updated', count: updatedCount, status });
    res.json({ updated_count: updatedCount, status });
  } catch (error: any) {
    console.error('Bulk status update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to bulk update', code: 'BULK_STATUS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 23: GET /api/dispatch/calls/search — Full-text search
// ═══════════════════════════════════════════════════════════
router.get('/calls/search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, limit: limitStr = '25' } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters', code: 'QUERY_TOO_SHORT' });
      return;
    }

    const searchLimit = Math.min(100000, Math.max(1, (parseInt(limitStr as string, 10)) || 100000));
    const term = `%${escapeLike(String(q).trim())}%`;

    // Upgrade 24: Search across call_number, location_address, narrative/notes, caller info, description, disposition
    const results = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status, c.location_address,
        c.caller_name, c.description, c.disposition, c.created_at, c.notes,
        c.priority_score
      FROM calls_for_service c
      WHERE c.call_number LIKE ? ESCAPE '\\'
         OR c.location_address LIKE ? ESCAPE '\\'
         OR c.description LIKE ? ESCAPE '\\'
         OR c.notes LIKE ? ESCAPE '\\'
         OR c.caller_name LIKE ? ESCAPE '\\'
         OR c.caller_phone LIKE ? ESCAPE '\\'
         OR c.disposition LIKE ? ESCAPE '\\'
         OR c.case_number LIKE ? ESCAPE '\\'
         OR c.subject_description LIKE ? ESCAPE '\\'
         OR c.vehicle_description LIKE ? ESCAPE '\\'
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(term, term, term, term, term, term, term, term, term, term, searchLimit) as any[];

    // Upgrade 25: Highlight which field matched
    const enriched = results.map(r => {
      const matchedFields: string[] = [];
      const qLower = String(q).trim().toLowerCase();
      if (r.call_number && r.call_number.toLowerCase().includes(qLower)) matchedFields.push('call_number');
      if (r.location_address && r.location_address.toLowerCase().includes(qLower)) matchedFields.push('location_address');
      if (r.description && r.description.toLowerCase().includes(qLower)) matchedFields.push('description');
      if (r.notes && r.notes.toLowerCase().includes(qLower)) matchedFields.push('notes');
      if (r.caller_name && r.caller_name.toLowerCase().includes(qLower)) matchedFields.push('caller_name');
      if (r.disposition && r.disposition.toLowerCase().includes(qLower)) matchedFields.push('disposition');
      return { ...r, _matched_fields: matchedFields };
    });

    res.json({ results: enriched, count: enriched.length, query: q });
  } catch (error: any) {
    console.error('Call search error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to search calls', code: 'SEARCH_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 26: GET /api/dispatch/calls/stats/response-times — Response time analytics
// ═══════════════════════════════════════════════════════════
router.get('/calls/stats/response-times', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Upgrade 27: Average response time by priority
    const byPriority = db.prepare(`
      SELECT priority,
        COUNT(*) as call_count,
        ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60), 1) as avg_response_min,
        ROUND(MIN((julianday(onscene_at) - julianday(created_at)) * 24 * 60), 1) as min_response_min,
        ROUND(MAX((julianday(onscene_at) - julianday(created_at)) * 24 * 60), 1) as max_response_min
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND created_at >= ?
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 > 0
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 < 720
      GROUP BY priority
      ORDER BY priority
    `).all(cutoff);

    // Upgrade 28: Average response time by incident type (top 15)
    const byType = db.prepare(`
      SELECT incident_type,
        COUNT(*) as call_count,
        ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60), 1) as avg_response_min
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND created_at >= ?
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 > 0
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 < 720
      GROUP BY incident_type
      ORDER BY call_count DESC
      LIMIT 15
    `).all(cutoff);

    // Upgrade 29: Overall average
    const overall = db.prepare(`
      SELECT
        COUNT(*) as total_calls,
        ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60), 1) as avg_response_min,
        ROUND(AVG((julianday(dispatched_at) - julianday(created_at)) * 24 * 60), 1) as avg_dispatch_delay_min,
        ROUND(AVG((julianday(onscene_at) - julianday(dispatched_at)) * 24 * 60), 1) as avg_travel_time_min
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND created_at >= ?
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 > 0
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 < 720
    `).get(cutoff) as any;

    // Upgrade 30: Response time trend by day
    const dailyTrend = db.prepare(`
      SELECT DATE(created_at) as date,
        COUNT(*) as call_count,
        ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60), 1) as avg_response_min
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND created_at >= ?
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 > 0
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 < 720
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(cutoff);

    res.json({
      period_days: days,
      overall: overall || {},
      by_priority: byPriority,
      by_type: byType,
      daily_trend: dailyTrend,
    });
  } catch (error: any) {
    console.error('Response time stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get response time stats', code: 'RESPONSE_TIME_STATS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 31: GET /api/dispatch/calls/stats/by-hour — Calls by hour distribution
// ═══════════════════════════════════════════════════════════
router.get('/calls/stats/by-hour', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as call_count,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1_count,
        SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) as p2_count
      FROM calls_for_service
      WHERE created_at >= ?
      GROUP BY hour
      ORDER BY hour
    `).all(cutoff);

    // Upgrade 32: Calls by day of week
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byDay = db.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) as dow,
        COUNT(*) as call_count
      FROM calls_for_service
      WHERE created_at >= ?
      GROUP BY dow
      ORDER BY dow
    `).all(cutoff) as any[];

    const byDayNamed = byDay.map(d => ({ day: DAY_NAMES[d.dow], dow: d.dow, call_count: d.call_count }));

    // Upgrade 33: Calls by type distribution
    const byType = db.prepare(`
      SELECT incident_type, COUNT(*) as call_count
      FROM calls_for_service
      WHERE created_at >= ? AND incident_type IS NOT NULL AND incident_type != ''
      GROUP BY incident_type
      ORDER BY call_count DESC
      LIMIT 25
    `).all(cutoff);

    // Upgrade 34: Calls by source
    const bySource = db.prepare(`
      SELECT source, COUNT(*) as call_count
      FROM calls_for_service
      WHERE created_at >= ? AND source IS NOT NULL AND source != ''
      GROUP BY source
      ORDER BY call_count DESC
    `).all(cutoff);

    res.json({
      period_days: days,
      by_hour: byHour,
      by_day: byDayNamed,
      by_type: byType,
      by_source: bySource,
    });
  } catch (error: any) {
    console.error('Calls by hour stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get hourly stats', code: 'HOURLY_STATS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 35: GET /api/dispatch/calls/stats/summary — Quick summary stats
// ═══════════════════════════════════════════════════════════
router.get('/calls/stats/summary', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    // Upgrade 36: Active calls count by status
    const activeCounts = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene', 'on_hold')
      GROUP BY status
    `).all();

    // Upgrade 37: Today's call volume
    const todayVolume = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1,
        SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) as p2,
        SUM(CASE WHEN status IN ('cleared', 'closed') THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    // Upgrade 38: Average time calls stay pending (queue wait time)
    const avgQueueWait = db.prepare(`
      SELECT ROUND(AVG((julianday(dispatched_at) - julianday(created_at)) * 24 * 60), 1) as avg_wait_min
      FROM calls_for_service
      WHERE dispatched_at IS NOT NULL AND DATE(created_at) = DATE('now', 'localtime')
        AND (julianday(dispatched_at) - julianday(created_at)) * 24 * 60 > 0
        AND (julianday(dispatched_at) - julianday(created_at)) * 24 * 60 < 720
    `).get() as any;

    // Upgrade 39: Oldest pending call age in minutes
    const oldestPending = db.prepare(`
      SELECT call_number, created_at,
        ROUND((julianday('now', 'localtime') - julianday(created_at)) * 24 * 60, 0) as age_minutes
      FROM calls_for_service
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `).get() as any;

    // Upgrade 40: Available unit count
    const availableUnits = db.prepare(`
      SELECT COUNT(*) as count FROM units WHERE status = 'available'
    `).get() as any;

    res.json({
      active_by_status: activeCounts,
      today: todayVolume || {},
      avg_queue_wait_min: avgQueueWait?.avg_wait_min || null,
      oldest_pending: oldestPending || null,
      available_units: availableUnits?.count || 0,
      generated_at: now,
    });
  } catch (error: any) {
    console.error('Call summary stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get summary stats', code: 'SUMMARY_STATS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 41: GET /api/dispatch/calls/:id/notes-analysis — Note/narrative analysis
// ═══════════════════════════════════════════════════════════
router.get('/calls/:id/notes-analysis', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, notes, description, narrative FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    // Upgrade 42: Word count and note count
    let noteCount = 0;
    let totalWordCount = 0;
    let latestNote: any = null;
    let earliestNote: any = null;

    if (call.notes) {
      try {
        const parsed = JSON.parse(call.notes);
        if (Array.isArray(parsed)) {
          noteCount = parsed.length;
          for (const n of parsed) {
            const text = String(n.text || '');
            totalWordCount += text.split(/\s+/).filter(Boolean).length;
          }
          if (parsed.length > 0) {
            latestNote = parsed[parsed.length - 1];
            earliestNote = parsed[0];
          }
        }
      } catch { /* not JSON array */ }
    }

    // Upgrade 43: Description and narrative word counts
    const descriptionWordCount = (call.description || '').split(/\s+/).filter(Boolean).length;
    const narrativeWordCount = (call.narrative || '').split(/\s+/).filter(Boolean).length;

    // Upgrade 44: Timeline entry count
    const timelineCount = db.prepare(
      "SELECT COUNT(*) as count FROM activity_log WHERE entity_type = 'call' AND entity_id = ?"
    ).get(call.id) as any;

    res.json({
      note_count: noteCount,
      notes_word_count: totalWordCount,
      description_word_count: descriptionWordCount,
      narrative_word_count: narrativeWordCount,
      total_word_count: totalWordCount + descriptionWordCount + narrativeWordCount,
      timeline_entry_count: timelineCount?.count || 0,
      latest_note: latestNote,
      earliest_note: earliestNote,
    });
  } catch (error: any) {
    console.error('Notes analysis error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to analyze notes', code: 'NOTES_ANALYSIS_ERROR' });
  }
});

// GET /api/dispatch/calls/:id/risk-score - Recalculate risk score for a call
router.get('/calls/:id/risk-score', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }

    const riskScore = computeRiskScore(call.id);
    db.prepare('UPDATE calls_for_service SET risk_score = ? WHERE id = ?').run(riskScore, call.id);

    res.json({ call_id: call.id, risk_score: riskScore });
  } catch (error: any) {
    console.error('[Calls] Risk score error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to compute risk score', code: 'RISK_SCORE_ERROR' });
  }
});

export default router;
