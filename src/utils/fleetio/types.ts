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

/**
 * ⚠️ Fleet.io has TWO pagination contracts, and which one you get is decided by
 * the API version bound to the API key (chosen at key-creation time — there is
 * no per-request version header). Grounded against
 * https://developer.fleetio.com/docs/overview/pagination on 2026-07-26:
 *
 *   Cursor-based (API version 2024-01-01 and newer, incl. the current
 *   2025-05-05): request `?per_page=<=100` and `?start_cursor=<cursor>`;
 *   response body is
 *     { records: [...], current_cursor, next_cursor, per_page,
 *       estimated_remaining_count, filtered_by: [], sorted_by: [] }
 *   `next_cursor` is null on the last page.
 *
 *   Legacy page-based (older keys): request `?page=N&per=<=100`; the response
 *   body is a BARE ARRAY and the counts arrive as response HEADERS —
 *   X-Pagination-Limit / -Current-Page / -Total-Pages / -Total-Count.
 *
 * Neither version emits a `{ records, pagination: { total_pages } }` body
 * envelope. An earlier revision of this file declared exactly that shape, so
 * `resp.pagination?.total_pages ?? 1` always resolved to 1 and every paginated
 * pull silently stopped after the first 100 records — and on a legacy key
 * `resp.records` was undefined, throwing outright. `FleetioListPage` below is
 * the normalized shape both contracts are parsed into; `parseListPage` does the
 * detection so no caller has to care which one is live.
 */
export interface FleetioListPage<T> {
  records: T[];
  /** Cursor API: `next_cursor` (null on the last page). Legacy: always null. */
  next_cursor: string | null;
  /** Legacy header pagination: total page count, when advertised. */
  total_pages: number | null;
  /** Cursor API: `estimated_remaining_count`, when advertised. */
  estimated_remaining_count: number | null;
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

/** Vendor resource (Fleet.io `/vendors`) — used by work_order/fuel_entry
 *  outbound FK translation and, as of the resource-parity extension, its
 *  own bidirectional sync (RMPG `ref_vendors`). */
export interface FleetioVendor {
  id: number;
  name: string | null;
  vendor_types?: string[] | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/** Part resource (Fleet.io `/parts`) — RMPG `fleet_parts`. */
export interface FleetioPart {
  id: number;
  name: string | null;
  part_number: string | null;
  description?: string | null;
  unit_cost?: number | null;
  quantity_on_hand?: number | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}
