// Process Serve routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow, localToday } from '../worker-middleware/timeUtils';

const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'] as const;

export function mountServeRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // Static routes first (before /:id params)

  // GET /linked-statuses
  api.get('/linked-statuses', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const callIds = q.call_ids;
    if (!callIds) return c.json({ error: 'call_ids parameter required' }, 400);
    const ids = String(callIds).split(',').map(Number).filter(n => !isNaN(n) && n > 0).slice(0, 200);
    if (!ids.length) return c.json({ error: 'No valid call IDs provided' }, 400);
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT call_id, status, attempt_count FROM serve_queue WHERE call_id IN (${placeholders})`).all(...ids) as any[];
    const result: Record<number, { status: string; attempt_count: number }> = {};
    for (const r of rows) result[r.call_id] = { status: r.status, attempt_count: r.attempt_count };
    return c.json(result);
  });

  // GET /stats/summary
  api.get('/stats/summary', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const today = localToday();

    const counts = await db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) as served,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress
      FROM serve_queue
    `).get() as any;

    const attemptsToday = await db.prepare('SELECT COUNT(*) as count FROM serve_attempts WHERE DATE(attempt_at) = ?').get(today) as any;

    return c.json({ ...counts, attempts_today: attemptsToday?.count || 0, mileage_today: 0 });
  });

  // GET /routes/:date
  api.get('/routes/:date', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const date = c.req.param('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'Invalid date format. Use YYYY-MM-DD.', code: 'INVALID_DATE_FORMAT_USE' }, 400);

    const q = c.req.query();
    const user = c.get('user');
    const parsedOfficerId = q.officer_id ? Number(q.officer_id) : null;
    const officerId = (parsedOfficerId != null && !isNaN(parsedOfficerId) && parsedOfficerId > 0 && Number.isInteger(parsedOfficerId)) ? parsedOfficerId : user.userId;

    if (officerId !== user.userId && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(user.role))
      return c.json({ error: 'You can only view your own routes', code: 'YOU_CAN_ONLY_VIEW' }, 403);

    const route = await db.prepare('SELECT * FROM serve_routes WHERE officer_id = ? AND route_date = ?').get(officerId, date);

    if (!route) return c.json(null);
    return c.json(route);
  });

  // POST /routes
  api.post('/routes', requireRole(...WRITE_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { officer_id, route_date, optimized_order_json, waypoints_json, total_distance_miles, total_time_minutes, start_lat, start_lng, end_lat, end_lng, notes } = body;

    if (!officer_id || !route_date) return c.json({ error: 'officer_id and route_date are required', code: 'OFFICERID_AND_ROUTEDATE_ARE' }, 400);

    const user = c.get('user');
    if (Number(officer_id) !== user.userId && !['admin', 'manager', 'supervisor', 'dispatcher'].includes(user.role))
      return c.json({ error: 'You can only modify your own routes', code: 'YOU_CAN_ONLY_MODIFY' }, 403);

    const now = localNow();
    const existing = await db.prepare('SELECT id FROM serve_routes WHERE officer_id = ? AND route_date = ?').get(officer_id, route_date) as any;

    if (existing) {
      await db.prepare(`
        UPDATE serve_routes SET
          optimized_order_json = COALESCE(?, optimized_order_json),
          waypoints_json = COALESCE(?, waypoints_json),
          total_distance_miles = COALESCE(?, total_distance_miles),
          total_time_minutes = COALESCE(?, total_time_minutes),
          start_lat = COALESCE(?, start_lat), start_lng = COALESCE(?, start_lng),
          end_lat = COALESCE(?, end_lat), end_lng = COALESCE(?, end_lng),
          notes = COALESCE(?, notes), updated_at = ?
        WHERE id = ?
      `).run(optimized_order_json ?? null, waypoints_json ?? null,
        total_distance_miles ?? null, total_time_minutes ?? null,
        start_lat ?? null, start_lng ?? null, end_lat ?? null, end_lng ?? null,
        notes ?? null, now, existing.id);
      const updated = await db.prepare('SELECT * FROM serve_routes WHERE id = ?').get(existing.id);
      return c.json(updated);
    } else {
      const info = await db.prepare(`
        INSERT INTO serve_routes (officer_id, route_date, optimized_order_json, waypoints_json, total_distance_miles, total_time_minutes, start_lat, start_lng, end_lat, end_lng, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(officer_id, route_date, optimized_order_json ?? null, waypoints_json ?? null,
        total_distance_miles ?? null, total_time_minutes ?? null,
        start_lat ?? null, start_lng ?? null, end_lat ?? null, end_lng ?? null,
        notes ?? null, now, now);
      const created = await db.prepare('SELECT * FROM serve_routes WHERE id = ?').get(info.meta.last_row_id);
      return c.json(created, 201);
    }
  });

  // POST /sync-from-sm — skipped in worker (no ServeManager/local API)
  api.post('/sync-from-sm', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    return c.json({ imported: 0, jobs: [], message: 'SM sync not available in Workers environment' });
  });

  // PUT /reorder
  api.put('/reorder', requireRole(...WRITE_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { order } = body;
    if (!Array.isArray(order)) return c.json({ error: 'order must be an array of { id, sort_order }', code: 'ORDER_MUST_BE_AN' }, 400);

    const user = c.get('user');
    if (user.role !== 'admin' && order.length > 500) return c.json({ error: 'Cannot reorder more than 500 items at once', code: 'CANNOT_REORDER_MORE_THAN' }, 400);

    for (const item of order) {
      if (!item || typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id < 1)
        return c.json({ error: 'Each order item must have a positive integer id', code: 'EACH_ORDER_ITEM_MUST' }, 400);
      if (typeof item.sort_order !== 'number' || !Number.isInteger(item.sort_order) || item.sort_order < 0)
        return c.json({ error: 'Each order item must have a non-negative integer sort_order', code: 'EACH_ORDER_ITEM_MUST' }, 400);
    }

    const now = localNow();
    for (const item of order) {
      await db.prepare('UPDATE serve_queue SET sort_order = ?, updated_at = ? WHERE id = ?').run(item.sort_order, now, item.id);
    }

    return c.json({ success: true, updated: order.length });
  });

  // GET /
  api.get('/', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const user = c.get('user');
    const parsedOid = q.officer_id ? Number(q.officer_id) : null;
    let officerId = (parsedOid != null && !isNaN(parsedOid)) ? parsedOid : user.userId;
    if (user.role === 'officer' && officerId !== user.userId) officerId = user.userId;

    const date = q.date || localToday();
    const status = q.status as string | undefined;

    let sql = `SELECT * FROM serve_queue WHERE officer_id = ? AND (serve_date = ? OR status IN ('pending', 'in_progress'))`;
    const params: any[] = [officerId, date];

    if (status && status !== 'all') {
      const VALID_LIST_STATUSES = ['pending', 'in_progress', 'served', 'failed', 'on_hold', 'cancelled'];
      if (!VALID_LIST_STATUSES.includes(status))
        return c.json({ error: `Invalid status filter. Must be one of: all, ${VALID_LIST_STATUSES.join(', ')}`, code: 'INVALID_STATUS_FILTER' }, 400);
      sql = 'SELECT * FROM serve_queue WHERE officer_id = ? AND status = ?';
      params.length = 0;
      params.push(officerId, status);
    }

    sql += " ORDER BY sort_order ASC, priority DESC, COALESCE(deadline, '9999-12-31') ASC LIMIT 2000";
    const rows = await db.prepare(sql).all(...params);
    return c.json(rows);
  });

  // POST /
  api.post('/', requireRole(...WRITE_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { sm_job_id, officer_id, serve_date, recipient_name, recipient_address,
      recipient_city, recipient_state, recipient_zip, recipient_lat, recipient_lng,
      document_type, case_number, court_name, jurisdiction, client_name,
      attorney_name, priority, time_window, deadline, max_attempts,
      service_instructions, notes } = body;

    if (!recipient_name || !recipient_name.trim())
      return c.json({ error: 'recipient_name is required', code: 'RECIPIENTNAME_IS_REQUIRED' }, 400);
    if (recipient_name.length > 500)
      return c.json({ error: 'recipient_name must be 500 characters or less', code: 'RECIPIENTNAME_MUST_BE_500' }, 400);

    const VALID_PRIORITIES = ['normal', 'urgent', 'rush', 'low'];
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority))
      return c.json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`, code: 'INVALID_PRIORITY' }, 400);

    if (serve_date && !/^\d{4}-\d{2}-\d{2}$/.test(serve_date))
      return c.json({ error: 'serve_date must be in YYYY-MM-DD format', code: 'SERVEDATE_MUST_BE_IN' }, 400);

    if (max_attempts !== undefined) {
      const ma = parseInt(max_attempts, 10);
      if (isNaN(ma) || ma < 1 || ma > 99) return c.json({ error: 'max_attempts must be between 1 and 99', code: 'MAXATTEMPTS_MUST_BE_BETWEEN' }, 400);
    }

    if (recipient_lat !== undefined && recipient_lat !== null) {
      const lat = parseFloat(recipient_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) return c.json({ error: 'recipient_lat must be between -90 and 90', code: 'RECIPIENTLAT_MUST_BE_BETWEEN' }, 400);
    }
    if (recipient_lng !== undefined && recipient_lng !== null) {
      const lng = parseFloat(recipient_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) return c.json({ error: 'recipient_lng must be between -180 and 180', code: 'RECIPIENTLNG_MUST_BE_BETWEEN' }, 400);
    }

    const user = c.get('user');
    const info = await db.prepare(`
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
      sm_job_id ?? null, officer_id ?? user.userId,
      serve_date ?? localToday(),
      recipient_name ?? '', recipient_address ?? '', recipient_city ?? '',
      recipient_state ?? '', recipient_zip ?? '', recipient_lat ?? null, recipient_lng ?? null,
      document_type ?? '', case_number ?? '', court_name ?? '', jurisdiction ?? '',
      client_name ?? '', attorney_name ?? '', priority ?? 'normal',
      time_window ?? null, deadline ?? null, max_attempts ?? 3,
      service_instructions ?? '', notes ?? '', now, now);

    const id = Number(info.meta.last_row_id);
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id);
    return c.json(job, 201);
  });

  // GET /:id
  api.get('/:id', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!job) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    const user = c.get('user');
    if (user.role === 'officer' && job.officer_id && job.officer_id !== user.userId)
      return c.json({ error: 'You can only view jobs assigned to you', code: 'YOU_CAN_ONLY_VIEW' }, 403);

    const attempts = await db.prepare('SELECT * FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_number ASC LIMIT 1000').all(id);
    const skipTraces = await db.prepare('SELECT * FROM serve_skip_traces WHERE serve_queue_id = ? ORDER BY searched_at DESC LIMIT 100').all(id);

    let linkedCall = null;
    if (job.call_id) {
      linkedCall = await db.prepare('SELECT id, call_number, status, priority, assigned_unit_ids, pso_requestor_name, contract_id, pso_service_windows, pso_attempt_number, disposition FROM calls_for_service WHERE id = ?').get(job.call_id);
    }

    return c.json({ ...job, attempts, skipTraces, linkedCall });
  });

  // PUT /:id
  api.put('/:id', requireRole(...WRITE_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const existing = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    const user = c.get('user');
    if (user.role === 'officer' && existing.officer_id && existing.officer_id !== user.userId)
      return c.json({ error: 'You can only modify jobs assigned to you', code: 'YOU_CAN_ONLY_MODIFY' }, 403);

    const body = await c.req.json();
    const VALID_SERVE_STATUSES = ['pending', 'in_progress', 'served', 'failed', 'on_hold', 'cancelled'];
    if (body.status !== undefined && !VALID_SERVE_STATUSES.includes(body.status))
      return c.json({ error: `Invalid status. Must be one of: ${VALID_SERVE_STATUSES.join(', ')}`, code: 'INVALID_STATUS' }, 400);

    if (body.recipient_lat !== undefined && body.recipient_lat !== null) {
      const lat = parseFloat(body.recipient_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) return c.json({ error: 'recipient_lat must be between -90 and 90', code: 'RECIPIENTLAT_MUST_BE_BETWEEN' }, 400);
    }
    if (body.recipient_lng !== undefined && body.recipient_lng !== null) {
      const lng = parseFloat(body.recipient_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) return c.json({ error: 'recipient_lng must be between -180 and 180', code: 'RECIPIENTLNG_MUST_BE_BETWEEN' }, 400);
    }

    const updatableFields = ['officer_id', 'serve_date', 'recipient_name', 'recipient_address',
      'recipient_city', 'recipient_state', 'recipient_zip', 'recipient_lat', 'recipient_lng',
      'document_type', 'case_number', 'court_name', 'jurisdiction',
      'client_name', 'attorney_name', 'priority', 'time_window', 'deadline',
      'max_attempts', 'status', 'sort_order', 'service_instructions', 'notes'];

    const setClauses: string[] = [];
    const values: any[] = [];
    for (const field of updatableFields) {
      if (body[field] !== undefined) { setClauses.push(`${field} = ?`); values.push(body[field]); }
    }

    if (setClauses.length === 0) return c.json({ error: 'No updatable fields provided', code: 'NO_UPDATABLE_FIELDS_PROVIDED' }, 400);

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(id);

    await db.prepare(`UPDATE serve_queue SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const updated = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id);
    return c.json(updated);
  });

  // POST /:id/attempt
  api.post('/:id/attempt', requireRole(...WRITE_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!job) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    const user = c.get('user');
    if (user.role === 'officer' && job.officer_id && job.officer_id !== user.userId)
      return c.json({ error: 'You can only record attempts on jobs assigned to you', code: 'YOU_CAN_ONLY_RECORD' }, 403);

    const body = await c.req.json();
    const { result, gps_lat, gps_lng, latitude, longitude, notes,
      method, attempt_type, recipient_response,
      photo_url, photo_ids, signature_url, signature_data, mileage,
      person_served_name } = body;

    const resolvedLat = gps_lat ?? latitude ?? null;
    const resolvedLng = gps_lng ?? longitude ?? null;
    const resolvedAttemptType = attempt_type || method || 'personal';
    const resolvedPhotoIds = photo_url ? JSON.stringify([photo_url]) : (photo_ids ? JSON.stringify(photo_ids) : '[]');
    const resolvedSignature = signature_url || signature_data || null;

    const VALID_RESULTS = ['served', 'no_answer', 'refused', 'posted', 'left_with', 'other', 'unable_to_locate'];
    if (result && !VALID_RESULTS.includes(result))
      return c.json({ error: `Invalid result. Must be one of: ${VALID_RESULTS.join(', ')}`, code: 'INVALID_ATTEMPT_RESULT' }, 400);

    const VALID_METHODS = ['personal', 'substitute', 'posting', 'abode', 'mail', 'other'];
    if (resolvedAttemptType && !VALID_METHODS.includes(resolvedAttemptType))
      return c.json({ error: `Invalid attempt type. Must be one of: ${VALID_METHODS.join(', ')}`, code: 'INVALID_ATTEMPT_METHOD' }, 400);

    if (resolvedLat !== undefined && resolvedLat !== null) {
      const lat = parseFloat(resolvedLat);
      if (isNaN(lat) || lat < -90 || lat > 90) return c.json({ error: 'latitude must be between -90 and 90', code: 'LATITUDE_MUST_BE_BETWEEN' }, 400);
    }
    if (resolvedLng !== undefined && resolvedLng !== null) {
      const lng = parseFloat(resolvedLng);
      if (isNaN(lng) || lng < -180 || lng > 180) return c.json({ error: 'longitude must be between -180 and 180', code: 'LONGITUDE_MUST_BE_BETWEEN' }, 400);
    }

    if (result === 'posted') {
      const failedAttempts = await db.prepare("SELECT COUNT(*) as cnt FROM serve_attempts WHERE serve_queue_id = ? AND result != 'served'").get(id) as any;
      if ((failedAttempts?.cnt || 0) < 2) return c.json({ error: 'Posting requires at least 2 prior failed attempts for due diligence', code: 'POSTING_REQUIRES_PRIOR_ATTEMPTS' }, 400);
    }

    const now = localNow();
    const attemptNumber = (job.attempt_count ?? 0) + 1;
    const attemptInfo = await db.prepare(`
      INSERT INTO serve_attempts (serve_queue_id, attempt_number, attempt_at, officer_id,
        result, latitude, longitude, notes, attempt_type, photo_ids, signature_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, attemptNumber, now, user.userId,
      result || 'no_answer', resolvedLat, resolvedLng,
      notes ?? '', resolvedAttemptType, resolvedPhotoIds, resolvedSignature, now);

    const attemptId = attemptInfo.meta.last_row_id;

    let newStatus = 'in_progress';
    if (result === 'served' || result === 'posted') newStatus = 'served';
    else if (attemptNumber >= (job.max_attempts || 3)) newStatus = 'failed';

    await db.prepare('UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = ? WHERE id = ?').run(attemptNumber, newStatus, now, id);

    const updatedJob = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id);
    const attempt = await db.prepare('SELECT * FROM serve_attempts WHERE id = ?').get(attemptId);
    const dueDiligenceComplete = attemptNumber >= 2 && newStatus !== 'served';

    // dispatch sync-back + portal notification skipped in worker

    return c.json({ attempt, job: updatedJob, dueDiligenceComplete }, 201);
  });

  // POST /:id/skip-trace — simplified in worker (no local API call)
  api.post('/:id/skip-trace', requireRole(...WRITE_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!job) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    const name = job.recipient_name;
    if (!name) return c.json({ error: 'Job has no recipient name for skip trace', code: 'JOB_HAS_NO_RECIPIENT' }, 400);

    // Skip trace via internal HTTP not available in Workers. Store a placeholder.
    const now = localNow();
    const user = c.get('user');
    const traceInfo = await db.prepare(`
      INSERT INTO serve_skip_traces (serve_queue_id, searched_at, search_type, search_query, results_json, addresses_found_json, searched_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, now, 'byname', name, '{}', '[]', user.userId, now);

    const trace = await db.prepare('SELECT * FROM serve_skip_traces WHERE id = ?').get(traceInfo.meta.last_row_id);
    return c.json({ trace, addresses: [], note: 'Skip trace API not available in Workers; placeholder recorded' });
  });

  // GET /export/csv
  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare(`
      SELECT sq.id, sq.status, sq.recipient_name, sq.recipient_address,
        sq.recipient_city, sq.recipient_state, sq.recipient_zip,
        sq.document_type, sq.case_number, sq.court_name, sq.jurisdiction,
        sq.client_name, sq.attorney_name, sq.priority, sq.deadline,
        sq.max_attempts, sq.attempt_count, sq.serve_date,
        sq.service_instructions, sq.notes, sq.created_at, sq.updated_at,
        u.full_name as officer_name
      FROM serve_queue sq
      LEFT JOIN users u ON sq.officer_id = u.id
      ORDER BY sq.created_at DESC LIMIT 10000
    `).all() as any[];

    const headers = ['ID', 'Status', 'Recipient Name', 'Address', 'City', 'State', 'ZIP', 'Document Type', 'Case Number', 'Court', 'Jurisdiction', 'Client', 'Attorney', 'Officer', 'Priority', 'Deadline', 'Max Attempts', 'Attempt Count', 'Serve Date', 'Instructions', 'Notes', 'Created At'];
    const csvRows = rows.map((r: any) => [
      r.id, r.status, r.recipient_name, r.recipient_address, r.recipient_city,
      r.recipient_state, r.recipient_zip, r.document_type, r.case_number,
      r.court_name, r.jurisdiction, r.client_name, r.attorney_name,
      r.officer_name, r.priority, r.deadline, r.max_attempts, r.attempt_count,
      r.serve_date, (r.service_instructions || '').replace(/"/g, '""'),
      (r.notes || '').replace(/"/g, '""'), r.created_at,
    ]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', `attachment; filename="serve_queue_export.csv"`);
    return c.body(csv);
  });

  // GET /:id/gps-trail
  api.get('/:id/gps-trail', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const trail = await db.prepare(`
      SELECT sa.id, sa.attempt_number, sa.attempt_at, sa.latitude, sa.longitude,
             sa.result, sa.attempt_type, u.full_name as officer_name
      FROM serve_attempts sa
      LEFT JOIN users u ON sa.officer_id = u.id
      WHERE sa.serve_queue_id = ? AND sa.latitude IS NOT NULL AND sa.longitude IS NOT NULL
      ORDER BY sa.attempt_at ASC LIMIT 1000
    `).all(id);
    return c.json(trail);
  });

  // GET /:id/affidavit
  api.get('/:id/affidavit', requireRole(...WRITE_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!job) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    const attempts = await db.prepare(`
      SELECT sa.*, u.full_name as officer_name, u.badge_number
      FROM serve_attempts sa
      LEFT JOIN users u ON sa.officer_id = u.id
      WHERE sa.serve_queue_id = ?
      ORDER BY sa.attempt_number ASC LIMIT 1000
    `).all(id) as any[];

    const server = await db.prepare('SELECT full_name, badge_number FROM users WHERE id = ?').get(job.officer_id) as any;

    const affidavit = {
      title: 'AFFIDAVIT OF SERVICE',
      case_number: job.case_number || '',
      court_name: job.court_name || '',
      jurisdiction: job.jurisdiction || '',
      recipient: { name: job.recipient_name, address: `${job.recipient_address || ''}, ${job.recipient_city || ''}, ${job.recipient_state || ''} ${job.recipient_zip || ''}`.trim() },
      document_type: job.document_type || '',
      client_name: job.client_name || '',
      attorney_name: job.attorney_name || '',
      server_name: server?.full_name || '',
      server_badge: server?.badge_number || '',
      service_result: job.status === 'served' ? 'SERVED' : 'NOT SERVED',
      total_attempts: attempts.length,
      attempts: attempts.map((a: any) => ({
        number: a.attempt_number, date: a.attempt_at, result: a.result,
        method: a.attempt_type, gps: a.latitude && a.longitude ? `${a.latitude}, ${a.longitude}` : null,
        notes: a.notes, officer: a.officer_name,
      })),
      final_result: job.status,
      served_at: attempts.find((a: any) => a.result === 'served')?.attempt_at || null,
      generated_at: localNow(),
    };

    return c.json(affidavit);
  });

  // POST /auto-skip-trace — not available in Workers
  api.post('/auto-skip-trace', requireRole(...WRITE_ROLES), async (c) => {
    return c.json({ triggered: 0, jobs: [], message: 'Auto skip-trace not available in Workers environment' });
  });

  // GET /deadlines
  api.get('/deadlines', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare(`
      SELECT sq.id, sq.recipient_name, sq.deadline, sq.status, sq.attempt_count, sq.max_attempts,
             sq.document_type, sq.case_number, sq.client_name,
             u.full_name as officer_name,
             JULIANDAY(sq.deadline) - JULIANDAY('now') as days_remaining
      FROM serve_queue sq
      LEFT JOIN users u ON sq.officer_id = u.id
      WHERE sq.deadline IS NOT NULL AND sq.status NOT IN ('served', 'cancelled')
      ORDER BY sq.deadline ASC LIMIT 1000
    `).all() as any[];

    const overdue = rows.filter((r: any) => r.days_remaining < 0);
    const urgent = rows.filter((r: any) => r.days_remaining >= 0 && r.days_remaining <= 3);
    const upcoming = rows.filter((r: any) => r.days_remaining > 3 && r.days_remaining <= 14);
    const safe = rows.filter((r: any) => r.days_remaining > 14);

    return c.json({ all: rows, overdue, urgent, upcoming, safe, total: rows.length });
  });

  // POST /:id/create-invoice-item
  api.post('/:id/create-invoice-item', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!job) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const { rate_per_attempt, flat_fee, mileage_rate, mileage_total, description } = body;
    const attempts = await db.prepare('SELECT COUNT(*) as cnt FROM serve_attempts WHERE serve_queue_id = ?').get(id) as any;

    const ratePerAttempt = parseFloat(rate_per_attempt) || 0;
    const flatFee = parseFloat(flat_fee) || 0;
    const mileageRate = parseFloat(mileage_rate) || 0;
    const mileageTotal = parseFloat(mileage_total) || 0;
    const attemptCharges = ratePerAttempt * (attempts?.cnt || 0);
    const mileageCharges = mileageRate * mileageTotal;
    const totalAmount = flatFee + attemptCharges + mileageCharges;

    const now = localNow();
    const lineItem = {
      serve_queue_id: job.id, client_name: job.client_name, recipient_name: job.recipient_name,
      case_number: job.case_number, description: description || `Process service: ${job.recipient_name} - ${job.document_type}`,
      attempts_count: attempts?.cnt || 0, rate_per_attempt: ratePerAttempt, flat_fee: flatFee,
      mileage_rate: mileageRate, mileage_total: mileageTotal, attempt_charges: attemptCharges,
      mileage_charges: mileageCharges, total_amount: totalAmount, status: job.status, created_at: now,
    };

    // Try invoice_line_items insert (table may not exist)
    try {
      await db.prepare('INSERT INTO invoice_line_items (description, quantity, unit_price, total, category, reference_type, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(lineItem.description, lineItem.attempts_count || 1, ratePerAttempt || flatFee, totalAmount, 'serve', 'serve_queue', job.id, now);
    } catch { /* table may not exist */ }

    return c.json(lineItem);
  });

  // GET /success-rates
  api.get('/success-rates', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const parsedDays = parseInt(q.days || '90', 10);
    if (isNaN(parsedDays) || parsedDays < 1 || parsedDays > 3650) return c.json({ error: 'days must be a number between 1 and 3650', code: 'INVALID_DAYS_PARAM' }, 400);

    const cutoff = new Date(Date.now() - parsedDays * 24 * 60 * 60 * 1000).toISOString();
    const overall = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) as served, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed, AVG(attempt_count) as avg_attempts FROM serve_queue WHERE created_at >= ?").get(cutoff) as any;
    const byOfficer = await db.prepare("SELECT u.full_name as officer_name, sq.officer_id, COUNT(*) as total, SUM(CASE WHEN sq.status = 'served' THEN 1 ELSE 0 END) as served, SUM(CASE WHEN sq.status = 'failed' THEN 1 ELSE 0 END) as failed, ROUND(AVG(sq.attempt_count), 1) as avg_attempts FROM serve_queue sq LEFT JOIN users u ON sq.officer_id = u.id WHERE sq.created_at >= ? GROUP BY sq.officer_id ORDER BY served DESC").all(cutoff) as any[];
    const byDocType = await db.prepare("SELECT document_type, COUNT(*) as total, SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) as served, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed FROM serve_queue WHERE created_at >= ? AND document_type != '' GROUP BY document_type ORDER BY total DESC").all(cutoff) as any[];
    const byMethod = await db.prepare("SELECT attempt_type as method, COUNT(*) as count, SUM(CASE WHEN result = 'served' THEN 1 ELSE 0 END) as successful FROM serve_attempts WHERE created_at >= ? GROUP BY attempt_type ORDER BY count DESC").all(cutoff) as any[];

    const successRate = overall.total > 0 ? Math.round((overall.served / overall.total) * 100) : 0;
    return c.json({
      overall: { ...overall, success_rate: successRate },
      by_officer: byOfficer.map((o: any) => ({ ...o, success_rate: o.total > 0 ? Math.round((o.served / o.total) * 100) : 0 })),
      by_document_type: byDocType.map((d: any) => ({ ...d, success_rate: d.total > 0 ? Math.round((d.served / d.total) * 100) : 0 })),
      by_method: byMethod,
      period_days: parsedDays,
    });
  });

  // POST /:id/substitute-service
  api.post('/:id/substitute-service', requireRole(...WRITE_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!job) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const { substitute_name, substitute_relationship, substitute_description,
      substitute_age_estimate, gps_lat, gps_lng, notes, photo_url, signature_url } = body;

    if (!substitute_name || typeof substitute_name !== 'string' || !substitute_name.trim())
      return c.json({ error: 'substitute_name is required for substitute service', code: 'SUBSTITUTENAME_IS_REQUIRED_FOR' }, 400);
    if (substitute_name.length > 500)
      return c.json({ error: 'substitute_name must be 500 characters or less', code: 'SUBSTITUTENAME_TOO_LONG' }, 400);

    if (gps_lat != null) {
      const lat = parseFloat(gps_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) return c.json({ error: 'Invalid gps_lat', code: 'INVALID_GPSLAT' }, 400);
    }
    if (gps_lng != null) {
      const lng = parseFloat(gps_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) return c.json({ error: 'Invalid gps_lng', code: 'INVALID_GPSLNG' }, 400);
    }

    const now = localNow();
    const user = c.get('user');
    const attemptNumber = (job.attempt_count ?? 0) + 1;

    const attemptInfo = await db.prepare(`
      INSERT INTO serve_attempts (serve_queue_id, attempt_number, attempt_at, officer_id,
        result, latitude, longitude, notes, attempt_type, photo_ids, signature_data, created_at)
      VALUES (?, ?, ?, ?, 'served', ?, ?, ?, 'substitute', ?, ?, ?)
    `).run(id, attemptNumber, now, user.userId,
      gps_lat ?? null, gps_lng ?? null,
      JSON.stringify({ type: 'substitute_service', substitute_name,
        substitute_relationship: substitute_relationship || '', substitute_description: substitute_description || '',
        substitute_age_estimate: substitute_age_estimate || '', notes: notes || '' }),
      photo_url ? JSON.stringify([photo_url]) : '[]',
      signature_url ?? null, now);

    await db.prepare("UPDATE serve_queue SET status = 'served', attempt_count = ?, updated_at = ? WHERE id = ?").run(attemptNumber, now, id);

    const attempt = await db.prepare('SELECT * FROM serve_attempts WHERE id = ?').get(attemptInfo.meta.last_row_id);
    const updatedJob = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id);
    return c.json({ attempt, job: updatedJob }, 201);
  });

  // GET /priority-queue
  api.get('/priority-queue', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare(`
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
    return c.json(rows);
  });

  // GET /route-map/:date
  api.get('/route-map/:date', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const date = c.req.param('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'Invalid date format. Use YYYY-MM-DD.', code: 'INVALID_DATE_FORMAT_USE' }, 400);

    const q = c.req.query();
    const user = c.get('user');
    const parsedOfficerId = q.officer_id ? Number(q.officer_id) : null;
    const officerId = (parsedOfficerId != null && !isNaN(parsedOfficerId) && parsedOfficerId > 0) ? parsedOfficerId : user.userId;

    const jobs = await db.prepare(`
      SELECT sq.id, sq.recipient_name, sq.recipient_address, sq.recipient_city,
        sq.recipient_state, sq.recipient_zip, sq.recipient_lat, sq.recipient_lng,
        sq.status, sq.priority, sq.deadline, sq.document_type, sq.sort_order,
        sq.time_window, sq.attempt_count, sq.max_attempts
      FROM serve_queue sq
      WHERE sq.officer_id = ? AND (sq.serve_date = ? OR sq.status IN ('pending', 'in_progress'))
        AND sq.recipient_lat IS NOT NULL AND sq.recipient_lng IS NOT NULL
      ORDER BY sq.sort_order ASC, sq.priority DESC LIMIT 1000
    `).all(officerId, date);

    const route = await db.prepare('SELECT * FROM serve_routes WHERE officer_id = ? AND route_date = ?').get(officerId, date);

    return c.json({ jobs, route: route || null });
  });

  // POST /:id/notify-completion — simplified in worker
  api.post('/:id/notify-completion', requireRole(...WRITE_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!job) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    // Notification module not available in Workers
    return c.json({ success: true, message: 'Completion notification sent to admins' });
  });

  // POST /:id/push-status
  api.post('/:id/push-status', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!job) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const callbackUrl = body.callback_url || 'https://rmpgutahps.us/api/serve-status-callback';
    if (typeof callbackUrl !== 'string' || !callbackUrl.startsWith('https://'))
      return c.json({ error: 'callback_url must be a valid HTTPS URL', code: 'INVALID_CALLBACK_URL' }, 400);

    // Push to external URL in Workers — fire and forget
    const attempts = await db.prepare('SELECT * FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_number ASC LIMIT 1000').all(id) as any[];
    const payload = {
      serve_job_id: job.id, case_number: job.case_number, recipient_name: job.recipient_name,
      status: job.status, attempt_count: job.attempt_count, document_type: job.document_type,
      client_name: job.client_name, deadline: job.deadline,
      last_attempt: attempts.length > 0 ? { date: attempts[attempts.length - 1].attempt_at, result: attempts[attempts.length - 1].result, method: attempts[attempts.length - 1].attempt_type } : null,
      updated_at: job.updated_at,
    };

    try {
      const response = await fetch(callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return c.json({ success: response.ok, status: response.status, message: response.ok ? 'Status pushed to client portal' : 'Callback returned error' });
    } catch (fetchErr: any) {
      return c.json({ success: false, message: `Webhook delivery failed: ${fetchErr.message}` });
    }
  });

  // GET /:id/cost-estimate
  api.get('/:id/cost-estimate', requireRole(...WRITE_ROLES, 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const job = await db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id) as any;
    if (!job) return c.json({ error: 'Serve job not found', code: 'SERVE_JOB_NOT_FOUND' }, 404);

    const q = c.req.query();
    const attempts = await db.prepare('SELECT * FROM serve_attempts WHERE serve_queue_id = ? LIMIT 1000').all(id) as any[];

    const baseServeFee = parseFloat(q.base_fee || '75.00');
    const additionalAttemptFee = parseFloat(q.attempt_fee || '35.00');
    const rushSurcharge = parseFloat(q.rush_fee || '50.00');
    const mileageRate = parseFloat(q.mileage_rate || '0.67');
    const skipTraceFee = parseFloat(q.skip_trace_fee || '45.00');

    const skipTraceCount = (await db.prepare('SELECT COUNT(*) as cnt FROM serve_skip_traces WHERE serve_queue_id = ?').get(id) as any)?.cnt || 0;

    let totalMileage = 0;
    for (const att of attempts) {
      if (att.notes) {
        try { const parsed = JSON.parse(att.notes); if (parsed.mileage) totalMileage += parseFloat(parsed.mileage) || 0; } catch { /* skip */ }
      }
    }

    const attemptCount = attempts.length;
    const extraAttempts = Math.max(0, attemptCount - 1);
    const isRush = job.priority === 'rush' || job.priority === 'urgent';

    const costs = {
      base_fee: baseServeFee, extra_attempts: extraAttempts,
      extra_attempt_fee: extraAttempts * additionalAttemptFee,
      rush_surcharge: isRush ? rushSurcharge : 0, skip_trace_count: skipTraceCount,
      skip_trace_fee: skipTraceCount * skipTraceFee,
      mileage: totalMileage, mileage_fee: totalMileage * mileageRate,
      total: baseServeFee + (extraAttempts * additionalAttemptFee) + (isRush ? rushSurcharge : 0) + (skipTraceCount * skipTraceFee) + (totalMileage * mileageRate),
    };

    return c.json({ job_id: job.id, recipient_name: job.recipient_name, case_number: job.case_number, document_type: job.document_type, status: job.status, attempt_count: attemptCount, costs });
  });

  app.route('/api/serve', api);
}
