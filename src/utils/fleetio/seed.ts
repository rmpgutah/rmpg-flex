// ============================================================
// RMPG Flex — Fleet.io integration: seed payload mapper
// ============================================================
// Pure function: maps an RMPG `fleet_vehicles` row to a Fleet.io
// `vehicles.create` payload. Splits data-shape concerns from the
// route handler so we can evolve the mapping as PR 3 adds columns.
// ============================================================

import type { FleetioVehicleCreatePayload, RmpgFleetVehicleRow } from './types';

/** Returns null when the row has no derivable name — caller should skip it. */
export function buildVehiclePayload(row: RmpgFleetVehicleRow): FleetioVehicleCreatePayload | null {
  const name = deriveName(row);
  if (!name) return null;

  // Fleet.io marks primary_meter_unit REQUIRED on create. Confirmed live
  // 2026-07-29 (docs/fleetio-api-reference.md) that mapVehicleFieldsToFleetio
  // and this function never sent it. Safe to default to 'mi': RMPG operates
  // US-only fleets, and Fleet.io's own enum is km/hr/mi — no account-specific
  // lookup needed, unlike vehicle_status_id/vehicle_type_id (also required,
  // but Fleet.io account-configured ids RMPG's D1 has no record of — those
  // are deliberately NOT defaulted; see the audit note on this).
  const payload: FleetioVehicleCreatePayload = { name, primary_meter_unit: 'mi' };

  if (row.vin) payload.vin = row.vin;
  if (row.plate_number) payload.license_plate = row.plate_number;
  if (row.year !== undefined) payload.year = row.year ?? null;
  if (row.make) payload.make = row.make;
  if (row.model) payload.model = row.model;
  if (row.color) payload.color = row.color;

  return payload;
}

function deriveName(row: RmpgFleetVehicleRow): string | null {
  if (row.vehicle_name && row.vehicle_name.trim()) return row.vehicle_name.trim();
  if (row.vehicle_number && row.vehicle_number.trim()) return row.vehicle_number.trim();
  if (row.vin && row.vin.trim()) return `VIN ${row.vin.trim()}`;
  return null;
}

// ============================================================
// Outbound event-queue mapper (dispatchOutbound in sync.ts)
// ============================================================
// buildVehiclePayload above only runs on the /seed route's own query
// (which SELECTs just the columns it needs). Every OTHER outbound vehicle
// event — queued via emitFleetioEvent from fleet.ts's create/update routes
// — carries the FULL `fleet_vehicles` row (all ~90 RMPG-internal columns:
// total_maintenance_cost, lienholder, equipment JSON, etc.) because that's
// what `SELECT * FROM fleet_vehicles WHERE id = ?` returns. dispatchOutbound
// was sending that raw row straight to Fleet.io's PATCH /vehicles/:id — RMPG
// column names Fleet.io doesn't recognize (vehicle_name vs. name,
// plate_number vs. license_plate) plus dozens of fields with no Fleet.io
// equivalent, which Fleet.io rejects with 422. Confirmed live 2026-07-23:
// every vehicle/update event in fleetio_events had status='failed',
// error='Fleet.io 422', attempts=7 (retries exhausted).
//
// This maps the SAME known-good field set as buildVehiclePayload, but from
// a generic Record (the parsed event payload) rather than a typed row, so
// dispatchOutbound can reuse it for both vehicle.create and vehicle.update
// events pulled off the queue.
//
// `isCreate` gates `primary_meter_unit: 'mi'` (required on create, see
// buildVehiclePayload's comment for why 'mi' is safe to default). It is
// deliberately NOT sent on update: unlike create, an update call fires on
// every unrelated field change (e.g. color), and forcing meter_unit on
// every one of those risks silently overwriting a value an operator set
// directly in Fleet.io's own UI — a real config change, not a
// missing-required-field bug like create's.
export function mapVehicleFieldsToFleetio(payload: Record<string, unknown>, isCreate = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const name = deriveNameFromRecord(payload);
  if (name) out.name = name;
  if (isNonEmptyString(payload.vin)) out.vin = payload.vin;
  if (isNonEmptyString(payload.plate_number)) out.license_plate = payload.plate_number;
  if (payload.year !== undefined) out.year = payload.year;
  if (isNonEmptyString(payload.make)) out.make = payload.make;
  if (isNonEmptyString(payload.model)) out.model = payload.model;
  if (isNonEmptyString(payload.color)) out.color = payload.color;
  if (isCreate) out.primary_meter_unit = 'mi';
  return out;
}

function deriveNameFromRecord(payload: Record<string, unknown>): string | null {
  if (isNonEmptyString(payload.vehicle_name)) return (payload.vehicle_name as string).trim();
  if (isNonEmptyString(payload.vehicle_number)) return (payload.vehicle_number as string).trim();
  if (isNonEmptyString(payload.vin)) return `VIN ${(payload.vin as string).trim()}`;
  return null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// Fleet.io's fuel_entries fields (per FleetioFuelEntry in client.ts, grounded
// against the API response shape) don't match RMPG's fleet_fuel_log columns
// either — `date`/`us_gallons`/`cost` vs. `fuel_date`/`gallons`/`total_cost`.
// Same class of bug as the vehicle mapper above; confirmed live 2026-07-23
// (fuel_entry/create event id=9, Fleet.io 422, attempts=7). `vehicle_id` is
// left untouched here — translateOutboundFks in sync.ts already rewrites its
// VALUE from the RMPG id to the Fleet.io id; the field NAME already matches.
export function mapFuelEntryFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (payload.vehicle_id !== undefined) out.vehicle_id = payload.vehicle_id;
  if (isNonEmptyString(payload.fuel_date)) out.date = payload.fuel_date;
  if (typeof payload.gallons === 'number') out.us_gallons = payload.gallons;
  // Fleet.io has no `cost` field — POST /fuel_entries takes a per-unit price
  // (`price_per_volume_unit`), not a total. `cost` was silently ignored, but
  // `meter_entry_attributes` is REQUIRED (developer.fleetio.com/reference/
  // create-fuel-entry, confirmed 2026-07-29) and its absence — not the bogus
  // `cost` field — is what caused the live 422 (fuel_entry/create event
  // id=9). Fleet.io's own example sends the meter value as a string.
  if (typeof payload.cost_per_gallon === 'number') out.price_per_volume_unit = payload.cost_per_gallon;
  if (typeof payload.odometer === 'number') {
    out.meter_entry_attributes = { value: String(payload.odometer) };
  }
  return out;
}

// Vendor/part payloads used to flow through dispatchOutbound's implicit
// ownership-filter pass-through (VENDOR_OWNERSHIP/PART_OWNERSHIP in
// ownership.ts) on the (wrong) assumption that RMPG's column names already
// matched Fleet.io's vendors/parts resources. They don't: confirmed live
// 2026-07-29 against developer.fleetio.com/reference/create-vendor and
// create-part — `address`/`state`/`zip`/`email` aren't Fleet.io fields at
// all (correct names: `street_address`/`region`/`postal_code`/
// `contact_email`), and Parts has no `name`/`part_number`/`category`/
// `supplier` fields either (correct: `number`/`part_category_name`/
// `part_manufacturer_name`; RMPG's `name` has no Fleet.io equivalent —
// Parts are identified by `number`, not a display name). Both mappers were
// silently dropping 4 of their fields on every sync.
export function mapVendorFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (isNonEmptyString(payload.name)) out.name = payload.name;
  if (isNonEmptyString(payload.address)) out.street_address = payload.address;
  if (isNonEmptyString(payload.city)) out.city = payload.city;
  if (isNonEmptyString(payload.state)) out.region = payload.state;
  if (isNonEmptyString(payload.zip)) out.postal_code = payload.zip;
  if (isNonEmptyString(payload.phone)) out.phone = payload.phone;
  if (isNonEmptyString(payload.email)) out.contact_email = payload.email;
  return out;
}

export function mapPartFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (isNonEmptyString(payload.part_number)) out.number = payload.part_number;
  if (isNonEmptyString(payload.category)) out.part_category_name = payload.category;
  if (isNonEmptyString(payload.description)) out.description = payload.description;
  if (isNonEmptyString(payload.supplier)) out.part_manufacturer_name = payload.supplier;
  if (typeof payload.unit_cost === 'number') out.unit_cost = payload.unit_cost;
  return out;
}

// Work orders had NO mapper at all — dispatchOutbound sent the raw RMPG
// `work_orders` row straight through. Confirmed live 2026-07-29 against
// developer.fleetio.com/reference/create-work-order: RMPG's `opened_at`
// isn't recognized and Fleet.io's REQUIRED create field `issued_at` was
// never sent, so every work_order.create dispatch should 422. 16 of 19
// RMPG columns had no Fleet.io equivalent; see docs/fleetio-api-reference.md
// for the full field-by-field mapping this was built from. `vehicle_id`/
// `vendor_id` are left untouched — translateOutboundFks in sync.ts already
// rewrites their VALUE from the RMPG id to the Fleet.io id.
export function mapWorkOrderFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (payload.vehicle_id !== undefined) out.vehicle_id = payload.vehicle_id;
  if (payload.vendor_id !== undefined) out.vendor_id = payload.vendor_id;
  if (isNonEmptyString(payload.opened_at)) out.issued_at = payload.opened_at;
  if (isNonEmptyString(payload.closed_at)) out.completed_at = payload.closed_at;
  if (isNonEmptyString(payload.summary)) out.description = payload.summary;
  if (typeof payload.odometer_at_open === 'number') {
    out.starting_meter_entry_attributes = { value: String(payload.odometer_at_open) };
  }
  if (typeof payload.odometer_at_close === 'number') {
    out.ending_meter_entry_attributes = { value: String(payload.odometer_at_close) };
  }
  if (isNonEmptyString(payload.notes)) out.comments_attributes = [{ comment: payload.notes }];
  // `status` (a string) has no Fleet.io equivalent — Fleet.io requires
  // `work_order_status_id`, an account-specific integer id this codebase
  // has no mapping table for yet. Deliberately dropped, not guessed.
  return out;
}
