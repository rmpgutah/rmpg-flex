import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { generateCallNumber } from '../../utils/caseNumbers';
import { sendCsv } from '../../utils/csvExport';
import { localNow } from '../../utils/timeUtils';
import { geocodeCallIfNeeded } from '../../utils/geocode';
import { identifyBeat } from '../../utils/geofence';
import { broadcastDispatchUpdate } from '../../utils/websocket';
import { createNotificationForRoles } from '../notifications';

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
      archived,
      page = '1',
      limit = '50',
    } = req.query;

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
    if (propertyId) {
      whereClause += ' AND c.property_id = ?';
      params.push(propertyId);
    }

    // Archive filter: exclude archived calls by default, include only when requested
    if (archived === 'true') {
      whereClause += " AND c.status = 'archived'";
    } else if (archived !== 'all') {
      whereClause += " AND c.status != 'archived'";
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM calls_for_service c ${whereClause}`).get(...params) as any;

    const calls = db.prepare(`
      SELECT c.*, p.name as property_name, u.full_name as dispatcher_name,
        cl.name as client_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      ${whereClause}
      ORDER BY
        ${archived === 'true'
          ? 'c.call_number DESC'
          : "CASE c.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END, c.created_at DESC"
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
    res.status(500).json({ error: 'Internal server error' });
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
      section_id, zone_id, beat_id,
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
      client_id: requestClientId,
      // Historical entry fields (optional)
      created_at: customCreatedAt,
      status: customStatus,
      dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, archived_at,
      disposition: customDisposition,
    } = req.body;

    if (!incident_type || !priority || !location_address) {
      res.status(400).json({ error: 'incident_type, priority, and location_address are required' });
      return;
    }

    // Input length validation for critical text fields
    const MAX_LENGTHS: Record<string, number> = {
      incident_type: 100, location_address: 500, description: 5000, notes: 5000,
      caller_name: 200, caller_phone: 50, caller_address: 500,
      subject_description: 2000, vehicle_description: 2000, direction_of_travel: 200,
      damage_description: 2000, action_taken: 5000, le_agency: 200, le_case_number: 100,
    };
    for (const [field, maxLen] of Object.entries(MAX_LENGTHS)) {
      const val = req.body[field];
      if (val && typeof val === 'string' && val.length > maxLen) {
        res.status(400).json({ error: `${field} exceeds maximum length of ${maxLen} characters` });
        return;
      }
    }

    // Normalize and validate priority against CHECK constraint (P1, P2, P3, P4)
    const normalizedPriority = String(priority).toUpperCase();
    const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
    if (!VALID_PRIORITIES.includes(normalizedPriority)) {
      res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });
      return;
    }

    // Generate call number: CFS-YYYY-NNNNN
    const callNumber = generateCallNumber(db);

    // Determine status — allow historical entries to set any valid status
    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
    const status = customStatus && validStatuses.includes(customStatus) ? customStatus : 'pending';

    // Auto-resolve client_id from property if not provided
    let resolvedClientId = requestClientId || null;
    if (!resolvedClientId && property_id) {
      const prop = db.prepare('SELECT client_id FROM properties WHERE id = ?').get(property_id) as any;
      if (prop) resolvedClientId = prop.client_id;
    }

    // ── Auto-fill Beat / Zone / Sector from GPS coordinates + 3-Tier dispatch districts ──
    let autoZoneBeat = zone_beat || null;
    let autoSectionId = section_id || null;
    let autoZoneId = zone_id || null;
    let autoBeatId = beat_id || null;
    let autoDispatchCode: string | null = null;
    let autoSectionName: string | null = null;
    let autoZoneName: string | null = null;
    let autoBeatName: string | null = null;
    let autoBeatDescriptor: string | null = null;
    if (latitude && longitude) {
      try {
        const beat = identifyBeat(Number(latitude), Number(longitude));
        if (beat) {
          if (!autoZoneBeat) autoZoneBeat = beat.beat_code;

          // Look up 3-tier dispatch district for richer naming
          const district = db.prepare(
            'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
          ).get(beat.city_code, beat.district_letter) as any;

          if (district) {
            if (!autoSectionId) autoSectionId = district.section_id;
            if (!autoZoneId) autoZoneId = district.zone_id;
            if (!autoBeatId) autoBeatId = district.beat_id;
            autoDispatchCode = district.dispatch_code;
            autoSectionName = district.section_name;
            autoZoneName = district.zone_name;
            autoBeatName = district.beat_name;
            autoBeatDescriptor = district.beat_descriptor;
          } else {
            // Fallback to raw geofence data
            if (!autoBeatId) autoBeatId = beat.beat_id;
            if (!autoZoneId) autoZoneId = `${beat.city} ${beat.district_letter}${beat.beat_number}`;
            if (!autoSectionId) autoSectionId = beat.district_letter;
          }
        }
      } catch { /* geofence not configured, skip */ }
    }

    // Transaction: insert call + activity log atomically
    const createCallTx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO calls_for_service (call_number, incident_type, priority, status, caller_name, caller_phone,
          caller_relationship, caller_address, location_address, property_id, latitude, longitude, description, notes, source, dispatcher_id,
          cross_street, location_building, location_floor, location_room, zone_beat,
          section_id, zone_id, beat_id, dispatch_code,
          section_name, zone_name, beat_name, beat_descriptor,
          weapons_involved, injuries_reported, num_subjects, num_victims,
          subject_description, vehicle_description, direction_of_travel,
          scene_safety, weather_conditions, lighting_conditions,
          alcohol_involved, drugs_involved, domestic_violence,
          supervisor_notified, le_notified, le_agency, le_case_number,
          damage_estimate, damage_description, responding_officer, action_taken,
          mental_health_crisis, juvenile_involved, felony_in_progress, officer_safety_caution,
          k9_requested, ems_requested, fire_requested, hazmat,
          gang_related, evidence_collected, body_camera_active, photos_taken,
          trespass_issued, vehicle_pursuit, foot_pursuit,
          pso_service_type, pso_authorization, pso_requestor_name,
          pso_requestor_phone, pso_requestor_email, pso_billing_code, pso_attempt_number,
          process_service_type, process_served_to, process_served_address,
          contract_id, client_id,
          created_at, dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, archived_at, disposition)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callNumber, incident_type, normalizedPriority, status, caller_name || null, caller_phone || null,
        caller_relationship || null, caller_address || null, location_address, property_id || null,
        latitude ?? null, longitude ?? null, description || null, notes || null,
        source || 'phone', req.user!.userId,
        cross_street || null, location_building || null, location_floor || null, location_room || null, autoZoneBeat,
        autoSectionId, autoZoneId, autoBeatId, autoDispatchCode,
        autoSectionName, autoZoneName, autoBeatName, autoBeatDescriptor,
        (weapons_involved && weapons_involved !== 'None') ? weapons_involved : null, toBoolInt(injuries_reported), num_subjects ?? null, num_victims ?? null,
        subject_description || null, vehicle_description || null, direction_of_travel || null,
        scene_safety || null, weather_conditions || null, lighting_conditions || null,
        toBoolInt(alcohol_involved), toBoolInt(drugs_involved), toBoolInt(domestic_violence),
        toBoolInt(supervisor_notified), toBoolInt(le_notified), (le_agency && le_agency !== 'None') ? le_agency : null, le_case_number || null,
        damage_estimate ?? null, damage_description || null, responding_officer || null, action_taken || null,
        toBoolInt(mental_health_crisis), toBoolInt(juvenile_involved), toBoolInt(felony_in_progress), toBoolInt(officer_safety_caution),
        toBoolInt(k9_requested), toBoolInt(ems_requested), toBoolInt(fire_requested), toBoolInt(hazmat),
        toBoolInt(gang_related), toBoolInt(evidence_collected), toBoolInt(body_camera_active), toBoolInt(photos_taken),
        toBoolInt(trespass_issued), toBoolInt(vehicle_pursuit), toBoolInt(foot_pursuit),
        pso_service_type || null, pso_authorization || null, pso_requestor_name || null,
        pso_requestor_phone || null, pso_requestor_email || null, pso_billing_code || null, createAttemptNumber ?? 1,
        process_service_type || null, process_served_to || null, process_served_address || null,
        contract_id || null, resolvedClientId,
        // created_at: use custom timestamp for historical entries, otherwise current time
        customCreatedAt || localNow(),
        dispatched_at || null, enroute_at || null, onscene_at || null,
        cleared_at || null, closed_at || null, archived_at || null,
        customDisposition || null,
      );

      const call = (db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(result.lastInsertRowid) as any) || { id: result.lastInsertRowid };

      // Log activity
      const isHistorical = !!customCreatedAt;
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_created', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `${isHistorical ? 'Historical entry: ' : 'Created '}${callNumber}: ${incident_type}`, req.ip || 'unknown');

      return call;
    });
    const call = createCallTx();

    // If no coordinates were provided, geocode the address asynchronously
    geocodeCallIfNeeded(call.id, location_address, latitude, longitude);

    // Broadcast to dispatch channel
    broadcastDispatchUpdate({ action: 'call_created', call });

    res.status(201).json(call);

    // Notify after response — non-fatal: a notification failure must never block
    // the 201 or cause an unhandled rejection in a completed handler.
    try {
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
    } catch (notifErr: any) {
      console.error('[Call Create] Non-fatal notification error:', notifErr?.message ?? notifErr);
    }
  } catch (error: any) {
    console.error('Create call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/export - Export calls as CSV
router.get('/calls/export', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, priority, startDate, endDate } = req.query;

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
    res.status(500).json({ error: 'Internal server error' });
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
        AND UPPER(REPLACE(location_address, '  ', ' ')) LIKE ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(`%${normalized}%`) as any[];

    res.json({ duplicates, count: duplicates.length });
  } catch (error: any) {
    console.error('Duplicate check error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/:id - Get single call with details
router.get('/calls/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    // Get assigned units with officer info
    let assignedUnits: any[] = [];
    try {
      const parsed = JSON.parse(call.assigned_unit_ids || '[]');
      const unitIds = Array.isArray(parsed) ? parsed : [];
      if (unitIds.length > 0) {
        const placeholders = unitIds.map(() => '?').join(',');
        assignedUnits = db.prepare(`
          SELECT u.*, usr.full_name as officer_name, usr.badge_number
          FROM units u
          LEFT JOIN users usr ON u.officer_id = usr.id
          WHERE u.id IN (${placeholders})
        `).all(...unitIds);
      }
    } catch { /* ignore parse errors */ }

    // Get related incidents
    const incidents = db.prepare(`
      SELECT id, incident_number, incident_type, status, created_at
      FROM incidents WHERE call_id = ?
    `).all(call.id);

    // Get activity log for this call
    const activity = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'call' AND al.entity_id = ?
      ORDER BY al.created_at DESC
    `).all(call.id);

    // Attach visit history for PSO calls
    let visit_history: any[] = [];
    if (call.incident_type === 'pso_client_request') {
      visit_history = db.prepare('SELECT * FROM call_visit_history WHERE call_id = ? ORDER BY visit_number ASC').all(call.id) as any[];
    }

    res.json({
      ...call,
      assigned_units: assignedUnits,
      related_incidents: incidents,
      activity,
      visit_history,
    });
  } catch (error: any) {
    console.error('Get call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/calls/:id - Update call
router.put('/calls/:id', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const {
      incident_type, priority, status, caller_name, caller_phone, caller_relationship,
      location_address, property_id, latitude, longitude, description, notes, disposition,
      cross_street, location_building, location_floor, location_room,
      weapons_involved, injuries_reported, num_subjects,
      subject_description, vehicle_description, direction_of_travel,
      source, caller_address, zone_beat, section_id, zone_id, beat_id, responding_officer, secondary_type,
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
    let autoSectionId = section_id;
    let autoZoneId = zone_id;
    let autoBeatId = beat_id;
    const effectiveLat = latitude !== undefined ? latitude : call.latitude;
    const effectiveLng = longitude !== undefined ? longitude : call.longitude;
    if (effectiveLat && effectiveLng && (latitude !== undefined || (!call.beat_id && !call.zone_id))) {
      try {
        const beat = identifyBeat(Number(effectiveLat), Number(effectiveLng));
        if (beat) {
          if (autoZoneBeat === undefined && !call.zone_beat) autoZoneBeat = beat.beat_code;

          // Look up 3-tier dispatch district for richer naming
          const district = db.prepare(
            'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
          ).get(beat.city_code, beat.district_letter) as any;

          if (district) {
            if (autoBeatId === undefined && !call.beat_id) autoBeatId = `${district.beat_name} — ${district.beat_descriptor}`;
            if (autoZoneId === undefined && !call.zone_id) autoZoneId = district.zone_name;
            if (autoSectionId === undefined && !call.section_id) autoSectionId = district.section_id;
          } else {
            if (autoBeatId === undefined && !call.beat_id) autoBeatId = beat.beat_id;
            if (autoZoneId === undefined && !call.zone_id) autoZoneId = `${beat.city} ${beat.district_letter}${beat.beat_number}`;
            if (autoSectionId === undefined && !call.section_id) autoSectionId = beat.district_letter;
          }

          // If coords explicitly changed, always update beat data
          if (latitude !== undefined) {
            if (autoZoneBeat === undefined) autoZoneBeat = beat.beat_code;

            const districtForce = db.prepare(
              'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
            ).get(beat.city_code, beat.district_letter) as any;

            if (districtForce) {
              autoBeatId = autoBeatId !== undefined ? autoBeatId : `${districtForce.beat_name} — ${districtForce.beat_descriptor}`;
              autoZoneId = autoZoneId !== undefined ? autoZoneId : districtForce.zone_name;
              autoSectionId = autoSectionId !== undefined ? autoSectionId : districtForce.section_id;
            } else {
              autoBeatId = autoBeatId !== undefined ? autoBeatId : beat.beat_id;
              autoZoneId = autoZoneId !== undefined ? autoZoneId : `${beat.city} ${beat.district_letter}${beat.beat_number}`;
              autoSectionId = autoSectionId !== undefined ? autoSectionId : beat.district_letter;
            }
          }
        }
      } catch { /* geofence not configured, skip */ }
    }

    // Validate priority if being updated
    if (priority !== undefined) {
      const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
      if (!VALID_PRIORITIES.includes(String(priority).toUpperCase())) {
        res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });
        return;
      }
    }

    // Build dynamic SET clause so we only update provided fields
    const updates: string[] = [];
    const params: any[] = [];
    const addField = (col: string, val: any) => {
      if (val === undefined) return;
      // better-sqlite3 only accepts scalars (string | number | bigint | Buffer | null).
      // If the frontend ever sends a field as a plain object or array — e.g. notes as
      // [] instead of "[]", or pso_service_windows as {} instead of "{}" — the driver
      // throws TypeError: Binding value cannot be an object, blocking all call edits.
      // Coerce objects/arrays to their JSON string representation here so the bound
      // value is always a scalar, matching how structured fields are stored in the DB.
      let coerced: any = val === '' ? null : val;
      if (coerced !== null && typeof coerced === 'object') {
        coerced = JSON.stringify(coerced);
      }
      updates.push(`${col} = ?`);
      params.push(coerced);
    };

    addField('incident_type', incident_type);
    addField('priority', priority ? String(priority).toUpperCase() : priority);
    addField('status', status);
    addField('caller_name', caller_name);
    addField('caller_phone', caller_phone);
    addField('caller_relationship', caller_relationship);
    addField('location_address', location_address);
    addField('property_id', property_id);
    addField('latitude', latitude);
    addField('longitude', longitude);
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
    addField('section_id', autoSectionId);
    addField('zone_id', autoZoneId);
    addField('beat_id', autoBeatId);
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
    addField('process_attempts', process_attempts !== undefined ? Number(process_attempts) : undefined);
    addField('process_served_at', process_served_at);
    addField('process_service_result', process_service_result);
    addField('client_id', resolvedUpdateClientId);

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(localNow());
    params.push(req.params.id);
    db.prepare(`UPDATE calls_for_service SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Activity log for call update
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_updated', 'call', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated call ${call.call_number}: ${updates.map(u => u.split(' = ')[0]).join(', ')}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;

    // If location changed but no coordinates provided, geocode asynchronously
    if (location_address && !latitude && !longitude) {
      geocodeCallIfNeeded(updated.id, location_address, updated.latitude, updated.longitude);
    }

    broadcastDispatchUpdate({ action: 'call_updated', call: updated });

    res.json(updated ?? null);
  } catch (error: any) {
    console.error('Update call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/redispatch - Re-dispatch a PSO call (increment attempt)
router.post('/calls/:id/redispatch', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  // Note: primary handler is now at top-level in index.ts — this is a fallback
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    // Only allow re-dispatch on PSO Client Request incidents
    if (call.incident_type !== 'pso_client_request') {
      res.status(400).json({ error: 'Re-dispatch is only available for PSO Client Request calls' });
      return;
    }

    // Only allow re-dispatch on completed/inactive calls
    if (!['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(call.status)) {
      res.status(400).json({ error: 'Call must be cleared, closed, cancelled, on hold, or archived to re-dispatch' });
      return;
    }

    const now = localNow();
    const currentAttempt = call.pso_attempt_number || 1;
    const newAttempt = currentAttempt + 1;

    // Ordinal suffix for note
    const ordinal = (n: number) => {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      if (v >= 11 && v <= 13) return n + 'th';
      return n + (s[n % 10] || s[0]);
    };

    // ── Snapshot current visit into history BEFORE resetting ──
    // Get assigned unit call signs for the snapshot
    let assignedCallSigns: string[] = [];
    try {
      const parsedIds = JSON.parse(call.assigned_unit_ids || '[]');
      const unitIds = Array.isArray(parsedIds) ? parsedIds : [];
      if (unitIds.length) {
        const units = db.prepare(`SELECT call_sign FROM units WHERE id IN (${unitIds.map(() => '?').join(',')})`).all(...unitIds) as any[];
        assignedCallSigns = units.map((u: any) => u.call_sign).filter(Boolean);
      }
    } catch { /* ignore parse errors */ }

    // Classify this visit's time window for PSO compliance tracking
    const attemptTime = call.onscene_at || call.cleared_at || call.closed_at || now;
    const { window: timeWindow, isWeekend } = classifyServiceWindow(attemptTime);

    db.prepare(`
      INSERT INTO call_visit_history
        (call_id, visit_number, status, dispatched_at, enroute_at, onscene_at, cleared_at, closed_at,
         assigned_units, responding_vehicle_id, starting_mileage, ending_mileage, disposition, note, created_by, created_at,
         time_window, is_weekend)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id, currentAttempt, call.status,
      call.dispatched_at, call.enroute_at, call.onscene_at, call.cleared_at, call.closed_at,
      JSON.stringify(assignedCallSigns), call.responding_vehicle_id || null,
      call.starting_mileage ?? null, call.ending_mileage ?? null,
      call.disposition || null, null, req.user?.fullName || 'Dispatch', now,
      timeWindow, isWeekend ? 1 : 0
    );

    // Parse existing notes to append re-dispatch note
    let notes: any[] = [];
    if (call.notes) {
      try { notes = JSON.parse(call.notes); } catch { notes = []; }
    }
    const { scheduled_note } = req.body || {};
    const noteText = scheduled_note
      ? `Re-dispatched — ${ordinal(newAttempt)} visit. Note: ${scheduled_note}`
      : `Re-dispatched — ${ordinal(newAttempt)} visit`;
    notes.push({
      id: String(Date.now()),
      author: req.user?.fullName || 'Dispatch',
      text: noteText,
      timestamp: now,
      created_at: now,
    });

    // Reset status to pending, clear dispatch timestamps + mileage, increment attempt
    db.prepare(`
      UPDATE calls_for_service SET
        status = 'pending',
        dispatched_at = NULL,
        enroute_at = NULL,
        onscene_at = NULL,
        cleared_at = NULL,
        closed_at = NULL,
        starting_mileage = NULL,
        ending_mileage = NULL,
        responding_vehicle_id = NULL,
        pso_attempt_number = ?,
        pso_72hr_notified = NULL,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(newAttempt, JSON.stringify(notes), now, req.params.id);

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_redispatched', 'call', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Re-dispatched PSO call ${call.call_number} — ${ordinal(newAttempt)} visit${scheduled_note ? `. ${scheduled_note}` : ''}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    // Attach visit history to the response
    const visitHistory = db.prepare('SELECT * FROM call_visit_history WHERE call_id = ? ORDER BY visit_number ASC').all(req.params.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: { ...updated, visit_history: visitHistory } });

    res.json({ ...updated, visit_history: visitHistory });
  } catch (error: any) {
    console.error('Re-dispatch call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/:id/visit-history - Get visit history for a PSO call
router.get('/calls/:id/visit-history', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, incident_type FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }
    const history = db.prepare('SELECT * FROM call_visit_history WHERE call_id = ? ORDER BY visit_number ASC').all(req.params.id);
    res.json(history);
  } catch (error: any) {
    console.error('Visit history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/:id/pso-compliance - Check PSO service window compliance
router.get('/calls/:id/pso-compliance', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, incident_type, pso_service_windows, pso_attempt_number, pso_72hr_deadline, created_at FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }
    if (call.incident_type !== 'pso_client_request') {
      res.status(400).json({ error: 'Not a PSO call' });
      return;
    }

    let windows = { early_morning: false, daytime: false, evening: false, weekend: false };
    if (call.pso_service_windows) {
      try { windows = JSON.parse(call.pso_service_windows); } catch { /* use defaults */ }
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
