import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { validateParamId, validateParamIdMiddleware } from '../../middleware/sanitize';
import { broadcast, broadcastDispatchUpdate, broadcastUnitUpdate } from '../../utils/websocket';
import { localNow, localToday } from '../../utils/timeUtils';
import { generateIncidentNumber } from '../../utils/caseNumbers';
import { createNotification, createNotificationForRoles } from '../notifications';
import { universalWarrantCheck } from '../../utils/universalWarrantScanner';
import { auditLog } from '../../utils/auditLogger';
import { sendCsv } from '../../utils/csvExport';
import { isLegalTransition, LEGAL_TRANSITIONS } from './callLifecycle';
import { startWelfareWatch, clearWelfareWatch } from '../../utils/officerWelfare';

const router = Router();

// ── PSO Service Window Classification ──────────────────────────────
// Required attempt windows for PSO due diligence:
//   1 attempt between 6AM-9AM (early_morning)
//   1 attempt between 9AM-6PM (daytime)
//   1 attempt between 6PM-9PM (evening)
//   1 attempt must be on a weekend (Saturday or Sunday)
// All times are Mountain Time (America/Denver).

type ServiceWindow = 'early_morning' | 'daytime' | 'evening';

interface PsoServiceWindows {
  early_morning: boolean;  // 6AM-9AM
  daytime: boolean;        // 9AM-6PM
  evening: boolean;        // 6PM-9PM
  weekend: boolean;        // Any attempt on Sat/Sun
}

function classifyServiceWindow(isoTimestamp: string): { window: ServiceWindow; isWeekend: boolean } {
  // Parse to Mountain Time
  const d = new Date(isoTimestamp);
  const mt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  const hour = mt.getHours();
  const day = mt.getDay(); // 0=Sun, 6=Sat
  const isWeekend = day === 0 || day === 6;

  let window: ServiceWindow;
  if (hour >= 6 && hour < 9) window = 'early_morning';
  else if (hour >= 9 && hour < 18) window = 'daytime';
  else if (hour >= 18 && hour < 21) window = 'evening';
  else window = hour < 6 ? 'early_morning' : 'evening'; // Before 6AM → early_morning bucket, after 9PM → evening bucket

  return { window, isWeekend };
}

function parsePsoWindows(json: string | null | undefined): PsoServiceWindows {
  if (!json) return { early_morning: false, daytime: false, evening: false, weekend: false };
  try {
    const parsed = JSON.parse(json);
    return {
      early_morning: !!parsed.early_morning,
      daytime: !!parsed.daytime,
      evening: !!parsed.evening,
      weekend: !!parsed.weekend,
    };
  } catch (parseErr) {
    console.error('[CallActions] Failed to parse PSO service windows JSON:', parseErr instanceof Error ? parseErr.message : parseErr);
    return { early_morning: false, daytime: false, evening: false, weekend: false };
  }
}

function isPsoCompliant(windows: PsoServiceWindows): boolean {
  return windows.early_morning && windows.daytime && windows.evening && windows.weekend;
}

// POST /api/dispatch/calls/:id/dispatch - Dispatch unit(s) to call
router.post('/calls/:id/dispatch', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    const { unit_ids } = req.body;
    if (!unit_ids || !Array.isArray(unit_ids) || unit_ids.length === 0) {
      res.status(400).json({ error: 'unit_ids array is required', code: 'UNITIDS_ARRAY_IS_REQUIRED' });
      return;
    }
    // Validate all unit_ids are positive integers and limit count
    if (unit_ids.length > 50) {
      res.status(400).json({ error: 'Cannot dispatch more than 50 units at once', code: 'CANNOT_DISPATCH_MORE_THAN' });
      return;
    }
    for (const uid of unit_ids) {
      const n = parseInt(String(uid), 10);
      if (isNaN(n) || n < 1) {
        res.status(400).json({ error: 'All unit_ids must be positive integers', code: 'ALL_UNITIDS_MUST_BE' });
        return;
      }
    }

    // Validate units exist and are in a dispatchable state
    const NON_DISPATCHABLE = ['off_duty', 'out_of_service'];
    const blockedUnits: { id: number; call_sign: string; status: string }[] = [];
    for (const uid of unit_ids) {
      const unit = db.prepare('SELECT id, call_sign, status FROM units WHERE id = ?').get(uid) as any;
      if (!unit) {
        res.status(404).json({ error: `Unit ${uid} not found`, code: 'UNIT_NOT_FOUND' });
        return;
      }
      if (NON_DISPATCHABLE.includes(unit.status)) {
        blockedUnits.push(unit);
      }
    }
    if (blockedUnits.length > 0) {
      res.status(400).json({
        error: `Cannot dispatch units that are ${blockedUnits.map(u => `${u.call_sign} (${u.status})`).join(', ')}`,
        code: 'UNIT_NOT_DISPATCHABLE',
        blockedUnits,
      });
      return;
    }

    const now = localNow();

    // Merge with existing assigned units
    let currentUnits: number[] = [];
    try {
      const parsed = JSON.parse(call.assigned_unit_ids || '[]');
      currentUnits = (Array.isArray(parsed) ? parsed : []).filter((n: any) => typeof n === 'number' && !isNaN(n));
    } catch (e) { console.error(`Failed to parse assigned_unit_ids for call ${call.id}:`, e); }

    const allUnits = [...new Set([...currentUnits, ...unit_ids])];

    // Transaction: update call + all units + activity logs atomically
    const dispatchTx = db.transaction(() => {
      // Update call
      db.prepare(`
        UPDATE calls_for_service SET
          status = CASE WHEN status = 'pending' THEN 'dispatched' ELSE status END,
          assigned_unit_ids = ?,
          dispatched_at = COALESCE(dispatched_at, ?),
          dispatcher_id = COALESCE(dispatcher_id, ?)
        WHERE id = ?
      `).run(JSON.stringify(allUnits), now, req.user!.userId, call.id);

      // Update each unit status
      for (const unitId of unit_ids) {
        db.prepare(`
          UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ? WHERE id = ?
        `).run(call.id, now, unitId);

        // Log activity
        const unit = db.prepare('SELECT call_sign FROM units WHERE id = ?').get(unitId) as any;
        db.prepare(`
          INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (?, 'unit_dispatched', 'unit', ?, ?, ?)
        `).run(req.user!.userId, unitId, `Dispatched ${unit?.call_sign || unitId} to ${call.call_number}`, req.ip || 'unknown');
      }
    });
    dispatchTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    if (updated) {
      broadcastDispatchUpdate({ action: 'units_dispatched', call: updated, unit_ids });
    }

    // Broadcast individual unit updates so Map/MDT get full unit state with call details
    for (const unitId of unit_ids) {
      const unitData = db.prepare(`
        SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone,
          c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
        FROM units u
        LEFT JOIN users usr ON u.officer_id = usr.id
        LEFT JOIN calls_for_service c ON u.current_call_id = c.id
        WHERE u.id = ?
      `).get(unitId);
      if (unitData) broadcastUnitUpdate({ action: 'unit_status_changed', unit: unitData });
    }

    // Notify dispatched officers individually (non-fatal — dispatch must not fail on notification error)
    try {
      for (const unitId of unit_ids) {
        const unitRow = db.prepare('SELECT officer_id, call_sign FROM units WHERE id = ?').get(unitId) as any;
        if (unitRow?.officer_id) {
          createNotification(
            unitRow.officer_id, 'dispatch',
            `Dispatched: ${call.call_number}`,
            `${call.incident_type} — ${call.location_address || 'No address'}`,
            'call', call.id, 'high',
          );
        }
      }
    } catch (notifErr: any) {
      console.error('[Dispatch] Officer notification failed (non-fatal):', notifErr.message);
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Dispatch error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to dispatch', code: 'DISPATCH_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/assign-unit - Attach a single unit to a call (dispatchers + officers for self-dispatch)
router.post('/calls/:id/assign-unit', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    const { unit_id } = req.body;
    if (!unit_id) {
      res.status(400).json({ error: 'unit_id is required', code: 'UNITID_IS_REQUIRED' });
      return;
    }

    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' });
      return;
    }

    // Prevent double-dispatch: if unit is already on a different active call, warn
    if (unit.current_call_id && unit.current_call_id !== call.id) {
      const otherCall = db.prepare('SELECT call_number, status FROM calls_for_service WHERE id = ?').get(unit.current_call_id) as any;
      if (otherCall && !['cleared', 'closed', 'cancelled', 'archived'].includes(otherCall.status)) {
        res.status(409).json({
          error: `Unit ${unit.call_sign} is already assigned to active call ${otherCall.call_number} (${otherCall.status})`,
          code: 'UNIT_ALREADY_DISPATCHED',
          current_call: otherCall.call_number,
        });
        return;
      }
    }

    const now = localNow();

    // Merge with existing assigned units
    let currentUnits: number[] = [];
    try {
      const parsed = JSON.parse(call.assigned_unit_ids || '[]');
      currentUnits = (Array.isArray(parsed) ? parsed : []).filter((n: any) => typeof n === 'number' && !isNaN(n));
    } catch (e) { console.error(`Failed to parse assigned_unit_ids for call ${call.id}:`, e); }

    const unitIdNum = Number(unit_id);
    if (isNaN(unitIdNum)) {
      res.status(400).json({ error: 'Invalid unit_id', code: 'INVALID_UNITID' });
      return;
    }
    if (!currentUnits.includes(unitIdNum)) {
      currentUnits.push(unitIdNum);
    }

    // Transaction: update call + unit + activity log atomically
    const assignTx = db.transaction(() => {
      // Update call: add unit to assigned_unit_ids, set dispatched if pending
      db.prepare(`
        UPDATE calls_for_service SET
          status = CASE WHEN status = 'pending' THEN 'dispatched' ELSE status END,
          assigned_unit_ids = ?,
          dispatched_at = COALESCE(dispatched_at, ?)
        WHERE id = ?
      `).run(JSON.stringify(currentUnits), now, call.id);

      // Update unit: set status to dispatched and link to this call
      db.prepare(`
        UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ? WHERE id = ?
      `).run(call.id, now, unit_id);

      // Log activity
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'unit_dispatched', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `Assigned ${unit.call_sign} to ${call.call_number}`, req.ip || 'unknown');
    });
    assignTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    if (updated) {
      broadcastDispatchUpdate({ action: 'unit_assigned', call: updated, unit_id });
    }
    const unitData = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone,
        c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      WHERE u.id = ?
    `).get(unit_id);
    if (unitData) broadcastUnitUpdate({ action: 'unit_status_changed', unit: unitData });

    res.json(updated);
  } catch (error: any) {
    console.error('Assign unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to assign unit', code: 'ASSIGN_UNIT_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/unassign-unit - Detach a single unit from a call
router.post('/calls/:id/unassign-unit', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    const { unit_id } = req.body;
    if (!unit_id) {
      res.status(400).json({ error: 'unit_id is required', code: 'UNITID_IS_REQUIRED' });
      return;
    }

    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' });
      return;
    }

    const now = localNow();

    // Transaction: update call + unit + activity log atomically
    // Read assigned_unit_ids INSIDE the transaction to prevent stale data race
    const unassignTx = db.transaction(() => {
      // Re-read call inside transaction to get fresh assigned_unit_ids
      const freshCall = db.prepare('SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?').get(call.id) as any;
      let currentUnits: number[] = [];
      try {
        currentUnits = JSON.parse(freshCall?.assigned_unit_ids || '[]');
      } catch (parseErr) { console.error('[CallActions] Failed to parse assigned_unit_ids:', parseErr instanceof Error ? parseErr.message : parseErr); }
      currentUnits = currentUnits.filter((id) => id !== Number(unit_id));

      // Update call: remove unit from assigned_unit_ids
      db.prepare(`
        UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?
      `).run(JSON.stringify(currentUnits), call.id);

      // Update unit: set status to available and clear current_call_id
      db.prepare(`
        UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ?
      `).run(now, unit_id);

      // Log activity
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'unit_unassigned', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `Removed ${unit.call_sign} from ${call.call_number}`, req.ip || 'unknown');
    });
    unassignTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    if (updated) {
      broadcastDispatchUpdate({ action: 'unit_unassigned', call: updated, unit_id });
    }
    const unassignedUnit = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone,
        c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      WHERE u.id = ?
    `).get(unit_id);
    if (unassignedUnit) broadcastUnitUpdate({ action: 'unit_status_changed', unit: unassignedUnit });

    res.json(updated);
  } catch (error: any) {
    console.error('Unassign unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to unassign unit', code: 'UNASSIGN_UNIT_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/status - Update call status with timestamp
router.post('/calls/:id/status', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    const { status, notes, disposition, starting_mileage, ending_mileage, responding_vehicle_id } = req.body;
    if (!status) {
      res.status(400).json({ error: 'status is required', code: 'STATUS_IS_REQUIRED' });
      return;
    }

    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived', 'on_hold'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status', code: 'INVALID_STATUS', valid: validStatuses });
      return;
    }

    // Enforce legal status transitions
    if (!isLegalTransition(call.status, status)) {
      const allowed = LEGAL_TRANSITIONS[call.status] || [];
      res.status(400).json({
        error: `Cannot transition from '${call.status}' to '${status}'`,
        code: 'ILLEGAL_TRANSITION',
        currentStatus: call.status,
        allowedTransitions: allowed,
      });
      return;
    }

    // ── Feature 4: Disposition required enforcement (ALL calls) ─────
    // All calls must have a disposition when closing (cleared/closed).
    if (['cleared', 'closed'].includes(status) && !disposition && !call.disposition) {
      res.status(400).json({
        error: 'A disposition is required when clearing or closing a call',
        code: 'DISPOSITION_REQUIRED',
      });
      return;
    }

    // ── PSO 72-Hour Rule Enforcement (server-side) ──────────
    // PSO Client Request calls have special rules:
    // 1. Cannot be cleared/closed without a disposition (already enforced above)
    // 2. Cannot be archived if 72hr re-dispatch deadline hasn't been addressed
    // 3. Auto-sets pso_72hr_deadline when cleared so countdown is precise
    if (call.incident_type === 'pso_client_request') {

      // Prevent archiving PSO calls that are overdue (72hr passed without re-dispatch)
      if (status === 'archived') {
        const clearedTime = call.cleared_at || call.closed_at;
        if (clearedTime) {
          const elapsed = Date.now() - new Date(clearedTime).getTime();
          const HOURS_72 = 72 * 60 * 60 * 1000;
          if (elapsed >= HOURS_72 && call.pso_72hr_notified !== 'resolved') {
            // Only admins/managers can archive overdue PSO calls
            const canOverride = ['admin', 'manager'].includes(req.user?.role || '');
            if (!canOverride) {
              res.status(403).json({
                error: 'PSO call is 72hr overdue — must be re-dispatched or resolved by admin/manager before archiving',
                code: 'PSO_72HR_OVERDUE',
              });
              return;
            }
          }
        }

        // Prevent archiving PSO calls that haven't met service window requirements
        // Required: 1 early morning (6-9AM), 1 daytime (9AM-6PM), 1 evening (6-9PM), 1 weekend
        const windows = parsePsoWindows(call.pso_service_windows);
        if (!isPsoCompliant(windows)) {
          const canOverride = ['admin', 'manager'].includes(req.user?.role || '');
          if (!canOverride) {
            const missing: string[] = [];
            if (!windows.early_morning) missing.push('6AM-9AM attempt');
            if (!windows.daytime) missing.push('9AM-6PM attempt');
            if (!windows.evening) missing.push('6PM-9PM attempt');
            if (!windows.weekend) missing.push('weekend attempt');
            res.status(403).json({
              error: `PSO service window requirements not met. Missing: ${missing.join(', ')}`,
              code: 'PSO_WINDOWS_INCOMPLETE',
              missing,
              windows,
            });
            return;
          }
        }
      }
    }

    const now = localNow();

    // Map status to timestamp field
    const timestampField: Record<string, string> = {
      dispatched: 'dispatched_at',
      enroute: 'enroute_at',
      onscene: 'onscene_at',
      cleared: 'cleared_at',
      closed: 'closed_at',
      archived: 'archived_at',
    };

    const tsField = timestampField[status];
    // Upgrade 59: Always track status_changed_at
    let updateQuery = `UPDATE calls_for_service SET status = ?, status_changed_at = ?`;
    const updateParams: any[] = [status, now];

    if (tsField) {
      updateQuery += `, ${tsField} = COALESCE(${tsField}, ?)`;
      updateParams.push(now);
    }
    if (notes) {
      updateQuery += `, notes = ?`;
      updateParams.push(notes);
    }
    if (disposition) {
      updateQuery += `, disposition = ?`;
      updateParams.push(disposition);
    }
    if (starting_mileage != null) {
      updateQuery += `, starting_mileage = ?`;
      updateParams.push(starting_mileage);
    }
    if (ending_mileage != null) {
      updateQuery += `, ending_mileage = ?`;
      updateParams.push(ending_mileage);
    }
    if (responding_vehicle_id) {
      updateQuery += `, responding_vehicle_id = ?`;
      updateParams.push(responding_vehicle_id);
    }

    // Upgrade 60: Calculate and store response_time_seconds when going onscene
    if (status === 'onscene' && call.created_at) {
      try {
        const created = new Date(call.created_at);
        const onsceneTime = new Date(now);
        if (!isNaN(created.getTime()) && !isNaN(onsceneTime.getTime())) {
          const diffSec = Math.round((onsceneTime.getTime() - created.getTime()) / 1000);
          if (diffSec > 0 && diffSec < 43200) { // max 12 hours
            updateQuery += `, response_time_seconds = ?`;
            updateParams.push(diffSec);
          }
        }
      } catch { /* non-fatal */ }
    }

    // Upgrade 61: Store total_onscene_seconds when clearing (time spent on scene)
    if (['cleared', 'closed'].includes(status) && call.onscene_at) {
      try {
        const onscene = new Date(call.onscene_at);
        const clearTime = new Date(now);
        if (!isNaN(onscene.getTime()) && !isNaN(clearTime.getTime())) {
          const sceneSec = Math.round((clearTime.getTime() - onscene.getTime()) / 1000);
          if (sceneSec > 0 && sceneSec < 86400) { // max 24 hours
            updateQuery += `, onscene_duration_seconds = ?`;
            updateParams.push(sceneSec);
          }
        }
      } catch { /* non-fatal */ }
    }

    updateQuery += ` WHERE id = ?`;
    updateParams.push(call.id);

    // Transaction: update call + free units + activity log atomically
    let freedUnitIds: number[] = [];
    const statusTx = db.transaction(() => {
      db.prepare(updateQuery).run(...updateParams);

      // ── PSO 72-hour deadline: set precise deadline when PSO call is cleared/closed ──
      if (call.incident_type === 'pso_client_request' && ['cleared', 'closed'].includes(status)) {
        db.prepare(`
          UPDATE calls_for_service SET pso_72hr_deadline = ?, pso_72hr_notified = NULL WHERE id = ?
        `).run(
          new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          call.id,
        );

        // ── PSO Service Window Compliance: classify this attempt's time window ──
        const attemptTime = call.onscene_at || now; // Use onscene time, fallback to now
        const { window: timeWindow, isWeekend } = classifyServiceWindow(attemptTime);
        const currentWindows = parsePsoWindows(call.pso_service_windows);
        currentWindows[timeWindow] = true;
        if (isWeekend) currentWindows.weekend = true;
        db.prepare(`
          UPDATE calls_for_service SET pso_service_windows = ? WHERE id = ?
        `).run(JSON.stringify(currentWindows), call.id);
      }

      // ── Reset overdue flag when call leaves active status ──
      if (['cleared', 'closed', 'cancelled', 'archived'].includes(status)) {
        db.prepare('UPDATE calls_for_service SET overdue_notified = NULL WHERE id = ? AND overdue_notified IS NOT NULL')
          .run(call.id);
      }

      // If cleared, closed, cancelled, or archived, free up units
      if (['cleared', 'closed', 'cancelled', 'archived'].includes(status)) {
        let unitIds: number[] = [];
        try {
          const parsed = JSON.parse(call.assigned_unit_ids || '[]');
          unitIds = Array.isArray(parsed) ? parsed : [];
        } catch {
          console.warn(`[Dispatch] Corrupted assigned_unit_ids for call ${call.call_number}: ${call.assigned_unit_ids}`);
        }

        for (const unitId of unitIds) {
          const result = db.prepare(`
            UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?
          `).run(now, unitId, call.id);
          if (result.changes > 0) freedUnitIds.push(unitId);
        }
      }

      // Log activity
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'status_change', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `${call.call_number} status changed to ${status}`, req.ip || 'unknown');
    });
    statusTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    if (!updated) {
      res.status(404).json({ error: 'Call not found after update', code: 'CALL_NOT_FOUND_AFTER' });
      return;
    }
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status });

    // Start welfare monitoring for high-priority calls when going onscene
    if (status === 'onscene') {
      try {
        startWelfareWatch(req.user!.userId, call.call_sign || call.call_number, call.id, call.call_number, call.priority);
      } catch { /* non-critical */ }
    }

    // Clear welfare watch when call is cleared/closed/cancelled
    if (['cleared', 'closed', 'cancelled', 'archived'].includes(status)) {
      try {
        clearWelfareWatch(req.user!.userId);
      } catch { /* non-critical */ }
    }

    // Broadcast unit status changes so dispatch map reflects freed units
    for (const unitId of freedUnitIds) {
      const unitData = db.prepare(`SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone, c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location FROM units u LEFT JOIN users usr ON u.officer_id = usr.id LEFT JOIN calls_for_service c ON u.current_call_id = c.id WHERE u.id = ?`).get(unitId);
      if (unitData) broadcastUnitUpdate({ action: 'unit_status_changed', unit: unitData });
    }

    // Notify supervisors when a call is cleared or closed
    if (['cleared', 'closed'].includes(status)) {
      try {
        createNotificationForRoles(
          ['admin', 'manager', 'supervisor'],
          'dispatch', `Call Cleared: ${call.call_number}`,
          `${call.incident_type} — status changed to ${status}`,
          'call', call.id, 'normal', 'dispatch.call_cleared', req.user!.userId,
        );
      } catch (notifErr: any) {
        console.error('[Dispatch] Notification failed (non-fatal):', notifErr.message);
      }

      // PSO-specific: send 72-hour deadline notification
      if (call.incident_type === 'pso_client_request') {
        try {
          const attempt = call.pso_attempt_number || 1;
          createNotificationForRoles(
            ['admin', 'manager', 'supervisor', 'dispatcher'],
            'dispatch',
            `PSO 72hr Clock Started: ${call.call_number}`,
            `PSO call ${call.call_number} (Visit #${attempt}) has been ${status}. Re-dispatch within 72 hours. Location: ${call.location_address || 'unknown'}`,
            'call', call.id, 'high', 'pso_72hr_clock_started',
          );
        } catch (notifErr: any) {
          console.error('[Dispatch] PSO notification failed (non-fatal):', notifErr.message);
        }
      }
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Status update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to status update', code: 'STATUS_UPDATE_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/revert-status - Revert call to previous status
router.post('/calls/:id/revert-status', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    // Status chain: pending -> dispatched -> enroute -> onscene -> cleared -> closed
    const statusChain: Record<string, string> = {
      dispatched: 'pending',
      enroute: 'dispatched',
      onscene: 'enroute',
      cleared: 'onscene',
      closed: 'cleared',
    };

    const previousStatus = statusChain[call.status];
    if (!previousStatus) {
      res.status(400).json({ error: `Cannot revert from status "${call.status}"`, code: 'CANNOT_REVERT_STATUS' });
      return;
    }

    const now = localNow();

    // Clear the timestamp for the current status
    const timestampField: Record<string, string> = {
      dispatched: 'dispatched_at',
      enroute: 'enroute_at',
      onscene: 'onscene_at',
      cleared: 'cleared_at',
      closed: 'closed_at',
    };

    const tsField = timestampField[call.status];
    let updateQuery = `UPDATE calls_for_service SET status = ?`;
    const updateParams: any[] = [previousStatus];

    // Clear the timestamp for the status being reverted
    if (tsField) {
      updateQuery += `, ${tsField} = NULL`;
    }
    updateQuery += ` WHERE id = ?`;
    updateParams.push(call.id);

    // Transaction: revert call status + re-dispatch units + activity log atomically
    let revertedUnitIds: number[] = [];
    const revertTx = db.transaction(() => {
      db.prepare(updateQuery).run(...updateParams);

      // If reverting from cleared/closed, re-dispatch assigned units
      // Only re-assign units that are still available (not already on another call)
      if (['cleared', 'closed'].includes(call.status)) {
        let unitIds: number[] = [];
        try {
          const parsed = JSON.parse(call.assigned_unit_ids || '[]');
          unitIds = Array.isArray(parsed) ? parsed : [];
        } catch (parseErr) { console.error('[CallActions] Failed to parse assigned_unit_ids for revert:', parseErr instanceof Error ? parseErr.message : parseErr); }

        for (const unitId of unitIds) {
          const prevUnitStatus = previousStatus === 'onscene' ? 'onscene' : previousStatus === 'enroute' ? 'enroute' : 'dispatched';
          // Guard: only re-assign if unit is available (not already dispatched to another call)
          const result = db.prepare(`
            UPDATE units SET status = ?, current_call_id = ?, last_status_change = ?
            WHERE id = ? AND (current_call_id IS NULL OR current_call_id = ?)
          `).run(prevUnitStatus, call.id, now, unitId, call.id);
          if (result.changes > 0) revertedUnitIds.push(unitId);
        }
      }

      // Log activity
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'status_reverted', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `${call.call_number} status reverted from ${call.status} to ${previousStatus}`, req.ip || 'unknown');
    });
    revertTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status: previousStatus });

    // Broadcast unit status changes for re-dispatched units
    for (const unitId of revertedUnitIds) {
      const unitData = db.prepare(`SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone, c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location FROM units u LEFT JOIN users usr ON u.officer_id = usr.id LEFT JOIN calls_for_service c ON u.current_call_id = c.id WHERE u.id = ?`).get(unitId);
      if (unitData) broadcastUnitUpdate({ action: 'unit_status_changed', unit: unitData });
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Revert status error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to revert status', code: 'REVERT_STATUS_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/hold - Put call on hold (saves previous status)
router.post('/calls/:id/hold', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    if (call.status === 'on_hold') {
      res.status(400).json({ error: 'Call is already on hold', code: 'CALL_IS_ALREADY_ON' });
      return;
    }

    // Only active statuses can be held (not cleared/closed/cancelled/archived)
    const holdable = ['pending', 'dispatched', 'enroute', 'onscene'];
    if (!holdable.includes(call.status)) {
      res.status(400).json({ error: `Cannot hold a call with status "${call.status}"`, code: 'CANNOT_HOLD_STATUS' });
      return;
    }

    // Transaction: update call + log activity atomically
    const holdTx = db.transaction(() => {
      db.prepare(`
        UPDATE calls_for_service SET status = 'on_hold', previous_status = ? WHERE id = ?
      `).run(call.status, call.id);

      // Log activity
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_held', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `${call.call_number} put on hold from ${call.status}`, req.ip || 'unknown');
    });
    holdTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status: 'on_hold' });

    res.json(updated);
  } catch (error: any) {
    console.error('Hold call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to hold call', code: 'HOLD_CALL_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/resume - Resume a held call (restores previous status)
router.post('/calls/:id/resume', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    if (call.status !== 'on_hold') {
      res.status(400).json({ error: 'Call is not on hold', code: 'CALL_IS_NOT_ON' });
      return;
    }

    if (!call.previous_status) {
      console.warn(`[Dispatch] Call ${call.call_number} on_hold with NULL previous_status — defaulting to 'pending'`);
    }
    const restoreStatus = call.previous_status || 'pending';

    // Transaction: update call + log activity atomically
    const resumeTx = db.transaction(() => {
      db.prepare(`
        UPDATE calls_for_service SET status = ?, previous_status = NULL WHERE id = ?
      `).run(restoreStatus, call.id);

      // Log activity
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_resumed', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `${call.call_number} resumed to ${restoreStatus}`, req.ip || 'unknown');
    });
    resumeTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status: restoreStatus });

    res.json(updated);
  } catch (error: any) {
    console.error('Resume call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to resume call', code: 'RESUME_CALL_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/promote-to-incident - Create incident from call
router.post('/calls/:id/promote-to-incident', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }

    // Generate incident number
    const incidentNumber = generateIncidentNumber(db, call.incident_type || 'general');

    // Transaction: create incident + audit log atomically
    const promoteTx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO incidents (incident_number, call_id, incident_type, priority, status,
          location_address, property_id, latitude, longitude, narrative, officer_id,
          zone_beat, section_id, zone_id, beat_id, domestic_violence, weapons_involved,
          injuries)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        incidentNumber,
        call.id,
        call.incident_type || 'general',
        call.priority || 'P3',
        call.location_address || null,
        call.property_id || null,
        call.latitude ?? null,
        call.longitude ?? null,
        call.description || null,
        req.user!.userId,
        call.zone_beat || null,
        call.section_id || null,
        call.zone_id || null,
        call.beat_id || null,
        call.domestic_violence ?? 0,
        call.weapons_involved || null,
        call.injuries_reported ?? 0
      );

      // Audit log the incident creation
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'incident_created', 'incident', ?, ?, ?)
      `).run(req.user!.userId, Number(result.lastInsertRowid), `Promoted call ${call.call_number} to incident ${incidentNumber}`, req.ip || 'unknown');

      return result;
    });
    const result = promoteTx();

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(Number(result.lastInsertRowid));
    if (!incident) { res.status(500).json({ error: 'Failed to retrieve created incident', code: 'FAILED_TO_RETRIEVE_CREATED' }); return; }

    res.status(201).json(incident);
  } catch (error: any) {
    console.error('Promote to incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to promote to incident', code: 'PROMOTE_TO_INCIDENT_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/le-notification - Notify external agency
router.post('/calls/:id/le-notification', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }

    const { agency, case_number, notes } = req.body;
    const now = localNow();

    // Validate agency/case_number length
    if (agency && (typeof agency !== 'string' || agency.length > 200)) {
      res.status(400).json({ error: 'Agency must be 200 characters or less', code: 'INVALID_AGENCY' }); return;
    }
    if (case_number && (typeof case_number !== 'string' || case_number.length > 100)) {
      res.status(400).json({ error: 'Case number must be 100 characters or less', code: 'INVALID_CASE_NUMBER' }); return;
    }

    // Transaction: update call + audit log atomically
    const leTx = db.transaction(() => {
      db.prepare(`
        UPDATE calls_for_service
        SET le_notified = 1, le_agency = ?, le_case_number = ?, le_notified_at = ?, le_notified_by = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        agency || 'Local PD',
        case_number || null,
        now,
        req.user!.userId,
        now,
        req.params.id
      );

      // Audit log — LE notification is a significant action requiring compliance trail
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, 'le_notification', 'call', ?, ?, ?, ?)
      `).run(
        req.user!.userId,
        call.id,
        `LE notified: ${agency || 'Local PD'}${case_number ? ` (Case #${case_number})` : ''}`,
        req.ip || 'unknown',
        now
      );
    });
    leTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('LE notification error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to le notification', code: 'LE_NOTIFICATION_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// CALL PERSONS — Link/unlink person records to dispatch calls
// ═══════════════════════════════════════════════════════════

// GET /api/dispatch/calls/:id/persons — List linked persons
router.get('/calls/:id/persons', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT cp.*, p.first_name, p.last_name, p.middle_name, p.dob, p.phone,
        p.address, p.city, p.state, p.zip, p.race, p.gender, p.height, p.weight,
        p.hair_color, p.eye_color, p.flags, p.dl_number, p.dl_state,
        u.full_name as added_by_name
      FROM call_persons cp
      LEFT JOIN persons p ON cp.person_id = p.id
      LEFT JOIN users u ON cp.added_by = u.id
      WHERE cp.call_id = ?
      ORDER BY cp.created_at ASC
    
      LIMIT 1000
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get call persons error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get call persons', code: 'GET_CALL_PERSONS_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/persons — Link a person to a call
router.post('/calls/:id/persons', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, call_number FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) return res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });

    const { person_id, role, notes } = req.body;
    if (!person_id || !role) return res.status(400).json({ error: 'person_id and role are required', code: 'PERSONID_AND_ROLE_ARE' });

    const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(person_id) as any;
    if (!person) return res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });

    const existing = db.prepare('SELECT id FROM call_persons WHERE call_id = ? AND person_id = ?').get(call.id, person_id) as any;
    if (existing) return res.status(409).json({ error: 'Person already linked to this call', code: 'PERSON_ALREADY_LINKED_TO' });

    // Upgrade 62: Check if person is linked to other active calls (duplicate detection hint)
    let otherCallLinks: any[] = [];
    try {
      otherCallLinks = db.prepare(`
        SELECT cp.call_id, c.call_number, c.incident_type, c.status, cp.role
        FROM call_persons cp
        JOIN calls_for_service c ON cp.call_id = c.id
        WHERE cp.person_id = ? AND cp.call_id != ?
          AND c.status NOT IN ('cleared','closed','cancelled','archived')
        LIMIT 5
      `).all(person_id, call.id) as any[];
    } catch { /* non-fatal */ }

    const result = db.prepare(`
      INSERT INTO call_persons (call_id, person_id, role, notes, added_by) VALUES (?, ?, ?, ?, ?)
    `).run(call.id, person_id, role, notes || null, req.user!.userId);

    const linked = db.prepare(`
      SELECT cp.*, p.first_name, p.last_name, p.middle_name, p.dob, p.phone,
        p.address, p.city, p.state, p.zip, p.race, p.gender, p.height, p.weight,
        p.hair_color, p.eye_color, p.flags, p.dl_number, p.dl_state,
        u.full_name as added_by_name
      FROM call_persons cp
      LEFT JOIN persons p ON cp.person_id = p.id
      LEFT JOIN users u ON cp.added_by = u.id
      WHERE cp.id = ?
    `).get(Number(result.lastInsertRowid)) || { id: Number(result.lastInsertRowid) };

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'person_linked', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id,
      `Linked ${person.first_name} ${person.last_name} as ${role} to call ${call.call_number}`,
      req.ip || 'unknown');

    // Async warrant check for linked person — auto-add activity log note + broadcast alert on hits
    universalWarrantCheck(Number(person_id)).then(result => {
      if (result.hitsFound > 0 || result.warrantsCreated > 0) {
        try {
          const db2 = getDb();
          const noteText = `⚠️ WARRANT ALERT: ${result.personName} — ${result.hitsFound} active warrant(s)`;
          db2.prepare(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
            VALUES (0, 'warrant_alert', 'call', ?, ?, 'system')
          `).run(call.id, noteText);

          broadcast('dispatch', 'call:warrant_alert', {
            callId: call.id,
            personId: Number(person_id),
            personName: result.personName,
            warrantCount: result.hitsFound,
          });
        } catch (err: any) {
          console.error('[Dispatch Warrant Alert] Note creation error:', err.message);
        }
      }
    }).catch(err => console.error('[Warrant Check] Async check failed:', err.message));

    broadcastDispatchUpdate({ action: 'call_person_linked', call_id: call.id, person: linked });

    // Upgrade 63: Include duplicate detection hints and caution flags in response
    const responseData: any = { ...linked as any };
    if (otherCallLinks.length > 0) {
      responseData._active_call_links = otherCallLinks;
      responseData._warning = `Person is also linked to ${otherCallLinks.length} other active call(s)`;
    }
    // Upgrade 64: Check for caution flags on the person
    if (person) {
      const fullPerson = db.prepare('SELECT caution_flags, is_sex_offender, gang_affiliation, probation_parole, flags FROM persons WHERE id = ?').get(person_id) as any;
      if (fullPerson) {
        const alerts: string[] = [];
        if (fullPerson.caution_flags) alerts.push(`CAUTION: ${fullPerson.caution_flags}`);
        if (fullPerson.is_sex_offender) alerts.push('SEX OFFENDER');
        if (fullPerson.gang_affiliation) alerts.push(`GANG: ${fullPerson.gang_affiliation}`);
        if (fullPerson.probation_parole) alerts.push('PROBATION/PAROLE');
        if (fullPerson.flags && String(fullPerson.flags).includes('ACTIVE_WARRANT')) alerts.push('ACTIVE WARRANT');
        if (alerts.length > 0) responseData._safety_alerts = alerts;
      }
    }

    res.status(201).json(responseData);
  } catch (error: any) {
    console.error('Link call person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to link call person', code: 'LINK_CALL_PERSON_ERROR' });
  }
});

// PUT /api/dispatch/calls/:id/persons/:linkId — Update person link role/notes
router.put('/calls/:id/persons/:linkId', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const linkId = parseInt(req.params.linkId, 10);
    if (isNaN(linkId) || linkId < 1) return res.status(400).json({ error: 'Invalid linkId', code: 'INVALID_LINK_ID' });
    const link = db.prepare('SELECT * FROM call_persons WHERE id = ? AND call_id = ?').get(linkId, req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Person link not found', code: 'PERSON_LINK_NOT_FOUND' });

    const setClauses: string[] = [];
    const setValues: any[] = [];
    for (const field of ['role', 'notes']) {
      if (req.body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        setValues.push(req.body[field] ?? null);
      }
    }
    if (setClauses.length > 0) {
      setValues.push(link.id);
      db.prepare(`UPDATE call_persons SET ${setClauses.join(', ')} WHERE id = ?`).run(...setValues);
    }

    const updated = db.prepare(`
      SELECT cp.*, p.first_name, p.last_name, p.middle_name, p.dob, p.phone,
        p.address, p.city, p.state, p.zip, p.race, p.gender, p.height, p.weight,
        p.hair_color, p.eye_color, p.flags, p.dl_number, p.dl_state,
        u.full_name as added_by_name
      FROM call_persons cp
      LEFT JOIN persons p ON cp.person_id = p.id
      LEFT JOIN users u ON cp.added_by = u.id
      WHERE cp.id = ?
    `).get(link.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update call person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update call person', code: 'UPDATE_CALL_PERSON_ERROR' });
  }
});

// DELETE /api/dispatch/calls/:id/persons/:linkId — Unlink person from call
router.delete('/calls/:id/persons/:linkId', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const delPLinkId = parseInt(req.params.linkId, 10);
    if (isNaN(delPLinkId) || delPLinkId < 1) return res.status(400).json({ error: 'Invalid linkId', code: 'INVALID_LINK_ID' });
    const link = db.prepare('SELECT cp.*, p.first_name, p.last_name FROM call_persons cp LEFT JOIN persons p ON cp.person_id = p.id WHERE cp.id = ? AND cp.call_id = ?')
      .get(delPLinkId, req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Person link not found', code: 'PERSON_LINK_NOT_FOUND' });

    const call = db.prepare('SELECT call_number FROM calls_for_service WHERE id = ?').get(req.params.id) as any;

    db.prepare('DELETE FROM call_persons WHERE id = ?').run(link.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'person_unlinked', 'call', ?, ?, ?)
    `).run(req.user!.userId, req.params.id,
      `Unlinked ${link.first_name} ${link.last_name} from call ${call?.call_number || req.params.id}`,
      req.ip || 'unknown');

    broadcastDispatchUpdate({ action: 'call_person_unlinked', call_id: Number(req.params.id), link_id: link.id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Unlink call person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to unlink call person', code: 'UNLINK_CALL_PERSON_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// CALL VEHICLES — Link/unlink vehicle records to dispatch calls
// ═══════════════════════════════════════════════════════════

// GET /api/dispatch/calls/:id/vehicles — List linked vehicles
router.get('/calls/:id/vehicles', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT cv.*, v.make, v.model, v.year, v.color, v.plate_number, v.state as plate_state,
        v.vin, v.body_style, v.secondary_color,
        op.first_name as owner_first_name, op.last_name as owner_last_name,
        v.stolen_status, v.stolen_date,
        u.full_name as added_by_name
      FROM call_vehicles cv
      LEFT JOIN vehicles_records v ON cv.vehicle_id = v.id
      LEFT JOIN persons op ON v.owner_person_id = op.id
      LEFT JOIN users u ON cv.added_by = u.id
      WHERE cv.call_id = ?
      ORDER BY cv.created_at ASC
    
      LIMIT 1000
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get call vehicles error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get call vehicles', code: 'GET_CALL_VEHICLES_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/vehicles — Link a vehicle to a call
router.post('/calls/:id/vehicles', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, call_number FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) return res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });

    const { vehicle_id, role, notes } = req.body;
    if (!vehicle_id || !role) return res.status(400).json({ error: 'vehicle_id and role are required', code: 'VEHICLEID_AND_ROLE_ARE' });

    const vehicle = db.prepare('SELECT id, make, model, year, plate_number FROM vehicles_records WHERE id = ?').get(vehicle_id) as any;
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });

    const existing = db.prepare('SELECT id FROM call_vehicles WHERE call_id = ? AND vehicle_id = ?').get(call.id, vehicle_id) as any;
    if (existing) return res.status(409).json({ error: 'Vehicle already linked to this call', code: 'VEHICLE_ALREADY_LINKED_TO' });

    // Upgrade 65: Check if vehicle is reported stolen
    const fullVehicle = db.prepare('SELECT stolen_status, stolen_date FROM vehicles_records WHERE id = ?').get(vehicle_id) as any;
    let stolenAlert = false;
    if (fullVehicle && fullVehicle.stolen_status && fullVehicle.stolen_status !== 'none' && fullVehicle.stolen_status !== '') {
      stolenAlert = true;
    }

    const result = db.prepare(`
      INSERT INTO call_vehicles (call_id, vehicle_id, role, notes, added_by) VALUES (?, ?, ?, ?, ?)
    `).run(call.id, vehicle_id, role, notes || null, req.user!.userId);

    const linked = db.prepare(`
      SELECT cv.*, v.make, v.model, v.year, v.color, v.plate_number, v.state as plate_state,
        v.vin, v.body_style, v.secondary_color,
        op.first_name as owner_first_name, op.last_name as owner_last_name,
        v.stolen_status, v.stolen_date,
        u.full_name as added_by_name
      FROM call_vehicles cv
      LEFT JOIN vehicles_records v ON cv.vehicle_id = v.id
      LEFT JOIN persons op ON v.owner_person_id = op.id
      LEFT JOIN users u ON cv.added_by = u.id
      WHERE cv.id = ?
    `).get(Number(result.lastInsertRowid)) || { id: Number(result.lastInsertRowid) };

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'vehicle_linked', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id,
      `Linked ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} PLT:${vehicle.plate_number || 'N/A'} as ${role} to call ${call.call_number}`,
      req.ip || 'unknown');

    broadcastDispatchUpdate({ action: 'call_vehicle_linked', call_id: call.id, vehicle: linked });

    // Upgrade 66: Include stolen vehicle alert in response
    const responseData: any = { ...linked as any };
    if (stolenAlert) {
      responseData._stolen_alert = true;
      responseData._warning = `STOLEN VEHICLE ALERT: ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} PLT:${vehicle.plate_number || 'N/A'} is reported stolen (${fullVehicle.stolen_status})`;

      // Upgrade 67: Auto-add stolen vehicle activity log note
      try {
        db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (0, 'stolen_vehicle_alert', 'call', ?, ?, 'system')`).run(
          call.id, `STOLEN VEHICLE: ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} PLT:${vehicle.plate_number || 'N/A'} linked to call ${call.call_number}`);
      } catch { /* non-fatal */ }
    }

    res.status(201).json(responseData);
  } catch (error: any) {
    console.error('Link call vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to link call vehicle', code: 'LINK_CALL_VEHICLE_ERROR' });
  }
});

// PUT /api/dispatch/calls/:id/vehicles/:linkId — Update vehicle link role/notes
router.put('/calls/:id/vehicles/:linkId', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vLinkId = parseInt(req.params.linkId, 10);
    if (isNaN(vLinkId) || vLinkId < 1) return res.status(400).json({ error: 'Invalid linkId', code: 'INVALID_LINK_ID' });
    const link = db.prepare('SELECT * FROM call_vehicles WHERE id = ? AND call_id = ?').get(vLinkId, req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Vehicle link not found', code: 'VEHICLE_LINK_NOT_FOUND' });

    const setClauses: string[] = [];
    const setValues: any[] = [];
    for (const field of ['role', 'notes']) {
      if (req.body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        setValues.push(req.body[field] ?? null);
      }
    }
    if (setClauses.length > 0) {
      setValues.push(link.id);
      db.prepare(`UPDATE call_vehicles SET ${setClauses.join(', ')} WHERE id = ?`).run(...setValues);
    }

    const updated = db.prepare(`
      SELECT cv.*, v.make, v.model, v.year, v.color, v.plate_number, v.state as plate_state,
        v.vin, v.body_style, v.secondary_color,
        op.first_name as owner_first_name, op.last_name as owner_last_name,
        v.stolen_status, v.stolen_date,
        u.full_name as added_by_name
      FROM call_vehicles cv
      LEFT JOIN vehicles_records v ON cv.vehicle_id = v.id
      LEFT JOIN persons op ON v.owner_person_id = op.id
      LEFT JOIN users u ON cv.added_by = u.id
      WHERE cv.id = ?
    `).get(link.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update call vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update call vehicle', code: 'UPDATE_CALL_VEHICLE_ERROR' });
  }
});

// DELETE /api/dispatch/calls/:id/vehicles/:linkId — Unlink vehicle from call
router.delete('/calls/:id/vehicles/:linkId', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const delVLinkId = parseInt(req.params.linkId, 10);
    if (isNaN(delVLinkId) || delVLinkId < 1) return res.status(400).json({ error: 'Invalid linkId', code: 'INVALID_LINK_ID' });
    const link = db.prepare(`SELECT cv.*, v.make, v.model, v.year, v.plate_number
      FROM call_vehicles cv LEFT JOIN vehicles_records v ON cv.vehicle_id = v.id
      WHERE cv.id = ? AND cv.call_id = ?`).get(delVLinkId, req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Vehicle link not found', code: 'VEHICLE_LINK_NOT_FOUND' });

    const call = db.prepare('SELECT call_number FROM calls_for_service WHERE id = ?').get(req.params.id) as any;

    db.prepare('DELETE FROM call_vehicles WHERE id = ?').run(link.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'vehicle_unlinked', 'call', ?, ?, ?)
    `).run(req.user!.userId, req.params.id,
      `Unlinked ${link.year || ''} ${link.make || ''} ${link.model || ''} from call ${call?.call_number || req.params.id}`,
      req.ip || 'unknown');

    broadcastDispatchUpdate({ action: 'call_vehicle_unlinked', call_id: Number(req.params.id), link_id: link.id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Unlink call vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to unlink call vehicle', code: 'UNLINK_CALL_VEHICLE_ERROR' });
  }
});

// POST /calls/:id/send-to-serve — Create serve queue entry from PSO dispatch call
router.post('/calls/:id/send-to-serve', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    if (call.incident_type !== 'pso_client_request' && call.incident_type !== 'process_service') {
      res.status(400).json({ error: 'Only PSO client request or process service calls can be sent to the serve queue', code: 'ONLY_PSO_CLIENT_REQUEST' });
      return;
    }

    // Block duplicate — check if already linked
    const existing = db.prepare('SELECT id FROM serve_queue WHERE call_id = ?').get(call.id) as any;
    if (existing) {
      res.status(409).json({ error: 'This call already has a linked serve queue entry', code: 'DUPLICATE_SERVE_ENTRY', serve_queue_id: existing.id });
      return;
    }

    const now = localNow();

    // Use process_served_to, or fall back to reporting party / caller name / subject
    const recipientName = call.process_served_to || call.reporting_party || call.caller_name || call.subject || 'Unknown';

    // Parse address into components if possible (simple comma split)
    const addrParts = (call.process_served_address || call.location_address || '').split(',').map((s: string) => s.trim());
    const recipientAddress = addrParts[0] || call.location_address || '';
    const recipientCity = addrParts[1] || '';
    const recipientState = addrParts[2] || 'UT';
    const recipientZip = addrParts[3] || '';

    // Try to get assigned officer
    let officerId: number | null = null;
    try {
      const unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      if (Array.isArray(unitIds) && unitIds.length > 0) {
        const unit = db.prepare('SELECT officer_id FROM units WHERE id = ?').get(unitIds[0]) as any;
        if (unit?.officer_id) officerId = unit.officer_id;
      }
    } catch (parseErr) { console.error('[CallActions] Failed to parse assigned_unit_ids for serve queue:', parseErr instanceof Error ? parseErr.message : parseErr); }

    // Map document type
    const docTypeMap: Record<string, string> = {
      subpoena: 'subpoena', summons: 'summons', complaint: 'complaint',
      eviction: 'eviction', restraining_order: 'restraining_order',
      writ: 'writ', order: 'order', notice: 'notice', petition: 'petition',
    };
    const documentType = docTypeMap[call.process_service_type] || call.process_service_type || 'civil';

    // Map dispatch priority (P1-P5) to serve queue priority (low/normal/high/rush)
    const priorityMap: Record<string, string> = { P1: 'rush', P2: 'high', P3: 'normal', P4: 'low', P5: 'low' };
    const servePriority = priorityMap[call.priority] || 'normal';

    const info = db.prepare(`
      INSERT INTO serve_queue (
        call_id, officer_id, serve_date, recipient_name,
        recipient_address, recipient_city, recipient_state, recipient_zip,
        recipient_lat, recipient_lng, document_type, case_number,
        client_name, priority, max_attempts, service_instructions, notes,
        status, attempt_count, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 999, ?, ?)
    `).run(
      call.id, officerId,
      localToday(),
      recipientName,
      recipientAddress, recipientCity, recipientState, recipientZip,
      call.latitude || null, call.longitude || null,
      documentType, call.case_number || '',
      call.pso_requestor_name || '', servePriority,
      3, '', `From dispatch ${call.call_number}`,
      now, now,
    );

    const id = info.lastInsertRowid;
    const job = db.prepare('SELECT * FROM serve_queue WHERE id = ?').get(id);

    auditLog(req, 'CREATE', 'serve_queue', String(id), `Sent dispatch call ${call.call_number} to serve queue for ${recipientName}`);
    broadcast('serve', 'serve_created', job);

    // Also update the call's activity log
    try {
      const activities = JSON.parse(call.activity_log || '[]');
      activities.push({
        action: 'sent_to_serve_queue',
        timestamp: now,
        user_id: req.user!.userId,
        details: `Sent to serve queue (ID: ${id})`,
      });
      db.prepare('UPDATE calls_for_service SET activity_log = ? WHERE id = ?').run(JSON.stringify(activities), call.id);
    } catch (logErr) { console.error('[CallActions] Failed to update activity_log for serve queue:', logErr instanceof Error ? logErr.message : logErr); }

    broadcastDispatchUpdate({ action: 'call_updated', call: db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id) });

    res.status(201).json(job);
  } catch (err: any) {
    console.error('[DISPATCH] Send to serve error:', err);
    res.status(500).json({ error: 'Failed to send to serve queue', code: 'FAILED_TO_SEND_TO' });
  }
});

// GET /calls/:id/serve-link — Get linked serve queue entry for a call
router.get('/calls/:id/serve-link', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM serve_queue WHERE call_id = ?').get(req.params.id) as any;
    if (!job) {
      res.json(null);
      return;
    }

    const attempts = db.prepare(
      'SELECT * FROM serve_attempts WHERE serve_queue_id = ? ORDER BY attempt_number ASC'
    ).all(job.id);

    res.json({ ...job, attempts });
  } catch (err: any) {
    console.error('[DISPATCH] Serve link error:', err);
    res.status(500).json({ error: 'Failed to fetch serve link', code: 'FAILED_TO_FETCH_SERVE' });
  }
});

// ============================================================
// GET /calls/actions/export/csv — Export call action log as CSV
// ============================================================
router.get('/calls/actions/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { from, to } = req.query;

    // Validate date params
    if (from && (typeof from !== 'string' || from.length > 50)) {
      res.status(400).json({ error: 'Invalid from date', code: 'INVALID_FROM_DATE' }); return;
    }
    if (to && (typeof to !== 'string' || to.length > 50)) {
      res.status(400).json({ error: 'Invalid to date', code: 'INVALID_TO_DATE' }); return;
    }

    let where = "WHERE al.entity_type = 'call'";
    const params: any[] = [];

    if (from) {
      where += ' AND al.created_at >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND al.created_at <= ?';
      params.push(to);
    }

    const rows = db.prepare(`
      SELECT al.id, al.action, al.entity_id as call_id, al.details,
        al.ip_address, al.created_at, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT 10000
    `).all(...params);

    sendCsv(res, `call_actions_export_${localNow().slice(0, 10)}.csv`, [
      { key: 'id', header: 'ID' },
      { key: 'call_id', header: 'Call ID' },
      { key: 'action', header: 'Action' },
      { key: 'details', header: 'Details' },
      { key: 'user_name', header: 'User' },
      { key: 'ip_address', header: 'IP Address' },
      { key: 'created_at', header: 'Timestamp' },
    ], rows);
  } catch (error: any) {
    console.error('Export call actions error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to export call actions', code: 'EXPORT_CALL_ACTIONS_ERROR' });
  }
});

// ── Feature 1: Call Priority Escalation Timer ────────────────────
// POST /api/dispatch/calls/:id/escalate - Auto-escalate call priority
router.post('/calls/:id/escalate', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }

    const escalationMap: Record<string, string> = { P4: 'P3', P3: 'P2', P2: 'P1' };
    const newPriority = escalationMap[call.priority];
    if (!newPriority) { res.status(400).json({ error: 'Call is already P1 or cannot be escalated', code: 'CALL_IS_ALREADY_P1' }); return; }

    const now = localNow();
    // Transaction: escalate priority + log atomically
    const escalateTx = db.transaction(() => {
      db.prepare('UPDATE calls_for_service SET priority = ?, updated_at = ? WHERE id = ?').run(newPriority, now, call.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'priority_escalated', 'call', ?, ?, ?)`).run(
        req.user!.userId, call.id, `Escalated ${call.call_number} from ${call.priority} to ${newPriority}`, req.ip || 'unknown');
    });
    escalateTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('Escalate priority error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to escalate priority', code: 'ESCALATE_PRIORITY_ERROR' });
  }
});

// ── Feature 10: Duplicate Call Warning ────────────────────────────
// GET /api/dispatch/calls/check-duplicate - Check for recent calls at same address
router.get('/calls/check-duplicate', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { address } = req.query;
    if (!address || typeof address !== 'string' || address.trim().length < 3) {
      res.json({ duplicates: [] });
      return;
    }
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const duplicates = db.prepare(`
      SELECT id, call_number, incident_type, priority, status, location_address, created_at
      FROM calls_for_service
      WHERE LOWER(location_address) = LOWER(?) AND created_at >= ? AND status != 'archived'
      ORDER BY created_at DESC LIMIT 5
    `).all(address.trim(), oneHourAgo);
    res.json({ duplicates });
  } catch (error: any) {
    console.error('Check duplicate error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to check duplicate', code: 'CHECK_DUPLICATE_ERROR' });
  }
});

// ── Feature 11: Auto-assign Nearest Unit ─────────────────────────
// POST /api/dispatch/calls/:id/auto-assign - Dispatch closest available unit
router.post('/calls/:id/auto-assign', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }
    if (!call.latitude || !call.longitude) {
      res.status(400).json({ error: 'Call has no GPS coordinates — cannot auto-assign', code: 'CALL_HAS_NO_GPS' });
      return;
    }

    // Find available units with GPS
    const availableUnits = db.prepare(`
      SELECT u.id, u.call_sign, u.latitude, u.longitude
      FROM units u
      WHERE u.status = 'available' AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
    
      LIMIT 1000
    `).all() as any[];

    if (availableUnits.length === 0) {
      res.status(404).json({ error: 'No available units with GPS positions', code: 'NO_AVAILABLE_UNITS_WITH' });
      return;
    }

    // Haversine distance
    const toRad = (d: number) => d * Math.PI / 180;
    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 3959; // miles
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    let nearest = availableUnits[0];
    let minDist = Infinity;
    for (const u of availableUnits) {
      const d = haversine(call.latitude, call.longitude, u.latitude, u.longitude);
      if (d < minDist) { minDist = d; nearest = u; }
    }

    // Assign the nearest unit
    const now = localNow();
    let currentUnits: number[] = [];
    try { currentUnits = JSON.parse(call.assigned_unit_ids || '[]'); } catch (parseErr) { console.error('[CallActions] Failed to parse assigned_unit_ids for auto-assign:', parseErr instanceof Error ? parseErr.message : parseErr); }
    if (!currentUnits.includes(Number(nearest.id))) currentUnits.push(Number(nearest.id));

    const assignTx = db.transaction(() => {
      db.prepare(`UPDATE calls_for_service SET status = CASE WHEN status = 'pending' THEN 'dispatched' ELSE status END,
        assigned_unit_ids = ?, dispatched_at = COALESCE(dispatched_at, ?) WHERE id = ?`).run(JSON.stringify(currentUnits), now, call.id);
      db.prepare(`UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ? WHERE id = ?`).run(call.id, now, nearest.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'auto_assigned', 'call', ?, ?, ?)`).run(
        req.user!.userId, call.id, `Auto-assigned nearest unit ${nearest.call_sign} (${minDist.toFixed(2)} mi) to ${call.call_number}`, req.ip || 'unknown');
    });
    assignTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id) as any;
    broadcastDispatchUpdate({ action: 'unit_assigned', call: updated, unit_id: nearest.id });
    res.json({ ...(updated || {}), auto_assigned_unit: nearest.call_sign, distance_miles: Math.round(minDist * 100) / 100 });
  } catch (error: any) {
    console.error('Auto-assign error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to auto-assign', code: 'AUTOASSIGN_ERROR' });
  }
});

// ── Feature 14: Disposition Statistics ───────────────────────────
// GET /api/dispatch/disposition-stats - Disposition counts for current shift
router.get('/disposition-stats', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const shiftStart = new Date();
    shiftStart.setHours(shiftStart.getHours() - 12);
    const stats = db.prepare(`
      SELECT disposition, COUNT(*) as count
      FROM calls_for_service
      WHERE disposition IS NOT NULL AND disposition != '' AND cleared_at >= ?
      GROUP BY disposition ORDER BY count DESC
    `).all(shiftStart.toISOString());
    res.json(stats);
  } catch (error: any) {
    console.error('Disposition stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to disposition stats', code: 'DISPOSITION_STATS_ERROR' });
  }
});

// ── Feature 19: Call Transfer ────────────────────────────────────
// POST /api/dispatch/calls/:id/transfer - Transfer call from one unit to another
router.post('/calls/:id/transfer', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }

    const { from_unit_id, to_unit_id } = req.body;
    if (!from_unit_id || !to_unit_id) {
      res.status(400).json({ error: 'from_unit_id and to_unit_id are required', code: 'FROMUNITID_AND_TOUNITID_ARE' });
      return;
    }

    const fromUnit = db.prepare('SELECT * FROM units WHERE id = ?').get(from_unit_id) as any;
    const toUnit = db.prepare('SELECT * FROM units WHERE id = ?').get(to_unit_id) as any;
    if (!fromUnit || !toUnit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    const now = localNow();
    let currentUnits: number[] = [];
    try { currentUnits = JSON.parse(call.assigned_unit_ids || '[]'); } catch (parseErr) { console.error('[CallActions] Failed to parse assigned_unit_ids for transfer:', parseErr instanceof Error ? parseErr.message : parseErr); }

    // Remove source, add target
    currentUnits = currentUnits.filter(id => id !== Number(from_unit_id));
    if (!currentUnits.includes(Number(to_unit_id))) currentUnits.push(Number(to_unit_id));

    const transferTx = db.transaction(() => {
      db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?').run(JSON.stringify(currentUnits), call.id);
      db.prepare(`UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ?`).run(now, from_unit_id);
      db.prepare(`UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ? WHERE id = ?`).run(call.id, now, to_unit_id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_transferred', 'call', ?, ?, ?)`).run(
        req.user!.userId, call.id, `Transferred ${call.call_number} from ${fromUnit.call_sign} to ${toUnit.call_sign}`, req.ip || 'unknown');
    });
    transferTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    broadcastUnitUpdate({ action: 'unit_status_changed', unit: db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(from_unit_id) });
    broadcastUnitUpdate({ action: 'unit_status_changed', unit: db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(to_unit_id) });

    res.json(updated);
  } catch (error: any) {
    console.error('Transfer call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to transfer call', code: 'TRANSFER_CALL_ERROR' });
  }
});

// ── Feature 20: Dispatch Notes Broadcast ─────────────────────────
// POST /api/dispatch/calls/:id/broadcast-note - Add a note that broadcasts to all assigned units
router.post('/calls/:id/broadcast-note', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }

    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length < 2 || message.length > 2000) {
      res.status(400).json({ error: 'message is required (2-2000 chars)', code: 'MESSAGE_IS_REQUIRED_MIN' });
      return;
    }

    const now = localNow();
    // Add note to call
    let notes: any[] = [];
    try { notes = JSON.parse(call.notes || '[]'); } catch (parseErr) { console.error('[CallActions] Failed to parse notes for broadcast:', parseErr instanceof Error ? parseErr.message : parseErr); }
    notes.push({ id: `bn-${Date.now()}`, author: 'DISPATCH BROADCAST', text: message.trim(), timestamp: now, broadcast: true });
    db.prepare('UPDATE calls_for_service SET notes = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(notes), now, call.id);

    // Notify all assigned units' officers
    let unitIds: number[] = [];
    try { unitIds = JSON.parse(call.assigned_unit_ids || '[]'); } catch (parseErr) { console.error('[CallActions] Failed to parse assigned_unit_ids for broadcast:', parseErr instanceof Error ? parseErr.message : parseErr); }
    for (const unitId of unitIds) {
      const unit = db.prepare('SELECT officer_id, call_sign FROM units WHERE id = ?').get(unitId) as any;
      if (unit?.officer_id) {
        try {
          createNotification(
            unit.officer_id, 'dispatch',
            `BROADCAST: ${call.call_number}`,
            message.trim(),
            'call', call.id, 'high',
          );
        } catch (notifErr) { console.error('[CallActions] Broadcast notification failed (non-fatal):', notifErr instanceof Error ? notifErr.message : notifErr); }
      }
    }

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    broadcast('dispatch', 'dispatch_broadcast', { call_id: call.id, call_number: call.call_number, message: message.trim(), unit_ids: unitIds });

    res.json(updated);
  } catch (error: any) {
    console.error('Broadcast note error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to broadcast note', code: 'BROADCAST_NOTE_ERROR' });
  }
});

export default router;
