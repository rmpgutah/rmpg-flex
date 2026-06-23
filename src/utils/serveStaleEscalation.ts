// ============================================================
// RMPG Flex — Stale in-progress serve job escalation
// ============================================================
// Per-minute cron sweep: catches serve_queue rows stuck in
// status='in_progress' longer than STALE_THRESHOLD_HOURS (8h).
// On trigger:
//   1. Escalates urgency_tier → 'critical' + priority → 'rush'
//      (one-way ratchet; never demotes)
//   2. Writes a notification to the assigned officer + supervisors
//   3. Emits a live serve_stale_escalation alert via AlertHubDO
//   4. Debups via serve_nudges (condition='stale_in_progress');
//      re-fires no sooner than STALE_THRESHOLD_HOURS later.
// ============================================================

import type { Bindings } from '../types';
import { query, queryFirst, execute } from './db';
import { emitAlert } from './alertHub';

const STALE_THRESHOLD_HOURS = 8;

export async function sweepStaleInProgress(
  db: Bindings['DB'],
  env: Bindings,
): Promise<number> {
  // Guard: serve_nudges may not exist on legacy D1 installs.
  const tableOk = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='serve_nudges'`,
  ).catch(() => null);
  if (!tableOk?.n) return 0;

  const thresholdIso = new Date(Date.now() - STALE_THRESHOLD_HOURS * 3_600_000).toISOString();

  const stale = await query<{
    id: number;
    officer_id: number | null;
    recipient_name: string | null;
    defendant_name: string | null;
    case_number: string | null;
    priority: string;
    urgency_tier: string | null;
    updated_at: string | null;
  }>(
    db,
    `SELECT id, officer_id, recipient_name, defendant_name, case_number,
            priority, urgency_tier, updated_at
       FROM serve_queue
      WHERE status = 'in_progress'
        AND updated_at <= ?
      ORDER BY updated_at ASC
      LIMIT 100`,
    thresholdIso,
  ).catch(() => []);

  if (!stale.length) return 0;

  const supervisors = await query<{ id: number }>(
    db,
    "SELECT id FROM users WHERE role IN ('admin','manager','supervisor') LIMIT 50",
  ).catch(() => []);

  let escalated = 0;

  for (const job of stale) {
    try {
      // Dedup: only re-fire after another full threshold window has elapsed.
      const nudge = await queryFirst<{ last_notified_at: string }>(
        db,
        'SELECT last_notified_at FROM serve_nudges WHERE serve_queue_id = ? AND condition = ?',
        job.id, 'stale_in_progress',
      ).catch(() => null);

      if (nudge?.last_notified_at) {
        const sinceHours = (Date.now() - new Date(nudge.last_notified_at).getTime()) / 3_600_000;
        if (sinceHours < STALE_THRESHOLD_HOURS) continue;
      }

      const who = job.defendant_name ?? job.recipient_name ?? `Job #${job.id}`;
      const caseRef = job.case_number ? ` — Case ${job.case_number}` : '';

      // Escalate tier + priority (raise-only ratchet).
      const needsPriorityBump = job.priority === 'normal' || job.priority === 'routine';
      const priorityClause = needsPriorityBump ? `, priority = 'rush'` : '';
      await execute(
        db,
        `UPDATE serve_queue
            SET urgency_tier = 'critical',
                urgency_computed_at = datetime('now')
                ${priorityClause}
          WHERE id = ?`,
        job.id,
      );

      // Notifications to assigned officer + supervisors.
      const recipients = new Set<number>();
      if (job.officer_id != null) recipients.add(job.officer_id);
      for (const s of supervisors) recipients.add(s.id);

      for (const uid of recipients) {
        await execute(
          db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('serve_stale', 'high', 'Serve job stalled', ?, 'serve_job', ?, ?, 0, datetime('now','localtime'))`,
          `Job stalled in-progress >${STALE_THRESHOLD_HOURS}h: ${who}${caseRef}`,
          job.id, uid,
        );
      }

      await emitAlert(env, 'serve_stale_escalation', {
        action: 'serve_stale_escalation',
        queueId: job.id,
        officerId: job.officer_id,
        recipientName: who,
        caseNumber: job.case_number ?? null,
        staledAt: job.updated_at,
        priorityEscalated: needsPriorityBump,
        message: `Serve job stalled in-progress >${STALE_THRESHOLD_HOURS}h: ${who}${caseRef}`,
      });

      await execute(
        db,
        `INSERT INTO serve_nudges (serve_queue_id, condition, last_notified_at)
         VALUES (?, 'stale_in_progress', datetime('now','localtime'))
         ON CONFLICT(serve_queue_id, condition)
         DO UPDATE SET last_notified_at = datetime('now','localtime')`,
        job.id,
      );

      escalated++;
    } catch (err: any) {
      console.error(`[serve-stale] job ${job.id}:`, err?.message);
    }
  }

  return escalated;
}
