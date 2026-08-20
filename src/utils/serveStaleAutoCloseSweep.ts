// ============================================================
// Serve Queue Stale Auto-Close Sweep
// ============================================================
// src/routes/serveQueueEnhanced.ts's POST /auto-close-stale has existed
// as an admin-triggerable tool since it was built, but has zero client
// callers anywhere - no UI button, no automation, nothing ever invoked
// it. Reuses that route's exact logic (same query, same 30-day default,
// same activity_log entry) as a daily cron sweep instead, since the
// route's own design already represents "just close these out" (a
// reversible status flip to 'failed', not permanent data destruction
// like evidence retention/disposal - so unlike that sweep, this one
// really does execute automatically) plus a notification so staff see
// it happened, via the same notification-rule engine pattern used by
// the fleet-maintenance/cert-expiration sweeps.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, execute, executeInChunks } from './db';
import { evaluateNotificationRules } from '../routes/notificationEngine';

const STALE_DAYS = 30;

export async function sweepStaleServeJobs(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ closed: number }> {
  const staleJobs = await query<{ id: number }>(db, `
    SELECT q.id
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
      LIMIT 500
  `, STALE_DAYS, STALE_DAYS);

  if (staleJobs.length === 0) return { closed: 0 };

  const ids = staleJobs.map((j) => j.id);
  // D1 rejects >100 bound parameters AT BIND TIME. The select above takes
  // LIMIT 500, so this UPDATE was a guaranteed failure the first time more
  // than 100 jobs went stale -- and it is a cron sweep, so nobody would have
  // seen the throw. Chunked writes are not atomic, which is fine here: the
  // status flip is idempotent and a partial run simply closes fewer jobs,
  // with the next sweep picking up the remainder.
  await executeInChunks(
    db, ids,
    (placeholders) => `UPDATE serve_queue SET status = 'failed', updated_at = datetime('now'), closed_at = datetime('now') WHERE id IN (${placeholders})`,
  );

  await execute(db,
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (NULL, 'auto_close_stale', 'serve_queue', 0, ?)`,
    JSON.stringify({ stale_days: STALE_DAYS, closed_count: ids.length, queue_ids: ids, source: 'cron' }));

  await evaluateNotificationRules(db, 'serve_jobs_auto_closed', {
    title: `${ids.length} stale process-service job(s) auto-closed`,
    message: `${ids.length} job(s) with no activity for ${STALE_DAYS}+ days were automatically marked 'failed'. Review Admin > Serve Queue if any need reopening.`,
    priority: 'normal',
    entity_type: 'serve_queue',
  }, env);

  return { closed: ids.length };
}
