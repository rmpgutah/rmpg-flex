import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';

const shiftStats = new Hono<Env>();

// GET /api/dispatch/shift-stats
// Returns aggregate statistics for the current shift window.
// Shift boundary: last occurrence of 06:00 or 18:00 MT.
shiftStats.get('/', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const { window_hours } = c.req.query();

    // Default shift window: 12 hours (covering a standard half-day shift).
    // Caller may override with ?window_hours= for custom analysis.
    const hoursBack = Math.min(Math.max(parseInt(window_hours || '12', 10) || 12, 1), 48);
    const windowStart = `datetime('now', '-${hoursBack} hours')`;

    // Totals
    const totals = await queryFirst<{
      calls_created: number;
      calls_closed: number;
      p1_count: number;
      p2_count: number;
      p3_count: number;
      p4_count: number;
      avg_response_seconds: number | null;
    }>(db, `
      SELECT
        COUNT(*) as calls_created,
        SUM(CASE WHEN status IN ('cleared','closed','cancelled') THEN 1 ELSE 0 END) as calls_closed,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1_count,
        SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) as p2_count,
        SUM(CASE WHEN priority = 'P3' THEN 1 ELSE 0 END) as p3_count,
        SUM(CASE WHEN priority = 'P4' THEN 1 ELSE 0 END) as p4_count,
        AVG(CASE WHEN response_time_seconds IS NOT NULL AND response_time_seconds > 0
                 THEN response_time_seconds ELSE NULL END) as avg_response_seconds
      FROM calls_for_service
      WHERE created_at >= ${windowStart}
    `);

    // Top incident types
    const topTypes = await query<{ incident_type: string; cnt: number }>(db, `
      SELECT incident_type, COUNT(*) as cnt
      FROM calls_for_service
      WHERE created_at >= ${windowStart}
        AND incident_type IS NOT NULL
        AND incident_type != ''
      GROUP BY incident_type
      ORDER BY cnt DESC
      LIMIT 10
    `);

    // Active units right now (status = 'available' or on a call)
    const activeUnits = await queryFirst<{ cnt: number }>(db, `
      SELECT COUNT(*) as cnt FROM units WHERE status != 'off_duty'
    `);

    // Response time from call_response_times table if it exists
    let rtFromTable: { avg_seconds: number | null } | null = null;
    try {
      rtFromTable = await queryFirst<{ avg_seconds: number | null }>(db, `
        SELECT AVG(response_seconds) as avg_seconds
        FROM call_response_times
        WHERE onscene_at >= ${windowStart}
      `);
    } catch { /* table may not exist yet */ }

    const avg_response_seconds = rtFromTable?.avg_seconds ?? totals?.avg_response_seconds ?? null;

    return c.json({
      window_hours: hoursBack,
      calls_created: totals?.calls_created ?? 0,
      calls_closed: totals?.calls_closed ?? 0,
      avg_response_seconds: avg_response_seconds != null ? Math.round(avg_response_seconds) : null,
      p1_count: totals?.p1_count ?? 0,
      p2_count: totals?.p2_count ?? 0,
      p3_count: totals?.p3_count ?? 0,
      p4_count: totals?.p4_count ?? 0,
      units_active: activeUnits?.cnt ?? 0,
      top_incident_types: topTypes.map(r => ({ type: r.incident_type, count: r.cnt })),
    });
  } catch (err) {
    log.error('GET /dispatch/shift-stats failed', {}, err as Error);
    return c.json({ error: 'Failed to get shift stats' }, 500);
  }
});

export default shiftStats;
