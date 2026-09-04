// ============================================================
// RMPG Flex — ClearPath GPS / dashcam integration route
// ============================================================
// Replaces the former `stubs` mapping at /api/clearpathgps. Backs the
// Admin → ClearPath GPS tab (client/src/pages/admin/AdminClearPathGpsTab.tsx),
// which is the contract of record — it sends { email, password, account_id }
// and expects a rich device list + mappings wrapped in { mappings: [...] }.
//
// Phase A (connectivity): credentials (password encrypted at rest), test
// connection, device discovery, camera↔unit mappings, settings.
// Phase B (media-sync) lights up /media-status, /dashcam-events, /media-sync-now.
// Phase C (ALPR) runs off the same per-event loop.
//
// Schema self-heals at boot (ensureCpgSchema) so a silently-failed migration
// apply can't 500 the tab.
// ============================================================

import { Hono, type Context } from 'hono';
import { clampIntParam } from '../utils/paginationParams';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { verifySignedResource } from '../utils/signedAccess';
import { encryptSecret, CpgCryptoError } from '../utils/cpgCrypto';
import { log } from '../utils/logger';
import {
  getCredentials, getConfigValue, setConfigValue, deleteConfigValue, CPG_KEYS,
  listDevices, testConnection,
  CpgAuthError, CpgRateLimitError, CpgHttpError,
} from '../utils/clearpathGps';

const cpg = new Hono<Env>();

const adminOnly = requireRole('admin');

// ── Schema reconcile ─────────────────────────────────────────

async function ensureCpgSchema(db: D1Database) {
  await execute(db, `CREATE TABLE IF NOT EXISTS cpg_device_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpg_device_id TEXT NOT NULL,
    cpg_display_name TEXT,
    cpg_serial_number TEXT,
    cpg_camera_id INTEGER,
    unit_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_synced_at TEXT,
    last_media_synced_at TEXT,
    media_sync_errors INTEGER DEFAULT 0,
    vehicle_make TEXT, vehicle_model TEXT, vehicle_vin TEXT,
    license_plate TEXT, ignition_state TEXT, driver_name TEXT,
    last_odometer REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_cpg_map_device ON cpg_device_mappings(cpg_device_id)`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_cpg_map_unit ON cpg_device_mappings(unit_id)`);
}

// ── Helpers ──────────────────────────────────────────────────

async function isTruthy(db: D1Database, key: string): Promise<boolean> {
  const v = await getConfigValue(db, key);
  return v === '1' || v === 'true';
}

async function activeMappingCount(db: D1Database): Promise<number> {
  try {
    const r = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM cpg_device_mappings WHERE is_active = 1');
    return r?.n ?? 0;
  } catch { return 0; }
}

/** Translate a thrown ClearPath client error into a safe, user-facing string. */
function clientErrorMessage(err: unknown): string {
  if (err instanceof CpgAuthError) return 'Invalid ClearPath credentials';
  if (err instanceof CpgRateLimitError) return `Rate limited — retry in ${err.retryAfterSeconds}s`;
  if (err instanceof CpgCryptoError) return err.message;
  if (err instanceof CpgHttpError) return `ClearPath API error (${err.status})`;
  if (err instanceof Error) return err.message;
  return 'ClearPath request failed';
}

// ── Status / credentials ─────────────────────────────────────

cpg.get('/status', async (c) => {
  const db = getDb(c.env);
  await ensureCpgSchema(db);
  const creds = await getCredentials(db, c.env).catch(() => null);
  const pollInterval = parseInt((await getConfigValue(db, CPG_KEYS.pollInterval)) || '30', 10);
  const mediaPoll = parseInt((await getConfigValue(db, CPG_KEYS.mediaPollInterval)) || '300', 10);
  return c.json({
    configured: !!creds,
    enabled: await isTruthy(db, CPG_KEYS.enabled),
    account: creds?.account ?? null,
    poll_interval_seconds: pollInterval,
    active_mappings: await activeMappingCount(db),
    last_sync: await getConfigValue(db, 'clearpathgps_last_sync'),
    media_sync_enabled: await isTruthy(db, CPG_KEYS.mediaEnabled),
    media_poll_interval_seconds: mediaPoll,
    last_media_sync: await getConfigValue(db, 'clearpathgps_last_media_sync'),
  });
});

cpg.get('/credentials', async (c) => {
  const db = getDb(c.env);
  const account = await getConfigValue(db, CPG_KEYS.account);
  const user = await getConfigValue(db, CPG_KEYS.user);
  const baseUrl = await getConfigValue(db, CPG_KEYS.baseUrl);
  return c.json({ configured: !!(account && user), account, user, base_url: baseUrl }); // password NEVER returned
});

// Save credentials (tab sends { email, password, account_id }). PUT and POST both accepted.
const saveCreds = async (c: Context<Env>) => {
  const db = getDb(c.env);
  await ensureCpgSchema(db);
  let body: { email?: string; password?: string; account_id?: string | number; base_url?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const email = (body.email ?? '').toString().trim();
  const password = (body.password ?? '').toString();
  const accountId = (body.account_id ?? '').toString().trim();
  if (!email || !password || !accountId) {
    return c.json({ error: 'email, password and account_id are required' }, 400);
  }
  let encrypted: string;
  try { encrypted = await encryptSecret(password, c.env.CPG_ENC_KEY); }
  catch (err) {
    return c.json({ error: clientErrorMessage(err), hint: 'Set CPG_ENC_KEY (wrangler secret put CPG_ENC_KEY)' }, 503);
  }
  await setConfigValue(db, CPG_KEYS.account, accountId);
  await setConfigValue(db, CPG_KEYS.user, email);
  await setConfigValue(db, CPG_KEYS.password, encrypted);
  if (body.base_url) await setConfigValue(db, CPG_KEYS.baseUrl, body.base_url.toString().trim());
  return c.json({ success: true });
};
cpg.put('/credentials', adminOnly, saveCreds);
cpg.post('/credentials', adminOnly, saveCreds);

cpg.delete('/credentials', adminOnly, async (c) => {
  const db = getDb(c.env);
  for (const k of [CPG_KEYS.account, CPG_KEYS.user, CPG_KEYS.password, CPG_KEYS.baseUrl]) {
    await deleteConfigValue(db, k);
  }
  await setConfigValue(db, CPG_KEYS.enabled, 'false');
  return c.json({ success: true });
});

// ── Connectivity ─────────────────────────────────────────────

cpg.post('/test-connection', adminOnly, async (c) => {
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

// ClearPath's public API does not enumerate accounts; validate creds + echo
// the configured account so the tab can confirm it.
cpg.post('/discover-accounts', adminOnly, async (c) => {
  const db = getDb(c.env);
  const creds = await getCredentials(db, c.env).catch(() => null);
  if (!creds) return c.json({ accounts: [], error: 'No credentials saved' });
  try {
    await testConnection(creds);
    return c.json({ accounts: [{ accountId: creds.account, description: 'Configured account' }] });
  } catch (err) {
    return c.json({ accounts: [], error: clientErrorMessage(err) });
  }
});

// ── Enable / settings ────────────────────────────────────────

const setEnable = async (c: Context<Env>) => {
  const db = getDb(c.env);
  let body: { enabled?: boolean; poll_interval_seconds?: number };
  try { body = await c.req.json(); } catch { body = {}; }
  await setConfigValue(db, CPG_KEYS.enabled, body.enabled ? 'true' : 'false');
  if (Number.isFinite(body.poll_interval_seconds)) {
    await setConfigValue(db, CPG_KEYS.pollInterval, String(Math.max(15, Math.min(900, Number(body.poll_interval_seconds)))));
  }
  return c.json({ success: true });
};
cpg.put('/enable', adminOnly, setEnable);
cpg.post('/enable', adminOnly, setEnable);

cpg.get('/settings', async (c) => {
  const db = getDb(c.env);
  return c.json({ history_backfill: await isTruthy(db, CPG_KEYS.historyBackfill) });
});
const setSettings = async (c: Context<Env>) => {
  const db = getDb(c.env);
  let body: { history_backfill?: boolean };
  try { body = await c.req.json(); } catch { body = {}; }
  if (body.history_backfill !== undefined) {
    await setConfigValue(db, CPG_KEYS.historyBackfill, body.history_backfill ? 'true' : 'false');
  }
  return c.json({ success: true });
};
cpg.put('/settings', adminOnly, setSettings);
cpg.post('/settings', adminOnly, setSettings);

// ── Devices ──────────────────────────────────────────────────

cpg.get('/devices', async (c) => {
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

// ── Mappings (camera ↔ dispatch unit) ────────────────────────

cpg.get('/mappings', async (c) => {
  const db = getDb(c.env);
  await ensureCpgSchema(db);
  let mappings: unknown[] = [];
  try {
    const res = await query<Record<string, unknown>>(db, `
      SELECT m.*, u.call_sign, u.status AS unit_status, ofc.full_name AS officer_name
      FROM cpg_device_mappings m
      LEFT JOIN units u ON u.id = m.unit_id
      LEFT JOIN users ofc ON ofc.id = u.officer_id
      WHERE m.is_active = 1
      ORDER BY m.id DESC
    `);
    mappings = res;
  } catch {
    // personnel/units shape varies — fall back to a join-free read.
    try { mappings = await query(db, 'SELECT * FROM cpg_device_mappings WHERE is_active = 1 ORDER BY id DESC'); }
    catch { mappings = []; }
  }
  return c.json({ mappings });
});

cpg.post('/mappings', adminOnly, async (c) => {
  const db = getDb(c.env);
  await ensureCpgSchema(db);
  let body: { cpg_device_id?: string; cpg_display_name?: string; cpg_serial_number?: string; unit_id?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  if (!body.cpg_device_id) return c.json({ error: 'cpg_device_id is required' }, 400);
  // Upsert by device id (unique index). DELETE-then-INSERT keeps it idempotent
  // and lets a re-map change the unit.
  await execute(db, 'DELETE FROM cpg_device_mappings WHERE cpg_device_id = ?', body.cpg_device_id);
  const r = await execute(db, `
    INSERT INTO cpg_device_mappings (cpg_device_id, cpg_display_name, cpg_serial_number, unit_id, is_active, updated_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
  `, body.cpg_device_id, body.cpg_display_name ?? null, body.cpg_serial_number ?? null, body.unit_id ?? null);
  return c.json({ success: true, id: r.meta.last_row_id });
});

cpg.delete('/mappings/:id', adminOnly, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const r = await execute(db, 'DELETE FROM cpg_device_mappings WHERE id = ?', id);
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// ── Media sync (Phase B) + dashcam events ────────────────────

cpg.get('/media-status', async (c) => {
  const db = getDb(c.env);
  let totals = { total_synced_clips: 0, total_synced_bytes: 0 };
  try {
    const r = await queryFirst<{ n: number; b: number }>(
      db, "SELECT COUNT(*) AS n, COALESCE(SUM(file_size),0) AS b FROM dashcam_videos WHERE source = 'clearpathgps'");
    if (r) totals = { total_synced_clips: r.n ?? 0, total_synced_bytes: r.b ?? 0 };
  } catch { /* table may predate Phase B */ }
  let devices: unknown[] = [];
  let syncErrors = 0;
  try {
    devices = await query(db, `
      SELECT m.cpg_device_id, m.cpg_display_name, m.last_media_synced_at,
             m.media_sync_errors, u.call_sign
      FROM cpg_device_mappings m
      LEFT JOIN units u ON u.id = m.unit_id
      WHERE m.is_active = 1`);
    const e = await queryFirst<{ s: number }>(db, 'SELECT COALESCE(SUM(media_sync_errors),0) AS s FROM cpg_device_mappings WHERE is_active = 1');
    syncErrors = e?.s ?? 0;
  } catch { /* */ }
  return c.json({
    media_sync_enabled: await isTruthy(db, CPG_KEYS.mediaEnabled),
    media_poll_interval_seconds: parseInt((await getConfigValue(db, CPG_KEYS.mediaPollInterval)) || '300', 10),
    last_media_sync: await getConfigValue(db, 'clearpathgps_last_media_sync'),
    ...totals,
    sync_errors: syncErrors,
    devices,
  });
});

const setMediaSettings = async (c: Context<Env>) => {
  const db = getDb(c.env);
  let body: { media_sync_enabled?: boolean; media_poll_interval_seconds?: number };
  try { body = await c.req.json(); } catch { body = {}; }
  if (body.media_sync_enabled !== undefined) {
    await setConfigValue(db, CPG_KEYS.mediaEnabled, body.media_sync_enabled ? 'true' : 'false');
  }
  if (Number.isFinite(body.media_poll_interval_seconds)) {
    await setConfigValue(db, CPG_KEYS.mediaPollInterval, String(Math.max(60, Math.min(900, Number(body.media_poll_interval_seconds)))));
  }
  return c.json({ success: true });
};
cpg.put('/media-settings', adminOnly, setMediaSettings);
cpg.post('/media-settings', adminOnly, setMediaSettings);

// Fire-and-forget: video downloads can take 90 s+ per clip, well over the
// client's 60 s fetch timeout. Register the sync via waitUntil so the Worker
// stays alive without blocking the HTTP response, then return immediately.
cpg.post('/media-sync-now', adminOnly, async (c) => {
  try {
    const { syncClearpathMedia } = await import('../utils/clearpathSync');
    const r = await syncClearpathMedia(c.env);
    return c.json({ synced: r.synced, errors: r.errors, ...(r.skipped ? { note: `Skipped: ${r.skipped}` } : {}) });
  } catch (err) {
    return c.json({ synced: 0, errors: 1, error: clientErrorMessage(err) });
  }
});

async function dashcamEventQuery(c: Context<Env>, where: string, ...params: unknown[]) {
  const db = getDb(c.env);
  const limit = clampIntParam(c.req.query('limit'), 50, 1, 500);
  try {
    const events = await query(db, `
      SELECT e.*, u.call_sign, ofc.full_name AS officer_name
      FROM dashcam_events e
      LEFT JOIN units u ON u.id = e.unit_id
      LEFT JOIN users ofc ON ofc.id = u.officer_id
      ${where}
      ORDER BY e.event_timestamp DESC
      LIMIT ?`, ...params, limit);
    const totalRow = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM dashcam_events e ${where}`, ...params);
    return c.json({ events, total: totalRow?.n ?? events.length });
  } catch {
    return c.json({ events: [], total: 0 });
  }
}

cpg.get('/dashcam-events', async (c) => dashcamEventQuery(c, ''));
cpg.get('/dashcam-events/by-officer/:id', async (c) =>
  dashcamEventQuery(c, 'WHERE e.unit_id IN (SELECT id FROM units WHERE officer_id = ?)', c.req.param('id')));
cpg.get('/dashcam-events/export', async (c) => {
  const db = getDb(c.env);
  try { return c.json(await query(db, 'SELECT * FROM dashcam_events ORDER BY event_timestamp DESC LIMIT 1000')); }
  catch (err) {
    log.error('clearpathgps GET /dashcam-events/export failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json([]);
  }
});

// Stream a synced dashcam clip from R2 (playback / evidence).
//
// Auth: `/stream` matches authMiddleware's media predicate, so a header-less
// GET with sig+exp is forwarded here UNVERIFIED — this handler must do the
// verification or the clip is public. These are the same `dashcam_videos`
// rows that /api/fleet/dashcam-videos/:id/stream protects, so reuse the
// 'dashcam' resource type: a signature issued for either route works on both,
// and neither is a bypass of the other.
cpg.get('/media/:id/stream', async (c) => {
  const idStr = c.req.param('id');
  const user = c.get('user') as { id?: number } | undefined;
  if (!user) {
    const ok = await verifySignedResource(c.env.JWT_SECRET, 'dashcam', idStr, {
      sig: c.req.query('sig'), exp: c.req.query('exp'), nonce: c.req.query('nonce'),
    });
    if (!ok) return c.json({ error: 'Authentication required' }, 401);
  }
  const db = getDb(c.env);
  const row = await queryFirst<{ r2_key: string | null; file_path: string | null; mime_type: string | null }>(
    db, 'SELECT r2_key, file_path, mime_type FROM dashcam_videos WHERE id = ?', c.req.param('id')).catch(() => null);
  const key = row?.r2_key || row?.file_path;
  if (!key) return c.json({ error: 'Clip not found' }, 404);
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ error: 'Clip object missing from storage' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': row?.mime_type || 'video/mp4', 'Cache-Control': 'private, max-age=3600' },
  });
});

export default cpg;
