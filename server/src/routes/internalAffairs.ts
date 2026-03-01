import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── STATS / DASHBOARD ──────────────────────────────

// GET /api/internal-affairs/stats
router.get('/stats', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days as string) || 365;

    const total = (db.prepare(`
      SELECT COUNT(*) as count FROM ia_complaints
      WHERE created_at >= date('now', '-${days} days')
    `).get() as any).count;

    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM ia_complaints
      WHERE created_at >= date('now', '-${days} days')
      GROUP BY status ORDER BY count DESC
    `).all();

    const byCategory = db.prepare(`
      SELECT category, COUNT(*) as count FROM ia_complaints
      WHERE created_at >= date('now', '-${days} days')
      GROUP BY category ORDER BY count DESC
    `).all();

    const bySeverity = db.prepare(`
      SELECT severity, COUNT(*) as count FROM ia_complaints
      WHERE created_at >= date('now', '-${days} days')
      GROUP BY severity ORDER BY count DESC
    `).all();

    const byFinding = db.prepare(`
      SELECT finding, COUNT(*) as count FROM ia_complaints
      WHERE finding IS NOT NULL AND created_at >= date('now', '-${days} days')
      GROUP BY finding ORDER BY count DESC
    `).all();

    const byOfficer = db.prepare(`
      SELECT u.full_name, u.badge_number, COUNT(*) as count
      FROM ia_complaints c
      JOIN users u ON c.accused_officer_id = u.id
      WHERE c.created_at >= date('now', '-${days} days')
      GROUP BY c.accused_officer_id ORDER BY count DESC LIMIT 10
    `).all();

    const openCases = (db.prepare(`
      SELECT COUNT(*) as count FROM ia_complaints
      WHERE status NOT IN ('closed','withdrawn','sustained','not_sustained','exonerated','unfounded')
    `).get() as any).count;

    const avgResolutionDays = (db.prepare(`
      SELECT ROUND(AVG(julianday(closed_at) - julianday(created_at)), 1) as avg_days
      FROM ia_complaints WHERE closed_at IS NOT NULL
    `).get() as any)?.avg_days || 0;

    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
      FROM ia_complaints
      WHERE created_at >= date('now', '-${days} days')
      GROUP BY month ORDER BY month ASC
    `).all();

    const sustainedRate = (() => {
      const row = db.prepare(`
        SELECT
          SUM(CASE WHEN finding = 'sustained' THEN 1 ELSE 0 END) as sustained,
          COUNT(*) as total
        FROM ia_complaints WHERE finding IS NOT NULL
      `).get() as any;
      return row?.total > 0 ? Math.round(100 * row.sustained / row.total) : 0;
    })();

    res.json({
      total, byStatus, byCategory, bySeverity, byFinding, byOfficer,
      openCases, avgResolutionDays, monthly, sustainedRate,
    });
  } catch (error: any) {
    console.error('IA stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── LIST ────────────────────────────────────────────

// GET /api/internal-affairs
router.get('/', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, category, severity, officer_id, search } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (status) { where += ' AND c.status = ?'; params.push(status); }
    if (category) { where += ' AND c.category = ?'; params.push(category); }
    if (severity) { where += ' AND c.severity = ?'; params.push(severity); }
    if (officer_id) { where += ' AND c.accused_officer_id = ?'; params.push(officer_id); }
    if (search) {
      where += ' AND (c.case_number LIKE ? OR c.complainant_name LIKE ? OR c.incident_description LIKE ? OR c.accused_officer_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const complaints = db.prepare(`
      SELECT c.*, u.full_name as officer_name, u.badge_number,
             inv.full_name as investigator_name,
             cr.full_name as created_by_name
      FROM ia_complaints c
      LEFT JOIN users u ON c.accused_officer_id = u.id
      LEFT JOIN users inv ON c.assigned_investigator_id = inv.id
      LEFT JOIN users cr ON c.created_by = cr.id
      ${where}
      ORDER BY c.created_at DESC
    `).all(...params);

    res.json(complaints.map((c: any) => ({
      ...c,
      evidence_collected: typeof c.evidence_collected === 'string' ? JSON.parse(c.evidence_collected) : c.evidence_collected,
      witnesses: typeof c.witnesses === 'string' ? JSON.parse(c.witnesses) : c.witnesses,
    })));
  } catch (error: any) {
    console.error('Get IA complaints error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET SINGLE ──────────────────────────────────────

// GET /api/internal-affairs/:id
router.get('/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const complaint = db.prepare(`
      SELECT c.*, u.full_name as officer_name, u.badge_number,
             inv.full_name as investigator_name
      FROM ia_complaints c
      LEFT JOIN users u ON c.accused_officer_id = u.id
      LEFT JOIN users inv ON c.assigned_investigator_id = inv.id
      WHERE c.id = ?
    `).get(req.params.id) as any;

    if (!complaint) { res.status(404).json({ error: 'Complaint not found' }); return; }
    complaint.evidence_collected = typeof complaint.evidence_collected === 'string' ? JSON.parse(complaint.evidence_collected) : complaint.evidence_collected;
    complaint.witnesses = typeof complaint.witnesses === 'string' ? JSON.parse(complaint.witnesses) : complaint.witnesses;
    res.json(complaint);
  } catch (error: any) {
    console.error('Get IA complaint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── CREATE ──────────────────────────────────────────

// POST /api/internal-affairs
router.post('/', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    // Generate case number: IA-YYYY-NNNN
    const year = new Date().getFullYear();
    const last = db.prepare(`
      SELECT case_number FROM ia_complaints
      WHERE case_number LIKE 'IA-${year}-%'
      ORDER BY id DESC LIMIT 1
    `).get() as any;
    const seq = last ? parseInt(last.case_number.split('-')[2]) + 1 : 1;
    const case_number = `IA-${year}-${String(seq).padStart(4, '0')}`;

    const b = req.body;

    const result = db.prepare(`
      INSERT INTO ia_complaints (
        case_number, complaint_type, category, severity,
        complainant_name, complainant_phone, complainant_email, complainant_address, complainant_anonymous,
        accused_officer_id, accused_officer_name,
        incident_date, incident_location, incident_description, allegation_summary,
        status, assigned_investigator_id, assigned_at,
        related_uof_id, related_incident_id,
        created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      case_number,
      b.complaint_type || 'citizen', b.category, b.severity || 'minor',
      b.complainant_name || null, b.complainant_phone || null,
      b.complainant_email || null, b.complainant_address || null,
      b.complainant_anonymous ? 1 : 0,
      b.accused_officer_id || null, b.accused_officer_name || null,
      b.incident_date || null, b.incident_location || null,
      b.incident_description, b.allegation_summary || null,
      b.assigned_investigator_id ? 'assigned' : 'received',
      b.assigned_investigator_id || null,
      b.assigned_investigator_id ? now : null,
      b.related_uof_id || null, b.related_incident_id || null,
      req.user!.userId, now, now,
    );

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'ia_created', 'ia_complaint', ?, ?, ?)`).run(
      req.user!.userId, result.lastInsertRowid, `IA ${case_number} created`, req.ip || 'unknown'
    );

    const created = db.prepare('SELECT * FROM ia_complaints WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create IA complaint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── UPDATE ──────────────────────────────────────────

// PUT /api/internal-affairs/:id
router.put('/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM ia_complaints WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Complaint not found' }); return; }

    const fields: string[] = [];
    const values: any[] = [];
    const addField = (col: string, val: any) => {
      if (val !== undefined) { fields.push(`${col} = ?`); values.push(val); }
    };

    const b = req.body;
    addField('complaint_type', b.complaint_type);
    addField('category', b.category);
    addField('severity', b.severity);
    addField('complainant_name', b.complainant_name);
    addField('complainant_phone', b.complainant_phone);
    addField('complainant_email', b.complainant_email);
    addField('complainant_address', b.complainant_address);
    addField('complainant_anonymous', b.complainant_anonymous !== undefined ? (b.complainant_anonymous ? 1 : 0) : undefined);
    addField('accused_officer_id', b.accused_officer_id);
    addField('accused_officer_name', b.accused_officer_name);
    addField('incident_date', b.incident_date);
    addField('incident_location', b.incident_location);
    addField('incident_description', b.incident_description);
    addField('allegation_summary', b.allegation_summary);
    addField('status', b.status);
    addField('investigation_notes', b.investigation_notes);
    if (b.evidence_collected !== undefined) addField('evidence_collected', JSON.stringify(b.evidence_collected));
    if (b.witnesses !== undefined) addField('witnesses', JSON.stringify(b.witnesses));
    addField('finding', b.finding);
    addField('finding_date', b.finding_date);
    addField('finding_notes', b.finding_notes);
    addField('discipline_type', b.discipline_type);
    addField('discipline_notes', b.discipline_notes);

    // Auto-assign investigator
    if (b.assigned_investigator_id !== undefined && !existing.assigned_investigator_id) {
      addField('assigned_investigator_id', b.assigned_investigator_id);
      addField('assigned_at', localNow());
      if (!b.status) { addField('status', 'assigned'); }
    } else if (b.assigned_investigator_id !== undefined) {
      addField('assigned_investigator_id', b.assigned_investigator_id);
    }

    // Auto-close
    if (b.status && ['sustained', 'not_sustained', 'exonerated', 'unfounded', 'closed', 'withdrawn'].includes(b.status)) {
      addField('closed_at', localNow());
    }

    if (fields.length === 0) { res.json(existing); return; }

    fields.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE ia_complaints SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'ia_updated', 'ia_complaint', ?, ?, ?)`).run(
      req.user!.userId, req.params.id, `IA #${req.params.id} updated`, req.ip || 'unknown'
    );

    const updated = db.prepare('SELECT * FROM ia_complaints WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update IA complaint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── OFFICER COMPLAINT HISTORY ───────────────────────

// GET /api/internal-affairs/officer/:officerId
router.get('/officer/:officerId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const complaints = db.prepare(`
      SELECT c.*, inv.full_name as investigator_name
      FROM ia_complaints c
      LEFT JOIN users inv ON c.assigned_investigator_id = inv.id
      WHERE c.accused_officer_id = ?
      ORDER BY c.created_at DESC
    `).all(req.params.officerId);

    const summary = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN finding = 'sustained' THEN 1 ELSE 0 END) as sustained,
        SUM(CASE WHEN finding = 'not_sustained' THEN 1 ELSE 0 END) as not_sustained,
        SUM(CASE WHEN finding = 'exonerated' THEN 1 ELSE 0 END) as exonerated,
        SUM(CASE WHEN finding = 'unfounded' THEN 1 ELSE 0 END) as unfounded,
        SUM(CASE WHEN status NOT IN ('closed','withdrawn','sustained','not_sustained','exonerated','unfounded') THEN 1 ELSE 0 END) as open
      FROM ia_complaints WHERE accused_officer_id = ?
    `).get(req.params.officerId);

    res.json({ complaints, summary });
  } catch (error: any) {
    console.error('Get officer IA history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
