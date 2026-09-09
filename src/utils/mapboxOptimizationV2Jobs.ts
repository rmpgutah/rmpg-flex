import { resolveOptimizationV2Token, type V2Solution } from './mapboxOptimizationV2';
import { log } from './logger';

export interface OptimizationJob {
  id: string;
  job_type: string;
  status: string;
  ref_id: number | null;
  created_at: string;
  problem_json: string;
  solution_json: string | null;
  error_message: string | null;
}

/** The API describes mileage on stops, and does not promise route summaries. */
export function normalizeOptimizationSolution(value: unknown): V2Solution {
  const solution = value as V2Solution;
  if (!solution || !Array.isArray(solution.routes) ||
      !Array.isArray(solution.dropped?.services) || !Array.isArray(solution.dropped?.shipments)) {
    throw new Error('invalid_solution');
  }
  for (const route of solution.routes) {
    if (!route || typeof route.vehicle !== 'string' || !Array.isArray(route.stops)) throw new Error('invalid_solution');
    if (route.stops.some(stop => !stop || !Number.isFinite(Date.parse(stop.eta)))) throw new Error('invalid_solution');
    const first = route.stops[0];
    const last = route.stops.at(-1);
    const odometers = route.stops.map(s => s.odometer).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    route.distance ??= odometers.length ? Math.max(0, Math.max(...odometers) - (first?.odometer ?? 0)) : 0;
    route.duration ??= first && last ? Math.max(0, (Date.parse(last.eta) - Date.parse(first.eta)) / 1000 + (last.duration ?? 0) + (last.wait ?? 0)) : 0;
  }
  return solution;
}

export async function pollOptimizationV2Job(db: D1Database, token: string | null, job: OptimizationJob) {
  let avgMpg: number | null = null;
  try { avgMpg = JSON.parse(job.problem_json)?.options?.avg_mpg ?? null; } catch { /* Older rows may lack metadata. */ }
  if (job.status === 'complete') return { job_id: job.id, status: 'complete', solution: normalizeOptimizationSolution(JSON.parse(job.solution_json!)), avg_mpg: avgMpg };
  if (job.status === 'error') return { job_id: job.id, status: 'error', error: job.error_message };
  const fail = async (error: string) => {
    await db.prepare("UPDATE mapbox_optimization_v2_jobs SET status='error', error_message=?, updated_at=datetime('now') WHERE id=? AND status IN ('pending','processing')").bind(error, job.id).run();
    return { job_id: job.id, status: 'error', error };
  };
  const created = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(job.created_at) ? job.created_at : `${job.created_at.replace(' ', 'T')}Z`);
  if (Number.isFinite(created) && Date.now() - created > 10 * 60_000) return fail('timed_out');
  if (!token) return { job_id: job.id, status: 'processing', error: 'not_configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://api.mapbox.com/optimized-trips/v2/${encodeURIComponent(job.id)}?access_token=${encodeURIComponent(token)}`, { signal: controller.signal });
    if (response.status === 202) {
      await db.prepare("UPDATE mapbox_optimization_v2_jobs SET status='processing', updated_at=datetime('now') WHERE id=? AND status IN ('pending','processing')").bind(job.id).run();
      return { job_id: job.id, status: 'processing' };
    }
    if ([401, 403, 404, 422].includes(response.status)) return fail(`http_${response.status}`);
    if (response.status !== 200) return { job_id: job.id, status: 'processing', error: `http_${response.status}` };
    const solution = normalizeOptimizationSolution(await response.json());
    const statements: D1PreparedStatement[] = [];
    const route = solution.routes[0];
    if (job.job_type === 'serve_run' && job.ref_id != null && route) {
      const ids = [...new Set(route.stops.filter(s => s.type === 'service').flatMap(s => s.services ?? [s.location]).map(Number))];
      if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('invalid_service_ids');
      // Completion and domain write-back commit together. A stale solve cannot
      // overwrite a newer optimization submitted for the same saved route.
      statements.push(db.prepare(`UPDATE serve_routes SET optimized_order_json=?, total_distance_miles=?, total_time_minutes=?, updated_at=datetime('now')
        WHERE id=? AND EXISTS (SELECT 1 FROM mapbox_optimization_v2_jobs WHERE id=? AND status IN ('pending','processing'))
        AND NOT EXISTS (SELECT 1 FROM mapbox_optimization_v2_jobs newer WHERE newer.ref_id=? AND newer.job_type='serve_run' AND newer.rowid > (SELECT rowid FROM mapbox_optimization_v2_jobs WHERE id=?))`)
        .bind(JSON.stringify(ids), Math.round((route.distance! / 1609.344) * 10) / 10, Math.round(route.duration! / 60), job.ref_id, job.id, job.ref_id, job.id));
    }
    statements.push(db.prepare("UPDATE mapbox_optimization_v2_jobs SET status='complete', solution_json=?, error_message=NULL, updated_at=datetime('now') WHERE id=? AND status IN ('pending','processing')").bind(JSON.stringify(solution), job.id));
    await db.batch(statements);
    return { job_id: job.id, status: 'complete', solution, avg_mpg: avgMpg };
  } catch (error) {
    log.error('[optimization-v2] poll failed', { jobId: job.id }, error instanceof Error ? error : new Error(String(error)));
    return { job_id: job.id, status: 'processing', error: 'poll_failed' };
  } finally { clearTimeout(timer); }
}

export async function sweepOptimizationV2Jobs(env: { DB: D1Database; MAPBOX_SECRET_TOKEN?: string; MAPBOX_ACCESS_TOKEN?: string }) {
  const token = resolveOptimizationV2Token(env);
  if (!token) return;
  const { results } = await env.DB.prepare("SELECT * FROM mapbox_optimization_v2_jobs WHERE status IN ('pending','processing') ORDER BY updated_at ASC LIMIT 10").all<OptimizationJob>();
  for (const job of results) await pollOptimizationV2Job(env.DB, token, job);
}
