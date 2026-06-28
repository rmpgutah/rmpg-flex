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
