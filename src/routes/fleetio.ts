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
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { configFromEnv, createVehicle, listVehicles, createVendor, createPart, ping } from '../utils/fleetio/client';
import { FleetioConfigError, FleetioError } from '../utils/fleetio/errors';
import { buildVehiclePayload } from '../utils/fleetio/seed';
import { matchLocalVehicle, buildLocalInsertFromFleetio, decideMatchAction, type LocalVehicleForMatch, type PullOutcome } from '../utils/fleetio/pull';
import type { RmpgFleetVehicleRow, SeedOutcome, SeedSummary } from '../utils/fleetio/types';
import { recordAudit } from '../utils/auditLog';
import fleetioWebhook from './fleetioWebhook';
import { rmpgTableToResource } from '../utils/fleetio/sync';
import { emitFleetioEvent, type FleetioEmitKind } from '../utils/fleetio/events';

const fleetio = new Hono<Env>();

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

/** List unresolved conflicts, optionally filtered by table / id. Auth: required
 *  (not admin-only) so fleet V2 pages can show conflict badges for non-admin
 *  users. Supports `?table=fleet_vehicles&ids=1,2,3` to filter multiple rows. */
fleetio.get('/conflicts', async (c) => {
  const db = getDb(c.env);
  const table = c.req.query('table');
  const id = c.req.query('id');
  const ids = c.req.query('ids');

  let sql = `SELECT id, rmpg_table, rmpg_id, field, local_value, remote_value, resolution, created_at
             FROM fleetio_conflicts WHERE resolved_at IS NULL`;
  const bindings: unknown[] = [];

  if (table) {
    sql += ' AND rmpg_table = ?';
    bindings.push(table);
  }
  if (id) {
    sql += ' AND rmpg_id = ?';
    bindings.push(parseInt(id, 10));
  } else if (ids) {
    const parsed = ids.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (parsed.length > 0) {
      sql += ` AND rmpg_id IN (${parsed.map(() => '?').join(',')})`;
      bindings.push(...parsed);
    }
  }

  sql += ' ORDER BY id DESC LIMIT 50';

  const rows = await query<Record<string, unknown>>(db, sql, ...bindings);
  return c.json({ conflicts: rows, count: rows.length });
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

  let applied: 'remote_applied' | 'outbound_requeued' | 'none' = 'none';
  try {
    if (body.resolution === 'remote_wins') {
      let remoteValue: unknown = null;
      try { remoteValue = conflict.remote_value ? JSON.parse(conflict.remote_value) : null; } catch { /* leave null */ }
      await execute(db,
        `UPDATE ${conflict.rmpg_table} SET ${conflict.field} = ?, updated_at = datetime('now') WHERE id = ?`,
        remoteValue, conflict.rmpg_id);
      applied = 'remote_applied';
    } else if (body.resolution === 'local_wins') {
      const mapping = rmpgTableToResource(conflict.rmpg_table);
      if (mapping) {
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
  const [links, eventsPending, eventsFailed, conflicts] = await Promise.all([
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM fleetio_links'),
    queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM fleetio_events WHERE direction='outbound' AND status='pending'"),
    queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM fleetio_events WHERE status='failed'"),
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM fleetio_conflicts WHERE resolved_at IS NULL'),
  ]);
  return c.json({
    links_total: links?.n ?? 0,
    outbound_pending: eventsPending?.n ?? 0,
    failed_total: eventsFailed?.n ?? 0,
    conflicts_unresolved: conflicts?.n ?? 0,
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

  // Rate-limit pacing: Fleet.io's account limit is 50 req/min (confirmed
  // 2026-06-21 against the Token-scope settings page). Space POSTs at 1.2 s
  // so we hit the 50 req/min ceiling exactly — never trigger a 429, and
  // leave headroom if another sync runs concurrently. For 18 vehicles this
  // takes ~22 s (well under the Worker 30 s response deadline). If `limit`
  // is set high (200 max), the caller should run `/seed` repeatedly rather
  // than one long call — each invocation auto-skips already-linked rows.
  const PACE_MS = 1200;
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
    if (!firstWrite) await new Promise((r) => setTimeout(r, PACE_MS));
    firstWrite = false;
    try {
      const created = await createVehicle({ config, payload });
      await execute(
        db,
        `INSERT INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        'fleet_vehicles', row.id, 'vehicles', created.id,
      );
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
  await execute(
    db,
    `INSERT INTO fleetio_conflicts (rmpg_table, rmpg_id, field, local_value, remote_value)
     VALUES ('fleet_vehicles', ?, 'fleetio_id', ?, ?)`,
    rmpgId,
    existingFleetioId !== null ? String(existingFleetioId) : null,
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
  const locals = await query<LocalVehicleForMatch>(
    db, `SELECT id, vin, plate_number, vehicle_number, vehicle_name FROM fleet_vehicles WHERE COALESCE(archived_at, '') = ''`,
  );
  const existingLinks = await query<{ fleetio_id: number; rmpg_id: number }>(
    db, `SELECT fleetio_id, rmpg_id FROM fleetio_links WHERE rmpg_table='fleet_vehicles' AND fleetio_resource='vehicles'`,
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
  let page = 1;
  let totalPages = 1;
  try {
    do {
      const resp = await listVehicles({ config, page, perPage: 100 });
      totalPages = resp.pagination?.total_pages ?? 1;
      for (const fioVehicle of resp.records) {
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
             VALUES ('fleet_vehicles', ?, 'vehicles', ?, datetime('now'))`,
            match.id, fioVehicle.id,
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
             VALUES ('fleet_vehicles', ?, 'vehicles', ?, datetime('now'))`,
            dup.id, fioVehicle.id,
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
           VALUES ('fleet_vehicles', ?, 'vehicles', ?, datetime('now'))`,
          newId, fioVehicle.id,
        );
        linkedRmpgIds.add(newId);
        linkedFleetioIdByRmpgId.set(newId, fioVehicle.id);
        outcomes.push({ fleetio_id: fioVehicle.id, status: 'created', rmpg_id: newId });
        locals.push({ id: newId, vin: insertRow.vin, plate_number: insertRow.plate_number, vehicle_number: insertRow.vehicle_number, vehicle_name: insertRow.vehicle_name });
      }
      page++;
    } while (page <= totalPages);
  } catch (err) {
    const message = err instanceof FleetioError
      ? `${err.name}: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message, outcomes }, 502);
  }

  const summary = {
    total: outcomes.length,
    created: outcomes.filter((o) => o.status === 'created').length,
    linked_existing: outcomes.filter((o) => o.status === 'linked_existing').length,
    already_linked: outcomes.filter((o) => o.status === 'already_linked').length,
    skipped: outcomes.filter((o) => o.status === 'skipped_no_name' || o.status === 'skipped_archived').length,
    // Kept separate from `skipped` — these are real data problems recorded
    // into fleetio_conflicts (see recordPullConflict), not benign no-ops.
    conflicts: outcomes.filter((o) => o.status === 'skipped_conflict').length,
  };

  await recordAudit(c, {
    action: 'FLEETIO_PULL',
    entityType: 'fleetio',
    details: { ...summary, sample: outcomes.slice(0, 10) },
  });

  return c.json({ ok: true, ...summary, outcomes });
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

  const PACE_MS = 1200;
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
    if (!firstWrite) await new Promise((r) => setTimeout(r, PACE_MS));
    firstWrite = false;
    try {
      const created = await opts.create(config, payload);
      await execute(
        db,
        `INSERT INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pushed_at)
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
    fleetioResource: 'vendor',
    buildPayload: (row) => (row.name ? { name: row.name, address: row.address, city: row.city, state: row.state, zip: row.zip, phone: row.phone, email: row.email } : null),
    create: (config, payload) => createVendor({ config, payload }),
    auditAction: 'FLEETIO_SEED_VENDORS',
  }),
);

/** Push every fleet_parts row lacking a fleetio_links entry. Admin only. */
fleetio.post('/seed-parts', requireRole('admin'), (c) =>
  seedSimpleResource(c, {
    rmpgTable: 'fleet_parts',
    fleetioResource: 'part',
    buildPayload: (row) => (row.name ? { name: row.name, part_number: row.part_number, description: row.description, unit_cost: row.unit_cost } : null),
    create: (config, payload) => createPart({ config, payload }),
    auditAction: 'FLEETIO_SEED_PARTS',
  }),
);

export default fleetio;
