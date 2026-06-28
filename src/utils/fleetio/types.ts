// ============================================================
// RMPG Flex — Fleet.io integration: type definitions
// ============================================================
// Subset of the Fleet.io API v1 response shapes we touch in PR 1.
// Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md
//
// Grounded against https://developer.fleetio.com (Quick Start +
// Webhooks docs, 2026-06-21). Fields beyond the subset below are
// allowed via the `[key: string]: unknown` index on FleetioVehicle —
// later PRs (esp. PR 3) replace this with stricter generated types.
// ============================================================

/** Pagination envelope. Fleet.io paginates with `?page=N&per_page=M`,
 *  exposing total counts in the response body. */
export interface FleetioPagination {
  current_page: number;
  total_pages: number;
  total_entries: number;
  per_page: number;
}

/** A list response carrying the resource array + pagination block. */
export interface FleetioListResponse<T> {
  records: T[];
  pagination: FleetioPagination;
}

/** Vehicle resource — PR 1 only writes a subset, but reads any record. */
export interface FleetioVehicle {
  id: number;
  name: string | null;
  vin: string | null;
  license_plate: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // Open record — Fleet.io has ~80 fields on Vehicle; we don't enumerate
  // them all in PR 1. PR 3 narrows this once the schema-diff report lands.
  [key: string]: unknown;
}

/** Payload for POST /api/v1/vehicles. All fields optional except `name`. */
export interface FleetioVehicleCreatePayload {
  name: string;
  vin?: string | null;
  license_plate?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  vehicle_type_id?: number | null;
  fuel_type_id?: number | null;
}

/** RMPG-side fleet_vehicles row shape — only the columns seed reads. */
export interface RmpgFleetVehicleRow {
  id: number;
  vehicle_name: string | null;
  vehicle_number: string | null;
  vin: string | null;
  plate_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
}

/** Outcome of a single vehicle seed attempt — what the route returns per row. */
export type SeedOutcome =
  | { rmpg_id: number; status: 'created'; fleetio_id: number }
  | { rmpg_id: number; status: 'already_linked'; fleetio_id: number }
  | { rmpg_id: number; status: 'skipped_no_name' }
  | { rmpg_id: number; status: 'error'; error: string };

export interface SeedSummary {
  total: number;
  created: number;
  already_linked: number;
  skipped: number;
  errors: number;
  outcomes: SeedOutcome[];
}
