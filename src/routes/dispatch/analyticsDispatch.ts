// ============================================================
// Dispatch — Incident Type Analytics
// GET /api/dispatch/analytics/incident-types?days=7
// Returns [{ incident_type, count, avg_duration_minutes,
//            avg_units_assigned, pct_of_total }]
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query } from '../../utils/db';

const analyticsDispatch = new Hono<Env>();

analyticsDispatch.get('/incident-types', async (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days') ?? '7'), 1), 365);
  const db = getDb(c.env);

  // We compute per-type stats for calls closed (or still open) within the window.
  // Duration = time between created_at and closed_at (NULL = still open, skip in avg).
  // Units assigned = count of distinct unit_ids in dispatch_assignments for the call.
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
        FROM dispatch_assignments
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
