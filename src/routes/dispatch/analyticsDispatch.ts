// ── Dispatch analytics endpoints ──────────────────────────────
// Officer availability timeline for staffing charts.
// Mounted at /api/dispatch/analytics via ROUTE_REGISTRY.

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';

const analytics = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

// ── GET /dispatch/analytics/availability?date=YYYY-MM-DD ───────
// Returns hourly breakdown of on-duty units and active calls for
// the given date (defaults to today in America/Denver). Uses
// time_entries for officer on-duty windows and calls_for_service
// created_at + closed_at for call activity.
//
// Response: [{ hour: 0..23, available_units, dispatched_units, total_calls }, ...]
analytics.get('/availability', requireRole(...READ_ROLES), async (c) => {
  // Accept a date in YYYY-MM-DD form (America/Denver local).
  // We store timestamps as UTC-ish sqlite datetime strings, so we
  // compare against the requested date string prefix directly.
  const dateParam = c.req.query('date');
  let dateStr: string;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    dateStr = dateParam;
  } else {
    // Default: today in America/Denver (UTC-6 / UTC-7)
    const now = new Date();
    const denver = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
    const y = denver.getFullYear();
    const m = String(denver.getMonth() + 1).padStart(2, '0');
    const d = String(denver.getDate()).padStart(2, '0');
    dateStr = `${y}-${m}-${d}`;
  }

  try {
    const db = getDb(c.env);

    // For each hour 0-23, count officers whose time_entry window overlaps
    // that hour on the given date. We do a single broad pull and classify
    // in JS to avoid 24 D1 queries.
    const entries = await query<{ clock_in: string; clock_out: string | null }>(
      db,
      `SELECT clock_in, clock_out FROM time_entries
       WHERE DATE(clock_in) = ? OR (clock_out IS NOT NULL AND DATE(clock_out) = ?)
          OR (clock_out IS NULL AND DATE(clock_in) <= ?)`,
      dateStr, dateStr, dateStr,
    );

    // Calls created on that date (by created_at prefix)
    const calls = await query<{ created_at: string; status: string }>(
      db,
      `SELECT created_at, status FROM calls_for_service
       WHERE created_at >= ? AND created_at < ?`,
      `${dateStr} 00:00:00`, `${dateStr} 23:59:59`,
    );

    // Active unit assignments: units that were dispatched (status=dispatched)
    // at some point on that date — approximate via unit_assignments if exists,
    // fallback to call assignments.
    // We use calls_for_service.assigned_unit_ids for dispatched count.
    const dispatchedCalls = await query<{ created_at: string; assigned_unit_ids: string | null }>(
      db,
      `SELECT created_at, assigned_unit_ids FROM calls_for_service
       WHERE COALESCE(status,'') NOT IN ('closed','cleared','cancelled','canceled','archived','completed')
         AND created_at >= ? AND created_at < ?`,
      `${dateStr} 00:00:00`, `${dateStr} 23:59:59`,
    );

    // Build 24-slot result
    const hours: {
      hour: number;
      available_units: number;
      dispatched_units: number;
      total_calls: number;
    }[] = [];

    for (let h = 0; h < 24; h++) {
      const hourStart = `${dateStr} ${String(h).padStart(2, '0')}:00:00`;
      const hourEnd = `${dateStr} ${String(h).padStart(2, '0')}:59:59`;

      // Officers on duty during this hour
      let available = 0;
      for (const e of entries) {
        const cin = e.clock_in;
        const cout = e.clock_out ?? `${dateStr} 23:59:59`;
        if (cin <= hourEnd && cout >= hourStart) available++;
      }

      // Calls created this hour
      const totalCalls = calls.filter(
        (call) => call.created_at >= hourStart && call.created_at <= hourEnd,
      ).length;

      // Dispatched units: count unique unit ids across active calls this hour
      const dispatchedUnitIds = new Set<string>();
      for (const dc of dispatchedCalls) {
        if (dc.created_at >= hourStart && dc.created_at <= hourEnd && dc.assigned_unit_ids) {
          try {
            const ids: number[] = JSON.parse(dc.assigned_unit_ids);
            for (const id of ids) dispatchedUnitIds.add(String(id));
          } catch { /* ignore malformed JSON */ }
        }
      }
      const dispatched = dispatchedUnitIds.size;

      hours.push({
        hour: h,
        available_units: Math.max(0, available - dispatched),
        dispatched_units: dispatched,
        total_calls: totalCalls,
      });
    }

    return c.json({ date: dateStr, hours });
  } catch (err) {
    log.error('[analyticsDispatch] GET /availability failed', { dateStr }, err);
    return c.json({ error: 'Availability data unavailable' }, 500);
  }
});

export default analytics;
