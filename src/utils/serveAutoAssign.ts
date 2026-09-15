// ============================================================
// RMPG Flex — Process Server auto-assignment engine
// ============================================================
// Assigns a serve_queue job to the active officer with the
// fewest currently open (non-terminal) jobs. Called fire-and-
// forget from serveIntakeRecords.ts after commitOneIntake when
// no explicit officer_id was supplied at intake.
//
// Also exposed as a batch helper used by the
// POST /api/serve/assignments/auto-assign-all route so a
// supervisor can bulk-assign a fresh queue in one click.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';

export interface AutoAssignResult {
  assigned: boolean;
  officer_id: number | null;
  officer_name: string | null;
  reason: string;
}

/**
 * Assign `queueId` to the active officer with the fewest open jobs.
 * No-ops when the job is already assigned (unless `force` is true)
 * or when no eligible officers exist.
 */
export async function autoAssignServeJob(
  db: D1Database,
  queueId: number,
  opts: { force?: boolean } = {},
): Promise<AutoAssignResult> {
  const job = await queryFirst<{ id: number; officer_id: number | null; status: string }>(
    db, 'SELECT id, officer_id, status FROM serve_queue WHERE id = ?', queueId,
  );
  if (!job) return { assigned: false, officer_id: null, officer_name: null, reason: 'job_not_found' };
  if (['served', 'cancelled', 'failed'].includes(job.status)) {
    return { assigned: false, officer_id: null, officer_name: null, reason: 'job_closed' };
  }
  if (job.officer_id != null && !opts.force) {
    return { assigned: false, officer_id: job.officer_id, officer_name: null, reason: 'already_assigned' };
  }

  // Pick the officer with the lowest open-job count among on-duty officers.
  // Eligibility: role='officer', must have at least one unit whose status is
  // not 'off_duty' or 'out_of_service'. Falls back to all role='officer' users
  // when no unit rows exist (e.g. a fresh install with no units table rows yet),
  // so new deployments auto-assign rather than silently no-oping.
  const candidates = await query<{ id: number; full_name: string; open_count: number }>(
    db,
    `SELECT u.id, u.full_name,
            COUNT(q.id) AS open_count
       FROM users u
       LEFT JOIN serve_queue q
         ON q.officer_id = u.id
        AND q.status NOT IN ('served','cancelled','failed')
      WHERE u.role = 'officer'
        AND (
          EXISTS (
            SELECT 1 FROM units un
             WHERE un.officer_id = u.id
               AND un.status NOT IN ('off_duty','out_of_service')
          )
          OR NOT EXISTS (SELECT 1 FROM units WHERE officer_id = u.id)
        )
      GROUP BY u.id, u.full_name
      ORDER BY open_count ASC, u.id ASC
      LIMIT 1`,
  ).catch(() => []);

  if (!candidates.length) {
    return { assigned: false, officer_id: null, officer_name: null, reason: 'no_eligible_officers' };
  }
  const pick = candidates[0];

  const newStatus = job.status === 'pending' ? 'assigned' : job.status;
  await execute(
    db,
    "UPDATE serve_queue SET officer_id = ?, status = ?, auto_assigned = 1, updated_at = datetime('now') WHERE id = ?",
    pick.id, newStatus, queueId,
  );

  await execute(
    db,
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
     VALUES (NULL, 'auto_assign', 'serve_assignment', ?, ?)`,
    queueId,
    JSON.stringify({ to_officer: pick.id, to_officer_name: pick.full_name, open_count: pick.open_count }),
  ).catch(() => {});

  return { assigned: true, officer_id: pick.id, officer_name: pick.full_name, reason: 'auto_assigned' };
}

/**
 * Batch-assign every unassigned pending job. Called from the
 * POST /assignments/auto-assign-all supervisor route.
 * Returns count of newly assigned jobs.
 */
export async function autoAssignAllUnassigned(db: D1Database): Promise<number> {
  const unassigned = await query<{ id: number }>(
    db,
    `SELECT id FROM serve_queue
      WHERE officer_id IS NULL AND status = 'pending'
      ORDER BY deadline IS NULL ASC, deadline ASC, id ASC
      LIMIT 500`,
  ).catch(() => []);

  let assigned = 0;
  for (const { id } of unassigned) {
    const r = await autoAssignServeJob(db, id);
    if (r.assigned) assigned++;
  }
  return assigned;
}
