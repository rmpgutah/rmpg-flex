// ============================================================
// RMPG Flex — Known Offender Registry API Routes
// ============================================================
// Manages flagged person alerts including ban zones, watch lists,
// and severity levels. Links to persons table for demographics.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── GET /stats ──────────────────────────────────────────
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const typeCounts = db.prepare(`
      SELECT alert_type, COUNT(*) as count FROM offender_alerts WHERE status = 'active' GROUP BY alert_type
    `).all() as any[];
    const severityCounts = db.prepare(`
      SELECT severity, COUNT(*) as count FROM offender_alerts WHERE status = 'active' GROUP BY severity
    `).all() as any[];
    const totalPersons = db.prepare(`
      SELECT COUNT(DISTINCT person_id) as count FROM offender_alerts WHERE status = 'active'
    `).get() as any;
    const expiringSoon = db.prepare(`
      SELECT COUNT(*) as count FROM offender_alerts
      WHERE status = 'active' AND expiration_date IS NOT NULL
      AND expiration_date <= DATE('now', '+30 days')
    `).get() as any;

    res.json({
      data: {
        by_type: Object.fromEntries(typeCounts.map(r => [r.alert_type, r.count])),
        by_severity: Object.fromEntries(severityCounts.map(r => [r.severity, r.count])),
        total_alerts: typeCounts.reduce((a: number, b: any) => a + b.count, 0),
        total_persons: totalPersons?.count || 0,
        expiring_soon: expiringSoon?.count || 0,
      },
    });
  } catch (error: any) {
    console.error('Get offender stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET / ───────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { alert_type, severity, status = 'active', search, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND oa.status = ?'; params.push(status); }
    if (alert_type) { where += ' AND oa.alert_type = ?'; params.push(alert_type); }
    if (severity) { where += ' AND oa.severity = ?'; params.push(severity); }
    if (search) {
      where += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR oa.description LIKE ?)';
      const s = `%${search}%`; params.push(s, s, s);
    }

    const total = (db.prepare(`
      SELECT COUNT(*) as count FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      ${where}
    `).get(...params) as any).count;

    const rows = db.prepare(`
      SELECT oa.*,
        p.first_name, p.last_name, p.dob, p.photo_url,
        p.caution_flags, p.is_sex_offender, p.gang_affiliation,
        p.first_name || ' ' || p.last_name as person_name
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      ${where}
      ORDER BY
        CASE oa.severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 WHEN 'caution' THEN 2 ELSE 3 END,
        oa.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get offender alerts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /check/:personId ────────────────────────────────
// Quick check: all active alerts for a specific person
router.get('/check/:personId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alerts = db.prepare(`
      SELECT * FROM offender_alerts WHERE person_id = ? AND status = 'active'
      ORDER BY CASE severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 WHEN 'caution' THEN 2 ELSE 3 END
    `).all(req.params.personId);
    res.json({ data: alerts });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT oa.*, p.first_name, p.last_name, p.dob, p.photo_url,
        p.first_name || ' ' || p.last_name as person_name
      FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Alert not found' });
    res.json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── POST / ──────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { person_id, alert_type, description, severity = 'caution',
      restricted_properties, restricted_zones, restriction_radius_ft,
      expiration_date, source_incident_id, source_citation_id, source_case_id, notes } = req.body;
    if (!person_id || !alert_type || !description) return res.status(400).json({ error: 'Person, alert type, and description required' });

    const result = db.prepare(`
      INSERT INTO offender_alerts (person_id, alert_type, status, description, severity,
        restricted_properties, restricted_zones, restriction_radius_ft,
        effective_date, expiration_date, source_incident_id, source_citation_id, source_case_id,
        created_by, notes, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(person_id, alert_type, description, severity,
      JSON.stringify(restricted_properties || []), JSON.stringify(restricted_zones || []),
      restriction_radius_ft || null, now, expiration_date || null,
      source_incident_id || null, source_citation_id || null, source_case_id || null,
      req.user!.userId, notes || null, now, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'create', 'offender_alert', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid, JSON.stringify({ person_id, alert_type, severity }), now);

    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (error: any) {
    console.error('Create offender alert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const fields = ['alert_type', 'description', 'severity', 'restriction_radius_ft',
      'expiration_date', 'notes'];
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (req.body.restricted_properties !== undefined) {
      updates.push('restricted_properties = ?');
      params.push(JSON.stringify(req.body.restricted_properties));
    }
    if (req.body.restricted_zones !== undefined) {
      updates.push('restricted_zones = ?');
      params.push(JSON.stringify(req.body.restricted_zones));
    }
    params.push(req.params.id);
    db.prepare(`UPDATE offender_alerts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ data: { id: parseInt(req.params.id) } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── PUT /:id/clear ──────────────────────────────────────
router.put('/:id/clear', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    db.prepare('UPDATE offender_alerts SET status = ?, updated_at = ? WHERE id = ?').run('cleared', now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'clear', 'offender_alert', ?, '{}', ?)`).run(req.user!.userId, req.params.id, now);

    res.json({ data: { id: parseInt(req.params.id), status: 'cleared' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
