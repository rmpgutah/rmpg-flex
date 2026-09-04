// ============================================================
// RMPG Flex — analytics lakehouse query route (R2 SQL over Iceberg)
// ============================================================
// Read-only analytical queries against the ALPR plate-read history stored as
// Apache Iceberg tables in R2 Data Catalog (written by the dual-write in
// src/routes/alpr.ts via Cloudflare Pipelines). Queried with R2 SQL — a
// serverless engine that runs on Cloudflare's network with zero R2 egress.
//
// CONFIG (all optional; every data endpoint 503s until set, matching the
// app-wide "graceful when the binding is unset" convention):
//   • R2_ANALYTICS_WAREHOUSE  (var)    "<account_id>_<bucket>" from setup
//   • R2_SQL_TOKEN            (secret)  bearer w/ R2 SQL + Data Catalog + R2 read
//
// R2 SQL is READ-ONLY (no INSERT/UPDATE/DELETE), so there is no mutation risk;
// the worst a crafted query can do is read other tables in the SAME analytics
// warehouse. Purpose-built endpoints build their SQL server-side from validated
// params; the raw /query passthrough is gated to privileged roles.
// ============================================================

import { Hono } from 'hono';
import { log } from '../utils/logger';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireRole } from '../middleware/auth';
import { dbErrorResponse } from '../utils/dbErrors';
import { notConfigured } from '../utils/notConfigured';
import {
  parseWarehouse,
  extractRows,
  buildPlateHistorySql,
  buildAlprSummarySql,
  buildAlprDistinctCountSql,
  buildEventsSql,
  buildEventSummarySql,
  buildCfsTrendsSql,
  buildGpsCoverageSql,
  buildAuditSummarySql,
  cleanEventType,
  ANALYTICS_NAMESPACE,
  ALPR_TABLE,
  EVENTS_TABLE,
} from '../utils/analytics';

const analytics = new Hono<Env>();

// Reads: same field-operational roles that already see plate data in the app.
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');
// Raw passthrough: command staff only.
const privileged = requireRole('admin', 'manager', 'supervisor');

class R2SqlConfigError extends Error {}
class R2SqlHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Run one R2 SQL statement via the HTTP API. Throws R2SqlConfigError when the
 *  warehouse/token are unset and R2SqlHttpError on a non-2xx response. */
async function runR2Sql(env: Env['Bindings'], sql: string): Promise<Record<string, unknown>[]> {
  const warehouse = env.R2_ANALYTICS_WAREHOUSE;
  const token = env.R2_SQL_TOKEN;
  if (!warehouse || !token) {
    throw new R2SqlConfigError('analytics warehouse not configured');
  }
  const { accountId, bucket } = parseWarehouse(warehouse);
  const url = `https://api.sql.cloudflarestorage.com/api/v1/accounts/${accountId}/r2-sql/query/${bucket}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave null; handled below */ }

  if (!res.ok) {
    const j = json as { errors?: Array<{ message?: string }>; error?: string } | null;
    const msg = j?.errors?.map((e) => e?.message).filter(Boolean).join('; ')
      || j?.error
      || text.slice(0, 300)
      || `HTTP ${res.status}`;
    throw new R2SqlHttpError(msg, res.status);
  }
  return extractRows(json);
}

/** Map a thrown R2 SQL error to an HTTP response. */
function sqlErrorResponse(c: Context<Env>, err: unknown): Response {
  if (err instanceof R2SqlConfigError) {
    // 200 + { ok:false, skipped:true, code:'not_configured' } — NOT 503. The
    // R2 analytics warehouse is an optional, unprovisioned integration, which
    // is a stable configuration gap rather than an outage. Observed live on
    // 2026-07-30: six /api/analytics/* endpoints returned a hard 503 on the
    // Admin, CRM and several records pages. Because apiFetch RETRIES on 5xx
    // (see src/utils/notConfigured.ts), each one fired twice and produced a red
    // console error every time, so a missing secret read as a site outage.
    return notConfigured(
      c,
      'analytics warehouse not configured',
      { hint: 'Set R2_ANALYTICS_WAREHOUSE + the R2_SQL_TOKEN secret (see wrangler.toml).' },
    );
  }
  if (err instanceof R2SqlHttpError) {
    log.error('[analytics] R2 SQL error', { status: err.status, message: err.message });
    // An AUTH rejection from R2 SQL is a configuration state, not an outage:
    // the R2_SQL_TOKEN is missing scopes, expired, or was minted for a
    // different warehouse. Retrying cannot fix it, so it belongs on the same
    // not_configured path as an unset secret — otherwise apiFetch retries a
    // permanent failure and every analytics widget logs a red 500.
    //
    // Observed live 2026-07-31: a stale R2_SQL_TOKEN predating the lakehouse
    // build returned "Unauthenticated." Once R2_ANALYTICS_WAREHOUSE was set,
    // the config guard stopped short-circuiting (it requires BOTH values), so
    // six endpoints went from an honest 503 to a misleading 500 db_error.
    if (err.status === 401 || err.status === 403 || /unauthenticated|unauthorized|forbidden/i.test(err.message)) {
      return notConfigured(
        c,
        'analytics warehouse credentials rejected',
        { hint: 'R2_SQL_TOKEN is missing, expired, or lacks R2 SQL + R2 Data Catalog read on the analytics bucket. Re-mint it and run: npx wrangler secret put R2_SQL_TOKEN' },
      );
    }
    // A missing Iceberg table is likewise a not-yet-provisioned state: the
    // sinks/pipelines create the tables, so before they exist every query
    // legitimately has nothing to read.
    if (err.status === 404 || /not found|does not exist|no such table|unknown table/i.test(err.message)) {
      return notConfigured(
        c,
        'analytics tables not yet created',
        { hint: 'Run scripts/analytics/finish-lakehouse.sh to create the sinks + pipelines that materialize the Iceberg tables.' },
      );
    }
    // Anything else (5xx, malformed query, quota) is a real runtime failure.
    return dbErrorResponse(c, err, 'analytics query failed');
  }
  log.error('[analytics] unexpected error', {}, err instanceof Error ? err : new Error(String(err)));
  return c.json({ error: 'analytics query failed' }, 500);
}

function daysAgoIso(days: number): string {
  const d = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 3650) : 90;
  return new Date(Date.now() - d * 86_400_000).toISOString();
}

// ── Health / config probe (no secrets leaked) ────────────────
analytics.get('/health', operational, (c) => {
  return c.json({
    ok: true,
    engine: 'r2-sql',
    table: `${ANALYTICS_NAMESPACE}.${ALPR_TABLE}`,
    events_table: `${ANALYTICS_NAMESPACE}.${EVENTS_TABLE}`,
    pipeline_bound: !!c.env.ANALYTICS,
    events_pipeline_bound: !!c.env.EVENTS,
    warehouse_configured: !!c.env.R2_ANALYTICS_WAREHOUSE,
    token_configured: !!c.env.R2_SQL_TOKEN,
    // `query_ready` true ⇒ the read endpoints can serve; pipeline_bound false
    // just means ingestion isn't wired yet (the table may still have rows from
    // a backfill).
    query_ready: !!c.env.R2_ANALYTICS_WAREHOUSE && !!c.env.R2_SQL_TOKEN,
  });
});

// ── ALPR: everywhere a plate was seen ────────────────────────
// GET /api/analytics/alpr/plate/:plate?days=90&limit=500
analytics.get('/alpr/plate/:plate', operational, async (c) => {
  const raw = c.req.param('plate') ?? '';
  // Plates are alphanumerics + hyphen. Reject anything else BEFORE building SQL
  // (defence in depth alongside the builder's quote-escaping).
  const plate = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!plate || plate.length > 12) {
    return c.json({ error: 'invalid plate' }, 400);
  }
  const days = Number(c.req.query('days'));
  const limit = Number(c.req.query('limit'));
  const sinceIso = daysAgoIso(days);
  const sql = buildPlateHistorySql({ plate, sinceIso, limit: Number.isFinite(limit) ? limit : undefined });
  try {
    const rows = await runR2Sql(c.env, sql);
    return c.json({ plate, since: sinceIso, count: rows.length, sightings: rows });
  } catch (err) {
    return sqlErrorResponse(c, err);
  }
});

// ── ALPR: busiest plates in a window ─────────────────────────
// GET /api/analytics/alpr/summary?days=7&limit=100
analytics.get('/alpr/summary', operational, async (c) => {
  const days = Number(c.req.query('days'));
  const limit = Number(c.req.query('limit'));
  const sinceIso = daysAgoIso(Number.isFinite(days) ? days : 7);
  const sql = buildAlprSummarySql({ sinceIso, limit: Number.isFinite(limit) ? limit : undefined });
  try {
    const rows = await runR2Sql(c.env, sql);
    return c.json({ since: sinceIso, count: rows.length, plates: rows });
  } catch (err) {
    return sqlErrorResponse(c, err);
  }
});

// ── ALPR: true distinct-plate / distinct-hit-plate counts ────
// GET /api/analytics/alpr/distinct-count?days=7
// Unbounded by LIMIT, unlike /alpr/summary's top-N-by-volume rows — the
// client's "Distinct plates"/"Plates with a hit" cards previously derived
// these from summary.length, silently undercounting whenever more than
// (summary's limit, default 100) distinct plates existed in the window.
analytics.get('/alpr/distinct-count', operational, async (c) => {
  const days = Number(c.req.query('days'));
  const sinceIso = daysAgoIso(Number.isFinite(days) ? days : 7);
  const sql = buildAlprDistinctCountSql({ sinceIso });
  try {
    const rows = await runR2Sql(c.env, sql);
    const row = (rows[0] ?? {}) as Record<string, unknown>;
    return c.json({
      since: sinceIso,
      distinct_plates: Number(row.distinct_plates) || 0,
      distinct_hit_plates: Number(row.distinct_hit_plates) || 0,
    });
  } catch (err) {
    return sqlErrorResponse(c, err);
  }
});

// ── System-wide events: activity timeline ────────────────────
// GET /api/analytics/events?type=cfs_created&days=7&limit=200
analytics.get('/events', operational, async (c) => {
  const days = Number(c.req.query('days'));
  const limit = Number(c.req.query('limit'));
  const typeRaw = c.req.query('type') ?? '';
  const eventType = typeRaw ? cleanEventType(typeRaw) : undefined;
  const sinceIso = daysAgoIso(Number.isFinite(days) ? days : 7);
  const sql = buildEventsSql({ sinceIso, eventType, limit: Number.isFinite(limit) ? limit : undefined });
  try {
    const rows = await runR2Sql(c.env, sql);
    return c.json({ since: sinceIso, event_type: eventType ?? null, count: rows.length, events: rows });
  } catch (err) {
    return sqlErrorResponse(c, err);
  }
});

// ── System-wide events: volume by type ───────────────────────
// GET /api/analytics/events/summary?days=7
analytics.get('/events/summary', operational, async (c) => {
  const days = Number(c.req.query('days'));
  const sinceIso = daysAgoIso(Number.isFinite(days) ? days : 7);
  try {
    const rows = await runR2Sql(c.env, buildEventSummarySql({ sinceIso }));
    return c.json({ since: sinceIso, count: rows.length, types: rows });
  } catch (err) {
    return sqlErrorResponse(c, err);
  }
});

// ── Calls-for-service trends (by nature/priority) ────────────
// GET /api/analytics/cfs/trends?days=30
analytics.get('/cfs/trends', operational, async (c) => {
  const days = Number(c.req.query('days'));
  const sinceIso = daysAgoIso(Number.isFinite(days) ? days : 30);
  try {
    const rows = await runR2Sql(c.env, buildCfsTrendsSql({ sinceIso }));
    return c.json({ since: sinceIso, count: rows.length, call_types: rows });
  } catch (err) {
    return sqlErrorResponse(c, err);
  }
});

// ── Patrol / AVL coverage by unit (proof of patrol) ──────────
// GET /api/analytics/gps/coverage?days=7
analytics.get('/gps/coverage', operational, async (c) => {
  const days = Number(c.req.query('days'));
  const sinceIso = daysAgoIso(Number.isFinite(days) ? days : 7);
  try {
    const rows = await runR2Sql(c.env, buildGpsCoverageSql({ sinceIso }));
    return c.json({ since: sinceIso, count: rows.length, units: rows });
  } catch (err) {
    return sqlErrorResponse(c, err);
  }
});

// ── Audit / compliance: actions by volume ────────────────────
// GET /api/analytics/audit/summary?days=30   (timeline via /events?type=audit)
analytics.get('/audit/summary', operational, async (c) => {
  const days = Number(c.req.query('days'));
  const sinceIso = daysAgoIso(Number.isFinite(days) ? days : 30);
  try {
    const rows = await runR2Sql(c.env, buildAuditSummarySql({ sinceIso }));
    return c.json({ since: sinceIso, count: rows.length, actions: rows });
  } catch (err) {
    return sqlErrorResponse(c, err);
  }
});

// ── Raw passthrough (command staff only) ─────────────────────
// POST /api/analytics/query  { "query": "SELECT ... FROM default.alpr_reads ..." }
// R2 SQL is read-only; this exists for ad-hoc exploration without a redeploy.
analytics.post('/query', privileged, async (c) => {
  let body: { query?: unknown };
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'invalid JSON body' }, 400); }

  const sql = typeof body.query === 'string' ? body.query.trim() : '';
  if (!sql) return c.json({ error: 'missing "query"' }, 400);
  if (sql.length > 8000) return c.json({ error: 'query too long' }, 400);
  // Belt-and-suspenders: R2 SQL has no write grammar, but reject obvious
  // mutation attempts early so the intent of this endpoint stays read-only.
  if (/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|MERGE|TRUNCATE)\b/i.test(sql)) {
    return c.json({ error: 'read-only: only SELECT/SHOW/DESCRIBE are allowed' }, 400);
  }
  try {
    const rows = await runR2Sql(c.env, sql);
    return c.json({ count: rows.length, rows });
  } catch (err) {
    return sqlErrorResponse(c, err);
  }
});

export default analytics;
