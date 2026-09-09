// ============================================================
// Mapbox Optimization V2 async engine
// Backs three CAD workflows: serve_run, patrol_beat, multi_unit_dispatch
// POST /submit → Mapbox job ID → D1 row
// GET /:jobId  → polls Mapbox, updates D1, write-back on completion
// GET /        → list jobs (supervisor+ sees own; admin/manager see all)
// ============================================================

import { Hono } from 'hono';
import { optimizationSubmitSchema, validateOptimizationProblem } from '../utils/mapboxOptimizationV2Validation';
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
  type V2ProblemDocument,
} from '../utils/mapboxOptimizationV2';

const app = new Hono<Env>();

const MB_V2 = 'https://api.mapbox.com/optimized-trips/v2';
const TIMEOUT_MS = 12_000;

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
  try { body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body'); } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = optimizationSubmitSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid optimization request', details: parsed.error.issues }, 400);
  body = parsed.data;

  const { job_type } = body as { job_type: string };
  if (!['serve_run', 'patrol_beat', 'multi_unit_dispatch', 'fleet_route'].includes(job_type)) {
    return c.json({ error: 'job_type must be serve_run, patrol_beat, or multi_unit_dispatch' }, 400);
  }

  let problem: V2ProblemDocument;
  let refId: number | null = null;

  try {
    if (parsed.data.job_type === 'fleet_route') {
      if (!SUPERVISOR_ROLES.has(user.role)) return c.json({ error: 'Supervisor role required' }, 403);
      problem = parsed.data.problem;
    } else if (job_type === 'serve_run') {
      const { serve_queue_ids, officer_unit_id, shift_start, shift_end, ref_id, origin, circular, objective, requirements } = body as {
        serve_queue_ids: number[];
        officer_unit_id?: number;
        shift_start: string;
        shift_end: string;
        ref_id?: number | null;
        origin?: { lat: number; lng: number } | null;
        circular?: boolean;
        objective?: 'min-schedule-completion-time' | 'min-total-travel-duration';
        requirements?: string[];
      };
      if (!serve_queue_ids?.length || !shift_start || !shift_end) {
        return c.json({ error: 'serve_run requires serve_queue_ids, shift_start, shift_end' }, 400);
      }
      const stopRows = await queryInChunks<ServeStop>(
        db,
        serve_queue_ids,
        (ph) => `SELECT id, recipient_address, recipient_lat, recipient_lng, time_window, deadline, priority, business_id, parsed_data->>'recipient_type' AS recipient_type FROM serve_queue WHERE id IN (${ph}) AND recipient_lat IS NOT NULL AND recipient_lng IS NOT NULL`,
      );
      if (stopRows.length !== serve_queue_ids.length) return c.json({ error: 'Every selected service must exist and have coordinates' }, 400);
      if (ref_id) {
        const savedRoute = await db.prepare('SELECT officer_id FROM serve_routes WHERE id = ?').bind(ref_id).first<{ officer_id: number }>();
        if (!savedRoute) return c.json({ error: 'Saved route not found' }, 404);
        if (savedRoute.officer_id !== user.id && !SUPERVISOR_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
      }
      try {
        const slots = await queryInChunks<{ queue_id: number; window_start: string; window_end: string; scheduled_date: string }>(
          db,
          serve_queue_ids,
          (ph) => `SELECT queue_id, window_start, window_end, scheduled_date FROM serve_attempt_schedules WHERE dismissed = 0 AND queue_id IN (${ph}) ORDER BY scheduled_date ASC, window_start ASC`,
        );
        const first = new Map<number, { window_start: string; window_end: string }>();
        const shiftDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date(shift_start));
        for (const slot of slots) {
          if (slot.scheduled_date !== shiftDay) continue;
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
          .prepare('SELECT id, call_sign, latitude, longitude, capabilities FROM units WHERE id = ? LIMIT 1')
          .bind(officer_unit_id)
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

      if (typeof officer.capabilities === 'string') {
        try { officer.capabilities = JSON.parse(officer.capabilities); } catch { officer.capabilities = null; }
      }
      problem = buildServeRunProblem(stopRows, officer, shift_start, shift_end, {
        circular: circular !== false,
        avgMpg,
        objective,
        requirements: requirements?.length ? requirements : undefined,
      });
      refId = ref_id ?? null;
    } else {
      if (!SUPERVISOR_ROLES.has(user.role)) {
        return c.json({ error: 'Forbidden — supervisor role required' }, 403);
      }
      if (job_type === 'patrol_beat') {
      const { beat_ids, unit_ids, shift_start, shift_end, objective, circular } = body as {
        beat_ids: number[];
        unit_ids: number[];
        shift_start: string;
        shift_end: string;
        objective?: 'min-schedule-completion-time' | 'min-total-travel-duration';
        circular?: boolean;
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
        (ph) => `SELECT id, call_sign, latitude, longitude, capabilities FROM units WHERE id IN (${ph})`,
      );
      if (beatRows.length !== beat_ids.length || unitRows.length !== unit_ids.length) return c.json({ error: 'Every selected beat and unit must exist and be active' }, 400);
      // Parse capabilities from JSON text column
      for (const u of unitRows) {
        if (typeof u.capabilities === 'string') {
          try { u.capabilities = JSON.parse(u.capabilities as string); } catch { u.capabilities = null; }
        }
      }
      problem = buildPatrolBeatProblem(beatRows, unitRows, shift_start, shift_end, { objective, circular });
    } else {
      const { call_ids, unit_ids, objective } = body as {
        call_ids: number[];
        unit_ids: number[];
        objective?: 'min-schedule-completion-time' | 'min-total-travel-duration';
      };
      if (!call_ids?.length || !unit_ids?.length) {
        return c.json({ error: 'multi_unit_dispatch requires call_ids and unit_ids' }, 400);
      }
      const callRows = await queryInChunks<CallRow>(
        db,
        call_ids,
        (ph) => `SELECT id, incident_number, latitude, longitude, priority FROM calls_for_service WHERE id IN (${ph}) AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      );
      // Parse requirements from JSON text column if present
      for (const c of callRows) {
        if (typeof (c as any).requirements === 'string') {
          try { c.requirements = JSON.parse((c as any).requirements); } catch { c.requirements = null; }
        }
      }
      const unitRows = await queryInChunks<UnitRow>(
        db,
        unit_ids,
        (ph) => `SELECT id, call_sign, latitude, longitude, capabilities FROM units WHERE id IN (${ph}) AND status = 'available'`,
      );
      // Parse capabilities from JSON text column
      for (const u of unitRows) {
        if (typeof u.capabilities === 'string') {
          try { u.capabilities = JSON.parse(u.capabilities as string); } catch { u.capabilities = null; }
        }
      }
      if (callRows.length !== call_ids.length || unitRows.length !== unit_ids.length) return c.json({ error: 'Every selected call needs coordinates and every unit must be available' }, 400);
      problem = buildDispatchProblem(callRows, unitRows, { objective });
    }
    }
  } catch (err) {
    log.error('[optimization-v2] problem build failed', { job_type }, err as Error);
    return c.json({ error: err instanceof Error ? err.message : 'Invalid optimization problem' }, 400);
  }

  try { validateOptimizationProblem(problem); } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid problem' }, 400);
  }

  // Submit to Mapbox V2
  let mapboxJobId: string;
  try {
    const resp = await mbFetch(`${MB_V2}?access_token=${encodeURIComponent(tk)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...problem, options: { objectives: problem.options?.objectives } }),
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

  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (row.created_by !== user.id && !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const tk = getToken(c);
  if (!tk && !['complete', 'error'].includes(String(row.status))) {
    return notConfigured(c, 'Mapbox Optimization V2 requires a configured token');
  }
  const { pollOptimizationV2Job } = await import('../utils/mapboxOptimizationV2Jobs');
  return c.json(await pollOptimizationV2Job(db, tk, row as unknown as import('../utils/mapboxOptimizationV2Jobs').OptimizationJob));
});

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const db = c.env.DB;
  const isAdminOrManager = ['admin', 'manager'].includes(user.role);

  const { results } = isAdminOrManager
    ? await db
        .prepare('SELECT id, job_type, status, ref_id, created_by, created_at, updated_at, error_message, problem_json, solution_json FROM mapbox_optimization_v2_jobs ORDER BY created_at DESC LIMIT 100')
        .all()
    : await db
        .prepare('SELECT id, job_type, status, ref_id, created_by, created_at, updated_at, error_message, problem_json, solution_json FROM mapbox_optimization_v2_jobs WHERE created_by = ? ORDER BY created_at DESC LIMIT 50')
        .bind(user.id)
        .all();

  const jobs = (results ?? []).map((row: Record<string, unknown>) => {
    const summary: Record<string, unknown> = {};

    // Extract problem summary
    try {
      const problem = JSON.parse(row.problem_json as string);
      if (problem) {
        summary.service_count = problem.services?.length ?? 0;
        summary.vehicle_count = problem.vehicles?.length ?? 0;
        summary.objective = problem.options?.objectives?.[0] ?? null;
        summary.avg_mpg = problem.options?.avg_mpg ?? null;

        // Capabilities across all vehicles
        const allCaps = new Set<string>();
        for (const v of problem.vehicles ?? []) {
          for (const cap of v.capabilities ?? []) allCaps.add(cap);
        }
        if (allCaps.size > 0) summary.capabilities = [...allCaps];

        // Requirements across all services
        const allReqs = new Set<string>();
        for (const s of problem.services ?? []) {
          for (const req of s.requirements ?? []) allReqs.add(req);
        }
        if (allReqs.size > 0) summary.requirements = [...allReqs];

        // Break info
        const firstVehicle = problem.vehicles?.[0];
        if (firstVehicle?.breaks?.length) {
          summary.has_break = true;
          summary.break_duration = firstVehicle.breaks[0].duration ?? null;
        }

        // Shift window from first vehicle
        if (firstVehicle?.earliest_start) summary.shift_start = firstVehicle.earliest_start;
        if (firstVehicle?.latest_end) summary.shift_end = firstVehicle.latest_end;
      }
    } catch { /* problem_json missing or malformed — skip summary */ }

    // Extract solution summary (only for complete jobs)
    if (row.status === 'complete' && row.solution_json) {
      try {
        const solution = JSON.parse(row.solution_json as string);
        if (solution) {
          summary.route_count = solution.routes?.length ?? 0;
          summary.dropped_count = solution.dropped?.services?.length ?? 0;

          // Aggregate distance/duration across routes
          let totalDistM = 0;
          let totalDurS = 0;
          for (const route of solution.routes ?? []) {
            totalDistM += route.distance ?? 0;
            totalDurS += route.duration ?? 0;
          }
          if (totalDistM > 0) summary.total_distance_mi = Math.round((totalDistM / 1609.34) * 10) / 10;
          if (totalDurS > 0) summary.total_duration_min = Math.round(totalDurS / 60);

          // Per-route summaries (vehicle name + distance)
          summary.route_summaries = (solution.routes ?? []).map((route: { vehicle?: string; distance?: number; duration?: number; stops?: unknown[] }) => ({
            vehicle: route.vehicle ?? null,
            distance_mi: route.distance ? Math.round((route.distance / 1609.34) * 10) / 10 : null,
            duration_min: route.duration ? Math.round(route.duration / 60) : null,
            stop_count: route.stops?.length ?? 0,
          }));
        }
      } catch { /* solution_json missing or malformed — skip summary */ }
    }

    const { problem_json: _pj, solution_json: _sj, ...base } = row;
    return { ...base, summary };
  });

  return c.json({ jobs });
});

export default app;
