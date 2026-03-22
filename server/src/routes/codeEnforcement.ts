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
    res.json({ data: { id: parseInt(req.params.id) } });
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

    res.json({ data: { id: parseInt(req.params.id), status } });
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
    res.json({ data: { id: parseInt(req.params.id) } });
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

    res.json({ data: { id: parseInt(req.params.id), status } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /property-history — Violation count for a property in last 12 months
router.get('/property-history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id, location } = req.query;
    if (!property_id && !location) return res.status(400).json({ error: 'property_id or location required' });

    let where = `WHERE created_at >= datetime('now', '-12 months')`;
    const params: any[] = [];
    if (property_id) { where += ' AND property_id = ?'; params.push(property_id); }
    else if (location) { where += ' AND location LIKE ?'; params.push(`%${location}%`); }

    const count = (db.prepare(`SELECT COUNT(*) as count FROM code_violations ${where}`).get(...params) as any).count;
    const violations = db.prepare(`SELECT id, violation_number, violation_type, status, location, created_at FROM code_violations ${where} ORDER BY created_at DESC`).all(...params);

    res.json({
      data: {
        violation_count_12mo: count,
        is_repeat_offender: count >= 3,
        violations,
      },
    });
  } catch (error: any) {
    console.error('Get property history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 31: Violation Severity Scoring
// ════════════════════════════════════════════════════════════

router.get('/violations/:id/severity-score', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const violation = db.prepare('SELECT * FROM code_violations WHERE id = ?').get(req.params.id) as any;
    if (!violation) return res.status(404).json({ error: 'Violation not found' });

    let score = 0;
    const factors: { factor: string; points: number }[] = [];

    // Base severity
    const sevPoints: Record<string, number> = { critical: 40, high: 30, medium: 20, low: 10, minor: 5 };
    const bp = sevPoints[violation.severity] || 10;
    score += bp;
    factors.push({ factor: `Base severity: ${violation.severity}`, points: bp });

    // Violation type multiplier
    const typePoints: Record<string, number> = { fire: 20, health: 15, nuisance: 10, property_maintenance: 10, noise: 5, zoning: 5, signage: 3, other: 5 };
    const tp = typePoints[violation.violation_type] || 5;
    score += tp;
    factors.push({ factor: `Type: ${violation.violation_type}`, points: tp });

    // Repeat offender check
    if (violation.location) {
      const repeatCount = (db.prepare(`
        SELECT COUNT(*) as cnt FROM code_violations WHERE location = ? AND id != ? AND created_at > datetime('now', '-12 months')
      `).get(violation.location, violation.id) as any)?.cnt || 0;
      if (repeatCount > 0) {
        const rp = Math.min(repeatCount * 5, 20);
        score += rp;
        factors.push({ factor: `Repeat violations at location`, points: rp });
      }
    }

    // Overdue compliance
    if (violation.compliance_deadline) {
      const daysOverdue = Math.floor((Date.now() - new Date(violation.compliance_deadline).getTime()) / (24 * 60 * 60 * 1000));
      if (daysOverdue > 0) {
        const op = Math.min(daysOverdue, 20);
        score += op;
        factors.push({ factor: `${daysOverdue} days past deadline`, points: op });
      }
    }

    score = Math.min(100, score);
    const priority = score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low';

    res.json({ data: { violation_id: violation.id, score, priority, factors } });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 32: Compliance Timeline
// ════════════════════════════════════════════════════════════

router.get('/violations/:id/timeline', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const violation = db.prepare('SELECT * FROM code_violations WHERE id = ?').get(req.params.id) as any;
    if (!violation) return res.status(404).json({ error: 'Violation not found' });

    // Get activity log entries for this violation
    const activities = db.prepare(`
      SELECT * FROM activity_log WHERE entity_type = 'code_violation' AND entity_id = ?
      ORDER BY created_at ASC
    `).all(req.params.id) as any[];

    const timeline = [
      { step: 'violation_reported', label: 'Violation Reported', date: violation.created_at, status: 'complete' },
    ];

    // Check for notice_sent
    const noticeSent = activities.find((a: any) => {
      try { return JSON.parse(a.details)?.status === 'notice_sent'; } catch { return false; }
    });
    timeline.push({
      step: 'notice_sent', label: 'Notice Sent',
      date: noticeSent?.created_at || null,
      status: noticeSent ? 'complete' : (violation.status === 'open' ? 'current' : 'pending'),
    });

    timeline.push({
      step: 'compliance_deadline', label: 'Compliance Deadline',
      date: violation.compliance_deadline || null,
      status: violation.compliance_deadline ? (new Date(violation.compliance_deadline) < new Date() ? 'overdue' : 'pending') : 'pending',
    });

    const reinspection = activities.find((a: any) => {
      try { return JSON.parse(a.details)?.status === 'reinspection'; } catch { return false; }
    });
    timeline.push({
      step: 'reinspection', label: 'Reinspection',
      date: reinspection?.created_at || null,
      status: reinspection ? 'complete' : 'pending',
    });

    timeline.push({
      step: 'resolution', label: 'Resolution',
      date: violation.resolved_date || null,
      status: violation.status === 'resolved' ? 'complete' : 'pending',
    });

    res.json({ data: { violation_id: violation.id, status: violation.status, timeline } });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 33: Geographic Violation Clustering
// ════════════════════════════════════════════════════════════

router.get('/violations/geo/clusters', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '90' } = req.query;
    const cutoff = new Date(Date.now() - parseInt(days as string, 10) * 24 * 60 * 60 * 1000).toISOString();

    // Group by location
    const clusters = db.prepare(`
      SELECT location, COUNT(*) as count,
        GROUP_CONCAT(DISTINCT violation_type) as types,
        MIN(created_at) as first_violation,
        MAX(created_at) as latest_violation,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
      FROM code_violations
      WHERE created_at >= ? AND location IS NOT NULL AND location != ''
      GROUP BY location
      ORDER BY count DESC
      LIMIT 50
    `).all(cutoff) as any[];

    // By violation type
    const byType = db.prepare(`
      SELECT violation_type, COUNT(*) as count
      FROM code_violations WHERE created_at >= ?
      GROUP BY violation_type ORDER BY count DESC
    `).all(cutoff);

    res.json({ data: { clusters, by_type: byType, period_days: parseInt(days as string, 10) } });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 34: Automated Fine Calculation
// ════════════════════════════════════════════════════════════

router.get('/violations/:id/calculate-fine', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const violation = db.prepare('SELECT * FROM code_violations WHERE id = ?').get(req.params.id) as any;
    if (!violation) return res.status(404).json({ error: 'Violation not found' });

    // Base fine by type
    const baseFines: Record<string, number> = {
      noise: 100, property_maintenance: 200, zoning: 300, signage: 150,
      health: 500, fire: 750, nuisance: 150, other: 100,
    };

    // Severity multiplier
    const severityMultipliers: Record<string, number> = {
      critical: 3.0, high: 2.0, medium: 1.5, low: 1.0, minor: 0.5,
    };

    const baseFine = baseFines[violation.violation_type] || 100;
    const severityMult = severityMultipliers[violation.severity] || 1.0;

    // Repeat offender escalation
    const priorViolations = (db.prepare(`
      SELECT COUNT(*) as cnt FROM code_violations
      WHERE location = ? AND id != ? AND created_at > datetime('now', '-24 months')
    `).get(violation.location, violation.id) as any)?.cnt || 0;

    const repeatMult = 1 + (priorViolations * 0.25); // 25% increase per prior violation

    // Late compliance penalty
    let latePenalty = 0;
    if (violation.compliance_deadline && violation.status !== 'resolved') {
      const daysLate = Math.max(0, Math.floor((Date.now() - new Date(violation.compliance_deadline).getTime()) / (24 * 60 * 60 * 1000)));
      latePenalty = daysLate * 25; // $25/day late fee
    }

    const calculatedFine = Math.round(baseFine * severityMult * repeatMult + latePenalty);

    res.json({
      data: {
        violation_id: violation.id,
        base_fine: baseFine,
        severity_multiplier: severityMult,
        repeat_multiplier: repeatMult,
        prior_violations: priorViolations,
        late_penalty: latePenalty,
        calculated_fine: calculatedFine,
        breakdown: `Base $${baseFine} x ${severityMult} (severity) x ${repeatMult.toFixed(2)} (repeat) + $${latePenalty} (late) = $${calculatedFine}`,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 35: Compliance Rate Dashboard
// ════════════════════════════════════════════════════════════

router.get('/compliance-dashboard', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '90' } = req.query;
    const cutoff = new Date(Date.now() - parseInt(days as string, 10) * 24 * 60 * 60 * 1000).toISOString();

    const overall = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'notice_sent' THEN 1 ELSE 0 END) as notice_sent,
        SUM(CASE WHEN status = 'reinspection' THEN 1 ELSE 0 END) as reinspection,
        SUM(CASE WHEN status = 'referred' THEN 1 ELSE 0 END) as referred
      FROM code_violations WHERE created_at >= ?
    `).get(cutoff) as any;

    // Average time to resolve
    const avgResolve = db.prepare(`
      SELECT AVG(JULIANDAY(resolved_date) - JULIANDAY(created_at)) as avg_days
      FROM code_violations WHERE resolved_date IS NOT NULL AND created_at >= ?
    `).get(cutoff) as any;

    // Resolution rate by type
    const byType = db.prepare(`
      SELECT violation_type,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
      FROM code_violations WHERE created_at >= ?
      GROUP BY violation_type ORDER BY total DESC
    `).all(cutoff) as any[];

    // Monthly trends
    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
      FROM code_violations WHERE created_at >= ?
      GROUP BY month ORDER BY month
    `).all(cutoff);

    const resolutionRate = overall.total > 0 ? Math.round((overall.resolved / overall.total) * 100) : 0;

    res.json({
      data: {
        overall: { ...overall, resolution_rate: resolutionRate },
        avg_time_to_resolve_days: Math.round((avgResolve?.avg_days || 0) * 10) / 10,
        by_type: byType.map((t: any) => ({
          ...t,
          resolution_rate: t.total > 0 ? Math.round((t.resolved / t.total) * 100) : 0,
        })),
        monthly_trend: monthlyTrend,
        period_days: parseInt(days as string, 10),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
