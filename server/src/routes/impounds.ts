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

// GET / — list impounds with optional status filter
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const status = paramStr(req.query.status as string | undefined);

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (status) {
    whereClause += ' AND status = ?';
    params.push(status);
  }

  const rows = db.prepare(`SELECT * FROM vehicle_impounds ${whereClause} ORDER BY created_at DESC`).all(...params);
  res.json(rows);
});

// GET /stats — counts by status
router.get('/stats', (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM vehicle_impounds GROUP BY status
  `).all();
  res.json(rows);
});

// GET /:id — get single impound
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const row = db.prepare('SELECT * FROM vehicle_impounds WHERE id = ?').get(id);
  if (!row) {
    res.status(404).json({ error: 'Impound record not found' });
    return;
  }
  res.json(row);
});

// POST / — create impound
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const {
    vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_vin,
    license_plate, license_state, tow_company, tow_driver,
    lot_location, lot_space, reason, authority,
    hold_flag, hold_reason, daily_fee, tow_fee,
    owner_name, owner_phone, owner_notified, owner_notified_date,
    call_id, incident_id, officer_id, photos, property_inventory, notes, status
  } = req.body;

  const result = db.prepare(`
    INSERT INTO vehicle_impounds (
      vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_vin,
      license_plate, license_state, tow_company, tow_driver,
      lot_location, lot_space, impound_date, reason, authority,
      hold_flag, hold_reason, daily_fee, tow_fee, status,
      owner_name, owner_phone, owner_notified, owner_notified_date,
      call_id, incident_id, officer_id, photos, property_inventory, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
  `).run(
    vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_vin,
    license_plate, license_state, tow_company, tow_driver,
    lot_location, lot_space, reason, authority,
    hold_flag || 0, hold_reason, daily_fee || 25, tow_fee || 150, status || 'impounded',
    owner_name, owner_phone, owner_notified || 0, owner_notified_date,
    call_id, incident_id, officer_id, photos, property_inventory, notes
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /:id — update impound
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const existing = db.prepare('SELECT id FROM vehicle_impounds WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Impound record not found' });
    return;
  }

  const {
    vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_vin,
    license_plate, license_state, tow_company, tow_driver,
    lot_location, lot_space, reason, authority,
    hold_flag, hold_reason, daily_fee, tow_fee,
    owner_name, owner_phone, owner_notified, owner_notified_date,
    call_id, incident_id, officer_id, photos, property_inventory, notes, status
  } = req.body;

  db.prepare(`
    UPDATE vehicle_impounds SET
      vehicle_year = ?, vehicle_make = ?, vehicle_model = ?, vehicle_color = ?, vehicle_vin = ?,
      license_plate = ?, license_state = ?, tow_company = ?, tow_driver = ?,
      lot_location = ?, lot_space = ?, reason = ?, authority = ?,
      hold_flag = ?, hold_reason = ?, daily_fee = ?, tow_fee = ?,
      owner_name = ?, owner_phone = ?, owner_notified = ?, owner_notified_date = ?,
      call_id = ?, incident_id = ?, officer_id = ?, photos = ?, property_inventory = ?, notes = ?, status = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_vin,
    license_plate, license_state, tow_company, tow_driver,
    lot_location, lot_space, reason, authority,
    hold_flag, hold_reason, daily_fee, tow_fee,
    owner_name, owner_phone, owner_notified, owner_notified_date,
    call_id, incident_id, officer_id, photos, property_inventory, notes, status,
    id
  );

  res.json({ success: true });
});

// PUT /:id/release — release vehicle, calculate total fees
router.put('/:id/release', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const existing = db.prepare('SELECT * FROM vehicle_impounds WHERE id = ?').get(id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Impound record not found' });
    return;
  }

  const { released_to, release_notes } = req.body;

  // Calculate days impounded and total fees
  const impoundDate = new Date(existing.impound_date);
  const releaseDate = new Date();
  const diffMs = releaseDate.getTime() - impoundDate.getTime();
  const days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const totalFees = (days * (existing.daily_fee || 0)) + (existing.tow_fee || 0);

  db.prepare(`
    UPDATE vehicle_impounds SET
      status = 'released', release_date = datetime('now','localtime'),
      released_to = ?, release_notes = ?, days_stored = ?, total_fees = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(released_to, release_notes, days, totalFees, id);

  res.json({ success: true, days, total_fees: totalFees });
});

// DELETE /:id — admin only
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const existing = db.prepare('SELECT id FROM vehicle_impounds WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Impound record not found' });
    return;
  }

  db.prepare('DELETE FROM vehicle_impounds WHERE id = ?').run(id);
  res.json({ success: true });
});

export default router;
