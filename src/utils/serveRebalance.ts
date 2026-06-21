// ============================================================
// RMPG Flex — Daily serve schedule rebalance
// ============================================================
// Runs at 04:00 America/Denver (driven by src/index.ts at UTC hour=10).
// For every pending/assigned serve_queue row:
//   1. Recompute urgency_tier from deadline + remaining attempts
//   2. If tier flipped to 'critical' AND priority NOT IN ('urgent'),
//      escalate priority='rush' (one-way ratchet — never demotes)
//   3. (PR 2/3 will add slot reshuffling here for non-manually_moved slots)
//
// Designed to be safe to run repeatedly. Returns counters for observability.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';
import { applyUrgencyTier, type UrgencyTier } from './serveDiligencePlanner';

export interface RebalanceResult {
  tiers_recomputed: number;
  tiers_promoted_critical: number;
  priority_escalated: number;
  slots_skipped_manual: number;
}

interface QueueRow {
  id: number;
  deadline: string | null;
  max_attempts: number;
  attempt_count: number;
  priority: string;
  urgency_tier: string | null;
}

export async function runDailyRebalance(db: D1Database, nowIso: string): Promise<RebalanceResult> {
  const rows = await query<QueueRow>(
    db,
    `SELECT id, deadline, max_attempts, attempt_count, priority, urgency_tier
       FROM serve_queue
      WHERE status IN ('pending', 'assigned', 'in_progress')`,
  );

  let tiers_recomputed = 0;
  let tiers_promoted_critical = 0;
  let priority_escalated = 0;
  const slots_skipped_manual = 0; // populated in PR 2/3 when slot reshuffling lands

  for (const row of rows) {
    const newTier: UrgencyTier = applyUrgencyTier(
      row.deadline,
      row.attempt_count,
      row.max_attempts,
      nowIso,
    );

    const escalate = newTier === 'critical'
      && row.urgency_tier !== 'critical'
      && row.priority !== 'urgent';

    if (newTier !== row.urgency_tier) tiers_recomputed++;
    if (newTier === 'critical' && row.urgency_tier !== 'critical') tiers_promoted_critical++;
    if (escalate) priority_escalated++;

    const priorityClause = escalate ? `, priority = 'rush'` : '';
    await execute(
      db,
      `UPDATE serve_queue
          SET urgency_tier = ?, urgency_computed_at = datetime('now') ${priorityClause}
        WHERE id = ?`,
      newTier, row.id,
    );
  }

  return { tiers_recomputed, tiers_promoted_critical, priority_escalated, slots_skipped_manual };
}
