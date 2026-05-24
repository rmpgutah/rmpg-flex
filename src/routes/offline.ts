// ============================================================
// /api/offline — Browser offline-cache sync endpoints
// ============================================================
// Consumed by client/src/services/offlineSync.ts. The IndexedDB
// cache polls these on per-table intervals (units every 10s, most
// tables every 2-10 min) so a cruiser that drops cell coverage
// keeps a recent snapshot of CAD + RMS data.
//
// Protocol — POST /sync/pull:
//   body: { table: string, since: string|null, limit?: number }
//   resp: { rows: object[], fullReplace: boolean }
// fullReplace=true when `since` is null (initial pull or
// REFERENCE_TABLES on the client side); the client then calls
// replaceTable() instead of deltaSync().
//
// Push, secrets, my-secret, secrets/generate are intentionally
// safe-stubbed for now — see notes on each handler. Returning a
// well-formed empty body silences the console flood without
// faking sync state, so queued items stay pending and retry.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

const offline = new Hono<Env>();

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

// Allowlist + per-table projection. The `cursorCol` is the
// column used for the `since` comparison; 14 tables track
// updates via `updated_at`, the remaining 3 are append-only
// (criminal_history, patrol_scans, patrol_checkpoints) and use
// `created_at` because their rows never mutate. time_entries
// also uses created_at — schema check 2026-05-24 showed no
// updated_at column on the live DB.
//
// `users` lists columns explicitly to keep password_hash,
// totp_secret_enc, totp_pending_secret, totp_backup_codes, and
// password_history out of every officer's IndexedDB. Any new
// column added to `users` is excluded by default until added
// here — that's the safer direction.
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
  const requested = typeof body.limit === 'number' ? body.limit : DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(requested)));

  const db = getDb(c.env);
  // table + cursorCol are from the allowlist, never user input —
  // safe to interpolate. `since` and `limit` are bound.
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

// ── /sync/push — drain the client's IndexedDB write queue ──
//
// Each item carries a method + endpoint + body that originated
// as a normal API call the client couldn't reach at the time
// (offline / lost cell). We replay each by re-issuing it to the
// same origin we were called on — that hits the proxy at
// rmpgutah.us in prod, so items whose endpoints live on the
// legacy Worker (e.g. /api/personnel/time/clock-in) still reach
// legacy without a service binding. The original JWT is passed
// through so the dispatched call inherits the same user identity.
//
// Allowlist source: client/src/services/offlineRouter.ts —
// every enqueue() call in that file maps to one entry below.
// Anything else returns { success: false, error: ... } per
// item rather than dispatching, so a tampered IndexedDB can't
// replay arbitrary endpoints (privilege escalation defense).
//
// Known limitation: this push is not idempotent. If a batch
// half-succeeds and the client retries, the succeeded items
// will be re-attempted. Per-item dedup needs a client_local_id
// column on each target table + INSERT ... ON CONFLICT, which
// is a schema migration deferred to a Phase 2 PR.
const PUSH_ALLOWLIST: { method: string; pattern: RegExp }[] = [
  { method: 'POST', pattern: /^\/api\/dispatch\/calls$/ },
  { method: 'PUT',  pattern: /^\/api\/dispatch\/calls\/\d+$/ },
  { method: 'PUT',  pattern: /^\/api\/dispatch\/units\/\d+$/ },
  { method: 'POST', pattern: /^\/api\/dispatch\/gps$/ },
  { method: 'POST', pattern: /^\/api\/incidents$/ },
  { method: 'POST', pattern: /^\/api\/personnel\/time\/clock-in$/ },
  { method: 'POST', pattern: /^\/api\/personnel\/time\/clock-out$/ },
  { method: 'POST', pattern: /^\/api\/citations$/ },
  { method: 'POST', pattern: /^\/api\/field-interviews$/ },
  { method: 'POST', pattern: /^\/api\/evidence$/ },
  { method: 'POST', pattern: /^\/api\/arrests$/ },
  { method: 'POST', pattern: /^\/api\/patrol\/checkpoints$/ },
  { method: 'POST', pattern: /^\/api\/trespass-orders$/ },
];

interface PushItem {
  local_id?: string;
  table_name?: string;
  method?: string;
  endpoint?: string;
  body?: string | null;
}

interface PushResult {
  local_id: string | null;
  success: boolean;
  server_id?: number | string | null;
  error?: string;
  status?: number;
}

function isAllowed(method: string, endpoint: string): boolean {
  return PUSH_ALLOWLIST.some(
    (r) => r.method === method.toUpperCase() && r.pattern.test(endpoint)
  );
}

function extractServerId(body: unknown): number | string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.id === 'number' || typeof b.id === 'string') return b.id;
  if (typeof b.server_id === 'number' || typeof b.server_id === 'string') return b.server_id;
  const data = b.data as Record<string, unknown> | undefined;
  if (data && (typeof data.id === 'number' || typeof data.id === 'string')) return data.id;
  return null;
}

offline.post('/sync/push', async (c) => {
  let body: { items?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const items = Array.isArray(body.items) ? (body.items as PushItem[]) : [];
  if (items.length === 0) {
    return c.json({ results: [], pushed: 0 });
  }

  const authHeader = c.req.header('Authorization') ?? '';
  const origin = new URL(c.req.url).origin;
  const results: PushResult[] = [];
  let pushed = 0;

  for (const item of items) {
    const localId = typeof item.local_id === 'string' ? item.local_id : null;
    const method = typeof item.method === 'string' ? item.method.toUpperCase() : '';
    const endpoint = typeof item.endpoint === 'string' ? item.endpoint : '';

    if (!isAllowed(method, endpoint)) {
      results.push({
        local_id: localId,
        success: false,
        error: `Endpoint ${method} ${endpoint} not allowed for offline push`,
      });
      continue;
    }

    try {
      const dispatchUrl = new URL(endpoint, origin).toString();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const resp = await fetch(dispatchUrl, {
        method,
        headers,
        body: typeof item.body === 'string' ? item.body : undefined,
      });

      let parsed: unknown = null;
      try { parsed = await resp.json(); } catch { /* empty or non-JSON body */ }

      if (resp.ok) {
        pushed++;
        results.push({
          local_id: localId,
          success: true,
          server_id: extractServerId(parsed),
          status: resp.status,
        });
      } else {
        const errMsg = parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as Record<string, unknown>).error)
          : `HTTP ${resp.status}`;
        results.push({ local_id: localId, success: false, error: errMsg, status: resp.status });
      }
    } catch (err) {
      results.push({
        local_id: localId,
        success: false,
        error: err instanceof Error ? err.message : 'Dispatch failed',
      });
    }
  }

  return c.json({ results, pushed });
});

// PIN/offline-secret system was VPS-era and not yet ported.
// Empty responses keep AdminOfflineTab + sync engine quiet without
// fabricating a secret that would lock users out on a later real
// rollout.
offline.get('/secrets', (c) => c.json({ secrets: [], admin_secret: null }));
offline.get('/my-secret', (c) => c.json({ secret: null }));
offline.post('/secrets/generate', (c) => c.json({ ok: true, generated: false }));

export default offline;
