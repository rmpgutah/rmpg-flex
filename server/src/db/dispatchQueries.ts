import { getDb } from '../models/database';
import type { CreateDispatchCallInput, DispatchCallFilters, DispatchCallRecord } from '../types/dispatch';

type SqlParam = string | number;

interface WhereClause {
  whereClause: string;
  params: SqlParam[];
}

interface InsertDispatchCallInput extends CreateDispatchCallInput {
  call_number: string;
  status: string;
  dispatcher_id: number;
  zone_beat?: string | null;
  section_id?: string | null;
  zone_id?: string | null;
  beat_id?: string | null;
  dispatch_code?: string | null;
  section_name?: string | null;
  zone_name?: string | null;
  beat_name?: string | null;
  beat_descriptor?: string | null;
  created_at_value?: string | null;
  historical_fallback_created_at: string;
  dispatched_at?: string | null;
  enroute_at?: string | null;
  onscene_at?: string | null;
  cleared_at?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
  disposition?: string | null;
}

export function buildCallsWhereClause(filters: DispatchCallFilters): WhereClause {
  let whereClause = 'WHERE 1=1';
  const params: SqlParam[] = [];

  if (filters.status) {
    whereClause += ' AND c.status = ?';
    params.push(filters.status);
  }
  if (filters.priority) {
    whereClause += ' AND c.priority = ?';
    params.push(filters.priority);
  }
  if (filters.startDate) {
    whereClause += ' AND c.created_at >= ?';
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    whereClause += ' AND c.created_at <= ?';
    params.push(filters.endDate);
  }
  if (filters.propertyId) {
    whereClause += ' AND c.property_id = ?';
    params.push(filters.propertyId);
  }

  if (filters.archived === 'true') {
    whereClause += " AND c.status = 'archived'";
  } else if (filters.archived !== 'all') {
    whereClause += " AND c.status != 'archived'";
  }

  return { whereClause, params };
}

export function countCalls(filters: DispatchCallFilters): number {
  const db = getDb();
  const { whereClause, params } = buildCallsWhereClause(filters);
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM calls_for_service c ${whereClause}`).get(...params) as { total: number };
  return countRow.total;
}

export function listCalls(filters: DispatchCallFilters): DispatchCallRecord[] {
  const db = getDb();
  const { whereClause, params } = buildCallsWhereClause(filters);
  const offset = (filters.page - 1) * filters.limit;
  const orderBy = filters.archived === 'true'
    ? 'c.call_number DESC'
    : "CASE c.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END, c.created_at DESC";

  return db.prepare(`
    SELECT c.*, p.name as property_name, u.full_name as dispatcher_name,
      cl.name as client_name
    FROM calls_for_service c
    LEFT JOIN properties p ON c.property_id = p.id
    LEFT JOIN users u ON c.dispatcher_id = u.id
    LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, filters.limit, offset) as DispatchCallRecord[];
}

export function getPropertyClientId(propertyId: number): number | null {
  const db = getDb();
  const prop = db.prepare('SELECT client_id FROM properties WHERE id = ?').get(propertyId) as { client_id: number | null } | undefined;
  return prop?.client_id ?? null;
}

export function getDispatchDistrict(cityCode: string, districtLetter: string): Record<string, unknown> | null {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
  ).get(cityCode, districtLetter) as Record<string, unknown> | undefined ?? null;
}

export function insertCall(input: InsertDispatchCallInput): number {
  const db = getDb();
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
    input.call_number, input.incident_type, input.priority, input.status, input.caller_name || null, input.caller_phone || null,
    input.caller_relationship || null, input.caller_address || null, input.location_address, input.property_id || null,
    input.latitude || null, input.longitude || null, input.description || null, input.notes || null,
    input.source || 'phone', input.dispatcher_id,
    input.cross_street || null, input.location_building || null, input.location_floor || null, input.location_room || null, input.zone_beat || null,
    input.section_id || null, input.zone_id || null, input.beat_id || null, input.dispatch_code || null,
    input.section_name || null, input.zone_name || null, input.beat_name || null, input.beat_descriptor || null,
    input.weapons_involved || null, input.injuries_reported ? 1 : 0, input.num_subjects || null, input.num_victims || null,
    input.subject_description || null, input.vehicle_description || null, input.direction_of_travel || null,
    input.scene_safety || null, input.weather_conditions || null, input.lighting_conditions || null,
    input.alcohol_involved ? 1 : 0, input.drugs_involved ? 1 : 0, input.domestic_violence ? 1 : 0,
    input.supervisor_notified ? 1 : 0, input.le_notified ? 1 : 0, input.le_agency || null, input.le_case_number || null,
    input.damage_estimate || null, input.damage_description || null, input.responding_officer || null, input.action_taken || null,
    input.mental_health_crisis ? 1 : 0, input.juvenile_involved ? 1 : 0, input.felony_in_progress ? 1 : 0, input.officer_safety_caution ? 1 : 0,
    input.k9_requested ? 1 : 0, input.ems_requested ? 1 : 0, input.fire_requested ? 1 : 0, input.hazmat ? 1 : 0,
    input.gang_related ? 1 : 0, input.evidence_collected ? 1 : 0, input.body_camera_active ? 1 : 0, input.photos_taken ? 1 : 0,
    input.trespass_issued ? 1 : 0, input.vehicle_pursuit ? 1 : 0, input.foot_pursuit ? 1 : 0,
    input.pso_service_type || null, input.pso_authorization || null, input.pso_requestor_name || null,
    input.pso_requestor_phone || null, input.pso_requestor_email || null, input.pso_billing_code || null,
    input.process_service_type || null, input.process_served_to || null, input.process_served_address || null,
    input.contract_id || null, input.client_id || null,
    input.created_at_value || null,
    input.historical_fallback_created_at,
    input.dispatched_at || null, input.enroute_at || null, input.onscene_at || null,
    input.cleared_at || null, input.closed_at || null, input.archived_at || null,
    input.disposition || null,
  );

  return Number(result.lastInsertRowid);
}

export function getCallById(id: number): DispatchCallRecord | null {
  const db = getDb();
  return db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(id) as DispatchCallRecord | undefined ?? null;
}

export function insertCallActivityLog(userId: number, callId: number, details: string, ipAddress: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
    VALUES (?, 'call_created', 'call', ?, ?, ?)
  `).run(userId, callId, details, ipAddress);
}

export function updateCallRiskScore(callId: number, riskScore: number): void {
  const db = getDb();
  db.prepare('UPDATE calls_for_service SET risk_score = ? WHERE id = ?').run(riskScore, callId);
}

export function getActiveSupervisorIds(): number[] {
  const db = getDb();
  return (db.prepare(
    "SELECT id FROM users WHERE role IN ('admin', 'supervisor') AND status = 'active'"
  ).all() as Array<{ id: number }>).map((row) => row.id);
}
