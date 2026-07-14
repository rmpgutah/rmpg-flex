// ============================================================
// RMPG Flex — Fleet.io integration: inbound vehicle reconciliation
// ============================================================
// Pure functions: matches a Fleet.io vehicle against RMPG's local
// fleet_vehicles rows and maps unmatched Fleet.io vehicles into a row
// insertable into fleet_vehicles. Split from the route handler (which
// does the D1 I/O) so the matching logic is unit-testable without a
// live Fleet.io account.
//
// Why this exists: PR 1's /seed only pushes RMPG -> Fleet.io via
// vehicles.create, which 422s whenever the vehicle already exists in
// Fleet.io (e.g. entered there manually before this integration shipped
// — Fleet.io is the pre-existing system of record for some vehicles).
// Pulling Fleet.io's roster first and matching by VIN/plate/name lets
// /seed's LEFT JOIN over fleetio_links skip already-linked vehicles on
// its next run instead of re-attempting a colliding create.
// ============================================================

import type { FleetioVehicle, RmpgFleetVehicleRow } from './types';

export interface LocalVehicleForMatch {
  id: number;
  vin: string | null;
  plate_number: string | null;
  vehicle_number: string | null;
  vehicle_name: string | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Finds the local fleet_vehicles row this Fleet.io vehicle corresponds to,
 * if any. Match priority: VIN (most reliable, rarely reused) > license
 * plate > name/vehicle_number. Returns null when nothing matches — the
 * caller should treat the Fleet.io vehicle as new to RMPG.
 */
export function matchLocalVehicle(
  fioVehicle: FleetioVehicle,
  locals: readonly LocalVehicleForMatch[],
): LocalVehicleForMatch | null {
  const vin = norm(fioVehicle.vin);
  if (vin) {
    const byVin = locals.find((l) => norm(l.vin) === vin);
    if (byVin) return byVin;
  }
  const plate = norm(fioVehicle.license_plate);
  if (plate) {
    const byPlate = locals.find((l) => norm(l.plate_number) === plate);
    if (byPlate) return byPlate;
  }
  const name = norm(fioVehicle.name);
  if (name) {
    const byName = locals.find((l) => norm(l.vehicle_number) === name || norm(l.vehicle_name) === name);
    if (byName) return byName;
  }
  return null;
}

/** Returns null when the Fleet.io vehicle has no usable name to seed a new row with. */
export function buildLocalInsertFromFleetio(
  fioVehicle: FleetioVehicle,
): Omit<RmpgFleetVehicleRow, 'id'> & { status: string } | null {
  const name = (fioVehicle.name ?? '').trim();
  if (!name) return null;
  return {
    vehicle_name: name,
    vehicle_number: name,
    vin: fioVehicle.vin || null,
    plate_number: fioVehicle.license_plate || null,
    year: fioVehicle.year ?? null,
    make: fioVehicle.make || null,
    model: fioVehicle.model || null,
    color: fioVehicle.color || null,
    status: 'in_service',
  };
}

/**
 * Decides what to do with a local match, given the set of rmpg_ids that
 * already have (or will have, earlier in this same run) a fleetio_links
 * row. Pure — no D1 access — so the collision case the fleetio_links
 * UNIQUE(rmpg_table, rmpg_id) index guards against is unit-testable
 * without mocking the database:
 *   - a local row already linked to a DIFFERENT Fleet.io vehicle (from an
 *     earlier /pull run, or another Fleet.io vehicle earlier in this same
 *     page/run matching the same local row via a shared VIN/plate/name)
 *   - must be skipped, not linked again, or the INSERT violates the
 *     unique index and (pre-fix) aborted the entire reconcile with a 502.
 */
export function decideMatchAction(
  matchedLocalId: number,
  linkedRmpgIds: ReadonlySet<number>,
): 'link' | 'conflict' {
  return linkedRmpgIds.has(matchedLocalId) ? 'conflict' : 'link';
}

export type PullOutcome =
  | { fleetio_id: number; status: 'linked_existing'; rmpg_id: number }
  | { fleetio_id: number; status: 'already_linked'; rmpg_id: number }
  | { fleetio_id: number; status: 'created'; rmpg_id: number }
  | { fleetio_id: number; status: 'skipped_no_name' }
  | { fleetio_id: number; status: 'skipped_archived' }
  // Match resolved to a local row already linked to a DIFFERENT Fleet.io
  // vehicle (e.g. two Fleet.io records sharing a VIN/plate/name, or one
  // already linked from an earlier run) — inserting a second link for the
  // same rmpg_id would violate fleetio_links' UNIQUE(rmpg_table, rmpg_id).
  | { fleetio_id: number; status: 'skipped_conflict'; rmpg_id: number };

export interface FleetioFuelEntryForPull {
  id: number;
  vehicle_id: number;
  date: string;
  liters: number | null;
  us_gallons: number | null;
  cost: number | null;
}

export interface LocalFuelLogInsert {
  fuel_date: string;
  gallons: number | null;
  total_cost: number | null;
  cost_per_gallon: number | null;
}

/** Maps a Fleet.io fuel_entries record into an insertable fleet_fuel_log
 *  row. Fleet.io doesn't carry RMPG-only fields (driver_name,
 *  payment_method, location, is_full_tank) — those stay null on a pulled
 *  row until a local edit fills them in. cost_per_gallon is derived (Fleet.io
 *  doesn't expose it directly) when both gallons and cost are present and
 *  gallons is nonzero. */
export function buildFuelLogInsertFromFleetio(entry: FleetioFuelEntryForPull): LocalFuelLogInsert {
  const gallons = entry.us_gallons ?? null;
  const totalCost = entry.cost ?? null;
  const costPerGallon = gallons != null && gallons > 0 && totalCost != null
    ? Math.round((totalCost / gallons) * 1000) / 1000
    : null;
  return {
    fuel_date: entry.date,
    gallons,
    total_cost: totalCost,
    cost_per_gallon: costPerGallon,
  };
}
