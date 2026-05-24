// ServeManager routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

const SM_BASE_URL = 'https://www.servemanager.com/api';

// ── Web Crypto helpers ──
async function deriveKey(jwtSecret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(jwtSecret));
  return await crypto.subtle.importKey('raw', keyMaterial, 'AES-256-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptApiKey(plaintext: string, jwtSecret: string): Promise<string> {
  const key = await deriveKey(jwtSecret);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  const encBuf = new Uint8Array(encrypted);
  const authTag = encBuf.slice(-16);
  const ciphertext = encBuf.slice(0, -16);
  const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${toHex(iv)}:${toHex(authTag)}:${toHex(ciphertext)}`;
}

async function decryptApiKey(stored: string, jwtSecret: string): Promise<string> {
  const key = await deriveKey(jwtSecret);
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const iv = fromHex(parts[0]);
  const authTag = fromHex(parts[1]);
  const ciphertext = fromHex(parts[2]);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
  return new TextDecoder().decode(decrypted);
}

async function getApiKey(db: D1Db, jwtSecret: string): Promise<string | null> {
  const row = await db.prepare("SELECT config_value FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1").get() as { config_value?: string } | undefined;
  if (!row?.config_value) return (globalThis as any).__env__?.SERVEMANAGER_API_KEY || null;
  try { return await decryptApiKey(row.config_value, jwtSecret); } catch { return row.config_value; }
}

class ServeManagerError extends Error {
  constructor(message: string, public status: number, public responseBody?: string) {
    super(message);
    this.name = 'ServeManagerError';
  }
}

async function smFetch(db: D1Db, jwtSecret: string, path: string, method: string, params?: Record<string, string>, body?: any): Promise<any> {
  const apiKey = await getApiKey(db, jwtSecret);
  if (!apiKey) throw new ServeManagerError('API key not configured', 400);
  const url = new URL(`${SM_BASE_URL}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers: Record<string, string> = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const resp = await fetch(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await resp.text();
  if (!resp.ok) throw new ServeManagerError(`SM API ${resp.status}`, resp.status, text);
  return text ? JSON.parse(text) : {};
}

async function smGet(db: D1Db, jwtSecret: string, path: string, params?: Record<string, string>): Promise<any> {
  return smFetch(db, jwtSecret, path, 'GET', params);
}

async function smPost(db: D1Db, jwtSecret: string, path: string, body: any): Promise<any> {
  return smFetch(db, jwtSecret, path, 'POST', undefined, body);
}

async function smPut(db: D1Db, jwtSecret: string, path: string, body: any): Promise<any> {
  return smFetch(db, jwtSecret, path, 'PUT', undefined, body);
}

async function testConnection(db: D1Db, jwtSecret: string): Promise<{ success: boolean; error?: string }> {
  try {
    await smGet(db, jwtSecret, '/companies', { page: '1', per_page: '1' });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Connection failed' };
  }
}

function initSmTables(db: D1Db): void {
  // D1 doesn't support exec for multiple statements in Workers the same way.
  // Tables should already exist from migrations.
}

function ensureTables(db: D1Db): void {
  try { initSmTables(db); } catch { /* ok */ }
}

export async function upsertJobFromApi(db: D1Db, job: any): Promise<void> {
  if (!job || !job.id) return;
  const now = localNow();
  const recipientName = job.recipient?.name || null;
  const recipientDesc = job.recipient?.description || null;
  const clientCompanyName = job.client_company?.name || null;
  const clientCompanyId = job.client_company?.id || null;
  const processServerName = job.employee_process_server ? `${job.employee_process_server.first_name || ''} ${job.employee_process_server.last_name || ''}`.trim() : job.process_server_company?.name || null;
  const empServerId = job.employee_process_server?.id || null;
  const courtCaseNumber = job.court_case?.number || null;
  const courtCaseId = job.court_case?.id || null;
  await db.prepare(`
    INSERT INTO sm_jobs (id, sm_job_number, job_status, service_status, client_job_number, rush, due_date, service_instructions,
      recipient_name, recipient_description, client_company_name, client_company_id, process_server_name,
      employee_process_server_id, court_case_number, court_case_id, attempt_count, last_attempt_at,
      addresses_json, documents_json, archived_at, sm_created_at, sm_updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET sm_job_number = excluded.sm_job_number, job_status = excluded.job_status,
      service_status = excluded.service_status, client_job_number = excluded.client_job_number, rush = excluded.rush,
      due_date = excluded.due_date, service_instructions = excluded.service_instructions,
      recipient_name = excluded.recipient_name, recipient_description = excluded.recipient_description,
      client_company_name = excluded.client_company_name, client_company_id = excluded.client_company_id,
      process_server_name = excluded.process_server_name, employee_process_server_id = excluded.employee_process_server_id,
      court_case_number = excluded.court_case_number, court_case_id = excluded.court_case_id,
      attempt_count = excluded.attempt_count, last_attempt_at = excluded.last_attempt_at,
      addresses_json = excluded.addresses_json, documents_json = excluded.documents_json,
      archived_at = excluded.archived_at, sm_created_at = excluded.sm_created_at,
      sm_updated_at = excluded.sm_updated_at, synced_at = excluded.synced_at
  `).run(job.id, job.servemanager_job_number, job.job_status, job.service_status, job.client_job_number,
    job.rush ? 1 : 0, job.due_date, job.service_instructions, recipientName, recipientDesc, clientCompanyName, clientCompanyId,
    processServerName, empServerId, courtCaseNumber, courtCaseId, job.attempt_count || 0, job.last_attempt_served_at,
    JSON.stringify(job.addresses || []), JSON.stringify(job.documents_to_be_served || []),
    job.archived_at, job.created_at, job.updated_at, now);
}

export async function upsertAttemptFromApi(db: D1Db, attempt: any): Promise<void> {
  if (!attempt || !attempt.id || !attempt.job_id) return;
  const now = localNow();
  await db.prepare(`
    INSERT INTO sm_attempts (id, job_id, description, success, service_status, serve_type, served_at, lat, lng,
      gps_timestamp, server_name, recipient_name, attachments_json, sm_created_at, sm_updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET description = excluded.description, success = excluded.success,
      service_status = excluded.service_status, serve_type = excluded.serve_type, served_at = excluded.served_at,
      lat = excluded.lat, lng = excluded.lng, gps_timestamp = excluded.gps_timestamp,
      server_name = excluded.server_name, recipient_name = excluded.recipient_name,
      attachments_json = excluded.attachments_json, sm_created_at = excluded.sm_created_at,
      sm_updated_at = excluded.sm_updated_at, synced_at = excluded.synced_at
  `).run(attempt.id, attempt.job_id, attempt.description, attempt.success ? 1 : 0, attempt.service_status,
    attempt.serve_type, attempt.served_at, attempt.lat, attempt.lng, attempt.gps_timestamp,
    attempt.server_name, attempt.recipient?.name || attempt.recipient_full_description || null,
    JSON.stringify(attempt.attachments || []), attempt.created_at, attempt.updated_at, now);
}

export function mountServemanagerRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  api.get('/status', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      ensureTables(db);
      const hasKey = !!(await getApiKey(db, c.env.JWT_SECRET));
      const lastSync = await db.prepare('SELECT * FROM sm_sync_log ORDER BY id DESC LIMIT 1').get() as any;
      const jobCount = (await db.prepare('SELECT COUNT(*) as count FROM sm_jobs').get() as any)?.count || 0;
      const attemptCount = (await db.prepare('SELECT COUNT(*) as count FROM sm_attempts').get() as any)?.count || 0;
      return c.json({ configured: hasKey, last_sync: lastSync || null, cached_jobs: jobCount, cached_attempts: attemptCount });
    } catch {
      return c.json({ error: 'Failed to get ServeManager status', code: 'SM_STATUS_ERROR' }, 500);
    }
  });

  api.post('/test-connection', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const result = await testConnection(db, c.env.JWT_SECRET);
      return c.json(result);
    } catch (error: any) {
      return c.json({ success: false, error: error.message });
    }
  });

  api.put('/api-key', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { api_key } = body;
      const now = localNow();
      if (!api_key || typeof api_key !== 'string' || api_key.trim().length === 0) return c.json({ error: 'api_key is required', code: 'APIKEY_IS_REQUIRED' }, 400);
      if (api_key.trim().length > 500) return c.json({ error: 'api_key must be 500 characters or less', code: 'APIKEY_TOO_LONG' }, 400);
      const encrypted = await encryptApiKey(api_key.trim(), c.env.JWT_SECRET);
      await db.prepare("DELETE FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations'").run();
      await db.prepare(`INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES ('servemanager_api_key', ?, 'integrations', 0, 1, ?, ?)`).run(encrypted, now, now);
      const user = c.get('user');
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.userId, 'sm_api_key_updated', 'system_config', 0, 'Updated ServeManager API key', c.req.header('CF-Connecting-IP') || 'unknown', now);
      return c.json({ success: true, message: 'API key saved' });
    } catch {
      return c.json({ error: 'Failed to save ServeManager API key', code: 'SM_SET_API_KEY_ERROR' }, 500);
    }
  });

  api.delete('/api-key', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      await db.prepare("DELETE FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations'").run();
      const user = c.get('user');
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.userId, 'sm_api_key_cleared', 'system_config', 0, 'Cleared ServeManager API key', c.req.header('CF-Connecting-IP') || 'unknown', now);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to clear ServeManager API key', code: 'SM_CLEAR_API_KEY_ERROR' }, 500);
    }
  });

  api.get('/jobs', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      ensureTables(db);
      const q = c.req.query();
      const source = q.source || 'cache';
      if (source === 'live') {
        const cappedPerPage = Math.min(100000, Math.max(1, parseInt(q.per_page || '100000', 10) || 100000));
        const params: Record<string, string> = { page: String(Math.max(1, parseInt(q.page || '1', 10) || 1)), per_page: String(cappedPerPage) };
        if (q.q) params.q = String(q.q);
        if (q.status) params['filter[job_status][]'] = String(q.status);
        if (q.service_status) params['filter[service_status][]'] = String(q.service_status);
        const result = await smGet(db, c.env.JWT_SECRET, '/jobs', params);
        if (Array.isArray(result.data)) { for (const job of result.data) await upsertJobFromApi(db, job); }
        return c.json(result);
      }
      const pageNum = Math.max(1, parseInt(q.page || '1', 10) || 1);
      const limit = Math.min(100000, Math.max(1, parseInt(q.per_page || '100000', 10) || 100000));
      const offset = (pageNum - 1) * limit;
      const conditions: string[] = [];
      const pArr: any[] = [];
      if (q.q) { const like = `%${q.q}%`; conditions.push('(sm_job_number LIKE ? OR recipient_name LIKE ? OR client_company_name LIKE ? OR client_job_number LIKE ?)'); pArr.push(like, like, like, like); }
      if (q.status) { conditions.push('job_status = ?'); pArr.push(q.status); }
      if (q.service_status) { conditions.push('service_status = ?'); pArr.push(q.service_status); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const total = (await db.prepare(`SELECT COUNT(*) as count FROM sm_jobs ${where}`).get(...pArr) as any).count;
      const rows = await db.prepare(`SELECT * FROM sm_jobs ${where} ORDER BY sm_created_at DESC LIMIT ? OFFSET ?`).all(...pArr, limit, offset);
      return c.json({ data: rows, pagination: { page: pageNum, per_page: limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message, details: error.responseBody }, error.status as any);
      return c.json({ error: 'Failed to list ServeManager jobs', code: 'SM_JOBS_LIST_ERROR' }, 500);
    }
  });

  api.get('/jobs/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      ensureTables(db);
      const id = paramNum(c.req.param('id'));
      const q = c.req.query();
      if (q.live === 'true') {
        const result = await smGet(db, c.env.JWT_SECRET, `/jobs/${id}`);
        if (!result.data) return c.json({ error: 'Job not found on ServeManager', code: 'SM_JOB_NOT_FOUND' }, 404);
        await upsertJobFromApi(db, result.data);
        if (Array.isArray(result.data.attempts)) { for (const attempt of result.data.attempts) await upsertAttemptFromApi(db, { ...attempt, job_id: result.data.id }); }
        return c.json({ data: result.data });
      }
      const job = await db.prepare('SELECT * FROM sm_jobs WHERE id = ?').get(id);
      if (!job) return c.json({ error: 'Job not found in cache. Try ?live=true', code: 'JOB_NOT_FOUND_IN' }, 404);
      const attempts = await db.prepare('SELECT * FROM sm_attempts WHERE job_id = ? ORDER BY sm_created_at DESC').all(id);
      return c.json({ data: { ...(job as any), attempts } });
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message }, error.status as any);
      return c.json({ error: 'Failed to get ServeManager job detail', code: 'SM_JOB_DETAIL_ERROR' }, 500);
    }
  });

  api.post('/jobs', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const now = localNow();
      const body = await c.req.json();
      const result = await smPost(db, c.env.JWT_SECRET, '/jobs', { type: 'job', ...body });
      if (!result.data) return c.json({ error: 'No data returned from ServeManager' }, 502);
      await upsertJobFromApi(db, result.data);
      const user = c.get('user');
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.userId, 'sm_job_created', 'sm_job', result.data.id, `Created SM job #${result.data.servemanager_job_number}`, c.req.header('CF-Connecting-IP') || 'unknown', now);
      return c.json({ data: result.data }, 201);
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message, details: error.responseBody }, error.status as any);
      return c.json({ error: 'Failed to create ServeManager job', code: 'SM_CREATE_JOB_ERROR' }, 500);
    }
  });

  api.put('/jobs/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const result = await smPut(db, c.env.JWT_SECRET, `/jobs/${id}`, { type: 'job', ...body });
      if (!result.data) return c.json({ error: 'No data returned from ServeManager' }, 502);
      await upsertJobFromApi(db, result.data);
      const user = c.get('user');
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.userId, 'sm_job_updated', 'sm_job', id, `Updated SM job #${result.data.servemanager_job_number}`, c.req.header('CF-Connecting-IP') || 'unknown', now);
      return c.json({ data: result.data });
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message, details: error.responseBody }, error.status as any);
      return c.json({ error: 'Failed to update ServeManager job', code: 'SM_UPDATE_JOB_ERROR' }, 500);
    }
  });

  api.post('/jobs/:id/cancel', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const result = await smPost(db, c.env.JWT_SECRET, `/jobs/${id}/cancel`, { type: 'note', cancellation_note_label: body.label || 'Cancelled', cancellation_note_body: body.body || 'Job cancelled via RMPG Flex' });
      try { const refreshed = await smGet(db, c.env.JWT_SECRET, `/jobs/${id}`); await upsertJobFromApi(db, refreshed.data); } catch { /* non-fatal */ }
      const user = c.get('user');
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.userId, 'sm_job_cancelled', 'sm_job', id, `Cancelled SM job ${id}`, c.req.header('CF-Connecting-IP') || 'unknown', now);
      return c.json({ success: true, data: result.data || null });
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message, details: error.responseBody }, error.status as any);
      return c.json({ error: 'Failed to cancel ServeManager job', code: 'SM_CANCEL_JOB_ERROR' }, 500);
    }
  });

  api.get('/jobs/:jobId/attempts', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      ensureTables(db);
      const q = c.req.query();
      if (q.live === 'true') {
        const jobId = String(c.req.param('jobId'));
        const result = await smGet(db, c.env.JWT_SECRET, '/attempts', { 'filter[job_id]': jobId });
        if (Array.isArray(result.data)) { for (const attempt of result.data) await upsertAttemptFromApi(db, { ...attempt, job_id: parseInt(jobId) }); }
        return c.json(result);
      }
      const rows = await db.prepare('SELECT * FROM sm_attempts WHERE job_id = ? ORDER BY sm_created_at DESC LIMIT 1000').all(c.req.param('jobId'));
      return c.json({ data: rows });
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message }, error.status as any);
      return c.json({ error: 'Failed to list ServeManager attempts', code: 'SM_ATTEMPTS_ERROR' }, 500);
    }
  });

  api.post('/attempts', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const now = localNow();
      const body = await c.req.json();
      const result = await smPost(db, c.env.JWT_SECRET, '/attempts', { type: 'attempt', ...body });
      await upsertAttemptFromApi(db, result.data);
      const user = c.get('user');
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.userId, 'sm_attempt_created', 'sm_attempt', result.data.id, `Created attempt on SM job ${result.data.job_id}`, c.req.header('CF-Connecting-IP') || 'unknown', now);
      return c.json({ data: result.data }, 201);
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message, details: error.responseBody }, error.status as any);
      return c.json({ error: 'Failed to create ServeManager attempt', code: 'SM_CREATE_ATTEMPT_ERROR' }, 500);
    }
  });

  api.post('/jobs/:jobId/notes', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const jobId = paramNum(c.req.param('jobId'));
      const body = await c.req.json();
      const result = await smPost(db, c.env.JWT_SECRET, `/jobs/${jobId}/notes`, { type: 'note', ...body });
      return c.json({ data: result.data }, 201);
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message }, error.status as any);
      return c.json({ error: 'Failed to create ServeManager note', code: 'SM_CREATE_NOTE_ERROR' }, 500);
    }
  });

  api.get('/companies', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const q = c.req.query();
      const params: Record<string, string> = {};
      if (q.q) params.q = String(q.q);
      if (q.page) params.page = String(q.page);
      const result = await smGet(db, c.env.JWT_SECRET, '/companies', params);
      return c.json(result);
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message }, error.status as any);
      return c.json({ error: 'Failed to fetch companies', code: 'SM_COMPANIES_ERROR' }, 500);
    }
  });

  api.get('/courts', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const result = await smGet(db, c.env.JWT_SECRET, '/courts');
      return c.json(result);
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message }, error.status as any);
      return c.json({ error: 'Failed to fetch courts', code: 'SM_COURTS_ERROR' }, 500);
    }
  });

  api.get('/employees', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const result = await smGet(db, c.env.JWT_SECRET, '/employees');
      return c.json(result);
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message }, error.status as any);
      return c.json({ error: 'Failed to fetch employees', code: 'SM_EMPLOYEES_ERROR' }, 500);
    }
  });

  api.get('/court-cases', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const q = c.req.query();
      const params: Record<string, string> = {};
      if (q.q) params.q = String(q.q);
      if (q.page) params.page = String(q.page);
      const result = await smGet(db, c.env.JWT_SECRET, '/court_cases', params);
      return c.json(result);
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message }, error.status as any);
      return c.json({ error: 'Failed to fetch court cases', code: 'SM_COURT_CASES_ERROR' }, 500);
    }
  });

  api.post('/sync', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      ensureTables(db);
      const now = localNow();
      const body = await c.req.json();
      const type = body.type || 'incremental';
      if (!['incremental', 'full'].includes(type)) return c.json({ error: 'sync type must be "incremental" or "full"', code: 'INVALID_SYNC_TYPE' }, 400);
      const syncResult = await db.prepare('INSERT INTO sm_sync_log (sync_type, status, started_at) VALUES (?, ?, ?)').run(type, 'running', now);
      const syncId = Number(syncResult.meta.last_row_id);
      let jobsSynced = 0;
      let attemptsSynced = 0;
      try {
        let page = 1;
        let hasMore = true;
        const params: Record<string, string> = { per_page: '100' };
        if (type === 'incremental') {
          const lastGood = await db.prepare("SELECT completed_at FROM sm_sync_log WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get() as any;
          if (lastGood?.completed_at) { params['filter[date_range][type]'] = 'updated_at'; params['filter[date_range][min]'] = lastGood.completed_at; }
        }
        while (hasMore) {
          params.page = String(page);
          const result = await smGet(db, c.env.JWT_SECRET, '/jobs', params);
          if (Array.isArray(result.data)) {
            for (const job of result.data) {
              await upsertJobFromApi(db, job);
              jobsSynced++;
              if (Array.isArray(job.attempts)) { for (const attempt of job.attempts) { await upsertAttemptFromApi(db, { ...attempt, job_id: job.id }); attemptsSynced++; } }
            }
            hasMore = result.links?.next != null && result.data.length > 0;
            page++;
          } else { hasMore = false; }
          if (page > 50) hasMore = false;
        }
        await db.prepare('UPDATE sm_sync_log SET status = ?, jobs_synced = ?, attempts_synced = ?, completed_at = ? WHERE id = ?').run('completed', jobsSynced, attemptsSynced, localNow(), syncId);
        const user = c.get('user');
        await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.userId, 'sm_sync_completed', 'sm_sync', syncId, `${type} sync: ${jobsSynced} jobs, ${attemptsSynced} attempts`, c.req.header('CF-Connecting-IP') || 'unknown', now);
        return c.json({ success: true, sync_id: syncId, type, jobs_synced: jobsSynced, attempts_synced: attemptsSynced });
      } catch (syncErr: any) {
        await db.prepare('UPDATE sm_sync_log SET status = ?, error_message = ?, completed_at = ? WHERE id = ?').run('failed', syncErr.message, localNow(), syncId);
        throw syncErr;
      }
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message }, error.status as any);
      return c.json({ error: 'Failed to sync ServeManager data', code: 'SM_SYNC_ERROR' }, 500);
    }
  });

  api.get('/sync/log', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      ensureTables(db);
      const rows = await db.prepare('SELECT * FROM sm_sync_log ORDER BY id DESC LIMIT 20').all();
      return c.json({ data: rows });
    } catch {
      return c.json({ error: 'Failed to get ServeManager sync log', code: 'SM_SYNC_LOG_ERROR' }, 500);
    }
  });

  api.put('/jobs/:id/link', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      ensureTables(db);
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { linked_warrant_id, linked_call_id, notes_local } = body;
      const job = await db.prepare('SELECT id FROM sm_jobs WHERE id = ?').get(id);
      if (!job) return c.json({ error: 'Job not found in cache', code: 'JOB_NOT_FOUND_IN' }, 404);
      if (linked_warrant_id !== undefined && linked_warrant_id !== null && (!Number.isInteger(linked_warrant_id) || linked_warrant_id < 0)) return c.json({ error: 'linked_warrant_id must be a positive integer or null', code: 'INVALID_LINKED_WARRANT_ID' }, 400);
      if (linked_call_id !== undefined && linked_call_id !== null && (!Number.isInteger(linked_call_id) || linked_call_id < 0)) return c.json({ error: 'linked_call_id must be a positive integer or null', code: 'INVALID_LINKED_CALL_ID' }, 400);
      if (notes_local !== undefined && notes_local !== null && typeof notes_local !== 'string') return c.json({ error: 'notes_local must be a string', code: 'INVALID_NOTES_LOCAL' }, 400);
      const updates: string[] = [];
      const values: any[] = [];
      if (linked_warrant_id !== undefined) { updates.push('linked_warrant_id = ?'); values.push(linked_warrant_id); }
      if (linked_call_id !== undefined) { updates.push('linked_call_id = ?'); values.push(linked_call_id); }
      if (notes_local !== undefined) { updates.push('notes_local = ?'); values.push(notes_local); }
      if (updates.length > 0) { values.push(id); await db.prepare(`UPDATE sm_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values); }
      const user = c.get('user');
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.userId, 'sm_job_linked', 'sm_job', id, 'Linked SM job to local records', c.req.header('CF-Connecting-IP') || 'unknown', now);
      const updated = await db.prepare('SELECT * FROM sm_jobs WHERE id = ?').get(id);
      return c.json({ data: updated });
    } catch {
      return c.json({ error: 'Failed to link ServeManager job', code: 'SM_LINK_JOB_ERROR' }, 500);
    }
  });

  api.get('/jobs/:jobId/geolocation-history', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      ensureTables(db);
      const jobId = paramNum(c.req.param('jobId'));
      const attempts = await db.prepare('SELECT id, description, success, served_at, lat, lng, gps_timestamp, server_name, service_status FROM sm_attempts WHERE job_id = ? AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY sm_created_at ASC').all(jobId) as any[];
      const addresses = await db.prepare('SELECT addresses_json FROM sm_jobs WHERE id = ?').get(jobId) as any;
      let parsedAddresses: any[] = [];
      try { parsedAddresses = JSON.parse(addresses?.addresses_json || '[]'); } catch { /* ignore */ }
      return c.json({ data: { job_id: jobId, attempts_with_gps: attempts, known_addresses: parsedAddresses, total_attempts: attempts.length } });
    } catch {
      return c.json({ error: 'Failed to get geolocation history', code: 'SM_GEOLOCATION_ERROR' }, 500);
    }
  });

  api.get('/jobs/:jobId/optimal-times', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      ensureTables(db);
      const jobId = paramNum(c.req.param('jobId'));
      const job = await db.prepare('SELECT * FROM sm_jobs WHERE id = ?').get(jobId) as any;
      if (!job) return c.json({ error: 'Job not found in cache', code: 'JOB_NOT_FOUND_IN' }, 404);
      const attempts = await db.prepare(`
        SELECT a.served_at, a.success, a.description FROM sm_attempts a JOIN sm_jobs j ON a.job_id = j.id
        WHERE j.recipient_name = ? AND a.served_at IS NOT NULL ORDER BY a.sm_created_at ASC
      `).all(job.recipient_name) as any[];
      const hourStats: Record<number, { attempts: number; successes: number }> = {};
      const dayStats: Record<number, { attempts: number; successes: number }> = {};
      for (const a of attempts) {
        if (a.served_at) {
          const date = new Date(a.served_at);
          const hour = date.getHours();
          const day = date.getDay();
          if (!hourStats[hour]) hourStats[hour] = { attempts: 0, successes: 0 };
          hourStats[hour].attempts++;
          if (a.success) hourStats[hour].successes++;
          if (!dayStats[day]) dayStats[day] = { attempts: 0, successes: 0 };
          dayStats[day].attempts++;
          if (a.success) dayStats[day].successes++;
        }
      }
      const bestHours = Object.entries(hourStats).filter(([_, s]) => s.successes > 0).sort((a, b) => (b[1].successes / b[1].attempts) - (a[1].successes / a[1].attempts)).slice(0, 3).map(([h, s]) => ({ hour: parseInt(h), success_rate: Math.round((s.successes / s.attempts) * 100), attempts: s.attempts }));
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const bestDays = Object.entries(dayStats).filter(([_, s]) => s.successes > 0).sort((a, b) => (b[1].successes / b[1].attempts) - (a[1].successes / a[1].attempts)).slice(0, 3).map(([d, s]) => ({ day: dayNames[parseInt(d)], success_rate: Math.round((s.successes / s.attempts) * 100), attempts: s.attempts }));
      const suggestions: string[] = [];
      if (bestHours.length > 0) suggestions.push(`Best time: ${bestHours[0].hour}:00 (${bestHours[0].success_rate}% success rate)`);
      if (bestDays.length > 0) suggestions.push(`Best day: ${bestDays[0].day} (${bestDays[0].success_rate}% success rate)`);
      if (attempts.length === 0) suggestions.push('No historical data — try morning (8-10 AM) or evening (5-7 PM)');
      return c.json({ data: { job_id: jobId, recipient_name: job.recipient_name, total_historical_attempts: attempts.length, best_hours: bestHours, best_days: bestDays, suggestions } });
    } catch {
      return c.json({ error: 'Failed to calculate optimal times', code: 'SM_OPTIMAL_TIMES_ERROR' }, 500);
    }
  });

  api.post('/jobs/batch-assign', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const apiKey = await getApiKey(db, c.env.JWT_SECRET);
      if (!apiKey) return c.json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' }, 400);
      const body = await c.req.json();
      const { job_ids, employee_process_server_id } = body;
      if (!Array.isArray(job_ids) || job_ids.length === 0) return c.json({ error: 'job_ids array required', code: 'JOB_IDS_REQUIRED' }, 400);
      if (!employee_process_server_id) return c.json({ error: 'employee_process_server_id required', code: 'SERVER_ID_REQUIRED' }, 400);
      if (job_ids.length > 50) return c.json({ error: 'Maximum 50 jobs per batch', code: 'MAX_BATCH_SIZE' }, 400);
      const now = localNow();
      const results: { job_id: number; success: boolean; error?: string }[] = [];
      for (const jobId of job_ids) {
        try {
          const result = await smPut(db, c.env.JWT_SECRET, `/jobs/${jobId}`, { type: 'job', employee_process_server_id });
          await upsertJobFromApi(db, result.data);
          results.push({ job_id: jobId, success: true });
        } catch (err: any) {
          results.push({ job_id: jobId, success: false, error: err.message });
        }
      }
      const user = c.get('user');
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.userId, 'sm_batch_assign', 'sm_job', 0, `Batch assigned ${results.filter(r => r.success).length}/${job_ids.length} jobs to server ${employee_process_server_id}`, c.req.header('CF-Connecting-IP') || 'unknown', now);
      return c.json({ success: true, assigned: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results });
    } catch (error: any) {
      if (error instanceof ServeManagerError) return c.json({ error: error.message }, error.status as any);
      return c.json({ error: 'Failed to batch assign', code: 'SM_BATCH_ASSIGN_ERROR' }, 500);
    }
  });

  api.get('/stats/completion', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      ensureTables(db);
      const overall = await db.prepare(`
        SELECT COUNT(*) as total_jobs, SUM(CASE WHEN service_status = 'Served' THEN 1 ELSE 0 END) as served,
          SUM(CASE WHEN service_status = 'Not Served' THEN 1 ELSE 0 END) as not_served,
          SUM(CASE WHEN service_status = 'Canceled' THEN 1 ELSE 0 END) as cancelled,
          SUM(CASE WHEN job_status = 'Opened' THEN 1 ELSE 0 END) as open,
          AVG(attempt_count) as avg_attempts, AVG(CASE WHEN service_status = 'Served' THEN attempt_count END) as avg_attempts_to_serve
        FROM sm_jobs
      `).get() as any;
      const completionRate = overall.total_jobs > 0 ? Math.round((overall.served / overall.total_jobs) * 100) : 0;
      const byServer = await db.prepare(`
        SELECT process_server_name, COUNT(*) as total_jobs, SUM(CASE WHEN service_status = 'Served' THEN 1 ELSE 0 END) as served,
          ROUND(AVG(attempt_count), 1) as avg_attempts FROM sm_jobs WHERE process_server_name IS NOT NULL AND process_server_name != ''
        GROUP BY process_server_name ORDER BY total_jobs DESC
      `).all() as any[];
      const monthlyTrend = await db.prepare(`
        SELECT strftime('%Y-%m', sm_created_at) as month, COUNT(*) as total,
          SUM(CASE WHEN service_status = 'Served' THEN 1 ELSE 0 END) as served
        FROM sm_jobs WHERE sm_created_at IS NOT NULL GROUP BY month ORDER BY month DESC LIMIT 12
      `).all();
      const rushStats = await db.prepare(`
        SELECT SUM(CASE WHEN rush = 1 THEN 1 ELSE 0 END) as rush_total, SUM(CASE WHEN rush = 1 AND service_status = 'Served' THEN 1 ELSE 0 END) as rush_served,
          SUM(CASE WHEN rush = 0 THEN 1 ELSE 0 END) as standard_total, SUM(CASE WHEN rush = 0 AND service_status = 'Served' THEN 1 ELSE 0 END) as standard_served
        FROM sm_jobs
      `).get() as any;
      return c.json({
        data: {
          overall: { ...overall, completion_rate: completionRate },
          by_server: byServer.map((s: any) => ({ ...s, completion_rate: s.total_jobs > 0 ? Math.round((s.served / s.total_jobs) * 100) : 0 })),
          monthly_trend: monthlyTrend, rush_vs_standard: rushStats,
        },
      });
    } catch {
      return c.json({ error: 'Failed to get completion stats', code: 'SM_COMPLETION_STATS_ERROR' }, 500);
    }
  });

  api.get('/jobs/:id/linked-records', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      ensureTables(db);
      const id = paramNum(c.req.param('id'));
      const job = await db.prepare('SELECT * FROM sm_jobs WHERE id = ?').get(id) as any;
      if (!job) return c.json({ error: 'Job not found', code: 'JOB_NOT_FOUND_IN' }, 404);
      const links: any = { warrant: null, call: null, trespass_orders: [] };
      if (job.linked_warrant_id) {
        links.warrant = await db.prepare(`SELECT w.id, w.warrant_number, w.type as warrant_type, w.status, COALESCE(p.first_name || ' ' || p.last_name, '') as subject_name FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id WHERE w.id = ?`).get(job.linked_warrant_id);
      }
      if (job.linked_call_id) {
        links.call = await db.prepare('SELECT id, call_number, call_type, status FROM calls WHERE id = ?').get(job.linked_call_id);
      }
      if (job.recipient_name) {
        links.trespass_orders = await db.prepare(`
          SELECT id, alert_type, severity, description, status FROM offender_alerts WHERE alert_type = 'ban_zone' AND status = 'active'
          AND person_id IN (SELECT id FROM persons WHERE first_name || ' ' || last_name LIKE ?) LIMIT 10
        `).all(`%${job.recipient_name}%`);
      }
      return c.json({ data: links });
    } catch {
      return c.json({ error: 'Failed to get linked records', code: 'SM_LINKS_ERROR' }, 500);
    }
  });

  app.route('/api/servemanager', api);
}
