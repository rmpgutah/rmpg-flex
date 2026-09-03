import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, queryFirst, execute, query } from '../../utils/db';
import { log } from '../../utils/logger';
import { requireRole } from '../../middleware/auth';
import { ACTIVE_CALL_WHERE } from '../../utils/callStatus';

const handoff = new Hono<Env>();

handoff.get('/', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ text: string; updated_by: number | null; updated_at: string }>(
      db, 'SELECT text, updated_by, updated_at FROM shift_handoff WHERE id = 1',
    );
    return c.json(row ? {
      text: row.text ?? '',
      updated_by: row.updated_by ?? null,
      updated_at: row.updated_at ?? null,
    } : { text: '', updated_by: null, updated_at: null });
  } catch {
    log.warn('[shiftHandoff] GET failed, table may not exist', {});
    return c.json({ text: '', updated_by: null, updated_at: null });
  }
});

handoff.put('/', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const text = typeof body.text === 'string' ? body.text : '';
    await execute(db,
      `INSERT INTO shift_handoff (id, text, updated_by, updated_at) VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      text, userId ?? null,
    );
    const row = await queryFirst<{ text: string; updated_by: number | null; updated_at: string }>(
      db, 'SELECT text, updated_by, updated_at FROM shift_handoff WHERE id = 1',
    );
    return c.json({ success: true, ...row });
  } catch (err) {
    log.error('[shiftHandoff] PUT failed', {}, err);
    return c.json({ success: false, error: 'Failed to save shift handoff' }, 500);
  }
});

// ── GET /briefing — auto-generated shift change briefing from live data ──
handoff.get('/briefing', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const results: Record<string, any> = {};

    // Active calls summary
    const activeCalls = await query<{ count: number; p1: number }>(
      db, `SELECT COUNT(*) AS count, SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) AS p1
           FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE}`,
    );
    results.active_calls = activeCalls[0];

    // Unit availability
    const unitCount = await query<{ available: number; total: number; dispatched: number }>(
      db, `SELECT SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
                  COUNT(*) AS total,
                  SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END) AS dispatched
           FROM units WHERE status != 'out_of_service'`,
    );
    results.units = unitCount[0];

    // Active BOLOs — wrapped individually so a missing table doesn't crash the briefing
    try {
      const boloCount = await queryFirst<{ n: number }>(
        db, "SELECT COUNT(*) AS n FROM bolos WHERE status = 'active'",
      );
      results.active_bolos = boloCount?.n ?? 0;
    } catch { results.active_bolos = 0; }

    // Pending serve jobs
    try {
      const serveCount = await queryFirst<{ n: number }>(
        db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status IN ('pending','assigned','in_progress','attempted')",
      );
      results.pending_serve_jobs = serveCount?.n ?? 0;
    } catch { results.pending_serve_jobs = 0; }

    // Anomaly alerts
    try {
      const anomalyCount = await queryFirst<{ n: number }>(
        db, "SELECT COUNT(*) AS n FROM anomaly_alerts WHERE acknowledged_at IS NULL",
      );
      results.unacknowledged_alerts = anomalyCount?.n ?? 0;
    } catch { results.unacknowledged_alerts = 0; }

    // Zones with coverage gaps
    const zones = await query<{ zone: string; unit_count: number }>(
      db, `SELECT COALESCE(u.assigned_beat, 'Unzoned') AS zone, COUNT(*) AS unit_count
           FROM units u WHERE u.status = 'available' GROUP BY u.assigned_beat`,
    );
    results.zone_coverage = zones;

    // Recent duty starts (last 2 hours)
    const recentShifts = await query<{ officer_name: string; clock_in: string }>(
      db, `SELECT COALESCE(usr.full_name, 'Unknown') AS officer_name, te.clock_in
           FROM time_entries te LEFT JOIN users usr ON te.officer_id = usr.id
           WHERE te.clock_in >= datetime('now', '-2 hours') AND te.clock_out IS NULL
           ORDER BY te.clock_in DESC LIMIT 20`,
    );
    results.recent_shift_starts = recentShifts;

    // Generated timestamp
    results.generated_at = new Date().toISOString();

    return c.json(results);
  } catch (err) {
    log.error('[shiftHandoff] briefing generation failed', {}, err);
    return c.json({ error: 'Briefing unavailable' }, 500);
  }
});

export default handoff;
