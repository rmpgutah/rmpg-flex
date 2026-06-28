// ============================================================
// RMPG Flex — Auto skip-trace weekly cron sweep
// ============================================================
// Finds serve jobs that have hit the skip-trace threshold (3+
// failed attempts) but are still active, and whose prior auto
// skip-trace (if any) is at least 7 days old. Triggers a new
// auto skip-trace via maybeAutoSkipTrace with force=true,
// bypassing the single-fire nudge dedup so stale jobs get
// retried on a weekly cycle.
// ============================================================

import type { Bindings } from '../types';
import { query } from './db';
import { maybeAutoSkipTrace } from './serveSkipTraceAuto';

/**
 * Sweep all active serve jobs with attempt_count >= 3 that either
 * have no auto skip-trace or whose last auto skip-trace is > 7 days
 * old. Returns the count of new skip-traces created.
 */
export async function sweepAutoSkipTraces(
  db: Bindings['DB'],
  env: Bindings,
): Promise<number> {
  const jobs = await query<{ id: number }>(
    db,
    `SELECT q.id FROM serve_queue q
     LEFT JOIN (
       SELECT serve_queue_id, MAX(searched_at) AS last_auto_at
       FROM serve_skip_traces
       WHERE search_type = 'auto'
       GROUP BY serve_queue_id
     ) st ON st.serve_queue_id = q.id
     WHERE q.attempt_count >= 3
       AND q.status NOT IN ('served', 'cancelled', 'failed')
       AND (st.last_auto_at IS NULL
            OR st.last_auto_at <= datetime('now', '-7 days'))
     LIMIT 200`,
  ).catch(() => []);

  if (!jobs.length) return 0;

  let triggered = 0;
  for (const j of jobs) {
    const ok = await maybeAutoSkipTrace(db, env, j.id, { force: true }).catch(() => false);
    if (ok) triggered++;
  }
  return triggered;
}
