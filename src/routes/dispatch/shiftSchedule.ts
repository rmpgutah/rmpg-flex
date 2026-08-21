// ============================================================
// Dispatch — Shift Schedule Endpoint
// GET /api/dispatch/shift-schedule?date=YYYY-MM-DD
// Returns the day's officers based on time_entries and users.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query } from '../../utils/db';

const shiftSchedule = new Hono<Env>();

shiftSchedule.get('/shift-schedule', async (c) => {
  const dateParam = c.req.query('date');
  // Default to today in Denver time (approximate — Workers run in UTC)
  const dateStr = dateParam ?? new Date(
    Date.now() - 7 * 60 * 60 * 1000, // rough MST offset
  ).toISOString().slice(0, 10);

  // Validate format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return c.json({ ok: false, error: 'date must be YYYY-MM-DD' }, 400);
  }

  const db = getDb(c.env);

  // A time_entry overlaps the requested date when:
  //   clock_in  <  date+1  AND  (clock_out is NULL OR clock_out >= date)
  const nextDate = new Date(dateStr);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDateStr = nextDate.toISOString().slice(0, 10);

  const rows = await query<{
    officer_id: number;
    officer_name: string | null;
    call_sign: string | null;
    role: string | null;
    clock_in: string;
    clock_out: string | null;
    status: string;
  }>(db, `
    SELECT
      te.officer_id,
      u.full_name                          AS officer_name,
      u.call_sign,
      u.role,
      te.clock_in,
      te.clock_out,
      CASE
        WHEN te.clock_out IS NULL     THEN 'active'
        WHEN te.clock_out >= ?        THEN 'active'
        ELSE 'completed'
      END                                  AS status
    FROM time_entries te
    LEFT JOIN users u ON u.id = te.officer_id
    WHERE te.clock_in < ?
      AND (te.clock_out IS NULL OR te.clock_out >= ?)
    ORDER BY te.clock_in ASC
  `, dateStr, nextDateStr, dateStr);

  return c.json({ ok: true, date: dateStr, schedule: rows });
});

export default shiftSchedule;
