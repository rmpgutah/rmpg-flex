// Offline cache warming — fires background GET requests to key API endpoints
// so the service worker's rmpg-api-data cache is pre-populated at login time.
//
// When an officer logs in and then goes offline before visiting every page,
// the cached responses from these background fetches let those pages render
// with stale-but-correct data instead of going blank.
//
// On rmpgutah.us / Vite, apiHttpBase() is '' so these are same-origin
// `/api/...` (zone proxy + SW-cacheable, no CORS preflight). Electron and
// other off-origin shells get the Worker origin. Never send a custom
// X-Offline-Warm header — that failed Access-Control-Allow-Headers on
// api.rmpgutah.us (field console 2026-08-28) and a cross-origin fetch is
// invisible to this origin's service worker anyway.

import { apiHttpBase } from './apiOrigin';

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
  // Disposition roster for DispatchPage. NOT /api/admin/config — that is
  // admin/manager/supervisor-only, so warming it 403'd for every dispatcher
  // and officer on every login.
  '/api/dispatch/disposition-codes',
  '/api/records/properties?limit=200',
  '/api/personnel?status=active',
  '/api/automation-rules',
  '/api/user/preferences',
];

let warmedAt = 0;
const REWARM_INTERVAL_MS = 15 * 60 * 1000; // Re-warm at most once per 15 min
// Stagger between requests to avoid a burst on login
const STAGGER_MS = 150;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Fire background GET requests to pre-populate the SW API cache.
 * Safe to call multiple times — throttled to once per REWARM_INTERVAL_MS.
 * Never throws; all failures are silently swallowed.
 */
export function warmOfflineCache(): void {
  if (isOffline()) return;
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('rmpg_token') : null;
  if (!token) return;

  const now = Date.now();
  if (now - warmedAt < REWARM_INTERVAL_MS) return;
  warmedAt = now;

  let aborted = false;
  const base = apiHttpBase();
  WARM_ENDPOINTS.forEach((path, i) => {
    setTimeout(() => {
      if (aborted || isOffline()) return;
      const current = typeof localStorage !== 'undefined' ? localStorage.getItem('rmpg_token') : null;
      if (!current) return;
      fetch(`${base}${path}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Authorization: `Bearer ${current}` },
      }).then((res) => {
        // Session is dead — don't keep hammering 16 more endpoints (the
        // 401 storm in the field console after a cellular drop).
        if (res.status === 401 || res.status === 403) aborted = true;
      }).catch(() => {});
    }, i * STAGGER_MS);
  });
}

/** Reset the throttle — for use in tests. */
export function resetWarmThrottle(): void {
  warmedAt = 0;
}

/** @internal — endpoints the warmer will hit. Tests only. */
export function _warmEndpointsForTest(): readonly string[] {
  return WARM_ENDPOINTS;
}
