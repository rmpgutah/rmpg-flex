// ============================================================
// Records Retention Reminder Sweep
// ============================================================
// POST /records/retention/enforce (admin-only) archives/purges evidence
// and incident records past their retention window, but nothing ever
// calls it automatically — an admin has to remember it exists and
// click it. Deliberately NOT auto-run on a cron here: silently
// disposing evidence tied to a case that's still open (retention
// schedule doesn't know about case status) is a real legal-liability
// risk, so a human must stay in the loop. This sweep only counts how
// many records are currently eligible and reminds an admin to review
// and run enforcement themselves — it never mutates evidence/incident
// records.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst } from './db';
import { evaluateNotificationRules } from '../routes/notificationEngine';
import { RETENTION_SCHEDULE } from '../routes/records';

export async function sweepRetentionReminders(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ eligible: Record<string, number>; notified: number }> {
  const eligible: Record<string, number> = {};

  const evidenceDue = await queryFirst<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM evidence WHERE status IN ('in_storage','received') AND datetime(created_at) < datetime('now', ?)`,
    `-${RETENTION_SCHEDULE.evidence} days`);
  if ((evidenceDue?.n ?? 0) > 0) eligible.evidence = evidenceDue!.n;

  const incidentsDue = await queryFirst<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM incidents WHERE status = 'approved' AND archived_at IS NULL AND datetime(created_at) < datetime('now', ?)`,
    `-${RETENTION_SCHEDULE.incidents} days`);
  if ((incidentsDue?.n ?? 0) > 0) eligible.incidents = incidentsDue!.n;

  if (Object.keys(eligible).length === 0) return { eligible, notified: 0 };

  const summary = Object.entries(eligible).map(([type, n]) => `${n} ${type}`).join(', ');
  const { notified } = await evaluateNotificationRules(db, 'records_retention_due', {
    title: 'Records retention enforcement due',
    message: `${summary} exceeded their retention window. Review and run retention enforcement (Admin > Records Retention).`,
    priority: 'normal',
    entity_type: 'records_retention',
  }, env);

  return { eligible, notified };
}
