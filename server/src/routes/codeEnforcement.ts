// ============================================================
// RMPG Flex — Code Enforcement API Routes
// ============================================================
// Manages code violations (municipal/property code) and vehicle
// tow operations. Auto-generates numbers in CV-YYYY-NNNN and
// TOW-YYYY-NNNN formats.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

function nextNumber(table: string, prefix: string, col: string): string {
  const db = getDb();
  const yr = new Date().getFullYear();
  const pfx = `${prefix}-${yr}-`;
  const last = db.prepare(
    `SELECT ${col} FROM ${table} WHERE ${col} LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(`${pfx}%`) as any;
  const seq = last ? parseInt(last[col].replace(pfx, ''), 10) + 1 : 1;
  return `${pfx}${String(seq).padStart(4, '0')}`;
}

// ─── GET /stats ──────────────────────────────────────────
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const violationCounts = db.prepare(`SELECT status, COUNT(*) as count FROM code_violations GROUP BY status`).all() as any[];
    const towCounts = db.prepare(`SELECT status, COUNT(*) as count FROM vehicle_tows GROUP BY status`).all() as any[];
    const today = localToday();
    const parkingToday = db.prepare(`SELECT COUNT(*) as count FROM citations WHERE type = 'parking' AND violation_date = ?`).get(today) as any;

    res.json({
      data: {
        violations: Object.fromEntries(violationCounts.map(r => [r.status, r.count])),
        tows: Object.fromEntries(towCounts.map(r => [r.status, r.count])),
        violations_total: violationCounts.reduce((a: number, b: any) => a + b.count, 0),
        tows_total: towCounts.reduce((a: number, b: any) => a + b.count, 0),
        parking_citations_today: parkingToday?.count || 0,
      },
    });
  } catch (error: any) {
    console.error('Get code enforcement stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════
// CODE VIOLATIONS
// ════════════════════════════════════════════════════════

router.get('/violations', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, violation_type, severity, search, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (violation_type) { where += ' AND violation_type = ?'; params.push(violation_type); }
    if (severity) { where += ' AND severity = ?'; params.push(severity); }
    if (search) {
      where += ' AND (violation_number LIKE ? OR location LIKE ? OR description LIKE ? OR violator_name LIKE ?)';
      const s = `%${search}%`; params.push(s, s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM code_violations ${where}`).get(...params) as any).count;
    const rows = db.prepare(`SELECT * FROM code_violations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);
    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get code violations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/violations/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM code_violations WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Violation not found' });
    res.json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/violations', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { violation_type, location, description, code_section, severity, property_id,
      person_id, violator_name, violator_contact, compliance_deadline, fine_amount } = req.body;
    if (!location || !description || !violation_type) return res.status(400).json({ error: 'Location, description, and type required' });

    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
    const violation_number = nextNumber('code_violations', 'CV', 'violation_number');

    const result = db.prepare(`
      INSERT INTO code_violations (violation_number, violation_type, status, location, property_id,
        person_id, violator_name, violator_contact, description, code_section, severity,
        compliance_deadline, fine_amount, reporting_officer_id, reporting_officer_name, created_at, updated_at)
      VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(violation_number, violation_type, location, property_id || null,
      person_id || null, violator_name || null, violator_contact || null,
      description, code_section || null, severity || 'minor',
      compliance_deadline || null, fine_amount || 0, req.user!.userId, user?.full_name || '', now, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'create', 'code_violation', ?, ?, ?)`).run(req.user!.userId, result.lastInsertRowid, JSON.stringify({ violation_number }), now);

    res.status(201).json({ data: { id: result.lastInsertRowid, violation_number } });
  } catch (error: any) {
    console.error('Create violation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/violations/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const fields = ['violation_type', 'location', 'description', 'code_section', 'severity',
      'property_id', 'person_id', 'violator_name', 'violator_contact', 'compliance_deadline',
      'fine_amount', 'resolution_notes'];
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    params.push(req.params.id);
    db.prepare(`UPDATE code_violations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ data: { id: parseInt(req.params.id as string) } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/violations/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { status, resolution_notes } = req.body;
    const valid = ['open', 'notice_sent', 'reinspection', 'resolved', 'referred', 'voided'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const updates: any = { status, updated_at: now };
    if (status === 'resolved') updates.resolved_date = localToday();
    if (resolution_notes) updates.resolution_notes = resolution_notes;

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE code_violations SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'status_change', 'code_violation', ?, ?, ?)`).run(req.user!.userId, req.params.id, JSON.stringify({ status }), now);

    res.json({ data: { id: parseInt(req.params.id as string), status } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ════════════════════════════════════════════════════════
// VEHICLE TOWS
// ════════════════════════════════════════════════════════

router.get('/tows', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, search, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (search) {
      where += ' AND (tow_number LIKE ? OR vehicle_plate LIKE ? OR tow_from LIKE ? OR tow_company LIKE ?)';
      const s = `%${search}%`; params.push(s, s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM vehicle_tows ${where}`).get(...params) as any).count;
    const rows = db.prepare(`SELECT * FROM vehicle_tows ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);
    res.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/tows/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM vehicle_tows WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Tow not found' });
    res.json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/tows', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { tow_from, tow_reason, tow_to, vehicle_plate, vehicle_state, vehicle_vin,
      vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_id,
      tow_company, tow_driver, tow_company_phone, authorization,
      call_id, citation_id, incident_id, tow_fee, storage_fee_daily, notes } = req.body;
    if (!tow_from || !tow_reason) return res.status(400).json({ error: 'Location and reason required' });

    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
    const tow_number = nextNumber('vehicle_tows', 'TOW', 'tow_number');

    const result = db.prepare(`
      INSERT INTO vehicle_tows (tow_number, status, vehicle_plate, vehicle_state, vehicle_vin,
        vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_id,
        tow_from, tow_to, tow_reason, authorization, tow_company, tow_driver, tow_company_phone,
        call_id, citation_id, incident_id, tow_fee, storage_fee_daily,
        officer_id, officer_name, notes, ordered_at, created_at, updated_at)
      VALUES (?, 'ordered', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tow_number, vehicle_plate || null, vehicle_state || null, vehicle_vin || null,
      vehicle_year || null, vehicle_make || null, vehicle_model || null, vehicle_color || null, vehicle_id || null,
      tow_from, tow_to || null, tow_reason, authorization || null,
      tow_company || null, tow_driver || null, tow_company_phone || null,
      call_id || null, citation_id || null, incident_id || null,
      tow_fee || 0, storage_fee_daily || 0,
      req.user!.userId, user?.full_name || '', notes || null, now, now, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'create', 'vehicle_tow', ?, ?, ?)`).run(req.user!.userId, result.lastInsertRowid, JSON.stringify({ tow_number }), now);

    res.status(201).json({ data: { id: result.lastInsertRowid, tow_number } });
  } catch (error: any) {
    console.error('Create tow error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/tows/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const fields = ['tow_from', 'tow_to', 'tow_reason', 'authorization', 'tow_company',
      'tow_driver', 'tow_company_phone', 'vehicle_plate', 'vehicle_state', 'vehicle_vin',
      'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_color',
      'tow_fee', 'storage_fee_daily', 'released_to', 'notes'];
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    params.push(req.params.id);
    db.prepare(`UPDATE vehicle_tows SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ data: { id: parseInt(req.params.id as string) } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/tows/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { status } = req.body;
    const valid = ['ordered', 'dispatched', 'in_progress', 'completed', 'released', 'cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const updates: any = { status, updated_at: now };
    if (status === 'dispatched') updates.dispatched_at = now;
    if (status === 'completed') updates.completed_at = now;
    if (status === 'released') { updates.released_at = now; if (req.body.released_to) updates.released_to = req.body.released_to; }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE vehicle_tows SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'status_change', 'vehicle_tow', ?, ?, ?)`).run(req.user!.userId, req.params.id, JSON.stringify({ status }), now);

    res.json({ data: { id: parseInt(req.params.id as string), status } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
