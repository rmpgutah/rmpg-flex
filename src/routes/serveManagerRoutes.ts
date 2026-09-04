// ============================================================
// RMPG Flex — ServeManager Integration Routes
// ============================================================
// Real API endpoints replacing the former stubs-router mounts.
// Backs the AdminServeManagerTab with live poller status,
// API key management, and manual poll triggering.
// ============================================================

import { Hono } from 'hono';
import type { Context } from 'hono';
import { clampIntParam } from '../utils/paginationParams';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { testConnection, setApiKey as smSetApiKey, clearApiKey as smClearApiKey, fetchJobById, fetchDocumentBinary, verifyWebhookSignature, readServeManagerSignatureHeader, extractServeManagerJobIds, pushAttemptToJob, uploadDocumentToJob } from '../utils/serveManagerClient';
import { pollServeManagerJobs, createDispatchCallForJob } from '../utils/serveManagerPoller';

import { log } from '../utils/logger';
const sm = new Hono<Env>();

// This router backs the ADMIN ServeManager tab, but had no role gate at all:
// with only readOnlyRoleGuard on the mount, any authenticated non-client_viewer
// role (officer, dispatcher, contract_manager, human_resources) could overwrite
// or clear the stored integration API key, repoint the poller, or force a sync.
// Substituting an attacker's key makes the poller pull jobs from an
// attacker-controlled ServeManager account; clearing it sabotages the feed.
// Gate every mutating method to admin/manager (reads/status stay open to the
// tab's viewers). Matches the adminOnly pattern in traccar.ts / clearpathgps.ts.
sm.use('*', async (c, next) => {
  const method = c.req.method;
  const actor = c.get('user') as { role?: string } | undefined;

  // Mutations (PUT/POST/DELETE/PATCH) are gated to admin/manager only —
  // overwriting the API key or repointing the poller requires elevated trust.
  // Reads (GET/HEAD/OPTIONS) stay open to any authenticated role so officers
  // can view the poller status without needing admin access.
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (!actor?.role || !['admin', 'manager'].includes(actor.role)) {
      return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    }
  }
  return next();
});

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
  } catch (err) { log.error('GET failed', { src: 'src/routes/serveManagerRoutes.ts' }, err); return c.json({ configured: false, last_sync: null, cached_jobs: 0, cached_attempts: 0 }); }
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
      "INSERT INTO sm_sync_log (sync_type, status, jobs_synced, attempts_synced, started_at) VALUES (?, 'running', 0, 0, datetime('now'))",
      type);
    syncId = inserted.meta?.last_row_id;

    // Clear the incremental watermark AFTER a successful poll, not before.
    // Clearing it before means a mid-poll failure leaves the watermark gone:
    // the next incremental poll re-fetches from the beginning of time,
    // flooding the import with old records and burying any new ones.
    // pollServeManagerJobs ignores the watermark when it is absent (treats it
    // as "no prior poll"), so we clear it right before calling and it is
    // effectively a reset only for that single call.
    if (type === 'full') {
      await execute(db,
        "DELETE FROM system_config WHERE config_key = 'servemanager_last_poll_at' AND category = 'integrations'");
    }

    const result = await pollServeManagerJobs(c.env as any);
    // If full sync errored, re-insert a sentinel watermark so the next auto-poll
    // does not silently re-fetch everything again from scratch.
    if (type === 'full' && result.error) {
      await execute(db,
        "INSERT OR IGNORE INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES ('servemanager_last_poll_at', datetime('now','-1 day'), 'integrations', 0, 1, datetime('now'), datetime('now'))",
      );
    }
    await execute(db,
      "UPDATE sm_sync_log SET status = ?, jobs_synced = ?, attempts_synced = ?, error_message = ?, completed_at = datetime('now') WHERE id = ?",
      result.error ? 'failed' : 'completed', result.synced, result.attemptsSynced, result.error || null, syncId);
    return c.json({
      success: !result.error, sync_id: syncId, type,
      jobs_synced: result.synced, attempts_synced: result.attemptsSynced,
    });
  } catch (err) {
    log.error('POST /sync failed', { src: 'src/routes/serveManagerRoutes.ts' }, err);
    const message = err instanceof Error ? err.message : 'Sync failed';
    if (syncId != null) {
      await execute(db,
        "UPDATE sm_sync_log SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?",
        message, syncId).catch(() => {});
    }
    return c.json({ success: false, sync_id: syncId ?? null, type, jobs_synced: 0, attempts_synced: 0, error: message }, 500);
  }
});

sm.get('/sync/log', async (c) => {
  try {
    const db = getDb(c.env);
    // sm_sync_log has NO `created_at` — its timestamps are started_at /
    // completed_at (verified on live D1). Selecting and ordering by
    // created_at threw "no such column" on every request, and the catch
    // below turned that into an empty list, so the ServeManager sync history
    // has always rendered as "no syncs yet" no matter how many ran.
    const rows = await query<Record<string, unknown>>(db,
      `SELECT id, started_at, completed_at, sync_type, status, jobs_synced,
              attempts_synced, error_message
         FROM sm_sync_log ORDER BY started_at DESC LIMIT 50`);
    return c.json({ data: rows });
  } catch (err) {
    // Keep the endpoint non-fatal, but stop it from reporting "no history"
    // when the truth is "the query failed" — those are not the same answer.
    log.error('GET /sync/log failed', { src: 'src/routes/serveManagerRoutes.ts' }, err as Error);
    return c.json({ data: [], error: 'Sync log unavailable' });
  }
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
  } catch (err) { log.error('GET failed', { src: 'src/routes/serveManagerRoutes.ts' }, err); return c.json({ enabled: false, poll_interval: 300, target_client: '', auto_create_calls: false, last_poll_at: null }); }
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
    const page = clampIntParam(c.req.query('page'), 1, 1, 1000000);
    const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') || '25', 10)));
    const q = c.req.query('q')?.trim();

    // D1's LIKE pattern is capped at 50 chars — any search string > 48 chars
    // (plus the two `%` wrappers = 50) causes a "too many LIKE pattern" error.
    // instr(col, needle) is uncapped and handles the same substring match;
    // it returns 0 (falsy) when the needle is absent and a positive position
    // when found, which SQLite evaluates as truth in a WHERE clause.
    const where = q ? `WHERE (instr(sm_job_number,?) OR instr(recipient_name,?) OR instr(client_company_name,?))` : '';
    const args = q ? [q, q, q] : [];

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
  } catch (err) {
    log.error('GET /jobs failed', { src: 'src/routes/serveManagerRoutes.ts' }, err); return c.json({ data: [], pagination: { page: 1, per_page: 25, total: 0, totalPages: 0 } }, 500); }
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
  } catch (err) { log.error('GET failed', { src: 'src/routes/serveManagerRoutes.ts' }, err); return c.json({ error: 'Not found' }, 404); }
});

// GET /documents/:documentId/download — proxies a cached job's document PDF
// (Fieldsheet, Address Label, etc.) through the Worker. The client can't hit
// documents_json's pdf_download_url directly — that's ServeManager's own
// authenticated API, not a public link, so it 401s without the stored key.
sm.get('/documents/:documentId/download', async (c) => {
  const documentId = c.req.param('documentId');
  const result = await fetchDocumentBinary(getDb(c.env), c.env, documentId);
  if (!result.ok) {
    log.error('GET /documents/:documentId/download failed', { src: 'src/routes/serveManagerRoutes.ts', documentId, status: result.status });
    return c.json({ error: 'Download failed' }, result.status === 503 ? 503 : 502);
  }
  // Add Content-Disposition so the browser treats this as a file download
  // and uses the document ID as the filename rather than the raw UUID path.
  // Without it, some browsers render the PDF inline and others just show the blob URL.
  const filename = `servemanager-doc-${documentId}.pdf`;
  return new Response(result.body, {
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// POST /jobs/:jobId/create-dispatch — manual override of the target-client
// filter and the "Auto-Create Dispatch Calls" toggle. An admin/manager (the
// router-wide gate above) can push a specific job through even when the
// poller wouldn't have (wrong/no target client, auto-create off, or the
// poller itself disabled) rather than waiting on config changes. Re-fetches
// the job fresh from ServeManager rather than trusting the sm_jobs cache, so
// the manually-created call captures current data — see fetchJobById.
sm.post('/jobs/:jobId/create-dispatch', async (c) => {
  try {
    const db = getDb(c.env);
    const jobId = parseInt(c.req.param('jobId'), 10);
    if (!Number.isFinite(jobId)) return c.json({ error: 'Invalid job id' }, 400);

    const existing = await queryFirst<{ linked_call_id: number | null }>(
      db, 'SELECT linked_call_id FROM sm_jobs WHERE sm_job_id = ?', jobId,
    );
    if (existing?.linked_call_id) {
      return c.json({ error: 'Job already has a linked dispatch call', code: 'ALREADY_LINKED', call_id: existing.linked_call_id }, 409);
    }

    const job = await fetchJobById(db, c.env, jobId);
    if (!job) return c.json({ error: 'Job not found in ServeManager (or API key not configured)' }, 404);

    const result = await createDispatchCallForJob(c.env, job);
    return c.json({ success: true, ...result });
  } catch (err) {
    log.error('POST /jobs/:jobId/create-dispatch failed', { src: 'src/routes/serveManagerRoutes.ts' }, err);
    return c.json({ error: 'Failed to create dispatch call' }, 500);
  }
});

sm.put('/api-key', async (c) => {
  try {
    const body = await c.req.json<{ api_key: string }>();
    if (!body.api_key) return c.json({ error: 'api_key required' }, 400);
    await smSetApiKey(getDb(c.env), c.env.JWT_SECRET, body.api_key);
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /api-key failed', { src: 'src/routes/serveManagerRoutes.ts' }, err); return c.json({ error: 'Failed to save key' }, 500); }
});

sm.delete('/api-key', async (c) => {
  try { await smClearApiKey(getDb(c.env)); return c.json({ success: true }); }
  catch (err) {
    log.error('DELETE /api-key failed', { src: 'src/routes/serveManagerRoutes.ts' }, err); return c.json({ error: 'Failed to clear key' }, 500); }
});

// Enabling/toggling the poller (turning the feed on, flipping auto-create,
// repointing Target Client) is a step above the router's general admin/
// manager gate above: this is the one action that starts pulling data from
// ServeManager and auto-creating dispatch calls unattended on every cron
// tick, so it requires the 'admin' role specifically — a manager can still
// trigger a one-off Poll Now / Full Sync (still gated admin/manager by the
// router-wide middleware), but cannot arm the always-on poller.
sm.put('/poller/settings', async (c) => {
  const actor = c.get('user') as { role?: string } | undefined;
  if (actor?.role !== 'admin') {
    return c.json({ error: 'Only an admin can change poller settings', code: 'ADMIN_REQUIRED' }, 403);
  }
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ enabled?: boolean; poll_interval?: number; target_client?: string; auto_create_calls?: boolean }>();
    const pairs: Record<string, string> = {};
    if (body.enabled !== undefined) pairs['servemanager_poller_enabled'] = body.enabled ? 'true' : 'false';
    if (body.poll_interval !== undefined) pairs['servemanager_poll_interval'] = String(body.poll_interval);
    if (body.target_client !== undefined) pairs['servemanager_target_client'] = body.target_client;
    if (body.auto_create_calls !== undefined) pairs['servemanager_auto_create_calls'] = body.auto_create_calls ? 'true' : 'false';
    // Use db.batch() so delete + insert are atomic per key — a partial failure
    // (delete succeeds, insert fails) previously left keys missing entirely,
    // which the reader treated as the feature being disabled, with no error surfaced.
    const stmts = Object.entries(pairs).flatMap(([key, value]) => [
      db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").bind(key),
      db.prepare(`INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, datetime('now'), datetime('now'))`).bind(key, value),
    ]);
    if (stmts.length) await db.batch(stmts);
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /poller/settings failed', { src: 'src/routes/serveManagerRoutes.ts' }, err); return c.json({ error: 'Failed to save settings' }, 500); }
});

sm.post('/poller/poll-now', async (c) => {
  const db = getDb(c.env);
  let syncId: number | undefined;
  try {
    const inserted = await execute(db,
      "INSERT INTO sm_sync_log (sync_type, status, jobs_synced, attempts_synced, started_at) VALUES ('incremental', 'running', 0, 0, datetime('now'))");
    syncId = inserted.meta?.last_row_id;
    const result = await pollServeManagerJobs(c.env as any);
    await execute(db,
      "UPDATE sm_sync_log SET status = ?, jobs_synced = ?, attempts_synced = ?, error_message = ?, completed_at = datetime('now') WHERE id = ?",
      result.error ? 'failed' : 'completed', result.synced, result.attemptsSynced, result.error || null, syncId);
    return c.json({ ...result, sync_id: syncId });
  } catch (err) {
    log.error('POST /poller/poll-now failed', { src: 'src/routes/serveManagerRoutes.ts' }, err);
    const message = err instanceof Error ? err.message : 'Poll failed';
    if (syncId != null) {
      await execute(db,
        "UPDATE sm_sync_log SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?",
        message, syncId).catch(() => {});
    }
    return c.json({ synced: 0, callsCreated: 0, attemptsSynced: 0, error: message, sync_id: syncId ?? null }, 500);
  }
});

sm.post('/test-connection', async (c) => {
  try { return c.json(await testConnection(getDb(c.env), c.env)); }
  catch (err) {
    log.error('POST /test-connection failed', { src: 'src/routes/serveManagerRoutes.ts' }, err); return c.json({ success: false, error: 'Connection test failed' }, 500); }
});

// GET /servemanager/webhook-url — returns the full Worker URL admin should
// paste into ServeManager's Webhooks settings page. SM will POST to this URL
// on every job/attempt change, triggering the real-time receiver below.
sm.get('/webhook-url', async (c) => {
  const workerUrl = new URL(c.req.url);
  const webhookUrl = `${workerUrl.protocol}//${workerUrl.host}/api/servemanager-webhook`;
  const db = getDb(c.env);
  const secretRow = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key = 'servemanager_webhook_secret' AND category = 'integrations' AND is_active = 1 LIMIT 1");
  return c.json({ webhook_url: webhookUrl, has_secret: !!secretRow?.config_value });
});

async function receiveServeManagerWebhook(c: Context<Env>) {
  const db = getDb(c.env);
  const rawBody = await c.req.text();
  const signature = readServeManagerSignatureHeader((name) => c.req.header(name));

  const secretRow = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key = 'servemanager_webhook_secret' AND category = 'integrations' AND is_active = 1 LIMIT 1");
  const secret = secretRow?.config_value?.trim();

  if (!secret) {
    // No webhook secret configured — we can't verify the payload.
    // Return 200 to prevent SM from retrying, but log and take no action.
    log.warn('SM webhook received with no secret configured — ignoring', { src: 'src/routes/serveManagerRoutes.ts' });
    return c.json({ ok: true, action: 'ignored_no_secret' });
  }

  const valid = await verifyWebhookSignature(rawBody, signature, secret);
  if (!valid) {
    log.warn('SM webhook signature verification failed', {
      src: 'src/routes/serveManagerRoutes.ts',
      headerPresent: !!signature,
    });
    return c.json({ error: 'Invalid signature' }, 401);
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch (err) { log.error('GET failed', { src: 'src/routes/serveManagerRoutes.ts' }, err); return c.json({ error: 'Invalid JSON' }, 400); }

  const jobIds = extractServeManagerJobIds(payload);
  log.info('SM webhook received', {
    src: 'src/routes/serveManagerRoutes.ts',
    jobIds,
    itemCount: Array.isArray((payload as { data?: unknown })?.data)
      ? ((payload as { data: unknown[] }).data).length
      : 1,
  });

  // Fire-and-forget via waitUntil so the 200 goes back to SM immediately.
  // The incremental poller is idempotent; batch payloads can name several jobs.
  // Hono's executionCtx getter THROWS when none is present (Miniflare unit
  // tests) — optional chaining does not catch that.
  try {
    c.executionCtx.waitUntil((async () => {
      try { await pollServeManagerJobs(c.env as any); }
      catch (err) { log.error('SM webhook re-sync failed', { jobIds }, err); }
    })());
  } catch {
    /* Miniflare app.request has no ExecutionContext */
  }

  return c.json({ ok: true, job_ids: jobIds });
}

// NOTE: the actual public webhook receiver is `serveManagerWebhookRouter` exported
// below, mounted at /api/servemanager-webhook (auth: 'public'). The route below
// is kept as an admin-only echo for testing the webhook path from the UI.
sm.post('/webhook', (c) => receiveServeManagerWebhook(c));

// PUT /servemanager/webhook-secret — admin sets the shared webhook secret that
// ServeManager signs its POSTs with. Must match the value in SM's Webhooks config.
sm.put('/webhook-secret', async (c) => {
  try {
    const body = await c.req.json<{ secret: string }>();
    const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
    if (!secret) return c.json({ error: 'secret required' }, 400);
    const db = getDb(c.env);
    await execute(db, "DELETE FROM system_config WHERE config_key = 'servemanager_webhook_secret' AND category = 'integrations'");
    await execute(db, `INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES ('servemanager_webhook_secret', ?, 'integrations', 0, 1, datetime('now'), datetime('now'))`, secret);
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /webhook-secret failed', { src: 'src/routes/serveManagerRoutes.ts' }, err);
    return c.json({ error: 'Failed to save secret' }, 500);
  }
});

// POST /servemanager/jobs/:jobId/push-attempt — push an RMPG serve attempt
// back to ServeManager so the client/attorney can see it in their SM dashboard.
// Called from the ServeJobCard or ServePage after an officer logs a field attempt.
sm.post('/jobs/:jobId/push-attempt', async (c) => {
  try {
    const db = getDb(c.env);
    const jobId = parseInt(c.req.param('jobId'), 10);
    if (!Number.isFinite(jobId)) return c.json({ error: 'Invalid job id' }, 400);
    const raw = await c.req.json<{
      served_at?: string;
      description?: string;
      success?: boolean;
      lat?: number;
      lng?: number;
      serve_type?: string;
    }>();
    const body = { ...raw, success: raw.success ?? false };
    const result = await pushAttemptToJob(db, c.env, jobId, body);
    if (!result.ok) return c.json({ error: result.error }, 502);
    return c.json({ success: true, attempt_id: result.id });
  } catch (err) {
    log.error('POST /jobs/:jobId/push-attempt failed', { src: 'src/routes/serveManagerRoutes.ts' }, err);
    return c.json({ error: 'Failed to push attempt' }, 500);
  }
});

// POST /servemanager/jobs/:jobId/documents/upload — upload an RMPG-generated
// PDF (affidavit of service, receipt, etc.) to ServeManager so the client sees
// it in their SM job file. Accepts multipart/form-data with a `file` field.
sm.post('/jobs/:jobId/documents/upload', async (c) => {
  try {
    const db = getDb(c.env);
    const jobId = parseInt(c.req.param('jobId'), 10);
    if (!Number.isFinite(jobId)) return c.json({ error: 'Invalid job id' }, 400);
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') return c.json({ error: 'file required (multipart)' }, 400);
    const title = (formData.get('title') as string | null) || (file as File).name || 'RMPG Document';
    const buffer = await (file as File).arrayBuffer();
    const contentType = (file as File).type || 'application/pdf';
    const result = await uploadDocumentToJob(db, c.env, jobId, title, buffer, contentType);
    if (!result.ok) return c.json({ error: result.error }, 502);
    return c.json({ success: true, document_id: result.id });
  } catch (err) {
    log.error('POST /jobs/:jobId/documents/upload failed', { src: 'src/routes/serveManagerRoutes.ts' }, err);
    return c.json({ error: 'Failed to upload document' }, 500);
  }
});

export default sm;

// ─── Public webhook receiver (no JWT required) ──────────────────────────────
// Mounted separately at /api/servemanager-webhook (auth: 'public') so SM can
// reach it without a JWT. The HMAC signature check IS the auth mechanism here.
// Keep this router minimal — only the webhook endpoint lives here.

const smPublic = new Hono<Env>();

smPublic.post('/', (c) => receiveServeManagerWebhook(c));

export { smPublic as serveManagerWebhookRouter };
