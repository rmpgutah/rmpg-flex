import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { validateParamId, validateParamIdMiddleware } from '../../middleware/sanitize';
import { broadcastUnitUpdate } from '../../utils/websocket';
import { localNow } from '../../utils/timeUtils';
import { auditLog } from '../../utils/auditLogger';
import { startWelfareWatch, clearWelfareWatch } from '../../utils/officerWelfare';


const router = Router();

// GET /api/dispatch/units - Get all units with current status
router.get('/units', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Fix 59: Index hints for GPS-related queries
    const units = db.prepare(`
      /* Uses idx: units(officer_id), units(current_call_id) */
      SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone,
        c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      ORDER BY u.call_sign
    
      LIMIT 1000
    `).all();

    res.set('Cache-Control', 'private, max-age=5');
    res.json(units);
  } catch (error: any) {
    console.error('[Units] get units error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get units', code: 'UNITS_GET_UNITS_ERROR' });
  }
});

// POST /api/dispatch/units - Create dispatch unit
router.post('/units', requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Audit 2026-04-11: previous handler dropped vehicle_id and capabilities
    // on create — those could only be set via a follow-up PUT.
    const { call_sign, officer_id, status, vehicle_id, capabilities } = req.body;
    if (!call_sign || !String(call_sign).trim()) {
      res.status(400).json({ error: 'call_sign is required', code: 'CALLSIGN_IS_REQUIRED' });
      return;
    }

    // Check for duplicate call_sign
    const existing = db.prepare('SELECT id FROM units WHERE call_sign = ?').get(call_sign);
    if (existing) {
      res.status(409).json({ error: 'A unit with this call sign already exists', code: 'A_UNIT_WITH_THIS' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO units (call_sign, officer_id, status, vehicle_id, capabilities, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      call_sign,
      officer_id || null,
      status || 'off_duty',
      vehicle_id || null,
      Array.isArray(capabilities) ? JSON.stringify(capabilities) : (capabilities || null),
      localNow(),
      localNow(),
    );

    const unit = db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(Number(result.lastInsertRowid));
    if (!unit) { res.status(500).json({ error: 'Failed to retrieve created unit', code: 'FAILED_TO_RETRIEVE_CREATED' }); return; }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_created', 'unit', ?, ?, ?)`).run(
      req.user!.userId, Number(result.lastInsertRowid), `Created unit: ${call_sign}`, req.ip || 'unknown');

    broadcastUnitUpdate({ action: 'unit_created', unit });
    res.status(201).json(unit);
  } catch (error: any) {
    console.error('[Units] create unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to create unit', code: 'UNITS_CREATE_UNIT_ERROR' });
  }
});

// PUT /api/dispatch/units/:id - Edit unit details (call_sign, officer_id, status, vehicle_id)
router.put('/units/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' });
      return;
    }

    const { call_sign, officer_id, status, vehicle_id, capabilities } = req.body;
    const now = localNow();
    const updates: string[] = [];
    const params: any[] = [];

    if (call_sign !== undefined) {
      const trimmed = call_sign.trim();
      if (!trimmed) {
        res.status(400).json({ error: 'call_sign cannot be empty', code: 'CALLSIGN_CANNOT_BE_EMPTY' });
        return;
      }
      // Check uniqueness (exclude self)
      const dup = db.prepare('SELECT id FROM units WHERE call_sign = ? AND id != ?').get(trimmed, req.params.id);
      if (dup) {
        res.status(409).json({ error: 'A unit with this call sign already exists', code: 'A_UNIT_WITH_THIS' });
        return;
      }
      updates.push('call_sign = ?');
      params.push(trimmed);
    }
    if (officer_id !== undefined) {
      updates.push('officer_id = ?');
      params.push(officer_id || null);
    }
    if (status !== undefined) {
      const VALID_UNIT_STATUSES = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service'];
      if (!VALID_UNIT_STATUSES.includes(status)) {
        res.status(400).json({ error: 'Invalid unit status', valid: VALID_UNIT_STATUSES });
        return;
      }
      updates.push('status = ?');
      params.push(status);
      updates.push('last_status_change = ?');
      params.push(now);
    }
    if (vehicle_id !== undefined) {
      updates.push('vehicle_id = ?');
      params.push(vehicle_id || null);
    }
    if (capabilities !== undefined) {
      updates.push('capabilities = ?');
      params.push(typeof capabilities === 'string' ? capabilities : JSON.stringify(capabilities));
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }

    updates.push("updated_at = ?");
    params.push(localNow());
    params.push(req.params.id);
    db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_updated', 'unit', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Updated unit: ${(updated as any)?.call_sign || req.params.id}`, req.ip || 'unknown');

    if (updated) broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('[Units] update unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update unit', code: 'UNITS_UPDATE_UNIT_ERROR' });
  }
});

// DELETE /api/dispatch/units/:id - Delete a unit
router.delete('/units/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' });
      return;
    }

    // Block deletion if unit is assigned to an active call
    // God Mode: admin bypass — auto-unassign from active call then delete
    if (unit.current_call_id) {
      if (req.user?.role !== 'admin') {
        res.status(400).json({ error: 'Cannot delete a unit that is assigned to an active call. Unassign the unit first.', code: 'CANNOT_DELETE_A_UNIT' });
        return;
      } else {
        // Admin force-unassign: clear unit from the call
        db.prepare('UPDATE units SET current_call_id = NULL, status = ? WHERE id = ?').run('available', req.params.id);
        auditLog(req, 'ADMIN_OVERRIDE', 'unit', Number(req.params.id), `Admin God Mode: force-unassigned unit ${unit.call_sign} from call ${unit.current_call_id} before deletion`);
      }
    }

    db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_deleted', 'unit', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Deleted unit: ${unit.call_sign}`, req.ip || 'unknown');

    broadcastUnitUpdate({ action: 'unit_deleted', unit_id: req.params.id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Units] delete unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to delete unit', code: 'UNITS_DELETE_UNIT_ERROR' });
  }
});

// PUT /api/dispatch/units/:id/status - Update unit status and location
router.put('/units/:id/status', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' });
      return;
    }

    const { status, latitude, longitude } = req.body;
    const now = localNow();

    // Validate status value if provided
    const VALID_UNIT_STATUSES = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service'];
    if (status && !VALID_UNIT_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Invalid unit status', valid: VALID_UNIT_STATUSES });
      return;
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (status) {
      // Fix 58: Validate status transitions
      // God Mode: admin bypass — can force any status transition
      const INVALID_TRANSITIONS: Record<string, string[]> = {
        off_duty: ['onscene'], // Can't go from off_duty directly to onscene
        out_of_service: ['onscene', 'enroute'], // Must go available first
      };
      const blocked = INVALID_TRANSITIONS[unit.status];
      if (blocked && blocked.includes(status)) {
        if (req.user?.role !== 'admin') {
          res.status(400).json({
            error: `Cannot transition from '${unit.status}' to '${status}'. Must go through 'available' or 'dispatched' first.`,
            code: 'INVALID_STATUS_TRANSITION',
            current_status: unit.status,
            requested_status: status,
          });
          return;
        } else {
          auditLog(req, 'ADMIN_OVERRIDE', 'unit', Number(req.params.id), `Admin God Mode: forced status transition ${unit.status} -> ${status}`);
        }
      }
      updates.push('status = ?');
      params.push(status);
      updates.push('last_status_change = ?');
      params.push(now);
      // If going available or off duty, clear current call in the same UPDATE
      if (status === 'available' || status === 'off_duty') {
        updates.push('current_call_id = NULL');
      }
    }
    if (latitude !== undefined) {
      const lat = parseFloat(String(latitude));
      if (isNaN(lat) || lat < -90 || lat > 90) {
        res.status(400).json({ error: 'latitude must be between -90 and 90', code: 'INVALID_LAT' });
        return;
      }
      updates.push('latitude = ?');
      params.push(lat);
    }
    if (longitude !== undefined) {
      const lng = parseFloat(String(longitude));
      if (isNaN(lng) || lng < -180 || lng > 180) {
        res.status(400).json({ error: 'longitude must be between -180 and 180', code: 'INVALID_LNG' });
        return;
      }
      updates.push('longitude = ?');
      params.push(lng);
    }
    // Fix 57: Update last_position_update timestamp when coordinates change
    if (latitude !== undefined || longitude !== undefined) {
      updates.push('gps_updated_at = ?');
      params.push(now);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }

    params.push(unit.id);
    db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'status_change', 'unit', ?, ?, ?)
    `).run(req.user!.userId, unit.id, `${unit.call_sign} status: ${status || 'location update'}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT u.*, usr.full_name as officer_name
      FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.id = ?
    `).get(unit.id);

    broadcastUnitUpdate({ action: 'unit_status_changed', unit: updated });

    // Start welfare monitoring when unit goes onscene
    if (status === 'onscene') {
      try {
        const call = unit.current_call_id
          ? db.prepare('SELECT id, call_number, priority FROM calls_for_service WHERE id = ?').get(unit.current_call_id) as any
          : null;
        if (call) startWelfareWatch(req.user!.userId, unit.call_sign, call.id, call.call_number, call.priority);
      } catch { /* non-critical */ }
    }

    // Clear welfare watch when officer goes available/off_duty
    if (['available', 'off_duty', 'out_of_service'].includes(status)) {
      try { clearWelfareWatch(req.user!.userId); } catch { /* non-critical */ }
    }

    res.json(updated);
  } catch (error: any) {
    console.error('[Units] status update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to status update', code: 'UNITS_STATUS_UPDATE_ERROR' });
  }
});

// PUT /api/dispatch/units/:id/mileage — Update unit mileage
router.put('/units/:id/mileage', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unitId = parseInt(req.params.id as string, 10);
    if (isNaN(unitId)) { res.status(400).json({ error: 'Invalid unit ID', code: 'INVALID_UNIT_ID' }); return; }

    const { mileage } = req.body;
    const mileageNum = Number(mileage);
    if (mileage === undefined || !Number.isFinite(mileageNum) || mileageNum < 0) {
      res.status(400).json({ error: 'Valid mileage number required', code: 'VALID_MILEAGE_NUMBER_REQUIRED' }); return;
    }

    const unit = db.prepare('SELECT id FROM units WHERE id = ?').get(unitId);
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    db.prepare('UPDATE units SET mileage = ?, updated_at = ? WHERE id = ?')
      .run(mileageNum, localNow(), unitId);
    const updated = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId);
    if (updated) broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 68: GET /api/dispatch/units/available — List only available units
// ═══════════════════════════════════════════════════════════
router.get('/units/available', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const units = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.status = 'available'
      ORDER BY u.call_sign
      LIMIT 500
    `).all();
    res.json(units);
  } catch (error: any) {
    console.error('[Units] get available units error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get available units', code: 'GET_AVAILABLE_UNITS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 69: GET /api/dispatch/units/workload — Unit workload stats
// ═══════════════════════════════════════════════════════════
router.get('/units/workload', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(90, parseInt(req.query.days as string, 10) || 7));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Upgrade 70: Count calls handled per unit in the time period
    const units = db.prepare(`
      SELECT u.id, u.call_sign, u.status, u.officer_id, usr.full_name as officer_name
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      ORDER BY u.call_sign
      LIMIT 500
    `).all() as any[];

    const workload = units.map((unit: any) => {
      // Count how many calls this unit was assigned to
      const callCount = db.prepare(`
        SELECT COUNT(*) as count
        FROM calls_for_service
        WHERE assigned_unit_ids LIKE ? AND created_at >= ?
      `).get(`%${unit.id}%`, cutoff) as any;

      // Upgrade 71: Average time on scene per call
      const avgOnScene = db.prepare(`
        SELECT ROUND(AVG(onscene_duration_seconds), 0) as avg_seconds
        FROM calls_for_service
        WHERE assigned_unit_ids LIKE ? AND onscene_duration_seconds IS NOT NULL AND created_at >= ?
      `).get(`%${unit.id}%`, cutoff) as any;

      // Upgrade 72: Count of status changes (activity level)
      const statusChanges = db.prepare(`
        SELECT COUNT(*) as count
        FROM activity_log
        WHERE entity_type = 'unit' AND entity_id = ? AND action = 'status_change' AND created_at >= ?
      `).get(unit.id, cutoff) as any;

      return {
        unit_id: unit.id,
        call_sign: unit.call_sign,
        officer_name: unit.officer_name,
        current_status: unit.status,
        calls_handled: callCount?.count || 0,
        avg_onscene_seconds: avgOnScene?.avg_seconds || null,
        status_changes: statusChanges?.count || 0,
      };
    });

    // Upgrade 73: Sort by calls handled descending
    workload.sort((a: any, b: any) => b.calls_handled - a.calls_handled);

    res.json({ period_days: days, units: workload });
  } catch (error: any) {
    console.error('[Units] workload stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get workload stats', code: 'WORKLOAD_STATS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 74: POST /api/dispatch/units/bulk-status — Bulk unit status update
// ═══════════════════════════════════════════════════════════
router.post('/units/bulk-status', requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { unit_ids, status } = req.body;

    if (!unit_ids || !Array.isArray(unit_ids) || unit_ids.length === 0) {
      res.status(400).json({ error: 'unit_ids array is required', code: 'UNITIDS_REQUIRED' });
      return;
    }
    // God Mode: admin bypass
    if (req.user?.role !== 'admin' && unit_ids.length > 50) {
      res.status(400).json({ error: 'Cannot update more than 50 units at once', code: 'TOO_MANY_UNITS' });
      return;
    }

    const VALID_UNIT_STATUSES = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service'];
    if (!status || !VALID_UNIT_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_UNIT_STATUSES.join(', ')}`, code: 'INVALID_STATUS' });
      return;
    }

    const now = localNow();
    let updatedCount = 0;

    const bulkTx = db.transaction(() => {
      for (const unitId of unit_ids) {
        const id = parseInt(String(unitId), 10);
        if (isNaN(id) || id < 1) continue;

        const unit = db.prepare('SELECT id, call_sign FROM units WHERE id = ?').get(id) as any;
        if (!unit) continue;

        // Upgrade 75: Clear current_call_id when going available or off_duty
        if (status === 'available' || status === 'off_duty') {
          db.prepare(`UPDATE units SET status = ?, current_call_id = NULL, last_status_change = ?, updated_at = ? WHERE id = ?`)
            .run(status, now, now, id);
        } else {
          db.prepare(`UPDATE units SET status = ?, last_status_change = ?, updated_at = ? WHERE id = ?`)
            .run(status, now, now, id);
        }
        updatedCount++;
      }

      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'bulk_unit_status', 'unit', 0, ?, ?)`).run(
        req.user!.userId, `Bulk unit status update: ${updatedCount} unit(s) set to ${status}`, req.ip || 'unknown');
    });
    bulkTx();

    // Broadcast unit updates
    for (const unitId of unit_ids) {
      const unitData = db.prepare(`
        SELECT u.*, usr.full_name as officer_name, usr.badge_number
        FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?
      `).get(unitId);
      if (unitData) broadcastUnitUpdate({ action: 'unit_status_changed', unit: unitData });
    }

    res.json({ updated_count: updatedCount, status });
  } catch (error: any) {
    console.error('[Units] bulk status error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to bulk update units', code: 'BULK_UNIT_STATUS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 76: GET /api/dispatch/units/stats — Unit status distribution stats
// ═══════════════════════════════════════════════════════════
router.get('/units/stats', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM units
      GROUP BY status
      ORDER BY count DESC
    `).all();

    const total = db.prepare('SELECT COUNT(*) as count FROM units').get() as any;
    const withOfficer = db.prepare('SELECT COUNT(*) as count FROM units WHERE officer_id IS NOT NULL').get() as any;
    const withGps = db.prepare('SELECT COUNT(*) as count FROM units WHERE latitude IS NOT NULL AND longitude IS NOT NULL').get() as any;
    const onCall = db.prepare('SELECT COUNT(*) as count FROM units WHERE current_call_id IS NOT NULL').get() as any;

    // Upgrade 77: Average time since last status change
    const avgIdleMinutes = db.prepare(`
      SELECT ROUND(AVG((julianday('now', 'localtime') - julianday(last_status_change)) * 24 * 60), 1) as avg_min
      FROM units
      WHERE status = 'available' AND last_status_change IS NOT NULL
    `).get() as any;

    res.json({
      total: total?.count || 0,
      by_status: byStatus,
      with_officer: withOfficer?.count || 0,
      with_gps: withGps?.count || 0,
      on_call: onCall?.count || 0,
      avg_available_idle_minutes: avgIdleMinutes?.avg_min || null,
    });
  } catch (error: any) {
    console.error('[Units] stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get unit stats', code: 'UNIT_STATS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 78: GET /api/dispatch/units/:id/history — Unit activity history
// ═══════════════════════════════════════════════════════════
router.get('/units/:id/history', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unitId = parseInt(req.params.id as string, 10);

    const unit = db.prepare('SELECT id, call_sign FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' });
      return;
    }

    const days = Math.max(1, Math.min(90, parseInt(req.query.days as string, 10) || 7));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Upgrade 79: Activity log entries for this unit
    const activities = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'unit' AND al.entity_id = ? AND al.created_at >= ?
      ORDER BY al.created_at DESC
      LIMIT 200
    `).all(unitId, cutoff);

    // Upgrade 80: Calls this unit was assigned to
    const calls = db.prepare(`
      SELECT id, call_number, incident_type, priority, status, location_address,
        created_at, cleared_at, response_time_seconds
      FROM calls_for_service
      WHERE assigned_unit_ids LIKE ? AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(`%${unitId}%`, cutoff);

    res.json({
      unit: { id: unit.id, call_sign: unit.call_sign },
      period_days: days,
      activities,
      calls_assigned: calls,
    });
  } catch (error: any) {
    console.error('[Units] history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get unit history', code: 'UNIT_HISTORY_ERROR' });
  }
});

// ────────────────────────────────────────────────────────────
// Upgrades 21–35: Extended unit endpoints
// ────────────────────────────────────────────────────────────

// Upgrade 22: GET /units/fatigue-monitor — Fatigue alerts for long-duty or high-call officers
router.get('/units/fatigue-monitor', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const todayStart = localNow().slice(0, 10) + ' 00:00:00';
    const units = db.prepare(`
      SELECT u.id, u.call_sign, usr.full_name AS officer_name, u.status,
        u.last_status_change,
        (SELECT MIN(al.created_at) FROM activity_log al
         WHERE al.entity_type = 'unit' AND al.entity_id = u.id AND al.created_at >= ?) AS first_activity_today,
        (SELECT COUNT(*) FROM calls_for_service
         WHERE assigned_unit_ids LIKE '%' || CAST(u.id AS TEXT) || '%'
           AND created_at >= ?) AS calls_today
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.status NOT IN ('off_duty')
    `).all(todayStart, todayStart) as any[];

    const now = new Date(localNow()).getTime();
    const alerts = units
      .map(u => {
        const firstActivity = u.first_activity_today ? new Date(u.first_activity_today).getTime() : null;
        const hoursOnDuty = firstActivity ? (now - firstActivity) / 3600000 : 0;
        const callsToday = u.calls_today || 0;
        let alert_level: 'none' | 'warning' | 'critical' = 'none';
        if (hoursOnDuty > 12 || callsToday > 8) alert_level = 'critical';
        else if (hoursOnDuty > 10 || callsToday > 5) alert_level = 'warning';
        return { ...u, hours_on_duty: Math.round(hoursOnDuty * 10) / 10, alert_level };
      })
      .filter(u => u.alert_level !== 'none');

    res.json(alerts);
  } catch (error: any) {
    console.error('[Units] fatigue-monitor error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get fatigue monitor', code: 'UNIT_FATIGUE_ERROR' });
  }
});

// Upgrade 23: POST /units/:id/capabilities — Update unit capabilities
router.post('/units/:id/capabilities', validateParamIdMiddleware, requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    const { capabilities } = req.body;
    if (!Array.isArray(capabilities)) {
      res.status(400).json({ error: 'capabilities must be an array', code: 'INVALID_CAPABILITIES' });
      return;
    }

    const oldCaps = unit.capabilities;
    const newCaps = JSON.stringify(capabilities);
    db.prepare('UPDATE units SET capabilities = ?, updated_at = ? WHERE id = ?').run(newCaps, localNow(), req.params.id);
    auditLog(req, 'UPDATE_CAPABILITIES', 'unit', Number(req.params.id), { capabilities: oldCaps }, { capabilities: newCaps });

    const updated = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);
    broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('[Units] update capabilities error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update capabilities', code: 'UNIT_CAPABILITIES_ERROR' });
  }
});

// Upgrade 24: GET /units/by-capability — Find units by capability
router.get('/units/by-capability', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const capability = req.query.capability as string;
    if (!capability) {
      res.status(400).json({ error: 'capability query parameter required', code: 'MISSING_CAPABILITY' });
      return;
    }

    // Sanitize capability to prevent LIKE injection via embedded quotes
    const safeCap = String(capability).replace(/["%_\\]/g, '');
    if (!safeCap) {
      res.status(400).json({ error: 'invalid capability value', code: 'INVALID_CAPABILITY' });
      return;
    }

    const units = db.prepare(`
      SELECT u.*, usr.full_name AS officer_name
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.capabilities LIKE ?
      ORDER BY u.call_sign
    `).all(`%"${safeCap}"%`);
    res.json(units);
  } catch (error: any) {
    console.error('[Units] by-capability error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get units by capability', code: 'UNIT_BY_CAPABILITY_ERROR' });
  }
});

// Upgrade 25: GET /units/:id/activity-log — Recent activity log entries for a unit
router.get('/units/:id/activity-log', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT id FROM units WHERE id = ?').get(req.params.id);
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    const entries = db.prepare(`
      SELECT al.*, usr.full_name AS user_name
      FROM activity_log al
      LEFT JOIN users usr ON al.user_id = usr.id
      WHERE al.entity_type = 'unit' AND al.entity_id = ?
      ORDER BY al.created_at DESC
      LIMIT 50
    `).all(req.params.id);
    res.json(entries);
  } catch (error: any) {
    console.error('[Units] activity-log error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get activity log', code: 'UNIT_ACTIVITY_LOG_ERROR' });
  }
});

// Upgrade 26: POST /units/:id/welfare-check — Log a welfare check for a unit
router.post('/units/:id/welfare-check', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    const { notes } = req.body;
    const details = `Welfare check on unit ${unit.call_sign}${notes ? ': ' + notes : ''}`;

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'welfare_check', 'unit', ?, ?, ?, ?)`).run(
      req.user!.userId, req.params.id, details, req.ip || 'unknown', localNow());

    broadcastUnitUpdate({ action: 'welfare_check', unit_id: Number(req.params.id), call_sign: unit.call_sign, notes: notes || null });
    res.json({ success: true, message: `Welfare check logged for ${unit.call_sign}` });
  } catch (error: any) {
    console.error('[Units] welfare-check error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to log welfare check', code: 'UNIT_WELFARE_CHECK_ERROR' });
  }
});

// Upgrade 27: GET /units/coverage-map — Beat coverage by available units
router.get('/units/coverage-map', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const beats = db.prepare('SELECT id, beat_code, beat_name FROM dispatch_beats ORDER BY beat_code').all() as any[];
    const assignedBeats = db.prepare(`
      SELECT DISTINCT assigned_beat_id FROM units
      WHERE assigned_beat_id IS NOT NULL AND status IN ('available', 'dispatched', 'enroute', 'onscene', 'busy')
    `).all() as any[];
    const coveredBeatIds = new Set(assignedBeats.map(r => r.assigned_beat_id));

    const coverage = beats.map(b => ({
      beat_id: b.id,
      beat_code: b.beat_code,
      beat_name: b.beat_name,
      has_coverage: coveredBeatIds.has(b.id),
    }));
    res.json(coverage);
  } catch (error: any) {
    console.error('[Units] coverage-map error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get coverage map', code: 'UNIT_COVERAGE_MAP_ERROR' });
  }
});

// Upgrade 28: POST /units/:id/break — Put unit on break
router.post('/units/:id/break', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }
    if (unit.status === 'off_duty') {
      res.status(400).json({ error: 'Cannot put an off-duty unit on break', code: 'UNIT_OFF_DUTY' });
      return;
    }

    const now = localNow();
    const { expected_return_minutes } = req.body;
    db.prepare('UPDATE units SET status = ?, last_status_change = ?, updated_at = ? WHERE id = ?')
      .run('busy', now, now, req.params.id);

    const details = `Break started${expected_return_minutes ? ` (expected ${expected_return_minutes} min)` : ''}`;
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'break_start', 'unit', ?, ?, ?, ?)`).run(
      req.user!.userId, req.params.id, details, req.ip || 'unknown', now);

    const updated = db.prepare('SELECT u.*, usr.full_name AS officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(req.params.id);
    broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json({ success: true, unit: updated });
  } catch (error: any) {
    console.error('[Units] break error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to start break', code: 'UNIT_BREAK_ERROR' });
  }
});

// Upgrade 29: POST /units/:id/end-break — End unit break
router.post('/units/:id/end-break', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    const now = localNow();
    // Find the most recent break_start to calculate duration
    const breakStart = db.prepare(`
      SELECT created_at FROM activity_log
      WHERE entity_type = 'unit' AND entity_id = ? AND action = 'break_start'
      ORDER BY created_at DESC LIMIT 1
    `).get(req.params.id) as any;

    let breakMinutes = 0;
    if (breakStart) {
      breakMinutes = Math.round((new Date(now).getTime() - new Date(breakStart.created_at).getTime()) / 60000);
    }

    db.prepare('UPDATE units SET status = ?, last_status_change = ?, updated_at = ? WHERE id = ?')
      .run('available', now, now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'break_end', 'unit', ?, ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Break ended (${breakMinutes} min)`, req.ip || 'unknown', now);

    const updated = db.prepare('SELECT u.*, usr.full_name AS officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(req.params.id);
    broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json({ success: true, break_duration_minutes: breakMinutes, unit: updated });
  } catch (error: any) {
    console.error('[Units] end-break error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to end break', code: 'UNIT_END_BREAK_ERROR' });
  }
});

// Upgrade 30: GET /units/shift-summary — Shift-level aggregate stats
router.get('/units/shift-summary', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const todayStart = localNow().slice(0, 10) + ' 00:00:00';

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) AS count FROM units GROUP BY status
    `).all() as any[];

    const callStats = db.prepare(`
      SELECT COUNT(*) AS total_calls,
        COALESCE(AVG(response_time_seconds), 0) AS avg_response_time
      FROM calls_for_service
      WHERE created_at >= ?
    `).get(todayStart) as any;

    res.json({
      units_by_status: statusCounts.reduce((acc: any, r: any) => { acc[r.status] = r.count; return acc; }, {}),
      total_calls_today: callStats.total_calls,
      avg_response_time_seconds: Math.round(callStats.avg_response_time),
    });
  } catch (error: any) {
    console.error('[Units] shift-summary error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get shift summary', code: 'UNIT_SHIFT_SUMMARY_ERROR' });
  }
});

// Upgrade 31: POST /units/:id/out-of-service — Mark unit out of service
router.post('/units/:id/out-of-service', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    const { reason } = req.body;
    if (!reason || !String(reason).trim()) {
      res.status(400).json({ error: 'reason is required', code: 'MISSING_REASON' });
      return;
    }

    const now = localNow();
    const oldStatus = unit.status;
    db.prepare('UPDATE units SET status = ?, last_status_change = ?, updated_at = ? WHERE id = ?')
      .run('out_of_service', now, now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'out_of_service', 'unit', ?, ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Out of service: ${String(reason).trim()}`, req.ip || 'unknown', now);

    auditLog(req, 'OUT_OF_SERVICE', 'unit', Number(req.params.id), { status: oldStatus }, { status: 'out_of_service', reason: String(reason).trim() });

    const updated = db.prepare('SELECT u.*, usr.full_name AS officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(req.params.id);
    broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json({ success: true, unit: updated });
  } catch (error: any) {
    console.error('[Units] out-of-service error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to mark out of service', code: 'UNIT_OOS_ERROR' });
  }
});

// Upgrade 32: GET /units/:id/gps-trail — Last N GPS breadcrumbs for a unit
router.get('/units/:id/gps-trail', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT id FROM units WHERE id = ?').get(req.params.id);
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 1000);
    const breadcrumbs = db.prepare(`
      SELECT id, latitude, longitude, accuracy, heading, speed, unit_status,
        call_sign, officer_name, current_call_number, recorded_at
      FROM gps_breadcrumbs
      WHERE unit_id = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `).all(req.params.id, limit);
    res.json(breadcrumbs);
  } catch (error: any) {
    console.error('[Units] gps-trail error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get GPS trail', code: 'UNIT_GPS_TRAIL_ERROR' });
  }
});

// Upgrade 33: POST /units/:id/assign-beat — Assign a beat to a unit
router.post('/units/:id/assign-beat', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    const { beat_id } = req.body;
    if (beat_id !== null && beat_id !== undefined) {
      const beat = db.prepare('SELECT id, beat_code FROM dispatch_beats WHERE id = ?').get(beat_id);
      if (!beat) { res.status(404).json({ error: 'Beat not found', code: 'BEAT_NOT_FOUND' }); return; }
    }

    const oldBeatId = unit.assigned_beat_id;
    db.prepare('UPDATE units SET assigned_beat_id = ?, updated_at = ? WHERE id = ?')
      .run(beat_id ?? null, localNow(), req.params.id);

    auditLog(req, 'ASSIGN_BEAT', 'unit', Number(req.params.id), { assigned_beat_id: oldBeatId }, { assigned_beat_id: beat_id ?? null });

    const updated = db.prepare('SELECT u.*, usr.full_name AS officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(req.params.id);
    broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json({ success: true, unit: updated });
  } catch (error: any) {
    console.error('[Units] assign-beat error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to assign beat', code: 'UNIT_ASSIGN_BEAT_ERROR' });
  }
});

// Upgrade 34: GET /units/nearest — Find nearest available units by GPS
router.get('/units/nearest', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: 'lat and lng query parameters required', code: 'MISSING_COORDINATES' });
      return;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 5, 1), 50);

    // Haversine approximation using SQLite math — good enough for dispatch distances
    const units = db.prepare(`
      SELECT u.id, u.call_sign, u.status, u.latitude, u.longitude,
        usr.full_name AS officer_name,
        (
          3959 * 2 * ATAN2(
            SQRT(
              SIN((RADIANS(u.latitude) - RADIANS(?)) / 2) * SIN((RADIANS(u.latitude) - RADIANS(?)) / 2)
              + COS(RADIANS(?)) * COS(RADIANS(u.latitude))
              * SIN((RADIANS(u.longitude) - RADIANS(?)) / 2) * SIN((RADIANS(u.longitude) - RADIANS(?)) / 2)
            ),
            SQRT(1 - (
              SIN((RADIANS(u.latitude) - RADIANS(?)) / 2) * SIN((RADIANS(u.latitude) - RADIANS(?)) / 2)
              + COS(RADIANS(?)) * COS(RADIANS(u.latitude))
              * SIN((RADIANS(u.longitude) - RADIANS(?)) / 2) * SIN((RADIANS(u.longitude) - RADIANS(?)) / 2)
            ))
          )
        ) AS distance_miles
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.status = 'available' AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
      ORDER BY distance_miles ASC
      LIMIT ?
    `).all(lat, lat, lat, lng, lng, lat, lat, lat, lng, lng, limit);
    res.json(units);
  } catch (error: any) {
    console.error('[Units] nearest error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to find nearest units', code: 'UNIT_NEAREST_ERROR' });
  }
});

// Upgrade 35: GET /units/:id/stats — Individual unit statistics
router.get('/units/:id/stats', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT id, call_sign FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) { res.status(404).json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }); return; }

    const todayStart = localNow().slice(0, 10) + ' 00:00:00';
    const weekStart = new Date(new Date(localNow()).getTime() - 7 * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
    const unitIdPattern = `%${req.params.id}%`;

    const callsToday = db.prepare(`
      SELECT COUNT(*) AS count FROM calls_for_service
      WHERE assigned_unit_ids LIKE ? AND created_at >= ?
    `).get(unitIdPattern, todayStart) as any;

    const callsThisWeek = db.prepare(`
      SELECT COUNT(*) AS count FROM calls_for_service
      WHERE assigned_unit_ids LIKE ? AND created_at >= ?
    `).get(unitIdPattern, weekStart) as any;

    const avgResponse = db.prepare(`
      SELECT COALESCE(AVG(response_time_seconds), 0) AS avg_response
      FROM calls_for_service
      WHERE assigned_unit_ids LIKE ? AND created_at >= ? AND response_time_seconds IS NOT NULL
    `).get(unitIdPattern, weekStart) as any;

    // Total GPS distance today (sum of consecutive-point distances)
    const breadcrumbs = db.prepare(`
      SELECT latitude, longitude FROM gps_breadcrumbs
      WHERE unit_id = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
    `).all(req.params.id, todayStart) as any[];

    let totalDistanceMiles = 0;
    for (let i = 1; i < breadcrumbs.length; i++) {
      const prev = breadcrumbs[i - 1];
      const curr = breadcrumbs[i];
      const dLat = (curr.latitude - prev.latitude) * Math.PI / 180;
      const dLng = (curr.longitude - prev.longitude) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos(prev.latitude * Math.PI / 180) * Math.cos(curr.latitude * Math.PI / 180)
        * Math.sin(dLng / 2) ** 2;
      totalDistanceMiles += 3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    res.json({
      unit_id: unit.id,
      call_sign: unit.call_sign,
      calls_today: callsToday.count,
      calls_this_week: callsThisWeek.count,
      avg_response_time_seconds: Math.round(avgResponse.avg_response),
      total_distance_today_miles: Math.round(totalDistanceMiles * 100) / 100,
    });
  } catch (error: any) {
    console.error('[Units] stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get unit stats', code: 'UNIT_STATS_ERROR' });
  }
});

export default router;
