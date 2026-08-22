// ============================================================
// RMPG Flex — Fleet.io integration routes
// ============================================================
// Mounted at /api/fleetio (auth: 'required'). All routes require an
// authenticated user; the heavy-write endpoints (seed) additionally
// require the `admin` role.
//
// PR 1 exposes:
//   GET  /test-connection   Any authed user. Returns { ok, account_id, account_name } or { ok:false, error }.
//   GET  /sync-status       Admin. Returns counts from fleetio_links / fleetio_events / fleetio_conflicts.
//   POST /seed              Admin. Pushes every fleet_vehicles row that lacks a fleetio_links entry into Fleet.io.
//   POST /pull               Admin. Reconciles Fleet.io's existing vehicle roster into fleet_vehicles
//                            (matches by VIN/plate/name, links rather than duplicates, creates what's new).
//   POST /seed-vendors       Admin. Same as /seed, for ref_vendors.
//   POST /seed-parts         Admin. Same as /seed, for fleet_parts.
//
// PR 4 adds:
//   POST /webhook           Fleet.io webhook receiver (HMAC-verified inbound).
//                           Auth bypass for this exact path lives in
//                           src/middleware/auth.ts (isPublicAuthBypass).
// ============================================================

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, chunkBindings } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { configFromEnv, createVehicle, listAllVehicles, listAllFuelEntries, createVendor, createPart, ping } from '../utils/fleetio/client';
import { FLEETIO_LINK_RESOURCE, RMPG_TABLE_TO_KIND, acceptedLinkResources } from '../utils/fleetio/resources';
import { getOwnership } from '../utils/fleetio/ownership';
import { FleetioConfigError, FleetioError } from '../utils/fleetio/errors';
import { buildVehiclePayload } from '../utils/fleetio/seed';
import { matchLocalVehicle, buildLocalInsertFromFleetio, decideMatchAction, buildFuelLogInsertFromFleetio, type LocalVehicleForMatch, type PullOutcome } from '../utils/fleetio/pull';
import type { RmpgFleetVehicleRow, SeedOutcome, SeedSummary } from '../utils/fleetio/types';
import { recordAudit } from '../utils/auditLog';
import fleetioWebhook from './fleetioWebhook';
import { rmpgTableToResource, getQueueHealth, isPermanentFailureMessage, PACE_MS, pace, coerceScalarForD1 } from '../utils/fleetio/sync';
import { emitFleetioEvent, type FleetioEmitKind } from '../utils/fleetio/events';

const fleetio = new Hono<Env>();

// PACE_MS / pace live in src/utils/fleetio/sync.ts (shared with the
// applyOutbound drain). Self-imposed pacing — Fleet.io limits are
// plan-dependent (no fixed published number).

// Mount the PR 4 webhook subrouter at the bare /webhook path. The bypass
// in src/middleware/auth.ts lets the request through without a JWT; the
// route handler verifies the inbound Authorization header equals
// FLEETIO_WEBHOOK_SECRET (Fleet.io's actual scheme, per PR 4c rewrite).
fleetio.route('/', fleetioWebhook);

/** Lightweight reachability + auth check. Any authed user can call it (admins
 *  need it during setup; ops staff need it for troubleshooting). */
fleetio.get('/test-connection', async (c) => {
  let config;
  try {
    config = configFromEnv(c.env as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof FleetioConfigError) {
      return c.json({ ok: false, error: err.message, code: 'not_configured' }, 503);
    }
    throw err;
  }
  const r = await ping({ config });
  return c.json(r, r.ok ? 200 : 502);
});

/** Counts only — no payloads. Useful as a smoke test post-deploy. */
/** Richer Fleet.io integration health snapshot for the admin dashboard
 *  (PR 4b). Covers what an operator needs at-a-glance:
 *    - Queue depth (pending) + retry-attempt distribution
 *    - Recent events timeline (last 20 across both directions)
 *    - Unresolved conflicts list (top 20) with full payload context
 *    - Last-received inbound timestamp (alert if > 2h during business hours)
 *    - Per-resource breakdown so a stuck queue's resource is obvious
 */
fleetio.get('/health', requireRole('admin'), async (c) => {
  const db = getDb(c.env);
  try {
    const [
      links,
      eventCounts,
      lastInbound,
      lastOutboundOk,
      lastOutboundFail,
      attemptHistogram,
      recentEvents,
      unresolvedConflicts,
      byResource,
    ] = await Promise.all([
      queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM fleetio_links'),
      query<{ direction: string; status: string; n: number }>(
        db,
        `SELECT direction, status, COUNT(*) AS n FROM fleetio_events GROUP BY direction, status`,
      ),
      queryFirst<{ created_at: string }>(
        db,
        `SELECT created_at FROM fleetio_events WHERE direction='inbound' ORDER BY id DESC LIMIT 1`,
      ),
      queryFirst<{ processed_at: string }>(
        db,
        `SELECT processed_at FROM fleetio_events WHERE direction='outbound' AND status='completed' ORDER BY id DESC LIMIT 1`,
      ),
      queryFirst<{ created_at: string; error: string | null }>(
        db,
        `SELECT created_at, error FROM fleetio_events WHERE status='failed' ORDER BY id DESC LIMIT 1`,
      ),
      query<{ attempts: number; n: number }>(
        db,
        `SELECT attempts, COUNT(*) AS n FROM fleetio_events WHERE status='pending' GROUP BY attempts ORDER BY attempts`,
      ),
      query<Record<string, unknown>>(
        db,
        `SELECT id, direction, event_id, resource, action, status, attempts, error, created_at, processed_at
         FROM fleetio_events ORDER BY id DESC LIMIT 20`,
      ),
      query<Record<string, unknown>>(
        db,
        `SELECT id, rmpg_table, rmpg_id, field, local_value, remote_value, resolution, created_at
         FROM fleetio_conflicts WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 20`,
      ),
      query<{ resource: string; status: string; n: number }>(
        db,
        `SELECT resource, status, COUNT(*) AS n FROM fleetio_events GROUP BY resource, status`,
      ),
    ]);
    // Derive "secrets configured" without leaking values — read the env keys.
    const env = c.env as unknown as Record<string, unknown>;
    const secrets_configured = {
      FLEETIO_API_KEY: Boolean(env.FLEETIO_API_KEY),
      FLEETIO_ACCOUNT_TOKEN: Boolean(env.FLEETIO_ACCOUNT_TOKEN),
      FLEETIO_WEBHOOK_SECRET: Boolean(env.FLEETIO_WEBHOOK_SECRET),
    };
    return c.json({
      links_total: links?.n ?? 0,
      secrets_configured,
      event_counts: eventCounts,
      attempt_histogram: attemptHistogram,
      last_inbound_at: lastInbound?.created_at ?? null,
      last_outbound_completed_at: lastOutboundOk?.processed_at ?? null,
      last_failure: lastOutboundFail ? {
        created_at: lastOutboundFail.created_at,
        error: lastOutboundFail.error,
      } : null,
      recent_events: recentEvents,
      unresolved_conflicts: unresolvedConflicts,
      by_resource: byResource,
    });
  } catch (err) {
    console.error('[fleetio.health] failed', err);
    return c.json({
      error: 'Failed to load Fleet.io health',
      detail: (err as Error)?.message,
      links_total: 0, secrets_configured: { FLEETIO_API_KEY: false, FLEETIO_ACCOUNT_TOKEN: false, FLEETIO_WEBHOOK_SECRET: false },
      event_counts: [], attempt_histogram: [],
      last_inbound_at: null, last_outbound_completed_at: null, last_failure: null,
      recent_events: [], unresolved_conflicts: [], by_resource: [],
    }, 500);
  }
});

/** Requeue a dead-lettered outbound event (status='failed', attempts exhausted
 *  at maxAttempts()) so the next reconciliation cron tick retries it. Needed
 *  because attempts < maxAttempts() is a hard SELECT filter in applyOutbound
 *  — once an event hits 'failed' it never retries on its own, even after the
 *  underlying bug (e.g. a bad payload mapping) is fixed server-side. Admin
 *  only; only resets rows already in 'failed' state. */
fleetio.post('/events/:id{[0-9]+}/retry', requireRole('admin'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '0', 10);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);

  // Refuse to re-arm a PERMANENT failure. A 4xx is Fleet.io's verdict on the
  // payload, so replaying it burns the retry budget and re-pages an operator
  // for a rejection that was correct every time — the loop observed live on
  // 2026-08-01 with fuel_entry event id=23. The fix for one of these is to
  // correct the source record in RMPG, which emits a fresh event naturally.
  const existing = await queryFirst<{ status: string; error: string | null }>(
    db,
    `SELECT status, error FROM fleetio_events WHERE id = ?`,
    id,
  );
  if (!existing || existing.status !== 'failed') {
    return c.json({ error: 'Event not found or not in failed state' }, 404);
  }
  if (isPermanentFailureMessage(existing.error)) {
    return c.json({
      error: 'This event failed permanently and cannot be retried — Fleet.io rejected the data itself. Correct the source record in RMPG; saving it queues a fresh event.',
      code: 'permanent_failure',
      reason: existing.error,
    }, 409);
  }

  const result = await execute(
    db,
    `UPDATE fleetio_events SET status = 'pending', attempts = 0, error = NULL
     WHERE id = ? AND status = 'failed'`,
    id,
  );
  if (!result.meta?.changes) {
    return c.json({ error: 'Event not found or not in failed state' }, 404);
  }
  return c.json({ success: true, id });
});

/** List unresolved conflicts, optionally filtered by table / id. Auth: required
 *  (not admin-only) so fleet V2 pages can show conflict badges for non-admin
 *  users. Supports `?table=fleet_vehicles&ids=1,2,3` to filter multiple rows. */
fleetio.get('/conflicts', async (c) => {
  const db = getDb(c.env);
  const table = c.req.query('table');
  const id = c.req.query('id');
  const ids = c.req.query('ids');

  const select = `SELECT id, rmpg_table, rmpg_id, field, local_value, remote_value, resolution, created_at
                  FROM fleetio_conflicts WHERE resolved_at IS NULL`;
  const RESULT_LIMIT = 50;

  // ── Single-id and no-filter forms: one query, bounded bindings ──
  if (!ids || id) {
    let sql = select;
    const bindings: unknown[] = [];
    if (table) { sql += ' AND rmpg_table = ?'; bindings.push(table); }
    if (id) { sql += ' AND rmpg_id = ?'; bindings.push(parseInt(id, 10)); }
    sql += ` ORDER BY id DESC LIMIT ${RESULT_LIMIT}`;
    const rows = await query<Record<string, unknown>>(db, sql, ...bindings);
    return c.json({ conflicts: rows, count: rows.length });
  }

  // ── Multi-id form: MUST be chunked ──
  // 🔴 D1 caps a query at 100 BOUND PARAMETERS
  // (developers.cloudflare.com/d1/platform/limits). This route built one
  // `rmpg_id IN (?,?,…)` list sized by however many rows the caller was
  // rendering, so the query's shape grew with the dataset: FleetFuelTab asking
  // about 109 fuel rows sent 110 bindings (1 table + 109 ids), D1 rejected the
  // statement before executing it, and the request 500'd. Observed live
  // 2026-07-26 — four retries, then the conflict badges silently never loaded.
  // It never reached `error_log` either, because D1 rejects at bind time inside
  // query() rather than throwing from the route body into the global onError.
  //
  // Chunk size comes from chunkBindings (src/utils/db.ts), which owns the cap —
  // `reservedBindings` accounts for the optional `table` filter so the IN-list
  // can never squeeze it out of the budget.
  const parsed = Array.from(new Set(
    ids.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0),
  ));
  if (parsed.length === 0) {
    return c.json({ conflicts: [], count: 0 });
  }

  const chunks = chunkBindings(parsed, table ? 1 : 0);

  const results = await Promise.all(chunks.map((chunk) => {
    let sql = select;
    const bindings: unknown[] = [];
    if (table) { sql += ' AND rmpg_table = ?'; bindings.push(table); }
    sql += ` AND rmpg_id IN (${chunk.map(() => '?').join(',')})`;
    bindings.push(...chunk);
    // Per-chunk LIMIT matches the overall one: no single chunk can contribute
    // more rows than the caller will ever be shown, but the merge below is what
    // actually enforces the response size.
    sql += ` ORDER BY id DESC LIMIT ${RESULT_LIMIT}`;
    return query<Record<string, unknown>>(db, sql, ...bindings);
  }));

  // Merge, then re-sort and truncate globally — a per-chunk limit alone would
  // bias the result toward whichever chunk happened to be queried, so the
  // ordering contract (newest first) has to be re-established after the merge.
  const merged = results.flat()
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, RESULT_LIMIT);

  return c.json({ conflicts: merged, count: merged.length });
});

/** Resolve a single conflict by id with a chosen resolution.
 *
 *  Previously this ONLY flagged a resolution — it never re-applied the
 *  chosen value anywhere, so picking "remote_wins" left the local row
 *  untouched and picking "local_wins" never pushed the local value back
 *  to Fleet.io. Now:
 *    - remote_wins: writes `remote_value` into the local table/field.
 *    - local_wins:  re-reads the CURRENT local value and queues a fresh
 *                   outbound event so the reconciliation cron pushes it
 *                   back to Fleet.io (overwriting whatever it has).
 *    - manual:      no auto-apply — an admin already resolved it by hand
 *                   elsewhere; this just clears the badge. */
fleetio.post('/conflicts/:id{[0-9]+}/resolve', requireRole('admin'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '0', 10);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ resolution?: string }>().catch(() => ({} as { resolution?: string }));
  const valid = new Set(['local_wins', 'remote_wins', 'manual']);
  if (!body.resolution || !valid.has(body.resolution)) {
    return c.json({ error: 'resolution must be one of: local_wins, remote_wins, manual', code: 'INVALID_RESOLUTION' }, 400);
  }
  const userId = (c.get('userId') as number | undefined) ?? null;
  const db = getDb(c.env);

  const conflict = await queryFirst<{ id: number; rmpg_table: string; rmpg_id: number; field: string; remote_value: string | null }>(
    db,
    `SELECT id, rmpg_table, rmpg_id, field, remote_value FROM fleetio_conflicts WHERE id = ? AND resolved_at IS NULL`,
    id,
  );
  if (!conflict) return c.json({ error: 'Conflict not found or already resolved' }, 404);

  // `rmpg_table` and `field` are interpolated as SQL IDENTIFIERS below (they
  // can't be bound as parameters). Both are written by our own code today —
  // resourceToRmpgTable() and the ownership maps — so neither is raw user
  // input. Validate anyway: this is the only place in the integration where a
  // stored string reaches the SQL text, and "a table/column name that came out
  // of the database" is exactly the assumption that quietly stops holding when
  // someone adds a new writer. An unknown identifier means the row is
  // malformed, so refuse rather than execute.
  const conflictKind = RMPG_TABLE_TO_KIND[conflict.rmpg_table];
  if (!conflictKind) {
    return c.json({ error: 'Conflict references an unsupported table', code: 'UNSUPPORTED_TABLE' }, 422);
  }
  // The field check is scoped to the branches that WRITE the field, not applied
  // up front: recordPullConflict files rows with field='fleetio_id', which is a
  // link-collision marker rather than a real column, and an admin must still be
  // able to clear those with resolution='manual'.
  const fieldIsRealColumn = getOwnership(conflictKind, conflict.field) !== null;

  let applied: 'remote_applied' | 'outbound_requeued' | 'none' = 'none';
  try {
    if (body.resolution === 'remote_wins') {
      if (!fieldIsRealColumn) {
        return c.json({
          error: `Cannot auto-apply the remote value for field '${conflict.field}' — it is not a synced column on ${conflict.rmpg_table}. Resolve this conflict manually.`,
          code: 'UNSUPPORTED_FIELD',
        }, 422);
      }
      let remoteValue: unknown = null;
      try { remoteValue = conflict.remote_value ? JSON.parse(conflict.remote_value) : null; } catch { /* leave null */ }
      // D1 bind() throws on objects/arrays; store non-scalars as their JSON
      // text (same convention as applyInbound's coerceScalarForD1).
      remoteValue = coerceScalarForD1(remoteValue);
      await execute(db,
        `UPDATE ${conflict.rmpg_table} SET ${conflict.field} = ?, updated_at = datetime('now') WHERE id = ?`,
        remoteValue, conflict.rmpg_id);
      applied = 'remote_applied';
    } else if (body.resolution === 'local_wins') {
      const mapping = rmpgTableToResource(conflict.rmpg_table);
      if (mapping && fieldIsRealColumn) {
        const current = await queryFirst<Record<string, unknown>>(
          db, `SELECT ${conflict.field} AS v FROM ${conflict.rmpg_table} WHERE id = ?`, conflict.rmpg_id,
        );
        await emitFleetioEvent(
          c, mapping.updateKind as FleetioEmitKind,
          { [conflict.field]: current?.v ?? null },
          { rmpgTable: conflict.rmpg_table, rmpgId: conflict.rmpg_id, versionToken: `conflict-resolve-${conflict.id}-${Date.now()}` },
        );
        applied = 'outbound_requeued';
      }
    }
  } catch (err) {
    console.error('[fleetio.conflicts.resolve] failed to apply resolution', { id, resolution: body.resolution, err });
    return c.json({ error: 'Failed to apply resolution', detail: (err as Error)?.message }, 500);
  }

  await execute(db,
    `UPDATE fleetio_conflicts
     SET resolution = ?, resolved_by = ?, resolved_at = datetime('now')
     WHERE id = ? AND resolved_at IS NULL`,
    body.resolution, userId, id);
  return c.json({ success: true, id, resolution: body.resolution, applied });
});

/** Fleet.io sync-health analytics for the fleet analytics dashboard.
 *  Distinct from /health (which is the raw admin troubleshooting dump):
 *  this is pre-aggregated for charting — link coverage %, a 14-day
 *  conflict trend, and outbound completion latency by resource. Any
 *  authed user (read-only, no secrets, matches /conflicts' access level). */
fleetio.get('/analytics', async (c) => {
  const db = getDb(c.env);
  try {
    const [linkCoverage, conflictTrend, latencyByResource, conflictsByResolution] = await Promise.all([
      // Link coverage: how many rows per synced RMPG table have a
      // fleetio_links entry vs the table's total row count.
      query<{ rmpg_table: string; linked: number }>(
        db, `SELECT rmpg_table, COUNT(*) AS linked FROM fleetio_links GROUP BY rmpg_table`,
      ),
      query<{ day: string; n: number }>(
        db,
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
         FROM fleetio_conflicts
         WHERE created_at >= datetime('now', '-14 days')
         GROUP BY day ORDER BY day`,
      ),
      // Average seconds from queue to completion, per resource — the
      // throughput/latency signal for "is sync keeping up."
      query<{ resource: string; avg_seconds: number; n: number }>(
        db,
        `SELECT resource,
                AVG((julianday(processed_at) - julianday(created_at)) * 86400) AS avg_seconds,
                COUNT(*) AS n
         FROM fleetio_events
         WHERE direction = 'outbound' AND status = 'completed' AND processed_at IS NOT NULL
           AND created_at >= datetime('now', '-30 days')
         GROUP BY resource`,
      ),
      query<{ resolution: string; n: number }>(
        db, `SELECT resolution, COUNT(*) AS n FROM fleetio_conflicts WHERE resolved_at IS NOT NULL GROUP BY resolution`,
      ),
    ]);
    const totalsByTable: Record<string, string> = {
      fleet_vehicles: 'fleet_vehicles', ref_vendors: 'ref_vendors', fleet_parts: 'fleet_parts',
    };
    const totals = await Promise.all(
      Object.values(totalsByTable).map((t) => queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${t}`)),
    );
    const totalMap: Record<string, number> = {};
    Object.keys(totalsByTable).forEach((t, i) => { totalMap[t] = totals[i]?.n ?? 0; });
    const link_coverage = Object.keys(totalsByTable).map((table) => {
      const linked = linkCoverage.find((r) => r.rmpg_table === table)?.linked ?? 0;
      const total = totalMap[table] ?? 0;
      return { rmpg_table: table, linked, total, coverage_pct: total > 0 ? Math.round((linked / total) * 1000) / 10 : 0 };
    });
    return c.json({
      link_coverage,
      conflict_trend_14d: conflictTrend,
      latency_by_resource: latencyByResource,
      conflicts_by_resolution: conflictsByResolution,
    });
  } catch (err) {
    console.error('[fleetio.analytics] failed', err);
    return c.json({ error: 'Failed to load Fleet.io analytics', detail: (err as Error)?.message }, 500);
  }
});

fleetio.get('/sync-status', requireRole('admin'), async (c) => {
  const db = getDb(c.env);
  const [links, eventsPending, eventsFailed, conflicts, queueHealth] = await Promise.all([
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM fleetio_links'),
    queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM fleetio_events WHERE direction='outbound' AND status='pending'"),
    queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM fleetio_events WHERE status='failed'"),
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM fleetio_conflicts WHERE resolved_at IS NULL'),
    // Same query the cron alert (isFleetioQueueUnhealthy) uses — reused here
    // (rather than a hand-rolled 6th parallel query) so the outbound-failed
    // count and the oldest-pending timestamp can never drift from the
    // worker-side "unhealthy" definition.
    getQueueHealth(db),
  ]);
  return c.json({
    links_total: links?.n ?? 0,
    outbound_pending: eventsPending?.n ?? 0,
    // Legacy all-directions failed count — kept for backward compatibility
    // with other consumers of this field. The "unhealthy" threshold does
    // NOT use this; see outbound_failed_total below.
    failed_total: eventsFailed?.n ?? 0,
    // The failed count the "unhealthy" badge threshold actually applies to —
    // matches the worker-side getQueueHealth()/isFleetioQueueUnhealthy()
    // definition (outbound-only) exactly, so the dashboard and the cron
    // alert can't disagree.
    outbound_failed_total: queueHealth.failedTotal,
    conflicts_unresolved: conflicts?.n ?? 0,
    oldest_pending_created_at: queueHealth.oldestPendingCreatedAt,
  });
});

/** Push every fleet_vehicles row that doesn't yet have a fleetio_links entry
 *  to Fleet.io. Idempotent: re-running skips already-linked rows. Returns a
 *  per-row outcome summary so the operator can see exactly what changed.
 *
 *  Body: { dry_run?: boolean }   (default false; true returns the would-be
 *                                  payloads without calling Fleet.io)
 *
 *  Admin only. Times out at ~25 s (Worker hard limit ~30 s for non-stream
 *  responses; large fleets should call repeatedly with limit param below). */
fleetio.post('/seed', requireRole('admin'), async (c) => {
  let config;
  try {
    config = configFromEnv(c.env as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof FleetioConfigError) {
      return c.json({ ok: false, error: err.message, code: 'not_configured' }, 503);
    }
    throw err;
  }

  const body = await c.req.json().catch(() => ({} as { dry_run?: boolean; limit?: number }));
  const dryRun = !!body.dry_run;
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

  const db = getDb(c.env);

  // Pull unlinked rows. LEFT JOIN over fleetio_links keeps already-pushed
  // vehicles out of the work-set automatically.
  const rows = await query<RmpgFleetVehicleRow>(
    db,
    `SELECT v.id, v.vehicle_name, v.vehicle_number, v.vin, v.plate_number,
            v.year, v.make, v.model, v.color
     FROM fleet_vehicles v
     LEFT JOIN fleetio_links l
       ON l.rmpg_table='fleet_vehicles' AND l.rmpg_id=v.id
     WHERE l.id IS NULL AND COALESCE(v.archived_at, '') = ''
     ORDER BY v.id ASC
     LIMIT ?`,
    limit,
  );

  // Paced via the shared PACE_MS above. For 18 vehicles that's ~22 s, well
  // under the Worker's 30 s response deadline. If `limit` is set high (200
  // max), call /seed repeatedly rather than in one long request — each
  // invocation auto-skips already-linked rows.
  const outcomes: SeedOutcome[] = [];
  let firstWrite = true;
  for (const row of rows) {
    const payload = buildVehiclePayload(row);
    if (!payload) {
      outcomes.push({ rmpg_id: row.id, status: 'skipped_no_name' });
      continue;
    }
    if (dryRun) {
      // Pretend it would have created with id=0; dry_run is for previewing
      // payloads only. No Fleet.io call → no pacing needed.
      outcomes.push({ rmpg_id: row.id, status: 'created', fleetio_id: 0 });
      continue;
    }
    if (!firstWrite) await pace(PACE_MS);
    firstWrite = false;
    try {
      const created = await createVehicle({ config, payload });
      // INSERT OR IGNORE, not a bare INSERT. The remote vehicle already exists
      // at this point, so a throw here (unique-index collision from a
      // concurrent /pull, or transient D1 failure) would surface as an 'error'
      // outcome while leaving an UNLINKED remote vehicle behind — which the
      // next /seed run then creates a SECOND copy of, since its LEFT JOIN still
      // sees the local row as unlinked. Swallowing the duplicate keeps the
      // create-then-link pair effectively idempotent.
      const linked = await execute(
        db,
        `INSERT OR IGNORE INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        'fleet_vehicles', row.id, FLEETIO_LINK_RESOURCE.vehicle, created.id,
      );
      if (!linked.meta?.changes) {
        // A link row already existed for this local vehicle (or this Fleet.io
        // id). The remote create still happened, so report it rather than
        // letting a silent no-op read as a clean link.
        console.warn('[fleetio.seed] created Fleet.io vehicle but a link row already existed', { rmpg_id: row.id, fleetio_id: created.id });
      }
      outcomes.push({ rmpg_id: row.id, status: 'created', fleetio_id: created.id });
    } catch (err) {
      // err.message is safe (fixed-format `Fleet.io ${status}` or
      // `FLEETIO_* is unset` — pinned by Task 5.5 tests). NEVER append
      // err.detail here — it can contain Fleet.io's raw response body
      // which may echo the request and leak credentials.
      const message = err instanceof FleetioError
        ? `${err.name}: ${err.message}`
        : err instanceof Error ? err.message : String(err);
      outcomes.push({ rmpg_id: row.id, status: 'error', error: message });
    }
  }

  const summary: SeedSummary = {
    total: outcomes.length,
    created: outcomes.filter((o) => o.status === 'created').length,
    already_linked: 0, // unreachable in this LEFT-JOIN-filtered query; preserved for shape
    skipped: outcomes.filter((o) => o.status === 'skipped_no_name').length,
    errors: outcomes.filter((o) => o.status === 'error').length,
    outcomes,
  };

  if (!dryRun) {
    await recordAudit(c, {
      action: 'FLEETIO_SEED',
      entityType: 'fleetio',
      details: { ...summary, outcomes: undefined, sample: outcomes.slice(0, 5) },
    });
  }

  return c.json({ ok: true, dry_run: dryRun, ...summary });
});

/**
 * Records a skipped_conflict as an unresolved fleetio_conflicts row instead
 * of only a transient outcome — otherwise it's permanent (the local row
 * never becomes eligible to link, so every future /pull re-skips it) yet
 * invisible outside the 10-item audit sample. Surfacing it here means it
 * shows up in GET /fleetio/health's unresolved_conflicts, same as any other
 * conflict, so an admin can actually act on it (e.g. archive/rename one of
 * the colliding local rows, or resolve manually).
 */
async function recordPullConflict(
  db: D1Database,
  rmpgId: number,
  existingFleetioId: number | null,
  collidingFleetioId: number,
): Promise<void> {
  // The situation this records is permanent until an admin resolves it — the
  // local row never becomes eligible to link, so every subsequent /pull
  // re-detects the exact same collision. Without the WHERE NOT EXISTS guard,
  // that means a fresh unresolved row per pull run for the same (rmpg_id,
  // colliding fleetio_id) pair, growing unbounded (no unique index covers
  // this on fleetio_conflicts — see migrations/0133).
  await execute(
    db,
    `INSERT INTO fleetio_conflicts (rmpg_table, rmpg_id, field, local_value, remote_value)
     SELECT 'fleet_vehicles', ?, 'fleetio_id', ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM fleetio_conflicts
       WHERE rmpg_table='fleet_vehicles' AND rmpg_id=? AND field='fleetio_id'
         AND remote_value=? AND resolved_at IS NULL
     )`,
    rmpgId,
    existingFleetioId !== null ? String(existingFleetioId) : null,
    String(collidingFleetioId),
    rmpgId,
    String(collidingFleetioId),
  );
}

/**
 * POST /pull — Admin. Reconciles RMPG's fleet_vehicles against Fleet.io's
 * existing vehicle roster, in the opposite direction from /seed.
 *
 * /seed assumes RMPG is the system of record and blind-creates in Fleet.io,
 * which 422s for any vehicle Fleet.io already has (e.g. entered there
 * directly before this integration existed — Fleet.io predates it as the
 * operator's fleet-management tool). /pull fetches Fleet.io's full roster
 * first and, per vehicle:
 *   - already in fleetio_links (by fleetio_id)   -> already_linked, no-op
 *   - matches a local row by VIN/plate/name       -> linked_existing (just
 *     inserts the fleetio_links row; never overwrites local field values)
 *   - matches nothing locally                     -> created (inserts a new
 *     fleet_vehicles row from Fleet.io's data + links it)
 *   - Fleet.io-archived                            -> skipped_archived
 *   - no usable name to seed a new row with        -> skipped_no_name
 *   - matches a local row already linked to a       -> skipped_conflict
 *     DIFFERENT Fleet.io vehicle (would violate      (recorded into
 *     fleetio_links' unique index)                   fleetio_conflicts,
 *                                                      not just skipped)
 *
 * Linking existing vehicles here is what actually fixes /seed's 422s: its
 * LEFT JOIN over fleetio_links will skip them on the next run.
 */
fleetio.post('/pull', requireRole('admin'), async (c) => {
  let config;
  try {
    config = configFromEnv(c.env as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof FleetioConfigError) {
      return c.json({ ok: false, error: err.message, code: 'not_configured' }, 503);
    }
    throw err;
  }

  const db = getDb(c.env);
  // Accept the legacy singular `fleetio_resource` spellings alongside the
  // canonical plural ones. Links written by the pre-canonicalization sync
  // engine used 'vehicle'/'fuel_entry', and a strict `='vehicles'` filter (what
  // this route used to have) made those rows invisible here — so /pull
  // re-processed already-linked vehicles every run and its fuel phase skipped
  // them entirely. migration 0206 normalizes the stored values; this keeps the
  // route correct during the rollout window and for any row an older bundle
  // writes mid-deploy.
  const vehicleLinkResources = acceptedLinkResources('vehicle');
  const fuelLinkResources = acceptedLinkResources('fuel_entry');
  const locals = await query<LocalVehicleForMatch>(
    db, `SELECT id, vin, plate_number, vehicle_number, vehicle_name FROM fleet_vehicles WHERE COALESCE(archived_at, '') = ''`,
  );
  const existingLinks = await query<{ fleetio_id: number; rmpg_id: number }>(
    db,
    `SELECT fleetio_id, rmpg_id FROM fleetio_links
     WHERE rmpg_table='fleet_vehicles' AND fleetio_resource IN (${vehicleLinkResources.map(() => '?').join(',')})`,
    ...vehicleLinkResources,
  );
  const alreadyLinkedIds = new Set(existingLinks.map((r) => r.fleetio_id));
  // Tracks every rmpg_id that now has (or will have, within this run) a
  // fleetio_links row — guards the UNIQUE(rmpg_table, rmpg_id) index, since
  // more than one Fleet.io vehicle can otherwise match the same local row
  // (duplicate VIN/plate/name, or a row already linked from an earlier run).
  const linkedRmpgIds = new Set(existingLinks.map((r) => r.rmpg_id));
  // rmpg_id -> the fleetio_id it's linked to, so a conflict row can record
  // *which* Fleet.io vehicle already owns the local row (not just that one
  // exists) — otherwise an admin resolving fleetio_conflicts has no idea
  // what the collision even was.
  const linkedFleetioIdByRmpgId = new Map(existingLinks.map((r) => [r.rmpg_id, r.fleetio_id]));

  const outcomes: PullOutcome[] = [];
  let vehiclesTruncated = false;
  try {
    // Fetch the WHOLE roster first, across every page, under whichever
    // pagination contract the API key's version uses (see iterateList /
    // FleetioListPage). The previous hand-rolled `do { … } while (page <=
    // resp.pagination.total_pages)` read a body field neither Fleet.io contract
    // emits, so `total_pages` was always undefined, the loop always exited after
    // one iteration, and any fleet beyond the first 100 vehicles was silently
    // never reconciled.
    //
    // `onPage` paces between page requests at the same 1.2 s the /seed route
    // uses (Fleet.io's account ceiling is 50 req/min) — /pull previously paced
    // nothing at all, so a multi-page roster plus a per-vehicle fuel fetch for
    // every linked vehicle blew straight through the limit and the resulting 429
    // aborted the entire reconcile with a 502.
    const roster = await listAllVehicles({
      config, perPage: 100, onPage: () => pace(PACE_MS),
    });
    vehiclesTruncated = roster.truncated;
    {
      for (const fioVehicle of roster.records) {
        if (alreadyLinkedIds.has(fioVehicle.id)) {
          outcomes.push({ fleetio_id: fioVehicle.id, status: 'already_linked', rmpg_id: -1 });
          continue;
        }
        if (fioVehicle.archived_at) {
          outcomes.push({ fleetio_id: fioVehicle.id, status: 'skipped_archived' });
          continue;
        }
        const match = matchLocalVehicle(fioVehicle, locals);
        if (match) {
          if (decideMatchAction(match.id, linkedRmpgIds) === 'conflict') {
            await recordPullConflict(db, match.id, linkedFleetioIdByRmpgId.get(match.id) ?? null, fioVehicle.id);
            outcomes.push({ fleetio_id: fioVehicle.id, status: 'skipped_conflict', rmpg_id: match.id });
            continue;
          }
          await execute(
            db,
            `INSERT OR IGNORE INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at)
             VALUES ('fleet_vehicles', ?, ?, ?, datetime('now'))`,
            match.id, FLEETIO_LINK_RESOURCE.vehicle, fioVehicle.id,
          );
          linkedRmpgIds.add(match.id);
          linkedFleetioIdByRmpgId.set(match.id, fioVehicle.id);
          outcomes.push({ fleetio_id: fioVehicle.id, status: 'linked_existing', rmpg_id: match.id });
          continue;
        }
        const insertRow = buildLocalInsertFromFleetio(fioVehicle);
        if (!insertRow) {
          outcomes.push({ fleetio_id: fioVehicle.id, status: 'skipped_no_name' });
          continue;
        }
        const dup = await queryFirst<{ id: number }>(
          db, 'SELECT id FROM fleet_vehicles WHERE vehicle_number = ?', insertRow.vehicle_number,
        );
        if (dup) {
          // vehicle_number collision the name-based match above missed
          // (e.g. differing VIN/plate casing) — link rather than error,
          // unless that row is already linked to a different Fleet.io vehicle.
          if (decideMatchAction(dup.id, linkedRmpgIds) === 'conflict') {
            await recordPullConflict(db, dup.id, linkedFleetioIdByRmpgId.get(dup.id) ?? null, fioVehicle.id);
            outcomes.push({ fleetio_id: fioVehicle.id, status: 'skipped_conflict', rmpg_id: dup.id });
            continue;
          }
          await execute(
            db,
            `INSERT OR IGNORE INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at)
             VALUES ('fleet_vehicles', ?, ?, ?, datetime('now'))`,
            dup.id, FLEETIO_LINK_RESOURCE.vehicle, fioVehicle.id,
          );
          linkedRmpgIds.add(dup.id);
          linkedFleetioIdByRmpgId.set(dup.id, fioVehicle.id);
          outcomes.push({ fleetio_id: fioVehicle.id, status: 'linked_existing', rmpg_id: dup.id });
          continue;
        }
        const result = await execute(
          db,
          `INSERT INTO fleet_vehicles (vehicle_name, vehicle_number, vin, plate_number, year, make, model, color, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          insertRow.vehicle_name, insertRow.vehicle_number, insertRow.vin, insertRow.plate_number,
          insertRow.year, insertRow.make, insertRow.model, insertRow.color, insertRow.status,
        );
        const newId = Number(result.meta?.last_row_id);
        await execute(
          db,
          `INSERT OR IGNORE INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at)
           VALUES ('fleet_vehicles', ?, ?, ?, datetime('now'))`,
          newId, FLEETIO_LINK_RESOURCE.vehicle, fioVehicle.id,
        );
        linkedRmpgIds.add(newId);
        linkedFleetioIdByRmpgId.set(newId, fioVehicle.id);
        outcomes.push({ fleetio_id: fioVehicle.id, status: 'created', rmpg_id: newId });
        locals.push({ id: newId, vin: insertRow.vin, plate_number: insertRow.plate_number, vehicle_number: insertRow.vehicle_number, vehicle_name: insertRow.vehicle_name });
      }
    }
  } catch (err) {
    const message = err instanceof FleetioError
      ? `${err.name}: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message, outcomes }, 502);
  }

  // ── Fuel entries: pull each linked vehicle's Fleet.io fuel history ──
  // Per-vehicle failures don't abort the run — a bad response for one
  // vehicle's fuel_entries shouldn't block importing the rest.
  type FuelPullOutcome =
    | { fleetio_vehicle_id: number; fleetio_fuel_id: number; status: 'fuel_created'; rmpg_id: number }
    // Adopted a pre-existing native RMPG row via the natural-key dedupe
    // instead of inserting a duplicate. Distinct from 'fuel_linked_existing',
    // which means the Fleet.io id was already in fleetio_links.
    | { fleetio_vehicle_id: number; fleetio_fuel_id: number; status: 'fuel_matched_existing'; rmpg_id: number }
    | { fleetio_vehicle_id: number; fleetio_fuel_id: number; status: 'fuel_linked_existing' }
    | { fleetio_vehicle_id: number; status: 'fuel_pull_failed'; error: string };
  const fuelOutcomes: FuelPullOutcome[] = [];
  const linkedVehicles = await query<{ rmpg_id: number; fleetio_id: number }>(
    db,
    `SELECT rmpg_id, fleetio_id FROM fleetio_links
     WHERE rmpg_table='fleet_vehicles' AND fleetio_resource IN (${vehicleLinkResources.map(() => '?').join(',')})`,
    ...vehicleLinkResources,
  );
  const existingFuelLinks = await query<{ fleetio_id: number }>(
    db,
    `SELECT fleetio_id FROM fleetio_links
     WHERE rmpg_table='fleet_fuel_log' AND fleetio_resource IN (${fuelLinkResources.map(() => '?').join(',')})`,
    ...fuelLinkResources,
  );
  const alreadyLinkedFuelIds = new Set(existingFuelLinks.map((r) => r.fleetio_id));

  let firstFuelFetch = true;
  for (const link of linkedVehicles) {
    try {
      // Pace between vehicles as well as between pages — this loop is the
      // request-heaviest part of /pull (one walk per linked vehicle).
      if (!firstFuelFetch) await pace(PACE_MS);
      firstFuelFetch = false;
      const fuelPage = await listAllFuelEntries({
        config, vehicleId: link.fleetio_id, perPage: 100, onPage: () => pace(PACE_MS),
      });
      if (fuelPage.filteredOut > 0) {
        // The ?vehicle_id= filter didn't take (see listAllFuelEntries) — the
        // entries were dropped rather than misattributed, but say so loudly:
        // silently discarding records reads identically to "there were none".
        console.warn(`[fleetio.pull] vehicle ${link.fleetio_id}: dropped ${fuelPage.filteredOut} fuel entr(ies) belonging to other vehicles — server-side vehicle_id filter appears to be ignored`);
      }
      {
        for (const fioFuel of fuelPage.records) {
          if (alreadyLinkedFuelIds.has(fioFuel.id)) {
            fuelOutcomes.push({ fleetio_vehicle_id: link.fleetio_id, fleetio_fuel_id: fioFuel.id, status: 'fuel_linked_existing' });
            continue;
          }
          const insertRow = buildFuelLogInsertFromFleetio(fioFuel);

          // ── Natural-key dedupe ───────────────────────────────────────
          // `fleetio_links` answers "did I import this Fleet.io id before?",
          // NOT "does this fill already exist in RMPG?". Any fill entered by
          // an officer AND present in Fleet.io therefore imported as a SECOND
          // row carrying only gallons/date — no odometer, driver, or cost.
          // Live D1 accumulated 22 such rows (2026-08-01), inflating the
          // dashboard's 30-day gallons from a true 36.4 to 107.9 (~3x) and
          // skewing utilization, cost-per-mile and the fuel z-scores.
          //
          // Match on the physical fill: same vehicle, same gallons (to 0.01 —
          // gallons is recorded to 3dp, so an accidental collision would need
          // two fills of identical volume within hours), close in time. Only
          // rows NOT already bound to a different Fleet.io entry are eligible.
          const twin = insertRow.gallons == null ? null : await queryFirst<{ id: number }>(
            db,
            `SELECT f.id
               FROM fleet_fuel_log f
               LEFT JOIN fleetio_links fl
                 ON fl.rmpg_table = 'fleet_fuel_log' AND fl.rmpg_id = f.id
              WHERE f.vehicle_id = ?
                AND f.gallons IS NOT NULL
                AND ABS(f.gallons - ?) < 0.01
                AND ABS(julianday(f.fuel_date) - julianday(?)) * 24 <= 6
                AND fl.rmpg_id IS NULL
              ORDER BY ABS(julianday(f.fuel_date) - julianday(?))
              LIMIT 1`,
            link.rmpg_id, insertRow.gallons, insertRow.fuel_date, insertRow.fuel_date,
          );

          let fuelRowId: number;
          let outcome: 'fuel_created' | 'fuel_matched_existing';
          if (twin) {
            // Adopt the existing native row rather than duplicating it, and
            // fill ONLY columns it is missing — an officer-entered value is
            // authoritative and must never be overwritten by Fleet.io.
            await execute(
              db,
              `UPDATE fleet_fuel_log
                  SET total_cost      = COALESCE(total_cost, ?),
                      cost_per_gallon = COALESCE(cost_per_gallon, ?)
                WHERE id = ?`,
              insertRow.total_cost, insertRow.cost_per_gallon, twin.id,
            );
            fuelRowId = twin.id;
            outcome = 'fuel_matched_existing';
          } else {
            // Not wrapped in db.batch() — matches the vehicle-linking phase's
            // pattern above; a crash between these two writes could leave an
            // unlinked fuel row. The dedupe above now absorbs that row on the
            // next /pull instead of duplicating it.
            const result = await execute(
              db,
              `INSERT INTO fleet_fuel_log (vehicle_id, fuel_date, gallons, total_cost, cost_per_gallon) VALUES (?, ?, ?, ?, ?)`,
              link.rmpg_id, insertRow.fuel_date, insertRow.gallons, insertRow.total_cost, insertRow.cost_per_gallon,
            );
            fuelRowId = Number(result.meta?.last_row_id);
            outcome = 'fuel_created';
          }

          await execute(
            db,
            `INSERT OR IGNORE INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pulled_at)
             VALUES ('fleet_fuel_log', ?, ?, ?, datetime('now'))`,
            fuelRowId, FLEETIO_LINK_RESOURCE.fuel_entry, fioFuel.id,
          );
          alreadyLinkedFuelIds.add(fioFuel.id);
          fuelOutcomes.push({ fleetio_vehicle_id: link.fleetio_id, fleetio_fuel_id: fioFuel.id, status: outcome, rmpg_id: fuelRowId });
        }
      }
    } catch (err) {
      const message = err instanceof FleetioError ? `${err.name}: ${err.message}` : err instanceof Error ? err.message : String(err);
      fuelOutcomes.push({ fleetio_vehicle_id: link.fleetio_id, status: 'fuel_pull_failed', error: message });
    }
  }

  const fuelSummary = {
    total: fuelOutcomes.length,
    created: fuelOutcomes.filter((o) => o.status === 'fuel_created').length,
    already_linked: fuelOutcomes.filter((o) => o.status === 'fuel_linked_existing').length,
    // Reported separately from `created`: a nonzero value means the dedupe
    // caught fills that would previously have become duplicate rows.
    matched_existing: fuelOutcomes.filter((o) => o.status === 'fuel_matched_existing').length,
    failed: fuelOutcomes.filter((o) => o.status === 'fuel_pull_failed').length,
  };

  const summary = {
    total: outcomes.length,
    created: outcomes.filter((o) => o.status === 'created').length,
    linked_existing: outcomes.filter((o) => o.status === 'linked_existing').length,
    already_linked: outcomes.filter((o) => o.status === 'already_linked').length,
    skipped: outcomes.filter((o) => o.status === 'skipped_no_name' || o.status === 'skipped_archived').length,
    // Kept separate from `skipped` — these are real data problems recorded
    // into fleetio_conflicts (see recordPullConflict), not benign no-ops.
    conflicts: outcomes.filter((o) => o.status === 'skipped_conflict').length,
    // True when the roster walk hit FLEETIO_MAX_PAGES. Reported rather than
    // swallowed: a truncated pull that claims success reads as "everything is
    // reconciled" when it isn't.
    vehicles_truncated: vehiclesTruncated,
  };

  await recordAudit(c, {
    action: 'FLEETIO_PULL',
    entityType: 'fleetio',
    details: { ...summary, sample: outcomes.slice(0, 10) },
  });

  return c.json({ ok: true, ...summary, outcomes, fuel: fuelSummary, fuel_outcomes: fuelOutcomes });
});

/** Shared seed implementation for vendors/parts — same shape as the vehicle
 *  seed above (unlinked rows, paced pushes, per-row outcomes) but simpler:
 *  no FK translation needed for either resource's create payload. */
async function seedSimpleResource(
  c: Context<Env>,
  opts: {
    rmpgTable: string;
    fleetioResource: string;
    buildPayload: (row: Record<string, unknown>) => Record<string, unknown> | null;
    create: (config: ReturnType<typeof configFromEnv>, payload: Record<string, unknown>) => Promise<{ id: number }>;
    auditAction: string;
  },
): Promise<Response> {
  let config;
  try {
    config = configFromEnv(c.env as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof FleetioConfigError) {
      return c.json({ ok: false, error: err.message, code: 'not_configured' }, 503);
    }
    throw err;
  }
  const body = await c.req.json().catch(() => ({} as { dry_run?: boolean; limit?: number }));
  const dryRun = !!(body as { dry_run?: boolean }).dry_run;
  const limit = Math.min(Math.max(Number((body as { limit?: number }).limit) || 50, 1), 200);
  const db = getDb(c.env);

  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT t.* FROM ${opts.rmpgTable} t
     LEFT JOIN fleetio_links l ON l.rmpg_table = ? AND l.rmpg_id = t.id
     WHERE l.id IS NULL
     ORDER BY t.id ASC
     LIMIT ?`,
    opts.rmpgTable, limit,
  );

  const outcomes: SeedOutcome[] = [];
  let firstWrite = true;
  for (const row of rows) {
    const id = row.id as number;
    const payload = opts.buildPayload(row);
    if (!payload) {
      outcomes.push({ rmpg_id: id, status: 'skipped_no_name' });
      continue;
    }
    if (dryRun) {
      outcomes.push({ rmpg_id: id, status: 'created', fleetio_id: 0 });
      continue;
    }
    if (!firstWrite) await pace(PACE_MS);
    firstWrite = false;
    try {
      const created = await opts.create(config, payload);
      // OR IGNORE for the same reason as the vehicle seed above: the remote
      // record exists by now, so a failing link insert must not be reported as
      // "create failed" and re-created on the next run.
      await execute(
        db,
        `INSERT OR IGNORE INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        opts.rmpgTable, id, opts.fleetioResource, created.id,
      );
      outcomes.push({ rmpg_id: id, status: 'created', fleetio_id: created.id });
    } catch (err) {
      const message = err instanceof FleetioError ? `${err.name}: ${err.message}` : err instanceof Error ? err.message : String(err);
      outcomes.push({ rmpg_id: id, status: 'error', error: message });
    }
  }

  const summary: SeedSummary = {
    total: outcomes.length,
    created: outcomes.filter((o) => o.status === 'created').length,
    already_linked: 0,
    skipped: outcomes.filter((o) => o.status === 'skipped_no_name').length,
    errors: outcomes.filter((o) => o.status === 'error').length,
    outcomes,
  };
  if (!dryRun) {
    await recordAudit(c, { action: opts.auditAction, entityType: 'fleetio', details: { ...summary, outcomes: undefined, sample: outcomes.slice(0, 5) } });
  }
  return c.json({ ok: true, dry_run: dryRun, ...summary });
}

/** Push every ref_vendors row lacking a fleetio_links entry. Admin only. */
fleetio.post('/seed-vendors', requireRole('admin'), (c) =>
  seedSimpleResource(c, {
    rmpgTable: 'ref_vendors',
    fleetioResource: FLEETIO_LINK_RESOURCE.vendor,
    buildPayload: (row) => (row.name ? { name: row.name, address: row.address, city: row.city, state: row.state, zip: row.zip, phone: row.phone, email: row.email } : null),
    create: (config, payload) => createVendor({ config, payload }),
    auditAction: 'FLEETIO_SEED_VENDORS',
  }),
);

/** Push every fleet_parts row lacking a fleetio_links entry. Admin only. */
fleetio.post('/seed-parts', requireRole('admin'), (c) =>
  seedSimpleResource(c, {
    rmpgTable: 'fleet_parts',
    fleetioResource: FLEETIO_LINK_RESOURCE.part,
    buildPayload: (row) => (row.name ? { name: row.name, part_number: row.part_number, description: row.description, unit_cost: row.unit_cost } : null),
    create: (config, payload) => createPart({ config, payload }),
    auditAction: 'FLEETIO_SEED_PARTS',
  }),
);

export default fleetio;
