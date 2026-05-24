// Code Enforcement routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow, localToday } from '../worker-middleware/timeUtils';

export function mountCodeEnforcementRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  function nextNumber(table: string, prefix: string, col: string, db: D1Db): string {
    const yr = new Date().getFullYear();
    const pfx = `${prefix}-${yr}-`;
    // Simplified: get the max numeric suffix
    // Note: D1Db doesn't support .get with LIKE easily, we'll handle in routes
    return `${pfx}XXXX`; // placeholder, overridden in each route
  }

  // GET /stats
  api.get('/stats', async (c) => {
    const db = new D1Db(c.env.DB);
    const violationCounts = await db.prepare('SELECT status, COUNT(*) as count FROM code_violations GROUP BY status').all() as any[];
    const towCounts = await db.prepare('SELECT status, COUNT(*) as count FROM vehicle_tows GROUP BY status').all() as any[];
    const today = localToday();
    const parkingToday = await db.prepare("SELECT COUNT(*) as count FROM citations WHERE type = 'parking' AND violation_date = ?").get(today) as any;

    c.header('Cache-Control', 'private, max-age=60');
    return c.json({
      data: {
        violations: Object.fromEntries(violationCounts.map(r => [r.status, r.count])),
        tows: Object.fromEntries(towCounts.map(r => [r.status, r.count])),
        violations_total: violationCounts.reduce((a: number, b: any) => a + b.count, 0),
        tows_total: towCounts.reduce((a: number, b: any) => a + b.count, 0),
        parking_citations_today: parkingToday?.count || 0,
      },
    });
  });

  // ===== CODE VIOLATIONS =====

  // GET /violations
  api.get('/violations', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { status, violation_type, severity, search, page = '1', limit = '100000' } = q;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
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

    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM code_violations ${where}`).get(...params) as any;
    const rows = await db.prepare(`SELECT * FROM code_violations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);
    return c.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total: countRow.count, totalPages: Math.ceil(countRow.count / limitNum) } });
  });

  // GET /violations/:id
  api.get('/violations/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid violation ID', code: 'INVALID_VIOLATION_ID' }, 400);
    const row = await db.prepare('SELECT * FROM code_violations WHERE id = ?').get(id);
    if (!row) return c.json({ error: 'Violation not found', code: 'VIOLATION_NOT_FOUND' }, 404);
    return c.json({ data: row });
  });

  // POST /violations
  api.post('/violations', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { violation_type, location, description, code_section, severity, property_id,
      person_id, violator_name, violator_contact, compliance_deadline, fine_amount } = body;
    if (!location || !description || !violation_type) return c.json({ error: 'Location, description, and type required', code: 'MISSING_FIELDS' }, 400);

    const cleanLocation = typeof location === 'string' ? location.trim() : location;
    const cleanDescription = typeof description === 'string' ? description.trim() : description;

    if (fine_amount !== undefined && fine_amount !== null) {
      const fineNum = parseFloat(fine_amount);
      if (isNaN(fineNum) || fineNum < 0) return c.json({ error: 'fine_amount must be a non-negative number', code: 'INVALID_FINE' }, 400);
    }

    const user = c.get('user');
    const userId = user.userId;
    // lookup user full_name
    const userRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(userId) as any;

    // Generate violation number
    const yr = new Date().getFullYear();
    const pfx = `CV-${yr}-`;
    const last = await db.prepare('SELECT violation_number FROM code_violations WHERE violation_number LIKE ? ORDER BY id DESC LIMIT 1').get(`${pfx}%`) as any;
    const parsed = last ? parseInt(last.violation_number.replace(pfx, ''), 10) : 0;
    const seq = isNaN(parsed) ? 1 : parsed + 1;
    const violation_number = `${pfx}${String(seq).padStart(4, '0')}`;

    const result = await db.prepare(`
      INSERT INTO code_violations (violation_number, violation_type, status, location, property_id,
        person_id, violator_name, violator_contact, description, code_section, severity,
        compliance_deadline, fine_amount, reporting_officer_id, reporting_officer_name, created_at, updated_at)
      VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(violation_number, violation_type, cleanLocation, property_id || null,
      person_id || null, violator_name || null, violator_contact || null,
      cleanDescription, code_section || null, severity || 'minor',
      compliance_deadline || null, fine_amount || 0, userId, userRow?.full_name || '', now, now);

    // activity_log skipped in worker (audit)

    return c.json({ data: { id: result.meta.last_row_id, violation_number } }, 201);
  });

  // PUT /violations/:id
  api.put('/violations/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const fields = ['violation_type', 'location', 'description', 'code_section', 'severity',
      'property_id', 'person_id', 'violator_name', 'violator_contact', 'compliance_deadline',
      'fine_amount', 'resolution_notes'];
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(body[f]); }
    }
    const id = paramNum(c.req.param('id'));
    params.push(id);
    await db.prepare(`UPDATE code_violations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return c.json({ data: { id } });
  });

  // PUT /violations/:id/status
  api.put('/violations/:id/status', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { status, resolution_notes } = body;
    const valid = ['open', 'notice_sent', 'reinspection', 'resolved', 'referred', 'voided'];
    if (!valid.includes(status)) return c.json({ error: 'Invalid status', code: 'INVALID_STATUS' }, 400);

    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid violation ID', code: 'INVALID_ID' }, 400);

    const updates: any = { status, updated_at: now };
    if (status === 'resolved') updates.resolved_date = localToday();
    if (resolution_notes) updates.resolution_notes = typeof resolution_notes === 'string' ? resolution_notes.trim() : resolution_notes;

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.prepare(`UPDATE code_violations SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);

    return c.json({ data: { id, status } });
  });

  // ===== VEHICLE TOWS =====

  // GET /tows
  api.get('/tows', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { status, search, page = '1', limit = '100000' } = q;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (search) {
      where += ' AND (tow_number LIKE ? OR vehicle_plate LIKE ? OR tow_from LIKE ? OR tow_company LIKE ?)';
      const s = `%${search}%`; params.push(s, s, s, s);
    }

    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM vehicle_tows ${where}`).get(...params) as any;
    const rows = await db.prepare(`SELECT * FROM vehicle_tows ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);
    return c.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total: countRow.count, totalPages: Math.ceil(countRow.count / limitNum) } });
  });

  // GET /tows/:id
  api.get('/tows/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Invalid tow ID', code: 'INVALID_TOW_ID' }, 400);
    const row = await db.prepare('SELECT * FROM vehicle_tows WHERE id = ?').get(id);
    if (!row) return c.json({ error: 'Tow not found', code: 'TOW_NOT_FOUND' }, 404);
    return c.json({ data: row });
  });

  // POST /tows
  api.post('/tows', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { tow_from, tow_reason, tow_to, vehicle_plate, vehicle_state, vehicle_vin,
      vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_id,
      tow_company, tow_driver, tow_company_phone, authorization,
      call_id, citation_id, incident_id, tow_fee, storage_fee_daily, notes } = body;
    if (!tow_from || !tow_reason) return c.json({ error: 'Location and reason required', code: 'MISSING_FIELDS' }, 400);

    if (tow_fee !== undefined && tow_fee !== null) {
      const feeNum = parseFloat(tow_fee);
      if (isNaN(feeNum) || feeNum < 0) return c.json({ error: 'tow_fee must be a non-negative number', code: 'INVALID_FEE' }, 400);
    }

    const user = c.get('user');
    const userId = user.userId;
    const userRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(userId) as any;

    const yr = new Date().getFullYear();
    const pfx = `TOW-${yr}-`;
    const last = await db.prepare('SELECT tow_number FROM vehicle_tows WHERE tow_number LIKE ? ORDER BY id DESC LIMIT 1').get(`${pfx}%`) as any;
    const parsed = last ? parseInt(last.tow_number.replace(pfx, ''), 10) : 0;
    const seq = isNaN(parsed) ? 1 : parsed + 1;
    const tow_number = `${pfx}${String(seq).padStart(4, '0')}`;

    const result = await db.prepare(`
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
      userId, userRow?.full_name || '', notes || null, now, now, now);

    return c.json({ data: { id: result.meta.last_row_id, tow_number } }, 201);
  });

  // PUT /tows/:id
  api.put('/tows/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const fields = ['tow_from', 'tow_to', 'tow_reason', 'authorization', 'tow_company',
      'tow_driver', 'tow_company_phone', 'vehicle_plate', 'vehicle_state', 'vehicle_vin',
      'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_color',
      'tow_fee', 'storage_fee_daily', 'released_to', 'notes'];
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(body[f]); }
    }
    const id = paramNum(c.req.param('id'));
    params.push(id);
    await db.prepare(`UPDATE vehicle_tows SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return c.json({ data: { id } });
  });

  // PUT /tows/:id/status
  api.put('/tows/:id/status', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { status } = body;
    const valid = ['ordered', 'dispatched', 'in_progress', 'completed', 'released', 'cancelled'];
    if (!valid.includes(status)) return c.json({ error: 'Invalid status', code: 'INVALID_STATUS' }, 400);

    const updates: any = { status, updated_at: now };
    if (status === 'dispatched') updates.dispatched_at = now;
    if (status === 'completed') updates.completed_at = now;
    if (status === 'released') { updates.released_at = now; if (body.released_to) updates.released_to = body.released_to; }

    const id = paramNum(c.req.param('id'));
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.prepare(`UPDATE vehicle_tows SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);

    return c.json({ data: { id, status } });
  });

  // GET /property-history
  api.get('/property-history', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const { property_id, location } = q;
    if (!property_id && !location) return c.json({ error: 'property_id or location required', code: 'PROPERTYID_OR_LOCATION_REQUIRED' }, 400);

    let where = "WHERE created_at >= datetime('now', '-12 months')";
    const params: any[] = [];
    if (property_id) { where += ' AND property_id = ?'; params.push(property_id); }
    else if (location) { where += ' AND location LIKE ?'; params.push(`%${location}%`); }

    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM code_violations ${where}`).get(...params) as any;
    const violations = await db.prepare(`SELECT id, violation_number, violation_type, status, location, created_at FROM code_violations ${where} ORDER BY created_at DESC`).all(...params);

    return c.json({
      data: {
        violation_count_12mo: countRow.count,
        is_repeat_offender: countRow.count >= 3,
        violations,
      },
    });
  });

  // GET /violations/:id/severity-score
  api.get('/violations/:id/severity-score', async (c) => {
    const db = new D1Db(c.env.DB);
    const violation = await db.prepare('SELECT * FROM code_violations WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!violation) return c.json({ error: 'Violation not found', code: 'VIOLATION_NOT_FOUND' }, 404);

    let score = 0;
    const factors: { factor: string; points: number }[] = [];
    const sevPoints: Record<string, number> = { critical: 40, high: 30, medium: 20, low: 10, minor: 5 };
    const bp = sevPoints[violation.severity] || 10;
    score += bp;
    factors.push({ factor: `Base severity: ${violation.severity}`, points: bp });

    const typePoints: Record<string, number> = { fire: 20, health: 15, nuisance: 10, property_maintenance: 10, noise: 5, zoning: 5, signage: 3, other: 5 };
    const tp = typePoints[violation.violation_type] || 5;
    score += tp;
    factors.push({ factor: `Type: ${violation.violation_type}`, points: tp });

    if (violation.location) {
      const repeatCount = (await db.prepare("SELECT COUNT(*) as cnt FROM code_violations WHERE location = ? AND id != ? AND created_at > datetime('now', '-12 months')").get(violation.location, violation.id) as any)?.cnt || 0;
      if (repeatCount > 0) {
        const rp = Math.min(repeatCount * 5, 20);
        score += rp;
        factors.push({ factor: 'Repeat violations at location', points: rp });
      }
    }

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
    return c.json({ data: { violation_id: violation.id, score, priority, factors } });
  });

  // GET /violations/:id/timeline
  api.get('/violations/:id/timeline', async (c) => {
    const db = new D1Db(c.env.DB);
    const violation = await db.prepare('SELECT * FROM code_violations WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!violation) return c.json({ error: 'Violation not found', code: 'VIOLATION_NOT_FOUND' }, 404);

    const activities = await db.prepare("SELECT * FROM activity_log WHERE entity_type = 'code_violation' AND entity_id = ? ORDER BY created_at ASC LIMIT 1000").all(violation.id) as any[];

    const timeline: any[] = [
      { step: 'violation_reported', label: 'Violation Reported', date: violation.created_at, status: 'complete' },
    ];

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

    return c.json({ data: { violation_id: violation.id, status: violation.status, timeline } });
  });

  // GET /violations/geo/clusters
  api.get('/violations/geo/clusters', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const days = parseInt(q.days || '90', 10);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const clusters = await db.prepare(`
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

    const byType = await db.prepare('SELECT violation_type, COUNT(*) as count FROM code_violations WHERE created_at >= ? GROUP BY violation_type ORDER BY count DESC').all(cutoff);
    return c.json({ data: { clusters, by_type: byType, period_days: days } });
  });

  // GET /violations/:id/calculate-fine
  api.get('/violations/:id/calculate-fine', async (c) => {
    const db = new D1Db(c.env.DB);
    const violation = await db.prepare('SELECT * FROM code_violations WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!violation) return c.json({ error: 'Violation not found', code: 'VIOLATION_NOT_FOUND' }, 404);

    const baseFines: Record<string, number> = {
      noise: 100, property_maintenance: 200, zoning: 300, signage: 150,
      health: 500, fire: 750, nuisance: 150, other: 100,
    };
    const severityMultipliers: Record<string, number> = {
      critical: 3.0, high: 2.0, medium: 1.5, low: 1.0, minor: 0.5,
    };

    const baseFine = baseFines[violation.violation_type] || 100;
    const severityMult = severityMultipliers[violation.severity] || 1.0;

    const priorViolations = (await db.prepare("SELECT COUNT(*) as cnt FROM code_violations WHERE location = ? AND id != ? AND created_at > datetime('now', '-24 months')").get(violation.location, violation.id) as any)?.cnt || 0;
    const repeatMult = 1 + (priorViolations * 0.25);

    let latePenalty = 0;
    if (violation.compliance_deadline && violation.status !== 'resolved') {
      const daysLate = Math.max(0, Math.floor((Date.now() - new Date(violation.compliance_deadline).getTime()) / (24 * 60 * 60 * 1000)));
      latePenalty = daysLate * 25;
    }

    const calculatedFine = Math.round(baseFine * severityMult * repeatMult + latePenalty);

    return c.json({
      data: {
        violation_id: violation.id, base_fine: baseFine, severity_multiplier: severityMult,
        repeat_multiplier: repeatMult, prior_violations: priorViolations,
        late_penalty: latePenalty, calculated_fine: calculatedFine,
        breakdown: `Base $${baseFine} x ${severityMult} (severity) x ${repeatMult.toFixed(2)} (repeat) + $${latePenalty} (late) = $${calculatedFine}`,
      },
    });
  });

  // GET /compliance-dashboard
  api.get('/compliance-dashboard', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const days = parseInt(q.days || '90', 10);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const overall = await db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'notice_sent' THEN 1 ELSE 0 END) as notice_sent,
        SUM(CASE WHEN status = 'reinspection' THEN 1 ELSE 0 END) as reinspection,
        SUM(CASE WHEN status = 'referred' THEN 1 ELSE 0 END) as referred
      FROM code_violations WHERE created_at >= ?
    `).get(cutoff) as any;

    const avgResolve = await db.prepare('SELECT AVG(JULIANDAY(resolved_date) - JULIANDAY(created_at)) as avg_days FROM code_violations WHERE resolved_date IS NOT NULL AND created_at >= ?').get(cutoff) as any;

    const byType = await db.prepare("SELECT violation_type, COUNT(*) as total, SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved FROM code_violations WHERE created_at >= ? GROUP BY violation_type ORDER BY total DESC").all(cutoff) as any[];

    const monthlyTrend = await db.prepare("SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as total, SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved FROM code_violations WHERE created_at >= ? GROUP BY month ORDER BY month").all(cutoff);

    const resolutionRate = overall.total > 0 ? Math.round((overall.resolved / overall.total) * 100) : 0;

    c.header('Cache-Control', 'private, max-age=120');
    return c.json({
      data: {
        overall: { ...overall, resolution_rate: resolutionRate },
        avg_time_to_resolve_days: Math.round((avgResolve?.avg_days || 0) * 10) / 10,
        by_type: byType.map((t: any) => ({ ...t, resolution_rate: t.total > 0 ? Math.round((t.resolved / t.total) * 100) : 0 })),
        monthly_trend: monthlyTrend,
        period_days: days,
      },
    });
  });

  // POST /violations/:id/escalate
  api.post('/violations/:id/escalate', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const violation = await db.prepare('SELECT * FROM code_violations WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!violation) return c.json({ error: 'Violation not found', code: 'VIOLATION_NOT_FOUND' }, 404);

    const { escalation_type, notes } = body;
    const validEscalations = ['warning', 'final_notice', 'citation', 'court_referral', 'abatement'];
    if (!escalation_type || !validEscalations.includes(escalation_type))
      return c.json({ error: 'Valid escalation_type required', code: 'INVALID_ESCALATION' }, 400);

    const escalationPath: Record<string, string> = {
      warning: 'notice_sent', final_notice: 'notice_sent', citation: 'referred',
      court_referral: 'referred', abatement: 'reinspection',
    };

    const newStatus = escalationPath[escalation_type] || violation.status;
    const user = c.get('user');
    const userRow = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user.userId) as any;

    let escalationHistory: any[] = [];
    try { escalationHistory = JSON.parse(violation.escalation_history || '[]'); } catch { /* ignore */ }
    escalationHistory.push({
      type: escalation_type, date: now, by_id: user.userId,
      by_name: userRow?.full_name || '', notes: notes || '',
      previous_status: violation.status, new_status: newStatus,
    });

    await db.prepare('UPDATE code_violations SET status = ?, escalation_level = ?, escalation_history = ?, updated_at = ? WHERE id = ?')
      .run(newStatus, escalation_type, JSON.stringify(escalationHistory), now, violation.id);

    return c.json({ data: { id: violation.id, status: newStatus, escalation_level: escalation_type } });
  });

  // GET /repeat-offenders
  api.get('/repeat-offenders', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query();
    const months = parseInt(q.months || '12', 10);
    const minViolations = parseInt(q.min_violations || '3', 10);
    const cutoff = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString();

    const byLocation = await db.prepare(`
      SELECT location, COUNT(*) as violation_count,
        GROUP_CONCAT(DISTINCT violation_type) as types,
        GROUP_CONCAT(DISTINCT violator_name) as violators,
        SUM(COALESCE(fine_amount, 0)) as total_fines,
        MIN(created_at) as first_violation,
        MAX(created_at) as last_violation,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count
      FROM code_violations
      WHERE created_at >= ? AND location IS NOT NULL AND location != ''
      GROUP BY location HAVING COUNT(*) >= ?
      ORDER BY violation_count DESC LIMIT 50
    `).all(cutoff, minViolations);

    const byViolator = await db.prepare(`
      SELECT violator_name, COUNT(*) as violation_count,
        GROUP_CONCAT(DISTINCT violation_type) as types,
        GROUP_CONCAT(DISTINCT location) as locations,
        SUM(COALESCE(fine_amount, 0)) as total_fines,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count
      FROM code_violations
      WHERE created_at >= ? AND violator_name IS NOT NULL AND violator_name != ''
      GROUP BY violator_name HAVING COUNT(*) >= ?
      ORDER BY violation_count DESC LIMIT 50
    `).all(cutoff, minViolations);

    return c.json({ data: { by_location: byLocation, by_violator: byViolator, period_months: months, min_threshold: minViolations } });
  });

  // GET /compliance-deadlines
  api.get('/compliance-deadlines', async (c) => {
    const db = new D1Db(c.env.DB);
    const today = localToday();

    const upcoming = await db.prepare(`
      SELECT id, violation_number, violation_type, location, violator_name,
        compliance_deadline, severity, status,
        CAST(JULIANDAY(compliance_deadline) - JULIANDAY('now') AS INTEGER) as days_remaining
      FROM code_violations
      WHERE compliance_deadline IS NOT NULL AND compliance_deadline >= ?
        AND compliance_deadline <= DATE(?, '+30 days')
        AND status NOT IN ('resolved', 'voided')
      ORDER BY compliance_deadline ASC LIMIT 100
    `).all(today, today);

    const overdue = await db.prepare(`
      SELECT id, violation_number, violation_type, location, violator_name,
        compliance_deadline, severity, status, fine_amount,
        CAST(JULIANDAY('now') - JULIANDAY(compliance_deadline) AS INTEGER) as days_overdue
      FROM code_violations
      WHERE compliance_deadline IS NOT NULL AND compliance_deadline < ?
        AND status NOT IN ('resolved', 'voided')
      ORDER BY days_overdue DESC LIMIT 100
    `).all(today);

    const stats = await db.prepare(`
      SELECT
        SUM(CASE WHEN compliance_deadline < ? AND status NOT IN ('resolved', 'voided') THEN 1 ELSE 0 END) as overdue_count,
        SUM(CASE WHEN compliance_deadline >= ? AND compliance_deadline <= DATE(?, '+7 days') AND status NOT IN ('resolved', 'voided') THEN 1 ELSE 0 END) as due_this_week,
        SUM(CASE WHEN compliance_deadline >= ? AND compliance_deadline <= DATE(?, '+30 days') AND status NOT IN ('resolved', 'voided') THEN 1 ELSE 0 END) as due_this_month
      FROM code_violations WHERE compliance_deadline IS NOT NULL
    `).get(today, today, today, today, today) as any;

    return c.json({ data: { upcoming, overdue, stats: stats || { overdue_count: 0, due_this_week: 0, due_this_month: 0 } } });
  });

  // POST /violations/:id/schedule-inspection
  api.post('/violations/:id/schedule-inspection', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { inspection_date, inspection_type, assigned_officer_id, notes } = body;
    if (!inspection_date) return c.json({ error: 'inspection_date required', code: 'INSPECTION_DATE_REQUIRED' }, 400);

    const violation = await db.prepare('SELECT * FROM code_violations WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!violation) return c.json({ error: 'Violation not found', code: 'VIOLATION_NOT_FOUND' }, 404);

    const user = c.get('user');
    const inspectionData = {
      violation_id: violation.id,
      inspection_type: inspection_type || 'reinspection',
      scheduled_date: inspection_date,
      assigned_officer_id: assigned_officer_id || user.userId,
      status: 'scheduled',
      notes: notes || '',
    };

    // activity_log skipped
    await db.prepare("UPDATE code_violations SET status = 'reinspection', updated_at = ? WHERE id = ?").run(now, violation.id);

    return c.json({ data: inspectionData });
  });

  // POST /violations/:id/payment
  api.post('/violations/:id/payment', async (c) => {
    const db = new D1Db(c.env.DB);
    const now = localNow();
    const body = await c.req.json();
    const { amount, payment_method, receipt_number, notes } = body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      return c.json({ error: 'Valid payment amount required', code: 'INVALID_PAYMENT_AMOUNT' }, 400);

    const violation = await db.prepare('SELECT * FROM code_violations WHERE id = ?').get(paramNum(c.req.param('id'))) as any;
    if (!violation) return c.json({ error: 'Violation not found', code: 'VIOLATION_NOT_FOUND' }, 404);

    const user = c.get('user');
    let paymentHistory: any[] = [];
    try { paymentHistory = JSON.parse(violation.payment_history || '[]'); } catch { /* ignore */ }

    paymentHistory.push({
      amount: parseFloat(amount), payment_method: payment_method || 'cash',
      receipt_number: receipt_number || null, notes: notes || '',
      recorded_by: user.userId, recorded_at: now,
    });

    const totalPaid = paymentHistory.reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const balance = (violation.fine_amount || 0) - totalPaid;

    await db.prepare('UPDATE code_violations SET payment_history = ?, amount_paid = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(paymentHistory), totalPaid, now, violation.id);

    return c.json({ data: { id: violation.id, total_paid: totalPaid, balance_due: balance } });
  });

  // GET /export/csv
  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const violations = await db.prepare('SELECT * FROM code_violations ORDER BY created_at DESC').all() as any[];
    const headers = ['ID', 'Violation Number', 'Type', 'Status', 'Priority', 'Location', 'Description', 'Violator Name', 'Reported By', 'Assigned Officer', 'Fine Amount', 'Amount Paid', 'Created', 'Updated'];
    const csvRows = violations.map((r: any) => [
      r.id, r.violation_number, r.violation_type, r.status, r.priority,
      (r.location || '').replace(/"/g, '""'), (r.description || '').replace(/"/g, '""'),
      r.violator_name, r.reported_by, r.assigned_officer,
      r.fine_amount, r.amount_paid, r.created_at, r.updated_at,
    ]);
    const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${v || ''}"`).join(','))].join('\n');
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', `attachment; filename="code_violations_export.csv"`);
    return c.body(csv);
  });

  app.route('/api/code-enforcement', api);
}
