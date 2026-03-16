// ============================================================
// Process Server Field Suite — API Routes
// ============================================================
// Queue management, service attempts, route planning, skip traces,
// and ServeManager import for the process server module.

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamIdOrUuid } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { broadcast, broadcastDispatchUpdate } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';
import config from '../config';

const router = Router();
router.use(authenticateToken);

// Validate :id params as positive integers
router.param('id', (req: Request, res: Response, next) => {
  const raw = String(req.params.id);
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1 || String(n) !== raw) {
    res.status(400).json({ error: 'Invalid ID parameter' });
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
      WHERE DATE(attempted_at) = ?
    `).get(today) as any;

    const mileageToday = db.prepare(`
      SELECT COALESCE(SUM(mileage), 0) as total FROM serve_attempts
      WHERE DATE(attempted_at) = ?
    `).get(today) as any;

    res.json({
      ...counts,
      attempts_today: attemptsToday?.count || 0,
      mileage_today: mileageToday?.total || 0,
    });
  } catch (err: any) {
    console.error('[SERVE] Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── GET /routes/:date — Get route for officer + date ────────
router.get('/routes/:date', requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const date = String(req.params.date);
    // Validate date format to prevent injection via route param
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      return;
    }
    const parsedOfficerId = req.query.officer_id ? Number(req.query.officer_id) : null;
    const officerId = (parsedOfficerId != null && !isNaN(parsedOfficerId)) ? parsedOfficerId : req.user!.userId;

    // IDOR protection: only supervisors+ can view other officers' routes
    if (officerId !== req.user!.userId && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(req.user!.role)) {
      res.status(403).json({ error: 'You can only view your own routes' });
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
    res.status(500).json({ error: 'Failed to fetch route' });
  }
});

// ── POST /routes — Upsert route ─────────────────────────────
router.post('/routes', requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, route_date, optimized_order_json, waypoints_json, total_distance_miles, total_time_minutes, start_lat, start_lng, end_lat, end_lng, notes } = req.body;

    if (!officer_id || !route_date) {
      res.status(400).json({ error: 'officer_id and route_date are required' });
      return;
    }

    // Validate route_date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(route_date)) {
      res.status(400).json({ error: 'Invalid route_date format. Use YYYY-MM-DD.' });
      return;
    }

    // IDOR protection: only supervisors+ can create/update routes for other officers
    if (Number(officer_id) !== req.user!.userId && !['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
      res.status(403).json({ error: 'You can only manage your own routes' });
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
    res.status(500).json({ error: 'Failed to save route' });
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
    res.status(500).json({ error: 'Failed to sync from ServeManager' });
  }
});

// ── PUT /reorder — Batch update sort_order ──────────────────
router.put('/reorder', requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { order } = req.body;

    if (!Array.isArray(order)) {
      res.status(400).json({ error: 'order must be an array of { id, sort_order }' });
      return;
    }

    if (order.length > 500) {
      res.status(400).json({ error: 'Cannot reorder more than 500 items at once' });
      return;
    }

    // Validate each item has numeric id and sort_order
    for (const item of order) {
      if (!item || typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id < 1 ||
          typeof item.sort_order !== 'number' || !Number.isInteger(item.sort_order)) {
        res.status(400).json({ error: 'Each item must have integer id and sort_order' });
        return;
      }
    }

    // IDOR check: verify EACH job belongs to the requesting officer (or user is supervisor+)
    const isSupervisor = ['admin', 'manager', 'supervisor'].includes(req.user!.role);
    if (!isSupervisor) {
      const checkStmt = db.prepare('SELECT id, officer_id FROM serve_queue WHERE id = ?');
      for (const item of order) {
        const job = checkStmt.get(item.id) as any;
        if (!job) {
          res.status(404).json({ error: `Serve job #${item.id} not found` });
          return;
        }
        if (job.officer_id !== req.user!.userId) {
          res.status(403).json({ error: 'You can only reorder your own serve jobs' });
          return;
        }
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

    auditLog(req, 'UPDATE', 'serve_queue', 0, `Batch reorder: ${order.length} serve jobs`);
    broadcast('serve', 'serve_reordered', { count: order.length });
    res.json({ success: true, updated: order.length });
  } catch (err: any) {
    console.error('[SERVE] Reorder error:', err);
    res.status(500).json({ error: 'Failed to reorder' });
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
    const officerId = (parsedOid != null && !isNaN(parsedOid)) ? parsedOid : req.user!.userId;

    // IDOR protection: only supervisors+ can view other officers' queues
    if (officerId !== req.user!.userId && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(req.user!.role)) {
      res.status(403).json({ error: 'You can only view your own serve queue' });
      return;
    }

    const date = req.query.date as string || localToday();
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      return;
    }
    const status = req.query.status as string | undefined;

    let sql = 'SELECT * FROM serve_queue WHERE officer_id = ? AND serve_date = ?';
    const params: any[] = [officerId, date];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY sort_order ASC, priority DESC, deadline ASC';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[SERVE] List error:', err);
    res.status(500).json({ error: 'Failed to list serve queue' });
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
      return res.status(400).json({ error: 'recipient_name is required' });
    }

    // IDOR protection: non-supervisors can only create jobs for themselves
    if (officer_id && officer_id !== req.user!.userId &&
        !['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
      return res.status(403).json({ error: 'You can only create serve jobs assigned to yourself' });
    }

    // Validate max_attempts is within reasonable bounds
    if (max_attempts !== undefined) {
      const ma = typeof max_attempts === 'number' ? max_attempts : parseInt(String(max_attempts), 10);
      if (isNaN(ma) || ma < 1 || ma > 20) {
        return res.status(400).json({ error: 'max_attempts must be between 1 and 20' });
      }
    }

    // Validate GPS coordinates are within valid ranges
    if (recipient_lat !== undefined && recipient_lat !== null) {
      const lat = Number(recipient_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ error: 'recipient_lat must be between -90 and 90' });
      }
    }
    if (recipient_lng !== undefined && recipient_lng !== null) {
      const lng = Number(recipient_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ error: 'recipient_lng must be between -180 and 180' });
      }
    }

    // Field length limits — prevent storage abuse and rendering issues
    const FIELD_LIMITS: Record<string, number> = {
      recipient_name: 200, recipient_address: 500, recipient_city: 100,
      recipient_state: 50, recipient_zip: 20, document_type: 100,
      case_number: 100, court_name: 200, jurisdiction: 100,
      client_name: 200, attorney_name: 200, priority: 20,
      time_window: 200, service_instructions: 5000, notes: 5000,
    };
    for (const [field, max] of Object.entries(FIELD_LIMITS)) {
      if (req.body[field] && String(req.body[field]).length > max) {
        return res.status(400).json({ error: `${field} exceeds maximum length (${max} chars)` });
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

    const id = info.lastInsertRowid;
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id);
    auditLog(req, 'CREATE', 'serve_queue', Number(id), `Created serve job for ${recipient_name || 'unknown'}`);
    broadcast('serve', 'serve_created', job);

    res.status(201).json(job);
  } catch (err: any) {
    console.error('[SERVE] Create error:', err);
    res.status(500).json({ error: 'Failed to create serve job' });
  }
});

// ── GET /:id — Get single job with attempts + skip traces ───
router.get('/:id', validateParamIdOrUuid, requireRole(...WRITE_ROLES, 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;

    if (!job) {
      res.status(404).json({ error: 'Serve job not found' });
      return;
    }

    const attempts = db.prepare(
      'SELECT * FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_number ASC'
    ).all(req.params.id);

    const skipTraces = db.prepare(
      'SELECT * FROM serve_skip_traces WHERE serve_queue_id = ? ORDER BY searched_at DESC'
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
    res.status(500).json({ error: 'Failed to fetch serve job' });
  }
});

// ── PUT /:id — Update serve job ─────────────────────────────
router.put('/:id', validateParamIdOrUuid, requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Serve job not found' });
      return;
    }

    // IDOR protection: only supervisors+ can update other officers' jobs
    if (existing.officer_id !== req.user!.userId && !['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
      res.status(403).json({ error: 'You can only update your own serve jobs' });
      return;
    }

    // Validate status enum if provided
    const validStatuses = ['pending', 'in_progress', 'served', 'failed', 'cancelled', 'returned'];
    if (req.body.status && !validStatuses.includes(req.body.status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    // Validate priority enum if provided
    const validPriorities = ['low', 'normal', 'high', 'urgent', 'rush'];
    if (req.body.priority && !validPriorities.includes(req.body.priority)) {
      res.status(400).json({ error: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` });
      return;
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
      res.status(400).json({ error: 'No updatable fields provided' });
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
    res.status(500).json({ error: 'Failed to update serve job' });
  }
});

// ── POST /:id/attempt — Record service attempt ─────────────
router.post('/:id/attempt', validateParamIdOrUuid, requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) {
      res.status(404).json({ error: 'Serve job not found' });
      return;
    }

    // IDOR protection: only the assigned officer or supervisors+ can record attempts
    if (job.officer_id !== req.user!.userId && !['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
      res.status(403).json({ error: 'You can only record attempts on your own serve jobs' });
      return;
    }

    const {
      result, gps_lat, gps_lng, notes, method, recipient_response,
      photo_url, signature_url, mileage,
    } = req.body;

    // Validate result enum
    const validResults = ['served', 'failed', 'posted', 'refused', 'not_home', 'wrong_address', 'other'];
    if (result && !validResults.includes(result)) {
      res.status(400).json({ error: `Invalid result. Must be one of: ${validResults.join(', ')}` });
      return;
    }

    // Enforce posting requirements: need 2+ prior failed attempts
    if (result === 'posted') {
      const failedAttempts = db.prepare(
        "SELECT COUNT(*) as cnt FROM serve_attempts WHERE serve_queue_id = ? AND result != 'served'"
      ).get(req.params.id) as any;
      if ((failedAttempts?.cnt || 0) < 2) {
        res.status(400).json({
          error: 'Posting requires at least 2 prior failed attempts for due diligence',
        });
        return;
      }
    }

    const now = localNow();
    const attemptNumber = (job.attempt_count ?? 0) + 1;
    // Determine new status
    let newStatus = 'in_progress';
    if (result === 'served' || result === 'posted') {
      newStatus = 'served';
    } else if (attemptNumber >= (job.max_attempts || 3)) {
      newStatus = 'failed';
    }

    // Atomic: insert attempt + update job status in one transaction
    let attemptId: number | bigint = 0;
    db.transaction(() => {
      const attemptInfo = db.prepare(`
        INSERT INTO serve_attempts (
          serve_queue_id, attempt_number, attempted_at, attempted_by,
          result, gps_lat, gps_lng, notes, method, recipient_response,
          photo_url, signature_url, mileage, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.params.id, attemptNumber, now, req.user!.userId,
        result || 'no_answer', gps_lat ?? null, gps_lng ?? null,
        notes ?? '', method ?? 'personal', recipient_response ?? '',
        photo_url ?? null, signature_url ?? null, mileage ?? null, now,
      );
      attemptId = attemptInfo.lastInsertRowid;

      db.prepare(`
        UPDATE serve_queue SET
          attempt_count = ?,
          status = ?,
          updated_at = ?
        WHERE id = ?
      `).run(attemptNumber, newStatus, now, req.params.id);
    })();

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
            } catch { /* activity log failure is non-fatal */ }
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
    res.status(500).json({ error: 'Failed to record attempt' });
  }
});

// ── POST /:id/skip-trace — Run skip trace for job ───────────
router.post('/:id/skip-trace', validateParamIdOrUuid, requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(req.params.id) as any;
    if (!job) {
      res.status(404).json({ error: 'Serve job not found' });
      return;
    }

    const name = job.recipient_name;
    const address = job.recipient_address;

    if (!name) {
      res.status(400).json({ error: 'Job has no recipient name for skip trace' });
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
      console.error('[Serve] Skip trace API error:', stResponse.status, errText);
      res.status(502).json({ error: 'Skip trace service returned an error' });
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
    res.status(500).json({ error: 'Failed to run skip trace' });
  }
});

export default router;
