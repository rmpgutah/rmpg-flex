// ============================================================
// Shift Plans — Daily Understaffed/No-Plan Notification Sweep
// ============================================================
// GET /shift-plans/conflicts and GET /staffing-levels are on-demand-only —
// nothing proactively tells a supervisor that a shift 3 days out is short-
// staffed or that a date has no active plan at all, until someone opens
// the Shift Plans page. Same dashboard-only gap fleet maintenance and
// certification expirations had before those got cron sweeps; reuses the
// same notification-rule engine (2026-08-08 comms integration spec).
//
// Reuses the exact staffing-minimum logic from GET /staffing-levels
// (src/routes/shiftPlans.ts) — {day:2, swing:2, graveyard:1} — and the
// no-active-plan check from GET /shift-notifications, so the sweep and the
// on-demand endpoints never drift apart in what counts as "understaffed."
// ============================================================

import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import { query } from './db';
import { evaluateNotificationRules } from '../routes/notificationEngine';

const STAFFING_MINIMUMS: Record<string, number> = { day: 2, swing: 2, graveyard: 1 };
const SWEEP_WINDOW_DAYS = 7;

interface PlanRow {
  id: number;
  date: string;
  shift_type: string;
  assignments: string;
}

function denverDateStrings(count: number): string[] {
  // America/Denver "today" as YYYY-MM-DD, then +1..+(count-1) days. Uses
  // Intl the same way src/index.ts's cron gate already does for Denver-
  // local hour/minute, so this sweep's "today" always matches the cron's
  // "today" even near a DST boundary or a UTC-day rollover.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  const start = new Date(`${y}-${m}-${d}T12:00:00Z`); // noon UTC avoids DST edge cases when adding days
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const dt = new Date(start.getTime() + i * 86_400_000);
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
}

export async function sweepShiftPlanNotifications(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ understaffed: number; noPlan: number; notified: number }> {
  let understaffed = 0;
  let noPlan = 0;
  let notified = 0;

  for (const date of denverDateStrings(SWEEP_WINDOW_DAYS)) {
    const plans = await query<PlanRow>(
      db,
      `SELECT id, date, shift_type, assignments FROM shift_plans WHERE date = ? AND status = 'active' ORDER BY shift_type`,
      date,
    );

    if (plans.length === 0) {
      noPlan++;
      const { notified: n } = await evaluateNotificationRules(db, 'shift_no_active_plan', {
        title: 'No active shift plan',
        message: `${date} has no active shift plan.`,
        priority: 'critical',
        entity_type: 'shift_plan_date',
        entity_id: 0,
      }, env);
      notified += n;
      continue;
    }

    for (const plan of plans) {
      let assignments: unknown[] = [];
      try { assignments = typeof plan.assignments === 'string' ? JSON.parse(plan.assignments) : (plan.assignments as unknown[] ?? []); }
      catch { assignments = []; }
      const minimum = STAFFING_MINIMUMS[plan.shift_type] ?? 1;
      if (assignments.length >= minimum) continue;

      understaffed++;
      const { notified: n } = await evaluateNotificationRules(db, 'shift_understaffed', {
        title: `Understaffed: ${date} ${plan.shift_type}`,
        message: `${date} ${plan.shift_type} shift has ${assignments.length} of ${minimum} required officer(s).`,
        priority: 'warning',
        entity_type: 'shift_plan',
        entity_id: plan.id,
      }, env);
      notified += n;
    }
  }

  return { understaffed, noPlan, notified };
}
