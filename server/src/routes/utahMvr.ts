// ============================================================
// Utah Motor Vehicle Records (MVR) Integration Routes
// ============================================================
// Credential management, query proxy, and audit logging for
// the Utah Division of Motor Vehicles (DLD) electronic records.
// Tables are self-initialized on import.

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import {
  getMvrCredentials, isConfigured, encryptCredential,
  queryRegistration, queryDriverRecord, queryByVin,
  testConnection, UtahMvrError,
} from '../utils/utahMvrClient';

const router = Router();
router.use(authenticateToken);

// ============================================================
// Table initialization (self-contained)
// ============================================================

function initMvrTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS utah_mvr_queries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      query_type   TEXT NOT NULL,
      query_input  TEXT NOT NULL,
      queried_by   INTEGER NOT NULL,
      response_json TEXT,
      hit          INTEGER DEFAULT 0,
      error_msg    TEXT,
      queried_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (queried_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mvr_queries_type ON utah_mvr_queries(query_type);
    CREATE INDEX IF NOT EXISTS idx_mvr_queries_user ON utah_mvr_queries(queried_by);
    CREATE INDEX IF NOT EXISTS idx_mvr_queries_input ON utah_mvr_queries(query_input);
  `);
}

try { initMvrTables(); } catch { /* DB not ready yet — will init on first request */ }

// ============================================================
// Helpers
// ============================================================

function ensureTables(): void {
  try { initMvrTables(); } catch { /* ignore */ }
}

function requireCredentials(_req: Request, res: Response): boolean {
  if (!isConfigured()) {
    res.status(400).json({ error: 'Utah MVR credentials not configured. Set them in Admin > Utah MVR.' });
    return false;
  }
  return true;
}

function logQuery(
  userId: number,
  queryType: string,
  queryInput: string,
  responseJson: string | null,
  hit: boolean,
  errorMsg: string | null,
): void {
  try {
    ensureTables();
    const db = getDb();
    db.prepare(`
      INSERT INTO utah_mvr_queries (query_type, query_input, queried_by, response_json, hit, error_msg)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(queryType, queryInput, userId, responseJson, hit ? 1 : 0, errorMsg);
  } catch (err) {
    console.error('[UTAH-MVR] Failed to log query:', err);
  }
}

function logActivity(userId: number, action: string, details: string, ip: string): void {
  try {
    const db = getDb();
    const now = localNow();
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, action, 'utah_mvr', 0, details, ip, now);
  } catch { /* non-fatal */ }
}

// ============================================================
// ROUTES: Configuration & Connection
// ============================================================

// GET /status
router.get('/status', (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();
    const configured = isConfigured();

    const totalQueries = (db.prepare('SELECT COUNT(*) as count FROM utah_mvr_queries').get() as any)?.count || 0;
    const totalHits = (db.prepare('SELECT COUNT(*) as count FROM utah_mvr_queries WHERE hit = 1').get() as any)?.count || 0;
    const lastQuery = db.prepare('SELECT queried_at FROM utah_mvr_queries ORDER BY id DESC LIMIT 1').get() as any;

    res.json({
      configured,
      total_queries: totalQueries,
      total_hits: totalHits,
      last_query_at: lastQuery?.queried_at || null,
    });
  } catch (error: any) {
    console.error('[UTAH-MVR] Status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /test-connection
router.post('/test-connection', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const result = await testConnection();
    logActivity(req.user!.userId, 'utah_mvr_test_connection', `Result: ${result.success ? 'success' : result.error}`, req.ip || 'unknown');
    res.json(result);
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// PUT /credentials
router.put('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { username, password } = req.body;
    const now = localNow();

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Both username and password are required' });
      return;
    }

    const encryptedUser = encryptCredential(username.trim());
    const encryptedPass = encryptCredential(password.trim());

    // Remove existing credentials
    db.prepare("DELETE FROM system_config WHERE config_key IN ('utah_mvr_username', 'utah_mvr_password') AND category = 'integrations'").run();

    // Insert new credentials
    const insertStmt = db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, 'integrations', 0, 1, ?, ?)
    `);
    insertStmt.run('utah_mvr_username', encryptedUser, now, now);
    insertStmt.run('utah_mvr_password', encryptedPass, now, now);

    logActivity(req.user!.userId, 'utah_mvr_credentials_updated', 'Updated Utah MVR credentials', req.ip || 'unknown');

    res.json({ success: true, message: 'Credentials saved' });
  } catch (error: any) {
    console.error('[UTAH-MVR] Set credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /credentials
router.delete('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare("DELETE FROM system_config WHERE config_key IN ('utah_mvr_username', 'utah_mvr_password') AND category = 'integrations'").run();
    logActivity(req.user!.userId, 'utah_mvr_credentials_cleared', 'Cleared Utah MVR credentials', req.ip || 'unknown');
    res.json({ success: true });
  } catch (error: any) {
    console.error('[UTAH-MVR] Clear credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// ROUTES: Queries
// ============================================================

// GET /query/registration?plate=XXX&state=UT
router.get('/query/registration', async (req: Request, res: Response) => {
  try {
    if (!requireCredentials(req, res)) return;

    const plate = String(req.query.plate || '').trim().toUpperCase();
    const state = String(req.query.state || 'UT').trim().toUpperCase();

    if (!plate) {
      res.status(400).json({ error: 'plate parameter is required' });
      return;
    }

    const result = await queryRegistration(plate, state);
    const hit = !!result.data;
    logQuery(req.user!.userId, 'registration', `${plate} (${state})`, JSON.stringify(result.data), hit, null);
    logActivity(req.user!.userId, 'utah_mvr_query_registration', `Queried plate ${plate} (${state})`, req.ip || 'unknown');

    res.json({ type: 'registration', query: plate, hit, data: result.data });
  } catch (error: any) {
    const plate = String(req.query.plate || '');
    logQuery(req.user!.userId, 'registration', plate, null, false, error.message);
    if (error instanceof UtahMvrError) {
      res.status(error.status).json({ error: error.message, details: error.responseBody });
      return;
    }
    console.error('[UTAH-MVR] Registration query error:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// GET /query/driver?dl=XXXXXXX
router.get('/query/driver', async (req: Request, res: Response) => {
  try {
    if (!requireCredentials(req, res)) return;

    const dl = String(req.query.dl || '').trim();
    if (!dl) {
      res.status(400).json({ error: 'dl parameter is required' });
      return;
    }

    const result = await queryDriverRecord(dl);
    const hit = !!result.data;
    logQuery(req.user!.userId, 'driver_record', dl, JSON.stringify(result.data), hit, null);
    logActivity(req.user!.userId, 'utah_mvr_query_driver', `Queried DL ${dl}`, req.ip || 'unknown');

    res.json({ type: 'driver_record', query: dl, hit, data: result.data });
  } catch (error: any) {
    const dl = String(req.query.dl || '');
    logQuery(req.user!.userId, 'driver_record', dl, null, false, error.message);
    if (error instanceof UtahMvrError) {
      res.status(error.status).json({ error: error.message, details: error.responseBody });
      return;
    }
    console.error('[UTAH-MVR] Driver query error:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// GET /query/vin?vin=XXXXXXX
router.get('/query/vin', async (req: Request, res: Response) => {
  try {
    if (!requireCredentials(req, res)) return;

    const vin = String(req.query.vin || '').trim().toUpperCase();
    if (!vin) {
      res.status(400).json({ error: 'vin parameter is required' });
      return;
    }

    const result = await queryByVin(vin);
    const hit = !!result.data;
    logQuery(req.user!.userId, 'vin', vin, JSON.stringify(result.data), hit, null);
    logActivity(req.user!.userId, 'utah_mvr_query_vin', `Queried VIN ${vin}`, req.ip || 'unknown');

    res.json({ type: 'vin', query: vin, hit, data: result.data });
  } catch (error: any) {
    const vin = String(req.query.vin || '');
    logQuery(req.user!.userId, 'vin', vin, null, false, error.message);
    if (error instanceof UtahMvrError) {
      res.status(error.status).json({ error: error.message, details: error.responseBody });
      return;
    }
    console.error('[UTAH-MVR] VIN query error:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// ============================================================
// ROUTES: Audit Log
// ============================================================

// GET /audit-log?page=1&per_page=25
router.get('/audit-log', requireRole('admin', 'supervisor'), (req: Request, res: Response) => {
  try {
    ensureTables();
    const db = getDb();

    const page = Math.max(1, parseInt(String(req.query.page || '1')));
    const perPage = Math.min(100, Math.max(1, parseInt(String(req.query.per_page || '25'))));
    const offset = (page - 1) * perPage;

    const total = (db.prepare('SELECT COUNT(*) as count FROM utah_mvr_queries').get() as any).count;
    const rows = db.prepare(`
      SELECT q.*, u.username, u.full_name
      FROM utah_mvr_queries q
      LEFT JOIN users u ON u.id = q.queried_by
      ORDER BY q.id DESC
      LIMIT ? OFFSET ?
    `).all(perPage, offset);

    res.json({
      data: rows,
      pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (error: any) {
    console.error('[UTAH-MVR] Audit log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
