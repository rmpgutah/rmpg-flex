import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

// GET / — List accreditations with filters
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, status, expiring_within_days, search } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (officer_id) { where += ' AND a.officer_id = ?'; params.push(officer_id); }
    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (expiring_within_days) {
      const days = parseInt(expiring_within_days as string, 10) || 60;
      where += ` AND a.expiration_date <= date('now', '+' || ? || ' days') AND a.expiration_date >= date('now')`;
      params.push(days);
    }
    if (search) {
      where += ' AND (a.name LIKE ? OR a.issuing_authority LIKE ? OR a.credential_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const rows = db.prepare(`
      SELECT a.*, u.full_name as officer_name
      FROM accreditations a
      LEFT JOIN users u ON a.officer_id = u.id
      ${where}
      ORDER BY a.expiration_date ASC
    `).all(...params);

    res.json(rows);
  } catch (err: any) {
    console.error('[Accreditations] List error:', err?.message);
    res.status(500).json({ error: 'Failed to list accreditations', code: 'ACCREDITATIONS_ERROR' });
  }
});

// GET /expiring — Accreditations expiring within 60 days
router.get('/expiring', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT a.*, u.full_name as officer_name
      FROM accreditations a
      LEFT JOIN users u ON a.officer_id = u.id
      WHERE a.expiration_date <= date('now', '+60 days')
        AND a.expiration_date >= date('now')
        AND a.status = 'active'
      ORDER BY a.expiration_date ASC
    `).all();

    res.json(rows);
  } catch (err: any) {
    console.error('[Accreditations] Expiring error:', err?.message);
    res.status(500).json({ error: 'Failed to get expiring accreditations', code: 'ACCREDITATIONS_ERROR' });
  }
});

// POST /check-reminders — Check and trigger notifications for expiring accreditations
router.post('/check-reminders', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const expiring = db.prepare(`
      SELECT a.*, u.full_name as officer_name, u.email as officer_email
      FROM accreditations a
      LEFT JOIN users u ON a.officer_id = u.id
      WHERE a.expiration_date <= date('now', '+60 days')
        AND a.expiration_date >= date('now')
        AND a.status = 'active'
      ORDER BY a.expiration_date ASC
    `).all() as any[];

    const now = new Date().toISOString();
    const reminders: any[] = [];

    for (const acc of expiring) {
      const daysUntilExpiry = Math.ceil(
        (new Date(acc.expiration_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      // Check if reminder already sent recently
      const recentReminder = db.prepare(`
        SELECT id FROM accreditation_reminders
        WHERE accreditation_id = ? AND sent_at >= date('now', '-7 days')
      `).get(acc.id);

      if (!recentReminder) {
        db.prepare(`
          INSERT INTO accreditation_reminders (accreditation_id, officer_id, days_until_expiry, sent_at)
          VALUES (?, ?, ?, ?)
        `).run(acc.id, acc.officer_id, daysUntilExpiry, now);

        reminders.push({
          accreditation_id: acc.id,
          officer_name: acc.officer_name,
          name: acc.name,
          expiration_date: acc.expiration_date,
          days_until_expiry: daysUntilExpiry,
        });
      }
    }

    res.json({ success: true, reminders_sent: reminders.length, reminders });
  } catch (err: any) {
    console.error('[Accreditations] Check reminders error:', err?.message);
    res.status(500).json({ error: 'Failed to check reminders', code: 'ACCREDITATIONS_ERROR' });
  }
});

// GET /:id — Single accreditation
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const row = db.prepare(`
      SELECT a.*, u.full_name as officer_name
      FROM accreditations a
      LEFT JOIN users u ON a.officer_id = u.id
      WHERE a.id = ?
    `).get(id);

    if (!row) {
      res.status(404).json({ error: 'Accreditation not found' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    console.error('[Accreditations] Get error:', err?.message);
    res.status(500).json({ error: 'Failed to get accreditation', code: 'ACCREDITATIONS_ERROR' });
  }
});

// POST / — Create accreditation
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      officer_id, name, credential_number, issuing_authority,
      issue_date, expiration_date, category, notes,
    } = req.body;

    if (!officer_id || !name) {
      res.status(400).json({ error: 'officer_id and name are required' });
      return;
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO accreditations (officer_id, name, credential_number, issuing_authority, issue_date, expiration_date, category, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      officer_id, name, credential_number || null, issuing_authority || null,
      issue_date || null, expiration_date || null, category || null,
      notes || null, now, now
    );

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    console.error('[Accreditations] Create error:', err?.message);
    res.status(500).json({ error: 'Failed to create accreditation', code: 'ACCREDITATIONS_ERROR' });
  }
});

// PUT /:id — Update accreditation
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const {
      name, credential_number, issuing_authority,
      issue_date, expiration_date, category, notes, status,
    } = req.body;

    const existing = db.prepare('SELECT id FROM accreditations WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Accreditation not found' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE accreditations SET
        name = COALESCE(?, name), credential_number = COALESCE(?, credential_number),
        issuing_authority = COALESCE(?, issuing_authority), issue_date = COALESCE(?, issue_date),
        expiration_date = COALESCE(?, expiration_date), category = COALESCE(?, category),
        notes = COALESCE(?, notes), status = COALESCE(?, status), updated_at = ?
      WHERE id = ?
    `).run(
      name || null, credential_number || null, issuing_authority || null,
      issue_date || null, expiration_date || null, category || null,
      notes || null, status || null, now, id
    );

    const updated = db.prepare('SELECT * FROM accreditations WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    console.error('[Accreditations] Update error:', err?.message);
    res.status(500).json({ error: 'Failed to update accreditation', code: 'ACCREDITATIONS_ERROR' });
  }
});

// DELETE /:id — Delete accreditation (admin only)
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);

    const existing = db.prepare('SELECT id FROM accreditations WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Accreditation not found' });
      return;
    }

    db.prepare('DELETE FROM accreditations WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Accreditations] Delete error:', err?.message);
    res.status(500).json({ error: 'Failed to delete accreditation', code: 'ACCREDITATIONS_ERROR' });
  }
});

export default router;
