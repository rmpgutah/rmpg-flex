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
    const { call_sign, officer_id, status } = req.body;
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
      INSERT INTO units (call_sign, officer_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(call_sign, officer_id || null, status || 'off_duty', localNow(), localNow());

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
    if (unit.current_call_id) {
      res.status(400).json({ error: 'Cannot delete a unit that is assigned to an active call. Unassign the unit first.', code: 'CANNOT_DELETE_A_UNIT' });
      return;
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
      const INVALID_TRANSITIONS: Record<string, string[]> = {
        off_duty: ['onscene'], // Can't go from off_duty directly to onscene
        out_of_service: ['onscene', 'enroute'], // Must go available first
      };
      const blocked = INVALID_TRANSITIONS[unit.status];
      if (blocked && blocked.includes(status)) {
        res.status(400).json({
          error: `Cannot transition from '${unit.status}' to '${status}'. Must go through 'available' or 'dispatched' first.`,
          code: 'INVALID_STATUS_TRANSITION',
          current_status: unit.status,
          requested_status: status,
        });
        return;
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
    const unitId = parseInt(req.params.id, 10);
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
    if (unit_ids.length > 50) {
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
    const unitId = parseInt(req.params.id, 10);

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

export default router;
