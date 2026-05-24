// ============================================================
// RMPG Flex — Citations API for Workers
// ============================================================
// Workers/Hono port of server/src/routes/citations.ts
// Full CRUD for traffic citations, criminal summons, parking
// tickets, and written warnings. Auto-generates citation numbers
// in CIT-YYYY-NNNN format.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
import { localNow, localToday } from '../worker-middleware/timeUtils';
import { auditLog } from '../worker-middleware/auditLogger';

export function mountCitationRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ─── GET /stats ─────────────────────────────────────────
  api.get('/stats', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localToday();

      const statusCounts = await db.prepare(`
        SELECT status, COUNT(*) as count FROM citations
        WHERE status != 'voided'
        GROUP BY status
      `).all() as any[];

      const statusMap: Record<string, number> = {};
      for (const row of statusCounts) statusMap[row.status] = row.count;

      const typeCounts = await db.prepare(`
        SELECT type, COUNT(*) as count FROM citations
        WHERE status != 'voided'
        GROUP BY type
      `).all() as any[];

      const typeMap: Record<string, number> = {};
      for (const row of typeCounts) typeMap[row.type] = row.count;

      const finesIssued = await db.prepare(`
        SELECT COALESCE(SUM(fine_amount), 0) as total FROM citations
        WHERE status != 'voided'
      `).get() as any;

      const finesCollected = await db.prepare(`
        SELECT COALESCE(SUM(fine_amount), 0) as total FROM citations
        WHERE status = 'paid'
      `).get() as any;

      const todayCount = await db.prepare(`
        SELECT COUNT(*) as count FROM citations
        WHERE violation_date = ? AND status != 'voided'
      `).get(today) as any;

      c.header('Cache-Control', 'private, max-age=60');
      return c.json({
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
          fines_issued: finesIssued?.total ?? 0,
          fines_collected: finesCollected?.total ?? 0,
          today_count: todayCount?.count ?? 0,
        },
      });
    } catch (error: any) {
      console.error('Get citation stats error:', error);
      return c.json({ error: 'Failed to retrieve citation statistics', code: 'STATS_ERROR' }, 500);
    }
  });

  // ─── GET /search ────────────────────────────────────────
  api.get('/search', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query('q');

      if (!q || q.length < 2) {
        return c.json({ error: 'Search query must be at least 2 characters', code: 'SEARCH_QUERY_MUST_BE' }, 400);
      }

      const searchTerm = `%${q}%`;

      const citations = await db.prepare(`
        SELECT * FROM citations
        WHERE citation_number LIKE ? OR person_name LIKE ? OR statute_citation LIKE ? OR violation_description LIKE ?
        ORDER BY created_at DESC
        LIMIT 25
      `).all(searchTerm, searchTerm, searchTerm, searchTerm);

      return c.json({ data: citations });
    } catch (error: any) {
      console.error('Search citations error:', error);
      return c.json({ error: 'Failed to search citations', code: 'SEARCH_ERROR' }, 500);
    }
  });

  // ─── GET /person/:personId ──────────────────────────────
  api.get('/person/:personId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const personId = parseInt(c.req.param('personId') || '', 10);
      if (isNaN(personId)) {
        return c.json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' }, 400);
      }

      const citations = await db.prepare(`
        SELECT * FROM citations
        WHERE person_id = ?
        ORDER BY violation_date DESC, violation_time DESC
        LIMIT 500
      `).all(personId);

      return c.json({ data: citations });
    } catch (error: any) {
      console.error('Get person citations error:', error);
      return c.json({ error: 'Failed to retrieve person citations', code: 'PERSON_CITATIONS_ERROR' }, 500);
    }
  });

  // ─── GET / (list) ───────────────────────────────────────
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const {
        page = '1',
        limit = '100000',
        status,
        type,
        q: searchQ,
        officer_id,
        date_from,
        date_to,
      } = q;

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
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

      if (searchQ) {
        const searchTerm = `%${searchQ}%`;
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

      const countRow = await db.prepare(
        `SELECT COUNT(*) as total FROM citations c ${whereClause}`
      ).get(...params) as any;

      const citations = await db.prepare(`
        SELECT c.*
        FROM citations c
        ${whereClause}
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);

      return c.json({
        data: citations,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: countRow?.total ?? 0,
          totalPages: Math.ceil((countRow?.total ?? 0) / limitNum),
        },
      });
    } catch (error: any) {
      console.error('Get citations error:', error);
      return c.json({ error: 'Failed to retrieve citations', code: 'LIST_CITATIONS_ERROR' }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════
  // IMPORTANT: /payment-summary must be declared BEFORE /:id
  // to avoid Express matching "/:id" first on "payment-summary"
  // ════════════════════════════════════════════════════════════
  api.get('/payment-summary', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { date_from, date_to } = c.req.query();
      let dateFilter = '';
      const params: any[] = [];
      if (date_from) { dateFilter += ' AND cp.payment_date >= ?'; params.push(date_from); }
      if (date_to) { dateFilter += ' AND cp.payment_date <= ?'; params.push(date_to); }
      const totalPayments = await db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM citation_payments cp WHERE 1=1${dateFilter}`).get(...params) as any;
      const byMethod = await db.prepare(`SELECT payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM citation_payments cp WHERE 1=1${dateFilter} GROUP BY payment_method`).all(...params) as any[];
      const outstandingRow = await db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(fine_amount), 0) as total FROM citations WHERE status IN ('issued', 'contested', 'payment_plan') AND fine_amount > 0`).get() as any;
      const collectedRow = await db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM citation_payments`).get() as any;
      const outstandingAmt = outstandingRow?.total || 0;
      const collectedAmt = collectedRow?.total || 0;
      return c.json({ data: { payment_count: totalPayments?.count ?? 0, payment_total: totalPayments?.total ?? 0, by_method: byMethod, outstanding_citations: outstandingRow?.count ?? 0, outstanding_amount: outstandingAmt, total_collected: collectedAmt, collection_rate: outstandingAmt > 0 ? Math.round((collectedAmt / (outstandingAmt + collectedAmt)) * 100) : 0 } });
    } catch (error: any) { console.error('Payment summary error:', error); return c.json({ error: 'Failed to get payment summary', code: 'PAYMENT_SUMMARY_ERROR' }, 500); }
  });

  // ─── GET /:id ───────────────────────────────────────────
  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '', 10);
      if (isNaN(id)) {
        return c.json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' }, 400);
      }

      const citation = await db.prepare(`SELECT * FROM citations WHERE id = ?`).get(id) as any;

      if (!citation) {
        return c.json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }, 404);
      }

      return c.json({ data: citation });
    } catch (error: any) {
      console.error('Get citation error:', error);
      return c.json({ error: 'Failed to retrieve citation', code: 'GET_CITATION_ERROR' }, 500);
    }
  });

  // ─── POST / ─────────────────────────────────────────────
  api.post('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');

      const validTypes = ['traffic', 'criminal', 'parking', 'warning'];
      const validStatuses = ['issued', 'paid', 'contested', 'dismissed', 'warrant_issued', 'payment_plan'];

      const body = await c.req.json();
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
        section_id, sector_id, zone_id, beat_id, zone_beat, latitude, longitude,
        vehicle_vin, vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_id,
        speed_recorded, speed_limit, radar_type, bac_level,
        bond_amount, bond_type,
        is_warning, is_equipment_violation, weather_conditions, road_conditions,
        school_zone, construction_zone, accident_related, dui_related, commercial_vehicle, hazmat,
        court_time, court_room, appearance_required,
        case_id,
      } = body;

      if (!violation_description?.trim()) {
        return c.json({ error: 'Violation description is required', code: 'MISSING_DESCRIPTION' }, 400);
      }

      if (!validTypes.includes(type)) {
        return c.json({ error: `type must be one of: ${validTypes.join(', ')}`, code: 'INVALID_TYPE' }, 400);
      }

      if (!violation_date) {
        return c.json({ error: 'violation_date is required', code: 'MISSING_DATE' }, 400);
      }

      if (typeof violation_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(violation_date)) {
        return c.json({ error: 'violation_date must be in YYYY-MM-DD format', code: 'VIOLATIONDATE_MUST_BE_IN' }, 400);
      }

      if (fine_amount !== undefined && fine_amount !== null) {
        const fineNum = parseFloat(fine_amount);
        if (isNaN(fineNum) || fineNum < 0) {
          return c.json({ error: 'fine_amount must be a non-negative number', code: 'FINEAMOUNT_MUST_BE_A' }, 400);
        }
      }

      const year = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })).getFullYear();
      const lastCit = await db.prepare(
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
      const created_at = (user?.role === 'admin' && body.created_at) ? body.created_at : now;
      if (user?.role === 'admin' && body.created_at) {
        // Audit BEFORE insert so we capture the override intent even if the insert fails.
        // last_row_id is unknown at this point; entityId 0 matches the Express convention.
        await auditLog(db, c, 'ADMIN_OVERRIDE', 'citation', 0, `Admin God Mode: overrode created_at to ${body.created_at} on new citation`);
      }

      const result = await db.prepare(`
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
          ?, ?, ?, ?,
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
        section_id || sector_id || null, zone_id || null, beat_id || null, zone_beat || null, latitude ?? null, longitude ?? null,
        vehicle_vin || null, vehicle_year || null, vehicle_make || null, vehicle_model || null, vehicle_color || null, vehicle_id || null,
        speed_recorded ?? null, speed_limit ?? null, radar_type || null, bac_level ?? null,
        bond_amount ?? null, bond_type || null,
        is_warning ? 1 : 0, is_equipment_violation ? 1 : 0, weather_conditions || null, road_conditions || null,
        school_zone ? 1 : 0, construction_zone ? 1 : 0, accident_related ? 1 : 0, dui_related ? 1 : 0, commercial_vehicle ? 1 : 0, hazmat ? 1 : 0,
        court_time || null, court_room || null, appearance_required ? 1 : 0, case_id || null
      );

      const created = await db.prepare('SELECT * FROM citations WHERE id = ?').get(result.meta.last_row_id ?? 0);

      // Audit log + broadcast skipped (not critical for Workers)

      return c.json({ data: created }, 201);
    } catch (error: any) {
      console.error('Create citation error:', error);
      return c.json({ error: 'Failed to create citation', code: 'CREATE_CITATION_ERROR' }, 500);
    }
  });

  // ─── PUT /:id ───────────────────────────────────────────
  api.put('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '', 10);
      if (isNaN(id)) {
        return c.json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' }, 400);
      }
      const citation = await db.prepare('SELECT * FROM citations WHERE id = ?').get(id) as any;
      if (!citation) {
        return c.json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }, 404);
      }

      const body = await c.req.json();
      const fields: string[] = [];
      const values: any[] = [];
      const bodyKeys = Object.keys(body);

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
        sector_id: v => v ?? null,
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
          values.push(transform(body[key]));
        }
      }

      const effectiveUpdatedAt = (user?.role === 'admin' && body.updated_at) ? body.updated_at : localNow();

      if (fields.length > 0) {
        fields.push('updated_at = ?');
        values.push(effectiveUpdatedAt);
        values.push(id);
        await db.prepare(`UPDATE citations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        if (user?.role === 'admin' && body.updated_at) {
          await auditLog(db, c, 'ADMIN_OVERRIDE', 'citation', id, `Admin God Mode: overrode updated_at to ${body.updated_at}`);
        }
      }

      if (user?.role === 'admin' && body.citation_number) {
        await db.prepare('UPDATE citations SET citation_number = ? WHERE id = ?').run(body.citation_number, id);
        await auditLog(db, c, 'ADMIN_OVERRIDE', 'citation', id, `Admin God Mode: overrode citation_number to ${body.citation_number}`);
      }

      const updated = await db.prepare('SELECT * FROM citations WHERE id = ?').get(id);
      return c.json({ data: updated });
    } catch (error: any) {
      console.error('Update citation error:', error);
      return c.json({ error: 'Failed to update citation', code: 'UPDATE_CITATION_ERROR' }, 500);
    }
  });

  // ─── DELETE /:id ────────────────────────────────────────
  api.delete('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '', 10);
      if (isNaN(id)) {
        return c.json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' }, 400);
      }
      const citation = await db.prepare('SELECT * FROM citations WHERE id = ?').get(id) as any;
      if (!citation) {
        return c.json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }, 404);
      }

      if (user?.role === 'admin' && c.req.query('hard') === 'true') {
        await db.prepare('DELETE FROM citations WHERE id = ?').run(id);
        await auditLog(db, c, 'ADMIN_OVERRIDE', 'citation', id, `Hard-deleted citation #${citation.citation_number}`);
        return c.json({ success: true, hard_deleted: true });
      }

      await db.prepare(`
        UPDATE citations SET status = 'voided', updated_at = ? WHERE id = ?
      `).run(localNow(), id);

      // Activity log + broadcast skipped (not critical for Workers)

      return c.json({ message: 'Citation voided', data: { id: citation.id, status: 'voided' } });
    } catch (error: any) {
      console.error('Void citation error:', error);
      return c.json({ error: 'Failed to void citation', code: 'VOID_CITATION_ERROR' }, 500);
    }
  });

  // ─── GET /:id/payments ──────────────────────────────────
  api.get('/:id/payments', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const paymentCitId = parseInt(c.req.param('id') || '', 10);
      if (isNaN(paymentCitId)) {
        return c.json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' }, 400);
      }
      const citation = await db.prepare('SELECT id, fine_amount, status FROM citations WHERE id = ?').get(paymentCitId) as any;
      if (!citation) {
        return c.json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }, 404);
      }

      const payments = await db.prepare(
        'SELECT * FROM citation_payments WHERE citation_id = ? ORDER BY payment_date DESC'
      ).all(paymentCitId) as any[];

      const totalPaid = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      const fineAmount = citation.fine_amount || 0;

      return c.json({
        data: {
          payments,
          total_amount: fineAmount,
          total_paid: totalPaid,
          remaining: Math.max(0, fineAmount - totalPaid),
        },
      });
    } catch (error: any) {
      console.error('Get citation payments error:', error);
      return c.json({ error: 'Failed to retrieve citation payments', code: 'GET_PAYMENTS_ERROR' }, 500);
    }
  });

  // ─── POST /:id/payments ─────────────────────────────────
  api.post('/:id/payments', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const payCitId = parseInt(c.req.param('id') || '', 10);
      if (isNaN(payCitId)) {
        return c.json({ error: 'Invalid citation ID', code: 'INVALID_CITATION_ID' }, 400);
      }
      const citation = await db.prepare('SELECT id, fine_amount, status FROM citations WHERE id = ?').get(payCitId) as any;
      if (!citation) {
        return c.json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }, 404);
      }

      const body = await c.req.json();
      const { amount, payment_date, payment_method, reference_number, notes } = body;
      if (!amount || !payment_date) {
        return c.json({ error: 'Amount and payment_date are required', code: 'AMOUNT_AND_PAYMENTDATE_ARE' }, 400);
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return c.json({ error: 'Amount must be a positive number', code: 'AMOUNT_MUST_BE_A' }, 400);
      }

      const now = localNow();
      const result = await db.prepare(`
        INSERT INTO citation_payments (citation_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(payCitId, parseFloat(amount), payment_date, payment_method || null, reference_number || null, notes || null, user.userId, now);

      const payments = await db.prepare(
        'SELECT COALESCE(SUM(amount), 0) as total FROM citation_payments WHERE citation_id = ?'
      ).get(payCitId) as any;
      const totalPaid = payments?.total ?? 0;
      if (totalPaid >= (citation.fine_amount || 0)) {
        await db.prepare("UPDATE citations SET status = 'paid', updated_at = ? WHERE id = ?").run(now, payCitId);
      } else if (citation.status !== 'payment_plan') {
        await db.prepare("UPDATE citations SET status = 'payment_plan', updated_at = ? WHERE id = ?").run(now, payCitId);
      }

      // Activity log skipped (not critical for Workers)

      return c.json({ data: { id: result.meta.last_row_id } }, 201);
    } catch (error: any) {
      console.error('Record citation payment error:', error);
      return c.json({ error: 'Failed to record payment', code: 'RECORD_PAYMENT_ERROR' }, 500);
    }
  });

  // ─── GET /:id/completeness ──────────────────────────────
  api.get('/:id/completeness', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const citId = parseInt(c.req.param('id') || '', 10);
      const citation = await db.prepare('SELECT * FROM citations WHERE id = ?').get(citId) as any;
      if (!citation) {
        return c.json({ error: 'Citation not found', code: 'CITATION_NOT_FOUND' }, 404);
      }
      const requiredFields = ['person_name', 'violation_description', 'violation_date', 'location', 'issuing_officer_name'];
      const recommendedFields = ['person_dob', 'person_dl', 'person_address', 'statute_citation', 'offense_level', 'fine_amount', 'violation_time', 'court_date', 'court_name', 'vehicle_plate'];
      const filledRequired = requiredFields.filter(f => citation[f] != null && String(citation[f]).trim() !== '').length;
      const filledRecommended = recommendedFields.filter(f => citation[f] != null && String(citation[f]).trim() !== '').length;
      const score = Math.round(((filledRequired / requiredFields.length) * 60 + (filledRecommended / recommendedFields.length) * 40));
      const missingRequired = requiredFields.filter(f => !citation[f] || String(citation[f]).trim() === '');
      const missingRecommended = recommendedFields.filter(f => !citation[f] || String(citation[f]).trim() === '');
      return c.json({ data: { citation_id: citation.id, score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', missing_required: missingRequired, missing_recommended: missingRecommended, filled_required: filledRequired, total_required: requiredFields.length, filled_recommended: filledRecommended, total_recommended: recommendedFields.length } });
    } catch (error: any) {
      console.error('Citation completeness error:', error);
      return c.json({ error: 'Failed to get completeness', code: 'CITATION_COMPLETENESS_ERROR' }, 500);
    }
  });

  // ─── GET /:id/full ──────────────────────────────────────
  api.get('/:id/full', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const citId = parseInt(c.req.param('id') || '', 10);
      const citation = await db.prepare('SELECT * FROM citations WHERE id = ?').get(citId) as any;
      if (!citation) {
        return c.json({ error: 'Citation not found' }, 404);
      }

      let violations: any[] = [];
      let payments: any[] = [];
      try {
        violations = await db.prepare(`
          SELECT cv.*, s.statute_number, s.title as statute_title
          FROM citation_violations cv LEFT JOIN utah_statutes s ON s.id = cv.statute_id
          WHERE cv.citation_id = ? ORDER BY cv.violation_number
        `).all(citId);
      } catch { /* table may not exist */ }
      try {
        payments = await db.prepare('SELECT * FROM citation_payments WHERE citation_id = ? ORDER BY payment_date DESC').all(citId);
      } catch { /* table may not exist */ }

      const totalFines = violations.reduce((sum: number, v: any) => sum + (v.fine_amount || 0), 0) || citation.fine_amount || 0;
      const totalPaid = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

      return c.json({
        ...citation,
        violations,
        payments,
        total_fines: totalFines,
        total_paid: totalPaid,
        balance_due: Math.max(0, totalFines - totalPaid),
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to load citation details' }, 500);
    }
  });

  app.route('/api/citations', api);
}
