import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { generateIncidentNumber } from '../utils/caseNumbers';
import { sendCsv } from '../utils/csvExport';
import { localNow, localToday } from '../utils/timeUtils';
import { identifyBeat } from '../utils/geofence';
import { createNotificationForRoles } from './notifications';
import { auditLog } from '../utils/auditLogger';
import { validateParamId, validateNumericParams, escapeLike, validateCoordinates, validateDateField } from '../middleware/sanitize';
import { exportRateLimit } from '../middleware/rateLimiter';
import { universalWarrantCheck } from '../utils/universalWarrantScanner';

const router = Router();

router.use(authenticateToken);

// GET /api/incidents - List incidents with filters
router.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, priority, officerId, startDate, endDate, archived, search, page = '1', limit = '50' } = req.query;

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

    if (search) {
      whereClause += " AND (i.incident_number LIKE ? ESCAPE '\\' OR i.incident_type LIKE ? ESCAPE '\\' OR i.location_address LIKE ? ESCAPE '\\' OR i.summary LIKE ? ESCAPE '\\')";
      const s = `%${escapeLike(String(search))}%`;
      params.push(s, s, s, s);
    }

    // If user is an officer, only show their own incidents unless supervisor+
    if (req.user!.role === 'officer') {
      whereClause += ' AND i.officer_id = ?';
      params.push(req.user!.userId);
    }

    const pageNum = Math.min(10000, Math.max(1, parseInt(page as string, 10) || 1));
    const limitNum = Math.max(1, Math.min(500, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM incidents i ${whereClause}`).get(...params) as any;

    const incidents = db.prepare(`
      SELECT i.*, o.full_name as officer_name, o.badge_number,
        s.full_name as supervisor_name, p.name as property_name,
        c.call_number, cl.name as client_name,
        COALESCE(dd.dispatch_code, CASE WHEN i.section_id IS NOT NULL AND i.zone_id IS NOT NULL AND i.beat_id IS NOT NULL THEN i.section_id || '-' || i.zone_id || '/' || i.beat_id ELSE NULL END) as dispatch_code
      FROM incidents i
      LEFT JOIN users o ON i.officer_id = o.id
      LEFT JOIN users s ON i.supervisor_id = s.id
      LEFT JOIN properties p ON i.property_id = p.id
      LEFT JOIN calls_for_service c ON i.call_id = c.id
      LEFT JOIN clients cl ON COALESCE(i.client_id, p.client_id) = cl.id
      LEFT JOIN dispatch_districts dd ON dd.section_id = i.section_id AND dd.zone_id = i.zone_id AND dd.beat_id = i.beat_id
      ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    const total = countRow?.total ?? 0;
    res.json({
      data: incidents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: limitNum > 0 ? Math.ceil(total / limitNum) : 0,
      },
    });
  } catch (error: any) {
    console.error('Get incidents error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/incidents/stats - Incident statistics
router.get('/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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

    res.json({
      byStatus,
      byType,
      pendingReview: pendingReview?.count ?? 0,
      thisMonth: thisMonth?.count ?? 0,
      lastMonth: lastMonth?.count ?? 0,
    });
  } catch (error: any) {
    console.error('Get incident stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/incidents/export - Export incidents as CSV
router.get('/export', requireRole('admin', 'manager', 'supervisor'), exportRateLimit, (req: Request, res: Response) => {
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
      LIMIT 50000
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
    console.error('Export incidents error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/incidents/:id - Get single incident
router.get('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare(`
      SELECT i.*, o.full_name as officer_name, o.badge_number,
        s.full_name as supervisor_name, p.name as property_name,
        c.call_number, c.incident_type as call_type,
        c.caller_name, c.caller_phone,
        c.scene_safety, c.direction_of_travel,
        -- PSO/Process: prefer incident's own columns, fall back to call
        COALESCE(i.pso_service_type, c.pso_service_type) as pso_service_type,
        COALESCE(i.pso_attempt_number, c.pso_attempt_number) as pso_attempt_number,
        COALESCE(i.process_service_type, c.process_service_type) as process_service_type,
        COALESCE(i.process_served_to, c.process_served_to) as process_served_to,
        COALESCE(i.process_served_address, c.process_served_address) as process_served_address,
        COALESCE(i.process_attempts, c.process_attempts) as process_attempts,
        COALESCE(i.process_service_result, c.process_service_result) as process_service_result,
        COALESCE(i.process_served_at, c.process_served_at) as process_served_at,
        -- Operational flags: prefer incident's own, fall back to call
        COALESCE(i.injuries_reported, c.injuries_reported) as injuries_reported,
        COALESCE(i.mental_health_crisis, c.mental_health_crisis) as mental_health_crisis,
        COALESCE(i.juvenile_involved, c.juvenile_involved) as juvenile_involved,
        COALESCE(i.felony_in_progress, c.felony_in_progress) as felony_in_progress,
        COALESCE(i.officer_safety_caution, c.officer_safety_caution) as officer_safety_caution,
        COALESCE(i.gang_related, c.gang_related) as gang_related,
        COALESCE(i.hazmat, c.hazmat) as hazmat,
        COALESCE(i.body_camera_active, c.body_camera_active) as body_camera_active,
        COALESCE(i.evidence_collected, c.evidence_collected) as evidence_collected,
        COALESCE(i.photos_taken, c.photos_taken) as photos_taken,
        COALESCE(i.supervisor_notified, c.supervisor_notified) as supervisor_notified,
        COALESCE(i.le_notified, c.le_notified) as le_notified,
        COALESCE(i.trespass_issued, c.trespass_issued) as trespass_issued,
        COALESCE(i.vehicle_pursuit, c.vehicle_pursuit) as vehicle_pursuit,
        COALESCE(i.foot_pursuit, c.foot_pursuit) as foot_pursuit,
        COALESCE(i.k9_requested, c.k9_requested) as k9_requested,
        COALESCE(i.ems_requested, c.ems_requested) as ems_requested,
        COALESCE(i.fire_requested, c.fire_requested) as fire_requested,
        cl.name as client_name,
        COALESCE(dd.dispatch_code, CASE WHEN i.section_id IS NOT NULL AND i.zone_id IS NOT NULL AND i.beat_id IS NOT NULL THEN i.section_id || '-' || i.zone_id || '/' || i.beat_id ELSE NULL END) as dispatch_code
      FROM incidents i
      LEFT JOIN users o ON i.officer_id = o.id
      LEFT JOIN users s ON i.supervisor_id = s.id
      LEFT JOIN properties p ON i.property_id = p.id
      LEFT JOIN calls_for_service c ON i.call_id = c.id
      LEFT JOIN clients cl ON COALESCE(i.client_id, p.client_id) = cl.id
      LEFT JOIN dispatch_districts dd ON dd.section_id = i.section_id AND dd.zone_id = i.zone_id AND dd.beat_id = i.beat_id
      WHERE i.id = ?
    `).get(req.params.id) as any;

    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    // Get evidence
    const evidence = db.prepare(`
      SELECT * FROM evidence WHERE incident_id = ?
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
    `).all(incident.id);

    // Get activity log
    const activity = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'incident' AND al.entity_id = ?
      ORDER BY al.created_at DESC
    `).all(incident.id);

    res.json({
      ...incident,
      evidence,
      linked_persons,
      linked_vehicles,
      activity,
    });
  } catch (error: any) {
    console.error('Get incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/incidents - Create incident
router.post('/', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
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
      client_id: requestClientId,
      // Sub-type fields
      road_conditions, traffic_control, vehicle_1_info, vehicle_2_info, diagram_notes,
      patient_status, ems_transport, patient_vitals, treatment_rendered,
      trespass_warning_issued, trespass_effective_date, trespass_expiry_date, property_boundaries,
      force_type, force_justification, subject_injuries, officer_injuries, de_escalation_attempts,
    } = req.body;

    if (!incident_type) {
      res.status(400).json({ error: 'incident_type is required' });
      return;
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

    // ── Auto-fill Beat / Zone / Sector from GPS coordinates + 3-Tier lookup ──
    let autoZoneBeat = zone_beat || null;
    let autoSectionId = section_id || null;
    let autoZoneId = zone_id || null;
    let autoBeatId = beat_id || null;
    if (latitude != null && longitude != null) {
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

    const createTx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO incidents (incident_number, call_id, incident_type, priority, status, location_address,
          property_id, latitude, longitude, narrative, officer_id,
          occurred_date, occurred_time, end_date, end_time,
          weather_conditions, lighting_conditions,
          injuries, injury_description, damage_estimate, damage_description,
          weapons_involved, alcohol_involved, drugs_involved, domestic_violence,
          disposition, zone_beat, section_id, zone_id, beat_id, responding_le_agency, le_case_number,
          statute_id, statute_citation, citation_fine, client_id,
          road_conditions, traffic_control, vehicle_1_info, vehicle_2_info, diagram_notes,
          patient_status, ems_transport, patient_vitals, treatment_rendered,
          trespass_warning_issued, trespass_effective_date, trespass_expiry_date, property_boundaries,
          force_type, force_justification, subject_injuries, officer_injuries, de_escalation_attempts)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?)
      `).run(
        incidentNumber, call_id || null, incident_type, priority || 'P3',
        location_address || null, property_id || null, latitude ?? null,
        longitude ?? null, narrative || null, req.user!.userId,
        occurred_date || null, occurred_time || null, end_date || null, end_time || null,
        weather_conditions || null, lighting_conditions || null,
        injuries ?? 'none', injury_description || null, damage_estimate ?? null, damage_description || null,
        weapons_involved || null,
        alcohol_involved ? 1 : 0, drugs_involved ? 1 : 0, domestic_violence ? 1 : 0,
        disposition || null, autoZoneBeat, autoSectionId, autoZoneId, autoBeatId,
        responding_le_agency || null, le_case_number || null,
        statute_id || null, statute_citation || null, citation_fine ?? null,
        resolvedClientId,
        road_conditions || null, traffic_control || null, vehicle_1_info || null, vehicle_2_info || null, diagram_notes || null,
        patient_status || null, ems_transport || null, patient_vitals || null, treatment_rendered || null,
        trespass_warning_issued ? 1 : 0, trespass_effective_date || null, trespass_expiry_date || null, property_boundaries || null,
        force_type || null, force_justification || null, subject_injuries || null, officer_injuries || null, de_escalation_attempts || null,
      );

      return db.prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid);
    });

    const incident = createTx();
    if (!incident) { res.status(500).json({ error: 'Failed to retrieve created incident' }); return; }

    auditLog(req, 'incident_created', 'incident', (incident as any).id, `Created incident #${incidentNumber}`);

    // Notify supervisors of new incident report
    createNotificationForRoles(
      ['admin', 'manager', 'supervisor'],
      'incident', `New Incident: ${incidentNumber}`,
      `${incident_type} — ${location_address || 'No address'}`,
      'incident', Number((incident as any).id), 'normal', 'incident.created', req.user!.userId,
    );

    res.status(201).json(incident);
  } catch (error: any) {
    console.error('Create incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/incidents/:id - Update incident
router.put('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    // Optimistic locking: if client sends updated_at, verify it matches
    const clientUpdatedAt = req.body.updated_at;
    if (clientUpdatedAt && clientUpdatedAt !== incident.updated_at) {
      res.status(409).json({
        error: 'This incident has been modified by another user. Please refresh and try again.',
        code: 'CONFLICT',
        server_updated_at: incident.updated_at,
      });
      return;
    }

    // Permission checks:
    // - Admin/manager/supervisor can edit any incident in any status
    // - Officers can edit their own incidents in draft, returned, submitted, or approved
    if (!['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
      if (!['draft', 'returned', 'submitted', 'approved'].includes(incident.status)) {
        res.status(403).json({ error: 'Cannot edit incidents in this status' });
        return;
      }
      if (incident.officer_id !== req.user!.userId) {
        res.status(403).json({ error: 'Can only edit your own incidents' });
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

    // Validate coordinates if provided
    if (latitude !== undefined || longitude !== undefined) {
      const coordErr = validateCoordinates(latitude, longitude);
      if (coordErr) { res.status(400).json({ error: coordErr }); return; }
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
      // PSO / Process Service fields
      pso_service_type: v => v ?? null,
      pso_attempt_number: v => v != null ? Number(v) : null,
      pso_requestor_name: v => v ?? null,
      pso_requestor_phone: v => v ?? null,
      pso_requestor_email: v => v ?? null,
      pso_billing_code: v => v ?? null,
      pso_authorization: v => v ?? null,
      process_service_type: v => v ?? null,
      process_served_to: v => v ?? null,
      process_served_address: v => v ?? null,
      process_service_result: v => v ?? null,
      process_served_at: v => v ?? null,
      process_attempts: v => v != null ? Number(v) : null,
      contract_id: v => v ?? null,
      // Operational flags
      injuries_reported: v => v ? 1 : 0,
      mental_health_crisis: v => v ? 1 : 0,
      juvenile_involved: v => v ? 1 : 0,
      felony_in_progress: v => v ? 1 : 0,
      officer_safety_caution: v => v ? 1 : 0,
      k9_requested: v => v ? 1 : 0,
      ems_requested: v => v ? 1 : 0,
      fire_requested: v => v ? 1 : 0,
      hazmat: v => v ? 1 : 0,
      gang_related: v => v ? 1 : 0,
      evidence_collected: v => v ? 1 : 0,
      body_camera_active: v => v ? 1 : 0,
      photos_taken: v => v ? 1 : 0,
      trespass_issued: v => v ? 1 : 0,
      vehicle_pursuit: v => v ? 1 : 0,
      foot_pursuit: v => v ? 1 : 0,
      le_notified: v => v ? 1 : 0,
      supervisor_notified: v => v ? 1 : 0,
    };

    for (const [key, transform] of Object.entries(iFieldMap)) {
      if (iBodyKeys.includes(key)) {
        iFields.push(`${key} = ?`);
        iValues.push(transform(req.body[key]));
      }
    }

    if (iFields.length > 0) {
      iFields.push("updated_at = ?");
      iValues.push(localNow());
      iValues.push(req.params.id);
      db.prepare(`UPDATE incidents SET ${iFields.join(', ')} WHERE id = ?`).run(...iValues);
    }

    auditLog(req, 'incident_updated', 'incident', String(req.params.id), `Updated incident #${incident.incident_number}`);

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/incidents/:id - Delete draft incident
router.delete('/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    if (incident.status !== 'draft') {
      res.status(403).json({ error: 'Can only delete draft incidents' });
      return;
    }

    if (incident.officer_id !== req.user!.userId && !['admin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    const deleteIncTx = db.transaction(() => {
      db.prepare('DELETE FROM supplemental_reports WHERE incident_id = ?').run(incident.id);
      db.prepare('DELETE FROM incident_persons WHERE incident_id = ?').run(incident.id);
      db.prepare('DELETE FROM incident_vehicles WHERE incident_id = ?').run(incident.id);
      db.prepare('DELETE FROM evidence WHERE incident_id = ?').run(incident.id);
      db.prepare('DELETE FROM incidents WHERE id = ?').run(incident.id);
    });
    deleteIncTx();

    auditLog(req, 'incident_deleted', 'incident', incident.id, `Deleted incident #${incident.incident_number}`);

    res.json({ message: 'Incident deleted' });
  } catch (error: any) {
    console.error('Delete incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/incidents/:id/archive - Archive an incident
router.post('/:id/archive', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) { res.status(404).json({ error: 'Incident not found' }); return; }
    if (incident.archived_at) { res.status(400).json({ error: 'Incident is already archived' }); return; }
    if (['draft', 'submitted'].includes(incident.status)) {
      res.status(400).json({ error: 'Can only archive approved or closed incidents' }); return;
    }
    const now = localNow();
    db.prepare('UPDATE incidents SET archived_at = ? WHERE id = ?').run(now, incident.id);
    auditLog(req, 'incident_status_changed', 'incident', incident.id, `Changed status to archived for incident #${incident.incident_number}`);
    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/incidents/:id/unarchive - Restore from archive
router.post('/:id/unarchive', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) { res.status(404).json({ error: 'Incident not found' }); return; }
    if (!incident.archived_at) { res.status(400).json({ error: 'Incident is not archived' }); return; }
    db.prepare('UPDATE incidents SET archived_at = NULL WHERE id = ?').run(incident.id);
    auditLog(req, 'incident_status_changed', 'incident', incident.id, `Changed status to unarchived for incident #${incident.incident_number}`);
    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/incidents/:id/submit - Submit for review
router.put('/:id/submit', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    if (!['draft', 'returned'].includes(incident.status)) {
      res.status(400).json({ error: 'Can only submit draft or returned incidents' });
      return;
    }

    if (!incident.narrative || incident.narrative.trim().length === 0) {
      res.status(400).json({ error: 'Narrative is required before submitting' });
      return;
    }

    db.prepare(`
      UPDATE incidents SET status = 'submitted', updated_at = ? WHERE id = ?
    `).run(localNow(), incident.id);

    auditLog(req, 'incident_status_changed', 'incident', incident.id, `Changed status to submitted for incident #${incident.incident_number}`);

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Submit incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/incidents/:id/approve - Approve incident (supervisor+)
router.put('/:id/approve', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    if (!['submitted', 'under_review'].includes(incident.status)) {
      res.status(400).json({ error: 'Can only approve submitted or under-review incidents' });
      return;
    }

    const now = localNow();

    db.prepare(`
      UPDATE incidents SET status = 'approved', supervisor_id = ?, approved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(req.user!.userId, now, localNow(), incident.id);

    auditLog(req, 'incident_status_changed', 'incident', incident.id, `Changed status to approved for incident #${incident.incident_number}`);

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Approve incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/incidents/:id/return - Return incident with comments
router.put('/:id/return', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    if (!['submitted', 'under_review'].includes(incident.status)) {
      res.status(400).json({ error: 'Can only return submitted or under-review incidents' });
      return;
    }

    const { comments } = req.body;

    db.prepare(`
      UPDATE incidents SET status = 'returned', supervisor_id = ?, updated_at = ?
      WHERE id = ?
    `).run(req.user!.userId, localNow(), incident.id);

    auditLog(req, 'incident_status_changed', 'incident', incident.id, `Changed status to returned for incident #${incident.incident_number}`);

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Return incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PERSON LINKING ──────────────────────────────────

// POST /api/incidents/:id/persons - Link person to incident
router.post('/:id/persons', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    const { person_id, role, notes } = req.body;
    if (!person_id || !role) {
      res.status(400).json({ error: 'person_id and role are required' });
      return;
    }

    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(person_id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    // Check if already linked
    const existing = db.prepare('SELECT * FROM incident_persons WHERE incident_id = ? AND person_id = ?').get(incident.id, person_id) as any;
    if (existing) {
      res.status(409).json({ error: 'Person already linked to this incident' });
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
    if (!linked) { res.status(500).json({ error: 'Failed to retrieve linked person' }); return; }

    auditLog(req, 'incident_updated', 'incident', incident.id, `Added person to incident #${incident.incident_number}`);

    // Async warrant check for linked person
    universalWarrantCheck(Number(person_id)).catch(err =>
      console.error('[Warrant Check] Async check failed:', err.message)
    );

    res.status(201).json(linked);
  } catch (error: any) {
    console.error('Link person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/incidents/:id/persons/:personId - Update person link
router.put('/:id/persons/:personId', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM incident_persons WHERE incident_id = ? AND person_id = ?')
      .get(req.params.id, req.params.personId) as any;
    if (!link) {
      res.status(404).json({ error: 'Person link not found' });
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

    auditLog(req, 'incident_updated', 'incident', String(req.params.id), `Updated person link on incident #${req.params.id}`);

    res.json(updated);
  } catch (error: any) {
    console.error('Update person link error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/incidents/:id/persons/:personId - Unlink person
router.delete('/:id/persons/:personId', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM incident_persons WHERE incident_id = ? AND person_id = ?')
      .get(req.params.id, req.params.personId) as any;
    if (!link) {
      res.status(404).json({ error: 'Person link not found' });
      return;
    }

    const person = db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(req.params.personId) as any;
    const incident = db.prepare('SELECT incident_number FROM incidents WHERE id = ?').get(req.params.id) as any;

    db.prepare('DELETE FROM incident_persons WHERE id = ?').run(link.id);

    auditLog(req, 'incident_updated', 'incident', String(req.params.id), `Removed person from incident #${incident?.incident_number || req.params.id}`);

    res.json({ message: 'Person unlinked from incident' });
  } catch (error: any) {
    console.error('Unlink person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── VEHICLE LINKING ─────────────────────────────────

// POST /api/incidents/:id/vehicles - Link vehicle to incident
router.post('/:id/vehicles', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    const { vehicle_id, role, notes } = req.body;
    if (!vehicle_id || !role) {
      res.status(400).json({ error: 'vehicle_id and role are required' });
      return;
    }

    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(vehicle_id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }

    const existing = db.prepare('SELECT * FROM incident_vehicles WHERE incident_id = ? AND vehicle_id = ?').get(incident.id, vehicle_id) as any;
    if (existing) {
      res.status(409).json({ error: 'Vehicle already linked to this incident' });
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
    if (!linked) { res.status(500).json({ error: 'Failed to retrieve linked vehicle' }); return; }

    auditLog(req, 'incident_updated', 'incident', incident.id, `Added vehicle to incident #${incident.incident_number}`);

    res.status(201).json(linked);
  } catch (error: any) {
    console.error('Link vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/incidents/:id/vehicles/:vehicleId - Update vehicle link
router.put('/:id/vehicles/:vehicleId', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM incident_vehicles WHERE incident_id = ? AND vehicle_id = ?')
      .get(req.params.id, req.params.vehicleId) as any;
    if (!link) {
      res.status(404).json({ error: 'Vehicle link not found' });
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

    auditLog(req, 'incident_updated', 'incident', String(req.params.id), `Updated vehicle link on incident #${req.params.id}`);

    res.json(updated);
  } catch (error: any) {
    console.error('Update vehicle link error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/incidents/:id/vehicles/:vehicleId - Unlink vehicle
router.delete('/:id/vehicles/:vehicleId', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM incident_vehicles WHERE incident_id = ? AND vehicle_id = ?')
      .get(req.params.id, req.params.vehicleId) as any;
    if (!link) {
      res.status(404).json({ error: 'Vehicle link not found' });
      return;
    }

    const vehicle = db.prepare('SELECT plate_number, make, model FROM vehicles_records WHERE id = ?').get(req.params.vehicleId) as any;
    const incident = db.prepare('SELECT incident_number FROM incidents WHERE id = ?').get(req.params.id) as any;

    db.prepare('DELETE FROM incident_vehicles WHERE id = ?').run(link.id);

    auditLog(req, 'incident_updated', 'incident', String(req.params.id), `Removed vehicle from incident #${incident?.incident_number || req.params.id}`);

    res.json({ message: 'Vehicle unlinked from incident' });
  } catch (error: any) {
    console.error('Unlink vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── EVIDENCE ────────────────────────────────────────

// POST /api/incidents/:id/evidence - Create evidence for incident
router.post('/:id/evidence', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
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
      res.status(400).json({ error: 'description and evidence_type are required' });
      return;
    }

    // Generate evidence number
    const currentYear = parseInt(localToday().slice(0, 4), 10);
    const lastEvidence = db.prepare(
      `SELECT evidence_number FROM evidence WHERE evidence_number LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 1`
    ).get(`${escapeLike(`EV-${currentYear}-`)}%`) as any;

    let nextNum = 1;
    if (lastEvidence) {
      const parts = lastEvidence.evidence_number.split('-');
      const parsed = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
      if (!isNaN(parsed)) nextNum = parsed + 1;
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
      collected_date || null, packaging_type || null, dimensions || null, weight ?? null,
      photo_taken ? 1 : 0, lab_submitted ? 1 : 0, lab_case_number || null, lab_name || null,
      disposal_method || null, disposal_date || null, disposal_authorized_by || null,
      serial_number || null, brand || null, model || null, estimated_value ?? null, category || null
    );

    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(result.lastInsertRowid);
    if (!evidence) { res.status(500).json({ error: 'Failed to retrieve created evidence' }); return; }

    auditLog(req, 'incident_updated', 'incident', incident.id, `Added evidence to incident #${incident.incident_number}`);

    res.status(201).json(evidence);
  } catch (error: any) {
    console.error('Create evidence error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── SUPPLEMENTS ─────────────────────────────────────

// GET /api/incidents/:id/supplements - List supplemental reports for an incident
router.get('/:id/supplements', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT id FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
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
    `).all(req.params.id);

    res.json(supplements);
  } catch (error: any) {
    console.error('List supplements error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/incidents/:id/supplements - Create a supplement
router.post('/:id/supplements', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    const { report_type, subject, narrative } = req.body;
    if (!report_type || !subject || !narrative) {
      res.status(400).json({ error: 'report_type, subject, and narrative are required' });
      return;
    }

    // Generate report number: SUP-YYYY-NNNNN
    const currentYearSup = parseInt(localToday().slice(0, 4), 10);
    const lastSup = db.prepare(
      `SELECT report_number FROM supplemental_reports WHERE report_number LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 1`
    ).get(`${escapeLike(`SUP-${currentYearSup}-`)}%`) as any;

    let nextNum = 1;
    if (lastSup) {
      const parts = lastSup.report_number.split('-');
      const parsed = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
      if (!isNaN(parsed)) nextNum = parsed + 1;
    }
    const reportNumber = `SUP-${currentYearSup}-${String(nextNum).padStart(5, '0')}`;

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
    if (!supplement) { res.status(500).json({ error: 'Failed to retrieve created supplement' }); return; }

    auditLog(req, 'supplement_added', 'incident', incident.id, `Added supplement to incident #${incident.incident_number}`);

    res.status(201).json(supplement);
  } catch (error: any) {
    console.error('Create supplement error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/incidents/:incidentId/supplements/:supId - Update a supplement
router.put('/:incidentId/supplements/:supId', validateNumericParams('incidentId', 'supId'), requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sup = db.prepare('SELECT * FROM supplemental_reports WHERE id = ? AND incident_id = ?')
      .get(req.params.supId, req.params.incidentId) as any;
    if (!sup) {
      res.status(404).json({ error: 'Supplement not found' });
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
      res.status(400).json({ error: 'No fields to update' });
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

    auditLog(req, 'incident_updated', 'incident', String(req.params.incidentId), `Updated supplement on incident #${req.params.incidentId}`);

    res.json(updated);
  } catch (error: any) {
    console.error('Update supplement error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/incidents/:incidentId/supplements/:supId - Delete a draft supplement
router.delete('/:incidentId/supplements/:supId', validateNumericParams('incidentId', 'supId'), requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sup = db.prepare('SELECT * FROM supplemental_reports WHERE id = ? AND incident_id = ?')
      .get(req.params.supId, req.params.incidentId) as any;
    if (!sup) {
      res.status(404).json({ error: 'Supplement not found' });
      return;
    }
    if (sup.status !== 'draft') {
      res.status(400).json({ error: 'Only draft supplements can be deleted' });
      return;
    }

    db.prepare('DELETE FROM supplemental_reports WHERE id = ?').run(req.params.supId);

    auditLog(req, 'incident_updated', 'incident', String(req.params.incidentId), `Deleted supplement from incident #${req.params.incidentId}`);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete supplement error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
