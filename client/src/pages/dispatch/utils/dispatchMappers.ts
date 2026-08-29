// ============================================================
// Dispatch Page — DB Row Mappers
// Convert raw backend DB rows into typed frontend objects.
// ============================================================

import type { CallForService, Unit, CallNote } from '../../../types';
import { TERMINAL_STATUSES } from './dispatchConstants';

/**
 * True when a backend response actually looks like a full calls_for_service
 * row, as opposed to a bare acknowledgement body like {message, ...} or
 * {error, ...}.
 *
 * WHY THIS EXISTS — every "replace the selected call with the server response"
 * path runs the body through mapDbCall() and stuffs the result back into
 * dispatch state. mapDbCall() defaults a row with no `id` to id:"undefined"
 * and incident_type:"other", so feeding it a non-row body produces a blank
 * 'Other' call that *wipes the real call out of the UI*. This has bitten us
 * twice — the timeline-edit PUT ("editing time destructs the call") and the
 * assign-unit endpoint ("attaching a unit destroys the dispatch"). Guard every
 * replace-with-response path with this so a future partial/error response can
 * never destroy a good call again.
 */
export function looksLikeCallRow(row: any): boolean {
  return !!row && typeof row === 'object'
    && row.id != null
    && (row.incident_type != null || row.call_number != null);
}

/**
 * Map a raw calls_for_service DB row to a CallForService frontend object.
 */
/**
 * Merge a partial call update into an existing CallForService, preserving
 * fields the update source doesn't carry (e.g. ext-table PSO/process fields
 * absent from the list endpoint or WS broadcasts). Only keys present in the
 * raw source row overwrite; absent keys keep the prior value.
 */
export function mergeCallUpdate(prev: CallForService, rawRow: any): CallForService {
  const incoming = mapDbCall(rawRow);
  const sourceKeys = new Set(Object.keys(rawRow || {}));
  const merged = { ...prev };
  for (const key of Object.keys(incoming) as (keyof CallForService)[]) {
    if (sourceKeys.has(key) || sourceKeys.has(fieldSourceMap[key] ?? '')) {
      (merged as any)[key] = incoming[key];
    }
    // Any other shape (object, number, etc.) is silently dropped — better an
    // empty notes panel than a hard crash.
  }
  if (sourceKeys.has('status')) merged.status = incoming.status;
  if (sourceKeys.has('updated_at')) merged.updated_at = incoming.updated_at;
  return merged;
}

const fieldSourceMap: Record<string, string> = {
  location: 'location_address',
  created_by: 'dispatcher_name',
};

export function mapDbCall(row: any): CallForService {
  // Notes: backend stores as single string; we parse or wrap.
  // Defensive: handle the case where row.notes is already an array (e.g. a
  // pre-mapped call passed through mapDbCall again via a websocket re-map).
  // Without this guard, JSON.parse(array) throws, the catch fallback puts the
  // whole array into the `text` field, and the renderer eventually tries to
  // render a CallNote object as a JSX child → React error #31.
  let notes: CallNote[] = [];
  if (row.notes) {
    if (Array.isArray(row.notes)) {
      notes = row.notes as CallNote[];
    } else if (typeof row.notes === 'string') {
      try {
        const parsed = JSON.parse(row.notes);
        if (Array.isArray(parsed)) notes = parsed;
        else notes = [{ id: '1', author: 'System', text: row.notes, timestamp: row.created_at }];
      } catch {
        notes = [{ id: '1', author: 'System', text: row.notes, timestamp: row.created_at }];
      }
    }
    // Any other shape (object, number, etc.) is silently dropped — better an
    // empty notes panel than a hard crash.
  }

  // assigned_unit_ids (JSON array of numeric unit IDs) -> assigned_units as
  // stringified IDs. NOTE: these are unit IDs, not call signs — the UI resolves
  // them to call signs separately against the units list.
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
    // Hold is stored server-side as calls_for_service_ext.held_at, NOT a status
    // enum — the live `status` CHECK constraint has no 'on_hold' value (see
    // src/routes/dispatch/calls.ts /:id/hold). The entire dispatch UI keys "held"
    // off status === 'on_hold', so synthesize it here from held_at while the call
    // is still active. A terminal call (cleared/closed/cancelled/archived) keeps
    // its real status even if a stale held_at lingers.
    status: (row.held_at && !TERMINAL_STATUSES.has(row.status))
      ? 'on_hold'
      : (row.status || 'pending'),
    caller_name: row.caller_name || undefined,
    caller_phone: row.caller_phone || undefined,
    caller_relationship: row.caller_relationship || undefined,
    caller_address: row.caller_address || undefined,
    location: row.location_address || row.location || '',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    property_id: row.property_id ? String(row.property_id) : undefined,
    property_name: row.property_name || undefined,
    // Premise intel joined from the linked property (GET /dispatch/calls/:id).
    // Surfaced to the PSO in the Info tab so post-orders / hazard warnings on
    // the address are visible before arrival.
    property_address: row.property_address || undefined,
    gate_code: row.gate_code || undefined,
    post_orders: row.post_orders || undefined,
    hazard_notes: row.hazard_notes || undefined,
    client_id: row.client_id ? String(row.client_id) : undefined,
    client_name: row.client_name || undefined,
    // Authoritative contracting-client fields (from the clients JOIN) — used by
    // the PSO Notice of Communication so the addressee + service type come from
    // the client record rather than the (inconsistent) call-level caller block.
    client_contact_name: row.client_contact_name || undefined,
    client_phone: row.client_phone || undefined,
    client_address: row.client_address || undefined,
    client_industry: row.client_industry || undefined,
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
    weather_snapshot: (() => {
      const raw = row.weather_snapshot;
      if (!raw) return undefined;
      if (typeof raw === 'object') return raw;
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return undefined; }
      }
      return undefined;
    })(),
    weather_manual: !!row.weather_manual,
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
    // Explicit Number() conversion guards against SQLite returning "0" as a string,
    // which would be truthy in JS comparisons and break the "No process service
    // details entered yet" conditional.
    process_attempts: row.process_attempts != null ? Number(row.process_attempts) : undefined,
    process_served_at: row.process_served_at || undefined,
    process_service_result: row.process_service_result || undefined,
    court_name: row.court_name || undefined,
    attorney_name: row.attorney_name || undefined,
    plaintiff_name: row.plaintiff_name || undefined,
    jurisdiction: row.jurisdiction || undefined,
    deadline: row.deadline || undefined,
    time_window: row.time_window || undefined,
    service_instructions: row.service_instructions || undefined,
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
    created_by: row.dispatcher_name || (row.dispatcher_id ? String(row.dispatcher_id) : ''),
    dispatcher_name: row.dispatcher_name || undefined,
    updated_at: row.updated_at || '',
    // Visit history (PSO calls — attached by GET /calls/:id and redispatch)
    visit_history: row.visit_history || undefined,
    // Linked serve job. mapDbCall builds an explicit object rather than
    // spreading the row, so an unmapped field is DROPPED — which is why
    // the call report's recipient QR never appeared even though both the
    // server and the PDF generator knew about serve_queue_id. The gap was
    // here, in the middle.
    serve_queue_id: row.serve_queue_id ?? undefined,
    // Pinned-to-top flag (sticky at top of dispatcher's call list)
    pinned: row.pinned ? 1 : 0,
    pso_72hr_deadline: row.pso_72hr_deadline || undefined,
    pso_72hr_notified: row.pso_72hr_notified || undefined,
    case_id: row.case_id ?? undefined,
    parent_call_id: row.parent_call_id ?? undefined,
    parent_call: row.parent_call || undefined,
    child_calls: row.child_calls || undefined,
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
    queued_call_ids: (() => {
      const raw = row.queued_call_ids;
      if (Array.isArray(raw)) return raw.map(Number);
      if (typeof raw === 'string' && raw.trim()) {
        try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(Number) : []; } catch { return []; }
      }
      return [];
    })(),
    // GET /dispatch/units aliases the joined call number as current_call_number
    // (`c.call_number AS current_call_number`); reading row.call_number left the
    // board's Assignment column permanently blank. Keep call_number as a fallback.
    current_call_number: row.current_call_number || row.call_number || undefined,
    location: row.current_call_location || row.location || undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    vehicle: row.vehicle || row.vehicle_id || undefined,
    // Setup fields. capabilities is a JSON-text column — parse defensively to
    // an array so the edit modal can pre-fill the multi-select.
    capabilities: (() => {
      const raw = row.capabilities;
      if (Array.isArray(raw)) return raw.map(String);
      if (typeof raw === 'string' && raw.trim()) {
        try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : []; } catch { return []; }
      }
      return [];
    })(),
    assigned_beat: row.assigned_beat || undefined,
    audio_mode: row.audio_mode || undefined,
    last_status_change: row.last_status_change || '',
    // Spillman EMERGENCY overlay — drives the flashing-red Status Monitor row
    // + map treatment. Normalized to a 0/1 number so isEmergency() is simple.
    emergency_active: row.emergency_active ? 1 : 0,
    emergency_call_id: row.emergency_call_id ?? null,
    emergency_since: row.emergency_since ?? null,
    camera_device_id: row.camera_device_id ?? null,
    camera_ignition_state: row.camera_ignition_state ?? null,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}
