import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastIncidentUpdate } from '../utils/websocket';
import { generateIncidentNumber } from '../utils/caseNumbers';
import { sendCsv } from '../utils/csvExport';
import { localNow } from '../utils/timeUtils';
import { identifyBeat } from '../utils/geofence';
import { geocodeAddress } from '../utils/geocode';

const router = Router();

router.use(authenticateToken);

// GET /api/incidents - List incidents with filters
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, priority, officerId, startDate, endDate, archived, page = '1', limit = '50' } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND i.status = ?';
      params.push(status);
    }
    if (priority) {
      whereClause += ' AND i.priority = ?';
      params.push(priority);
    }
    if (officerId) {
      whereClause += ' AND i.officer_id = ?';
      params.push(officerId);
    }
    if (startDate) {
      whereClause += ' AND i.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND i.created_at <= ?';
      params.push(endDate);
    }

    // Archive filter: use archived_at column
    if (archived === 'true') {
      whereClause += ' AND i.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND i.archived_at IS NULL';
    }

    // If user is an officer, only show their own incidents unless supervisor+
    if (req.user!.role === 'officer') {
      whereClause += ' AND i.officer_id = ?';
      params.push(req.user!.userId);
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, Math.min(500, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM incidents i ${whereClause}`).get(...params) as any;

    const incidents = db.prepare(`
      SELECT i.*, o.full_name as officer_name, o.badge_number,
        s.full_name as supervisor_name, p.name as property_name,
        c.call_number, cl.name as client_name
      FROM incidents i
      LEFT JOIN users o ON i.officer_id = o.id
      LEFT JOIN users s ON i.supervisor_id = s.id
      LEFT JOIN properties p ON i.property_id = p.id
      LEFT JOIN calls_for_service c ON i.call_id = c.id
      LEFT JOIN clients cl ON COALESCE(i.client_id, p.client_id) = cl.id
      ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({
      data: incidents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Get incidents error:', error);
    res.status(500).json({ error: 'Failed to get incidents', code: 'GET_INCIDENTS_ERROR' });
  }
});

// GET /api/incidents/map - Incidents with coordinates for map display
router.get('/map', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const limit = Math.max(1, Math.min(2000, parseInt(req.query.limit as string, 10) || 500));

    const statusFilter = req.query.status
      ? String(req.query.status).split(',').filter(s => s.length > 0 && s.length < 50).slice(0, 10)
      : [];

    const typesFilter = req.query.types
      ? String(req.query.types).split(',').filter(t => t.length > 0 && t.length < 100).slice(0, 30)
      : [];

    const conditions: string[] = [
      'i.latitude IS NOT NULL',
      'i.longitude IS NOT NULL',
      `i.created_at >= datetime('now', 'localtime', '-${days} days')`,
      'i.archived_at IS NULL',
    ];
    const params: any[] = [];

    if (statusFilter.length > 0) {
      const placeholders = statusFilter.map(() => '?').join(',');
      conditions.push(`i.status IN (${placeholders})`);
      params.push(...statusFilter);
    }

    if (typesFilter.length > 0) {
      const placeholders = typesFilter.map(() => '?').join(',');
      conditions.push(`i.incident_type IN (${placeholders})`);
      params.push(...typesFilter);
    }

    // Officers can only see their own incidents
    if (req.user!.role === 'officer') {
      conditions.push('i.officer_id = ?');
      params.push(req.user!.userId);
    }

    const whereClause = conditions.join(' AND ');

    const rows = db.prepare(`
      SELECT
        i.id,
        i.incident_number,
        i.incident_type,
        i.priority,
        i.status,
        i.location_address,
        i.latitude,
        i.longitude,
        SUBSTR(i.narrative, 1, 100) as narrative_preview,
        o.full_name as officer_name,
        i.created_at,
        c.call_number,
        i.incident_number
      FROM incidents i
      LEFT JOIN users o ON i.officer_id = o.id
      LEFT JOIN calls_for_service c ON i.call_id = c.id
      WHERE ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT ?
    `).all(...params, limit);

    res.json(rows);
  } catch (error: any) {
    console.error('Get incidents map error:', error);
    res.status(500).json({ error: 'Failed to get incidents map', code: 'GET_INCIDENTS_MAP_ERROR' });
  }
});

// GET /api/incidents/stats - Incident statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM incidents GROUP BY status
    `).all();

    const byType = db.prepare(`
      SELECT incident_type, COUNT(*) as count FROM incidents GROUP BY incident_type ORDER BY count DESC LIMIT 10
    `).all();

    const pendingReview = db.prepare(`
      SELECT COUNT(*) as count FROM incidents WHERE status IN ('submitted', 'under_review')
    `).get() as any;

    const thisMonth = db.prepare(`
      SELECT COUNT(*) as count FROM incidents
      WHERE created_at >= date('now', 'start of month')
    `).get() as any;

    const lastMonth = db.prepare(`
      SELECT COUNT(*) as count FROM incidents
      WHERE created_at >= date('now', 'start of month', '-1 month')
        AND created_at < date('now', 'start of month')
    `).get() as any;

    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      byStatus,
      byType,
      pendingReview: pendingReview.count,
      thisMonth: thisMonth.count,
      lastMonth: lastMonth.count,
    });
  } catch (error: any) {
    console.error('Get incident stats error:', error);
    res.status(500).json({ error: 'Failed to get incident stats', code: 'GET_INCIDENT_STATS_ERROR' });
  }
});

// GET /api/incidents/export - Export incidents as CSV
router.get('/export', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, priority, officerId, startDate, endDate } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND i.status = ?';
      params.push(status);
    }
    if (priority) {
      whereClause += ' AND i.priority = ?';
      params.push(priority);
    }
    if (officerId) {
      whereClause += ' AND i.officer_id = ?';
      params.push(officerId);
    }
    if (startDate) {
      whereClause += ' AND i.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND i.created_at <= ?';
      params.push(endDate);
    }

    if (req.user!.role === 'officer') {
      whereClause += ' AND i.officer_id = ?';
      params.push(req.user!.userId);
    }

    const rows = db.prepare(`
      SELECT i.incident_number, i.incident_type, i.priority, i.status, i.location_address,
        CASE WHEN LENGTH(i.narrative) > 200 THEN SUBSTR(i.narrative, 1, 200) || '...' ELSE i.narrative END as narrative,
        o.full_name as officer_name, i.created_at, i.updated_at
      FROM incidents i
      LEFT JOIN users o ON i.officer_id = o.id
      ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT 5000
    `).all(...params);

    sendCsv(res, 'incidents_export.csv', [
      { key: 'incident_number', header: 'Incident Number' },
      { key: 'incident_type', header: 'Incident Type' },
      { key: 'priority', header: 'Priority' },
      { key: 'status', header: 'Status' },
      { key: 'location_address', header: 'Location Address' },
      { key: 'narrative', header: 'Narrative' },
      { key: 'officer_name', header: 'Officer Name' },
      { key: 'created_at', header: 'Created At' },
      { key: 'updated_at', header: 'Updated At' },
    ], rows);
  } catch (error: any) {
    console.error('Export incidents error:', error);
    res.status(500).json({ error: 'Failed to export incidents', code: 'EXPORT_INCIDENTS_ERROR' });
  }
});

// GET /api/incidents/:id - Get single incident
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incidentId = parseInt(req.params.id, 10);
    if (isNaN(incidentId)) {
      res.status(400).json({ error: 'Invalid incident ID', code: 'INVALID_INCIDENT_ID' });
      return;
    }
    const incident = db.prepare(`
      SELECT i.*, o.full_name as officer_name, o.badge_number,
        s.full_name as supervisor_name, p.name as property_name,
        c.call_number, c.incident_type as call_type,
        cl.name as client_name
      FROM incidents i
      LEFT JOIN users o ON i.officer_id = o.id
      LEFT JOIN users s ON i.supervisor_id = s.id
      LEFT JOIN properties p ON i.property_id = p.id
      LEFT JOIN calls_for_service c ON i.call_id = c.id
      LEFT JOIN clients cl ON COALESCE(i.client_id, p.client_id) = cl.id
      WHERE i.id = ?
    `).get(incidentId) as any;

    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    // Get evidence
    const evidence = db.prepare(`
      SELECT * FROM evidence WHERE incident_id = ?
    
      LIMIT 1000
    `).all(incident.id);

    // Get linked persons
    const linked_persons = db.prepare(`
      SELECT ip.*, p.first_name, p.last_name, p.dob, p.phone, p.flags,
        u.full_name as added_by_name
      FROM incident_persons ip
      LEFT JOIN persons p ON ip.person_id = p.id
      LEFT JOIN users u ON ip.added_by = u.id
      WHERE ip.incident_id = ?
      ORDER BY ip.created_at
    
      LIMIT 1000
    `).all(incident.id);

    // Get linked vehicles
    const linked_vehicles = db.prepare(`
      SELECT iv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin,
        p.first_name as owner_first_name, p.last_name as owner_last_name,
        u.full_name as added_by_name
      FROM incident_vehicles iv
      LEFT JOIN vehicles_records v ON iv.vehicle_id = v.id
      LEFT JOIN persons p ON v.owner_person_id = p.id
      LEFT JOIN users u ON iv.added_by = u.id
      WHERE iv.incident_id = ?
      ORDER BY iv.created_at
    
      LIMIT 1000
    `).all(incident.id);

    // Get activity log
    const activity = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'incident' AND al.entity_id = ?
      ORDER BY al.created_at DESC
    
      LIMIT 1000
    `).all(incident.id);

    res.json({
      ...incident,
      evidence,
      linked_persons,
      linked_vehicles,
      activity,
    });
  } catch (error: any) {
    console.error('Get incident error:', error);
    res.status(500).json({ error: 'Failed to get incident', code: 'GET_INCIDENT_ERROR' });
  }
});

// POST /api/incidents - Create incident
router.post('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      call_id, incident_type, priority, location_address, property_id,
      latitude, longitude, narrative,
      occurred_date, occurred_time, end_date, end_time,
      weather_conditions, lighting_conditions,
      injuries, injury_description, damage_estimate, damage_description,
      weapons_involved, alcohol_involved, drugs_involved, domestic_violence,
      disposition, zone_beat, section_id, zone_id, beat_id, responding_le_agency, le_case_number,
      client_id: requestClientId, contract_id,
      // PSO / Process Service fields
      pso_service_type, pso_attempt_number, pso_requestor_name, pso_requestor_phone,
      pso_requestor_email, pso_billing_code, pso_authorization,
      process_service_type, process_served_to, process_served_address,
      process_served_at, process_service_result, process_attempts,
      // Sub-type fields
      road_conditions, traffic_control, vehicle_1_info, vehicle_2_info, diagram_notes,
      patient_status, ems_transport, patient_vitals, treatment_rendered,
      trespass_warning_issued, trespass_effective_date, trespass_expiry_date, property_boundaries,
      force_type, force_justification, subject_injuries, officer_injuries, de_escalation_attempts,
    } = req.body;

    if (!incident_type) {
      res.status(400).json({ error: 'incident_type is required', code: 'INCIDENTTYPE_IS_REQUIRED' });
      return;
    }

    // Max length validation
    if (narrative && String(narrative).length > 50000) {
      res.status(400).json({ error: 'Narrative too long (max 50000 chars)', code: 'FIELD_TOO_LONG' });
      return;
    }

    // Prevent duplicate active incidents for the same call
    if (call_id) {
      const existingIncident = db.prepare(
        "SELECT id, incident_number FROM incidents WHERE call_id = ? AND status NOT IN ('closed', 'archived') AND archived_at IS NULL"
      ).get(call_id) as any;
      if (existingIncident) {
        res.status(409).json({
          error: `An active incident (${existingIncident.incident_number}) is already linked to this call`,
          code: 'CALL_ALREADY_HAS_INCIDENT',
          existing_incident_id: existingIncident.id,
        });
        return;
      }
    }

    // Auto-resolve client_id from property if not provided
    let resolvedClientId = requestClientId || null;
    if (!resolvedClientId && property_id) {
      const prop = db.prepare('SELECT client_id FROM properties WHERE id = ?').get(property_id) as any;
      if (prop) resolvedClientId = prop.client_id;
    }

    // Generate incident number: RMP-YY-NNNNN-CODE
    const incidentNumber = generateIncidentNumber(db, incident_type);

    const { statute_id, statute_citation, citation_fine } = req.body;

    // Auto-geocode if address provided but no coordinates
    let resolvedLat = latitude || null;
    let resolvedLng = longitude || null;
    if (location_address && (!resolvedLat || !resolvedLng)) {
      try {
        const coords = await geocodeAddress(location_address);
        if (coords) { resolvedLat = coords.latitude; resolvedLng = coords.longitude; }
      } catch { /* non-critical */ }
    }

    // ── Auto-fill Beat / Zone / Sector from GPS coordinates + 3-Tier lookup ──
    let autoZoneBeat = zone_beat || null;
    let autoSectionId = section_id || null;
    let autoZoneId = zone_id || null;
    let autoBeatId = beat_id || null;
    if (resolvedLat && resolvedLng) {
      try {
        const beat = identifyBeat(Number(resolvedLat), Number(resolvedLng));
        if (beat) {
          if (!autoZoneBeat) autoZoneBeat = beat.beat_code;

          // Look up 3-tier dispatch district for richer naming
          const district = db.prepare(
            'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
          ).get(beat.city_code, beat.district_letter) as any;

          if (district) {
            if (!autoSectionId) autoSectionId = district.section_id;
            if (!autoZoneId) autoZoneId = district.zone_name;
            if (!autoBeatId) autoBeatId = `${district.beat_name} — ${district.beat_descriptor}`;
          } else {
            if (!autoBeatId) autoBeatId = beat.beat_id;
            if (!autoZoneId) autoZoneId = `${beat.city} ${beat.district_letter}${beat.beat_number}`;
            if (!autoSectionId) autoSectionId = beat.district_letter;
          }
        }
      } catch { /* geofence not configured, skip */ }
    }

    const result = db.prepare(`
      INSERT INTO incidents (incident_number, call_id, incident_type, priority, status, location_address,
        property_id, latitude, longitude, narrative, officer_id,
        occurred_date, occurred_time, end_date, end_time,
        weather_conditions, lighting_conditions,
        injuries, injury_description, damage_estimate, damage_description,
        weapons_involved, alcohol_involved, drugs_involved, domestic_violence,
        disposition, zone_beat, section_id, zone_id, beat_id, responding_le_agency, le_case_number,
        statute_id, statute_citation, citation_fine, client_id, contract_id,
        pso_service_type, pso_attempt_number, pso_requestor_name, pso_requestor_phone,
        pso_requestor_email, pso_billing_code, pso_authorization,
        process_service_type, process_served_to, process_served_address,
        process_served_at, process_service_result, process_attempts,
        road_conditions, traffic_control, vehicle_1_info, vehicle_2_info, diagram_notes,
        patient_status, ems_transport, patient_vitals, treatment_rendered,
        trespass_warning_issued, trespass_effective_date, trespass_expiry_date, property_boundaries,
        force_type, force_justification, subject_injuries, officer_injuries, de_escalation_attempts,
        created_at)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?)
    `).run(
      incidentNumber, call_id || null, incident_type, priority || 'P3',
      location_address || null, property_id || null, resolvedLat || null,
      resolvedLng || null, narrative || null, req.user!.userId,
      occurred_date || null, occurred_time || null, end_date || null, end_time || null,
      weather_conditions || null, lighting_conditions || null,
      injuries ?? 'none', injury_description || null, damage_estimate || null, damage_description || null,
      weapons_involved || null,
      alcohol_involved ? 1 : 0, drugs_involved ? 1 : 0, domestic_violence ? 1 : 0,
      disposition || null, autoZoneBeat, autoSectionId, autoZoneId, autoBeatId,
      responding_le_agency || null, le_case_number || null,
      statute_id || null, statute_citation || null, citation_fine || null,
      resolvedClientId, contract_id || null,
      pso_service_type || null, pso_attempt_number || null, pso_requestor_name || null, pso_requestor_phone || null,
      pso_requestor_email || null, pso_billing_code || null, pso_authorization || null,
      process_service_type || null, process_served_to || null, process_served_address || null,
      process_served_at || null, process_service_result || null, process_attempts || null,
      road_conditions || null, traffic_control || null, vehicle_1_info || null, vehicle_2_info || null, diagram_notes || null,
      patient_status || null, ems_transport || null, patient_vitals || null, treatment_rendered || null,
      trespass_warning_issued ? 1 : 0, trespass_effective_date || null, trespass_expiry_date || null, property_boundaries || null,
      force_type || null, force_justification || null, subject_injuries || null, officer_injuries || null, de_escalation_attempts || null,
      (req.user?.role === 'admin' && req.body.created_at) ? req.body.created_at : localNow(),
    );

    if (req.user?.role === 'admin' && req.body.created_at) {
      auditLog(req, 'ADMIN_OVERRIDE', 'incident', 0, `Admin God Mode: overrode created_at to ${req.body.created_at} on new incident`);
    }

    const newIncidentId = result.lastInsertRowid as number;

    // Copy linked persons and vehicles from the source call
    if (call_id) {
      try {
        const callPersons = db.prepare('SELECT person_id, role, notes FROM call_persons WHERE call_id = ?').all(call_id) as any[];
        for (const cp of callPersons) {
          db.prepare('INSERT OR IGNORE INTO incident_persons (incident_id, person_id, role, notes, added_by) VALUES (?, ?, ?, ?, ?)').run(
            newIncidentId, cp.person_id, cp.role || 'involved', cp.notes || null, req.user!.userId
          );
        }
        const callVehicles = db.prepare('SELECT vehicle_id, role, notes FROM call_vehicles WHERE call_id = ?').all(call_id) as any[];
        for (const cv of callVehicles) {
          db.prepare('INSERT OR IGNORE INTO incident_vehicles (incident_id, vehicle_id, role, notes, added_by) VALUES (?, ?, ?, ?, ?)').run(
            newIncidentId, cv.vehicle_id, cv.role || 'involved', cv.notes || null, req.user!.userId
          );
        }
      } catch (e) { /* call_persons/call_vehicles tables may not exist yet */ }

      // Inherit beat/location from call if not already set on the incident
      try {
        const srcCall = db.prepare('SELECT section_id, zone_id, beat_id, zone_beat, latitude, longitude, location_address FROM calls_for_service WHERE id = ?').get(call_id) as any;
        if (srcCall) {
          const updates: string[] = [];
          const vals: any[] = [];
          if (!autoZoneBeat && srcCall.zone_beat) { updates.push('zone_beat = ?'); vals.push(srcCall.zone_beat); }
          if (!autoSectionId && srcCall.section_id) { updates.push('section_id = ?'); vals.push(srcCall.section_id); }
          if (!autoZoneId && srcCall.zone_id) { updates.push('zone_id = ?'); vals.push(srcCall.zone_id); }
          if (!autoBeatId && srcCall.beat_id) { updates.push('beat_id = ?'); vals.push(srcCall.beat_id); }
          if (updates.length > 0) {
            vals.push(newIncidentId);
            db.prepare(`UPDATE incidents SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
          }
        }
      } catch (e) { /* non-critical */ }
    }

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(newIncidentId);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_created', 'incident', ?, ?, ?)
    `).run(req.user!.userId, newIncidentId, `Created ${incidentNumber}`, req.ip || 'unknown');

    res.status(201).json(incident);
  } catch (error: any) {
    console.error('Create incident error:', error);
    res.status(500).json({ error: 'Failed to create incident', code: 'CREATE_INCIDENT_ERROR' });
  }
});

// PUT /api/incidents/:id - Update incident
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    // Permission checks:
    // - Admin/manager/supervisor can edit any incident in any status
    // - Officers can edit their own incidents in draft, returned, submitted, or approved
    if (!['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
      if (!['draft', 'returned', 'submitted', 'approved'].includes(incident.status)) {
        res.status(403).json({ error: 'Cannot edit incidents in this status', code: 'CANNOT_EDIT_INCIDENTS_IN' });
        return;
      }
      if (incident.officer_id !== req.user!.userId) {
        res.status(403).json({ error: 'Can only edit your own incidents', code: 'CAN_ONLY_EDIT_YOUR' });
        return;
      }
    }

    const {
      incident_type, priority, location_address, property_id,
      latitude, longitude, narrative,
      occurred_date, occurred_time, end_date, end_time,
      weather_conditions, lighting_conditions,
      injuries, injury_description, damage_estimate, damage_description,
      weapons_involved, alcohol_involved, drugs_involved, domestic_violence,
      disposition, zone_beat, section_id, zone_id, beat_id, responding_le_agency, le_case_number,
    } = req.body;

    // Auto-geocode if address provided/changed but no coordinates
    if (location_address && (!latitude && !longitude)) {
      // Only geocode if address changed or incident has no coords
      if (location_address !== incident.location_address || (!incident.latitude && !incident.longitude)) {
        try {
          const coords = await geocodeAddress(location_address);
          if (coords) {
            req.body.latitude = coords.latitude;
            req.body.longitude = coords.longitude;
          }
        } catch { /* non-critical */ }
      }
    }

    // Build dynamic SET clause — only update fields explicitly provided
    const iFields: string[] = [];
    const iValues: any[] = [];
    const iBodyKeys = Object.keys(req.body);

    const iFieldMap: Record<string, (v: any) => any> = {
      incident_type: v => v ?? null, priority: v => v ?? null,
      location_address: v => v ?? null, property_id: v => v ?? null,
      latitude: v => v ?? null, longitude: v => v ?? null,
      narrative: v => v ?? null,
      occurred_date: v => v ?? null, occurred_time: v => v ?? null,
      end_date: v => v ?? null, end_time: v => v ?? null,
      weather_conditions: v => v ?? null, lighting_conditions: v => v ?? null,
      injuries: v => v ?? null, injury_description: v => v ?? null,
      damage_estimate: v => v ?? null, damage_description: v => v ?? null,
      weapons_involved: v => v ?? null,
      alcohol_involved: v => v ? 1 : 0, drugs_involved: v => v ? 1 : 0,
      domestic_violence: v => v ? 1 : 0,
      disposition: v => v ?? null, zone_beat: v => v ?? null,
      section_id: v => v ?? null, zone_id: v => v ?? null, beat_id: v => v ?? null,
      responding_le_agency: v => v ?? null, le_case_number: v => v ?? null,
      statute_id: v => v ?? null, statute_citation: v => v ?? null, citation_fine: v => v ?? null,
      client_id: v => v ?? null,
      // Sub-type fields
      road_conditions: v => v ?? null, traffic_control: v => v ?? null,
      vehicle_1_info: v => v ?? null, vehicle_2_info: v => v ?? null, diagram_notes: v => v ?? null,
      patient_status: v => v ?? null, ems_transport: v => v ?? null,
      patient_vitals: v => v ?? null, treatment_rendered: v => v ?? null,
      trespass_warning_issued: v => v ? 1 : 0,
      trespass_effective_date: v => v ?? null, trespass_expiry_date: v => v ?? null,
      property_boundaries: v => v ?? null,
      force_type: v => v ?? null, force_justification: v => v ?? null,
      subject_injuries: v => v ?? null, officer_injuries: v => v ?? null,
      de_escalation_attempts: v => v ?? null,
      // PSO Client Request fields
      pso_service_type: v => v ?? null,
      pso_attempt_number: v => v != null ? Number(v) || null : null,
      pso_requestor_name: v => v ?? null,
      pso_requestor_phone: v => v ?? null,
      pso_requestor_email: v => v ?? null,
      pso_billing_code: v => v ?? null,
      pso_authorization: v => v ?? null,
      // Process Service fields
      process_service_type: v => v ?? null,
      process_served_to: v => v ?? null,
      process_served_address: v => v ?? null,
      process_service_result: v => v ?? null,
      process_served_at: v => v ?? null,
      process_attempts: v => v != null ? Number(v) || null : null,
      // Contract / Client
      contract_id: v => v ?? null,
    };

    for (const [key, transform] of Object.entries(iFieldMap)) {
      if (iBodyKeys.includes(key)) {
        iFields.push(`${key} = ?`);
        iValues.push(transform(req.body[key]));
      }
    }

    // Admin can override updated_at timestamp
    const effectiveUpdatedAt = (req.user?.role === 'admin' && req.body.updated_at) ? req.body.updated_at : localNow();

    if (iFields.length > 0) {
      iFields.push("updated_at = ?");
      iValues.push(effectiveUpdatedAt);
      iValues.push(req.params.id);
      db.prepare(`UPDATE incidents SET ${iFields.join(', ')} WHERE id = ?`).run(...iValues);
      if (req.user?.role === 'admin' && req.body.updated_at) {
        auditLog(req, 'ADMIN_OVERRIDE', 'incident', Number(req.params.id), `Admin God Mode: overrode updated_at to ${req.body.updated_at}`);
      }
    }

    // Admin can override incident_number
    if (req.user?.role === 'admin' && req.body.incident_number) {
      db.prepare('UPDATE incidents SET incident_number = ? WHERE id = ?').run(req.body.incident_number, req.params.id);
      auditLog(req, 'ADMIN_OVERRIDE', 'incident', Number(req.params.id), `Admin God Mode: overrode incident_number to ${req.body.incident_number}`);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_updated', 'incident', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated incident ${incident.incident_number}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);

    broadcastIncidentUpdate({ id: Number(req.params.id), incident_number: incident.incident_number, action: 'updated' });

    res.json(updated);
  } catch (error: any) {
    console.error('Update incident error:', error);
    res.status(500).json({ error: 'Failed to update incident', code: 'UPDATE_INCIDENT_ERROR' });
  }
});

// DELETE /api/incidents/:id - Delete draft incident
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    // God Mode: admin bypass — can delete any incident regardless of status
    if (req.user?.role !== 'admin') {
      if (incident.status !== 'draft') {
        res.status(403).json({ error: 'Can only delete draft incidents', code: 'CAN_ONLY_DELETE_DRAFT' });
        return;
      }
    } else if (incident.status !== 'draft') {
      auditLog(req, 'ADMIN_OVERRIDE', 'incident', incident.id, `Admin God Mode: bypassed draft-only delete restriction (status: ${incident.status})`);
    }

    // Only allow deleting own incidents (unless admin/manager)
    if (req.user?.role !== 'admin' && req.user?.role !== 'manager' && incident.officer_id !== req.user!.userId) {
      res.status(403).json({ error: 'Can only delete your own incident reports', code: 'FORBIDDEN' });
      return;
    }

    const deleteIncTx = db.transaction(() => {
      db.prepare('DELETE FROM supplemental_reports WHERE incident_id = ?').run(incident.id);
      db.prepare('DELETE FROM incident_persons WHERE incident_id = ?').run(incident.id);
      db.prepare('DELETE FROM incident_vehicles WHERE incident_id = ?').run(incident.id);
      db.prepare('DELETE FROM evidence WHERE incident_id = ?').run(incident.id);
      db.prepare('DELETE FROM incidents WHERE id = ?').run(incident.id);
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'incident_deleted', 'incident', ?, ?, ?)
      `).run(req.user!.userId, incident.id, `Deleted incident ${incident.incident_number}`, req.ip || 'unknown');
    });
    deleteIncTx();

    res.json({ message: 'Incident deleted' });
  } catch (error: any) {
    console.error('Delete incident error:', error);
    res.status(500).json({ error: 'Failed to delete incident', code: 'DELETE_INCIDENT_ERROR' });
  }
});

// POST /api/incidents/:id/archive - Archive an incident
router.post('/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) { res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }); return; }
    if (incident.archived_at) { res.status(400).json({ error: 'Incident is already archived', code: 'INCIDENT_IS_ALREADY_ARCHIVED' }); return; }
    if (['draft', 'submitted'].includes(incident.status) && req.user?.role !== 'admin') {
      res.status(400).json({ error: 'Can only archive approved or closed incidents', code: 'CAN_ONLY_ARCHIVE_APPROVED' }); return;
    }
    if (req.user?.role === 'admin' && ['draft', 'submitted'].includes(incident.status)) {
      auditLog(req, 'ADMIN_OVERRIDE', 'incident', incident.id, `Admin God Mode: bypassed archive status restriction (status: ${incident.status})`);
    }
    const now = localNow();
    db.prepare('UPDATE incidents SET archived_at = ? WHERE id = ?').run(now, incident.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_archived', 'incident', ?, ?, ?)`).run(req.user!.userId, incident.id, `Archived ${incident.incident_number}`, req.ip || 'unknown');
    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive incident error:', error);
    res.status(500).json({ error: 'Failed to archive incident', code: 'ARCHIVE_INCIDENT_ERROR' });
  }
});

// POST /api/incidents/:id/unarchive - Restore from archive
router.post('/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) { res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }); return; }
    if (!incident.archived_at) { res.status(400).json({ error: 'Incident is not archived', code: 'INCIDENT_IS_NOT_ARCHIVED' }); return; }
    db.prepare('UPDATE incidents SET archived_at = NULL WHERE id = ?').run(incident.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_unarchived', 'incident', ?, ?, ?)`).run(req.user!.userId, incident.id, `Restored ${incident.incident_number} from archive`, req.ip || 'unknown');
    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive incident error:', error);
    res.status(500).json({ error: 'Failed to unarchive incident', code: 'UNARCHIVE_INCIDENT_ERROR' });
  }
});

// PUT /api/incidents/:id/submit - Submit for review
router.put('/:id/submit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    if (!['draft', 'returned'].includes(incident.status) && req.user?.role !== 'admin') {
      res.status(400).json({ error: 'Can only submit draft or returned incidents', code: 'CAN_ONLY_SUBMIT_DRAFT' });
      return;
    }
    if (req.user?.role === 'admin' && !['draft', 'returned'].includes(incident.status)) {
      auditLog(req, 'ADMIN_OVERRIDE', 'incident', incident.id, `Admin God Mode: bypassed draft/returned-only submit restriction (status: ${incident.status})`);
    }

    const missingFields: string[] = [];
    if (!incident.narrative?.trim()) missingFields.push('narrative');
    if (!incident.location_address?.trim()) missingFields.push('location_address');
    if (!incident.incident_type?.trim()) missingFields.push('incident_type');

    if (missingFields.length > 0) {
      res.status(400).json({
        error: `Missing required fields for submission: ${missingFields.join(', ')}`,
        code: 'MISSING_REQUIRED_FIELDS',
      });
      return;
    }

    db.prepare(`
      UPDATE incidents SET status = 'submitted', updated_at = ? WHERE id = ?
    `).run(localNow(), incident.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_submitted', 'incident', ?, ?, ?)
    `).run(req.user!.userId, incident.id, `Submitted ${incident.incident_number} for review`, req.ip || 'unknown');

    broadcastIncidentUpdate({ id: incident.id, incident_number: incident.incident_number, action: 'submitted' });

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Submit incident error:', error);
    res.status(500).json({ error: 'Failed to submit incident', code: 'SUBMIT_INCIDENT_ERROR' });
  }
});

// PUT /api/incidents/:id/approve - Approve incident (supervisor+)
router.put('/:id/approve', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    if (!['submitted', 'under_review'].includes(incident.status) && req.user?.role !== 'admin') {
      res.status(400).json({ error: 'Can only approve submitted or under-review incidents', code: 'CAN_ONLY_APPROVE_SUBMITTED' });
      return;
    }
    if (req.user?.role === 'admin' && !['submitted', 'under_review'].includes(incident.status)) {
      auditLog(req, 'ADMIN_OVERRIDE', 'incident', incident.id, `Admin approved incident in '${incident.status}' status (bypassed submitted/under_review requirement)`);
    }

    const now = localNow();

    db.prepare(`
      UPDATE incidents SET status = 'approved', supervisor_id = ?, approved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(req.user!.userId, now, localNow(), incident.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_approved', 'incident', ?, ?, ?)
    `).run(req.user!.userId, incident.id, `Approved ${incident.incident_number}`, req.ip || 'unknown');

    broadcastIncidentUpdate({ id: incident.id, incident_number: incident.incident_number, action: 'approved' });

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Approve incident error:', error);
    res.status(500).json({ error: 'Failed to approve incident', code: 'APPROVE_INCIDENT_ERROR' });
  }
});

// PUT /api/incidents/:id/return - Return incident with comments
router.put('/:id/return', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    if (!['submitted', 'under_review'].includes(incident.status)) {
      res.status(400).json({ error: 'Can only return submitted or under-review incidents', code: 'CAN_ONLY_RETURN_SUBMITTED' });
      return;
    }

    const { comments } = req.body;

    db.prepare(`
      UPDATE incidents SET status = 'returned', supervisor_id = ?, updated_at = ?
      WHERE id = ?
    `).run(req.user!.userId, localNow(), incident.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_returned', 'incident', ?, ?, ?)
    `).run(req.user!.userId, incident.id, `Returned ${incident.incident_number}: ${comments || 'No comments'}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Return incident error:', error);
    res.status(500).json({ error: 'Failed to return incident', code: 'RETURN_INCIDENT_ERROR' });
  }
});

// ─── PERSON LINKING ──────────────────────────────────

// POST /api/incidents/:id/persons - Link person to incident
router.post('/:id/persons', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    const { person_id, role, notes } = req.body;
    if (!person_id || !role) {
      res.status(400).json({ error: 'person_id and role are required', code: 'PERSONID_AND_ROLE_ARE' });
      return;
    }

    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(person_id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }

    // Check if already linked
    const existing = db.prepare('SELECT * FROM incident_persons WHERE incident_id = ? AND person_id = ?').get(incident.id, person_id) as any;
    if (existing) {
      res.status(409).json({ error: 'Person already linked to this incident', code: 'PERSON_ALREADY_LINKED_TO' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO incident_persons (incident_id, person_id, role, notes, added_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(incident.id, person_id, role, notes || null, req.user!.userId);

    const linked = db.prepare(`
      SELECT ip.*, p.first_name, p.last_name, p.dob, p.phone, p.flags,
        u.full_name as added_by_name
      FROM incident_persons ip
      LEFT JOIN persons p ON ip.person_id = p.id
      LEFT JOIN users u ON ip.added_by = u.id
      WHERE ip.id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'person_linked', 'incident', ?, ?, ?)
    `).run(
      req.user!.userId, incident.id,
      `Linked ${person.first_name} ${person.last_name} as ${role} to ${incident.incident_number}`,
      req.ip || 'unknown'
    );

    res.status(201).json(linked);
  } catch (error: any) {
    console.error('Link person error:', error);
    res.status(500).json({ error: 'Failed to link person', code: 'LINK_PERSON_ERROR' });
  }
});

// PUT /api/incidents/:id/persons/:personId - Update person link
router.put('/:id/persons/:personId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM incident_persons WHERE incident_id = ? AND person_id = ?')
      .get(req.params.id, req.params.personId) as any;
    if (!link) {
      res.status(404).json({ error: 'Person link not found', code: 'PERSON_LINK_NOT_FOUND' });
      return;
    }

    const bodyKeys = Object.keys(req.body);
    const setClauses: string[] = [];
    const setValues: any[] = [];
    for (const field of ['role', 'notes']) {
      if (bodyKeys.includes(field)) {
        setClauses.push(`${field} = ?`);
        const val = req.body[field];
        setValues.push(val === '' ? null : val ?? null);
      }
    }
    if (setClauses.length > 0) {
      setValues.push(link.id);
      db.prepare(`UPDATE incident_persons SET ${setClauses.join(', ')} WHERE id = ?`).run(...setValues);
    }

    const updated = db.prepare(`
      SELECT ip.*, p.first_name, p.last_name, p.dob, p.phone, p.flags,
        u.full_name as added_by_name
      FROM incident_persons ip
      LEFT JOIN persons p ON ip.person_id = p.id
      LEFT JOIN users u ON ip.added_by = u.id
      WHERE ip.id = ?
    `).get(link.id);

    res.json(updated);
  } catch (error: any) {
    console.error('Update person link error:', error);
    res.status(500).json({ error: 'Failed to update person link', code: 'UPDATE_PERSON_LINK_ERROR' });
  }
});

// DELETE /api/incidents/:id/persons/:personId - Unlink person
router.delete('/:id/persons/:personId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM incident_persons WHERE incident_id = ? AND person_id = ?')
      .get(req.params.id, req.params.personId) as any;
    if (!link) {
      res.status(404).json({ error: 'Person link not found', code: 'PERSON_LINK_NOT_FOUND' });
      return;
    }

    const person = db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(req.params.personId) as any;
    const incident = db.prepare('SELECT incident_number FROM incidents WHERE id = ?').get(req.params.id) as any;

    db.prepare('DELETE FROM incident_persons WHERE id = ?').run(link.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'person_unlinked', 'incident', ?, ?, ?)
    `).run(
      req.user!.userId, req.params.id,
      `Unlinked ${person?.first_name || ''} ${person?.last_name || ''} from ${incident?.incident_number || req.params.id}`,
      req.ip || 'unknown'
    );

    res.json({ message: 'Person unlinked from incident' });
  } catch (error: any) {
    console.error('Unlink person error:', error);
    res.status(500).json({ error: 'Failed to unlink person', code: 'UNLINK_PERSON_ERROR' });
  }
});

// ─── VEHICLE LINKING ─────────────────────────────────

// POST /api/incidents/:id/vehicles - Link vehicle to incident
router.post('/:id/vehicles', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    const { vehicle_id, role, notes } = req.body;
    if (!vehicle_id || !role) {
      res.status(400).json({ error: 'vehicle_id and role are required', code: 'VEHICLEID_AND_ROLE_ARE' });
      return;
    }

    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(vehicle_id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });
      return;
    }

    const existing = db.prepare('SELECT * FROM incident_vehicles WHERE incident_id = ? AND vehicle_id = ?').get(incident.id, vehicle_id) as any;
    if (existing) {
      res.status(409).json({ error: 'Vehicle already linked to this incident', code: 'VEHICLE_ALREADY_LINKED_TO' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO incident_vehicles (incident_id, vehicle_id, role, notes, added_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(incident.id, vehicle_id, role, notes || null, req.user!.userId);

    const linked = db.prepare(`
      SELECT iv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin,
        p.first_name as owner_first_name, p.last_name as owner_last_name,
        u.full_name as added_by_name
      FROM incident_vehicles iv
      LEFT JOIN vehicles_records v ON iv.vehicle_id = v.id
      LEFT JOIN persons p ON v.owner_person_id = p.id
      LEFT JOIN users u ON iv.added_by = u.id
      WHERE iv.id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'vehicle_linked', 'incident', ?, ?, ?)
    `).run(
      req.user!.userId, incident.id,
      `Linked vehicle ${vehicle.plate_number || 'No plate'} ${vehicle.make || ''} ${vehicle.model || ''} as ${role} to ${incident.incident_number}`,
      req.ip || 'unknown'
    );

    res.status(201).json(linked);
  } catch (error: any) {
    console.error('Link vehicle error:', error);
    res.status(500).json({ error: 'Failed to link vehicle', code: 'LINK_VEHICLE_ERROR' });
  }
});

// PUT /api/incidents/:id/vehicles/:vehicleId - Update vehicle link
router.put('/:id/vehicles/:vehicleId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM incident_vehicles WHERE incident_id = ? AND vehicle_id = ?')
      .get(req.params.id, req.params.vehicleId) as any;
    if (!link) {
      res.status(404).json({ error: 'Vehicle link not found', code: 'VEHICLE_LINK_NOT_FOUND' });
      return;
    }

    const bodyKeys = Object.keys(req.body);
    const setClauses: string[] = [];
    const setValues: any[] = [];
    for (const field of ['role', 'notes']) {
      if (bodyKeys.includes(field)) {
        setClauses.push(`${field} = ?`);
        const val = req.body[field];
        setValues.push(val === '' ? null : val ?? null);
      }
    }
    if (setClauses.length > 0) {
      setValues.push(link.id);
      db.prepare(`UPDATE incident_vehicles SET ${setClauses.join(', ')} WHERE id = ?`).run(...setValues);
    }

    const updated = db.prepare(`
      SELECT iv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin,
        p.first_name as owner_first_name, p.last_name as owner_last_name,
        u.full_name as added_by_name
      FROM incident_vehicles iv
      LEFT JOIN vehicles_records v ON iv.vehicle_id = v.id
      LEFT JOIN persons p ON v.owner_person_id = p.id
      LEFT JOIN users u ON iv.added_by = u.id
      WHERE iv.id = ?
    `).get(link.id);

    res.json(updated);
  } catch (error: any) {
    console.error('Update vehicle link error:', error);
    res.status(500).json({ error: 'Failed to update vehicle link', code: 'UPDATE_VEHICLE_LINK_ERROR' });
  }
});

// DELETE /api/incidents/:id/vehicles/:vehicleId - Unlink vehicle
router.delete('/:id/vehicles/:vehicleId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM incident_vehicles WHERE incident_id = ? AND vehicle_id = ?')
      .get(req.params.id, req.params.vehicleId) as any;
    if (!link) {
      res.status(404).json({ error: 'Vehicle link not found', code: 'VEHICLE_LINK_NOT_FOUND' });
      return;
    }

    const vehicle = db.prepare('SELECT plate_number, make, model FROM vehicles_records WHERE id = ?').get(req.params.vehicleId) as any;
    const incident = db.prepare('SELECT incident_number FROM incidents WHERE id = ?').get(req.params.id) as any;

    db.prepare('DELETE FROM incident_vehicles WHERE id = ?').run(link.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'vehicle_unlinked', 'incident', ?, ?, ?)
    `).run(
      req.user!.userId, req.params.id,
      `Unlinked vehicle ${vehicle?.plate_number || ''} from ${incident?.incident_number || req.params.id}`,
      req.ip || 'unknown'
    );

    res.json({ message: 'Vehicle unlinked from incident' });
  } catch (error: any) {
    console.error('Unlink vehicle error:', error);
    res.status(500).json({ error: 'Failed to unlink vehicle', code: 'UNLINK_VEHICLE_ERROR' });
  }
});

// ─── EVIDENCE ────────────────────────────────────────

// POST /api/incidents/:id/evidence - Create evidence for incident
router.post('/:id/evidence', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    const {
      description, evidence_type, storage_location,
      collected_date, packaging_type, dimensions, weight,
      photo_taken, lab_submitted, lab_case_number, lab_name,
      disposal_method, disposal_date, disposal_authorized_by,
      serial_number, brand, model, estimated_value, category
    } = req.body;
    if (!description || !evidence_type) {
      res.status(400).json({ error: 'description and evidence_type are required', code: 'DESCRIPTION_AND_EVIDENCETYPE_ARE' });
      return;
    }

    // Generate evidence number
    const currentYear = new Date().getFullYear();
    const lastEvidence = db.prepare(
      `SELECT evidence_number FROM evidence WHERE evidence_number LIKE ? ORDER BY id DESC LIMIT 1`
    ).get(`EV-${currentYear}-%`) as any;

    let nextNum = 1;
    if (lastEvidence) {
      const parts = lastEvidence.evidence_number.split('-');
      nextNum = parseInt(parts[2], 10) + 1;
    }
    const evidenceNumber = `EV-${currentYear}-${String(nextNum).padStart(5, '0')}`;

    const result = db.prepare(`
      INSERT INTO evidence (
        evidence_number, incident_id, description, evidence_type, storage_location, collected_by,
        collected_date, packaging_type, dimensions, weight,
        photo_taken, lab_submitted, lab_case_number, lab_name,
        disposal_method, disposal_date, disposal_authorized_by,
        serial_number, brand, model, estimated_value, category
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidenceNumber, incident.id, description, evidence_type,
      storage_location || null, req.user!.userId,
      collected_date || null, packaging_type || null, dimensions || null, weight || null,
      photo_taken ? 1 : 0, lab_submitted ? 1 : 0, lab_case_number || null, lab_name || null,
      disposal_method || null, disposal_date || null, disposal_authorized_by || null,
      serial_number || null, brand || null, model || null, estimated_value || null, category || null
    );

    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'evidence_created', 'incident', ?, ?, ?)
    `).run(
      req.user!.userId, incident.id,
      `Added evidence ${evidenceNumber} to ${incident.incident_number}: ${description}`,
      req.ip || 'unknown'
    );

    res.status(201).json(evidence);
  } catch (error: any) {
    console.error('Create evidence error:', error);
    res.status(500).json({ error: 'Failed to create evidence', code: 'CREATE_EVIDENCE_ERROR' });
  }
});

// ─── SUPPLEMENTS ─────────────────────────────────────

// GET /api/incidents/:id/supplements - List supplemental reports for an incident
router.get('/:id/supplements', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT id FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    const supplements = db.prepare(`
      SELECT sr.*,
        u.full_name AS author_name,
        u.badge_number AS author_badge,
        a.full_name AS approved_by_name
      FROM supplemental_reports sr
      LEFT JOIN users u ON sr.author_id = u.id
      LEFT JOIN users a ON sr.approved_by = a.id
      WHERE sr.incident_id = ?
      ORDER BY sr.created_at DESC
    
      LIMIT 1000
    `).all(req.params.id);

    res.json(supplements);
  } catch (error: any) {
    console.error('List supplements error:', error);
    res.status(500).json({ error: 'Failed to list supplements', code: 'LIST_SUPPLEMENTS_ERROR' });
  }
});

// POST /api/incidents/:id/supplements - Create a supplement
router.post('/:id/supplements', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
      return;
    }

    const { report_type, subject, narrative } = req.body;
    if (!report_type || !subject || !narrative) {
      res.status(400).json({ error: 'report_type, subject, and narrative are required', code: 'REPORTTYPE_SUBJECT_AND_NARRATIVE' });
      return;
    }

    // Generate report number: SUP-YYYY-NNNNN
    const currentYear = new Date().getFullYear();
    const lastSup = db.prepare(
      `SELECT report_number FROM supplemental_reports WHERE report_number LIKE ? ORDER BY id DESC LIMIT 1`
    ).get(`SUP-${currentYear}-%`) as any;

    let nextNum = 1;
    if (lastSup) {
      const parts = lastSup.report_number.split('-');
      nextNum = parseInt(parts[2], 10) + 1;
    }
    const reportNumber = `SUP-${currentYear}-${String(nextNum).padStart(5, '0')}`;

    const result = db.prepare(`
      INSERT INTO supplemental_reports (report_number, incident_id, author_id, report_type, subject, narrative, status)
      VALUES (?, ?, ?, ?, ?, ?, 'draft')
    `).run(reportNumber, incident.id, req.user!.userId, report_type, subject, narrative);

    const supplement = db.prepare(`
      SELECT sr.*, u.full_name AS author_name
      FROM supplemental_reports sr
      LEFT JOIN users u ON sr.author_id = u.id
      WHERE sr.id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'supplement_created', 'incident', ?, ?, ?)
    `).run(
      req.user!.userId, incident.id,
      `Created ${report_type} supplement ${reportNumber} for ${incident.incident_number}: ${subject}`,
      req.ip || 'unknown'
    );

    res.status(201).json(supplement);
  } catch (error: any) {
    console.error('Create supplement error:', error);
    res.status(500).json({ error: 'Failed to create supplement', code: 'CREATE_SUPPLEMENT_ERROR' });
  }
});

// PUT /api/incidents/:incidentId/supplements/:supId - Update a supplement
router.put('/:incidentId/supplements/:supId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sup = db.prepare('SELECT * FROM supplemental_reports WHERE id = ? AND incident_id = ?')
      .get(req.params.supId, req.params.incidentId) as any;
    if (!sup) {
      res.status(404).json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' });
      return;
    }

    const { subject, narrative, status } = req.body;
    const fields: string[] = [];
    const values: any[] = [];

    if (subject !== undefined) { fields.push('subject = ?'); values.push(subject); }
    if (narrative !== undefined) { fields.push('narrative = ?'); values.push(narrative); }
    if (status !== undefined) {
      fields.push('status = ?');
      values.push(status);
      if (status === 'approved') {
        fields.push('approved_by = ?');
        values.push(req.user!.userId);
        fields.push('approved_at = ?');
        values.push(localNow());
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }

    fields.push("updated_at = ?");
    values.push(localNow());
    values.push(req.params.supId, req.params.incidentId);

    db.prepare(`UPDATE supplemental_reports SET ${fields.join(', ')} WHERE id = ? AND incident_id = ?`).run(...values);

    const updated = db.prepare(`
      SELECT sr.*, u.full_name AS author_name, a.full_name AS approved_by_name
      FROM supplemental_reports sr
      LEFT JOIN users u ON sr.author_id = u.id
      LEFT JOIN users a ON sr.approved_by = a.id
      WHERE sr.id = ?
    `).get(req.params.supId);

    res.json(updated);
  } catch (error: any) {
    console.error('Update supplement error:', error);
    res.status(500).json({ error: 'Failed to update supplement', code: 'UPDATE_SUPPLEMENT_ERROR' });
  }
});

// DELETE /api/incidents/:incidentId/supplements/:supId - Delete a draft supplement
router.delete('/:incidentId/supplements/:supId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sup = db.prepare('SELECT * FROM supplemental_reports WHERE id = ? AND incident_id = ?')
      .get(req.params.supId, req.params.incidentId) as any;
    if (!sup) {
      res.status(404).json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' });
      return;
    }
    if (sup.status !== 'draft') {
      res.status(400).json({ error: 'Only draft supplements can be deleted', code: 'ONLY_DRAFT_SUPPLEMENTS_CAN' });
      return;
    }

    db.prepare('DELETE FROM supplemental_reports WHERE id = ?').run(req.params.supId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete supplement error:', error);
    res.status(500).json({ error: 'Failed to delete supplement', code: 'DELETE_SUPPLEMENT_ERROR' });
  }
});

// ══════════════════════════════════════════════════════════════════
// INCIDENT UPGRADES
// ══════════════════════════════════════════════════════════════════

// ── Upgrade 17: Incident severity scoring ───────────────────────
router.get('/:id/severity', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) { res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }); return; }

    // Compute severity score 0-100 based on multiple factors
    let score = 0;
    const factors: { factor: string; points: number; reason: string }[] = [];

    // Priority factor (0-30)
    const priorityScores: Record<string, number> = { P1: 30, P2: 20, P3: 10, P4: 5 };
    const priorityPoints = priorityScores[incident.priority] || 5;
    score += priorityPoints;
    factors.push({ factor: 'priority', points: priorityPoints, reason: `Priority ${incident.priority}` });

    // Weapons involved (0-20)
    if (incident.weapons_involved) {
      score += 20;
      factors.push({ factor: 'weapons', points: 20, reason: 'Weapons involved' });
    }

    // Injuries (0-15)
    if (incident.injuries === 'fatal') { score += 15; factors.push({ factor: 'injuries', points: 15, reason: 'Fatal injuries' }); }
    else if (incident.injuries === 'serious') { score += 10; factors.push({ factor: 'injuries', points: 10, reason: 'Serious injuries' }); }
    else if (incident.injuries === 'minor') { score += 5; factors.push({ factor: 'injuries', points: 5, reason: 'Minor injuries' }); }

    // Domestic violence (0-10)
    if (incident.domestic_violence) {
      score += 10;
      factors.push({ factor: 'domestic_violence', points: 10, reason: 'Domestic violence' });
    }

    // Drugs/alcohol (0-5 each)
    if (incident.alcohol_involved) { score += 5; factors.push({ factor: 'alcohol', points: 5, reason: 'Alcohol involved' }); }
    if (incident.drugs_involved) { score += 5; factors.push({ factor: 'drugs', points: 5, reason: 'Drugs involved' }); }

    // Damage estimate (0-10)
    const dmg = parseFloat(incident.damage_estimate) || 0;
    if (dmg > 10000) { score += 10; factors.push({ factor: 'damage', points: 10, reason: `Damage $${dmg.toLocaleString()}` }); }
    else if (dmg > 1000) { score += 5; factors.push({ factor: 'damage', points: 5, reason: `Damage $${dmg.toLocaleString()}` }); }

    // Multiple persons (0-5)
    const personCount = (db.prepare('SELECT COUNT(*) as count FROM incident_persons WHERE incident_id = ?').get(incident.id) as any)?.count || 0;
    if (personCount > 2) { score += 5; factors.push({ factor: 'persons', points: 5, reason: `${personCount} persons involved` }); }

    const level = score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low';

    res.json({ incident_id: incident.id, severity_score: Math.min(score, 100), severity_level: level, factors });
  } catch (error: any) {
    console.error('Severity scoring error:', error);
    res.status(500).json({ error: 'Failed to compute severity', code: 'SEVERITY_ERROR' });
  }
});

// ── Upgrade 18: Auto-link incident to dispatch calls ────────────
router.post('/:id/auto-link', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) { res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }); return; }

    if (incident.call_id) {
      res.json({ message: 'Already linked to call', call_id: incident.call_id, auto_linked: false });
      return;
    }

    // Try to find matching call by address and time (within 2 hours)
    const conditions: string[] = [];
    const params: any[] = [];

    if (incident.location_address) {
      conditions.push('UPPER(c.location_address) = UPPER(?)');
      params.push(incident.location_address);
    }

    if (conditions.length === 0 && incident.latitude && incident.longitude) {
      // Try GPS proximity (within ~0.3 miles / 500m)
      conditions.push('ABS(c.latitude - ?) < 0.005 AND ABS(c.longitude - ?) < 0.005');
      params.push(incident.latitude, incident.longitude);
    }

    if (conditions.length === 0) {
      res.json({ message: 'No address or GPS to match', auto_linked: false });
      return;
    }

    // Time window: 2 hours before and 30 minutes after incident creation
    const timeCondition = `c.created_at BETWEEN datetime(?, '-2 hours') AND datetime(?, '+30 minutes')`;
    conditions.push(timeCondition);
    params.push(incident.created_at, incident.created_at);

    const match = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.location_address, c.created_at
      FROM calls_for_service c
      WHERE ${conditions.join(' AND ')}
      ORDER BY ABS(julianday(c.created_at) - julianday(?)) ASC
      LIMIT 1
    `).get(...params, incident.created_at) as any;

    if (match) {
      db.prepare('UPDATE incidents SET call_id = ?, updated_at = ? WHERE id = ?')
        .run(match.id, localNow(), incident.id);

      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'incident_auto_linked', 'incident', ?, ?, ?)`).run(
        req.user!.userId, incident.id,
        `Auto-linked ${incident.incident_number} to call ${match.call_number}`,
        req.ip || 'unknown');

      res.json({ auto_linked: true, call_id: match.id, call_number: match.call_number });
    } else {
      res.json({ auto_linked: false, message: 'No matching call found' });
    }
  } catch (error: any) {
    console.error('Auto-link error:', error);
    res.status(500).json({ error: 'Failed to auto-link incident', code: 'AUTO_LINK_ERROR' });
  }
});

// ── Upgrade 19: Incident type statistics (enhanced) ─────────────
router.get('/type-stats/detailed', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '30' } = req.query;
    const daysNum = Math.max(1, Math.min(365, parseInt(days as string, 10) || 30));

    // Type breakdown with trend
    const byType = db.prepare(`
      SELECT incident_type, COUNT(*) as count,
        SUM(CASE WHEN weapons_involved = 1 THEN 1 ELSE 0 END) as weapons_count,
        SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_count,
        SUM(CASE WHEN injuries != 'none' AND injuries IS NOT NULL THEN 1 ELSE 0 END) as injury_count,
        AVG(CASE WHEN damage_estimate IS NOT NULL THEN CAST(damage_estimate AS REAL) ELSE NULL END) as avg_damage
      FROM incidents
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY incident_type
      ORDER BY count DESC
    `).all(daysNum);

    // This period vs previous period comparison
    const currentPeriod = db.prepare(`
      SELECT COUNT(*) as count FROM incidents
      WHERE created_at >= datetime('now', '-' || ? || ' days')
    `).get(daysNum) as any;

    const previousPeriod = db.prepare(`
      SELECT COUNT(*) as count FROM incidents
      WHERE created_at >= datetime('now', '-' || ? || ' days')
        AND created_at < datetime('now', '-' || ? || ' days')
    `).get(daysNum * 2, daysNum) as any;

    const currentCount = currentPeriod?.count || 0;
    const previousCount = previousPeriod?.count || 0;
    const changePercent = previousCount > 0
      ? Math.round(((currentCount - previousCount) / previousCount) * 100)
      : null;

    // By day of week
    const byDayOfWeek = db.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) as day_of_week, COUNT(*) as count
      FROM incidents
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY day_of_week ORDER BY day_of_week
    `).all(daysNum);

    // By hour of day
    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM incidents
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY hour ORDER BY hour
    `).all(daysNum);

    // By officer
    const byOfficer = db.prepare(`
      SELECT u.full_name, u.badge_number, COUNT(*) as count
      FROM incidents i
      JOIN users u ON i.officer_id = u.id
      WHERE i.created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY i.officer_id
      ORDER BY count DESC LIMIT 10
    `).all(daysNum);

    // Disposition breakdown
    const byDisposition = db.prepare(`
      SELECT disposition, COUNT(*) as count
      FROM incidents
      WHERE created_at >= datetime('now', '-' || ? || ' days')
        AND disposition IS NOT NULL AND disposition != ''
      GROUP BY disposition ORDER BY count DESC
    `).all(daysNum);

    res.json({
      period_days: daysNum,
      byType,
      comparison: { current: currentCount, previous: previousCount, changePercent },
      byDayOfWeek,
      byHour,
      byOfficer,
      byDisposition,
    });
  } catch (error: any) {
    console.error('Type stats error:', error);
    res.status(500).json({ error: 'Failed to get type statistics', code: 'TYPE_STATS_ERROR' });
  }
});

// ── Upgrade 20: Batch severity scoring for all recent incidents ─
router.get('/severity-batch', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '7', min_score = '0' } = req.query;
    const daysNum = Math.max(1, Math.min(90, parseInt(days as string, 10) || 7));
    const minScore = parseInt(min_score as string, 10) || 0;

    const incidents = db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.priority, i.status,
        i.weapons_involved, i.injuries, i.domestic_violence,
        i.alcohol_involved, i.drugs_involved, i.damage_estimate,
        i.location_address, i.created_at, u.full_name as officer_name
      FROM incidents i
      LEFT JOIN users u ON i.officer_id = u.id
      WHERE i.created_at >= datetime('now', '-' || ? || ' days')
      ORDER BY i.created_at DESC
    `).all(daysNum) as any[];

    const scored = incidents.map(inc => {
      let score = 0;
      const priorityScores: Record<string, number> = { P1: 30, P2: 20, P3: 10, P4: 5 };
      score += priorityScores[inc.priority] || 5;
      if (inc.weapons_involved) score += 20;
      if (inc.injuries === 'fatal') score += 15;
      else if (inc.injuries === 'serious') score += 10;
      else if (inc.injuries === 'minor') score += 5;
      if (inc.domestic_violence) score += 10;
      if (inc.alcohol_involved) score += 5;
      if (inc.drugs_involved) score += 5;
      const dmg = parseFloat(inc.damage_estimate) || 0;
      if (dmg > 10000) score += 10;
      else if (dmg > 1000) score += 5;

      const level = score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low';
      return { ...inc, severity_score: Math.min(score, 100), severity_level: level };
    }).filter(inc => inc.severity_score >= minScore);

    scored.sort((a, b) => b.severity_score - a.severity_score);

    res.json({ data: scored, count: scored.length });
  } catch (error: any) {
    console.error('Severity batch error:', error);
    res.status(500).json({ error: 'Failed to batch severity', code: 'SEVERITY_BATCH_ERROR' });
  }
});

// ── Upgrade 21: Find potential call matches for unlinked incidents
router.get('/:id/potential-calls', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) { res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }); return; }

    const conditions: string[] = [];
    const params: any[] = [];

    // Time window: 4 hours before, 1 hour after
    conditions.push(`c.created_at BETWEEN datetime(?, '-4 hours') AND datetime(?, '+1 hour')`);
    params.push(incident.created_at, incident.created_at);

    // Match by address similarity or GPS proximity
    const matchConditions: string[] = [];
    if (incident.location_address) {
      matchConditions.push('UPPER(c.location_address) LIKE UPPER(?)');
      params.push(`%${incident.location_address.split(',')[0]}%`);
    }
    if (incident.latitude && incident.longitude) {
      matchConditions.push('(ABS(c.latitude - ?) < 0.01 AND ABS(c.longitude - ?) < 0.01)');
      params.push(incident.latitude, incident.longitude);
    }
    if (incident.incident_type) {
      matchConditions.push('c.incident_type = ?');
      params.push(incident.incident_type);
    }

    if (matchConditions.length > 0) {
      conditions.push(`(${matchConditions.join(' OR ')})`);
    }

    const calls = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status,
        c.location_address, c.created_at, c.description
      FROM calls_for_service c
      WHERE ${conditions.join(' AND ')}
      ORDER BY ABS(julianday(c.created_at) - julianday(?)) ASC
      LIMIT 10
    `).all(...params, incident.created_at);

    res.json({ incident_id: incident.id, potential_calls: calls, count: calls.length });
  } catch (error: any) {
    console.error('Potential calls error:', error);
    res.status(500).json({ error: 'Failed to find potential calls', code: 'POTENTIAL_CALLS_ERROR' });
  }
});

// PUT /incidents/:id/link-call — Link incident to a CFS
router.put('/:id/link-call', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_id } = req.body;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid incident ID' }); return; }

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
    if (!incident) { res.status(404).json({ error: 'Incident not found' }); return; }

    if (call_id) {
      const call = db.prepare('SELECT id, case_id, case_number FROM calls_for_service WHERE id = ?').get(call_id) as any;
      if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

      db.prepare('UPDATE incidents SET call_id = ?, updated_at = ? WHERE id = ?').run(call_id, localNow(), id);

      // If the call has a case, auto-link this incident to that case
      if (call.case_id) {
        try {
          db.prepare('INSERT OR IGNORE INTO case_incidents (case_id, incident_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(call.case_id, id, (req as any).user!.userId, localNow());
        } catch { /* table may not exist yet */ }
      }
    } else {
      // Unlink
      db.prepare('UPDATE incidents SET call_id = NULL, updated_at = ? WHERE id = ?').run(localNow(), id);
    }

    auditLog(req, 'UPDATE', 'incident', id, `${call_id ? 'Linked' : 'Unlinked'} incident to call #${call_id || 'none'}`);

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
    res.json(updated);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── POST /incidents/swap-numbers — Swap incident numbers between two incidents (admin)
router.post('/swap-numbers', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { incident_id_a, incident_id_b } = req.body;
    if (!incident_id_a || !incident_id_b) { res.status(400).json({ error: 'incident_id_a and incident_id_b required' }); return; }

    const a = db.prepare('SELECT id, incident_number FROM incidents WHERE id = ?').get(incident_id_a) as any;
    const b = db.prepare('SELECT id, incident_number FROM incidents WHERE id = ?').get(incident_id_b) as any;
    if (!a || !b) { res.status(404).json({ error: 'One or both incidents not found' }); return; }

    const now = localNow();
    const tempNum = `SWAP_TEMP_${Date.now()}`;
    db.transaction(() => {
      db.prepare('UPDATE incidents SET incident_number = ?, updated_at = ? WHERE id = ?').run(tempNum, now, a.id);
      db.prepare('UPDATE incidents SET incident_number = ?, updated_at = ? WHERE id = ?').run(a.incident_number, now, b.id);
      db.prepare('UPDATE incidents SET incident_number = ?, updated_at = ? WHERE id = ?').run(b.incident_number, now, a.id);
    })();

    auditLog(req, 'ADMIN_OVERRIDE', 'incident', a.id, `Swapped incident numbers: ${a.incident_number} ↔ ${b.incident_number}`);
    res.json({ success: true, swapped: [{ id: a.id, new_number: b.incident_number }, { id: b.id, new_number: a.incident_number }] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// INCIDENT OFFENSES — Spillman Flex offense tracking
// ════════════════════════════════════════════════════════════

router.get('/:id(\\d+)/offenses', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const offenses = db.prepare(`
      SELECT io.*,
        s.statute_number, s.title as statute_title, s.category as statute_category,
        sp.first_name as suspect_first, sp.last_name as suspect_last,
        vp.first_name as victim_first, vp.last_name as victim_last
      FROM incident_offenses io
      LEFT JOIN utah_statutes s ON s.id = io.statute_id
      LEFT JOIN persons sp ON sp.id = io.suspect_person_id
      LEFT JOIN persons vp ON vp.id = io.victim_person_id
      WHERE io.incident_id = ?
      ORDER BY io.created_at
    `).all(req.params.id);
    res.json(offenses);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load offenses' });
  }
});

router.post('/:id(\\d+)/offenses', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { offense_code, statute_id, description, offense_date, offense_level, ucr_code, nibrs_code,
      attempted_completed, suspect_person_id, victim_person_id, location_type, weapon_force,
      criminal_activity, bias_motivation, counts, notes } = req.body;
    if (!offense_code || !description) { res.status(400).json({ error: 'offense_code and description required' }); return; }
    const result = db.prepare(`
      INSERT INTO incident_offenses (incident_id, offense_code, statute_id, description, offense_date, offense_level, ucr_code, nibrs_code,
        attempted_completed, suspect_person_id, victim_person_id, location_type, weapon_force, criminal_activity, bias_motivation, counts, notes, added_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, offense_code, statute_id || null, description, offense_date, offense_level || 'misdemeanor',
      ucr_code, nibrs_code, attempted_completed || 'completed', suspect_person_id || null, victim_person_id || null,
      location_type, weapon_force, criminal_activity, bias_motivation, counts || 1, notes, userId);
    auditLog(req, 'CREATE', 'incident_offenses', result.lastInsertRowid as number, null, req.body);
    const offense = db.prepare('SELECT * FROM incident_offenses WHERE id = ?').get(result.lastInsertRowid);
    res.json(offense);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.status(500).json({ error: 'Offense tracking not yet initialized. Restart server.' }); return; }
    res.status(500).json({ error: 'Failed to add offense' });
  }
});

router.put('/:id(\\d+)/offenses/:offenseId(\\d+)', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fields = ['offense_code', 'statute_id', 'description', 'offense_date', 'offense_level', 'ucr_code', 'nibrs_code',
      'attempted_completed', 'suspect_person_id', 'victim_person_id', 'location_type', 'weapon_force',
      'criminal_activity', 'bias_motivation', 'disposition', 'disposition_date', 'counts', 'notes'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    values.push(req.params.offenseId, req.params.id);
    db.prepare(`UPDATE incident_offenses SET ${updates.join(', ')} WHERE id = ? AND incident_id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM incident_offenses WHERE id = ?').get(req.params.offenseId);
    res.json(updated);
  } catch { res.status(500).json({ error: 'Failed to update offense' }); }
});

router.delete('/:id(\\d+)/offenses/:offenseId(\\d+)', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM incident_offenses WHERE id = ? AND incident_id = ?').run(req.params.offenseId, req.params.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete offense' }); }
});

// ════════════════════════════════════════════════════════════
// INCIDENT OFFICERS — Multi-officer tracking with roles
// ════════════════════════════════════════════════════════════

router.get('/:id(\\d+)/officers', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officers = db.prepare(`
      SELECT io.*, u.first_name, u.last_name, u.badge_number, u.rank
      FROM incident_officers io
      JOIN users u ON u.id = io.officer_id
      WHERE io.incident_id = ?
      ORDER BY CASE io.role WHEN 'primary' THEN 0 WHEN 'supervisor' THEN 1 WHEN 'responding' THEN 2 WHEN 'backup' THEN 3 ELSE 4 END
    `).all(req.params.id);
    res.json(officers);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load officers' });
  }
});

router.post('/:id(\\d+)/officers', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { officer_id, role, arrived_at, departed_at, action_taken, notes } = req.body;
    if (!officer_id) { res.status(400).json({ error: 'officer_id required' }); return; }
    const result = db.prepare(`
      INSERT INTO incident_officers (incident_id, officer_id, role, arrived_at, departed_at, action_taken, notes, added_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, officer_id, role || 'responding', arrived_at, departed_at, action_taken, notes, userId);
    const officer = db.prepare(`
      SELECT io.*, u.first_name, u.last_name, u.badge_number, u.rank
      FROM incident_officers io JOIN users u ON u.id = io.officer_id
      WHERE io.id = ?
    `).get(result.lastInsertRowid);
    auditLog(req, 'CREATE', 'incident_officers', result.lastInsertRowid as number, null, req.body);
    res.json(officer);
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) { res.status(409).json({ error: 'Officer already added to this incident' }); return; }
    if (err?.message?.includes('no such table')) { res.status(500).json({ error: 'Officer tracking not yet initialized' }); return; }
    res.status(500).json({ error: 'Failed to add officer' });
  }
});

router.delete('/:id(\\d+)/officers/:linkId(\\d+)', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM incident_officers WHERE id = ? AND incident_id = ?').run(req.params.linkId, req.params.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to remove officer' }); }
});

// ════════════════════════════════════════════════════════════
// INCIDENT LINKS — Cross-reference to other records
// ════════════════════════════════════════════════════════════

router.get('/:id(\\d+)/links', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const links = db.prepare(`SELECT * FROM incident_links WHERE incident_id = ? ORDER BY created_at`).all(req.params.id);

    // Enrich each link with basic info from linked record
    const enriched = (links as any[]).map((link: any) => {
      let detail: any = null;
      try {
        if (link.linked_type === 'incident') {
          detail = db.prepare('SELECT incident_number, incident_type, status FROM incidents WHERE id = ?').get(link.linked_id);
        } else if (link.linked_type === 'call') {
          detail = db.prepare('SELECT call_number, incident_type, status FROM calls_for_service WHERE id = ?').get(link.linked_id);
        } else if (link.linked_type === 'case') {
          detail = db.prepare('SELECT case_number, case_type, status FROM cases WHERE id = ?').get(link.linked_id);
        } else if (link.linked_type === 'warrant') {
          detail = db.prepare('SELECT warrant_number, type, status FROM warrants WHERE id = ?').get(link.linked_id);
        } else if (link.linked_type === 'citation') {
          detail = db.prepare('SELECT citation_number, violation_description, status FROM citations WHERE id = ?').get(link.linked_id);
        }
      } catch { /* table may not exist */ }
      return { ...link, detail };
    });

    res.json(enriched);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load links' });
  }
});

router.post('/:id(\\d+)/links', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { linked_type, linked_id, link_reason } = req.body;
    if (!linked_type || !linked_id) { res.status(400).json({ error: 'linked_type and linked_id required' }); return; }
    const result = db.prepare(`
      INSERT INTO incident_links (incident_id, linked_type, linked_id, link_reason, added_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.id, linked_type, linked_id, link_reason, userId);
    auditLog(req, 'CREATE', 'incident_links', result.lastInsertRowid as number, null, req.body);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) { res.status(409).json({ error: 'Link already exists' }); return; }
    res.status(500).json({ error: 'Failed to create link' });
  }
});

router.delete('/:id(\\d+)/links/:linkId(\\d+)', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM incident_links WHERE id = ? AND incident_id = ?').run(req.params.linkId, req.params.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete link' }); }
});

// ════════════════════════════════════════════════════════════
// INCIDENT FULL — Aggregated view (Spillman-style)
// ════════════════════════════════════════════════════════════

router.get('/:id(\\d+)/full', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare(`
      SELECT i.*, u.first_name as officer_first, u.last_name as officer_last, u.badge_number as officer_badge
      FROM incidents i LEFT JOIN users u ON u.id = i.officer_id
      WHERE i.id = ?
    `).get(req.params.id) as any;
    if (!incident) { res.status(404).json({ error: 'Incident not found' }); return; }

    // Load all related data
    let persons: any[] = [];
    let vehicles: any[] = [];
    let offenses: any[] = [];
    let officers: any[] = [];
    let links: any[] = [];
    let evidence: any[] = [];
    let supplements: any[] = [];

    try {
      persons = db.prepare(`
        SELECT ip.*, p.first_name, p.last_name, p.date_of_birth, p.gender, p.race, p.phone, p.address,
          p.drivers_license_number, p.flags
        FROM incident_persons ip JOIN persons p ON p.id = ip.person_id
        WHERE ip.incident_id = ? ORDER BY CASE ip.role WHEN 'suspect' THEN 0 WHEN 'victim' THEN 1 WHEN 'witness' THEN 2 ELSE 3 END
      `).all(req.params.id);
    } catch { /* table may not exist */ }

    try {
      vehicles = db.prepare(`
        SELECT iv.*, v.plate_number, v.plate_state, v.vin, v.make, v.model, v.year, v.color, v.owner_name
        FROM incident_vehicles iv JOIN vehicles_records v ON v.id = iv.vehicle_id
        WHERE iv.incident_id = ? ORDER BY iv.role
      `).all(req.params.id);
    } catch { /* table may not exist */ }

    try {
      offenses = db.prepare(`
        SELECT io.*, s.statute_number, s.title as statute_title,
          sp.first_name as suspect_first, sp.last_name as suspect_last,
          vp.first_name as victim_first, vp.last_name as victim_last
        FROM incident_offenses io
        LEFT JOIN utah_statutes s ON s.id = io.statute_id
        LEFT JOIN persons sp ON sp.id = io.suspect_person_id
        LEFT JOIN persons vp ON vp.id = io.victim_person_id
        WHERE io.incident_id = ? ORDER BY io.created_at
      `).all(req.params.id);
    } catch { /* table may not exist */ }

    try {
      officers = db.prepare(`
        SELECT io.*, u.first_name, u.last_name, u.badge_number, u.rank
        FROM incident_officers io JOIN users u ON u.id = io.officer_id
        WHERE io.incident_id = ?
        ORDER BY CASE io.role WHEN 'primary' THEN 0 WHEN 'supervisor' THEN 1 ELSE 2 END
      `).all(req.params.id);
    } catch { /* table may not exist */ }

    try {
      links = db.prepare(`SELECT * FROM incident_links WHERE incident_id = ? ORDER BY created_at`).all(req.params.id);
    } catch { /* table may not exist */ }

    try {
      evidence = db.prepare(`
        SELECT * FROM evidence WHERE incident_id = ? ORDER BY created_at
      `).all(req.params.id);
    } catch { /* table may not exist */ }

    try {
      supplements = db.prepare(`
        SELECT s.*, u.first_name as author_first, u.last_name as author_last
        FROM incident_supplements s LEFT JOIN users u ON u.id = s.created_by
        WHERE s.incident_id = ? ORDER BY s.created_at
      `).all(req.params.id);
    } catch { /* table may not exist */ }

    res.json({
      ...incident,
      persons,
      vehicles,
      offenses,
      officers,
      links,
      evidence,
      supplements,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load full incident' });
  }
});

// ════════════════════════════════════════════════════════════
// MASTER NAME INDEX (MNI) — Cross-record person search
// ════════════════════════════════════════════════════════════

router.get('/mni/search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const q = (req.query.q as string || '').trim();
    if (q.length < 2) { res.status(400).json({ error: 'Search query must be at least 2 characters' }); return; }
    const limit = Math.min(50, parseInt(req.query.limit as string, 10) || 25);
    const like = `%${q}%`;

    // Search persons table
    const persons = db.prepare(`
      SELECT p.id, p.first_name, p.last_name, p.date_of_birth, p.gender, p.race,
        p.drivers_license_number, p.phone, p.address, p.flags,
        (SELECT COUNT(*) FROM incident_persons WHERE person_id = p.id) as incident_count,
        (SELECT COUNT(*) FROM call_persons WHERE person_id = p.id) as call_count,
        (SELECT GROUP_CONCAT(DISTINCT ip.role) FROM incident_persons ip WHERE ip.person_id = p.id) as known_roles
      FROM persons p
      WHERE p.first_name || ' ' || p.last_name LIKE ?
        OR p.last_name LIKE ?
        OR p.drivers_license_number LIKE ?
        OR p.phone LIKE ?
        OR p.ssn LIKE ?
      ORDER BY p.last_name, p.first_name
      LIMIT ?
    `).all(like, like, like, like, like, limit);

    res.json({ results: persons, total: persons.length });
  } catch (err: any) {
    res.status(500).json({ error: 'MNI search failed' });
  }
});

// MNI person detail — all records linked to a person
router.get('/mni/person/:personId(\\d+)', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const personId = req.params.personId;

    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(personId);
    if (!person) { res.status(404).json({ error: 'Person not found' }); return; }

    let incidents: any[] = [];
    let calls: any[] = [];
    let warrants: any[] = [];
    let citations: any[] = [];
    let arrests: any[] = [];
    let trespass: any[] = [];

    try {
      incidents = db.prepare(`
        SELECT i.id, i.incident_number, i.incident_type, i.status, i.priority, i.location_address, i.created_at, ip.role
        FROM incident_persons ip JOIN incidents i ON i.id = ip.incident_id
        WHERE ip.person_id = ? ORDER BY i.created_at DESC LIMIT 50
      `).all(personId);
    } catch { /* ignore */ }

    try {
      calls = db.prepare(`
        SELECT c.id, c.call_number, c.incident_type, c.status, c.priority, c.location_address, c.created_at, cp.role
        FROM call_persons cp JOIN calls_for_service c ON c.id = cp.call_id
        WHERE cp.person_id = ? ORDER BY c.created_at DESC LIMIT 50
      `).all(personId);
    } catch { /* ignore */ }

    try {
      warrants = db.prepare(`
        SELECT * FROM warrants WHERE subject_person_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(personId);
    } catch { /* ignore */ }

    try {
      citations = db.prepare(`
        SELECT * FROM citations WHERE person_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(personId);
    } catch { /* ignore */ }

    try {
      arrests = db.prepare(`
        SELECT * FROM arrest_records WHERE person_id = ? ORDER BY arrest_date DESC LIMIT 20
      `).all(personId);
    } catch { /* ignore */ }

    try {
      trespass = db.prepare(`
        SELECT * FROM trespass_orders WHERE subject_person_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(personId);
    } catch { /* ignore */ }

    res.json({
      person,
      incidents,
      calls,
      warrants,
      citations,
      arrests,
      trespass,
      total_records: incidents.length + calls.length + warrants.length + citations.length + arrests.length + trespass.length,
    });
  } catch { res.status(500).json({ error: 'Failed to load person records' }); }
});

export default router;
