import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { validateParamId } from '../../middleware/sanitize';
import { broadcastUnitUpdate } from '../../utils/websocket';
import { auditLog } from '../../utils/auditLogger';
import { localNow } from '../../utils/timeUtils';

const router = Router();

// GET /api/dispatch/units - Get all units with current status
router.get('/units', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const units = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone,
        c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      ORDER BY u.call_sign
    `).all();

    res.json(units);
  } catch (error: any) {
    console.error('Get units error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/units/available - Get only available units
router.get('/units/available', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const units = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.status = 'available'
      ORDER BY u.call_sign
    `).all();

    res.json(units);
  } catch (error: any) {
    console.error('Get available units error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/units - Create dispatch unit
router.post('/units', requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_sign, officer_id, status } = req.body;
    if (!call_sign || !String(call_sign).trim()) {
      res.status(400).json({ error: 'call_sign is required' });
      return;
    }

    // Check for duplicate call_sign
    const existing = db.prepare('SELECT id FROM units WHERE call_sign = ?').get(call_sign);
    if (existing) {
      res.status(409).json({ error: 'A unit with this call sign already exists' });
      return;
    }

    // Validate status enum on creation (same list as PUT endpoint)
    const VALID_CREATE_STATUSES = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service'];
    if (status && !VALID_CREATE_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Invalid unit status', valid: VALID_CREATE_STATUSES });
      return;
    }

    const result = db.prepare(`
      INSERT INTO units (call_sign, officer_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(call_sign, officer_id || null, status || 'off_duty', localNow(), localNow());

    const unit = db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(Number(result.lastInsertRowid));
    if (!unit) { res.status(500).json({ error: 'Failed to retrieve created unit' }); return; }

    auditLog(req, 'CREATE', 'unit', Number(result.lastInsertRowid) as number, `Created unit: ${call_sign}`);

    broadcastUnitUpdate({ action: 'unit_created', unit });
    res.status(201).json(unit);
  } catch (error: any) {
    console.error('Create unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/units/:id - Edit unit details (call_sign, officer_id, status, vehicle_id)
router.put('/units/:id', validateParamId, requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const { call_sign, officer_id, status, vehicle_id, capabilities } = req.body;
    const now = localNow();
    const updates: string[] = [];
    const params: any[] = [];

    if (call_sign !== undefined) {
      const trimmed = call_sign.trim();
      if (!trimmed) {
        res.status(400).json({ error: 'call_sign cannot be empty' });
        return;
      }
      // Check uniqueness (exclude self)
      const dup = db.prepare('SELECT id FROM units WHERE call_sign = ? AND id != ?').get(trimmed, req.params.id);
      if (dup) {
        res.status(409).json({ error: 'A unit with this call sign already exists' });
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
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push("updated_at = ?");
    params.push(localNow());
    params.push(req.params.id);
    db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(req.params.id);

    auditLog(req, 'UPDATE', 'unit', parseInt(String(req.params.id), 10), `Updated unit: ${(updated as any)?.call_sign || req.params.id}`);

    if (updated) broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('Update unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/units/:id - Delete a unit
router.delete('/units/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    // Block deletion if unit is assigned to an active call
    if (unit.current_call_id) {
      res.status(400).json({ error: 'Cannot delete a unit that is assigned to an active call. Unassign the unit first.' });
      return;
    }

    db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);

    auditLog(req, 'DELETE', 'unit', parseInt(String(req.params.id), 10), `Deleted unit: ${unit.call_sign}`);

    broadcastUnitUpdate({ action: 'unit_deleted', unit_id: req.params.id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete unit error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/units/:id/status - Update unit status and location
router.put('/units/:id/status', validateParamId, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
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
      const lat = parseFloat(latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        res.status(400).json({ error: 'latitude must be between -90 and 90' });
        return;
      }
      updates.push('latitude = ?');
      params.push(lat);
    }
    if (longitude !== undefined) {
      const lng = parseFloat(longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        res.status(400).json({ error: 'longitude must be between -180 and 180' });
        return;
      }
      updates.push('longitude = ?');
      params.push(lng);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    params.push(unit.id);
    db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    auditLog(req, 'UPDATE', 'unit', unit.id, `${unit.call_sign} status: ${status || 'location update'}`);

    const updated = db.prepare(`
      SELECT u.*, usr.full_name as officer_name
      FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.id = ?
    `).get(unit.id);

    broadcastUnitUpdate({ action: 'unit_status_changed', unit: updated });

    res.json(updated);
  } catch (error: any) {
    console.error('Unit status update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
