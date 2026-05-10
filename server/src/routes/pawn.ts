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

// GET / — list all pawn transactions with optional filtering
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const status = paramStr(req.query.status as string | undefined);
  const search = paramStr(req.query.search as string | undefined);

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (status) {
    whereClause += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    whereClause += ' AND (serial_number LIKE ? OR seller_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const rows = db.prepare(`SELECT * FROM pawn_transactions ${whereClause} ORDER BY created_at DESC`).all(...params);
  res.json(rows);
});

// GET /search/stolen — cross-reference serial numbers against evidence
router.get('/search/stolen', (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM pawn_transactions
    WHERE serial_number IN (
      SELECT serial_number FROM evidence
      WHERE serial_number IS NOT NULL AND serial_number != ''
    )
  `).all();
  res.json(rows);
});

// GET /:id — get single transaction
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const row = db.prepare('SELECT * FROM pawn_transactions WHERE id = ?').get(id);
  if (!row) {
    res.status(404).json({ error: 'Pawn transaction not found' });
    return;
  }
  res.json(row);
});

// POST / — create transaction
router.post('/', requireRole('admin', 'manager', 'officer'), (req: Request, res: Response) => {
  const db = getDb();
  const {
    seller_name, seller_id_type, seller_id_number, seller_address, seller_phone,
    item_description, serial_number, item_category, amount, status, notes
  } = req.body;

  const result = db.prepare(`
    INSERT INTO pawn_transactions (
      seller_name, seller_id_type, seller_id_number, seller_address, seller_phone,
      item_description, serial_number, item_category, amount, status, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
  `).run(
    seller_name, seller_id_type, seller_id_number, seller_address, seller_phone,
    item_description, serial_number, item_category, amount, status || 'active', notes
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /:id — update transaction
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const existing = db.prepare('SELECT id FROM pawn_transactions WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Pawn transaction not found' });
    return;
  }

  const {
    seller_name, seller_id_type, seller_id_number, seller_address, seller_phone,
    item_description, serial_number, item_category, amount, status, notes
  } = req.body;

  db.prepare(`
    UPDATE pawn_transactions SET
      seller_name = ?, seller_id_type = ?, seller_id_number = ?, seller_address = ?, seller_phone = ?,
      item_description = ?, serial_number = ?, item_category = ?, amount = ?, status = ?, notes = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    seller_name, seller_id_type, seller_id_number, seller_address, seller_phone,
    item_description, serial_number, item_category, amount, status, notes,
    id
  );

  res.json({ success: true });
});

// DELETE /:id — admin only
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const existing = db.prepare('SELECT id FROM pawn_transactions WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Pawn transaction not found' });
    return;
  }

  db.prepare('DELETE FROM pawn_transactions WHERE id = ?').run(id);
  res.json({ success: true });
});

// POST /:id/flag — flag transaction as stolen
router.post('/:id/flag', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(paramStr(req.params.id), 10);
  const existing = db.prepare('SELECT id FROM pawn_transactions WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Pawn transaction not found' });
    return;
  }

  const { reason } = req.body;

  db.prepare(`
    UPDATE pawn_transactions SET
      status = 'stolen', flagged_reason = ?, flagged_at = datetime('now','localtime'),
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(reason || null, id);

  res.json({ success: true });
});

export default router;
