// Offline cache warming — fires background GET requests to key API endpoints
// so the service worker's rmpg-api-data cache is pre-populated at login time.
//
// When an officer logs in and then goes offline before visiting every page,
// the cached responses from these background fetches let those pages render
// with stale-but-correct data instead of going blank.
//
// The SW intercepts each fetch, stores the successful response, and serves it
// on subsequent offline requests. No IDB or apiFetch changes needed.

import { resolveApiHttpBase, WORKER_HTTP_ORIGIN } from './apiOrigin';

function getApiBase(): string {
  if (typeof window === 'undefined') return WORKER_HTTP_ORIGIN;
  return resolveApiHttpBase({
    isDev: Boolean(import.meta.env?.DEV),
    hostname: window.location.hostname,
  });
}

// Endpoints to pre-cache. Mirrors the PULL_TABLES list in src/routes/offline.ts
// so the same tables the server is willing to sync are the ones we warm locally.
// limit=200 gives enough for list-view rendering without full table dumps.
const WARM_ENDPOINTS: string[] = [
  '/api/dispatch/calls?limit=200',
  '/api/dispatch/units',
  '/api/incidents?limit=200',
  '/api/warrants?limit=200',
  '/api/citations?limit=200',
  '/api/field-interviews?limit=200',
  '/api/records/evidence?limit=200',
  '/api/records/persons?limit=200',
  '/api/trespass-orders?limit=200',
  '/api/patrol/checkpoints?limit=200',
  '/api/process-server?limit=200',
  '/api/admin/clients',
  '/api/admin/config',
  '/api/records/properties?limit=200',
  '/api/personnel?status=active',
  '/api/automation-rules',
  '/api/user/preferences',
];

let warmedAt = 0;
const REWARM_INTERVAL_MS = 15 * 60 * 1000; // Re-warm at most once per 15 min
// Stagger between requests to avoid a burst on login
const STAGGER_MS = 150;

/**
 * Fire background GET requests to pre-populate the SW API cache.
 * Safe to call multiple times — throttled to once per REWARM_INTERVAL_MS.
 * Never throws; all failures are silently swallowed.
 */
export function warmOfflineCache(): void {
  const now = Date.now();
  if (now - warmedAt < REWARM_INTERVAL_MS) return;
  warmedAt = now;

  const base = getApiBase();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('rmpg_token') : null;
  const headers: Record<string, string> = { 'X-Offline-Warm': '1' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  WARM_ENDPOINTS.forEach((path, i) => {
    setTimeout(() => {
      fetch(`${base}${path}`, {
        method: 'GET',
        credentials: 'include',
        headers,
      }).catch(() => {});
    }, i * STAGGER_MS);
  });
}

/** Reset the throttle — for use in tests. */
export function resetWarmThrottle(): void {
  warmedAt = 0;
}
