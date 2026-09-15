import { Hono } from 'hono';
import { log } from '../utils/logger';
import { tableExists } from '../utils/db';
import { replayQueue } from '../utils/syncConflict';
import type { Bindings, Variables } from '../types';

const sync = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Provisioning gate ──
// `sync_queue` and `sync_conflicts` come from migrations 0249/0250, both
// marked `Local-only` in their headers and deliberately never applied to
// live D1 (CLAUDE.md "Schema changes": they are the two files the deploy's
// migration runner skips by design). The FZ-55 secondary server has them;
// the cloud Worker does not.
//
// So "table missing" here is the EXPECTED cloud state, not a fault. Before
// the gate every endpoint threw `no such table` out of the handler body and
// the global onError turned it into a 500 — which is what made the admin
// Sync Status tab fire two requests, fail, and retry each three times on
// every mount (observed live 2026-09-15). Reads now degrade to an empty
// payload carrying `provisioned: false` so the UI can say so, and writes
// answer a typed 503 instead of an opaque 500.
const SYNC_TABLES = ['sync_queue', 'sync_conflicts'] as const;

async function syncTablesProvisioned(db: D1Database): Promise<boolean> {
  const present = await Promise.all(SYNC_TABLES.map((t) => tableExists(db, t)));
  return present.every(Boolean);
}

const NOT_PROVISIONED = {
  ok: false,
  code: 'not_provisioned',
  error: 'FZ-55 sync tables are not provisioned on this deployment (migrations 0249/0250 are local-only).',
} as const;

function requirePrivileged(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

// GET /api/sync/queue — pending/failed queue counts (admin/manager only)
sync.get('/queue', async (c) => {
  const user = c.get('user');
  if (!requirePrivileged(user?.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const db = c.env.DB;
  if (!(await syncTablesProvisioned(db))) {
    return c.json({ provisioned: false, pending: 0, failed: 0, delivered: 0 });
  }
  const [pending, failed, delivered] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'`).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) as count FROM sync_queue WHERE status = 'failed'`).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) as count FROM sync_queue WHERE status = 'delivered'`).first<{ count: number }>(),
  ]);
  return c.json({
    provisioned: true,
    pending: pending?.count ?? 0,
    failed: failed?.count ?? 0,
    delivered: delivered?.count ?? 0,
  });
});

// GET /api/sync/conflicts — paginated conflict audit log (admin/manager only)
sync.get('/conflicts', async (c) => {
  const user = c.get('user');
  if (!requirePrivileged(user?.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const db = c.env.DB;
  // Coerce before use: `parseInt('abc')` is NaN, and NaN in a LIMIT binding
  // is a D1 type error rather than a default.
  const pageRaw = parseInt(c.req.query('page') ?? '1', 10);
  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 200);
  const tableName = c.req.query('table');
  const offset = (page - 1) * limit;

  if (!(await syncTablesProvisioned(db))) {
    return c.json({ provisioned: false, conflicts: [], page, limit });
  }

  const whereClause = tableName ? 'WHERE table_name = ?' : '';
  const bindings = tableName ? [tableName, limit, offset] : [limit, offset];

  const rows = await db.prepare(
    `SELECT id, table_name, record_id, fz55_updated_at, cloud_updated_at,
            winning_source, resolved_at, sync_queue_id
     FROM sync_conflicts
     ${whereClause}
     ORDER BY resolved_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...bindings).all();

  return c.json({ provisioned: true, conflicts: rows.results, page, limit });
});

// POST /api/sync/replay — manual trigger (admin/manager only)
sync.post('/replay', async (c) => {
  const user = c.get('user');
  if (!requirePrivileged(user?.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (!(await syncTablesProvisioned(c.env.DB))) {
    return c.json(NOT_PROVISIONED, 503);
  }
  const result = await replayQueue(c.env.DB, c.env.JWT_SECRET ?? '');
  log.info('manual sync replay triggered', { ...result, userId: user.id });
  return c.json(result);
});

// POST /api/sync/enqueue — record a missed cloud write for later replay
sync.post('/enqueue', async (c) => {
  if (!(await syncTablesProvisioned(c.env.DB))) {
    return c.json(NOT_PROVISIONED, 503);
  }
  const body = await c.req.json<{ method: string; path: string; body?: string; headers?: string }>();
  const result = await c.env.DB.prepare(
    `INSERT INTO sync_queue (method, path, body, headers, created_at) VALUES (?,?,?,?,datetime('now'))`
  ).bind(body.method, body.path, body.body ?? null, body.headers ?? null).run();
  return c.json({ ok: true, id: result.meta.last_row_id });
});

export default sync;
