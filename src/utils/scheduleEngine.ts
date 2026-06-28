// ============================================================
// RMPG Flex — Schedule Engine (Cloudflare Workers + D1)
// ============================================================
// Core scheduling logic for the police CAD/RMS. No Node.js deps.
// All functions accept a D1Database instance (c.env.DB).
//
// Tables used:
//   shift_plans          — shift roster (assignments as JSON)
//   shift_swap_requests  — officer swap workflow
//   time_entries         — clock-in/out hours
//   users                — officer roster + roles
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';

// ── Types ───────────────────────────────────────────────────

export interface ScheduleRules {
  minOfficersPerShift: number;
  maxHoursPerDay: number;
  maxHoursPerWeek: number;
  requiredRoles: string[];
  allowOvertime: boolean;
  geographicZones: string[];
}

export interface CoverageGap {
  date: string;
  shiftStart: string;
  shiftEnd: string;
  required: number;
  scheduled: number;
  deficit: number;
  suggestedFill: string[];
}

export interface ShiftHandoff {
  shiftId: number;
  activeCalls: any[];
  pendingServes: any[];
  officerStatus: any[];
  pendingWarrants: any[];
  notes: string;
}

export interface ShiftAssignment {
  officerId: number;
  officerName: string;
  shiftType: string;
  callSign?: string;
  zone?: string;
  hours: number;
}

export interface OfficerAvailability {
  userId: number;
  fullName: string;
  date: string;
  status: 'on_shift' | 'off_shift' | 'on_leave' | 'available_overtime';
  shiftType?: string;
  hoursWorked: number;
  remainingHours: number;
}

export interface OvertimeBreakdown {
  date: string;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
}

export interface CoverageMetrics {
  date: string;
  required: number;
  scheduled: number;
  coverageScore: number;
  gaps: CoverageGap[];
  overtimeHours: number;
}

export interface SwapSuggestion {
  officerId: number;
  officerName: string;
  role: string;
  currentShift?: string;
  matchScore: number;
  reason: string;
}

// ── Shift time windows (local America/Denver) ────────────────

const SHIFT_WINDOWS: Record<string, { start: string; end: string; hours: number }> = {
  day:     { start: '06:00', end: '14:00', hours: 8 },
  swing:   { start: '14:00', end: '22:00', hours: 8 },
  night:   { start: '22:00', end: '06:00', hours: 8 },
  graveyard: { start: '22:00', end: '06:00', hours: 8 },
};

function shiftWindow(shiftType: string): { start: string; end: string; hours: number } {
  return SHIFT_WINDOWS[shiftType] ?? { start: '08:00', end: '17:00', hours: 8 };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function hoursBetween(start: string, end: string): number {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  return (b > a ? b - a : b + 1440 - a) / 60;
}

function overlapMinutes(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const aS = timeToMinutes(aStart);
  const aE = timeToMinutes(aEnd);
  const bS = timeToMinutes(bStart);
  const bE = timeToMinutes(bEnd);
  const start = Math.max(aS, bS);
  const end = Math.min(aE > aS ? aE : aE + 1440, bE > bS ? bE : bE + 1440);
  return Math.max(0, end - start);
}

// ── Helper: parse assignments from a shift_plans row ────────

function parseAssignments(row: any): any[] {
  if (!row) return [];
  try {
    return typeof row.assignments === 'string' ? JSON.parse(row.assignments) : (row.assignments ?? []);
  } catch {
    return [];
  }
}

// ── Helper: get all officers assigned to a specific date ─────

async function getOfficersForDate(db: D1Database, date: string): Promise<{
  userId: number;
  name: string;
  shiftType: string;
  callSign?: string;
  zone?: string;
  hours: number;
}[]> {
  const plans = await query<any>(
    db,
    `SELECT shift_type, assignments FROM shift_plans
       WHERE date = ? AND status IN ('active','completed')`,
    date,
  );

  const officers: {
    userId: number;
    name: string;
    shiftType: string;
    callSign?: string;
    zone?: string;
    hours: number;
  }[] = [];

  for (const plan of plans) {
    const assignments = parseAssignments(plan);
    for (const a of assignments) {
      const uid = a.officer_id ?? a.userId;
      if (!uid) continue;
      officers.push({
        userId: uid,
        name: a.name || a.officer_name || `Officer ${uid}`,
        shiftType: plan.shift_type,
        callSign: a.call_sign,
        zone: a.zone,
        hours: a.hours ?? shiftWindow(plan.shift_type).hours,
      });
    }
  }
  return officers;
}

// ── Helper: get time_entries hours for officer on date ───────

async function getHoursWorkedOnDate(
  db: D1Database,
  userId: number,
  date: string,
): Promise<number> {
  const row = await queryFirst<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(
       CASE
         WHEN total_hours IS NOT NULL THEN total_hours
         WHEN clock_out IS NOT NULL THEN
           (julianday(clock_out) - julianday(clock_in)) * 24
         ELSE 0
       END
     ), 0) AS total
       FROM time_entries
       WHERE officer_id = ?
         AND DATE(clock_in) = ?`,
    userId, date,
  );
  return row?.total ?? 0;
}

// ── Helper: get hours worked in a week ──────────────────────

async function getWeekHours(
  db: D1Database,
  userId: number,
  weekStartDate: string,
): Promise<number> {
  const row = await queryFirst<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(
       CASE
         WHEN total_hours IS NOT NULL THEN total_hours
         WHEN clock_out IS NOT NULL THEN
           (julianday(clock_out) - julianday(clock_in)) * 24
         ELSE 0
       END
     ), 0) AS total
       FROM time_entries
       WHERE officer_id = ?
         AND DATE(clock_in) >= ?
         AND DATE(clock_in) <= DATE(?, '+6 days')`,
    userId, weekStartDate, weekStartDate,
  );
  return row?.total ?? 0;
}

// ── Helper: get officer role from users table ───────────────

async function getOfficerRole(db: D1Database, userId: number): Promise<string | null> {
  const row = await queryFirst<{ role: string }>(
    db, 'SELECT role FROM users WHERE id = ?', userId,
  );
  return row?.role ?? null;
}

// ── Helper: check if officer is on leave for date ───────────

async function isOnLeave(db: D1Database, userId: number, date: string): Promise<boolean> {
  const row = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM shift_leave_requests
       WHERE user_id = ?
         AND status = 'approved'
         AND start_date <= ?
         AND end_date >= ?
       LIMIT 1`,
    userId, date, date,
  );
  return row !== null;
}

// ── Helper: get Monday of the week containing a date ─────────

function getMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ── Helper: get date range as array of YYYY-MM-DD ───────────

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  while (d <= e) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// ═════════════════════════════════════════════════════════════
// 1. detectCoverageGaps
// ═════════════════════════════════════════════════════════════

export async function detectCoverageGaps(
  db: D1Database,
  date: string,
): Promise<CoverageGap[]> {
  const SHIFT_TYPES = ['day', 'swing', 'night'];
  const MIN_REQUIRED = 3; // default minimum per shift

  const officers = await getOfficersForDate(db, date);
  const gaps: CoverageGap[] = [];

  // Also pull staffing-level overrides if the table exists
  let minOverride = MIN_REQUIRED;
  try {
    const setting = await queryFirst<{ value: string }>(
      db,
      `SELECT value FROM system_settings
         WHERE key = 'scheduling_min_officers_per_shift'`,
    );
    if (setting?.value) minOverride = parseInt(setting.value, 10) || MIN_REQUIRED;
  } catch { /* table may not exist */ }

  for (const shiftType of SHIFT_TYPES) {
    const window = shiftWindow(shiftType);
    const assigned = officers.filter((o) => o.shiftType === shiftType);
    const scheduled = assigned.length;
    const required = minOverride;

    if (scheduled < required) {
      const deficit = required - scheduled;
      // Suggest available officers not currently assigned
      const assignedIds = new Set(assigned.map((a) => a.userId));
      const available = await query<any>(
        db,
        `SELECT id, full_name, role FROM users
           WHERE status = 'active'
             AND role IN ('officer','supervisor','manager')
             AND id NOT IN (SELECT officer_id FROM time_entries
                            WHERE DATE(clock_in) = ? AND clock_out IS NULL)`,
        date,
      );
      const suggested = available
        .filter((u: any) => !assignedIds.has(u.id))
        .slice(0, deficit)
        .map((u: any) => `${u.full_name} (${u.role})`);

      gaps.push({
        date,
        shiftStart: window.start,
        shiftEnd: window.end,
        required,
        scheduled,
        deficit,
        suggestedFill: suggested,
      });
    }
  }

  return gaps;
}

// ═════════════════════════════════════════════════════════════
// 2. suggestShiftSwap
// ═════════════════════════════════════════════════════════════

export async function suggestShiftSwap(
  db: D1Database,
  requestId: number,
): Promise<SwapSuggestion[]> {
  const request = await queryFirst<any>(
    db,
    `SELECT * FROM shift_swap_requests WHERE id = ?`,
    requestId,
  );
  if (!request) return [];

  const requesterRole = await getOfficerRole(db, request.requester_id);

  // Get officers assigned to the target shift date
  const targetOfficers = await getOfficersForDate(db, request.shift_date);
  const targetShiftType = request.requested_shift;

  // Get all active officers with same role
  const candidates = await query<any>(
    db,
    `SELECT id, full_name, role FROM users
       WHERE status = 'active'
         AND role = ?
         AND id != ?`,
    requesterRole ?? 'officer',
    request.requester_id,
  );

  const suggestions: SwapSuggestion[] = [];

  for (const candidate of candidates) {
    // Check not already assigned on that date
    const alreadyAssigned = targetOfficers.some(
      (o) => o.userId === candidate.id && o.shiftType === targetShiftType,
    );
    if (alreadyAssigned) continue;

    // Check not on leave
    const onLeave = await isOnLeave(db, candidate.id, request.shift_date);
    if (onLeave) continue;

    // Check overtime conflict (40h/week cap)
    const monday = getMonday(request.shift_date);
    const weekHours = await getWeekHours(db, candidate.id, monday);
    const shiftHours = shiftWindow(targetShiftType).hours;
    if (weekHours + shiftHours > 40) continue;

    // Score: prefer officers with fewer hours that week (more available)
    const score = Math.max(0, 100 - Math.round(weekHours * 1.5));

    // Check if they have an overlapping shift to swap FROM
    const candidateShift = targetOfficers.find((o) => o.userId === candidate.id);
    const reason = candidateShift
      ? `Has ${candidateShift.shiftType} shift that day — can swap`
      : 'Available, no conflicting shift';

    suggestions.push({
      officerId: candidate.id,
      officerName: candidate.full_name,
      role: candidate.role,
      currentShift: candidateShift?.shiftType,
      matchScore: score,
      reason,
    });
  }

  // Sort by score descending
  suggestions.sort((a, b) => b.matchScore - a.matchScore);
  return suggestions;
}

// ═════════════════════════════════════════════════════════════
// 3. calculateOvertime
// ═════════════════════════════════════════════════════════════

export async function calculateOvertime(
  db: D1Database,
  userId: number,
  startDate: string,
  endDate: string,
): Promise<{ totalOvertimeHours: number; dailyBreakdown: OvertimeBreakdown[] }> {
  const dates = dateRange(startDate, endDate);
  const dailyBreakdown: OvertimeBreakdown[] = [];
  let totalOvertimeHours = 0;

  for (const date of dates) {
    const hoursWorked = await getHoursWorkedOnDate(db, userId, date);
    const regularHours = Math.min(hoursWorked, 8);
    const overtimeHours = Math.max(0, hoursWorked - 8);

    dailyBreakdown.push({
      date,
      regularHours,
      overtimeHours,
      totalHours: hoursWorked,
    });
    totalOvertimeHours += overtimeHours;
  }

  // Also calculate weekly overtime (>40h/week)
  const weeks = new Map<string, number>();
  for (const entry of dailyBreakdown) {
    const monday = getMonday(entry.date);
    weeks.set(monday, (weeks.get(monday) ?? 0) + entry.totalHours);
  }

  // Add weekly OT on top of daily OT where applicable
  for (const [, weekTotal] of weeks) {
    if (weekTotal > 40) {
      // Daily OT already counted per-day; weekly excess beyond daily caps
      // is the additional amount above 40 that wasn't caught by daily >8
      const dailyCapped = dailyBreakdown
        .filter((d) => getMonday(d.date) === [...weeks.keys()].find((k) => weeks.get(k) === weekTotal))
        .reduce((sum, d) => sum + d.overtimeHours, 0);
      const weeklyExcess = Math.max(0, weekTotal - 40);
      const additionalWeekly = Math.max(0, weeklyExcess - dailyCapped);
      totalOvertimeHours += additionalWeekly;
    }
  }

  return { totalOvertimeHours, dailyBreakdown };
}

// ═════════════════════════════════════════════════════════════
// 4. enforceWorkloadCap
// ═════════════════════════════════════════════════════════════

export async function enforceWorkloadCap(
  db: D1Database,
  userId: number,
  date: string,
  maxHours: number,
): Promise<{ allowed: boolean; currentHours: number; remainingHours: number }> {
  const currentHours = await getHoursWorkedOnDate(db, userId, date);
  const remainingHours = Math.max(0, maxHours - currentHours);
  return {
    allowed: currentHours < maxHours,
    currentHours,
    remainingHours,
  };
}

// ═════════════════════════════════════════════════════════════
// 5. autoScheduleShifts
// ═════════════════════════════════════════════════════════════

export async function autoScheduleShifts(
  db: D1Database,
  date: string,
  rules: ScheduleRules,
): Promise<ShiftAssignment[]> {
  const SHIFT_TYPES = ['day', 'swing', 'night'];
  const assignments: ShiftAssignment[] = [];

  // Get all eligible active officers
  const officers = await query<any>(
    db,
    `SELECT id, full_name, role, badge_number FROM users
       WHERE status = 'active'
       ORDER BY created_at ASC`,  // seniority = earlier hire
  );

  // Build availability tracker
  const assignedToday = new Set<number>();
  const officerHours: Record<number, number> = {};

  for (const officer of officers) {
    officerHours[officer.id] = 0;
  }

  // Check existing time entries for the date
  for (const officer of officers) {
    const hours = await getHoursWorkedOnDate(db, officer.id, date);
    officerHours[officer.id] = hours;
    if (hours > 0) assignedToday.add(officer.id);
  }

  // Check leave
  const onLeaveIds = new Set<number>();
  for (const officer of officers) {
    if (await isOnLeave(db, officer.id, date)) {
      onLeaveIds.add(officer.id);
    }
  }

  // Greedy assignment per shift
  for (const shiftType of SHIFT_TYPES) {
    const window = shiftWindow(shiftType);
    let assigned = 0;

    for (const officer of officers) {
      if (assigned >= rules.minOfficersPerShift) break;
      if (onLeaveIds.has(officer.id)) continue;
      if (assignedToday.has(officer.id)) continue;

      // Role check
      if (rules.requiredRoles.length > 0 && !rules.requiredRoles.includes(officer.role)) {
        continue;
      }

      // Workload cap
      if (officerHours[officer.id] + window.hours > rules.maxHoursPerDay) {
        if (!rules.allowOvertime) continue;
      }

      // Weekly cap
      const monday = getMonday(date);
      const weekHours = await getWeekHours(db, officer.id, monday);
      if (weekHours + window.hours > rules.maxHoursPerWeek) {
        if (!rules.allowOvertime) continue;
      }

      assignments.push({
        officerId: officer.id,
        officerName: officer.full_name,
        shiftType,
        callSign: officer.badge_number,
        hours: window.hours,
      });

      assignedToday.add(officer.id);
      officerHours[officer.id] += window.hours;
      assigned++;
    }
  }

  return assignments;
}

// ═════════════════════════════════════════════════════════════
// 6. getShiftHandoffData
// ═════════════════════════════════════════════════════════════

export async function getShiftHandoffData(
  db: D1Database,
  shiftId: number,
): Promise<ShiftHandoff> {
  // Active calls (dispatched, not cleared)
  const activeCalls = await query(
    db,
    `SELECT id, incident_number, type, priority, status, location, assigned_units, created_at
       FROM calls_for_service
       WHERE status IN ('dispatched','en_route','on_scene','investigating')
       ORDER BY priority ASC, created_at ASC
       LIMIT 50`,
  );

  // Pending serve jobs
  const pendingServes = await query(
    db,
    `SELECT id, case_number, serve_type, recipient_name, address, status, priority, created_at
       FROM serve_jobs
       WHERE status IN ('pending','in_progress','attempted')
       ORDER BY priority ASC, created_at ASC
       LIMIT 50`,
  );

  // Officer status from time_entries
  const officerStatus = await query(
    db,
    `SELECT te.officer_id, u.full_name, te.clock_in, te.clock_out, te.status, te.break_start
       FROM time_entries te
       JOIN users u ON te.officer_id = u.id
       WHERE DATE(te.clock_in) = DATE('now','localtime')
         AND te.clock_out IS NULL
       ORDER BY te.clock_in ASC`,
  );

  // Pending warrants
  const pendingWarrants = await query(
    db,
    `SELECT id, warrant_number, subject_name, charge, issuing_agency, status, created_at
       FROM warrants
       WHERE status = 'active'
       ORDER BY created_at DESC
       LIMIT 50`,
  );

  // Handoff notes from the single-row table
  let notes = '';
  try {
    const handoff = await queryFirst<{ text: string }>(
      db, 'SELECT text FROM shift_handoff WHERE id = 1',
    );
    notes = handoff?.text ?? '';
  } catch { /* table may not exist */ }

  return {
    shiftId,
    activeCalls,
    pendingServes,
    officerStatus,
    pendingWarrants,
    notes,
  };
}

// ═════════════════════════════════════════════════════════════
// 7. getOfficerAvailability
// ═════════════════════════════════════════════════════════════

export async function getOfficerAvailability(
  db: D1Database,
  userId: number,
  dateRange_: [string, string],
): Promise<OfficerAvailability[]> {
  const dates = dateRange(dateRange_[0], dateRange_[1]);
  const officer = await queryFirst<{ id: number; full_name: string }>(
    db, 'SELECT id, full_name FROM users WHERE id = ?', userId,
  );
  if (!officer) return [];

  const matrix: OfficerAvailability[] = [];
  const maxHoursPerDay = 8;

  for (const date of dates) {
    // Check if assigned to a shift
    const assignedShift = await queryFirst<{ shift_type: string }>(
      db,
      `SELECT sp.shift_type FROM shift_plans sp
         WHERE sp.date = ? AND sp.status IN ('active','completed')`,
      date,
    );

    const hoursWorked = await getHoursWorkedOnDate(db, userId, date);
    const onLeave = await isOnLeave(db, userId, date);

    let status: OfficerAvailability['status'];
    let shiftType: string | undefined;

    if (onLeave) {
      status = 'on_leave';
    } else if (assignedShift) {
      status = 'on_shift';
      shiftType = assignedShift.shift_type;
    } else if (hoursWorked > 0) {
      status = 'on_shift';
    } else if (hoursWorked === 0 && maxHoursPerDay - hoursWorked > 0) {
      status = 'available_overtime';
    } else {
      status = 'off_shift';
    }

    const remainingHours = Math.max(0, maxHoursPerDay - hoursWorked);

    matrix.push({
      userId,
      fullName: officer.full_name,
      date,
      status,
      shiftType,
      hoursWorked,
      remainingHours,
    });
  }

  return matrix;
}

// ═════════════════════════════════════════════════════════════
// 8. calculateShiftCoverageMetrics
// ═════════════════════════════════════════════════════════════

export async function calculateShiftCoverageMetrics(
  db: D1Database,
  startDate: string,
  endDate: string,
): Promise<CoverageMetrics[]> {
  const dates = dateRange(startDate, endDate);
  const metrics: CoverageMetrics[] = [];

  for (const date of dates) {
    const gaps = await detectCoverageGaps(db, date);
    const officers = await getOfficersForDate(db, date);

    // Required = minOfficersPerShift × 3 shifts
    let minRequired = 3;
    try {
      const setting = await queryFirst<{ value: string }>(
        db,
        `SELECT value FROM system_settings
           WHERE key = 'scheduling_min_officers_per_shift'`,
      );
      if (setting?.value) minRequired = parseInt(setting.value, 10) || 3;
    } catch { /* table may not exist */ }

    const required = minRequired * 3; // 3 standard shifts
    const scheduled = officers.length;
    const coverageScore = required > 0 ? Math.min(1, scheduled / required) : 1;

    // Sum overtime from time entries
    const otRow = await queryFirst<{ total: number }>(
      db,
      `SELECT COALESCE(SUM(
         CASE
           WHEN total_hours IS NOT NULL AND total_hours > 8 THEN total_hours - 8
           WHEN clock_out IS NOT NULL AND (julianday(clock_out) - julianday(clock_in)) * 24 > 8
             THEN (julianday(clock_out) - julianday(clock_in)) * 24 - 8
           ELSE 0
         END
       ), 0) AS total
         FROM time_entries
         WHERE DATE(clock_in) = ?`,
      date,
    );

    metrics.push({
      date,
      required,
      scheduled,
      coverageScore,
      gaps,
      overtimeHours: otRow?.total ?? 0,
    });
  }

  return metrics;
}
