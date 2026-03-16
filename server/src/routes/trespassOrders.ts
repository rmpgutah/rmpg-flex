import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { broadcast } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';
import { createNotificationForRoles } from './notifications';
import { resolveDistrict } from '../utils/districtResolver';
import { escapeLike } from '../middleware/sanitize';

const router = Router();
router.use(authenticateToken);

/** Generate next order number: TO-YYYY-NNNN — wrapped in transaction to prevent race conditions */
function generateOrderNumber(db: ReturnType<typeof getDb>): string {
  const year = parseInt(localToday().slice(0, 4), 10);
  const prefix = `TO-${year}-`;
  return db.transaction(() => {
    const row = db.prepare(
      `SELECT order_number FROM trespass_orders WHERE order_number LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 1`
    ).get(`${escapeLike(prefix)}%`) as { order_number: string } | undefined;

    let seq = 1;
    if (row) {
      const parts = row.order_number.split('-');
      const parsed = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
      if (!isNaN(parsed)) seq = parsed + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  })();
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
      where += ` AND ((t.subject_first_name || ' ' || t.subject_last_name) LIKE ? ESCAPE '\\' OR t.order_number LIKE ? ESCAPE '\\' OR t.location LIKE ? ESCAPE '\\' OR t.property_name LIKE ? ESCAPE '\\')`;
      const s = `%${escapeLike(String(search))}%`;
      params.push(s, s, s, s);
    }
    if (archived === 'true') {
      where += ' AND t.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      where += ' AND t.archived_at IS NULL';
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(per_page as string, 10) || 25));
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

    const total = countRow?.total ?? 0;
    res.json({
      data: rows,
      pagination: { page: pageNum, per_page: perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
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
      where += " AND t.location LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(String(address))}%`);
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — Create new trespass order
router.post('/', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
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

    // Auto-fill Section/Zone/Beat from linked call, incident, or property
    let { section_id, zone_id, beat_id, zone_beat } = req.body;
    if (!section_id && !zone_id && !beat_id) {
      if (originating_call_id) {
        const linkedCall = db.prepare('SELECT section_id, zone_id, beat_id, zone_beat FROM calls_for_service WHERE id = ?').get(originating_call_id) as any;
        if (linkedCall) {
          section_id = linkedCall.section_id; zone_id = linkedCall.zone_id;
          beat_id = linkedCall.beat_id; zone_beat = linkedCall.zone_beat;
        }
      } else if (originating_incident_id) {
        const linkedInc = db.prepare('SELECT section_id, zone_id, beat_id, zone_beat FROM incidents WHERE id = ?').get(originating_incident_id) as any;
        if (linkedInc) {
          section_id = linkedInc.section_id; zone_id = linkedInc.zone_id;
          beat_id = linkedInc.beat_id; zone_beat = linkedInc.zone_beat;
        }
      } else if (property_id) {
        // Try to get S/Z/B from property's lat/lng
        const prop = db.prepare('SELECT latitude, longitude FROM properties WHERE id = ?').get(property_id) as any;
        if (prop?.latitude != null && prop?.longitude != null) {
          const district = resolveDistrict(Number(prop.latitude), Number(prop.longitude));
          if (district) {
            section_id = district.section_id; zone_id = district.zone_id;
            beat_id = district.beat_id; zone_beat = district.zone_beat;
          }
        }
      }
    }

    // Auto-calc expiration if duration_days provided
    let exp = expiration_date || null;
    if (!exp && duration_days) {
      const parsedDays = parseInt(duration_days, 10);
      if (!isNaN(parsedDays) && parsedDays > 0 && parsedDays <= 3650) {
        const eff = effective_date ? new Date(effective_date) : new Date();
        eff.setDate(eff.getDate() + parsedDays);
        exp = eff.toISOString().split('T')[0];
      }
    }

    const result = db.prepare(`
      INSERT INTO trespass_orders (
        order_number, person_id, subject_first_name, subject_last_name, subject_dob, subject_description,
        property_id, property_name, location,
        order_type, status, reason, conditions,
        duration_days, effective_date, expiration_date,
        originating_call_id, originating_incident_id,
        issued_by, issued_by_name, authorized_by, notes,
        section_id, zone_id, beat_id, zone_beat,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order_number, person_id || null, subject_first_name, subject_last_name, subject_dob || null, subject_description,
      property_id || null, property_name, location,
      order_type, reason, conditions,
      duration_days ?? null, effective_date || now, exp,
      originating_call_id || null, originating_incident_id || null,
      user.userId, user.fullName, authorized_by, notes,
      section_id || null, zone_id || null, beat_id || null, zone_beat || null,
      now, now
    );

    const created = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(result.lastInsertRowid) as any;
    if (!created) { res.status(500).json({ error: 'Failed to retrieve created trespass order' }); return; }
    // Broadcast minimal payload — no subject PII over WebSocket
    broadcast('alerts', 'trespass_order_created', {
      id: created.id, order_number: created.order_number, property_name: created.property_name,
      order_type: created.order_type, status: created.status,
    });

    // Notify supervisors of new trespass order
    createNotificationForRoles(
      ['admin', 'manager', 'supervisor'],
      'trespass', `Trespass Order: ${created.order_number}`,
      `${created.order_type} — ${created.property_name || 'No property'}`,
      'trespass_order', created.id, 'normal', 'trespass.created', req.user!.userId,
    );

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:id — Update order
router.put('/:id', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
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
      'section_id', 'zone_id', 'beat_id', 'zone_beat',
    ];

    const setClauses: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        params.push(req.body[f] ?? null);
      }
    }

    params.push(req.params.id);
    db.prepare(`UPDATE trespass_orders SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id) as any;
    // Broadcast minimal payload — no subject PII over WebSocket
    broadcast('alerts', 'trespass_order_updated', {
      id: updated.id, order_number: updated.order_number, property_name: updated.property_name,
      order_type: updated.order_type, status: updated.status,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:id/serve — Mark order as served
router.put('/:id/serve', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();
    const existing = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Trespass order not found' }); return; }
    db.prepare(`UPDATE trespass_orders SET status = 'served', served_at = ?, served_by = ?, updated_at = ? WHERE id = ?`)
      .run(now, user.userId, now, req.params.id);
    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id) as any;
    broadcast('alerts', 'trespass_order_served', {
      id: updated.id, order_number: updated.order_number, property_name: updated.property_name,
      order_type: updated.order_type, status: updated.status,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:id/lift — Lift order
router.put('/:id/lift', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const existing = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Trespass order not found' }); return; }
    db.prepare(`UPDATE trespass_orders SET status = 'lifted', updated_at = ? WHERE id = ?`).run(now, req.params.id);
    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id) as any;
    broadcast('alerts', 'trespass_order_lifted', {
      id: updated.id, order_number: updated.order_number, property_name: updated.property_name,
      order_type: updated.order_type, status: updated.status,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:id/violate — Record violation
router.put('/:id/violate', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const existing = db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Trespass order not found' }); return; }
    db.prepare(`UPDATE trespass_orders SET status = 'violated', updated_at = ? WHERE id = ?`).run(now, req.params.id);
    const updated = db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(req.params.id) as any;
    broadcast('alerts', 'trespass_order_violated', {
      id: updated.id, order_number: updated.order_number, property_name: updated.property_name,
      order_type: updated.order_type, status: updated.status,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
