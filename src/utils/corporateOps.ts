// ============================================================
// Corporate ops — shared math + the 90 enhancer catalog.
// Pure functions only. D1 writes live in corporateWorkflows.ts.
// ============================================================

export const OVERTIME_WEEKLY_HOURS = 40;
export const TARDY_GRACE_MINUTES = 8;
export const MAX_BREAK_MINUTES = 60;
export const FATIGUE_REST_HOURS = 8;
export const STALE_SHIFT_HOURS = 16;
export const MILEAGE_VARIANCE_FLAG_MI = 8;
export const IRS_MILEAGE_RATE = 0.70; // 2026 IRS standard; reimbursement estimate only

export interface CorporateEnhancer {
  id: number;
  feature: string;
  change: string;
  benefit: string;
}

export function daysInclusive(startDate: string, endDate: string): number {
  const a = Date.parse(`${startDate}T00:00:00Z`);
  const b = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function overtimeFromPeriodHours(
  totalHours: number,
  periodStart: string,
  periodEnd: string,
  weekly = OVERTIME_WEEKLY_HOURS,
): { regular_hours: number; overtime_hours: number } {
  const hours = Number.isFinite(totalHours) && totalHours > 0 ? totalHours : 0;
  const weeks = Math.max(1, daysInclusive(periodStart, periodEnd) / 7);
  const cap = Math.round(weekly * weeks * 100) / 100;
  if (hours <= cap) return { regular_hours: round2(hours), overtime_hours: 0 };
  return { regular_hours: round2(cap), overtime_hours: round2(hours - cap) };
}

export function applyOvertimeThreshold(
  regularHours: number,
  overtimeHours: number | undefined | null,
): { regular_hours: number; overtime_hours: number } {
  if (overtimeHours != null || !Number.isFinite(regularHours) || regularHours <= OVERTIME_WEEKLY_HOURS) {
    return { regular_hours: regularHours, overtime_hours: overtimeHours ?? 0 };
  }
  return { regular_hours: OVERTIME_WEEKLY_HOURS, overtime_hours: regularHours - OVERTIME_WEEKLY_HOURS };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function hoursBetween(inIso: string, outIso: string, breakMin = 0): number {
  const a = new Date(inIso).getTime();
  const b = new Date(outIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return round2((b - a) / 3_600_000 - (Number.isFinite(breakMin) ? breakMin : 0) / 60);
}

export function minutesLate(clockInIso: string, scheduleStart: string, grace = TARDY_GRACE_MINUTES): number {
  const clock = Date.parse(clockInIso);
  const sched = Date.parse(scheduleStart);
  if (!Number.isFinite(clock) || !Number.isFinite(sched)) return 0;
  const late = Math.round((clock - sched) / 60_000) - grace;
  return late > 0 ? late : 0;
}

export function capBreakMinutes(minutes: number, cap = MAX_BREAK_MINUTES): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(Math.round(minutes), cap);
}

export function milesDelta(start: number | null | undefined, end: number | null | undefined): number | null {
  if (start == null || end == null) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return round2(Math.max(0, end - start));
}

export function metersToMiles(meters: number | null | undefined): number {
  if (meters == null || !Number.isFinite(meters) || meters <= 0) return 0;
  return round2(meters / 1609.344);
}

export interface MileageSources {
  duty_miles: number;
  gps_trip_miles: number;
  serve_billed_miles: number;
  cfs_miles: number;
}

export function reconcileMileage(src: MileageSources): {
  duty_miles: number;
  gps_trip_miles: number;
  serve_billed_miles: number;
  cfs_miles: number;
  variance_miles: number;
  flag: string | null;
} {
  const duty = round2(src.duty_miles || 0);
  const gps = round2(src.gps_trip_miles || 0);
  const serve = round2(src.serve_billed_miles || 0);
  const cfs = round2(src.cfs_miles || 0);
  const variance = round2(duty - gps);
  let flag: string | null = null;
  if (duty === 0 && gps > 1) flag = 'gps_travel_no_odometer';
  else if (Math.abs(variance) >= MILEAGE_VARIANCE_FLAG_MI) flag = 'duty_vs_gps_variance';
  else if (serve > duty + 2 && duty > 0) flag = 'serve_billed_exceeds_duty';
  return { duty_miles: duty, gps_trip_miles: gps, serve_billed_miles: serve, cfs_miles: cfs, variance_miles: variance, flag };
}

export function mileageReimburse(miles: number, rate = IRS_MILEAGE_RATE): number {
  return round2(Math.max(0, miles) * rate);
}

export function commuteVsBillable(totalDutyMiles: number, serveBilledMiles: number): {
  commute_miles: number;
  billable_miles: number;
} {
  const duty = Math.max(0, totalDutyMiles);
  const billed = Math.max(0, serveBilledMiles);
  const billable = Math.min(duty, billed);
  return { commute_miles: round2(Math.max(0, duty - billable)), billable_miles: round2(billable) };
}

export function payrollGross(opts: {
  regular_hours: number;
  overtime_hours: number;
  holiday_hours: number;
  rate: number;
  overtime_rate?: number;
  holiday_rate?: number;
}): { base_pay: number; overtime_pay: number; holiday_pay: number; gross_pay: number } {
  const rate = opts.rate || 0;
  const otMult = opts.overtime_rate ?? 1.5;
  const holMult = opts.holiday_rate ?? 1.5;
  const base_pay = round2(opts.regular_hours * rate);
  const overtime_pay = round2(opts.overtime_hours * rate * otMult);
  const holiday_pay = round2(opts.holiday_hours * rate * holMult);
  return { base_pay, overtime_pay, holiday_pay, gross_pay: round2(base_pay + overtime_pay + holiday_pay) };
}

export function isFatigueRisk(hoursSinceLastShift: number, minRest = FATIGUE_REST_HOURS): boolean {
  return Number.isFinite(hoursSinceLastShift) && hoursSinceLastShift < minRest;
}

export function isStaleOpenShift(clockInIso: string, nowMs = Date.now(), maxHours = STALE_SHIFT_HOURS): boolean {
  const t = Date.parse(clockInIso);
  if (!Number.isFinite(clockInIso as unknown as number) && !Number.isFinite(t)) return false;
  if (!Number.isFinite(t)) return false;
  return (nowMs - t) / 3_600_000 >= maxHours;
}

export function denverDateFromIso(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date(iso));
  } catch {
    return (iso || '').slice(0, 10);
  }
}

export function combineScheduleStart(shiftDate: string, startTime: string): string {
  const t = (startTime || '00:00').trim();
  const hhmm = t.length === 5 ? `${t}:00` : t;
  return `${shiftDate}T${hhmm}-07:00`;
}

export function resolveClockOfficerId(opts: {
  selfId: number | undefined;
  requested: unknown;
  role: string | undefined;
  onBehalfRoles: Set<string>;
}): { ok: true; officerId: number } | { ok: false; status: 401 | 403; error: string; code: string } {
  const self = opts.selfId;
  if (!self || !Number.isFinite(self)) {
    return { ok: false, status: 401, error: 'Authentication required', code: 'NO_OFFICER' };
  }
  const reqId = opts.requested != null ? Number(opts.requested) : NaN;
  if (!Number.isFinite(reqId) || reqId <= 0 || reqId === self) {
    return { ok: true, officerId: self };
  }
  if (opts.role && opts.onBehalfRoles.has(opts.role)) {
    return { ok: true, officerId: reqId };
  }
  return { ok: false, status: 403, error: 'Cannot clock another officer in or out', code: 'CLOCK_IDOR' };
}

export const CLOCK_ON_BEHALF_ROLES = new Set([
  'admin', 'manager', 'supervisor', 'dispatcher', 'human_resources',
]);

export const CORPORATE_ENHANCERS: CorporateEnhancer[] = [
  { id: 1, feature: 'Single clock identity', change: 'Personnel clock-in/out now resolve officer_id like duty (self unless dispatch/HR on-behalf).', benefit: 'Stops IDOR clock-ins that created payroll rows for the wrong officer.' },
  { id: 2, feature: 'Duty + personnel share clock_source', change: 'time_entries.clock_source records duty vs desk vs personnel vs workflow.', benefit: 'Payroll and audits can tell a field shift from a desk punch.' },
  { id: 3, feature: 'Clock-in GPS capture', change: 'Personnel clock-in stores clock_in_latitude/longitude when the client sends them.', benefit: 'HR and Map can prove where a punch happened.' },
  { id: 4, feature: 'Schedule auto-link', change: 'Duty and personnel clock-in attach today\'s schedules.id onto the time entry.', benefit: 'Tardy and unattended-shift workflows have a real join key.' },
  { id: 5, feature: 'Take-home / assigned vehicle on personnel clock', change: 'Desk-path clock-in still stamps unit_id, vehicle_id, and fleet odometer when a unit/car is already assigned.', benefit: 'Mileage is no longer blank just because the officer used Personnel instead of MDT.' },
  { id: 6, feature: 'Starting mileage fill-from fleet', change: 'If no odometer is typed, clock-in copies fleet_vehicles.current_mileage.', benefit: 'One-tap clock still records corporate miles.' },
  { id: 7, feature: 'Clock-out ending mileage', change: 'Personnel clock-out fills ending_mileage and total_miles from fleet odometer when omitted.', benefit: 'Duty miles land in HR even from the simple clock widget.' },
  { id: 8, feature: 'Fleet odometer sync on personnel punch', change: 'Clock-out calls setFleetOdometer when an ending reading exists.', benefit: 'Fleet, Map trips, and payroll share one odometer truth.' },
  { id: 9, feature: 'Leave blocks field duty', change: 'Duty start 409s ON_LEAVE; admin/manager/supervisor/dispatcher/HR may pass override_leave=1.', benefit: 'Officers on PTO cannot silently go 10-8 and bill hours.' },
  { id: 10, feature: 'Fatigue already on duty — now on personnel too', change: 'Personnel clock-in uses the same <8h rest warning as duty/start.', benefit: 'HR clock path cannot bypass fatigue policy.' },
  { id: 11, feature: 'Break minute cap', change: 'end-break clamps accumulated minutes at 60.', benefit: 'A forgotten break-end cannot zero out a whole shift for payroll.' },
  { id: 12, feature: 'Auto-end break on clock-out', change: 'Clock-out closes an open break and folds minutes into total_hours.', benefit: 'Officers who clock out while on lunch still get a complete timecard.' },
  { id: 13, feature: 'Denver local stamps on duty start/end', change: 'Duty writes clock_in_local / clock_out_local via nowDualStamp.', benefit: 'Personnel Time tab shows Denver wall time for MDT shifts too.' },
  { id: 14, feature: 'Duty schedule_id', change: 'duty/start writes schedule_id from today\'s schedules row.', benefit: 'Unattended-shift cron can compare roster vs actual punches.' },
  { id: 15, feature: 'Mid-shift vehicle swap', change: 'POST /dispatch/duty/swap-vehicle reassigns fleet + updates the open time_entry.', benefit: 'Pool cars can change without closing the shift and losing hours.' },
  { id: 16, feature: 'Stale open-shift flag', change: 'Nightly workflow flags time_entries still open after 16 hours.', benefit: 'Forgotten clock-outs surface before payroll populate.' },
  { id: 17, feature: 'Payroll populate from clocks', change: 'POST /hr/payroll/periods/:id/populate SUMs time_entries in the period window.', benefit: 'Draft payroll hours match the time clock instead of zeros.' },
  { id: 18, feature: 'Period-aware overtime split', change: 'Populate splits regular vs OT using period length × 40h/week.', benefit: 'Biweekly periods no longer dump 80 hours into regular_hours.' },
  { id: 19, feature: 'PTO/sick from leave_requests', change: 'Populate adds approved vacation/personal into pto_hours and sick into sick_hours.', benefit: 'Leave already approved in HR hits the same paycheck draft.' },
  { id: 20, feature: 'Duty miles on payroll rows', change: 'Populate writes duty_miles and a mileage_reimburse estimate onto hr_payroll_entries.', benefit: 'Finance sees hours and miles on one corporate record.' },
  { id: 21, feature: 'Serve billed miles on payroll', change: 'Populate attaches serve GPS miles for the same officer/period.', benefit: 'Client-billable miles sit next to company duty miles for reconciliation.' },
  { id: 22, feature: 'GPS trip miles on payroll', change: 'Populate sums unit_trips.distance_m for the officer\'s units in the period.', benefit: 'Map-derived travel is visible to HR without opening Fleet.' },
  { id: 23, feature: 'Draft-only overwrite', change: 'Populate updates existing draft entries; approved/paid rows are left alone.', benefit: 'Re-running populate cannot clobber a finalized check.' },
  { id: 24, feature: 'Clock hours column', change: 'hr_payroll_entries.clock_hours stores the raw SUM before OT split.', benefit: 'Auditors can see source hours vs regular/OT split.' },
  { id: 25, feature: 'Auto tardy from schedule', change: 'Clock-in later than schedule start + 8 min inserts hr_attendance type=tardy.', benefit: 'Attendance is no longer only a manual HR form.' },
  { id: 26, feature: 'Tardy dedupe', change: 'Tardy insert is unique per officer+date (INSERT OR IGNORE pattern).', benefit: 'Double clock-in retries do not create duplicate discipline records.' },
  { id: 27, feature: 'Shift-unattended workflow', change: 'Nightly run finds schedules with no time_entry and emits shift_unattended.', benefit: 'Dispatch/HR see no-shows without watching the roster all morning.' },
  { id: 28, feature: 'shift_unattended alert live flag', change: 'Admin notification catalog marks shift_unattended as live.', benefit: 'Operators can actually wire a rule instead of a dead UI label.' },
  { id: 29, feature: 'Vehicle service-due alert live flag', change: 'Admin catalog marks vehicle_maintenance_due as live.', benefit: 'Fleet due dates can page supervisors from the same engine as CAD alerts.' },
  { id: 30, feature: 'HR dashboard clocked vs scheduled', change: '/hr/dashboard adds clocked_in_now, scheduled_today, unattended_today.', benefit: 'HR landing page shows live operations, not just leave counts.' },
  { id: 31, feature: 'OT suggestion from weekly hours', change: 'Populate creates overtime_requests drafts when OT hours > 0 and none exist for that date.', benefit: 'Supervisors get a queue instead of discovering OT at payday.' },
  { id: 32, feature: 'Payroll CSV miles columns', change: 'Payroll export includes clock_hours, duty_miles, serve_miles, gps_trip_miles.', benefit: 'Accounting can ingest the corporate join without a second report.' },
  { id: 33, feature: 'Personnel time SELECT miles', change: 'GET /personnel/time returns unit/vehicle/mileage/clock_source.', benefit: 'Time & Attendance tab can show miles next to hours.' },
  { id: 34, feature: 'Time tab miles column', change: 'TimeAttendanceTab shows total_miles and a shift miles summary card.', benefit: 'Supervisors see mileage without opening Fleet.' },
  { id: 35, feature: 'Duty timecard miles', change: 'GET /dispatch/duty/timecard includes total_miles and vehicle_id.', benefit: 'Officers reviewing their own card see travel, not just hours.' },
  { id: 36, feature: 'Serve requires on-duty', change: 'Officers logging a serve attempt while off-duty get 409 NOT_ON_DUTY.', benefit: 'Process server work cannot happen off the clock / off the books.' },
  { id: 37, feature: 'Serve attempt ↔ time_entry', change: 'logAttempt writes time_entry_id onto serve_attempts.', benefit: 'Every attempt joins to the shift that owned the hours and car.' },
  { id: 38, feature: 'Serve attempt ↔ vehicle', change: 'logAttempt writes vehicle_id from the open time_entry.', benefit: 'Fleet cost-per-mile can attribute serve days to a unit car.' },
  { id: 39, feature: 'Duty miles snapshot on attempt', change: 'duty_miles_snapshot stores shift miles at attempt time.', benefit: 'Billing disputes can compare GPS billed vs odometer at that stop.' },
  { id: 40, feature: 'Commute vs billable split', change: 'Nightly reconcile computes commute_miles = duty − serve billed.', benefit: 'Company mileage is not confused with client-billable miles.' },
  { id: 41, feature: 'Mileage reconcile table', change: 'corporate_mileage_links stores duty/GPS/serve/CFS miles per officer/day.', benefit: 'One corporate table for Map, Fleet, Serve, and HR to read.' },
  { id: 42, feature: 'Variance flag', change: 'Reconcile flags |duty−GPS| ≥ 8 miles and serve billed > duty.', benefit: 'Supervisors get an exception list instead of eyeballing four systems.' },
  { id: 43, feature: 'CFS miles in reconcile', change: 'Day rollup sums calls_for_service ending−starting mileage for the officer\'s units.', benefit: 'Dispatch call miles sit on the same corporate row as duty miles.' },
  { id: 44, feature: 'unit_trips join by shift day', change: 'GPS miles come from unit_trips closed that Denver date for the officer\'s unit.', benefit: 'Map breadcrumb travel is not orphaned from payroll.' },
  { id: 45, feature: 'Corporate snapshot API', change: 'GET /api/corporate-ops/snapshot returns hours, miles, clocked-in, serve, fleet due.', benefit: 'One corporate dashboard instead of six page-hops.' },
  { id: 46, feature: 'Workflow run builder', change: 'POST /api/corporate-ops/runs executes named jobs and stores corporate_ops_runs.', benefit: 'Nightly and manual runs are auditable with item rows.' },
  { id: 47, feature: 'Nightly cron hook', change: '04:00 America/Denver scheduled handler runs the corporate nightly bundle.', benefit: 'Mileage, tardy, unattended, and stale-shift jobs fire without an operator.' },
  { id: 48, feature: 'Enhancer catalog endpoint', change: 'GET /api/corporate-ops/enhancers returns this 90-row table.', benefit: 'The product documents its own corporate linkage in-app.' },
  { id: 49, feature: 'HR Corporate Ops tab', change: 'HR Console gains an Ops tab with snapshot, run buttons, and the enhancer table.', benefit: 'HR, Fleet, and Dispatch supervisors share one linkage surface.' },
  { id: 50, feature: 'Populate toast includes hours', change: 'Payroll populate response reports filled hours/miles so the UI can say so.', benefit: 'Managers see that clocks actually loaded, not just "N employees created".' },
  { id: 51, feature: 'Dispatch aggregates corporate strip', change: '/dispatch/aggregates adds clocked_in, duty_miles_today, serve_attempts_today.', benefit: 'Dispatch board sees time/mileage without opening HR.' },
  { id: 52, feature: 'Map on-duty GPS only helper', change: 'Snapshot lists on-duty officers with last lat/lng for the map roster.', benefit: 'Map can hide off-duty ghosts using the same clock source as CAD.' },
  { id: 53, feature: 'Process server Assign clocked-in', change: 'GET /corporate-ops/servers returns clocked-in servers with vehicle and today miles.', benefit: 'Assigning jobs prefers officers who are actually on duty with a car.' },
  { id: 54, feature: 'Force-end shift (supervisor)', change: 'POST /dispatch/duty/force-end closes a stale entry with a required reason into time_entry_edits.', benefit: 'Payroll is not blocked by a radio that never clocked out.' },
  { id: 55, feature: 'Open-entry uniqueness guard', change: 'Clock-in still 409s on an existing open row (unchanged) and now returns vehicle/unit on that row.', benefit: 'Clients can resume the same shift instead of creating a second punch.' },
  { id: 56, feature: 'Handbook-unacked warning', change: 'Clock-in response includes handbook_pending when required docs are unsigned.', benefit: 'HR policy gates are visible at the punch, not only in Documents.' },
  { id: 57, feature: 'Driver cert expiry warning', change: 'Duty/personnel start warns when officer_credentials of type license/CDL expire within 14 days.', benefit: 'Fleet assignment is not given to an expired license by accident.' },
  { id: 58, feature: 'Service-due vehicle warning', change: 'Clock-in/duty-start includes service_due when next_service_mileage ≤ current.', benefit: 'Officers see the car is due before they put miles on it.' },
  { id: 59, feature: 'Fuel-level closest-unit hint', change: 'Snapshot includes low_fuel_units from fleet_vehicles.fuel_level when present.', benefit: 'Dispatch can avoid sending a nearly empty car on a long serve run.' },
  { id: 60, feature: 'Cost-per-mile join', change: 'Snapshot reports fuel $ / duty miles for the last 30 days when both exist.', benefit: 'Corporate CPM uses clock miles, not only fuel-log odometer deltas.' },
  { id: 61, feature: 'Run card: payroll_clock_sync', change: 'Named workflow kind rebuilds draft payroll for the open period.', benefit: 'HR can rebuild from clocks without waiting for payday.' },
  { id: 62, feature: 'Run card: mileage_reconcile', change: 'Named workflow rebuilds corporate_mileage_links for a Denver date.', benefit: 'Ops can re-run yesterday after late GPS uploads.' },
  { id: 63, feature: 'Run card: attendance_tardy', change: 'Named workflow backfills tardies for a date from clocks vs schedules.', benefit: 'Monday can catch Friday\'s late punches after the fact.' },
  { id: 64, feature: 'Run card: shift_unattended', change: 'Named workflow emits unattended schedule rows.', benefit: 'Manual "who no-showed" is a one-click job.' },
  { id: 65, feature: 'Run card: stale_open_shifts', change: 'Named workflow lists/optionally force-flags 16h+ open entries.', benefit: 'Forgotten 10-8s are a workflow, not a tribal-knowledge hunt.' },
  { id: 66, feature: 'Run card: serve_duty_gaps', change: 'Named workflow lists serve_attempts with null time_entry_id.', benefit: 'Process server work off-clock becomes an exception report.' },
  { id: 67, feature: 'Run card: fleet_service_due', change: 'Named workflow lists in-service vehicles past mileage/date service.', benefit: 'Fleet due list is generated the same night as payroll/mileage.' },
  { id: 68, feature: 'Idempotent nightly runs', change: 'Same kind+Denver date does not double-insert mileage_links (UNIQUE officer/date/entry).', benefit: 'Cron retries are safe.' },
  { id: 69, feature: 'Workflow item audit', change: 'Each run writes corporate_ops_run_items for officers touched.', benefit: 'You can see who the job acted on, not just a count.' },
  { id: 70, feature: 'RBAC on corporate-ops', change: 'Snapshot/runs require admin/manager/supervisor/HR/dispatcher; officers get 403.', benefit: 'Client viewers cannot pull the whole company\'s hours and GPS.' },
  { id: 71, feature: 'Officer self snapshot', change: 'GET /corporate-ops/mine returns the caller\'s today hours/miles/serve only.', benefit: 'Field users still see their own corporate totals on MDT/HR.' },
  { id: 72, feature: 'Panic/shift vehicle already on duty', change: 'Duty roster already joins vehicle; snapshot reuses that join for map.', benefit: 'Map and Dispatch share one on-duty vehicle picture.' },
  { id: 73, feature: 'Fill-only CFS miles already exist — now rolled up', change: 'Corporate reconcile reads CFS starting/ending mileage fill-only fields.', benefit: 'Does not overwrite call cards; still feeds HR/Fleet totals.' },
  { id: 74, feature: 'Serve GPS miles via serveMileage helper', change: 'Reconcile uses existing serve mileage attribution rather than a second haversine.', benefit: 'Billing miles and corporate miles use one algorithm.' },
  { id: 75, feature: 'Desktop clock stays on personnel API', change: 'Desktop taskbar still hits /personnel/time/clock-* which now does corporate linking.', benefit: 'No client-test breakage; corporate data still lands.' },
  { id: 76, feature: 'Personnel clock 409 returns existing entry', change: 'Already-clocked-in payload includes the open entry\'s vehicle/unit/miles.', benefit: 'UI can show "already on duty in D19" instead of a dead error.' },
  { id: 77, feature: 'Clock-out without open entry 404 unchanged', change: 'Still 404; now includes code NO_ACTIVE_CLOCK.', benefit: 'Clients can branch on a stable code.' },
  { id: 78, feature: 'Approved leave hours typed', change: 'vacation+personal → pto_hours; sick → sick_hours; unpaid ignored.', benefit: 'Unpaid leave does not inflate a paycheck.' },
  { id: 79, feature: 'Holiday hours left manual', change: 'Populate does not guess holidays; holiday_hours stay manager-entered.', benefit: 'Holiday premium is not auto-invented from a clock.' },
  { id: 80, feature: 'Gross pay recomputed on populate', change: 'Uses hr_pay_rates rate × split hours the same as PUT /payroll/entries.', benefit: 'Draft checks have real dollars, not $0.00.' },
  { id: 81, feature: 'Missing pay rate still drafts zeros-pay', change: 'Hours/miles still fill when rate is missing; pay stays 0.', benefit: 'HR sees who worked even before a rate is set.' },
  { id: 82, feature: 'Active users only', change: 'Populate still skips terminated/inactive users.', benefit: 'Alumni do not get empty payroll drafts.' },
  { id: 83, feature: 'Schema reconciler', change: 'ensureCorporateOpsSchema adds tables/columns at boot like other D1 reconcilers.', benefit: 'continue-on-error deploys still get the linkage columns.' },
  { id: 84, feature: 'No ALTER of CFS/persons', change: 'New linkage lives on overflow tables, not 100-col CAD masters.', benefit: 'Column-cap CI stays green.' },
  { id: 85, feature: 'Substitute-service also links shift', change: 'POST substitute-service writes the same time_entry_id/vehicle_id when columns exist.', benefit: 'Substitute serves are not invisible to corporate mileage.' },
  { id: 86, feature: 'Force-end writes time_entry_edits', change: 'Supervisor force-end requires a reason and logs old/new clock_out.', benefit: 'Payroll corrections stay explainable.' },
  { id: 87, feature: 'Swap-vehicle assignment audit', change: 'Swap closes prior fleet_assignments and opens a new row.', benefit: 'Fleet assignment history matches the shift, not just the last car.' },
  { id: 88, feature: 'On-foot miles excluded from GPS rollup', change: 'Reconcile ignores unit_trips with on_foot=1 when that column exists.', benefit: 'Walking a property does not inflate vehicle CPM.' },
  { id: 89, feature: 'Integration tests for math + IDOR + populate', change: 'Vitest covers overtime, mileage flags, clock IDOR, and payroll hour fill.', benefit: 'The join cannot regress back to zero-hour populate.' },
  { id: 90, feature: 'Automatic workflow run builds', change: 'Nightly bundle runs mileage_reconcile + attendance_tardy + shift_unattended + stale_open_shifts + fleet_service_due as one parent run.', benefit: 'Corporate tracking is a scheduled pipeline, not six manual exports.' },
];

export function enhancerCount(): number {
  return CORPORATE_ENHANCERS.length;
}
