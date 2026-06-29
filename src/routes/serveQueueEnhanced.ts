// ============================================================
// RMPG Flex — Enhanced Serve Queue Management (Cloudflare Worker)
// ============================================================
// Advanced queue operations: filtering, batch reassign, priority
// scoring, route optimization, duplicate detection, proof-of-
// service, ETA calculation, workload summaries, and enhanced
// intake scanning. Builds on serve.ts (officer workflow) and
// serveIntake.ts (OCR pipeline).
//
// All endpoints require auth via c.get('userId').
//
// Dependencies:
//   ../types, ../utils/db, ../utils/serveRouteOptimizer,
//   ../utils/serveIntakeEnhanced
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { toDenverWallClock } from '../utils/denverTime';
import {
  optimizeRoute,
  haversineDistance,
  estimateDriveTime,
} from '../utils/serveRouteOptimizer';
import {
  crossReferenceDefendant,
  validateCharges,
  detectDuplicates as detectDuplicatesBase,
  classifyDocumentType,
  calculateAttemptPriority,
  type DuplicateMatch,
} from '../utils/serveIntakeEnhanced';

const sqe = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const user = c.get('user');
  if (!user) return 'Unauthorized — user not found on context';
  if (!roles.includes(user.role)) return `Role '${user.role}' not authorized`;
  return null;
}

const SERVICE_METHODS = new Set(['personal', 'substitute', 'posting']);

// ── 1. GET /api/serve-queue/enhanced ────────────────────────
// Advanced filtering with pagination: ?status=&county=&serverId=
// &priority=&dateFrom=&dateTo=&documentType=&search=&page=&limit=
sqe.get('/enhanced', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const db = getDb(c.env);
  const status = c.req.query('status');
  const county = c.req.query('county');
  const serverId = c.req.query('serverId');
  const priority = c.req.query('priority');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const documentType = c.req.query('documentType');
  const search = c.req.query('search');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10)), 500);
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const args: unknown[] = [];

  if (status) { where.push('q.status = ?'); args.push(status); }
  if (county) { where.push('q.recipient_city = ?'); args.push(county); }
  if (serverId) { where.push('q.officer_id = ?'); args.push(parseInt(serverId, 10)); }
  if (priority) { where.push('q.priority = ?'); args.push(priority); }
  if (dateFrom) { where.push('q.created_at >= ?'); args.push(dateFrom); }
  if (dateTo) { where.push('q.created_at <= ?'); args.push(dateTo + ' 23:59:59'); }
  if (documentType) { where.push('q.document_type = ?'); args.push(documentType); }
  if (search) {
    where.push('(q.defendant_name LIKE ? OR q.recipient_name LIKE ? OR q.case_number LIKE ? OR q.recipient_address LIKE ?)');
    const s = `%${search}%`;
    args.push(s, s, s, s);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countResult = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM serve_queue q ${whereClause}`,
    ...args,
  );
  const total = countResult?.n ?? 0;

  const rows = await query(
    db,
    `SELECT q.*, u.full_name AS officer_name
       FROM serve_queue q
       LEFT JOIN users u ON u.id = q.officer_id
       ${whereClause}
       ORDER BY
         CASE q.priority WHEN 'urgent' THEN 1 WHEN 'rush' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         q.deadline IS NULL, q.deadline ASC, q.sort_order ASC, q.id DESC
       LIMIT ? OFFSET ?`,
    ...args, limit, offset,
  );

  return c.json({
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── 2. POST /api/serve-queue/batch-reassign ─────────────────
// Batch reassign: { attempts: [{ attemptId, newServerId }] }
sqe.post('/batch-reassign', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body: { attempts?: Array<{ attemptId: number; newServerId: number }> } =
    await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.attempts) || !body.attempts.length) {
    return c.json({ error: 'attempts array required' }, 400);
  }

  const db = getDb(c.env);
  let reassignedCount = 0;
  const reassigned: number[] = [];
  const skipped: Array<{ attemptId: number; reason: string }> = [];

  for (const { attemptId, newServerId } of body.attempts) {
    if (!attemptId || !newServerId) {
      skipped.push({ attemptId, reason: 'missing attemptId or newServerId' });
      continue;
    }

    const attempt = await queryFirst<{ id: number; serve_queue_id: number }>(
      db,
      'SELECT id, serve_queue_id FROM serve_attempts WHERE id = ?',
      attemptId,
    );
    if (!attempt) {
      skipped.push({ attemptId, reason: 'attempt not found' });
      continue;
    }

    const targetServer = await queryFirst<{ id: number }>(
      db,
      "SELECT id FROM users WHERE id = ? AND role IN ('officer', 'supervisor', 'manager', 'admin')",
      newServerId,
    );
    if (!targetServer) {
      skipped.push({ attemptId, reason: 'target server not found or not assignable' });
      continue;
    }

    const queue = await queryFirst<{ id: number; status: string; officer_id: number | null }>(
      db,
      'SELECT id, status, officer_id FROM serve_queue WHERE id = ?',
      attempt.serve_queue_id,
    );
    if (!queue || ['served', 'cancelled', 'failed'].includes(queue.status)) {
      skipped.push({ attemptId, reason: 'queue entry not found or terminal status' });
      continue;
    }

    const newStatus = queue.status === 'pending' ? 'assigned' : queue.status;
    await execute(
      db,
      "UPDATE serve_queue SET officer_id = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?",
      newServerId, newStatus, queue.id,
    );

    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
       VALUES (?, 'batch_reassign', 'serve_assignment', ?, ?)`,
      userId, queue.id,
      JSON.stringify({ from_officer: queue.officer_id, to_officer: newServerId, attempt_id: attemptId }),
    );

    reassigned.push(attemptId);
    reassignedCount++;
  }

  return c.json({ reassignedCount, reassigned, skipped });
});

// ── 3. POST /api/serve-queue/priority-score ─────────────────
// Calculate priority scores for all pending serves or specific IDs.
sqe.post('/priority-score', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body: { queueIds?: number[] } = await c.req.json().catch(() => ({}));
  const db = getDb(c.env);

  let queueIds: number[];
  if (Array.isArray(body.queueIds) && body.queueIds.length > 0) {
    queueIds = body.queueIds;
  } else {
    const pending = await query<{ id: number }>(
      db,
      "SELECT id FROM serve_queue WHERE status NOT IN ('served', 'cancelled', 'failed') LIMIT 200",
    );
    queueIds = pending.map((r) => r.id);
  }

  const scored = await Promise.all(
    queueIds.map(async (id) => {
      const result = await calculateAttemptPriority(db, id);
      return { queueId: id, ...result };
    }),
  );

  scored.sort((a, b) => b.priority - a.priority);

  return c.json({ scored, count: scored.length });
});

// ── 4. GET /api/serve-queue/optimize-route/:serverId ─────────
// Run route optimization for a server. Return ordered stop list.
sqe.get('/optimize-route/:serverId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const serverId = parseInt(c.req.param('serverId'), 10);
  if (isNaN(serverId)) return c.json({ error: 'Invalid serverId' }, 400);

  const db = getDb(c.env);

  const pendingAttempts = await query<{ id: number }>(
    db,
    `SELECT a.id
       FROM serve_attempts a
       JOIN serve_queue q ON q.id = a.serve_queue_id
       WHERE q.officer_id = ?
         AND q.status NOT IN ('served', 'cancelled', 'failed')
       ORDER BY
         CASE q.priority WHEN 'urgent' THEN 1 WHEN 'rush' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         q.deadline IS NULL, q.deadline ASC, q.id ASC
       LIMIT 50`,
    serverId,
  );

  if (pendingAttempts.length === 0) {
    return c.json({
      orderedAttemptIds: [],
      totalDistanceMiles: 0,
      estimatedDriveTimeMinutes: 0,
      stops: [],
    });
  }

  const result = await optimizeRoute(
    db,
    serverId,
    pendingAttempts.map((a) => a.id),
  );

  return c.json(result);
});

// ── 5. POST /api/serve-queue/detect-duplicates ──────────────
// Check for duplicates across the queue. Accepts optional
// { caseNumber, defendantName, address } or scans all active.
sqe.post('/detect-duplicates', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body: {
    caseNumber?: string;
    defendantName?: string;
    address?: string;
  } = await c.req.json().catch(() => ({}));

  const db = getDb(c.env);
  const duplicateGroups: Array<{
    primary: { queueId: number; caseNumber: string; defendantName: string; address: string };
    matches: DuplicateMatch[];
  }> = [];

  if (body.caseNumber && body.defendantName && body.address) {
    const matches = await detectDuplicatesBase(db, body.caseNumber, body.defendantName, body.address);
    if (matches.length > 0) {
      duplicateGroups.push({
        primary: { queueId: 0, caseNumber: body.caseNumber, defendantName: body.defendantName, address: body.address },
        matches,
      });
    }
  } else {
    const activeJobs = await query<{
      id: number;
      case_number: string | null;
      defendant_name: string | null;
      recipient_name: string | null;
      recipient_address: string | null;
    }>(
      db,
      `SELECT id, case_number, defendant_name, recipient_name, recipient_address
       FROM serve_queue
       WHERE status NOT IN ('served', 'cancelled', 'failed')
       LIMIT 100`,
    );

    const seen = new Set<number>();
    for (const job of activeJobs) {
      if (seen.has(job.id)) continue;
      const defendantName = job.defendant_name || job.recipient_name || '';
      const address = job.recipient_address || '';
      const caseNumber = job.case_number || '';
      if (!defendantName && !address && !caseNumber) continue;

      const matches = await detectDuplicatesBase(db, caseNumber, defendantName, address);
      const filtered = matches.filter((m) => m.queueId !== job.id && !seen.has(m.queueId));
      if (filtered.length > 0) {
        duplicateGroups.push({
          primary: {
            queueId: job.id,
            caseNumber,
            defendantName,
            address,
          },
          matches: filtered,
        });
        seen.add(job.id);
        for (const m of filtered) seen.add(m.queueId);
      }
    }
  }

  return c.json({ duplicateGroups, count: duplicateGroups.length });
});

// ── 6. POST /api/serve-queue/auto-close-stale ───────────────
// Auto-close attempts older than N days with no activity.
sqe.post('/auto-close-stale', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body: { days?: number } = await c.req.json().catch(() => ({}));
  const staleDays = Math.max(1, body.days || 30);
  const db = getDb(c.env);

  const staleJobs = await query<{ id: number }>(
    db,
    `SELECT q.id
       FROM serve_queue q
       LEFT JOIN (
         SELECT serve_queue_id, MAX(attempt_at) AS last_activity
         FROM serve_attempts
         GROUP BY serve_queue_id
       ) la ON la.serve_queue_id = q.id
       WHERE q.status NOT IN ('served', 'cancelled', 'failed')
         AND (
           (la.last_activity IS NOT NULL AND la.last_activity < datetime('now','localtime','-' || ? || ' days'))
           OR (la.last_activity IS NULL AND q.created_at < datetime('now','localtime','-' || ? || ' days'))
         )
       LIMIT 500`,
    staleDays, staleDays,
  );

  let closedCount = 0;
  if (staleJobs.length > 0) {
    const placeholders = staleJobs.map(() => '?').join(',');
    await execute(
      db,
      `UPDATE serve_queue
       SET status = 'failed', updated_at = datetime('now','localtime'), closed_at = datetime('now','localtime')
       WHERE id IN (${placeholders})`,
      ...staleJobs.map((j) => j.id),
    );
    closedCount = staleJobs.length;

    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
       VALUES (?, 'auto_close_stale', 'serve_queue', 0, ?)`,
      userId,
      JSON.stringify({ stale_days: staleDays, closed_count: closedCount, queue_ids: staleJobs.map((j) => j.id) }),
    );
  }

  return c.json({ closedCount, staleDays });
});

// ── 7. GET /api/serve-queue/attempt-history/:queueId ─────────
// Full timeline with photos, notes, GPS breadcrumbs.
sqe.get('/attempt-history/:queueId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const queueId = parseInt(c.req.param('queueId'), 10);
  if (isNaN(queueId)) return c.json({ error: 'Invalid queueId' }, 400);

  const db = getDb(c.env);

  const queue = await queryFirst(
    db,
    `SELECT q.*, u.full_name AS officer_name
       FROM serve_queue q LEFT JOIN users u ON u.id = q.officer_id
       WHERE q.id = ?`,
    queueId,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);

  const attempts = await query(
    db,
    `SELECT a.*, u.full_name AS officer_name
       FROM serve_attempts a
       LEFT JOIN users u ON u.id = a.officer_id
       WHERE a.serve_queue_id = ?
       ORDER BY a.attempt_at ASC, a.id ASC`,
    queueId,
  );

  const activityLog = await query(
    db,
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
            u.full_name AS user_name
     FROM activity_log a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE (a.entity_type = 'serve_assignment' AND a.entity_id = ?)
        OR (a.entity_type = 'serve_attempt' AND (a.details LIKE ? OR a.details LIKE ?))
        OR (a.entity_type = 'serve_attempts' AND a.entity_id = ?)
     ORDER BY a.id ASC
     LIMIT 500`,
    queueId,
    `%"serve_queue_id":${queueId},%`,
    `%"serve_queue_id":${queueId}}%`,
    queueId,
  );

  const timeline: Array<{
    type: 'attempt' | 'activity' | 'creation';
    timestamp: string;
    data: Record<string, unknown>;
  }> = [];

  timeline.push({
    type: 'creation',
    timestamp: (queue as Record<string, unknown>).created_at as string,
    data: {
      action: 'queue_created',
      officer_name: (queue as Record<string, unknown>).officer_name,
      recipient_name: (queue as Record<string, unknown>).recipient_name,
      defendant_name: (queue as Record<string, unknown>).defendant_name,
      document_type: (queue as Record<string, unknown>).document_type,
      priority: (queue as Record<string, unknown>).priority,
    },
  });

  for (const a of attempts) {
    const attempt = a as Record<string, unknown>;
    let photoIds: string[] = [];
    try { photoIds = JSON.parse((attempt.photo_ids as string) || '[]'); } catch { photoIds = []; }

    timeline.push({
      type: 'attempt',
      timestamp: attempt.attempt_at as string,
      data: {
        attempt_id: attempt.id,
        attempt_number: attempt.attempt_number,
        officer_name: attempt.officer_name,
        result: attempt.result,
        disposition_code: attempt.disposition_code ?? null,
        attempt_type: attempt.attempt_type,
        notes: attempt.notes,
        latitude: attempt.latitude,
        longitude: attempt.longitude,
        photo_ids: photoIds,
        has_signature: !!attempt.signature_data,
      },
    });
  }

  for (const log of activityLog) {
    let details: Record<string, unknown> = {};
    try { details = JSON.parse((log as Record<string, unknown>).details as string || '{}'); } catch { details = { raw: (log as Record<string, unknown>).details }; }
    timeline.push({
      type: 'activity',
      timestamp: (log as Record<string, unknown>).created_at as string,
      data: {
        action: (log as Record<string, unknown>).action,
        entity_type: (log as Record<string, unknown>).entity_type,
        user_name: (log as Record<string, unknown>).user_name,
        details,
      },
    });
  }

  timeline.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));

  return c.json({
    queue_id: queueId,
    queue,
    total_events: timeline.length,
    timeline,
  });
});

// ── 8. POST /api/serve-queue/complete-with-proof ─────────────
// Mark serve complete with proof: attemptId, method, location,
// notes, photos[]. Generate proof of service data.
sqe.post('/complete-with-proof', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body: {
    attemptId?: number;
    method?: string;
    location?: string;
    locationLat?: number;
    locationLng?: number;
    notes?: string;
    photos?: string[];
    recipientSignature?: string;
    witnessName?: string;
    witnessSignature?: string;
  } = await c.req.json().catch(() => ({}));

  if (!body.attemptId) return c.json({ error: 'attemptId required' }, 400);
  const method = body.method || 'personal';
  if (!SERVICE_METHODS.has(method)) {
    return c.json({ error: `method must be one of: ${[...SERVICE_METHODS].join(', ')}` }, 400);
  }

  const db = getDb(c.env);

  const attempt = await queryFirst<{
    id: number;
    serve_queue_id: number;
    result: string | null;
    attempt_number: number;
  }>(
    db,
    'SELECT id, serve_queue_id, result, attempt_number FROM serve_attempts WHERE id = ?',
    body.attemptId,
  );
  if (!attempt) return c.json({ error: 'Attempt not found' }, 404);

  const queue = await queryFirst<{ id: number; status: string; attempt_count: number; max_attempts: number }>(
    db,
    'SELECT id, status, attempt_count, max_attempts FROM serve_queue WHERE id = ?',
    attempt.serve_queue_id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);
  if (['served', 'cancelled', 'failed'].includes(queue.status)) {
    return c.json({ error: `Queue already in terminal status: ${queue.status}` }, 400);
  }

  const result = method === 'posting' ? 'posted' : method === 'substitute' ? 'sub_served' : 'served';

  await execute(
    db,
    `UPDATE serve_attempts
     SET result = ?, notes = COALESCE(notes, '') || ? || char(10) || ?
     WHERE id = ?`,
    result,
    `[Proof of Service - ${toDenverWallClock(new Date())}]`,
    `Method: ${method} | Location: ${body.location || 'N/A'}${body.notes ? ` | Notes: ${body.notes}` : ''}`,
    body.attemptId,
  );

  const newStatus = 'served';
  await execute(
    db,
    `UPDATE serve_queue
     SET status = ?, updated_at = datetime('now','localtime'), closed_at = datetime('now','localtime')
     WHERE id = ?`,
    newStatus, attempt.serve_queue_id,
  );

  const proofOfService = {
    attemptId: body.attemptId,
    queueId: attempt.serve_queue_id,
    attemptNumber: attempt.attempt_number,
    method,
    result,
    location: body.location || null,
    locationLat: body.locationLat ?? null,
    locationLng: body.locationLng ?? null,
    notes: body.notes || null,
    photos: body.photos || [],
    recipientSignature: body.recipientSignature || null,
    witnessName: body.witnessName || null,
    witnessSignature: body.witnessSignature || null,
    servedAt: toDenverWallClock(new Date()),
    servedBy: userId,
    proofGenerated: true,
  };

  await execute(
    db,
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
     VALUES (?, 'complete_with_proof', 'serve_attempt', ?, ?)`,
    userId, body.attemptId, JSON.stringify(proofOfService),
  );

  return c.json({ success: true, proofOfService });
});

// ── 9. GET /api/serve-queue/eta/:attemptId ───────────────────
// Calculate ETA based on server GPS position and route.
sqe.get('/eta/:attemptId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const attemptId = parseInt(c.req.param('attemptId'), 10);
  if (isNaN(attemptId)) return c.json({ error: 'Invalid attemptId' }, 400);

  const db = getDb(c.env);

  const attempt = await queryFirst<{
    id: number;
    serve_queue_id: number;
    latitude: number | null;
    longitude: number | null;
  }>(
    db,
    'SELECT id, serve_queue_id, latitude, longitude FROM serve_attempts WHERE id = ?',
    attemptId,
  );
  if (!attempt) return c.json({ error: 'Attempt not found' }, 404);

  const queue = await queryFirst<{
    id: number;
    recipient_lat: number | null;
    recipient_lng: number | null;
    recipient_address: string | null;
    officer_id: number | null;
  }>(
    db,
    'SELECT id, recipient_lat, recipient_lng, recipient_address, officer_id FROM serve_queue WHERE id = ?',
    attempt.serve_queue_id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);

  const serverLocation = await queryFirst<{ lat: number; lng: number }>(
    db,
    `SELECT latitude AS lat, longitude AS lng
       FROM clearpathgps_reports
       WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    userId,
  );

  if (!serverLocation || !queue.recipient_lat || !queue.recipient_lng) {
    return c.json({
      etaMinutes: null,
      distanceMiles: null,
      available: false,
      reason: !serverLocation
        ? 'Server GPS position not available'
        : 'Recipient coordinates not available',
    });
  }

  const distanceMiles = haversineDistance(
    serverLocation.lat, serverLocation.lng,
    queue.recipient_lat, queue.recipient_lng,
  );
  const etaMinutes = estimateDriveTime(distanceMiles);

  return c.json({
    etaMinutes,
    distanceMiles: Math.round(distanceMiles * 10) / 10,
    estimatedDriveMinutes: etaMinutes,
    available: true,
    serverLat: serverLocation.lat,
    serverLng: serverLocation.lng,
    destinationLat: queue.recipient_lat,
    destinationLng: queue.recipient_lng,
    destinationAddress: queue.recipient_address,
  });
});

// ── 10. POST /api/serve-queue/schedule-attempt ───────────────
// Schedule an attempt with time window enforcement (business
// hours check for business serves).
sqe.post('/schedule-attempt', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body: {
    queueId?: number;
    scheduledDate?: string;
    scheduledTime?: string;
    notes?: string;
  } = await c.req.json().catch(() => ({}));

  if (!body.queueId) return c.json({ error: 'queueId required' }, 400);
  if (!body.scheduledDate) return c.json({ error: 'scheduledDate required' }, 400);

  const db = getDb(c.env);

  const queue = await queryFirst<{
    id: number;
    status: string;
    document_type: string | null;
    time_window: string | null;
    recipient_lat: number | null;
    recipient_lng: number | null;
    defendant_name: string | null;
    recipient_name: string | null;
    recipient_address: string | null;
    priority: string | null;
  }>(
    db,
    `SELECT id, status, document_type, time_window, recipient_lat, recipient_lng,
            defendant_name, recipient_name, recipient_address, priority
     FROM serve_queue WHERE id = ?`,
    body.queueId,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);
  if (['served', 'cancelled', 'failed'].includes(queue.status)) {
    return c.json({ error: `Queue already in terminal status: ${queue.status}` }, 400);
  }

  const isBusinessServe = queue.document_type === 'eviction'
    || queue.document_type === 'order_to_show_cause'
    || (queue.time_window || '').toLowerCase().includes('business');

  const scheduledDateTime = new Date(`${body.scheduledDate}T${body.scheduledTime || '09:00'}`);
  const hour = scheduledDateTime.getHours();
  const minute = scheduledDateTime.getMinutes();
  const timeDecimal = hour + minute / 60;

  if (isBusinessServe && (timeDecimal < 9 || timeDecimal > 17)) {
    return c.json({
      error: 'Business serves must be scheduled during business hours (09:00–17:00)',
      warning: 'Time window outside business hours for this document type',
    }, 400);
  }

  if (timeDecimal < 7 || timeDecimal > 20.5) {
    return c.json({
      error: 'Service attempts must be scheduled between 07:00 and 20:30',
    }, 400);
  }

  const scheduledAttempt = {
    queueId: body.queueId,
    scheduledDate: body.scheduledDate,
    scheduledTime: body.scheduledTime || '09:00',
    notes: body.notes || null,
    defendantName: queue.defendant_name || queue.recipient_name,
    address: queue.recipient_address,
    documentType: queue.document_type,
    priority: queue.priority,
    scheduledBy: userId,
    scheduledAt: toDenverWallClock(new Date()),
    isBusinessServe,
  };

  await execute(
    db,
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
     VALUES (?, 'schedule_attempt', 'serve_queue', ?, ?)`,
    userId, body.queueId, JSON.stringify(scheduledAttempt),
  );

  return c.json({ success: true, scheduledAttempt });
});

// ── 11. GET /api/serve-queue/workload-summary ────────────────
// Per-server workload: active assigned, overdue, completed today,
// success rate.
sqe.get('/workload-summary', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const db = getDb(c.env);
  const today = toDenverWallClock(new Date()).slice(0, 10);
  const rows = await query<{
    officer_id: number;
    officer_name: string;
    active_assigned: number;
    overdue: number;
    completed_today: number;
    total_attempts: number;
    successful_attempts: number;
  }>(
    db,
    `SELECT
       u.id AS officer_id,
       u.full_name AS officer_name,
       SUM(CASE WHEN q.status IN ('assigned', 'in_progress', 'attempted') THEN 1 ELSE 0 END) AS active_assigned,
       SUM(CASE WHEN q.deadline IS NOT NULL
                  AND q.deadline < datetime('now','localtime')
                  AND q.status NOT IN ('served', 'cancelled', 'failed')
             THEN 1 ELSE 0 END) AS overdue,
       COALESCE(today_completed.cnt, 0) AS completed_today,
       COALESCE(all_attempts.total, 0) AS total_attempts,
       COALESCE(all_attempts.successful, 0) AS successful_attempts
     FROM users u
     INNER JOIN serve_queue q ON q.officer_id = u.id
     LEFT JOIN (
       SELECT officer_id, COUNT(*) AS cnt
       FROM serve_attempts
       WHERE result IN ('served', 'sub_served')
         AND DATE(attempt_at) = ?
       GROUP BY officer_id
     ) today_completed ON today_completed.officer_id = u.id
     LEFT JOIN (
       SELECT officer_id,
              COUNT(*) AS total,
              SUM(CASE WHEN result IN ('served', 'sub_served') THEN 1 ELSE 0 END) AS successful
       FROM serve_attempts
       GROUP BY officer_id
     ) all_attempts ON all_attempts.officer_id = u.id
     WHERE q.status NOT IN ('served', 'cancelled', 'failed')
       AND u.role IN ('officer', 'supervisor', 'manager', 'admin')
     GROUP BY u.id, u.full_name, today_completed.cnt, all_attempts.total, all_attempts.successful
     ORDER BY active_assigned DESC
     LIMIT 200`,
    today,
  );

  return c.json({
    servers: rows.map((r) => ({
      officerId: r.officer_id,
      officerName: r.officer_name,
      activeAssigned: r.active_assigned,
      overdue: r.overdue,
      completedToday: r.completed_today,
      totalAttempts: r.total_attempts,
      successfulAttempts: r.successful_attempts,
      successRate: r.total_attempts
        ? Math.round((r.successful_attempts / r.total_attempts) * 10000) / 100
        : 0,
    })),
  });
});

// ── 12. POST /api/serve-queue/intake-scan ────────────────────
// Enhanced intake scan: accept document text, cross-reference
// defendant, validate charges, detect duplicates, classify
// document type. Return comprehensive intake result.
sqe.post('/intake-scan', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body: {
    text?: string;
    caseNumber?: string;
    defendantName?: string;
    dob?: string;
    address?: string;
    charges?: Array<{ statute: string; description?: string; count?: number }>;
  } = await c.req.json().catch(() => ({}));

  if (!body.text && !body.defendantName) {
    return c.json({ error: 'text or defendantName required' }, 400);
  }

  const db = getDb(c.env);

  const documentClassification = body.text
    ? classifyDocumentType(body.text, 0.8)
    : { type: 'unknown', confidence: 0, keywords: [] };

  const defendantMatches = body.defendantName
    ? await crossReferenceDefendant(db, body.defendantName, body.dob || null)
    : [];

  const chargeValidations = body.charges && body.charges.length > 0
    ? await validateCharges(db, body.charges)
    : [];

  const duplicateMatches = (body.caseNumber && body.defendantName && body.address)
    ? await detectDuplicatesBase(db, body.caseNumber, body.defendantName, body.address)
    : [];

  const keyFields: Record<string, string> = {};
  if (body.text) {
    const lines = body.text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const caseMatch = trimmed.match(/case\s*(?:no\.?|#)?\s*:?\s*(.+)/i);
      if (caseMatch) keyFields.case_number = caseMatch[1].trim();
      const courtMatch = trimmed.match(/(?:court|district|justice)\s*:?\s*(.+)/i);
      if (courtMatch) keyFields.court_name = courtMatch[1].trim();
      const dateMatch = trimmed.match(/(?:hearing|court)\s*date\s*:?\s*(.+)/i);
      if (dateMatch) keyFields.court_date = dateMatch[1].trim();
    }
  }

  return c.json({
    documentClassification,
    defendantMatches,
    chargeValidations,
    duplicateMatches,
    duplicateCount: duplicateMatches.length,
    keyFields,
    hasDefendantMatch: defendantMatches.length > 0,
    hasDuplicates: duplicateMatches.length > 0,
    hasChargesValid: chargeValidations.length > 0 && chargeValidations.every((cv) => cv.valid),
    inputSummary: {
      hasText: !!body.text,
      textLength: body.text?.length || 0,
      caseNumber: body.caseNumber || null,
      defendantName: body.defendantName || null,
      dob: body.dob || null,
      address: body.address || null,
      chargeCount: body.charges?.length || 0,
    },
  });
});

// ── GET /cross-reference/dispatch — find PSO calls without serve_queue entries ─
// Scans calls_for_service for pso_client_request calls that have no matching
// serve_queue row. Useful for diagnosing gaps where the forward cross-link
// missed a call (e.g., calls created before the crosslink was wired).
sqe.get('/cross-reference/dispatch', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<{
    id: number; call_number: string | null; priority: string;
    status: string; location_address: string | null;
    jurisdiction: string | null; created_at: string;
    incident_type: string;
  }>(
    db,
    `SELECT c.id, c.call_number, c.priority, c.status,
            c.location_address, c.jurisdiction, c.created_at,
            c.incident_type
       FROM calls_for_service c
      WHERE c.incident_type = 'pso_client_request'
        AND c.status NOT IN ('cancelled', 'archived')
        AND NOT EXISTS (
          SELECT 1 FROM serve_queue q WHERE q.call_id = c.id
        )
      ORDER BY c.created_at DESC
      LIMIT 50`,
  );
  return c.json({ unmatched: rows, count: rows.length });
});

export default sqe;
