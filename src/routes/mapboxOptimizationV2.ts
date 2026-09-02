// ============================================================
// Mapbox Optimization V2 async engine
// Backs three CAD workflows: serve_run, patrol_beat, multi_unit_dispatch
// POST /submit → Mapbox job ID → D1 row
// GET /:jobId  → polls Mapbox, updates D1, write-back on completion
// GET /        → list jobs (supervisor+ sees own; admin/manager see all)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { notConfigured } from '../utils/notConfigured';
import { log } from '../utils/logger';
import { queryInChunks } from '../utils/db';
import {
  buildServeRunProblem,
  buildPatrolBeatProblem,
  buildDispatchProblem,
  resolveOptimizationV2Token,
  type ServeStop,
  type UnitRow,
  type BeatRow,
  type CallRow,
  type V2Solution,
} from '../utils/mapboxOptimizationV2';

const app = new Hono<Env>();

const MB_V2 = 'https://api.mapbox.com/optimized-trips/v2';
const TIMEOUT_MS = 12_000;
const POLL_TIMEOUT_MIN = 5;

const SUPERVISOR_ROLES = new Set(['admin', 'manager', 'supervisor']);

function getToken(c: { env: { MAPBOX_SECRET_TOKEN?: string; MAPBOX_ACCESS_TOKEN?: string } }): string | null {
  return resolveOptimizationV2Token(c.env);
}

async function mbFetch(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      const e = new Error(`Mapbox ${res.status}`) as Error & { status: number; body: unknown };
      e.status = res.status;
      e.body = body;
      throw e;
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

// ── POST /submit ─────────────────────────────────────────────────────────────
app.post('/submit', async (c) => {
  const tk = getToken(c);
  if (!tk) return notConfigured(c, 'Mapbox Optimization V2 requires MAPBOX_ACCESS_TOKEN or MAPBOX_SECRET_TOKEN');

  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const db = c.env.DB;
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { job_type } = body as { job_type: string };
  if (!['serve_run', 'patrol_beat', 'multi_unit_dispatch'].includes(job_type)) {
    return c.json({ error: 'job_type must be serve_run, patrol_beat, or multi_unit_dispatch' }, 400);
  }

  let problem: unknown;
  let refId: number | null = null;

  try {
    if (job_type === 'serve_run') {
      const { serve_queue_ids, officer_unit_id, shift_start, shift_end, ref_id, origin, circular } = body as {
        serve_queue_ids: number[];
        officer_unit_id?: number;
        shift_start: string;
        shift_end: string;
        ref_id?: number | null;
        origin?: { lat: number; lng: number } | null;
        circular?: boolean;
      };
      if (!serve_queue_ids?.length || !shift_start || !shift_end) {
        return c.json({ error: 'serve_run requires serve_queue_ids, shift_start, shift_end' }, 400);
      }
      const stopRows = await queryInChunks<ServeStop>(
        db,
        serve_queue_ids,
        (ph) => `SELECT id, recipient_address, recipient_lat, recipient_lng, time_window, deadline, priority, business_id, parsed_data->>'recipient_type' AS recipient_type FROM serve_queue WHERE id IN (${ph}) AND recipient_lat IS NOT NULL AND recipient_lng IS NOT NULL`,
      );
      try {
        const slots = await queryInChunks<{ queue_id: number; window_start: string; window_end: string; scheduled_date: string }>(
          db,
          serve_queue_ids,
          (ph) => `SELECT queue_id, window_start, window_end, scheduled_date FROM serve_attempt_schedules WHERE dismissed = 0 AND queue_id IN (${ph}) ORDER BY scheduled_date ASC, window_start ASC`,
        );
        const first = new Map<number, { window_start: string; window_end: string }>();
        const shiftDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date(shift_start));
        for (const slot of slots) {
          if (slot.scheduled_date < shiftDay) continue;
          if (!first.has(slot.queue_id)) first.set(slot.queue_id, slot);
        }
        for (const row of stopRows) {
          const slot = first.get(row.id);
          if (slot) row.time_window = `${slot.window_start}-${slot.window_end}`;
        }
      } catch { /* schedules table optional */ }
      let officer: UnitRow | null = null;
      if (officer_unit_id) {
        const officerRow = await db
          .prepare('SELECT id, call_sign, latitude, longitude FROM units WHERE id = ? OR officer_id = ? LIMIT 1')
          .bind(officer_unit_id, officer_unit_id)
          .first();
        if (officerRow) officer = officerRow as unknown as UnitRow;
      }
      if (!officer && origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
        officer = {
          id: officer_unit_id || user.id,
          call_sign: 'serve',
          latitude: origin.lat,
          longitude: origin.lng,
        };
      }
      if (!officer) {
        return c.json({ error: 'serve_run requires origin {lat,lng} or a valid officer_unit_id' }, 400);
      }
      if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
        officer = { ...officer, latitude: origin.lat, longitude: origin.lng };
      }

      // Look up the officer's fleet vehicle MPG (falls back to fleet-wide average).
      const { lookupOfficerFleetMpg } = await import('../utils/serveRouteOptimizer');
      const avgMpg = await lookupOfficerFleetMpg(db, officer_unit_id);

      problem = buildServeRunProblem(stopRows, officer, shift_start, shift_end, {
        circular: circular !== false,
        avgMpg,
      });
      refId = ref_id ?? null;
    } else {
      if (!SUPERVISOR_ROLES.has(user.role)) {
        return c.json({ error: 'Forbidden — supervisor role required' }, 403);
      }
      if (job_type === 'patrol_beat') {
      const { beat_ids, unit_ids, shift_start, shift_end } = body as {
        beat_ids: number[];
        unit_ids: number[];
        shift_start: string;
        shift_end: string;
      };
      if (!beat_ids?.length || !unit_ids?.length || !shift_start || !shift_end) {
        return c.json({ error: 'patrol_beat requires beat_ids, unit_ids, shift_start, shift_end' }, 400);
      }
      const beatRows = await queryInChunks<BeatRow>(
        db,
        beat_ids,
        (ph) => `SELECT id, beat_code, min_lat, max_lat, min_lng, max_lng FROM dispatch_beats WHERE id IN (${ph}) AND active = 1`,
      );
      const unitRows = await queryInChunks<UnitRow>(
        db,
        unit_ids,
        (ph) => `SELECT id, call_sign, latitude, longitude FROM units WHERE id IN (${ph})`,
      );
      problem = buildPatrolBeatProblem(beatRows, unitRows, shift_start, shift_end);
    } else {
      const { call_ids, unit_ids } = body as { call_ids: number[]; unit_ids: number[] };
      if (!call_ids?.length || !unit_ids?.length) {
        return c.json({ error: 'multi_unit_dispatch requires call_ids and unit_ids' }, 400);
      }
      const callRows = await queryInChunks<CallRow>(
        db,
        call_ids,
        (ph) => `SELECT id, incident_number, latitude, longitude, priority FROM calls_for_service WHERE id IN (${ph}) AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      );
      const unitRows = await queryInChunks<UnitRow>(
        db,
        unit_ids,
        (ph) => `SELECT id, call_sign, latitude, longitude FROM units WHERE id IN (${ph}) AND status IN ('available','on_scene')`,
      );
      problem = buildDispatchProblem(callRows, unitRows);
    }
    }
  } catch (err) {
    log.error('[optimization-v2] problem build failed', { job_type }, err as Error);
    return c.json({ error: 'Failed to build optimization problem' }, 500);
  }

  // Submit to Mapbox V2
  let mapboxJobId: string;
  try {
    const resp = await mbFetch(`${MB_V2}?access_token=${tk}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(problem),
    }) as { id?: string };
    if (!resp?.id) throw new Error('No job ID in Mapbox response');
    mapboxJobId = resp.id;
  } catch (err: unknown) {
    const e = err as { status?: number; body?: { message?: string } };
    if (e?.status === 401) {
      return c.json({ error: 'Mapbox token lacks Optimization V2 access', code: 'optimization_v2_unauthorized' }, 503);
    }
    if (e?.status === 422) {
      return c.json({ error: 'Invalid optimization problem', detail: e?.body?.message }, 400);
    }
    log.error('[optimization-v2] Mapbox submit failed', {}, err as Error);
    return c.json({ error: 'Mapbox submit failed' }, 502);
  }

  await db
    .prepare(`INSERT INTO mapbox_optimization_v2_jobs (id, job_type, status, problem_json, ref_id, created_by) VALUES (?, ?, 'pending', ?, ?, ?)`)
    .bind(mapboxJobId, job_type, JSON.stringify(problem), refId, user.id)
    .run();

  log.info('[optimization-v2] job submitted', { jobId: mapboxJobId, job_type, refId });
  return c.json({ job_id: mapboxJobId, status: 'pending' }, 202);
});

// ── GET /:jobId ───────────────────────────────────────────────────────────────
app.get('/:jobId', async (c) => {
  const db = c.env.DB;
  const { jobId } = c.req.param();

  const row = await db
    .prepare('SELECT * FROM mapbox_optimization_v2_jobs WHERE id = ? LIMIT 1')
    .bind(jobId)
    .first() as Record<string, unknown> | null;

  if (!row) return c.json({ error: 'Job not found' }, 404);

  // Cached terminal states — no Mapbox token needed
  if (row.status === 'complete') {
    return c.json({ job_id: jobId, status: 'complete', solution: JSON.parse(row.solution_json as string) });
  }
  if (row.status === 'error') {
    return c.json({ job_id: jobId, status: 'error', error: row.error_message });
  }

  // Still in-flight — need the token to poll Mapbox
  const tk = getToken(c);
  if (!tk) return notConfigured(c, 'Mapbox Optimization V2 requires MAPBOX_ACCESS_TOKEN or MAPBOX_SECRET_TOKEN');

  // Check timeout
  const updatedAt = new Date((row.updated_at as string) + 'Z').getTime();
  if (Date.now() - updatedAt > POLL_TIMEOUT_MIN * 60 * 1000 && row.status !== 'pending') {
    await db
      .prepare(`UPDATE mapbox_optimization_v2_jobs SET status = 'error', error_message = 'timed_out', updated_at = datetime('now') WHERE id = ?`)
      .bind(jobId)
      .run();
    return c.json({ job_id: jobId, status: 'error', error: 'timed_out' });
  }

  // Poll Mapbox
  let mapboxResp: unknown;
  try {
    mapboxResp = await mbFetch(`${MB_V2}/${jobId}?access_token=${tk}`);
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e?.status === 202) {
      await db
        .prepare(`UPDATE mapbox_optimization_v2_jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ?`)
        .bind(jobId)
        .run();
      return c.json({ job_id: jobId, status: 'processing' });
    }
    log.error('[optimization-v2] poll failed', { jobId }, err as Error);
    return c.json({ job_id: jobId, status: 'processing', error: 'poll_failed' });
  }

  const solution = mapboxResp as V2Solution;
  await db
    .prepare(`UPDATE mapbox_optimization_v2_jobs SET status = 'complete', solution_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify(solution), jobId)
    .run();

  // Write-back for serve_run
  if (row.job_type === 'serve_run' && row.ref_id) {
    try {
      const route = solution.routes[0];
      if (route) {
        // Store plain IDs so the client reader (ServeRoutePlanner) can look
        // them up in its job map. Previous version stored objects {id,eta,wait}
        // which broke on reload because Map uses reference equality for objects.
        const orderedIds = route.stops
          .filter((s) => s.type === 'service')
          .map((s) => Number(s.location));
        // Compute total distance (meters) and duration (seconds) from the
        // route-level summary that Mapbox V2 returns on each route object.
        const routeAny = route as any;
        const totalDistanceMiles = routeAny.distance
          ? Math.round((routeAny.distance / 1609.34) * 10) / 10
          : null;
        const totalDurationMinutes = routeAny.duration
          ? Math.round(routeAny.duration / 60)
          : null;
        await db
          .prepare(
            `UPDATE serve_routes
             SET optimized_order_json = ?,
                 total_distance_miles = COALESCE(?, total_distance_miles),
                 total_time_minutes = COALESCE(?, total_time_minutes),
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(
            JSON.stringify(orderedIds),
            totalDistanceMiles,
            totalDurationMinutes,
            row.ref_id,
          )
          .run();
        log.info('[optimization-v2] serve_routes write-back complete', {
          refId: row.ref_id,
          stops: orderedIds.length,
          totalDistanceMiles,
          totalDurationMinutes,
        });
      }
    } catch (err) {
      log.error('[optimization-v2] serve_routes write-back failed', { refId: row.ref_id }, err as Error);
    }
  }

  log.info('[optimization-v2] job complete', { jobId, routes: solution.routes.length, dropped: solution.dropped.services.length });
  // Extract avg_mpg from the original problem (stored at submit time) so the
  // client can display vehicle-specific fuel cost estimates.
  let avgMpg: number | null = null;
  try {
    const problemDoc = JSON.parse(row.problem_json as string);
    avgMpg = problemDoc?.options?.avg_mpg ?? null;
  } catch { /* ignore */ }
  return c.json({ job_id: jobId, status: 'complete', solution, avg_mpg: avgMpg });
});

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const db = c.env.DB;
  const isAdminOrManager = ['admin', 'manager'].includes(user.role);

  const { results } = isAdminOrManager
    ? await db
        .prepare('SELECT id, job_type, status, ref_id, created_by, created_at, updated_at, error_message FROM mapbox_optimization_v2_jobs ORDER BY created_at DESC LIMIT 100')
        .all()
    : await db
        .prepare('SELECT id, job_type, status, ref_id, created_by, created_at, updated_at, error_message FROM mapbox_optimization_v2_jobs WHERE created_by = ? ORDER BY created_at DESC LIMIT 50')
        .bind(user.id)
        .all();

  return c.json({ jobs: results ?? [] });
});

export default app;
