// ============================================================
// ServeManager Integration Routes
// ============================================================
// Proxy + cache layer for ServeManager API.
// Tables are self-initialized on import (same pattern as adminSystems.ts).

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import {
  smGet, smPost, smPut,
  testConnection, getApiKey, encryptApiKey,
  ServeManagerError,
} from '../utils/serveManagerClient';

const router = Router();
router.use(authenticateToken);

// ============================================================
// Table initialization (self-contained)
// ============================================================

function initSmTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sm_jobs (
      id INTEGER PRIMARY KEY,
      sm_job_number TEXT,
      job_status TEXT,
      service_status TEXT,
      client_job_number TEXT,
      rush INTEGER DEFAULT 0,
      due_date TEXT,
      service_instructions TEXT,
      recipient_name TEXT,
      recipient_description TEXT,
      client_company_name TEXT,
      client_company_id INTEGER,
      process_server_name TEXT,
      employee_process_server_id INTEGER,
      court_case_number TEXT,
      court_case_id INTEGER,
      attempt_count INTEGER DEFAULT 0,
      last_attempt_at TEXT,
      addresses_json TEXT DEFAULT '[]',
      documents_json TEXT DEFAULT '[]',
      archived_at TEXT,
      sm_created_at TEXT,
      sm_updated_at TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      linked_warrant_id INTEGER,
      linked_call_id INTEGER,
      notes_local TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sm_jobs_number ON sm_jobs(sm_job_number);
    CREATE INDEX IF NOT EXISTS idx_sm_jobs_status ON sm_jobs(job_status);
    CREATE INDEX IF NOT EXISTS idx_sm_jobs_service ON sm_jobs(service_status);

    CREATE TABLE IF NOT EXISTS sm_attempts (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      description TEXT,
      success INTEGER DEFAULT 0,
      service_status TEXT,
      serve_type TEXT,
      served_at TEXT,
      lat REAL,
      lng REAL,
      gps_timestamp TEXT,
      server_name TEXT,
      recipient_name TEXT,
      attachments_json TEXT DEFAULT '[]',
      sm_created_at TEXT,
      sm_updated_at TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_sm_attempts_job ON sm_attempts(job_id);

    CREATE TABLE IF NOT EXISTS sm_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      jobs_synced INTEGER DEFAULT 0,
      attempts_synced INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at TEXT
    );
  `);
}

try { initSmTables(); } catch (err) { console.error('[ServeManager] Table init deferred:', err instanceof Error ? err.message : err); }

// ============================================================
// Helpers
// ============================================================

function ensureTables(): void {
  try { initSmTables(); } catch (err) { console.error('[ServeManager] ensureTables failed:', err instanceof Error ? err.message : err); }
}

function requireApiKey(_req: Request, res: Response): boolean {
  if (!getApiKey()) {
    res.status(400).json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.', code: 'SERVEMANAGER_API_KEY_NOT' });
    return false;
  }
  return true;
}

export function upsertJobFromApi(job: any): void {
  if (!job || !job.id) {
    console.warn('[ServeManager] upsertJobFromApi: skipping job with missing id');
    return;
  }
  ensureTables();
  const db = getDb();
  const now = localNow();

  const recipientName = job.recipient?.name || null;
  const recipientDesc = job.recipient?.description || null;
  const clientCompanyName = job.client_company?.name || null;
  const clientCompanyId = job.client_company?.id || null;
  const processServerName = job.employee_process_server
    ? `${job.employee_process_server.first_name || ''} ${job.employee_process_server.last_name || ''}`.trim()
    : job.process_server_company?.name || null;
  const empServerId = job.employee_process_server?.id || null;
  const courtCaseNumber = job.court_case?.number || null;
  const courtCaseId = job.court_case?.id || null;

  db.prepare(`
    INSERT INTO sm_jobs (
      id, sm_job_number, job_status, service_status, client_job_number,
      rush, due_date, service_instructions, recipient_name, recipient_description,
      client_company_name, client_company_id, process_server_name,
      employee_process_server_id, court_case_number, court_case_id,
      attempt_count, last_attempt_at, addresses_json, documents_json,
      archived_at, sm_created_at, sm_updated_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sm_job_number = excluded.sm_job_number,
      job_status = excluded.job_status,
      service_status = excluded.service_status,
      client_job_number = excluded.client_job_number,
      rush = excluded.rush,
      due_date = excluded.due_date,
      service_instructions = excluded.service_instructions,
      recipient_name = excluded.recipient_name,
      recipient_description = excluded.recipient_description,
      client_company_name = excluded.client_company_name,
      client_company_id = excluded.client_company_id,
      process_server_name = excluded.process_server_name,
      employee_process_server_id = excluded.employee_process_server_id,
      court_case_number = excluded.court_case_number,
      court_case_id = excluded.court_case_id,
      attempt_count = excluded.attempt_count,
      last_attempt_at = excluded.last_attempt_at,
      addresses_json = excluded.addresses_json,
      documents_json = excluded.documents_json,
      archived_at = excluded.archived_at,
      sm_created_at = excluded.sm_created_at,
      sm_updated_at = excluded.sm_updated_at,
      synced_at = excluded.synced_at
  `).run(
    job.id, job.servemanager_job_number, job.job_status, job.service_status,
    job.client_job_number, job.rush ? 1 : 0, job.due_date, job.service_instructions,
    recipientName, recipientDesc, clientCompanyName, clientCompanyId,
    processServerName, empServerId, courtCaseNumber, courtCaseId,
    job.attempt_count || 0, job.last_attempt_served_at,
    JSON.stringify(job.addresses || []), JSON.stringify(job.documents_to_be_served || []),
    job.archived_at, job.created_at, job.updated_at, now
  );
}

export function upsertAttemptFromApi(attempt: any): void {
  if (!attempt || !attempt.id || !attempt.job_id) {
    console.warn('[ServeManager] upsertAttemptFromApi: skipping attempt with missing id or job_id');
    return;
  }
  ensureTables();
  const db = getDb();
  const now = localNow();

  db.prepare(`
    INSERT INTO sm_attempts (
      id, job_id, description, success, service_status, serve_type,
      served_at, lat, lng, gps_timestamp, server_name, recipient_name,
      attachments_json, sm_created_at, sm_updated_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      description = excluded.description,
      success = excluded.success,
      service_status = excluded.service_status,
      serve_type = excluded.serve_type,
      served_at = excluded.served_at,
      lat = excluded.lat,
      lng = excluded.lng,
      gps_timestamp = excluded.gps_timestamp,
      server_name = excluded.server_name,
      recipient_name = excluded.recipient_name,
      attachments_json = excluded.attachments_json,
      sm_created_at = excluded.sm_created_at,
      sm_updated_at = excluded.sm_updated_at,
      synced_at = excluded.synced_at
  `).run(
    attempt.id, attempt.job_id, attempt.description,
    attempt.success ? 1 : 0, attempt.service_status, attempt.serve_type,
    attempt.served_at, attempt.lat, attempt.lng, attempt.gps_timestamp,
    attempt.server_name,
    attempt.recipient?.name || attempt.recipient_full_description || null,
    JSON.stringify(attempt.attachments || []),
    attempt.created_at, attempt.updated_at, now
  );
}

// ============================================================
// ROUTES: Configuration & Connection
// ============================================================

// GET /status
router.get('/status', (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();
    const hasKey = !!getApiKey();

    const lastSync = db.prepare(
      'SELECT * FROM sm_sync_log ORDER BY id DESC LIMIT 1'
    ).get() as any;

    const jobCount = (db.prepare('SELECT COUNT(*) as count FROM sm_jobs').get() as any)?.count || 0;
    const attemptCount = (db.prepare('SELECT COUNT(*) as count FROM sm_attempts').get() as any)?.count || 0;

    res.json({
      configured: hasKey,
      last_sync: lastSync || null,
      cached_jobs: jobCount,
      cached_attempts: attemptCount,
    });
  } catch (error: any) {
    console.error('SM status error:', error);
    res.status(500).json({ error: 'Failed to get ServeManager status', code: 'SM_STATUS_ERROR' });
  }
});

// POST /test-connection
router.post('/test-connection', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// PUT /api-key
router.put('/api-key', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { api_key } = req.body;
    const now = localNow();

    if (!api_key || typeof api_key !== 'string' || api_key.trim().length === 0) {
      res.status(400).json({ error: 'api_key is required', code: 'APIKEY_IS_REQUIRED' });
      return;
    }
    if (api_key.trim().length > 500) {
      res.status(400).json({ error: 'api_key must be 500 characters or less', code: 'APIKEY_TOO_LONG' });
      return;
    }

    const encrypted = encryptApiKey(api_key.trim());

    db.prepare(
      "DELETE FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations'"
    ).run();

    db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
      VALUES ('servemanager_api_key', ?, 'integrations', 0, 1, ?, ?)
    `).run(encrypted, now, now);

    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_api_key_updated', 'system_config', 0, 'Updated ServeManager API key', req.ip || 'unknown', now);

    res.json({ success: true, message: 'API key saved' });
  } catch (error: any) {
    console.error('SM set API key error:', error);
    res.status(500).json({ error: 'Failed to save ServeManager API key', code: 'SM_SET_API_KEY_ERROR' });
  }
});

// DELETE /api-key
router.delete('/api-key', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    db.prepare(
      "DELETE FROM system_config WHERE config_key = 'servemanager_api_key' AND category = 'integrations'"
    ).run();

    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_api_key_cleared', 'system_config', 0, 'Cleared ServeManager API key', req.ip || 'unknown', now);

    res.json({ success: true });
  } catch (error: any) {
    console.error('SM clear API key error:', error);
    res.status(500).json({ error: 'Failed to clear ServeManager API key', code: 'SM_CLEAR_API_KEY_ERROR' });
  }
});

// ============================================================
// ROUTES: Jobs
// ============================================================

// GET /jobs — list from cache or live
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    ensureTables();
    const db = getDb();

    const { source = 'cache', page = '1', per_page = '50', q, status, service_status: svcStatus } = req.query;

    if (source === 'live') {
      const cappedPerPage = Math.min(100, Math.max(1, parseInt(String(per_page), 10) || 50));
      const params: Record<string, string> = {
        page: String(Math.max(1, parseInt(String(page), 10) || 1)),
        per_page: String(cappedPerPage),
      };
      if (q) params.q = String(q);
      if (status) params['filter[job_status][]'] = String(status);
      if (svcStatus) params['filter[service_status][]'] = String(svcStatus);

      const result = await smGet('/jobs', params);
      if (Array.isArray(result.data)) {
        for (const job of result.data) {
          upsertJobFromApi(job);
        }
      }
      res.json(result);
      return;
    }

    // Cache mode
    const pageNum = Math.max(1, parseInt(String(page)));
    const limit = Math.min(100, Math.max(1, parseInt(String(per_page))));
    const offset = (pageNum - 1) * limit;

    const conditions: string[] = [];
    const pArr: any[] = [];

    if (q) {
      const like = `%${q}%`;
      conditions.push('(sm_job_number LIKE ? OR recipient_name LIKE ? OR client_company_name LIKE ? OR client_job_number LIKE ?)');
      pArr.push(like, like, like, like);
    }
    if (status) { conditions.push('job_status = ?'); pArr.push(status); }
    if (svcStatus) { conditions.push('service_status = ?'); pArr.push(svcStatus); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) as count FROM sm_jobs ${where}`).get(...pArr) as any).count;
    const rows = db.prepare(`SELECT * FROM sm_jobs ${where} ORDER BY sm_created_at DESC LIMIT ? OFFSET ?`).all(...pArr, limit, offset);

    res.json({
      data: rows,
      pagination: { page: pageNum, per_page: limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    if (error instanceof ServeManagerError) {
      res.status(error.status).json({ error: error.message, details: error.responseBody });
      return;
    }
    console.error('SM jobs list error:', error);
    res.status(500).json({ error: 'Failed to list ServeManager jobs', code: 'SM_JOBS_LIST_ERROR' });
  }
});

// GET /jobs/:id
router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    ensureTables();

    if (req.query.live === 'true') {
      const result = await smGet(`/jobs/${req.params.id}`);
      if (!result.data) {
        res.status(404).json({ error: 'Job not found on ServeManager', code: 'SM_JOB_NOT_FOUND' });
        return;
      }
      upsertJobFromApi(result.data);
      if (Array.isArray(result.data.attempts)) {
        for (const attempt of result.data.attempts) {
          upsertAttemptFromApi({ ...attempt, job_id: result.data.id });
        }
      }
      res.json({ data: result.data });
      return;
    }

    const db = getDb();
    const job = db.prepare('SELECT * FROM sm_jobs WHERE id = ?').get(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found in cache. Try ?live=true', code: 'JOB_NOT_FOUND_IN' }); return; }
    const attempts = db.prepare('SELECT * FROM sm_attempts WHERE job_id = ? ORDER BY sm_created_at DESC').all(req.params.id);

    res.json({ data: { ...(job as any), attempts } });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('SM job detail error:', error);
    res.status(500).json({ error: 'Failed to get ServeManager job detail', code: 'SM_JOB_DETAIL_ERROR' });
  }
});

// POST /jobs — create on SM
router.post('/jobs', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const now = localNow();
    const result = await smPost('/jobs', { type: 'job', ...req.body });
    if (!result.data) { res.status(502).json({ error: 'No data returned from ServeManager' }); return; }
    upsertJobFromApi(result.data);

    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_job_created', 'sm_job', result.data.id,
      `Created SM job #${result.data.servemanager_job_number}`, req.ip || 'unknown', now);

    res.status(201).json({ data: result.data });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message, details: error.responseBody }); return; }
    console.error('SM create job error:', error);
    res.status(500).json({ error: 'Failed to create ServeManager job', code: 'SM_CREATE_JOB_ERROR' });
  }
});

// PUT /jobs/:id — update on SM
router.put('/jobs/:id', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const now = localNow();
    const result = await smPut(`/jobs/${req.params.id}`, { type: 'job', ...req.body });
    if (!result.data) { res.status(502).json({ error: 'No data returned from ServeManager' }); return; }
    upsertJobFromApi(result.data);

    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_job_updated', 'sm_job', req.params.id,
      `Updated SM job #${result.data.servemanager_job_number}`, req.ip || 'unknown', now);

    res.json({ data: result.data });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message, details: error.responseBody }); return; }
    console.error('SM update job error:', error);
    res.status(500).json({ error: 'Failed to update ServeManager job', code: 'SM_UPDATE_JOB_ERROR' });
  }
});

// POST /jobs/:id/cancel
router.post('/jobs/:id/cancel', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const now = localNow();

    const result = await smPost(`/jobs/${req.params.id}/cancel`, {
      type: 'note',
      cancellation_note_label: req.body.label || 'Cancelled',
      cancellation_note_body: req.body.body || 'Job cancelled via RMPG Flex',
    });

    try {
      const refreshed = await smGet(`/jobs/${req.params.id}`);
      upsertJobFromApi(refreshed.data);
    } catch (refreshErr) {
      console.error('[ServeManager] Non-fatal: failed to refresh cancelled job:', refreshErr instanceof Error ? refreshErr.message : refreshErr);
    }

    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_job_cancelled', 'sm_job', req.params.id,
      `Cancelled SM job ${req.params.id}`, req.ip || 'unknown', now);

    res.json({ success: true, data: result.data || null });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message, details: error.responseBody }); return; }
    console.error('SM cancel job error:', error);
    res.status(500).json({ error: 'Failed to cancel ServeManager job', code: 'SM_CANCEL_JOB_ERROR' });
  }
});

// ============================================================
// ROUTES: Attempts
// ============================================================

// GET /jobs/:jobId/attempts
router.get('/jobs/:jobId/attempts', async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    ensureTables();
    const db = getDb();

    if (req.query.live === 'true') {
      const jobId = String(req.params.jobId);
      const result = await smGet('/attempts', { 'filter[job_id]': jobId });
      if (Array.isArray(result.data)) {
        for (const attempt of result.data) {
          upsertAttemptFromApi({ ...attempt, job_id: parseInt(jobId) });
        }
      }
      res.json(result);
      return;
    }

    const rows = db.prepare('SELECT * FROM sm_attempts WHERE job_id = ? ORDER BY sm_created_at DESC LIMIT 1000').all(req.params.jobId);
    res.json({ data: rows });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('SM attempts error:', error);
    res.status(500).json({ error: 'Failed to list ServeManager attempts', code: 'SM_ATTEMPTS_ERROR' });
  }
});

// POST /attempts — create on SM
router.post('/attempts', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const now = localNow();
    const result = await smPost('/attempts', { type: 'attempt', ...req.body });
    upsertAttemptFromApi(result.data);

    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_attempt_created', 'sm_attempt', result.data.id,
      `Created attempt on SM job ${result.data.job_id}`, req.ip || 'unknown', now);

    res.status(201).json({ data: result.data });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message, details: error.responseBody }); return; }
    console.error('SM create attempt error:', error);
    res.status(500).json({ error: 'Failed to create ServeManager attempt', code: 'SM_CREATE_ATTEMPT_ERROR' });
  }
});

// ============================================================
// ROUTES: Notes
// ============================================================

// POST /jobs/:jobId/notes
router.post('/jobs/:jobId/notes', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const result = await smPost(`/jobs/${req.params.jobId}/notes`, { type: 'note', ...req.body });
    res.status(201).json({ data: result.data });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('SM create note error:', error);
    res.status(500).json({ error: 'Failed to create ServeManager note', code: 'SM_CREATE_NOTE_ERROR' });
  }
});

// ============================================================
// ROUTES: Reference Data (proxy to SM)
// ============================================================

// GET /companies
router.get('/companies', async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const params: Record<string, string> = {};
    if (req.query.q) params.q = String(req.query.q);
    if (req.query.page) params.page = String(req.query.page);
    const result = await smGet('/companies', params);
    res.json(result);
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('SM companies error:', error);
    res.status(500).json({ error: 'Failed to fetch companies', code: 'SM_COMPANIES_ERROR' });
  }
});

// GET /courts
router.get('/courts', async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const result = await smGet('/courts');
    res.json(result);
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('SM courts error:', error);
    res.status(500).json({ error: 'Failed to fetch courts', code: 'SM_COURTS_ERROR' });
  }
});

// GET /employees
router.get('/employees', async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const result = await smGet('/employees');
    res.json(result);
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('SM employees error:', error);
    res.status(500).json({ error: 'Failed to fetch employees', code: 'SM_EMPLOYEES_ERROR' });
  }
});

// GET /court-cases
router.get('/court-cases', async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const params: Record<string, string> = {};
    if (req.query.q) params.q = String(req.query.q);
    if (req.query.page) params.page = String(req.query.page);
    const result = await smGet('/court_cases', params);
    res.json(result);
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('SM court-cases error:', error);
    res.status(500).json({ error: 'Failed to fetch court cases', code: 'SM_COURT_CASES_ERROR' });
  }
});

// ============================================================
// ROUTES: Sync
// ============================================================

// POST /sync — full or incremental
router.post('/sync', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    ensureTables();
    const db = getDb();
    const now = localNow();
    const { type = 'incremental' } = req.body;

    if (!['incremental', 'full'].includes(type)) {
      res.status(400).json({ error: 'sync type must be "incremental" or "full"', code: 'INVALID_SYNC_TYPE' });
      return;
    }

    const syncResult = db.prepare(
      'INSERT INTO sm_sync_log (sync_type, status, started_at) VALUES (?, ?, ?)'
    ).run(type, 'running', now);
    const syncId = syncResult.lastInsertRowid;

    let jobsSynced = 0;
    let attemptsSynced = 0;

    try {
      let page = 1;
      let hasMore = true;
      const params: Record<string, string> = { per_page: '100' };

      if (type === 'incremental') {
        const lastGood = db.prepare(
          "SELECT completed_at FROM sm_sync_log WHERE status = 'completed' ORDER BY id DESC LIMIT 1"
        ).get() as any;
        if (lastGood?.completed_at) {
          params['filter[date_range][type]'] = 'updated_at';
          params['filter[date_range][min]'] = lastGood.completed_at;
        }
      }

      while (hasMore) {
        params.page = String(page);
        const result = await smGet('/jobs', params);

        if (Array.isArray(result.data)) {
          for (const job of result.data) {
            upsertJobFromApi(job);
            jobsSynced++;
            if (Array.isArray(job.attempts)) {
              for (const attempt of job.attempts) {
                upsertAttemptFromApi({ ...attempt, job_id: job.id });
                attemptsSynced++;
              }
            }
          }
          hasMore = result.links?.next != null && result.data.length > 0;
          page++;
        } else {
          hasMore = false;
        }

        if (page > 50) hasMore = false; // safety valve
      }

      db.prepare(
        'UPDATE sm_sync_log SET status = ?, jobs_synced = ?, attempts_synced = ?, completed_at = ? WHERE id = ?'
      ).run('completed', jobsSynced, attemptsSynced, localNow(), syncId);

      db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(req.user!.userId, 'sm_sync_completed', 'sm_sync', syncId,
        `${type} sync: ${jobsSynced} jobs, ${attemptsSynced} attempts`, req.ip || 'unknown', now);

      res.json({ success: true, sync_id: syncId, type, jobs_synced: jobsSynced, attempts_synced: attemptsSynced });
    } catch (syncErr: any) {
      db.prepare(
        'UPDATE sm_sync_log SET status = ?, error_message = ?, completed_at = ? WHERE id = ?'
      ).run('failed', syncErr.message, localNow(), syncId);
      throw syncErr;
    }
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('SM sync error:', error);
    res.status(500).json({ error: 'Failed to sync ServeManager data', code: 'SM_SYNC_ERROR' });
  }
});

// GET /sync/log
router.get('/sync/log', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM sm_sync_log ORDER BY id DESC LIMIT 20').all();
    res.json({ data: rows });
  } catch (error: any) {
    console.error('SM sync log error:', error);
    res.status(500).json({ error: 'Failed to get ServeManager sync log', code: 'SM_SYNC_LOG_ERROR' });
  }
});

// ============================================================
// ROUTES: Local linkage
// ============================================================

// PUT /jobs/:id/link — link SM job to local warrant/call
router.put('/jobs/:id/link', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();
    const now = localNow();
    const { linked_warrant_id, linked_call_id, notes_local } = req.body;

    const job = db.prepare('SELECT id FROM sm_jobs WHERE id = ?').get(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found in cache', code: 'JOB_NOT_FOUND_IN' }); return; }

    // Validate link IDs are integers or null
    if (linked_warrant_id !== undefined && linked_warrant_id !== null && (!Number.isInteger(linked_warrant_id) || linked_warrant_id < 0)) {
      res.status(400).json({ error: 'linked_warrant_id must be a positive integer or null', code: 'INVALID_LINKED_WARRANT_ID' });
      return;
    }
    if (linked_call_id !== undefined && linked_call_id !== null && (!Number.isInteger(linked_call_id) || linked_call_id < 0)) {
      res.status(400).json({ error: 'linked_call_id must be a positive integer or null', code: 'INVALID_LINKED_CALL_ID' });
      return;
    }
    if (notes_local !== undefined && notes_local !== null && typeof notes_local !== 'string') {
      res.status(400).json({ error: 'notes_local must be a string', code: 'INVALID_NOTES_LOCAL' });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    if (linked_warrant_id !== undefined) { updates.push('linked_warrant_id = ?'); values.push(linked_warrant_id); }
    if (linked_call_id !== undefined) { updates.push('linked_call_id = ?'); values.push(linked_call_id); }
    if (notes_local !== undefined) { updates.push('notes_local = ?'); values.push(notes_local); }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE sm_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_job_linked', 'sm_job', req.params.id,
      'Linked SM job to local records', req.ip || 'unknown', now);

    const updated = db.prepare('SELECT * FROM sm_jobs WHERE id = ?').get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('SM link job error:', error);
    res.status(500).json({ error: 'Failed to link ServeManager job', code: 'SM_LINK_JOB_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Attempt Geolocation Tracking
// ════════════════════════════════════════════════════════════

router.get('/jobs/:jobId/geolocation-history', (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();
    const attempts = db.prepare(`
      SELECT id, description, success, served_at, lat, lng, gps_timestamp, server_name, service_status
      FROM sm_attempts WHERE job_id = ? AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY sm_created_at ASC
    `).all(req.params.jobId) as any[];

    const addresses = db.prepare('SELECT addresses_json FROM sm_jobs WHERE id = ?').get(req.params.jobId) as any;
    let parsedAddresses: any[] = [];
    try { parsedAddresses = JSON.parse(addresses?.addresses_json || '[]'); } catch { /* ignore */ }

    res.json({
      data: {
        job_id: parseInt(req.params.jobId as string),
        attempts_with_gps: attempts,
        known_addresses: parsedAddresses,
        total_attempts: attempts.length,
      },
    });
  } catch (error: any) {
    console.error('SM geolocation history error:', error);
    res.status(500).json({ error: 'Failed to get geolocation history', code: 'SM_GEOLOCATION_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Optimal Serve Time Suggestions
// ════════════════════════════════════════════════════════════

router.get('/jobs/:jobId/optimal-times', (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();
    const job = db.prepare('SELECT * FROM sm_jobs WHERE id = ?').get(req.params.jobId) as any;
    if (!job) return res.status(404).json({ error: 'Job not found in cache', code: 'JOB_NOT_FOUND_IN' });

    // Analyze past attempts for this recipient at any address
    const attempts = db.prepare(`
      SELECT a.served_at, a.success, a.description
      FROM sm_attempts a
      JOIN sm_jobs j ON a.job_id = j.id
      WHERE j.recipient_name = ? AND a.served_at IS NOT NULL
      ORDER BY a.sm_created_at ASC
    `).all(job.recipient_name) as any[];

    // Analyze by hour of day and day of week
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

    // Find best hours and days
    const bestHours = Object.entries(hourStats)
      .filter(([_, s]) => s.successes > 0)
      .sort((a, b) => (b[1].successes / b[1].attempts) - (a[1].successes / a[1].attempts))
      .slice(0, 3)
      .map(([h, s]) => ({ hour: parseInt(h), success_rate: Math.round((s.successes / s.attempts) * 100), attempts: s.attempts }));

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const bestDays = Object.entries(dayStats)
      .filter(([_, s]) => s.successes > 0)
      .sort((a, b) => (b[1].successes / b[1].attempts) - (a[1].successes / a[1].attempts))
      .slice(0, 3)
      .map(([d, s]) => ({ day: dayNames[parseInt(d)], success_rate: Math.round((s.successes / s.attempts) * 100), attempts: s.attempts }));

    const suggestions: string[] = [];
    if (bestHours.length > 0) suggestions.push(`Best time: ${bestHours[0].hour}:00 (${bestHours[0].success_rate}% success rate)`);
    if (bestDays.length > 0) suggestions.push(`Best day: ${bestDays[0].day} (${bestDays[0].success_rate}% success rate)`);
    if (attempts.length === 0) suggestions.push('No historical data — try morning (8-10 AM) or evening (5-7 PM)');

    res.json({
      data: {
        job_id: parseInt(req.params.jobId as string),
        recipient_name: job.recipient_name,
        total_historical_attempts: attempts.length,
        best_hours: bestHours,
        best_days: bestDays,
        suggestions,
      },
    });
  } catch (error: any) {
    console.error('SM optimal times error:', error);
    res.status(500).json({ error: 'Failed to calculate optimal times', code: 'SM_OPTIMAL_TIMES_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Batch Assignment to Process Servers
// ════════════════════════════════════════════════════════════

router.post('/jobs/batch-assign', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const { job_ids, employee_process_server_id } = req.body;

    if (!Array.isArray(job_ids) || job_ids.length === 0)
      return res.status(400).json({ error: 'job_ids array required', code: 'JOB_IDS_REQUIRED' });
    if (!employee_process_server_id)
      return res.status(400).json({ error: 'employee_process_server_id required', code: 'SERVER_ID_REQUIRED' });

    if (job_ids.length > 50)
      return res.status(400).json({ error: 'Maximum 50 jobs per batch', code: 'MAX_BATCH_SIZE' });

    const now = localNow();
    const results: { job_id: number; success: boolean; error?: string }[] = [];

    for (const jobId of job_ids) {
      try {
        const result = await smPut(`/jobs/${jobId}`, {
          type: 'job',
          employee_process_server_id,
        });
        upsertJobFromApi(result.data);
        results.push({ job_id: jobId, success: true });
      } catch (err: any) {
        results.push({ job_id: jobId, success: false, error: err.message });
      }
    }

    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_batch_assign', 'sm_job', 0,
      `Batch assigned ${results.filter(r => r.success).length}/${job_ids.length} jobs to server ${employee_process_server_id}`,
      req.ip || 'unknown', now);

    res.json({
      success: true,
      assigned: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('SM batch assign error:', error);
    res.status(500).json({ error: 'Failed to batch assign', code: 'SM_BATCH_ASSIGN_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Completion Rate Statistics
// ════════════════════════════════════════════════════════════

router.get('/stats/completion', (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();

    const overall = db.prepare(`
      SELECT
        COUNT(*) as total_jobs,
        SUM(CASE WHEN service_status = 'Served' THEN 1 ELSE 0 END) as served,
        SUM(CASE WHEN service_status = 'Not Served' THEN 1 ELSE 0 END) as not_served,
        SUM(CASE WHEN service_status = 'Canceled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN job_status = 'Opened' THEN 1 ELSE 0 END) as open,
        AVG(attempt_count) as avg_attempts,
        AVG(CASE WHEN service_status = 'Served' THEN attempt_count END) as avg_attempts_to_serve
      FROM sm_jobs
    `).get() as any;

    const completionRate = overall.total_jobs > 0
      ? Math.round((overall.served / overall.total_jobs) * 100) : 0;

    // By process server
    const byServer = db.prepare(`
      SELECT process_server_name,
        COUNT(*) as total_jobs,
        SUM(CASE WHEN service_status = 'Served' THEN 1 ELSE 0 END) as served,
        ROUND(AVG(attempt_count), 1) as avg_attempts
      FROM sm_jobs WHERE process_server_name IS NOT NULL AND process_server_name != ''
      GROUP BY process_server_name ORDER BY total_jobs DESC
    `).all() as any[];

    // Monthly trend
    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', sm_created_at) as month,
        COUNT(*) as total,
        SUM(CASE WHEN service_status = 'Served' THEN 1 ELSE 0 END) as served
      FROM sm_jobs WHERE sm_created_at IS NOT NULL
      GROUP BY month ORDER BY month DESC LIMIT 12
    `).all();

    // Rush vs standard
    const rushStats = db.prepare(`
      SELECT
        SUM(CASE WHEN rush = 1 THEN 1 ELSE 0 END) as rush_total,
        SUM(CASE WHEN rush = 1 AND service_status = 'Served' THEN 1 ELSE 0 END) as rush_served,
        SUM(CASE WHEN rush = 0 THEN 1 ELSE 0 END) as standard_total,
        SUM(CASE WHEN rush = 0 AND service_status = 'Served' THEN 1 ELSE 0 END) as standard_served
      FROM sm_jobs
    `).get() as any;

    res.json({
      data: {
        overall: { ...overall, completion_rate: completionRate },
        by_server: byServer.map((s: any) => ({
          ...s,
          completion_rate: s.total_jobs > 0 ? Math.round((s.served / s.total_jobs) * 100) : 0,
        })),
        monthly_trend: monthlyTrend,
        rush_vs_standard: rushStats,
      },
    });
  } catch (error: any) {
    console.error('SM completion stats error:', error);
    res.status(500).json({ error: 'Failed to get completion stats', code: 'SM_COMPLETION_STATS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Link Serve Jobs to Warrants/Trespass Orders
// ════════════════════════════════════════════════════════════

router.get('/jobs/:id/linked-records', (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();
    const job = db.prepare('SELECT * FROM sm_jobs WHERE id = ?').get(req.params.id) as any;
    if (!job) return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND_IN' });

    const links: any = { warrant: null, call: null, trespass_orders: [] };

    if (job.linked_warrant_id) {
      links.warrant = db.prepare('SELECT id, warrant_number, warrant_type, status, subject_name FROM warrants WHERE id = ?')
        .get(job.linked_warrant_id);
    }
    if (job.linked_call_id) {
      links.call = db.prepare('SELECT id, call_number, call_type, status FROM calls WHERE id = ?')
        .get(job.linked_call_id);
    }

    // Try to find trespass orders by recipient name
    if (job.recipient_name) {
      const trespassOrders = db.prepare(`
        SELECT id, alert_type, severity, description, status
        FROM offender_alerts WHERE alert_type = 'ban_zone' AND status = 'active'
        AND person_id IN (SELECT id FROM persons WHERE first_name || ' ' || last_name LIKE ?)
        LIMIT 10
      `).all(`%${job.recipient_name}%`);
      links.trespass_orders = trespassOrders;
    }

    res.json({ data: links });
  } catch (error: any) {
    console.error('SM linked records error:', error);
    res.status(500).json({ error: 'Failed to get linked records', code: 'SM_LINKS_ERROR' });
  }
});


export default router;
