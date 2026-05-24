// ============================================================
// Known Offender Registry — Workers (Hono) Port
// Alerts CRUD, stats, person check, proximity alerts,
// compliance checks, contact log, risk scoring, map view,
// expiring registrations, CSV export.
// Skips: auditLog, broadcastAlert, sendCsv.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

export function mountOffenderRegistryRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // === GET /stats ===
  api.get('/stats', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const typeCounts = await db.prepare(`
        SELECT alert_type, COUNT(*) as count FROM offender_alerts WHERE status = 'active' GROUP BY alert_type
      `).all() as any[];
      const severityCounts = await db.prepare(`
        SELECT severity, COUNT(*) as count FROM offender_alerts WHERE status = 'active' GROUP BY severity
      `).all() as any[];
      const totalPersons = await db.prepare(`
        SELECT COUNT(DISTINCT person_id) as count FROM offender_alerts WHERE status = 'active'
      `).get() as any;
      const expiringSoon = await db.prepare(`
        SELECT COUNT(*) as count FROM offender_alerts
        WHERE status = 'active' AND expiration_date IS NOT NULL
        AND expiration_date <= DATE('now', '+30 days')
      `).get() as any;

      c.header('Cache-Control', 'private, max-age=60');
      return c.json({
        data: {
          by_type: Object.fromEntries(typeCounts.map(r => [r.alert_type, r.count])),
          by_severity: Object.fromEntries(severityCounts.map(r => [r.severity, r.count])),
          total_alerts: typeCounts.reduce((a: number, b: any) => a + b.count, 0),
          total_persons: totalPersons?.count || 0,
          expiring_soon: expiringSoon?.count || 0,
        },
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to get offender stats', code: 'GET_OFFENDER_STATS_ERROR' }, 500);
    }
  });

  // === GET / — List alerts ===
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { alert_type, severity, status = 'active', search, page = '1', limit = '100000' } = q;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
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

      const total = (await db.prepare(`
        SELECT COUNT(*) as count FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id ${where}
      `).get(...params) as any).count;

      const rows = await db.prepare(`
        SELECT oa.*,
          p.first_name, p.last_name, p.dob, p.photo_url,
          p.caution_flags, p.is_sex_offender, p.gang_affiliation,
          p.first_name || ' ' || p.last_name as person_name
        FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
        ${where}
        ORDER BY
          CASE oa.severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 WHEN 'caution' THEN 2 ELSE 3 END,
          oa.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);

      c.header('Cache-Control', 'private, max-age=30');
      return c.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
    } catch (error: any) {
      return c.json({ error: 'Failed to get offender alerts', code: 'GET_OFFENDER_ALERTS_ERROR' }, 500);
    }
  });

  // === GET /check/:personId — Quick check for active alerts on a person ===
  api.get('/check/:personId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const personId = paramNum(c.req.param('personId'));
      if (isNaN(personId)) return c.json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' }, 400);

      const alerts = await db.prepare(`
        SELECT * FROM offender_alerts WHERE person_id = ? AND status = 'active'
        ORDER BY CASE severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 WHEN 'caution' THEN 2 ELSE 3 END LIMIT 1000
      `).all(personId);

      c.header('Cache-Control', 'private, max-age=60');
      return c.json({ data: alerts });
    } catch (error: any) {
      return c.json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }, 500);
    }
  });

  // === GET /:id — Single alert ===
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid alert ID', code: 'INVALID_ALERT_ID' }, 400);

      const row = await db.prepare(`
        SELECT oa.*, p.first_name, p.last_name, p.dob, p.photo_url,
          p.first_name || ' ' || p.last_name as person_name
        FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
        WHERE oa.id = ?
      `).get(id);

      if (!row) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);
      return c.json({ data: row });
    } catch (error: any) {
      return c.json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }, 500);
    }
  });

  // === POST / — Create alert ===
  api.post('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const body = await c.req.json();
      const { person_id, alert_type, description, severity = 'caution',
        restricted_properties, restricted_zones, restriction_radius_ft,
        expiration_date, source_incident_id, source_citation_id, source_case_id, notes } = body;

      if (!person_id || !alert_type || !description)
        return c.json({ error: 'Person, alert type, and description required', code: 'MISSING_FIELDS' }, 400);

      const validSeverities = ['caution', 'warning', 'danger'];
      if (!validSeverities.includes(severity))
        return c.json({ error: 'Invalid severity', code: 'INVALID_SEVERITY' }, 400);

      const parsedPersonId = parseInt(person_id, 10);
      if (isNaN(parsedPersonId))
        return c.json({ error: 'person_id must be a number', code: 'INVALID_PERSON_ID' }, 400);

      const result = await db.prepare(`
        INSERT INTO offender_alerts (person_id, alert_type, status, description, severity,
          restricted_properties, restricted_zones, restriction_radius_ft,
          effective_date, expiration_date, source_incident_id, source_citation_id, source_case_id,
          created_by, notes, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(person_id, alert_type, description, severity,
        JSON.stringify(restricted_properties || []), JSON.stringify(restricted_zones || []),
        restriction_radius_ft || null, now, expiration_date || null,
        source_incident_id || null, source_citation_id || null, source_case_id || null,
        user.userId, notes || null, now, now);

      return c.json({ data: { id: result.meta.last_row_id } }, 201);
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'CREATE_ALERT_ERROR' }, 500);
    }
  });

  // === PUT /:id — Update alert ===
  api.put('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid alert ID', code: 'INVALID_ALERT_ID' }, 400);

      const existing = await db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(id);
      if (!existing) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

      const now = localNow();
      const body = await c.req.json();
      const fields = ['alert_type', 'description', 'severity', 'restriction_radius_ft', 'expiration_date', 'notes'];
      const updates: string[] = ['updated_at = ?'];
      const params: any[] = [now];

      for (const f of fields) {
        if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(body[f]); }
      }
      if (body.restricted_properties !== undefined) {
        updates.push('restricted_properties = ?');
        params.push(JSON.stringify(body.restricted_properties));
      }
      if (body.restricted_zones !== undefined) {
        updates.push('restricted_zones = ?');
        params.push(JSON.stringify(body.restricted_zones));
      }
      params.push(id);
      await db.prepare(`UPDATE offender_alerts SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      return c.json({ data: { id } });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'UPDATE_ALERT_ERROR' }, 500);
    }
  });

  // === PUT /:id/clear — Clear alert ===
  api.put('/:id/clear', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid alert ID', code: 'INVALID_ALERT_ID' }, 400);

      const existing = await db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(id);
      if (!existing) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

      const now = localNow();
      await db.prepare('UPDATE offender_alerts SET status = ?, updated_at = ? WHERE id = ?').run('cleared', now, id);

      return c.json({ data: { id, status: 'cleared' } });
    } catch (error: any) {
      return c.json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }, 500);
    }
  });

  // === PUT /:id/proximity-alert — Configure proximity alert ===
  api.put('/:id/proximity-alert', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { alert_radius_ft, alert_latitude, alert_longitude, alert_address, alert_enabled } = body;
      const now = localNow();

      const existing = await db.prepare('SELECT id FROM offender_alerts WHERE id = ?').get(c.req.param('id'));
      if (!existing) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

      await db.prepare(`
        UPDATE offender_alerts SET
          restriction_radius_ft = COALESCE(?, restriction_radius_ft),
          alert_latitude = ?, alert_longitude = ?, alert_address = ?,
          alert_enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(
        alert_radius_ft ?? null,
        alert_latitude ?? null,
        alert_longitude ?? null,
        alert_address ?? null,
        alert_enabled !== undefined ? (alert_enabled ? 1 : 0) : 1,
        now, c.req.param('id')
      );

      return c.json({ data: { id: parseInt(c.req.param('id')), alert_radius_ft, alert_enabled } });
    } catch (error: any) {
      return c.json({ error: 'Failed to set proximity alert', code: 'SET_PROXIMITY_ALERT_ERROR' }, 500);
    }
  });

  // === POST /:id/schedule-check — Schedule compliance check ===
  api.post('/:id/schedule-check', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const alert = await db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(c.req.param('id')) as any;
      if (!alert) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { check_date, check_type, assigned_officer_id, notes } = body;
      if (!check_date) return c.json({ error: 'check_date is required', code: 'CHECKDATE_IS_REQUIRED' }, 400);

      const now = localNow();
      const checkData = {
        offender_alert_id: parseInt(c.req.param('id')),
        person_id: alert.person_id,
        check_type: check_type || 'address_verification',
        scheduled_date: check_date,
        assigned_officer_id: assigned_officer_id || user.userId,
        status: 'scheduled',
        notes: notes || '',
      };

      await db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
        VALUES (?, 'compliance_check_scheduled', 'offender_alert', ?, ?, ?)
      `).run(user.userId, c.req.param('id'), JSON.stringify(checkData), now);

      return c.json({ data: checkData }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to schedule compliance check', code: 'SCHEDULE_COMPLIANCE_CHECK_ERROR' }, 500);
    }
  });

  // === GET /:id/compliance-checks — List scheduled checks ===
  api.get('/:id/compliance-checks', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const checks = await db.prepare(`
        SELECT al.*, u.full_name as scheduled_by_name
        FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
        WHERE al.entity_type = 'offender_alert' AND al.entity_id = ? AND al.action = 'compliance_check_scheduled'
        ORDER BY al.created_at DESC LIMIT 1000
      `).all(c.req.param('id')) as any[];

      const parsed = checks.map((ch: any) => {
        try { return { ...JSON.parse(ch.details), id: ch.id, created_at: ch.created_at, scheduled_by: ch.scheduled_by_name }; }
        catch { return ch; }
      });

      return c.json({ data: parsed });
    } catch (error: any) {
      return c.json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }, 500);
    }
  });

  // === POST /:id/contact — Log offender contact ===
  api.post('/:id/contact', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const alert = await db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(c.req.param('id')) as any;
      if (!alert) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { contact_type, contact_date, location, gps_lat, gps_lng, outcome, notes } = body;
      const now = localNow();

      const contactData = {
        offender_alert_id: parseInt(c.req.param('id')),
        person_id: alert.person_id,
        contact_type: contact_type || 'field_contact',
        contact_date: contact_date || now,
        officer_id: user.userId,
        location: location || '',
        gps_lat: gps_lat ?? null,
        gps_lng: gps_lng ?? null,
        outcome: outcome || 'compliant',
        notes: notes || '',
      };

      await db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, 'offender_contact', 'offender_alert', ?, ?, ?, ?)
      `).run(user.userId, c.req.param('id'), JSON.stringify(contactData), 'unknown', now);

      return c.json({ data: contactData }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to log offender contact', code: 'LOG_OFFENDER_CONTACT_ERROR' }, 500);
    }
  });

  // === GET /:id/contacts — Get contact log ===
  api.get('/:id/contacts', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const contacts = await db.prepare(`
        SELECT al.*, u.full_name as officer_name
        FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
        WHERE al.entity_type = 'offender_alert' AND al.entity_id = ? AND al.action = 'offender_contact'
        ORDER BY al.created_at DESC LIMIT 100
      `).all(c.req.param('id')) as any[];

      const parsed = contacts.map((ct: any) => {
        try { return { ...JSON.parse(ct.details), id: ct.id, created_at: ct.created_at, officer_name: ct.officer_name }; }
        catch { return ct; }
      });

      return c.json({ data: parsed });
    } catch (error: any) {
      return c.json({ error: 'Server error in offenderRegistry', code: 'OFFENDERREGISTRY_ERROR' }, 500);
    }
  });

  // === GET /:id/risk-score — Risk assessment scoring ===
  api.get('/:id/risk-score', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const alert = await db.prepare(`
        SELECT oa.*, p.first_name, p.last_name, p.dob, p.caution_flags, p.is_sex_offender, p.gang_affiliation
        FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
        WHERE oa.id = ?
      `).get(c.req.param('id')) as any;
      if (!alert) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

      const alertCount = (await db.prepare(
        'SELECT COUNT(*) as cnt FROM offender_alerts WHERE person_id = ? AND status = \'active\''
      ).get(alert.person_id) as any)?.cnt || 0;

      const incidentCount = (await db.prepare(
        'SELECT COUNT(*) as cnt FROM incidents WHERE reporting_officer_id IS NOT NULL AND description LIKE ?'
      ).get(`%${alert.first_name}%${alert.last_name}%`) as any)?.cnt || 0;

      const citationCount = (await db.prepare(
        'SELECT COUNT(*) as cnt FROM citations WHERE violator_name LIKE ?'
      ).get(`%${alert.last_name}%`) as any)?.cnt || 0;

      let riskScore = 0;
      const factors: { factor: string; points: number; description: string }[] = [];

      const severityPoints: Record<string, number> = { danger: 30, warning: 20, caution: 10, info: 5 };
      const sp = severityPoints[alert.severity] || 5;
      riskScore += sp;
      factors.push({ factor: 'Alert severity', points: sp, description: `${alert.severity} level` });

      const typePoints: Record<string, number> = {
        violent_history: 20, sex_offender: 20, gang_member: 15, warrant_flag: 15,
        ban_zone: 10, probation: 10, parole: 10, mental_health: 5, watch_list: 5,
      };
      const tp = typePoints[alert.alert_type] || 5;
      riskScore += tp;
      factors.push({ factor: 'Alert type', points: tp, description: alert.alert_type });

      if (alertCount > 1) {
        const mp = Math.min(alertCount * 5, 20);
        riskScore += mp;
        factors.push({ factor: 'Multiple active alerts', points: mp, description: `${alertCount} active alerts` });
      }

      if (incidentCount > 0) {
        const ip = Math.min(incidentCount * 3, 15);
        riskScore += ip;
        factors.push({ factor: 'Incident history', points: ip, description: `${incidentCount} related incidents` });
      }

      if (citationCount > 0) {
        const cp = Math.min(citationCount * 2, 10);
        riskScore += cp;
        factors.push({ factor: 'Citation history', points: cp, description: `${citationCount} citations` });
      }

      if (alert.is_sex_offender) { riskScore += 10; factors.push({ factor: 'Sex offender', points: 10, description: 'Registered sex offender' }); }
      if (alert.gang_affiliation) { riskScore += 10; factors.push({ factor: 'Gang affiliation', points: 10, description: alert.gang_affiliation }); }

      riskScore = Math.min(100, riskScore);
      const riskLevel = riskScore >= 75 ? 'critical' : riskScore >= 50 ? 'high' : riskScore >= 25 ? 'medium' : 'low';

      return c.json({
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
      return c.json({ error: 'Failed to risk assessment', code: 'RISK_ASSESSMENT_ERROR' }, 500);
    }
  });

  // === GET /map/all — Map data for all active offenders ===
  api.get('/map/all', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT oa.id, oa.alert_type, oa.severity, oa.description,
               oa.restriction_radius_ft, oa.alert_latitude, oa.alert_longitude, oa.alert_address,
               p.first_name, p.last_name, p.photo_url,
               p.first_name || ' ' || p.last_name as person_name
        FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
        WHERE oa.status = 'active'
          AND (oa.alert_latitude IS NOT NULL OR p.latitude IS NOT NULL)
        LIMIT 1000
      `).all() as any[];

      const withAddresses = await db.prepare(`
        SELECT oa.id, oa.alert_type, oa.severity, oa.description,
               oa.restriction_radius_ft,
               p.first_name, p.last_name, p.photo_url, p.address, p.city, p.state,
               p.first_name || ' ' || p.last_name as person_name
        FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
        WHERE oa.status = 'active' AND oa.alert_latitude IS NULL AND p.address IS NOT NULL AND p.address != ''
        LIMIT 1000
      `).all() as any[];

      return c.json({
        data: {
          with_coordinates: rows,
          with_addresses: withAddresses,
          total: rows.length + withAddresses.length,
        },
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to map offenders', code: 'MAP_OFFENDERS_ERROR' }, 500);
    }
  });

  // === POST /:id/schedule-verification — Schedule address verification ===
  api.post('/:id/schedule-verification', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const alert = await db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(c.req.param('id')) as any;
      if (!alert) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { verification_date, verification_type, assigned_officer_id, address_to_verify, notes } = body;
      if (!verification_date) return c.json({ error: 'verification_date required', code: 'VERIFICATION_DATE_REQUIRED' }, 400);

      const now = localNow();
      const verificationData = {
        offender_alert_id: parseInt(c.req.param('id')),
        person_id: alert.person_id,
        verification_type: verification_type || 'address_verification',
        scheduled_date: verification_date,
        assigned_officer_id: assigned_officer_id || user.userId,
        address_to_verify: address_to_verify || null,
        status: 'scheduled',
        notes: notes || '',
      };

      await db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
        VALUES (?, 'address_verification_scheduled', 'offender_alert', ?, ?, ?)`).run(
        user.userId, c.req.param('id'), JSON.stringify(verificationData), now);

      return c.json({ data: verificationData }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to schedule verification', code: 'SCHEDULE_VERIFICATION_ERROR' }, 500);
    }
  });

  // === POST /:id/compliance-result — Record compliance check result ===
  api.post('/:id/compliance-result', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const alert = await db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(c.req.param('id')) as any;
      if (!alert) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { check_type, result, address_verified, address_current, resident_confirmed,
        gps_lat, gps_lng, photos_taken, officer_notes } = body;

      const validResults = ['compliant', 'non_compliant', 'unable_to_verify', 'absconded', 'moved'];
      if (!result || !validResults.includes(result))
        return c.json({ error: 'Valid result required', code: 'INVALID_RESULT' }, 400);

      const now = localNow();
      const userRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user.userId) as any;

      const complianceData = {
        offender_alert_id: parseInt(c.req.param('id')),
        person_id: alert.person_id,
        check_type: check_type || 'address_verification',
        result,
        address_verified: address_verified || null,
        address_current: address_current !== undefined ? address_current : null,
        resident_confirmed: resident_confirmed !== undefined ? resident_confirmed : null,
        gps_lat: gps_lat || null,
        gps_lng: gps_lng || null,
        photos_taken: photos_taken || 0,
        officer_id: user.userId,
        officer_name: userRow?.full_name || '',
        officer_notes: officer_notes || '',
        checked_at: now,
      };

      await db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, 'compliance_check_completed', 'offender_alert', ?, ?, ?, ?)`).run(
        user.userId, c.req.param('id'), JSON.stringify(complianceData), 'unknown', now);

      await db.prepare(`UPDATE offender_alerts SET last_compliance_check = ?, last_compliance_result = ?, updated_at = ? WHERE id = ?`)
        .run(now, result, now, c.req.param('id'));

      if (['non_compliant', 'absconded'].includes(result) && alert.severity !== 'danger') {
        const newSeverity = result === 'absconded' ? 'danger' : 'warning';
        await db.prepare(`UPDATE offender_alerts SET severity = ?, updated_at = ? WHERE id = ?`)
          .run(newSeverity, now, c.req.param('id'));
      }

      return c.json({ data: complianceData }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to record compliance result', code: 'COMPLIANCE_RESULT_ERROR' }, 500);
    }
  });

  // === GET /expiring-registrations — Expiring registration alerts ===
  api.get('/expiring-registrations', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const days = parseInt(c.req.query('days') || '30', 10) || 30;

      const expiring = await db.prepare(`
        SELECT oa.*, p.first_name, p.last_name, p.address, p.city, p.state,
          p.first_name || ' ' || p.last_name as person_name,
          CAST(JULIANDAY(oa.expiration_date) - JULIANDAY('now') AS INTEGER) as days_until_expiry
        FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
        WHERE oa.status = 'active' AND oa.expiration_date IS NOT NULL
          AND oa.expiration_date <= DATE('now', '+' || ? || ' days')
        ORDER BY oa.expiration_date ASC LIMIT 100
      `).all(String(days));

      const alreadyExpired = await db.prepare(`
        SELECT oa.*, p.first_name, p.last_name,
          p.first_name || ' ' || p.last_name as person_name,
          CAST(JULIANDAY('now') - JULIANDAY(oa.expiration_date) AS INTEGER) as days_expired
        FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
        WHERE oa.status = 'active' AND oa.expiration_date IS NOT NULL
          AND oa.expiration_date < DATE('now')
        ORDER BY oa.expiration_date ASC LIMIT 100
      `).all();

      return c.json({
        data: {
          expiring_soon: expiring,
          already_expired: alreadyExpired,
          expiring_count: expiring.length,
          expired_count: alreadyExpired.length,
          days_ahead: days,
        },
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to get expiring registrations', code: 'EXPIRING_REGISTRATIONS_ERROR' }, 500);
    }
  });

  // === GET /:id/compliance-summary — Compliance history summary ===
  api.get('/:id/compliance-summary', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const alert = await db.prepare('SELECT * FROM offender_alerts WHERE id = ?').get(c.req.param('id')) as any;
      if (!alert) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

      const allChecks = await db.prepare(`
        SELECT al.details, al.created_at, u.full_name as officer_name
        FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
        WHERE al.entity_type = 'offender_alert' AND al.entity_id = ?
          AND al.action IN ('compliance_check_completed', 'compliance_check_scheduled', 'offender_contact', 'address_verification_scheduled')
        ORDER BY al.created_at DESC LIMIT 200
      `).all(c.req.param('id')) as any[];

      const parsed = allChecks.map((ch: any) => {
        try { return { ...JSON.parse(ch.details), created_at: ch.created_at, officer_name: ch.officer_name }; }
        catch { return { raw: ch.details, created_at: ch.created_at, officer_name: ch.officer_name }; }
      });

      const compliant = parsed.filter((p: any) => p.result === 'compliant').length;
      const nonCompliant = parsed.filter((p: any) => p.result === 'non_compliant').length;
      const total = parsed.filter((p: any) => p.result).length;

      return c.json({
        data: {
          alert_id: parseInt(c.req.param('id')),
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
      return c.json({ error: 'Failed to get compliance summary', code: 'COMPLIANCE_SUMMARY_ERROR' }, 500);
    }
  });

  // === DELETE /:id — Delete alert (admin only) ===
  api.delete('/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid alert ID', code: 'INVALID_ALERT_ID' }, 400);

      const result = await db.prepare('DELETE FROM offender_alerts WHERE id = ?').run(id);
      if (result.meta.changes === 0) return c.json({ error: 'Not found', code: 'ALERT_NOT_FOUND' }, 404);

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Delete failed', code: 'DELETE_ALERT_ERROR' }, 500);
    }
  });

  // === GET /export/csv — CSV export ===
  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT oa.*, p.full_name as person_name, p.dob as person_dob
        FROM offender_alerts oa LEFT JOIN persons p ON oa.person_id = p.id
        ORDER BY oa.created_at DESC
      `).all() as any[];

      const headers = ['ID', 'Person Name', 'DOB', 'Alert Type', 'Severity', 'Status', 'Description', 'Ban Zone', 'Expiration', 'Created By', 'Created', 'Updated'];
      const csvRows = rows.map((r: any) => [r.id, r.person_name, r.person_dob, r.alert_type, r.severity, r.status, r.description, r.ban_zone, r.expiration_date, r.created_by_name, r.created_at, r.updated_at]);
      const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');

      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', 'attachment; filename="offender_alerts_export.csv"');
      return c.body(csv);
    } catch (error: any) {
      return c.json({ error: 'Export failed', code: 'EXPORT_FAILED' }, 500);
    }
  });

  app.route('/api/offender-registry', api);
}
