// ============================================================
// Shift Swaps — 24-Hour Escalation Sweep
// ============================================================
// A shift-swap request can sit in 'pending' (awaiting the target
// officer's response) or 'pending_supervisor' (awaiting final approval)
// indefinitely with no reminder to anyone. This sweep, run from the
// existing daily 04:00 America/Denver cron block, escalates any swap
// that's been in either state for 24+ hours by notifying admin/manager
// via the notification-rule engine (2026-08-08 approval-workflow spec).
//
// escalated_at is the dedupe key: once stamped, a swap is never
// re-escalated, even though it stays matched by the status filter until
// someone actually acts on it. Without this, a swap stuck for a week
// would fire a fresh escalation notification every single day.
// ============================================================

import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import { query, execute } from './db';
import { evaluateNotificationRules } from '../routes/notificationEngine';

const ESCALATION_HOURS = 24;

interface StaleSwapRow {
  id: number;
  requester_id: number;
  target_id: number | null;
  status: string;
}

export async function sweepShiftSwapEscalations(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ escalated: number; notified: number }> {
  const cutoffModifier = `-${ESCALATION_HOURS} hours`;
  const staleSwaps = await query<StaleSwapRow>(
    db,
    `SELECT id, requester_id, target_id, status FROM shift_swap_requests
     WHERE escalated_at IS NULL
       AND (
         (status = 'pending' AND created_at <= datetime('now', ?))
         OR
         (status = 'pending_supervisor' AND target_responded_at <= datetime('now', ?))
       )`,
    cutoffModifier,
    cutoffModifier,
  );

  let escalated = 0;
  let notified = 0;

  for (const swap of staleSwaps) {
    await execute(
      db,
      `UPDATE shift_swap_requests SET escalated_at = datetime('now') WHERE id = ?`,
      swap.id,
    );
    escalated++;

    const { notified: n } = await evaluateNotificationRules(db, 'shift_swap_escalated', {
      title: 'Shift swap needs attention',
      message: `Swap request #${swap.id} has been awaiting action for over ${ESCALATION_HOURS} hours (status: ${swap.status})`,
      priority: 'warning',
      entity_type: 'shift_swap_request',
      entity_id: swap.id,
    }, env);
    notified += n;
  }

  return { escalated, notified };
}
