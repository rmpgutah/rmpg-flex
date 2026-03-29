import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { broadcast } from '../utils/websocket';
import { auditLog } from '../utils/auditLogger';
import { localNow, localToday } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

/** Generate next order number: TO-YYYY-NNNN */
function generateOrderNumber(db: ReturnType<typeof getDb>): string {
  const year = new Date().getFullYear();
  const prefix = `TO-${year}-`;
  const row = db.prepare(
    `SELECT order_number FROM trespass_orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${prefix}%`) as { order_number: string } | undefined;

  let seq = 1;
  if (row) {
    const parts = row.order_number.split('-');
    const parsed = parseInt(parts[2], 10);
    seq = isNaN(parsed) ? 1 : parsed + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// GET / — List trespass orders
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, property_id, search, archived, page = '1', per_page = '50' } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (property_id) { where += ' AND t.property_id = ?'; params.push(property_id); }
    if (search) {
      where += ` AND (t.subject_first_name || ' ' || t.subject_last_name LIKE ? OR t.order_number LIKE ? OR t.location LIKE ? OR t.property_name LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    if (archived === 'true') {
      where += ' AND t.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      where += ' AND t.archived_at IS NULL';
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 50));
    const offset = (pageNum - 1) * perPage;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM trespass_orders t ${where}`).get(...params) as any;
    const rows = db.prepare(`
      SELECT t.*, u.full_name as issued_by_display,
        p.first_name as linked_person_first, p.last_name as linked_person_last,
        prop.name as linked_property_name
      FROM trespass_orders t
      LEFT JOIN users u ON t.issued_by = u.id
      LEFT JOIN persons p ON t.person_id = p.id
      LEFT JOIN properties prop ON t.property_id = prop.id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, offset);

    res.json({
      data: rows,
      pagination: { page: pageNum, per_page: perPage, total: countRow.total, totalPages: Math.ceil(countRow.total / perPage) },
    });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// GET /check — Check active trespass orders for a property (dispatch alert use)
router.get('/check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id, address } = req.query;

    let where = `WHERE t.status = 'active' AND (t.expiration_date IS NULL OR t.expiration_date > datetime('now','localtime'))`;
    const params: any[] = [];

    if (property_id) {
      where += ' AND t.property_id = ?';
      params.push(property_id);
    } else if (address) {
      where += ' AND t.location LIKE ?';
      params.push(`%${address}%`);
    } else {
      return res.json({ orders: [], count: 0 });
    }

    const rows = db.prepare(`
      SELECT t.id, t.order_number, t.subject_first_name, t.subject_last_name,
        t.subject_description, t.order_type, t.status, t.reason, t.effective_date, t.expiration_date,
        t.property_name, t.location
      FROM trespass_orders t
      ${where}
      ORDER BY t.created_at DESC
    
      LIMIT 1000
    `).all(...params);

    res.json({ orders: rows, count: rows.length });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// GET /:id — Single order detail
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid trespass order ID', code: 'INVALID_TRESPASS_ORDER_ID' }); return; }
    const row = db.prepare(`
      SELECT t.*, u.full_name as issued_by_display,
        p.first_name as linked_person_first, p.last_name as linked_person_last,
        prop.name as linked_property_name,
        su.full_name as served_by_name
      FROM trespass_orders t
      LEFT JOIN users u ON t.issued_by = u.id
      LEFT JOIN persons p ON t.person_id = p.id
      LEFT JOIN properties prop ON t.property_id = prop.id
      LEFT JOIN users su ON t.served_by = su.id
      WHERE t.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'Trespass order not found', code: 'NOT_FOUND' });
    res.json({ data: row });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// POST / — Create new trespass order
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const order_number = generateOrderNumber(db);
    const now = localNow();

    const {
      person_id, subject_first_name, subject_last_name, subject_dob, subject_description,
      property_id, property_name, location,
      order_type = 'trespass_warning', reason, conditions,
      duration_days, effective_date, expiration_date,
      originating_call_id, originating_incident_id,
      authorized_by, notes,
    } = req.body;

    if (!subject_first_name || !subject_last_name) return res.status(400).json({ error: 'Subject name is required', code: 'MISSING_NAME' });
    if (!location?.trim()) return res.status(400).json({ error: 'Location is required', code: 'MISSING_LOCATION' });

    // Input sanitization
    const cleanFirstName = typeof subject_first_name === 'string' ? subject_first_name.trim() : subject_first_name;
    const cleanLastName = typeof subject_last_name === 'string' ? subject_last_name.trim() : subject_last_name;
    const cleanLocation = typeof location === 'string' ? location.trim() : location;

    // Validate duration_days if provided
    if (duration_days !== undefined && duration_days !== null) {
      const dur = parseInt(duration_days, 10);
      if (isNaN(dur) || dur < 1 || dur > 3650) return res.status(400).json({ error: 'duration_days must be between 1 and 3650', code: 'INVALID_DURATION' });
    }

    // Auto-calc expiration if duration_days provided
    let exp = expiration_date || null;
    if (!exp && duration_days) {
      const eff = effective_date ? new Date(effective_date) : new Date();
      eff.setDate(eff.getDate() + parseInt(duration_days, 10));
      exp = eff.toISOString().split('T')[0];
    }

    const result = db.prepare(`
      INSERT INTO trespass_orders (
        order_number, person_id, subject_first_name, subject_last_name, subject_dob, subject_description,
        property_id, property_name, location,
        order_type, status, reason, conditions,
        duration_days, effective_date, expiration_date,
        originating_call_id, originating_incident_id,
        issued_by, issued_by_name, authorized_by, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order_number, person_id || null, subject_first_name, subject_last_name, subject_dob || null, subject_description,
      property_id || null, property_name, location,
      order_type, reason, conditions,
      duration_days || null, effective_date || now, exp,
      originating_call_id || null, originating_incident_id || null,
      user.id, user.full_name, authorized_by, notes,
      now, now
    );

    const created = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(result.lastInsertRowid);
    auditLog(req, 'CREATE', 'trespass_order', result.lastInsertRowid as number, `Created trespass order ${order_number}`);
    broadcast('alerts', 'trespass_order_created', created);
    res.status(201).json({ data: created });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Internal server error', code: 'CREATE_ERROR' });
  }
});

// PUT /:id — Update order
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const existing = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' });

    const fields = [
      'person_id', 'subject_first_name', 'subject_last_name', 'subject_dob', 'subject_description',
      'property_id', 'property_name', 'location',
      'order_type', 'status', 'reason', 'conditions',
      'duration_days', 'effective_date', 'expiration_date',
      'authorized_by', 'notes',
    ];

    const setClauses: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        params.push(req.body[f] || null);
      }
    }

    params.push(req.params.id);
    db.prepare(`UPDATE trespass_orders SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id);
    auditLog(req, 'UPDATE', 'trespass_order', req.params.id, `Updated trespass order #${req.params.id}`);
    broadcast('alerts', 'trespass_order_updated', updated);
    res.json({ data: updated });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Internal server error', code: 'UPDATE_ERROR' });
  }
});

// PUT /:id/serve — Mark order as served
router.put('/:id/serve', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
    const existing = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }); return; }
    db.prepare(`UPDATE trespass_orders SET status = 'served', served_at = ?, served_by = ?, updated_at = ? WHERE id = ?`)
      .run(now, user.id, now, id);
    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id);
    auditLog(req, 'UPDATE', 'trespass_order', id, `Served trespass order #${id}`);
    broadcast('alerts', 'trespass_order_served', updated);
    res.json({ data: updated });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Internal server error', code: 'SERVE_ERROR' });
  }
});

// PUT /:id/lift — Lift order
router.put('/:id/lift', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
    const existing = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }); return; }
    db.prepare(`UPDATE trespass_orders SET status = 'lifted', updated_at = ? WHERE id = ?`).run(now, id);
    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id);
    auditLog(req, 'UPDATE', 'trespass_order', id, `Lifted trespass order #${id}`);
    broadcast('alerts', 'trespass_order_lifted', updated);
    res.json({ data: updated });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// PUT /:id/violate — Record violation
router.put('/:id/violate', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }
    const existing = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }); return; }
    db.prepare(`UPDATE trespass_orders SET status = 'violated', updated_at = ? WHERE id = ?`).run(now, id);
    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id);
    auditLog(req, 'UPDATE', 'trespass_order', id, `Violation recorded on trespass order #${id}`);
    broadcast('alerts', 'trespass_order_violated', updated);
    res.json({ data: updated });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// POST /:id/renew — Renew expiring trespass order
router.post('/:id/renew', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();

    const existing = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' });

    // Generate new order number
    const order_number = generateOrderNumber(db);

    // Calculate new dates
    const duration = existing.duration_days || 365;
    const effectiveDate = new Date();
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + duration);

    // Create new order with same details
    const result = db.prepare(`
      INSERT INTO trespass_orders (
        order_number, person_id, subject_first_name, subject_last_name, subject_dob, subject_description,
        property_id, property_name, location,
        order_type, status, reason, conditions,
        duration_days, effective_date, expiration_date,
        issued_by, issued_by_name, authorized_by, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order_number, existing.person_id, existing.subject_first_name, existing.subject_last_name,
      existing.subject_dob, existing.subject_description,
      existing.property_id, existing.property_name, existing.location,
      existing.order_type, existing.reason, existing.conditions,
      duration, effectiveDate.toISOString().split('T')[0], expirationDate.toISOString().split('T')[0],
      user.id, user.full_name, existing.authorized_by,
      `Renewed from ${existing.order_number}. ${existing.notes || ''}`.trim(),
      now, now
    );

    // Archive old order
    db.prepare(`UPDATE trespass_orders SET archived_at = ?, notes = COALESCE(notes, '') || ? WHERE id = ?`)
      .run(now, `\nArchived: Renewed as ${order_number}`, existing.id);

    const created = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(result.lastInsertRowid);
    auditLog(req, 'CREATE', 'trespass_order', result.lastInsertRowid as number, `Renewed trespass order ${existing.order_number} as ${order_number}`);
    broadcast('alerts', 'trespass_order_renewed', { old: existing, new: created });
    res.status(201).json({ data: created });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 16: Photo Attachment for Trespass Orders
// ════════════════════════════════════════════════════════════

router.put('/:id/photo', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' });

    const { photo_url } = req.body;
    if (!photo_url) return res.status(400).json({ error: 'photo_url is required', code: 'PHOTOURL_IS_REQUIRED' });

    const now = localNow();
    db.prepare('UPDATE trespass_orders SET subject_photo_url = ?, updated_at = ? WHERE id = ?')
      .run(photo_url, now, req.params.id);

    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id);
    auditLog(req, 'UPDATE', 'trespass_order', req.params.id, `Updated photo on trespass order #${req.params.id}`);
    res.json({ data: updated });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Internal server error', code: 'PHOTO_UPDATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 17: Violation Auto-detection
// Check if a person at a property has an active trespass order
// ════════════════════════════════════════════════════════════

router.get('/detect-violation', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { person_id, person_name, property_id, address } = req.query;

    let where = `WHERE t.status = 'active' AND (t.expiration_date IS NULL OR t.expiration_date > datetime('now','localtime'))`;
    const params: any[] = [];

    if (person_id) {
      where += ' AND t.person_id = ?';
      params.push(person_id);
    } else if (person_name) {
      const nameParts = (person_name as string).split(' ');
      if (nameParts.length >= 2) {
        where += ' AND (LOWER(t.subject_first_name) = LOWER(?) AND LOWER(t.subject_last_name) = LOWER(?))';
        params.push(nameParts[0], nameParts[nameParts.length - 1]);
      } else {
        where += ' AND (LOWER(t.subject_first_name) = LOWER(?) OR LOWER(t.subject_last_name) = LOWER(?))';
        params.push(nameParts[0], nameParts[0]);
      }
    } else {
      return res.json({ violation_detected: false, orders: [] });
    }

    if (property_id) {
      where += ' AND t.property_id = ?';
      params.push(property_id);
    } else if (address) {
      where += ' AND t.location LIKE ?';
      params.push(`%${address}%`);
    }

    const orders = db.prepare(`
      SELECT t.id, t.order_number, t.subject_first_name, t.subject_last_name,
             t.property_name, t.location, t.order_type, t.reason,
             t.effective_date, t.expiration_date
      FROM trespass_orders t ${where}
    
      LIMIT 1000
    `).all(...params) as any[];

    res.json({
      violation_detected: orders.length > 0,
      orders,
      alert_message: orders.length > 0
        ? `TRESPASS ALERT: ${orders.length} active trespass order(s) found for this person at this location`
        : null,
    });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 18: Trespass Order Expiration Calendar
// ════════════════════════════════════════════════════════════

router.get('/expiration-calendar', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { start_date, end_date } = req.query;
    const start = start_date as string || localToday();
    const endD = end_date as string || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const expiring = db.prepare(`
      SELECT t.id, t.order_number, t.subject_first_name, t.subject_last_name,
             t.property_name, t.location, t.order_type, t.status,
             t.expiration_date, t.effective_date,
             JULIANDAY(t.expiration_date) - JULIANDAY('now') as days_remaining
      FROM trespass_orders t
      WHERE t.status = 'active' AND t.expiration_date IS NOT NULL
        AND t.expiration_date BETWEEN ? AND ?
      ORDER BY t.expiration_date ASC
    
      LIMIT 1000
    `).all(start, endD) as any[];

    // Group by month
    const byMonth: Record<string, any[]> = {};
    for (const order of expiring) {
      const month = order.expiration_date.substring(0, 7);
      if (!byMonth[month]) byMonth[month] = [];
      byMonth[month].push(order);
    }

    res.json({ expiring_orders: expiring, by_month: byMonth, total: expiring.length });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 19: Bulk Trespass Order Creation
// ════════════════════════════════════════════════════════════

router.post('/bulk', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { persons, property_id, property_name, location, order_type, reason, conditions, duration_days, authorized_by, notes } = req.body;

    if (!Array.isArray(persons) || persons.length === 0) {
      return res.status(400).json({ error: 'persons array is required', code: 'PERSONS_ARRAY_IS_REQUIRED' });
    }
    if (!location) return res.status(400).json({ error: 'location is required', code: 'LOCATION_IS_REQUIRED' });
    if (persons.length > 50) return res.status(400).json({ error: 'Maximum 50 persons per bulk operation', code: 'MAXIMUM_50_PERSONS_PER' });

    const now = localNow();
    const effectiveDate = now.split('T')[0];
    let exp: string | null = null;
    if (duration_days) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(duration_days, 10));
      exp = d.toISOString().split('T')[0];
    }

    const created: any[] = [];
    const txn = db.transaction(() => {
      for (const person of persons) {
        const order_number = generateOrderNumber(db);
        const info = db.prepare(`
          INSERT INTO trespass_orders (
            order_number, person_id, subject_first_name, subject_last_name, subject_dob, subject_description,
            property_id, property_name, location, order_type, status, reason, conditions,
            duration_days, effective_date, expiration_date,
            issued_by, issued_by_name, authorized_by, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          order_number, person.person_id || null,
          person.first_name || '', person.last_name || '', person.dob || null, person.description || '',
          property_id || null, property_name || '', location,
          order_type || 'trespass_warning', reason || '', conditions || '',
          duration_days || null, effectiveDate, exp,
          user.id, user.full_name, authorized_by || '', notes || '', now, now
        );
        created.push({ id: info.lastInsertRowid, order_number, name: `${person.first_name} ${person.last_name}` });
      }
    });
    txn();

    broadcast('alerts', 'trespass_orders_bulk_created', { count: created.length });
    res.status(201).json({ created: created.length, orders: created });
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 20: Trespass Order PDF Data (with photo + property map)
// ════════════════════════════════════════════════════════════

router.get('/:id/pdf-data', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const order = db.prepare(`
      SELECT t.*, u.full_name as issued_by_display,
        p.first_name as linked_person_first, p.last_name as linked_person_last,
        p.photo_url as person_photo, p.dob as person_dob,
        prop.name as linked_property_name, prop.address as property_address,
        prop.latitude as property_lat, prop.longitude as property_lng,
        su.full_name as served_by_name
      FROM trespass_orders t
      LEFT JOIN users u ON t.issued_by = u.id
      LEFT JOIN persons p ON t.person_id = p.id
      LEFT JOIN properties prop ON t.property_id = prop.id
      LEFT JOIN users su ON t.served_by = su.id
      WHERE t.id = ?
    `).get(req.params.id) as any;

    if (!order) return res.status(404).json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' });

    // Build PDF-ready data
    const pdfData = {
      title: 'TRESPASS ORDER / NOTICE',
      order_number: order.order_number,
      order_type: order.order_type,
      status: order.status,
      subject: {
        first_name: order.subject_first_name,
        last_name: order.subject_last_name,
        dob: order.subject_dob || order.person_dob,
        description: order.subject_description,
        photo_url: order.subject_photo_url || order.person_photo || null,
      },
      property: {
        name: order.property_name || order.linked_property_name,
        address: order.property_address || order.location,
        latitude: order.property_lat,
        longitude: order.property_lng,
      },
      details: {
        reason: order.reason,
        conditions: order.conditions,
        effective_date: order.effective_date,
        expiration_date: order.expiration_date,
        duration_days: order.duration_days,
      },
      issued_by: order.issued_by_display,
      authorized_by: order.authorized_by,
      served_by: order.served_by_name,
      served_at: order.served_at,
      notes: order.notes,
      created_at: order.created_at,
    };

    res.json(pdfData);
  } catch (err: any) {
    console.error('[TrespassOrders] Error:', err?.message);
    res.status(500).json({ error: 'Failed to process trespass orders', code: 'TRESPASSORDERS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 21: Expiration Countdown Display
// ════════════════════════════════════════════════════════════
router.get('/expiring', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string, 10) || 30;
    const orders = db.prepare(`
      SELECT t.*, CAST(JULIANDAY(t.expiration_date) - JULIANDAY('now', 'localtime') AS INTEGER) as days_remaining,
        u.full_name as issued_by_display
      FROM trespass_orders t LEFT JOIN users u ON t.issued_by = u.id
      WHERE t.status = 'active' AND t.expiration_date IS NOT NULL
        AND t.expiration_date <= date('now', '+' || ? || ' days', 'localtime')
        AND t.expiration_date >= date('now', 'localtime')
        AND t.archived_at IS NULL
      ORDER BY t.expiration_date ASC LIMIT 100
    `).all(days);
    res.json({ data: orders, count: orders.length });
  } catch (err: any) { console.error('[TrespassOrders] Expiring error:', err?.message); res.status(500).json({ error: 'Failed to get expiring orders', code: 'EXPIRING_ORDERS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 22: Violation Count Badge
// ════════════════════════════════════════════════════════════
try { const db = getDb(); db.prepare(`CREATE TABLE IF NOT EXISTS trespass_violations (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, violation_date TEXT NOT NULL, location TEXT, description TEXT, officer_id INTEGER, officer_name TEXT, linked_incident_id INTEGER, linked_call_id INTEGER, notes TEXT, created_at TEXT NOT NULL)`).run(); } catch { /* already exists */ }

router.get('/:id/violations', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const order = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(req.params.id);
    if (!order) { res.status(404).json({ error: 'Trespass order not found', code: 'NOT_FOUND' }); return; }
    const violations = db.prepare('SELECT tv.*, u.full_name as officer_display FROM trespass_violations tv LEFT JOIN users u ON tv.officer_id = u.id WHERE tv.order_id = ? ORDER BY tv.violation_date DESC').all(req.params.id);
    res.json({ data: violations, count: violations.length });
  } catch (err: any) { console.error('[TrespassOrders] Violations error:', err?.message); res.status(500).json({ error: 'Failed to get violations', code: 'GET_VIOLATIONS_ERROR' }); }
});

router.post('/:id/violations', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const order = db.prepare('SELECT id, order_number FROM trespass_orders WHERE id = ?').get(req.params.id) as any;
    if (!order) { res.status(404).json({ error: 'Trespass order not found', code: 'NOT_FOUND' }); return; }
    const { violation_date, location, description, linked_incident_id, linked_call_id, notes } = req.body;
    const now = localNow();
    const result = db.prepare('INSERT INTO trespass_violations (order_id, violation_date, location, description, officer_id, officer_name, linked_incident_id, linked_call_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.params.id, violation_date || now, location || null, description || null, user.id, user.full_name, linked_incident_id || null, linked_call_id || null, notes || null, now);
    // Update order status to violated
    db.prepare("UPDATE trespass_orders SET status = 'violated', updated_at = ? WHERE id = ?").run(now, req.params.id);
    auditLog(req, 'CREATE', 'trespass_violation', Number(result.lastInsertRowid), `Violation recorded on order ${order.order_number}`);
    broadcast('alerts', 'trespass_violation_recorded', { order_id: parseInt(req.params.id), order_number: order.order_number });
    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (err: any) { console.error('[TrespassOrders] Create violation error:', err?.message); res.status(500).json({ error: 'Failed to record violation', code: 'CREATE_VIOLATION_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 23: Auto-Archive Expired Orders
// ════════════════════════════════════════════════════════════
router.post('/auto-archive-expired', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const expired = db.prepare(`SELECT id, order_number FROM trespass_orders WHERE status = 'active' AND expiration_date IS NOT NULL AND expiration_date < date('now', 'localtime') AND archived_at IS NULL`).all() as any[];
    if (expired.length === 0) { res.json({ data: { archived_count: 0 } }); return; }
    db.prepare(`UPDATE trespass_orders SET status = 'expired', archived_at = ?, updated_at = ? WHERE status = 'active' AND expiration_date IS NOT NULL AND expiration_date < date('now', 'localtime') AND archived_at IS NULL`).run(now, now);
    for (const o of expired) {
      auditLog(req, 'UPDATE', 'trespass_order', o.id, `Auto-archived expired order ${o.order_number}`);
    }
    broadcast('alerts', 'trespass_orders_auto_archived', { count: expired.length });
    res.json({ data: { archived_count: expired.length, archived_orders: expired.map((o: any) => o.order_number) } });
  } catch (err: any) { console.error('[TrespassOrders] Auto-archive error:', err?.message); res.status(500).json({ error: 'Failed to auto-archive', code: 'AUTO_ARCHIVE_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 24: Trespass Orders CSV Export
// ════════════════════════════════════════════════════════════
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, date_from, date_to } = req.query;
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (date_from) { where += ' AND t.effective_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND t.effective_date <= ?'; params.push(date_to); }
    const rows = db.prepare(`SELECT t.order_number, t.subject_first_name, t.subject_last_name, t.order_type, t.status, t.property_name, t.location, t.reason, t.effective_date, t.expiration_date, t.duration_days, t.issued_by_name, t.authorized_by, t.created_at FROM trespass_orders t ${where} ORDER BY t.created_at DESC LIMIT 10000`).all(...params) as any[];
    const headers = ['Order #', 'First Name', 'Last Name', 'Type', 'Status', 'Property', 'Location', 'Reason', 'Effective', 'Expires', 'Duration', 'Issued By', 'Authorized By', 'Created'];
    const csvRows = rows.map((r: any) => [r.order_number, r.subject_first_name, r.subject_last_name, r.order_type, r.status, (r.property_name || '').replace(/"/g, '""'), (r.location || '').replace(/"/g, '""'), (r.reason || '').replace(/"/g, '""'), r.effective_date, r.expiration_date, r.duration_days, r.issued_by_name, r.authorized_by, r.created_at]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trespass_orders_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err: any) { console.error('[TrespassOrders] Export error:', err?.message); res.status(500).json({ error: 'Failed to export', code: 'EXPORT_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 25: Trespass Orders Statistics
// ════════════════════════════════════════════════════════════
router.get('/stats/overview', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const byStatus = db.prepare(`SELECT status, COUNT(*) as count FROM trespass_orders WHERE archived_at IS NULL GROUP BY status`).all() as any[];
    const byType = db.prepare(`SELECT order_type, COUNT(*) as count FROM trespass_orders WHERE archived_at IS NULL GROUP BY order_type`).all() as any[];
    const activeCount = (db.prepare("SELECT COUNT(*) as count FROM trespass_orders WHERE status = 'active' AND archived_at IS NULL").get() as any).count;
    const expiringThisMonth = (db.prepare(`SELECT COUNT(*) as count FROM trespass_orders WHERE status = 'active' AND expiration_date IS NOT NULL AND expiration_date BETWEEN date('now','localtime') AND date('now','localtime','+30 days') AND archived_at IS NULL`).get() as any).count;
    let totalViolations = 0;
    try { totalViolations = (db.prepare('SELECT COUNT(*) as count FROM trespass_violations').get() as any).count; } catch { /* table may not exist */ }
    const recentlyIssued = (db.prepare("SELECT COUNT(*) as count FROM trespass_orders WHERE created_at >= datetime('now','-7 days','localtime')").get() as any).count;
    res.json({ data: { by_status: Object.fromEntries(byStatus.map((r: any) => [r.status, r.count])), by_type: Object.fromEntries(byType.map((r: any) => [r.order_type, r.count])), active_count: activeCount, expiring_this_month: expiringThisMonth, total_violations: totalViolations, recently_issued_7d: recentlyIssued } });
  } catch (err: any) { console.error('[TrespassOrders] Stats error:', err?.message); res.status(500).json({ error: 'Failed to get stats', code: 'STATS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 26: Trespass Order Data Completeness
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const order = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id) as any;
    if (!order) { res.status(404).json({ error: 'Trespass order not found', code: 'NOT_FOUND' }); return; }
    const requiredFields = ['subject_first_name', 'subject_last_name', 'location', 'reason'];
    const recommendedFields = ['subject_dob', 'subject_description', 'property_name', 'conditions', 'expiration_date', 'authorized_by', 'notes'];
    const filledRequired = requiredFields.filter(f => order[f] != null && String(order[f]).trim() !== '').length;
    const filledRecommended = recommendedFields.filter(f => order[f] != null && String(order[f]).trim() !== '').length;
    const score = Math.round(((filledRequired / requiredFields.length) * 60 + (filledRecommended / recommendedFields.length) * 40));
    res.json({ data: { order_id: order.id, score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', missing_required: requiredFields.filter(f => !order[f] || String(order[f]).trim() === ''), missing_recommended: recommendedFields.filter(f => !order[f] || String(order[f]).trim() === '') } });
  } catch (err: any) { console.error('[TrespassOrders] Completeness error:', err?.message); res.status(500).json({ error: 'Failed to get completeness', code: 'COMPLETENESS_ERROR' }); }
});

export default router;
