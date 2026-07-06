// ============================================================
// Fleet Maintenance Reminder Sweep
// ============================================================
// Daily cron job that finds overdue/critical fleet_maintenance rows
// (same urgency logic as GET /fleet/maintenance-schedule, which only
// computes urgency for an admin looking at a dashboard) and fires the
// existing notification-rule engine so nobody has to remember to check
// the maintenance schedule manually. No-ops until an admin configures
// a notification rule with trigger_event='fleet_maintenance_due' (the
// engine already supports this — it was just never called by anything).
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';
import { evaluateNotificationRules } from '../routes/notificationEngine';

interface DueMaintenanceRow {
  id: number;
  vehicle_id: number;
  type: string | null;
  next_due_date: string | null;
  next_due_mileage: number | null;
  vehicle_number: string | null;
  current_mileage: number | null;
}

export async function sweepFleetMaintenanceReminders(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ overdue: number; critical: number; notified: number }> {
  const rows = await query<DueMaintenanceRow>(db, `
    SELECT m.id, m.vehicle_id, m.type, m.next_due_date, m.next_due_mileage,
           v.vehicle_number, v.current_mileage
    FROM fleet_maintenance m
    LEFT JOIN fleet_vehicles v ON v.id = m.vehicle_id
    WHERE v.archived_at IS NULL
      AND (m.next_due_date IS NOT NULL OR m.next_due_mileage IS NOT NULL)
  `);

  const today = Date.now();
  let overdueCount = 0;
  let criticalCount = 0;
  let notified = 0;

  for (const m of rows) {
    const daysUntil = m.next_due_date && !Number.isNaN(Date.parse(m.next_due_date))
      ? Math.round((Date.parse(m.next_due_date) - today) / 86_400_000) : null;
    const milesUntil = (m.next_due_mileage != null && m.current_mileage != null)
      ? m.next_due_mileage - m.current_mileage : null;
    const overdue = (daysUntil != null && daysUntil < 0) || (milesUntil != null && milesUntil < 0);
    const critical = !overdue && ((daysUntil != null && daysUntil <= 7) || (milesUntil != null && milesUntil <= 500));
    if (!overdue && !critical) continue;

    if (overdue) overdueCount++; else criticalCount++;

    const serviceType = m.type ?? 'service';
    const vehicleLabel = m.vehicle_number ?? `#${m.vehicle_id}`;
    const { notified: n } = await evaluateNotificationRules(db, 'fleet_maintenance_due', {
      title: overdue ? `Overdue: ${serviceType} — ${vehicleLabel}` : `Due soon: ${serviceType} — ${vehicleLabel}`,
      message: daysUntil != null
        ? `${vehicleLabel} ${serviceType} was due ${Math.abs(daysUntil)} day(s) ${overdue ? 'ago' : 'from now'}.`
        : `${vehicleLabel} ${serviceType} is due within ${milesUntil} miles.`,
      priority: overdue ? 'high' : 'normal',
      entity_type: 'fleet_maintenance',
      entity_id: m.id,
    }, env);
    notified += n;
  }

  return { overdue: overdueCount, critical: criticalCount, notified };
}
