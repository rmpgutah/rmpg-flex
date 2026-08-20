// ============================================================
// RMPG Flex — Traccar GPS integration route
// ============================================================
// Backs the Admin → Traccar tab (client/src/pages/admin/AdminTraccarTab.tsx),
// which is the contract of record — it sends { url, email, password } and
// expects the raw Traccar device shape ({ id, name, uniqueId, status,
// lastUpdate, model, category, phone, attributes }) back from /devices.
//
// Phase A (this file, mirrors src/routes/clearpathgps.ts's Phase A):
// credentials (password encrypted at rest via TRACCAR_ENC_KEY), test
// connection, device discovery, device↔unit mappings, settings, enable.
//
// Phase B (continuous position polling that writes gps_breadcrumbs/units,
// and telemetry-event ingestion that writes dashcam_events with
// source='traccar') is NOT implemented here — it needs its own cron
// trigger / queue design, same as ClearPath's media-sync shipped as a
// separate pass after its Phase A landed. GET /dashcam-events is a real
// read against the real table; there's just no writer yet, so an
// unconfigured/fresh install honestly returns an empty list rather than
// fabricated events.
//
// Schema self-heals at boot (ensureTraccarSchema) so a silently-failed
// migration apply can't 500 the tab — same pattern as clearpathgps.ts.
// ============================================================

import { Hono, type Context } from 'hono';
import { clampIntParam } from '../utils/paginationParams';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { CpgCryptoError } from '../utils/cpgCrypto';
import {
  getCredentials, getConfigValue, setConfigValue, deleteConfigValue, encryptSecret,
  TRACCAR_KEYS, listDevices, testConnection,
  TraccarAuthError, TraccarHttpError,
} from '../utils/traccar';

const traccar = new Hono<Env>();

const adminOnly = requireRole('admin');

// ── Schema reconcile ─────────────────────────────────────────

async function ensureTraccarSchema(db: D1Database) {
  await execute(db, `CREATE TABLE IF NOT EXISTS traccar_device_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    traccar_unique_id TEXT NOT NULL,
    traccar_device_id INTEGER,
    traccar_display_name TEXT,
    unit_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_synced_at TEXT,
    ignition_state TEXT,
    last_odometer REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_traccar_map_device ON traccar_device_mappings(traccar_unique_id)`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_traccar_map_unit ON traccar_device_mappings(unit_id)`);
}

// ── Helpers ──────────────────────────────────────────────────

async function isTruthy(db: D1Database, key: string): Promise<boolean> {
  const v = await getConfigValue(db, key);
  return v === '1' || v === 'true';
}

async function activeMappingCount(db: D1Database): Promise<number> {
  try {
    const r = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM traccar_device_mappings WHERE is_active = 1');
    return r?.n ?? 0;
  } catch { return 0; }
}

/** Translate a thrown Traccar client error into a safe, user-facing string. */
function clientErrorMessage(err: unknown): string {
  if (err instanceof TraccarAuthError) return 'Invalid Traccar credentials';
  if (err instanceof CpgCryptoError) return err.message;
  if (err instanceof TraccarHttpError) return `Traccar server error (${err.status})`;
  if (err instanceof Error && err.name === 'TimeoutError') return 'Traccar server did not respond in time';
  if (err instanceof Error) return err.message;
  return 'Traccar request failed';
}

// ── Status / credentials ─────────────────────────────────────

traccar.get('/status', async (c) => {
  const db = getDb(c.env);
  await ensureTraccarSchema(db);
  const creds = await getCredentials(db, c.env).catch(() => null);
  const pollInterval = parseInt((await getConfigValue(db, TRACCAR_KEYS.pollInterval)) || '30', 10);
  return c.json({
    configured: !!creds,
    enabled: await isTruthy(db, TRACCAR_KEYS.enabled),
    poll_interval_seconds: pollInterval,
    active_mappings: await activeMappingCount(db),
    last_sync: await getConfigValue(db, 'traccar_last_sync'),
  });
});

// Save credentials (tab sends { url, email, password }). PUT and POST both accepted.
const saveCreds = async (c: Context<Env>) => {
  const db = getDb(c.env);
  await ensureTraccarSchema(db);
  let body: { url?: string; email?: string; password?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const url = (body.url ?? '').toString().trim();
  const email = (body.email ?? '').toString().trim();
  const password = (body.password ?? '').toString();
  if (!url || !email || !password) {
    return c.json({ error: 'url, email and password are required' }, 400);
  }
  let encrypted: string;
  try { encrypted = await encryptSecret(password, c.env.TRACCAR_ENC_KEY); }
  catch (err) {
    return c.json({ error: clientErrorMessage(err), hint: 'Set TRACCAR_ENC_KEY (wrangler secret put TRACCAR_ENC_KEY)' }, 503);
  }
  await setConfigValue(db, TRACCAR_KEYS.url, url);
  await setConfigValue(db, TRACCAR_KEYS.email, email);
  await setConfigValue(db, TRACCAR_KEYS.password, encrypted);
  return c.json({ success: true });
};
traccar.put('/credentials', adminOnly, saveCreds);
traccar.post('/credentials', adminOnly, saveCreds);

traccar.delete('/credentials', adminOnly, async (c) => {
  const db = getDb(c.env);
  for (const k of [TRACCAR_KEYS.url, TRACCAR_KEYS.email, TRACCAR_KEYS.password]) {
    await deleteConfigValue(db, k);
  }
  await setConfigValue(db, TRACCAR_KEYS.enabled, 'false');
  return c.json({ success: true });
});

// ── Connectivity ─────────────────────────────────────────────

traccar.post('/test-connection', adminOnly, async (c) => {
  const db = getDb(c.env);
  const creds = await getCredentials(db, c.env).catch((err) => { throw err; });
  if (!creds) return c.json({ success: false, error: 'No credentials saved' });
  try {
    const deviceCount = await testConnection(creds);
    return c.json({ success: true, deviceCount });
  } catch (err) {
    return c.json({ success: false, error: clientErrorMessage(err) });
  }
});

// ── Enable / settings ────────────────────────────────────────

const setEnable = async (c: Context<Env>) => {
  const db = getDb(c.env);
  let body: { enabled?: boolean; poll_interval_seconds?: number };
  try { body = await c.req.json(); } catch { body = {}; }
  await setConfigValue(db, TRACCAR_KEYS.enabled, body.enabled ? 'true' : 'false');
  if (Number.isFinite(body.poll_interval_seconds)) {
    await setConfigValue(db, TRACCAR_KEYS.pollInterval, String(Math.max(15, Math.min(900, Number(body.poll_interval_seconds)))));
  }
  return c.json({ success: true });
};
traccar.put('/enable', adminOnly, setEnable);
traccar.post('/enable', adminOnly, setEnable);

traccar.get('/settings', async (c) => {
  const db = getDb(c.env);
  return c.json({ history_backfill: await isTruthy(db, TRACCAR_KEYS.historyBackfill) });
});
const setSettings = async (c: Context<Env>) => {
  const db = getDb(c.env);
  let body: { history_backfill?: boolean };
  try { body = await c.req.json(); } catch { body = {}; }
  if (body.history_backfill !== undefined) {
    await setConfigValue(db, TRACCAR_KEYS.historyBackfill, body.history_backfill ? 'true' : 'false');
  }
  return c.json({ success: true });
};
traccar.put('/settings', adminOnly, setSettings);
traccar.post('/settings', adminOnly, setSettings);

// ── Devices ──────────────────────────────────────────────────

traccar.get('/devices', async (c) => {
  const db = getDb(c.env);
  const creds = await getCredentials(db, c.env).catch(() => null);
  if (!creds) return c.json({ devices: [], error: 'No credentials saved' });
  try {
    const devices = await listDevices(creds);
    return c.json({ devices });
  } catch (err) {
    return c.json({ devices: [], error: clientErrorMessage(err) });
  }
});

// ── Mappings (Traccar device ↔ dispatch unit) ────────────────

traccar.get('/mappings', async (c) => {
  const db = getDb(c.env);
  await ensureTraccarSchema(db);
  let mappings: unknown[] = [];
  try {
    const res = await query<Record<string, unknown>>(db, `
      SELECT m.id, m.traccar_unique_id AS cpg_device_id, m.traccar_display_name AS cpg_display_name,
             m.traccar_device_id, m.unit_id, m.is_active, m.last_synced_at, m.ignition_state, m.last_odometer,
             u.call_sign, u.status AS unit_status, ofc.full_name AS officer_name
      FROM traccar_device_mappings m
      LEFT JOIN units u ON u.id = m.unit_id
      LEFT JOIN users ofc ON ofc.id = u.officer_id
      WHERE m.is_active = 1
      ORDER BY m.id DESC
    `);
    mappings = res;
  } catch {
    try { mappings = await query(db, 'SELECT * FROM traccar_device_mappings WHERE is_active = 1 ORDER BY id DESC'); }
    catch { mappings = []; }
  }
  return c.json({ mappings });
});

traccar.post('/mappings', adminOnly, async (c) => {
  const db = getDb(c.env);
  await ensureTraccarSchema(db);
  let body: { device_unique_id?: string; device_name?: string; traccar_device_id?: number; unit_id?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  if (!body.device_unique_id) return c.json({ error: 'device_unique_id is required' }, 400);
  // Upsert by device unique id (unique index). DELETE-then-INSERT keeps it
  // idempotent and lets a re-map change the unit.
  await execute(db, 'DELETE FROM traccar_device_mappings WHERE traccar_unique_id = ?', body.device_unique_id);
  const r = await execute(db, `
    INSERT INTO traccar_device_mappings (traccar_unique_id, traccar_device_id, traccar_display_name, unit_id, is_active, updated_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
  `, body.device_unique_id, body.traccar_device_id ?? null, body.device_name ?? null, body.unit_id ?? null);
  return c.json({ success: true, id: r.meta.last_row_id });
});

traccar.delete('/mappings/:id', adminOnly, async (c) => {
  const db = getDb(c.env);
  await execute(db, 'DELETE FROM traccar_device_mappings WHERE id = ?', c.req.param('id'));
  return c.json({ success: true });
});

// ── Telemetry events ─────────────────────────────────────────
// Reuses the shared dashcam_events table (migration 0117) with
// source='traccar' — see file header. Honest empty list until a Phase B
// poller writes rows.

traccar.get('/dashcam-events', async (c) => {
  const db = getDb(c.env);
  const limit = clampIntParam(c.req.query('limit'), 50, 1, 500);
  try {
    const events = await query(db, `
      SELECT e.*, u.call_sign, ofc.full_name AS officer_name
      FROM dashcam_events e
      LEFT JOIN units u ON u.id = e.unit_id
      LEFT JOIN users ofc ON ofc.id = u.officer_id
      WHERE e.source = 'traccar'
      ORDER BY e.event_timestamp DESC
      LIMIT ?`, limit);
    const totalRow = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM dashcam_events WHERE source = 'traccar'`);
    return c.json({ events, total: totalRow?.n ?? events.length });
  } catch {
    return c.json({ events: [], total: 0 });
  }
});

export default traccar;
