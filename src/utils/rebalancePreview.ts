// ============================================================
// RMPG Flex — Serve schedule rebalance preview (pure)
// ============================================================
// Same logic as src/utils/serveRebalance.runDailyRebalance but
// returns the proposed diff instead of writing. Used by the
// POST /serve-intake/schedule/rebalance endpoint to back the
// "Preview rebalance" modal.
// ============================================================

import { applyUrgencyTier, type UrgencyTier } from './serveDiligencePlanner';

export interface RebalanceQueueRow {
  id: number;
  deadline: string | null;
  max_attempts: number;
  attempt_count: number;
  priority: string;
  urgency_tier: string | null;
}

export interface RebalanceChange {
  queue_id: number;
  from_tier: string | null;
  to_tier: UrgencyTier;
  from_priority: string;
  to_priority: 'rush' | null;
  reason: 'urgency_promotion' | 'tier_demotion' | 'tier_drift';
}

export interface RebalancePreview {
  changes: RebalanceChange[];
  skipped_manual: number;
  tiers_promoted_critical: number;
  priority_escalated: number;
}

export function previewRangeRebalance(
  rows: RebalanceQueueRow[],
  nowIso: string,
): RebalancePreview {
  const changes: RebalanceChange[] = [];
  let tiers_promoted_critical = 0;
  let priority_escalated = 0;
  const skipped_manual = 0; // populated when slot-level manual-move detection lands

  for (const r of rows) {
    const newTier = applyUrgencyTier(r.deadline, r.attempt_count, r.max_attempts, nowIso);
    if (newTier === r.urgency_tier) continue;

    const promoteCritical = newTier === 'critical' && r.urgency_tier !== 'critical';
    const escalate = promoteCritical && r.priority !== 'urgent';

    if (promoteCritical) tiers_promoted_critical++;
    if (escalate) priority_escalated++;

    let reason: RebalanceChange['reason'];
    if (promoteCritical) reason = 'urgency_promotion';
    else if (newTier === 'standard' && r.urgency_tier !== 'standard') reason = 'tier_demotion';
    else reason = 'tier_drift';

    changes.push({
      queue_id: r.id,
      from_tier: r.urgency_tier,
      to_tier: newTier,
      from_priority: r.priority,
      to_priority: escalate ? 'rush' : null,
      reason,
    });
  }

  changes.sort((a, b) => a.queue_id - b.queue_id);
  return { changes, skipped_manual, tiers_promoted_critical, priority_escalated };
}
