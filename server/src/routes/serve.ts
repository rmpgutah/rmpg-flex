// ============================================================
// Process Server Field Suite — API Routes
// ============================================================
// Queue management, service attempts, route planning, skip traces,
// and ServeManager import for the process server module.

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId, validateParamIdMiddleware } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { broadcast, broadcastDispatchUpdate } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';
import config from '../config';
import { sendCsv } from '../utils/csvExport';

const router = Router();
router.use(authenticateToken);

// Validate :id params as positive integers
router.param('id', (req: Request, res: Response, next) => {
  const raw = String(req.params.id);
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1 || String(n) !== raw) {
    res.status(400).json({ error: 'Invalid ID parameter', code: 'INVALID_ID_PARAMETER' });
    return;
  }
  next();
});

const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'];

// ============================================================
// Static routes FIRST (before /:id param route)
// ============================================================

// ── GET /stats/summary — Dashboard stats ────────────────────
router.get('/stats/summary', requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();

    const counts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) as served,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress
      FROM serve_queue
    `).get() as any;

    const attemptsToday = db.prepare(`
      SELECT COUNT(*) as count FROM serve_attempts
      WHERE DATE(attempt_at) = ?
    `).get(today) as any;

    res.json({
      ...counts,
      attempts_today: attemptsToday?.count || 0,
      mileage_today: 0,
    });
  } catch (err: any) {
    console.error('[SERVE] Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats', code: 'FAILED_TO_FETCH_STATS' });
  }
});

// ── GET /routes/:date — Get route for officer + date ────────
router.get('/routes/:date', requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const date = String(req.params.date);
    // Validate date format to prevent injection via route param
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.', code: 'INVALID_DATE_FORMAT_USE' });
      return;
    }
    const parsedOfficerId = req.query.officer_id ? Number(req.query.officer_id) : null;
    const officerId = (parsedOfficerId != null && !isNaN(parsedOfficerId) && parsedOfficerId > 0 && Number.isInteger(parsedOfficerId)) ? parsedOfficerId : req.user!.userId;

    // IDOR protection: only supervisors+ can view other officers' routes
    if (officerId !== req.user!.userId && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(req.user!.role)) {
      res.status(403).json({ error: 'You can only view your own routes', code: 'YOU_CAN_ONLY_VIEW' });
      return;
    }

    const route = db.prepare(`
      SELECT * FROM serve_routes
      WHERE officer_id = ? AND route_date = ?
    `).get(officerId, date);

    if (!route) {
      res.json(null);
      return;
    }

    res.json(route);
  } catch (err: any) {
    console.error('[SERVE] Route fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch route', code: 'FAILED_TO_FETCH_ROUTE' });
  }
});

// ── POST /routes — Upsert route ─────────────────────────────
router.post('/routes', requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, route_date, optimized_order_json, waypoints_json, total_distance_miles, total_time_minutes, start_lat, start_lng, end_lat, end_lng, notes } = req.body;

    if (!officer_id || !route_date) {
      res.status(400).json({ error: 'officer_id and route_date are required', code: 'OFFICERID_AND_ROUTEDATE_ARE' });
      return;
    }

    // IDOR protection: only supervisors+ can create/modify routes for other officers
    if (Number(officer_id) !== req.user!.userId && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(req.user!.role)) {
      res.status(403).json({ error: 'You can only modify your own routes', code: 'YOU_CAN_ONLY_MODIFY' });
      return;
    }

    const now = localNow();
    const existing = db.prepare('SELECT id FROM serve_routes WHERE officer_id = ? AND route_date = ?').get(officer_id, route_date) as any;

    if (existing) {
      db.prepare(`
        UPDATE serve_routes SET
          optimized_order_json = COALESCE(?, optimized_order_json),
          waypoints_json = COALESCE(?, waypoints_json),
          total_distance_miles = COALESCE(?, total_distance_miles),
          total_time_minutes = COALESCE(?, total_time_minutes),
          start_lat = COALESCE(?, start_lat),
          start_lng = COALESCE(?, start_lng),
          end_lat = COALESCE(?, end_lat),
          end_lng = COALESCE(?, end_lng),
          notes = COALESCE(?, notes),
          updated_at = ?
        WHERE id = ?
      `).run(
        optimized_order_json ?? null, waypoints_json ?? null,
        total_distance_miles ?? null, total_time_minutes ?? null,
        start_lat ?? null, start_lng ?? null, end_lat ?? null, end_lng ?? null,
        notes ?? null, now, existing.id,
      );
      const updated = db.prepare('SELECT * FROM serve_routes WHERE id = ?').get(existing.id);
      res.json(updated);
    } else {
      const info = db.prepare(`
        INSERT INTO serve_routes (officer_id, route_date, optimized_order_json, waypoints_json, total_distance_miles, total_time_minutes, start_lat, start_lng, end_lat, end_lng, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        officer_id, route_date,
        optimized_order_json ?? null, waypoints_json ?? null,
        total_distance_miles ?? null, total_time_minutes ?? null,
        start_lat ?? null, start_lng ?? null, end_lat ?? null, end_lng ?? null,
        notes ?? null, now, now,
      );
      const created = db.prepare('SELECT * FROM serve_routes WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(created);
    }
  } catch (err: any) {
    console.error('[SERVE] Route upsert error:', err);
    res.status(500).json({ error: 'Failed to save route', code: 'FAILED_TO_SAVE_ROUTE' });
  }
});

// ── POST /sync-from-sm — Import unserved SM jobs ────────────
router.post('/sync-from-sm', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    // Find SM jobs not yet in serve_queue that aren't completed/cancelled
    const unimported = db.prepare(`
      SELECT sm.*
      FROM sm_jobs sm
      LEFT JOIN serve_queue sq ON sq.sm_job_id = sm.id
      WHERE sq.id IS NULL
        AND COALESCE(sm.service_status, '') NOT IN ('Served', 'Canceled', 'On Hold')
    
      LIMIT 1000
    `).all() as any[];

    if (!unimported.length) {
      res.json({ imported: 0, jobs: [] });
      return;
    }

    const insertStmt = db.prepare(`
      INSERT INTO serve_queue (
        sm_job_id, officer_id, serve_date, recipient_name,
        recipient_address, recipient_city, recipient_state, recipient_zip,
        recipient_lat, recipient_lng, document_type, case_number,
        court_name, jurisdiction, client_name, attorney_name,
        priority, deadline, max_attempts, service_instructions, notes,
        status, attempt_count, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 999, ?, ?)
    `);

    const imported: any[] = [];
    const today = localToday();

    const txn = db.transaction(() => {
      for (const sm of unimported) {
        // Parse first address from addresses_json
        let addr = '', city = '', state = '', zip = '', lat: number | null = null, lng: number | null = null;
        try {
          const addrs = JSON.parse(sm.addresses_json || '[]');
          if (addrs.length > 0) {
            const a = addrs[0];
            addr = a.Address1 || a.address || '';
            city = a.City || a.city || '';
            state = a.State || a.state || '';
            zip = a.Zip || a.zip || '';
            lat = a.Latitude ?? a.lat ?? null;
            lng = a.Longitude ?? a.lng ?? null;
          }
        } catch (e) { console.warn('[serve] Failed to parse address for serve job:', e); }

        const info = insertStmt.run(
          sm.id, sm.employee_process_server_id || null, today,
          sm.recipient_name || '', addr, city, state, zip, lat, lng,
          'civil', sm.court_case_number || '',
          '', '', sm.client_company_name || '', '',
          sm.rush ? 'urgent' : 'normal', sm.due_date || null,
          3, sm.service_instructions || '', sm.notes_local || '',
          now, now,
        );
        imported.push({ id: info.lastInsertRowid, sm_job_id: sm.id, recipient_name: sm.recipient_name });
      }
    });
    txn();

    auditLog(req, 'CREATE', 'serve_queue', 0, `Imported ${imported.length} jobs from ServeManager`);
    broadcast('serve', 'serve_sync', { count: imported.length });

    res.json({ imported: imported.length, jobs: imported });
  } catch (err: any) {
    console.error('[SERVE] SM sync error:', err);
    res.status(500).json({ error: 'Failed to sync from ServeManager', code: 'FAILED_TO_SYNC_FROM' });
  }
});

// ── PUT /reorder — Batch update sort_order ──────────────────
router.put('/reorder', requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { order } = req.body;

    if (!Array.isArray(order)) {
      res.status(400).json({ error: 'order must be an array of { id, sort_order }', code: 'ORDER_MUST_BE_AN' });
      return;
    }

    if (order.length > 500) {
      res.status(400).json({ error: 'Cannot reorder more than 500 items at once', code: 'CANNOT_REORDER_MORE_THAN' });
      return;
    }

    // Validate each reorder item has integer id and sort_order
    for (const item of order) {
      if (!item || typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id < 1) {
        res.status(400).json({ error: 'Each order item must have a positive integer id', code: 'EACH_ORDER_ITEM_MUST' });
        return;
      }
      if (typeof item.sort_order !== 'number' || !Number.isInteger(item.sort_order) || item.sort_order < 0) {
        res.status(400).json({ error: 'Each order item must have a non-negative integer sort_order', code: 'EACH_ORDER_ITEM_MUST' });
        return;
      }
    }

    const stmt = db.prepare('UPDATE serve_queue SET sort_order = ?, updated_at = ? WHERE id = ?');
    const now = localNow();

    const txn = db.transaction(() => {
      for (const item of order) {
        stmt.run(item.sort_order, now, item.id);
      }
    });
    txn();

    broadcast('serve', 'serve_reordered', { count: order.length });
    res.json({ success: true, updated: order.length });
  } catch (err: any) {
    console.error('[SERVE] Reorder error:', err);
    res.status(500).json({ error: 'Failed to reorder', code: 'FAILED_TO_REORDER' });
  }
});

// ============================================================
// Parameterized routes
// ============================================================

// ── GET / — List serve queue ────────────────────────────────
router.get('/', requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const parsedOid = req.query.officer_id ? Number(req.query.officer_id) : null;
    let officerId = (parsedOid != null && !isNaN(parsedOid)) ? parsedOid : req.user!.userId;

    // IDOR protection: officers can only list their own queue
    if (req.user!.role === 'officer' && officerId !== req.user!.userId) {
      officerId = req.user!.userId;
    }

    const date = req.query.date as string || localToday();
    const status = req.query.status as string | undefined;

    // Show all pending/in_progress jobs regardless of date (they shouldn't disappear),
    // plus any jobs matching the selected date
    let sql = `SELECT * FROM serve_queue WHERE officer_id = ? AND (
      serve_date = ? OR status IN ('pending', 'in_progress')
    )`;
    const params: any[] = [officerId, date];

    if (status && status !== 'all') {
      const VALID_LIST_STATUSES = ['pending', 'in_progress', 'served', 'failed', 'on_hold', 'cancelled'];
      if (!VALID_LIST_STATUSES.includes(status)) {
        res.status(400).json({ error: `Invalid status filter. Must be one of: all, ${VALID_LIST_STATUSES.join(', ')}`, code: 'INVALID_STATUS_FILTER' });
        return;
      }
      sql = 'SELECT * FROM serve_queue WHERE officer_id = ? AND status = ?';
      params.length = 0;
      params.push(officerId, status);
    }

    sql += ` ORDER BY sort_order ASC, priority DESC, COALESCE(deadline, '9999-12-31') ASC LIMIT 2000`;

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[SERVE] List error:', err);
    res.status(500).json({ error: 'Failed to list serve queue', code: 'FAILED_TO_LIST_SERVE' });
  }
});

// ── POST / — Create serve job ───────────────────────────────
router.post('/', requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    const {
      sm_job_id, officer_id, serve_date, recipient_name, recipient_address,
      recipient_city, recipient_state, recipient_zip, recipient_lat, recipient_lng,
      document_type, case_number, court_name, jurisdiction, client_name,
      attorney_name, priority, time_window, deadline, max_attempts,
      service_instructions, notes,
    } = req.body;

    if (!recipient_name || !recipient_name.trim()) {
      return res.status(400).json({ error: 'recipient_name is required', code: 'RECIPIENTNAME_IS_REQUIRED' });
    }
    if (recipient_name.length > 500) {
      return res.status(400).json({ error: 'recipient_name must be 500 characters or less', code: 'RECIPIENTNAME_MUST_BE_500' });
    }

    // Validate priority if provided
    const VALID_PRIORITIES = ['normal', 'urgent', 'rush', 'low'];
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`, code: 'INVALID_PRIORITY' });
    }

    // Validate serve_date format if provided
    if (serve_date && !/^\d{4}-\d{2}-\d{2}$/.test(serve_date)) {
      return res.status(400).json({ error: 'serve_date must be in YYYY-MM-DD format', code: 'SERVEDATE_MUST_BE_IN' });
    }

    // Validate max_attempts is a reasonable positive integer
    if (max_attempts !== undefined) {
      const ma = parseInt(max_attempts, 10);
      if (isNaN(ma) || ma < 1 || ma > 99) {
        return res.status(400).json({ error: 'max_attempts must be between 1 and 99', code: 'MAXATTEMPTS_MUST_BE_BETWEEN' });
      }
    }

    // Validate GPS coordinates if provided
    if (recipient_lat !== undefined && recipient_lat !== null) {
      const lat = parseFloat(recipient_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ error: 'recipient_lat must be between -90 and 90', code: 'RECIPIENTLAT_MUST_BE_BETWEEN' });
      }
    }
    if (recipient_lng !== undefined && recipient_lng !== null) {
      const lng = parseFloat(recipient_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ error: 'recipient_lng must be between -180 and 180', code: 'RECIPIENTLNG_MUST_BE_BETWEEN' });
      }
    }

    const info = db.prepare(`
      INSERT INTO serve_queue (
        sm_job_id, officer_id, serve_date, recipient_name,
        recipient_address, recipient_city, recipient_state, recipient_zip,
        recipient_lat, recipient_lng, document_type, case_number,
        court_name, jurisdiction, client_name, attorney_name,
        priority, time_window, deadline, max_attempts,
        service_instructions, notes, status, attempt_count, sort_order,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 999, ?, ?)
    `).run(
      sm_job_id ?? null, officer_id ?? req.user!.userId,
      serve_date ?? localToday(),
      recipient_name ?? '', recipient_address ?? '', recipient_city ?? '',
      recipient_state ?? '', recipient_zip ?? '', recipient_lat ?? null, recipient_lng ?? null,
      document_type ?? '', case_number ?? '', court_name ?? '', jurisdiction ?? '',
      client_name ?? '', attorney_name ?? '', priority ?? 'normal',
      time_window ?? null, deadline ?? null, max_attempts ?? 3,
      service_instructions ?? '', notes ?? '', now, now,
    );

    const id = Number(info.lastInsertRowid);
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id);
    auditLog(req, 'CREATE', 'serve_queue', id, `Created serve job for ${recipient_name || 'unknown'}`);
    broadcast('serve', 'serve_created', job);

    res.status(201).json(job);
  } catch (err: any) {
    console.error('[SERVE] Create error:', err);
    res.status(500).json({ error: 'Failed to create serve job', code: 'FAILED_TO_CREATE_SERVE' });
  }
});

// ── GET /:id — Get single job with attempts + skip traces ───
router.get('/:id', validateParamIdMiddleware, requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;

    if (!job) {
      res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' });
      return;
    }

    // IDOR protection: officers can only view their own assigned jobs
    if (req.user!.role === 'officer' && job.officer_id && job.officer_id !== req.user!.userId) {
      res.status(403).json({ error: 'You can only view jobs assigned to you', code: 'YOU_CAN_ONLY_VIEW' });
      return;
    }

    const attempts = db.prepare(
      'SELECT * FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_number ASC LIMIT 1000'
    ).all(req.params.id);

    const skipTraces = db.prepare(
      'SELECT * FROM serve_skip_traces WHERE serve_queue_id = ? ORDER BY searched_at DESC LIMIT 100'
    ).all(req.params.id);

    let linkedCall = null;
    if (job.call_id) {
      linkedCall = db.prepare(`
        SELECT id, call_number, status, priority, assigned_unit_ids,
               pso_requestor_name, contract_id, pso_service_windows,
               pso_attempt_number, disposition
        FROM calls_for_service WHERE id = ?
      `).get(job.call_id);
    }

    res.json({ ...job, attempts, skipTraces, linkedCall });
  } catch (err: any) {
    console.error('[SERVE] Get error:', err);
    res.status(500).json({ error: 'Failed to fetch serve job', code: 'FAILED_TO_FETCH_SERVE' });
  }
});

// ── PUT /:id — Update serve job ─────────────────────────────
router.put('/:id', validateParamIdMiddleware, requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' });
      return;
    }

    // IDOR protection: officers can only modify their own assigned jobs
    if (req.user!.role === 'officer' && existing.officer_id && existing.officer_id !== req.user!.userId) {
      res.status(403).json({ error: 'You can only modify jobs assigned to you', code: 'YOU_CAN_ONLY_MODIFY' });
      return;
    }

    // Validate status enum if provided
    const VALID_SERVE_STATUSES = ['pending', 'in_progress', 'served', 'failed', 'on_hold', 'cancelled'];
    if (req.body.status !== undefined && !VALID_SERVE_STATUSES.includes(req.body.status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_SERVE_STATUSES.join(', ')}`, code: 'INVALID_STATUS' });
      return;
    }

    // Validate GPS coordinates if provided
    if (req.body.recipient_lat !== undefined && req.body.recipient_lat !== null) {
      const lat = parseFloat(req.body.recipient_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        res.status(400).json({ error: 'recipient_lat must be between -90 and 90', code: 'RECIPIENTLAT_MUST_BE_BETWEEN' });
        return;
      }
    }
    if (req.body.recipient_lng !== undefined && req.body.recipient_lng !== null) {
      const lng = parseFloat(req.body.recipient_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        res.status(400).json({ error: 'recipient_lng must be between -180 and 180', code: 'RECIPIENTLNG_MUST_BE_BETWEEN' });
        return;
      }
    }

    const updatableFields = [
      'officer_id', 'serve_date', 'recipient_name', 'recipient_address',
      'recipient_city', 'recipient_state', 'recipient_zip', 'recipient_lat', 'recipient_lng',
      'document_type', 'case_number', 'court_name', 'jurisdiction',
      'client_name', 'attorney_name', 'priority', 'time_window', 'deadline',
      'max_attempts', 'status', 'sort_order', 'service_instructions', 'notes',
    ];

    const setClauses: string[] = [];
    const values: any[] = [];

    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No updatable fields provided', code: 'NO_UPDATABLE_FIELDS_PROVIDED' });
      return;
    }

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE serve_queue SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id);
    auditLog(req, 'UPDATE', 'serve_queue', String(req.params.id), `Updated serve job: ${setClauses.map(c => c.split(' =')[0]).join(', ')}`);
    broadcast('serve', 'serve_updated', updated);

    res.json(updated);
  } catch (err: any) {
    console.error('[SERVE] Update error:', err);
    res.status(500).json({ error: 'Failed to update serve job', code: 'FAILED_TO_UPDATE_SERVE' });
  }
});

// ── POST /:id/attempt — Record service attempt ─────────────
router.post('/:id/attempt', validateParamIdMiddleware, requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) {
      res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' });
      return;
    }

    // IDOR protection: officers can only record attempts on their own assigned jobs
    if (req.user!.role === 'officer' && job.officer_id && job.officer_id !== req.user!.userId) {
      res.status(403).json({ error: 'You can only record attempts on jobs assigned to you', code: 'YOU_CAN_ONLY_RECORD' });
      return;
    }

    const {
      result, gps_lat, gps_lng, notes, method, recipient_response,
      photo_url, signature_url, mileage,
    } = req.body;

    // Validate result enum
    const VALID_RESULTS = ['served', 'no_answer', 'refused', 'posted', 'left_with', 'other', 'unable_to_locate'];
    if (result && !VALID_RESULTS.includes(result)) {
      return res.status(400).json({ error: `Invalid result. Must be one of: ${VALID_RESULTS.join(', ')}`, code: 'INVALID_ATTEMPT_RESULT' });
    }

    // Validate method enum
    const VALID_METHODS = ['personal', 'substitute', 'posting', 'abode', 'mail', 'other'];
    if (method && !VALID_METHODS.includes(method)) {
      return res.status(400).json({ error: `Invalid method. Must be one of: ${VALID_METHODS.join(', ')}`, code: 'INVALID_ATTEMPT_METHOD' });
    }

    // Validate GPS coordinates for serve attempt location tracking
    if (gps_lat !== undefined && gps_lat !== null) {
      const lat = parseFloat(gps_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ error: 'gps_lat must be between -90 and 90', code: 'GPSLAT_MUST_BE_BETWEEN' });
      }
    }
    if (gps_lng !== undefined && gps_lng !== null) {
      const lng = parseFloat(gps_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ error: 'gps_lng must be between -180 and 180', code: 'GPSLNG_MUST_BE_BETWEEN' });
      }
    }

    // Enforce posting requirements: need 2+ prior failed attempts
    if (result === 'posted') {
      const failedAttempts = db.prepare(
        "SELECT COUNT(*) as cnt FROM serve_attempts WHERE serve_queue_id = ? AND result != 'served'"
      ).get(req.params.id) as any;
      if ((failedAttempts?.cnt || 0) < 2) {
        res.status(400).json({
          error: 'Posting requires at least 2 prior failed attempts for due diligence',
          code: 'POSTING_REQUIRES_PRIOR_ATTEMPTS',
        });
        return;
      }
    }

    const now = localNow();
    const attemptNumber = (job.attempt_count ?? 0) + 1;
    const attemptInfo = db.prepare(`
      INSERT INTO serve_attempts (
        serve_queue_id, attempt_number, attempt_at, officer_id,
        result, latitude, longitude, notes, attempt_type,
        photo_ids, signature_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id, attemptNumber, now, req.user!.userId,
      result || 'no_answer', gps_lat ?? null, gps_lng ?? null,
      notes ?? '', method ?? 'personal',
      photo_url ? JSON.stringify([photo_url]) : '[]', signature_url ?? null, now,
    );
    const attemptId = attemptInfo.lastInsertRowid;

    // Determine new status
    let newStatus = 'in_progress';
    if (result === 'served' || result === 'posted') {
      newStatus = 'served';
    } else if (attemptNumber >= (job.max_attempts || 3)) {
      newStatus = 'failed';
    }

    db.prepare(`
      UPDATE serve_queue SET
        attempt_count = ?,
        status = ?,
        updated_at = ?
      WHERE id = ?
    `).run(attemptNumber, newStatus, now, req.params.id);

    const updatedJob = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id);
    const attempt = db.prepare('SELECT * FROM serve_attempts WHERE id = ?').get(attemptId);

    const dueDiligenceComplete = attemptNumber >= 2 && newStatus !== 'served';

    auditLog(req, 'CREATE', 'serve_queue', String(req.params.id), `Attempt #${attemptNumber}: ${result}`);
    broadcast('serve', 'serve_attempt', { job: updatedJob, attempt });

    // Sync back to linked dispatch call (atomic to prevent race conditions)
    try {
      const updatedJobForSync = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
      if (updatedJobForSync?.call_id) {
        const linkedCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(updatedJobForSync.call_id) as any;
        if (linkedCall) {
          const syncBack = db.transaction(() => {
            // Map serve result to dispatch disposition
            const dispositionMap: Record<string, Record<string, string>> = {
              served: { personal: 'Served - Personal', substitute: 'Served - Substitute', posting: 'Served - Posting' },
            };

            const updates: string[] = ['process_attempts = ?'];
            const values: any[] = [attemptNumber];

            updates.push('process_service_result = ?');
            values.push(result || 'no_answer');

            if (result === 'served' || result === 'posted') {
              // Auto-close the dispatch call
              const attemptMethod = method || 'personal';
              const disposition = dispositionMap['served']?.[attemptMethod] || 'Served';

              updates.push('process_served_at = ?');
              values.push(now);

              if (req.body.person_served_name) {
                updates.push('process_served_to = ?');
                values.push(req.body.person_served_name);
              }

              updates.push('status = ?', 'closed_at = ?', 'disposition = ?');
              values.push('closed', now, disposition);
            }

            values.push(linkedCall.id);
            db.prepare(`UPDATE calls_for_service SET ${updates.join(', ')} WHERE id = ?`).run(...values);

            // Activity log
            try {
              const activities = JSON.parse(linkedCall.activity_log || '[]');
              activities.push({
                action: 'process_served_via_serve_queue',
                timestamp: now,
                user_id: req.user!.userId,
                details: `Serve attempt #${attemptNumber}: ${result}${result === 'served' ? ` (${method || 'personal'})` : ''}`,
              });
              db.prepare('UPDATE calls_for_service SET activity_log = ? WHERE id = ?').run(JSON.stringify(activities), linkedCall.id);
            } catch (alErr) { console.error('[Serve] Activity log update failed (non-fatal):', alErr instanceof Error ? alErr.message : alErr); }
          });

          syncBack();

          // Broadcast dispatch update (outside transaction)
          const updatedCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(linkedCall.id);
          broadcastDispatchUpdate({ action: 'call_updated', call: updatedCall });
        }
      }
    } catch (syncErr) {
      console.error('[Serve] Dispatch sync-back failed:', (syncErr as Error)?.message);
      // Sync failure must never prevent the attempt from being recorded
    }

    res.status(201).json({ attempt, job: updatedJob, dueDiligenceComplete });
  } catch (err: any) {
    console.error('[SERVE] Attempt error:', err);
    res.status(500).json({ error: 'Failed to record attempt', code: 'FAILED_TO_RECORD_ATTEMPT' });
  }
});

// ── POST /:id/skip-trace — Run skip trace for job ───────────
router.post('/:id/skip-trace', validateParamIdMiddleware, requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) {
      res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' });
      return;
    }

    const name = job.recipient_name;
    const address = job.recipient_address;

    if (!name) {
      res.status(400).json({ error: 'Job has no recipient name for skip trace', code: 'JOB_HAS_NO_RECIPIENT' });
      return;
    }

    // Call internal skip tracer API
    const port = config.port;
    const authHeader = req.headers['authorization'];
    let endpoint = `http://localhost:${port}/api/skiptracer/search/byname?name=${encodeURIComponent(name)}`;
    if (address) {
      endpoint = `http://localhost:${port}/api/skiptracer/search/bynameaddress?name=${encodeURIComponent(name)}&address=${encodeURIComponent(address)}`;
    }

    const stResponse = await fetch(endpoint, {
      headers: { Authorization: authHeader || '' },
      signal: AbortSignal.timeout(30000),
    });

    if (!stResponse.ok) {
      const errText = await stResponse.text();
      res.status(stResponse.status).json({ error: `Skip trace failed: ${errText}` });
      return;
    }

    const stData = await stResponse.json() as any;

    // Extract addresses from results
    const addresses: any[] = [];
    if (stData?.PeopleDetails && Array.isArray(stData.PeopleDetails)) {
      for (const person of stData.PeopleDetails) {
        if (person.Addresses && Array.isArray(person.Addresses)) {
          for (const addr of person.Addresses) {
            addresses.push({
              address: addr.Address1 || addr.StreetAddress || '',
              city: addr.City || '',
              state: addr.State || '',
              zip: addr.Zip || '',
              type: addr.AddressType || 'unknown',
            });
          }
        }
      }
    }

    // Save to serve_skip_traces
    const now = localNow();
    const traceInfo = db.prepare(`
      INSERT INTO serve_skip_traces (
        serve_queue_id, searched_at, search_type, search_query,
        results_json, addresses_found_json, searched_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id, now,
      address ? 'bynameaddress' : 'byname',
      address ? `${name} | ${address}` : name,
      JSON.stringify(stData),
      JSON.stringify(addresses),
      req.user!.userId,
      now,
    );

    const trace = db.prepare('SELECT * FROM serve_skip_traces WHERE id = ?').get(traceInfo.lastInsertRowid);
    auditLog(req, 'CREATE', 'serve_queue', String(req.params.id), `Skip trace for ${name}: ${addresses.length} addresses found`);

    res.json({ trace, addresses });
  } catch (err: any) {
    console.error('[SERVE] Skip trace error:', err);
    res.status(500).json({ error: 'Failed to run skip trace', code: 'FAILED_TO_RUN_SKIP' });
  }
});

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /api/serve/export/csv — Export serve queue jobs
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT sq.id, sq.status, sq.recipient_name, sq.recipient_address,
        sq.recipient_city, sq.recipient_state, sq.recipient_zip,
        sq.document_type, sq.case_number, sq.court_name, sq.jurisdiction,
        sq.client_name, sq.attorney_name, sq.priority, sq.deadline,
        sq.max_attempts, sq.attempt_count, sq.serve_date,
        sq.service_instructions, sq.notes,
        sq.created_at, sq.updated_at,
        u.full_name as officer_name
      FROM serve_queue sq
      LEFT JOIN users u ON sq.officer_id = u.id
      ORDER BY sq.created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'serve_queue_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'status', header: 'Status' },
      { key: 'recipient_name', header: 'Recipient Name' },
      { key: 'recipient_address', header: 'Address' },
      { key: 'recipient_city', header: 'City' },
      { key: 'recipient_state', header: 'State' },
      { key: 'recipient_zip', header: 'ZIP' },
      { key: 'document_type', header: 'Document Type' },
      { key: 'case_number', header: 'Case Number' },
      { key: 'court_name', header: 'Court' },
      { key: 'jurisdiction', header: 'Jurisdiction' },
      { key: 'client_name', header: 'Client' },
      { key: 'attorney_name', header: 'Attorney' },
      { key: 'officer_name', header: 'Officer' },
      { key: 'priority', header: 'Priority' },
      { key: 'deadline', header: 'Deadline' },
      { key: 'max_attempts', header: 'Max Attempts' },
      { key: 'attempt_count', header: 'Attempt Count' },
      { key: 'serve_date', header: 'Serve Date' },
      { key: 'service_instructions', header: 'Instructions' },
      { key: 'notes', header: 'Notes' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    console.error('[SERVE] CSV export error:', error);
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 9: Serve Attempt GPS Logging
// (Already implemented in POST /:id/attempt via gps_lat/gps_lng)
// This endpoint returns GPS trail for all attempts on a job.
// ════════════════════════════════════════════════════════════

router.get('/:id/gps-trail', validateParamIdMiddleware, requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const trail = db.prepare(`
      SELECT sa.id, sa.attempt_number, sa.attempt_at, sa.latitude, sa.longitude,
             sa.result, sa.attempt_type, u.full_name as officer_name
      FROM serve_attempts sa
      LEFT JOIN users u ON sa.officer_id = u.id
      WHERE sa.serve_queue_id = ? AND sa.latitude IS NOT NULL AND sa.longitude IS NOT NULL
      ORDER BY sa.attempt_at ASC
    
      LIMIT 1000
    `).all(req.params.id);
    res.json(trail);
  } catch (err: any) {
    console.error('[SERVE] GPS trail error:', err);
    res.status(500).json({ error: 'Failed to fetch GPS trail', code: 'FAILED_TO_FETCH_GPS' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 10: Service Affidavit Generation (data for PDF)
// ════════════════════════════════════════════════════════════

router.get('/:id/affidavit', validateParamIdMiddleware, requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) { res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }); return; }

    const attempts = db.prepare(`
      SELECT sa.*, u.full_name as officer_name, u.badge_number
      FROM serve_attempts sa
      LEFT JOIN users u ON sa.officer_id = u.id
      WHERE sa.serve_queue_id = ?
      ORDER BY sa.attempt_number ASC
    
      LIMIT 1000
    `).all(req.params.id) as any[];

    const server = db.prepare('SELECT full_name, badge_number FROM users WHERE id = ?').get(job.officer_id) as any;

    const affidavit = {
      title: 'AFFIDAVIT OF SERVICE',
      case_number: job.case_number || '',
      court_name: job.court_name || '',
      jurisdiction: job.jurisdiction || '',
      recipient: {
        name: job.recipient_name,
        address: `${job.recipient_address || ''}, ${job.recipient_city || ''}, ${job.recipient_state || ''} ${job.recipient_zip || ''}`.trim(),
      },
      document_type: job.document_type || '',
      client_name: job.client_name || '',
      attorney_name: job.attorney_name || '',
      server_name: server?.full_name || '',
      server_badge: server?.badge_number || '',
      service_result: job.status === 'served' ? 'SERVED' : 'NOT SERVED',
      total_attempts: attempts.length,
      attempts: attempts.map((a: any) => ({
        number: a.attempt_number,
        date: a.attempt_at,
        result: a.result,
        method: a.attempt_type,
        gps: a.latitude && a.longitude ? `${a.latitude}, ${a.longitude}` : null,
        notes: a.notes,
        officer: a.officer_name,
      })),
      final_result: job.status,
      served_at: attempts.find((a: any) => a.result === 'served')?.attempt_at || null,
      generated_at: localNow(),
    };

    res.json(affidavit);
  } catch (err: any) {
    console.error('[SERVE] Affidavit error:', err);
    res.status(500).json({ error: 'Failed to generate affidavit data', code: 'FAILED_TO_GENERATE_AFFIDAVIT' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 11: Skip Trace Auto-trigger (after 3 failed attempts)
// (Implemented as logic in POST /:id/attempt — returns autoSkipTrace flag)
// Also: endpoint to check and auto-trigger pending skip traces
// ════════════════════════════════════════════════════════════

router.post('/auto-skip-trace', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Find jobs that have 3+ failed attempts and no skip trace yet
    const candidates = db.prepare(`
      SELECT sq.id, sq.recipient_name, sq.recipient_address, sq.attempt_count
      FROM serve_queue sq
      WHERE sq.status IN ('in_progress', 'failed')
        AND sq.attempt_count >= 3
        AND sq.id NOT IN (SELECT DISTINCT serve_queue_id FROM serve_skip_traces)
    
      LIMIT 1000
    `).all() as any[];

    const triggered: any[] = [];
    for (const job of candidates) {
      try {
        const port = config.port;
        const authHeader = req.headers['authorization'];
        let endpoint = `http://localhost:${port}/api/skiptracer/search/byname?name=${encodeURIComponent(job.recipient_name)}`;
        if (job.recipient_address) {
          endpoint = `http://localhost:${port}/api/skiptracer/search/bynameaddress?name=${encodeURIComponent(job.recipient_name)}&address=${encodeURIComponent(job.recipient_address)}`;
        }

        const stResponse = await fetch(endpoint, {
          headers: { Authorization: authHeader || '' },
          signal: AbortSignal.timeout(15000),
        });

        if (stResponse.ok) {
          const stData = await stResponse.json() as any;
          const addresses: any[] = [];
          if (stData?.PeopleDetails) {
            for (const person of stData.PeopleDetails) {
              if (person.Addresses) {
                for (const addr of person.Addresses) {
                  addresses.push({ address: addr.Address1 || '', city: addr.City || '', state: addr.State || '', zip: addr.Zip || '' });
                }
              }
            }
          }

          const now = localNow();
          db.prepare(`
            INSERT INTO serve_skip_traces (serve_queue_id, searched_at, search_type, search_query, results_json, addresses_found_json, searched_by, created_at)
            VALUES (?, ?, 'auto', ?, ?, ?, ?, ?)
          `).run(job.id, now, job.recipient_name, JSON.stringify(stData), JSON.stringify(addresses), req.user!.userId, now);

          triggered.push({ job_id: job.id, recipient: job.recipient_name, addresses_found: addresses.length });
        }
      } catch (stErr) { console.error(`[Serve] Auto skip-trace failed for job ${job.id}:`, stErr instanceof Error ? stErr.message : stErr); }
    }

    res.json({ triggered: triggered.length, jobs: triggered });
  } catch (err: any) {
    console.error('[SERVE] Auto skip trace error:', err);
    res.status(500).json({ error: 'Failed to run auto skip traces', code: 'FAILED_TO_RUN_AUTO' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 12: Serve Deadline Tracking
// ════════════════════════════════════════════════════════════

router.get('/deadlines', requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT sq.id, sq.recipient_name, sq.deadline, sq.status, sq.attempt_count, sq.max_attempts,
             sq.document_type, sq.case_number, sq.client_name,
             u.full_name as officer_name,
             JULIANDAY(sq.deadline) - JULIANDAY('now') as days_remaining
      FROM serve_queue sq
      LEFT JOIN users u ON sq.officer_id = u.id
      WHERE sq.deadline IS NOT NULL AND sq.status NOT IN ('served', 'cancelled')
      ORDER BY sq.deadline ASC
    
      LIMIT 1000
    `).all() as any[];

    const overdue = rows.filter((r: any) => r.days_remaining < 0);
    const urgent = rows.filter((r: any) => r.days_remaining >= 0 && r.days_remaining <= 3);
    const upcoming = rows.filter((r: any) => r.days_remaining > 3 && r.days_remaining <= 14);
    const safe = rows.filter((r: any) => r.days_remaining > 14);

    res.json({ all: rows, overdue, urgent, upcoming, safe, total: rows.length });
  } catch (err: any) {
    console.error('[SERVE] Deadlines error:', err);
    res.status(500).json({ error: 'Failed to fetch deadlines', code: 'FAILED_TO_FETCH_DEADLINES' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 13: Client Billing Integration
// ════════════════════════════════════════════════════════════

router.post('/:id/create-invoice-item', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) { res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }); return; }

    const attempts = db.prepare('SELECT COUNT(*) as cnt FROM serve_attempts WHERE serve_queue_id = ?').get(req.params.id) as any;

    const { rate_per_attempt, flat_fee, mileage_rate, mileage_total, description } = req.body;
    const ratePerAttempt = parseFloat(rate_per_attempt) || 0;
    const flatFee = parseFloat(flat_fee) || 0;
    const mileageRate = parseFloat(mileage_rate) || 0;
    const mileageTotal = parseFloat(mileage_total) || 0;

    const attemptCharges = ratePerAttempt * (attempts?.cnt || 0);
    const mileageCharges = mileageRate * mileageTotal;
    const totalAmount = flatFee + attemptCharges + mileageCharges;

    const now = localNow();
    const lineItem = {
      serve_queue_id: job.id,
      client_name: job.client_name,
      recipient_name: job.recipient_name,
      case_number: job.case_number,
      description: description || `Process service: ${job.recipient_name} - ${job.document_type}`,
      attempts_count: attempts?.cnt || 0,
      rate_per_attempt: ratePerAttempt,
      flat_fee: flatFee,
      mileage_rate: mileageRate,
      mileage_total: mileageTotal,
      attempt_charges: attemptCharges,
      mileage_charges: mileageCharges,
      total_amount: totalAmount,
      status: job.status,
      created_at: now,
    };

    // Try to insert into invoice_line_items if table exists
    try {
      const info = db.prepare(`
        INSERT INTO invoice_line_items (
          description, quantity, unit_price, total, category, reference_type, reference_id, created_at
        ) VALUES (?, ?, ?, ?, 'serve', 'serve_queue', ?, ?)
      `).run(
        lineItem.description, lineItem.attempts_count || 1, ratePerAttempt || flatFee,
        totalAmount, job.id, now
      );
      lineItem.serve_queue_id = Number(info.lastInsertRowid);
    } catch (invoiceErr) { console.error('[Serve] Invoice line item insert failed (table may not exist):', invoiceErr instanceof Error ? invoiceErr.message : invoiceErr); }

    auditLog(req, 'CREATE', 'serve_queue', String(req.params.id), `Created billing item: $${totalAmount.toFixed(2)}`);
    res.json(lineItem);
  } catch (err: any) {
    console.error('[SERVE] Billing error:', err);
    res.status(500).json({ error: 'Failed to create invoice item', code: 'FAILED_TO_CREATE_INVOICE' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 14: Serve Success Rate Stats
// ════════════════════════════════════════════════════════════

router.get('/success-rates', requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '90' } = req.query;
    const parsedDays = parseInt(days as string, 10);
    if (isNaN(parsedDays) || parsedDays < 1 || parsedDays > 3650) {
      res.status(400).json({ error: 'days must be a number between 1 and 3650', code: 'INVALID_DAYS_PARAM' });
      return;
    }
    const cutoff = new Date(Date.now() - parsedDays * 24 * 60 * 60 * 1000).toISOString();

    // Overall stats
    const overall = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) as served,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(attempt_count) as avg_attempts
      FROM serve_queue WHERE created_at >= ?
    `).get(cutoff) as any;

    // By officer
    const byOfficer = db.prepare(`
      SELECT u.full_name as officer_name, sq.officer_id,
        COUNT(*) as total,
        SUM(CASE WHEN sq.status = 'served' THEN 1 ELSE 0 END) as served,
        SUM(CASE WHEN sq.status = 'failed' THEN 1 ELSE 0 END) as failed,
        ROUND(AVG(sq.attempt_count), 1) as avg_attempts
      FROM serve_queue sq
      LEFT JOIN users u ON sq.officer_id = u.id
      WHERE sq.created_at >= ?
      GROUP BY sq.officer_id
      ORDER BY served DESC
    `).all(cutoff) as any[];

    // By document type
    const byDocType = db.prepare(`
      SELECT document_type,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) as served,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM serve_queue WHERE created_at >= ? AND document_type != ''
      GROUP BY document_type ORDER BY total DESC
    `).all(cutoff) as any[];

    // By method
    const byMethod = db.prepare(`
      SELECT attempt_type as method, COUNT(*) as count,
        SUM(CASE WHEN result = 'served' THEN 1 ELSE 0 END) as successful
      FROM serve_attempts WHERE created_at >= ?
      GROUP BY attempt_type ORDER BY count DESC
    `).all(cutoff) as any[];

    const successRate = overall.total > 0 ? Math.round((overall.served / overall.total) * 100) : 0;

    res.json({
      overall: { ...overall, success_rate: successRate },
      by_officer: byOfficer.map((o: any) => ({
        ...o,
        success_rate: o.total > 0 ? Math.round((o.served / o.total) * 100) : 0,
      })),
      by_document_type: byDocType.map((d: any) => ({
        ...d,
        success_rate: d.total > 0 ? Math.round((d.served / d.total) * 100) : 0,
      })),
      by_method: byMethod,
      period_days: parsedDays,
    });
  } catch (err: any) {
    console.error('[SERVE] Success rates error:', err);
    res.status(500).json({ error: 'Failed to fetch success rates', code: 'FAILED_TO_FETCH_SUCCESS' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 15: Substitute Service Tracking
// ════════════════════════════════════════════════════════════

router.post('/:id/substitute-service', validateParamIdMiddleware, requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) { res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }); return; }

    const {
      substitute_name, substitute_relationship, substitute_description,
      substitute_age_estimate, gps_lat, gps_lng, notes, photo_url, signature_url,
    } = req.body;

    if (!substitute_name || typeof substitute_name !== 'string' || !substitute_name.trim()) {
      res.status(400).json({ error: 'substitute_name is required for substitute service', code: 'SUBSTITUTENAME_IS_REQUIRED_FOR' });
      return;
    }
    if (substitute_name.length > 500) {
      res.status(400).json({ error: 'substitute_name must be 500 characters or less', code: 'SUBSTITUTENAME_TOO_LONG' });
      return;
    }

    // Validate GPS coords
    if (gps_lat != null) {
      const lat = parseFloat(gps_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) { return res.status(400).json({ error: 'Invalid gps_lat', code: 'INVALID_GPSLAT' }); }
    }
    if (gps_lng != null) {
      const lng = parseFloat(gps_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) { return res.status(400).json({ error: 'Invalid gps_lng', code: 'INVALID_GPSLNG' }); }
    }

    const now = localNow();
    const attemptNumber = (job.attempt_count ?? 0) + 1;

    // Record the attempt as substitute service
    const attemptInfo = db.prepare(`
      INSERT INTO serve_attempts (
        serve_queue_id, attempt_number, attempt_at, officer_id,
        result, latitude, longitude, notes, attempt_type,
        photo_ids, signature_data, created_at
      ) VALUES (?, ?, ?, ?, 'served', ?, ?, ?, 'substitute', ?, ?, ?)
    `).run(
      req.params.id, attemptNumber, now, req.user!.userId,
      gps_lat ?? null, gps_lng ?? null,
      JSON.stringify({
        type: 'substitute_service',
        substitute_name,
        substitute_relationship: substitute_relationship || '',
        substitute_description: substitute_description || '',
        substitute_age_estimate: substitute_age_estimate || '',
        notes: notes || '',
      }),
      photo_url ? JSON.stringify([photo_url]) : '[]',
      signature_url ?? null, now,
    );

    // Mark job as served
    db.prepare(`
      UPDATE serve_queue SET status = 'served', attempt_count = ?, updated_at = ? WHERE id = ?
    `).run(attemptNumber, now, req.params.id);

    const attempt = db.prepare('SELECT * FROM serve_attempts WHERE id = ?').get(attemptInfo.lastInsertRowid);
    const updatedJob = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id);

    auditLog(req, 'UPDATE', 'serve_queue', String(req.params.id),
      `Substitute service on ${job.recipient_name} via ${substitute_name} (${substitute_relationship || 'unknown relationship'})`);
    broadcast('serve', 'serve_attempt', { job: updatedJob, attempt });

    res.status(201).json({ attempt, job: updatedJob });
  } catch (err: any) {
    console.error('[SERVE] Substitute service error:', err);
    res.status(500).json({ error: 'Failed to record substitute service', code: 'FAILED_TO_RECORD_SUBSTITUTE' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE: Priority Queue — jobs sorted by deadline urgency
// ════════════════════════════════════════════════════════════

router.get('/priority-queue', requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT sq.*, u.full_name as officer_name,
        CASE
          WHEN sq.deadline IS NULL THEN 'none'
          WHEN JULIANDAY(sq.deadline) - JULIANDAY('now') < 0 THEN 'overdue'
          WHEN JULIANDAY(sq.deadline) - JULIANDAY('now') <= 1 THEN 'critical'
          WHEN JULIANDAY(sq.deadline) - JULIANDAY('now') <= 3 THEN 'urgent'
          WHEN JULIANDAY(sq.deadline) - JULIANDAY('now') <= 7 THEN 'soon'
          ELSE 'normal'
        END as urgency,
        ROUND(JULIANDAY(sq.deadline) - JULIANDAY('now'), 1) as days_remaining
      FROM serve_queue sq
      LEFT JOIN users u ON sq.officer_id = u.id
      WHERE sq.status IN ('pending', 'in_progress')
      ORDER BY
        CASE
          WHEN sq.deadline IS NULL THEN 5
          WHEN JULIANDAY(sq.deadline) - JULIANDAY('now') < 0 THEN 0
          WHEN JULIANDAY(sq.deadline) - JULIANDAY('now') <= 1 THEN 1
          WHEN JULIANDAY(sq.deadline) - JULIANDAY('now') <= 3 THEN 2
          WHEN JULIANDAY(sq.deadline) - JULIANDAY('now') <= 7 THEN 3
          ELSE 4
        END ASC,
        CASE sq.priority WHEN 'rush' THEN 0 WHEN 'urgent' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC,
        sq.deadline ASC NULLS LAST
    
      LIMIT 1000
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[SERVE] Priority queue error:', err);
    res.status(500).json({ error: 'Failed to fetch priority queue', code: 'FAILED_TO_FETCH_PRIORITY' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE: Route Map — today's serve jobs with coordinates
// ════════════════════════════════════════════════════════════

router.get('/route-map/:date', requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.', code: 'INVALID_DATE_FORMAT_USE' });
      return;
    }
    const parsedOfficerId = req.query.officer_id ? Number(req.query.officer_id) : null;
    const officerId = (parsedOfficerId != null && !isNaN(parsedOfficerId) && parsedOfficerId > 0) ? parsedOfficerId : req.user!.userId;

    const jobs = db.prepare(`
      SELECT sq.id, sq.recipient_name, sq.recipient_address, sq.recipient_city,
        sq.recipient_state, sq.recipient_zip, sq.recipient_lat, sq.recipient_lng,
        sq.status, sq.priority, sq.deadline, sq.document_type, sq.sort_order,
        sq.time_window, sq.attempt_count, sq.max_attempts
      FROM serve_queue sq
      WHERE sq.officer_id = ?
        AND (sq.serve_date = ? OR sq.status IN ('pending', 'in_progress'))
        AND sq.recipient_lat IS NOT NULL AND sq.recipient_lng IS NOT NULL
      ORDER BY sq.sort_order ASC, sq.priority DESC
    
      LIMIT 1000
    `).all(officerId, date);

    const route = db.prepare(`
      SELECT * FROM serve_routes
      WHERE officer_id = ? AND route_date = ?
    `).get(officerId, date);

    res.json({ jobs, route: route || null });
  } catch (err: any) {
    console.error('[SERVE] Route map error:', err);
    res.status(500).json({ error: 'Failed to fetch route map data', code: 'FAILED_TO_FETCH_ROUTE' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE: Serve Completion Notification — notify admin
// ════════════════════════════════════════════════════════════

router.post('/:id/notify-completion', validateParamIdMiddleware, requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) { res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }); return; }

    // Dynamic import for notifications module (may not exist)
    let createNotificationForRoles: any;
    try {
      const notifModule = await import('./notifications.js');
      createNotificationForRoles = notifModule.createNotificationForRoles;
    } catch (importErr) {
      console.error('[Serve] notifications module not available:', importErr instanceof Error ? importErr.message : importErr);
      res.status(500).json({ error: 'Notification system unavailable', code: 'NOTIFICATION_MODULE_UNAVAILABLE' });
      return;
    }
    createNotificationForRoles(
      ['admin', 'manager', 'supervisor'],
      'serve_completed',
      `Serve Complete: ${job.recipient_name}`,
      `${job.document_type || 'Document'} for ${job.recipient_name} (${job.case_number || 'N/A'}) has been marked ${job.status}. Attempts: ${job.attempt_count || 0}.`,
      'serve_queue',
      job.id,
      'normal',
      undefined,
      req.user!.userId
    );

    res.json({ success: true, message: 'Completion notification sent to admins' });
  } catch (err: any) {
    console.error('[SERVE] Notify completion error:', err);
    res.status(500).json({ error: 'Failed to send notification', code: 'FAILED_TO_SEND_NOTIFICATION' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE: Client Case Status Webhook
// Push update via callback when serve job status changes
// ════════════════════════════════════════════════════════════

router.post('/:id/push-status', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) { res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }); return; }

    const attempts = db.prepare(
      'SELECT * FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_number ASC LIMIT 1000'
    ).all(req.params.id) as any[];

    // Get callback URL from config, with sensible default
    const callbackUrl = req.body.callback_url || 'https://rmpgutahps.us/api/serve-status-callback';
    // Basic URL validation
    if (typeof callbackUrl !== 'string' || !callbackUrl.startsWith('https://')) {
      res.status(400).json({ error: 'callback_url must be a valid HTTPS URL', code: 'INVALID_CALLBACK_URL' });
      return;
    }
    const payload = {
      serve_job_id: job.id,
      case_number: job.case_number,
      recipient_name: job.recipient_name,
      status: job.status,
      attempt_count: job.attempt_count,
      document_type: job.document_type,
      client_name: job.client_name,
      deadline: job.deadline,
      last_attempt: attempts.length > 0 ? {
        date: attempts[attempts.length - 1].attempt_at,
        result: attempts[attempts.length - 1].result,
        method: attempts[attempts.length - 1].attempt_type,
      } : null,
      updated_at: job.updated_at,
    };

    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      auditLog(req, 'WEBHOOK', 'serve_queue', String(req.params.id),
        `Status push to portal: ${response.status} ${response.statusText}`);

      res.json({
        success: response.ok,
        status: response.status,
        message: response.ok ? 'Status pushed to client portal' : 'Callback returned error',
      });
    } catch (fetchErr: any) {
      auditLog(req, 'WEBHOOK_FAIL', 'serve_queue', String(req.params.id),
        `Status push failed: ${fetchErr.message}`);
      res.json({
        success: false,
        message: `Webhook delivery failed: ${fetchErr.message}`,
      });
    }
  } catch (err: any) {
    console.error('[SERVE] Push status error:', err);
    res.status(500).json({ error: 'Failed to push status', code: 'FAILED_TO_PUSH_STATUS' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE: Serve Job Cost Calculator
// ════════════════════════════════════════════════════════════

router.get('/:id/cost-estimate', validateParamIdMiddleware, requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) { res.status(404).json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }); return; }

    const attempts = db.prepare(
      'SELECT * FROM serve_attempts WHERE serve_queue_id = ? LIMIT 1000'
    ).all(req.params.id) as any[];

    // Default fee schedule (can be overridden by query params)
    const baseServeFee = parseFloat(req.query.base_fee as string) || 75.00;
    const additionalAttemptFee = parseFloat(req.query.attempt_fee as string) || 35.00;
    const rushSurcharge = parseFloat(req.query.rush_fee as string) || 50.00;
    const mileageRate = parseFloat(req.query.mileage_rate as string) || 0.67;
    const skipTraceFee = parseFloat(req.query.skip_trace_fee as string) || 45.00;

    const skipTraceCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM serve_skip_traces WHERE serve_queue_id = ?'
    ).get(req.params.id) as any)?.cnt || 0;

    // Calculate estimated mileage from attempt GPS data
    let totalMileage = 0;
    for (const att of attempts) {
      if (att.notes) {
        try {
          const parsed = JSON.parse(att.notes);
          if (parsed.mileage) totalMileage += parseFloat(parsed.mileage) || 0;
        } catch { /* notes is not JSON — skip mileage extraction */ }
      }
    }

    const attemptCount = attempts.length;
    const extraAttempts = Math.max(0, attemptCount - 1);
    const isRush = job.priority === 'rush' || job.priority === 'urgent';

    const costs = {
      base_fee: baseServeFee,
      extra_attempts: extraAttempts,
      extra_attempt_fee: extraAttempts * additionalAttemptFee,
      rush_surcharge: isRush ? rushSurcharge : 0,
      skip_trace_count: skipTraceCount,
      skip_trace_fee: skipTraceCount * skipTraceFee,
      mileage: totalMileage,
      mileage_fee: totalMileage * mileageRate,
      total: baseServeFee + (extraAttempts * additionalAttemptFee) + (isRush ? rushSurcharge : 0) + (skipTraceCount * skipTraceFee) + (totalMileage * mileageRate),
    };

    res.json({
      job_id: job.id,
      recipient_name: job.recipient_name,
      case_number: job.case_number,
      document_type: job.document_type,
      status: job.status,
      attempt_count: attemptCount,
      costs,
    });
  } catch (err: any) {
    console.error('[SERVE] Cost estimate error:', err);
    res.status(500).json({ error: 'Failed to calculate cost', code: 'FAILED_TO_CALCULATE_COST' });
  }
});

export default router;
