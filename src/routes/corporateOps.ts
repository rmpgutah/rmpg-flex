import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';
import { CORPORATE_ENHANCERS } from '../utils/corporateOps';
import {
  ensureCorporateOpsSchema,
  loadCorporateSnapshot,
  populatePayrollFromClocks,
  runAttendanceTardy,
  runFleetServiceDue,
  runMileageReconcile,
  runNightlyBundle,
  runServeDutyGaps,
  runShiftUnattended,
  runStaleOpenShifts,
  denverToday,
} from '../utils/corporateWorkflows';

const corporateOps = new Hono<Env>();
const READ_ROLES = ['admin', 'manager', 'supervisor', 'human_resources', 'dispatcher'] as const;

corporateOps.use('*', async (c, next) => {
  await ensureCorporateOpsSchema(getDb(c.env));
  await next();
});

corporateOps.get('/enhancers', requireRole(...READ_ROLES), (c) => {
  return c.json({ count: CORPORATE_ENHANCERS.length, enhancers: CORPORATE_ENHANCERS });
});

corporateOps.get('/snapshot', requireRole(...READ_ROLES), async (c) => {
  try {
    return c.json(await loadCorporateSnapshot(getDb(c.env)));
  } catch (err) {
    log.error('GET /corporate-ops/snapshot failed', {}, err);
    return dbErrorResponse(c, err, 'Failed to load corporate snapshot');
  }
});

corporateOps.get('/mine', async (c) => {
  try {
    const officerId = c.get('userId') as number | undefined;
    if (!officerId) return c.json({ error: 'Authentication required' }, 401);
    const db = getDb(c.env);
    const day = denverToday();
    const entry = await queryFirst(db,
      `SELECT id, clock_in, clock_out, total_hours, total_miles, vehicle_id, unit_id, clock_source, starting_mileage, ending_mileage
         FROM time_entries WHERE officer_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
      officerId);
    const hours = await queryFirst<{ h: number | null }>(db,
      `SELECT COALESCE(SUM(total_hours), 0) AS h FROM time_entries WHERE officer_id = ? AND (date(clock_in) = ? OR date(clock_in_local) = ?)`,
      officerId, day, day);
    const miles = await queryFirst<{ m: number | null }>(db,
      `SELECT COALESCE(SUM(total_miles), 0) AS m FROM time_entries WHERE officer_id = ? AND (date(clock_in) = ? OR date(clock_in_local) = ?)`,
      officerId, day, day);
    const serve = await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM serve_attempts WHERE officer_id = ? AND date(attempt_at) = ?`,
      officerId, day).catch(() => ({ n: 0 }));
    return c.json({
      day,
      on_duty: !!entry,
      time_entry: entry ?? null,
      hours_today: hours?.h ?? 0,
      duty_miles_today: miles?.m ?? 0,
      serve_attempts_today: serve?.n ?? 0,
    });
  } catch (err) {
    log.error('GET /corporate-ops/mine failed', {}, err);
    return dbErrorResponse(c, err, 'Failed to load my corporate totals');
  }
});

corporateOps.get('/servers', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const day = denverToday();
    const rows = await query<{
      officer_id: number; full_name: string; time_entry_id: number; clock_in: string;
      total_miles: number | null; vehicle_id: number | null; vehicle_number: string | null; call_sign: string | null;
    }>(db, `
      SELECT us.id AS officer_id, us.full_name, te.id AS time_entry_id, te.clock_in,
             te.total_miles, te.vehicle_id, fv.vehicle_number, un.call_sign
        FROM time_entries te
        JOIN users us ON us.id = te.officer_id
        LEFT JOIN units un ON un.id = te.unit_id
        LEFT JOIN fleet_vehicles fv ON fv.id = te.vehicle_id
       WHERE te.clock_out IS NULL
       ORDER BY us.full_name`);
    const miles = await query<{ officer_id: number; m: number | null }>(db,
      `SELECT officer_id, COALESCE(SUM(total_miles), 0) AS m FROM time_entries
        WHERE date(clock_in) = ? OR date(clock_in_local) = ?
        GROUP BY officer_id`, day, day).catch(() => []);
    const byId = new Map(miles.map((r) => [r.officer_id, r.m ?? 0]));
    return c.json({
      day,
      officers: rows.map((r) => ({
        ...r,
        miles_today: byId.get(Number(r.officer_id)) ?? r.total_miles ?? 0,
      })),
    });
  } catch (err) {
    log.error('GET /corporate-ops/servers failed', {}, err);
    return dbErrorResponse(c, err, 'Failed to load on-duty servers');
  }
});

corporateOps.get('/runs', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query(db, `SELECT * FROM corporate_ops_runs ORDER BY id DESC LIMIT 50`);
    return c.json(rows);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to list workflow runs');
  }
});

const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'human_resources'] as const;
const HR_PAYROLL_KINDS = new Set(['payroll_clock_sync', 'attendance_tardy', 'nightly_bundle']);

corporateOps.post('/runs', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id?: number; role?: string } | undefined;
    const userId = user?.id ?? null;
    const body = await c.req.json<{ kind?: string; day?: string }>().catch(() => ({} as { kind?: string; day?: string }));
    const kind = (body.kind || '').trim();
    const allowed = new Set([
      'mileage_reconcile', 'attendance_tardy', 'shift_unattended', 'stale_open_shifts',
      'serve_duty_gaps', 'fleet_service_due', 'payroll_clock_sync', 'nightly_bundle',
    ]);
    if (!allowed.has(kind)) return c.json({ error: 'Unknown workflow kind', code: 'UNKNOWN_KIND' }, 400);
    if (HR_PAYROLL_KINDS.has(kind) && !(WRITE_ROLES as readonly string[]).includes(user?.role ?? '')) {
      return c.json({ error: 'Insufficient permissions for this workflow', code: 'HR_WORKFLOW_FORBIDDEN' }, 403);
    }
    const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : denverToday();
    const env = { ALERT_HUB: c.env.ALERT_HUB };
    let result: unknown;
    switch (kind) {
      case 'mileage_reconcile':
        result = await runMileageReconcile(db, day, userId, 'manual');
        break;
      case 'attendance_tardy':
        result = await runAttendanceTardy(db, day, userId, 'manual');
        break;
      case 'shift_unattended':
        result = await runShiftUnattended(db, day, userId, 'manual', env);
        break;
      case 'stale_open_shifts':
        result = await runStaleOpenShifts(db, userId, 'manual');
        break;
      case 'serve_duty_gaps':
        result = await runServeDutyGaps(db, day, userId, 'manual');
        break;
      case 'fleet_service_due':
        result = await runFleetServiceDue(db, userId, 'manual', env);
        break;
      case 'payroll_clock_sync': {
        const open = await queryFirst<{ id: number }>(db, `SELECT id FROM hr_pay_periods WHERE status = 'open' ORDER BY start_date DESC LIMIT 1`);
        if (!open) return c.json({ error: 'No open pay period', code: 'NO_OPEN_PERIOD' }, 409);
        const pop = await populatePayrollFromClocks(db, open.id);
        result = { period_id: open.id, ...pop };
        break;
      }
      case 'nightly_bundle':
        result = await runNightlyBundle(db, userId, 'manual', env);
        break;
    }
    return c.json({ ok: true, kind, day, result });
  } catch (err) {
    log.error('POST /corporate-ops/runs failed', {}, err);
    return dbErrorResponse(c, err, 'Workflow run failed');
  }
});

export default corporateOps;
