import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { validateParamId } from '../../middleware/sanitize';
import { broadcast, broadcastDispatchUpdate, broadcastUnitUpdate } from '../../utils/websocket';
import { localNow, localToday } from '../../utils/timeUtils';
import { generateIncidentNumber } from '../../utils/caseNumbers';
import { createNotification, createNotificationForRoles } from '../notifications';
import { universalWarrantCheck } from '../../utils/universalWarrantScanner';
import { auditLog } from '../../utils/auditLogger';
import { sendCsv } from '../../utils/csvExport';

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
  } catch {
    return { early_morning: false, daytime: false, evening: false, weekend: false };
  }
}

function isPsoCompliant(windows: PsoServiceWindows): boolean {
  return windows.early_morning && windows.daytime && windows.evening && windows.weekend;
}

// POST /api/dispatch/calls/:id/dispatch - Dispatch unit(s) to call
router.post('/calls/:id/dispatch', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { unit_ids } = req.body;
    if (!unit_ids || !Array.isArray(unit_ids) || unit_ids.length === 0) {
      res.status(400).json({ error: 'unit_ids array is required' });
      return;
    }
    // Validate all unit_ids are positive integers and limit count
    if (unit_ids.length > 50) {
      res.status(400).json({ error: 'Cannot dispatch more than 50 units at once' });
      return;
    }
    for (const uid of unit_ids) {
      const n = parseInt(String(uid), 10);
      if (isNaN(n) || n < 1) {
        res.status(400).json({ error: 'All unit_ids must be positive integers' });
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
            'call', call.id, 'high', 'dispatch.unit_dispatched',
          );
        }
      }
    } catch (notifErr: any) {
      console.error('[Dispatch] Officer notification failed (non-fatal):', notifErr.message);
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Dispatch error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/assign-unit - Attach a single unit to a call (dispatchers + officers for self-dispatch)
router.post('/calls/:id/assign-unit', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { unit_id } = req.body;
    if (!unit_id) {
      res.status(400).json({ error: 'unit_id is required' });
      return;
    }

    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
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
      res.status(400).json({ error: 'Invalid unit_id' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/unassign-unit - Detach a single unit from a call
router.post('/calls/:id/unassign-unit', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { unit_id } = req.body;
    if (!unit_id) {
      res.status(400).json({ error: 'unit_id is required' });
      return;
    }

    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unit_id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
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
      } catch { /* ignore */ }
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/status - Update call status with timestamp
router.post('/calls/:id/status', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { status, notes, disposition, starting_mileage, ending_mileage, responding_vehicle_id } = req.body;
    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived', 'on_hold'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status', valid: validStatuses });
      return;
    }

    // ── PSO 72-Hour Rule Enforcement (server-side) ──────────
    // PSO Client Request calls have special rules:
    // 1. Cannot be cleared/closed without a disposition
    // 2. Cannot be archived if 72hr re-dispatch deadline hasn't been addressed
    // 3. Auto-sets pso_72hr_deadline when cleared so countdown is precise
    if (call.incident_type === 'pso_client_request') {
      // Require disposition when clearing/closing PSO calls
      if (['cleared', 'closed'].includes(status) && !disposition && !call.disposition) {
        res.status(400).json({
          error: 'PSO calls require a disposition when clearing or closing',
          code: 'PSO_DISPOSITION_REQUIRED',
        });
        return;
      }

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
    let updateQuery = `UPDATE calls_for_service SET status = ?`;
    const updateParams: any[] = [status];

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
      res.status(404).json({ error: 'Call not found after update' });
      return;
    }
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status });

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/revert-status - Revert call to previous status
router.post('/calls/:id/revert-status', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
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
      res.status(400).json({ error: `Cannot revert from status "${call.status}"` });
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
        } catch { /* ignore */ }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/hold - Put call on hold (saves previous status)
router.post('/calls/:id/hold', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status === 'on_hold') {
      res.status(400).json({ error: 'Call is already on hold' });
      return;
    }

    // Only active statuses can be held (not cleared/closed/cancelled/archived)
    const holdable = ['pending', 'dispatched', 'enroute', 'onscene'];
    if (!holdable.includes(call.status)) {
      res.status(400).json({ error: `Cannot hold a call with status "${call.status}"` });
      return;
    }

    db.prepare(`
      UPDATE calls_for_service SET status = 'on_hold', previous_status = ? WHERE id = ?
    `).run(call.status, call.id);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_held', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} put on hold from ${call.status}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status: 'on_hold' });

    res.json(updated);
  } catch (error: any) {
    console.error('Hold call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/resume - Resume a held call (restores previous status)
router.post('/calls/:id/resume', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status !== 'on_hold') {
      res.status(400).json({ error: 'Call is not on hold' });
      return;
    }

    if (!call.previous_status) {
      console.warn(`[Dispatch] Call ${call.call_number} on_hold with NULL previous_status — defaulting to 'pending'`);
    }
    const restoreStatus = call.previous_status || 'pending';

    db.prepare(`
      UPDATE calls_for_service SET status = ?, previous_status = NULL WHERE id = ?
    `).run(restoreStatus, call.id);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_resumed', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} resumed to ${restoreStatus}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status: restoreStatus });

    res.json(updated);
  } catch (error: any) {
    console.error('Resume call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/promote-to-incident - Create incident from call
router.post('/calls/:id/promote-to-incident', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    // Generate incident number
    const incidentNumber = generateIncidentNumber(db, call.incident_type || 'general');

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

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(Number(result.lastInsertRowid));
    if (!incident) { res.status(500).json({ error: 'Failed to retrieve created incident' }); return; }

    // Audit log the incident creation
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_created', 'incident', ?, ?, ?)
    `).run(req.user!.userId, Number(result.lastInsertRowid), `Promoted call ${call.call_number} to incident ${incidentNumber}`, req.ip || 'unknown');

    res.status(201).json(incident);
  } catch (error: any) {
    console.error('Promote to incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/le-notification - Notify external agency
router.post('/calls/:id/le-notification', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    const { agency, case_number, notes } = req.body;
    const now = localNow();

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

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('LE notification error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════
// CALL PERSONS — Link/unlink person records to dispatch calls
// ═══════════════════════════════════════════════════════════

// GET /api/dispatch/calls/:id/persons — List linked persons
router.get('/calls/:id/persons', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get call persons error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/persons — Link a person to a call
router.post('/calls/:id/persons', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, call_number FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const { person_id, role, notes } = req.body;
    if (!person_id || !role) return res.status(400).json({ error: 'person_id and role are required' });

    const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(person_id) as any;
    if (!person) return res.status(404).json({ error: 'Person not found' });

    const existing = db.prepare('SELECT id FROM call_persons WHERE call_id = ? AND person_id = ?').get(call.id, person_id) as any;
    if (existing) return res.status(409).json({ error: 'Person already linked to this call' });

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
    res.status(201).json(linked);
  } catch (error: any) {
    console.error('Link call person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/calls/:id/persons/:linkId — Update person link role/notes
router.put('/calls/:id/persons/:linkId', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM call_persons WHERE id = ? AND call_id = ?').get(req.params.linkId, req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Person link not found' });

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/calls/:id/persons/:linkId — Unlink person from call
router.delete('/calls/:id/persons/:linkId', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT cp.*, p.first_name, p.last_name FROM call_persons cp LEFT JOIN persons p ON cp.person_id = p.id WHERE cp.id = ? AND cp.call_id = ?')
      .get(req.params.linkId, req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Person link not found' });

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════
// CALL VEHICLES — Link/unlink vehicle records to dispatch calls
// ═══════════════════════════════════════════════════════════

// GET /api/dispatch/calls/:id/vehicles — List linked vehicles
router.get('/calls/:id/vehicles', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get call vehicles error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/vehicles — Link a vehicle to a call
router.post('/calls/:id/vehicles', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, call_number FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const { vehicle_id, role, notes } = req.body;
    if (!vehicle_id || !role) return res.status(400).json({ error: 'vehicle_id and role are required' });

    const vehicle = db.prepare('SELECT id, make, model, year, plate_number FROM vehicles_records WHERE id = ?').get(vehicle_id) as any;
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const existing = db.prepare('SELECT id FROM call_vehicles WHERE call_id = ? AND vehicle_id = ?').get(call.id, vehicle_id) as any;
    if (existing) return res.status(409).json({ error: 'Vehicle already linked to this call' });

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
    res.status(201).json(linked);
  } catch (error: any) {
    console.error('Link call vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/calls/:id/vehicles/:linkId — Update vehicle link role/notes
router.put('/calls/:id/vehicles/:linkId', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM call_vehicles WHERE id = ? AND call_id = ?').get(req.params.linkId, req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Vehicle link not found' });

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/calls/:id/vehicles/:linkId — Unlink vehicle from call
router.delete('/calls/:id/vehicles/:linkId', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare(`SELECT cv.*, v.make, v.model, v.year, v.plate_number
      FROM call_vehicles cv LEFT JOIN vehicles_records v ON cv.vehicle_id = v.id
      WHERE cv.id = ? AND cv.call_id = ?`).get(req.params.linkId, req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Vehicle link not found' });

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /calls/:id/send-to-serve — Create serve queue entry from PSO dispatch call
router.post('/calls/:id/send-to-serve', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.incident_type !== 'pso_client_request') {
      res.status(400).json({ error: 'Only PSO client request calls can be sent to the serve queue' });
      return;
    }

    // Block duplicate — check if already linked
    const existing = db.prepare('SELECT id FROM serve_queue WHERE call_id = ?').get(call.id) as any;
    if (existing) {
      res.status(409).json({ error: 'This call already has a linked serve queue entry', serve_queue_id: existing.id });
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
    } catch {}

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
    } catch {}

    broadcastDispatchUpdate({ action: 'call_updated', call: db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id) });

    res.status(201).json(job);
  } catch (err: any) {
    console.error('[DISPATCH] Send to serve error:', err);
    res.status(500).json({ error: 'Failed to send to serve queue' });
  }
});

// GET /calls/:id/serve-link — Get linked serve queue entry for a call
router.get('/calls/:id/serve-link', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
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
    res.status(500).json({ error: 'Failed to fetch serve link' });
  }
});

// ============================================================
// GET /calls/actions/export/csv — Export call action log as CSV
// ============================================================
router.get('/calls/actions/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { from, to } = req.query;

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
