// ============================================================
// RMPG Flex — Citations / Summons API Routes
// ============================================================
// Full CRUD for traffic citations, criminal summons, parking
// tickets, and written warnings. Auto-generates citation numbers
// in CIT-YYYY-NNNN format.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastCitationUpdate, broadcastDispatchUpdate } from '../utils/websocket';
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

    res.set('Cache-Control', 'private, max-age=60');
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
    res.status(500).json({ error: 'Failed to retrieve citation statistics', code: 'STATS_ERROR' });
  }
});

// ─── GET /api/citations/search ────────────────────────────
router.get('/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters', code: 'SEARCH_QUERY_MUST_BE' });
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
    res.status(500).json({ error: 'Failed to search citations', code: 'SEARCH_ERROR' });
  }
});

// ─── GET /api/citations/person/:personId ──────────────────
router.get('/person/:personId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const personId = parseInt(req.params.personId, 10);
    if (isNaN(personId)) {
      res.status(400).json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' });
      return;
    }

    const citations = db.prepare(`
      SELECT * FROM citations
      WHERE person_id = ?
      ORDER BY violation_date DESC, violation_time DESC
      LIMIT 500
    `).all(personId);

    res.json({ data: citations });
  } catch (error: any) {
    console.error('Get person citations error:', error);
    res.status(500).json({ error: 'Failed to retrieve person citations', code: 'PERSON_CITATIONS_ERROR' });
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
    const limitNum = Math.min(Math.max(1, parseInt(limit as string, 10) || 50), 200);
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
    res.status(500).json({ error: 'Failed to retrieve citations', code: 'LIST_CITATIONS_ERROR' });
  }
});

// ─── GET /api/citations/:id ──────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' });
      return;
    }

    const citation = db.prepare(`SELECT * FROM citations WHERE id = ?`).get(id) as any;

    if (!citation) {
      res.status(404).json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' });
      return;
    }

    res.json({ data: citation });
  } catch (error: any) {
    console.error('Get citation error:', error);
    res.status(500).json({ error: 'Failed to retrieve citation', code: 'GET_CITATION_ERROR' });
  }
});

// ─── POST /api/citations ─────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const validTypes = ['traffic', 'criminal', 'parking', 'warning'];
    const validStatuses = ['issued', 'paid', 'contested', 'dismissed', 'warrant_issued', 'payment_plan'];

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
      // Spillman Flex extended fields
      section_id, zone_id, beat_id, zone_beat, latitude, longitude,
      vehicle_vin, vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_id,
      speed_recorded, speed_limit, radar_type, bac_level,
      bond_amount, bond_type,
      is_warning, is_equipment_violation, weather_conditions, road_conditions,
      school_zone, construction_zone, accident_related, dui_related, commercial_vehicle, hazmat,
      court_time, court_room, appearance_required,
      case_id,
    } = req.body;

    if (!violation_description?.trim()) {
      res.status(400).json({ error: 'Violation description is required', code: 'MISSING_DESCRIPTION' });
      return;
    }

    // Validate type enum
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}`, code: 'INVALID_TYPE' });
      return;
    }

    if (!violation_date) {
      res.status(400).json({ error: 'violation_date is required', code: 'MISSING_DATE' });
      return;
    }

    // Validate violation_date format
    if (typeof violation_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(violation_date)) {
      res.status(400).json({ error: 'violation_date must be in YYYY-MM-DD format', code: 'VIOLATIONDATE_MUST_BE_IN' });
      return;
    }

    // Validate fine_amount if provided
    if (fine_amount !== undefined && fine_amount !== null) {
      const fineNum = parseFloat(fine_amount);
      if (isNaN(fineNum) || fineNum < 0) {
        res.status(400).json({ error: 'fine_amount must be a non-negative number', code: 'FINEAMOUNT_MUST_BE_A' });
        return;
      }
    }

    // Auto-generate citation number: CIT-YYYY-NNNN
    const year = new Date().getFullYear();
    const lastCit = db.prepare(
      "SELECT citation_number FROM citations WHERE citation_number LIKE ? ORDER BY id DESC LIMIT 1"
    ).get(`CIT-${year}-%`) as any;
    let seq = 1;
    if (lastCit) {
      const parts = lastCit.citation_number.split('-');
      const parsed = parseInt(parts[2], 10);
      seq = isNaN(parsed) ? 1 : parsed + 1;
    }
    const citation_number = `CIT-${year}-${String(seq).padStart(4, '0')}`;

    const now = localNow();
    // Admin can override created_at
    const created_at = (req.user?.role === 'admin' && req.body.created_at) ? req.body.created_at : now;
    if (req.user?.role === 'admin' && req.body.created_at) {
      auditLog(req, 'ADMIN_OVERRIDE', 'citation', 0, `Admin God Mode: overrode created_at to ${req.body.created_at} on new citation`);
    }

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
        notes, created_at, updated_at,
        section_id, zone_id, beat_id, zone_beat, latitude, longitude,
        vehicle_vin, vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_id,
        speed_recorded, speed_limit, radar_type, bac_level,
        bond_amount, bond_type,
        is_warning, is_equipment_violation, weather_conditions, road_conditions,
        school_zone, construction_zone, accident_related, dui_related, commercial_vehicle, hazmat,
        court_time, court_room, appearance_required, case_id
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
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
      notes || null, created_at, now,
      section_id || null, zone_id || null, beat_id || null, zone_beat || null, latitude ?? null, longitude ?? null,
      vehicle_vin || null, vehicle_year || null, vehicle_make || null, vehicle_model || null, vehicle_color || null, vehicle_id || null,
      speed_recorded ?? null, speed_limit ?? null, radar_type || null, bac_level ?? null,
      bond_amount ?? null, bond_type || null,
      is_warning ? 1 : 0, is_equipment_violation ? 1 : 0, weather_conditions || null, road_conditions || null,
      school_zone ? 1 : 0, construction_zone ? 1 : 0, accident_related ? 1 : 0, dui_related ? 1 : 0, commercial_vehicle ? 1 : 0, hazmat ? 1 : 0,
      court_time || null, court_room || null, appearance_required ? 1 : 0, case_id || null
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
    broadcastCitationUpdate({ type: 'citation_created', id: result.lastInsertRowid, citation_number });
    broadcastDispatchUpdate({
      action: 'citation_issued',
      citation: { id: result.lastInsertRowid, citation_number, subject_name: person_name, violation: violation_description, officer_name: issuing_officer_name },
    });
    res.status(201).json({ data: created });
  } catch (error: any) {
    console.error('Create citation error:', error);
    res.status(500).json({ error: 'Failed to create citation', code: 'CREATE_CITATION_ERROR' });
  }
});

// ─── PUT /api/citations/:id ──────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' });
      return;
    }
    const citation = db.prepare('SELECT * FROM citations WHERE id = ?').get(id) as any;
    if (!citation) {
      res.status(404).json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' });
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
      section_id: v => v ?? null,
      zone_id: v => v ?? null,
      beat_id: v => v ?? null,
      zone_beat: v => v ?? null,
      latitude: v => v ?? null,
      longitude: v => v ?? null,
      vehicle_vin: v => v ?? null,
      vehicle_year: v => v ?? null,
      vehicle_make: v => v ?? null,
      vehicle_model: v => v ?? null,
      vehicle_color: v => v ?? null,
      vehicle_id: v => v || null,
      speed_recorded: v => v ?? null,
      speed_limit: v => v ?? null,
      radar_type: v => v ?? null,
      bac_level: v => v ?? null,
      bond_amount: v => v ?? null,
      bond_type: v => v ?? null,
      is_warning: v => v ? 1 : 0,
      is_equipment_violation: v => v ? 1 : 0,
      weather_conditions: v => v ?? null,
      road_conditions: v => v ?? null,
      school_zone: v => v ? 1 : 0,
      construction_zone: v => v ? 1 : 0,
      accident_related: v => v ? 1 : 0,
      dui_related: v => v ? 1 : 0,
      commercial_vehicle: v => v ? 1 : 0,
      hazmat: v => v ? 1 : 0,
      voided_reason: v => v ?? null,
      court_time: v => v ?? null,
      court_room: v => v ?? null,
      appearance_required: v => v ? 1 : 0,
      plea: v => v ?? null,
      verdict: v => v ?? null,
      sentence: v => v ?? null,
      disposition_date: v => v ?? null,
      case_id: v => v || null,
    };

    for (const [key, transform] of Object.entries(fieldMap)) {
      if (bodyKeys.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(transform(req.body[key]));
      }
    }

    // Admin can override timestamps
    const effectiveUpdatedAt = (req.user?.role === 'admin' && req.body.updated_at) ? req.body.updated_at : localNow();

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(effectiveUpdatedAt);
      values.push(req.params.id);
      db.prepare(`UPDATE citations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (req.user?.role === 'admin' && req.body.updated_at) {
        auditLog(req, 'ADMIN_OVERRIDE', 'citation', id, `Admin God Mode: overrode updated_at to ${req.body.updated_at}`);
      }
    }

    // Admin can override citation_number
    if (req.user?.role === 'admin' && req.body.citation_number) {
      db.prepare('UPDATE citations SET citation_number = ? WHERE id = ?').run(req.body.citation_number, id);
      auditLog(req, 'ADMIN_OVERRIDE', 'citation', id, `Admin God Mode: overrode citation_number to ${req.body.citation_number}`);
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
    broadcastCitationUpdate({ type: 'citation_updated', id: parseInt(req.params.id) });
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Update citation error:', error);
    res.status(500).json({ error: 'Failed to update citation', code: 'UPDATE_CITATION_ERROR' });
  }
});

// ─── DELETE /api/citations/:id ────────────────────────────
// Soft-delete: sets status to 'voided'
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' });
      return;
    }
    const citation = db.prepare('SELECT * FROM citations WHERE id = ?').get(id) as any;
    if (!citation) {
      res.status(404).json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' });
      return;
    }

    // Admin God Mode: hard delete option
    if (req.user?.role === 'admin' && req.query.hard === 'true') {
      db.prepare('DELETE FROM citations WHERE id = ?').run(id);
      auditLog(req, 'ADMIN_OVERRIDE', 'citation', id, `Hard-deleted citation #${citation.citation_number}`);
      broadcastCitationUpdate({ type: 'citation_voided', id: citation.id });
      res.json({ success: true, hard_deleted: true });
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

    broadcastCitationUpdate({ type: 'citation_voided', id: citation.id });
    res.json({ message: 'Citation voided', data: { id: citation.id, status: 'voided' } });
  } catch (error: any) {
    console.error('Void citation error:', error);
    res.status(500).json({ error: 'Failed to void citation', code: 'VOID_CITATION_ERROR' });
  }
});

// ─── Payment Plan Tracking ──────────────────────────────

// Ensure citation_payments table exists
try {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS citation_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      citation_id INTEGER NOT NULL REFERENCES citations(id),
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT,
      reference_number TEXT,
      notes TEXT,
      recorded_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);
} catch (e) { console.warn('citation_payments table init:', (e as Error).message); }

// GET /api/citations/:id/payments — Get payment history for a citation
router.get('/:id/payments', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const paymentCitId = parseInt(req.params.id, 10);
    if (isNaN(paymentCitId)) { res.status(400).json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' }); return; }
    const citation = db.prepare('SELECT id, fine_amount, status FROM citations WHERE id = ?').get(paymentCitId) as any;
    if (!citation) { res.status(404).json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }); return; }

    const payments = db.prepare(
      'SELECT * FROM citation_payments WHERE citation_id = ? ORDER BY payment_date DESC'
    ).all(req.params.id) as any[];

    const totalPaid = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    const fineAmount = citation.fine_amount || 0;

    res.json({
      data: {
        payments,
        total_amount: fineAmount,
        total_paid: totalPaid,
        remaining: Math.max(0, fineAmount - totalPaid),
      },
    });
  } catch (error: any) {
    console.error('Get citation payments error:', error);
    res.status(500).json({ error: 'Failed to retrieve citation payments', code: 'GET_PAYMENTS_ERROR' });
  }
});

// POST /api/citations/:id/payments — Record a payment
router.post('/:id/payments', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const payCitId = parseInt(req.params.id, 10);
    if (isNaN(payCitId)) { res.status(400).json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' }); return; }
    const citation = db.prepare('SELECT id, fine_amount, status FROM citations WHERE id = ?').get(payCitId) as any;
    if (!citation) { res.status(404).json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }); return; }

    const { amount, payment_date, payment_method, reference_number, notes } = req.body;
    if (!amount || !payment_date) {
      res.status(400).json({ error: 'Amount and payment_date are required', code: 'AMOUNT_AND_PAYMENTDATE_ARE' });
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number', code: 'AMOUNT_MUST_BE_A' });
      return;
    }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO citation_payments (citation_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, parseFloat(amount), payment_date, payment_method || null, reference_number || null, notes || null, req.user!.userId, now);

    // Check if fully paid
    const payments = db.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM citation_payments WHERE citation_id = ?'
    ).get(req.params.id) as any;
    const totalPaid = payments.total;
    if (totalPaid >= (citation.fine_amount || 0)) {
      db.prepare("UPDATE citations SET status = 'paid', updated_at = ? WHERE id = ?").run(now, req.params.id);
    } else if (citation.status !== 'payment_plan') {
      db.prepare("UPDATE citations SET status = 'payment_plan', updated_at = ? WHERE id = ?").run(now, req.params.id);
    }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'payment_recorded', 'citation', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Payment of $${parseFloat(amount).toFixed(2)} recorded`, req.ip || 'unknown');

    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (error: any) {
    console.error('Record citation payment error:', error);
    res.status(500).json({ error: 'Failed to record payment', code: 'RECORD_PAYMENT_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 9: Violation Code Lookup / Autocomplete
// ════════════════════════════════════════════════════════════
router.get('/statutes/lookup', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, offense_level } = req.query;
    if (!q || (q as string).length < 2) { res.status(400).json({ error: 'Query too short', code: 'QUERY_TOO_SHORT' }); return; }
    const searchTerm = `%${q}%`;
    let whereExtra = '';
    const params: any[] = [searchTerm, searchTerm, searchTerm];
    if (offense_level) { whereExtra = ' AND s.offense_level = ?'; params.push(offense_level); }
    try {
      const statutes = db.prepare(`SELECT s.id, s.citation_code, s.title, s.offense_level, s.default_fine, s.description FROM statutes s WHERE (s.citation_code LIKE ? OR s.title LIKE ? OR s.description LIKE ?)${whereExtra} ORDER BY s.citation_code LIMIT 20`).all(...params);
      res.json({ data: statutes });
    } catch {
      // statutes table may not exist — return empty
      res.json({ data: [] });
    }
  } catch (error: any) { console.error('Statute lookup error:', error); res.status(500).json({ error: 'Failed to lookup statutes', code: 'STATUTE_LOOKUP_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 10: Fine Calculation Based on Violation Type
// ════════════════════════════════════════════════════════════
router.get('/calculate-fine', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { statute_id, offense_level, type } = req.query;
    let baseFine = 0;
    if (statute_id) {
      try {
        const statute = db.prepare('SELECT default_fine, offense_level FROM statutes WHERE id = ?').get(statute_id) as any;
        if (statute?.default_fine) baseFine = statute.default_fine;
      } catch { /* statutes table may not exist */ }
    }
    if (!baseFine) {
      // Default fine schedule by offense level
      const fineSchedule: Record<string, number> = { felony: 1000, misdemeanor_a: 500, misdemeanor_b: 350, misdemeanor_c: 250, misdemeanor: 350, infraction: 150, violation: 100 };
      baseFine = fineSchedule[offense_level as string] || 100;
    }
    // Type multipliers
    const typeMultipliers: Record<string, number> = { traffic: 1.0, criminal: 1.5, parking: 0.5, warning: 0 };
    const multiplier = typeMultipliers[type as string] || 1.0;
    const calculatedFine = Math.round(baseFine * multiplier * 100) / 100;
    res.json({ data: { base_fine: baseFine, multiplier, calculated_fine: calculatedFine, type: type || 'traffic' } });
  } catch (error: any) { console.error('Calculate fine error:', error); res.status(500).json({ error: 'Failed to calculate fine', code: 'CALCULATE_FINE_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 11: Payment Tracking Summary
// ════════════════════════════════════════════════════════════
router.get('/payment-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to } = req.query;
    let dateFilter = '';
    const params: any[] = [];
    if (date_from) { dateFilter += ' AND cp.payment_date >= ?'; params.push(date_from); }
    if (date_to) { dateFilter += ' AND cp.payment_date <= ?'; params.push(date_to); }
    const totalPayments = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM citation_payments cp WHERE 1=1${dateFilter}`).get(...params) as any;
    const byMethod = db.prepare(`SELECT payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM citation_payments cp WHERE 1=1${dateFilter} GROUP BY payment_method`).all(...params) as any[];
    const outstandingRow = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(fine_amount), 0) as total FROM citations WHERE status IN ('issued', 'contested', 'payment_plan') AND fine_amount > 0`).get() as any;
    const collectedRow = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM citation_payments`).get() as any;
    res.json({ data: { payment_count: totalPayments.count, payment_total: totalPayments.total, by_method: byMethod, outstanding_citations: outstandingRow.count, outstanding_amount: outstandingRow.total, total_collected: collectedRow.total, collection_rate: outstandingRow.total > 0 ? Math.round((collectedRow.total / (outstandingRow.total + collectedRow.total)) * 100) : 0 } });
  } catch (error: any) { console.error('Payment summary error:', error); res.status(500).json({ error: 'Failed to get payment summary', code: 'PAYMENT_SUMMARY_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 12: Citations by Officer Stats
// ════════════════════════════════════════════════════════════
router.get('/stats/by-officer', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to } = req.query;
    let dateFilter = '';
    const params: any[] = [];
    if (date_from) { dateFilter += ' AND c.violation_date >= ?'; params.push(date_from); }
    if (date_to) { dateFilter += ' AND c.violation_date <= ?'; params.push(date_to); }
    const byOfficer = db.prepare(`SELECT c.issuing_officer_id, c.issuing_officer_name, COUNT(*) as citation_count, COALESCE(SUM(c.fine_amount), 0) as total_fines, SUM(CASE WHEN c.status = 'paid' THEN 1 ELSE 0 END) as paid_count, SUM(CASE WHEN c.status = 'contested' THEN 1 ELSE 0 END) as contested_count, SUM(CASE WHEN c.type = 'traffic' THEN 1 ELSE 0 END) as traffic_count, SUM(CASE WHEN c.type = 'criminal' THEN 1 ELSE 0 END) as criminal_count FROM citations c WHERE c.status != 'voided' AND c.issuing_officer_id IS NOT NULL${dateFilter} GROUP BY c.issuing_officer_id, c.issuing_officer_name ORDER BY citation_count DESC`).all(...params);
    res.json({ data: byOfficer });
  } catch (error: any) { console.error('Citations by officer error:', error); res.status(500).json({ error: 'Failed to get officer stats', code: 'OFFICER_STATS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 13: Citations CSV Export with Date Range
// ════════════════════════════════════════════════════════════
function handleCitationsExport(req: Request, res: Response) {
  try {
    const db = getDb();
    const { date_from, date_to, status, type } = req.query;
    let where = "WHERE c.status != 'voided'";
    const params: any[] = [];
    if (date_from) { where += ' AND c.violation_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND c.violation_date <= ?'; params.push(date_to); }
    if (status) { where += ' AND c.status = ?'; params.push(status); }
    if (type) { where += ' AND c.type = ?'; params.push(type); }
    const rows = db.prepare(`SELECT c.citation_number, c.type, c.status, c.person_name, c.person_dob, c.violation_description, c.statute_citation, c.offense_level, c.fine_amount, c.violation_date, c.violation_time, c.location, c.issuing_officer_name, c.court_date, c.court_name, c.created_at FROM citations c ${where} ORDER BY c.violation_date DESC LIMIT 10000`).all(...params) as any[];
    const headers = ['Citation #', 'Type', 'Status', 'Person', 'DOB', 'Violation', 'Statute', 'Offense Level', 'Fine', 'Date', 'Time', 'Location', 'Officer', 'Court Date', 'Court', 'Created'];
    const csvRows = rows.map((r: any) => [r.citation_number, r.type, r.status, r.person_name, r.person_dob, (r.violation_description || '').replace(/"/g, '""'), r.statute_citation, r.offense_level, r.fine_amount, r.violation_date, r.violation_time, (r.location || '').replace(/"/g, '""'), r.issuing_officer_name, r.court_date, r.court_name, r.created_at]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="citations_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (error: any) { console.error('Export citations error:', error); res.status(500).json({ error: 'Failed to export citations', code: 'EXPORT_CITATIONS_ERROR' }); }
}
router.get('/export', requireRole('admin', 'manager', 'supervisor'), handleCitationsExport);
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), handleCitationsExport);

// ════════════════════════════════════════════════════════════
// UPGRADE 14: Citation Data Completeness
// ════════════════════════════════════════════════════════════
router.get('/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const citation = db.prepare('SELECT * FROM citations WHERE id = ?').get(req.params.id) as any;
    if (!citation) { res.status(404).json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }); return; }
    const requiredFields = ['person_name', 'violation_description', 'violation_date', 'location', 'issuing_officer_name'];
    const recommendedFields = ['person_dob', 'person_dl', 'person_address', 'statute_citation', 'offense_level', 'fine_amount', 'violation_time', 'court_date', 'court_name', 'vehicle_plate'];
    const filledRequired = requiredFields.filter(f => citation[f] != null && String(citation[f]).trim() !== '').length;
    const filledRecommended = recommendedFields.filter(f => citation[f] != null && String(citation[f]).trim() !== '').length;
    const score = Math.round(((filledRequired / requiredFields.length) * 60 + (filledRecommended / recommendedFields.length) * 40));
    const missingRequired = requiredFields.filter(f => !citation[f] || String(citation[f]).trim() === '');
    const missingRecommended = recommendedFields.filter(f => !citation[f] || String(citation[f]).trim() === '');
    res.json({ data: { citation_id: citation.id, score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', missing_required: missingRequired, missing_recommended: missingRecommended, filled_required: filledRequired, total_required: requiredFields.length, filled_recommended: filledRecommended, total_recommended: recommendedFields.length } });
  } catch (error: any) { console.error('Citation completeness error:', error); res.status(500).json({ error: 'Failed to get completeness', code: 'CITATION_COMPLETENESS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// CITATION VIOLATIONS — Multiple violations per citation
// ════════════════════════════════════════════════════════════

router.get('/:id(\\d+)/violations', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const violations = db.prepare(`
      SELECT cv.*, s.statute_number, s.title as statute_title, s.category as statute_category
      FROM citation_violations cv
      LEFT JOIN utah_statutes s ON s.id = cv.statute_id
      WHERE cv.citation_id = ?
      ORDER BY cv.violation_number
    `).all(req.params.id);
    res.json(violations);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.json([]); return; }
    res.status(500).json({ error: 'Failed to load violations' });
  }
});

router.post('/:id(\\d+)/violations', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { statute_id, statute_citation, violation_description, offense_level, fine_amount, speed_recorded, speed_limit, notes } = req.body;
    if (!violation_description) { res.status(400).json({ error: 'violation_description required' }); return; }
    // Auto-increment violation_number
    const maxNum = db.prepare('SELECT MAX(violation_number) as mx FROM citation_violations WHERE citation_id = ?').get(req.params.id) as any;
    const nextNum = (maxNum?.mx || 0) + 1;
    const result = db.prepare(`
      INSERT INTO citation_violations (citation_id, violation_number, statute_id, statute_citation, violation_description, offense_level, fine_amount, speed_recorded, speed_limit, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, nextNum, statute_id || null, statute_citation, violation_description, offense_level || 'infraction', fine_amount || 0, speed_recorded, speed_limit, notes);
    // Update total fine on parent citation
    const totalFine = db.prepare('SELECT COALESCE(SUM(fine_amount), 0) as total FROM citation_violations WHERE citation_id = ?').get(req.params.id) as any;
    db.prepare('UPDATE citations SET fine_amount = ?, updated_at = datetime(\'now\') WHERE id = ?').run(totalFine.total, req.params.id);
    const violation = db.prepare('SELECT * FROM citation_violations WHERE id = ?').get(result.lastInsertRowid);
    res.json(violation);
  } catch (err: any) {
    if (err?.message?.includes('no such table')) { res.status(500).json({ error: 'Violations table not initialized' }); return; }
    res.status(500).json({ error: 'Failed to add violation' });
  }
});

router.put('/:id(\\d+)/violations/:violationId(\\d+)', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fields = ['statute_id', 'statute_citation', 'violation_description', 'offense_level', 'fine_amount', 'speed_recorded', 'speed_limit', 'plea', 'verdict', 'disposition', 'disposition_date', 'notes'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    values.push(req.params.violationId, req.params.id);
    db.prepare(`UPDATE citation_violations SET ${updates.join(', ')} WHERE id = ? AND citation_id = ?`).run(...values);
    // Recalculate total fine
    const totalFine = db.prepare('SELECT COALESCE(SUM(fine_amount), 0) as total FROM citation_violations WHERE citation_id = ?').get(req.params.id) as any;
    db.prepare('UPDATE citations SET fine_amount = ?, updated_at = datetime(\'now\') WHERE id = ?').run(totalFine.total, req.params.id);
    const updated = db.prepare('SELECT * FROM citation_violations WHERE id = ?').get(req.params.violationId);
    res.json(updated);
  } catch { res.status(500).json({ error: 'Failed to update violation' }); }
});

router.delete('/:id(\\d+)/violations/:violationId(\\d+)', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM citation_violations WHERE id = ? AND citation_id = ?').run(req.params.violationId, req.params.id);
    // Recalculate total fine
    const totalFine = db.prepare('SELECT COALESCE(SUM(fine_amount), 0) as total FROM citation_violations WHERE citation_id = ?').get(req.params.id) as any;
    db.prepare('UPDATE citations SET fine_amount = ?, updated_at = datetime(\'now\') WHERE id = ?').run(totalFine.total, req.params.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete violation' }); }
});

// ════════════════════════════════════════════════════════════
// BATCH OPERATIONS — Void/status change multiple citations
// ════════════════════════════════════════════════════════════

router.post('/batch/void', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { citation_ids, reason } = req.body;
    if (!Array.isArray(citation_ids) || citation_ids.length === 0) { res.status(400).json({ error: 'citation_ids array required' }); return; }
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE citations SET status = ?, voided_reason = ?, voided_by = ?, voided_at = ?, updated_at = ? WHERE id = ?');
    let count = 0;
    for (const id of citation_ids.slice(0, 100)) {
      stmt.run('voided', reason || 'Batch voided', userId, now, now, id);
      count++;
    }
    res.json({ success: true, voided: count });
  } catch { res.status(500).json({ error: 'Batch void failed' }); }
});

router.post('/batch/status', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { citation_ids, status } = req.body;
    const validStatuses = ['issued', 'paid', 'payment_plan', 'contested', 'dismissed', 'warrant_issued'];
    if (!Array.isArray(citation_ids) || !validStatuses.includes(status)) {
      res.status(400).json({ error: 'Valid citation_ids array and status required' });
      return;
    }
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE citations SET status = ?, updated_at = ? WHERE id = ?');
    let count = 0;
    for (const id of citation_ids.slice(0, 100)) {
      stmt.run(status, now, id);
      count++;
    }
    res.json({ success: true, updated: count });
  } catch { res.status(500).json({ error: 'Batch status change failed' }); }
});

// ════════════════════════════════════════════════════════════
// CITATION FULL — Aggregated view with violations + payments
// ════════════════════════════════════════════════════════════

router.get('/:id(\\d+)/full', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const citation = db.prepare('SELECT * FROM citations WHERE id = ?').get(req.params.id) as any;
    if (!citation) { res.status(404).json({ error: 'Citation not found' }); return; }

    let violations: any[] = [];
    let payments: any[] = [];
    try {
      violations = db.prepare(`
        SELECT cv.*, s.statute_number, s.title as statute_title
        FROM citation_violations cv LEFT JOIN utah_statutes s ON s.id = cv.statute_id
        WHERE cv.citation_id = ? ORDER BY cv.violation_number
      `).all(req.params.id);
    } catch { /* table may not exist */ }
    try {
      payments = db.prepare('SELECT * FROM citation_payments WHERE citation_id = ? ORDER BY payment_date DESC').all(req.params.id);
    } catch { /* table may not exist */ }

    const totalFines = violations.reduce((sum: number, v: any) => sum + (v.fine_amount || 0), 0) || citation.fine_amount || 0;
    const totalPaid = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

    res.json({
      ...citation,
      violations,
      payments,
      total_fines: totalFines,
      total_paid: totalPaid,
      balance_due: Math.max(0, totalFines - totalPaid),
    });
  } catch { res.status(500).json({ error: 'Failed to load citation details' }); }
});

export default router;
