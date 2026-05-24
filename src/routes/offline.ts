// ============================================================
// RMPG Flex — Offline sync endpoints
// ============================================================
// Backs the client-side offline queue in client/src/services/offlineSync.ts.
// The browser queues writes to IndexedDB when offline (or always, then
// retries), then drains the queue via POST /api/offline/sync/push.
//
// /sync/push is the only non-stub here. It dispatches each queued item
// back through the root Hono app (so canonical handlers in
// src/routes/dispatch/calls.ts, src/routes/incidents.ts, etc. run
// unchanged) and returns per-item success/server_id so the client can
// reconcile its IndexedDB rows.
//
// The other endpoints (/sync/pull, /my-secret, /secrets) are stubs
// for now — pull-side delta sync and offline-PIN secret rotation are
// separate work streams. They return shapes the client tolerates so
// the catch-paths in offlineSync.ts don't spam errors.
//
// ── Security model ────────────────────────────────────────────
// A queued item is a (method, endpoint, body) tuple from the browser.
// Without restriction, a tampered IndexedDB could push e.g.
//   { method: 'DELETE', endpoint: '/api/admin/users/1' }
// and our authenticated subrequest would happily forward it. The
// ALLOWED_ENDPOINTS regex list below restricts replay to the exact
// (method, path) pairs the client actually enqueues — derived from
// every `await enqueue(...)` call site in offlineRouter.ts as of
// 2026-05-24. New offline-queueable endpoints MUST be added here
// or the push will silently reject them.
//
// Patterns are anchored (^…$) so a tampered endpoint like
// '/api/dispatch/calls/1?override=/api/admin' can't slip through the
// regex via partial match.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';

const offline = new Hono<Env>();

// ─── Stubs (preserve existing client contract) ───────────────
// pullSecrets() and pullTable() in offlineSync.ts call these. Empty
// shapes are intentional — feature wiring deferred. Keep the keys
// the client checks for (`secret`, `secrets`, `admin_secret`, `rows`)
// even if values are null/empty, so client branches don't error.
offline.get('/my-secret', (c) => c.json({ secret: null, admin_secret: null }));
offline.get('/secrets', (c) => c.json({ secrets: [], admin_secret: null }));
offline.post('/sync/pull', (c) => c.json({ rows: [], fullReplace: false }));

// ─── Allowlist: which (method, endpoint) tuples can be replayed ─
// Source-of-truth grep: `grep -rn "await enqueue(" client/src/` in
// the repo at 2026-05-24. Keep this in sync with offlineRouter.ts.
//
// IMPORTANT: anchor with ^…$. A pattern like `/^\/api\/dispatch\/calls/`
// without an end-anchor would match `/api/dispatch/calls/../../admin`,
// which (combined with the URL constructor's path normalization) could
// route to unintended handlers.
const ALLOWED_ENDPOINTS: Array<{ method: string; pattern: RegExp }> = [
  // Dispatch
  { method: 'POST', pattern: /^\/api\/dispatch\/calls$/ },
  { method: 'PUT',  pattern: /^\/api\/dispatch\/calls\/\d+$/ },
  { method: 'PUT',  pattern: /^\/api\/dispatch\/units\/\d+$/ },
  { method: 'POST', pattern: /^\/api\/dispatch\/gps$/ },
  // Incidents / RMS writes
  { method: 'POST', pattern: /^\/api\/incidents$/ },
  { method: 'POST', pattern: /^\/api\/citations$/ },
  { method: 'POST', pattern: /^\/api\/field-interviews$/ },
  { method: 'POST', pattern: /^\/api\/evidence$/ },
  { method: 'POST', pattern: /^\/api\/arrests$/ },
  { method: 'POST', pattern: /^\/api\/patrol\/checkpoints$/ },
  { method: 'POST', pattern: /^\/api\/trespass-orders$/ },
  // Personnel time clock
  { method: 'POST', pattern: /^\/api\/personnel\/time\/clock-in$/ },
  { method: 'POST', pattern: /^\/api\/personnel\/time\/clock-out$/ },
];

function isAllowed(method: string, endpoint: string): boolean {
  const m = method.toUpperCase();
  return ALLOWED_ENDPOINTS.some(e => e.method === m && e.pattern.test(endpoint));
}

interface PushItem {
  id?: number;
  local_id: string;
  table_name?: string;
  method: string;
  endpoint: string;
  body?: string;
  attempts?: number;
}

interface PushResult {
  local_id: string;
  success: boolean;
  server_id?: number | string;
  error?: string;
}

// ─── POST /sync/push ─────────────────────────────────────────
// Drains a batch of offline-queued writes. Per-item: validate against
// allowlist → dispatch through root app → translate response shape
// into { success, server_id | error } for the client to reconcile.
//
// Known dup risk (Phase 2): if the client retries a batch where some
// items succeeded but the response never arrived, those items will be
// re-pushed and re-inserted. Fix shape is a `client_local_id` column
// + dedup check in each handler; tracked separately. In practice the
// window is small because the client only re-pushes items it never
// marked 'synced'.
offline.post('/sync/push', async (c) => {
  const body = await c.req.json<{ items?: PushItem[] }>().catch(() => ({ items: [] as PushItem[] }));
  const items = Array.isArray(body?.items) ? body.items : [];

  if (items.length === 0) {
    return c.json({ results: [], pushed: 0 });
  }

  // Pass the caller's auth through verbatim so each subrequest's
  // authMiddleware sees the same JWT/cookie and resolves to the same
  // user — preserves audit trails (created_by, dispatcher_id, etc.)
  // exactly as if the user were online.
  const authHeader = c.req.header('Authorization') ?? '';
  const cookieHeader = c.req.header('Cookie') ?? '';
  const origin = new URL(c.req.url).origin;

  // Lazy import to break the module-load cycle:
  //   index.ts → routesConfig.ts → offline.ts → index.ts
  // ES modules tolerate this at request time (well after all modules
  // have finished loading), but a top-level `import { app }` would
  // resolve to `undefined` during the registry-building phase.
  const { app } = await import('../index');

  const results: PushResult[] = [];

  for (const item of items) {
    if (!item || typeof item.local_id !== 'string'
        || typeof item.endpoint !== 'string'
        || typeof item.method !== 'string') {
      results.push({
        local_id: String(item?.local_id ?? ''),
        success: false,
        error: 'Malformed queue item',
      });
      continue;
    }

    if (!isAllowed(item.method, item.endpoint)) {
      results.push({
        local_id: item.local_id,
        success: false,
        error: `Endpoint not allowlisted for offline replay: ${item.method} ${item.endpoint}`,
      });
      continue;
    }

    try {
      const method = item.method.toUpperCase();
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (authHeader) headers.set('Authorization', authHeader);
      if (cookieHeader) headers.set('Cookie', cookieHeader);

      const subReq = new Request(`${origin}${item.endpoint}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : (item.body ?? ''),
      });

      const res = await app.fetch(subReq, c.env, c.executionCtx);

      if (res.ok) {
        let parsed: any = null;
        try { parsed = await res.clone().json(); } catch { /* non-JSON body, fine */ }
        // Handler response shapes vary:
        //   dispatch/calls POST → row object with `.id` (201)
        //   incidents POST → row object with `.id` (201)
        //   citations / field-interviews / etc → row object with `.id`
        //   dispatch/gps POST → { inserted: N } (no id, batch insert)
        // Falling through to `undefined` is fine — client just won't
        // back-fill server_id on that record (still marks synced).
        const server_id = parsed?.id
          ?? parsed?.server_id
          ?? parsed?.meta?.last_row_id
          ?? undefined;
        results.push({ local_id: item.local_id, success: true, server_id });
      } else {
        let errMsg: string;
        try {
          const errBody = await res.clone().json() as any;
          errMsg = errBody?.error || errBody?.message || `HTTP ${res.status}`;
        } catch {
          errMsg = `HTTP ${res.status} ${res.statusText}`;
        }
        results.push({ local_id: item.local_id, success: false, error: errMsg });
      }
    } catch (err: any) {
      results.push({
        local_id: item.local_id,
        success: false,
        error: err?.message || 'Subrequest dispatch failed',
      });
    }
  }

  return c.json({
    results,
    pushed: results.filter(r => r.success).length,
  });
});

export default offline;
