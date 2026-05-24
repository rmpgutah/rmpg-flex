// ============================================================
// RMPG Flex — Citations (Cloudflare Worker)
// ============================================================
// Traffic / criminal / parking / warning citations. Phase 1 RMS.
//
// Migration: 0027_citations.sql (citations + citation_violations +
// citation_payments).
//
// MVP scope — 16 endpoints. Niche endpoints deferred to a follow-up:
//   - GET /statutes/lookup, GET /calculate-fine (need utah_statutes
//     table — separate Phase 5 port)
//   - GET /stats/by-officer, GET /:id/full, GET /:id/completeness
//     (reporting — non-critical)
//   - POST /batch/void, POST /batch/status (batch ops; per-:id PUT
//     handles the common case)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const citations = new Hono<Env>();

const VALID_TYPES = new Set(['traffic', 'criminal', 'parking', 'warning']);
const VALID_STATUSES = new Set(['issued', 'paid', 'contested', 'dismissed', 'warrant_issued', 'voided']);

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = typeof v === 'string' ? v : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Generate next citation_number: CIT-YYYY-NNNN.
 *  Scans the latest existing citation for the current year and
 *  increments. Same concurrency caveat as fieldInterviews FI gen —
 *  high-volume parallel inserts in the same millisecond could
 *  collide on the unique check + insert race; legacy had the same
 *  shape. Patrol cadence makes this a non-issue in practice. */
async function generateCitationNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CIT-${year}-`;
  const row = await queryFirst<{ citation_number: string }>(
    db,
    `SELECT citation_number FROM citations
     WHERE citation_number LIKE ?
     ORDER BY id DESC LIMIT 1`,
    `${prefix}%`,
  );
  let seq = 1;
  if (row?.citation_number) {
    const parts = row.citation_number.split('-');
    const parsed = parseInt(parts[2], 10);
    seq = isNaN(parsed) ? 1 : parsed + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── GET /stats — must come before GET /:id for static-precedence ──
citations.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM citations'))?.count ?? 0;
    const byStatus = await query<Record<string, unknown>>(
      db, `SELECT status, COUNT(*) as count FROM citations GROUP BY status ORDER BY count DESC`,
    );
    const byType = await query<Record<string, unknown>>(
      db, `SELECT type, COUNT(*) as count FROM citations GROUP BY type ORDER BY count DESC`,
    );
    const last7 = (await queryFirst<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM citations WHERE violation_date >= date('now', '-7 days')`,
    ))?.count ?? 0;
    const last30 = (await queryFirst<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM citations WHERE violation_date >= date('now', '-30 days')`,
    ))?.count ?? 0;
    return c.json({ total, byStatus, byType, last7, last30 });
  } catch (err) {
    return c.json({ error: 'Failed to get citation stats', code: 'STATS_ERROR' }, 500);
  }
});

// ── GET /search ─────────────────────────────────────────────
citations.get('/search', async (c) => {
  try {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) return c.json({ data: [] });
    const db = getDb(c.env);
    const like = `%${q}%`;
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM citations
       WHERE citation_number LIKE ? OR person_name LIKE ? OR vehicle_plate LIKE ?
       ORDER BY violation_date DESC LIMIT 100`,
      like, like, like,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to search citations', code: 'SEARCH_ERROR' }, 500);
  }
});

// ── GET /person/:personId — citations issued to one person ──
citations.get('/person/:personId', async (c) => {
  try {
    const db = getDb(c.env);
    const personId = parseInt(c.req.param('personId'), 10);
    if (isNaN(personId)) return c.json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM citations WHERE person_id = ? ORDER BY violation_date DESC LIMIT 200`,
      personId,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to get citations by person', code: 'PERSON_QUERY_ERROR' }, 500);
  }
});

// ── GET /payment-summary — aggregate totals across all citations ──
// Returns { total_outstanding, total_collected, count_unpaid }.
// Computed via JOIN onto citation_payments — partial payments tracked.
citations.get('/payment-summary', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{
      total_assessed: number; total_collected: number; count_unpaid: number;
    }>(
      db,
      `SELECT
         COALESCE(SUM(c.fine_amount), 0) as total_assessed,
         COALESCE(SUM((SELECT COALESCE(SUM(amount), 0) FROM citation_payments WHERE citation_id = c.id)), 0) as total_collected,
         SUM(CASE WHEN c.status NOT IN ('paid','dismissed','voided') THEN 1 ELSE 0 END) as count_unpaid
       FROM citations c`,
    );
    const total_assessed = row?.total_assessed ?? 0;
    const total_collected = row?.total_collected ?? 0;
    return c.json({
      total_assessed,
      total_collected,
      total_outstanding: Math.max(0, total_assessed - total_collected),
      count_unpaid: row?.count_unpaid ?? 0,
    });
  } catch (err) {
    return c.json({ error: 'Failed to get payment summary', code: 'PAYMENT_SUMMARY_ERROR' }, 500);
  }
});

// ── GET / — paginated list with filters ─────────────────────
citations.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('type')) { conditions.push('type = ?'); params.push(q('type')); }
    if (q('officer_id')) { conditions.push('issuing_officer_id = ?'); params.push(q('officer_id')); }
    if (q('person_id')) { conditions.push('person_id = ?'); params.push(q('person_id')); }
    if (q('date_from')) { conditions.push('violation_date >= ?'); params.push(q('date_from')); }
    if (q('date_to')) { conditions.push('violation_date <= ?'); params.push(q('date_to')); }
    const search = q('search');
    if (search) {
      conditions.push('(citation_number LIKE ? OR person_name LIKE ? OR vehicle_plate LIKE ? OR location LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(10000, Math.max(1, parseInt(q('per_page') || '100', 10) || 100));
    const offset = (pageNum - 1) * perPage;

    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM citations ${where}`, ...params,
    );
    const total = countRow?.total ?? 0;

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT c.*,
              p.first_name as person_first_name, p.last_name as person_last_name,
              u.full_name as officer_full_name
       FROM citations c
       LEFT JOIN persons p ON c.person_id = p.id
       LEFT JOIN users u ON c.issuing_officer_id = u.id
       ${where}
       ORDER BY c.violation_date DESC, c.id DESC
       LIMIT ? OFFSET ?`,
      ...params, perPage, offset,
    );

    return c.json({
      data: rows,
      pagination: { page: pageNum, per_page: perPage, total, totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0 },
    });
  } catch (err) {
    return c.json({
      error: 'Failed to list citations', code: 'LIST_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── GET /:id ────────────────────────────────────────────────
citations.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT c.*, p.first_name as person_first_name, p.last_name as person_last_name,
              u.full_name as officer_full_name
       FROM citations c
       LEFT JOIN persons p ON c.person_id = p.id
       LEFT JOIN users u ON c.issuing_officer_id = u.id
       WHERE c.id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'Citation not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: row });
  } catch (err) {
    return c.json({ error: 'Failed to get citation', code: 'GET_ERROR' }, 500);
  }
});

// ── POST / — create citation (officer+) ─────────────────────
citations.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();

    // Required-field validation
    if (typeof b.violation_description !== 'string' || !b.violation_description.trim()) {
      return c.json({ error: 'Violation description is required', code: 'MISSING_DESCRIPTION' }, 400);
    }
    if (!b.violation_date || typeof b.violation_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.violation_date)) {
      return c.json({ error: 'violation_date must be YYYY-MM-DD', code: 'INVALID_DATE' }, 400);
    }
    const type = (typeof b.type === 'string' && VALID_TYPES.has(b.type)) ? b.type : 'traffic';
    const status = (typeof b.status === 'string' && VALID_STATUSES.has(b.status)) ? b.status : 'issued';
    if (b.fine_amount !== undefined && b.fine_amount !== null) {
      const n = parseFloat(String(b.fine_amount));
      if (isNaN(n) || n < 0) return c.json({ error: 'fine_amount must be non-negative', code: 'INVALID_FINE' }, 400);
    }

    const citationNumber = await generateCitationNumber(db);

    // Allowed columns for INSERT — explicit allow-list keeps the
    // attack surface bounded (no SQL-via-body-key injection).
    const cols: string[] = ['citation_number', 'type', 'status', 'violation_date', 'violation_description'];
    const vals: unknown[] = [citationNumber, type, status, b.violation_date, b.violation_description];

    const optional: Record<string, true> = {
      person_id: true, person_name: true, person_dob: true, person_dl: true, person_address: true,
      vehicle_id: true, vehicle_description: true, vehicle_plate: true, vehicle_state: true,
      vehicle_vin: true, vehicle_year: true, vehicle_make: true, vehicle_model: true, vehicle_color: true,
      statute_id: true, statute_citation: true, offense_level: true, fine_amount: true,
      bond_amount: true, bond_type: true,
      speed_recorded: true, speed_limit: true, radar_type: true, bac_level: true,
      is_warning: true, is_equipment_violation: true, accident_related: true, dui_related: true,
      school_zone: true, construction_zone: true, commercial_vehicle: true, hazmat: true,
      weather_conditions: true, road_conditions: true,
      violation_time: true, location: true, latitude: true, longitude: true,
      section_id: true, sector_id: true, zone_id: true, beat_id: true, zone_beat: true,
      incident_id: true, call_id: true, case_id: true,
      issuing_officer_id: true, issuing_officer_name: true, badge_number: true,
      court_date: true, court_time: true, court_room: true, court_name: true, court_address: true,
      appearance_required: true, notes: true,
    };

    for (const [k, v] of Object.entries(b)) {
      if (!optional[k] || v === undefined) continue;
      cols.push(k);
      vals.push(v ?? null);
    }

    const result = await execute(
      db,
      `INSERT INTO citations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ...vals,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM citations WHERE id = ?', newId);
    return c.json({ data: created, citation_number: citationNumber }, 201);
  } catch (err) {
    return c.json({
      error: 'Failed to create citation', code: 'CREATE_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── PUT /:id — partial update (officer+) ────────────────────
const UPDATABLE: Record<string, true> = {
  type: true, status: true,
  person_id: true, person_name: true, person_dob: true, person_dl: true, person_address: true,
  vehicle_id: true, vehicle_description: true, vehicle_plate: true, vehicle_state: true,
  vehicle_vin: true, vehicle_year: true, vehicle_make: true, vehicle_model: true, vehicle_color: true,
  statute_id: true, statute_citation: true, violation_description: true, offense_level: true,
  fine_amount: true, bond_amount: true, bond_type: true,
  speed_recorded: true, speed_limit: true, radar_type: true, bac_level: true,
  is_warning: true, is_equipment_violation: true, accident_related: true, dui_related: true,
  school_zone: true, construction_zone: true, commercial_vehicle: true, hazmat: true,
  weather_conditions: true, road_conditions: true,
  violation_date: true, violation_time: true, location: true, latitude: true, longitude: true,
  section_id: true, sector_id: true, zone_id: true, beat_id: true, zone_beat: true,
  incident_id: true, call_id: true, case_id: true,
  court_date: true, court_time: true, court_room: true, court_name: true, court_address: true,
  appearance_required: true,
  plea: true, verdict: true, sentence: true, disposition_date: true,
  notes: true,
};

citations.put('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ id: number; status: string }>(
      db, 'SELECT id, status FROM citations WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Citation not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];

    for (const [k, v] of Object.entries(b)) {
      if (!UPDATABLE[k]) continue;
      if (k === 'type' && (typeof v !== 'string' || !VALID_TYPES.has(v))) continue;
      if (k === 'status' && (typeof v !== 'string' || !VALID_STATUSES.has(v))) continue;
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }

    // Voiding bookkeeping — if status transitions to 'voided', capture
    // who/when/why so it's auditable later. Caller can also pass
    // voided_reason in the body explicitly.
    if (b.status === 'voided' && existing.status !== 'voided') {
      sets.push('voided_at = ?', 'voided_by = ?');
      vals.push(new Date().toISOString(), c.get('userId') ?? null);
      if (typeof b.voided_reason === 'string') {
        sets.push('voided_reason = ?');
        vals.push(b.voided_reason);
      }
    }

    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    sets.push(`updated_at = datetime('now')`);
    vals.push(id);

    await execute(db, `UPDATE citations SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM citations WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update citation', code: 'UPDATE_ERROR' }, 500);
  }
});

// ── DELETE /:id — admin/manager only ────────────────────────
citations.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM citations WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Citation not found', code: 'NOT_FOUND' }, 404);
    // Children (violations, payments) CASCADE via FK. Belt-and-suspenders
    // explicit deletes here in case PRAGMA foreign_keys isn't ON.
    await execute(db, 'DELETE FROM citation_payments WHERE citation_id = ?', id);
    await execute(db, 'DELETE FROM citation_violations WHERE citation_id = ?', id);
    await execute(db, 'DELETE FROM citations WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete citation', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PAYMENTS — citation_payments child table
// ═══════════════════════════════════════════════════════════════

citations.get('/:id/payments', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT p.*, u.full_name as recorded_by_name
       FROM citation_payments p
       LEFT JOIN users u ON p.recorded_by = u.id
       WHERE p.citation_id = ?
       ORDER BY p.payment_date DESC, p.id DESC`,
      id,
    );
    const totalRow = await queryFirst<{ total: number }>(
      db, 'SELECT COALESCE(SUM(amount), 0) as total FROM citation_payments WHERE citation_id = ?', id,
    );
    return c.json({ data: rows, total_paid: totalRow?.total ?? 0 });
  } catch (err) {
    return c.json({ error: 'Failed to get payments', code: 'PAYMENTS_GET_ERROR' }, 500);
  }
});

citations.post('/:id/payments', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const userId = c.get('userId') as number;
    const b = await c.req.json<{
      amount?: number; payment_date?: string; payment_method?: string;
      reference_number?: string; notes?: string;
    }>();
    if (typeof b.amount !== 'number' || b.amount <= 0) {
      return c.json({ error: 'amount must be a positive number', code: 'INVALID_AMOUNT' }, 400);
    }

    const cit = await queryFirst<{ id: number; fine_amount: number | null }>(
      db, 'SELECT id, fine_amount FROM citations WHERE id = ?', id,
    );
    if (!cit) return c.json({ error: 'Citation not found', code: 'NOT_FOUND' }, 404);

    const result = await execute(
      db,
      `INSERT INTO citation_payments (citation_id, amount, payment_date, payment_method, reference_number, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, b.amount, b.payment_date ?? new Date().toISOString().slice(0, 10),
      b.payment_method ?? null, b.reference_number ?? null, b.notes ?? null, userId,
    );
    const paymentId = Number(result.meta.last_row_id);

    // Auto-mark citation paid when total payments meet/exceed fine
    if (cit.fine_amount && cit.fine_amount > 0) {
      const totalRow = await queryFirst<{ total: number }>(
        db, 'SELECT COALESCE(SUM(amount), 0) as total FROM citation_payments WHERE citation_id = ?', id,
      );
      if ((totalRow?.total ?? 0) >= cit.fine_amount) {
        await execute(db, `UPDATE citations SET status = 'paid', updated_at = datetime('now') WHERE id = ?`, id);
      }
    }

    const payment = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM citation_payments WHERE id = ?', paymentId);
    return c.json({ data: payment }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to record payment', code: 'PAYMENTS_POST_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// VIOLATIONS — citation_violations child table
// ═══════════════════════════════════════════════════════════════

citations.get('/:id/violations', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM citation_violations WHERE citation_id = ? ORDER BY violation_number, id`,
      id,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to get violations', code: 'VIOLATIONS_GET_ERROR' }, 500);
  }
});

citations.post('/:id/violations', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const b = await c.req.json<{
      violation_number?: number; statute_id?: number; statute_citation?: string;
      violation_description?: string; offense_level?: string; fine_amount?: number;
      speed_recorded?: number; speed_limit?: number; notes?: string;
    }>();
    if (!b.violation_description?.trim()) {
      return c.json({ error: 'violation_description required', code: 'MISSING_DESCRIPTION' }, 400);
    }

    // Auto-assign violation_number if not supplied
    let violationNumber = b.violation_number;
    if (!violationNumber) {
      const maxRow = await queryFirst<{ max_num: number }>(
        db, 'SELECT COALESCE(MAX(violation_number), 0) as max_num FROM citation_violations WHERE citation_id = ?', id,
      );
      violationNumber = (maxRow?.max_num ?? 0) + 1;
    }

    const result = await execute(
      db,
      `INSERT INTO citation_violations (
         citation_id, violation_number, statute_id, statute_citation,
         violation_description, offense_level, fine_amount,
         speed_recorded, speed_limit, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, violationNumber, b.statute_id ?? null, b.statute_citation ?? null,
      b.violation_description, b.offense_level ?? 'infraction', b.fine_amount ?? 0,
      b.speed_recorded ?? null, b.speed_limit ?? null, b.notes ?? null,
    );
    const violation = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM citation_violations WHERE id = ?', Number(result.meta.last_row_id),
    );
    return c.json({ data: violation }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to add violation', code: 'VIOLATION_POST_ERROR' }, 500);
  }
});

const VIOLATION_UPDATABLE: Record<string, true> = {
  statute_id: true, statute_citation: true, violation_description: true,
  offense_level: true, fine_amount: true, speed_recorded: true, speed_limit: true,
  plea: true, verdict: true, disposition: true, disposition_date: true, notes: true,
};

citations.put('/:id/violations/:violationId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const citationId = parseInt(c.req.param('id'), 10);
    const violationId = parseInt(c.req.param('violationId'), 10);
    if (isNaN(citationId) || isNaN(violationId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM citation_violations WHERE id = ? AND citation_id = ?', violationId, citationId,
    );
    if (!existing) return c.json({ error: 'Violation not found', code: 'NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (!VIOLATION_UPDATABLE[k]) continue;
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    vals.push(violationId);

    await execute(db, `UPDATE citation_violations SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM citation_violations WHERE id = ?', violationId);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update violation', code: 'VIOLATION_PUT_ERROR' }, 500);
  }
});

citations.delete('/:id/violations/:violationId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const citationId = parseInt(c.req.param('id'), 10);
    const violationId = parseInt(c.req.param('violationId'), 10);
    if (isNaN(citationId) || isNaN(violationId)) return c.json({ error: 'Invalid IDs', code: 'INVALID_ID' }, 400);
    const result = await execute(
      db, 'DELETE FROM citation_violations WHERE id = ? AND citation_id = ?', violationId, citationId,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Violation not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete violation', code: 'VIOLATION_DELETE_ERROR' }, 500);
  }
});

// ── GET /export/csv — supervisor+ only ──────────────────────
citations.get('/export/csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (dateFrom) { where.push('violation_date >= ?'); params.push(dateFrom); }
    if (dateTo) { where.push('violation_date <= ?'); params.push(dateTo); }

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT c.citation_number, c.type, c.status, c.violation_date, c.violation_time,
              c.person_name, c.person_dob, c.person_dl,
              c.vehicle_plate, c.vehicle_state,
              c.statute_citation, c.violation_description, c.offense_level, c.fine_amount,
              c.location, u.full_name as officer_name, c.badge_number,
              c.court_date, c.court_name, c.created_at
       FROM citations c
       LEFT JOIN users u ON c.issuing_officer_id = u.id
       WHERE ${where.join(' AND ')}
       ORDER BY c.violation_date DESC LIMIT 10000`,
      ...params,
    );

    const headers = [
      { key: 'citation_number', label: 'Citation #' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'violation_date', label: 'Date' },
      { key: 'violation_time', label: 'Time' },
      { key: 'person_name', label: 'Person' },
      { key: 'person_dob', label: 'DOB' },
      { key: 'person_dl', label: 'DL' },
      { key: 'vehicle_plate', label: 'Plate' },
      { key: 'vehicle_state', label: 'State' },
      { key: 'statute_citation', label: 'Statute' },
      { key: 'violation_description', label: 'Description' },
      { key: 'offense_level', label: 'Level' },
      { key: 'fine_amount', label: 'Fine' },
      { key: 'location', label: 'Location' },
      { key: 'officer_name', label: 'Officer' },
      { key: 'badge_number', label: 'Badge' },
      { key: 'court_date', label: 'Court Date' },
      { key: 'court_name', label: 'Court' },
      { key: 'created_at', label: 'Created' },
    ];
    const head = headers.map((h) => csvEscape(h.label)).join(',');
    const body = rows.map((r) => headers.map((h) => csvEscape(r[h.key])).join(',')).join('\n');
    const csv = `${head}\n${body}\n`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="citations_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to export citations', code: 'EXPORT_ERROR' }, 500);
  }
});

export default citations;
