import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { broadcastDispatchUpdate, broadcastUnitUpdate, broadcastPanic } from '../utils/websocket';
import { generateIncidentNumber, generateCallNumber } from '../utils/caseNumbers';
import { sendCsv } from '../utils/csvExport';
import { localNow } from '../utils/timeUtils';
import { geocodeCallIfNeeded, reverseGeocodeAddress } from '../utils/geocode';

const router = Router();

// All dispatch routes require authentication
router.use(authenticateToken);

// GET /api/dispatch/calls - List calls with filters
router.get('/calls', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      status,
      priority,
      startDate,
      endDate,
      propertyId,
      archived,
      page = '1',
      limit = '50',
    } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND c.status = ?';
      params.push(status);
    }
    if (priority) {
      whereClause += ' AND c.priority = ?';
      params.push(priority);
    }
    if (startDate) {
      whereClause += ' AND c.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND c.created_at <= ?';
      params.push(endDate);
    }
    if (propertyId) {
      whereClause += ' AND c.property_id = ?';
      params.push(propertyId);
    }

    // Archive filter: exclude archived calls by default, include only when requested
    if (archived === 'true') {
      whereClause += " AND c.status = 'archived'";
    } else if (archived !== 'all') {
      whereClause += " AND c.status != 'archived'";
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM calls_for_service c ${whereClause}`).get(...params) as any;

    const calls = db.prepare(`
      SELECT c.*, p.name as property_name, u.full_name as dispatcher_name,
        cl.name as client_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      ${whereClause}
      ORDER BY
        CASE c.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END,
        c.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({
      data: calls,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Get calls error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls - Create new call for service
// Supports optional historical fields: created_at, status, dispatched_at, enroute_at,
// onscene_at, cleared_at, closed_at, disposition — for entering past records.
router.post('/calls', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      incident_type, priority, caller_name, caller_phone, caller_relationship, caller_address,
      location_address, property_id, latitude, longitude, description, notes, source,
      cross_street, location_building, location_floor, location_room, zone_beat,
      section_id, zone_id, beat_id,
      weapons_involved, injuries_reported, num_subjects, num_victims,
      subject_description, vehicle_description, direction_of_travel,
      scene_safety, weather_conditions, lighting_conditions,
      alcohol_involved, drugs_involved, domestic_violence,
      supervisor_notified, le_notified, le_agency, le_case_number,
      damage_estimate, damage_description, responding_officer, action_taken,
      client_id: requestClientId,
      // Historical entry fields (optional)
      created_at: customCreatedAt,
      status: customStatus,
      dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, archived_at,
      disposition: customDisposition,
    } = req.body;

    if (!incident_type || !priority || !location_address) {
      res.status(400).json({ error: 'incident_type, priority, and location_address are required' });
      return;
    }

    // Normalize priority to uppercase to match CHECK constraint (P1, P2, P3, P4)
    const normalizedPriority = String(priority).toUpperCase();

    // Generate call number: CFS-YYYY-NNNNN
    const callNumber = generateCallNumber(db);

    // Determine status — allow historical entries to set any valid status
    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
    const status = customStatus && validStatuses.includes(customStatus) ? customStatus : 'pending';

    // Auto-resolve client_id from property if not provided
    let resolvedClientId = requestClientId || null;
    if (!resolvedClientId && property_id) {
      const prop = db.prepare('SELECT client_id FROM properties WHERE id = ?').get(property_id) as any;
      if (prop) resolvedClientId = prop.client_id;
    }

    const result = db.prepare(`
      INSERT INTO calls_for_service (call_number, incident_type, priority, status, caller_name, caller_phone,
        caller_relationship, caller_address, location_address, property_id, latitude, longitude, description, notes, source, dispatcher_id,
        cross_street, location_building, location_floor, location_room, zone_beat,
        section_id, zone_id, beat_id,
        weapons_involved, injuries_reported, num_subjects, num_victims,
        subject_description, vehicle_description, direction_of_travel,
        scene_safety, weather_conditions, lighting_conditions,
        alcohol_involved, drugs_involved, domestic_violence,
        supervisor_notified, le_notified, le_agency, le_case_number,
        damage_estimate, damage_description, responding_officer, action_taken,
        client_id,
        created_at, dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, archived_at, disposition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?,
              COALESCE(?, ?), ?, ?, ?, ?, ?, ?, ?)
    `).run(
      callNumber, incident_type, normalizedPriority, status, caller_name || null, caller_phone || null,
      caller_relationship || null, caller_address || null, location_address, property_id || null,
      latitude || null, longitude || null, description || null, notes || null,
      source || 'phone', req.user!.userId,
      cross_street || null, location_building || null, location_floor || null, location_room || null, zone_beat || null,
      section_id || null, zone_id || null, beat_id || null,
      weapons_involved || null, injuries_reported ? 1 : 0, num_subjects || null, num_victims || null,
      subject_description || null, vehicle_description || null, direction_of_travel || null,
      scene_safety || null, weather_conditions || null, lighting_conditions || null,
      alcohol_involved ? 1 : 0, drugs_involved ? 1 : 0, domestic_violence ? 1 : 0,
      supervisor_notified ? 1 : 0, le_notified ? 1 : 0, le_agency || null, le_case_number || null,
      damage_estimate || null, damage_description || null, responding_officer || null, action_taken || null,
      resolvedClientId,
      // Historical timestamps
      customCreatedAt || null,
      localNow(),
      dispatched_at || null, enroute_at || null, onscene_at || null,
      cleared_at || null, closed_at || null, archived_at || null,
      customDisposition || null,
    );

    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(result.lastInsertRowid) as any;

    // Log activity
    const isHistorical = !!customCreatedAt;
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_created', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${isHistorical ? 'Historical entry: ' : 'Created '}${callNumber}: ${incident_type}`, req.ip || 'unknown');

    // If no coordinates were provided, geocode the address asynchronously
    geocodeCallIfNeeded(call.id, location_address, latitude, longitude);

    // Broadcast to dispatch channel
    broadcastDispatchUpdate({ action: 'call_created', call });

    res.status(201).json(call);
  } catch (error: any) {
    console.error('Create call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/export - Export calls as CSV
router.get('/calls/export', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, priority, startDate, endDate } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND c.status = ?';
      params.push(status);
    }
    if (priority) {
      whereClause += ' AND c.priority = ?';
      params.push(priority);
    }
    if (startDate) {
      whereClause += ' AND c.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND c.created_at <= ?';
      params.push(endDate);
    }

    const rows = db.prepare(`
      SELECT c.call_number, c.incident_type, c.priority, c.status, c.caller_name,
        c.location_address, c.description, c.source, c.disposition, c.created_at, c.cleared_at
      FROM calls_for_service c
      ${whereClause}
      ORDER BY c.created_at DESC
    `).all(...params);

    sendCsv(res, 'calls_export.csv', [
      { key: 'call_number', header: 'Call Number' },
      { key: 'incident_type', header: 'Incident Type' },
      { key: 'priority', header: 'Priority' },
      { key: 'status', header: 'Status' },
      { key: 'caller_name', header: 'Caller Name' },
      { key: 'location_address', header: 'Location Address' },
      { key: 'description', header: 'Description' },
      { key: 'source', header: 'Source' },
      { key: 'disposition', header: 'Disposition' },
      { key: 'created_at', header: 'Created At' },
      { key: 'cleared_at', header: 'Cleared At' },
    ], rows);
  } catch (error: any) {
    console.error('Export calls error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/:id - Get single call with details
router.get('/calls/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare(`
      SELECT c.*, p.name as property_name, p.address as property_address,
        p.gate_code, p.alarm_code, p.emergency_contact, p.post_orders, p.hazard_notes,
        u.full_name as dispatcher_name,
        cl.name as client_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      WHERE c.id = ?
    `).get(req.params.id) as any;

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    // Get assigned units with officer info
    let assignedUnits: any[] = [];
    try {
      const unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      if (unitIds.length > 0) {
        const placeholders = unitIds.map(() => '?').join(',');
        assignedUnits = db.prepare(`
          SELECT u.*, usr.full_name as officer_name, usr.badge_number
          FROM units u
          LEFT JOIN users usr ON u.officer_id = usr.id
          WHERE u.id IN (${placeholders})
        `).all(...unitIds);
      }
    } catch { /* ignore parse errors */ }

    // Get related incidents
    const incidents = db.prepare(`
      SELECT id, incident_number, incident_type, status, created_at
      FROM incidents WHERE call_id = ?
    `).all(call.id);

    // Get activity log for this call
    const activity = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'call' AND al.entity_id = ?
      ORDER BY al.created_at DESC
    `).all(call.id);

    res.json({
      ...call,
      assigned_units: assignedUnits,
      related_incidents: incidents,
      activity,
    });
  } catch (error: any) {
    console.error('Get call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/calls/:id - Update call
router.put('/calls/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const {
      incident_type, priority, status, caller_name, caller_phone, caller_relationship,
      location_address, property_id, latitude, longitude, description, notes, disposition,
      cross_street, location_building, location_floor, location_room,
      weapons_involved, injuries_reported, num_subjects,
      subject_description, vehicle_description, direction_of_travel,
      source, caller_address, zone_beat, section_id, zone_id, beat_id, responding_officer, secondary_type,
      contact_method, scene_safety, weather_conditions, lighting_conditions,
      num_victims, alcohol_involved, drugs_involved, domestic_violence,
      supervisor_notified, le_notified, le_agency, le_case_number,
      damage_estimate, damage_description, action_taken,
      client_id: updateClientId,
    } = req.body;

    // Auto-resolve client_id from property if property changes
    let resolvedUpdateClientId = updateClientId;
    if (resolvedUpdateClientId === undefined && property_id !== undefined && property_id) {
      const prop = db.prepare('SELECT client_id FROM properties WHERE id = ?').get(property_id) as any;
      if (prop) resolvedUpdateClientId = prop.client_id;
    }

    // Build dynamic SET clause so we only update provided fields
    const updates: string[] = [];
    const params: any[] = [];
    const addField = (col: string, val: any) => {
      if (val !== undefined) { updates.push(`${col} = ?`); params.push(val === '' ? null : val); }
    };

    addField('incident_type', incident_type);
    addField('priority', priority);
    addField('status', status);
    addField('caller_name', caller_name);
    addField('caller_phone', caller_phone);
    addField('caller_relationship', caller_relationship);
    addField('location_address', location_address);
    addField('property_id', property_id);
    addField('latitude', latitude);
    addField('longitude', longitude);
    addField('description', description);
    addField('notes', notes);
    addField('disposition', disposition);
    addField('cross_street', cross_street);
    addField('location_building', location_building);
    addField('location_floor', location_floor);
    addField('location_room', location_room);
    addField('weapons_involved', weapons_involved);
    addField('injuries_reported', injuries_reported !== undefined ? (injuries_reported ? 1 : 0) : undefined);
    addField('num_subjects', num_subjects);
    addField('subject_description', subject_description);
    addField('vehicle_description', vehicle_description);
    addField('direction_of_travel', direction_of_travel);
    addField('source', source);
    addField('caller_address', caller_address);
    addField('zone_beat', zone_beat);
    addField('section_id', section_id);
    addField('zone_id', zone_id);
    addField('beat_id', beat_id);
    addField('responding_officer', responding_officer);
    addField('secondary_type', secondary_type);
    addField('contact_method', contact_method);
    addField('scene_safety', scene_safety);
    addField('weather_conditions', weather_conditions);
    addField('lighting_conditions', lighting_conditions);
    addField('num_victims', num_victims);
    addField('alcohol_involved', alcohol_involved !== undefined ? (alcohol_involved ? 1 : 0) : undefined);
    addField('drugs_involved', drugs_involved !== undefined ? (drugs_involved ? 1 : 0) : undefined);
    addField('domestic_violence', domestic_violence !== undefined ? (domestic_violence ? 1 : 0) : undefined);
    addField('supervisor_notified', supervisor_notified !== undefined ? (supervisor_notified ? 1 : 0) : undefined);
    addField('le_notified', le_notified !== undefined ? (le_notified ? 1 : 0) : undefined);
    addField('le_agency', le_agency);
    addField('le_case_number', le_case_number);
    addField('damage_estimate', damage_estimate);
    addField('damage_description', damage_description);
    addField('action_taken', action_taken);
    addField('client_id', resolvedUpdateClientId);

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(localNow());
    params.push(req.params.id);
    db.prepare(`UPDATE calls_for_service SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Activity log for call update
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_updated', 'call', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated call ${call.call_number}: ${updates.map(u => u.split(' = ')[0]).join(', ')}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;

    // If location changed but no coordinates provided, geocode asynchronously
    if (location_address && !latitude && !longitude) {
      geocodeCallIfNeeded(updated.id, location_address, updated.latitude, updated.longitude);
    }

    broadcastDispatchUpdate({ action: 'call_updated', call: updated });

    res.json(updated);
  } catch (error: any) {
    console.error('Update call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
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

// GET /api/dispatch/units - Get all units with current status
router.get('/units', (req: Request, res: Response) => {
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
    console.error('Get units error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/units - Create dispatch unit
router.post('/units', requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_sign, officer_id, status } = req.body;
    if (!call_sign) {
      res.status(400).json({ error: 'call_sign is required' });
      return;
    }

    // Check for duplicate call_sign
    const existing = db.prepare('SELECT id FROM units WHERE call_sign = ?').get(call_sign);
    if (existing) {
      res.status(409).json({ error: 'A unit with this call sign already exists' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO units (call_sign, officer_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(call_sign, officer_id || null, status || 'off_duty', localNow(), localNow());

    const unit = db.prepare('SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.id = ?').get(result.lastInsertRowid);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_created', 'unit', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid, `Created unit: ${call_sign}`, req.ip || 'unknown');

    broadcastUnitUpdate({ action: 'unit_created', unit });
    res.status(201).json(unit);
  } catch (error: any) {
    console.error('Create unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/units/:id - Edit unit details (call_sign, officer_id, status, vehicle_id)
router.put('/units/:id', requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
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

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_updated', 'unit', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Updated unit: ${(updated as any)?.call_sign || req.params.id}`, req.ip || 'unknown');

    broadcastUnitUpdate({ action: 'unit_updated', unit: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('Update unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/units/:id - Delete a unit
router.delete('/units/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
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

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'unit_deleted', 'unit', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `Deleted unit: ${unit.call_sign}`, req.ip || 'unknown');

    broadcastUnitUpdate({ action: 'unit_deleted', unit_id: req.params.id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dispatch/units/:id/status - Update unit status and location
router.put('/units/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    const { status, latitude, longitude } = req.body;
    const now = localNow();

    const updates: string[] = [];
    const params: any[] = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);
      updates.push('last_status_change = ?');
      params.push(now);
    }
    if (latitude !== undefined) {
      updates.push('latitude = ?');
      params.push(latitude);
    }
    if (longitude !== undefined) {
      updates.push('longitude = ?');
      params.push(longitude);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    params.push(unit.id);
    db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // If unit going available, clear current call
    if (status === 'available' || status === 'off_duty') {
      db.prepare('UPDATE units SET current_call_id = NULL WHERE id = ?').run(unit.id);
    }

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

    res.json(updated);
  } catch (error: any) {
    console.error('Unit status update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/gps - Lightweight GPS position ping from officer
// Updates the unit assigned to the current user (no status change, no activity log for performance)
router.post('/gps', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { latitude, longitude, accuracy, heading, speed } = req.body;

    if (latitude == null || longitude == null) {
      res.status(400).json({ error: 'latitude and longitude are required' });
      return;
    }

    // Find unit assigned to current user
    const unit = db.prepare('SELECT id, call_sign, status FROM units WHERE officer_id = ?').get(req.user!.userId) as any;
    if (!unit) {
      res.status(404).json({ error: 'No unit assigned to current user' });
      return;
    }

    // Only update GPS for active units (not off_duty)
    if (unit.status === 'off_duty') {
      res.json({ ok: true, skipped: true, reason: 'off_duty' });
      return;
    }

    db.prepare(`
      UPDATE units SET latitude = ?, longitude = ?
      WHERE id = ?
    `).run(latitude, longitude, unit.id);

    // Broadcast position update to all connected clients
    const updated = db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number,
        c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      WHERE u.id = ?
    `).get(unit.id) as any;

    // Record breadcrumb with full snapshot of unit state at this moment
    db.prepare(`
      INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number, current_call_id, current_call_number, current_call_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      unit.id, req.user!.userId, latitude, longitude,
      accuracy ?? null, heading ?? null, speed ?? null,
      updated?.status ?? unit.status, updated?.call_sign ?? unit.call_sign,
      updated?.officer_name ?? null, updated?.badge_number ?? null,
      updated?.current_call_id ?? null, updated?.call_number ?? null, updated?.current_call_type ?? null,
    );

    broadcastUnitUpdate({ action: 'unit_position_update', unit: updated });

    res.json({ ok: true, unit_id: unit.id, call_sign: unit.call_sign });
  } catch (error: any) {
    console.error('GPS update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/gps/my-unit - Get current user's assigned unit
router.get('/gps/my-unit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unit = db.prepare(`
      SELECT u.id, u.call_sign, u.status, u.latitude, u.longitude
      FROM units u WHERE u.officer_id = ?
    `).get(req.user!.userId) as any;

    res.json(unit || null);
  } catch (error: any) {
    console.error('Get my unit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/gps/trail/:unitId - Get GPS breadcrumb trail for a unit
router.get('/gps/trail/:unitId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unitId = parseInt(req.params.unitId);
    const hours = parseInt(req.query.hours as string) || 8;

    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();

    const trail = db.prepare(`
      SELECT latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number,
        current_call_id, current_call_number, current_call_type,
        recorded_at
      FROM gps_breadcrumbs
      WHERE unit_id = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
    `).all(unitId, cutoff);

    res.json(trail);
  } catch (error: any) {
    console.error('GPS trail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/gps/trails - Get breadcrumb trails for all active units
router.get('/gps/trails', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = parseInt(req.query.hours as string) || 8;

    // Use SQLite's datetime() for the cutoff so the format matches
    // recorded_at's DEFAULT (datetime('now','localtime') → "YYYY-MM-DD HH:MM:SS").
    // Using JS toISOString() produced "YYYY-MM-DDTHH:MM:SS.sssZ" which always
    // compared > the space-separated stored format, returning zero results.
    const rows = db.prepare(`
      SELECT b.unit_id, b.call_sign, b.latitude, b.longitude, b.accuracy,
        b.heading, b.speed, b.unit_status, b.officer_name, b.badge_number,
        b.current_call_number, b.current_call_type, b.recorded_at
      FROM gps_breadcrumbs b
      JOIN units u ON b.unit_id = u.id
      WHERE b.recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY b.unit_id, b.recorded_at ASC
    `).all(hours) as any[];

    // Group by unit
    const trails: Record<number, { unit_id: number; call_sign: string; officer_name: string; badge_number: string; points: any[] }> = {};
    for (const row of rows) {
      if (!trails[row.unit_id]) {
        trails[row.unit_id] = {
          unit_id: row.unit_id,
          call_sign: row.call_sign,
          officer_name: row.officer_name || '',
          badge_number: row.badge_number || '',
          points: [],
        };
      }
      trails[row.unit_id].points.push({
        lat: row.latitude,
        lng: row.longitude,
        accuracy: row.accuracy,
        heading: row.heading,
        speed: row.speed,
        status: row.unit_status,
        call_number: row.current_call_number,
        call_type: row.current_call_type,
        time: row.recorded_at,
      });
    }

    res.json(Object.values(trails));
  } catch (error: any) {
    console.error('GPS trails error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/gps/breadcrumbs/cleanup - Purge old breadcrumb data
router.delete('/gps/breadcrumbs/cleanup', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 7;

    // Use SQLite datetime() to match the stored format (datetime('now','localtime'))
    const result = db.prepare(
      `DELETE FROM gps_breadcrumbs WHERE recorded_at < datetime('now', 'localtime', '-' || ? || ' days')`
    ).run(days);
    res.json({ deleted: result.changes });
  } catch (error: any) {
    console.error('Breadcrumb cleanup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/heatmap - Aggregated call locations for heat map display
router.get('/heatmap', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 30;

    // Use SQLite datetime() for consistent format comparison
    const points = db.prepare(`
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        COUNT(*) as count
      FROM calls_for_service
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', '-' || ? || ' days')
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      ORDER BY count DESC
      LIMIT 200
    `).all(days);

    res.json(points);
  } catch (error: any) {
    console.error('Heatmap error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/queue - Active dispatch queue
router.get('/queue', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const calls = db.prepare(`
      SELECT c.*, p.name as property_name, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.status IN ('pending', 'dispatched', 'enroute', 'onscene')
      ORDER BY
        CASE c.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END,
        c.created_at ASC
    `).all();

    res.json(calls);
  } catch (error: any) {
    console.error('Get queue error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/stats - Current dispatch statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const callsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now')
      GROUP BY status
    `).all();

    const callsByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now')
      GROUP BY priority
    `).all();

    const unitsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM units GROUP BY status
    `).all();

    const activeCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene')
    `).get() as any;

    const todayTotal = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now')
    `).get() as any;

    const avgResponseTime = db.prepare(`
      SELECT AVG(
        (julianday(onscene_at) - julianday(created_at)) * 24 * 60
      ) as avg_minutes
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now')
    `).get() as any;

    res.json({
      activeCalls: activeCalls.count,
      todayTotal: todayTotal.count,
      avgResponseMinutes: avgResponseTime.avg_minutes ? Math.round(avgResponseTime.avg_minutes * 10) / 10 : null,
      callsByStatus,
      callsByPriority,
      unitsByStatus,
    });
  } catch (error: any) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/generate-incident - Generate incident report from a cleared/closed call
router.post('/calls/:id/generate-incident', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare(`
      SELECT c.*, p.name as property_name, p.address as property_address
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.id = ?
    `).get(req.params.id) as any;

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (!['cleared', 'closed'].includes(call.status)) {
      res.status(400).json({ error: 'Can only generate incident reports from cleared or closed calls' });
      return;
    }

    // Check if incident already exists for this call
    const existingIncident = db.prepare('SELECT id, incident_number FROM incidents WHERE call_id = ?').get(call.id) as any;
    if (existingIncident) {
      res.status(409).json({
        error: 'An incident report already exists for this call',
        incident_id: existingIncident.id,
        incident_number: existingIncident.incident_number
      });
      return;
    }

    // Generate incident number: RMP-YY-NNNNN-CODE
    const incidentNumber = generateIncidentNumber(db, call.incident_type);

    // Build narrative template from call data
    const narrativeParts: string[] = [];
    narrativeParts.push(`Incident generated from dispatch call ${call.call_number}.`);
    narrativeParts.push(`\nCall Type: ${(call.incident_type || '').replace(/_/g, ' ').toUpperCase()}`);
    narrativeParts.push(`Priority: ${call.priority}`);
    narrativeParts.push(`Location: ${call.location_address || 'Unknown'}`);
    if (call.property_name) narrativeParts.push(`Property: ${call.property_name}`);
    if (call.caller_name) narrativeParts.push(`Caller: ${call.caller_name}${call.caller_phone ? ` (${call.caller_phone})` : ''}`);
    if (call.description) narrativeParts.push(`\nCall Description: ${call.description}`);
    if (call.disposition) narrativeParts.push(`Disposition: ${call.disposition}`);
    narrativeParts.push(`\nCall Timeline:`);
    if (call.created_at) narrativeParts.push(`  Created: ${call.created_at}`);
    if (call.dispatched_at) narrativeParts.push(`  Dispatched: ${call.dispatched_at}`);
    if (call.enroute_at) narrativeParts.push(`  En Route: ${call.enroute_at}`);
    if (call.onscene_at) narrativeParts.push(`  On Scene: ${call.onscene_at}`);
    if (call.cleared_at) narrativeParts.push(`  Cleared: ${call.cleared_at}`);
    narrativeParts.push(`\n--- Officer narrative below ---\n`);

    const narrative = narrativeParts.join('\n');

    const result = db.prepare(`
      INSERT INTO incidents (incident_number, call_id, incident_type, priority, status, location_address,
        property_id, latitude, longitude, narrative, officer_id)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
    `).run(
      incidentNumber, call.id, call.incident_type, call.priority,
      call.location_address || call.property_address || null,
      call.property_id || null, call.latitude || null, call.longitude || null,
      narrative, req.user!.userId
    );

    const incident = db.prepare(`
      SELECT i.*, o.full_name as officer_name, o.badge_number, c.call_number
      FROM incidents i
      LEFT JOIN users o ON i.officer_id = o.id
      LEFT JOIN calls_for_service c ON i.call_id = c.id
      WHERE i.id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_created', 'incident', ?, ?, ?)
    `).run(
      req.user!.userId, result.lastInsertRowid,
      `Generated ${incidentNumber} from call ${call.call_number}`,
      req.ip || 'unknown'
    );

    res.status(201).json(incident);
  } catch (error: any) {
    console.error('Generate incident error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/archive-bulk - Archive multiple cleared/closed/cancelled calls at once
// NOTE: This route MUST come before /calls/:id/archive to avoid Express matching "archive-bulk" as :id
router.post('/calls/archive-bulk', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_ids, statuses } = req.body;

    const now = localNow();
    let callsToArchive: any[] = [];

    if (call_ids && Array.isArray(call_ids) && call_ids.length > 0) {
      // Archive specific calls by ID
      const placeholders = call_ids.map(() => '?').join(',');
      callsToArchive = db.prepare(
        `SELECT * FROM calls_for_service WHERE id IN (${placeholders}) AND status != 'archived'`
      ).all(...call_ids);
    } else {
      // Archive all calls matching the given statuses (default: cleared, closed, cancelled)
      const targetStatuses = Array.isArray(statuses) && statuses.length > 0
        ? statuses
        : ['cleared', 'closed', 'cancelled'];
      const placeholders = targetStatuses.map(() => '?').join(',');
      callsToArchive = db.prepare(
        `SELECT * FROM calls_for_service WHERE status IN (${placeholders})`
      ).all(...targetStatuses);
    }

    if (callsToArchive.length === 0) {
      res.json({ archived_count: 0, message: 'No calls to archive' });
      return;
    }

    const archiveStmt = db.prepare('UPDATE calls_for_service SET status = ?, archived_at = ? WHERE id = ?');
    const freeUnitStmt = db.prepare(
      `UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?`
    );
    const logStmt = db.prepare(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'call_archived', 'call', ?, ?, ?)`
    );

    const archiveTransaction = db.transaction(() => {
      for (const call of callsToArchive) {
        archiveStmt.run('archived', now, call.id);

        // Free up any assigned units
        let unitIds: number[] = [];
        try { unitIds = JSON.parse(call.assigned_unit_ids || '[]'); } catch { /* ignore */ }
        for (const unitId of unitIds) {
          freeUnitStmt.run(now, unitId, call.id);
        }

        logStmt.run(req.user!.userId, call.id, `${call.call_number} bulk archived`, req.ip || 'unknown');
      }
    });

    archiveTransaction();

    broadcastDispatchUpdate({ action: 'calls_bulk_archived', count: callsToArchive.length });

    res.json({ archived_count: callsToArchive.length, message: `${callsToArchive.length} call(s) archived` });
  } catch (error: any) {
    console.error('Bulk archive error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/archive - Archive a closed/cleared call
router.post('/calls/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status === 'archived') {
      res.status(400).json({ error: 'Call is already archived' });
      return;
    }

    const now = localNow();
    db.prepare('UPDATE calls_for_service SET status = ?, archived_at = ? WHERE id = ?')
      .run('archived', now, call.id);

    // Free up any assigned units when archiving
    let unitIds: number[] = [];
    try {
      unitIds = JSON.parse(call.assigned_unit_ids || '[]');
    } catch { /* ignore */ }
    for (const unitId of unitIds) {
      db.prepare(`UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?`)
        .run(now, unitId, call.id);
    }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_archived', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} archived`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_archived', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('Archive call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/unarchive - Restore archived call back to closed
router.post('/calls/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status !== 'archived') {
      res.status(400).json({ error: 'Call is not archived' });
      return;
    }

    db.prepare('UPDATE calls_for_service SET status = ? WHERE id = ?').run('closed', call.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_unarchived', 'call', ?, ?, ?)
    `).run(req.user!.userId, call.id, `${call.call_number} restored from archive`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_unarchived', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive call error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/calls/:id - Hard delete a call (admin/manager only)
router.delete('/calls/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

    // If call has active units assigned, free them first
    let unitIds: number[] = [];
    try { unitIds = JSON.parse(call.assigned_unit_ids || '[]'); } catch { /* ignore */ }
    const now = localNow();
    for (const unitId of unitIds) {
      db.prepare(`
        UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?
      `).run(now, unitId, call.id);
    }

    // Nullify FK references in related tables before deleting the call
    try { db.prepare('UPDATE incidents SET call_id = NULL WHERE call_id = ?').run(call.id); } catch { /* ignore */ }
    try { db.prepare('UPDATE units SET current_call_id = NULL WHERE current_call_id = ?').run(call.id); } catch { /* ignore */ }
    try { db.prepare('DELETE FROM record_links WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)').run('call', String(call.id), 'call', String(call.id)); } catch { /* ignore */ }

    // Delete related records
    try { db.prepare('DELETE FROM activity_log WHERE entity_type = ? AND entity_id = ?').run('call', call.id); } catch { /* ignore */ }
    try { db.prepare("DELETE FROM activity_log WHERE entity_type = 'call' AND entity_id = ?").run(String(call.id)); } catch { /* ignore */ }

    db.prepare('DELETE FROM calls_for_service WHERE id = ?').run(call.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_deleted', 'call', ?, ?, ?)`).run(
      req.user!.userId, call.id, `Deleted call ${call.call_number}`, req.ip || 'unknown');

    broadcastDispatchUpdate({ action: 'call_deleted', call_id: call.id });
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete call error:', error);
    const msg = error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
      ? 'Cannot delete: this call has linked records. Unlink them first.'
      : 'Failed to delete call';
    res.status(500).json({ error: msg });
  }
});

// PUT /api/dispatch/calls/:id/timeline/:entryId - Edit a timeline/activity entry
router.put('/calls/:id/timeline/:entryId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const entry = db.prepare('SELECT * FROM activity_log WHERE id = ? AND entity_type = ? AND entity_id = ?')
      .get(req.params.entryId, 'call', req.params.id) as any;
    if (!entry) {
      res.status(404).json({ error: 'Timeline entry not found' });
      return;
    }

    const { details, created_at } = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    if (details !== undefined) { updates.push('details = ?'); params.push(details); }
    if (created_at !== undefined) { updates.push('created_at = ?'); params.push(created_at); }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    params.push(entry.id);
    db.prepare(`UPDATE activity_log SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT al.*, u.full_name as user_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.id = ?').get(entry.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update timeline entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/dispatch/calls/:id/timeline/:entryId - Delete a timeline/activity entry
router.delete('/calls/:id/timeline/:entryId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const entry = db.prepare('SELECT * FROM activity_log WHERE id = ? AND entity_type = ? AND entity_id = ?')
      .get(req.params.entryId, 'call', req.params.id) as any;
    if (!entry) {
      res.status(404).json({ error: 'Timeline entry not found' });
      return;
    }

    db.prepare('DELETE FROM activity_log WHERE id = ?').run(entry.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete timeline entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/dispatch/calls/:id/timeline - Add a manual timeline entry
router.post('/calls/:id/timeline', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const { action, details, created_at } = req.body;
    if (!details) {
      res.status(400).json({ error: 'details is required' });
      return;
    }

    const timestamp = created_at || localNow();
    const result = db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'call', ?, ?, ?, ?)
    `).run(req.user!.userId, action || 'note_added', call.id, details, req.ip || 'unknown', timestamp);

    const entry = db.prepare('SELECT al.*, u.full_name as user_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.id = ?').get(result.lastInsertRowid);
    res.status(201).json(entry);
  } catch (error: any) {
    console.error('Add timeline entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dispatch/calls/:id/warnings - Get warning tags for a call
router.get('/calls/:id/warnings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const warnings: Array<{ type: string; label: string; severity: 'critical' | 'high' | 'medium'; source: string }> = [];

    // Check call flags
    if (call.weapons_involved) {
      warnings.push({ type: 'ARMED', label: 'ARMED / WEAPONS', severity: 'critical', source: 'call' });
    }
    if (call.domestic_violence) {
      warnings.push({ type: 'DV', label: 'DOMESTIC VIOLENCE', severity: 'high', source: 'call' });
    }
    if (call.injuries_reported) {
      warnings.push({ type: 'INJURIES', label: 'INJURIES REPORTED', severity: 'high', source: 'call' });
    }
    if (call.alcohol_involved) {
      warnings.push({ type: 'ALCOHOL', label: 'ALCOHOL INVOLVED', severity: 'medium', source: 'call' });
    }
    if (call.drugs_involved) {
      warnings.push({ type: 'DRUGS', label: 'DRUGS INVOLVED', severity: 'medium', source: 'call' });
    }

    // Check linked persons for caution flags and warrants
    try {
      const linkedPersons = db.prepare(`
        SELECT p.id, p.first_name, p.last_name, p.caution_flags, p.is_sex_offender, p.gang_affiliation,
               p.probation_parole
        FROM incident_persons ip
        JOIN persons p ON ip.person_id = p.id
        JOIN incidents i ON ip.incident_id = i.id
        WHERE i.call_id = ?
      `).all(call.id) as any[];

      for (const person of linkedPersons) {
        if (person.caution_flags) {
          const flags = person.caution_flags.split(',').map((f: string) => f.trim()).filter(Boolean);
          for (const flag of flags) {
            warnings.push({
              type: 'CAUTION',
              label: flag.toUpperCase(),
              severity: 'high',
              source: `${person.first_name} ${person.last_name}`
            });
          }
        }
        if (person.is_sex_offender) {
          warnings.push({ type: 'SEX_OFFENDER', label: 'SEX OFFENDER', severity: 'critical', source: `${person.first_name} ${person.last_name}` });
        }
        if (person.gang_affiliation) {
          warnings.push({ type: 'GANG', label: 'GANG AFFILIATED', severity: 'critical', source: `${person.first_name} ${person.last_name}` });
        }
        if (person.probation_parole) {
          warnings.push({ type: 'PROBATION', label: 'ON PROBATION/PAROLE', severity: 'high', source: `${person.first_name} ${person.last_name}` });
        }
        // Pre-Trial Supervision
        if (person.probation_parole && person.probation_parole.toLowerCase().includes('pre-trial')) {
          warnings.push({ type: 'PTS', label: 'PRE-TRIAL SUPERVISION', severity: 'high', source: `${person.first_name} ${person.last_name}` });
        }
      }
    } catch { /* linked persons table may not exist */ }

    // Check for active warrants at location
    try {
      const activeWarrants = db.prepare(`
        SELECT w.warrant_number, w.charge_description, w.type, w.offense_level,
               p.first_name, p.last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
        AND (w.subject_person_id IN (
          SELECT ip.person_id FROM incident_persons ip
          JOIN incidents i ON ip.incident_id = i.id
          WHERE i.call_id = ?
        ))
      `).all(call.id) as any[];

      for (const warrant of activeWarrants) {
        warnings.push({
          type: 'WARRANT',
          label: `ACTIVE WARRANT: ${warrant.charge_description || warrant.type}`.toUpperCase(),
          severity: 'critical',
          source: `${warrant.first_name || ''} ${warrant.last_name || ''}`.trim() || warrant.warrant_number
        });
      }
    } catch { /* warrants table may not exist */ }

    // Check property hazard notes
    if (call.property_id) {
      try {
        const property = db.prepare('SELECT hazard_notes, post_orders FROM properties WHERE id = ?').get(call.property_id) as any;
        if (property?.hazard_notes) {
          warnings.push({ type: 'HAZARD', label: 'PROPERTY HAZARD', severity: 'high', source: 'Property file' });
        }
      } catch { /* ignore */ }
    }

    // Incident type-based warnings
    const itype = (call.incident_type || '').toLowerCase();
    if (itype.includes('shooting') || itype.includes('shots_fired') || itype.includes('armed')) {
      if (!warnings.find(w => w.type === 'ARMED')) {
        warnings.push({ type: 'ARMED', label: 'POSSIBLE WEAPONS', severity: 'critical', source: 'Incident type' });
      }
    }
    if (itype.includes('barricade') || itype.includes('hostage') || itype.includes('standoff')) {
      warnings.push({ type: 'BARRICADE', label: 'BARRICADED SUBJECT', severity: 'critical', source: 'Incident type' });
    }
    if (itype.includes('hazmat') || itype.includes('chemical') || itype.includes('spill')) {
      warnings.push({ type: 'HAZMAT', label: 'HAZMAT', severity: 'critical', source: 'Incident type' });
    }

    res.json(warnings);
  } catch (error: any) {
    console.error('Get warnings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/dispatch/panic ───────────────────────
// Emergency PANIC button — broadcasts audible alert to all connected users
router.post('/panic', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { latitude, longitude, message } = req.body;

    const user = db.prepare('SELECT id, full_name, badge_number, role FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const now = localNow();

    // Log the panic alert to activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'panic_alert', 'user', ?, ?, ?)
    `).run(
      user.id,
      user.id,
      `PANIC ALERT triggered by ${user.full_name} (${user.badge_number || 'N/A'})${message ? ': ' + message : ''}`,
      req.ip || 'unknown'
    );

    // ── Reverse-geocode officer GPS → address (with fallback) ──
    let locationAddress = latitude && longitude
      ? `GPS: ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
      : 'Unknown location';

    if (latitude && longitude) {
      try {
        const addr = await reverseGeocodeAddress(Number(latitude), Number(longitude));
        if (addr) locationAddress = addr;
      } catch { /* keep GPS fallback */ }
    }

    // ── Auto-create "Officer Assist — Panic Alarm" dispatch call ──
    const callNumber = generateCallNumber(db);
    const description = `PANIC ALARM — Officer ${user.full_name} (Badge: ${user.badge_number || 'N/A'}) triggered emergency alert.${message ? ' Message: ' + message : ''}`;

    const callResult = db.prepare(`
      INSERT INTO calls_for_service (
        call_number, incident_type, priority, status,
        caller_name, location_address, latitude, longitude,
        description, source, dispatcher_id,
        weapons_involved, created_at, dispatched_at
      ) VALUES (?, 'officer_assist', 'P1', 'dispatched',
        ?, ?, ?, ?,
        ?, 'panic', ?,
        'unknown', ?, ?)
    `).run(
      callNumber,
      user.full_name,
      locationAddress,
      latitude || null,
      longitude || null,
      description,
      user.id,
      now,
      now,
    );

    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?')
      .get(callResult.lastInsertRowid) as any;

    // ── Auto-assign officer's unit to the call ──
    const unit = db.prepare('SELECT id, call_sign FROM units WHERE officer_id = ?')
      .get(user.id) as any;

    if (unit) {
      db.prepare('UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?')
        .run('dispatched', call.id, now, unit.id);

      // Update call's assigned_unit_ids JSON array
      const unitIds = JSON.stringify([String(unit.id)]);
      db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
        .run(unitIds, call.id);

      broadcastUnitUpdate({ action: 'unit_status_changed', unit: { ...unit, status: 'dispatched', current_call_id: call.id } });
    }

    // Log call creation
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'call_created', 'call', ?, ?, ?)
    `).run(user.id, call.id, `PANIC auto-created ${callNumber}: officer_assist`, req.ip || 'unknown');

    // ── Broadcast panic alert to ALL clients (with call info) ──
    broadcastPanic({
      user_id: user.id,
      user_name: user.full_name,
      badge_number: user.badge_number,
      role: user.role,
      message: message || null,
      latitude: latitude || null,
      longitude: longitude || null,
      triggered_at: now,
      call_number: callNumber,
      call_id: call.id,
      location_address: locationAddress,
      unit_call_sign: unit?.call_sign || null,
    });

    // ── Broadcast dispatch update so Dispatch page picks up the new call ──
    const enrichedCall = db.prepare(`
      SELECT c.*, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.id = ?
    `).get(call.id);

    broadcastDispatchUpdate({ action: 'call_created', call: enrichedCall || call });

    res.json({
      success: true,
      message: 'Panic alert sent — dispatch call created',
      call_number: callNumber,
      call_id: call.id,
    });
  } catch (error: any) {
    console.error('Panic alert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
