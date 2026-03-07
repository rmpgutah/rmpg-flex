import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate, broadcastUnitUpdate } from '../../utils/websocket';
import { localNow } from '../../utils/timeUtils';

const router = Router();

// POST /api/dispatch/calls/:id/dispatch - Dispatch unit(s) to call
router.post('/calls/:id/dispatch', (req: Request, res: Response) => {
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

    const now = localNow();

    // Merge with existing assigned units
    let currentUnits: number[] = [];
    try {
      currentUnits = JSON.parse(call.assigned_unit_ids || '[]');
    } catch { /* ignore */ }

    const allUnits = [...new Set([...currentUnits, ...unit_ids])];

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

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'units_dispatched', call: updated, unit_ids });

    res.json(updated);
  } catch (error: any) {
    console.error('Dispatch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/assign-unit - Attach a single unit to a call
router.post('/calls/:id/assign-unit', (req: Request, res: Response) => {
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

    // Merge with existing assigned units
    let currentUnits: number[] = [];
    try {
      currentUnits = JSON.parse(call.assigned_unit_ids || '[]');
    } catch { /* ignore */ }

    if (!currentUnits.includes(Number(unit_id))) {
      currentUnits.push(Number(unit_id));
    }

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

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'unit_assigned', call: updated, unit_id });
    broadcastUnitUpdate({ action: 'unit_status_changed', unit: db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(unit_id) });

    res.json(updated);
  } catch (error: any) {
    console.error('Assign unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/unassign-unit - Detach a single unit from a call
router.post('/calls/:id/unassign-unit', (req: Request, res: Response) => {
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

    // Remove unit from assigned_unit_ids
    let currentUnits: number[] = [];
    try {
      currentUnits = JSON.parse(call.assigned_unit_ids || '[]');
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

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'unit_unassigned', call: updated, unit_id });
    broadcastUnitUpdate({ action: 'unit_status_changed', unit: db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(unit_id) });

    res.json(updated);
  } catch (error: any) {
    console.error('Unassign unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/status - Update call status with timestamp
router.post('/calls/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { status, notes, disposition } = req.body;
    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived', 'on_hold'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status', valid: validStatuses });
      return;
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
    updateQuery += ` WHERE id = ?`;
    updateParams.push(call.id);

    db.prepare(updateQuery).run(...updateParams);

    // If cleared, closed, cancelled, or archived, free up units
    if (['cleared', 'closed', 'cancelled', 'archived'].includes(status)) {
      let unitIds: number[] = [];
      try {
        unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      } catch { /* ignore */ }

      for (const unitId of unitIds) {
        db.prepare(`
          UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?
        `).run(now, unitId, call.id);
      }
    }

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'status_change', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} status changed to ${status}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status });

    res.json(updated);
  } catch (error: any) {
    console.error('Status update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/revert-status - Revert call to previous status
router.post('/calls/:id/revert-status', (req: Request, res: Response) => {
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

    db.prepare(updateQuery).run(...updateParams);

    // If reverting from cleared/closed, re-dispatch assigned units
    if (['cleared', 'closed'].includes(call.status)) {
      let unitIds: number[] = [];
      try {
        unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      } catch { /* ignore */ }

      for (const unitId of unitIds) {
        const prevUnitStatus = previousStatus === 'onscene' ? 'onscene' : previousStatus === 'enroute' ? 'enroute' : 'dispatched';
        db.prepare(`
          UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?
        `).run(prevUnitStatus, call.id, now, unitId);
      }
    }

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'status_reverted', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} status reverted from ${call.status} to ${previousStatus}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_status_changed', call: updated, status: previousStatus });

    res.json(updated);
  } catch (error: any) {
    console.error('Revert status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/hold - Put call on hold (saves previous status)
router.post('/calls/:id/hold', (req: Request, res: Response) => {
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
    console.error('Hold call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/resume - Resume a held call (restores previous status)
router.post('/calls/:id/resume', (req: Request, res: Response) => {
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
    console.error('Resume call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/promote-to-incident - Create incident from call
router.post('/calls/:id/promote-to-incident', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    // Generate incident number
    const { generateIncidentNumber } = require('../../utils/caseNumbers');
    const incidentNumber = generateIncidentNumber(db, call.incident_type || 'general');

    const result = db.prepare(`
      INSERT INTO incidents (incident_number, call_id, incident_type, priority, status,
        location_address, property_id, latitude, longitude, narrative, officer_id,
        zone_beat, section_id, zone_id, beat_id, domestic_violence, weapons_involved,
        injuries, created_by)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      incidentNumber,
      call.id,
      call.incident_type || 'general',
      call.priority || 'P3',
      call.location_address || null,
      call.property_id || null,
      call.latitude || null,
      call.longitude || null,
      call.description || null,
      req.user!.userId,
      call.zone_beat || null,
      call.section_id || null,
      call.zone_id || null,
      call.beat_id || null,
      call.domestic_violence || 0,
      call.weapons_involved || 0,
      call.injuries_reported || 0,
      req.user!.userId
    );

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(incident);
  } catch (error: any) {
    console.error('Promote to incident error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/le-notification - Notify external agency
router.post('/calls/:id/le-notification', (req: Request, res: Response) => {
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

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('LE notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
