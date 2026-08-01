// Best-effort route chunk warming.
//
// Strictly advisory: real navigation always goes through lazyRetry() in
// App.tsx, which owns stale-chunk retry and the bounded reload. Nothing here
// may affect navigation correctness — every path swallows its errors.
import { getRouteImporter } from '../routes/routeModules';

/** Paths already warmed (or in flight). import() is itself deduped by the
 *  module cache; this just avoids the repeated call on every hover. */
const warmed = new Set<string>();

/** Exported for tests only — module state persists across cases otherwise. */
export function __resetPrefetchCacheForTests(): void {
  warmed.clear();
}

/**
 * Skip prefetching when the user is paying for bytes or is on a link too slow
 * to spend them speculatively. Mirrors the guard the Dispatch/Map idle
 * prefetch has used since 2026-07-02.
 */
function shouldSkipForConnection(): boolean {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  return /^(slow-2g|2g)$/.test(conn.effectiveType || '');
}

/**
 * Warm the chunk for `path`. Fire-and-forget: never throws, never returns a
 * promise the caller must handle, and never reports failure to the user.
 *
 * `path` MUST be a top-level nav-catalog path (see routeModules.ts) — never
 * the current location or a caller-supplied path. getRouteImporter resolves
 * via longest-registered-prefix, so a nested path like `/fleet/dashboard`
 * would warm the wrong chunk (FleetPage's, not FleetDashboard's own lazy
 * chunk). Only wire this to fixed nav-catalog entries.
 */
export function prefetchRoute(path: string): void {
  try {
    if (warmed.has(path)) return;
    if (shouldSkipForConnection()) return;

    const importer = getRouteImporter(path);
    if (!importer) return;

    // Call the importer BEFORE marking `path` as warmed. import() itself is
    // synchronous up to returning its promise (module fetching happens async),
    // so there's no gap here for a second call to slip through unmarked —
    // this ordering only protects against the theoretical case of `importer`
    // throwing synchronously, which would otherwise leave the marker set with
    // nothing in flight and no import ever retried for this path.
    const pending = importer();
    warmed.add(path);
    void pending.catch(() => {
      // A transient blip must not poison the cache — drop the marker so a
      // later hover can try again. The user may well navigate here anyway,
      // and lazyRetry handles the real load.
      warmed.delete(path);
    });
  } catch {
    // getRouteImporter or the connection probe threw. Prefetch is a nicety.
  }
}

/**
 * Routes worth warming during idle time, by role. Replaces the old hardcoded
 * DISPATCH_MAP_ROLES set, which prefetched Dispatch + Map (and their ~2.3 MB
 * mapbox/deck.gl dependency) for every role that had them in nav.
 *
 * Keep these lists SHORT. Each entry is speculative bandwidth on a cellular
 * link; two or three genuinely-most-used routes beat an exhaustive list.
 */
export const ROLE_PREFETCH_ROUTES: Readonly<Record<string, string[]>> = {
  admin: ['/dispatch', '/map'],
  manager: ['/dispatch', '/map'],
  supervisor: ['/dispatch', '/map'],
  dispatcher: ['/dispatch', '/map'],
  officer: ['/dispatch', '/map', '/mdt'],
  contract_manager: ['/reports'],
  human_resources: ['/personnel'],
  client_viewer: [],
};
