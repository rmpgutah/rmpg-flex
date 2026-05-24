// Trespass Orders routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow, localToday } from '../worker-middleware/timeUtils';

export function mountTrespassOrderRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  async function generateOrderNumber(db: D1Db): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `TO-${year}-`;
    const row = await db.prepare('SELECT order_number FROM trespass_orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1').get(`${prefix}%`) as { order_number: string } | undefined;
    let seq = 1;
    if (row) {
      const parts = row.order_number.split('-');
      const parsed = parseInt(parts[2], 10);
      seq = isNaN(parsed) ? 1 : parsed + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  // GET /
  api.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { status, property_id, search, archived, page = '1', per_page = '100000' } = q;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (property_id) { where += ' AND t.property_id = ?'; params.push(property_id); }
    if (search) {
      where += " AND (t.subject_first_name || ' ' || t.subject_last_name LIKE ? OR t.order_number LIKE ? OR t.location LIKE ? OR t.property_name LIKE ?)";
      const s = `%${search}%`; params.push(s, s, s, s);
    }
    if (archived === 'true') { where += ' AND t.archived_at IS NOT NULL'; }
    else if (archived !== 'all') { where += ' AND t.archived_at IS NULL'; }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(100000, Math.max(1, parseInt(per_page, 10) || 100000));
    const offset = (pageNum - 1) * perPage;

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM trespass_orders t ${where}`).get(...params) as any;
    const rows = await db.prepare(`
      SELECT t.*, u.full_name as issued_by_display,
        p.first_name as linked_person_first, p.last_name as linked_person_last,
        prop.name as linked_property_name
      FROM trespass_orders t
      LEFT JOIN users u ON t.issued_by = u.id
      LEFT JOIN persons p ON t.person_id = p.id
      LEFT JOIN properties prop ON t.property_id = prop.id
      ${where}
      ORDER BY t.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, perPage, offset);

    return c.json({ data: rows, pagination: { page: pageNum, per_page: perPage, total: countRow.total, totalPages: Math.ceil(countRow.total / perPage) } });
  });

  // GET /check
  api.get('/check', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { property_id, address } = q;

    let where = "WHERE t.status = 'active' AND (t.expiration_date IS NULL OR t.expiration_date > datetime('now','localtime'))";
    const params: any[] = [];
    if (property_id) { where += ' AND t.property_id = ?'; params.push(property_id); }
    else if (address) { where += ' AND t.location LIKE ?'; params.push(`%${address}%`); }
    else return c.json({ orders: [], count: 0 });

    const rows = await db.prepare(`
      SELECT t.id, t.order_number, t.subject_first_name, t.subject_last_name,
        t.subject_description, t.order_type, t.status, t.reason, t.effective_date, t.expiration_date,
        t.property_name, t.location
      FROM trespass_orders t ${where}
      ORDER BY t.created_at DESC LIMIT 1000
    `).all(...params);

    return c.json({ orders: rows, count: rows.length });
  });

  // GET /:id
  api.get('/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid trespass order ID', code: 'INVALID_TRESPASS_ORDER_ID' }, 400);
    const row = await db.prepare(`
      SELECT t.*, u.full_name as issued_by_display,
        p.first_name as linked_person_first, p.last_name as linked_person_last,
        prop.name as linked_property_name, su.full_name as served_by_name
      FROM trespass_orders t
      LEFT JOIN users u ON t.issued_by = u.id
      LEFT JOIN persons p ON t.person_id = p.id
      LEFT JOIN properties prop ON t.property_id = prop.id
      LEFT JOIN users su ON t.served_by = su.id
      WHERE t.id = ?
    `).get(id);
    if (!row) return c.json({ error: 'Trespass order not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: row });
  });

  // POST /
  api.post('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const order_number = await generateOrderNumber(db);
    const now = localNow();
    const body = await c.req.json();

    const { person_id, subject_first_name, subject_last_name, subject_dob, subject_description,
      property_id, property_name, location,
      order_type = 'trespass_warning', reason, conditions,
      duration_days, effective_date, expiration_date,
      originating_call_id, originating_incident_id,
      authorized_by, notes,
      section_id, sector_id, zone_id, beat_id, zone_beat,
      subject_photo_url, served_at, served_by } = body;

    if (!subject_first_name || !subject_last_name) return c.json({ error: 'Subject name is required', code: 'MISSING_NAME' }, 400);
    if (!location?.trim()) return c.json({ error: 'Location is required', code: 'MISSING_LOCATION' }, 400);

    if (duration_days !== undefined && duration_days !== null) {
      const dur = parseInt(duration_days, 10);
      if (isNaN(dur) || dur < 1 || dur > 3650) return c.json({ error: 'duration_days must be between 1 and 3650', code: 'INVALID_DURATION' }, 400);
    }

    let exp = expiration_date || null;
    if (!exp && duration_days) {
      const eff = effective_date ? new Date(effective_date) : new Date();
      eff.setDate(eff.getDate() + parseInt(duration_days, 10));
      exp = eff.toISOString().split('T')[0];
    }

    const result = await db.prepare(`
      INSERT INTO trespass_orders (
        order_number, person_id, subject_first_name, subject_last_name, subject_dob, subject_description,
        property_id, property_name, location,
        order_type, status, reason, conditions,
        duration_days, effective_date, expiration_date,
        originating_call_id, originating_incident_id,
        issued_by, issued_by_name, authorized_by, notes,
        section_id, zone_id, beat_id, zone_beat,
        subject_photo_url, served_at, served_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order_number, person_id || null, subject_first_name, subject_last_name, subject_dob || null, subject_description,
      property_id || null, property_name, location,
      order_type, reason, conditions,
      duration_days || null, effective_date || now, exp,
      originating_call_id || null, originating_incident_id || null,
      user.userId, user.username, authorized_by, notes,
      section_id || sector_id || null, zone_id || null, beat_id || null, zone_beat || null,
      subject_photo_url || null, served_at || null, served_by || null,
      now, now);

    const created = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(result.meta.last_row_id);
    return c.json({ data: created }, 201);
  });

  // DELETE /:id
  api.delete('/:id', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }, 404);
    await db.prepare('DELETE FROM trespass_orders WHERE id = ?').run(id);
    return c.json({ success: true, message: `Trespass order ${existing.order_number} deleted` });
  });

  // PUT /:id
  api.put('/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const id = paramNum(c.req.param('id'));
    const existing = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const fields = [
      'person_id', 'subject_first_name', 'subject_last_name', 'subject_dob', 'subject_description',
      'property_id', 'property_name', 'location',
      'order_type', 'status', 'reason', 'conditions',
      'duration_days', 'effective_date', 'expiration_date',
      'authorized_by', 'notes', 'served_at', 'served_by',
      'originating_call_id', 'originating_incident_id',
      'issued_by', 'issued_by_name',
      'section_id', 'zone_id', 'beat_id', 'zone_beat', 'subject_photo_url',
    ];

    const setClauses: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (body[f] !== undefined) { setClauses.push(`${f} = ?`); params.push(body[f] || null); }
    }
    if (body.sector_id !== undefined && body.section_id === undefined) {
      setClauses.push('section_id = ?');
      params.push(body.sector_id || null);
    }

    params.push(id);
    await db.prepare(`UPDATE trespass_orders SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

    const updated = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id);
    return c.json({ data: updated });
  });

  // PUT /:id/serve
  api.put('/:id/serve', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const now = localNow();
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(id);
    if (!existing) return c.json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }, 404);

    await db.prepare("UPDATE trespass_orders SET status = 'served', served_at = ?, served_by = ?, updated_at = ? WHERE id = ?").run(now, user.userId, now, id);
    const updated = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id);
    return c.json({ data: updated });
  });

  // PUT /:id/lift
  api.put('/:id/lift', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(id);
    if (!existing) return c.json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }, 404);

    await db.prepare("UPDATE trespass_orders SET status = 'lifted', updated_at = ? WHERE id = ?").run(now, id);
    const updated = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id);
    return c.json({ data: updated });
  });

  // PUT /:id/violate
  api.put('/:id/violate', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(id);
    if (!existing) return c.json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }, 404);

    await db.prepare("UPDATE trespass_orders SET status = 'violated', updated_at = ? WHERE id = ?").run(now, id);
    const updated = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id);
    return c.json({ data: updated });
  });

  // POST /:id/renew
  api.post('/:id/renew', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const now = localNow();
    const id = paramNum(c.req.param('id'));
    const existing = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }, 404);

    const order_number = await generateOrderNumber(db);
    const duration = existing.duration_days || 365;
    const effectiveDate = new Date();
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + duration);

    const result = await db.prepare(`
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
      user.userId, user.username, existing.authorized_by,
      `Renewed from ${existing.order_number}. ${existing.notes || ''}`.trim(),
      now, now);

    await db.prepare("UPDATE trespass_orders SET archived_at = ?, notes = COALESCE(notes, '') || ? WHERE id = ?")
      .run(now, `\nArchived: Renewed as ${order_number}`, existing.id);

    const created = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(result.meta.last_row_id);
    return c.json({ data: created }, 201);
  });

  // PUT /:id/photo
  api.put('/:id/photo', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const existing = await db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(id);
    if (!existing) return c.json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const { photo_url } = body;
    if (!photo_url) return c.json({ error: 'photo_url is required', code: 'PHOTOURL_IS_REQUIRED' }, 400);

    const now = localNow();
    await db.prepare('UPDATE trespass_orders SET subject_photo_url = ?, updated_at = ? WHERE id = ?').run(photo_url, now, id);
    const updated = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(id);
    return c.json({ data: updated });
  });

  // GET /detect-violation
  api.get('/detect-violation', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { person_id, person_name, property_id, address } = q;

    let where = "WHERE t.status = 'active' AND (t.expiration_date IS NULL OR t.expiration_date > datetime('now','localtime'))";
    const params: any[] = [];

    if (person_id) { where += ' AND t.person_id = ?'; params.push(person_id); }
    else if (person_name) {
      const nameParts = (person_name as string).split(' ');
      if (nameParts.length >= 2) {
        where += ' AND (LOWER(t.subject_first_name) = LOWER(?) AND LOWER(t.subject_last_name) = LOWER(?))';
        params.push(nameParts[0], nameParts[nameParts.length - 1]);
      } else {
        where += ' AND (LOWER(t.subject_first_name) = LOWER(?) OR LOWER(t.subject_last_name) = LOWER(?))';
        params.push(nameParts[0], nameParts[0]);
      }
    } else return c.json({ violation_detected: false, orders: [] });

    if (property_id) { where += ' AND t.property_id = ?'; params.push(property_id); }
    else if (address) { where += ' AND t.location LIKE ?'; params.push(`%${address}%`); }

    const orders = await db.prepare(`
      SELECT t.id, t.order_number, t.subject_first_name, t.subject_last_name,
             t.property_name, t.location, t.order_type, t.reason, t.effective_date, t.expiration_date
      FROM trespass_orders t ${where} LIMIT 1000
    `).all(...params) as any[];

    return c.json({ violation_detected: orders.length > 0, orders, alert_message: orders.length > 0 ? `TRESPASS ALERT: ${orders.length} active trespass order(s) found for this person at this location` : null });
  });

  // GET /expiration-calendar
  api.get('/expiration-calendar', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const start = (q.start_date as string) || localToday();
    const endD = (q.end_date as string) || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const expiring = await db.prepare(`
      SELECT t.id, t.order_number, t.subject_first_name, t.subject_last_name,
             t.property_name, t.location, t.order_type, t.status,
             t.expiration_date, t.effective_date,
             JULIANDAY(t.expiration_date) - JULIANDAY('now') as days_remaining
      FROM trespass_orders t
      WHERE t.status = 'active' AND t.expiration_date IS NOT NULL
        AND t.expiration_date BETWEEN ? AND ?
      ORDER BY t.expiration_date ASC LIMIT 1000
    `).all(start, endD) as any[];

    const byMonth: Record<string, any[]> = {};
    for (const order of expiring) {
      const month = order.expiration_date.substring(0, 7);
      if (!byMonth[month]) byMonth[month] = [];
      byMonth[month].push(order);
    }

    return c.json({ expiring_orders: expiring, by_month: byMonth, total: expiring.length });
  });

  // POST /bulk
  api.post('/bulk', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { persons, property_id, property_name, location, order_type, reason, conditions, duration_days, authorized_by, notes } = body;

    if (!Array.isArray(persons) || persons.length === 0) return c.json({ error: 'persons array is required', code: 'PERSONS_ARRAY_IS_REQUIRED' }, 400);
    if (!location) return c.json({ error: 'location is required', code: 'LOCATION_IS_REQUIRED' }, 400);
    if (persons.length > 50) return c.json({ error: 'Maximum 50 persons per bulk operation', code: 'MAXIMUM_50_PERSONS_PER' }, 400);

    const now = localNow();
    const effectiveDate = now.split('T')[0];
    let exp: string | null = null;
    if (duration_days) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(duration_days, 10));
      exp = d.toISOString().split('T')[0];
    }

    const created: any[] = [];
    for (const person of persons) {
      const order_number = await generateOrderNumber(db);
      const info = await db.prepare(`
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
        user.userId, user.username, authorized_by || '', notes || '', now, now);
      created.push({ id: info.meta.last_row_id, order_number, name: `${person.first_name} ${person.last_name}` });
    }

    return c.json({ created: created.length, orders: created }, 201);
  });

  // GET /:id/pdf-data
  api.get('/:id/pdf-data', async (c) => {
    const db = new D1Db(c.env.DB);
    const order = await db.prepare(`
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
    `).get(paramNum(c.req.param('id'))) as any;

    if (!order) return c.json({ error: 'Trespass order not found', code: 'TRESPASS_ORDER_NOT_FOUND' }, 404);

    return c.json({
      title: 'TRESPASS ORDER / NOTICE',
      order_number: order.order_number,
      order_type: order.order_type,
      status: order.status,
      subject: { first_name: order.subject_first_name, last_name: order.subject_last_name, dob: order.subject_dob || order.person_dob, description: order.subject_description, photo_url: order.subject_photo_url || order.person_photo || null },
      property: { name: order.property_name || order.linked_property_name, address: order.property_address || order.location, latitude: order.property_lat, longitude: order.property_lng },
      details: { reason: order.reason, conditions: order.conditions, effective_date: order.effective_date, expiration_date: order.expiration_date, duration_days: order.duration_days },
      issued_by: order.issued_by_display,
      authorized_by: order.authorized_by,
      served_by: order.served_by_name,
      served_at: order.served_at,
      notes: order.notes,
      created_at: order.created_at,
    });
  });

  // GET /expiring
  api.get('/expiring', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const days = parseInt(q.days || '30', 10) || 30;
    const orders = await db.prepare(`
      SELECT t.*, CAST(JULIANDAY(t.expiration_date) - JULIANDAY('now', 'localtime') AS INTEGER) as days_remaining,
        u.full_name as issued_by_display
      FROM trespass_orders t LEFT JOIN users u ON t.issued_by = u.id
      WHERE t.status = 'active' AND t.expiration_date IS NOT NULL
        AND t.expiration_date <= date('now', '+' || ? || ' days', 'localtime')
        AND t.expiration_date >= date('now', 'localtime')
        AND t.archived_at IS NULL
      ORDER BY t.expiration_date ASC LIMIT 100
    `).all(days);
    return c.json({ data: orders, count: orders.length });
  });

  // Violations sub-routes

  // GET /:id/violations
  api.get('/:id/violations', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const order = await db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(id);
    if (!order) return c.json({ error: 'Trespass order not found', code: 'NOT_FOUND' }, 404);
    try {
      const violations = await db.prepare('SELECT tv.*, u.full_name as officer_display FROM trespass_violations tv LEFT JOIN users u ON tv.officer_id = u.id WHERE tv.order_id = ? ORDER BY tv.violation_date DESC').all(id);
      return c.json({ data: violations, count: violations.length });
    } catch { return c.json({ data: [], count: 0 }); }
  });

  // POST /:id/violations
  api.post('/:id/violations', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const id = paramNum(c.req.param('id'));
    const order = await db.prepare('SELECT id, order_number FROM trespass_orders WHERE id = ?').get(id) as any;
    if (!order) return c.json({ error: 'Trespass order not found', code: 'NOT_FOUND' }, 404);

    const body = await c.req.json();
    const { violation_date, location, description, linked_incident_id, linked_call_id, action_taken, notes } = body;
    const now = localNow();

    const result = await db.prepare('INSERT INTO trespass_violations (order_id, violation_date, location, description, officer_id, officer_name, linked_incident_id, linked_call_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, violation_date || now, location || null, description || null, user.userId, user.username, linked_incident_id || null, linked_call_id || null, action_taken || notes || null, now);

    await db.prepare("UPDATE trespass_orders SET status = 'violated', updated_at = ? WHERE id = ?").run(now, id);

    const created = await db.prepare('SELECT * FROM trespass_violations WHERE id = ?').get(result.meta.last_row_id);
    return c.json({ data: created }, 201);
  });

  // PUT /:id/violations/:violationId
  api.put('/:id/violations/:violationId', requireRole('dispatcher', 'supervisor', 'admin', 'manager', 'officer'), async (c) => {
    const db = new D1Db(c.env.DB);
    const orderId = paramNum(c.req.param('id'));
    const violationId = paramNum(c.req.param('violationId'));

    const order = await db.prepare('SELECT id FROM trespass_orders WHERE id = ?').get(orderId);
    if (!order) return c.json({ error: 'Trespass order not found', code: 'NOT_FOUND' }, 404);

    const violation = await db.prepare('SELECT * FROM trespass_violations WHERE id = ? AND order_id = ?').get(violationId, orderId);
    if (!violation) return c.json({ error: 'Violation not found', code: 'VIOLATION_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const fieldMap: Record<string, string> = {
      violation_date: 'violation_date', location: 'location', description: 'description',
      linked_incident_id: 'linked_incident_id', linked_call_id: 'linked_call_id', notes: 'notes',
    };
    const setClauses: string[] = [];
    const values: any[] = [];
    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (body[bodyKey] !== undefined) { setClauses.push(`${dbCol} = ?`); values.push(body[bodyKey] ?? null); }
    }
    if (setClauses.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    values.push(violationId);
    await db.prepare(`UPDATE trespass_violations SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const updated = await db.prepare('SELECT * FROM trespass_violations WHERE id = ?').get(violationId);
    return c.json({ data: updated });
  });

  // DELETE /:id/violations/:violationId
  api.delete('/:id/violations/:violationId', requireRole('supervisor', 'admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const orderId = paramNum(c.req.param('id'));
    const violationId = paramNum(c.req.param('violationId'));

    const order = await db.prepare('SELECT id, order_number FROM trespass_orders WHERE id = ?').get(orderId) as any;
    if (!order) return c.json({ error: 'Trespass order not found', code: 'NOT_FOUND' }, 404);

    const violation = await db.prepare('SELECT * FROM trespass_violations WHERE id = ? AND order_id = ?').get(violationId, orderId);
    if (!violation) return c.json({ error: 'Violation not found', code: 'VIOLATION_NOT_FOUND' }, 404);

    await db.prepare('DELETE FROM trespass_violations WHERE id = ?').run(violationId);

    const remaining = await db.prepare('SELECT COUNT(*) as cnt FROM trespass_violations WHERE order_id = ?').get(orderId) as any;
    if (remaining.cnt === 0) {
      await db.prepare("UPDATE trespass_orders SET status = 'active', updated_at = ? WHERE id = ? AND status = 'violated'").run(localNow(), orderId);
    }
    return c.json({ success: true });
  });

  // POST /auto-archive-expired
  api.post('/auto-archive-expired', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const expired = await db.prepare("SELECT id, order_number FROM trespass_orders WHERE status = 'active' AND expiration_date IS NOT NULL AND expiration_date < date('now', 'localtime') AND archived_at IS NULL").all() as any[];
    if (expired.length === 0) return c.json({ data: { archived_count: 0 } });

    await db.prepare("UPDATE trespass_orders SET status = 'expired', archived_at = ?, updated_at = ? WHERE status = 'active' AND expiration_date IS NOT NULL AND expiration_date < date('now', 'localtime') AND archived_at IS NULL").run(now, now);
    return c.json({ data: { archived_count: expired.length, archived_orders: expired.map((o: any) => o.order_number) } });
  });

  // GET /export/csv
  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { status, date_from, date_to } = q;
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (date_from) { where += ' AND t.effective_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND t.effective_date <= ?'; params.push(date_to); }

    const rows = await db.prepare(`SELECT t.order_number, t.subject_first_name, t.subject_last_name, t.order_type, t.status, t.property_name, t.location, t.reason, t.effective_date, t.expiration_date, t.duration_days, t.issued_by_name, t.authorized_by, t.created_at FROM trespass_orders t ${where} ORDER BY t.created_at DESC LIMIT 10000`).all(...params) as any[];

    const headers = ['Order #', 'First Name', 'Last Name', 'Type', 'Status', 'Property', 'Location', 'Reason', 'Effective', 'Expires', 'Duration', 'Issued By', 'Authorized By', 'Created'];
    const csvRows = rows.map((r: any) => [r.order_number, r.subject_first_name, r.subject_last_name, r.order_type, r.status, (r.property_name || '').replace(/"/g, '""'), (r.location || '').replace(/"/g, '""'), (r.reason || '').replace(/"/g, '""'), r.effective_date, r.expiration_date, r.duration_days, r.issued_by_name, r.authorized_by, r.created_at]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', `attachment; filename="trespass_orders_${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv);
  });

  // GET /stats/overview
  api.get('/stats/overview', async (c) => {
    const db = new D1Db(c.env.DB);
    const byStatus = await db.prepare('SELECT status, COUNT(*) as count FROM trespass_orders WHERE archived_at IS NULL GROUP BY status').all() as any[];
    const byType = await db.prepare('SELECT order_type, COUNT(*) as count FROM trespass_orders WHERE archived_at IS NULL GROUP BY order_type').all() as any[];
    const activeCount = (await db.prepare("SELECT COUNT(*) as count FROM trespass_orders WHERE status = 'active' AND archived_at IS NULL").get() as any).count;
    const expiringThisMonth = (await db.prepare("SELECT COUNT(*) as count FROM trespass_orders WHERE status = 'active' AND expiration_date IS NOT NULL AND expiration_date BETWEEN date('now','localtime') AND date('now','localtime','+30 days') AND archived_at IS NULL").get() as any).count;
    let totalViolations = 0;
    try { totalViolations = (await db.prepare('SELECT COUNT(*) as count FROM trespass_violations').get() as any).count; } catch { /* table may not exist */ }
    const recentlyIssued = (await db.prepare("SELECT COUNT(*) as count FROM trespass_orders WHERE created_at >= datetime('now','-7 days','localtime')").get() as any).count;

    return c.json({ data: { by_status: Object.fromEntries(byStatus.map((r: any) => [r.status, r.count])), by_type: Object.fromEntries(byType.map((r: any) => [r.order_type, r.count])), active_count: activeCount, expiring_this_month: expiringThisMonth, total_violations: totalViolations, recently_issued_7d: recentlyIssued } });
  });

  // GET /:id/completeness
  api.get('/:id/completeness', async (c) => {
    const db = new D1Db(c.env.DB);
    const order = await db.prepare('SELECT * FROM trespass_orders WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!order) return c.json({ error: 'Trespass order not found', code: 'NOT_FOUND' }, 404);

    const requiredFields = ['subject_first_name', 'subject_last_name', 'location', 'reason'];
    const recommendedFields = ['subject_dob', 'subject_description', 'property_name', 'conditions', 'expiration_date', 'authorized_by', 'notes'];
    const filledRequired = requiredFields.filter(f => order[f] != null && String(order[f]).trim() !== '').length;
    const filledRecommended = recommendedFields.filter(f => order[f] != null && String(order[f]).trim() !== '').length;
    const score = Math.round(((filledRequired / requiredFields.length) * 60 + (filledRecommended / recommendedFields.length) * 40));

    return c.json({ data: { order_id: order.id, score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', missing_required: requiredFields.filter(f => !order[f] || String(order[f]).trim() === ''), missing_recommended: recommendedFields.filter(f => !order[f] || String(order[f]).trim() === '') } });
  });

  app.route('/api/trespass-orders', api);
}
