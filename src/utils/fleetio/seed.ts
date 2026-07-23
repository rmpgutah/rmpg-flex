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

  const payload: FleetioVehicleCreatePayload = { name };

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
export function mapVehicleFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const name = deriveNameFromRecord(payload);
  if (name) out.name = name;
  if (isNonEmptyString(payload.vin)) out.vin = payload.vin;
  if (isNonEmptyString(payload.plate_number)) out.license_plate = payload.plate_number;
  if (payload.year !== undefined) out.year = payload.year;
  if (isNonEmptyString(payload.make)) out.make = payload.make;
  if (isNonEmptyString(payload.model)) out.model = payload.model;
  if (isNonEmptyString(payload.color)) out.color = payload.color;
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
  if (typeof payload.total_cost === 'number') out.cost = payload.total_cost;
  return out;
}

// Vendor/part update payloads still flow through dispatchOutbound's implicit
// ownership-filter pass-through (VENDOR_OWNERSHIP/PART_OWNERSHIP in
// ownership.ts). That happens to work today only because those maps were
// hand-written with field names that already match Fleet.io's vendors/parts
// resources — an unenforced coincidence, not a mapping. These explicit
// allowlists close the same class of risk the vehicle/fuel_entry mappers
// above closed: a future RMPG-only column added to ref_vendors/fleet_parts
// can no longer silently leak into an outbound payload.
export function mapVendorFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'address', 'city', 'state', 'zip', 'phone', 'email'] as const) {
    if (isNonEmptyString(payload[k])) out[k] = payload[k];
  }
  return out;
}

export function mapPartFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'part_number', 'category', 'description', 'supplier'] as const) {
    if (isNonEmptyString(payload[k])) out[k] = payload[k];
  }
  if (typeof payload.unit_cost === 'number') out.unit_cost = payload.unit_cost;
  return out;
}
