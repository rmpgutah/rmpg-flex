// Case-task due-date nudge sweep (v3 Phase 2). Mirrors serveNudgeSweep:
// runs on the 4-hourly cron ("0 */4 * * *") and dedups via the notifications
// table so each recipient is reminded at most once per ~20h per task.
import { log } from './logger';
import type { Bindings } from '../types';
import { query, queryFirst, execute } from './db';

/** Pure: classify a task's urgency by its due date. `now` injected for tests. */
export function classifyTaskDue(dueDate: string | null | undefined, now: Date): 'overdue' | 'due_soon' | null {
  if (!dueDate) return null;
  const due = new Date(`${String(dueDate).slice(0, 10)}T23:59:59`);
  if (isNaN(due.getTime())) return null;
  const diffH = (due.getTime() - now.getTime()) / 3600000;
  if (diffH < 0) return 'overdue';
  if (diffH <= 24) return 'due_soon';
  return null;
}

interface NudgeTask {
  id: number; title: string; due_date: string | null; status: string;
  assignee_id: number | null; case_id: number; case_number: string | null;
}

/**
 * Raise notifications for overdue / due-soon active tasks that have an
 * assignee. Recipients: the assignee + all supervisors. Returns the number
 * of notification rows inserted.
 */
export async function sweepCaseTaskNudges(db: Bindings['DB'], _env: Bindings): Promise<number> {
  let tasks: NudgeTask[] = [];
  try {
    tasks = await query<NudgeTask>(
      db,
      `SELECT t.id, t.title, t.due_date, t.status, t.assignee_id, c.id AS case_id, c.case_number
       FROM case_tasks t JOIN cases c ON t.case_id = c.id
       WHERE t.assignee_id IS NOT NULL
         AND t.status IN ('open','in_progress')
         AND t.due_date IS NOT NULL
         AND date(t.due_date) <= date('now','+1 day')`,
    );
  } catch { return 0; }
  if (!tasks.length) return 0;

  const supervisors = await query<{ id: number }>(
    db, "SELECT id FROM users WHERE role IN ('admin','manager','supervisor')",
  ).catch(() => [] as { id: number }[]);

  const now = new Date();
  let inserted = 0;

  for (const t of tasks) {
    const urgency = classifyTaskDue(t.due_date, now);
    if (!urgency) continue;

    const recipients = new Set<number>();
    if (t.assignee_id != null) recipients.add(t.assignee_id);
    for (const s of supervisors) recipients.add(s.id);

    const priority = urgency === 'overdue' ? 'high' : 'normal';
    const title = `Task ${urgency === 'overdue' ? 'overdue' : 'due soon'}: ${t.title}`;
    const message = `Case ${t.case_number ?? `#${t.case_id}`}: "${t.title}" is ${urgency === 'overdue' ? 'overdue' : `due ${t.due_date}`}.`;

    for (const uid of recipients) {
      // Per-recipient dedup: at most one nudge per task per user per 20h. Done
      // per-recipient (not per-task) so a transient insert failure for one
      // recipient never blocks the others from being notified next sweep.
      let recent: { one: number } | null = null;
      let dedupOk = true;
      try {
        recent = await queryFirst<{ one: number }>(
          db,
          `SELECT 1 AS one FROM notifications
           WHERE entity_type = 'case_task' AND entity_id = ? AND user_id = ? AND created_at > datetime('now','-20 hours') LIMIT 1`,
          t.id, uid,
        );
      } catch (err) {
        dedupOk = false;
        // Fail-closed: previously this swallow-to-null treated a failed dedup
        // SELECT as "no recent nudge" and re-inserted every 4h cron tick.
        // Better to miss one tick than to spam the recipient.
        log.error('dedup SELECT failed; skipping insert to avoid spam', { task_id: t.id, user_id: uid, error: String((err as Error)?.message ?? err) });
      }
      if (!dedupOk || recent) continue;
      try {
        await execute(
          db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('case_task_nudge', ?, ?, ?, 'case_task', ?, ?, 0, datetime('now'))`,
          priority, title, message, t.id, uid,
        );
        inserted++;
      } catch (err) {
        // Per-recipient best-effort: don't block the loop, but log so we can
        // see if a specific user/task is chronically failing.
        log.error('notification INSERT failed', { task_id: t.id, user_id: uid, error: String((err as Error)?.message ?? err) });
      }
    }
  }
  return inserted;
}
