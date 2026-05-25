// ============================================================
// RMPG Flex — Offline sync endpoints
// ============================================================
// Backs the client-side offline queue in client/src/services/offlineSync.ts.
// The browser queues writes to IndexedDB when offline (or always, then
// retries), then drains the queue via POST /api/offline/sync/push.
//
// Two real handlers + secret stubs:
//
//   POST /sync/pull — incremental table read with `since` cursor +
//     per-table column allowlist. 17 tables of CAD/RMS data feed the
//     browser's IndexedDB cache. See PULL_TABLES below.
//
//   POST /sync/push — drains the client's write queue by re-dispatching
//     each item back through the root Hono app (so canonical handlers
//     in src/routes/dispatch/calls.ts, src/routes/incidents.ts, etc.
//     run unchanged) and returns per-item success/server_id.
//
// GET /my-secret + /secrets stay stubbed — offline-PIN secret
// rotation is a separate work stream. Empty shapes keep the client's
// catch paths quiet without fabricating secrets.
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
import { getDb, query } from '../utils/db';

const offline = new Hono<Env>();

// ─── Stubs (preserve existing client contract) ───────────────
// pullSecrets() in offlineSync.ts calls these. Empty shapes are
// intentional — offline-PIN secret rotation is a separate work
// stream. Keep the keys the client checks for (`secret`, `secrets`,
// `admin_secret`) even if values are null/empty so client branches
// don't error.
offline.get('/my-secret', (c) => c.json({ secret: null, admin_secret: null }));
offline.get('/secrets', (c) => c.json({ secrets: [], admin_secret: null }));

// ─── POST /sync/pull — incremental table sync ────────────────
// Per-table allowlist + projection. `cursorCol` is the column used
// for the `since` comparison: 14 tables track updates via
// `updated_at`; criminal_history, patrol_scans, patrol_checkpoints,
// and time_entries are append-only (live D1 schema check 2026-05-24
// showed no updated_at column) so they use `created_at`.
//
// `users` lists columns explicitly to keep password_hash,
// totp_secret_enc, totp_pending_secret, totp_backup_codes, and
// password_history out of every officer's IndexedDB. Any new column
// added to `users` is excluded by default until added here — the
// safer direction in a 70+ column table.
//
// This handler was originally part of PR #636 but got silently
// reverted to a stub during PR #638's merge conflict resolution
// (which accepted their offline.ts wholesale). The console didn't
// 404 anymore because the stub returned 200, so the regression was
// invisible until you tried to use the offline cache.
type CursorCol = 'updated_at' | 'created_at';
const PULL_TABLES: Record<string, { columns: string; cursorCol: CursorCol }> = {
  users: {
    columns: [
      'id', 'username', 'full_name', 'first_name', 'middle_name', 'last_name',
      'email', 'role', 'badge_number', 'phone', 'status', 'avatar_url', 'photo',
      'rank', 'department', 'employee_id', 'assigned_unit_id',
      'voice_persona', 'voice_rate', 'voice_pitch', 'voice_terseness',
      'voice_brain_enabled', 'theme_preference', 'font_size_preference',
      'created_at', 'updated_at',
    ].join(', '),
    cursorCol: 'updated_at',
  },
  clients:            { columns: '*', cursorCol: 'updated_at' },
  properties:         { columns: '*', cursorCol: 'updated_at' },
  units:              { columns: '*', cursorCol: 'updated_at' },
  calls_for_service:  { columns: '*', cursorCol: 'updated_at' },
  incidents:          { columns: '*', cursorCol: 'updated_at' },
  time_entries:       { columns: '*', cursorCol: 'created_at' },
  persons:            { columns: '*', cursorCol: 'updated_at' },
  vehicles_records:   { columns: '*', cursorCol: 'updated_at' },
  citations:          { columns: '*', cursorCol: 'updated_at' },
  field_interviews:   { columns: '*', cursorCol: 'updated_at' },
  evidence:           { columns: '*', cursorCol: 'updated_at' },
  criminal_history:   { columns: '*', cursorCol: 'created_at' },
  patrol_scans:       { columns: '*', cursorCol: 'created_at' },
  patrol_checkpoints: { columns: '*', cursorCol: 'created_at' },
  trespass_orders:    { columns: '*', cursorCol: 'updated_at' },
  warrants:           { columns: '*', cursorCol: 'updated_at' },
};

const PULL_DEFAULT_LIMIT = 1000;
const PULL_MAX_LIMIT = 5000;

offline.post('/sync/pull', async (c) => {
  let body: { table?: unknown; since?: unknown; limit?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const table = typeof body.table === 'string' ? body.table : '';
  const spec = PULL_TABLES[table];
  if (!spec) {
    return c.json({ error: `Unknown table: ${table}` }, 400);
  }

  const since = typeof body.since === 'string' && body.since.length > 0 ? body.since : null;
  const requested = typeof body.limit === 'number' ? body.limit : PULL_DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(PULL_MAX_LIMIT, Math.floor(requested)));

  const db = getDb(c.env);
  // table + cursorCol come from the allowlist, never user input —
  // safe to interpolate. `since` + `limit` are bound.
  const sql = since
    ? `SELECT ${spec.columns} FROM ${table} WHERE ${spec.cursorCol} > ? ORDER BY ${spec.cursorCol} ASC LIMIT ?`
    : `SELECT ${spec.columns} FROM ${table} ORDER BY ${spec.cursorCol} ASC LIMIT ?`;

  try {
    const rows = since
      ? await query(db, sql, since, limit)
      : await query(db, sql, limit);
    return c.json({ rows, fullReplace: since === null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Query failed';
    return c.json({ error: msg }, 500);
  }
});

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
