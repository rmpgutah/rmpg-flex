import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── ACTIVE VISITORS (currently signed in) ────────────

router.get('/active', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const visitors = db.prepare(`
      SELECT v.*, p.name as property_name, p.address as property_address,
        u.full_name as signed_in_by_name
      FROM visitor_log v
      LEFT JOIN properties p ON v.property_id = p.id
      LEFT JOIN users u ON v.signed_in_by = u.id
      WHERE v.sign_out_time IS NULL
      ORDER BY v.sign_in_time DESC
    `).all();

    res.json({ data: visitors, count: visitors.length });
  } catch (error: any) {
    console.error('Get active visitors error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── LIST VISITORS ────────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id, search, active_only, date_from, date_to, page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (property_id) { where += ' AND v.property_id = ?'; params.push(property_id); }
    if (active_only === 'true') { where += ' AND v.sign_out_time IS NULL'; }
    if (date_from) { where += ' AND v.sign_in_time >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND v.sign_in_time <= ?'; params.push(date_to + ' 23:59:59'); }
    if (search) {
      where += ' AND (v.visitor_name LIKE ? OR v.visitor_company LIKE ? OR v.vehicle_plate LIKE ? OR v.badge_number LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as c FROM visitor_log v ${where}`).get(...params) as any).c;
    const data = db.prepare(`
      SELECT v.*, p.name as property_name, p.address as property_address,
        u.full_name as signed_in_by_name, u2.full_name as signed_out_by_name
      FROM visitor_log v
      LEFT JOIN properties p ON v.property_id = p.id
      LEFT JOIN users u ON v.signed_in_by = u.id
      LEFT JOIN users u2 ON v.signed_out_by = u2.id
      ${where}
      ORDER BY v.sign_in_time DESC LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({ data, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get visitors error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── SIGN IN (create visitor entry) ───────────────────

router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      property_id, visitor_name, visitor_company, visitor_phone, visitor_email,
      visitor_type, vehicle_plate, vehicle_description, badge_number,
      purpose, destination, escort_name, escort_officer_id,
      id_verified, id_type, id_number, photo_url, notes,
    } = req.body;

    if (!visitor_name || !property_id) {
      return res.status(400).json({ error: 'visitor_name and property_id are required' });
    }

    // Auto-generate entry number
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const count = (db.prepare(`SELECT COUNT(*) as c FROM visitor_log WHERE entry_number LIKE ?`)
      .get(`VIS-${year}${month}-%`) as any).c;
    const entry_number = `VIS-${year}${month}-${String(count + 1).padStart(4, '0')}`;

    const result = db.prepare(`
      INSERT INTO visitor_log (entry_number, property_id, visitor_name, visitor_company,
        visitor_phone, visitor_email, visitor_type, vehicle_plate, vehicle_description,
        badge_number, purpose, destination, escort_name, escort_officer_id,
        id_verified, id_type, id_number, photo_url, notes,
        sign_in_time, signed_in_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry_number, property_id, visitor_name, visitor_company,
      visitor_phone, visitor_email, visitor_type || 'visitor',
      vehicle_plate, vehicle_description, badge_number,
      purpose, destination, escort_name, escort_officer_id || null,
      id_verified ? 1 : 0, id_type, id_number, photo_url, notes,
      localNow(), (req as any).user?.userId
    );

    const created = db.prepare('SELECT * FROM visitor_log WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Sign in visitor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── SIGN OUT ─────────────────────────────────────────

router.post('/:id/sign-out', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { notes } = req.body;

    const visitor = db.prepare('SELECT * FROM visitor_log WHERE id = ?').get(req.params.id) as any;
    if (!visitor) return res.status(404).json({ error: 'Visitor entry not found' });
    if (visitor.sign_out_time) return res.status(400).json({ error: 'Visitor already signed out' });

    db.prepare(`
      UPDATE visitor_log
      SET sign_out_time = ?, signed_out_by = ?, sign_out_notes = ?
      WHERE id = ?
    `).run(localNow(), (req as any).user?.userId, notes || null, req.params.id);

    const updated = db.prepare('SELECT * FROM visitor_log WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Sign out visitor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── UPDATE VISITOR ───────────────────────────────────

router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fields = req.body;
    const sets: string[] = [];
    const params: any[] = [];

    const allowed = [
      'visitor_name', 'visitor_company', 'visitor_phone', 'visitor_email',
      'visitor_type', 'vehicle_plate', 'vehicle_description', 'badge_number',
      'purpose', 'destination', 'escort_name', 'escort_officer_id',
      'id_verified', 'id_type', 'id_number', 'photo_url', 'notes',
    ];

    for (const key of allowed) {
      if (key in fields) {
        sets.push(`${key} = ?`);
        params.push(key === 'id_verified' ? (fields[key] ? 1 : 0) : fields[key]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    sets.push('updated_at = ?');
    params.push(localNow());
    params.push(req.params.id);

    db.prepare(`UPDATE visitor_log SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM visitor_log WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update visitor error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── PROPERTY VISITOR STATS ───────────────────────────

router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id, days = '30' } = req.query;
    const daysNum = parseInt(days as string, 10);

    let where = `WHERE v.sign_in_time >= date('now', 'localtime', '-${daysNum} days')`;
    const params: any[] = [];
    if (property_id) { where += ' AND v.property_id = ?'; params.push(property_id); }

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_visitors,
        COUNT(DISTINCT v.visitor_name) as unique_visitors,
        SUM(CASE WHEN v.sign_out_time IS NULL THEN 1 ELSE 0 END) as currently_signed_in,
        COUNT(DISTINCT v.visitor_company) as unique_companies,
        COUNT(DISTINCT v.property_id) as properties_visited
      FROM visitor_log v ${where}
    `).get(...params) as any;

    const byType = db.prepare(`
      SELECT visitor_type, COUNT(*) as count
      FROM visitor_log v ${where}
      GROUP BY visitor_type ORDER BY count DESC
    `).all(...params) as any[];

    const byProperty = db.prepare(`
      SELECT p.name as property_name, COUNT(*) as visit_count
      FROM visitor_log v
      LEFT JOIN properties p ON v.property_id = p.id
      ${where}
      GROUP BY v.property_id ORDER BY visit_count DESC LIMIT 10
    `).all(...params) as any[];

    const dailyTrend = db.prepare(`
      SELECT date(v.sign_in_time) as visit_date, COUNT(*) as count
      FROM visitor_log v ${where}
      GROUP BY visit_date ORDER BY visit_date DESC LIMIT ${daysNum}
    `).all(...params) as any[];

    res.json({ period_days: daysNum, stats, by_type: byType, by_property: byProperty, daily_trend: dailyTrend });
  } catch (error: any) {
    console.error('Visitor stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;
