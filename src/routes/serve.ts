// ============================================================
// RMPG Flex — Process Service Operations (Cloudflare Worker)
// ============================================================
// Officer-facing serve workflow on top of serve_queue / serve_attempts
// / serve_routes (defined by migration 0030_serve_intake.sql, ensured
// by 0033_serve_ensure.sql).
//
// Relationship to serveIntake (PR #625):
//   - /api/serve-intake = data layer + structured intake (creating
//     queue entries from parsed documents)
//   - /api/serve        = officer-facing daily workflow (routing,
//     attempts, deadlines, priority queue, success rates)
//   Both routes touch the same tables; the split mirrors legacy.
//
// Endpoints (15 MVP):
//   GET    /linked-statuses          status enum + counts
//   GET    /stats/summary
//   GET    /                         list queue (rich filters)
//   POST   /                         create queue entry (alias of intake POST)
//   GET    /:id
//   PUT    /:id
//   POST   /:id/attempt              richer than intake's variant (gps + invalidation)
//   POST   /:id/substitute-service   substitute-service attempt shortcut
//   GET    /:id/gps-trail            attempt locations as a polyline-ready array
//   GET    /routes/:date             active route for officer+date
//   POST   /routes                   create/update route plan
//   PUT    /reorder                  bulk sort_order update
//   GET    /priority-queue           urgent-first triage feed
//   GET    /deadlines                approaching-deadline list
//   GET    /success-rates            per-officer success aggregations
//   GET    /export/csv               admin/manager
//
// Deferred (depend on external integrations / infra not yet ported):
//   - sync-from-sm / push-status     (ServeManager API client)
//   - auto-skip-trace                (third-party skip-trace vendor)
//   - affidavit                      (PDF rendering — pdfTools container)
//   - create-invoice-item            (QuickBooks / ServeManager billing)
//   - notify-completion              (email/SMS fan-out)
//   - route-map                      (Mapbox render endpoint)
//   - cost-estimate                  (config-driven pricing tables)
// ============================================================

import { Hono, type Context } from 'hono';
import { log } from '../utils/logger';
import { clampIntParam } from '../utils/paginationParams';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists, queryInChunks, executeInChunks } from '../utils/db';
import { codeToLegacyResult, codeToQueueStatus, lookupPsoCode } from '../utils/processServiceCodes';
import { generateServeCharges } from '../utils/serveChargeStore';
import { requireOnDutyForServe, linkServeAttemptToShift } from '../utils/corporateWorkflows';
import { syncServeCompletionToCfs } from '../utils/reversePsoSync';
import { notifyServeCompletion } from '../utils/serveCompletionNotify';
import { broadcastAll } from './ws';
import { toDisplayLabel } from '../utils/displayLabel';
import { geocodeAddress } from './geocode';
import { classifyServeJob, type ServeJobForAttention, type AttentionSettings } from '../utils/serveAttention';
import { autoAssignAllUnassigned } from '../utils/serveAutoAssign';
import { routeJsonColumn } from '../utils/serveRoutePayload';
import { parseD1TimestampMs } from '../utils/fleetio/sync';
import { computeOfficerMileageForDay, computeOfficerMileageSegments } from '../utils/serveMileage';
import { hashAddress, shouldRecordDwell, dwellSeconds, attachLearnedDwellSeconds } from '../utils/serveRouteOptimizer';
import {
  coerceAttemptResult,
  defaultPsCodeForResult,
  parseArrivedAtIso,
  STAMP_ONSCENE_DURATION_SQL,
} from '../utils/serveAttemptNormalize';
import { scheduleNextServeAttempt } from '../utils/serveAutoReplan';
import { catalogServeAttemptFiles, type CatalogFileInput } from '../utils/serveAttemptFiles';
import serveAttemptFiles from './serveAttemptFiles';
import { applyUrgencyTier } from '../utils/serveDiligencePlanner';
import {
  intakePatchFromPreview,
  parseServeParsedData,
  previewServeOps,
  type ServeJobOps,
} from '../utils/serveJobOps';

const sv = new Hono<Env>();
sv.route('/', serveAttemptFiles);

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

// D1 can return REAL columns as strings when they were inserted via text
// binding or the column has TEXT affinity. Coerce fee fields to number|null
// so client code can safely call .toFixed() without a Number() guard.
function normalizeFees<T extends Record<string, unknown>>(job: T): T {
  const sf = job.serve_fee;
  const rf = job.rush_fee;
  return {
    ...job,
    serve_fee: sf == null ? null : Number(sf),
    rush_fee: rf == null ? null : Number(rf),
  };
}

async function persistJobOps(
  db: D1Database,
  id: number,
  body: Record<string, unknown>,
) {
  const row = await queryFirst<{
    parsed_data: string | null;
    recipient_name: string | null;
    recipient_address: string | null;
    recipient_city: string | null;
    recipient_state: string | null;
    recipient_zip: string | null;
    recipient_type: string | null;
    business_name: string | null;
    registered_agent_name: string | null;
    document_type: string | null;
    case_number: string | null;
    court_name: string | null;
    jurisdiction: string | null;
    client_name: string | null;
    attorney_name: string | null;
    priority: string | null;
    deadline: string | null;
    service_instructions: string | null;
    notes: string | null;
    plaintiff_name: string | null;
    defendant_name: string | null;
    court_date: string | null;
  }>(db, `SELECT parsed_data, recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
      recipient_type, business_name, registered_agent_name, document_type, case_number, court_name, jurisdiction,
      client_name, attorney_name, priority, deadline, service_instructions, notes,
      plaintiff_name, defendant_name, court_date
     FROM serve_queue WHERE id = ?`, id);
  if (!row) return null;
  const meta = parseServeParsedData(row.parsed_data);
  const opsFromBody = (body.ops && typeof body.ops === 'object')
    ? body.ops as Partial<ServeJobOps>
    : (body as Partial<ServeJobOps>);
  const mergedOps = { ...meta.ops, ...normalizePartialOps(opsFromBody) };
  const klass = typeof body.address_class === 'string' ? body.address_class
    : typeof body.klass === 'string' ? body.klass
    : meta.addressClass;
  const confirmed = body.address_class_confirmed !== undefined
    ? body.address_class_confirmed === true || body.address_class_confirmed === 1
    : typeof body.confirmed === 'boolean' ? body.confirmed
    : meta.addressClassConfirmed;
  const preview = previewServeOps({
    addressClass: klass,
    addressClassConfirmed: confirmed,
    recipient_name: strOrNull(body.recipient_name) ?? row.recipient_name,
    recipient_address: strOrNull(body.recipient_address) ?? row.recipient_address,
    recipient_city: strOrNull(body.recipient_city) ?? row.recipient_city,
    recipient_state: strOrNull(body.recipient_state) ?? row.recipient_state,
    recipient_zip: strOrNull(body.recipient_zip) ?? row.recipient_zip,
    recipient_type: strOrNull(body.recipient_type) ?? row.recipient_type,
    business_name: strOrNull(body.business_name) ?? row.business_name,
    registered_agent_name: strOrNull(body.registered_agent_name) ?? row.registered_agent_name,
    document_type: strOrNull(body.document_type) ?? row.document_type,
    case_number: strOrNull(body.case_number) ?? row.case_number,
    court_name: strOrNull(body.court_name) ?? row.court_name,
    jurisdiction: strOrNull(body.jurisdiction) ?? row.jurisdiction,
    client_name: strOrNull(body.client_name) ?? row.client_name,
    attorney_name: strOrNull(body.attorney_name) ?? row.attorney_name,
    priority: strOrNull(body.priority) ?? row.priority,
    deadline: strOrNull(body.deadline) ?? row.deadline,
    service_instructions: strOrNull(body.service_instructions) ?? row.service_instructions,
    notes: strOrNull(body.notes) ?? row.notes,
    plaintiff_name: strOrNull(body.plaintiff_name) ?? row.plaintiff_name,
    defendant_name: strOrNull(body.defendant_name) ?? row.defendant_name,
    court_date: strOrNull(body.court_date) ?? row.court_date,
    ops: mergedOps,
  });
  const json = intakePatchFromPreview(row.parsed_data, preview);
  await execute(db, `UPDATE serve_queue SET parsed_data = ?, updated_at = datetime(\'now\') WHERE id = ?`, json, id);
  return preview;
}

function normalizePartialOps(raw: Partial<ServeJobOps>): Partial<ServeJobOps> {
  const out: Partial<ServeJobOps> = {};
  const keys: (keyof ServeJobOps)[] = [
    'documents_to_serve', 'venue_kind', 'gate_code', 'dogs_on_site', 'cameras_on_site',
    'language_needed', 'authorized_acceptor', 'photo_required', 'physical_description',
    'vehicle_description', 'best_contact_window', 'no_sunday', 'no_saturday', 'sub_service_first',
  ];
  for (const k of keys) {
    if (raw[k] !== undefined) (out as Record<string, unknown>)[k] = raw[k];
  }
  return out;
}

function restoreServeOfficerUnit(
  db: ReturnType<typeof getDb>,
  officerId: number,
  serveCallId: number | null | undefined,
): Promise<unknown> {
  // Never drop a unit off a different live CFS (patrol/alarm) just because
  // the officer logged a paper-serve attempt.
  return execute(db,
    `UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = datetime(\'now\'), updated_at = datetime(\'now\')
     WHERE officer_id = ?
       AND status NOT IN ('off_duty','out_of_service')
       AND (current_call_id IS NULL OR current_call_id = ?)`,
    officerId, serveCallId ?? -1,
  );
}
const WRITE = ['admin', 'manager', 'supervisor', 'officer'];
const READ = [...WRITE, 'dispatcher'];

const STATUSES = new Set(['pending', 'assigned', 'in_progress', 'served', 'attempted', 'failed', 'cancelled', 'archived']);
// serve_queue.priority CHECK enum — coerce unknown values to 'normal' (a bad
// value 500s the INSERT/UPDATE on the constraint).
const PRIORITIES = new Set(['routine', 'normal', 'rush', 'urgent']);
const URGENCY_TIERS = new Set(['critical', 'tight', 'standard']);
const ATTEMPT_RESULTS = new Set([
  'served', 'sub_served', 'posted', 'no_answer', 'refused',
  'bad_address', 'moved', 'deceased', 'other',
]);

// ─────────────────────────────────────────────────────────────
// Static paths first (BEFORE /:id)
// ─────────────────────────────────────────────────────────────

// GET /linked-statuses
sv.get('/linked-statuses', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const rows = await query<{ status: string; n: number }>(
    getDb(c.env), 'SELECT status, COUNT(*) AS n FROM serve_queue GROUP BY status',
  );
  return c.json({ statuses: [...STATUSES], counts: rows });
});

// GET /stats/summary
sv.get('/stats/summary', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);

  // ServePage's Stats tab renders six cards off this payload and has always
  // sent `?date=`, but the handler never read it and never returned three of
  // the fields the client's StatsSummary declares. The visible result was a
  // tab where "Total Attempts" was permanently 0, "Mileage Today" and "Route
  // Efficiency" showed "--", "Jobs Remaining" silently undercounted by every
  // in-progress job, and the date picker did nothing. The client's `catch {}`
  // ("stats are non-critical") meant none of that ever surfaced as an error.
  //
  // Dates are stored UTC-naive via datetime('now'); compare on the Mountain
  // calendar day so a 6pm Denver service doesn't count as tomorrow.
  const dateParam = c.req.query('date');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? '')
    ? dateParam!
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());

  // Open-workload counts are point-in-time, not per-day: a job still pending is
  // pending regardless of which date is being viewed, so these stay unscoped.
  const openCounts = await queryFirst<{ pending: number; in_progress: number; overdue: number }>(
    db,
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)     AS pending,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN deadline IS NOT NULL AND deadline < datetime('now')
                 AND status NOT IN ('served','cancelled','failed') THEN 1 ELSE 0 END) AS overdue
     FROM serve_queue`,
  );

  // Outcome counts ARE per-day — they answer "what did the run accomplish on
  // this date", which is what the cards are labelled ("Served Today").
  const dayCounts = await queryFirst<{ served: number; failed: number }>(
    db,
    `SELECT
       SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) AS served,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM serve_queue
     WHERE closed_at IS NOT NULL AND date(closed_at) = ?`,
    day,
  );

  const attempts = await queryFirst<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM serve_attempts WHERE date(attempt_at) = ?',
    day,
  );

  const total = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM serve_queue');

  // Planned mileage lives on serve_routes.total_distance_miles (one row per
  // officer per day) — this is what the Stats tab's "Route Efficiency" card
  // divides by.
  let plannedMileage = 0;
  if (await columnExists(db, 'serve_routes', 'total_distance_miles')) {
    const m = await queryFirst<{ planned: number | null }>(
      db,
      `SELECT SUM(total_distance_miles) AS planned
         FROM serve_routes WHERE route_date = ?`,
      day,
    );
    plannedMileage = Math.round((m?.planned ?? 0) * 10) / 10;
  }

  // Actual driven mileage — sum computeOfficerMileageForDay (serveMileage.ts)
  // across every officer with an attempt that day. This is the same
  // attribution the billing line-item generator uses (serveBillingEnhanced.ts
  // -> computeMileageForQueue), so this card can never show a number the
  // eventual invoice disagrees with. A query failure falls back to null
  // (never to the planned figure — labelling a planned number as actual
  // would quietly overstate reimbursable mileage on a billing-adjacent
  // surface).
  let actualMileage: number | null = null;
  try {
    const officerRows = await query<{ officer_id: number }>(
      db,
      `SELECT DISTINCT officer_id FROM serve_attempts
       WHERE date(attempt_at) = ? AND officer_id IS NOT NULL`,
      day,
    );
    let sum = 0;
    for (const { officer_id } of officerRows) {
      sum += await computeOfficerMileageForDay(db, officer_id, day);
    }
    actualMileage = Math.round(sum * 10) / 10;
  } catch {
    actualMileage = null;
  }

  return c.json({
    date: day,
    total: total?.n ?? 0,
    pending: openCounts?.pending ?? 0,
    in_progress: openCounts?.in_progress ?? 0,
    served: dayCounts?.served ?? 0,
    failed: dayCounts?.failed ?? 0,
    overdue: openCounts?.overdue ?? 0,
    total_attempts: attempts?.n ?? 0,
    mileage: actualMileage,
    planned_mileage: plannedMileage,
  });
});

// GET /mileage/mine — officer-facing "mileage today" surface. Scoped to the
// authenticated officer's own id only (never a query param) so this can
// never leak another officer's driven mileage. Backs MyRunTab's pre-invoice
// visibility line: the same number this endpoint returns is what
// generateBillingLineItems (serveBillingEnhanced.ts) will later bill to the
// client, computed from the same shared serveMileage.ts source.
sv.get('/mileage/mine', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const user = c.get('user') as { id: number } | undefined;
  if (!user?.id) return c.json({ error: 'Not authenticated' }, 401);

  const dateParam = c.req.query('date');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? '')
    ? dateParam!
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());

  const db = getDb(c.env);
  try {
    const segments = await computeOfficerMileageSegments(
      db, user.id, `${day} 00:00:00`, `${day} 23:59:59`,
    );
    const byJobMap = new Map<number, number>();
    for (const s of segments) {
      byJobMap.set(s.serveQueueId, (byJobMap.get(s.serveQueueId) ?? 0) + s.miles);
    }
    const by_job = Array.from(byJobMap.entries()).map(([serve_queue_id, miles]) => ({
      serve_queue_id,
      miles: Math.round(miles * 10) / 10,
    }));
    const miles = Math.round(by_job.reduce((sum, j) => sum + j.miles, 0) * 10) / 10;
    return c.json({ date: day, miles, by_job });
  } catch {
    return c.json({ date: day, miles: null, by_job: [] });
  }
});

// GET /active-routes — DispatchPage's process-server overlay. Returns
// today's routes (America/Denver) + all not-yet-terminal serve jobs.
// Must be declared before /:id, which otherwise eats the path as an id
// and 400s (the exact bug this fixes, 2026-07-01).
sv.get('/active-routes', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' })
    .format(new Date());
  const [routes, jobs] = await Promise.all([
    query(db, 'SELECT * FROM serve_routes WHERE route_date = ? ORDER BY id DESC LIMIT 50', today),
    query(db, `SELECT * FROM serve_queue
               WHERE status NOT IN ('served','cancelled','failed')
               ORDER BY sort_order, id DESC LIMIT 200`),
  ]);
  return c.json({ jobs, routes });
});

// GET /routes/:date  (specific path before /:id catches "routes")
sv.get('/routes/:date', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const date = c.req.param('date');
  const user = c.get('user') as { id: number; role: string } | undefined;
  const officerId = c.req.query('officer_id');
  const args: any[] = [date];
  let sql = 'SELECT * FROM serve_routes WHERE route_date = ?';
  // Officers only see their own routes; supervisors/managers/admins can filter by officer_id or see all.
  if (user?.role === 'officer') {
    sql += ' AND officer_id = ?'; args.push(user.id);
  } else if (officerId) {
    sql += ' AND officer_id = ?'; args.push(parseInt(officerId, 10));
  }
  sql += ' ORDER BY id DESC LIMIT 50';
  return c.json(await query(getDb(c.env), sql, ...args));
});

// POST /routes
sv.post('/routes', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const officerId = body.officer_id ?? user?.id;
  if (!officerId) return c.json({ error: 'officer_id required' }, 400);
  const r = await execute(
    getDb(c.env),
    `INSERT INTO serve_routes (
       officer_id, route_date, optimized_order_json, waypoints_json,
       total_distance_miles, total_time_minutes,
       start_lat, start_lng, end_lat, end_lng, notes, planned_start_time
     ) VALUES (?,?,?,?, ?,?, ?,?,?,?, ?,?)`,
    officerId, body.route_date ?? null,
    routeJsonColumn(body.optimized_order_json, body.optimized_order),
    routeJsonColumn(body.waypoints_json, body.waypoints),
    body.total_distance_miles ?? null, body.total_time_minutes ?? null,
    body.start_lat ?? null, body.start_lng ?? null,
    body.end_lat ?? null, body.end_lng ?? null,
    body.notes ?? null, body.planned_start_time ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id }, 201);
});

// GET /officer-start/:officerId — last known GPS fix for an officer.
//
// The route planner anchors optimization on the officer's STARTING position:
// without one, the "first" stop is chosen arbitrarily and the officer's real
// first leg (wherever they are → stop 1) is never counted, so the planned
// mileage understates the run. Live GPS covers the officer planning their own
// day, but the planner's officer dropdown lets a supervisor plan for SOMEONE
// ELSE — and the browser's GPS is the supervisor's position, not theirs. This
// endpoint supplies that other officer's own last known position.
//
// Deliberately returns the raw fix PLUS its age and lets the caller decide what
// is too stale. Baking a cutoff in here would silently turn "your last fix is
// 3 hours old" into an indistinguishable "no position on file", which are very
// different things for an operator to see.
//
// Declared before sv.get('/:id') (line ~815) — a two-segment path can't be
// caught by the single-segment '/:id', but keeping the specific routes above it
// is the convention in this file and Hono matches in declaration order.
sv.get('/officer-start/:officerId', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const officerId = parseInt(c.req.param('officerId'), 10);
  if (!Number.isFinite(officerId)) return c.json({ error: 'officerId must be numeric' }, 400);

  const db = getDb(c.env);
  const row = await queryFirst<{
    latitude: number; longitude: number; accuracy: number | null; recorded_at: string;
  }>(
    db,
    `SELECT latitude, longitude, accuracy, recorded_at
       FROM gps_breadcrumbs
      WHERE officer_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1`,
    officerId,
  );

  if (!row) return c.json({ found: false, officer_id: officerId });

  // recorded_at is written by datetime('now'), which is UTC but zone-LESS —
  // a bare Date.parse reads that as LOCAL time and skews the age by the host's
  // offset (the same trap documented for Fleet.io's last-write-wins compare).
  // parseD1TimestampMs is the canonical fix; utahWarrantPoller imports it the
  // same way.
  const recordedMs = parseD1TimestampMs(row.recorded_at);
  const ageMinutes = recordedMs == null
    ? null
    : Math.max(0, Math.round((Date.now() - recordedMs) / 60000));

  return c.json({
    found: true,
    officer_id: officerId,
    lat: row.latitude,
    lng: row.longitude,
    accuracy_m: row.accuracy ?? null,
    recorded_at: row.recorded_at,
    age_minutes: ageMinutes,
  });
});

// PUT /reorder — bulk sort_order update for drag-and-drop UIs
sv.put('/reorder', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<{ items?: { id: number; sort_order: number }[] }>()
    .catch(() => ({} as { items?: { id: number; sort_order: number }[] }));
  if (!Array.isArray(body.items) || !body.items.length) {
    return c.json({ error: 'items array required' }, 400);
  }
  const db = getDb(c.env);
  // D1 doesn't support transactions across multiple .run() calls in
  // a single batch the same way as better-sqlite3; use db.batch().
  await db.batch(body.items.map((it) => db.prepare(
    "UPDATE serve_queue SET sort_order = ?, updated_at = datetime(\'now\') WHERE id = ?",
  ).bind(it.sort_order, it.id)));
  return c.json({ success: true, updated: body.items.length });
});

// GET /priority-queue — urgent first, then rush, then deadline-ascending
sv.get('/priority-queue', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const officerId = c.req.query('officer_id');
  const where: string[] = ["status NOT IN ('served','cancelled','failed')"];
  const args: any[] = [];
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  const sql = `SELECT * FROM serve_queue
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE priority WHEN 'urgent' THEN 1 WHEN 'rush' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      deadline IS NULL, deadline ASC, sort_order ASC, id ASC
    LIMIT 100`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

// GET /deadlines — approaching-deadline triage view
sv.get('/deadlines', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const days = parseInt(c.req.query('days') || '7', 10);
  const sql = `SELECT *, CAST(julianday(deadline) - julianday('now') AS INTEGER) AS days_remaining
    FROM serve_queue
    WHERE deadline IS NOT NULL
      AND deadline <= datetime('now','+' || ? || ' days')
      AND status NOT IN ('served','cancelled','failed')
    ORDER BY deadline ASC LIMIT 200`;
  return c.json(await query(getDb(c.env), sql, days));
});

// GET /success-rates?days=N — per-officer success aggregations
sv.get('/success-rates', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  // The client's period selector (30/60/90 days — PerformanceTab.tsx) sends
  // ?days=N, but this query never read it and always aggregated all-time
  // data, so every period selection showed the identical lifetime rate.
  const days = parseInt(c.req.query('days') || '90', 10);
  const rows = await query<{ officer_id: number; officer_name: string; total: number; served: number; failed: number; attempts: number }>(
    getDb(c.env),
    `SELECT u.id AS officer_id, u.full_name AS officer_name,
            COUNT(q.id) AS total,
            SUM(CASE WHEN q.status='served' THEN 1 ELSE 0 END) AS served,
            SUM(CASE WHEN q.status='failed' THEN 1 ELSE 0 END) AS failed,
            SUM(q.attempt_count) AS attempts
       FROM serve_queue q LEFT JOIN users u ON u.id = q.officer_id
       WHERE q.officer_id IS NOT NULL
         AND q.created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY q.officer_id, u.full_name
       ORDER BY total DESC LIMIT 100`,
    days,
  );
  // Three live consumers read this route with two incompatible shapes:
  //   - ServeDashboardPerformance.tsx reads `{ officers: [{full_name,
  //     success_pct, ...}] }` (the original shape).
  //   - PerformanceTab.tsx and ServePage.tsx both read
  //     `{ period_days, overall: {...}, by_officer: [{officer_name,
  //     success_rate, ...}] }` — neither of which this route ever returned,
  //     so both silently rendered nothing but their headers.
  // Return both shapes rather than picking one and re-breaking whichever
  // consumer isn't updated in the same pass.
  const overallTotal = rows.reduce((s, r) => s + r.total, 0);
  const overallServed = rows.reduce((s, r) => s + r.served, 0);
  const overallFailed = rows.reduce((s, r) => s + r.failed, 0);
  const overallAttempts = rows.reduce((s, r) => s + (r.attempts ?? 0), 0);
  return c.json({
    officers: rows.map((r) => ({
      officer_id: r.officer_id,
      full_name: r.officer_name,
      total: r.total,
      served: r.served,
      failed: r.failed,
      success_pct: r.total ? Math.round((r.served / r.total) * 10000) / 100 : 0,
    })),
    period_days: days,
    overall: {
      total: overallTotal,
      served: overallServed,
      failed: overallFailed,
      success_rate: overallTotal ? Math.round((overallServed / overallTotal) * 10000) / 100 : 0,
      avg_attempts: overallTotal ? Math.round((overallAttempts / overallTotal) * 100) / 100 : 0,
    },
    by_officer: rows.map((r) => ({
      officer_id: r.officer_id,
      officer_name: r.officer_name,
      total: r.total,
      served: r.served,
      failed: r.failed,
      success_rate: r.total ? Math.round((r.served / r.total) * 10000) / 100 : 0,
      avg_attempts: r.total ? Math.round((Number(r.attempts ?? 0) / r.total) * 100) / 100 : 0,
    })),
  });
});

// GET /schedule-analytics?start_date=YYYY-MM-DD — attempt-timing patterns
// for ServeDashboardPerformance's "when do we actually succeed" widget.
// Never existed on the backend before (2026-07-02) — the client's call fell
// into the /:id catch-all below (parseInt('schedule-analytics') → 400),
// and because it's awaited inside a single Promise.all with summary/rates/
// deadlines, that 400 threw and silently blanked the WHOLE widget on every
// refresh, not just the analytics section.
sv.get('/schedule-analytics', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('start_date') || '')
    ? c.req.query('start_date')!
    : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const db = getDb(c.env);

  // ⚠️ Bucketing happens in the Worker, NOT in SQL. `attempt_at` is naive UTC,
  // so `strftime('%w'/'%H', attempt_at)` — what this endpoint used to do —
  // buckets by UTC: a 7pm MDT knock is stored 01:00 UTC the NEXT day, so it
  // was counted as a 1am attempt on the following weekday. That systematically
  // moved every evening attempt (the highest-yield slot) into the small hours
  // of the wrong day, which is precisely backwards for a widget whose entire
  // job is telling a server when to knock.
  //
  // A fixed SQL offset can't fix it either: Utah runs MST (UTC-7) in winter and
  // MDT (UTC-6) in summer, so any constant is wrong for half the year. Reading
  // through the IANA zone is the only DST-correct option.
  const ROW_SCAN_LIMIT = 5000;
  const rows = await query<{ attempt_at: string; result: string }>(db, `
    SELECT attempt_at, result FROM serve_attempts
     WHERE date(attempt_at) >= ? AND attempt_at IS NOT NULL
     ORDER BY attempt_at DESC LIMIT ?`, startDate, ROW_SCAN_LIMIT);

  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', hour: '2-digit', hour12: false, weekday: 'short',
  });
  const DOW_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Same three bands the client's diligence model uses (serveDiligenceChain.ts),
  // so "vary your time-of-day" and "here's when we succeed" speak one language.
  const bandFor = (h: number) => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');

  const by_day_of_week: Record<string, { total: number; served: number }> = {};
  const by_hour: Record<string, { total: number; served: number }> = {};
  // Cross-tab: 7 days × 3 bands. A 7×24 grid would be almost entirely empty at
  // this volume; three bands stay populated enough to actually steer a route.
  const by_day_band: Record<string, { total: number; served: number }> = {};

  const bump = (bucket: Record<string, { total: number; served: number }>, key: string, ok: boolean) => {
    const e = bucket[key] ?? (bucket[key] = { total: 0, served: 0 });
    e.total++;
    if (ok) e.served++;
  };

  for (const r of rows) {
    // Naive UTC string -> real instant. Appending 'Z' is what makes the zone
    // conversion below meaningful; without it the runtime reads it as local.
    const iso = r.attempt_at.includes('T') ? r.attempt_at : r.attempt_at.replace(' ', 'T');
    const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
    if (Number.isNaN(d.getTime())) continue;

    const parts = Object.fromEntries(partsFmt.formatToParts(d).map((p) => [p.type, p.value]));
    const hour = parseInt(parts.hour, 10) % 24;
    const dow = DOW_INDEX[parts.weekday] ?? 0;
    const ok = r.result === 'served' || r.result === 'sub_served';

    bump(by_day_of_week, DOW_NAMES[dow], ok);
    bump(by_hour, String(hour).padStart(2, '0'), ok);
    bump(by_day_band, `${dow}|${bandFor(hour)}`, ok);
  }

  // Summary is derived from the SAME `rows` the buckets are built from, not
  // from a separate COUNT(*) over the whole window. A second SQL aggregate
  // would count every attempt while the grid only reflects the first
  // ROW_SCAN_LIMIT of them, so past that many attempts the header would claim
  // a total the cells below could not add up to — the kind of drift that only
  // appears once real volume arrives and is then very hard to trust or trace.
  let total = 0;
  let served = 0;
  for (const b of Object.values(by_day_of_week)) { total += b.total; served += b.served; }

  return c.json({
    summary: {
      total_attempts: total,
      success_rate: total ? Math.round((served / total) * 10000) / 100 : 0,
    },
    by_day_of_week,
    by_hour,
    by_day_band,
    bands: ['morning', 'afternoon', 'evening'],
    timezone: 'America/Denver',
    // True when the window held more attempts than we scanned, so the caller
    // can say "based on the most recent N" instead of implying completeness.
    truncated: rows.length >= ROW_SCAN_LIMIT,
    scanned: rows.length,
  });
});

// GET /export/csv
sv.get('/export/csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const rows = await query<any>(
    getDb(c.env),
    `SELECT id, status, priority, recipient_name, recipient_address, recipient_city,
            recipient_state, document_type, case_number, deadline, attempt_count, officer_id, created_at
       FROM serve_queue ORDER BY id DESC LIMIT 10000`,
  );
  const headers = ['id', 'status', 'priority', 'recipient_name', 'recipient_address',
    'recipient_city', 'recipient_state', 'document_type', 'case_number', 'deadline',
    'attempt_count', 'officer_id', 'created_at'];
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="serve_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// Core queue CRUD (overlaps with serveIntake — intentional)
// ─────────────────────────────────────────────────────────────

// ── Assignment console ─────────────────────────────────────
async function loadNudgeSettings(db: ReturnType<typeof getDb>): Promise<AttentionSettings & { renotify_hours: number; notify_supervisor_email: number; digest_sender_user_id: number | null }> {
  const row = await queryFirst<any>(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1').catch(() => null);
  return {
    approaching_hours: row?.approaching_hours ?? 48,
    diligence_gap_days: row?.diligence_gap_days ?? 3,
    unassigned_window_hours: row?.unassigned_window_hours ?? 72,
    renotify_hours: row?.renotify_hours ?? 24,
    notify_supervisor_email: row?.notify_supervisor_email ?? 1,
    digest_sender_user_id: row?.digest_sender_user_id ?? null,
  };
}

async function loadOpenJobsWithAttempts(db: ReturnType<typeof getDb>) {
  return query<any>(db,
    `SELECT q.id, q.status, q.officer_id, q.deadline, q.priority, q.sort_order,
            q.defendant_name, q.recipient_name, q.recipient_address, q.case_number,
            (SELECT MAX(a.attempt_at) FROM serve_attempts a WHERE a.serve_queue_id = q.id) AS last_attempt_at
       FROM serve_queue q
      WHERE q.status NOT IN ('served','cancelled','failed')
      ORDER BY q.deadline IS NULL, q.deadline ASC, q.sort_order ASC, q.id ASC
      LIMIT 1000`);
}

sv.get('/assignments/board', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const now = new Date().toISOString();
  const settings = await loadNudgeSettings(db);
  const jobs = await loadOpenJobsWithAttempts(db);
  const officers = await query<any>(db, "SELECT id, full_name FROM users WHERE role IN ('officer','supervisor','manager','admin') ORDER BY full_name LIMIT 200");

  const byOfficer: Record<string, any[]> = {};
  const unassigned: any[] = [];
  const counts: Record<string, number> = {};
  for (const j of jobs) {
    const jobForAttn: ServeJobForAttention = { id: j.id, status: j.status, officer_id: j.officer_id, deadline: j.deadline, last_attempt_at: j.last_attempt_at };
    j.attention = classifyServeJob(jobForAttn, now, settings);
    if (j.officer_id == null) { unassigned.push(j); }
    else { (byOfficer[j.officer_id] ??= []).push(j); counts[j.officer_id] = (counts[j.officer_id] ?? 0) + 1; }
  }
  return c.json({
    officers: officers.map((o) => ({
      id: o.id, name: o.full_name, count: counts[o.id] ?? 0,
      attention: (byOfficer[o.id] ?? []).reduce((acc: any, j: any) => { for (const cnd of j.attention) acc[cnd] = (acc[cnd] ?? 0) + 1; return acc; }, {}),
    })),
    unassigned, byOfficer,
  });
});

sv.post('/assignments/assign', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const b = await c.req.json<any>();
  const jobIds: number[] = Array.isArray(b.job_ids) ? b.job_ids.map((x: any) => parseInt(x, 10)).filter((n: number) => Number.isFinite(n) && n > 0) : [];
  if (!jobIds.length) return c.json({ error: 'job_ids required' }, 400);
  let officerId: number | null = null;
  if (b.officer_id != null) {
    officerId = parseInt(b.officer_id, 10);
    if (!Number.isFinite(officerId) || officerId < 1) return c.json({ error: 'invalid officer_id' }, 400);
    const ok = await queryFirst<any>(db, "SELECT id FROM users WHERE id = ? AND role IN ('officer','supervisor','manager','admin')", officerId);
    if (!ok) return c.json({ error: 'officer_id is not an assignable user' }, 400);
  }
  const user = c.get('user') as { id: number } | undefined;

  const assigned: number[] = [];
  const skipped: number[] = [];
  for (const id of jobIds) {
    const job = await queryFirst<any>(db, 'SELECT id, status, officer_id FROM serve_queue WHERE id = ?', id);
    if (!job) { skipped.push(id); continue; }
    if (['served', 'cancelled', 'failed'].includes(job.status)) { skipped.push(id); continue; }
    const newStatus = officerId == null ? 'pending' : (job.status === 'pending' ? 'assigned' : job.status);
    await execute(db, "UPDATE serve_queue SET officer_id = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?", officerId, newStatus, id);
    await execute(db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'assign', 'serve_assignment', ?, ?)`,
      user?.id ?? null, id, JSON.stringify({ from_officer: job.officer_id, to_officer: officerId, reason: b.reason ?? null }));
    assigned.push(id);
  }
  return c.json({ success: true, assigned, skipped });
});

// POST /assignments/auto-assign-all — batch-assign every unassigned pending
// job to the officer with the fewest open jobs. autoAssignAllUnassigned()
// (utils/serveAutoAssign.ts) has existed since it was built for this exact
// route — the route itself was never registered, so PerformanceTab.tsx's
// "Auto-Assign All Unassigned" button always 404'd.
sv.post('/assignments/auto-assign-all', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const assigned = await autoAssignAllUnassigned(getDb(c.env));
  return c.json({ success: true, assigned });
});

sv.get('/assignments/needs-attention', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const now = new Date().toISOString();
  const settings = await loadNudgeSettings(db);
  const jobs = await loadOpenJobsWithAttempts(db);
  const flagged = jobs.map((j) => ({ ...j, attention: classifyServeJob({ id: j.id, status: j.status, officer_id: j.officer_id, deadline: j.deadline, last_attempt_at: j.last_attempt_at }, now, settings) }))
    .filter((j) => j.attention.length > 0);
  return c.json({ data: flagged });
});

sv.get('/assignments/settings', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const row = await queryFirst(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1');
  return c.json({ data: row ?? {
    id: 1, approaching_hours: 48, diligence_gap_days: 3,
    unassigned_window_hours: 72, renotify_hours: 24,
    notify_supervisor_email: 1, digest_sender_user_id: null,
    mileage_rate: 0.67, business_hours_start: '08:00',
    business_hours_end: '20:00', business_hours_days: '[1,2,3,4,5]',
    auto_geocode_on_intake: 1, geocode_confidence_min: 0.6,
  } });
});

sv.put('/assignments/settings', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const b = await c.req.json<any>();
  const user = c.get('user') as { id: number } | undefined;
  const cur = await queryFirst<any>(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1') ?? {};
  await execute(db,
    `INSERT INTO serve_nudge_settings
       (id, approaching_hours, diligence_gap_days, unassigned_window_hours,
        renotify_hours, notify_supervisor_email, digest_sender_user_id,
        mileage_rate, business_hours_start, business_hours_end,
        business_hours_days, auto_geocode_on_intake, geocode_confidence_min,
        updated_by)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       approaching_hours = excluded.approaching_hours,
       diligence_gap_days = excluded.diligence_gap_days,
       unassigned_window_hours = excluded.unassigned_window_hours,
       renotify_hours = excluded.renotify_hours,
       notify_supervisor_email = excluded.notify_supervisor_email,
       digest_sender_user_id = excluded.digest_sender_user_id,
       mileage_rate = excluded.mileage_rate,
       business_hours_start = excluded.business_hours_start,
       business_hours_end = excluded.business_hours_end,
       business_hours_days = excluded.business_hours_days,
       auto_geocode_on_intake = excluded.auto_geocode_on_intake,
       geocode_confidence_min = excluded.geocode_confidence_min,
       updated_at = datetime('now'),
       updated_by = excluded.updated_by`,
    b.approaching_hours ?? cur.approaching_hours ?? 48,
    b.diligence_gap_days ?? cur.diligence_gap_days ?? 3,
    b.unassigned_window_hours ?? cur.unassigned_window_hours ?? 72,
    b.renotify_hours ?? cur.renotify_hours ?? 24,
    b.notify_supervisor_email !== undefined ? (b.notify_supervisor_email ? 1 : 0) : (cur.notify_supervisor_email ?? 1),
    b.digest_sender_user_id !== undefined ? b.digest_sender_user_id : (cur.digest_sender_user_id ?? null),
    b.mileage_rate ?? cur.mileage_rate ?? 0.67,
    b.business_hours_start ?? cur.business_hours_start ?? '08:00',
    b.business_hours_end ?? cur.business_hours_end ?? '20:00',
    b.business_hours_days !== undefined
      ? (Array.isArray(b.business_hours_days) ? JSON.stringify(b.business_hours_days) : b.business_hours_days)
      : (cur.business_hours_days ?? '[1,2,3,4,5]'),
    b.auto_geocode_on_intake !== undefined ? (b.auto_geocode_on_intake ? 1 : 0) : (cur.auto_geocode_on_intake ?? 1),
    b.geocode_confidence_min ?? cur.geocode_confidence_min ?? 0.6,
    user?.id ?? null);
  await execute(db, `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'update', 'serve_nudge_settings', 1, ?)`, user?.id ?? null, JSON.stringify(b));
  const after = await queryFirst(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1');
  return c.json({ data: after });
});

// POST /preview-ops — live venue / windows / OPS tree from the job form.
// Static path must be registered before /:id so it is never captured as an id.
sv.post('/preview-ops', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const preview = previewServeOps({
    addressClass: typeof body.address_class === 'string' ? body.address_class : null,
    addressClassConfirmed: body.address_class_confirmed === true || body.address_class_confirmed === 1,
    recipient_name: strOrNull(body.recipient_name),
    recipient_address: strOrNull(body.recipient_address),
    recipient_city: strOrNull(body.recipient_city),
    recipient_state: strOrNull(body.recipient_state),
    recipient_zip: strOrNull(body.recipient_zip),
    recipient_type: strOrNull(body.recipient_type),
    business_name: strOrNull(body.business_name),
    registered_agent_name: strOrNull(body.registered_agent_name),
    document_type: strOrNull(body.document_type),
    case_number: strOrNull(body.case_number),
    court_name: strOrNull(body.court_name),
    jurisdiction: strOrNull(body.jurisdiction),
    client_name: strOrNull(body.client_name),
    attorney_name: strOrNull(body.attorney_name),
    priority: strOrNull(body.priority),
    deadline: strOrNull(body.deadline),
    service_instructions: strOrNull(body.service_instructions),
    notes: strOrNull(body.notes),
    plaintiff_name: strOrNull(body.plaintiff_name),
    defendant_name: strOrNull(body.defendant_name),
    court_date: strOrNull(body.court_date),
    ops: (body.ops && typeof body.ops === 'object') ? body.ops as Partial<ServeJobOps> : null,
  });
  return c.json({
    address_class: preview.addressClass,
    address_class_confirmed: preview.addressClassConfirmed,
    venue: preview.venue,
    venue_inferred: preview.venueInferred,
    venue_label: preview.venueLabel,
    windows: preview.windows,
    fired_ids: preview.tree.firedIds,
    fired_count: preview.tree.features.length,
    catalog_size: preview.tree.catalogSize,
    features: preview.tree.features,
    note: preview.note,
    ops: preview.ops,
  });
});

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

sv.get('/', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const status = c.req.query('status');
  const officerId = c.req.query('officer_id');
  const priority = c.req.query('priority');
  const search = c.req.query('q');
  const limit = clampIntParam(c.req.query('limit'), 100, 1, 500);
  const where: string[] = [];
  const args: any[] = [];
  // Every filter column below must be qualified with q. — serve_queue is
  // joined against calls_for_service (cfs), which also has status and
  // priority columns, so an unqualified `status = ?` / `priority = ?` is
  // genuinely ambiguous to SQLite. Confirmed live 2026-08-09: any request
  // with ?status= or ?priority= (and ?q=, which touches the same
  // unqualified-column class) 500'd with "D1_ERROR: ambiguous column name:
  // status" — this endpoint had never been exercised with a filter in
  // production before that.
  if (status) { where.push('q.status = ?'); args.push(status); }
  if (officerId) { where.push('q.officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (priority) { where.push('q.priority = ?'); args.push(priority); }
  if (search) {
    where.push('(q.recipient_name LIKE ? OR q.case_number LIKE ? OR q.recipient_address LIKE ?)');
    const s = `%${search.slice(0, 48)}%`; // D1 LIKE cap: pattern >50 chars silently returns nothing
    args.push(s, s, s);
  }
  // FK reference guards: CASE expressions are re-emitted AFTER q.* so
  // they win on duplicate column names. serve_queue rows can reference
  // hard-deleted records (pre-soft-delete era) or records purged during
  // data cleanup — a dead FK produces a guaranteed downstream error.
  const sql = `SELECT q.*, u.full_name AS officer_name,
      CASE WHEN cfs.id IS NULL THEN NULL ELSE q.call_id END AS call_id,
      CASE WHEN p.id IS NULL THEN NULL ELSE q.recipient_person_id END AS recipient_person_id,
      CASE WHEN prop.id IS NULL THEN NULL ELSE q.property_id END AS property_id,
      cfs.call_number AS linked_call_number,
      cfs.pso_attempt_number AS linked_attempt_number,
      cfs_ext.parent_call_id AS linked_parent_call_id
    FROM serve_queue q
    LEFT JOIN users u ON u.id = q.officer_id
    LEFT JOIN calls_for_service cfs ON cfs.id = q.call_id
    LEFT JOIN calls_for_service_ext cfs_ext ON cfs_ext.id = q.call_id
    LEFT JOIN persons p ON p.id = q.recipient_person_id
    LEFT JOIN properties prop ON prop.id = q.property_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE q.priority WHEN 'urgent' THEN 1 WHEN 'rush' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      q.deadline IS NULL, q.deadline ASC, q.sort_order ASC, q.id DESC LIMIT ?`;
  args.push(limit);
  const jobs = await query<any>(db, sql, ...args);

  // ── Attach attempts per job ────────────────────────────────
  // ServeJobCard renders a "Prior Attempts" timeline when job.attempts is
  // non-empty, but the list endpoint historically only returned serve_queue
  // columns — so the timeline never appeared in the queue view (only in
  // the detail page that hits GET /:id). One follow-up query batches
  // every attempt for the listed jobs and merges them in-process.
  // disposition_code is schema-guarded — migration 0143 may not be live
  // on every D1, in which case we still return the legacy `result` column.
  if (jobs.length) {
    const ids = jobs.map((j) => j.id).filter((n) => Number.isFinite(n));
    if (ids.length) {
      const hasDispositionCol = await columnExists(db, 'serve_attempts', 'disposition_code');
      const attemptCols = hasDispositionCol
        ? 'a.id, a.serve_queue_id, a.attempt_number, a.attempt_at, a.attempt_type, a.result, a.disposition_code, a.notes, a.latitude, a.longitude, a.officer_id, a.photo_ids, u.full_name AS officer_name'
        : 'a.id, a.serve_queue_id, a.attempt_number, a.attempt_at, a.attempt_type, a.result, a.notes, a.latitude, a.longitude, a.officer_id, a.photo_ids, u.full_name AS officer_name';
      // `limit` is caller-supplied and capped at 500, so `ids` routinely exceeds
      // D1's 100-bound-parameter cap — a hand-rolled IN-list 500s the whole
      // queue view the moment a dispatcher asks for more than 100 jobs.
      const attempts = await queryInChunks<any>(
        db,
        ids,
        (placeholders) => `SELECT ${attemptCols}
           FROM serve_attempts a
           LEFT JOIN users u ON u.id = a.officer_id
          WHERE a.serve_queue_id IN (${placeholders})
          ORDER BY a.attempt_at ASC, a.id ASC`,
      );
      const byQueue = new Map<number, any[]>();
      for (const a of attempts) {
        a.photo_ids = (() => { try { return JSON.parse(a.photo_ids || '[]'); } catch { return []; } })();
        const bucket = byQueue.get(a.serve_queue_id) ?? [];
        bucket.push(a);
        byQueue.set(a.serve_queue_id, bucket);
      }
      for (const j of jobs) j.attempts = byQueue.get(j.id) ?? [];

      try {
        const slots = await queryInChunks<{
          queue_id: number; scheduled_date: string; window_start: string; window_end: string;
        }>(
          db,
          ids,
          (placeholders) => `SELECT queue_id, scheduled_date, window_start, window_end
             FROM serve_attempt_schedules
            WHERE dismissed = 0 AND queue_id IN (${placeholders})
            ORDER BY scheduled_date ASC, window_start ASC`,
        );
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
        const nextByQueue = new Map<number, { scheduled_date: string; window_start: string; window_end: string }>();
        for (const slot of slots) {
          if (slot.scheduled_date < today) continue;
          if (!nextByQueue.has(slot.queue_id)) nextByQueue.set(slot.queue_id, slot);
        }
        for (const j of jobs) {
          const slot = nextByQueue.get(j.id);
          if (!slot) continue;
          j.next_attempt_date = slot.scheduled_date;
          j.next_attempt_window = `${slot.window_start}-${slot.window_end}`;
        }
      } catch {
        // Table may be absent on some D1 installs.
      }

      // ── Attach notice scans per job ─────────────────────────────
      // QR "Notice of Attempt to Serve" scan evidence (migration 0189).
      const scans = await queryInChunks<any>(
        db,
        ids,
        (placeholders) => `SELECT id, serve_queue_id, job_ref, scanned_at, ip_address, user_agent,
                geo_city, geo_region, geo_country, geo_lat, geo_lng,
                device_type, device_brand, device_model, os_family,
                browser_family, browser_version, touch_capable, is_proxy, is_bot
           FROM notice_scans
          WHERE serve_queue_id IN (${placeholders})
          ORDER BY scanned_at ASC, id ASC`,
      );
      const scansByQueue = new Map<number, any[]>();
      for (const s of scans) {
        const bucket = scansByQueue.get(s.serve_queue_id) ?? [];
        bucket.push(s);
        scansByQueue.set(s.serve_queue_id, bucket);
      }
      for (const j of jobs) j.scans = scansByQueue.get(j.id) ?? [];
    }
  }
  await attachLearnedDwellSeconds(db, jobs).catch(() => {});
  return c.json(jobs.map(normalizeFees));
});

sv.post('/', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.recipient_name && !body.recipient_address) {
    return c.json({ error: 'recipient_name or recipient_address required' }, 400);
  }
  const priority = PRIORITIES.has(body.priority) ? body.priority : 'normal';
  const status = body.status && STATUSES.has(body.status) ? body.status : 'pending';

  // Backfill geocode when recipient_address is provided but coords are not
  let lat = body.recipient_lat != null ? body.recipient_lat : null;
  let lng = body.recipient_lng != null ? body.recipient_lng : null;
  let geocodeSource: string | null = body.recipient_lat != null ? 'point' : null;
  if ((lat == null || lng == null) && typeof body.recipient_address === 'string' && body.recipient_address.trim().length >= 3) {
    const coords = await geocodeAddress(c.env, body.recipient_address).catch(() => null);
    if (coords) { lat = coords.lat; lng = coords.lng; geocodeSource = coords.geocodeSource; }
  }

  // Schema-guard mig 0237 columns on CREATE too
  const dbPost = getDb(c.env);
  const hasRecipientTypeOnCreate = (
    body.recipient_type != null || body.business_name != null
  ) ? await columnExists(dbPost, 'serve_queue', 'recipient_type') : false;

  const insertCols = [
    'call_id', 'sm_job_id', 'officer_id', 'serve_date',
    'recipient_name', 'recipient_person_id', 'recipient_address', 'recipient_address_2', 'recipient_city',
    'recipient_state', 'recipient_zip', 'recipient_lat', 'recipient_lng', 'property_id',
    'recipient_phone', 'recipient_email', 'recipient_dob',
    'recipient_employer', 'recipient_employer_address',
    'document_type', 'case_number', 'court_name', 'jurisdiction',
    'client_name', 'attorney_name', 'plaintiff_name', 'defendant_name',
    'serve_type', 'case_type', 'return_date', 'co_defendants', 'relationship',
    'priority', 'time_window', 'deadline',
    'max_attempts', 'service_instructions', 'notes', 'status', 'contract_id',
    'serve_fee', 'rush_fee', 'payment_status',
    'diligence_required', 'contact_restrictions', 'building_access_notes',
    'court_date', 'document_text',
  ];
  const insertVals: any[] = [
    body.call_id ?? null, body.sm_job_id ?? null, body.officer_id ?? null, body.serve_date ?? null,
    body.recipient_name ?? null, body.recipient_person_id ?? null, body.recipient_address ?? null, body.recipient_address_2 ?? null, body.recipient_city ?? null,
    body.recipient_state ?? null, body.recipient_zip ?? null, lat, lng, body.property_id ?? null,
    body.recipient_phone ?? null, body.recipient_email ?? null, body.recipient_dob ?? null,
    body.recipient_employer ?? null, body.recipient_employer_address ?? null,
    body.document_type ?? null, body.case_number ?? null, body.court_name ?? null, body.jurisdiction ?? null,
    body.client_name ?? null, body.attorney_name ?? null, body.plaintiff_name ?? null, body.defendant_name ?? null,
    body.serve_type ?? 'personal', body.case_type ?? null, body.return_date ?? null, body.co_defendants ?? null, body.relationship ?? null,
    priority, body.time_window ?? null, body.deadline ?? null,
    body.max_attempts ?? 3, body.service_instructions ?? null, body.notes ?? null, status, body.contract_id ?? null,
    body.serve_fee ?? null, body.rush_fee ?? null, body.payment_status ?? 'unpaid',
    body.diligence_required ? 1 : 0, body.contact_restrictions ?? null, body.building_access_notes ?? null,
    body.court_date ?? null, body.document_text ?? null,
  ];
  if (hasRecipientTypeOnCreate) {
    insertCols.push(
      'recipient_type', 'business_name', 'business_dba', 'business_ein',
      'business_sos_filing', 'business_state_of_inc', 'registered_agent_name',
      'registered_agent_title', 'registered_office_address',
    );
    insertVals.push(
      body.recipient_type ?? null, body.business_name ?? null, body.business_dba ?? null,
      body.business_ein ?? null, body.business_sos_filing ?? null, body.business_state_of_inc ?? null,
      body.registered_agent_name ?? null, body.registered_agent_title ?? null,
      body.registered_office_address ?? null,
    );
  }
  if (await columnExists(dbPost, 'serve_queue', 'attorney_phone')) {
    insertCols.push('attorney_phone', 'attorney_email', 'attorney_bar_number');
    insertVals.push(body.attorney_phone ?? null, body.attorney_email ?? null, body.attorney_bar_number ?? null);
  }
  if (geocodeSource && await columnExists(dbPost, 'serve_queue', 'geocode_source')) {
    insertCols.push('geocode_source');
    insertVals.push(geocodeSource);
  }
  const placeholders = insertVals.map(() => '?').join(',');
  const r = await execute(
    dbPost,
    `INSERT INTO serve_queue (${insertCols.join(', ')}) VALUES (${placeholders})`,
    ...insertVals,
  );
  const newId = r.meta.last_row_id;
  if (newId && (body.ops || body.address_class)) {
    await persistJobOps(dbPost, Number(newId), body).catch(() => {});
  }
  return c.json({ success: true, id: newId }, 201);
});

// ── Bulk status update ────────────────────────────────────────────────────────
// PUT /serve/bulk-status { ids: number[], status: string }
// Lets dispatchers batch-move selected jobs between folders (Queue → Archive, etc.)
sv.put('/bulk-status', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<{ ids?: number[]; status?: string }>();
  const { ids, status } = body;
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'ids required' }, 400);
  const VALID = ['pending', 'in_progress', 'served', 'failed', 'archived'] as const;
  if (!status || !(VALID as readonly string[]).includes(status)) {
    return c.json({ error: `status must be one of: ${VALID.join(', ')}` }, 400);
  }
  const db = getDb(c.env);
  const closedAt = (status === 'served' || status === 'failed')
    ? `datetime('now')`
    : 'NULL';
  // D1 doesn't support array bindings — use a parameterized IN clause, chunked
  // under the 100-bound-parameter cap. `ids` comes straight from the request
  // body (ServeBulkActions' "select all" sends the whole visible folder), and
  // `status` is bound ahead of the list, so it must be reserved out of the
  // budget or a 100-id batch would land at 101 parameters and throw at bind
  // time. NOTE: chunked writes are not atomic — a mid-batch failure leaves
  // earlier chunks committed, which is the same best-effort posture the
  // billing call below already assumes.
  await executeInChunks(
    db,
    ids,
    (placeholders) => `UPDATE serve_queue SET status = ?, closed_at = ${closedAt}
     WHERE id IN (${placeholders})`,
    [status],
  );

  // Bill served jobs — every other path to status='served' (single-attempt
  // logAttempt, the substitute-service shortcut) calls generateServeCharges;
  // this bulk path updated status directly and skipped it, so batch "Mark
  // Served" silently never billed. Best-effort like the other call sites —
  // generateServeCharges swallows its own errors so a billing hiccup can't
  // break the status update that already committed.
  if (status === 'served') {
    for (const id of ids) {
      await generateServeCharges(db, id).catch(() => {});
    }
  }

  // Fire-and-forget: sync terminal outcomes back to their originating CFS rows
  if (status === 'served' || status === 'failed') {
    const affected = await queryInChunks<{ id: number }>(
      db,
      ids,
      (placeholders) => `SELECT id FROM serve_queue WHERE id IN (${placeholders}) AND call_id IS NOT NULL`,
    );
    for (const q of affected) {
      syncServeCompletionToCfs(db, q.id).catch((e: unknown) => log.error('syncServeCompletionToCfs failed', { queueId: q.id }, e instanceof Error ? e : new Error(String(e))));
    }
  }

  return c.json({ updated: ids.length, status });
});

// ── Folder stats ──────────────────────────────────────────────────────────────
// GET /serve/folder-stats?date=YYYY-MM-DD
sv.get('/folder-stats', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const db = getDb(c.env);
  const rows = await query<{ status: string; cnt: number }>(
    db,
    `SELECT status, COUNT(*) AS cnt FROM serve_queue
     WHERE DATE(created_at, '-7 hours') = ? OR DATE(serve_date) = ?
     GROUP BY status`,
    date, date,
  );
  const stats: Record<string, number> = {};
  for (const r of rows) stats[r.status] = r.cnt;
  return c.json({ date, stats });
});

// GET /aging must be registered BEFORE /:id — Hono matches in order, so
// "/aging" would match /:id first (parseInt("aging") → NaN → 400).
sv.get('/aging', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(db, `
    SELECT q.id, q.recipient_name, q.recipient_address, q.deadline, q.priority,
           q.status, q.attempt_count, q.officer_id,
           u.full_name AS officer_name,
           MAX(a.attempt_at) AS last_attempt_at,
           CAST(julianday(q.deadline) - julianday('now') AS INTEGER) AS days_remaining
    FROM serve_queue q
    LEFT JOIN users u   ON u.id = q.officer_id
    LEFT JOIN serve_attempts a ON a.serve_queue_id = q.id
    WHERE q.status NOT IN ('served', 'failed', 'cancelled')
      AND q.deadline IS NOT NULL
      AND julianday(q.deadline) - julianday('now') <= 5
    GROUP BY q.id
    HAVING last_attempt_at IS NULL
        OR (julianday('now') - julianday(last_attempt_at)) >= COALESCE(
             (SELECT diligence_gap_days FROM serve_nudge_settings WHERE id = 1 LIMIT 1), 3)
    ORDER BY days_remaining ASC
    LIMIT 200
  `);
  return c.json(rows);
});

// GET /upcoming — must be before /:id (Hono matches in registration order)
sv.get('/upcoming', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(db, `
    SELECT q.id, q.recipient_name, q.recipient_address, q.deadline, q.priority,
           q.status, q.attempt_count, q.officer_id, u.full_name AS officer_name,
           q.next_attempt_note
    FROM serve_queue q
    LEFT JOIN users u ON u.id = q.officer_id
    WHERE q.status NOT IN ('served', 'failed', 'cancelled')
      AND q.next_attempt_note IS NOT NULL AND q.next_attempt_note != ''
    ORDER BY q.deadline ASC NULLS LAST, q.priority DESC
    LIMIT 200
  `);
  return c.json(rows);
});

// GET /client-breakdown — must be before /:id (same reason as above)
sv.get('/client-breakdown', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(db, `
    SELECT
      COALESCE(NULLIF(client_name, ''), NULLIF(attorney_name, ''), 'Unknown Client') AS client,
      COUNT(*)                                                                        AS total,
      SUM(CASE WHEN status = 'served'    THEN 1 ELSE 0 END)                          AS served,
      SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END)                          AS failed,
      SUM(CASE WHEN status NOT IN ('served','failed','cancelled') THEN 1 ELSE 0 END) AS active
    FROM serve_queue
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 50
  `);
  return c.json(rows);
});

sv.get('/:id', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<any>(
    db,
    `SELECT q.*, u.full_name AS officer_name
       FROM serve_queue q LEFT JOIN users u ON u.id = q.officer_id WHERE q.id = ?`,
    id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  const attempts = (await query(
    db,
    `SELECT a.*, u.full_name AS officer_name
       FROM serve_attempts a LEFT JOIN users u ON u.id = a.officer_id
       WHERE a.serve_queue_id = ? ORDER BY a.attempt_at DESC`,
    id,
  )).map((a: any) => ({
    ...a,
    photo_ids: (() => { try { return JSON.parse(a.photo_ids || '[]'); } catch { return []; } })(),
  }));
  const scans = await query(
    db,
    `SELECT id, serve_queue_id, job_ref, scanned_at, ip_address, user_agent,
            geo_city, geo_region, geo_country, geo_lat, geo_lng,
            device_type, device_brand, device_model, os_family,
            browser_family, browser_version, touch_capable, is_proxy, is_bot
       FROM notice_scans WHERE serve_queue_id = ? ORDER BY scanned_at DESC`,
    id,
  );
  const skipTraceRows = await query(
    db,
    `SELECT * FROM serve_skip_traces WHERE serve_queue_id = ? ORDER BY created_at DESC`,
    id,
  ).catch(() => [] as Record<string, unknown>[]);
  const skipTraces = (skipTraceRows as Record<string, unknown>[]).map(row => {
    let addresses_found: unknown[] = [];
    const raw = row.addresses_found_json;
    if (typeof raw === 'string' && raw.trim()) {
      try { addresses_found = JSON.parse(raw); } catch { addresses_found = []; }
    }
    const { addresses_found_json: _drop, ...rest } = row;
    return { ...rest, addresses_found };
  });
  return c.json(normalizeFees({ ...row, attempts, scans, skipTraces }));
});

// ── Serve audit trail ──────────────────────────────────────────
// GET /serve/:id/audit
// Returns activity_log entries for this serve queue (assignments,
// attempt deletions, renumbering events).
sv.get('/:id/audit', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const queueIdStr = String(id);
  const rows = await query<any>(
    db,
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, u.full_name AS user_name
     FROM activity_log a LEFT JOIN users u ON a.user_id = u.id
     WHERE (a.entity_type = 'serve_assignment' AND a.entity_id = ?)
        OR (a.entity_type = 'serve_attempt' AND (a.details LIKE ? OR a.details LIKE ?))
        OR (a.entity_type = 'serve_attempts' AND a.entity_id = ?)
     ORDER BY a.id DESC LIMIT 500`,
    id, `%"serve_queue_id":${queueIdStr},%`, `%"serve_queue_id":${queueIdStr}}%`, id,
  );
  return c.json(rows);
});

sv.put('/:id', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const allowed = [
    'call_id', 'sm_job_id', 'officer_id', 'serve_date',
    'recipient_name', 'recipient_person_id', 'recipient_address', 'recipient_address_2', 'recipient_city',
    'recipient_state', 'recipient_zip', 'recipient_lat', 'recipient_lng', 'property_id',
    'recipient_phone', 'recipient_email', 'recipient_dob',
    'recipient_employer', 'recipient_employer_address',
    'document_type', 'case_number', 'court_name', 'jurisdiction',
    'client_name', 'attorney_name', 'attorney_phone', 'attorney_email', 'attorney_bar_number',
    'plaintiff_name', 'defendant_name',
    'serve_type', 'case_type', 'return_date', 'co_defendants', 'relationship',
    'priority', 'time_window', 'deadline',
    'max_attempts', 'service_instructions', 'notes', 'status', 'sort_order', 'contract_id',
    'next_attempt_note', 'urgency_tier',
    'serve_fee', 'rush_fee', 'payment_status',
    'diligence_required', 'mileage_actual', 'contact_restrictions', 'building_access_notes',
    'court_date', 'document_text',
    'recipient_type',
    'business_name', 'business_dba', 'business_ein', 'business_sos_filing',
    'business_state_of_inc', 'registered_agent_name', 'registered_agent_title',
    'registered_office_address',
  ];
  const sets: string[] = [];
  const args: any[] = [];
  const db = getDb(c.env);
  // Schema-guard newly-added columns so the route doesn't 500 when callers
  // post next_attempt_note before migration 0142 reaches live D1.
  const hasNextAttemptCol = 'next_attempt_note' in body
    ? await columnExists(db, 'serve_queue', 'next_attempt_note')
    : true;
  // Schema-guard mig 0237 recipient-type columns
  const hasRecipientTypeCol = 'recipient_type' in body || body.business_name != null
    ? await columnExists(db, 'serve_queue', 'recipient_type')
    : true;
  const RECIPIENT_TYPE_COLS = new Set([
    'recipient_type', 'business_name', 'business_dba', 'business_ein',
    'business_sos_filing', 'business_state_of_inc', 'registered_agent_name',
    'registered_agent_title', 'registered_office_address',
  ]);
  const hasAttorneyContactCol = (
    'attorney_phone' in body || 'attorney_email' in body || 'attorney_bar_number' in body
  ) ? await columnExists(db, 'serve_queue', 'attorney_phone') : true;
  const ATTORNEY_CONTACT_COLS = new Set(['attorney_phone', 'attorney_email', 'attorney_bar_number']);
  for (const k of allowed) {
    if (!(k in body)) continue;
    if (k === 'status' && body[k] && !STATUSES.has(body[k])) continue;
    if (k === 'priority' && body[k] && !PRIORITIES.has(body[k])) continue; // skip invalid (CHECK enum)
    if (k === 'urgency_tier') {
      if (body[k] && URGENCY_TIERS.has(body[k])) {
        sets.push('urgency_tier = ?');
        args.push(body[k]);
      }
      continue;
    }
    if (k === 'next_attempt_note' && !hasNextAttemptCol) continue;
    if (RECIPIENT_TYPE_COLS.has(k) && !hasRecipientTypeCol) continue;
    if (ATTORNEY_CONTACT_COLS.has(k) && !hasAttorneyContactCol) continue;
    sets.push(`${k} = ?`);
    args.push(body[k]);
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM serve_queue WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // Re-geocode when recipient_address is updated but coords are not explicitly set.
  // Clear stale pins when geocode fails so the map does not keep the old location.
  if ('recipient_address' in body && body.recipient_lat === undefined && body.recipient_lng === undefined
      && typeof body.recipient_address === 'string' && body.recipient_address.trim().length >= 3) {
    const fullLine = [
      body.recipient_address,
      body.recipient_city,
      body.recipient_state,
      body.recipient_zip,
    ].filter(v => typeof v === 'string' && v.trim()).join(', ');
    const coords = await geocodeAddress(c.env, fullLine || body.recipient_address).catch(() => null);
    if (coords) {
      sets.push('recipient_lat = ?', 'recipient_lng = ?');
      args.push(coords.lat, coords.lng);
      if (await columnExists(getDb(c.env), 'serve_queue', 'geocode_source')) {
        sets.push('geocode_source = ?');
        args.push(coords.geocodeSource);
      }
    } else {
      sets.push('recipient_lat = NULL', 'recipient_lng = NULL');
      if (await columnExists(getDb(c.env), 'serve_queue', 'geocode_source')) {
        sets.push('geocode_source = NULL');
      }
    }
  }

  sets.push("updated_at = datetime('now')");
  // Stamp closed_at when an operator explicitly marks the job served —
  // write-once: only set when transitioning to 'served' (not on every edit).
  if (body.status === 'served') {
    sets.push("closed_at = COALESCE(closed_at, datetime('now'))");
  }
  args.push(id);
  await execute(getDb(c.env), `UPDATE serve_queue SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await persistJobOps(getDb(c.env), id, body).catch(() => {});
  // Fire-and-forget: if status was explicitly set to a terminal outcome,
  // sync back to the originating CFS call (if one exists).
  if (body.status === 'served' || body.status === 'failed') {
    syncServeCompletionToCfs(getDb(c.env), id).catch((e: unknown) => log.error('syncServeCompletionToCfs failed', { queueId: id }, e instanceof Error ? e : new Error(String(e))));
  }
  return c.json({ success: true });
});

// PATCH /:id/address-class — operator confirms the serve location's address class
// so the auto-scheduler can apply business-hours windows for genuine corporate offices.
// Updates parsed_data._intake.address_class in-place via json_set; leaves every
// other key in parsed_data untouched.
sv.patch('/:id/address-class', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ klass?: string; confirmed?: boolean }>().catch(() => ({} as { klass?: string; confirmed?: boolean }));
  const VALID_KLASS = new Set([
    'residential', 'business', 'corporate', 'small_business',
    'government', 'gated', 'po_box', 'unknown',
  ]);
  const klass = typeof body.klass === 'string' && VALID_KLASS.has(body.klass) ? body.klass : null;
  const confirmed = typeof body.confirmed === 'boolean' ? body.confirmed : null;
  if (klass === null && confirmed === null) return c.json({ error: 'Provide klass and/or confirmed' }, 400);
  const db = getDb(c.env);
  // json_set creates the path when it does not exist (safe on rows that predate
  // commitIntake, which is all rows without an OCR intake).
  const sets: string[] = ["updated_at = datetime('now')"];
  const args: (string | number | null)[] = [];
  if (klass !== null) {
    sets.push(`parsed_data = json_set(COALESCE(parsed_data, '{}'), '$._intake.address_class.klass', ?)`);
    args.push(klass);
  }
  if (confirmed !== null) {
    sets.push(`parsed_data = json_set(COALESCE(parsed_data, '{}'), '$._intake.address_class.confirmed', ?)`);
    args.push(confirmed ? 1 : 0);
  }
  args.push(id);
  await execute(db, `UPDATE serve_queue SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await persistJobOps(db, id, {
    address_class: klass,
    address_class_confirmed: confirmed,
  }).catch(() => {});
  return c.json({ success: true, klass, confirmed });
});

// PATCH /:id/ops — scene/packet fields + rebuild venue/windows/tree in parsed_data.
sv.patch('/:id/ops', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const db = getDb(c.env);
  const preview = await persistJobOps(db, id, body);
  if (!preview) return c.json({ error: 'Not found' }, 404);
  if (typeof body.court_date === 'string' && await columnExists(db, 'serve_queue', 'court_date')) {
    await execute(db, `UPDATE serve_queue SET court_date = ?, updated_at = datetime(\'now\') WHERE id = ?`, body.court_date || null, id);
  }
  return c.json({
    success: true,
    venue: preview.venue,
    venue_label: preview.venueLabel,
    windows: preview.windows,
    fired_ids: preview.tree.firedIds,
    note: preview.note,
    ops: preview.ops,
  });
});

// ─────────────────────────────────────────────────────────────
// Attempts — richer than the intake variant (gps + photo refs)
// ─────────────────────────────────────────────────────────────

/**
 * Normalize a device-stamped attempt time into the naive-UTC storage format.
 *
 * The officer's device is the authority on WHEN an attempt happened: the
 * column default stamps at request-receipt, which is the moment the POST
 * reaches us, not the moment the officer stood at the door. Those diverge
 * whenever the request is delayed — a dead zone at the address, a queued
 * offline submit, a slow upload behind photo/signature payloads. The client
 * sends `new Date().toISOString()`, which resolves the device clock through
 * the device's own timezone, so the instant is already unambiguous by the
 * time it reaches us and needs no offset math here.
 *
 * Returns null (→ fall back to the column default) when the value is absent,
 * unparseable, or fails the skew guards below. A wrong clock on a Toughbook
 * would otherwise print a false time onto a legal notice, so an implausible
 * device stamp is discarded in favor of server time rather than trusted.
 */
export function deviceAttemptAt(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const now = Date.now();
  // Future stamps are never legitimate — an attempt cannot happen after it is
  // reported. Allow 5 min for benign clock drift, reject beyond that.
  if (ms > now + 5 * 60_000) return null;
  // A stamp older than 30 days on a fresh POST means a badly wrong clock, not
  // a genuinely delayed sync; offline queues drain in hours, not weeks.
  if (ms < now - 30 * 24 * 60 * 60_000) return null;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

async function logAttempt(c: Context<Env>, defaultResult: string) {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as any;
  const user = c.get('user') as { id: number; role: string } | undefined;
  const db = getDb(c.env);

  const queue = await queryFirst<{
    attempt_count: number; max_attempts: number; status: string;
    officer_id: number | null; call_id: number | null;
    recipient_name: string | null; case_number: string | null;
    recipient_address: string | null; recipient_type: string | null;
  }>(
    db, 'SELECT attempt_count, max_attempts, status, officer_id, call_id, recipient_name, case_number, recipient_address, recipient_type FROM serve_queue WHERE id = ?', id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);

  // Officers can only log attempts on jobs assigned to them.
  if (user?.role === 'officer' && queue.officer_id !== user.id) {
    return c.json({ error: 'Not assigned to this job' }, 403);
  }

  const actorId = user?.id ?? null;
  if (user?.role === 'officer' && actorId) {
    const duty = await requireOnDutyForServe(db, actorId);
    if (!duty.on_duty) {
      return c.json({ error: 'Clock in before logging a serve attempt', code: 'NOT_ON_DUTY' }, 409);
    }
  }
  const attemptOfficerId = user?.role === 'officer' ? user.id : (body.officer_id ?? user?.id ?? null);

  // Structured PS code (PS/15.05 etc.) is the new source of truth. When
  // supplied, it derives both the legacy `result` enum (for the existing
  // CHECK constraint) and the next queue status. When absent, fall back to
  // whatever the caller passed in `result` (legacy path).
  const coercedResult = coerceAttemptResult(body.result, defaultResult, ATTEMPT_RESULTS);
  let psCode = typeof body.disposition_code === 'string' && lookupPsoCode(body.disposition_code)
    ? body.disposition_code.trim().toUpperCase()
    : null;
  if (!psCode) {
    const inferred = defaultPsCodeForResult(coercedResult);
    if (inferred && lookupPsoCode(inferred)) psCode = inferred;
  }
  const result = psCode
    ? codeToLegacyResult(psCode)
    : coercedResult;
  const nextNum = (queue.attempt_count ?? 0) + 1;

  // Live serve_attempts has no `status` column (migration 0030 drift —
  // never applied to 785de7ae). It's redundant with `result` + the
  // serve_queue.status update below, so omit it. See
  // [[feedback-verify-live-schema-before-insert]].
  // Guard the disposition_code write — migration 0143 may not have reached
  // live D1 when a new client deploys (deploy step is continue-on-error).
  const hasDispositionCol = psCode
    ? await columnExists(db, 'serve_attempts', 'disposition_code')
    : false;
  // Device-stamped attempt time. COALESCE(?, datetime('now')) keeps the
  // server clock as the fallback when the device sent nothing usable, so the
  // column is never null and behavior is unchanged for older clients.
  const stampedAt = deviceAttemptAt(body.attempt_at);

  const ins = hasDispositionCol
    ? await execute(
        db,
        `INSERT INTO serve_attempts (
           serve_queue_id, attempt_number, officer_id, result, disposition_code,
           latitude, longitude, notes, attempt_type, photo_ids, signature_data,
           attempt_at
         ) VALUES (?,?,?,?,?, ?,?,?,?, ?,?, COALESCE(?, datetime('now')))`,
        id, nextNum, attemptOfficerId, result, psCode,
        body.latitude ?? null, body.longitude ?? null, body.notes ?? null,
        body.attempt_type ?? null,
        JSON.stringify(body.photo_ids ?? []), body.signature_data ?? null,
        stampedAt,
      )
    : await execute(
        db,
        `INSERT INTO serve_attempts (
           serve_queue_id, attempt_number, officer_id, result,
           latitude, longitude, notes, attempt_type, photo_ids, signature_data,
           attempt_at
         ) VALUES (?,?,?,?, ?,?,?,?, ?,?, COALESCE(?, datetime('now')))`,
        id, nextNum, attemptOfficerId, result,
        body.latitude ?? null, body.longitude ?? null, body.notes ?? null,
        body.attempt_type ?? null,
        JSON.stringify(body.photo_ids ?? []), body.signature_data ?? null,
        stampedAt,
      );

  const loggedAttemptId = Number(ins.meta.last_row_id) || 0;
  if (loggedAttemptId > 0) {
    await linkServeAttemptToShift(db, loggedAttemptId, attemptOfficerId != null ? Number(attemptOfficerId) : null).catch(() => {});
    const catalogItems: CatalogFileInput[] = [];
    const photoIds = Array.isArray(body.photo_ids)
      ? body.photo_ids.filter((fid: unknown) => typeof fid === 'string' && fid.length > 0)
      : [];
    for (const fileId of photoIds) {
      catalogItems.push({
        file_id: fileId,
        kind: 'photo',
        document_type: 'door_photo',
        uploaded_by: body.officer_id ?? user?.id ?? null,
      });
    }
    if (Array.isArray(body.evidence_files)) {
      for (const row of body.evidence_files) {
        if (!row || typeof row.file_id !== 'string' || !row.file_id) continue;
        catalogItems.push({
          file_id: row.file_id,
          kind: row.kind,
          title: row.title,
          description: row.description,
          document_type: row.document_type,
          copies: row.copies,
          original_name: row.original_name,
          mime_type: row.mime_type,
          file_size: row.file_size,
          uploaded_by: body.officer_id ?? user?.id ?? null,
        });
      }
    }
    await catalogServeAttemptFiles(db, id, loggedAttemptId, catalogItems).catch((err) => {
      log.warn('catalogServeAttemptFiles after logAttempt failed', { queueId: id, loggedAttemptId, error: err instanceof Error ? err.message : String(err) });
    });
  }

  // Dwell-time learning — write path. Prefer the device's arrivedAt / arrived_at
  // (web + iOS); fall back to the linked CFS onscene_at so Dispatch Arrive
  // still trains the planner when the wizard never sent an arrival stamp.
  let arrivedAt = parseArrivedAtIso(body as Record<string, unknown>);
  if (!arrivedAt && queue.call_id) {
    const cfs = await queryFirst<{ onscene_at: string | null }>(
      db, 'SELECT onscene_at FROM calls_for_service WHERE id = ?', queue.call_id,
    ).catch(() => null);
    const onsceneMs = parseD1TimestampMs(cfs?.onscene_at);
    if (onsceneMs) arrivedAt = new Date(onsceneMs).toISOString();
  }
  if (arrivedAt) {
    const loggedAt = new Date().toISOString();
    const dwell = dwellSeconds(arrivedAt, loggedAt);
    if (shouldRecordDwell(dwell) && queue.recipient_address && queue.recipient_address.trim() !== '') {
      const addrHash = await hashAddress(queue.recipient_address);
      c.executionCtx.waitUntil(
        c.env.DB.prepare(
          'INSERT INTO serve_dwell_times (address_hash, defendant_type, dwell_seconds) VALUES (?, ?, ?)'
        )
          .bind(addrHash, queue.recipient_type ?? 'individual', dwell)
          .run()
      );
    }
  }

  // Queue status: structured code wins (codeToQueueStatus knows whether a
  // posting counts as completion, whether a sub-service flips the queue,
  // etc.); legacy heuristic keeps the existing behavior for non-coded paths.
  let newStatus = queue.status;
  if (psCode) {
    const codeStatus = codeToQueueStatus(psCode);
    if (codeStatus === 'served' || codeStatus === 'failed') newStatus = codeStatus;
    else if (codeStatus === 'pending') newStatus = 'pending';
    else newStatus = nextNum >= (queue.max_attempts ?? 3) ? 'failed' : 'attempted';
  } else if (result === 'served' || result === 'sub_served') newStatus = 'served';
  else if (nextNum >= (queue.max_attempts ?? 3)) newStatus = 'failed';
  else newStatus = 'attempted';

  // Operator-set next-attempt note lives on the parent queue row so it
  // persists across attempts and survives until the Notice of Attempt PDF
  // reads it. Guard the column write — migration 0142 may not be applied
  // to live D1 yet when the new client deploys (deploy step is
  // continue-on-error per CLAUDE.md).
  const hasNextAttemptCol =
    typeof body.next_attempt_note === 'string'
      ? await columnExists(db, 'serve_queue', 'next_attempt_note')
      : false;
  const closedClause = newStatus === 'served' ? ", closed_at = datetime('now')" : '';
  if (hasNextAttemptCol) {
    await execute(
      db,
      `UPDATE serve_queue SET attempt_count = ?, status = ?, next_attempt_note = ?, updated_at = datetime(\'now\')${closedClause} WHERE id = ?`,
      nextNum, newStatus, body.next_attempt_note || null, id,
    );
  } else {
    await execute(
      db,
      `UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = datetime(\'now\')${closedClause} WHERE id = ?`,
      nextNum, newStatus, id,
    );
  }
  // Best-effort: bill on completion (served or non-est/failed). Must never
  // break the serve write, so failures are swallowed by generateServeCharges.
  if (newStatus === 'served' || newStatus === 'failed') {
    await generateServeCharges(db, id);
    syncServeCompletionToCfs(db, id).catch(() => {});
    notifyServeCompletion(db, id, newStatus).catch(() => {});

    // [F2] Auto-clear the linked CFS call when the job is served. Only
    // transitions calls that are still open — never re-opens a cleared call.
    if (newStatus === 'served' && queue.call_id) {
      execute(db,
        `UPDATE calls_for_service SET status = 'cleared', cleared_at = datetime(\'now\'),
         ${STAMP_ONSCENE_DURATION_SQL}, updated_at = datetime('now')
         WHERE id = ? AND status NOT IN ('cleared','archived')`,
        queue.call_id,
      ).then(async (r) => {
        if ((r as any).meta?.changes > 0) {
          // Fetch the updated row so DispatchPage can merge it in-place.
          const updatedCall = await db.prepare('SELECT id, status, cleared_at FROM calls_for_service WHERE id = ?')
            .bind(queue.call_id).first<{ id: number; status: string; cleared_at: string | null }>();
          broadcastAll('dispatch_update', {
            action: 'call_status_changed',
            call: updatedCall ?? { id: queue.call_id, status: 'cleared' },
          });
        }
      }).catch(() => {});
    }

    // [F5] Alert dispatchers when a serve job reaches a terminal outcome.
    broadcastAll('dispatch_update', {
      action: newStatus === 'served' ? 'serve_completed' : 'serve_failed',
      queue_id: id,
      call_id: queue.call_id ?? null,
      recipient_name: queue.recipient_name ?? null,
      case_number: queue.case_number ?? null,
      attempt_count: nextNum,
    });

    // [F3] Restore PSO officer unit to available on terminal status so they
    // show as free in the dispatch units panel.
    if (user?.id) {
      restoreServeOfficerUnit(db, user.id, queue.call_id).then(() => {
        broadcastAll('dispatch_update', { action: 'unit_status_changed', officer_id: user!.id, status: 'available' });
      }).catch(() => {});
    }
  } else if (user?.id) {
    // After a logged attempt the officer is rolling to the next stop —
    // leaving them 'onscene' jammed Dispatch while they still had more papers.
    restoreServeOfficerUnit(db, user.id, queue.call_id).then(() => {
      broadcastAll('dispatch_update', { action: 'unit_status_changed', officer_id: user!.id, status: 'available' });
    }).catch(() => {});
    if (queue.call_id) {
      execute(db,
        `UPDATE calls_for_service SET ${STAMP_ONSCENE_DURATION_SQL}, updated_at = datetime(\'now\')
         WHERE id = ? AND onscene_at IS NOT NULL`,
        queue.call_id,
      ).catch(() => {});
    }
  }

  // [12a] Live dispatch sync — broadcast over WebSocket so ServePage / DispatchPage
  // consumers subscribed to 'process-server' receive a push without polling.
  // useLiveSync in the client already wires up this module; until now the server
  // never emitted it. Fire-and-forget: WS delivery is best-effort.
  broadcastAll('data_changed', {
    module: 'process-server',
    entity: 'serve_queue',
    id,
    status: newStatus,
    attempt: nextNum,
  });

  // [12b] CFS timeline entry — if this job is linked to a call, write a
  // call_notes row so dispatchers see serve activity in the call's history
  // alongside radio notes and status changes.
  if (queue.call_id) {
    const attemptLabel = toDisplayLabel(result);
    const caseRef = queue.case_number ? ` (${queue.case_number})` : '';
    const recipientRef = queue.recipient_name ? ` for ${queue.recipient_name}` : '';
    const noteText = [
      `[Process Server] Attempt ${nextNum}${caseRef}${recipientRef}: ${attemptLabel}`,
      body.notes ? String(body.notes).slice(0, 200) : null,
    ].filter(Boolean).join(' — ');
    execute(db,
      `INSERT INTO call_notes (call_id, user_id, note, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      queue.call_id, user?.id ?? null, noteText,
    ).catch(() => {});
  }

  // [11] GPS proximity soft-warning — non-blocking. If the client sent GPS
  // coordinates, check them against the linked CFS call's coordinates.
  // A mismatch > 400 m is included in the response as a flag so the mobile UI
  // can surface a confirmation banner without blocking the attempt write.
  let proximityWarning: boolean | null = null;
  if (body.latitude != null && body.longitude != null) {
    const cfsCoords = await queryFirst<{ latitude: number | null; longitude: number | null }>(db,
      `SELECT c.latitude, c.longitude
       FROM calls_for_service c
       JOIN serve_queue q ON q.call_id = c.id
       WHERE q.id = ?`,
      id,
    ).catch(() => null);
    if (cfsCoords?.latitude != null && cfsCoords?.longitude != null) {
      // Haversine distance in meters (approximate flat-earth for distances < 50 km)
      const R = 6_371_000;
      const dLat = (body.latitude - cfsCoords.latitude) * (Math.PI / 180);
      const dLon = (body.longitude - cfsCoords.longitude) * (Math.PI / 180);
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos(cfsCoords.latitude * (Math.PI / 180))
        * Math.cos(body.latitude * (Math.PI / 180))
        * Math.sin(dLon / 2) ** 2;
      const distanceM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      proximityWarning = distanceM > 400;
    }
  }

  // [13] Consecutive non-service streak — after a non-served attempt, count
  // how many of the most recent consecutive attempts also failed to make contact.
  // At 5+ in a row, insert a system comment so supervisors see it in the thread.
  // Fetch enough rows so a streak longer than the window is not silently capped.
  // nextNum is the attempt count after this insert, so fetch nextNum rows —
  // the true streak cannot exceed the total number of attempts.
  if (newStatus !== 'served' && newStatus !== 'failed') {
    const fetchLimit = Math.max(nextNum, 10);
    const recentResults = await query<{ result: string }>(db,
      `SELECT result FROM serve_attempts WHERE serve_queue_id = ?
       ORDER BY attempt_number DESC LIMIT ?`,
      id, fetchLimit,
    ).catch(() => [] as { result: string }[]);
    const streak = recentResults.findIndex((r) =>
      r.result === 'served' || r.result === 'sub_served',
    );
    const streakCount = streak === -1 ? recentResults.length : streak;
    if (streakCount >= 5) {
      execute(db,
        `INSERT OR IGNORE INTO serve_job_comments
           (serve_queue_id, author_name, author_role, body, is_system)
         VALUES (?, 'System', 'system', ?, 1)`,
        id,
        `⚠ ${streakCount} consecutive non-service attempts. Supervisor review recommended.`,
      ).catch(() => {});
    }
  }

  if (newStatus !== 'served' && newStatus !== 'failed') {
    const attemptAtIso = stampedAt || new Date().toISOString();
    c.executionCtx.waitUntil(
      scheduleNextServeAttempt(
        db,
        id,
        Number(ins.meta.last_row_id) || 0,
        result,
        attemptAtIso,
        typeof body.window === 'string' ? body.window : null,
      ).then((replan) => {
        if (!replan) return;
        broadcastAll('data_changed', {
          module: 'serve-schedule',
          entity: 'slot',
          action: 'created',
          slot_id: replan.slot_id,
          queue_id: id,
        });
      }).catch(() => {}),
    );
  }

  return c.json({
    success: true,
    id: ins.meta.last_row_id,
    attempt_number: nextNum,
    queue_status: newStatus,
    // attempt_threshold_reached: true when the attempt count reaches max_attempts.
    // This is a count-only heuristic — NOT a legal diligence certification.
    // Full Rule 4(d) diligence requires time separation and time-of-day variation
    // that only the client-side assessDiligence() can evaluate. Keep the old
    // `due_diligence_complete` key as a count-threshold alias so ServeAttemptModal
    // still offers the non-service affidavit shortcut.
    attempt_threshold_reached: nextNum >= (queue.max_attempts ?? 3),
    due_diligence_complete: nextNum >= (queue.max_attempts ?? 3),
    proximity_warning: proximityWarning,
  });
}

sv.post('/:id/attempt', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  return logAttempt(c, 'other');
});

// Substitute service shortcut: forces result='sub_served', sets attempt_type='substitute'
sv.post('/:id/substitute-service', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  // Clone request with overrides — Hono's c.req.json() consumes the body once,
  // so we read it here and re-attach via a synthesized handler.
  const body = await c.req.json<any>().catch(() => ({}));
  body.result = 'sub_served';
  body.attempt_type = body.attempt_type ?? 'substitute';
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user') as { id: number; role?: string } | undefined;
  const db = getDb(c.env);
  const queue = await queryFirst<{ attempt_count: number; max_attempts: number; call_id: number | null; officer_id: number | null }>(
    db, 'SELECT attempt_count, max_attempts, call_id, officer_id FROM serve_queue WHERE id = ?', id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);
  if (user?.role === 'officer' && queue.officer_id != null && queue.officer_id !== user.id) {
    return c.json({ error: 'Not assigned to this job' }, 403);
  }
  const nextNum = (queue.attempt_count ?? 0) + 1;
  const officerForAttempt = user?.id ?? body.officer_id ?? null;
  if (user?.role === 'officer' && officerForAttempt) {
    const duty = await requireOnDutyForServe(db, Number(officerForAttempt));
    if (!duty.on_duty) {
      return c.json({ error: 'Clock in before logging a serve attempt', code: 'NOT_ON_DUTY' }, 409);
    }
  }
  // No `status` column on live serve_attempts (see logAttempt note above).
  const ins = await execute(
    db,
    `INSERT INTO serve_attempts (
       serve_queue_id, attempt_number, officer_id, result,
       latitude, longitude, notes, attempt_type, photo_ids, signature_data,
       attempt_at
     ) VALUES (?,?,?, 'sub_served', ?,?,?, ?, ?,?, COALESCE(?, datetime('now')))`,
    id, nextNum, officerForAttempt,
    body.latitude ?? null, body.longitude ?? null, body.notes ?? null,
    body.attempt_type, JSON.stringify(body.photo_ids ?? []), body.signature_data ?? null,
    deviceAttemptAt(body.attempt_at),
  );
  await linkServeAttemptToShift(db, Number(ins.meta.last_row_id) || 0, officerForAttempt != null ? Number(officerForAttempt) : null).catch(() => {});
  await execute(
    db,
    `UPDATE serve_queue SET attempt_count = ?, status = 'served', updated_at = datetime(\'now\'), closed_at = datetime(\'now\') WHERE id = ?`,
    nextNum, id,
  );
  // generateServeCharges must never surface a billing failure as an HTTP 500
  // on the attempt POST — the DB writes for the attempt already committed and
  // cannot be rolled back. Swallow failures the same way logAttempt does.
  await generateServeCharges(db, id).catch(() => {});
  syncServeCompletionToCfs(db, id).catch(() => {});
  notifyServeCompletion(db, id, 'served').catch(() => {});

  // Notify dispatchers and restore officer unit status — mirroring logAttempt's
  // terminal-completion path so substitute-service is not invisible to dispatch.
  broadcastAll('dispatch_update', {
    action: 'serve_completed',
    queue_id: id,
    attempt_count: nextNum,
  });
  if (user?.id) {
    restoreServeOfficerUnit(db, user.id, queue.call_id).then(() => {
      broadcastAll('dispatch_update', { action: 'unit_status_changed', officer_id: user.id, status: 'available' });
    }).catch(() => {});
  }

  return c.json({ success: true, id: ins.meta.last_row_id, attempt_number: nextNum });
});

// ─────────────────────────────────────────────────────────────
// Edit an existing attempt
// ─────────────────────────────────────────────────────────────
// PUT /:queueId/attempt/:attemptId
//
// Operator corrections to a previously-logged attempt: timestamp typos,
// wrong attempt_type, wrong result/disposition_code picked, follow-up
// notes. Photo/signature/officer_id stay immutable — those are evidence.
//
// Status side-effect: if the edit changes result or disposition_code,
// re-derive serve_queue.status from the most-recent attempt (per the
// 2026-06-22 product decision). Edits to notes/timestamp/type alone
// don't touch parent state. Billing is NOT reversed — generateServeCharges
// is one-way; a wrongly-billed completion needs a manual credit.
sv.put('/:queueId/attempt/:attemptId', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const queueId = parseInt(c.req.param('queueId'), 10);
  const attemptId = parseInt(c.req.param('attemptId'), 10);
  if (!Number.isFinite(queueId) || queueId < 1 || !Number.isFinite(attemptId) || attemptId < 1) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const db = getDb(c.env);

  // Ownership check: attempt must belong to this queue row. Prevents an
  // operator with WRITE role from editing some other tenant's job's
  // attempts via a guessed id.
  const existing = await queryFirst<{
    id: number; result: string | null; disposition_code: string | null;
    attempt_number: number;
  }>(db, 'SELECT id, result, attempt_number FROM serve_attempts WHERE id = ? AND serve_queue_id = ?',
    attemptId, queueId);
  if (!existing) return c.json({ error: 'Attempt not found for this job' }, 404);

  // Whitelist + per-field validation. disposition_code is guarded —
  // migration 0143 may not have reached live D1 on a fresh deploy.
  const hasDispositionCol = 'disposition_code' in body
    ? await columnExists(db, 'serve_attempts', 'disposition_code')
    : true;
  // person_served_* guarded — migration 0256 adds these columns; the deploy
  // step is continue-on-error so they may not exist on a fresh deploy.
  const hasPersonServedCols = ('person_served_name' in body || 'person_served_relationship' in body || 'person_served_description' in body)
    ? await columnExists(db, 'serve_attempts', 'person_served_name')
    : true;
  const sets: string[] = [];
  const args: any[] = [];
  let resultChanged = false;
  let newResult: string | null = existing.result;

  if ('attempt_at' in body && body.attempt_at !== undefined) {
    sets.push('attempt_at = ?');
    args.push(body.attempt_at || null);
  }
  if ('attempt_type' in body && body.attempt_type !== undefined) {
    sets.push('attempt_type = ?');
    args.push(body.attempt_type || null);
  }
  if ('notes' in body && body.notes !== undefined) {
    sets.push('notes = ?');
    args.push(body.notes || null);
  }
  if ('latitude' in body && body.latitude !== undefined) {
    sets.push('latitude = ?');
    args.push(body.latitude == null ? null : Number(body.latitude));
  }
  if ('longitude' in body && body.longitude !== undefined) {
    sets.push('longitude = ?');
    args.push(body.longitude == null ? null : Number(body.longitude));
  }

  // Photo IDs — append new IDs to the existing array (never replace/delete).
  // Operators can attach additional field photos after the fact; the original
  // evidence set is preserved because we only ever grow photo_ids, never shrink.
  let appendedPhotoIds: string[] = [];
  if ('photo_ids_append' in body && Array.isArray(body.photo_ids_append) && body.photo_ids_append.length > 0) {
    const existingRow = await queryFirst<{ photo_ids: string | null }>(
      db, 'SELECT photo_ids FROM serve_attempts WHERE id = ?', attemptId);
    const current: string[] = (() => {
      try { return JSON.parse(existingRow?.photo_ids || '[]'); } catch { return []; }
    })();
    const newIds = (body.photo_ids_append as string[]).filter(
      (id) => typeof id === 'string' && id.length > 0 && !current.includes(id),
    );
    if (newIds.length > 0) {
      appendedPhotoIds = newIds;
      sets.push('photo_ids = ?');
      args.push(JSON.stringify([...current, ...newIds]));
    }
  }

  // Physical description fields (editable for officer corrections).
  // Guarded by hasPersonServedCols — migration 0256 may not be applied yet.
  if (hasPersonServedCols) {
    if ('person_served_name' in body) {
      sets.push('person_served_name = ?');
      args.push(body.person_served_name || null);
    }
    if ('person_served_relationship' in body) {
      sets.push('person_served_relationship = ?');
      args.push(body.person_served_relationship || null);
    }
    if ('person_served_description' in body) {
      sets.push('person_served_description = ?');
      args.push(body.person_served_description || null);
    }
  }

  // Structured PS code takes precedence — derive the legacy `result`
  // and update both columns when supplied. Mirrors logAttempt.
  if ('disposition_code' in body && body.disposition_code !== undefined && hasDispositionCol) {
    const code = typeof body.disposition_code === 'string' && body.disposition_code.trim()
      ? body.disposition_code.trim().toUpperCase()
      : null;
    if (code && !lookupPsoCode(code)) {
      return c.json({ error: `Unknown disposition_code: ${code}` }, 400);
    }
    sets.push('disposition_code = ?');
    args.push(code);
    if (code) {
      const derived = codeToLegacyResult(code);
      sets.push('result = ?');
      args.push(derived);
      newResult = derived;
      resultChanged = derived !== existing.result;
    }
  } else if ('result' in body && body.result !== undefined) {
    if (!ATTEMPT_RESULTS.has(body.result)) {
      return c.json({ error: `Unknown result: ${body.result}` }, 400);
    }
    sets.push('result = ?');
    args.push(body.result);
    newResult = body.result;
    resultChanged = body.result !== existing.result;
  }

  if (!sets.length) return c.json({ error: 'No editable fields supplied' }, 400);
  args.push(attemptId);
  await execute(db, `UPDATE serve_attempts SET ${sets.join(', ')} WHERE id = ?`, ...args);

  if (appendedPhotoIds.length > 0) {
    await catalogServeAttemptFiles(
      db,
      queueId,
      attemptId,
      appendedPhotoIds.map((file_id) => ({
        file_id,
        kind: 'photo' as const,
        document_type: 'door_photo',
        uploaded_by: c.get('user')?.id ?? null,
      })),
    ).catch((err) => {
      log.warn('catalogServeAttemptFiles after photo append failed', { queueId, attemptId, error: err instanceof Error ? err.message : String(err) });
    });
  }

  // ── Parent status recompute ───────────────────────────────
  // Only fire when result/disposition actually changed. We re-derive
  // status from the most recent attempt's result, not the edited one,
  // because the edit may target an OLD attempt and the latest is what
  // determines whether the job is currently served/failed/attempted.
  let recomputed: { status: string } | null = null;
  if (resultChanged) {
    const queue = await queryFirst<{ attempt_count: number; max_attempts: number; status: string }>(
      db, 'SELECT attempt_count, max_attempts, status FROM serve_queue WHERE id = ?', queueId);
    const latest = await queryFirst<{ result: string | null; disposition_code: string | null }>(
      db,
      hasDispositionCol
        ? 'SELECT result, disposition_code FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_at DESC, id DESC LIMIT 1'
        : 'SELECT result FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_at DESC, id DESC LIMIT 1',
      queueId,
    );
    if (queue && latest) {
      let nextStatus = queue.status;
      const psCode = latest.disposition_code;
      if (psCode) {
        const codeStatus = codeToQueueStatus(psCode);
        if (codeStatus === 'served' || codeStatus === 'failed') nextStatus = codeStatus;
        else if (codeStatus === 'pending') nextStatus = 'pending';
        else nextStatus = queue.attempt_count >= (queue.max_attempts ?? 3) ? 'failed' : 'attempted';
      } else if (latest.result === 'served' || latest.result === 'sub_served') {
        nextStatus = 'served';
      } else if (queue.attempt_count >= (queue.max_attempts ?? 3)) {
        nextStatus = 'failed';
      } else {
        nextStatus = 'attempted';
      }
      if (nextStatus !== queue.status) {
        await execute(db,
          `UPDATE serve_queue SET status = ?, updated_at = datetime(\'now\') WHERE id = ?`,
          nextStatus, queueId);
        recomputed = { status: nextStatus };
        if (nextStatus === 'served' || nextStatus === 'failed') {
          syncServeCompletionToCfs(db, queueId).catch(() => {});
        }
      }
    }
  }

  return c.json({
    success: true,
    attempt_id: attemptId,
    fields_updated: sets.length,
    result: newResult,
    queue_status_recomputed: recomputed,
  });
});

// ─────────────────────────────────────────────────────────────
// Delete an attempt (admin/manager/supervisor only)
// ─────────────────────────────────────────────────────────────
// DELETE /:queueId/attempt/:attemptId
//
// Allows supervisors to remove an inaccurate entry (wrong recipient,
// fat-fingered GPS, duplicate attempt, etc.) while preserving the
// rest of the service log. Also recalculates the parent queue's
// attempt_count and re-derives status from remaining attempts.
//
// Billing auto-reversal: when the last served attempt is deleted and
// the queue status reverts from 'served', non-invoiced serve_charges
// are auto-voided. Invoiced charges are left for manual credit.
sv.delete('/:queueId/attempt/:attemptId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const queueId = parseInt(c.req.param('queueId'), 10);
  const attemptId = parseInt(c.req.param('attemptId'), 10);
  if (!Number.isFinite(queueId) || queueId < 1 || !Number.isFinite(attemptId) || attemptId < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const user = c.get('user') as { id: number } | undefined;

  // Snapshot pre-deletion queue status for billing reversal detection
  const prevQueue = await queryFirst<{ status: string }>(
    db, 'SELECT status FROM serve_queue WHERE id = ?', queueId,
  );
  if (!prevQueue) return c.json({ error: 'Queue entry not found' }, 404);

  // Ownership check: attempt must belong to this queue row
  const existing = await queryFirst<{ id: number; result: string | null; attempt_number: number }>(
    db, 'SELECT id, result, attempt_number FROM serve_attempts WHERE id = ? AND serve_queue_id = ?',
    attemptId, queueId,
  );
  if (!existing) return c.json({ error: 'Attempt not found for this job' }, 404);

  await execute(db, 'DELETE FROM serve_attempts WHERE id = ?', attemptId);

  // Recalculate attempt_count from remaining attempts
  const remainingCount = await queryFirst<{ n: number }>(
    db, 'SELECT COUNT(*) AS n FROM serve_attempts WHERE serve_queue_id = ?', queueId,
  );
  const newCount = remainingCount?.n ?? 0;

  // Re-derive queue status from the most recent remaining attempt
  let newStatus = 'pending';
  if (newCount > 0) {
    const latest = await queryFirst<{ result: string | null; disposition_code: string | null }>(
      db, 'SELECT result, disposition_code FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_at DESC, id DESC LIMIT 1',
      queueId,
    );
    if (latest) {
      const psCode = latest.disposition_code;
      if (psCode) {
        const codeStatus = codeToQueueStatus(psCode);
        if (codeStatus === 'served' || codeStatus === 'failed') newStatus = codeStatus;
        else if (codeStatus === 'pending') newStatus = 'pending';
        else newStatus = 'attempted';
      } else if (latest.result === 'served' || latest.result === 'sub_served') {
        newStatus = 'served';
      } else {
        newStatus = 'attempted';
      }
    }
  }

  const clearClosed = (newStatus !== 'served' && newStatus !== 'failed') ? ", closed_at = NULL" : "";
  await execute(
    db,
    `UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = datetime(\'now\')${clearClosed} WHERE id = ?`,
    newCount, newStatus, queueId,
  );

  await execute(db,
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'delete', 'serve_attempt', ?, ?)`,
    user?.id ?? null, attemptId, JSON.stringify({
      serve_queue_id: queueId,
      deleted_attempt_number: existing.attempt_number,
      deleted_result: existing.result,
      new_queue_status: newStatus,
      new_attempt_count: newCount,
    }),
  );

  if (newStatus === 'served' || newStatus === 'failed') {
    syncServeCompletionToCfs(db, queueId).catch(() => {});
  }

  // Auto-void charges when the last served attempt is deleted and the
  // queue reverts from 'served'. Only non-invoiced charges are voided;
  // invoiced charges require a manual credit note.
  if (prevQueue.status === 'served' && newStatus !== 'served') {
    await execute(db,
      `UPDATE serve_charges SET status = 'void', notes = ? WHERE serve_queue_id = ? AND status NOT IN ('invoiced', 'void')`,
      'Auto-voided: the served attempt was deleted', queueId,
    ).catch(() => {});
  }

  return c.json({
    success: true,
    deleted_attempt_id: attemptId,
    attempt_count: newCount,
    queue_status: newStatus,
  });
});

// ─────────────────────────────────────────────────────────────
// Renumber attempts after deletion (admin/manager/supervisor only)
// ─────────────────────────────────────────────────────────────
// POST /:queueId/renumber-attempts
//
// After an admin deletes attempt #2 of 3, remaining attempts still
// carry numbers 1 and 3 — gaps that can confuse notice-of-attempt
// PDF generation and timeline displays. This endpoint re-sequences
// all remaining attempts to contiguous numbers (1, 2, 3, …).
//
// Billing records are NOT affected — they reference attempt IDs,
// not attempt numbers.
sv.post('/:queueId/renumber-attempts', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const queueId = parseInt(c.req.param('queueId'), 10);
  if (!Number.isFinite(queueId) || queueId < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const user = c.get('user') as { id: number } | undefined;

  const queue = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM serve_queue WHERE id = ?', queueId,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);

  const attempts = await query<{ id: number; attempt_number: number }>(
    db,
    'SELECT id, attempt_number FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_number ASC, id ASC',
    queueId,
  );

  if (!attempts.length) {
    return c.json({ success: true, renumbered: 0, message: 'No attempts to renumber' });
  }

  const updates: { id: number; old: number; new: number }[] = [];
  const stmts: any[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const newNum = i + 1;
    if (attempts[i].attempt_number !== newNum) {
      updates.push({ id: attempts[i].id, old: attempts[i].attempt_number, new: newNum });
      stmts.push(
        db.prepare('UPDATE serve_attempts SET attempt_number = ? WHERE id = ?')
          .bind(newNum, attempts[i].id),
      );
    }
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
    // Update attempt_count to reflect the actual count
    await execute(db,
      'UPDATE serve_queue SET attempt_count = ?, updated_at = datetime(\'now\') WHERE id = ?',
      attempts.length, queueId,
    );
  }

  await execute(db,
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'renumber', 'serve_attempts', ?, ?)`,
    user?.id ?? null, queueId, JSON.stringify({
      serve_queue_id: queueId,
      total_attempts: attempts.length,
      renumberings: updates,
    }),
  );

  return c.json({
    success: true,
    queue_id: queueId,
    attempt_count: attempts.length,
    renumbered: updates.length,
    changes: updates,
  });
});

// GET /:id/gps-trail — attempts ordered chronologically, drop ones missing coords
sv.get('/:id/gps-trail', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const rows = await query<{ attempt_at: string; latitude: number | null; longitude: number | null; result: string }>(
    getDb(c.env),
    `SELECT attempt_at, latitude, longitude, result FROM serve_attempts
       WHERE serve_queue_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY attempt_at ASC`,
    id,
  );
  return c.json({
    trail: rows,
    polyline: rows.map((r) => [r.longitude, r.latitude]),  // GeoJSON [lng,lat] order
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature pack: 30 Process Server enhancements (PR 4)
// ─────────────────────────────────────────────────────────────────────────────

// [1] GET /aging is registered above the /:id catch-all (route order matters in Hono).

// [2] GET /upcoming — moved to before /:id (see route-order note above)

// [3] PATCH /bulk-deadline — extend deadline on multiple jobs at once
sv.patch('/bulk-deadline', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<{ ids: number[]; deadline: string }>().catch(() => null);
  if (!body?.ids?.length) return c.json({ error: 'ids required' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deadline ?? '')) return c.json({ error: 'Invalid deadline date (YYYY-MM-DD)' }, 400);
  const db = getDb(c.env);
  const updated = await executeInChunks(
    db,
    body.ids,
    (phs) => `UPDATE serve_queue SET deadline = ?, updated_at = datetime(\'now\') WHERE id IN (${phs})`,
    [body.deadline],
  );
  return c.json({ success: true, updated });
});

// [4] PATCH /bulk-assign — reassign multiple jobs to one officer (or unassign with null)
sv.patch('/bulk-assign', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<{ ids: number[]; officer_id: number | null }>().catch(() => null);
  if (!body?.ids?.length) return c.json({ error: 'ids required' }, 400);
  const officerId = body.officer_id ?? null;
  const db = getDb(c.env);
  const updated = await executeInChunks(
    db,
    body.ids,
    (phs) => `UPDATE serve_queue SET officer_id = ?, updated_at = datetime(\'now\') WHERE id IN (${phs})`,
    [officerId],
  );
  return c.json({ success: true, updated });
});

// [5a] GET /:id/comments — per-job comment thread
sv.get('/:id/comments', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const rows = await query<Record<string, unknown>>(
    getDb(c.env),
    `SELECT id, author_name, author_role, body, created_at, edited_at, is_system, parent_id
       FROM serve_job_comments
      WHERE serve_queue_id = ?
      ORDER BY created_at ASC`,
    id,
  );
  return c.json(rows);
});

// [5b] POST /:id/comments — add a comment to a job's thread
sv.post('/:id/comments', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user') as { id?: number; role?: string; full_name?: string; username?: string } | undefined;
  const body = await c.req.json<{ body: string; parent_id?: number }>().catch(() => null);
  const text = (body?.body ?? '').trim().slice(0, 4000);
  if (!text) return c.json({ error: 'Comment body required' }, 400);
  const db = getDb(c.env);
  const job = await queryFirst<{ id: number }>(db, 'SELECT id FROM serve_queue WHERE id = ?', id);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const r = await execute(db,
    `INSERT INTO serve_job_comments (serve_queue_id, author_id, author_name, author_role, body, parent_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    user?.id ?? null,
    user?.full_name || user?.username || 'Unknown',
    user?.role || null,
    text,
    body?.parent_id ?? null,
  );
  return c.json({ id: r.meta.last_row_id, success: true }, 201);
});

// [6] PATCH /:id/court-filing — mark/unmark affidavit filed with court
// Stored in parsed_data JSON to avoid adding a column to the capped serve_queue
sv.patch('/:id/court-filing', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ filed?: boolean; filed_at?: string }>().catch(() => null);
  const filedAt = body?.filed
    ? (body.filed_at ?? new Date().toISOString().slice(0, 10))
    : null;
  const db = getDb(c.env);
  await execute(db,
    `UPDATE serve_queue
        SET parsed_data = json_set(COALESCE(parsed_data, '{}'), '$.court_filing_date', ?),
            updated_at  = datetime('now')
      WHERE id = ?`,
    filedAt, id,
  );
  return c.json({ success: true, filed: !!body?.filed, filed_at: filedAt });
});

// [7] GET /stats/first-attempt-rate — % of closed jobs served on the first attempt
sv.get('/stats/first-attempt-rate', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const row = await queryFirst<{ total: number; first_attempt_served: number }>(db, `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN attempt_count = 1 AND status = 'served' THEN 1 ELSE 0 END) AS first_attempt_served
    FROM serve_queue
    WHERE status IN ('served', 'failed') AND attempt_count > 0
  `);
  const total = row?.total ?? 0;
  const fas   = row?.first_attempt_served ?? 0;
  return c.json({ total, first_attempt_served: fas, rate: total > 0 ? Math.round((fas / total) * 100) : 0 });
});

// [8] GET /stats/velocity — attempt volume this week vs last week
sv.get('/stats/velocity', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const row = await queryFirst<{ last7: number; prev7: number }>(db, `
    SELECT
      SUM(CASE WHEN attempt_at >= datetime('now', '-7 days')  THEN 1 ELSE 0 END) AS last7,
      SUM(CASE WHEN attempt_at >= datetime('now', '-14 days')
               AND attempt_at <  datetime('now', '-7 days')   THEN 1 ELSE 0 END) AS prev7
    FROM serve_attempts
    WHERE attempt_at >= datetime('now', '-14 days')
  `);
  const last7 = row?.last7 ?? 0;
  const prev7 = row?.prev7 ?? 0;
  return c.json({ last_7_days: last7, prior_7_days: prev7, trend: last7 - prev7 });
});

// [9] GET /client-breakdown — moved before /:id; see route-order note at top of this section

// [10] GET /:id/address-history — previous jobs at the same service address
sv.get('/:id/address-history', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const job = await queryFirst<{ recipient_address: string }>(db,
    'SELECT recipient_address FROM serve_queue WHERE id = ?', id,
  );
  if (!job?.recipient_address) return c.json([]);
  const rows = await query<Record<string, unknown>>(db, `
    SELECT id, recipient_name, status, attempt_count, deadline, closed_at,
           json_extract(parsed_data, '$.court_filing_date') AS court_filing_date
    FROM serve_queue
    WHERE recipient_address = ? AND id != ?
    ORDER BY id DESC
    LIMIT 20
  `, job.recipient_address, id);
  return c.json(rows);
});

// [26] GET /stats/daily-run-summary — today's attempt counts, served, and mileage
sv.get('/stats/daily-run-summary', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const row = await queryFirst<{ attempts: number; served: number; not_home: number; refused: number }>(db, `
    SELECT
      COUNT(*)  AS attempts,
      SUM(CASE WHEN result = 'served'   THEN 1 ELSE 0 END) AS served,
      SUM(CASE WHEN result = 'not_home' THEN 1 ELSE 0 END) AS not_home,
      SUM(CASE WHEN result = 'refused'  THEN 1 ELSE 0 END) AS refused
    FROM serve_attempts
    WHERE attempt_at >= date('now', '-7 hours')
  `);
  const mileRow = await queryFirst<{ total_miles: number }>(db, `
    SELECT SUM(mileage_actual) AS total_miles
    FROM serve_queue
    WHERE closed_at >= date('now', '-7 hours') AND status = 'served'
  `);
  return c.json({
    date: new Date().toISOString().slice(0, 10),
    attempts:   row?.attempts  ?? 0,
    served:     row?.served    ?? 0,
    not_home:   row?.not_home  ?? 0,
    refused:    row?.refused   ?? 0,
    total_miles: mileRow?.total_miles ?? 0,
  });
});

// [27] GET /client-report/:client — all jobs for a specific client (for status reports)
sv.get('/client-report/:client', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const client = decodeURIComponent(c.req.param('client') ?? '').trim().slice(0, 200);
  if (!client) return c.json({ error: 'client required' }, 400);
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(db, `
    SELECT id, recipient_name, recipient_address, case_number, document_type,
           status, attempt_count, deadline, closed_at, priority,
           json_extract(parsed_data, '$.court_filing_date') AS court_filing_date
    FROM serve_queue
    WHERE COALESCE(NULLIF(client_name,''), NULLIF(attorney_name,'')) = ?
    ORDER BY status ASC, deadline ASC
    LIMIT 500
  `, client);
  return c.json({ client, job_count: rows.length, jobs: rows });
});

// [28] GET /export/attorney-grouped — serve history grouped by attorney for billing exports
sv.get('/export/attorney-grouped', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(db, `
    SELECT
      COALESCE(NULLIF(attorney_name,''), NULLIF(client_name,''), 'Unknown') AS attorney,
      COUNT(*)                                                               AS total_jobs,
      SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END)                    AS served,
      SUM(COALESCE(serve_fee, 0) + COALESCE(rush_fee, 0))                   AS total_fees,
      SUM(COALESCE(mileage_actual, 0))                                       AS total_miles,
      MIN(created_at)                                                        AS first_job_at,
      MAX(created_at)                                                        AS last_job_at
    FROM serve_queue
    WHERE status IN ('served', 'failed', 'cancelled')
    GROUP BY 1
    ORDER BY total_fees DESC
    LIMIT 200
  `);
  return c.json({ exported_at: new Date().toISOString(), attorneys: rows });
});

// [29] GET /:id/affidavit-prefill — pre-fill non-service affidavit from attempt history
sv.get('/:id/affidavit-prefill', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const job = await queryFirst<{ recipient_name: string; recipient_address: string; case_number: string; document_type: string; attorney_name: string }>(db,
    'SELECT recipient_name, recipient_address, case_number, document_type, attorney_name FROM serve_queue WHERE id = ?', id,
  );
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const attempts = await query<{ attempt_at: string; result: string; notes: string; attempt_number: number }>(db,
    `SELECT attempt_number, attempt_at, result, notes FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_number ASC`,
    id,
  );
  const attemptLines = attempts.map((a) =>
    `Attempt #${a.attempt_number} on ${a.attempt_at?.slice(0, 10) ?? '?'}: ${a.result}${a.notes ? ` — ${a.notes}` : ''}`,
  );
  return c.json({
    serve_queue_id: id,
    recipient_name:    job.recipient_name,
    recipient_address: job.recipient_address,
    case_number:       job.case_number,
    document_type:     job.document_type,
    attorney_name:     job.attorney_name,
    attempt_count:     attempts.length,
    attempt_summary:   attemptLines.join('\n'),
    generated_at:      new Date().toISOString(),
  });
});

export default sv;
