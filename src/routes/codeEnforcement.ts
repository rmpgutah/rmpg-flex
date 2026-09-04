// ============================================================
// Code Enforcement — violations + vehicle tows (D1-backed)
// ============================================================
// Live tables: code_violations (27 cols + 0086 additions),
// vehicle_tows (33 cols). Both existed on live D1 with zero rows
// while the page's endpoints 404'd — the UI was fully built against
// handlers that never existed (this router replaces the lone
// /export/csv stub in stubs.ts).
//
// CodeEnforcementPage contract:
//   GET  /violations            → { data, pagination { total, totalPages } }
//   GET  /violations/:id        → { data }
//   POST /violations            → create (violation_number auto-gen)
//   PUT  /violations/:id/status → { status }
//   GET  /tows /tows/:id  POST /tows  PUT /tows/:id/status — same shape
//   GET  /stats                 → { data: { violations:{open}, tows:{active},
//                                   parking_citations_today } }
//   GET  /property-history?location= → { data: { is_repeat_offender,
//                                   violation_count_12mo, violations } }
//   GET  /export/csv            → violations CSV
//
// NOT implemented (the page defines handlers for severity-score,
// timeline, calculate-fine, compliance-dashboard and geo/clusters but
// never wires them to any UI element — dead client code; add the
// endpoints when the buttons land).

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { denverDateExpr, denverNowDateExpr } from '../utils/denverTime';
import { containsAnyClause } from '../utils/searchText';

const ce = new Hono<Env>();

function csvEscape(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

async function nextNumber(
  db: ReturnType<typeof getDb>, table: string, column: string, prefix: string,
): Promise<string> {
  const last = await queryFirst<{ n: string }>(
    db,
    `SELECT ${column} AS n FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`,
    `${prefix}%`,
  );
  let seq = 1;
  if (last?.n) {
    const m = last.n.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

const yy = () => String(new Date().getFullYear()).slice(-2);

// ── Violations ──────────────────────────────────────────────

ce.get('/violations', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('violation_type')) { conditions.push('violation_type = ?'); params.push(q('violation_type')); }
    const search = q('search');
    if (search) {
      // instr(), not LIKE — D1 caps LIKE patterns at 50 chars (searchText.ts).
      const _m = containsAnyClause(['violation_number', 'location', 'description', 'violator_name']);
      conditions.push(_m.sql);
      params.push(..._m.binds(search));
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(q('limit') || '50', 10) || 50));
    const offset = (page - 1) * limit;
    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) AS total FROM code_violations ${where}`, ...params,
    );
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM code_violations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const total = countRow?.total ?? 0;
    return c.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    console.error('GET /code-enforcement/violations error:', err);
    return c.json({ error: 'Failed to list violations', code: 'LIST_ERROR' }, 500);
  }
});

ce.get('/violations/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM code_violations WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Violation not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: row });
  } catch (err) {
    console.error('GET /code-enforcement/violations/:id error:', err);
    return c.json({ error: 'Failed to load violation', code: 'GET_ERROR' }, 500);
  }
});

ce.post('/violations', async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; full_name?: string } | undefined;
    const b = (await c.req.json()) as Record<string, unknown>;
    if (typeof b.location !== 'string' || !b.location.trim()) {
      return c.json({ error: 'Location is required', code: 'MISSING_LOCATION' }, 400);
    }
    if (typeof b.description !== 'string' || !b.description.trim()) {
      return c.json({ error: 'Description is required', code: 'MISSING_DESCRIPTION' }, 400);
    }
    const violationNumber = await nextNumber(db, 'code_violations', 'violation_number', `CV-${yy()}-`);
    const fine = b.fine_amount !== undefined && b.fine_amount !== '' ? Number(b.fine_amount) : null;
    const result = await execute(
      db,
      `INSERT INTO code_violations
         (violation_number, violation_type, status, severity, location,
          description, code_section, compliance_deadline, fine_amount,
          notes, zone_beat, sector_id, zone_id, beat_id,
          reporting_officer_id, created_at, updated_at)
       VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      violationNumber,
      String(b.violation_type || 'other'),
      String(b.severity || 'low'),
      b.location.trim(),
      b.description.trim(),
      (typeof b.code_section === 'string' && b.code_section) ? b.code_section : null,
      (typeof b.compliance_deadline === 'string' && b.compliance_deadline) ? b.compliance_deadline : null,
      Number.isFinite(fine) ? fine : null,
      (typeof b.notes === 'string' && b.notes) ? b.notes : null,
      (typeof b.zone_beat === 'string' && b.zone_beat) ? b.zone_beat : null,
      (typeof b.sector_id === 'string' || typeof b.sector_id === 'number') && b.sector_id !== '' ? String(b.sector_id) : null,
      (typeof b.zone_id === 'string' || typeof b.zone_id === 'number') && b.zone_id !== '' ? String(b.zone_id) : null,
      (typeof b.beat_id === 'string' || typeof b.beat_id === 'number') && b.beat_id !== '' ? String(b.beat_id) : null,
      user?.id ?? null,
    );
    return c.json({ success: true, id: result.meta.last_row_id, violation_number: violationNumber });
  } catch (err) {
    console.error('POST /code-enforcement/violations error:', err);
    return c.json({ error: 'Failed to create violation', code: 'CREATE_ERROR' }, 500);
  }
});

const VIOLATION_STATUSES = new Set(['open', 'notice_sent', 'reinspection', 'resolved', 'referred', 'voided']);

ce.put('/violations/:id/status', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const b = (await c.req.json()) as { status?: string; resolution_notes?: string };
    if (!b.status || !VIOLATION_STATUSES.has(b.status)) {
      return c.json({ error: 'Invalid status', code: 'INVALID_STATUS' }, 400);
    }
    const result = await execute(
      db,
      `UPDATE code_violations SET
         status = ?,
         resolved_date = CASE WHEN ? IN ('resolved', 'voided') THEN datetime('now') ELSE resolved_date END,
         resolution_notes = COALESCE(?, resolution_notes),
         updated_at = datetime('now')
       WHERE id = ?`,
      b.status, b.status, b.resolution_notes ?? null, id,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Violation not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /code-enforcement/violations/:id/status error:', err);
    return c.json({ error: 'Failed to update status', code: 'STATUS_ERROR' }, 500);
  }
});

// ── Tows ────────────────────────────────────────────────────

ce.get('/tows', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    const search = q('search');
    if (search) {
      // instr(), not LIKE — D1 caps LIKE patterns at 50 chars (searchText.ts).
      const _m = containsAnyClause(['tow_number', 'vehicle_plate', 'vehicle_vin', 'tow_from']);
      conditions.push(_m.sql);
      params.push(..._m.binds(search));
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(q('limit') || '50', 10) || 50));
    const offset = (page - 1) * limit;
    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) AS total FROM vehicle_tows ${where}`, ...params,
    );
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM vehicle_tows ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const total = countRow?.total ?? 0;
    return c.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    console.error('GET /code-enforcement/tows error:', err);
    return c.json({ error: 'Failed to list tows', code: 'LIST_ERROR' }, 500);
  }
});

ce.get('/tows/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM vehicle_tows WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Tow not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: row });
  } catch (err) {
    console.error('GET /code-enforcement/tows/:id error:', err);
    return c.json({ error: 'Failed to load tow', code: 'GET_ERROR' }, 500);
  }
});

ce.post('/tows', async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; full_name?: string } | undefined;
    const b = (await c.req.json()) as Record<string, unknown>;
    if (typeof b.tow_from !== 'string' || !b.tow_from.trim()) {
      return c.json({ error: 'Tow-from location is required', code: 'MISSING_LOCATION' }, 400);
    }
    const towNumber = await nextNumber(db, 'vehicle_tows', 'tow_number', `TOW-${yy()}-`);
    const towFee = b.tow_fee !== undefined && b.tow_fee !== '' ? Number(b.tow_fee) : null;
    // Client form field is `storage_fee`; the live column is storage_fee_daily.
    const storageFee = b.storage_fee !== undefined && b.storage_fee !== '' ? Number(b.storage_fee) : null;
    const result = await execute(
      db,
      `INSERT INTO vehicle_tows
         (tow_number, status, vehicle_plate, vehicle_state, vehicle_vin,
          vehicle_year, vehicle_make, vehicle_model, vehicle_color,
          tow_from, tow_to, tow_reason, tow_company, tow_fee, storage_fee_daily,
          notes, officer_id, officer_name, ordered_at, created_at, updated_at)
       VALUES (?, 'ordered', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
      towNumber,
      (b.vehicle_plate as string) || null,
      (b.vehicle_state as string) || null,
      (b.vehicle_vin as string) || null,
      (b.vehicle_year as string) || null,
      (b.vehicle_make as string) || null,
      (b.vehicle_model as string) || null,
      (b.vehicle_color as string) || null,
      b.tow_from.trim(),
      (b.tow_to as string) || null,
      String(b.tow_reason || 'parking_violation'),
      (b.tow_company as string) || null,
      Number.isFinite(towFee) ? towFee : null,
      Number.isFinite(storageFee) ? storageFee : null,
      (b.notes as string) || null,
      user?.id ?? null,
      user?.full_name ?? null,
    );
    return c.json({ success: true, id: result.meta.last_row_id, tow_number: towNumber });
  } catch (err) {
    console.error('POST /code-enforcement/tows error:', err);
    return c.json({ error: 'Failed to create tow record', code: 'CREATE_ERROR' }, 500);
  }
});

const TOW_STATUSES = new Set(['ordered', 'dispatched', 'in_progress', 'completed', 'released', 'cancelled']);

ce.put('/tows/:id/status', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const b = (await c.req.json()) as { status?: string; released_to?: string };
    if (!b.status || !TOW_STATUSES.has(b.status)) {
      return c.json({ error: 'Invalid status', code: 'INVALID_STATUS' }, 400);
    }
    const result = await execute(
      db,
      `UPDATE vehicle_tows SET
         status = ?,
         dispatched_at = CASE WHEN ? = 'dispatched' AND dispatched_at IS NULL THEN datetime('now') ELSE dispatched_at END,
         completed_at  = CASE WHEN ? = 'completed'  AND completed_at  IS NULL THEN datetime('now') ELSE completed_at  END,
         released_at   = CASE WHEN ? = 'released'   AND released_at   IS NULL THEN datetime('now') ELSE released_at   END,
         released_to   = COALESCE(?, released_to),
         updated_at = datetime('now')
       WHERE id = ?`,
      b.status, b.status, b.status, b.status, b.released_to ?? null, id,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Tow not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /code-enforcement/tows/:id/status error:', err);
    return c.json({ error: 'Failed to update tow status', code: 'STATUS_ERROR' }, 500);
  }
});

// ── Stats / property history / export ───────────────────────

ce.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const v = await queryFirst<Record<string, number>>(db, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status NOT IN ('resolved', 'voided') THEN 1 ELSE 0 END) AS open,
             SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
      FROM code_violations`);
    const t = await queryFirst<Record<string, number>>(db, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status NOT IN ('completed', 'released', 'cancelled') THEN 1 ELSE 0 END) AS active
      FROM vehicle_tows`);
    // Parking citations issued today — best-effort; citations schema
    // drift on live makes this a guarded sub-query.
    let parkingToday = 0;
    try {
      const p = await queryFirst<{ n: number }>(db, `
        SELECT COUNT(*) AS n FROM citations
        WHERE (violation LIKE '%park%' OR type LIKE '%park%')
          AND ${denverDateExpr('created_at')} = ${denverNowDateExpr()}`);
      parkingToday = p?.n ?? 0;
    } catch { /* citations schema drift — leave 0 */ }
    return c.json({
      data: {
        violations: { total: v?.total ?? 0, open: v?.open ?? 0, resolved: v?.resolved ?? 0 },
        tows: { total: t?.total ?? 0, active: t?.active ?? 0 },
        parking_citations_today: parkingToday,
      },
    });
  } catch (err) {
    console.error('GET /code-enforcement/stats error:', err);
    return c.json({ data: { violations: { open: 0 }, tows: { active: 0 }, parking_citations_today: 0 } }, 200);
  }
});

ce.get('/property-history', async (c) => {
  try {
    const db = getDb(c.env);
    const location = c.req.query('location');
    if (!location) return c.json({ error: 'location is required', code: 'MISSING_LOCATION' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, violation_number, violation_type, status, created_at
       FROM code_violations WHERE location = ? ORDER BY created_at DESC LIMIT 50`,
      location,
    );
    const recentRow = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM code_violations
       WHERE location = ? AND created_at >= datetime('now', '-12 months')`,
      location,
    );
    const count12mo = recentRow?.n ?? 0;
    return c.json({
      data: {
        location,
        violations: rows,
        violation_count_12mo: count12mo,
        is_repeat_offender: count12mo >= 3,
      },
    });
  } catch (err) {
    console.error('GET /code-enforcement/property-history error:', err);
    return c.json({ data: null }, 200);
  }
});

ce.get('/export/csv', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT violation_number, violation_type, status, severity, location,
              description, code_section, fine_amount, compliance_deadline,
              resolved_date, created_at
       FROM code_violations ORDER BY created_at DESC LIMIT 10000`,
    );
    const cols = ['violation_number', 'violation_type', 'status', 'severity', 'location', 'description', 'code_section', 'fine_amount', 'compliance_deadline', 'resolved_date', 'created_at'];
    const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => csvEscape(r[k])).join(','))].join('\n');
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="code_violations_export.csv"');
    return c.body(csv);
  } catch (err) {
    console.error('GET /code-enforcement/export/csv error:', err);
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="code_violations_export.csv"');
    return c.body('');
  }
});

export default ce;
