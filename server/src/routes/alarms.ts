import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';

const router = Router();

router.use(authenticateToken);

router.param('id', (req: Request, _res: Response, next: NextFunction, value: string) => {
  if (!/^\d+$/.test(value)) {
    next('route');
    return;
  }
  next();
});

// ---------- Permits ----------

// GET /permits — list all alarm permits
router.get('/permits', (req: Request, res: Response) => {
  const db = getDb();
  const status = paramStr(req.query.status as string | undefined);

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (status) {
    whereClause += ' AND status = ?';
    params.push(status);
  }

  const rows = db.prepare(`SELECT * FROM alarm_permits ${whereClause} ORDER BY created_at DESC`).all(...params);
  res.json(rows);
});

// GET /permits/:id — get single permit with its activations
router.get('/permits/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const permit = db.prepare('SELECT * FROM alarm_permits WHERE id = ?').get(id);
  if (!permit) {
    res.status(404).json({ error: 'Alarm permit not found' });
    return;
  }

  const activations = db.prepare(
    'SELECT * FROM alarm_activations WHERE permit_id = ? ORDER BY activation_date DESC'
  ).all(id);

  res.json({ ...permit as any, activations });
});

// POST /permits — create permit
router.post('/permits', (req: Request, res: Response) => {
  const db = getDb();
  const {
    permit_number, business_name, contact_name, contact_phone, contact_email,
    address, alarm_type, alarm_company, status, notes
  } = req.body;

  const result = db.prepare(`
    INSERT INTO alarm_permits (
      permit_number, business_name, contact_name, contact_phone, contact_email,
      address, alarm_type, alarm_company, false_alarm_count, status, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
  `).run(
    permit_number, business_name, contact_name, contact_phone, contact_email,
    address, alarm_type, alarm_company, status || 'active', notes
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /permits/:id — update permit
router.put('/permits/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const existing = db.prepare('SELECT id FROM alarm_permits WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Alarm permit not found' });
    return;
  }

  const {
    permit_number, business_name, contact_name, contact_phone, contact_email,
    address, alarm_type, alarm_company, status, notes
  } = req.body;

  db.prepare(`
    UPDATE alarm_permits SET
      permit_number = ?, business_name = ?, contact_name = ?, contact_phone = ?, contact_email = ?,
      address = ?, alarm_type = ?, alarm_company = ?, status = ?, notes = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    permit_number, business_name, contact_name, contact_phone, contact_email,
    address, alarm_type, alarm_company, status, notes,
    id
  );

  res.json({ success: true });
});

// ---------- Activations ----------

// GET /activations — list activations with optional filters
router.get('/activations', (req: Request, res: Response) => {
  const db = getDb();
  const permit_id = paramStr(req.query.permit_id as string | undefined);
  const is_false_alarm = paramStr(req.query.is_false_alarm as string | undefined);

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (permit_id) {
    whereClause += ' AND a.permit_id = ?';
    params.push(parseInt(permit_id, 10));
  }
  if (is_false_alarm) {
    whereClause += ' AND a.is_false_alarm = ?';
    params.push(parseInt(is_false_alarm, 10));
  }

  const rows = db.prepare(`
    SELECT a.*, p.permit_number, p.business_name, p.address
    FROM alarm_activations a
    LEFT JOIN alarm_permits p ON a.permit_id = p.id
    ${whereClause}
    ORDER BY a.activation_date DESC
  `).all(...params);
  res.json(rows);
});

// POST /activations — create activation, auto-increment false_alarm_count if false alarm
router.post('/activations', (req: Request, res: Response) => {
  const db = getDb();
  const {
    permit_id, activation_date, alarm_type, responding_officer, disposition,
    is_false_alarm, notes
  } = req.body;

  // Verify permit exists
  const permit = db.prepare('SELECT id FROM alarm_permits WHERE id = ?').get(permit_id);
  if (!permit) {
    res.status(404).json({ error: 'Alarm permit not found' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO alarm_activations (
      permit_id, activation_date, alarm_type, responding_officer, disposition,
      is_false_alarm, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `).run(
    permit_id, activation_date || new Date().toISOString(), alarm_type,
    responding_officer, disposition, is_false_alarm ? 1 : 0, notes
  );

  // Auto-increment false_alarm_count on the permit
  if (is_false_alarm) {
    db.prepare(`
      UPDATE alarm_permits SET
        false_alarm_count = false_alarm_count + 1,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(permit_id);
  }

  res.json({ success: true, id: result.lastInsertRowid });
});

// ---------- Stats ----------

// GET /stats — false alarm stats by permit
router.get('/stats', (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.id, p.permit_number, p.business_name, p.address, p.false_alarm_count,
      COUNT(a.id) as total_activations,
      SUM(CASE WHEN a.is_false_alarm = 1 THEN 1 ELSE 0 END) as false_alarm_activations
    FROM alarm_permits p
    LEFT JOIN alarm_activations a ON a.permit_id = p.id
    GROUP BY p.id
    ORDER BY p.false_alarm_count DESC
  `).all();
  res.json(rows);
});

export default router;
