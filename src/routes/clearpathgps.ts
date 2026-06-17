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
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { encryptSecret, CpgCryptoError } from '../utils/cpgCrypto';
import {
  getApiConfig, getConfigValue, setConfigValue, deleteConfigValue, CPG_KEYS,
  listDevices, testConnection,
  ensureCpgConfig, backupConfig, clearConfigBackup, vehicleToCamera,
  CpgAuthError, CpgRateLimitError, CpgHttpError,
} from '../utils/clearpathGps';
import {
  createFullDriveJob, getJobStatus, ensureFullDriveSchema,
} from '../utils/fullDrivePipeline';

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
  await ensureCpgConfig(db, c.env).catch(() => false); // self-heal config if D1 rows were wiped
  const client = await getApiConfig(db, c.env).catch(() => null);
  const pollInterval = parseInt((await getConfigValue(db, CPG_KEYS.pollInterval)) || '30', 10);
  const mediaPoll = parseInt((await getConfigValue(db, CPG_KEYS.mediaPollInterval)) || '300', 10);
  return c.json({
    configured: !!client,
    enabled: await isTruthy(db, CPG_KEYS.enabled),
    account: client?.account ?? null,
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
  const userId = c.env.CPG_USER_ID || (await getConfigValue(db, CPG_KEYS.userId));
  const hasToken = !!(c.env.CPG_REFRESH_TOKEN || (await getConfigValue(db, CPG_KEYS.refreshToken)));
  // The refresh token is NEVER returned; we only report whether one is stored.
  return c.json({
    configured: hasToken,
    account,
    user_id: userId,
    has_refresh_token: hasToken,
    from_env: !!c.env.CPG_REFRESH_TOKEN,
  });
});

// Save the ClearPath connection (tab sends { refresh_token, user_id, account_id }).
// ClearPath uses a long-lived refresh token from a logged-in session, exchanged
// server-side for short access tokens. PUT and POST both accepted.
const saveCreds = async (c: Context<Env>) => {
  const db = getDb(c.env);
  await ensureCpgSchema(db);
  let body: { refresh_token?: string; user_id?: string | number; account_id?: string | number };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const refreshToken = (body.refresh_token ?? '').toString().trim();
  const userId = (body.user_id ?? '').toString().trim();
  const accountId = (body.account_id ?? '').toString().trim();
  if (!refreshToken) {
    return c.json({ error: 'refresh_token is required' }, 400);
  }
  let encrypted: string;
  try { encrypted = await encryptSecret(refreshToken, c.env.CPG_ENC_KEY); }
  catch (err) {
    return c.json({ error: clientErrorMessage(err), hint: 'Set CPG_ENC_KEY (wrangler secret put CPG_ENC_KEY)' }, 503);
  }
  await setConfigValue(db, CPG_KEYS.refreshToken, encrypted);
  if (userId) await setConfigValue(db, CPG_KEYS.userId, userId);
  if (accountId) await setConfigValue(db, CPG_KEYS.account, accountId);
  // Durable KV backup (encrypted blob) so the config self-heals if the D1 rows
  // are ever deleted. Re-read user/account so a partial save still backs up
  // whatever is now configured.
  await backupConfig(c.env, {
    refreshToken: encrypted,
    userId: userId || (await getConfigValue(db, CPG_KEYS.userId)),
    account: accountId || (await getConfigValue(db, CPG_KEYS.account)),
  });
  // A freshly-saved token invalidates any cached access token.
  try { await c.env.KV.delete('cpg:access_token'); } catch { /* */ }
  return c.json({ success: true });
};
cpg.put('/credentials', adminOnly, saveCreds);
cpg.post('/credentials', adminOnly, saveCreds);

cpg.delete('/credentials', adminOnly, async (c) => {
  const db = getDb(c.env);
  for (const k of [
    CPG_KEYS.refreshToken, CPG_KEYS.userId, CPG_KEYS.account,
    CPG_KEYS.legacyUser, CPG_KEYS.legacyPassword, CPG_KEYS.legacyBaseUrl,
    CPG_KEYS.legacyClientId, CPG_KEYS.legacyClientSecret,
  ]) {
    await deleteConfigValue(db, k);
  }
  await setConfigValue(db, CPG_KEYS.enabled, 'false');
  // Explicit clear = full removal, including the durable backup (so self-heal
  // does NOT resurrect an intentionally-cleared connection).
  await clearConfigBackup(c.env);
  try { await c.env.KV.delete('cpg:access_token'); } catch { /* */ }
  return c.json({ success: true });
});

// ── Connectivity ─────────────────────────────────────────────

cpg.post('/test-connection', adminOnly, async (c) => {
  const db = getDb(c.env);
  const client = await getApiConfig(db, c.env).catch((err) => { throw err; });
  if (!client) return c.json({ success: false, error: 'No API credentials saved' });
  try {
    const deviceCount = await testConnection(c.env, client);
    return c.json({ success: true, deviceCount });
  } catch (err) {
    return c.json({ success: false, error: clientErrorMessage(err) });
  }
});

// The machine token is account-scoped server-side; validate creds + echo the
// configured account so the tab can confirm it.
cpg.post('/discover-accounts', adminOnly, async (c) => {
  const db = getDb(c.env);
  const client = await getApiConfig(db, c.env).catch(() => null);
  if (!client) return c.json({ accounts: [], error: 'No API credentials saved' });
  try {
    await testConnection(c.env, client);
    return c.json({ accounts: [{ accountId: client.account, description: 'Configured account' }] });
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
  const client = await getApiConfig(db, c.env).catch(() => null);
  if (!client) return c.json({ devices: [], error: 'No API credentials saved' });
  try {
    const devices = await listDevices(c.env, client);
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
  const db = getDb(c.env);
  await execute(db, 'DELETE FROM cpg_device_mappings WHERE id = ?', c.req.param('id'));
  return c.json({ success: true });
});

// Backfill unit_id onto a device's existing NULL-unit dashcam_events after the
// admin maps it to a unit. Idempotent, bounded to the one device.
cpg.post('/mappings/:id/relink', adminOnly, async (c) => {
  const db = getDb(c.env);
  const m = await queryFirst<{ cpg_device_id: string; unit_id: number | null }>(
    db, 'SELECT cpg_device_id, unit_id FROM cpg_device_mappings WHERE id = ?', c.req.param('id'));
  if (!m) return c.json({ error: 'Mapping not found' }, 404);
  if (m.unit_id == null) return c.json({ error: 'Map this device to a unit first' }, 400);
  let events = 0;
  try {
    const r = await execute(db,
      `UPDATE dashcam_events SET unit_id = ? WHERE cpg_device_id = ? AND unit_id IS NULL`,
      m.unit_id, m.cpg_device_id);
    events = r.meta.changes ?? 0;
  } catch { /* table may be absent on a fresh env */ }
  return c.json({ success: true, relinked_events: events });
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
  // Dashcam ALPR reads landed in alpr_captures (capture_id 'cpg_dashcam:*'). The
  // plate-log panel's "reads" tile previously counted only the recent-sightings
  // window (→ 0 even with hundreds of captures); surface the real total here.
  let total_dashcam_reads = 0;
  try {
    const r = await queryFirst<{ n: number }>(
      db, "SELECT COUNT(*) AS n FROM alpr_captures WHERE capture_id LIKE 'cpg_dashcam%'");
    total_dashcam_reads = r?.n ?? 0;
  } catch { /* alpr_captures may not exist yet */ }
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
    total_dashcam_reads,
    sync_errors: syncErrors,
    devices,
  });
});

/** Auto-create device→unit mappings for dashcam-equipped (media-enabled)
 *  vehicles so the media sync has targets without the admin hand-mapping each
 *  one. The camera id stored is the GPS-Insight assetId (the /v2.0/media key);
 *  unit_id is left null for the admin to assign later. Idempotent. */
async function autoMapMediaDevices(env: Env['Bindings'], db: D1Database): Promise<{ mapped: number; candidates: number }> {
  const client = await getApiConfig(db, env).catch(() => null);
  if (!client) return { mapped: 0, candidates: 0 };
  const devices = await listDevices(env, client);
  let candidates = devices.filter((d) => d.mediaEnabled);
  if (!candidates.length) candidates = devices.filter((d) => d.assetId); // account clearly has dashcams; fall back to any asset
  let mapped = 0;
  for (const d of candidates) {
    const cameraId = vehicleToCamera(d)?.id ?? null;
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM cpg_device_mappings WHERE cpg_device_id = ?', d.deviceId);
    if (existing) {
      await execute(db, `UPDATE cpg_device_mappings SET
          cpg_camera_id = COALESCE(cpg_camera_id, ?), cpg_display_name = COALESCE(cpg_display_name, ?),
          is_active = 1, updated_at = datetime('now') WHERE cpg_device_id = ?`,
        cameraId, d.displayName || null, d.deviceId);
    } else {
      await execute(db, `INSERT INTO cpg_device_mappings
          (cpg_device_id, cpg_display_name, cpg_serial_number, cpg_camera_id, unit_id, is_active, updated_at)
          VALUES (?, ?, ?, ?, NULL, 1, datetime('now'))`,
        d.deviceId, d.displayName || null, d.serialNumber || null, cameraId);
      mapped++;
    }
  }
  return { mapped, candidates: candidates.length };
}

// Discover dashcam-equipped vehicles and map them (admin one-click).
cpg.post('/auto-map-devices', adminOnly, async (c) => {
  const db = getDb(c.env);
  await ensureCpgSchema(db);
  try { return c.json({ success: true, ...(await autoMapMediaDevices(c.env, db)) }); }
  catch (err) { return c.json({ success: false, error: clientErrorMessage(err) }, 200); }
});

// One-click: auto-map dashcam devices + turn media sync on (feeds the ALPR pipeline).
cpg.post('/enable-media', adminOnly, async (c) => {
  const db = getDb(c.env);
  await ensureCpgSchema(db);
  let mapResult = { mapped: 0, candidates: 0 };
  try { mapResult = await autoMapMediaDevices(c.env, db); }
  catch (err) { return c.json({ success: false, error: clientErrorMessage(err) }, 200); }
  await setConfigValue(db, CPG_KEYS.mediaEnabled, 'true');
  return c.json({ success: true, media_sync_enabled: true, ...mapResult });
});

const setMediaSettings = async (c: Context<Env>) => {
  const db = getDb(c.env);
  let body: { media_sync_enabled?: boolean; media_poll_interval_seconds?: number };
  try { body = await c.req.json(); } catch { body = {}; }
  if (body.media_sync_enabled !== undefined) {
    await setConfigValue(db, CPG_KEYS.mediaEnabled, body.media_sync_enabled ? 'true' : 'false');
    // Enabling with no mappings would sync nothing — auto-map dashcam devices.
    if (body.media_sync_enabled && (await activeMappingCount(db)) === 0) {
      try { await autoMapMediaDevices(c.env, db); } catch { /* best-effort */ }
    }
  }
  if (Number.isFinite(body.media_poll_interval_seconds)) {
    await setConfigValue(db, CPG_KEYS.mediaPollInterval, String(Math.max(60, Math.min(900, Number(body.media_poll_interval_seconds)))));
  }
  return c.json({ success: true });
};
cpg.put('/media-settings', adminOnly, setMediaSettings);
cpg.post('/media-settings', adminOnly, setMediaSettings);

cpg.post('/media-sync-now', adminOnly, async (c) => {
  const { syncClearpathMedia } = await import('../utils/clearpathSync');
  c.executionCtx.waitUntil(
    syncClearpathMedia(c.env)
      .then((r) => console.log(`[cpg-sync] done: synced=${r.synced} errors=${r.errors}`))
      .catch((err) => console.error('[cpg-sync] failed:', (err as Error)?.message)),
  );
  return c.json({ started: true });
});

// Lightweight still-only ALPR scan — pulls a few dashcam stills, runs ALPR, and
// writes capture rows (powers the gallery). Fast vs. the full clip sync.
cpg.post('/scan-alpr-now', adminOnly, async (c) => {
  try {
    const { scanClearpathMediaAlpr } = await import('../utils/clearpathSync');
    const r = await scanClearpathMediaAlpr(c.env);
    return c.json({ scanned: r.scanned, captured: r.captured, ...(r.skipped ? { note: `Skipped: ${r.skipped}` } : {}) });
  } catch (err) {
    return c.json({ scanned: 0, captured: 0, error: clientErrorMessage(err) });
  }
});

async function dashcamEventQuery(c: Context<Env>, where: string, ...params: unknown[]) {
  const db = getDb(c.env);
  const limit = Math.max(1, Math.min(500, parseInt(c.req.query('limit') || '50', 10)));
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
  catch { return c.json([]); }
});

// Stream a synced dashcam clip from R2 (playback / evidence).
cpg.get('/media/:id/stream', async (c) => {
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

// ── Full-drive download (back-to-back clips for a time window) ───────────
// ── Full-drive job system ────────────────────────────────────
// Detects trip segments (GPS breadcrumb gap analysis), enqueues one on-demand
// footage_request per trip, and returns a job_id for polling. Videos arrive via
// the per-minute cron's request/download passes (no 60s timeout risk).

cpg.post('/full-drive', adminOnly, async (c) => {
  try {
    let body: { device_id?: string; hours_back?: number; from_ts?: number; to_ts?: number } = {};
    try { body = await c.req.json(); } catch { /* body optional */ }
    const toMs = Number.isFinite(Number(body.to_ts)) ? Number(body.to_ts) : Date.now();
    const hoursBack = Math.max(1, Math.min(168, Number(body.hours_back ?? 8)));
    const fromMs = Number.isFinite(Number(body.from_ts)) ? Number(body.from_ts) : (toMs - hoursBack * 3_600_000);

    const db = getDb(c.env);
    // Resolve the device mapping to get the assetId + unitId.
    const targetDeviceId = body.device_id || undefined;
    const mapping = await queryFirst<{
      cpg_device_id: string; cpg_camera_id: number | null; unit_id: number | null;
    }>(db,
      targetDeviceId
        ? 'SELECT cpg_device_id, cpg_camera_id, unit_id FROM cpg_device_mappings WHERE is_active=1 AND cpg_device_id=? LIMIT 1'
        : 'SELECT cpg_device_id, cpg_camera_id, unit_id FROM cpg_device_mappings WHERE is_active=1 LIMIT 1',
      ...(targetDeviceId ? [targetDeviceId] : []),
    );
    if (!mapping?.cpg_camera_id) {
      return c.json({ started: false, error: 'No active device mapping with a camera ID. Run Auto-Map first.' }, 400);
    }

    const job = await createFullDriveJob(c.env, {
      deviceId: mapping.cpg_device_id,
      assetId: mapping.cpg_camera_id,
      unitId: mapping.unit_id,
      fromMs,
      toMs,
      createdBy: c.var.user?.id ?? null,
    });

    // Kick off the first request pass immediately so clips start arriving
    // without waiting for the next cron tick.
    c.executionCtx.waitUntil(
      import('../utils/fullDrivePipeline')
        .then(({ maybePollFullDriveChunks }) => maybePollFullDriveChunks(c.env))
        .catch((err) => console.error('[full-drive] initial poll failed:', (err as Error).message)),
    );

    return c.json({
      started: true, job_id: job.jobId,
      trip_count: job.tripCount,
      from_ts: fromMs, to_ts: toMs,
      hours: Math.round((toMs - fromMs) / 3_600_000),
    });
  } catch (err) {
    return c.json({ started: false, error: clientErrorMessage(err) }, 500);
  }
});

// List recent full-drive jobs (last 20).
cpg.get('/full-drive/jobs', adminOnly, async (c) => {
  try {
    const db = getDb(c.env);
    await ensureFullDriveSchema(db);
    const jobs = await query<{
      id: number; device_id: string; from_ts: number; to_ts: number;
      status: string; trip_count: number; clips_requested: number; clips_ready: number;
      created_at: string; updated_at: string;
    }>(db, `SELECT id, device_id, from_ts, to_ts, status, trip_count, clips_requested, clips_ready,
      created_at, updated_at FROM cpg_drive_jobs ORDER BY id DESC LIMIT 20`);
    return c.json({ jobs });
  } catch (err) {
    return c.json({ jobs: [], error: clientErrorMessage(err) });
  }
});

// Get status of a single full-drive job with live trip progress.
cpg.get('/full-drive/jobs/:id', adminOnly, async (c) => {
  try {
    const db = getDb(c.env);
    const jobId = parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(jobId)) return c.json({ error: 'invalid id' }, 400);
    const job = await getJobStatus(db, jobId);
    if (!job) return c.json({ error: 'not found' }, 404);
    return c.json(job);
  } catch (err) {
    return c.json({ error: clientErrorMessage(err) }, 500);
  }
});

// Get ordered clip metadata for a trip (streamed via /full-drive/clip/:r2Key).
cpg.get('/full-drive/trips/:requestId/clips', adminOnly, async (c) => {
  try {
    const db = getDb(c.env);
    const reqId = parseInt(c.req.param('requestId') ?? '', 10);
    if (!Number.isFinite(reqId)) return c.json({ error: 'invalid id' }, 400);
    const chunks = await query<{ seq: number; r2_key: string; from_ts: number; to_ts: number }>(
      db,
      `SELECT seq, r2_key, from_ts, to_ts FROM footage_chunks
       WHERE request_id = ? AND status = 'downloaded' AND r2_key IS NOT NULL
       ORDER BY seq ASC`, reqId,
    );
    // Return keys as API-relative stream URLs; the client appends the JWT and
    // plays them sequentially — no Worker-signed-URL needed.
    const clips = chunks.map((ch) => ({
      seq: ch.seq,
      streamUrl: `/api/clearpathgps/full-drive/clip/${encodeURIComponent(ch.r2_key)}`,
      from_ts: ch.from_ts,
      to_ts: ch.to_ts,
    }));
    return c.json({ clips, total: chunks.length });
  } catch (err) {
    return c.json({ error: clientErrorMessage(err) }, 500);
  }
});

// Stream a single clip from R2 for sequential playback (supports Range requests).
cpg.get('/full-drive/clip/*', adminOnly, async (c) => {
  try {
    const r2Key = decodeURIComponent(c.req.param('*') || '');
    if (!r2Key.startsWith('flexcam/')) return c.notFound();
    const range = c.req.header('range');
    const parsed = range ? parseRange(range) : null;
    const obj = parsed
      ? await c.env.UPLOADS.get(r2Key, { range: parsed })
      : await c.env.UPLOADS.get(r2Key);
    if (!obj) return c.notFound();
    const status = range ? 206 : 200;
    const headers: Record<string, string> = {
      'Content-Type': obj.httpMetadata?.contentType || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    };
    if (obj.size) headers['Content-Length'] = String(obj.size);
    return new Response(obj.body, { status, headers });
  } catch (err) {
    return c.json({ error: clientErrorMessage(err) }, 500);
  }
});

function parseRange(rangeHeader: string): { offset: number; length?: number } | null {
  const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!m) return null;
  const offset = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : undefined;
  return end !== undefined ? { offset, length: end - offset + 1 } : { offset };
}

export default cpg;
