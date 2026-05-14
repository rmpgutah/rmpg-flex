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

// GET / — list cases with optional filtering
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const case_type = paramStr(req.query.case_type as string | undefined);
  const status = paramStr(req.query.status as string | undefined);

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (case_type) {
    whereClause += ' AND case_type = ?';
    params.push(case_type);
  }
  if (status) {
    whereClause += ' AND status = ?';
    params.push(status);
  }

  const rows = db.prepare(`SELECT * FROM animal_control_cases ${whereClause} ORDER BY created_at DESC`).all(...params);
  res.json(rows);
});

// GET /stats — counts by type and status
router.get('/stats', (req: Request, res: Response) => {
  const db = getDb();
  const byType = db.prepare('SELECT case_type, COUNT(*) as count FROM animal_control_cases GROUP BY case_type').all();
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM animal_control_cases GROUP BY status').all();
  res.json({ by_type: byType, by_status: byStatus });
});

// GET /:id — get single case
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const row = db.prepare('SELECT * FROM animal_control_cases WHERE id = ?').get(id);
  if (!row) {
    res.status(404).json({ error: 'Animal control case not found' });
    return;
  }
  res.json(row);
});

// POST / — create case with auto-generated case_number (AC-YY-NNNNN)
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const {
    case_type, status, animal_type, animal_breed, animal_color, animal_name,
    animal_sex, microchip_number,
    owner_name, owner_phone, owner_address, location, latitude, longitude,
    description, disposition, assigned_officer_id, linked_incident_id,
    quarantine_start, quarantine_end, vaccination_status, impound_date, release_date,
    priority, notes
  } = req.body;

  // Auto-generate case number: AC-YY-NNNNN
  const year = new Date().getFullYear().toString().slice(-2);
  const lastCase = db.prepare(
    `SELECT case_number FROM animal_control_cases WHERE case_number LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`AC-${year}-%`) as any;

  let seq = 1;
  if (lastCase) {
    const parts = lastCase.case_number.split('-');
    seq = parseInt(parts[2], 10) + 1;
  }
  const case_number = `AC-${year}-${String(seq).padStart(5, '0')}`;

  const result = db.prepare(`
    INSERT INTO animal_control_cases (
      case_number, case_type, animal_type, animal_breed, animal_color, animal_name,
      animal_sex, microchip_number,
      owner_name, owner_address, owner_phone, location, latitude, longitude,
      description, status, disposition, assigned_officer_id, linked_incident_id,
      quarantine_start, quarantine_end, vaccination_status, impound_date, release_date,
      notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
  `).run(
    case_number, case_type || 'complaint', animal_type, animal_breed, animal_color, animal_name,
    animal_sex, microchip_number,
    owner_name, owner_address, owner_phone, location, latitude, longitude,
    description, status || 'open', disposition, assigned_officer_id, linked_incident_id,
    quarantine_start, quarantine_end, vaccination_status, impound_date, release_date,
    notes
  );

  res.json({ success: true, id: result.lastInsertRowid, case_number });
});

// PUT /:id — update case
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const existing = db.prepare('SELECT id FROM animal_control_cases WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Animal control case not found' });
    return;
  }

  const {
    case_type, status, animal_type, animal_breed, animal_color, animal_name,
    animal_sex, microchip_number,
    owner_name, owner_phone, owner_address, location, latitude, longitude,
    description, disposition, assigned_officer_id, linked_incident_id,
    quarantine_start, quarantine_end, vaccination_status, impound_date, release_date,
    priority, notes
  } = req.body;

  db.prepare(`
    UPDATE animal_control_cases SET
      case_type = ?, status = ?, animal_type = ?, animal_breed = ?, animal_color = ?, animal_name = ?,
      animal_sex = ?, microchip_number = ?,
      owner_name = ?, owner_phone = ?, owner_address = ?, location = ?, latitude = ?, longitude = ?,
      description = ?, disposition = ?, assigned_officer_id = ?, linked_incident_id = ?,
      quarantine_start = ?, quarantine_end = ?, vaccination_status = ?, impound_date = ?, release_date = ?,
      notes = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    case_type, status, animal_type, animal_breed, animal_color, animal_name,
    animal_sex, microchip_number,
    owner_name, owner_phone, owner_address, location, latitude, longitude,
    description, disposition, assigned_officer_id, linked_incident_id,
    quarantine_start, quarantine_end, vaccination_status, impound_date, release_date,
    notes,
    id
  );

  res.json({ success: true });
});

// DELETE /:id — admin only
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const existing = db.prepare('SELECT id FROM animal_control_cases WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Animal control case not found' });
    return;
  }

  db.prepare('DELETE FROM animal_control_cases WHERE id = ?').run(id);
  res.json({ success: true });
});

export default router;
