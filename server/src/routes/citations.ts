// ============================================================
// RMPG Flex — Citations / Summons API Routes
// ============================================================
// Full CRUD for traffic citations, criminal summons, parking
// tickets, and written warnings. Auto-generates citation numbers
// in CIT-YYYY-NNNN format.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── GET /api/citations/stats ─────────────────────────────
// Dashboard statistics: counts by status/type, fines totals
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM citations
      WHERE status != 'voided'
      GROUP BY status
    `).all() as any[];

    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) statusMap[row.status] = row.count;

    const typeCounts = db.prepare(`
      SELECT type, COUNT(*) as count FROM citations
      WHERE status != 'voided'
      GROUP BY type
    `).all() as any[];

    const typeMap: Record<string, number> = {};
    for (const row of typeCounts) typeMap[row.type] = row.count;

    const finesIssued = db.prepare(`
      SELECT COALESCE(SUM(fine_amount), 0) as total FROM citations
      WHERE status != 'voided'
    `).get() as any;

    const finesCollected = db.prepare(`
      SELECT COALESCE(SUM(fine_amount), 0) as total FROM citations
      WHERE status = 'paid'
    `).get() as any;

    const todayCount = db.prepare(`
      SELECT COUNT(*) as count FROM citations
      WHERE violation_date = ? AND status != 'voided'
    `).get(today) as any;

    res.json({
      data: {
        by_status: {
          issued: statusMap['issued'] || 0,
          paid: statusMap['paid'] || 0,
          contested: statusMap['contested'] || 0,
          dismissed: statusMap['dismissed'] || 0,
          warrant_issued: statusMap['warrant_issued'] || 0,
        },
        by_type: typeMap,
        total: Object.values(statusMap).reduce((a, b) => a + b, 0),
        fines_issued: finesIssued.total,
        fines_collected: finesCollected.total,
        today_count: todayCount.count,
      },
    });
  } catch (error: any) {
    console.error('Get citation stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/citations/search ────────────────────────────
router.get('/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters' });
      return;
    }

    const searchTerm = `%${q}%`;

    const citations = db.prepare(`
      SELECT * FROM citations
      WHERE citation_number LIKE ? OR person_name LIKE ? OR statute_citation LIKE ? OR violation_description LIKE ?
      ORDER BY created_at DESC
      LIMIT 25
    `).all(searchTerm, searchTerm, searchTerm, searchTerm);

    res.json({ data: citations });
  } catch (error: any) {
    console.error('Search citations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/citations/person/:personId ──────────────────
router.get('/person/:personId', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const citations = db.prepare(`
      SELECT * FROM citations
      WHERE person_id = ?
      ORDER BY violation_date DESC, violation_time DESC
    `).all(req.params.personId);

    res.json({ data: citations });
  } catch (error: any) {
    console.error('Get person citations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/citations ───────────────────────────────────
// List with pagination and filters
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      page = '1',
      limit = '50',
      status,
      type,
      q,
      officer_id,
      date_from,
      date_to,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 200);
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND c.status = ?';
      params.push(status);
    }

    if (type) {
      whereClause += ' AND c.type = ?';
      params.push(type);
    }

    if (q) {
      const searchTerm = `%${q}%`;
      whereClause += ' AND (c.citation_number LIKE ? OR c.person_name LIKE ? OR c.violation_description LIKE ?)';
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (officer_id) {
      whereClause += ' AND c.issuing_officer_id = ?';
      params.push(officer_id);
    }

    if (date_from) {
      whereClause += ' AND c.violation_date >= ?';
      params.push(date_from);
    }

    if (date_to) {
      whereClause += ' AND c.violation_date <= ?';
      params.push(date_to);
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM citations c ${whereClause}`
    ).get(...params) as any;

    const citations = db.prepare(`
      SELECT c.*
      FROM citations c
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({
      data: citations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Get citations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/citations/:id ──────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const citation = db.prepare(`SELECT * FROM citations WHERE id = ?`).get(req.params.id) as any;

    if (!citation) {
      res.status(404).json({ error: 'Citation not found' });
      return;
    }

    res.json({ data: citation });
  } catch (error: any) {
    console.error('Get citation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/citations ─────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const {
      type = 'traffic',
      status = 'issued',
      person_id,
      person_name,
      person_dob,
      person_dl,
      person_address,
      vehicle_description,
      vehicle_plate,
      vehicle_state,
      statute_id,
      statute_citation,
      violation_description,
      offense_level,
      fine_amount,
      violation_date,
      violation_time,
      location,
      incident_id,
      call_id,
      issuing_officer_id,
      issuing_officer_name,
      badge_number,
      court_date,
      court_name,
      court_address,
      notes,
    } = req.body;

    if (!violation_date) {
      res.status(400).json({ error: 'violation_date is required' });
      return;
    }

    // Auto-generate citation number: CIT-YYYY-NNNN
    const year = new Date().getFullYear();
    const lastCit = db.prepare(
      "SELECT citation_number FROM citations WHERE citation_number LIKE ? ORDER BY id DESC LIMIT 1"
    ).get(`CIT-${year}-%`) as any;
    let seq = 1;
    if (lastCit) {
      const parts = lastCit.citation_number.split('-');
      seq = parseInt(parts[2], 10) + 1;
    }
    const citation_number = `CIT-${year}-${String(seq).padStart(4, '0')}`;

    const now = localNow();

    const result = db.prepare(`
      INSERT INTO citations (
        citation_number, type, status,
        person_id, person_name, person_dob, person_dl, person_address,
        vehicle_description, vehicle_plate, vehicle_state,
        statute_id, statute_citation, violation_description, offense_level, fine_amount,
        violation_date, violation_time, location,
        incident_id, call_id,
        issuing_officer_id, issuing_officer_name, badge_number,
        court_date, court_name, court_address,
        notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?
      )
    `).run(
      citation_number, type, status,
      person_id || null, person_name || null, person_dob || null, person_dl || null, person_address || null,
      vehicle_description || null, vehicle_plate || null, vehicle_state || null,
      statute_id || null, statute_citation || null, violation_description || null, offense_level || null, fine_amount ?? null,
      violation_date, violation_time || null, location || null,
      incident_id || null, call_id || null,
      issuing_officer_id || null, issuing_officer_name || null, badge_number || null,
      court_date || null, court_name || null, court_address || null,
      notes || null, now, now
    );

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'citation_created', 'citation', ?, ?, ?)
    `).run(
      req.user!.userId,
      result.lastInsertRowid,
      `Created citation ${citation_number}${person_name ? ` for ${person_name}` : ''}`,
      req.ip || 'unknown'
    );

    const created = db.prepare('SELECT * FROM citations WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: created });
  } catch (error: any) {
    console.error('Create citation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/citations/:id ──────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const citation = db.prepare('SELECT * FROM citations WHERE id = ?').get(req.params.id) as any;
    if (!citation) {
      res.status(404).json({ error: 'Citation not found' });
      return;
    }

    const fields: string[] = [];
    const values: any[] = [];
    const bodyKeys = Object.keys(req.body);

    const fieldMap: Record<string, (v: any) => any> = {
      type: v => v ?? null,
      status: v => v ?? null,
      person_id: v => v || null,
      person_name: v => v ?? null,
      person_dob: v => v ?? null,
      person_dl: v => v ?? null,
      person_address: v => v ?? null,
      vehicle_description: v => v ?? null,
      vehicle_plate: v => v ?? null,
      vehicle_state: v => v ?? null,
      statute_id: v => v || null,
      statute_citation: v => v ?? null,
      violation_description: v => v ?? null,
      offense_level: v => v ?? null,
      fine_amount: v => v ?? null,
      violation_date: v => v ?? null,
      violation_time: v => v ?? null,
      location: v => v ?? null,
      incident_id: v => v || null,
      call_id: v => v || null,
      issuing_officer_id: v => v || null,
      issuing_officer_name: v => v ?? null,
      badge_number: v => v ?? null,
      court_date: v => v ?? null,
      court_name: v => v ?? null,
      court_address: v => v ?? null,
      notes: v => v ?? null,
    };

    for (const [key, transform] of Object.entries(fieldMap)) {
      if (bodyKeys.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(transform(req.body[key]));
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(localNow());
      values.push(req.params.id);
      db.prepare(`UPDATE citations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'citation_updated', 'citation', ?, ?, ?)
    `).run(
      req.user!.userId,
      req.params.id,
      `Updated citation ${citation.citation_number}`,
      req.ip || 'unknown'
    );

    const updated = db.prepare('SELECT * FROM citations WHERE id = ?').get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Update citation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/citations/:id ────────────────────────────
// Soft-delete: sets status to 'voided'
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const citation = db.prepare('SELECT * FROM citations WHERE id = ?').get(req.params.id) as any;
    if (!citation) {
      res.status(404).json({ error: 'Citation not found' });
      return;
    }

    db.prepare(`
      UPDATE citations SET status = 'voided', updated_at = ? WHERE id = ?
    `).run(localNow(), req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'citation_voided', 'citation', ?, ?, ?)
    `).run(
      req.user!.userId,
      req.params.id,
      `Voided citation ${citation.citation_number}`,
      req.ip || 'unknown'
    );

    res.json({ message: 'Citation voided', data: { id: citation.id, status: 'voided' } });
  } catch (error: any) {
    console.error('Void citation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
