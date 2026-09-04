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
import { clampIntParam } from '../utils/paginationParams';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, executeInChunks } from '../utils/db';
import { getServeConfig } from '../utils/serveConfig';
import { toDenverWallClock } from '../utils/denverTime';
import {
  optimizeRouteForServer as optimizeRoute,
  haversineDistanceMiles as haversineDistance,
  estimateDriveTime,
} from '../utils/serveRouteOptimizer';
import { containsAnyClause } from '../utils/searchText';
import { log as logger, logErrorToDb } from '../utils/logger';
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

// Only 2 of ~17 routes in this file checked role before this fix — the rest
// checked only "is logged in," letting any authenticated user reassign any
// serve job, bulk-fail hundreds of active jobs, or fabricate a completed
// proof-of-service for a job they were never assigned. Mirrors serve.ts's
// own READ/WRITE convention (client_viewer/contract_manager excluded from
// both; officer excluded from bulk/admin-tier actions).
const WRITE = ['admin', 'manager', 'supervisor', 'officer'];
const READ = [...WRITE, 'dispatcher'];
const BULK = ['admin', 'manager', 'supervisor'];

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
  const deniedEnhanced = requireRole(c, ...READ);
  if (deniedEnhanced) return c.json({ error: deniedEnhanced }, 403);

  const db = getDb(c.env);
  const status = c.req.query('status');
  const county = c.req.query('county');
  const serverId = c.req.query('serverId');
  const priority = c.req.query('priority');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const documentType = c.req.query('documentType');
  const search = c.req.query('search');
  const page = clampIntParam(c.req.query('page'), 1, 1, 1000000);
  const limit = clampIntParam(c.req.query('limit'), 50, 1, 500);
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
    // instr(), not LIKE — D1 caps LIKE patterns at 50 chars (searchText.ts).
    const _m = containsAnyClause(['q.defendant_name', 'q.recipient_name', 'q.case_number', 'q.recipient_address']);
    where.push(_m.sql);
    args.push(..._m.binds(search));
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
  const deniedBatchReassign = requireRole(c, ...BULK);
  if (deniedBatchReassign) return c.json({ error: deniedBatchReassign }, 403);

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
      "UPDATE serve_queue SET officer_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
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
  const deniedPriorityScore = requireRole(c, ...READ);
  if (deniedPriorityScore) return c.json({ error: deniedPriorityScore }, 403);

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
  const deniedOptimizeRouteServer = requireRole(c, ...READ);
  if (deniedOptimizeRouteServer) return c.json({ error: deniedOptimizeRouteServer }, 403);

  const serverId = parseInt(c.req.param('serverId'), 10);
  if (!Number.isFinite(serverId) || serverId < 1) return c.json({ error: 'Invalid serverId' }, 400);

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
  const deniedDetectDuplicates = requireRole(c, ...READ);
  if (deniedDetectDuplicates) return c.json({ error: deniedDetectDuplicates }, 403);

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
  const deniedAutoCloseStale = requireRole(c, ...BULK);
  if (deniedAutoCloseStale) return c.json({ error: deniedAutoCloseStale }, 403);

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
           (la.last_activity IS NOT NULL AND la.last_activity < datetime('now','-' || ? || ' days'))
           OR (la.last_activity IS NULL AND q.created_at < datetime('now','-' || ? || ' days'))
         )
       LIMIT 500`,
    staleDays, staleDays,
  );

  let closedCount = 0;
  if (staleJobs.length > 0) {
    // The SELECT above is `LIMIT 500`, so this IN-list is not merely *able* to
    // exceed D1's 100-bound-parameter cap — it is designed to fetch five times
    // it. Any sweep finding more than 100 stale jobs threw at bind time, and
    // because this runs from cron the throw surfaced nowhere: no rows closed,
    // no error_log entry, and the next sweep found the same backlog.
    // Report rows actually changed, not rows attempted. Chunked writes are not
    // atomic, so a partial sweep is possible; `staleJobs.length` would report a
    // clean full close either way and hide it.
    closedCount = await executeInChunks(
      db,
      staleJobs.map((j) => j.id),
      (placeholders: string) => `UPDATE serve_queue
       SET status = 'failed', updated_at = datetime('now'), closed_at = datetime('now')
       WHERE id IN (${placeholders})`,
    );

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
  const deniedAttemptHistory = requireRole(c, ...READ);
  if (deniedAttemptHistory) return c.json({ error: deniedAttemptHistory }, 403);

  const queueId = parseInt(c.req.param('queueId'), 10);
  if (!Number.isFinite(queueId) || queueId < 1) return c.json({ error: 'Invalid queueId' }, 400);

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
  const deniedCompleteWithProof = requireRole(c, ...WRITE);
  if (deniedCompleteWithProof) return c.json({ error: deniedCompleteWithProof }, 403);

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

  const queue = await queryFirst<{ id: number; status: string; attempt_count: number; max_attempts: number; assigned_officer_id: number | null }>(
    db,
    'SELECT id, status, attempt_count, max_attempts, assigned_officer_id FROM serve_queue WHERE id = ?',
    attempt.serve_queue_id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);
  // Proof-of-service is a legal attestation — only the officer actually
  // assigned to this job (or a supervisor-tier override) may file it.
  // Guard: if the job is assigned to a specific officer AND the caller is not
  // that officer AND the caller is not a supervisor-tier role → deny.
  // Previously the condition used requireRole() as a truthy "denied" string,
  // which inverted the logic: the guard PASSED when the role was insufficient
  // (requireRole returned an error string = truthy) and FAILED for supervisors.
  if (queue.assigned_officer_id != null && queue.assigned_officer_id !== userId && requireRole(c, ...BULK) !== null) {
    return c.json({ error: 'Only the assigned officer or a supervisor may complete this job' }, 403);
  }
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
     SET status = ?, updated_at = datetime('now'), closed_at = datetime('now')
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
  const deniedEta = requireRole(c, ...READ);
  if (deniedEta) return c.json({ error: deniedEta }, 403);

  const attemptId = parseInt(c.req.param('attemptId'), 10);
  if (!Number.isFinite(attemptId) || attemptId < 1) return c.json({ error: 'Invalid attemptId' }, 400);

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
    // clearpathgps_reports does not exist. The live officer-keyed location
    // source is gps_breadcrumbs (cpgps_locations is vehicle-keyed and has no
    // user column), so the server's last known position comes from there.
    `SELECT latitude AS lat, longitude AS lng
       FROM gps_breadcrumbs
       WHERE officer_id = ?
       ORDER BY recorded_at DESC LIMIT 1`,
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
  const deniedScheduleAttempt = requireRole(c, ...WRITE);
  if (deniedScheduleAttempt) return c.json({ error: deniedScheduleAttempt }, 403);

  const body: {
    queueId?: number;
    scheduledDate?: string;
    scheduledTime?: string;
    notes?: string;
  } = await c.req.json().catch(() => ({}));

  if (!body.queueId) return c.json({ error: 'queueId required' }, 400);
  if (!body.scheduledDate) return c.json({ error: 'scheduledDate required' }, 400);

  const db = getDb(c.env);
  const serveConfig = await getServeConfig(db);

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

  // Parse as Mountain Time (America/Denver) — appending 'T...' without a
  // timezone designator causes the Workers runtime to treat the string as UTC,
  // so a 09:00 Mountain schedule was being stored and validated as 09:00 UTC
  // (03:00 Mountain). Use Intl to extract the wall-clock hour in Denver instead.
  const scheduledDateTimeUtc = new Date(`${body.scheduledDate}T${body.scheduledTime || '09:00'}:00`);
  const denverParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
  }).formatToParts(scheduledDateTimeUtc);
  const getPart = (t: string) => denverParts.find(p => p.type === t)?.value ?? '';
  const hour = parseInt(getPart('hour'), 10);
  const minute = parseInt(getPart('minute'), 10);
  const scheduledDateTime = scheduledDateTimeUtc; // keep reference for .getDay() fallback below
  const timeDecimal = hour + minute / 60;

  const parseTimeDecimal = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h + (m || 0) / 60;
  };
  const bizStart = parseTimeDecimal(serveConfig.business_hours_start);
  const bizEnd = parseTimeDecimal(serveConfig.business_hours_end);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const denverWeekday = getPart('weekday');
  const dayOfWeek = dayNames.indexOf(denverWeekday);
  const isAllowedDay = serveConfig.business_hours_days.includes(dayOfWeek);
  if (isBusinessServe && (!isAllowedDay || timeDecimal < bizStart || timeDecimal > bizEnd)) {
    const allowedDayStr = serveConfig.business_hours_days.map(d => dayNames[d]).join('/');
    return c.json({
      error: `Business serves must be scheduled during business hours (${serveConfig.business_hours_start}–${serveConfig.business_hours_end}, ${allowedDayStr})`,
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
  const deniedWorkloadSummary = requireRole(c, ...READ);
  if (deniedWorkloadSummary) return c.json({ error: deniedWorkloadSummary }, 403);

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
                  AND q.deadline < datetime('now')
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
  const deniedIntakeScan = requireRole(c, ...WRITE);
  if (deniedIntakeScan) return c.json({ error: deniedIntakeScan }, 403);

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
    // calls_for_service has no `jurisdiction` (and is at D1's 100-column cap,
    // so it can't gain one) — the overflow table's area_name carries it.
    `SELECT c.id, c.call_number, c.priority, c.status,
            c.location_address, e.area_name AS jurisdiction, c.created_at,
            c.incident_type
       FROM calls_for_service c
       LEFT JOIN calls_for_service_ext e ON e.id = c.id
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

// ── POST /optimize-route — run server-side nearest-neighbor optimization ──
// Accepts user's current GPS coordinates as the route origin so the
// optimized order starts from wherever the officer actually is.
sqe.post('/optimize-route', async (c) => {
  const deniedOptimizeRoute = requireRole(c, ...READ);
  if (deniedOptimizeRoute) return c.json({ error: deniedOptimizeRoute }, 403);
  try {
    const db = getDb(c.env);
    const { optimizeRouteFullPipeline, resolveMapboxDirectionsToken } = await import('../utils/serveRouteOptimizer');
    type RouteStop = import('../utils/serveRouteOptimizer').RouteStop;
    const body = await c.req.json<{
      stops: RouteStop[];
      departAt?: string;
      origin?: { lat: number; lng: number } | null;
      circular?: boolean;
      officer_id?: number;
    }>();
    const departAt = body.departAt ?? new Date().toISOString();
    const mapboxToken = resolveMapboxDirectionsToken(c.env);

    // Look up the officer's fleet vehicle MPG (falls back to fleet-wide average).
    const { lookupOfficerFleetMpg } = await import('../utils/serveRouteOptimizer');
    const avgMpg = await lookupOfficerFleetMpg(db, body.officer_id);

    const result = await optimizeRouteFullPipeline(body.stops, departAt, db, mapboxToken, {
      origin: body.origin ?? null,
      circular: body.circular === true,
      avgMpg,
    });
    return c.json({ ...result, avg_mpg: avgMpg });
  } catch (err) {
    logger.error('[serve-queue] optimize-route error', {}, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: (err as Error)?.message ?? String(err),
      details: { route: 'POST /serve-queue/optimize-route' },
      traceId: c.get('traceId') ?? '',
      source: 'serveQueueEnhanced',
      statusCode: 500,
    }, c.executionCtx);
    return c.json({ error: 'Route optimization failed' }, 500);
  }
});

// ── POST /route-progress — update route completion progress ──
sqe.post('/route-progress', async (c) => {
  const deniedRouteProgress = requireRole(c, ...WRITE);
  if (deniedRouteProgress) return c.json({ error: deniedRouteProgress }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const body = await c.req.json<{ route_id: number; visited_queue_ids: number[]; current_lat?: number; current_lng?: number }>();
    if (!body.route_id || !Array.isArray(body.visited_queue_ids)) {
      return c.json({ error: 'route_id and visited_queue_ids required' }, 400);
    }
    await execute(db,
      `UPDATE serve_routes SET visited_queue_ids = ?, current_lat = ?, current_lng = ?, updated_at = datetime('now')
       WHERE id = ? AND officer_id = ?`,
      JSON.stringify(body.visited_queue_ids), body.current_lat ?? null, body.current_lng ?? null,
      body.route_id, userId);
    return c.json({ success: true });
  } catch (err) {
    logger.error('POST /route-progress failed', { src: 'src/routes/serveQueueEnhanced.ts' }, err); return c.json({ error: 'Progress update failed' }, 500); }
});

// ── POST /batch-optimize — optimize routes for all servers at once ──
sqe.post('/batch-optimize', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const { batchOptimizeAllServers } = await import('../utils/serveRouteOptimizer');
    const result = await batchOptimizeAllServers(db);
    return c.json(result);
  } catch (err) {
    logger.error('[serve-queue] batch-optimize error', { src: 'src/routes/serveQueueEnhanced.ts' }, err);
    return c.json({ error: 'Batch optimization failed' }, 500);
  }
});

// ── GET /nearest-unassigned — find closest unassigned job to a location ──
sqe.get('/nearest-unassigned', async (c) => {
  const deniedNearestUnassigned = requireRole(c, ...READ);
  if (deniedNearestUnassigned) return c.json({ error: deniedNearestUnassigned }, 403);
  try {
    const db = getDb(c.env);
    const lat = parseFloat(c.req.query('lat') || '');
    const lng = parseFloat(c.req.query('lng') || '');
    const radius = parseFloat(c.req.query('radius') || '50');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: 'lat and lng required' }, 400);
    const { getNearestUnassignedAttempt } = await import('../utils/serveRouteOptimizer');
    const result = await getNearestUnassignedAttempt(db, lat, lng, radius);
    return c.json(result);
  } catch (err) {
    logger.error('GET /nearest-unassigned failed', { src: 'src/routes/serveQueueEnhanced.ts' }, err); return c.json({ error: 'Lookup failed' }, 500); }
});

// ── POST /route/traffic-check — mid-shift traffic degradation check ──
sqe.post('/route/traffic-check', async (c) => {
  const deniedTrafficCheck = requireRole(c, ...WRITE);
  if (deniedTrafficCheck) return c.json({ error: deniedTrafficCheck }, 403);
  try {
    const body = await c.req.json<{
      remainingStops: import('../utils/serveRouteOptimizer').RouteStop[];
      currentOrder: number[];
      currentPosition: { lat: number; lng: number };
      originalEtas: string[];
      officer_id?: number;
    }>();
    const { remainingStops, currentOrder, currentPosition, originalEtas, officer_id } = body;

    if (!remainingStops?.length) {
      return c.json<import('../utils/serveRouteOptimizer').TrafficCheckResult>({
        degraded: false,
        addedMinutes: 0,
        newOrder: [],
        newEtas: [],
        degradedSegments: [],
        matrixFallback: false,
      });
    }

    const { checkTrafficDegradation, resolveMapboxDirectionsToken, lookupOfficerFleetMpg } = await import('../utils/serveRouteOptimizer');
    const db = getDb(c.env);

    const avgMpg = await lookupOfficerFleetMpg(db, officer_id);

    const result = await checkTrafficDegradation(
      remainingStops,
      currentOrder,
      currentPosition,
      originalEtas,
      db,
      resolveMapboxDirectionsToken(c.env),
      avgMpg ? { avgMpg } : undefined,
    );
    return c.json(result);
  } catch (err) {
    logger.error('POST /route/traffic-check failed', { src: 'src/routes/serveQueueEnhanced.ts' }, err);
    return c.json({ error: 'Traffic check failed' }, 500);
  }
});

export default sqe;
