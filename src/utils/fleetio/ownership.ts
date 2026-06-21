// ============================================================
// RMPG Flex — Fleet.io integration: field ownership map (PR 4)
// ============================================================
// Hard-coded TypeScript const. The integration spec rejects a D1-overridable
// rule store because: (a) policy-is-code matches every other rule in this
// codebase (route allowlists, role permissions); (b) git blame is the audit
// trail; (c) an admin-edited rule has no review gate. If churn ever exceeds
// ~2 edits/month, promote to D1 overrides at that point — not before.
//
// Three classes per field:
//   'rmpg'    — RMPG-owned. Outbound push always wins. An inbound update
//               for this field LOGS A CONFLICT and does NOT overwrite;
//               the caller may queue an outbound re-assertion of the
//               local value to push back to Fleet.io.
//   'fleetio' — Fleet.io-owned. Inbound updates always win. Outbound
//               pushes for this field are silently dropped (no error,
//               just not included in the PATCH payload).
//   'shared'  — Last-write-wins by `updated_at` timestamp. If both sides
//               changed within 60 seconds of each other, log
//               resolution='unresolved' and surface a conflict badge.
//
// Each map is namespaced by the local RMPG table since the same column
// name (e.g. `notes`) can mean different things across tables.
// ============================================================

export type OwnershipClass = 'rmpg' | 'fleetio' | 'shared';

/** Window inside which a `shared` field's concurrent edits are flagged unresolved. */
export const SHARED_CONFLICT_WINDOW_MS = 60_000;

// ─── Vehicle ────────────────────────────────────────────────

export const VEHICLE_OWNERSHIP: Record<string, OwnershipClass> = {
  // — RMPG-owned (dispatch / RMPG-internal context) —
  vehicle_name:          'rmpg',
  vehicle_number:        'rmpg',
  assigned_unit_id:      'rmpg',
  status:                'rmpg',
  current_mileage:       'rmpg',   // ClearPathGPS-fed; FI's PM engine reads this
  is_pursuit_rated:      'rmpg',
  is_take_home:          'rmpg',
  garage_location:       'rmpg',
  color:                 'rmpg',
  plate_state:           'rmpg',
  default_image_url:     'rmpg',

  // — Fleet.io-owned (FI's PM engine + watchlists compute these) —
  next_service_mileage:  'fleetio',
  next_service_date:     'fleetio',
  warranty_expiry_date:  'fleetio',
  watch_list:            'fleetio',

  // — Shared (last-write-wins by updated_at, 60-s unresolved window) —
  vin:                   'shared',
  make:                  'shared',
  model:                 'shared',
  year:                  'shared',
  plate_number:          'shared',
  body_type:             'shared',
  fuel_type_id:          'shared',
  primary_meter_unit:    'shared',
  tire_size_id:          'shared',
  oil_type_id:           'shared',
  oil_capacity_qts:      'shared',
  coolant_capacity_qts:  'shared',
  gvwr_lbs:              'shared',
  fuel_volume_units:     'shared',
  secondary_meter_value: 'shared',
  secondary_meter_unit:  'shared',
  secondary_meter_label: 'shared',
};

// ─── Fuel entry ────────────────────────────────────────────

export const FUEL_OWNERSHIP: Record<string, OwnershipClass> = {
  // — RMPG-owned (RMPG's operational context + device capture) —
  vehicle_id:            'rmpg',
  fuel_date:             'rmpg',
  driver_id:             'rmpg',
  driver_name:           'rmpg',
  geo_lat:               'rmpg',
  geo_lng:               'rmpg',
  receipt_r2_key:        'rmpg',
  comments:              'rmpg',
  // — Shared —
  gallons:               'shared',
  total_cost:            'shared',
  cost_per_gallon:       'shared',
  odometer:              'shared',
  fuel_grade:            'shared',
  fuel_type:             'shared',
  vendor_id:             'shared',
  reference_number:      'shared',
  is_partial_fillup:     'shared',
  is_full_tank:          'shared',
  station:               'shared',
  notes:                 'shared',
  // — Fleet.io-owned —
  // (none — Fleet.io's fuel records are inbound-shared only; this row is here
  // as documentation that the absence is intentional, not an oversight.)
};

// ─── Work order (PR 5) ─────────────────────────────────────

export const WORK_ORDER_OWNERSHIP: Record<string, OwnershipClass> = {
  // — RMPG-owned (operational context lives here) —
  vehicle_id:           'rmpg',
  category_code:        'rmpg',
  assigned_to_user_id:  'rmpg',
  odometer_at_open:     'rmpg',   // ClearPathGPS-fed
  odometer_at_close:    'rmpg',
  created_by:           'rmpg',

  // — Shared (last-write-wins; either side can edit) —
  status:               'shared',
  number:               'shared',
  opened_at:            'shared',
  closed_at:            'shared',
  summary:              'shared',
  vendor_id:            'shared',
  est_cost:             'shared',
  actual_cost:          'shared',
  vmrs_system_code:     'shared',
  vmrs_assembly_code:   'shared',
  vmrs_component_code:  'shared',
  notes:                'shared',
  custom_fields_json:   'shared',

  // — Fleet.io-owned (FI's automation generates these) —
  // (none today; PR 9 may add an inferred-priority field that's fleetio-owned.)
};

// ─── Lookup helpers (pure) ─────────────────────────────────

const RESOURCE_TO_MAP: Record<string, Record<string, OwnershipClass>> = {
  vehicle:    VEHICLE_OWNERSHIP,
  fuel_entry: FUEL_OWNERSHIP,
  work_order: WORK_ORDER_OWNERSHIP,
};

/**
 * Return the ownership class for a resource:field, or null if the field is
 * not in the map. Callers MUST treat null as 'shared' but also surface
 * `unknown_field` in the conflict log so the maintainer knows to extend the map.
 */
export function getOwnership(resource: string, field: string): OwnershipClass | null {
  const map = RESOURCE_TO_MAP[resource];
  if (!map) return null;
  return Object.prototype.hasOwnProperty.call(map, field) ? map[field] : null;
}

/**
 * For an outbound PATCH, the set of fields we may include in the payload —
 * everything except `fleetio`-owned fields (whose values we never push).
 */
export function outboundFieldFilter(resource: string, fields: Iterable<string>): string[] {
  const map = RESOURCE_TO_MAP[resource];
  if (!map) return Array.from(fields);
  const out: string[] = [];
  for (const f of fields) {
    if (map[f] !== 'fleetio') out.push(f);
  }
  return out;
}

/**
 * For an inbound update, partition the fields by what the sync engine should do:
 *   - apply: 'fleetio'-owned (always overwrite) + 'shared' (last-write-wins;
 *            the caller decides per the timestamps).
 *   - conflict: 'rmpg'-owned (DO NOT overwrite; log + queue re-assertion).
 *   - unknown: not in the map (caller decides — see getOwnership doc).
 */
export function partitionInboundFields(
  resource: string,
  fields: Iterable<string>,
): { apply: string[]; conflict: string[]; unknown: string[] } {
  const apply: string[] = [];
  const conflict: string[] = [];
  const unknown: string[] = [];
  for (const f of fields) {
    const klass = getOwnership(resource, f);
    if (klass === null) unknown.push(f);
    else if (klass === 'rmpg') conflict.push(f);
    else apply.push(f);
  }
  return { apply, conflict, unknown };
}

/**
 * For a `shared` field where both sides changed near simultaneously,
 * determine whether the two timestamps are inside the unresolved window.
 *
 * Returns:
 *   'unresolved' — both edits within SHARED_CONFLICT_WINDOW_MS; caller logs
 *                  resolution='unresolved' and (per spec) applies REMOTE
 *                  as the default + surfaces the conflict badge.
 *   'remote_wins' — remote is strictly newer than local.
 *   'local_wins'  — local is strictly newer than remote (or equal).
 */
export function resolveSharedConflict(
  localUpdatedAtMs: number,
  remoteUpdatedAtMs: number,
  windowMs: number = SHARED_CONFLICT_WINDOW_MS,
): 'unresolved' | 'remote_wins' | 'local_wins' {
  const delta = Math.abs(remoteUpdatedAtMs - localUpdatedAtMs);
  if (delta <= windowMs) return 'unresolved';
  return remoteUpdatedAtMs > localUpdatedAtMs ? 'remote_wins' : 'local_wins';
}
