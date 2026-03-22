// ============================================================
// RMPG Flex — Known Offender Registry API Routes
// ============================================================
// Manages flagged person alerts including ban zones, watch lists,
// and severity levels. Links to persons table for demographics.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { escapeLike, validateParamId } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';

const router = Router();
router.use(authenticateToken);

// ─── GET /stats ──────────────────────────────────────────
// Restricted: offender alerts contain criminal flags and PII
router.get('/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    console.error('Get offender stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET / ───────────────────────────────────────────────
router.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { alert_type, severity, status = 'active', search, page = '1', limit = '50' } = req.query;
    const parsedPage = parseInt(page as string, 10);
    const pageNum = Math.max(1, isNaN(parsedPage) ? 1 : parsedPage);
    const parsedLimit = parseInt(limit as string, 10);
    const limitNum = Math.min(100, Math.max(1, isNaN(parsedLimit) ? 50 : parsedLimit));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND oa.status = ?'; params.push(status); }
    if (alert_type) { where += ' AND oa.alert_type = ?'; params.push(alert_type); }
    if (severity) { where += ' AND oa.severity = ?'; params.push(severity); }
    if (search) {
      where += " AND (p.first_name LIKE ? ESCAPE '\\' OR p.last_name LIKE ? ESCAPE '\\' OR oa.description LIKE ? ESCAPE '\\')";
      const s = `%${escapeLike(String(search))}%`; params.push(s, s, s);
    }

    const total = (db.prepare(`
      SELECT COUNT(*) as count FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      ${where}
    `).get(...params) as any)?.count || 0;

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
    console.error('Get offender alerts error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /check/:personId ────────────────────────────────
// Quick check: all active alerts for a specific person
router.get('/check/:personId', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
router.get('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
router.post('/', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
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
      restriction_radius_ft ?? null, now, expiration_date || null,
      source_incident_id || null, source_citation_id || null, source_case_id || null,
      req.user!.userId, notes || null, now, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'create', 'offender_alert', ?, ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid, JSON.stringify({ person_id, alert_type, severity }), req.ip || 'unknown', now);

    auditLog(req, 'CREATE' as any, 'offender_alert' as any, result.lastInsertRowid, `Created ${severity} ${alert_type} alert for person ${person_id}`);
    broadcast('records', 'offender:created', { id: result.lastInsertRowid, person_id, alert_type, severity });
    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (error: any) {
    console.error('Create offender alert error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
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
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const existing = db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Alert not found' });

    params.push(id);
    db.prepare(`UPDATE offender_alerts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    auditLog(req, 'UPDATE' as any, 'offender_alert' as any, id, `Updated offender alert ${id}`);
    broadcast('records', 'offender:updated', { id });
    res.json({ data: { id } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── PUT /:id/clear ──────────────────────────────────────
router.put('/:id/clear', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const existing = db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Alert not found' });

    db.prepare('UPDATE offender_alerts SET status = ?, updated_at = ? WHERE id = ?').run('cleared', now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'clear', 'offender_alert', ?, '{}', ?, ?)`).run(req.user!.userId, id, req.ip || 'unknown', now);

    auditLog(req, 'UPDATE' as any, 'offender_alert' as any, id, `Cleared offender alert ${id}`);
    broadcast('records', 'offender:updated', { id, status: 'cleared' });
    res.json({ data: { id, status: 'cleared' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /api/offender-registry/export/csv — Export offender alerts
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT oa.id, oa.alert_type, oa.status, oa.description, oa.severity,
        oa.restriction_radius_ft, oa.effective_date, oa.expiration_date,
        oa.notes, oa.created_at, oa.updated_at,
        p.first_name, p.last_name, p.dob,
        p.first_name || ' ' || p.last_name as person_name
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      ORDER BY oa.created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'offender_alerts_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'person_name', header: 'Person' },
      { key: 'first_name', header: 'First Name' },
      { key: 'last_name', header: 'Last Name' },
      { key: 'dob', header: 'DOB' },
      { key: 'alert_type', header: 'Alert Type' },
      { key: 'severity', header: 'Severity' },
      { key: 'status', header: 'Status' },
      { key: 'description', header: 'Description' },
      { key: 'restriction_radius_ft', header: 'Restriction Radius (ft)' },
      { key: 'effective_date', header: 'Effective Date' },
      { key: 'expiration_date', header: 'Expiration Date' },
      { key: 'notes', header: 'Notes' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
