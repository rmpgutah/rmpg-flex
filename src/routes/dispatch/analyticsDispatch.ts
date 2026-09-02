// ── Dispatch analytics endpoints ──────────────────────────────
// Officer availability timeline + incident-type analytics.
// Mounted at /api/dispatch/analytics via ROUTE_REGISTRY.

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';

const analyticsDispatch = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

// ── GET /dispatch/analytics/availability?date=YYYY-MM-DD ───────
// Returns hourly breakdown of on-duty units and active calls for
// the given date (defaults to today in America/Denver).
analyticsDispatch.get('/availability', requireRole(...READ_ROLES), async (c) => {
  const dateParam = c.req.query('date');
  let dateStr: string;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    dateStr = dateParam;
  } else {
    const now = new Date();
    const denver = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
    const y = denver.getFullYear();
    const m = String(denver.getMonth() + 1).padStart(2, '0');
    const d = String(denver.getDate()).padStart(2, '0');
    dateStr = `${y}-${m}-${d}`;
  }

  try {
    const db = getDb(c.env);

    const entries = await query<{ clock_in: string; clock_out: string | null }>(
      db,
      `SELECT clock_in, clock_out FROM time_entries
       WHERE DATE(clock_in) = ? OR (clock_out IS NOT NULL AND DATE(clock_out) = ?)
          OR (clock_out IS NULL AND DATE(clock_in) <= ?)`,
      dateStr, dateStr, dateStr,
    );

    const calls = await query<{ created_at: string; status: string }>(
      db,
      `SELECT created_at, status FROM calls_for_service
       WHERE created_at >= ? AND created_at < ?`,
      `${dateStr} 00:00:00`, `${dateStr} 23:59:59`,
    );

    const dispatchedCalls = await query<{ created_at: string; assigned_unit_ids: string | null }>(
      db,
      `SELECT created_at, assigned_unit_ids FROM calls_for_service
       WHERE COALESCE(status,'') NOT IN ('closed','cleared','cancelled','canceled','archived','completed')
         AND created_at >= ? AND created_at < ?`,
      `${dateStr} 00:00:00`, `${dateStr} 23:59:59`,
    );

    const hours: {
      hour: number;
      available_units: number;
      dispatched_units: number;
      total_calls: number;
    }[] = [];

    for (let h = 0; h < 24; h++) {
      const hourStart = `${dateStr} ${String(h).padStart(2, '0')}:00:00`;
      const hourEnd = `${dateStr} ${String(h).padStart(2, '0')}:59:59`;

      let available = 0;
      for (const e of entries) {
        const cin = e.clock_in;
        const cout = e.clock_out ?? `${dateStr} 23:59:59`;
        if (cin <= hourEnd && cout >= hourStart) available++;
      }

      const totalCalls = calls.filter(
        (call) => call.created_at >= hourStart && call.created_at <= hourEnd,
      ).length;

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

// ── GET /dispatch/analytics/incident-types?days=7 ──────────────
// Returns [{ incident_type, count, avg_duration_minutes,
//            avg_units_assigned, pct_of_total }]
analyticsDispatch.get('/incident-types', async (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days') ?? '7'), 1), 365);
  const db = getDb(c.env);

  const rows = await query<{
    incident_type: string | null;
    count: number;
    avg_duration_minutes: number | null;
    avg_units_assigned: number | null;
  }>(db, `
    SELECT
      COALESCE(c.incident_type, 'Unknown') AS incident_type,
      COUNT(*)                              AS count,
      AVG(
        CASE
          WHEN c.closed_at IS NOT NULL
          THEN CAST((julianday(c.closed_at) - julianday(c.created_at)) * 1440 AS REAL)
          ELSE NULL
        END
      )                                     AS avg_duration_minutes,
      AVG(ua.unit_count)                    AS avg_units_assigned
    FROM calls_for_service c
    LEFT JOIN (
      SELECT call_id, COUNT(DISTINCT unit_id) AS unit_count
        FROM call_units
       GROUP BY call_id
    ) ua ON ua.call_id = c.id
    WHERE c.created_at >= datetime('now', ? || ' days')
    GROUP BY COALESCE(c.incident_type, 'Unknown')
    ORDER BY count DESC
  `, String(-days));

  const total = rows.reduce((s, r) => s + (r.count ?? 0), 0);
  const result = rows.map((r) => ({
    incident_type: r.incident_type ?? 'Unknown',
    count: r.count,
    avg_duration_minutes: r.avg_duration_minutes !== null
      ? Math.round((r.avg_duration_minutes ?? 0) * 10) / 10
      : null,
    avg_units_assigned: r.avg_units_assigned !== null
      ? Math.round((r.avg_units_assigned ?? 0) * 100) / 100
      : null,
    pct_of_total: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
  }));

  return c.json({ ok: true, days, total_calls: total, incident_types: result });
});

export default analyticsDispatch;
