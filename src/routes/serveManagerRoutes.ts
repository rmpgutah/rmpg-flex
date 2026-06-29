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

sm.get('/jobs/:jobId', async (c) => {
  try {
    const db = getDb(c.env);
    const jobId = parseInt(c.req.param('jobId'), 10);
    const job = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM sm_jobs WHERE id = ?', jobId);
    if (!job) return c.json({ error: 'Not found' }, 404);
    const attempts = await query<Record<string, unknown>>(db, 'SELECT * FROM sm_attempts WHERE sm_job_id = ? ORDER BY id DESC', (job as any).sm_job_id);
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
