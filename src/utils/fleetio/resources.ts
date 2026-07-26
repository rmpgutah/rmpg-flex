// ============================================================
// RMPG Flex — Fleet.io integration: canonical resource keys
// ============================================================
// `fleetio_links.fleetio_resource` participates in a UNIQUE index —
// `UNIQUE (fleetio_resource, fleetio_id)` (migrations/0133) — so the STRING
// is part of the identity of a link, not a free-text label.
//
// Before this module the same Fleet.io resource was written under two
// different keys: `/seed` and `/pull` in src/routes/fleetio.ts wrote
// 'vehicles' while recordLink() in sync.ts wrote 'vehicle'. Two consequences,
// both live:
//   1. The unique index stopped preventing a double-link — ('vehicle', 42)
//      and ('vehicles', 42) are distinct keys, so the same Fleet.io vehicle
//      could be linked twice.
//   2. `/pull`'s `WHERE fleetio_resource='vehicles'` could not see links the
//      sync engine created, so it re-processed those vehicles every run and
//      its fuel-import phase skipped them entirely (their fuel history never
//      landed in RMPG).
//
// One canonical key per resource, named after the Fleet.io REST path segment
// so the value is derivable from the endpoint and can't drift again. Every
// writer and reader of `fleetio_resource` MUST go through this map.
// migration 0206 normalizes the singular legacy values already in live D1.
// ============================================================

/** Internal resource token (as used in `fleetio_events.resource`). */
export type FleetioResourceKind =
  | 'vehicle'
  | 'fuel_entry'
  | 'work_order'
  | 'vendor'
  | 'part';

/** Canonical `fleetio_links.fleetio_resource` value, per resource kind. */
export const FLEETIO_LINK_RESOURCE: Record<FleetioResourceKind, string> = {
  vehicle:    'vehicles',
  fuel_entry: 'fuel_entries',
  work_order: 'work_orders',
  vendor:     'vendors',
  part:       'parts',
};

/** Canonical RMPG table per resource kind — the other half of a link row.
 *  Kept beside the resource keys so a new resource can't be added with a
 *  table name in one map and a different one in another (defect #4: the FK
 *  map said 'vendors' while links were written under 'ref_vendors'). */
export const FLEETIO_RMPG_TABLE: Record<FleetioResourceKind, string> = {
  vehicle:    'fleet_vehicles',
  fuel_entry: 'fleet_fuel_log',
  work_order: 'work_orders',
  vendor:     'ref_vendors',
  part:       'fleet_parts',
};

/** RMPG table → resource kind. Inverse of FLEETIO_RMPG_TABLE. */
export const RMPG_TABLE_TO_KIND: Record<string, FleetioResourceKind> = Object.fromEntries(
  Object.entries(FLEETIO_RMPG_TABLE).map(([kind, table]) => [table, kind as FleetioResourceKind]),
) as Record<string, FleetioResourceKind>;

/** Canonical link-resource value for an RMPG table, or null if the table
 *  isn't part of the Fleet.io sync surface. */
export function linkResourceForTable(rmpgTable: string): string | null {
  const kind = RMPG_TABLE_TO_KIND[rmpgTable];
  return kind ? FLEETIO_LINK_RESOURCE[kind] : null;
}

/** Legacy → canonical `fleetio_resource` values. The singular forms are what
 *  sync.ts's recordLink wrote before canonicalization; migration 0206 rewrites
 *  them in D1, but readers stay tolerant so a row written by an older Worker
 *  bundle (deploys are not atomic across the Worker + Pages pair) still
 *  resolves. Keys are the legacy values; values are canonical. */
export const LEGACY_LINK_RESOURCE_ALIASES: Record<string, string> = {
  vehicle:     'vehicles',
  fuel_entry:  'fuel_entries',
  work_order:  'work_orders',
  vendor:      'vendors',
  part:        'parts',
};

/** Every accepted `fleetio_resource` spelling for a kind — canonical first.
 *  Used to build tolerant `IN (?, ?)` filters during the alias window. */
export function acceptedLinkResources(kind: FleetioResourceKind): string[] {
  const canonical = FLEETIO_LINK_RESOURCE[kind];
  return canonical === kind ? [canonical] : [canonical, kind];
}
