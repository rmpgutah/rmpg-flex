// Pure helpers for investigative case tasks (v2 Phase 2). Kept free of D1
// and request context so the rules are unit-testable in the worker suite.

export const TASK_STATUSES = ['open', 'in_progress', 'done', 'canceled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function isValidTaskStatus(s: unknown): s is TaskStatus {
  return typeof s === 'string' && (TASK_STATUSES as readonly string[]).includes(s);
}

export function isValidTaskPriority(p: unknown): p is TaskPriority {
  return typeof p === 'string' && (TASK_PRIORITIES as readonly string[]).includes(p);
}

/**
 * completed_at lifecycle: stamped the first time a task reaches `done`,
 * preserved if it stays done, and cleared if it leaves `done` (reopened or
 * canceled). `prev` is the existing completed_at value.
 */
export function completedAtFor(status: string, nowIso: string, prev: string | null): string | null {
  if (status === 'done') return prev ?? nowIso;
  return null;
}

/** A task is overdue when it has a past due date and is still actionable. */
export function isTaskOverdue(dueDate: string | null | undefined, status: string, now: Date): boolean {
  if (!dueDate) return false;
  if (status === 'done' || status === 'canceled') return false;
  const due = new Date(`${String(dueDate).slice(0, 10)}T23:59:59`);
  if (isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}
