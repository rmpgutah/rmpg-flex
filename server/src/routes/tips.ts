import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';
import crypto from 'crypto';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateTipTrackingNumber(): string {
  const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TIP-${hex}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS (no auth)
// ═══════════════════════════════════════════════════════════════════════════

// POST /public/submit — Submit an anonymous tip
router.post('/public/submit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { category, description, location, tip_date, tipster_name, tipster_contact } = req.body;

    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const tracking_number = generateTipTrackingNumber();
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO tips (tracking_number, category, description, location, tip_date, tipster_name, tipster_contact, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
    `).run(tracking_number, category || 'general', description, location || null, tip_date || now, tipster_name || null, tipster_contact || null, now, now);

    res.status(201).json({ success: true, id: result.lastInsertRowid, tracking_number });
  } catch (err: any) {
    console.error('[Tips] Submit error:', err?.message);
    res.status(500).json({ error: 'Failed to submit tip', code: 'TIPS_ERROR' });
  }
});

// GET /public/status/:trackingNumber — Check tip status (anonymous)
router.get('/public/status/:trackingNumber', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const trackingNumber = paramStr(req.params.trackingNumber);
    const row = db.prepare(
      `SELECT tracking_number, category, status, created_at, updated_at FROM tips WHERE tracking_number = ?`
    ).get(trackingNumber);

    if (!row) {
      res.status(404).json({ error: 'Tip not found' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    console.error('[Tips] Status lookup error:', err?.message);
    res.status(500).json({ error: 'Failed to look up tip status', code: 'TIPS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PROTECTED ENDPOINTS (auth required)
// ═══════════════════════════════════════════════════════════════════════════

router.use(authenticateToken);

// GET / — List tips
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, category, search, date_from, date_to, assigned_to } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (category) { where += ' AND t.category = ?'; params.push(category); }
    if (assigned_to) { where += ' AND t.assigned_officer_id = ?'; params.push(assigned_to); }
    if (date_from) { where += ' AND t.created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND t.created_at <= ?'; params.push(date_to); }
    if (search) {
      where += ' AND (t.description LIKE ? OR t.location LIKE ? OR t.tracking_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const rows = db.prepare(`
      SELECT t.*, u.full_name as assigned_officer_name
      FROM tips t
      LEFT JOIN users u ON t.assigned_officer_id = u.id
      ${where}
      ORDER BY t.created_at DESC
    `).all(...params);

    res.json(rows);
  } catch (err: any) {
    console.error('[Tips] List error:', err?.message);
    res.status(500).json({ error: 'Failed to list tips', code: 'TIPS_ERROR' });
  }
});

// GET /:id — Get single tip
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const row = db.prepare(`
      SELECT t.*, u.full_name as assigned_officer_name
      FROM tips t
      LEFT JOIN users u ON t.assigned_officer_id = u.id
      WHERE t.id = ?
    `).get(id);

    if (!row) {
      res.status(404).json({ error: 'Tip not found' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    console.error('[Tips] Get error:', err?.message);
    res.status(500).json({ error: 'Failed to get tip', code: 'TIPS_ERROR' });
  }
});

// PUT /:id — Update tip (assign, update status)
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const { status, assigned_officer_id, priority, notes } = req.body;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM tips WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Tip not found' });
      return;
    }

    db.prepare(`
      UPDATE tips SET
        status = COALESCE(?, status),
        assigned_officer_id = COALESCE(?, assigned_officer_id),
        priority = COALESCE(?, priority),
        notes = COALESCE(?, notes),
        updated_at = ?
      WHERE id = ?
    `).run(status || null, assigned_officer_id || null, priority || null, notes || null, now, id);

    const updated = db.prepare('SELECT * FROM tips WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    console.error('[Tips] Update error:', err?.message);
    res.status(500).json({ error: 'Failed to update tip', code: 'TIPS_ERROR' });
  }
});

// DELETE /:id — Delete tip (admin only)
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);

    const existing = db.prepare('SELECT id FROM tips WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Tip not found' });
      return;
    }

    db.prepare('DELETE FROM tips WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Tips] Delete error:', err?.message);
    res.status(500).json({ error: 'Failed to delete tip', code: 'TIPS_ERROR' });
  }
});

export default router;
