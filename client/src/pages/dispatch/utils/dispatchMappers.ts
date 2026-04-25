// ============================================================
// Dispatch Page — DB Row Mappers
// Convert raw backend DB rows into typed frontend objects.
// ============================================================

import type { CallForService, Unit, CallNote } from '../../../types';

/**
 * Map a raw calls_for_service DB row to a CallForService frontend object.
 */
export function mapDbCall(row: any): CallForService {
  // Notes: backend stores as single string; we parse or wrap
  let notes: CallNote[] = [];
  if (row.notes) {
    try {
      const parsed = JSON.parse(row.notes);
      if (Array.isArray(parsed)) notes = parsed;
      else notes = [{ id: '1', author: 'System', text: row.notes, timestamp: row.created_at }];
    } catch {
      notes = [{ id: '1', author: 'System', text: row.notes, timestamp: row.created_at }];
    }
  }

  // assigned_unit_ids -> assigned_units (call signs)
  let assignedUnits: string[] = [];
  if (row.assigned_unit_ids) {
    try {
      const parsed = JSON.parse(row.assigned_unit_ids);
      assignedUnits = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch { /* ignore */ }
  }

  return {
    id: String(row.id),
    call_number: row.call_number || '',
    incident_type: row.incident_type || 'other',
    priority: row.priority || 'P3',
    status: row.status || 'pending',
    caller_name: row.caller_name || undefined,
    caller_phone: row.caller_phone || undefined,
    caller_relationship: row.caller_relationship || undefined,
    caller_address: row.caller_address || undefined,
    location: row.location_address || row.location || '',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    property_id: row.property_id ? String(row.property_id) : undefined,
    property_name: row.property_name || undefined,
    client_id: row.client_id ? String(row.client_id) : undefined,
    client_name: row.client_name || undefined,
    description: row.description || '',
    source: row.source || 'phone',
    assigned_units: assignedUnits,
    notes,
    disposition: row.disposition || undefined,
    // Location details
    cross_street: row.cross_street || undefined,
    location_building: row.location_building || undefined,
    location_floor: row.location_floor || undefined,
    location_room: row.location_room || undefined,
    zone_beat: row.zone_beat || undefined,
    sector_id: row.sector_id || undefined,
    zone_id: row.zone_id || undefined,
    beat_id: row.beat_id || undefined,
    // Dispatch district data
    dispatch_code: row.dispatch_code || undefined,
    sector_name: row.sector_name || undefined,
    zone_name: row.zone_name || undefined,
    beat_name: row.beat_name || undefined,
    beat_descriptor: row.beat_descriptor || undefined,
    // Contract ID
    contract_id: row.contract_id || undefined,
    // PSO Client Request fields
    pso_requestor_name: row.pso_requestor_name || undefined,
    pso_requestor_phone: row.pso_requestor_phone || undefined,
    pso_requestor_email: row.pso_requestor_email || undefined,
    pso_service_type: row.pso_service_type || undefined,
    pso_billing_code: row.pso_billing_code || undefined,
    pso_authorization: row.pso_authorization || undefined,
    pso_attempt_number: row.pso_attempt_number || undefined,
    pso_service_windows: row.pso_service_windows
      ? (() => { try { return JSON.parse(row.pso_service_windows); } catch { return undefined; } })()
      : undefined,
    // Subject/threat info
    weapons_involved: row.weapons_involved || undefined,
    injuries_reported: !!row.injuries_reported,
    num_subjects: row.num_subjects || undefined,
    num_victims: row.num_victims || undefined,
    subject_description: row.subject_description || undefined,
    vehicle_description: row.vehicle_description || undefined,
    direction_of_travel: row.direction_of_travel || undefined,
    // Scene details
    scene_safety: row.scene_safety || undefined,
    weather_conditions: row.weather_conditions || undefined,
    lighting_conditions: row.lighting_conditions || undefined,
    // Flags
    alcohol_involved: !!row.alcohol_involved,
    drugs_involved: !!row.drugs_involved,
    domestic_violence: !!row.domestic_violence,
    supervisor_notified: !!row.supervisor_notified,
    le_notified: !!row.le_notified,
    le_agency: row.le_agency || undefined,
    le_case_number: row.le_case_number || undefined,
    case_number: row.case_number || undefined,
    incident_number: row.incident_number || undefined,
    // Additional operational flags
    mental_health_crisis: !!row.mental_health_crisis,
    juvenile_involved: !!row.juvenile_involved,
    felony_in_progress: !!row.felony_in_progress,
    officer_safety_caution: !!row.officer_safety_caution,
    k9_requested: !!row.k9_requested,
    ems_requested: !!row.ems_requested,
    fire_requested: !!row.fire_requested,
    hazmat: !!row.hazmat,
    gang_related: !!row.gang_related,
    evidence_collected: !!row.evidence_collected,
    body_camera_active: !!row.body_camera_active,
    photos_taken: !!row.photos_taken,
    trespass_issued: !!row.trespass_issued,
    vehicle_pursuit: !!row.vehicle_pursuit,
    foot_pursuit: !!row.foot_pursuit,
    // Process Service fields
    process_service_type: row.process_service_type || undefined,
    process_served_to: row.process_served_to || undefined,
    process_served_address: row.process_served_address || undefined,
    process_attempts: row.process_attempts ?? undefined,
    process_served_at: row.process_served_at || undefined,
    process_service_result: row.process_service_result || undefined,
    // Damage
    damage_estimate: row.damage_estimate ?? undefined,
    damage_description: row.damage_description || undefined,
    // Resolution
    action_taken: row.action_taken || undefined,
    responding_officer: row.responding_officer || undefined,
    secondary_type: row.secondary_type || undefined,
    contact_method: row.contact_method || undefined,
    // Mileage
    starting_mileage: row.starting_mileage ?? undefined,
    ending_mileage: row.ending_mileage ?? undefined,
    responding_vehicle_id: row.responding_vehicle_id || undefined,
    // Timestamps
    created_at: row.created_at || '',
    dispatched_at: row.dispatched_at || undefined,
    enroute_at: row.enroute_at || undefined,
    onscene_at: row.onscene_at || undefined,
    cleared_at: row.cleared_at || undefined,
    closed_at: row.closed_at || undefined,
    archived_at: row.archived_at || undefined,
    created_by: row.dispatcher_id ? String(row.dispatcher_id) : '',
    updated_at: row.updated_at || '',
    // Visit history (PSO calls — attached by GET /calls/:id and redispatch)
    visit_history: row.visit_history || undefined,
    // Pinned-to-top flag (sticky at top of dispatcher's call list)
    pinned: row.pinned ? 1 : 0,
  };
}

/**
 * Map a raw units DB row to a Unit frontend object.
 */
export function mapDbUnit(row: any): Unit {
  return {
    id: String(row.id),
    call_sign: row.call_sign || '',
    officer_id: row.officer_id ? String(row.officer_id) : '',
    officer_name: row.officer_name || '',
    badge_number: row.badge_number || undefined,
    status: row.status || 'available',
    current_call_id: row.current_call_id ? String(row.current_call_id) : undefined,
    current_call_number: row.call_number || undefined,
    location: row.current_call_location || row.location || undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    vehicle: row.vehicle || row.vehicle_id || undefined,
    last_status_change: row.last_status_change || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}
