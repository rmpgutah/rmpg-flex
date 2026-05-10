import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

// ─── Reads ──────────────────────────────────────────────────────────────────

// POST /reads — Ingest ALPR reads (accepts array, auto-checks hotlist)
router.post('/reads', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const reads: any[] = Array.isArray(req.body) ? req.body : [req.body];

    if (!reads.length) {
      res.status(400).json({ error: 'At least one read is required' });
      return;
    }

    const hotlistPlates = db.prepare(
      `SELECT plate_number FROM alpr_hotlist WHERE active = 1`
    ).all() as { plate_number: string }[];
    const hotlistSet = new Set(hotlistPlates.map(h => h.plate_number.toUpperCase()));

    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO alpr_reads (plate_number, state, camera_id, camera_name, latitude, longitude, confidence, image_url, is_hit, hit_reason, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    let hits = 0;
    const insertMany = db.transaction(() => {
      for (const read of reads) {
        if (!read.plate_number) continue;
        const plateUpper = read.plate_number.toUpperCase();
        const isHit = hotlistSet.has(plateUpper) ? 1 : 0;
        let hitReason: string | null = null;

        if (isHit) {
          const hotEntry = db.prepare(
            `SELECT reason FROM alpr_hotlist WHERE plate_number = ? AND active = 1 LIMIT 1`
          ).get(plateUpper) as { reason: string } | undefined;
          hitReason = hotEntry?.reason || 'hotlist match';
          hits++;
        }

        insert.run(
          plateUpper, read.state || null, read.camera_id || null,
          read.camera_name || null, read.latitude || null, read.longitude || null,
          read.confidence || null, read.image_url || null,
          isHit, hitReason, read.read_at || now, now
        );
        inserted++;
      }
    });
    insertMany();

    res.status(201).json({ success: true, inserted, hits });
  } catch (err: any) {
    console.error('[ALPR] Ingest error:', err?.message);
    res.status(500).json({ error: 'Failed to ingest reads', code: 'ALPR_ERROR' });
  }
});

// GET /reads — List reads with filters
router.get('/reads', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { plate, camera_id, date_from, date_to, hits_only, limit = '500' } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (plate) { where += ' AND plate_number LIKE ?'; params.push(`%${(plate as string).toUpperCase()}%`); }
    if (camera_id) { where += ' AND camera_id = ?'; params.push(camera_id); }
    if (date_from) { where += ' AND read_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND read_at <= ?'; params.push(date_to); }
    if (hits_only === 'true') { where += ' AND is_hit = 1'; }

    const maxRows = Math.min(5000, Math.max(1, parseInt(limit as string, 10) || 500));
    const rows = db.prepare(`SELECT * FROM alpr_reads ${where} ORDER BY read_at DESC LIMIT ?`).all(...params, maxRows);
    res.json(rows);
  } catch (err: any) {
    console.error('[ALPR] List reads error:', err?.message);
    res.status(500).json({ error: 'Failed to list reads', code: 'ALPR_ERROR' });
  }
});

// GET /reads/stats — Read statistics
router.get('/reads/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const byCamera = db.prepare(`
      SELECT camera_id, camera_name, COUNT(*) as count
      FROM alpr_reads
      WHERE read_at >= date('now', '-30 days')
      GROUP BY camera_id
    `).all();

    const hitsPerDay = db.prepare(`
      SELECT date(read_at) as day, COUNT(*) as count
      FROM alpr_reads
      WHERE is_hit = 1 AND read_at >= date('now', '-30 days')
      GROUP BY day ORDER BY day
    `).all();

    const total = db.prepare('SELECT COUNT(*) as count FROM alpr_reads').get() as any;
    const totalHits = db.prepare('SELECT COUNT(*) as count FROM alpr_reads WHERE is_hit = 1').get() as any;

    res.json({ total: total.count, total_hits: totalHits.count, by_camera: byCamera, hits_per_day: hitsPerDay });
  } catch (err: any) {
    console.error('[ALPR] Stats error:', err?.message);
    res.status(500).json({ error: 'Failed to get stats', code: 'ALPR_ERROR' });
  }
});

// ─── Hotlist ────────────────────────────────────────────────────────────────

// GET /hotlist — List active hotlist entries
router.get('/hotlist', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT h.*, u.full_name as added_by_name
      FROM alpr_hotlist h
      LEFT JOIN users u ON h.added_by = u.id
      WHERE h.active = 1
      ORDER BY h.created_at DESC
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[ALPR] List hotlist error:', err?.message);
    res.status(500).json({ error: 'Failed to list hotlist', code: 'ALPR_ERROR' });
  }
});

// POST /hotlist — Add to hotlist
router.post('/hotlist', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { plate_number, state, reason, alert_type, expiration_date, notes } = req.body;

    if (!plate_number || !reason) {
      res.status(400).json({ error: 'plate_number and reason are required' });
      return;
    }

    const user = (req as any).user;
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO alpr_hotlist (plate_number, state, reason, alert_type, expiration_date, notes, added_by, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(plate_number.toUpperCase(), state || null, reason, alert_type || 'alert', expiration_date || null, notes || null, user?.id || null, now, now);

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    console.error('[ALPR] Add hotlist error:', err?.message);
    res.status(500).json({ error: 'Failed to add to hotlist', code: 'ALPR_ERROR' });
  }
});

// PUT /hotlist/:id — Update hotlist entry
router.put('/hotlist/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    const { plate_number, state, reason, alert_type, expiration_date, notes, active } = req.body;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM alpr_hotlist WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Hotlist entry not found' });
      return;
    }

    db.prepare(`
      UPDATE alpr_hotlist SET
        plate_number = COALESCE(?, plate_number), state = COALESCE(?, state),
        reason = COALESCE(?, reason), alert_type = COALESCE(?, alert_type),
        expiration_date = COALESCE(?, expiration_date), notes = COALESCE(?, notes),
        active = COALESCE(?, active), updated_at = ?
      WHERE id = ?
    `).run(
      plate_number ? plate_number.toUpperCase() : null, state || null,
      reason || null, alert_type || null, expiration_date || null,
      notes || null, active != null ? (active ? 1 : 0) : null, now, id
    );

    const updated = db.prepare('SELECT * FROM alpr_hotlist WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: any) {
    console.error('[ALPR] Update hotlist error:', err?.message);
    res.status(500).json({ error: 'Failed to update hotlist entry', code: 'ALPR_ERROR' });
  }
});

// DELETE /hotlist/:id — Remove hotlist entry
router.delete('/hotlist/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);

    const existing = db.prepare('SELECT id FROM alpr_hotlist WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Hotlist entry not found' });
      return;
    }

    db.prepare('DELETE FROM alpr_hotlist WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ALPR] Delete hotlist error:', err?.message);
    res.status(500).json({ error: 'Failed to delete hotlist entry', code: 'ALPR_ERROR' });
  }
});

export default router;
