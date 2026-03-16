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
import { escapeLike, validateParamId } from '../middleware/sanitize';

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

// Lazy init — tables are created on first request, after initDatabase() has run
let smTablesReady = false;
function ensureSmTables(): void {
  if (smTablesReady) return;
  initSmTables();
  smTablesReady = true;
}
router.use((_req, _res, next) => { try { ensureSmTables(); } catch (err) { console.error('[ServeManager] Table init failed:', err); } next(); });

// ============================================================
// Helpers
// ============================================================

function ensureTables(): void {
  try { ensureSmTables(); } catch { /* ignore */ }
}

function requireApiKey(_req: Request, res: Response): boolean {
  if (!getApiKey()) {
    res.status(400).json({ error: 'ServeManager API key not configured. Set it in Admin > ServeManager.' });
    return false;
  }
  return true;
}

export function upsertJobFromApi(job: any): void {
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
    job.attempt_count ?? 0, job.last_attempt_served_at,
    JSON.stringify(job.addresses || []), JSON.stringify(job.documents_to_be_served || []),
    job.archived_at, job.created_at, job.updated_at, now
  );
}

export function upsertAttemptFromApi(attempt: any): void {
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
router.get('/status', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
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
    console.error('SM status error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /test-connection
router.post('/test-connection', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error: any) {
    res.status(502).json({ success: false, error: 'Connection test failed' });
  }
});

// PUT /api-key
router.put('/api-key', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { api_key } = req.body;
    const now = localNow();

    if (!api_key || typeof api_key !== 'string' || api_key.trim().length === 0) {
      res.status(400).json({ error: 'api_key is required' });
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
    console.error('SM set API key error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('SM clear API key error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTES: Jobs
// ============================================================

// GET /jobs — list from cache or live
router.get('/jobs', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    ensureTables();
    const db = getDb();

    const { source = 'cache', page = '1', per_page = '50', q, status, service_status: svcStatus } = req.query;

    if (source === 'live') {
      const params: Record<string, string> = {
        page: String(page),
        per_page: String(per_page),
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
    const parsedPage = parseInt(String(page), 10);
    const pageNum = Math.max(1, isNaN(parsedPage) ? 1 : parsedPage);
    const parsedPerPage = parseInt(String(per_page), 10);
    const limit = Math.min(100, Math.max(1, isNaN(parsedPerPage) ? 25 : parsedPerPage));
    const offset = (pageNum - 1) * limit;

    const conditions: string[] = [];
    const pArr: any[] = [];

    if (q) {
      const like = `%${escapeLike(String(q))}%`;
      conditions.push("(sm_job_number LIKE ? ESCAPE '\\' OR recipient_name LIKE ? ESCAPE '\\' OR client_company_name LIKE ? ESCAPE '\\' OR client_job_number LIKE ? ESCAPE '\\')");
      pArr.push(like, like, like, like);
    }
    if (status) { conditions.push('job_status = ?'); pArr.push(status); }
    if (svcStatus) { conditions.push('service_status = ?'); pArr.push(svcStatus); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) as count FROM sm_jobs ${where}`).get(...pArr) as any)?.count || 0;
    const rows = db.prepare(`SELECT * FROM sm_jobs ${where} ORDER BY sm_created_at DESC LIMIT ? OFFSET ?`).all(...pArr, limit, offset);

    res.json({
      data: rows,
      pagination: { page: pageNum, per_page: limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    if (error instanceof ServeManagerError) {
      res.status(error.status).json({ error: 'ServeManager request failed' });
      return;
    }
    console.error('SM jobs list error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /jobs/:id
router.get('/jobs/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    ensureTables();

    if (req.query.live === 'true') {
      const result = await smGet(`/jobs/${req.params.id}`);
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
    if (!job) { res.status(404).json({ error: 'Job not found in cache. Try ?live=true' }); return; }
    const attempts = db.prepare('SELECT * FROM sm_attempts WHERE job_id = ? ORDER BY sm_created_at DESC').all(req.params.id);

    res.json({ data: { ...(job as any), attempts } });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    console.error('SM job detail error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /jobs — create on SM
router.post('/jobs', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const now = localNow();
    const result = await smPost('/jobs', { type: 'job', ...req.body });
    upsertJobFromApi(result.data);

    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_job_created', 'sm_job', result.data.id,
      `Created SM job #${result.data.servemanager_job_number}`, req.ip || 'unknown', now);

    res.status(201).json({ data: result.data });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    console.error('SM create job error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /jobs/:id — update on SM
router.put('/jobs/:id', validateParamId, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const now = localNow();
    const result = await smPut(`/jobs/${req.params.id}`, { type: 'job', ...req.body });
    upsertJobFromApi(result.data);

    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_job_updated', 'sm_job', req.params.id,
      `Updated SM job #${result.data.servemanager_job_number}`, req.ip || 'unknown', now);

    res.json({ data: result.data });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    console.error('SM update job error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /jobs/:id/cancel
router.post('/jobs/:id/cancel', validateParamId, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
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
    } catch { /* non-fatal */ }

    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_job_cancelled', 'sm_job', req.params.id,
      `Cancelled SM job ${req.params.id}`, req.ip || 'unknown', now);

    res.json({ success: true, data: result.data });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    console.error('SM cancel job error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTES: Attempts
// ============================================================

// GET /jobs/:jobId/attempts
router.get('/jobs/:jobId/attempts', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    ensureTables();
    const db = getDb();

    if (req.query.live === 'true') {
      const jobId = String(req.params.jobId);
      const result = await smGet('/attempts', { 'filter[job_id]': jobId });
      if (Array.isArray(result.data)) {
        for (const attempt of result.data) {
          upsertAttemptFromApi({ ...attempt, job_id: parseInt(jobId, 10) });
        }
      }
      res.json(result);
      return;
    }

    const rows = db.prepare('SELECT * FROM sm_attempts WHERE job_id = ? ORDER BY sm_created_at DESC').all(req.params.jobId);
    res.json({ data: rows });
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    console.error('SM attempts error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    console.error('SM create attempt error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    console.error('SM create note error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTES: Reference Data (proxy to SM)
// ============================================================

// GET /companies
router.get('/companies', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const params: Record<string, string> = {};
    if (req.query.q) params.q = String(req.query.q);
    if (req.query.page) params.page = String(req.query.page);
    const result = await smGet('/companies', params);
    res.json(result);
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /courts
router.get('/courts', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const result = await smGet('/courts');
    res.json(result);
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /employees
router.get('/employees', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const result = await smGet('/employees');
    res.json(result);
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /court-cases
router.get('/court-cases', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const params: Record<string, string> = {};
    if (req.query.q) params.q = String(req.query.q);
    if (req.query.page) params.page = String(req.query.page);
    const result = await smGet('/court_cases', params);
    res.json(result);
  } catch (error: any) {
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    res.status(500).json({ error: 'Internal server error' });
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
    if (error instanceof ServeManagerError) { res.status(error.status).json({ error: 'ServeManager request failed' }); return; }
    console.error('SM sync error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('SM sync log error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTES: Local linkage
// ============================================================

// PUT /jobs/:id/link — link SM job to local warrant/call
router.put('/jobs/:id/link', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();
    const now = localNow();
    const { linked_warrant_id, linked_call_id, notes_local } = req.body;

    const job = db.prepare('SELECT id FROM sm_jobs WHERE id = ?').get(req.params.id);
    if (!job) { res.status(404).json({ error: 'Job not found in cache' }); return; }

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
    console.error('SM link job error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTES: Auto-poller config
// ============================================================

import {
  startServeManagerPoller,
  stopServeManagerPoller,
  restartServeManagerPoller,
  pollServeManagerNow,
} from '../utils/serveManagerPoller';

function getPollerConfig(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

function setPollerConfig(key: string, value: string): void {
  const db = getDb();
  const now = localNow();
  db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(key);
  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)"
  ).run(key, value, now, now);
}

// GET /poller/status — current poller config
router.get('/poller/status', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    res.json({
      enabled: getPollerConfig('servemanager_poller_enabled') === 'true',
      poll_interval: parseInt(getPollerConfig('servemanager_poll_interval') || '300', 10),
      target_client: getPollerConfig('servemanager_target_client') || 'ICU Investigations, LLC',
      auto_create_calls: getPollerConfig('servemanager_auto_create_calls') !== 'false',
      last_poll_at: getPollerConfig('servemanager_last_poll_at') || null,
    });
  } catch (error: any) {
    console.error('SM poller status error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /poller/settings — update poller config + restart
router.put('/poller/settings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { enabled, poll_interval, target_client, auto_create_calls } = req.body;

    if (enabled !== undefined) {
      setPollerConfig('servemanager_poller_enabled', String(!!enabled));
    }
    if (poll_interval !== undefined) {
      const secs = Math.max(60, Math.min(1800, parseInt(poll_interval, 10) || 300));
      setPollerConfig('servemanager_poll_interval', String(secs));
    }
    if (target_client !== undefined) {
      setPollerConfig('servemanager_target_client', String(target_client));
    }
    if (auto_create_calls !== undefined) {
      setPollerConfig('servemanager_auto_create_calls', String(!!auto_create_calls));
    }

    // Restart or stop based on enabled state
    const isEnabled = getPollerConfig('servemanager_poller_enabled') === 'true';
    if (isEnabled && getApiKey()) {
      restartServeManagerPoller();
    } else {
      stopServeManagerPoller();
    }

    // Audit log
    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user!.userId, 'sm_poller_settings_updated', 'system', null,
      `SM poller: enabled=${isEnabled}, interval=${poll_interval || 'unchanged'}, client=${target_client || 'unchanged'}`,
      req.ip || 'unknown', localNow());

    res.json({ success: true, message: isEnabled ? 'Poller restarted' : 'Poller stopped' });
  } catch (error: any) {
    console.error('SM poller settings error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /poller/poll-now — trigger immediate poll
router.post('/poller/poll-now', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!requireApiKey(req, res)) return;
    const result = await pollServeManagerNow();
    res.json(result);
  } catch (error: any) {
    console.error('SM poll-now error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
