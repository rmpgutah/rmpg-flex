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
//
// PR 4 will add POST /webhook (HMAC-verified inbound).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { configFromEnv, createVehicle, ping } from '../utils/fleetio/client';
import { FleetioConfigError, FleetioError } from '../utils/fleetio/errors';
import { buildVehiclePayload } from '../utils/fleetio/seed';
import type { RmpgFleetVehicleRow, SeedOutcome, SeedSummary } from '../utils/fleetio/types';
import { recordAudit } from '../utils/auditLog';

const fleetio = new Hono<Env>();

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

export default fleetio;
