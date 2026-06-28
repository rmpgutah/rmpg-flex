// ── Admin Dev Panel ────────────────────────────────────────────────────────
// Mounted at /api/admin/dev (routesConfig.ts). Provides:
//   GET  /feature-flags        — read KV-backed feature flags (any authed user)
//   PUT  /feature-flags        — update flags in KV              (admin only)
//   POST /mock/gps             — inject a GPS position for a unit  (admin only)
//   POST /mock/call            — seed a [TEST] call               (admin only)
//   DELETE /mock/calls         — close all [TEST] calls           (admin only)
//
// FeatureFlagsContext.tsx calls GET /admin/dev/feature-flags (via apiFetch).

import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const adminDev = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Defaults (mirror client/src/context/FeatureFlagsContext.tsx) ──────────
const DEFAULT_FLAGS = {
  draw: true,
  annotations: true,
  gps_replay: true,
  nav_overlay: true,
  buildings_3d: true,
  buffer_rings: true,
  ruler: true,
  minimap: true,
  dev_diagnostics: false,
} as const;

type FlagKey = keyof typeof DEFAULT_FLAGS;

// ── Helpers ───────────────────────────────────────────────────────────────
function requireAdmin(c: { get: (k: 'user') => Variables['user'] | undefined }) {
  const user = c.get('user');
  if (!user || user.role !== 'admin') return true; // caller should 403
  return false;
}

async function loadFlags(kv: KVNamespace): Promise<Record<FlagKey, boolean>> {
  const raw = await kv.get('feature_flags');
  if (!raw) return { ...DEFAULT_FLAGS };
  try {
    const saved = JSON.parse(raw) as Partial<Record<FlagKey, boolean>>;
    return { ...DEFAULT_FLAGS, ...saved };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

// ── GET /feature-flags ─────────────────────────────────────────────────────
// Readable by any authenticated user so the client can load flags on boot
// without requiring an admin session.
adminDev.get('/feature-flags', async (c) => {
  return c.json(await loadFlags(c.env.KV));
});

// ── PUT /feature-flags ─────────────────────────────────────────────────────
// Merges the incoming partial patch over the current KV state. Admin only.
adminDev.put('/feature-flags', async (c) => {
  if (requireAdmin(c)) return c.json({ error: 'admin_only' }, 403);

  const patch = await c.req.json<Partial<Record<FlagKey, boolean>>>();
  const current = await loadFlags(c.env.KV);
  const updated = { ...current, ...patch };
  await c.env.KV.put('feature_flags', JSON.stringify(updated));
  return c.json({ success: true, flags: updated });
});

// ── POST /mock/gps ─────────────────────────────────────────────────────────
// Injects a synthetic GPS position for a unit. Useful for testing the live
// map without a real vehicle. Writes to gps_positions + audit_log.
adminDev.post('/mock/gps', async (c) => {
  if (requireAdmin(c)) return c.json({ error: 'admin_only' }, 403);

  const body = await c.req.json<{ unit_id?: number; lat?: number; lng?: number }>();
  if (!body.unit_id || body.lat === undefined || body.lng === undefined) {
    return c.json({ error: 'unit_id, lat, and lng are required' }, 400);
  }

  const db = c.env.DB;
  const unit = await db.prepare('SELECT id, unit_number FROM units WHERE id = ?')
    .bind(body.unit_id).first<{ id: number; unit_number: string }>();
  if (!unit) return c.json({ error: 'unit_not_found' }, 404);

  const actor = c.get('user')!;

  await db.prepare(
    `INSERT INTO gps_positions (unit_id, latitude, longitude, timestamp)
     VALUES (?, ?, ?, datetime('now'))`
  ).bind(body.unit_id, body.lat, body.lng).run();

  await db.prepare(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, notes)
     VALUES ('DEV_SIM', 'unit', ?, ?, 'Mock GPS injection')`
  ).bind(body.unit_id, actor.id).run();

  return c.json({ success: true, unit });
});

// ── POST /mock/call ────────────────────────────────────────────────────────
// Seeds a low-priority [TEST] call. Useful for smoke-testing dispatch UI.
// Allowed types are intentionally narrow to avoid cluttering real data.
const MOCK_CALL_TYPES = ['TRAFFIC STOP', 'WELFARE CHECK', 'DISTURBANCE'] as const;

adminDev.post('/mock/call', async (c) => {
  if (requireAdmin(c)) return c.json({ error: 'admin_only' }, 403);

  const body = await c.req.json<{ type?: string }>();
  const type = body.type ?? 'TRAFFIC STOP';
  if (!(MOCK_CALL_TYPES as readonly string[]).includes(type)) {
    return c.json({ error: 'invalid_type', allowed: [...MOCK_CALL_TYPES] }, 400);
  }

  const db = c.env.DB;
  const actor = c.get('user')!;

  const result = await db.prepare(
    `INSERT INTO calls_for_service (incident_type, priority, status, notes, dispatcher_id, created_at, updated_at)
     VALUES (?, 'LOW', 'PENDING', '[TEST]', ?, datetime('now'), datetime('now'))`
  ).bind(type, actor.id).run();

  await db.prepare(
    `INSERT INTO audit_log (action_type, entity_type, entity_id, performed_by, notes)
     VALUES ('DEV_SIM', 'call', ?, ?, 'Mock call seed')`
  ).bind(result.meta.last_row_id, actor.id).run();

  return c.json({ success: true, id: result.meta.last_row_id });
});

// ── DELETE /mock/calls ─────────────────────────────────────────────────────
// Closes all [TEST]-tagged calls. Safe to run repeatedly (idempotent).
adminDev.delete('/mock/calls', async (c) => {
  if (requireAdmin(c)) return c.json({ error: 'admin_only' }, 403);

  await c.env.DB.prepare(
    `UPDATE calls_for_service SET status = 'CLOSED', updated_at = datetime('now')
     WHERE notes LIKE '%[TEST]%'`
  ).run();

  return c.json({ success: true });
});

export default adminDev;
