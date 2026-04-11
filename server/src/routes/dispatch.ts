import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { broadcastDispatchUpdate, broadcastUnitUpdate, broadcastPanic } from '../utils/websocket';
import { generateIncidentNumber, generateCallNumber } from '../utils/caseNumbers';
import { sendCsv } from '../utils/csvExport';
import { localNow } from '../utils/timeUtils';
import { geocodeCallIfNeeded, reverseGeocodeAddress, reverseGeocodeDetailed } from '../utils/geocode';
import { identifyBeat } from '../utils/geofence';
import { computeRiskScore } from '../utils/riskScoring';
import { createNotification } from './notifications';

const router = Router();

// All dispatch routes require authentication
router.use(authenticateToken);

// GET /api/dispatch/calls - List calls with filters
router.get('/calls', (req: Request, res: Response) => {
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

    res.json({
      data: calls,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Get calls error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls - Create new call for service
// Supports optional historical fields: created_at, status, dispatched_at, enroute_at,
// onscene_at, cleared_at, closed_at, disposition — for entering past records.
router.post('/calls', (req: Request, res: Response) => {
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

    // Normalize priority to uppercase to match CHECK constraint (P1, P2, P3, P4)
    const normalizedPriority = String(priority).toUpperCase();

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
        pso_requestor_phone, pso_requestor_email, pso_billing_code,
        process_service_type, process_served_to, process_served_address,
        contract_id, client_id,
        created_at, dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, archived_at, disposition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?,
              COALESCE(?, ?), ?, ?, ?, ?, ?, ?, ?)
    `).run(
      callNumber, incident_type, normalizedPriority, status, caller_name || null, caller_phone || null,
      caller_relationship || null, caller_address || null, location_address, property_id || null,
      latitude || null, longitude || null, description || null, notes || null,
      source || 'phone', req.user!.userId,
      cross_street || null, location_building || null, location_floor || null, location_room || null, autoZoneBeat,
      autoSectionId, autoZoneId, autoBeatId, autoDispatchCode,
      autoSectionName, autoZoneName, autoBeatName, autoBeatDescriptor,
      weapons_involved || null, injuries_reported ? 1 : 0, num_subjects || null, num_victims || null,
      subject_description || null, vehicle_description || null, direction_of_travel || null,
      scene_safety || null, weather_conditions || null, lighting_conditions || null,
      alcohol_involved ? 1 : 0, drugs_involved ? 1 : 0, domestic_violence ? 1 : 0,
      supervisor_notified ? 1 : 0, le_notified ? 1 : 0, le_agency || null, le_case_number || null,
      damage_estimate || null, damage_description || null, responding_officer || null, action_taken || null,
      mental_health_crisis ? 1 : 0, juvenile_involved ? 1 : 0, felony_in_progress ? 1 : 0, officer_safety_caution ? 1 : 0,
      k9_requested ? 1 : 0, ems_requested ? 1 : 0, fire_requested ? 1 : 0, hazmat ? 1 : 0,
      gang_related ? 1 : 0, evidence_collected ? 1 : 0, body_camera_active ? 1 : 0, photos_taken ? 1 : 0,
      trespass_issued ? 1 : 0, vehicle_pursuit ? 1 : 0, foot_pursuit ? 1 : 0,
      pso_service_type || null, pso_authorization || null, pso_requestor_name || null,
      pso_requestor_phone || null, pso_requestor_email || null, pso_billing_code || null,
      process_service_type || null, process_served_to || null, process_served_address || null,
      contract_id || null, resolvedClientId,
      // Historical timestamps
      customCreatedAt || null,
      localNow(),
      dispatched_at || null, enroute_at || null, onscene_at || null,
      cleared_at || null, closed_at || null, archived_at || null,
      customDisposition || null,
    );

    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(result.lastInsertRowid) as any;

    // Log activity
    const isHistorical = !!customCreatedAt;
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_created', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${isHistorical ? 'Historical entry: ' : 'Created '}${callNumber}: ${incident_type}`, req.ip || 'unknown');

    // If no coordinates were provided, geocode the address asynchronously
    geocodeCallIfNeeded(call.id, location_address, latitude, longitude);

    // Compute risk score and update call
    try {
      const riskScore = computeRiskScore(call.id);
      db.prepare('UPDATE calls_for_service SET risk_score = ? WHERE id = ?').run(riskScore, call.id);
      call.risk_score = riskScore;

      // Auto-notify supervisors for high-risk calls (score >= 80)
      if (riskScore >= 80) {
        const supervisors = db.prepare(
          "SELECT id FROM users WHERE role IN ('admin', 'supervisor') AND status = 'active'"
        ).all() as any[];
        for (const sup of supervisors) {
          createNotification(
            sup.id, 'high_risk_call', `HIGH RISK Call: ${callNumber}`,
            `Risk score ${riskScore}/100 — ${incident_type} at ${location_address}`,
            'call', call.id, 'critical'
          );
        }
      }
    } catch (e) { console.error('Risk scoring error:', e); }

    // Broadcast to dispatch channel
    broadcastDispatchUpdate({ action: 'call_created', call });

    res.status(201).json(call);
  } catch (error: any) {
    console.error('Create call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/export - Export calls as CSV
router.get('/calls/export', (req: Request, res: Response) => {
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
    console.error('Export calls error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/check-duplicate - Check for active calls at same/similar address
router.get('/calls/check-duplicate', (req: Request, res: Response) => {
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
    console.error('Duplicate check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/:id - Get single call with details
router.get('/calls/:id', (req: Request, res: Response) => {
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
      const unitIds = JSON.parse(call.assigned_unit_ids || '[]');
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

    res.json({
      ...call,
      assigned_units: assignedUnits,
      related_incidents: incidents,
      activity,
    });
  } catch (error: any) {
    console.error('Get call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/calls/:id - Update call
router.put('/calls/:id', (req: Request, res: Response) => {
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
      // Case linkage
      case_number, case_id, contract_id,
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

    // Build dynamic SET clause so we only update provided fields
    const updates: string[] = [];
    const params: any[] = [];
    const addField = (col: string, val: any) => {
      if (val !== undefined) { updates.push(`${col} = ?`); params.push(val === '' ? null : val); }
    };

    addField('incident_type', incident_type);
    addField('priority', priority);
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
    addField('weapons_involved', weapons_involved);
    addField('injuries_reported', injuries_reported !== undefined ? (injuries_reported ? 1 : 0) : undefined);
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
    addField('alcohol_involved', alcohol_involved !== undefined ? (alcohol_involved ? 1 : 0) : undefined);
    addField('drugs_involved', drugs_involved !== undefined ? (drugs_involved ? 1 : 0) : undefined);
    addField('domestic_violence', domestic_violence !== undefined ? (domestic_violence ? 1 : 0) : undefined);
    addField('supervisor_notified', supervisor_notified !== undefined ? (supervisor_notified ? 1 : 0) : undefined);
    addField('le_notified', le_notified !== undefined ? (le_notified ? 1 : 0) : undefined);
    addField('le_agency', le_agency);
    addField('le_case_number', le_case_number);
    addField('damage_estimate', damage_estimate);
    addField('damage_description', damage_description);
    addField('action_taken', action_taken);
    addField('starting_mileage', starting_mileage);
    addField('ending_mileage', ending_mileage);
    // Extended operational flags
    addField('mental_health_crisis', mental_health_crisis !== undefined ? (mental_health_crisis ? 1 : 0) : undefined);
    addField('juvenile_involved', juvenile_involved !== undefined ? (juvenile_involved ? 1 : 0) : undefined);
    addField('felony_in_progress', felony_in_progress !== undefined ? (felony_in_progress ? 1 : 0) : undefined);
    addField('officer_safety_caution', officer_safety_caution !== undefined ? (officer_safety_caution ? 1 : 0) : undefined);
    addField('k9_requested', k9_requested !== undefined ? (k9_requested ? 1 : 0) : undefined);
    addField('ems_requested', ems_requested !== undefined ? (ems_requested ? 1 : 0) : undefined);
    addField('fire_requested', fire_requested !== undefined ? (fire_requested ? 1 : 0) : undefined);
    addField('hazmat', hazmat !== undefined ? (hazmat ? 1 : 0) : undefined);
    addField('gang_related', gang_related !== undefined ? (gang_related ? 1 : 0) : undefined);
    addField('evidence_collected', evidence_collected !== undefined ? (evidence_collected ? 1 : 0) : undefined);
    addField('body_camera_active', body_camera_active !== undefined ? (body_camera_active ? 1 : 0) : undefined);
    addField('photos_taken', photos_taken !== undefined ? (photos_taken ? 1 : 0) : undefined);
    addField('trespass_issued', trespass_issued !== undefined ? (trespass_issued ? 1 : 0) : undefined);
    addField('vehicle_pursuit', vehicle_pursuit !== undefined ? (vehicle_pursuit ? 1 : 0) : undefined);
    addField('foot_pursuit', foot_pursuit !== undefined ? (foot_pursuit ? 1 : 0) : undefined);
    // PSO Client Request fields
    addField('pso_service_type', pso_service_type);
    addField('pso_authorization', pso_authorization);
    addField('pso_requestor_name', pso_requestor_name);
    addField('pso_requestor_phone', pso_requestor_phone);
    addField('pso_requestor_email', pso_requestor_email);
    addField('pso_billing_code', pso_billing_code);
    addField('pso_attempt_number', pso_attempt_number !== undefined ? (isNaN(Number(pso_attempt_number)) ? null : Number(pso_attempt_number)) : undefined);
    // Process Service fields
    addField('process_service_type', process_service_type);
    addField('process_served_to', process_served_to);
    addField('process_served_address', process_served_address);
    addField('process_attempts', process_attempts !== undefined ? (isNaN(Number(process_attempts)) ? null : Number(process_attempts)) : undefined);
    addField('process_served_at', process_served_at);
    addField('process_service_result', process_service_result);
    // Case linkage
    addField('case_number', case_number);
    addField('case_id', case_id);
    addField('contract_id', contract_id);
    addField('client_id', resolvedUpdateClientId);

    // ── Timeline dispatch timestamp override (admin/manager/supervisor/dispatcher) ──
    // Allows editing historical dispatch timestamps (dispatched_at, enroute_at,
    // onscene_at, cleared_at, closed_at, received_at). Pulled from req.body
    // directly since these fields aren't in the main destructure above.
    // Officers are excluded — field staff shouldn't correct historical records.
    const TIMELINE_EDIT_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher'];
    if (TIMELINE_EDIT_ROLES.includes(req.user?.role || '')) {
      const tlBody = req.body as Record<string, unknown>;
      const isValidIso = (v: unknown): v is string =>
        typeof v === 'string' && v.length >= 10 && !Number.isNaN(new Date(v).getTime());

      const handleTimelineField = (col: string) => {
        const val = tlBody[col];
        if (val === undefined) return;
        if (val === null || val === '') {
          updates.push(`${col} = NULL`);
          return;
        }
        if (isValidIso(val)) {
          updates.push(`${col} = ?`);
          params.push(val);
          return;
        }
        console.warn(
          `[PUT /calls/:id dispatch.ts] rejected timeline ${col}: type=${typeof val} value=${JSON.stringify(val)?.substring(0, 80)}`,
        );
      };

      handleTimelineField('received_at');
      handleTimelineField('dispatched_at');
      handleTimelineField('enroute_at');
      handleTimelineField('onscene_at');
      handleTimelineField('cleared_at');
      handleTimelineField('closed_at');
      handleTimelineField('created_at');
    }

    if (updates.length === 0) {
      const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
      console.warn(
        `[PUT /calls/:id dispatch.ts] NO_FIELDS_TO_UPDATE id=${req.params.id} role=${req.user?.role || 'n/a'} body_keys=[${bodyKeys.join(',')}]`,
      );
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

    res.json(updated);
  } catch (error: any) {
    console.error('Update call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/dispatch - Dispatch unit(s) to call
router.post('/calls/:id/dispatch', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { unit_ids } = req.body;
    if (!unit_ids || !Array.isArray(unit_ids) || unit_ids.length === 0) {
      res.status(400).json({ error: 'unit_ids array is required' });
      return;
    }

    const now = localNow();

    // Merge with existing assigned units
    let currentUnits: number[] = [];
    try {
      currentUnits = JSON.parse(call.assigned_unit_ids || '[]');
    } catch { /* ignore */ }

    const allUnits = [...new Set([...currentUnits, ...unit_ids])];

    // Update call
    db.prepare(`
      UPDATE calls_for_service SET
        status = CASE WHEN status = 'pending' THEN 'dispatched' ELSE status END,
        assigned_unit_ids = ?,
        dispatched_at = COALESCE(dispatched_at, ?),
        dispatcher_id = COALESCE(dispatcher_id, ?)
      WHERE id = ?
    `).run(JSON.stringify(allUnits), now, req.user!.userId, call.id);

    // Update each unit status
    for (const unitId of unit_ids) {
      db.prepare(`
        UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ? WHERE id = ?
      `).run(call.id, now, unitId);

      // Log activity
      const unit = db.prepare('SELECT call_sign FROM units WHERE id = ?').get(unitId) as any;
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'unit_dispatched', 'unit', ?, ?, ?)
      `).run(req.user!.userId, unitId, `Dispatched ${unit?.call_sign || unitId} to ${call.call_number}`, req.ip || 'unknown');
    }

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'units_dispatched', call: updated, unit_ids });

    res.json(updated);
  } catch (error: any) {
    console.error('Dispatch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/assign-unit - Attach a single unit to a call
router.post('/calls/:id/assign-unit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { unit_id } = req.body;
    if (!unit_id) {
      res.status(400).json({ error: 'unit_id is required' });
      return;
    }

    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const now = localNow();

    // Merge with existing assigned units
    let currentUnits: number[] = [];
    try {
      currentUnits = JSON.parse(call.assigned_unit_ids || '[]');
    } catch { /* ignore */ }

    if (!currentUnits.includes(Number(unit_id))) {
      currentUnits.push(Number(unit_id));
    }

    // Update call: add unit to assigned_unit_ids, set dispatched if pending
    db.prepare(`
      UPDATE calls_for_service SET
        status = CASE WHEN status = 'pending' THEN 'dispatched' ELSE status END,
        assigned_unit_ids = ?,
        dispatched_at = COALESCE(dispatched_at, ?)
      WHERE id = ?
    `).run(JSON.stringify(currentUnits), now, call.id);

    // Update unit: set status to dispatched and link to this call
    db.prepare(`
      UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ? WHERE id = ?
    `).run(call.id, now, unit_id);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_dispatched', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `Assigned ${unit.call_sign} to ${call.call_number}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'unit_assigned', call: updated, unit_id });
    broadcastUnitUpdate({ action: 'unit_status_changed', unit: db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(unit_id) });

    res.json(updated);
  } catch (error: any) {
    console.error('Assign unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/unassign-unit - Detach a single unit from a call
router.post('/calls/:id/unassign-unit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { unit_id } = req.body;
    if (!unit_id) {
      res.status(400).json({ error: 'unit_id is required' });
      return;
    }

    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const now = localNow();

    // Remove unit from assigned_unit_ids
    let currentUnits: number[] = [];
    try {
      currentUnits = JSON.parse(call.assigned_unit_ids || '[]');
    } catch { /* ignore */ }

    currentUnits = currentUnits.filter((id) => id !== Number(unit_id));

    // Update call: remove unit from assigned_unit_ids
    db.prepare(`
      UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?
    `).run(JSON.stringify(currentUnits), call.id);

    // Update unit: set status to available and clear current_call_id
    db.prepare(`
      UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ?
    `).run(now, unit_id);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_unassigned', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `Removed ${unit.call_sign} from ${call.call_number}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'unit_unassigned', call: updated, unit_id });
    broadcastUnitUpdate({ action: 'unit_status_changed', unit: db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(unit_id) });

    res.json(updated);
  } catch (error: any) {
    console.error('Unassign unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/status - Update call status with timestamp
router.post('/calls/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { status, notes, disposition } = req.body;
    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived', 'on_hold'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status', valid: validStatuses });
      return;
    }

    const now = localNow();

    // Map status to timestamp field
    const timestampField: Record<string, string> = {
      dispatched: 'dispatched_at',
      enroute: 'enroute_at',
      onscene: 'onscene_at',
      cleared: 'cleared_at',
      closed: 'closed_at',
      archived: 'archived_at',
    };

    const tsField = timestampField[status];
    let updateQuery = `UPDATE calls_for_service SET status = ?`;
    const updateParams: any[] = [status];

    if (tsField) {
      updateQuery += `, ${tsField} = COALESCE(${tsField}, ?)`;
      updateParams.push(now);
    }
    if (notes) {
      updateQuery += `, notes = ?`;
      updateParams.push(notes);
    }
    if (disposition) {
      updateQuery += `, disposition = ?`;
      updateParams.push(disposition);
    }
    updateQuery += ` WHERE id = ?`;
    updateParams.push(call.id);

    db.prepare(updateQuery).run(...updateParams);

    // If cleared, closed, cancelled, or archived, free up units
    if (['cleared', 'closed', 'cancelled', 'archived'].includes(status)) {
      let unitIds: number[] = [];
      try {
        unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      } catch { /* ignore */ }

      for (const unitId of unitIds) {
        db.prepare(`
          UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?
        `).run(now, unitId, call.id);
      }
    }

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'status_change', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} status changed to ${status}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status });

    res.json(updated);
  } catch (error: any) {
    console.error('Status update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/revert-status - Revert call to previous status
router.post('/calls/:id/revert-status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    // Status chain: pending -> dispatched -> enroute -> onscene -> cleared -> closed
    const statusChain: Record<string, string> = {
      dispatched: 'pending',
      enroute: 'dispatched',
      onscene: 'enroute',
      cleared: 'onscene',
      closed: 'cleared',
    };

    const previousStatus = statusChain[call.status];
    if (!previousStatus) {
      res.status(400).json({ error: `Cannot revert from status "${call.status}"` });
      return;
    }

    const now = localNow();

    // Clear the timestamp for the current status
    const timestampField: Record<string, string> = {
      dispatched: 'dispatched_at',
      enroute: 'enroute_at',
      onscene: 'onscene_at',
      cleared: 'cleared_at',
      closed: 'closed_at',
    };

    const tsField = timestampField[call.status];
    let updateQuery = `UPDATE calls_for_service SET status = ?`;
    const updateParams: any[] = [previousStatus];

    // Clear the timestamp for the status being reverted
    if (tsField) {
      updateQuery += `, ${tsField} = NULL`;
    }
    updateQuery += ` WHERE id = ?`;
    updateParams.push(call.id);

    db.prepare(updateQuery).run(...updateParams);

    // If reverting from cleared/closed, re-dispatch assigned units
    if (['cleared', 'closed'].includes(call.status)) {
      let unitIds: number[] = [];
      try {
        unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      } catch { /* ignore */ }

      for (const unitId of unitIds) {
        const prevUnitStatus = previousStatus === 'onscene' ? 'onscene' : previousStatus === 'enroute' ? 'enroute' : 'dispatched';
        db.prepare(`
          UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?
        `).run(prevUnitStatus, call.id, now, unitId);
      }
    }

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'status_reverted', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} status reverted from ${call.status} to ${previousStatus}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status: previousStatus });

    res.json(updated);
  } catch (error: any) {
    console.error('Revert status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/hold - Put call on hold (saves previous status)
router.post('/calls/:id/hold', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status === 'on_hold') {
      res.status(400).json({ error: 'Call is already on hold' });
      return;
    }

    // Only active statuses can be held (not cleared/closed/cancelled/archived)
    const holdable = ['pending', 'dispatched', 'enroute', 'onscene'];
    if (!holdable.includes(call.status)) {
      res.status(400).json({ error: `Cannot hold a call with status "${call.status}"` });
      return;
    }

    const now = localNow();
    db.prepare(`
      UPDATE calls_for_service SET status = 'on_hold', previous_status = ?, held_at = ? WHERE id = ?
    `).run(call.status, now, call.id);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_held', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} put on hold from ${call.status}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status: 'on_hold' });

    res.json(updated);
  } catch (error: any) {
    console.error('Hold call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/resume - Resume a held call (restores previous status)
router.post('/calls/:id/resume', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status !== 'on_hold') {
      res.status(400).json({ error: 'Call is not on hold' });
      return;
    }

    const restoreStatus = call.previous_status || 'pending';

    // Accumulate hold duration (minutes spent on hold this time)
    const now = localNow();
    let holdMinutesThisTime = 0;
    if (call.held_at) {
      holdMinutesThisTime = (new Date(now).getTime() - new Date(call.held_at).getTime()) / 60000;
      if (holdMinutesThisTime < 0) holdMinutesThisTime = 0;
    }
    const newTotalHold = (call.total_hold_minutes || 0) + holdMinutesThisTime;

    db.prepare(`
      UPDATE calls_for_service SET status = ?, previous_status = NULL, held_at = NULL, total_hold_minutes = ? WHERE id = ?
    `).run(restoreStatus, Math.round(newTotalHold * 100) / 100, call.id);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_resumed', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} resumed to ${restoreStatus} (held ${Math.round(holdMinutesThisTime * 10) / 10}m)`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status: restoreStatus });

    res.json(updated);
  } catch (error: any) {
    console.error('Resume call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/promote-to-incident - Create incident from call
router.post('/calls/:id/promote-to-incident', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    // Generate incident number
    const { generateIncidentNumber } = require('../utils/caseNumbers');
    const incidentNumber = generateIncidentNumber(db, call.incident_type || 'general');

    // Propagate all operational flags + district + client info from the source call
    // (Previously only 3 flags propagated + a type mismatch on `injuries`/`weapons_involved`
    //  stuffed 0 into text columns — audit 2026-04-10.)
    const result = db.prepare(`
      INSERT INTO incidents (incident_number, call_id, incident_type, priority, status,
        location_address, property_id, latitude, longitude, narrative, officer_id,
        zone_beat, section_id, zone_id, beat_id, client_id, contract_id,
        alcohol_involved, drugs_involved, domestic_violence, weapons_involved,
        injuries_reported, mental_health_crisis, juvenile_involved, felony_in_progress,
        officer_safety_caution, k9_requested, ems_requested, fire_requested,
        hazmat, gang_related, evidence_collected, body_camera_active, photos_taken,
        trespass_issued, vehicle_pursuit, foot_pursuit, le_notified, supervisor_notified,
        disposition, created_by)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?)
    `).run(
      incidentNumber,
      call.id,
      call.incident_type || 'general',
      call.priority || 'P3',
      call.location_address || null,
      call.property_id || null,
      call.latitude || null,
      call.longitude || null,
      call.description || null,
      req.user!.userId,
      call.zone_beat || null,
      call.section_id || null,
      call.zone_id || null,
      call.beat_id || null,
      call.client_id || null,
      call.contract_id || null,
      call.alcohol_involved ? 1 : 0,
      call.drugs_involved ? 1 : 0,
      call.domestic_violence ? 1 : 0,
      call.weapons_involved || null,
      call.injuries_reported ? 1 : 0,
      call.mental_health_crisis ? 1 : 0,
      call.juvenile_involved ? 1 : 0,
      call.felony_in_progress ? 1 : 0,
      call.officer_safety_caution ? 1 : 0,
      call.k9_requested ? 1 : 0,
      call.ems_requested ? 1 : 0,
      call.fire_requested ? 1 : 0,
      call.hazmat ? 1 : 0,
      call.gang_related ? 1 : 0,
      call.evidence_collected ? 1 : 0,
      call.body_camera_active ? 1 : 0,
      call.photos_taken ? 1 : 0,
      call.trespass_issued ? 1 : 0,
      call.vehicle_pursuit ? 1 : 0,
      call.foot_pursuit ? 1 : 0,
      call.le_notified ? 1 : 0,
      call.supervisor_notified ? 1 : 0,
      call.disposition || null,
      req.user!.userId
    );

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(incident);
  } catch (error: any) {
    console.error('Promote to incident error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/le-notification - Notify external agency
router.post('/calls/:id/le-notification', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    const { agency, case_number, notes } = req.body;
    const now = localNow();

    db.prepare(`
      UPDATE calls_for_service
      SET le_notified = 1, le_agency = ?, le_case_number = ?, le_notified_at = ?, le_notified_by = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      agency || 'Local PD',
      case_number || null,
      now,
      req.user!.userId,
      now,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('LE notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/units - Get all units with current status
router.get('/units', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const units = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone,
        c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location,
        cpg.vehicle_make as cpg_vehicle_make, cpg.vehicle_model as cpg_vehicle_model,
        cpg.license_plate as cpg_license_plate, cpg.ignition_state as cpg_ignition_state,
        cpg.last_odometer as cpg_last_odometer, cpg.driver_name as cpg_driver_name,
        cpg.last_synced_at as cpg_last_synced_at
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      LEFT JOIN cpg_device_mappings cpg ON cpg.unit_id = u.id AND cpg.is_active = 1
      ORDER BY u.call_sign
    `).all();

    res.json(units);
  } catch (error: any) {
    console.error('Get units error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/units - Create dispatch unit
router.post('/units', requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_sign, officer_id, status } = req.body;
    if (!call_sign) {
      res.status(400).json({ error: 'call_sign is required' });
      return;
    }

    // Check for duplicate call_sign
    const existing = db.prepare('SELECT id FROM units WHERE call_sign = ?').get(call_sign);
    if (existing) {
      res.status(409).json({ error: 'A unit with this call sign already exists' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO units (call_sign, officer_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(call_sign, officer_id || null, status || 'off_duty', localNow(), localNow());

    const unit = db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(result.lastInsertRowid);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_created', 'unit', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid, `Created unit: ${call_sign}`, req.ip || 'unknown');

    broadcastUnitUpdate({ action: 'unit_created', unit });
    res.status(201).json(unit);
  } catch (error: any) {
    console.error('Create unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/units/:id - Edit unit details (call_sign, officer_id, status, vehicle_id)
router.put('/units/:id', requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const { call_sign, officer_id, status, vehicle_id, capabilities } = req.body;
    const now = localNow();
    const updates: string[] = [];
    const params: any[] = [];

    if (call_sign !== undefined) {
      const trimmed = call_sign.trim();
      if (!trimmed) {
        res.status(400).json({ error: 'call_sign cannot be empty' });
        return;
      }
      // Check uniqueness (exclude self)
      const dup = db.prepare('SELECT id FROM units WHERE call_sign = ? AND id != ?').get(trimmed, req.params.id);
      if (dup) {
        res.status(409).json({ error: 'A unit with this call sign already exists' });
        return;
      }
      updates.push('call_sign = ?');
      params.push(trimmed);
    }
    if (officer_id !== undefined) {
      updates.push('officer_id = ?');
      params.push(officer_id || null);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
      updates.push('last_status_change = ?');
      params.push(now);
    }
    if (vehicle_id !== undefined) {
      updates.push('vehicle_id = ?');
      params.push(vehicle_id || null);
    }
    if (capabilities !== undefined) {
      updates.push('capabilities = ?');
      params.push(typeof capabilities === 'string' ? capabilities : JSON.stringify(capabilities));
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push("updated_at = ?");
    params.push(localNow());
    params.push(req.params.id);
    db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_updated', 'unit', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Updated unit: ${(updated as any)?.call_sign || req.params.id}`, req.ip || 'unknown');

    broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('Update unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/units/:id - Delete a unit
router.delete('/units/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    // Block deletion if unit is assigned to an active call
    if (unit.current_call_id) {
      res.status(400).json({ error: 'Cannot delete a unit that is assigned to an active call. Unassign the unit first.' });
      return;
    }

    db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_deleted', 'unit', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Deleted unit: ${unit.call_sign}`, req.ip || 'unknown');

    broadcastUnitUpdate({ action: 'unit_deleted', unit_id: req.params.id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/units/:id/status - Update unit status and location
router.put('/units/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const { status, latitude, longitude } = req.body;
    const now = localNow();

    const updates: string[] = [];
    const params: any[] = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);
      updates.push('last_status_change = ?');
      params.push(now);
    }
    if (latitude !== undefined) {
      updates.push('latitude = ?');
      params.push(latitude);
    }
    if (longitude !== undefined) {
      updates.push('longitude = ?');
      params.push(longitude);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    params.push(unit.id);
    db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // If unit going available, clear current call
    if (status === 'available' || status === 'off_duty') {
      db.prepare('UPDATE units SET current_call_id = NULL WHERE id = ?').run(unit.id);
    }

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'status_change', 'unit', ?, ?, ?)
    `).run(req.user!.userId, unit.id, `${unit.call_sign} status: ${status || 'location update'}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT u.*, usr.full_name as officer_name
      FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.id = ?
    `).get(unit.id);

    broadcastUnitUpdate({ action: 'unit_status_changed', unit: updated });

    res.json(updated);
  } catch (error: any) {
    console.error('Unit status update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/gps - Batch GPS position update from officer
// Accepts either a single point or an array of points collected at ~1-second intervals.
// Updates the unit's live position (latest point only), bulk-inserts all breadcrumbs,
// and broadcasts the latest position via WebSocket.
//
// Body formats:
//   Single (legacy):  { latitude, longitude, accuracy, heading, speed }
//   Batch (v4.3+):    { points: [{ lat, lng, accuracy, heading, speed, timestamp }] }
router.post('/gps', (req: Request, res: Response) => {
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

    if (Array.isArray(req.body.points)) {
      // Batch format: { points: [...] }
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

    // Validate: at least one point with valid coordinates
    const validPoints = points.filter(
      (p) => p.lat != null && p.lng != null &&
        p.lat >= -90 && p.lat <= 90 &&
        p.lng >= -180 && p.lng <= 180
    );

    if (validPoints.length === 0) {
      res.status(400).json({ error: 'No valid GPS points provided' });
      return;
    }

    // Find unit assigned to current user
    const unit = db.prepare('SELECT id, call_sign, status FROM units WHERE officer_id = ?').get(req.user!.userId) as any;
    if (!unit) {
      res.status(404).json({ error: 'No unit assigned to current user' });
      return;
    }

    // GPS tracking is mandatory for ALL logged-in users regardless of status.
    // Previously off_duty units were skipped — now we always record breadcrumbs.

    // ── Use the LATEST point for live unit position and broadcast ──
    const latest = validPoints[validPoints.length - 1];

    db.prepare(`
      UPDATE units SET latitude = ?, longitude = ?
      WHERE id = ?
    `).run(latest.lat, latest.lng, unit.id);

    // Fetch full unit info for broadcast
    const updated = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number,
        c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      WHERE u.id = ?
    `).get(unit.id) as any;

    // ── Bulk-insert all breadcrumb points in a single transaction ──
    const insertStmt = db.prepare(`
      INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number, current_call_id, current_call_number, current_call_type,
        road_name, nearest_intersection, gps_source, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        NULL, NULL, 'browser',
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
          pt.timestamp ?? null,
        );
      }
    });

    insertMany(validPoints);

    // Broadcast ONLY the latest position (not every batch point)
    broadcastUnitUpdate({ action: 'unit_position_update', unit: updated });

    res.json({ ok: true, unit_id: unit.id, call_sign: unit.call_sign, inserted: validPoints.length });

    // ── Async geocode: reverse-geocode the latest point, then backfill the batch ──
    // Runs after the response is sent so it doesn't slow down the GPS endpoint.
    (async () => {
      try {
        const geo = await reverseGeocodeDetailed(latest.lat, latest.lng);
        if (!geo || (!geo.road_name && !geo.nearest_intersection)) return;

        // Update all points in this batch that were just inserted (last N for this unit)
        db.prepare(`
          UPDATE gps_breadcrumbs
          SET road_name = ?, nearest_intersection = ?
          WHERE unit_id = ? AND road_name IS NULL
          ORDER BY id DESC LIMIT ?
        `).run(geo.road_name, geo.nearest_intersection, unit.id, validPoints.length);
      } catch (err) {
        // Non-critical — don't log excessively
      }
    })();
  } catch (error: any) {
    console.error('GPS update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/gps/my-unit - Get current user's assigned unit
router.get('/gps/my-unit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare(`
      SELECT u.id, u.call_sign, u.status, u.latitude, u.longitude, u.gps_source
      FROM units u WHERE u.officer_id = ?
    `).get(req.user!.userId) as any;

    res.json(unit || null);
  } catch (error: any) {
    console.error('Get my unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/gps/trail/:unitId - Get GPS breadcrumb trail for a unit
// Also applies the same starburst-prevention filters as /trails.
router.get('/gps/trail/:unitId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unitId = parseInt(req.params.unitId);
    const hours = parseInt(req.query.hours as string) || 8;

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

      const dtSec = Math.max(
        (new Date(row.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000,
        0.5
      );
      if (dist / dtSec > MAX_SPEED) continue;

      filtered.push(row);
    }

    res.json(filtered);
  } catch (error: any) {
    console.error('GPS trail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/gps/trails - Get breadcrumb trails for all active units
// Applies server-side filtering to eliminate starburst artifacts caused by
// WiFi-triangulation jumps stored in the database (pre-v4.3 data).
router.get('/gps/trails', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = parseInt(req.query.hours as string) || 8;

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
        b.current_call_number, b.current_call_type, b.road_name, b.gps_source, b.recorded_at
      FROM gps_breadcrumbs b
      JOIN units u ON b.unit_id = u.id
      WHERE b.recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY b.unit_id, b.recorded_at ASC
    `).all(hours) as any[];

    // ── Group by unit, then filter each trail to remove starburst artifacts ──
    // Two filters applied per-unit:
    //   1. Accuracy gate: skip points with accuracy > 150 m (WiFi triangulation)
    //   2. Jump detection: skip points implying > 80 m/s (~180 mph) from last accepted point
    //      This catches WiFi "teleportation" back to a router's estimated position.
    const MAX_ACCURACY = 250;   // meters — accept WiFi/cell-tower positioning
    const MAX_SPEED    = 100;   // m/s (~224 mph) — reject impossible jumps
    const MIN_DISTANCE = 2;     // meters — collapse stationary duplicates

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
        gps_source: row.gps_source || 'browser',
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
      const dtSec    = Math.max((curTime - prevTime) / 1000, 0.5); // floor at 0.5s to avoid /0

      if (dist / dtSec > MAX_SPEED) continue; // impossible jump — skip

      trailPts.push(pt);
    }

    res.json(Object.values(trails));
  } catch (error: any) {
    console.error('GPS trails error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/gps/breadcrumbs/cleanup - Purge old breadcrumb data
router.delete('/gps/breadcrumbs/cleanup', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 7;

    // Use SQLite datetime() to match the stored format (datetime('now','localtime'))
    const result = db.prepare(
      `DELETE FROM gps_breadcrumbs WHERE recorded_at < datetime('now', 'localtime', '-' || ? || ' days')`
    ).run(days);
    res.json({ deleted: result.changes });
  } catch (error: any) {
    console.error('Breadcrumb cleanup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/heatmap - Aggregated call locations for heat map display
router.get('/heatmap', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 30;

    // Use SQLite datetime() for consistent format comparison
    const points = db.prepare(`
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        COUNT(*) as count
      FROM calls_for_service
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', '-' || ? || ' days')
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      ORDER BY count DESC
      LIMIT 200
    `).all(days);

    res.json(points);
  } catch (error: any) {
    console.error('Heatmap error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/heatmap/predicted - Predictive heatmap based on day-of-week + time-of-day patterns
router.get('/heatmap/predicted', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hoursAhead = parseInt(req.query.hours_ahead as string) || 2;
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sunday
    const currentHour = now.getHours();
    const endHour = currentHour + hoursAhead;

    const points = db.prepare(`
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        SUM(
          CASE
            WHEN created_at >= datetime('now', 'localtime', '-30 days') THEN 3
            WHEN created_at >= datetime('now', 'localtime', '-90 days') THEN 2
            ELSE 1
          END
        ) as predicted_weight,
        COUNT(*) as historical_count
      FROM calls_for_service
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND CAST(strftime('%w', created_at) AS INTEGER) = ?
        AND CAST(strftime('%H', created_at) AS INTEGER) BETWEEN ? AND ?
        AND created_at >= datetime('now', 'localtime', '-180 days')
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      ORDER BY predicted_weight DESC
      LIMIT 200
    `).all(dayOfWeek, currentHour, endHour);

    res.json({
      day_of_week: dayOfWeek,
      hour_range: `${currentHour}:00-${endHour}:00`,
      points,
    });
  } catch (error: any) {
    console.error('Predicted heatmap error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/:id/risk-score - Recalculate risk score for a call
router.get('/calls/:id/risk-score', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    const riskScore = computeRiskScore(call.id);
    db.prepare('UPDATE calls_for_service SET risk_score = ? WHERE id = ?').run(riskScore, call.id);

    res.json({ call_id: call.id, risk_score: riskScore });
  } catch (error: any) {
    console.error('Risk score error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/queue - Active dispatch queue
router.get('/queue', (req: Request, res: Response) => {
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
    console.error('Get queue error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/stats - Current dispatch statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const callsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now')
      GROUP BY status
    `).all();

    const callsByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now')
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
      WHERE DATE(created_at) = DATE('now')
    `).get() as any;

    const avgResponseTime = db.prepare(`
      SELECT AVG(
        (julianday(onscene_at) - julianday(created_at)) * 24 * 60
      ) as avg_minutes
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now')
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
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/generate-incident - Generate incident report from a cleared/closed call
router.post('/calls/:id/generate-incident', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare(`
      SELECT c.*, p.name as property_name, p.address as property_address
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.id = ?
    `).get(req.params.id) as any;

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (!['cleared', 'closed'].includes(call.status)) {
      res.status(400).json({ error: 'Can only generate incident reports from cleared or closed calls' });
      return;
    }

    // Check if incident already exists for this call
    const existingIncident = db.prepare('SELECT id, incident_number FROM incidents WHERE call_id = ?').get(call.id) as any;
    if (existingIncident) {
      res.status(409).json({
        error: 'An incident report already exists for this call',
        incident_id: existingIncident.id,
        incident_number: existingIncident.incident_number
      });
      return;
    }

    // Generate incident number: RMP-YY-NNNNN-CODE
    const incidentNumber = generateIncidentNumber(db, call.incident_type);

    // Build narrative template from call data
    const narrativeParts: string[] = [];
    narrativeParts.push(`Incident generated from dispatch call ${call.call_number}.`);
    narrativeParts.push(`\nCall Type: ${(call.incident_type || '').replace(/_/g, ' ').toUpperCase()}`);
    narrativeParts.push(`Priority: ${call.priority}`);
    narrativeParts.push(`Location: ${call.location_address || 'Unknown'}`);
    if (call.property_name) narrativeParts.push(`Property: ${call.property_name}`);
    if (call.caller_name) narrativeParts.push(`Caller: ${call.caller_name}${call.caller_phone ? ` (${call.caller_phone})` : ''}`);
    if (call.description) narrativeParts.push(`\nCall Description: ${call.description}`);
    if (call.disposition) narrativeParts.push(`Disposition: ${call.disposition}`);
    narrativeParts.push(`\nCall Timeline:`);
    if (call.created_at) narrativeParts.push(`  Created: ${call.created_at}`);
    if (call.dispatched_at) narrativeParts.push(`  Dispatched: ${call.dispatched_at}`);
    if (call.enroute_at) narrativeParts.push(`  En Route: ${call.enroute_at}`);
    if (call.onscene_at) narrativeParts.push(`  On Scene: ${call.onscene_at}`);
    if (call.cleared_at) narrativeParts.push(`  Cleared: ${call.cleared_at}`);
    narrativeParts.push(`\n--- Officer narrative below ---\n`);

    const narrative = narrativeParts.join('\n');

    // Propagate ALL operational flags + district + client info from the source call
    // (Previously dropped here — audit 2026-04-10.)
    const result = db.prepare(`
      INSERT INTO incidents (incident_number, call_id, incident_type, priority, status, location_address,
        property_id, latitude, longitude, narrative, officer_id, client_id, contract_id,
        alcohol_involved, drugs_involved, domestic_violence, weapons_involved,
        injuries_reported, mental_health_crisis, juvenile_involved, felony_in_progress,
        officer_safety_caution, k9_requested, ems_requested, fire_requested,
        hazmat, gang_related, evidence_collected, body_camera_active, photos_taken,
        trespass_issued, vehicle_pursuit, foot_pursuit, le_notified, supervisor_notified,
        section_id, zone_id, beat_id, disposition)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?)
    `).run(
      incidentNumber, call.id, call.incident_type, call.priority,
      call.location_address || call.property_address || null,
      call.property_id || null, call.latitude || null, call.longitude || null,
      narrative, req.user!.userId, call.client_id || null, call.contract_id || null,
      call.alcohol_involved ? 1 : 0, call.drugs_involved ? 1 : 0,
      call.domestic_violence ? 1 : 0, call.weapons_involved || null,
      call.injuries_reported ? 1 : 0, call.mental_health_crisis ? 1 : 0,
      call.juvenile_involved ? 1 : 0, call.felony_in_progress ? 1 : 0,
      call.officer_safety_caution ? 1 : 0, call.k9_requested ? 1 : 0,
      call.ems_requested ? 1 : 0, call.fire_requested ? 1 : 0,
      call.hazmat ? 1 : 0, call.gang_related ? 1 : 0,
      call.evidence_collected ? 1 : 0, call.body_camera_active ? 1 : 0,
      call.photos_taken ? 1 : 0,
      call.trespass_issued ? 1 : 0, call.vehicle_pursuit ? 1 : 0,
      call.foot_pursuit ? 1 : 0, call.le_notified ? 1 : 0,
      call.supervisor_notified ? 1 : 0,
      call.section_id || null, call.zone_id || null, call.beat_id || null,
      call.disposition || null
    );

    const incident = db.prepare(`
      SELECT i.*, o.full_name as officer_name, o.badge_number, c.call_number
      FROM incidents i
      LEFT JOIN users o ON i.officer_id = o.id
      LEFT JOIN calls_for_service c ON i.call_id = c.id
      WHERE i.id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_created', 'incident', ?, ?, ?)
    `).run(
      req.user!.userId, result.lastInsertRowid,
      `Generated ${incidentNumber} from call ${call.call_number}`,
      req.ip || 'unknown'
    );

    res.status(201).json(incident);
  } catch (error: any) {
    console.error('Generate incident error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/archive-bulk - Archive multiple cleared/closed/cancelled calls at once
// NOTE: This route MUST come before /calls/:id/archive to avoid Express matching "archive-bulk" as :id
router.post('/calls/archive-bulk', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_ids, statuses } = req.body;

    const now = localNow();
    let callsToArchive: any[] = [];

    if (call_ids && Array.isArray(call_ids) && call_ids.length > 0) {
      // Archive specific calls by ID
      const placeholders = call_ids.map(() => '?').join(',');
      callsToArchive = db.prepare(
        `SELECT * FROM calls_for_service WHERE id IN (${placeholders}) AND status != 'archived'`
      ).all(...call_ids);
    } else {
      // Archive all calls matching the given statuses (default: cleared, closed, cancelled)
      const targetStatuses = Array.isArray(statuses) && statuses.length > 0
        ? statuses
        : ['cleared', 'closed', 'cancelled'];
      const placeholders = targetStatuses.map(() => '?').join(',');
      callsToArchive = db.prepare(
        `SELECT * FROM calls_for_service WHERE status IN (${placeholders})`
      ).all(...targetStatuses);
    }

    if (callsToArchive.length === 0) {
      res.json({ archived_count: 0, message: 'No calls to archive' });
      return;
    }

    const archiveStmt = db.prepare('UPDATE calls_for_service SET status = ?, archived_at = ? WHERE id = ?');
    const freeUnitStmt = db.prepare(
      `UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?`
    );
    const logStmt = db.prepare(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'call_archived', 'call', ?, ?, ?)`
    );

    const archiveTransaction = db.transaction(() => {
      for (const call of callsToArchive) {
        archiveStmt.run('archived', now, call.id);

        // Free up any assigned units
        let unitIds: number[] = [];
        try { unitIds = JSON.parse(call.assigned_unit_ids || '[]'); } catch { /* ignore */ }
        for (const unitId of unitIds) {
          freeUnitStmt.run(now, unitId, call.id);
        }

        logStmt.run(req.user!.userId, call.id, `${call.call_number} bulk archived`, req.ip || 'unknown');
      }
    });

    archiveTransaction();

    broadcastDispatchUpdate({ action: 'calls_bulk_archived', count: callsToArchive.length });

    res.json({ archived_count: callsToArchive.length, message: `${callsToArchive.length} call(s) archived` });
  } catch (error: any) {
    console.error('Bulk archive error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/archive - Archive a closed/cleared call
router.post('/calls/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status === 'archived') {
      res.status(400).json({ error: 'Call is already archived' });
      return;
    }

    const now = localNow();
    db.prepare('UPDATE calls_for_service SET status = ?, archived_at = ? WHERE id = ?')
      .run('archived', now, call.id);

    // Free up any assigned units when archiving
    let unitIds: number[] = [];
    try {
      unitIds = JSON.parse(call.assigned_unit_ids || '[]');
    } catch { /* ignore */ }
    for (const unitId of unitIds) {
      db.prepare(`UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?`)
        .run(now, unitId, call.id);
    }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_archived', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} archived`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_archived', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('Archive call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/unarchive - Restore archived call back to closed
router.post('/calls/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status !== 'archived') {
      res.status(400).json({ error: 'Call is not archived' });
      return;
    }

    db.prepare('UPDATE calls_for_service SET status = ? WHERE id = ?').run('closed', call.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_unarchived', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} restored from archive`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_unarchived', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/calls/:id - Hard delete a call (admin/manager only)
router.delete('/calls/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    // If call has active units assigned, free them first
    let unitIds: number[] = [];
    try { unitIds = JSON.parse(call.assigned_unit_ids || '[]'); } catch { /* ignore */ }
    const now = localNow();
    for (const unitId of unitIds) {
      db.prepare(`
        UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?
      `).run(now, unitId, call.id);
    }

    // Nullify FK references in related tables before deleting the call
    try { db.prepare('UPDATE incidents SET call_id = NULL WHERE call_id = ?').run(call.id); } catch { /* ignore */ }
    try { db.prepare('UPDATE units SET current_call_id = NULL WHERE current_call_id = ?').run(call.id); } catch { /* ignore */ }
    try { db.prepare('DELETE FROM record_links WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)').run('call', String(call.id), 'call', String(call.id)); } catch { /* ignore */ }

    // Delete related records
    try { db.prepare('DELETE FROM activity_log WHERE entity_type = ? AND entity_id = ?').run('call', call.id); } catch { /* ignore */ }
    try { db.prepare("DELETE FROM activity_log WHERE entity_type = 'call' AND entity_id = ?").run(String(call.id)); } catch { /* ignore */ }

    db.prepare('DELETE FROM calls_for_service WHERE id = ?').run(call.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_deleted', 'call', ?, ?, ?)`).run(
      req.user!.userId, call.id, `Deleted call ${call.call_number}`, req.ip || 'unknown');

    broadcastDispatchUpdate({ action: 'call_deleted', call_id: call.id });
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete call error:', error);
    const msg = error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
      ? 'Cannot delete: this call has linked records. Unlink them first.'
      : 'Failed to delete call';
    res.status(500).json({ error: msg });
  }
});

// PUT /api/dispatch/calls/:id/timeline/:entryId - Edit a timeline/activity entry
router.put('/calls/:id/timeline/:entryId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const entry = db.prepare('SELECT * FROM activity_log WHERE id = ? AND entity_type = ? AND entity_id = ?')
      .get(req.params.entryId, 'call', req.params.id) as any;
    if (!entry) {
      res.status(404).json({ error: 'Timeline entry not found' });
      return;
    }

    const { details, created_at } = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    if (details !== undefined) { updates.push('details = ?'); params.push(details); }
    if (created_at !== undefined) { updates.push('created_at = ?'); params.push(created_at); }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    params.push(entry.id);
    db.prepare(`UPDATE activity_log SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT al.*, u.full_name as user_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.id = ?').get(entry.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update timeline entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/calls/:id/timeline/:entryId - Delete a timeline/activity entry
router.delete('/calls/:id/timeline/:entryId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const entry = db.prepare('SELECT * FROM activity_log WHERE id = ? AND entity_type = ? AND entity_id = ?')
      .get(req.params.entryId, 'call', req.params.id) as any;
    if (!entry) {
      res.status(404).json({ error: 'Timeline entry not found' });
      return;
    }

    db.prepare('DELETE FROM activity_log WHERE id = ?').run(entry.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete timeline entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/timeline - Add a manual timeline entry
router.post('/calls/:id/timeline', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { action, details, created_at } = req.body;
    if (!details) {
      res.status(400).json({ error: 'details is required' });
      return;
    }

    const timestamp = created_at || localNow();
    const result = db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'call', ?, ?, ?, ?)
    `).run(req.user!.userId, action || 'note_added', call.id, details, req.ip || 'unknown', timestamp);

    const entry = db.prepare('SELECT al.*, u.full_name as user_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.id = ?').get(result.lastInsertRowid);
    res.status(201).json(entry);
  } catch (error: any) {
    console.error('Add timeline entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/:id/warnings - Get warning tags for a call
router.get('/calls/:id/warnings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const warnings: Array<{ type: string; label: string; severity: 'critical' | 'high' | 'medium'; source: string }> = [];

    // Check call flags
    if (call.weapons_involved) {
      warnings.push({ type: 'ARMED', label: 'ARMED / WEAPONS', severity: 'critical', source: 'call' });
    }
    if (call.domestic_violence) {
      warnings.push({ type: 'DV', label: 'DOMESTIC VIOLENCE', severity: 'high', source: 'call' });
    }
    if (call.injuries_reported) {
      warnings.push({ type: 'INJURIES', label: 'INJURIES REPORTED', severity: 'high', source: 'call' });
    }
    if (call.alcohol_involved) {
      warnings.push({ type: 'ALCOHOL', label: 'ALCOHOL INVOLVED', severity: 'medium', source: 'call' });
    }
    if (call.drugs_involved) {
      warnings.push({ type: 'DRUGS', label: 'DRUGS INVOLVED', severity: 'medium', source: 'call' });
    }

    // Check linked persons for caution flags and warrants
    try {
      const linkedPersons = db.prepare(`
        SELECT p.id, p.first_name, p.last_name, p.caution_flags, p.is_sex_offender, p.gang_affiliation,
               p.probation_parole
        FROM incident_persons ip
        JOIN persons p ON ip.person_id = p.id
        JOIN incidents i ON ip.incident_id = i.id
        WHERE i.call_id = ?
      `).all(call.id) as any[];

      for (const person of linkedPersons) {
        if (person.caution_flags) {
          const flags = person.caution_flags.split(',').map((f: string) => f.trim()).filter(Boolean);
          for (const flag of flags) {
            warnings.push({
              type: 'CAUTION',
              label: flag.toUpperCase(),
              severity: 'high',
              source: `${person.first_name} ${person.last_name}`
            });
          }
        }
        if (person.is_sex_offender) {
          warnings.push({ type: 'SEX_OFFENDER', label: 'SEX OFFENDER', severity: 'critical', source: `${person.first_name} ${person.last_name}` });
        }
        if (person.gang_affiliation) {
          warnings.push({ type: 'GANG', label: 'GANG AFFILIATED', severity: 'critical', source: `${person.first_name} ${person.last_name}` });
        }
        if (person.probation_parole) {
          warnings.push({ type: 'PROBATION', label: 'ON PROBATION/PAROLE', severity: 'high', source: `${person.first_name} ${person.last_name}` });
        }
        // Pre-Trial Supervision
        if (person.probation_parole && person.probation_parole.toLowerCase().includes('pre-trial')) {
          warnings.push({ type: 'PTS', label: 'PRE-TRIAL SUPERVISION', severity: 'high', source: `${person.first_name} ${person.last_name}` });
        }
      }
    } catch { /* linked persons table may not exist */ }

    // Check for active warrants at location
    try {
      const activeWarrants = db.prepare(`
        SELECT w.warrant_number, w.charge_description, w.type, w.offense_level,
               p.first_name, p.last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
        AND (w.subject_person_id IN (
          SELECT ip.person_id FROM incident_persons ip
          JOIN incidents i ON ip.incident_id = i.id
          WHERE i.call_id = ?
        ))
      `).all(call.id) as any[];

      for (const warrant of activeWarrants) {
        warnings.push({
          type: 'WARRANT',
          label: `ACTIVE WARRANT: ${warrant.charge_description || warrant.type}`.toUpperCase(),
          severity: 'critical',
          source: `${warrant.first_name || ''} ${warrant.last_name || ''}`.trim() || warrant.warrant_number
        });
      }
    } catch { /* warrants table may not exist */ }

    // Check property hazard notes
    if (call.property_id) {
      try {
        const property = db.prepare('SELECT hazard_notes, post_orders FROM properties WHERE id = ?').get(call.property_id) as any;
        if (property?.hazard_notes) {
          warnings.push({ type: 'HAZARD', label: 'PROPERTY HAZARD', severity: 'high', source: 'Property file' });
        }
      } catch { /* ignore */ }
    }

    // Incident type-based warnings
    const itype = (call.incident_type || '').toLowerCase();
    if (itype.includes('shooting') || itype.includes('shots_fired') || itype.includes('armed')) {
      if (!warnings.find(w => w.type === 'ARMED')) {
        warnings.push({ type: 'ARMED', label: 'POSSIBLE WEAPONS', severity: 'critical', source: 'Incident type' });
      }
    }
    if (itype.includes('barricade') || itype.includes('hostage') || itype.includes('standoff')) {
      warnings.push({ type: 'BARRICADE', label: 'BARRICADED SUBJECT', severity: 'critical', source: 'Incident type' });
    }
    if (itype.includes('hazmat') || itype.includes('chemical') || itype.includes('spill')) {
      warnings.push({ type: 'HAZMAT', label: 'HAZMAT', severity: 'critical', source: 'Incident type' });
    }

    res.json(warnings);
  } catch (error: any) {
    console.error('Get warnings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/dispatch/panic ───────────────────────
// Emergency PANIC button — broadcasts audible alert to all connected users
router.post('/panic', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { latitude, longitude, message } = req.body;

    const user = db.prepare('SELECT id, full_name, badge_number, role FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const now = localNow();

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

    // ── Reverse-geocode officer GPS → address (with fallback) ──
    let locationAddress = latitude && longitude
      ? `GPS: ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
      : 'Unknown location';

    if (latitude && longitude) {
      try {
        const addr = await reverseGeocodeAddress(Number(latitude), Number(longitude));
        if (addr) locationAddress = addr;
      } catch { /* keep GPS fallback */ }
    }

    // ── Auto-create "Officer Assist — Panic Alarm" dispatch call ──
    const callNumber = generateCallNumber(db);
    const description = `PANIC ALARM — Officer ${user.full_name} (Badge: ${user.badge_number || 'N/A'}) triggered emergency alert.${message ? ' Message: ' + message : ''}`;

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
      latitude || null,
      longitude || null,
      description,
      user.id,
      now,
      now,
    );

    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?')
      .get(callResult.lastInsertRowid) as any;

    // ── Auto-assign officer's unit to the call ──
    const unit = db.prepare('SELECT id, call_sign FROM units WHERE officer_id = ?')
      .get(user.id) as any;

    if (unit) {
      db.prepare('UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?')
        .run('dispatched', call.id, now, unit.id);

      // Update call's assigned_unit_ids JSON array
      const unitIds = JSON.stringify([String(unit.id)]);
      db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
        .run(unitIds, call.id);

      broadcastUnitUpdate({ action: 'unit_status_changed', unit: { ...unit, status: 'dispatched', current_call_id: call.id } });
    }

    // Log call creation
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_created', 'call', ?, ?, ?)
    `).run(user.id, call.id, `PANIC auto-created ${callNumber}: officer_assist`, req.ip || 'unknown');

    // ── Broadcast panic alert to ALL clients (with call info) ──
    broadcastPanic({
      user_id: user.id,
      user_name: user.full_name,
      badge_number: user.badge_number,
      role: user.role,
      message: message || null,
      latitude: latitude || null,
      longitude: longitude || null,
      triggered_at: now,
      call_number: callNumber,
      call_id: call.id,
      location_address: locationAddress,
      unit_call_sign: unit?.call_sign || null,
    });

    // ── Broadcast dispatch update so Dispatch page picks up the new call ──
    const enrichedCall = db.prepare(`
      SELECT c.*, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.id = ?
    `).get(call.id);

    broadcastDispatchUpdate({ action: 'call_created', call: enrichedCall || call });

    res.json({
      success: true,
      message: 'Panic alert sent — dispatch call created',
      call_number: callNumber,
      call_id: call.id,
    });
  } catch (error: any) {
    console.error('Panic alert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/dispatch/premise-history ───────────────────────
// Premise history lookup — returns prior calls at or near a given address.
// Used by the command line (PR command) and NewCallModal for officer safety alerts.
router.get('/premise-history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { address } = req.query;

    if (!address || (address as string).length < 3) {
      res.status(400).json({ error: 'Address must be at least 3 characters' });
      return;
    }

    const searchTerm = `%${address}%`;

    // Find prior calls at this address (fuzzy match on location_address)
    const calls = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status, c.disposition,
        c.location_address, c.created_at, c.cleared_at,
        c.weapons_involved, c.domestic_violence, c.injuries_reported,
        c.alcohol_involved, c.drugs_involved, c.description
      FROM calls_for_service c
      WHERE c.location_address LIKE ?
      ORDER BY c.created_at DESC
      LIMIT 20
    `).all(searchTerm) as any[];

    // Determine if there are hazardous warnings
    const warningTypes: string[] = [];
    for (const call of calls) {
      if (call.weapons_involved && !warningTypes.includes('ARMED'))
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
        SELECT hazard_notes FROM properties WHERE address LIKE ? AND hazard_notes IS NOT NULL LIMIT 1
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
    console.error('Premise history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/dispatch/safety-screen ─────────────────────────
// Officer Safety Auto-Screening — searches persons and warrants
// by name to detect active warrants, caution flags, criminal history.
// Used by NewCallModal for real-time safety alerts during call creation.
router.get('/safety-screen', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name } = req.query;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.json({ persons: [], directWarrantHits: [], hasWarnings: false });
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
        WHERE (first_name LIKE ? AND last_name LIKE ?)
           OR (first_name LIKE ? AND last_name LIKE ?)
           OR (first_name || ' ' || last_name LIKE ?)
        LIMIT 10
      `).all(
        `%${parts[0]}%`, `%${parts[1]}%`,
        `%${parts[1]}%`, `%${parts[0]}%`,
        `%${searchName}%`
      );
    } else {
      personRows = db.prepare(`
        SELECT * FROM persons
        WHERE first_name LIKE ? OR last_name LIKE ?
        LIMIT 10
      `).all(`%${parts[0]}%`, `%${parts[0]}%`);
    }

    // Enrich each person with warrants and criminal history
    const persons = personRows.map((person: any) => {
      const warrants = db.prepare(`
        SELECT * FROM warrants
        WHERE status = 'active'
          AND subject_first_name LIKE ? AND subject_last_name LIKE ?
      `).all(`%${person.first_name}%`, `%${person.last_name}%`);

      const criminalHistory = db.prepare(`
        SELECT * FROM criminal_history WHERE person_id = ? ORDER BY charge_date DESC LIMIT 10
      `).all(person.id);

      return { person, warrants, criminalHistory };
    });

    // ── Search warrants directly by subject name ──
    let directWarrantHits: any[] = [];
    if (parts.length >= 2) {
      directWarrantHits = db.prepare(`
        SELECT * FROM warrants
        WHERE status = 'active'
          AND ((subject_first_name LIKE ? AND subject_last_name LIKE ?)
            OR (subject_first_name LIKE ? AND subject_last_name LIKE ?))
        LIMIT 10
      `).all(
        `%${parts[0]}%`, `%${parts[1]}%`,
        `%${parts[1]}%`, `%${parts[0]}%`
      );
    } else {
      directWarrantHits = db.prepare(`
        SELECT * FROM warrants
        WHERE status = 'active'
          AND (subject_first_name LIKE ? OR subject_last_name LIKE ?)
        LIMIT 10
      `).all(`%${parts[0]}%`, `%${parts[0]}%`);
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
    console.error('Safety screen error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/dispatch/districts ─ List all 3-tier dispatch districts ──
router.get('/districts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const districts = db.prepare('SELECT * FROM dispatch_districts ORDER BY section_id, zone_id, beat_id').all();
    res.json(districts);
  } catch (error: any) {
    console.error('Districts list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/dispatch/districts/lookup ─ Lookup 3-tier by zone_id + beat_id ──
router.get('/districts/lookup', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { zone_id, beat_id } = req.query;

    if (!zone_id) {
      res.status(400).json({ error: 'zone_id is required' });
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
    console.error('District lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/dispatch/districts/identify ─ Identify district from GPS coordinates ──
router.get('/districts/identify', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      res.status(400).json({ error: 'lat and lng are required' });
      return;
    }

    const beat = identifyBeat(Number(lat), Number(lng));
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
    console.error('District identify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/dispatch/calls/:id/mileage ─ Update starting/ending mileage ──
router.put('/calls/:id/mileage', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { starting_mileage, ending_mileage } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

    if (starting_mileage !== undefined) {
      updates.push('starting_mileage = ?');
      params.push(starting_mileage || null);
    }
    if (ending_mileage !== undefined) {
      updates.push('ending_mileage = ?');
      params.push(ending_mileage || null);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No mileage fields provided' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(localNow());
    params.push(req.params.id);

    db.prepare(`UPDATE calls_for_service SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Log activity
    const details = [];
    if (starting_mileage !== undefined) details.push(`start: ${starting_mileage}`);
    if (ending_mileage !== undefined) details.push(`end: ${ending_mileage}`);
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'mileage_updated', 'call', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Mileage for ${call.call_number}: ${details.join(', ')}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });

    res.json(updated);
  } catch (error: any) {
    console.error('Mileage update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── SMART UNIT RECOMMENDATION ENGINE ──────────────────────────
// Ranks available units for a call based on distance, capabilities, workload, and familiarity

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get('/calls/:id/recommend-units', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    // Get all units that could potentially respond (available, busy, or dispatched but not off-duty)
    const units = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.specializations
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.status IN ('available', 'busy', 'dispatched')
        AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
    `).all() as any[];

    if (units.length === 0) { res.json([]); return; }

    const callLat = call.latitude;
    const callLng = call.longitude;
    const today = new Date().toISOString().split('T')[0];

    const recommendations = units.map((unit: any) => {
      let totalScore = 0;
      const breakdown: Record<string, number> = {};

      // 1. Distance score (0-40) — closest gets 40, scaled by max distance among candidates
      let distanceMiles = 999;
      if (callLat && callLng && unit.latitude && unit.longitude) {
        distanceMiles = haversineDistance(callLat, callLng, unit.latitude, unit.longitude);
      }
      // Score: 40 for 0 miles, 0 for 20+ miles, linear interpolation
      const distScore = Math.max(0, Math.round(40 * (1 - distanceMiles / 20)));
      breakdown.distance = distScore;
      totalScore += distScore;

      // 2. Capability match (0-25) — check if unit has relevant specializations
      let capScore = 0;
      let specs: string[] = [];
      try { specs = JSON.parse(unit.specializations || '[]'); } catch { specs = []; }
      let caps: string[] = [];
      try { caps = JSON.parse(unit.capabilities || '[]'); } catch { caps = []; }
      const allCaps = [...specs, ...caps].map((c: string) => c.toLowerCase());

      if (call.weapons_involved && allCaps.some((c: string) => ['tactical', 'swat', 'armed_response'].includes(c))) capScore += 15;
      if (call.domestic_violence && allCaps.some((c: string) => ['dv', 'domestic_violence', 'dv_trained'].includes(c))) capScore += 15;
      if (call.mental_health_crisis && allCaps.some((c: string) => ['cit', 'mental_health', 'crisis_intervention'].includes(c))) capScore += 15;
      if (call.k9_requested && allCaps.some((c: string) => ['k9', 'canine'].includes(c))) capScore += 20;
      if (call.felony_in_progress && allCaps.some((c: string) => ['tactical', 'swat', 'felony'].includes(c))) capScore += 10;
      capScore = Math.min(25, capScore);
      breakdown.capability = capScore;
      totalScore += capScore;

      // 3. Workload score (0-20) — fewer calls today = higher score
      const workload = db.prepare(`
        SELECT COUNT(*) as call_count FROM activity_log
        WHERE user_id = ? AND action = 'status_changed' AND entity_type = 'call'
          AND created_at >= ?
      `).get(unit.officer_id || 0, today) as any;
      const callCount = workload?.call_count || 0;
      const workloadScore = Math.max(0, 20 - callCount * 3);
      breakdown.workload = workloadScore;
      totalScore += workloadScore;

      // 4. Premise familiarity (0-15) — has this officer responded here before?
      let familiarityScore = 0;
      if (call.location_address && unit.officer_id) {
        const priorCalls = db.prepare(`
          SELECT COUNT(*) as cnt FROM calls_for_service
          WHERE location_address = ? AND assigned_unit_ids LIKE ?
            AND created_at >= datetime('now', 'localtime', '-365 days')
        `).get(call.location_address, `%${unit.id}%`) as any;
        familiarityScore = Math.min(15, (priorCalls?.cnt || 0) * 5);
      }
      breakdown.familiarity = familiarityScore;
      totalScore += familiarityScore;

      return {
        unit_id: unit.id,
        unit_name: unit.unit_name || unit.call_sign,
        call_sign: unit.call_sign,
        officer_name: unit.officer_name,
        status: unit.status,
        distance_miles: Math.round(distanceMiles * 100) / 100,
        total_score: totalScore,
        breakdown,
      };
    });

    // Sort by total score descending, return top 5
    recommendations.sort((a: any, b: any) => b.total_score - a.total_score);
    res.json(recommendations.slice(0, 5));
  } catch (error: any) {
    console.error('Unit recommendation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ANOMALY ALERTS ──────────────────────────────────────────

// GET /api/dispatch/anomaly-alerts
router.get('/anomaly-alerts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = parseInt(req.query.hours as string) || 4;
    const alerts = db.prepare(`
      SELECT a.*, u.full_name as acknowledged_by_name
      FROM anomaly_alerts a
      LEFT JOIN users u ON a.acknowledged_by = u.id
      WHERE a.created_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY a.created_at DESC
    `).all(hours);
    res.json(alerts);
  } catch (error: any) {
    console.error('Anomaly alerts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/anomaly-alerts/:id/acknowledge
router.post('/anomaly-alerts/:id/acknowledge', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alert = db.prepare('SELECT * FROM anomaly_alerts WHERE id = ?').get(req.params.id) as any;
    if (!alert) { res.status(404).json({ error: 'Alert not found' }); return; }

    db.prepare(`
      UPDATE anomaly_alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?
    `).run(req.user!.userId, localNow(), req.params.id);

    const updated = db.prepare('SELECT * FROM anomaly_alerts WHERE id = ?').get(req.params.id);
    broadcastDispatchUpdate({ action: 'anomaly_acknowledged', alert: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('Anomaly acknowledge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── BACKUP REQUEST ──────────────────────────────────────────

// POST /api/dispatch/request-backup
router.post('/request-backup', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { latitude, longitude, message } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as any;
    const unit = db.prepare('SELECT * FROM units WHERE officer_id = ?').get(req.user!.userId) as any;

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'backup_requested', 'unit', ?, ?, ?)
    `).run(req.user!.userId, unit?.id || null, `Backup requested by ${user?.full_name || 'Unknown'}: ${message || 'No message'}`, req.ip || 'unknown');

    // Broadcast to dispatch channel
    broadcastDispatchUpdate({
      action: 'backup_requested',
      user_id: req.user!.userId,
      user_name: user?.full_name,
      badge_number: user?.badge_number,
      call_sign: unit?.call_sign,
      current_call_id: unit?.current_call_id,
      latitude, longitude, message,
      requested_at: localNow(),
    });

    // Notify all dispatchers
    const dispatchers = db.prepare(
      "SELECT id FROM users WHERE role IN ('admin', 'supervisor', 'dispatcher') AND status = 'active'"
    ).all() as any[];
    for (const d of dispatchers) {
      createNotification(
        d.id, 'backup_request', `BACKUP: ${unit?.call_sign || user?.full_name}`,
        message || 'Officer requesting backup',
        'unit', unit?.id || null, 'critical'
      );
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Backup request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
