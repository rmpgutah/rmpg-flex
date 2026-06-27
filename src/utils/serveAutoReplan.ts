// ============================================================
// RMPG Flex — Auto re-plan attempt slot after failed attempt
// ============================================================
// When logAttempt() sets queue status to 'attempted' (i.e. a
// non-terminal failure with attempts remaining), this helper
// appends one new future attempt slot to serve_attempt_schedules
// so the calendar doesn't go empty.
//
// A 24-hour cooling-off period is enforced: the new slot will
// always be at least 24h from now. A slot is only added when no
// un-notified future slot already exists for this job.
//
// Call fire-and-forget; failures are swallowed by the caller.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst } from './db';
import { appendAttemptSlot } from './serveAttemptScheduler';
import { planAttemptWindows } from './serveDiligencePlanner';

const COOLING_HOURS = 24;

/**
 * Append one new attempt schedule slot after a non-terminal failure.
 * Returns true if a slot was added, false if already covered or
 * no plan could be generated.
 */
export async function autoReplanAfterAttempt(
  db: D1Database,
  queueId: number,
  nextAttemptNumber: number,
  nowIso: string,
): Promise<boolean> {
  try {
    // Guard: serve_attempt_schedules may not be live on all D1 installs.
    const tableExists = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='serve_attempt_schedules'`,
    ).catch(() => null);
    if (!tableExists?.n) return false;

    // Don't add a slot when one already exists that hasn't fired yet.
    const futureSlot = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM serve_attempt_schedules
        WHERE queue_id = ? AND scheduled_date > date('now')
          AND notified = 0 AND dismissed = 0
       ORDER BY scheduled_date ASC LIMIT 1`,
      queueId,
    ).catch(() => null);
    if (futureSlot) return false;

    const job = await queryFirst<{
      deadline: string | null;
      max_attempts: number;
      attempt_count: number;
    }>(db, 'SELECT deadline, max_attempts, attempt_count FROM serve_queue WHERE id = ?', queueId);
    if (!job) return false;

    // Don't schedule beyond the remaining attempt budget.
    if (nextAttemptNumber >= (job.max_attempts ?? 3)) return false;

    // Plan from the cooling window forward. planAttemptWindows uses
    // deadline + Denver timezone so DST is handled correctly.
    const coolingStartIso = new Date(Date.parse(nowIso) + COOLING_HOURS * 3_600_000).toISOString();
    const plan = planAttemptWindows(coolingStartIso, job.deadline, 'America/Denver', {
      isBusiness: false,
      locationNote: null,
    });
    if (!plan.length) return false;

    // Take only the first window; sequential re-planning keeps the
    // calendar realistic rather than flooding it with speculative slots.
    const nextSlot = { ...plan[0], attempt: nextAttemptNumber };
    await appendAttemptSlot(db, queueId, nextSlot, nowIso);
    return true;
  } catch {
    return false;
  }
}
