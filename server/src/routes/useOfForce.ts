import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── DASHBOARD / STATS ───────────────────────────────

// GET /api/use-of-force/stats
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 365;

    const total = (db.prepare(`
      SELECT COUNT(*) as count FROM use_of_force_reports
      WHERE incident_date >= date('now', '-${days} days')
    `).get() as any).count;

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM use_of_force_reports
      WHERE incident_date >= date('now', '-${days} days')
      GROUP BY status ORDER BY count DESC
    `).all();

    const byForceLevel = db.prepare(`
      SELECT force_level, COUNT(*) as count FROM use_of_force_reports
      WHERE incident_date >= date('now', '-${days} days')
      GROUP BY force_level ORDER BY count DESC
    `).all();

    const byOfficer = db.prepare(`
      SELECT u.full_name, u.badge_number, COUNT(*) as count
      FROM use_of_force_reports r
      JOIN users u ON r.officer_id = u.id
      WHERE r.incident_date >= date('now', '-${days} days')
      GROUP BY r.officer_id ORDER BY count DESC LIMIT 10
    `).all();

    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', incident_date) as month, COUNT(*) as count
      FROM use_of_force_reports
      WHERE incident_date >= date('now', '-${days} days')
      GROUP BY month ORDER BY month ASC
    `).all();

    const subjectInjuryRate = (db.prepare(`
      SELECT ROUND(100.0 * SUM(CASE WHEN subject_medical_treatment = 1 THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 1) as rate
      FROM use_of_force_reports
      WHERE incident_date >= date('now', '-${days} days')
    `).get() as any).rate || 0;

    const officerInjuryRate = (db.prepare(`
      SELECT ROUND(100.0 * SUM(CASE WHEN officer_medical_treatment = 1 THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 1) as rate
      FROM use_of_force_reports
      WHERE incident_date >= date('now', '-${days} days')
    `).get() as any).rate || 0;

    const pendingReview = (db.prepare(`
      SELECT COUNT(*) as count FROM use_of_force_reports WHERE status IN ('submitted','under_review')
    `).get() as any).count;

    const deEscalationRate = (db.prepare(`
      SELECT ROUND(100.0 * SUM(CASE WHEN de_escalation_attempted = 1 THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 1) as rate
      FROM use_of_force_reports
      WHERE incident_date >= date('now', '-${days} days')
    `).get() as any).rate || 0;

    res.json({
      total, byStatus, byForceLevel, byOfficer, monthly,
      subjectInjuryRate, officerInjuryRate, pendingReview, deEscalationRate,
    });
  } catch (error: any) {
    console.error('UOF stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── LIST ────────────────────────────────────────────

// GET /api/use-of-force
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, force_level, officer_id, search } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND r.status = ?'; params.push(status); }
    if (force_level) { where += ' AND r.force_level = ?'; params.push(force_level); }
    if (officer_id) { where += ' AND r.officer_id = ?'; params.push(officer_id); }
    if (search) {
      where += ' AND (r.report_number LIKE ? OR r.subject_name LIKE ? OR r.narrative LIKE ? OR u.full_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const reports = db.prepare(`
      SELECT r.*, u.full_name as officer_name, u.badge_number,
             rv.full_name as reviewer_name
      FROM use_of_force_reports r
      LEFT JOIN users u ON r.officer_id = u.id
      LEFT JOIN users rv ON r.reviewed_by = rv.id
      ${where}
      ORDER BY r.incident_date DESC, r.created_at DESC
    `).all(...params);

    res.json(reports.map((r: any) => ({
      ...r,
      force_types: typeof r.force_types === 'string' ? JSON.parse(r.force_types) : r.force_types,
      witnesses: typeof r.witnesses === 'string' ? JSON.parse(r.witnesses) : r.witnesses,
    })));
  } catch (error: any) {
    console.error('Get UOF reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET SINGLE ──────────────────────────────────────

// GET /api/use-of-force/:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const report = db.prepare(`
      SELECT r.*, u.full_name as officer_name, u.badge_number,
             rv.full_name as reviewer_name
      FROM use_of_force_reports r
      LEFT JOIN users u ON r.officer_id = u.id
      LEFT JOIN users rv ON r.reviewed_by = rv.id
      WHERE r.id = ?
    `).get(req.params.id) as any;

    if (!report) { res.status(404).json({ error: 'Report not found' }); return; }

    report.force_types = typeof report.force_types === 'string' ? JSON.parse(report.force_types) : report.force_types;
    report.witnesses = typeof report.witnesses === 'string' ? JSON.parse(report.witnesses) : report.witnesses;
    res.json(report);
  } catch (error: any) {
    console.error('Get UOF report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── CREATE ──────────────────────────────────────────

// POST /api/use-of-force
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    // Generate report number: UOF-YYYY-NNNN
    const year = new Date().getFullYear();
    const last = db.prepare(`
      SELECT report_number FROM use_of_force_reports
      WHERE report_number LIKE 'UOF-${year}-%'
      ORDER BY id DESC LIMIT 1
    `).get() as any;
    const seq = last ? parseInt(last.report_number.split('-')[2]) + 1 : 1;
    const report_number = `UOF-${year}-${String(seq).padStart(4, '0')}`;

    const {
      incident_id, call_id, officer_id, subject_name, subject_dob, subject_gender,
      subject_race, subject_height, subject_weight, subject_armed, subject_weapon_description,
      subject_behavior, subject_impairment, location_address, latitude, longitude,
      incident_date, incident_time, force_types, force_level,
      de_escalation_attempted, de_escalation_description, verbal_commands_given,
      narrative, subject_injuries, subject_medical_treatment, subject_hospitalized,
      officer_injuries, officer_medical_treatment, bystander_injuries,
      body_camera_active, body_camera_footage_id, witnesses, status,
    } = req.body;

    const result = db.prepare(`
      INSERT INTO use_of_force_reports (
        report_number, incident_id, call_id, officer_id, subject_name, subject_dob,
        subject_gender, subject_race, subject_height, subject_weight,
        subject_armed, subject_weapon_description, subject_behavior, subject_impairment,
        location_address, latitude, longitude, incident_date, incident_time,
        force_types, force_level, de_escalation_attempted, de_escalation_description,
        verbal_commands_given, narrative, subject_injuries, subject_medical_treatment,
        subject_hospitalized, officer_injuries, officer_medical_treatment,
        bystander_injuries, body_camera_active, body_camera_footage_id,
        witnesses, status, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      report_number,
      incident_id || null, call_id || null,
      officer_id || req.user!.userId,
      subject_name, subject_dob || null, subject_gender || null,
      subject_race || null, subject_height || null, subject_weight || null,
      subject_armed || 'unknown', subject_weapon_description || null,
      subject_behavior || 'unknown', subject_impairment || 'unknown',
      location_address || null, latitude || null, longitude || null,
      incident_date, incident_time || null,
      JSON.stringify(force_types || []), force_level,
      de_escalation_attempted ? 1 : 0, de_escalation_description || null,
      verbal_commands_given !== false ? 1 : 0,
      narrative,
      subject_injuries || null, subject_medical_treatment ? 1 : 0, subject_hospitalized ? 1 : 0,
      officer_injuries || null, officer_medical_treatment ? 1 : 0,
      bystander_injuries || null,
      body_camera_active !== false ? 1 : 0, body_camera_footage_id || null,
      JSON.stringify(witnesses || []),
      status || 'draft', now, now,
    );

    // Audit log
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'uof_created', 'use_of_force', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid, `UOF ${report_number} created`, req.ip || 'unknown'
    );

    const created = db.prepare('SELECT * FROM use_of_force_reports WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create UOF report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── UPDATE ──────────────────────────────────────────

// PUT /api/use-of-force/:id
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM use_of_force_reports WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Report not found' }); return; }

    const fields: string[] = [];
    const values: any[] = [];
    const addField = (col: string, val: any) => {
      if (val !== undefined) { fields.push(`${col} = ?`); values.push(val); }
    };

    // Allow updating all fields
    const b = req.body;
    addField('subject_name', b.subject_name);
    addField('subject_dob', b.subject_dob);
    addField('subject_gender', b.subject_gender);
    addField('subject_race', b.subject_race);
    addField('subject_height', b.subject_height);
    addField('subject_weight', b.subject_weight);
    addField('subject_armed', b.subject_armed);
    addField('subject_weapon_description', b.subject_weapon_description);
    addField('subject_behavior', b.subject_behavior);
    addField('subject_impairment', b.subject_impairment);
    addField('location_address', b.location_address);
    addField('latitude', b.latitude);
    addField('longitude', b.longitude);
    addField('incident_date', b.incident_date);
    addField('incident_time', b.incident_time);
    if (b.force_types !== undefined) addField('force_types', JSON.stringify(b.force_types));
    addField('force_level', b.force_level);
    addField('de_escalation_attempted', b.de_escalation_attempted !== undefined ? (b.de_escalation_attempted ? 1 : 0) : undefined);
    addField('de_escalation_description', b.de_escalation_description);
    addField('verbal_commands_given', b.verbal_commands_given !== undefined ? (b.verbal_commands_given ? 1 : 0) : undefined);
    addField('narrative', b.narrative);
    addField('subject_injuries', b.subject_injuries);
    addField('subject_medical_treatment', b.subject_medical_treatment !== undefined ? (b.subject_medical_treatment ? 1 : 0) : undefined);
    addField('subject_hospitalized', b.subject_hospitalized !== undefined ? (b.subject_hospitalized ? 1 : 0) : undefined);
    addField('officer_injuries', b.officer_injuries);
    addField('officer_medical_treatment', b.officer_medical_treatment !== undefined ? (b.officer_medical_treatment ? 1 : 0) : undefined);
    addField('bystander_injuries', b.bystander_injuries);
    addField('body_camera_active', b.body_camera_active !== undefined ? (b.body_camera_active ? 1 : 0) : undefined);
    addField('body_camera_footage_id', b.body_camera_footage_id);
    if (b.witnesses !== undefined) addField('witnesses', JSON.stringify(b.witnesses));
    addField('status', b.status);
    addField('review_notes', b.review_notes);

    if (fields.length === 0) { res.json(existing); return; }

    fields.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE use_of_force_reports SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM use_of_force_reports WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update UOF report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── REVIEW ACTIONS ──────────────────────────────────

// PUT /api/use-of-force/:id/review
router.put('/:id/review', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, review_notes } = req.body;

    if (!['approved', 'returned', 'ia_referral'].includes(status)) {
      res.status(400).json({ error: 'Invalid review status' });
      return;
    }

    const now = localNow();
    db.prepare(`
      UPDATE use_of_force_reports
      SET status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(status, req.user!.userId, now, review_notes || null, now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'uof_reviewed', 'use_of_force', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `UOF #${req.params.id} → ${status}`, req.ip || 'unknown'
    );

    // If referred to IA, auto-create a complaint
    if (status === 'ia_referral') {
      const report = db.prepare('SELECT * FROM use_of_force_reports WHERE id = ?').get(req.params.id) as any;
      if (report) {
        const iaYear = new Date().getFullYear();
        const lastIA = db.prepare(`SELECT case_number FROM ia_complaints WHERE case_number LIKE 'IA-${iaYear}-%' ORDER BY id DESC LIMIT 1`).get() as any;
        const iaSeq = lastIA ? parseInt(lastIA.case_number.split('-')[2]) + 1 : 1;
        const iaCaseNumber = `IA-${iaYear}-${String(iaSeq).padStart(4, '0')}`;

        db.prepare(`
          INSERT INTO ia_complaints (case_number, complaint_type, category, severity, accused_officer_id, accused_officer_name,
            incident_date, incident_location, incident_description, allegation_summary, related_uof_id, created_by, created_at, updated_at)
          VALUES (?, 'internal', 'excessive_force', 'serious', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          iaCaseNumber, report.officer_id, report.officer_name || 'Unknown',
          report.incident_date, report.location_address,
          `UOF Report ${report.report_number} referred to Internal Affairs for review.`,
          `Use of Force report referred: ${report.force_level} force used`,
          report.id, req.user!.userId, now, now,
        );
      }
    }

    const updated = db.prepare('SELECT * FROM use_of_force_reports WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('UOF review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
