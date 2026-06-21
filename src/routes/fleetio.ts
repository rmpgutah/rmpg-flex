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
import { getDb, queryFirst } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { configFromEnv, createVehicle, ping } from '../utils/fleetio/client';
import { FleetioConfigError } from '../utils/fleetio/errors';
import { buildVehiclePayload } from '../utils/fleetio/seed';
import type { RmpgFleetVehicleRow, SeedOutcome, SeedSummary } from '../utils/fleetio/types';

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

export default fleetio;
