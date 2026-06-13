// Case-task due-date nudge sweep (v3 Phase 2). Mirrors serveNudgeSweep:
// runs on the per-minute cron but dedups via the notifications table so an
// assignee/supervisor is reminded at most once per ~20h per task.
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

    // Dedup: skip if this task was already nudged in the last 20h.
    const recent = await queryFirst<{ one: number }>(
      db,
      `SELECT 1 AS one FROM notifications
       WHERE entity_type = 'case_task' AND entity_id = ? AND created_at > datetime('now','-20 hours') LIMIT 1`,
      t.id,
    ).catch(() => null);
    if (recent) continue;

    const recipients = new Set<number>();
    if (t.assignee_id != null) recipients.add(t.assignee_id);
    for (const s of supervisors) recipients.add(s.id);

    const priority = urgency === 'overdue' ? 'high' : 'normal';
    const title = `Task ${urgency === 'overdue' ? 'overdue' : 'due soon'}: ${t.title}`;
    const message = `Case ${t.case_number ?? `#${t.case_id}`}: "${t.title}" is ${urgency === 'overdue' ? 'overdue' : `due ${t.due_date}`}.`;

    for (const uid of recipients) {
      try {
        await execute(
          db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('case_task_nudge', ?, ?, ?, 'case_task', ?, ?, 0, datetime('now'))`,
          priority, title, message, t.id, uid,
        );
        inserted++;
      } catch { /* per-recipient best-effort */ }
    }
  }
  return inserted;
}
