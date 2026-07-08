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

export type PullOutcome =
  | { fleetio_id: number; status: 'linked_existing'; rmpg_id: number }
  | { fleetio_id: number; status: 'already_linked'; rmpg_id: number }
  | { fleetio_id: number; status: 'created'; rmpg_id: number }
  | { fleetio_id: number; status: 'skipped_no_name' }
  | { fleetio_id: number; status: 'skipped_archived' };
