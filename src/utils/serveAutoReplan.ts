// ============================================================
// RMPG Flex — Auto re-plan attempt slot after failed attempt
// ============================================================
// When logAttempt() sets queue status to 'attempted', append the next
// diligence window to serve_attempt_schedules so the route planner can
// honor it (e.g. 18:00–21:00 the same day after an afternoon no-answer).
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { execute, queryFirst } from './db';
import { appendAttemptSlot } from './serveAttemptScheduler';
import { applyUrgencyTier, replanAfterFailedAttempt } from './serveDiligencePlanner';
import { loadPersistedPlanContext } from './servePlanContext';
import { log } from './logger';

const REPLAN_RESULTS = new Set(['no_answer', 'refused', 'bad_address', 'moved', 'wrong_address', 'other']);

export interface NextAttemptSlotSummary {
  slot_id: number;
  scheduled_date: string;
  window: string;
}

export async function scheduleNextServeAttempt(
  db: D1Database,
  queueId: number,
  attemptId: number,
  result: string,
  attemptAtIso: string,
  failedWindow: string | null,
): Promise<NextAttemptSlotSummary | null> {
  if (!REPLAN_RESULTS.has(result)) return null;

  try {
    const tableExists = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='serve_attempt_schedules'`,
    ).catch(() => null);
    if (!tableExists?.n) return null;

    const job = await queryFirst<{
      id: number;
      deadline: string | null;
      max_attempts: number;
      attempt_count: number;
      business_id: number | null;
      recipient_lat: number | null;
      recipient_lng: number | null;
      recipient_type: string | null;
    }>(
      db,
      `SELECT id, deadline, max_attempts, attempt_count, business_id,
              recipient_lat, recipient_lng,
              parsed_data->>'recipient_type' AS recipient_type
         FROM serve_queue WHERE id = ?`,
      queueId,
    );
    if (!job) return null;
    if (job.attempt_count >= (job.max_attempts ?? 3)) return null;

    const ctx = await loadPersistedPlanContext(db, queueId);
    const next = replanAfterFailedAttempt(
      { attempt_at: attemptAtIso, result, window: failedWindow },
      {
        deadline: job.deadline,
        max_attempts: job.max_attempts ?? 3,
        attempt_count: Math.max(0, (job.attempt_count ?? 1) - 1),
        recipient_lat: job.recipient_lat,
        recipient_lng: job.recipient_lng,
        isBusiness: !!(job.business_id || (job.recipient_type || '').toLowerCase() === 'business'),
        addressClass: ctx.addressClass,
        addressClassConfirmed: ctx.addressClassConfirmed,
        clientBands: ctx.clientBands,
        allowedDays: ctx.allowedDays,
        startNotBefore: ctx.startNotBefore,
      },
    );
    if (!next) return null;

    await appendAttemptSlot(db, queueId, next, attemptAtIso);

    const slot = await queryFirst<{ id: number; scheduled_date: string; window_start: string; window_end: string }>(
      db,
      `SELECT id, scheduled_date, window_start, window_end
         FROM serve_attempt_schedules
        WHERE queue_id = ? AND scheduled_date = ?
        ORDER BY id DESC LIMIT 1`,
      queueId, next.date,
    );
    if (!slot) return null;

    await execute(
      db,
      `UPDATE serve_attempt_schedules SET auto_replan_source = ? WHERE id = ?`,
      attemptId, slot.id,
    ).catch(() => null);

    const tier = applyUrgencyTier(job.deadline, job.attempt_count, job.max_attempts ?? 3, attemptAtIso);
    const priorityClause = tier === 'critical'
      ? `, priority = CASE WHEN priority IN ('urgent') THEN priority ELSE 'rush' END`
      : '';
    await execute(
      db,
      `UPDATE serve_queue SET urgency_tier = ?, urgency_computed_at = datetime('now') ${priorityClause} WHERE id = ?`,
      tier, queueId,
    ).catch(() => null);

    return {
      slot_id: slot.id,
      scheduled_date: slot.scheduled_date,
      window: `${slot.window_start}-${slot.window_end}`,
    };
  } catch (err) {
    log.warn('[serve] scheduleNextServeAttempt failed', { queueId, err: String(err) });
    return null;
  }
}
