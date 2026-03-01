import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── DASHBOARD / STATS ──────────────────────────────

// GET /api/body-cameras/stats
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalDevices = (db.prepare('SELECT COUNT(*) as count FROM bwc_devices').get() as any).count;
    const assigned = (db.prepare("SELECT COUNT(*) as count FROM bwc_devices WHERE status = 'assigned'").get() as any).count;
    const available = (db.prepare("SELECT COUNT(*) as count FROM bwc_devices WHERE status = 'available'").get() as any).count;
    const maintenance = (db.prepare("SELECT COUNT(*) as count FROM bwc_devices WHERE status = 'maintenance'").get() as any).count;

    const totalFootage = (db.prepare('SELECT COUNT(*) as count FROM bwc_footage').get() as any).count;
    const totalStorageMb = (db.prepare('SELECT COALESCE(SUM(file_size_mb), 0) as total FROM bwc_footage').get() as any).total;

    const footageByCategory = db.prepare(`
      SELECT category, COUNT(*) as count FROM bwc_footage
      GROUP BY category ORDER BY count DESC
    `).all();

    const footageByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM bwc_footage
      GROUP BY status ORDER BY count DESC
    `).all();

    const flaggedCount = (db.prepare('SELECT COUNT(*) as count FROM bwc_footage WHERE flagged = 1').get() as any).count;
    const pendingReview = (db.prepare("SELECT COUNT(*) as count FROM bwc_footage WHERE reviewed = 0 AND status = 'available'").get() as any).count;
    const litigationHold = (db.prepare("SELECT COUNT(*) as count FROM bwc_footage WHERE retention_class = 'litigation_hold'").get() as any).count;

    const byOfficer = db.prepare(`
      SELECT u.full_name, u.badge_number, COUNT(*) as count,
             ROUND(COALESCE(SUM(f.duration_seconds), 0) / 3600.0, 1) as total_hours
      FROM bwc_footage f
      JOIN users u ON f.officer_id = u.id
      WHERE f.start_time >= date('now', '-30 days')
      GROUP BY f.officer_id ORDER BY count DESC LIMIT 10
    `).all();

    const recentCheckouts = db.prepare(`
      SELECT cl.*, d.device_serial, d.device_model, u.full_name as officer_name, u.badge_number,
             p.full_name as performed_by_name
      FROM bwc_checkout_log cl
      JOIN bwc_devices d ON cl.device_id = d.id
      JOIN users u ON cl.officer_id = u.id
      JOIN users p ON cl.performed_by = p.id
      ORDER BY cl.performed_at DESC LIMIT 10
    `).all();

    const expiringRetention = db.prepare(`
      SELECT COUNT(*) as count FROM bwc_footage
      WHERE retention_expiry IS NOT NULL
        AND retention_expiry <= date('now', '+30 days')
        AND status != 'deleted'
    `).get() as any;

    res.json({
      devices: { total: totalDevices, assigned, available, maintenance },
      footage: {
        total: totalFootage,
        totalStorageGb: Math.round(totalStorageMb / 1024 * 10) / 10,
        byCategory: footageByCategory,
        byStatus: footageByStatus,
        flagged: flaggedCount,
        pendingReview,
        litigationHold,
        expiringRetention: expiringRetention.count,
      },
      byOfficer,
      recentCheckouts,
    });
  } catch (error: any) {
    console.error('BWC stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DEVICES ─────────────────────────────────────────

// GET /api/body-cameras/devices
router.get('/devices', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, search } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND d.status = ?'; params.push(status); }
    if (search) {
      where += ' AND (d.device_serial LIKE ? OR d.device_model LIKE ? OR u.full_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const devices = db.prepare(`
      SELECT d.*, u.full_name as officer_name, u.badge_number
      FROM bwc_devices d
      LEFT JOIN users u ON d.assigned_officer_id = u.id
      ${where}
      ORDER BY d.status ASC, d.device_serial ASC
    `).all(...params);

    res.json(devices);
  } catch (error: any) {
    console.error('Get BWC devices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/body-cameras/devices/:id
router.get('/devices/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const device = db.prepare(`
      SELECT d.*, u.full_name as officer_name, u.badge_number
      FROM bwc_devices d
      LEFT JOIN users u ON d.assigned_officer_id = u.id
      WHERE d.id = ?
    `).get(req.params.id) as any;
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }

    // Get checkout history
    const history = db.prepare(`
      SELECT cl.*, u.full_name as officer_name, p.full_name as performed_by_name
      FROM bwc_checkout_log cl
      JOIN users u ON cl.officer_id = u.id
      JOIN users p ON cl.performed_by = p.id
      WHERE cl.device_id = ?
      ORDER BY cl.performed_at DESC LIMIT 50
    `).all(req.params.id);

    // Get footage count
    const footageCount = (db.prepare(
      'SELECT COUNT(*) as count FROM bwc_footage WHERE device_id = ?'
    ).get(req.params.id) as any).count;

    res.json({ ...device, history, footageCount });
  } catch (error: any) {
    console.error('Get BWC device error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/body-cameras/devices
router.post('/devices', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { device_serial, device_model, device_type, assigned_officer_id, firmware_version,
            storage_capacity_gb, purchase_date, warranty_expiry, notes } = req.body;

    if (!device_serial) { res.status(400).json({ error: 'Device serial number is required' }); return; }

    const now = localNow();
    const status = assigned_officer_id ? 'assigned' : 'available';

    const result = db.prepare(`
      INSERT INTO bwc_devices (device_serial, device_model, device_type, assigned_officer_id, status,
        firmware_version, storage_capacity_gb, purchase_date, warranty_expiry, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      device_serial, device_model || 'Axon Body 3', device_type || 'body',
      assigned_officer_id || null, status,
      firmware_version || null, storage_capacity_gb || null,
      purchase_date || null, warranty_expiry || null, notes || null, now, now,
    );

    // If assigned, log checkout
    if (assigned_officer_id) {
      db.prepare(`INSERT INTO bwc_checkout_log (device_id, officer_id, action, performed_by, performed_at)
        VALUES (?, ?, 'checkout', ?, ?)`).run(result.lastInsertRowid, assigned_officer_id, req.user!.userId, now);
    }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'bwc_device_created', 'bwc_device', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid, `BWC ${device_serial} registered`, req.ip || 'unknown'
    );

    const created = db.prepare('SELECT * FROM bwc_devices WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ error: 'A device with this serial number already exists' });
      return;
    }
    console.error('Create BWC device error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/body-cameras/devices/:id
router.put('/devices/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM bwc_devices WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Device not found' }); return; }

    const fields: string[] = [];
    const values: any[] = [];
    const addField = (col: string, val: any) => {
      if (val !== undefined) { fields.push(`${col} = ?`); values.push(val); }
    };

    const b = req.body;
    addField('device_serial', b.device_serial);
    addField('device_model', b.device_model);
    addField('device_type', b.device_type);
    addField('status', b.status);
    addField('firmware_version', b.firmware_version);
    addField('storage_capacity_gb', b.storage_capacity_gb);
    addField('purchase_date', b.purchase_date);
    addField('warranty_expiry', b.warranty_expiry);
    addField('notes', b.notes);

    // Handle assignment change
    if (b.assigned_officer_id !== undefined && b.assigned_officer_id !== existing.assigned_officer_id) {
      addField('assigned_officer_id', b.assigned_officer_id || null);
      const now = localNow();
      // Log checkin for old officer
      if (existing.assigned_officer_id) {
        db.prepare(`INSERT INTO bwc_checkout_log (device_id, officer_id, action, performed_by, performed_at)
          VALUES (?, ?, 'checkin', ?, ?)`).run(req.params.id, existing.assigned_officer_id, req.user!.userId, now);
      }
      // Log checkout for new officer
      if (b.assigned_officer_id) {
        db.prepare(`INSERT INTO bwc_checkout_log (device_id, officer_id, action, performed_by, performed_at)
          VALUES (?, ?, 'checkout', ?, ?)`).run(req.params.id, b.assigned_officer_id, req.user!.userId, now);
        if (!b.status) addField('status', 'assigned');
      } else {
        if (!b.status) addField('status', 'available');
      }
    }

    if (fields.length === 0) { res.json(existing); return; }
    fields.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE bwc_devices SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM bwc_devices WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update BWC device error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/body-cameras/devices/:id/checkout
router.post('/devices/:id/checkout', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const device = db.prepare('SELECT * FROM bwc_devices WHERE id = ?').get(req.params.id) as any;
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    if (device.status !== 'available') {
      res.status(400).json({ error: `Device is currently ${device.status} — cannot checkout` }); return;
    }

    const { officer_id, battery_level, storage_used_pct, condition_notes } = req.body;
    const officerId = officer_id || req.user!.userId;
    const now = localNow();

    db.prepare(`UPDATE bwc_devices SET assigned_officer_id = ?, status = 'assigned', updated_at = ? WHERE id = ?`)
      .run(officerId, now, req.params.id);

    db.prepare(`INSERT INTO bwc_checkout_log (device_id, officer_id, action, battery_level, storage_used_pct, condition_notes, performed_by, performed_at)
      VALUES (?, ?, 'checkout', ?, ?, ?, ?, ?)`).run(
      req.params.id, officerId, battery_level || null, storage_used_pct || null,
      condition_notes || null, req.user!.userId, now,
    );

    const updated = db.prepare(`
      SELECT d.*, u.full_name as officer_name FROM bwc_devices d
      LEFT JOIN users u ON d.assigned_officer_id = u.id WHERE d.id = ?
    `).get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('BWC checkout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/body-cameras/devices/:id/checkin
router.post('/devices/:id/checkin', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const device = db.prepare('SELECT * FROM bwc_devices WHERE id = ?').get(req.params.id) as any;
    if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
    if (device.status !== 'assigned') {
      res.status(400).json({ error: `Device is ${device.status} — not checked out` }); return;
    }

    const { battery_level, storage_used_pct, condition_notes } = req.body;
    const now = localNow();

    db.prepare(`UPDATE bwc_devices SET assigned_officer_id = NULL, status = 'available', updated_at = ? WHERE id = ?`)
      .run(now, req.params.id);

    db.prepare(`INSERT INTO bwc_checkout_log (device_id, officer_id, action, battery_level, storage_used_pct, condition_notes, performed_by, performed_at)
      VALUES (?, ?, 'checkin', ?, ?, ?, ?, ?)`).run(
      req.params.id, device.assigned_officer_id, battery_level || null, storage_used_pct || null,
      condition_notes || null, req.user!.userId, now,
    );

    const updated = db.prepare('SELECT * FROM bwc_devices WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('BWC checkin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── FOOTAGE ─────────────────────────────────────────

// GET /api/body-cameras/footage
router.get('/footage', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { category, status, officer_id, flagged, search, incident_id } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (category) { where += ' AND f.category = ?'; params.push(category); }
    if (status) { where += ' AND f.status = ?'; params.push(status); }
    if (officer_id) { where += ' AND f.officer_id = ?'; params.push(officer_id); }
    if (flagged === '1') { where += ' AND f.flagged = 1'; }
    if (incident_id) { where += ' AND f.linked_incident_id = ?'; params.push(incident_id); }
    if (search) {
      where += ' AND (f.footage_id LIKE ? OR f.title LIKE ? OR f.notes LIKE ? OR u.full_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const footage = db.prepare(`
      SELECT f.*, u.full_name as officer_name, u.badge_number,
             d.device_serial, d.device_model,
             rv.full_name as reviewed_by_name
      FROM bwc_footage f
      JOIN users u ON f.officer_id = u.id
      JOIN bwc_devices d ON f.device_id = d.id
      LEFT JOIN users rv ON f.reviewed_by = rv.id
      ${where}
      ORDER BY f.start_time DESC
      LIMIT 200
    `).all(...params);

    res.json(footage.map((f: any) => ({
      ...f,
      tags: typeof f.tags === 'string' ? JSON.parse(f.tags) : f.tags,
    })));
  } catch (error: any) {
    console.error('Get BWC footage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/body-cameras/footage/:id
router.get('/footage/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const footage = db.prepare(`
      SELECT f.*, u.full_name as officer_name, u.badge_number,
             d.device_serial, d.device_model,
             rv.full_name as reviewed_by_name
      FROM bwc_footage f
      JOIN users u ON f.officer_id = u.id
      JOIN bwc_devices d ON f.device_id = d.id
      LEFT JOIN users rv ON f.reviewed_by = rv.id
      WHERE f.id = ?
    `).get(req.params.id) as any;
    if (!footage) { res.status(404).json({ error: 'Footage not found' }); return; }
    footage.tags = typeof footage.tags === 'string' ? JSON.parse(footage.tags) : footage.tags;
    res.json(footage);
  } catch (error: any) {
    console.error('Get BWC footage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/body-cameras/footage
router.post('/footage', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    // Generate footage ID: BWC-YYYY-NNNNNN
    const year = new Date().getFullYear();
    const last = db.prepare(`SELECT footage_id FROM bwc_footage WHERE footage_id LIKE 'BWC-${year}-%' ORDER BY id DESC LIMIT 1`).get() as any;
    const seq = last ? parseInt(last.footage_id.split('-')[2]) + 1 : 1;
    const footage_id = `BWC-${year}-${String(seq).padStart(6, '0')}`;

    const b = req.body;
    if (!b.device_id || !b.start_time) {
      res.status(400).json({ error: 'device_id and start_time are required' }); return;
    }

    // Calculate duration if both start and end provided
    let duration_seconds = b.duration_seconds || null;
    if (!duration_seconds && b.start_time && b.end_time) {
      const diff = new Date(b.end_time).getTime() - new Date(b.start_time).getTime();
      if (diff > 0) duration_seconds = Math.round(diff / 1000);
    }

    // Determine retention expiry based on class
    let retention_expiry = b.retention_expiry || null;
    if (!retention_expiry && b.retention_class !== 'permanent' && b.retention_class !== 'litigation_hold') {
      const months = b.retention_class === 'extended' ? 36 : 12; // extended: 3yrs, standard: 1yr
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      retention_expiry = d.toISOString().split('T')[0];
    }

    const result = db.prepare(`
      INSERT INTO bwc_footage (
        device_id, officer_id, footage_id, title, category, start_time, end_time,
        duration_seconds, file_size_mb, storage_location, retention_class, retention_expiry,
        linked_incident_id, linked_call_id, linked_case_id, linked_uof_id,
        flagged, flag_reason, tags, notes, status, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      b.device_id, b.officer_id || req.user!.userId, footage_id,
      b.title || null, b.category || 'routine',
      b.start_time, b.end_time || null, duration_seconds,
      b.file_size_mb || null, b.storage_location || null,
      b.retention_class || 'standard', retention_expiry,
      b.linked_incident_id || null, b.linked_call_id || null,
      b.linked_case_id || null, b.linked_uof_id || null,
      b.flagged ? 1 : 0, b.flag_reason || null,
      JSON.stringify(b.tags || []), b.notes || null,
      b.status || 'uploaded', now, now,
    );

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'bwc_footage_added', 'bwc_footage', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid, `BWC footage ${footage_id} added`, req.ip || 'unknown'
    );

    const created = db.prepare('SELECT * FROM bwc_footage WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create BWC footage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/body-cameras/footage/:id
router.put('/footage/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM bwc_footage WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Footage not found' }); return; }

    const fields: string[] = [];
    const values: any[] = [];
    const addField = (col: string, val: any) => {
      if (val !== undefined) { fields.push(`${col} = ?`); values.push(val); }
    };

    const b = req.body;
    addField('title', b.title);
    addField('category', b.category);
    addField('start_time', b.start_time);
    addField('end_time', b.end_time);
    addField('duration_seconds', b.duration_seconds);
    addField('file_size_mb', b.file_size_mb);
    addField('storage_location', b.storage_location);
    addField('retention_class', b.retention_class);
    addField('retention_expiry', b.retention_expiry);
    addField('linked_incident_id', b.linked_incident_id);
    addField('linked_call_id', b.linked_call_id);
    addField('linked_case_id', b.linked_case_id);
    addField('linked_uof_id', b.linked_uof_id);
    addField('flagged', b.flagged !== undefined ? (b.flagged ? 1 : 0) : undefined);
    addField('flag_reason', b.flag_reason);
    if (b.tags !== undefined) addField('tags', JSON.stringify(b.tags));
    addField('notes', b.notes);
    addField('status', b.status);

    if (fields.length === 0) { res.json(existing); return; }
    fields.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE bwc_footage SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM bwc_footage WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update BWC footage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/body-cameras/footage/:id/review
router.put('/footage/:id/review', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { review_notes } = req.body;

    db.prepare(`
      UPDATE bwc_footage SET reviewed = 1, reviewed_by = ?, reviewed_at = ?, review_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(req.user!.userId, now, review_notes || null, now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'bwc_footage_reviewed', 'bwc_footage', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `BWC footage #${req.params.id} reviewed`, req.ip || 'unknown'
    );

    const updated = db.prepare('SELECT * FROM bwc_footage WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('BWC review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/body-cameras/footage/:id/flag
router.put('/footage/:id/flag', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { flagged, flag_reason } = req.body;
    const now = localNow();

    db.prepare(`UPDATE bwc_footage SET flagged = ?, flag_reason = ?, updated_at = ? WHERE id = ?`)
      .run(flagged ? 1 : 0, flag_reason || null, now, req.params.id);

    const updated = db.prepare('SELECT * FROM bwc_footage WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('BWC flag error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/body-cameras/footage/:id/retention
router.put('/footage/:id/retention', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { retention_class, retention_expiry } = req.body;
    const now = localNow();

    const updates: string[] = ['updated_at = ?'];
    const vals: any[] = [now];
    if (retention_class) { updates.push('retention_class = ?'); vals.push(retention_class); }
    if (retention_expiry !== undefined) { updates.push('retention_expiry = ?'); vals.push(retention_expiry); }
    if (retention_class === 'litigation_hold') { updates.push("status = 'litigation_hold'"); }
    vals.push(req.params.id);

    db.prepare(`UPDATE bwc_footage SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'bwc_retention_changed', 'bwc_footage', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `BWC #${req.params.id} retention → ${retention_class}`, req.ip || 'unknown'
    );

    const updated = db.prepare('SELECT * FROM bwc_footage WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('BWC retention error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
