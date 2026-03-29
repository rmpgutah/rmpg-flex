// ============================================================
// RMPG Flex — Known Offender Registry API Routes
// ============================================================
// Manages flagged person alerts including ban zones, watch lists,
// and severity levels. Links to persons table for demographics.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastAlert } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';
import { sendCsv } from '../utils/csvExport';

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

    res.set('Cache-Control', 'private, max-age=60');
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
    res.status(500).json({ error: 'Failed to get offender stats', code: 'GET_OFFENDER_STATS_ERROR' });
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

    res.set('Cache-Control', 'private, max-age=30');
    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get offender alerts error:', error);
    res.status(500).json({ error: 'Failed to get offender alerts', code: 'GET_OFFENDER_ALERTS_ERROR' });
  }
});

// ─── GET /check/:personId ────────────────────────────────
// Quick check: all active alerts for a specific person
router.get('/check/:personId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const personId = parseInt(req.params.personId, 10);
    if (isNaN(personId)) { res.status(400).json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' }); return; }
    const alerts = db.prepare(`
      SELECT * FROM offender_alerts WHERE person_id = ? AND status = 'active'
      ORDER BY CASE severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 WHEN 'caution' THEN 2 ELSE 3 END
    
      LIMIT 1000
    `).all(personId);
    res.set('Cache-Control', 'private, max-age=60');
    res.json({ data: alerts });
  } catch (error: any) { res.status(500).json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }); }
});

// ─── GET /:id ────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid alert ID', code: 'INVALID_ALERT_ID' }); return; }
    const row = db.prepare(`
      SELECT oa.*, p.first_name, p.last_name, p.dob, p.photo_url,
        p.first_name || ' ' || p.last_name as person_name
      FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' });
    res.json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }); }
});

// ─── POST / ──────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { person_id, alert_type, description, severity = 'caution',
      restricted_properties, restricted_zones, restriction_radius_ft,
      expiration_date, source_incident_id, source_citation_id, source_case_id, notes } = req.body;
    if (!person_id || !alert_type || !description) return res.status(400).json({ error: 'Person, alert type, and description required', code: 'MISSING_FIELDS' });

    // Input sanitization
    const cleanDescription = typeof description === 'string' ? description.trim() : description;

    // Validate severity
    const validSeverities = ['caution', 'warning', 'danger'];
    if (!validSeverities.includes(severity)) return res.status(400).json({ error: 'Invalid severity', code: 'INVALID_SEVERITY' });

    // Validate person_id is numeric
    const parsedPersonId = parseInt(person_id, 10);
    if (isNaN(parsedPersonId)) return res.status(400).json({ error: 'person_id must be a number', code: 'INVALID_PERSON_ID' });

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

    broadcastAlert({ type: 'offender_alert_created', person_id, alert_type, severity });
    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (error: any) {
    console.error('Create offender alert error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'CREATE_ALERT_ERROR' });
  }
});

// ─── PUT /:id ────────────────────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid alert ID', code: 'INVALID_ALERT_ID' }); return; }
    const existing = db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }); return; }
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
    auditLog(req, 'UPDATE', 'offender_alert', id, `Updated offender alert #${id}`);
    res.json({ data: { id } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error', code: 'UPDATE_ALERT_ERROR' }); }
});

// ─── PUT /:id/clear ──────────────────────────────────────
router.put('/:id/clear', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid alert ID', code: 'INVALID_ALERT_ID' }); return; }
    const existing = db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(id);
    if (!existing) { res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }); return; }
    const now = localNow();
    db.prepare('UPDATE offender_alerts SET status = ?, updated_at = ? WHERE id = ?').run('cleared', now, id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'clear', 'offender_alert', ?, '{}', ?)`).run(req.user!.userId, id, now);

    res.json({ data: { id, status: 'cleared' } });
  } catch (error: any) { res.status(500).json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }); }
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
    if (!existing) return res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' });

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
    res.status(500).json({ error: 'Failed to set proximity alert', code: 'SET_PROXIMITY_ALERT_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 22: Compliance Check Scheduling
// ════════════════════════════════════════════════════════════

router.post('/:id/schedule-check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alert = db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(req.params.id) as any;
    if (!alert) return res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' });

    const { check_date, check_type, assigned_officer_id, notes } = req.body;
    if (!check_date) return res.status(400).json({ error: 'check_date is required', code: 'CHECKDATE_IS_REQUIRED' });

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
    res.status(500).json({ error: 'Failed to schedule compliance check', code: 'SCHEDULE_COMPLIANCE_CHECK_ERROR' });
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
    
      LIMIT 1000
    `).all(req.params.id) as any[];

    const parsed = checks.map((c: any) => {
      try { return { ...JSON.parse(c.details), id: c.id, created_at: c.created_at, scheduled_by: c.scheduled_by_name }; }
      catch { return c; }
    });

    res.json({ data: parsed });
  } catch (error: any) { res.status(500).json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// FEATURE 23: Offender Contact Log
// ════════════════════════════════════════════════════════════

router.post('/:id/contact', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alert = db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(req.params.id) as any;
    if (!alert) return res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' });

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
    res.status(500).json({ error: 'Failed to log offender contact', code: 'LOG_OFFENDER_CONTACT_ERROR' });
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
  } catch (error: any) { res.status(500).json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }); }
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
    if (!alert) return res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' });

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
    res.status(500).json({ error: 'Failed to risk assessment', code: 'RISK_ASSESSMENT_ERROR' });
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
    
      LIMIT 1000
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
    
      LIMIT 1000
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
    res.status(500).json({ error: 'Failed to map offenders', code: 'MAP_OFFENDERS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Address Verification Scheduling
// ════════════════════════════════════════════════════════════

router.post('/:id/schedule-verification', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alert = db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(req.params.id) as any;
    if (!alert) return res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' });

    const { verification_date, verification_type, assigned_officer_id, address_to_verify, notes } = req.body;
    if (!verification_date) return res.status(400).json({ error: 'verification_date required', code: 'VERIFICATION_DATE_REQUIRED' });

    const now = localNow();
    const verificationData = {
      offender_alert_id: parseInt(req.params.id),
      person_id: alert.person_id,
      verification_type: verification_type || 'address_verification',
      scheduled_date: verification_date,
      assigned_officer_id: assigned_officer_id || req.user!.userId,
      address_to_verify: address_to_verify || null,
      status: 'scheduled',
      notes: notes || '',
    };

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'address_verification_scheduled', 'offender_alert', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, JSON.stringify(verificationData), now);

    res.status(201).json({ data: verificationData });
  } catch (error: any) {
    console.error('Schedule verification error:', error);
    res.status(500).json({ error: 'Failed to schedule verification', code: 'SCHEDULE_VERIFICATION_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Compliance Check Logging with Results
// ════════════════════════════════════════════════════════════

router.post('/:id/compliance-result', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alert = db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(req.params.id) as any;
    if (!alert) return res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' });

    const { check_type, result, address_verified, address_current, resident_confirmed,
      gps_lat, gps_lng, photos_taken, officer_notes } = req.body;

    const validResults = ['compliant', 'non_compliant', 'unable_to_verify', 'absconded', 'moved'];
    if (!result || !validResults.includes(result))
      return res.status(400).json({ error: 'Valid result required', code: 'INVALID_RESULT' });

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    const complianceData = {
      offender_alert_id: parseInt(req.params.id),
      person_id: alert.person_id,
      check_type: check_type || 'address_verification',
      result,
      address_verified: address_verified || null,
      address_current: address_current !== undefined ? address_current : null,
      resident_confirmed: resident_confirmed !== undefined ? resident_confirmed : null,
      gps_lat: gps_lat || null,
      gps_lng: gps_lng || null,
      photos_taken: photos_taken || 0,
      officer_id: req.user!.userId,
      officer_name: user?.full_name || '',
      officer_notes: officer_notes || '',
      checked_at: now,
    };

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'compliance_check_completed', 'offender_alert', ?, ?, ?, ?)`).run(
      req.user!.userId, req.params.id, JSON.stringify(complianceData), req.ip || 'unknown', now);

    // Update last compliance check date on alert
    db.prepare(`UPDATE offender_alerts SET last_compliance_check = ?, last_compliance_result = ?, updated_at = ? WHERE id = ?`)
      .run(now, result, now, req.params.id);

    // If non-compliant or absconded, escalate severity
    if (['non_compliant', 'absconded'].includes(result) && alert.severity !== 'danger') {
      const newSeverity = result === 'absconded' ? 'danger' : 'warning';
      db.prepare(`UPDATE offender_alerts SET severity = ?, updated_at = ? WHERE id = ?`)
        .run(newSeverity, now, req.params.id);
      broadcastAlert({ type: 'offender_compliance_failure', person_id: alert.person_id, result, severity: newSeverity });
    }

    res.status(201).json({ data: complianceData });
  } catch (error: any) {
    console.error('Compliance result error:', error);
    res.status(500).json({ error: 'Failed to record compliance result', code: 'COMPLIANCE_RESULT_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Registration Expiration Alerts
// ════════════════════════════════════════════════════════════

router.get('/expiring-registrations', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '30' } = req.query;
    const daysAhead = parseInt(days as string, 10) || 30;

    const expiring = db.prepare(`
      SELECT oa.*, p.first_name, p.last_name, p.address, p.city, p.state,
        p.first_name || ' ' || p.last_name as person_name,
        CAST(JULIANDAY(oa.expiration_date) - JULIANDAY('now') AS INTEGER) as days_until_expiry
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.status = 'active' AND oa.expiration_date IS NOT NULL
        AND oa.expiration_date <= DATE('now', '+' || ? || ' days')
      ORDER BY oa.expiration_date ASC
      LIMIT 100
    `).all(String(daysAhead));

    const alreadyExpired = db.prepare(`
      SELECT oa.*, p.first_name, p.last_name,
        p.first_name || ' ' || p.last_name as person_name,
        CAST(JULIANDAY('now') - JULIANDAY(oa.expiration_date) AS INTEGER) as days_expired
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.status = 'active' AND oa.expiration_date IS NOT NULL
        AND oa.expiration_date < DATE('now')
      ORDER BY oa.expiration_date ASC
      LIMIT 100
    `).all();

    res.json({
      data: {
        expiring_soon: expiring,
        already_expired: alreadyExpired,
        expiring_count: expiring.length,
        expired_count: alreadyExpired.length,
        days_ahead: daysAhead,
      },
    });
  } catch (error: any) {
    console.error('Expiring registrations error:', error);
    res.status(500).json({ error: 'Failed to get expiring registrations', code: 'EXPIRING_REGISTRATIONS_ERROR' });
  }
});

// Generate expiration notifications
router.post('/generate-expiration-alerts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    // Find alerts expiring in next 30 days that haven't been notified
    const expiring = db.prepare(`
      SELECT oa.id, oa.person_id, oa.alert_type, oa.expiration_date,
        p.first_name || ' ' || p.last_name as person_name
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      WHERE oa.status = 'active' AND oa.expiration_date IS NOT NULL
        AND oa.expiration_date <= DATE('now', '+30 days')
        AND oa.expiration_date > DATE('now')
        AND oa.expiration_notified IS NULL
      LIMIT 200
    `).all() as any[];

    let notified = 0;
    for (const alert of expiring) {
      // Notify all supervisors
      const supervisors = db.prepare(`SELECT id FROM users WHERE role IN ('admin', 'manager', 'supervisor') AND status = 'active'`).all() as any[];
      for (const sup of supervisors) {
        try {
          db.prepare(`INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, created_at)
            VALUES ('system', 'normal', ?, ?, 'offender_alert', ?, ?, ?)`).run(
            `Registration Expiring: ${alert.person_name || 'Unknown'}`,
            `${alert.alert_type} registration for ${alert.person_name || 'Unknown'} expires on ${alert.expiration_date}`,
            alert.id, sup.id, now
          );
        } catch { /* notification table may not exist */ }
      }
      db.prepare(`UPDATE offender_alerts SET expiration_notified = ? WHERE id = ?`).run(now, alert.id);
      notified++;
    }

    res.json({ alerts_notified: notified });
  } catch (error: any) {
    console.error('Generate expiration alerts error:', error);
    res.status(500).json({ error: 'Failed to generate expiration alerts', code: 'EXPIRATION_ALERTS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Compliance History Summary
// ════════════════════════════════════════════════════════════

router.get('/:id/compliance-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const alert = db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(req.params.id) as any;
    if (!alert) return res.status(404).json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' });

    const allChecks = db.prepare(`
      SELECT al.details, al.created_at, u.full_name as officer_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'offender_alert' AND al.entity_id = ?
        AND al.action IN ('compliance_check_completed', 'compliance_check_scheduled', 'offender_contact', 'address_verification_scheduled')
      ORDER BY al.created_at DESC
      LIMIT 200
    `).all(req.params.id) as any[];

    const parsed = allChecks.map((c: any) => {
      try { return { ...JSON.parse(c.details), created_at: c.created_at, officer_name: c.officer_name }; }
      catch { return { raw: c.details, created_at: c.created_at, officer_name: c.officer_name }; }
    });

    const compliant = parsed.filter((p: any) => p.result === 'compliant').length;
    const nonCompliant = parsed.filter((p: any) => p.result === 'non_compliant').length;
    const total = parsed.filter((p: any) => p.result).length;

    res.json({
      data: {
        alert_id: parseInt(req.params.id),
        checks: parsed,
        total_checks: total,
        compliant_count: compliant,
        non_compliant_count: nonCompliant,
        compliance_rate: total > 0 ? Math.round((compliant / total) * 100) : 0,
        last_check: alert.last_compliance_check || null,
        last_result: alert.last_compliance_result || null,
      },
    });
  } catch (error: any) {
    console.error('Compliance summary error:', error);
    res.status(500).json({ error: 'Failed to get compliance summary', code: 'COMPLIANCE_SUMMARY_ERROR' });
  }
});

// ─── DELETE /:id ────────────────────────────────────────
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid alert ID', code: 'INVALID_ALERT_ID' }); return; }
    const result = db.prepare('DELETE FROM offender_alerts WHERE id = ?').run(id);
    if (result.changes === 0) { res.status(404).json({ error: 'Not found', code: 'ALERT_NOT_FOUND' }); return; }
    auditLog(req, 'DELETE', 'offender_alert', id, `Deleted offender alert #${id}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete offender alert error:', error);
    res.status(500).json({ error: 'Delete failed', code: 'DELETE_ALERT_ERROR' });
  }
});

// ─── CSV Export ──────────────────────────────────────────
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT oa.*, p.full_name as person_name, p.dob as person_dob
      FROM offender_alerts oa
      LEFT JOIN persons p ON oa.person_id = p.id
      ORDER BY oa.created_at DESC
    `).all() as any[];
    sendCsv(res, 'offender_alerts_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'person_name', header: 'Person Name' },
      { key: 'person_dob', header: 'DOB' },
      { key: 'alert_type', header: 'Alert Type' },
      { key: 'severity', header: 'Severity' },
      { key: 'status', header: 'Status' },
      { key: 'description', header: 'Description' },
      { key: 'ban_zone', header: 'Ban Zone' },
      { key: 'expiration_date', header: 'Expiration' },
      { key: 'created_by_name', header: 'Created By' },
      { key: 'created_at', header: 'Created' },
      { key: 'updated_at', header: 'Updated' },
    ], rows);
  } catch (error: any) {
    console.error('Export offender alerts error:', error);
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});

export default router;
