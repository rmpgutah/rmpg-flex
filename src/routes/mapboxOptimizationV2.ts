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
import {
  buildServeRunProblem,
  buildPatrolBeatProblem,
  buildDispatchProblem,
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

function getToken(c: { env: { MAPBOX_ACCESS_TOKEN?: string } }): string | null {
  const t = c.env?.MAPBOX_ACCESS_TOKEN || null;
  if (!t) return null;
  if (t.startsWith('sk.')) return null; // never proxy secret tokens
  return t;
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
  if (!tk) return notConfigured(c, 'Mapbox Optimization V2 requires MAPBOX_ACCESS_TOKEN');

  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user || !SUPERVISOR_ROLES.has(user.role)) {
    return c.json({ error: 'Forbidden — supervisor role required' }, 403);
  }

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
      const { serve_queue_ids, officer_unit_id, shift_start, shift_end, ref_id } = body as {
        serve_queue_ids: number[];
        officer_unit_id: number;
        shift_start: string;
        shift_end: string;
        ref_id: number;
      };
      if (!serve_queue_ids?.length || !officer_unit_id || !shift_start || !shift_end || !ref_id) {
        return c.json({ error: 'serve_run requires serve_queue_ids, officer_unit_id, shift_start, shift_end, ref_id' }, 400);
      }
      const placeholders = serve_queue_ids.map(() => '?').join(',');
      const { results: stopRows } = await db
        .prepare(`SELECT id, recipient_address, recipient_lat, recipient_lng, time_window, deadline, priority FROM serve_queue WHERE id IN (${placeholders}) AND recipient_lat IS NOT NULL AND recipient_lng IS NOT NULL`)
        .bind(...serve_queue_ids)
        .all();
      const officerRow = await db
        .prepare('SELECT id, call_sign, latitude, longitude FROM units WHERE id = ? LIMIT 1')
        .bind(officer_unit_id)
        .first();
      if (!officerRow) return c.json({ error: 'officer unit not found' }, 404);
      problem = buildServeRunProblem(stopRows as unknown as ServeStop[], officerRow as unknown as UnitRow, shift_start, shift_end);
      refId = ref_id;
    } else if (job_type === 'patrol_beat') {
      const { beat_ids, unit_ids, shift_start, shift_end } = body as {
        beat_ids: number[];
        unit_ids: number[];
        shift_start: string;
        shift_end: string;
      };
      if (!beat_ids?.length || !unit_ids?.length || !shift_start || !shift_end) {
        return c.json({ error: 'patrol_beat requires beat_ids, unit_ids, shift_start, shift_end' }, 400);
      }
      const bPlaceholders = beat_ids.map(() => '?').join(',');
      const uPlaceholders = unit_ids.map(() => '?').join(',');
      const { results: beatRows } = await db
        .prepare(`SELECT id, beat_code, min_lat, max_lat, min_lng, max_lng FROM dispatch_beats WHERE id IN (${bPlaceholders}) AND active = 1`)
        .bind(...beat_ids)
        .all();
      const { results: unitRows } = await db
        .prepare(`SELECT id, call_sign, latitude, longitude FROM units WHERE id IN (${uPlaceholders})`)
        .bind(...unit_ids)
        .all();
      problem = buildPatrolBeatProblem(beatRows as unknown as BeatRow[], unitRows as unknown as UnitRow[], shift_start, shift_end);
    } else {
      const { call_ids, unit_ids } = body as { call_ids: number[]; unit_ids: number[] };
      if (!call_ids?.length || !unit_ids?.length) {
        return c.json({ error: 'multi_unit_dispatch requires call_ids and unit_ids' }, 400);
      }
      const cPlaceholders = call_ids.map(() => '?').join(',');
      const uPlaceholders = unit_ids.map(() => '?').join(',');
      const { results: callRows } = await db
        .prepare(`SELECT id, incident_number, latitude, longitude, priority FROM calls_for_service WHERE id IN (${cPlaceholders}) AND latitude IS NOT NULL AND longitude IS NOT NULL`)
        .bind(...call_ids)
        .all();
      const { results: unitRows } = await db
        .prepare(`SELECT id, call_sign, latitude, longitude FROM units WHERE id IN (${uPlaceholders}) AND status IN ('available','on_scene')`)
        .bind(...unit_ids)
        .all();
      problem = buildDispatchProblem(callRows as unknown as CallRow[], unitRows as unknown as UnitRow[]);
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
  const tk = getToken(c);
  if (!tk) return notConfigured(c, 'Mapbox Optimization V2 requires MAPBOX_ACCESS_TOKEN');

  const db = c.env.DB;
  const { jobId } = c.req.param();

  const row = await db
    .prepare('SELECT * FROM mapbox_optimization_v2_jobs WHERE id = ? LIMIT 1')
    .bind(jobId)
    .first() as Record<string, unknown> | null;

  if (!row) return c.json({ error: 'Job not found' }, 404);

  if (row.status === 'complete') {
    return c.json({ job_id: jobId, status: 'complete', solution: JSON.parse(row.solution_json as string) });
  }
  if (row.status === 'error') {
    return c.json({ job_id: jobId, status: 'error', error: row.error_message });
  }

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
        const orderedStops = route.stops
          .filter((s) => s.type === 'service')
          .map((s) => ({ id: Number(s.location), eta: s.eta, wait: s.wait ?? 0 }));
        await db
          .prepare(`UPDATE serve_routes SET optimized_order_json = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(JSON.stringify(orderedStops), row.ref_id)
          .run();
        log.info('[optimization-v2] serve_routes write-back complete', { refId: row.ref_id, stops: orderedStops.length });
      }
    } catch (err) {
      log.error('[optimization-v2] serve_routes write-back failed', { refId: row.ref_id }, err as Error);
    }
  }

  log.info('[optimization-v2] job complete', { jobId, routes: solution.routes.length, dropped: solution.dropped.services.length });
  return c.json({ job_id: jobId, status: 'complete', solution });
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
