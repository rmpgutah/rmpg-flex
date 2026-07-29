// ============================================================
// RMPG Flex — ServeManager integration: canonical resource keys
// ============================================================
// Fleet.io's `fleetio_links.fleetio_resource` drifted between 'vehicle' and
// 'vehicles' before migration 0206 canonicalized it, defeating the row's
// UNIQUE(resource, id) index. Define the canonical mapping up front so
// servemanager_links never has the same problem.
// ============================================================

export type ServeManagerResourceKind = 'job';

/** Canonical ServeManager REST path segment per resource kind — this is the
 *  value stored in servemanager_links.servemanager_resource. It participates
 *  in UNIQUE(servemanager_resource, servemanager_id), so it is identity, not
 *  a label. Always source it from here, never inline a string literal. */
export const SERVEMANAGER_LINK_RESOURCE: Record<ServeManagerResourceKind, string> = {
  job: 'jobs',
};

/** Local RMPG table each resource kind maps to. */
export const SERVEMANAGER_RMPG_TABLE: Record<ServeManagerResourceKind, string> = {
  job: 'serve_queue',
};

export const RMPG_TABLE_TO_SERVEMANAGER_KIND: Record<string, ServeManagerResourceKind> = Object.fromEntries(
  Object.entries(SERVEMANAGER_RMPG_TABLE).map(([kind, table]) => [table, kind as ServeManagerResourceKind])
);

export function linkResourceForTable(table: string): string | undefined {
  const kind = RMPG_TABLE_TO_SERVEMANAGER_KIND[table];
  return kind ? SERVEMANAGER_LINK_RESOURCE[kind] : undefined;
}
