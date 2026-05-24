// Incident routes for Workers (full CRUD)
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow, paramStr, paramNum } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';

const TYPE_CODES: Record<string, string> = {
  alarm_response: 'ALR', access_control: 'ACC', patrol_check: 'PTL', lock_unlock: 'LCK',
  property_damage: 'PDM', lost_found: 'LFP', theft: 'THF', burglary: 'BRG', robbery: 'ROB',
  assault: 'ASL', battery: 'BAT', vandalism: 'VAN', criminal_mischief: 'CRM',
  drug_activity: 'DRG', weapons_offense: 'WPN', fraud_forgery: 'FRD',
  kidnapping: 'KID', arson: 'ARS', sexual_assault: 'SXA', stalking: 'STK',
  identity_theft: 'IDT', extortion: 'EXT', criminal_trespass: 'CTR',
  disorderly_conduct: 'DIS', public_intoxication: 'PIX', indecent_exposure: 'INX',
  shoplifting: 'SHP', auto_theft: 'ATH', receiving_stolen: 'RST',
  poss_stolen_vehicle: 'PSV', criminal_threat: 'CTH', illegal_dumping: 'ILD',
  prostitution: 'PRS', trespass: 'TRS', disturbance: 'DST', noise_complaint: 'NOI',
  loitering: 'LOI', panhandling: 'PNH', domestic_dispute: 'DOM',
  prowler: 'PRW', harassment: 'HRS', curfew_violation: 'CRF', illegal_camping: 'ILC',
  traffic_accident: 'TAC', hit_and_run: 'HNR', dui_dwi: 'DUI', parking_violation: 'PKV',
  traffic_hazard: 'THZ', abandoned_vehicle: 'ABV', reckless_driving: 'RKD',
  suspended_license: 'SLI', no_insurance: 'NIN', expired_registration: 'EXR',
  speed_violation: 'SPD', traffic_stop: 'TST', medical_emergency: 'MED', overdose: 'OVD',
  mental_health_crisis: 'MHC', fire: 'FIR', fire_alarm: 'FAR', hazmat: 'HAZ',
  escort: 'ESC', welfare_check: 'WCK', citizen_assist: 'CTA', civil_standby: 'CSB',
  animal_complaint: 'ANM', utility_problem: 'UTI', pso_client_request: 'PSO',
  death_investigation: 'DTH', juvenile_runaway: 'JRN', missing_person: 'MSP',
  found_person: 'FDP', repo_notice: 'REP', civil_dispute: 'CVD',
  daily_activity: 'DAR', special_event: 'SPE', training_exercise: 'TRN',
  equipment_issue: 'EQP', suspicious_activity: 'SUS', other: 'OTH',
};

function getTypeCode(type: string): string {
  return TYPE_CODES[type] || 'OTH';
}

async function generateIncidentNumber(db: D1Db, incidentType: string): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const code = getTypeCode(incidentType);
  const prefix = `RKY${yy}-`;
  const lastInc = await db.prepare('SELECT incident_number FROM incidents WHERE incident_number LIKE ? ORDER BY id DESC LIMIT 1').get(`${prefix}%`) as any;
  let nextNum = 1;
  if (lastInc) {
    const match = lastInc.incident_number?.match(/RKY\d{2}-(\d{5})-/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(5, '0')}-${code}`;
}

export function mountIncidentRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ─── LIST ────────────────────────────────────────────
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { status, priority, officerId, startDate, endDate, archived, page = '1', limit = '100000' } = c.req.query();

      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (status) { where += ' AND i.status = ?'; params.push(status); }
      if (priority) { where += ' AND i.priority = ?'; params.push(priority); }
      if (officerId) { where += ' AND i.officer_id = ?'; params.push(Number(officerId)); }
      if (startDate) { where += ' AND i.created_at >= ?'; params.push(startDate); }
      if (endDate) { where += ' AND i.created_at <= ?'; params.push(endDate); }
      if (archived === 'true') { where += ' AND i.archived_at IS NOT NULL'; }
      else if (archived !== 'all') { where += ' AND i.archived_at IS NULL'; }
      if (user.role === 'officer') { where += ' AND i.officer_id = ?'; params.push(user.userId); }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
      const offset = (pageNum - 1) * limitNum;

      const countRow = await db.prepare(`SELECT COUNT(*) as total FROM incidents i ${where}`).get(...params) as any;
      const incidents = await db.prepare(`
        SELECT i.*, o.full_name as officer_name, o.badge_number,
          s.full_name as supervisor_name, p.name as property_name,
          c.call_number, cl.name as client_name
        FROM incidents i
        LEFT JOIN users o ON i.officer_id = o.id
        LEFT JOIN users s ON i.supervisor_id = s.id
        LEFT JOIN properties p ON i.property_id = p.id
        LEFT JOIN calls_for_service c ON i.call_id = c.id
        LEFT JOIN clients cl ON COALESCE(i.client_id, p.client_id) = cl.id
        ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);

      return c.json({ data: incidents, pagination: { page: pageNum, limit: limitNum, total: (countRow as any)?.total ?? 0, totalPages: Math.ceil(((countRow as any)?.total ?? 0) / limitNum) } });
    } catch (err: any) {
      return c.json({ error: 'Failed to get incidents', code: 'GET_INCIDENTS_ERROR' }, 500);
    }
  });

  // ─── GET MAP ─────────────────────────────────────────
  api.get('/map', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10) || 30));
      const limit = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100000', 10) || 100000));

      const statusFilter = c.req.query('status')
        ? String(c.req.query('status')).split(',').filter(s => s.length > 0 && s.length < 50).slice(0, 10)
        : [];

      const typesFilter = c.req.query('types')
        ? String(c.req.query('types')).split(',').filter(t => t.length > 0 && t.length < 100).slice(0, 30)
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

      if (user.role === 'officer') {
        conditions.push('i.officer_id = ?');
        params.push(user.userId);
      }

      const whereClause = conditions.join(' AND ');

      const rows = await db.prepare(`
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

      return c.json(rows);
    } catch (err: any) {
      return c.json({ error: 'Failed to get incidents map data', code: 'GET_INCIDENTS_MAP_ERROR' }, 500);
    }
  });

  // ─── GET SINGLE ──────────────────────────────────────
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare(`
        SELECT i.*, o.full_name as officer_name, o.badge_number,
          s.full_name as supervisor_name, p.name as property_name,
          c.call_number, c.incident_type as call_type, cl.name as client_name
        FROM incidents i
        LEFT JOIN users o ON i.officer_id = o.id
        LEFT JOIN users s ON i.supervisor_id = s.id
        LEFT JOIN properties p ON i.property_id = p.id
        LEFT JOIN calls_for_service c ON i.call_id = c.id
        LEFT JOIN clients cl ON COALESCE(i.client_id, p.client_id) = cl.id
        WHERE i.id = ?
      `).get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);

      const [evidence, linked_persons, linked_vehicles, activity] = await Promise.all([
        db.prepare('SELECT * FROM evidence WHERE incident_id = ? LIMIT 1000').all(id),
        db.prepare(`SELECT ip.*, p.first_name, p.last_name, p.dob, p.phone, p.flags, u.full_name as added_by_name FROM incident_persons ip LEFT JOIN persons p ON ip.person_id = p.id LEFT JOIN users u ON ip.added_by = u.id WHERE ip.incident_id = ? ORDER BY ip.created_at LIMIT 1000`).all(id),
        db.prepare(`SELECT iv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin, p.first_name as owner_first_name, p.last_name as owner_last_name, u.full_name as added_by_name FROM incident_vehicles iv LEFT JOIN vehicles_records v ON iv.vehicle_id = v.id LEFT JOIN persons p ON v.owner_person_id = p.id LEFT JOIN users u ON iv.added_by = u.id WHERE iv.incident_id = ? ORDER BY iv.created_at LIMIT 1000`).all(id),
        db.prepare(`SELECT al.*, u.full_name as user_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.entity_type = 'incident' AND al.entity_id = ? ORDER BY al.created_at DESC LIMIT 1000`).all(id),
      ]);

      return c.json({ ...incident, evidence, linked_persons, linked_vehicles, activity });
    } catch (err: any) {
      return c.json({ error: 'Failed to get incident', code: 'GET_INCIDENT_ERROR' }, 500);
    }
  });

  // ─── GET FULL ────────────────────────────────────────
  api.get('/:id/full', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT i.*, u.full_name as officer_name FROM incidents i LEFT JOIN users u ON i.officer_id = u.id WHERE i.id = ?').get(id);
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);

      const [offenses, officers, links] = await Promise.all([
        db.prepare('SELECT * FROM incident_offenses WHERE incident_id = ?').all(id),
        db.prepare('SELECT io.*, u.full_name as officer_name FROM incident_officers io LEFT JOIN users u ON io.officer_user_id = u.id WHERE io.incident_id = ?').all(id),
        db.prepare('SELECT * FROM incident_links WHERE incident_id = ?').all(id),
      ]);
      return c.json({ ...incident, offenses, officers, links });
    } catch (err: any) {
      return c.json({ error: 'Failed to get incident', code: 'GET_INCIDENT_FULL_ERROR' }, 500);
    }
  });

  // ─── CREATE ──────────────────────────────────────────
  api.post('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { call_id, incident_type, priority, location_address, property_id, latitude, longitude, narrative, occurred_date, occurred_time, end_date, end_time, weather_conditions, lighting_conditions, injuries, injury_description, damage_estimate, damage_description, weapons_involved, alcohol_involved, drugs_involved, domestic_violence, disposition, zone_beat, sector_id, zone_id, beat_id, responding_le_agency, le_case_number, client_id: requestClientId, road_conditions, traffic_control, vehicle_1_info, vehicle_2_info, diagram_notes, patient_status, ems_transport, patient_vitals, treatment_rendered, trespass_warning_issued, trespass_effective_date, trespass_expiry_date, property_boundaries, force_type, force_justification, subject_injuries, officer_injuries, de_escalation_attempts, injuries_reported, mental_health_crisis, juvenile_involved, felony_in_progress, officer_safety_caution, k9_requested, ems_requested, fire_requested, hazmat, gang_related, evidence_collected, body_camera_active, photos_taken, trespass_issued, vehicle_pursuit, foot_pursuit, le_notified, supervisor_notified, contract_id, pso_service_type, pso_attempt_number, pso_requestor_name, pso_requestor_phone, pso_requestor_email, pso_billing_code, pso_authorization, process_service_type, process_served_to, process_served_address, process_service_result, process_served_at, process_attempts } = body;

      if (!incident_type) return c.json({ error: 'incident_type is required', code: 'INCIDENTTYPE_IS_REQUIRED' }, 400);

      let resolvedClientId = requestClientId || null;
      if (!resolvedClientId && property_id) {
        const prop = await db.prepare('SELECT client_id FROM properties WHERE id = ?').get(property_id) as any;
        if (prop) resolvedClientId = prop.client_id;
      }

      const incidentNumber = await generateIncidentNumber(db, incident_type);
      const now = localNow();

      const result = await db.prepare(`
        INSERT INTO incidents (incident_number, call_id, incident_type, priority, status, location_address, property_id, latitude, longitude, narrative, officer_id, occurred_date, occurred_time, end_date, end_time, weather_conditions, lighting_conditions, injuries, injury_description, damage_estimate, damage_description, weapons_involved, alcohol_involved, drugs_involved, domestic_violence, disposition, zone_beat, sector_id, zone_id, beat_id, responding_le_agency, le_case_number, client_id, road_conditions, traffic_control, vehicle_1_info, vehicle_2_info, diagram_notes, patient_status, ems_transport, patient_vitals, treatment_rendered, trespass_warning_issued, trespass_effective_date, trespass_expiry_date, property_boundaries, force_type, force_justification, subject_injuries, officer_injuries, de_escalation_attempts, injuries_reported, mental_health_crisis, juvenile_involved, felony_in_progress, officer_safety_caution, k9_requested, ems_requested, fire_requested, hazmat, gang_related, evidence_collected, body_camera_active, photos_taken, trespass_issued, vehicle_pursuit, foot_pursuit, le_notified, supervisor_notified, contract_id, pso_service_type, pso_attempt_number, pso_requestor_name, pso_requestor_phone, pso_requestor_email, pso_billing_code, pso_authorization, process_service_type, process_served_to, process_served_address, process_service_result, process_served_at, process_attempts, created_at)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        incidentNumber, call_id || null, incident_type, priority || 'P3',
        location_address || null, property_id || null, latitude || null, longitude || null,
        narrative || null, user.userId, occurred_date || null, occurred_time || null,
        end_date || null, end_time || null, weather_conditions || null, lighting_conditions || null,
        injuries ?? 'none', injury_description || null, damage_estimate || null, damage_description || null,
        weapons_involved || null, alcohol_involved ? 1 : 0, drugs_involved ? 1 : 0, domestic_violence ? 1 : 0,
        disposition || null, zone_beat || null, sector_id || null, zone_id || null, beat_id || null,
        responding_le_agency || null, le_case_number || null, resolvedClientId,
        road_conditions || null, traffic_control || null, vehicle_1_info || null, vehicle_2_info || null, diagram_notes || null,
        patient_status || null, ems_transport || null, patient_vitals || null, treatment_rendered || null,
        trespass_warning_issued ? 1 : 0, trespass_effective_date || null, trespass_expiry_date || null, property_boundaries || null,
        force_type || null, force_justification || null, subject_injuries || null, officer_injuries || null, de_escalation_attempts || null,
        injuries_reported ? 1 : 0, mental_health_crisis ? 1 : 0, juvenile_involved ? 1 : 0, felony_in_progress ? 1 : 0,
        officer_safety_caution ? 1 : 0, k9_requested ? 1 : 0, ems_requested ? 1 : 0, fire_requested ? 1 : 0, hazmat ? 1 : 0,
        gang_related ? 1 : 0, evidence_collected ? 1 : 0, body_camera_active ? 1 : 0, photos_taken ? 1 : 0,
        trespass_issued ? 1 : 0, vehicle_pursuit ? 1 : 0, foot_pursuit ? 1 : 0,
        le_notified ? 1 : 0, supervisor_notified ? 1 : 0,
        contract_id || null, pso_service_type || null, pso_attempt_number ?? null,
        pso_requestor_name || null, pso_requestor_phone || null, pso_requestor_email || null,
        pso_billing_code || null, pso_authorization || null,
        process_service_type || null, process_served_to || null, process_served_address || null,
        process_service_result || null, process_served_at || null, process_attempts ?? 0,
        now,
      );

      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(result.meta.last_row_id);
      await auditLog(db, c, 'incident_created', 'incident', Number(result.meta.last_row_id), `Created ${incidentNumber}`);
      return c.json(incident, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to create incident', code: 'CREATE_INCIDENT_ERROR' }, 500);
    }
  });

  // ─── UPDATE ──────────────────────────────────────────
  api.put('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);

      if (!['admin', 'manager', 'supervisor'].includes(user.role)) {
        if (!['draft', 'returned', 'submitted', 'approved'].includes(incident.status)) return c.json({ error: 'Cannot edit incidents in this status', code: 'CANNOT_EDIT_INCIDENTS_IN' }, 403);
        if (incident.officer_id !== user.userId) return c.json({ error: 'Can only edit your own incidents', code: 'CAN_ONLY_EDIT_YOUR' }, 403);
      }

      const body = await c.req.json();
      const fieldMap: Record<string, (v: any) => any> = {
        incident_type: v => v ?? null, priority: v => v ?? null, location_address: v => v ?? null,
        property_id: v => v ?? null, latitude: v => v ?? null, longitude: v => v ?? null,
        narrative: v => v ?? null, occurred_date: v => v ?? null, occurred_time: v => v ?? null,
        end_date: v => v ?? null, end_time: v => v ?? null, weather_conditions: v => v ?? null,
        lighting_conditions: v => v ?? null, injuries: v => v ?? null, injury_description: v => v ?? null,
        damage_estimate: v => v ?? null, damage_description: v => v ?? null, weapons_involved: v => v ?? null,
        alcohol_involved: v => v ? 1 : 0, drugs_involved: v => v ? 1 : 0, domestic_violence: v => v ? 1 : 0,
        disposition: v => v ?? null, zone_beat: v => v ?? null, sector_id: v => v ?? null,
        zone_id: v => v ?? null, beat_id: v => v ?? null, responding_le_agency: v => v ?? null,
        le_case_number: v => v ?? null, client_id: v => v ?? null,
        road_conditions: v => v ?? null, traffic_control: v => v ?? null, vehicle_1_info: v => v ?? null,
        vehicle_2_info: v => v ?? null, diagram_notes: v => v ?? null, patient_status: v => v ?? null,
        ems_transport: v => v ?? null, patient_vitals: v => v ?? null, treatment_rendered: v => v ?? null,
        trespass_warning_issued: v => v ? 1 : 0, trespass_effective_date: v => v ?? null,
        trespass_expiry_date: v => v ?? null, property_boundaries: v => v ?? null,
        force_type: v => v ?? null, force_justification: v => v ?? null, subject_injuries: v => v ?? null,
        officer_injuries: v => v ?? null, de_escalation_attempts: v => v ?? null,
        injuries_reported: v => v ? 1 : 0, mental_health_crisis: v => v ? 1 : 0,
        juvenile_involved: v => v ? 1 : 0, felony_in_progress: v => v ? 1 : 0,
        officer_safety_caution: v => v ? 1 : 0, k9_requested: v => v ? 1 : 0,
        ems_requested: v => v ? 1 : 0, fire_requested: v => v ? 1 : 0, hazmat: v => v ? 1 : 0,
        gang_related: v => v ? 1 : 0, evidence_collected: v => v ? 1 : 0, body_camera_active: v => v ? 1 : 0,
        photos_taken: v => v ? 1 : 0, trespass_issued: v => v ? 1 : 0, vehicle_pursuit: v => v ? 1 : 0,
        foot_pursuit: v => v ? 1 : 0, le_notified: v => v ? 1 : 0, supervisor_notified: v => v ? 1 : 0,
        contract_id: v => v ?? null, pso_service_type: v => v ?? null, pso_attempt_number: v => v ?? null,
        pso_requestor_name: v => v ?? null, pso_requestor_phone: v => v ?? null,
        pso_requestor_email: v => v ?? null, pso_billing_code: v => v ?? null,
        pso_authorization: v => v ?? null, process_service_type: v => v ?? null,
        process_served_to: v => v ?? null, process_served_address: v => v ?? null,
        process_service_result: v => v ?? null, process_served_at: v => v ?? null,
        process_attempts: v => v ?? null,
      };

      const bodyKeys = Object.keys(body);
      const fields: string[] = [];
      const values: any[] = [];
      for (const [key, transform] of Object.entries(fieldMap)) {
        if (bodyKeys.includes(key)) { fields.push(`${key} = ?`); values.push(transform(body[key])); }
      }
      if (fields.length > 0) { fields.push('updated_at = ?'); values.push(localNow()); values.push(id); await db.prepare(`UPDATE incidents SET ${fields.join(', ')} WHERE id = ?`).run(...values); }

      await auditLog(db, c, 'incident_updated', 'incident', id, `Updated incident ${incident.incident_number}`);
      const updated = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ error: 'Failed to update incident', code: 'UPDATE_INCIDENT_ERROR' }, 500);
    }
  });

  // ─── DELETE ──────────────────────────────────────────
  api.delete('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
      if (user.role !== 'admin' && incident.status !== 'draft') return c.json({ error: 'Can only delete draft incidents', code: 'CAN_ONLY_DELETE_DRAFT' }, 403);
      if (incident.officer_id !== user.userId && !['admin', 'manager'].includes(user.role)) return c.json({ error: 'Insufficient permissions', code: 'INSUFFICIENT_PERMISSIONS' }, 403);

      await db.prepare('DELETE FROM supplemental_reports WHERE incident_id = ?').run(id);
      await db.prepare('DELETE FROM incident_persons WHERE incident_id = ?').run(id);
      await db.prepare('DELETE FROM incident_vehicles WHERE incident_id = ?').run(id);
      await db.prepare('UPDATE evidence SET incident_id = NULL WHERE incident_id = ?').run(id);
      await db.prepare('DELETE FROM incidents WHERE id = ?').run(id);
      await auditLog(db, c, 'incident_deleted', 'incident', id, `Deleted incident ${incident.incident_number}`);
      return c.json({ message: 'Incident deleted' });
    } catch (err: any) {
      return c.json({ error: 'Failed to delete incident', code: 'DELETE_INCIDENT_ERROR' }, 500);
    }
  });

  // ─── SUBMIT ──────────────────────────────────────────
  api.post('/:id/submit', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
      if (!['draft', 'returned'].includes(incident.status) && user.role !== 'admin') return c.json({ error: 'Can only submit draft or returned incidents', code: 'CAN_ONLY_SUBMIT_DRAFT' }, 400);
      if (!incident.narrative?.trim()) return c.json({ error: 'Narrative is required before submitting', code: 'NARRATIVE_IS_REQUIRED_BEFORE' }, 400);

      await db.prepare("UPDATE incidents SET status = 'submitted', updated_at = ? WHERE id = ?").run(localNow(), id);
      await auditLog(db, c, 'incident_submitted', 'incident', id, `Submitted ${incident.incident_number} for review`);
      const updated = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ error: 'Failed to submit incident', code: 'SUBMIT_INCIDENT_ERROR' }, 500);
    }
  });

  // ─── APPROVE ─────────────────────────────────────────
  api.post('/:id/approve', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
      if (!['submitted', 'under_review'].includes(incident.status) && user.role !== 'admin') return c.json({ error: 'Can only approve submitted or under-review incidents', code: 'CAN_ONLY_APPROVE_SUBMITTED' }, 400);

      const now = localNow();
      await db.prepare("UPDATE incidents SET status = 'approved', supervisor_id = ?, approved_at = ?, updated_at = ? WHERE id = ?").run(user.userId, now, now, id);
      await auditLog(db, c, 'incident_approved', 'incident', id, `Approved ${incident.incident_number}`);
      const updated = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ error: 'Failed to approve incident', code: 'APPROVE_INCIDENT_ERROR' }, 500);
    }
  });

  // ─── RETURN ──────────────────────────────────────────
  api.post('/:id/return', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
      if (!['submitted', 'under_review'].includes(incident.status)) return c.json({ error: 'Can only return submitted or under-review incidents', code: 'CAN_ONLY_RETURN_SUBMITTED' }, 400);

      const body = await c.req.json();
      const { comments } = body;
      await db.prepare("UPDATE incidents SET status = 'returned', supervisor_id = ?, updated_at = ? WHERE id = ?").run(user.userId, localNow(), id);
      await auditLog(db, c, 'incident_returned', 'incident', id, `Returned ${incident.incident_number}: ${comments || 'No comments'}`);
      const updated = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ error: 'Failed to return incident', code: 'RETURN_INCIDENT_ERROR' }, 500);
    }
  });

  // ─── ARCHIVE / UNARCHIVE ────────────────────────────
  api.post('/:id/archive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
      if (incident.archived_at) return c.json({ error: 'Incident is already archived', code: 'INCIDENT_IS_ALREADY_ARCHIVED' }, 400);

      await db.prepare('UPDATE incidents SET archived_at = ? WHERE id = ?').run(localNow(), id);
      await auditLog(db, c, 'incident_archived', 'incident', id, `Archived ${incident.incident_number}`);
      const updated = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ error: 'Failed to archive incident', code: 'ARCHIVE_INCIDENT_ERROR' }, 500);
    }
  });

  api.post('/:id/unarchive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
      if (!incident.archived_at) return c.json({ error: 'Incident is not archived', code: 'INCIDENT_IS_NOT_ARCHIVED' }, 400);

      await db.prepare('UPDATE incidents SET archived_at = NULL WHERE id = ?').run(id);
      await auditLog(db, c, 'incident_unarchived', 'incident', id, `Restored ${incident.incident_number} from archive`);
      const updated = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ error: 'Failed to unarchive incident', code: 'UNARCHIVE_INCIDENT_ERROR' }, 500);
    }
  });

  // ─── PERSONS ─────────────────────────────────────────
  api.post('/:id/persons', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { person_id, role, notes } = body;
      if (!person_id || !role) return c.json({ error: 'person_id and role are required', code: 'PERSONID_AND_ROLE_ARE' }, 400);

      const person = await db.prepare('SELECT * FROM persons WHERE id = ?').get(person_id) as any;
      if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);

      const existing = await db.prepare('SELECT * FROM incident_persons WHERE incident_id = ? AND person_id = ?').get(id, person_id) as any;
      if (existing) return c.json({ error: 'Person already linked to this incident', code: 'PERSON_ALREADY_LINKED_TO' }, 409);

      const result = await db.prepare('INSERT INTO incident_persons (incident_id, person_id, role, notes, added_by) VALUES (?, ?, ?, ?, ?)').run(id, person_id, role, notes || null, user.userId);
      const linked = await db.prepare(`SELECT ip.*, p.first_name, p.last_name, p.dob, p.phone, p.flags, u.full_name as added_by_name FROM incident_persons ip LEFT JOIN persons p ON ip.person_id = p.id LEFT JOIN users u ON ip.added_by = u.id WHERE ip.id = ?`).get(result.meta.last_row_id);
      return c.json(linked, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to link person', code: 'LINK_PERSON_ERROR' }, 500);
    }
  });

  api.delete('/:id/persons/:personId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const personId = paramNum(c.req.param('personId'));
      const link = await db.prepare('SELECT * FROM incident_persons WHERE incident_id = ? AND person_id = ?').get(id, personId) as any;
      if (!link) return c.json({ error: 'Person link not found', code: 'PERSON_LINK_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM incident_persons WHERE id = ?').run(link.id);
      return c.json({ message: 'Person unlinked from incident' });
    } catch (err: any) {
      return c.json({ error: 'Failed to unlink person', code: 'UNLINK_PERSON_ERROR' }, 500);
    }
  });

  // ─── VEHICLES ───────────────────────────────────────
  api.post('/:id/vehicles', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const incident = await db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
      if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { vehicle_id, role, notes } = body;
      if (!vehicle_id) return c.json({ error: 'vehicle_id is required', code: 'VEHICLEID_IS_REQUIRED' }, 400);

      const existing = await db.prepare('SELECT * FROM incident_vehicles WHERE incident_id = ? AND vehicle_id = ?').get(id, vehicle_id) as any;
      if (existing) return c.json({ error: 'Vehicle already linked', code: 'VEHICLE_ALREADY_LINKED' }, 409);

      const result = await db.prepare('INSERT INTO incident_vehicles (incident_id, vehicle_id, role, notes, added_by) VALUES (?, ?, ?, ?, ?)').run(id, vehicle_id, role || 'involved', notes || null, user.userId);
      const linked = await db.prepare(`SELECT iv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin, p.first_name as owner_first_name, p.last_name as owner_last_name, u.full_name as added_by_name FROM incident_vehicles iv LEFT JOIN vehicles_records v ON iv.vehicle_id = v.id LEFT JOIN persons p ON v.owner_person_id = p.id LEFT JOIN users u ON iv.added_by = u.id WHERE iv.id = ?`).get(result.meta.last_row_id);
      return c.json(linked, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to link vehicle', code: 'LINK_VEHICLE_ERROR' }, 500);
    }
  });

  api.delete('/:id/vehicles/:vehicleId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const vehicleId = paramNum(c.req.param('vehicleId'));
      const link = await db.prepare('SELECT * FROM incident_vehicles WHERE incident_id = ? AND vehicle_id = ?').get(id, vehicleId) as any;
      if (!link) return c.json({ error: 'Vehicle link not found', code: 'VEHICLE_LINK_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM incident_vehicles WHERE id = ?').run(link.id);
      return c.json({ message: 'Vehicle unlinked from incident' });
    } catch (err: any) {
      return c.json({ error: 'Failed to unlink vehicle', code: 'UNLINK_VEHICLE_ERROR' }, 500);
    }
  });

  // ─── OFFENSES ────────────────────────────────────────
  api.post('/:id/offenses', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { statute_code, ucr_code, offense_type, classification, attempt_only, suspect_id, victim_id, location_type, property_description, value_stolen, value_recovered, drugs_involved, drug_type, drug_quantity } = body;

      const result = await db.prepare(`
        INSERT INTO incident_offenses (incident_id, statute_code, ucr_code, offense_type, classification,
          attempt_only, suspect_id, victim_id, location_type, property_description,
          value_stolen, value_recovered, drugs_involved, drug_type, drug_quantity, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, statute_code || null, ucr_code || null, offense_type || null, classification || null,
        attempt_only ? 1 : 0, suspect_id || null, victim_id || null, location_type || null,
        property_description || null, value_stolen || null, value_recovered || null,
        drugs_involved ? 1 : 0, drug_type || null, drug_quantity || null, user.userId);

      const offense = await db.prepare('SELECT * FROM incident_offenses WHERE id = ?').get(result.meta.last_row_id);
      return c.json(offense, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to add offense', code: 'ADD_OFFENSE_ERROR' }, 500);
    }
  });

  api.delete('/:id/offenses/:offenseId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const offenseId = paramNum(c.req.param('offenseId'));
      await db.prepare('DELETE FROM incident_offenses WHERE id = ? AND incident_id = ?').run(offenseId, id);
      return c.json({ message: 'Offense deleted' });
    } catch (err: any) {
      return c.json({ error: 'Failed to delete offense', code: 'DELETE_OFFENSE_ERROR' }, 500);
    }
  });

  // ─── OFFICERS ────────────────────────────────────────
  api.delete('/:id/officers/:officerId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const officerId = paramNum(c.req.param('officerId'));
      await db.prepare('DELETE FROM incident_officers WHERE id = ? AND incident_id = ?').run(officerId, id);
      return c.json({ message: 'Officer removed from incident' });
    } catch (err: any) {
      return c.json({ error: 'Failed to remove officer', code: 'REMOVE_OFFICER_ERROR' }, 500);
    }
  });

  // ─── LINKS ───────────────────────────────────────────
  api.post('/:id/links', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { linked_incident_id, linked_call_id, linked_case_id, linked_warrant_id, linked_citation_id, linked_arrest_id, link_type, notes } = body;
      const id = paramNum(c.req.param('id'));

      const result = await db.prepare(`
        INSERT INTO incident_links (incident_id, linked_incident_id, linked_call_id, linked_case_id, linked_warrant_id, linked_citation_id, linked_arrest_id, link_type, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, linked_incident_id || null, linked_call_id || null, linked_case_id || null, linked_warrant_id || null, linked_citation_id || null, linked_arrest_id || null, link_type || 'related', notes || null);

      const link = await db.prepare('SELECT * FROM incident_links WHERE id = ?').get(result.meta.last_row_id);
      return c.json(link, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to add link', code: 'ADD_LINK_ERROR' }, 500);
    }
  });

  api.delete('/:id/links/:linkId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const linkId = paramNum(c.req.param('linkId'));
      await db.prepare('DELETE FROM incident_links WHERE id = ? AND incident_id = ?').run(linkId, id);
      return c.json({ message: 'Link removed' });
    } catch (err: any) {
      return c.json({ error: 'Failed to remove link', code: 'REMOVE_LINK_ERROR' }, 500);
    }
  });

  // ─── SUPPLEMENTS ─────────────────────────────────────
  api.get('/:id/supplements', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const supplements = await db.prepare(`SELECT sr.*, u.full_name as created_by_name FROM supplemental_reports sr LEFT JOIN users u ON sr.created_by = u.id WHERE sr.incident_id = ? ORDER BY sr.created_at LIMIT 1000`).all(id);
      return c.json(supplements);
    } catch (err: any) {
      return c.json({ error: 'Failed to get supplements', code: 'GET_SUPPLEMENTS_ERROR' }, 500);
    }
  });

  api.post('/:id/supplements', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { content } = body;
      if (!content) return c.json({ error: 'content is required', code: 'CONTENT_IS_REQUIRED' }, 400);

      const result = await db.prepare("INSERT INTO supplemental_reports (incident_id, content, created_by) VALUES (?, ?, ?)").run(id, content, user.userId);
      const sup = await db.prepare('SELECT * FROM supplemental_reports WHERE id = ?').get(result.meta.last_row_id);
      return c.json(sup, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to create supplement', code: 'CREATE_SUPPLEMENT_ERROR' }, 500);
    }
  });

  api.put('/:id/supplements/:supId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const supId = paramNum(c.req.param('supId'));
      const body = await c.req.json();
      const { content } = body;

      const sets: string[] = [];
      const vals: any[] = [];
      if (content !== undefined) { sets.push('content = ?'); vals.push(content); }
      if (sets.length > 0) { vals.push(supId); await db.prepare(`UPDATE supplemental_reports SET ${sets.join(', ')} WHERE id = ? AND incident_id = ?`).run(...vals, id); }

      const updated = await db.prepare('SELECT * FROM supplemental_reports WHERE id = ?').get(supId);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ error: 'Failed to update supplement', code: 'UPDATE_SUPPLEMENT_ERROR' }, 500);
    }
  });

  api.delete('/:id/supplements/:supId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const supId = paramNum(c.req.param('supId'));
      await db.prepare('DELETE FROM supplemental_reports WHERE id = ? AND incident_id = ?').run(supId, id);
      return c.json({ message: 'Supplement deleted' });
    } catch (err: any) {
      return c.json({ error: 'Failed to delete supplement', code: 'DELETE_SUPPLEMENT_ERROR' }, 500);
    }
  });

  // ─── EVIDENCE ────────────────────────────────────────
  api.post('/:id/evidence', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { description, type, location_found, collected_by, chain_of_custody, storage_location, disposition } = body;

      const result = await db.prepare(`
        INSERT INTO evidence (incident_id, description, type, location_found, collected_by, chain_of_custody, storage_location, disposition, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collected', ?)
      `).run(id, description || null, type || null, location_found || null, collected_by || null, chain_of_custody || null, storage_location || null, disposition || null, user.userId);

      const ev = await db.prepare('SELECT * FROM evidence WHERE id = ?').get(result.meta.last_row_id);
      return c.json(ev, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to add evidence', code: 'ADD_EVIDENCE_ERROR' }, 500);
    }
  });

  // GET /api/incidents/stats
  api.get('/stats', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const [total, byStatus, byPriority, recent] = await Promise.all([
        db.prepare('SELECT COUNT(*) as count FROM incidents').get(),
        db.prepare('SELECT status, COUNT(*) as count FROM incidents GROUP BY status').all(),
        db.prepare('SELECT priority, COUNT(*) as count FROM incidents GROUP BY priority').all(),
        db.prepare("SELECT COUNT(*) as count FROM incidents WHERE created_at >= datetime('now','localtime','-7 days')").get(),
      ]);
      return c.json({
        total: (total as any)?.count || 0,
        by_status: byStatus,
        by_priority: byPriority,
        recent_7d: (recent as any)?.count || 0,
      });
    } catch { return c.json({ total: 0, by_status: [], by_priority: [], recent_7d: 0 }); }
  });

  // GET /api/incidents/stats
  api.get('/stats', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const [total, byStatus, byPriority, recent] = await Promise.all([
        db.prepare('SELECT COUNT(*) as count FROM incidents').get(),
        db.prepare('SELECT status, COUNT(*) as count FROM incidents GROUP BY status').all(),
        db.prepare('SELECT priority, COUNT(*) as count FROM incidents GROUP BY priority').all(),
        db.prepare("SELECT COUNT(*) as count FROM incidents WHERE created_at >= datetime('now','localtime','-7 days')").get(),
      ]);
      return c.json({
        total: (total as any)?.count || 0,
        by_status: byStatus,
        by_priority: byPriority,
        recent_7d: (recent as any)?.count || 0,
      });
    } catch { return c.json({ total: 0, by_status: [], by_priority: [], recent_7d: 0 }); }
  });

  app.route('/api/incidents', api);
}
