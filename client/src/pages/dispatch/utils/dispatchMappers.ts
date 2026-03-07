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
      assignedUnits = JSON.parse(row.assigned_unit_ids).map(String);
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
    section_id: row.section_id || undefined,
    zone_id: row.zone_id || undefined,
    beat_id: row.beat_id || undefined,
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
    // Damage
    damage_estimate: row.damage_estimate || undefined,
    damage_description: row.damage_description || undefined,
    // Resolution
    action_taken: row.action_taken || undefined,
    responding_officer: row.responding_officer || undefined,
    secondary_type: row.secondary_type || undefined,
    contact_method: row.contact_method || undefined,
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
    status: row.status || 'available',
    current_call_id: row.current_call_id ? String(row.current_call_id) : undefined,
    current_call_number: row.call_number || undefined,
    location: row.current_call_location || row.location || undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    vehicle: row.vehicle || undefined,
    last_status_change: row.last_status_change || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}
