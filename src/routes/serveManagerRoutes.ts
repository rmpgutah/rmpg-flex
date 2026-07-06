// ============================================================
// RMPG Flex — ServeManager Integration Routes
// ============================================================
// Real API endpoints replacing the former stubs-router mounts.
// Backs the AdminServeManagerTab with live poller status,
// API key management, and manual poll triggering.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { testConnection, setApiKey as smSetApiKey, clearApiKey as smClearApiKey } from '../utils/serveManagerClient';
import { pollServeManagerJobs } from '../utils/serveManagerPoller';

const sm = new Hono<Env>();

// GET /servemanager/status — top-level integration status card on
// AdminServeManagerTab. Distinct from /poller/status (auto-poller config);
// this is "is the API key set + how did the last sync go + cache size".
sm.get('/status', async (c) => {
  try {
    const db = getDb(c.env);
    const keyRow = await queryFirst<{ config_value: string }>(db,
      "SELECT config_value FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1");
    const lastSync = await queryFirst<Record<string, unknown>>(db,
      'SELECT id, sync_type, status, jobs_synced, attempts_synced, error_message, started_at, completed_at FROM sm_sync_log ORDER BY started_at DESC LIMIT 1');
    const jobsCount = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM sm_jobs');
    const attemptsCount = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM sm_attempts');
    return c.json({
      configured: !!keyRow?.config_value,
      last_sync: lastSync || null,
      cached_jobs: jobsCount?.n ?? 0,
      cached_attempts: attemptsCount?.n ?? 0,
    });
  } catch {
    return c.json({ configured: false, last_sync: null, cached_jobs: 0, cached_attempts: 0 });
  }
});

// POST /servemanager/sync {type: 'full'|'incremental'} — manual sync
// trigger from the admin tab. Logs a sm_sync_log row (the poller's
// /poller/poll-now does not log), reusing the same poll logic.
sm.post('/sync', async (c) => {
  const db = getDb(c.env);
  let syncId: number | undefined;
  let type: 'full' | 'incremental' = 'incremental';
  try {
    const body = await c.req.json().catch(() => ({}));
    type = body?.type === 'full' ? 'full' : 'incremental';
    const inserted = await execute(db,
      "INSERT INTO sm_sync_log (sync_type, status, jobs_synced, attempts_synced, started_at) VALUES (?, 'running', 0, 0, datetime('now','localtime'))",
      type);
    syncId = inserted.meta?.last_row_id;

    // A 'full' sync re-fetches everything by clearing the poller's
    // incremental watermark first — pollServeManagerJobs() otherwise
    // always fetches only since servemanager_last_poll_at.
    if (type === 'full') {
      await execute(db,
        "DELETE FROM system_config WHERE config_key = 'servemanager_last_poll_at' AND category = 'integrations'");
    }

    const result = await pollServeManagerJobs(c.env as any);
    await execute(db,
      "UPDATE sm_sync_log SET status = ?, jobs_synced = ?, attempts_synced = ?, error_message = ?, completed_at = datetime('now','localtime') WHERE id = ?",
      result.error ? 'failed' : 'completed', result.synced, 0, result.error || null, syncId);
    return c.json({
      success: !result.error, sync_id: syncId, type,
      jobs_synced: result.synced, attempts_synced: 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    if (syncId != null) {
      await execute(db,
        "UPDATE sm_sync_log SET status = 'failed', error_message = ?, completed_at = datetime('now','localtime') WHERE id = ?",
        message, syncId).catch(() => {});
    }
    return c.json({ success: false, sync_id: syncId ?? null, type, jobs_synced: 0, attempts_synced: 0, error: message }, 500);
  }
});

sm.get('/sync/log', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      'SELECT id, created_at AS started_at, status, jobs_synced, attempts_synced, error_message FROM sm_sync_log ORDER BY created_at DESC LIMIT 50');
    return c.json({ data: rows });
  } catch { return c.json({ data: [] }); }
});

sm.get('/poller/status', async (c) => {
  try {
    const db = getDb(c.env);
    const get = async (k: string) => (await queryFirst<{ config_value: string }>(db,
      "SELECT config_value FROM system_config WHERE config_key=? AND category='integrations' AND is_active=1", k))?.config_value;
    return c.json({
      enabled: (await get('servemanager_poller_enabled')) === 'true',
      poll_interval: parseInt((await get('servemanager_poll_interval')) || '300', 10),
      target_client: (await get('servemanager_target_client')) || '',
      auto_create_calls: (await get('servemanager_auto_create_calls')) === 'true',
      last_poll_at: (await get('servemanager_last_poll_at')) || null,
    });
  } catch { return c.json({ enabled: false, poll_interval: 300, target_client: '', auto_create_calls: false, last_poll_at: null }); }
});

// GET /servemanager/jobs — paginated job list backing AdminServeManagerTab's
// job table (search + pagination). sm_jobs.id is a TEXT PRIMARY KEY that the
// poller's INSERT never sets (SQLite only auto-rowid-aliases INTEGER PRIMARY
// KEY columns, so every row's `id` is NULL) — the real, populated identifier
// is `sm_job_id` (ServeManager's own numeric job id, see migration 0163).
// `sm_job_id AS id` is re-emitted AFTER `*` so it wins on the duplicate `id`
// key, giving the client the working identifier under the field name its
// SMCachedJob.id type already expects.
sm.get('/jobs', async (c) => {
  try {
    const db = getDb(c.env);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') || '25', 10)));
    const q = c.req.query('q')?.trim();

    const where = q ? `WHERE sm_job_number LIKE ? OR recipient_name LIKE ? OR client_company_name LIKE ?` : '';
    const args = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];

    const totalRow = await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) AS n FROM sm_jobs ${where}`, ...args,
    );
    const total = totalRow?.n || 0;

    const jobs = await query<Record<string, unknown>>(
      db,
      `SELECT *, sm_job_id AS id FROM sm_jobs ${where} ORDER BY sm_updated_at DESC LIMIT ? OFFSET ?`,
      ...args, perPage, (page - 1) * perPage,
    );

    return c.json({
      data: jobs,
      pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch { return c.json({ data: [], pagination: { page: 1, per_page: 25, total: 0, totalPages: 0 } }, 500); }
});

sm.get('/jobs/:jobId', async (c) => {
  try {
    const db = getDb(c.env);
    const jobId = parseInt(c.req.param('jobId'), 10);
    const job = await queryFirst<Record<string, unknown>>(db, 'SELECT *, sm_job_id AS id FROM sm_jobs WHERE sm_job_id = ?', jobId);
    if (!job) return c.json({ error: 'Not found' }, 404);
    // sm_attempts.job_id is TEXT (unlike sm_jobs.sm_job_id, which is
    // INTEGER) — bind as a string so a strict-type D1 prepared-statement
    // comparison matches the stored value (SQLite's CLI applies column-
    // affinity coercion automatically; the Workers D1 binding API does not).
    const attempts = await query<Record<string, unknown>>(db, 'SELECT * FROM sm_attempts WHERE job_id = ? ORDER BY id DESC', String(jobId));
    return c.json({ data: { ...job, attempts } });
  } catch { return c.json({ error: 'Not found' }, 404); }
});

sm.put('/api-key', async (c) => {
  try {
    const body = await c.req.json<{ api_key: string }>();
    if (!body.api_key) return c.json({ error: 'api_key required' }, 400);
    await smSetApiKey(getDb(c.env), c.env.JWT_SECRET, body.api_key);
    return c.json({ success: true });
  } catch { return c.json({ error: 'Failed to save key' }, 500); }
});

sm.delete('/api-key', async (c) => {
  try { await smClearApiKey(getDb(c.env)); return c.json({ success: true }); }
  catch { return c.json({ error: 'Failed to clear key' }, 500); }
});

sm.put('/poller/settings', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ enabled?: boolean; poll_interval?: number; target_client?: string; auto_create_calls?: boolean }>();
    const pairs: Record<string, string> = {};
    if (body.enabled !== undefined) pairs['servemanager_poller_enabled'] = body.enabled ? 'true' : 'false';
    if (body.poll_interval !== undefined) pairs['servemanager_poll_interval'] = String(body.poll_interval);
    if (body.target_client !== undefined) pairs['servemanager_target_client'] = body.target_client;
    if (body.auto_create_calls !== undefined) pairs['servemanager_auto_create_calls'] = body.auto_create_calls ? 'true' : 'false';
    for (const [key, value] of Object.entries(pairs)) {
      await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'", key);
      await execute(db, `INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, datetime('now','localtime'), datetime('now','localtime'))`, key, value);
    }
    return c.json({ success: true });
  } catch { return c.json({ error: 'Failed to save settings' }, 500); }
});

sm.post('/poller/poll-now', async (c) => {
  try { return c.json(await pollServeManagerJobs(c.env as any)); }
  catch { return c.json({ synced: 0, callsCreated: 0, error: 'Poll failed' }, 500); }
});

sm.post('/test-connection', async (c) => {
  try { return c.json(await testConnection(getDb(c.env), c.env.JWT_SECRET)); }
  catch { return c.json({ success: false, error: 'Connection test failed' }, 500); }
});

export default sm;
