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
    const personId = parseInt(req.params.personId, 10);
    if (isNaN(personId)) { res.status(400).json({ error: 'Invalid person ID' }); return; }
    const alerts = db.prepare(`
      SELECT * FROM offender_alerts WHERE person_id = ? AND status = 'active'
      ORDER BY CASE severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 WHEN 'caution' THEN 2 ELSE 3 END
    `).all(personId);
    res.json({ data: alerts });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid alert ID' }); return; }
    const row = db.prepare(`
      SELECT oa.*, p.first_name, p.last_name, p.dob, p.photo_url,
        p.first_name || ' ' || p.last_name as person_name
      FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.id = ?
    `).get(id);
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
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid alert ID' }); return; }
    const existing = db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Alert not found' }); return; }
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
    params.push(id);
    db.prepare(`UPDATE offender_alerts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ data: { id } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── PUT /:id/clear ──────────────────────────────────────
router.put('/:id/clear', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid alert ID' }); return; }
    const existing = db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Alert not found' }); return; }
    const now = localNow();
    db.prepare('UPDATE offender_alerts SET status = ?, updated_at = ? WHERE id = ?').run('cleared', now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'clear', 'offender_alert', ?, '{}', ?)`).run(req.user!.userId, id, now);

    res.json({ data: { id, status: 'cleared' } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ════════════════════════════════════════════════════════════
// FEATURE 21: Proximity Alert Configuration
// ════════════════════════════════════════════════════════════

router.put('/:id/proximity-alert', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { alert_radius_ft, alert_latitude, alert_longitude, alert_address, alert_enabled } = req.body;
    const now = localNow();

    const existing = db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Alert not found' });

    db.prepare(`
      UPDATE offender_alerts SET
        restriction_radius_ft = COALESCE(?, restriction_radius_ft),
        alert_latitude = ?,
        alert_longitude = ?,
        alert_address = ?,
        alert_enabled = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      alert_radius_ft ?? null,
      alert_latitude ?? null,
      alert_longitude ?? null,
      alert_address ?? null,
      alert_enabled !== undefined ? (alert_enabled ? 1 : 0) : 1,
      now, req.params.id
    );

    res.json({ data: { id: parseInt(req.params.id), alert_radius_ft, alert_enabled } });
  } catch (error: any) {
    console.error('Set proximity alert error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 22: Compliance Check Scheduling
// ════════════════════════════════════════════════════════════

router.post('/:id/schedule-check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alert = db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(req.params.id) as any;
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    const { check_date, check_type, assigned_officer_id, notes } = req.body;
    if (!check_date) return res.status(400).json({ error: 'check_date is required' });

    const now = localNow();

    // Store compliance check in activity log with structured data
    const checkData = {
      offender_alert_id: parseInt(req.params.id),
      person_id: alert.person_id,
      check_type: check_type || 'address_verification',
      scheduled_date: check_date,
      assigned_officer_id: assigned_officer_id || req.user!.userId,
      status: 'scheduled',
      notes: notes || '',
    };

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'compliance_check_scheduled', 'offender_alert', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, JSON.stringify(checkData), now);

    res.status(201).json({ data: checkData });
  } catch (error: any) {
    console.error('Schedule compliance check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/compliance-checks', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checks = db.prepare(`
      SELECT al.*, u.full_name as scheduled_by_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'offender_alert' AND al.entity_id = ? AND al.action = 'compliance_check_scheduled'
      ORDER BY al.created_at DESC
    `).all(req.params.id) as any[];

    const parsed = checks.map((c: any) => {
      try { return { ...JSON.parse(c.details), id: c.id, created_at: c.created_at, scheduled_by: c.scheduled_by_name }; }
      catch { return c; }
    });

    res.json({ data: parsed });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ════════════════════════════════════════════════════════════
// FEATURE 23: Offender Contact Log
// ════════════════════════════════════════════════════════════

router.post('/:id/contact', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alert = db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(req.params.id) as any;
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    const { contact_type, contact_date, location, gps_lat, gps_lng, outcome, notes } = req.body;
    const now = localNow();

    const contactData = {
      offender_alert_id: parseInt(req.params.id),
      person_id: alert.person_id,
      contact_type: contact_type || 'field_contact',
      contact_date: contact_date || now,
      officer_id: req.user!.userId,
      location: location || '',
      gps_lat: gps_lat ?? null,
      gps_lng: gps_lng ?? null,
      outcome: outcome || 'compliant',
      notes: notes || '',
    };

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'offender_contact', 'offender_alert', ?, ?, ?, ?)
    `).run(req.user!.userId, req.params.id, JSON.stringify(contactData), req.ip || 'unknown', now);

    res.status(201).json({ data: contactData });
  } catch (error: any) {
    console.error('Log offender contact error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/contacts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const contacts = db.prepare(`
      SELECT al.*, u.full_name as officer_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'offender_alert' AND al.entity_id = ? AND al.action = 'offender_contact'
      ORDER BY al.created_at DESC
      LIMIT 100
    `).all(req.params.id) as any[];

    const parsed = contacts.map((c: any) => {
      try { return { ...JSON.parse(c.details), id: c.id, created_at: c.created_at, officer_name: c.officer_name }; }
      catch { return c; }
    });

    res.json({ data: parsed });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ════════════════════════════════════════════════════════════
// FEATURE 24: Risk Assessment Scoring
// ════════════════════════════════════════════════════════════

router.get('/:id/risk-score', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alert = db.prepare(`
      SELECT oa.*, p.first_name, p.last_name, p.dob, p.caution_flags, p.is_sex_offender, p.gang_affiliation
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.id = ?
    `).get(req.params.id) as any;
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    // Count related records
    const alertCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM offender_alerts WHERE person_id = ? AND status = \'active\''
    ).get(alert.person_id) as any)?.cnt || 0;

    const incidentCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM incidents WHERE reporting_officer_id IS NOT NULL AND description LIKE ?'
    ).get(`%${alert.first_name}%${alert.last_name}%`) as any)?.cnt || 0;

    const citationCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM citations WHERE violator_name LIKE ?'
    ).get(`%${alert.last_name}%`) as any)?.cnt || 0;

    // Calculate risk score (0-100)
    let riskScore = 0;
    const factors: { factor: string; points: number; description: string }[] = [];

    // Severity-based points
    const severityPoints: Record<string, number> = { danger: 30, warning: 20, caution: 10, info: 5 };
    const sp = severityPoints[alert.severity] || 5;
    riskScore += sp;
    factors.push({ factor: 'Alert severity', points: sp, description: `${alert.severity} level` });

    // Alert type points
    const typePoints: Record<string, number> = {
      violent_history: 20, sex_offender: 20, gang_member: 15, warrant_flag: 15,
      ban_zone: 10, probation: 10, parole: 10, mental_health: 5, watch_list: 5,
    };
    const tp = typePoints[alert.alert_type] || 5;
    riskScore += tp;
    factors.push({ factor: 'Alert type', points: tp, description: alert.alert_type });

    // Multiple active alerts
    if (alertCount > 1) {
      const mp = Math.min(alertCount * 5, 20);
      riskScore += mp;
      factors.push({ factor: 'Multiple active alerts', points: mp, description: `${alertCount} active alerts` });
    }

    // Incident history
    if (incidentCount > 0) {
      const ip = Math.min(incidentCount * 3, 15);
      riskScore += ip;
      factors.push({ factor: 'Incident history', points: ip, description: `${incidentCount} related incidents` });
    }

    // Citation history
    if (citationCount > 0) {
      const cp = Math.min(citationCount * 2, 10);
      riskScore += cp;
      factors.push({ factor: 'Citation history', points: cp, description: `${citationCount} citations` });
    }

    // Special flags
    if (alert.is_sex_offender) { riskScore += 10; factors.push({ factor: 'Sex offender', points: 10, description: 'Registered sex offender' }); }
    if (alert.gang_affiliation) { riskScore += 10; factors.push({ factor: 'Gang affiliation', points: 10, description: alert.gang_affiliation }); }

    riskScore = Math.min(100, riskScore);

    const riskLevel = riskScore >= 75 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 25 ? 'medium' : 'low';

    res.json({
      data: {
        person_id: alert.person_id,
        person_name: `${alert.first_name} ${alert.last_name}`,
        risk_score: riskScore,
        risk_level: riskLevel,
        factors,
        alert_count: alertCount,
        incident_count: incidentCount,
        citation_count: citationCount,
      },
    });
  } catch (error: any) {
    console.error('Risk assessment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 25: Multi-offender Map View data
// ════════════════════════════════════════════════════════════

router.get('/map/all', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT oa.id, oa.alert_type, oa.severity, oa.description,
             oa.restriction_radius_ft, oa.alert_latitude, oa.alert_longitude, oa.alert_address,
             p.first_name, p.last_name, p.photo_url,
             p.first_name || ' ' || p.last_name as person_name
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.status = 'active'
        AND (oa.alert_latitude IS NOT NULL OR p.latitude IS NOT NULL)
    `).all() as any[];

    // Also get alerts with known addresses from persons
    const withAddresses = db.prepare(`
      SELECT oa.id, oa.alert_type, oa.severity, oa.description,
             oa.restriction_radius_ft,
             p.first_name, p.last_name, p.photo_url, p.address, p.city, p.state,
             p.first_name || ' ' || p.last_name as person_name
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.status = 'active' AND oa.alert_latitude IS NULL AND p.address IS NOT NULL AND p.address != ''
    `).all() as any[];

    res.json({
      data: {
        with_coordinates: rows,
        with_addresses: withAddresses,
        total: rows.length + withAddresses.length,
      },
    });
  } catch (error: any) {
    console.error('Map offenders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
