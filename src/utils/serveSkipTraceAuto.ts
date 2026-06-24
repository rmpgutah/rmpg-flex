// ============================================================
// RMPG Flex — Auto skip-trace trigger
// ============================================================
// Logs a skip-trace request when a serve job accumulates
// SKIP_TRACE_THRESHOLD (3) failed attempts and has no existing
// skip-trace entry. Saves the officer from having to manually
// request it on every stale job.
//
// The `force` option (used by autoSkipTraceSweep cron) bypasses
// both dedup checks so that stale jobs whose prior auto skip-trace
// returned no results are retried on a weekly cycle.
// ============================================================

import type { Bindings } from '../types';
import { query, queryFirst, execute } from './db';
import { emitAlert } from './alertHub';

const SKIP_TRACE_THRESHOLD = 3;

/**
 * If this job has hit the skip-trace threshold and has no existing
 * skip-trace entry, insert a 'manual' skip-trace row and notify
 * supervisors + the assigned officer. Returns true on trigger.
 *
 * @param options.force — when true, skip dedup checks (nudge + existing
 *   skip-trace). Used by the weekly cron sweep to retry jobs whose
 *   prior auto skip-trace found no results.
 */
export async function maybeAutoSkipTrace(
  db: Bindings['DB'],
  env: Bindings,
  queueId: number,
  options?: { force?: boolean },
): Promise<boolean> {
  try {
    const job = await queryFirst<{
      attempt_count: number;
      recipient_name: string | null;
      defendant_name: string | null;
      case_number: string | null;
      officer_id: number | null;
    }>(db,
      'SELECT attempt_count, recipient_name, defendant_name, case_number, officer_id FROM serve_queue WHERE id = ?',
      queueId,
    );
    if (!job || (job.attempt_count ?? 0) < SKIP_TRACE_THRESHOLD) return false;

    // Dedup checks — skip when force=true (cron retry after 7 days).
    if (!options?.force) {
      // Already triggered for this job?
      const alreadyDone = await queryFirst<{ id: number }>(
        db,
        'SELECT id FROM serve_nudges WHERE serve_queue_id = ? AND condition = ?',
        queueId, 'auto_skip_trace',
      ).catch(() => null);
      if (alreadyDone) return false;

      // Already has any skip-trace entry (manual or prior auto)?
      const hasTrace = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM serve_skip_traces WHERE serve_queue_id = ? LIMIT 1', queueId,
      ).catch(() => null);
      if (hasTrace) {
        // Mark dedup so we don't keep checking on every subsequent attempt.
        await execute(db,
          `INSERT INTO serve_nudges (serve_queue_id, condition, last_notified_at)
           VALUES (?, 'auto_skip_trace', datetime('now','localtime'))
           ON CONFLICT(serve_queue_id, condition)
           DO UPDATE SET last_notified_at = datetime('now','localtime')`,
          queueId,
        ).catch(() => {});
        return false;
      }
    }

    const who = job.defendant_name ?? job.recipient_name ?? `Job #${queueId}`;
    const caseRef = job.case_number ? ` (Case ${job.case_number})` : '';

    // Insert the skip-trace row using the existing schema:
    // serve_queue_id, search_type, search_query, results_json,
    // addresses_found_json, searched_by
    await execute(db,
      `INSERT INTO serve_skip_traces
         (serve_queue_id, search_type, search_query, results_json, addresses_found_json, searched_by)
       VALUES (?, 'auto', ?, ?, '[]', NULL)`,
      queueId,
      `Auto-requested after ${job.attempt_count} failed attempts on ${who}${caseRef}`,
      JSON.stringify({ triggered_by: 'auto', attempt_count: job.attempt_count }),
    ).catch(() => {});

    // Notify supervisors + assigned officer.
    const supervisors = await query<{ id: number }>(
      db, "SELECT id FROM users WHERE role IN ('admin','manager','supervisor') LIMIT 50",
    ).catch(() => []);

    const recipients = new Set<number>();
    if (job.officer_id != null) recipients.add(job.officer_id);
    for (const s of supervisors) recipients.add(s.id);

    for (const uid of recipients) {
      await execute(db,
        `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
         VALUES ('serve_skip_trace_auto', 'normal', 'Auto skip-trace requested', ?, 'serve_job', ?, ?, 0, datetime('now','localtime'))`,
        `Skip-trace auto-requested for ${who}${caseRef} after ${job.attempt_count} failed attempts`,
        queueId, uid,
      );
    }

    await emitAlert(env, 'serve_skip_trace_auto', {
      action: 'serve_skip_trace_auto',
      queueId,
      officerId: job.officer_id,
      recipientName: who,
      caseNumber: job.case_number ?? null,
      attemptCount: job.attempt_count,
      message: `Skip-trace auto-requested for ${who}${caseRef} after ${job.attempt_count} failed attempts`,
    });

    // Dedup mark
    await execute(db,
      `INSERT INTO serve_nudges (serve_queue_id, condition, last_notified_at)
       VALUES (?, 'auto_skip_trace', datetime('now','localtime'))
       ON CONFLICT(serve_queue_id, condition)
       DO UPDATE SET last_notified_at = datetime('now','localtime')`,
      queueId,
    ).catch(() => {});

    return true;
  } catch (err: any) {
    console.error(`[serve-skip-trace-auto] job ${queueId}:`, err?.message);
    return false;
  }
}
