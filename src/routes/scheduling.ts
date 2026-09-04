// ============================================================
// RMPG Flex — Scheduling Routes (Hono)
// ============================================================
// REST endpoints exposing the scheduling engine. All require auth.
//
// Mount: src/index.ts → app.use('/api/scheduling', schedulingRoutes)
//
// Endpoints:
//   GET    /coverage-gaps          — detect gaps for a date
//   POST   /swap-request           — create a shift swap request
//   GET    /swap-suggestions/:id   — find compatible swap partners
//   POST   /swap-approve/:id       — approve/deny a swap
//   GET    /overtime/:userId       — calculate OT in a date range
//   POST   /auto-schedule          — auto-assign open shifts
//   GET    /handoff/:shiftId       — shift handoff briefing
//   GET    /officer-availability/:userId — availability matrix
//   GET    /metrics                — coverage metrics
//   GET    /shift-comparison       — compare two shifts
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { authMiddleware } from '../middleware/auth';
import { log } from '../utils/logger';
import {
  detectCoverageGaps,
  suggestShiftSwap,
  calculateOvertime,
  enforceWorkloadCap,
  autoScheduleShifts,
  getShiftHandoffData,
  getOfficerAvailability,
  calculateShiftCoverageMetrics,
  type ScheduleRules,
} from '../utils/scheduleEngine';

const sch = new Hono<Env>();

sch.use('*', authMiddleware);

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function parseAssignments<T extends { assignments?: string | unknown[] }>(row: T): T {
  if (!row) return row;
  try {
    (row as any).assignments = typeof row.assignments === 'string'
      ? JSON.parse(row.assignments)
      : (row.assignments ?? []);
  } catch {
    (row as any).assignments = [];
  }
  return row;
}

// ═════════════════════════════════════════════════════════════
// GET /api/scheduling/coverage-gaps?date=YYYY-MM-DD
// ═════════════════════════════════════════════════════════════

sch.get('/coverage-gaps', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);

  const date = c.req.query('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Valid date parameter required (YYYY-MM-DD)' }, 400);
  }

  try {
    const gaps = await detectCoverageGaps(c.env.DB, date);
    return c.json({
      date,
      gaps,
      totalGaps: gaps.length,
      totalDeficit: gaps.reduce((sum, g) => sum + g.deficit, 0),
    });
  } catch (err) {
    log.error('GET /coverage-gaps failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to detect coverage gaps' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════
// POST /api/scheduling/swap-request
// ═════════════════════════════════════════════════════════════

sch.post('/swap-request', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({} as any));

  const { target_id, shift_date, original_shift, requested_shift, reason, plan_id } = body;

  if (!shift_date || !requested_shift) {
    return c.json({ error: 'shift_date and requested_shift are required' }, 400);
  }

  const db = c.env.DB;

  try {
    // Get requester info
    const user = await queryFirst<{ id: number; full_name: string }>(
      db, 'SELECT id, full_name FROM users WHERE id = ?', userId,
    );
    if (!user) return c.json({ error: 'User not found' }, 404);

    // Get target officer info if provided
    let targetName: string | null = null;
    if (target_id) {
      const target = await queryFirst<{ full_name: string }>(
        db, 'SELECT full_name FROM users WHERE id = ?', target_id,
      );
      targetName = target?.full_name ?? null;
    }

    const result = await execute(
      db,
      `INSERT INTO shift_swap_requests
         (requester_id, requester_name, target_id, target_name, plan_id,
          shift_date, original_shift, requested_shift, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      userId,
      user.full_name,
      target_id ?? null,
      targetName,
      plan_id ?? null,
      shift_date,
      original_shift ?? null,
      requested_shift,
      reason ?? null,
    );

    return c.json({
      success: true,
      requestId: result.meta.last_row_id,
      message: 'Swap request created',
    }, 201);
  } catch (err) {
    log.error('POST /swap-request failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to create swap request' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════
// GET /api/scheduling/swap-suggestions/:requestId
// ═════════════════════════════════════════════════════════════

sch.get('/swap-suggestions/:requestId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);

  const requestId = parseInt(c.req.param('requestId'), 10);
  if (!Number.isFinite(requestId) || requestId < 1) {
    return c.json({ error: 'Invalid request ID' }, 400);
  }

  try {
    const suggestions = await suggestShiftSwap(c.env.DB, requestId);
    return c.json({
      requestId,
      suggestions,
      total: suggestions.length,
    });
  } catch (err) {
    log.error('GET /swap-suggestions/:requestId failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to get swap suggestions' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════
// POST /api/scheduling/swap-approve/:requestId
// ═════════════════════════════════════════════════════════════

sch.post('/swap-approve/:requestId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);

  const userId = c.get('userId');
  const requestId = parseInt(c.req.param('requestId'), 10);
  if (!Number.isFinite(requestId) || requestId < 1) {
    return c.json({ error: 'Invalid request ID' }, 400);
  }

  const body = await c.req.json().catch(() => ({} as any));
  const { decision, review_notes } = body;

  if (!decision || !['approved', 'denied'].includes(decision)) {
    return c.json({ error: 'decision must be "approved" or "denied"' }, 400);
  }

  const db = c.env.DB;

  try {
    const request = await queryFirst<any>(
      db, 'SELECT * FROM shift_swap_requests WHERE id = ?', requestId,
    );
    if (!request) return c.json({ error: 'Swap request not found' }, 404);
    if (request.status !== 'pending') {
      return c.json({ error: `Request is already ${request.status}` }, 409);
    }

    // Get reviewer info
    const reviewer = await queryFirst<{ full_name: string }>(
      db, 'SELECT full_name FROM users WHERE id = ?', userId,
    );

    await execute(
      db,
      `UPDATE shift_swap_requests
         SET status = ?, reviewed_by = ?, reviewed_by_name = ?,
             reviewed_at = datetime('now'), review_notes = ?
       WHERE id = ?`,
      decision,
      userId,
      reviewer?.full_name ?? null,
      review_notes ?? null,
      requestId,
    );

    // If approved, update the shift_plans assignments
    if (decision === 'approved' && request.plan_id) {
      const plan = await queryFirst<any>(
        db, 'SELECT * FROM shift_plans WHERE id = ?', request.plan_id,
      );
      if (plan) {
        let assignments: any[] = [];
        try {
          assignments = typeof plan.assignments === 'string'
            ? JSON.parse(plan.assignments)
            : (plan.assignments ?? []);
        } catch { assignments = []; }

        // Find requester's assignment and swap with target
        const requesterIdx = assignments.findIndex(
          (a: any) => (a.officer_id ?? a.userId) === request.requester_id,
        );
        if (requesterIdx >= 0 && request.target_id) {
          // Swap the officer IDs
          assignments[requesterIdx].officer_id = request.target_id;
          assignments[requesterIdx].name = request.target_name;
          assignments[requesterIdx].swapped_from = request.requester_id;
        }

        await execute(
          db,
          `UPDATE shift_plans SET assignments = ?, updated_at = datetime('now')
             WHERE id = ?`,
          JSON.stringify(assignments),
          request.plan_id,
        );
      }
    }

    return c.json({
      success: true,
      requestId,
      decision,
      message: `Swap request ${decision}`,
    });
  } catch (err) {
    log.error('POST /swap-approve/:requestId failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to process swap request' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════
// GET /api/scheduling/overtime/:userId?start=&end=
// ═════════════════════════════════════════════════════════════

sch.get('/overtime/:userId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);

  const userId = parseInt(c.req.param('userId'), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  const start = c.req.query('start');
  const end = c.req.query('end');

  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return c.json({ error: 'start and end date parameters required (YYYY-MM-DD)' }, 400);
  }

  try {
    const ot = await calculateOvertime(c.env.DB, userId, start, end);
    return c.json({
      userId,
      startDate: start,
      endDate: end,
      totalOvertimeHours: ot.totalOvertimeHours,
      dailyBreakdown: ot.dailyBreakdown,
    });
  } catch (err) {
    log.error('GET /overtime/:userId failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to calculate overtime' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════
// POST /api/scheduling/auto-schedule
// ═════════════════════════════════════════════════════════════

sch.post('/auto-schedule', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);

  const body = await c.req.json().catch(() => ({} as any));
  const { date, rules } = body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Valid date is required (YYYY-MM-DD)' }, 400);
  }

  const scheduleRules: ScheduleRules = {
    minOfficersPerShift: rules?.minOfficersPerShift ?? 3,
    maxHoursPerDay: rules?.maxHoursPerDay ?? 8,
    maxHoursPerWeek: rules?.maxHoursPerWeek ?? 40,
    requiredRoles: rules?.requiredRoles ?? ['officer', 'supervisor'],
    allowOvertime: rules?.allowOvertime ?? false,
    geographicZones: rules?.geographicZones ?? [],
  };

  try {
    const assignments = await autoScheduleShifts(c.env.DB, date, scheduleRules);

    // Group by shift type
    const byShift: Record<string, typeof assignments> = {};
    for (const a of assignments) {
      (byShift[a.shiftType] ??= []).push(a);
    }

    return c.json({
      date,
      rules: scheduleRules,
      assignments,
      summary: {
        totalAssigned: assignments.length,
        byShiftType: Object.fromEntries(
          Object.entries(byShift).map(([k, v]) => [k, v.length]),
        ),
      },
    });
  } catch (err) {
    log.error('POST /auto-schedule failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to auto-schedule' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════
// GET /api/scheduling/handoff/:shiftId
// ═════════════════════════════════════════════════════════════

sch.get('/handoff/:shiftId', async (c) => {
  const shiftId = parseInt(c.req.param('shiftId'), 10);
  if (!Number.isFinite(shiftId) || shiftId < 1) {
    return c.json({ error: 'Invalid shift ID' }, 400);
  }

  try {
    const handoff = await getShiftHandoffData(c.env.DB, shiftId);
    return c.json(handoff);
  } catch (err) {
    log.error('GET /handoff/:shiftId failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to get handoff data' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════
// GET /api/scheduling/officer-availability/:userId?start=&end=
// ═════════════════════════════════════════════════════════════

sch.get('/officer-availability/:userId', async (c) => {
  const userId = parseInt(c.req.param('userId'), 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  const start = c.req.query('start');
  const end = c.req.query('end');

  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return c.json({ error: 'start and end date parameters required (YYYY-MM-DD)' }, 400);
  }

  try {
    const availability = await getOfficerAvailability(c.env.DB, userId, [start, end]);
    return c.json({
      userId,
      startDate: start,
      endDate: end,
      availability,
      summary: {
        onShift: availability.filter((a) => a.status === 'on_shift').length,
        offShift: availability.filter((a) => a.status === 'off_shift').length,
        onLeave: availability.filter((a) => a.status === 'on_leave').length,
        availableOvertime: availability.filter((a) => a.status === 'available_overtime').length,
      },
    });
  } catch (err) {
    log.error('GET /officer-availability/:userId failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to get officer availability' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════
// GET /api/scheduling/metrics?start=&end=
// ═════════════════════════════════════════════════════════════

sch.get('/metrics', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);

  const start = c.req.query('start');
  const end = c.req.query('end');

  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return c.json({ error: 'start and end date parameters required (YYYY-MM-DD)' }, 400);
  }

  try {
    const metrics = await calculateShiftCoverageMetrics(c.env.DB, start, end);

    const totalRequired = metrics.reduce((sum, m) => sum + m.required, 0);
    const totalScheduled = metrics.reduce((sum, m) => sum + m.scheduled, 0);
    const avgCoverage = metrics.length > 0
      ? metrics.reduce((sum, m) => sum + m.coverageScore, 0) / metrics.length
      : 0;
    const totalOvertime = metrics.reduce((sum, m) => sum + m.overtimeHours, 0);
    const totalGaps = metrics.reduce((sum, m) => sum + m.gaps.length, 0);

    return c.json({
      startDate: start,
      endDate: end,
      days: metrics.length,
      summary: {
        totalRequired,
        totalScheduled,
        averageCoverageScore: Math.round(avgCoverage * 100) / 100,
        totalOvertimeHours: Math.round(totalOvertime * 100) / 100,
        totalGaps,
      },
      daily: metrics,
    });
  } catch (err) {
    log.error('GET /metrics failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to calculate metrics' }, 500);
  }
});

// ═════════════════════════════════════════════════════════════
// GET /api/scheduling/shift-comparison?shift1=&shift2=
// ═════════════════════════════════════════════════════════════

sch.get('/shift-comparison', async (c) => {
  const shift1 = c.req.query('shift1');
  const shift2 = c.req.query('shift2');

  if (!shift1 || !shift2) {
    return c.json({ error: 'shift1 and shift2 plan IDs are required' }, 400);
  }

  const db = c.env.DB;

  try {
    const plan1 = await queryFirst<any>(
      db, 'SELECT * FROM shift_plans WHERE id = ?', shift1,
    );
    const plan2 = await queryFirst<any>(
      db, 'SELECT * FROM shift_plans WHERE id = ?', shift2,
    );

    if (!plan1) return c.json({ error: `Shift plan "${shift1}" not found` }, 404);
    if (!plan2) return c.json({ error: `Shift plan "${shift2}" not found` }, 404);

    parseAssignments(plan1);
    parseAssignments(plan2);
    const assignments1 = plan1.assignments as any[];
    const assignments2 = plan2.assignments as any[];

    const officers1 = new Set(assignments1.map((a: any) => a.officer_id ?? a.userId));
    const officers2 = new Set(assignments2.map((a: any) => a.officer_id ?? a.userId));

    const common = [...officers1].filter((id) => officers2.has(id));
    const onlyIn1 = [...officers1].filter((id) => !officers2.has(id));
    const onlyIn2 = [...officers2].filter((id) => !officers1.has(id));

    return c.json({
      shift1: {
        id: shift1,
        name: plan1.name,
        date: plan1.date,
        shiftType: plan1.shift_type,
        status: plan1.status,
        officerCount: assignments1.length,
        officers: assignments1.map((a: any) => ({
          id: a.officer_id ?? a.userId,
          name: a.name || a.officer_name,
          callSign: a.call_sign,
        })),
      },
      shift2: {
        id: shift2,
        name: plan2.name,
        date: plan2.date,
        shiftType: plan2.shift_type,
        status: plan2.status,
        officerCount: assignments2.length,
        officers: assignments2.map((a: any) => ({
          id: a.officer_id ?? a.userId,
          name: a.name || a.officer_name,
          callSign: a.call_sign,
        })),
      },
      comparison: {
        commonOfficers: common.length,
        onlyInShift1: onlyIn1.length,
        onlyInShift2: onlyIn2.length,
        commonOfficerIds: common,
        onlyInShift1Ids: onlyIn1,
        onlyInShift2Ids: onlyIn2,
        staffingDiff: assignments1.length - assignments2.length,
      },
    });
  } catch (err) {
    log.error('GET /shift-comparison failed', { src: 'src/routes/scheduling.ts' }, err);
    return c.json({ error: err instanceof Error ? err.message : 'Failed to compare shifts' }, 500);
  }
});

export default sch;
