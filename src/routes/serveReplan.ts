// ============================================================
// RMPG Flex — Serve intake auto-replan on failed attempt
// ============================================================
// POST /api/serve-intake/schedule/:queueId/replan-on-failure
// 
// When an officer logs a failed attempt (no_answer | refused | bad_address),
// this route triggers the auto-replan: computes the next attempt window,
// persists it, updates urgency tier, and broadcasts the refresh alert.
// ============================================================

import { Hono } from 'hono';
import { execute, queryFirst } from '../utils/db';
import { replanAfterFailedAttempt } from '../utils/serveDiligencePlanner';
import { appendAttemptSlot } from '../utils/serveAttemptScheduler';
import { applyUrgencyTier } from '../utils/serveDiligencePlanner';
import { emitAlert } from '../utils/alertHub';
import type { Bindings, HonoEnv } from '../types';

const router = new Hono<HonoEnv>();

interface ReplanRequest {
  attempt_at: string;       // ISO timestamp of the failed attempt
  result: string;           // 'no_answer' | 'refused' | 'bad_address' | 'moved'
  window?: string | null;   // the band that failed (e.g. '17:00–20:30')
}

interface ReplanResponse {
  success: boolean;
  next_window?: {
    attempt: number;
    date: string;
    weekday: string;
    window: string;
    focus: string;
  } | null;
  message?: string;
  exhausted?: boolean;
}

// POST /api/serve-intake/schedule/:queueId/replan-on-failure
router.post('/:queueId/replan-on-failure', async (c) => {
  const queueId = Number(c.req.param('queueId'));
  if (!Number.isFinite(queueId) || queueId <= 0) {
    return c.json({ error: 'invalid queueId' }, 400);
  }

  const body = await c.req.json<ReplanRequest>().catch(() => null);
  if (!body?.attempt_at || !body?.result) {
    return c.json({ error: 'missing required fields: attempt_at, result' }, 400);
  }

  const db = c.env.DB;
  const env = c.env;

  try {
    // Fetch the queue row
    const queue = await queryFirst<any>(
      db,
      `SELECT id, case_number, recipient_name, recipient_address, deadline,
              attempt_count, max_attempts, priority, status, 
              parsed_data, recipient_lat, recipient_lng
       FROM serve_queue WHERE id = ?`,
      queueId,
    );

    if (!queue) {
      return c.json({ error: 'queue not found' }, 404);
    }

    if (queue.status === 'served' || queue.status === 'cancelled' || queue.status === 'failed') {
      return c.json({ error: `cannot replan: status=${queue.status}` }, 409);
    }

    const parsed = typeof queue.parsed_data === 'string' ? JSON.parse(queue.parsed_data) : queue.parsed_data;
    const { isBusiness, locationNote } = parsed?._intake ?? {};

    // Compute next window
    const next = replanAfterFailedAttempt(
      {
        attempt_at: body.attempt_at,
        result: body.result,
        window: body.window ?? null,
      },
      {
        deadline: queue.deadline,
        max_attempts: queue.max_attempts,
        attempt_count: queue.attempt_count,
        recipient_lat: queue.recipient_lat,
        recipient_lng: queue.recipient_lng,
        isBusiness: isBusiness ?? false,
        locationNote: locationNote ?? null,
      },
    );

    if (!next) {
      // Max attempts exhausted
      await execute(
        db,
        `UPDATE serve_queue SET status = 'failed', 
         updated_at = datetime('now','localtime') WHERE id = ?`,
        queueId,
      );

      await emitAlert(env, 'serve_attempt_exhausted', {
        queueId,
        caseNumber: queue.case_number,
        recipientName: queue.recipient_name,
        message: `Max attempts exhausted for ${queue.recipient_name} (${queue.case_number})`,
      });

      return c.json<ReplanResponse>({
        success: true,
        exhausted: true,
        message: 'Max attempts exhausted — serve queue marked as failed',
      });
    }

    // Persist the new slot
    await appendAttemptSlot(db, queueId, next, new Date().toISOString());

    // Increment attempt_count
    await execute(
      db,
      `UPDATE serve_queue SET attempt_count = attempt_count + 1,
       updated_at = datetime('now','localtime') WHERE id = ?`,
      queueId,
    );

    // Recompute urgency tier
    const newTier = applyUrgencyTier(
      queue.deadline,
      queue.attempt_count + 1,
      queue.max_attempts,
      new Date().toISOString(),
    );

    await execute(
      db,
      `UPDATE serve_queue SET urgency_tier = ? WHERE id = ?`,
      newTier,
      queueId,
    );

    // Broadcast refresh alert
    await emitAlert(env, 'serve_attempt_rescheduled', {
      queueId,
      attemptNumber: next.attempt,
      scheduledDate: next.date,
      window: next.window,
      caseNumber: queue.case_number,
      recipientName: queue.recipient_name,
      message: `Attempt #${next.attempt} rescheduled for ${next.date} ${next.window}`,
    });

    return c.json<ReplanResponse>({
      success: true,
      next_window: next,
    });
  } catch (err) {
    console.error(`[serve-replan] failed for queue=${queueId}:`, err);
    return c.json(
      {
        error: 'replan failed',
        detail: (err as Error).message,
      },
      500,
    );
  }
});

export default router;
