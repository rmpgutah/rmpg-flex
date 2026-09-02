// ============================================================
// Corporate ops D1 workflows — payroll from clocks, mileage
// reconcile, tardy/unattended, serve↔shift links, nightly bundle.
// ============================================================
import type { D1Database, DurableObjectNamespace } from '@cloudflare/workers-types';
import { query, queryFirst, execute, columnExists } from './db';
import { log } from './logger';
import { setFleetOdometer } from './fleetOdometer';
import { computeOfficerMileageForDay } from './serveMileage';
import { evaluateNotificationRules } from '../routes/notificationEngine';
import { nowDualStamp } from './denverTime';
import {
  overtimeFromPeriodHours,
  payrollGross,
  reconcileMileage,
  mileageReimburse,
  minutesLate,
  combineScheduleStart,
  denverDateFromIso,
  hoursBetween,
  capBreakMinutes,
  milesDelta,
  metersToMiles,
  isStaleOpenShift,
  IRS_MILEAGE_RATE,
  STALE_SHIFT_HOURS,
} from './corporateOps';

let _schemaEnsured = false;

const EXTRA_COLS: Array<[string, string, string]> = [
  ['hr_payroll_entries', 'clock_hours', 'REAL'],
  ['hr_payroll_entries', 'duty_miles', 'REAL'],
  ['hr_payroll_entries', 'serve_miles', 'REAL'],
  ['hr_payroll_entries', 'gps_trip_miles', 'REAL'],
  ['hr_payroll_entries', 'mileage_reimburse', 'REAL'],
  ['time_entries', 'clock_source', 'TEXT'],
  ['time_entries', 'workflow_run_id', 'INTEGER'],
  ['serve_attempts', 'time_entry_id', 'INTEGER'],
  ['serve_attempts', 'vehicle_id', 'INTEGER'],
  ['serve_attempts', 'duty_miles_snapshot', 'REAL'],
];

export async function ensureCorporateOpsSchema(db: D1Database): Promise<void> {
  if (_schemaEnsured) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS corporate_ops_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      triggered_by INTEGER,
      trigger_source TEXT NOT NULL DEFAULT 'manual',
      summary_json TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS corporate_ops_run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      officer_id INTEGER,
      summary_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS corporate_mileage_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      time_entry_id INTEGER,
      vehicle_id INTEGER,
      unit_id INTEGER,
      duty_miles REAL NOT NULL DEFAULT 0,
      gps_trip_miles REAL NOT NULL DEFAULT 0,
      serve_billed_miles REAL NOT NULL DEFAULT 0,
      cfs_miles REAL NOT NULL DEFAULT 0,
      variance_miles REAL NOT NULL DEFAULT 0,
      flag TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(officer_id, work_date, time_entry_id)
    )`).run();
  } catch (err) {
    log.warn('[corporateOps] table create failed', { err: String((err as Error)?.message) });
  }
  for (const [table, col, type] of EXTRA_COLS) {
    try {
      if (!(await columnExists(db, table, col))) {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      /* duplicate column / missing table */
    }
  }
  _schemaEnsured = true;
}

export function denverToday(): string {
  return denverDateFromIso(new Date().toISOString());
}

async function startRun(
  db: D1Database,
  kind: string,
  source: string,
  triggeredBy: number | null,
): Promise<number> {
  await ensureCorporateOpsSchema(db);
  const res = await execute(
    db,
    `INSERT INTO corporate_ops_runs (kind, status, triggered_by, trigger_source, started_at)
     VALUES (?, 'running', ?, ?, datetime('now'))`,
    kind, triggeredBy, source,
  );
  return Number(res.meta.last_row_id);
}

async function finishRun(
  db: D1Database,
  runId: number,
  itemCount: number,
  summary: Record<string, unknown>,
  status: 'completed' | 'failed' = 'completed',
): Promise<void> {
  await execute(
    db,
    `UPDATE corporate_ops_runs SET status = ?, item_count = ?, summary_json = ?, finished_at = datetime('now') WHERE id = ?`,
    status, itemCount, JSON.stringify(summary), runId,
  );
}

async function addItem(
  db: D1Database,
  runId: number,
  entityType: string,
  entityId: number | null,
  officerId: number | null,
  summary: Record<string, unknown>,
): Promise<void> {
  await execute(
    db,
    `INSERT INTO corporate_ops_run_items (run_id, entity_type, entity_id, officer_id, summary_json)
     VALUES (?, ?, ?, ?, ?)`,
    runId, entityType, entityId, officerId, JSON.stringify(summary),
  );
}

export async function lookupTodayScheduleId(db: D1Database, officerId: number, day = denverToday()): Promise<number | null> {
  try {
    const row = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM schedules WHERE officer_id = ? AND shift_date = ? AND status != 'cancelled' ORDER BY start_time LIMIT 1`,
      officerId, day,
    );
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function officerOnApprovedLeave(db: D1Database, officerId: number, day = denverToday()): Promise<boolean> {
  try {
    const row = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM leave_requests
        WHERE officer_id = ? AND status = 'approved'
          AND date(?) BETWEEN date(start_date) AND date(end_date)`,
      officerId, day,
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function recordTardyIfLate(
  db: D1Database,
  officerId: number,
  clockInIso: string,
  documentedBy: number | null,
): Promise<{ recorded: boolean; minutes_late: number }> {
  const day = denverDateFromIso(clockInIso);
  try {
    const sched = await queryFirst<{ shift_date: string; start_time: string }>(
      db,
      `SELECT shift_date, start_time FROM schedules
        WHERE officer_id = ? AND shift_date = ? AND status != 'cancelled' ORDER BY start_time LIMIT 1`,
      officerId, day,
    );
    if (!sched) return { recorded: false, minutes_late: 0 };
    const late = minutesLate(clockInIso, combineScheduleStart(sched.shift_date, sched.start_time));
    if (late <= 0) return { recorded: false, minutes_late: 0 };
    const existing = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM hr_attendance WHERE officer_id = ? AND date = ? AND type = 'tardy' LIMIT 1`,
      officerId, day,
    );
    if (existing) return { recorded: false, minutes_late: late };
    await execute(
      db,
      `INSERT INTO hr_attendance (officer_id, date, type, minutes_late, reason, excused, documented_by, created_at)
       VALUES (?, ?, 'tardy', ?, 'Auto from time clock vs schedule', 0, ?, datetime('now'))`,
      officerId, day, late, documentedBy,
    );
    return { recorded: true, minutes_late: late };
  } catch (err) {
    log.warn('[corporateOps] tardy insert failed', { officerId, err: String((err as Error)?.message) });
    return { recorded: false, minutes_late: 0 };
  }
}

export async function enrichTimeEntryOnClockIn(
  db: D1Database,
  entryId: number,
  officerId: number,
  opts: {
    clockSource: string;
    lat?: number | null;
    lng?: number | null;
  },
): Promise<{
  unit_id: number | null;
  vehicle_id: number | null;
  starting_mileage: number | null;
  schedule_id: number | null;
  service_due: boolean;
  license_expiring: boolean;
  handbook_pending: boolean;
}> {
  const unit = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM units WHERE officer_id = ? ORDER BY last_status_change DESC, id DESC LIMIT 1`,
    officerId,
  ).catch(() => null);
  const veh = unit
    ? await queryFirst<{ id: number; current_mileage: number | null; next_service_mileage: number | null }>(
      db,
      `SELECT id, current_mileage, next_service_mileage FROM fleet_vehicles WHERE assigned_unit_id = ? LIMIT 1`,
      unit.id,
    ).catch(() => null)
    : null;
  const scheduleId = await lookupTodayScheduleId(db, officerId);
  const startMi = veh?.current_mileage != null && Number(veh.current_mileage) > 0
    ? Math.round(Number(veh.current_mileage) * 10) / 10
    : null;
  const parts: string[] = ['clock_source = ?'];
  const vals: unknown[] = [opts.clockSource];
  if (unit?.id) { parts.push('unit_id = COALESCE(unit_id, ?)'); vals.push(unit.id); }
  if (veh?.id) { parts.push('vehicle_id = COALESCE(vehicle_id, ?)'); vals.push(veh.id); }
  if (startMi != null) { parts.push('starting_mileage = COALESCE(starting_mileage, ?)'); vals.push(startMi); }
  if (scheduleId) { parts.push('schedule_id = COALESCE(schedule_id, ?)'); vals.push(scheduleId); }
  if (opts.lat != null && Number.isFinite(opts.lat)) { parts.push('clock_in_latitude = COALESCE(clock_in_latitude, ?)'); vals.push(opts.lat); }
  if (opts.lng != null && Number.isFinite(opts.lng)) { parts.push('clock_in_longitude = COALESCE(clock_in_longitude, ?)'); vals.push(opts.lng); }
  vals.push(entryId);
  await execute(db, `UPDATE time_entries SET ${parts.join(', ')} WHERE id = ?`, ...vals);

  let license_expiring = false;
  try {
    const cred = await queryFirst<{ expiry_date: string }>(
      db,
      `SELECT expiry_date FROM officer_credentials
        WHERE officer_id = ? AND LOWER(credential_type) LIKE '%licen%'
          AND expiry_date IS NOT NULL
        ORDER BY expiry_date LIMIT 1`,
      officerId,
    );
    if (cred?.expiry_date) {
      const days = (Date.parse(cred.expiry_date) - Date.now()) / 86_400_000;
      license_expiring = Number.isFinite(days) && days <= 14;
    }
  } catch { /* optional table */ }

  const service_due = !!(veh?.next_service_mileage != null && startMi != null && startMi >= Number(veh.next_service_mileage));
  let handbook_pending = false;
  try {
    const row = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM hr_documents d
        WHERE LOWER(COALESCE(d.category, '')) = 'handbook'
          AND NOT EXISTS (
            SELECT 1 FROM hr_handbook_acknowledgments a
             WHERE a.document_id = d.id AND a.officer_id = ?
          )`,
      officerId,
    );
    handbook_pending = (row?.n ?? 0) > 0;
  } catch { handbook_pending = false; }
  return {
    unit_id: unit?.id ?? null,
    vehicle_id: veh?.id ?? null,
    starting_mileage: startMi,
    schedule_id: scheduleId,
    service_due,
    license_expiring,
    handbook_pending,
  };
}

export async function finalizeTimeEntryOnClockOut(
  db: D1Database,
  entry: { id: number; clock_in: string; break_minutes?: number | null; break_start?: string | null; starting_mileage?: number | null; vehicle_id?: number | null; status?: string },
  endingMileageRaw: unknown,
): Promise<{ hours: number; ending_mileage: number | null; total_miles: number | null }> {
  let breakMin = Number(entry.break_minutes) || 0;
  if (entry.break_start) {
    const added = Math.round((Date.now() - Date.parse(entry.break_start)) / 60_000);
    breakMin = capBreakMinutes(breakMin + (Number.isFinite(added) ? added : 0));
  }
  const stamp = nowDualStamp();
  const hrs = hoursBetween(String(entry.clock_in), stamp.utc, breakMin);
  let ending = typeof endingMileageRaw === 'number' ? endingMileageRaw : Number(endingMileageRaw);
  if (!Number.isFinite(ending) || ending <= 0) {
    if (entry.vehicle_id) {
      const veh = await queryFirst<{ current_mileage: number | null }>(
        db, 'SELECT current_mileage FROM fleet_vehicles WHERE id = ?', entry.vehicle_id,
      ).catch(() => null);
      ending = veh?.current_mileage != null ? Number(veh.current_mileage) : NaN;
    }
  }
  const startMi = entry.starting_mileage != null ? Number(entry.starting_mileage) : null;
  const endMi = Number.isFinite(ending) && ending > 0 ? Math.round(ending * 10) / 10 : null;
  const totalMiles = milesDelta(startMi, endMi);
  await execute(
    db,
    `UPDATE time_entries SET clock_out = ?, clock_out_local = ?, total_hours = ?, ending_mileage = ?, total_miles = ?,
            break_start = NULL, break_minutes = ?, status = 'completed' WHERE id = ?`,
    stamp.utc, stamp.local, hrs, endMi, totalMiles, breakMin, entry.id,
  );
  if (endMi != null) await setFleetOdometer(db, entry.vehicle_id ?? null, endMi);
  return { hours: hrs, ending_mileage: endMi, total_miles: totalMiles };
}

export async function linkServeAttemptToShift(
  db: D1Database,
  attemptId: number,
  officerId: number | null,
): Promise<{ time_entry_id: number | null; vehicle_id: number | null }> {
  if (!officerId || attemptId <= 0) return { time_entry_id: null, vehicle_id: null };
  await ensureCorporateOpsSchema(db);
  const entry = await queryFirst<{ id: number; vehicle_id: number | null; starting_mileage: number | null; ending_mileage: number | null }>(
    db,
    `SELECT id, vehicle_id, starting_mileage, ending_mileage FROM time_entries
      WHERE officer_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
    officerId,
  ).catch(() => null);
  if (!entry) return { time_entry_id: null, vehicle_id: null };
  const snapshot = milesDelta(entry.starting_mileage, entry.ending_mileage);
  try {
    if (await columnExists(db, 'serve_attempts', 'time_entry_id')) {
      await execute(
        db,
        `UPDATE serve_attempts SET time_entry_id = ?, vehicle_id = COALESCE(?, vehicle_id), duty_miles_snapshot = ? WHERE id = ?`,
        entry.id, entry.vehicle_id, snapshot, attemptId,
      );
    }
  } catch (err) {
    log.warn('[corporateOps] serve attempt link failed', { attemptId, err: String((err as Error)?.message) });
  }
  return { time_entry_id: entry.id, vehicle_id: entry.vehicle_id ?? null };
}

export async function requireOnDutyForServe(
  db: D1Database,
  officerId: number,
): Promise<{ on_duty: boolean; time_entry_id: number | null }> {
  const entry = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM time_entries WHERE officer_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,
    officerId,
  ).catch(() => null);
  return { on_duty: !!entry, time_entry_id: entry?.id ?? null };
}

async function gpsTripMilesForOfficerDay(db: D1Database, officerId: number, day: string): Promise<number> {
  try {
    const hasOnFoot = await columnExists(db, 'unit_trips', 'on_foot');
    const row = await queryFirst<{ m: number | null }>(
      db,
      `SELECT COALESCE(SUM(t.distance_m), 0) AS m
         FROM unit_trips t
         JOIN units u ON u.id = t.unit_id
        WHERE u.officer_id = ?
          AND date(COALESCE(t.end_time, t.start_time)) = ?
          ${hasOnFoot ? 'AND COALESCE(t.on_foot, 0) = 0' : ''}`,
      officerId, day,
    );
    return metersToMiles(row?.m ?? 0);
  } catch {
    return 0;
  }
}

async function cfsMilesForOfficerDay(db: D1Database, officerId: number, day: string): Promise<number> {
  try {
    const row = await queryFirst<{ m: number | null }>(
      db,
      `SELECT COALESCE(SUM(
          CASE WHEN c.ending_mileage IS NOT NULL AND c.starting_mileage IS NOT NULL
               THEN MAX(0, c.ending_mileage - c.starting_mileage) ELSE 0 END
        ), 0) AS m
         FROM calls_for_service c
         JOIN units u ON (',' || COALESCE(c.assigned_unit_ids,'') || ',') LIKE '%,' || u.id || ',%'
            OR u.call_sign = c.primary_unit
        WHERE u.officer_id = ?
          AND date(COALESCE(c.cleared_at, c.onscene_at, c.created_at)) = ?`,
      officerId, day,
    );
    return Math.round(Number(row?.m ?? 0) * 100) / 100;
  } catch {
    return 0;
  }
}

export async function runMileageReconcile(
  db: D1Database,
  day: string,
  triggeredBy: number | null,
  source: string,
): Promise<{ run_id: number; item_count: number }> {
  const runId = await startRun(db, 'mileage_reconcile', source, triggeredBy);
  try {
    const entries = await query<{
      id: number; officer_id: number; vehicle_id: number | null; unit_id: number | null;
      total_miles: number | null; starting_mileage: number | null; ending_mileage: number | null;
      clock_in: string;
    }>(
      db,
      `SELECT id, officer_id, vehicle_id, unit_id, total_miles, starting_mileage, ending_mileage, clock_in
         FROM time_entries
        WHERE date(clock_in) = ? OR date(clock_in_local) = ?`,
      day, day,
    ).catch(() => []);

    const officers = new Set(entries.map((e) => e.officer_id));
    const extraServe = await query<{ officer_id: number }>(
      db, `SELECT DISTINCT officer_id FROM serve_attempts WHERE date(attempt_at) = ? AND officer_id IS NOT NULL`, day,
    ).catch(() => []);
    for (const r of extraServe) officers.add(r.officer_id);

    let items = 0;
    for (const officerId of officers) {
      const mine = entries.filter((e) => e.officer_id === officerId);
      const duty = mine.reduce((s, e) => s + (e.total_miles != null ? Number(e.total_miles) : (milesDelta(e.starting_mileage, e.ending_mileage) ?? 0)), 0);
      const gps = await gpsTripMilesForOfficerDay(db, officerId, day);
      let serve = 0;
      try { serve = await computeOfficerMileageForDay(db, officerId, day); } catch { serve = 0; }
      const cfs = await cfsMilesForOfficerDay(db, officerId, day);
      const rec = reconcileMileage({ duty_miles: duty, gps_trip_miles: gps, serve_billed_miles: serve, cfs_miles: cfs });
      const primary = mine[0];
      await execute(
        db,
        `INSERT INTO corporate_mileage_links
           (officer_id, work_date, time_entry_id, vehicle_id, unit_id, duty_miles, gps_trip_miles, serve_billed_miles, cfs_miles, variance_miles, flag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(officer_id, work_date, time_entry_id) DO UPDATE SET
           duty_miles = excluded.duty_miles,
           gps_trip_miles = excluded.gps_trip_miles,
           serve_billed_miles = excluded.serve_billed_miles,
           cfs_miles = excluded.cfs_miles,
           variance_miles = excluded.variance_miles,
           flag = excluded.flag,
           vehicle_id = excluded.vehicle_id,
           unit_id = excluded.unit_id`,
        officerId, day, primary?.id ?? 0, primary?.vehicle_id ?? null, primary?.unit_id ?? null,
        rec.duty_miles, rec.gps_trip_miles, rec.serve_billed_miles, rec.cfs_miles, rec.variance_miles, rec.flag,
      );
      await addItem(db, runId, 'officer_day', primary?.id ?? null, officerId, rec);
      items++;
    }
    await finishRun(db, runId, items, { day, officers: officers.size });
    return { run_id: runId, item_count: items };
  } catch (err) {
    log.error('[corporateOps] mileage reconcile failed', { day }, err);
    await finishRun(db, runId, 0, { error: String((err as Error)?.message) }, 'failed');
    throw err;
  }
}

export interface PayrollPopulateResult {
  created: number;
  updated: number;
  skipped_final: number;
  total: number;
  hours_filled: number;
  miles_filled: number;
}

export async function populatePayrollFromClocks(
  db: D1Database,
  periodId: number,
): Promise<PayrollPopulateResult> {
  await ensureCorporateOpsSchema(db);
  const period = await queryFirst<{ start_date: string; end_date: string; status: string }>(
    db, 'SELECT start_date, end_date, status FROM hr_pay_periods WHERE id = ?', periodId,
  );
  if (!period) throw new Error('Pay period not found');
  const start = period.start_date;
  const end = period.end_date;
  const now = new Date().toISOString();

  const activeUsers = await query<{ id: number }>(
    db, `SELECT id FROM users WHERE COALESCE(status, 'active') = 'active' ORDER BY full_name`,
  );
  const existing = await query<{ id: number; user_id: number; status: string }>(
    db, 'SELECT id, user_id, status FROM hr_payroll_entries WHERE pay_period_id = ?', periodId,
  );
  const byUser = new Map(existing.map((e) => [e.user_id, e]));

  let created = 0;
  let updated = 0;
  let skipped_final = 0;
  let hours_filled = 0;
  let miles_filled = 0;

  const hasClockCol = await columnExists(db, 'hr_payroll_entries', 'clock_hours');

  for (const u of activeUsers) {
    const clock = await queryFirst<{ hours: number | null; miles: number | null }>(
      db,
      `SELECT COALESCE(SUM(total_hours), 0) AS hours, COALESCE(SUM(total_miles), 0) AS miles
         FROM time_entries
        WHERE officer_id = ? AND clock_out IS NOT NULL
          AND date(clock_in) >= date(?) AND date(clock_in) <= date(?)`,
      u.id, start, end,
    );
    const hours = Number(clock?.hours ?? 0);
    const dutyMiles = Number(clock?.miles ?? 0);
    let serveMiles = 0;
    try {
      // Sum per-day serve miles across the period (bounded: iterate dates only if period ≤ 16 days).
      const days = [];
      for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
        days.push(d.toISOString().slice(0, 10));
        if (days.length > 16) break;
      }
      for (const day of days) {
        serveMiles += await computeOfficerMileageForDay(db, u.id, day);
      }
    } catch { serveMiles = 0; }

    const gpsMiles = await queryFirst<{ m: number | null }>(
      db,
      `SELECT COALESCE(SUM(t.distance_m), 0) AS m
         FROM unit_trips t JOIN units un ON un.id = t.unit_id
        WHERE un.officer_id = ? AND date(COALESCE(t.end_time, t.start_time)) >= date(?)
          AND date(COALESCE(t.end_time, t.start_time)) <= date(?)`,
      u.id, start, end,
    ).then((r) => metersToMiles(r?.m ?? 0)).catch(() => 0);

    const leave = await queryFirst<{ pto: number | null; sick: number | null }>(
      db,
      `SELECT
          COALESCE(SUM(CASE WHEN type IN ('vacation','personal') THEN hours_requested ELSE 0 END), 0) AS pto,
          COALESCE(SUM(CASE WHEN type = 'sick' THEN hours_requested ELSE 0 END), 0) AS sick
         FROM leave_requests
        WHERE officer_id = ? AND status = 'approved'
          AND date(start_date) <= date(?) AND date(end_date) >= date(?)`,
      u.id, end, start,
    ).catch(() => ({ pto: 0, sick: 0 }));

    const split = overtimeFromPeriodHours(hours, start, end);
    const payRate = await queryFirst<{ id: number; rate: number; overtime_rate: number; holiday_rate: number }>(
      db,
      `SELECT id, rate, overtime_rate, holiday_rate FROM hr_pay_rates
        WHERE user_id = ? AND end_date IS NULL ORDER BY effective_date DESC LIMIT 1`,
      u.id,
    ).catch(() => null);
    const pay = payrollGross({
      regular_hours: split.regular_hours,
      overtime_hours: split.overtime_hours,
      holiday_hours: 0,
      rate: payRate?.rate ?? 0,
      overtime_rate: payRate?.overtime_rate,
      holiday_rate: payRate?.holiday_rate,
    });
    const reimburse = mileageReimburse(dutyMiles, IRS_MILEAGE_RATE);
    hours_filled += hours;
    miles_filled += dutyMiles;

    const row = byUser.get(u.id);
    if (row && row.status !== 'draft') {
      skipped_final++;
      continue;
    }

    if (row) {
      if (hasClockCol) {
        await execute(
          db,
          `UPDATE hr_payroll_entries SET regular_hours = ?, overtime_hours = ?, pto_hours = ?, sick_hours = ?,
            base_pay = ?, overtime_pay = ?, holiday_pay = ?, gross_pay = ?, net_pay = ?,
            clock_hours = ?, duty_miles = ?, serve_miles = ?, gps_trip_miles = ?, mileage_reimburse = ?,
            pay_rate_id = COALESCE(pay_rate_id, ?), updated_at = ?
           WHERE id = ? AND status = 'draft'`,
          split.regular_hours, split.overtime_hours, leave?.pto ?? 0, leave?.sick ?? 0,
          pay.base_pay, pay.overtime_pay, pay.holiday_pay, pay.gross_pay, pay.gross_pay,
          hours, dutyMiles, serveMiles, gpsMiles, reimburse,
          payRate?.id ?? null, now, row.id,
        );
      } else {
        await execute(
          db,
          `UPDATE hr_payroll_entries SET regular_hours = ?, overtime_hours = ?, pto_hours = ?, sick_hours = ?,
            base_pay = ?, overtime_pay = ?, holiday_pay = ?, gross_pay = ?, net_pay = ?, updated_at = ?
           WHERE id = ? AND status = 'draft'`,
          split.regular_hours, split.overtime_hours, leave?.pto ?? 0, leave?.sick ?? 0,
          pay.base_pay, pay.overtime_pay, pay.holiday_pay, pay.gross_pay, pay.gross_pay,
          now, row.id,
        );
      }
      updated++;
    } else {
      if (hasClockCol) {
        await execute(
          db,
          `INSERT INTO hr_payroll_entries (user_id, pay_period_id, pay_rate_id, regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours, base_pay, overtime_pay, holiday_pay, gross_pay, total_deductions, net_pay, status, clock_hours, duty_miles, serve_miles, gps_trip_miles, mileage_reimburse, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 0, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
          u.id, periodId, payRate?.id ?? null, split.regular_hours, split.overtime_hours,
          leave?.pto ?? 0, leave?.sick ?? 0,
          pay.base_pay, pay.overtime_pay, pay.holiday_pay, pay.gross_pay, pay.gross_pay,
          hours, dutyMiles, serveMiles, gpsMiles, reimburse, now, now,
        );
      } else {
        await execute(
          db,
          `INSERT INTO hr_payroll_entries (user_id, pay_period_id, pay_rate_id, regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours, base_pay, overtime_pay, holiday_pay, gross_pay, total_deductions, net_pay, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 0, ?, 'draft', ?, ?)`,
          u.id, periodId, payRate?.id ?? null, split.regular_hours, split.overtime_hours,
          leave?.pto ?? 0, leave?.sick ?? 0,
          pay.base_pay, pay.overtime_pay, pay.holiday_pay, pay.gross_pay, pay.gross_pay, now, now,
        );
      }
      created++;
    }

    if (split.overtime_hours > 0) {
      try {
        const existsOt = await queryFirst<{ id: number }>(
          db,
          `SELECT id FROM overtime_requests WHERE officer_id = ? AND requested_date = ? LIMIT 1`,
          u.id, end,
        );
        if (!existsOt) {
          await execute(
            db,
            `INSERT INTO overtime_requests (officer_id, requested_date, hours_requested, reason, status, created_at)
             VALUES (?, ?, ?, 'Auto from time clock populate', 'requested', datetime('now'))`,
            u.id, end, split.overtime_hours,
          );
        }
      } catch { /* overtime_requests optional */ }
    }
  }

  return { created, updated, skipped_final, total: activeUsers.length, hours_filled, miles_filled };
}

export async function runAttendanceTardy(
  db: D1Database,
  day: string,
  triggeredBy: number | null,
  source: string,
): Promise<{ run_id: number; item_count: number }> {
  const runId = await startRun(db, 'attendance_tardy', source, triggeredBy);
  const entries = await query<{ id: number; officer_id: number; clock_in: string }>(
    db,
    `SELECT id, officer_id, clock_in FROM time_entries WHERE date(clock_in) = ? OR date(clock_in_local) = ?`,
    day, day,
  ).catch(() => []);
  let items = 0;
  for (const e of entries) {
    const r = await recordTardyIfLate(db, e.officer_id, e.clock_in, triggeredBy);
    if (r.recorded) {
      await addItem(db, runId, 'tardy', e.id, e.officer_id, r);
      items++;
    }
  }
  await finishRun(db, runId, items, { day });
  return { run_id: runId, item_count: items };
}

export async function runShiftUnattended(
  db: D1Database,
  day: string,
  triggeredBy: number | null,
  source: string,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ run_id: number; item_count: number }> {
  const runId = await startRun(db, 'shift_unattended', source, triggeredBy);
  const rows = await query<{ id: number; officer_id: number; start_time: string }>(
    db,
    `SELECT s.id, s.officer_id, s.start_time FROM schedules s
      WHERE s.shift_date = ? AND s.status != 'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM time_entries te
           WHERE te.officer_id = s.officer_id
             AND (date(te.clock_in) = s.shift_date OR date(te.clock_in_local) = s.shift_date)
        )`,
    day,
  ).catch(() => []);
  for (const r of rows) {
    await addItem(db, runId, 'schedule', r.id, r.officer_id, { start_time: r.start_time, day });
    await evaluateNotificationRules(db, 'shift_unattended', {
      title: 'Shift unattended',
      message: `Scheduled shift on ${day} has no clock-in`,
      entity_type: 'schedule',
      entity_id: r.id,
      officer_id: r.officer_id,
    }, env, undefined).catch(() => {});
  }
  await finishRun(db, runId, rows.length, { day });
  return { run_id: runId, item_count: rows.length };
}

export async function runStaleOpenShifts(
  db: D1Database,
  triggeredBy: number | null,
  source: string,
): Promise<{ run_id: number; item_count: number }> {
  const runId = await startRun(db, 'stale_open_shifts', source, triggeredBy);
  const rows = await query<{ id: number; officer_id: number; clock_in: string }>(
    db, `SELECT id, officer_id, clock_in FROM time_entries WHERE clock_out IS NULL`,
  ).catch(() => []);
  const stale = rows.filter((r) => isStaleOpenShift(r.clock_in, Date.now(), STALE_SHIFT_HOURS));
  for (const r of stale) {
    await addItem(db, runId, 'time_entry', r.id, r.officer_id, { clock_in: r.clock_in });
  }
  await finishRun(db, runId, stale.length, { hours: STALE_SHIFT_HOURS });
  return { run_id: runId, item_count: stale.length };
}

export async function runServeDutyGaps(
  db: D1Database,
  day: string,
  triggeredBy: number | null,
  source: string,
): Promise<{ run_id: number; item_count: number }> {
  const runId = await startRun(db, 'serve_duty_gaps', source, triggeredBy);
  await ensureCorporateOpsSchema(db);
  const hasCol = await columnExists(db, 'serve_attempts', 'time_entry_id');
  const rows = hasCol
    ? await query<{ id: number; officer_id: number }>(
      db,
      `SELECT id, officer_id FROM serve_attempts WHERE date(attempt_at) = ? AND time_entry_id IS NULL AND officer_id IS NOT NULL`,
      day,
    ).catch(() => [])
    : [];
  for (const r of rows) await addItem(db, runId, 'serve_attempt', r.id, r.officer_id, { day });
  await finishRun(db, runId, rows.length, { day });
  return { run_id: runId, item_count: rows.length };
}

export async function runFleetServiceDue(
  db: D1Database,
  triggeredBy: number | null,
  source: string,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ run_id: number; item_count: number }> {
  const runId = await startRun(db, 'fleet_service_due', source, triggeredBy);
  const rows = await query<{ id: number; vehicle_number: string | null; current_mileage: number | null; next_service_mileage: number | null }>(
    db,
    `SELECT id, vehicle_number, current_mileage, next_service_mileage FROM fleet_vehicles
      WHERE COALESCE(status, 'in_service') = 'in_service'
        AND next_service_mileage IS NOT NULL AND current_mileage IS NOT NULL
        AND current_mileage >= next_service_mileage`,
  ).catch(() => []);
  for (const r of rows) {
    await addItem(db, runId, 'fleet_vehicle', r.id, null, r);
    await evaluateNotificationRules(db, 'vehicle_maintenance_due', {
      title: 'Vehicle service due',
      message: `${r.vehicle_number ?? r.id} is at ${r.current_mileage} (due ${r.next_service_mileage})`,
      entity_type: 'fleet_vehicle',
      entity_id: r.id,
    }, env).catch(() => {});
  }
  await finishRun(db, runId, rows.length, {});
  return { run_id: runId, item_count: rows.length };
}

export async function runNightlyBundle(
  db: D1Database,
  triggeredBy: number | null,
  source: string,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ run_id: number; children: Record<string, number> }> {
  const day = denverToday();
  const parent = await startRun(db, 'nightly_bundle', source, triggeredBy);
  const children: Record<string, number> = {};
  try {
    children.mileage = (await runMileageReconcile(db, day, triggeredBy, source)).item_count;
    children.tardy = (await runAttendanceTardy(db, day, triggeredBy, source)).item_count;
    children.unattended = (await runShiftUnattended(db, day, triggeredBy, source, env)).item_count;
    children.stale = (await runStaleOpenShifts(db, triggeredBy, source)).item_count;
    children.serve_gaps = (await runServeDutyGaps(db, day, triggeredBy, source)).item_count;
    children.fleet = (await runFleetServiceDue(db, triggeredBy, source, env)).item_count;
    await finishRun(db, parent, Object.values(children).reduce((s, n) => s + n, 0), { day, children });
  } catch (err) {
    await finishRun(db, parent, 0, { error: String((err as Error)?.message) }, 'failed');
    throw err;
  }
  return { run_id: parent, children };
}

export async function loadCorporateSnapshot(db: D1Database): Promise<Record<string, unknown>> {
  await ensureCorporateOpsSchema(db);
  const day = denverToday();
  const clocked = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM time_entries WHERE clock_out IS NULL`).catch(() => ({ n: 0 }));
  const scheduled = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM schedules WHERE shift_date = ? AND status != 'cancelled'`, day).catch(() => ({ n: 0 }));
  const hoursToday = await queryFirst<{ h: number | null }>(
    db, `SELECT COALESCE(SUM(total_hours), 0) AS h FROM time_entries WHERE date(clock_in) = ? OR date(clock_in_local) = ?`, day, day,
  ).catch(() => ({ h: 0 }));
  const dutyMiles = await queryFirst<{ m: number | null }>(
    db, `SELECT COALESCE(SUM(total_miles), 0) AS m FROM time_entries WHERE date(clock_in) = ? OR date(clock_in_local) = ?`, day, day,
  ).catch(() => ({ m: 0 }));
  const serveAttempts = await queryFirst<{ n: number }>(
    db, `SELECT COUNT(*) AS n FROM serve_attempts WHERE date(attempt_at) = ?`, day,
  ).catch(() => ({ n: 0 }));
  const fleetDue = await queryFirst<{ n: number }>(
    db, `SELECT COUNT(*) AS n FROM fleet_vehicles WHERE next_service_mileage IS NOT NULL AND current_mileage >= next_service_mileage AND COALESCE(status,'in_service')='in_service'`,
  ).catch(() => ({ n: 0 }));
  const flags = await queryFirst<{ n: number }>(
    db, `SELECT COUNT(*) AS n FROM corporate_mileage_links WHERE work_date = ? AND flag IS NOT NULL`, day,
  ).catch(() => ({ n: 0 }));
  const onDutyMap = await query<Record<string, unknown>>(
    db,
    `SELECT us.id AS officer_id, us.full_name, un.call_sign, fv.vehicle_number, un.latitude, un.longitude, te.total_miles, te.clock_in
       FROM time_entries te
       JOIN users us ON us.id = te.officer_id
       LEFT JOIN units un ON un.id = COALESCE(te.unit_id, (SELECT id FROM units WHERE officer_id = te.officer_id ORDER BY last_status_change DESC LIMIT 1))
       LEFT JOIN fleet_vehicles fv ON fv.id = te.vehicle_id OR fv.assigned_unit_id = un.id
      WHERE te.clock_out IS NULL
      ORDER BY us.full_name`,
  ).catch(() => []);
  const lastRuns = await query<{ id: number; kind: string; status: string; item_count: number; started_at: string }>(
    db, `SELECT id, kind, status, item_count, started_at FROM corporate_ops_runs ORDER BY id DESC LIMIT 12`,
  ).catch(() => []);
  const handbookPending = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT u.id) AS n
       FROM users u
      WHERE u.status = 'active'
        AND EXISTS (
          SELECT 1 FROM hr_documents d
           WHERE LOWER(COALESCE(d.category, '')) = 'handbook'
             AND NOT EXISTS (
               SELECT 1 FROM hr_handbook_acknowledgments a
                WHERE a.document_id = d.id AND a.officer_id = u.id
             )
        )`,
  ).catch(() => ({ n: 0 }));
  const lowFuel = await query<{ id: number; vehicle_number: string | null; fuel_level: number | null }>(
    db,
    `SELECT id, vehicle_number, fuel_level FROM fleet_vehicles
      WHERE COALESCE(status,'in_service')='in_service' AND fuel_level IS NOT NULL AND fuel_level <= 20
      ORDER BY fuel_level LIMIT 20`,
  ).catch(() => []);
  const cpm = await queryFirst<{ fuel: number | null; miles: number | null }>(
    db,
    `SELECT
       (SELECT COALESCE(SUM(total_cost), 0) FROM fleet_fuel_log WHERE fuel_date >= date('now','-30 days')) AS fuel,
       (SELECT COALESCE(SUM(total_miles), 0) FROM time_entries WHERE clock_out IS NOT NULL AND date(clock_in) >= date('now','-30 days')) AS miles`,
  ).catch(() => ({ fuel: 0, miles: 0 }));
  const fuel = Number(cpm?.fuel ?? 0);
  const miles = Number(cpm?.miles ?? 0);
  return {
    day,
    clocked_in_now: clocked?.n ?? 0,
    scheduled_today: scheduled?.n ?? 0,
    hours_today: hoursToday?.h ?? 0,
    duty_miles_today: dutyMiles?.m ?? 0,
    serve_attempts_today: serveAttempts?.n ?? 0,
    fleet_service_due: fleetDue?.n ?? 0,
    mileage_flags_today: flags?.n ?? 0,
    on_duty: onDutyMap,
    recent_runs: lastRuns,
    handbook_pending: handbookPending?.n ?? 0,
    low_fuel_units: lowFuel,
    cost_per_mile_30d: miles > 0 ? Math.round((fuel / miles) * 100) / 100 : null,
  };
}
