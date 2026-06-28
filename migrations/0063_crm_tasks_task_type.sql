-- 0063_crm_tasks_task_type.sql
-- The CRM task form submits task_type (follow_up/call/email/meeting/...) and the
-- task list renders toDisplayLabel(task.task_type), but crm_tasks had no such
-- column so the value was silently dropped on create. Add it.
-- Applied directly to live D1 (785de7ae) on 2026-06-01.
ALTER TABLE crm_tasks ADD COLUMN task_type TEXT DEFAULT 'follow_up';
