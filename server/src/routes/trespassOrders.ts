import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { broadcast } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';

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
    seq = parseInt(parts[2], 10) + 1;
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
    res.status(500).json({ error: err.message });
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
    `).all(...params);

    res.json({ orders: rows, count: rows.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — Single order detail
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
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
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Trespass order not found' });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

    if (!subject_first_name || !subject_last_name) return res.status(400).json({ error: 'Subject name is required' });
    if (!location) return res.status(400).json({ error: 'Location is required' });

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
    broadcast('alerts', 'trespass_order_created', created);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — Update order
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const existing = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Trespass order not found' });

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
    broadcast('alerts', 'trespass_order_updated', updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id/serve — Mark order as served
router.put('/:id/serve', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();
    db.prepare(`UPDATE trespass_orders SET status = 'served', served_at = ?, served_by = ?, updated_at = ? WHERE id = ?`)
      .run(now, user.id, now, req.params.id);
    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id);
    broadcast('alerts', 'trespass_order_served', updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id/lift — Lift order
router.put('/:id/lift', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    db.prepare(`UPDATE trespass_orders SET status = 'lifted', updated_at = ? WHERE id = ?`).run(now, req.params.id);
    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id);
    broadcast('alerts', 'trespass_order_lifted', updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id/violate — Record violation
router.put('/:id/violate', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    db.prepare(`UPDATE trespass_orders SET status = 'violated', updated_at = ? WHERE id = ?`).run(now, req.params.id);
    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id);
    broadcast('alerts', 'trespass_order_violated', updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
