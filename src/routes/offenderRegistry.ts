// ============================================================
// Offender registry — alerts CRUD + stats + contact log
// ============================================================
// Live table: offender_alerts (id, person_id, alert_type, status,
// severity, alert_address, alert_latitude, alert_longitude, description,
// last_compliance_check, last_compliance_result, created_at, updated_at,
// + 0086: expiration_date, notes, created_by, effective_date).
// Contact log: offender_contacts (0086).
//
// OffenderRegistryPage contract:
//   GET  /            → { data: OffenderAlert[], pagination }
//   POST /            → create from { person_id, alert_type, severity,
//                        description, expiration_date, notes }
//   PUT  /:id/clear   → status = 'cleared'
//   GET  /:id/risk-score → { data } computed from severity/type/compliance
//   GET  /:id/contacts   → { data: contact rows }
//   POST /:id/contact    → log { contact_type, notes }
//   GET  /stats       → { data } stat tiles
// The client aliases location_lat/lng/address — SELECT maps the
// alert_latitude/alert_longitude/alert_address live columns onto them.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const offenderRegistry = new Hono<Env>();

const ALERT_SELECT = `
  SELECT a.*,
         a.alert_latitude  AS location_lat,
         a.alert_longitude AS location_lng,
         a.alert_address   AS location_address,
         TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS person_name,
         p.first_name, p.last_name, p.middle_name,
         p.dob, p.is_sex_offender, p.gang_affiliation
  FROM offender_alerts a
  LEFT JOIN persons p ON p.id = a.person_id`;

// ── GET / — paginated alert list ────────────────────────────
offenderRegistry.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('alert_type')) { conditions.push('a.alert_type = ?'); params.push(q('alert_type')); }
    if (q('severity')) { conditions.push('a.severity = ?'); params.push(q('severity')); }
    if (q('status')) { conditions.push('a.status = ?'); params.push(q('status')); }
    const search = q('search');
    if (search) {
      conditions.push(`(a.description LIKE ? OR a.alert_address LIKE ?
        OR p.first_name LIKE ? OR p.last_name LIKE ?)`);
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(q('limit') || '50', 10) || 50));
    const offset = (page - 1) * limit;

    const countRow = await queryFirst<{ total: number }>(
      db,
      `SELECT COUNT(*) as total FROM offender_alerts a LEFT JOIN persons p ON p.id = a.person_id ${where}`,
      ...params,
    );
    const rows = await query<Record<string, unknown>>(
      db,
      `${ALERT_SELECT} ${where}
       ORDER BY CASE a.severity WHEN 'danger' THEN 1 WHEN 'warning' THEN 2 WHEN 'caution' THEN 3 ELSE 4 END,
                a.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const total = countRow?.total ?? 0;
    return c.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    console.error('GET /offender-registry error:', err);
    return c.json({ error: 'Failed to list offender alerts', code: 'LIST_ERROR' }, 500);
  }
});

// ── POST / — create alert ───────────────────────────────────
offenderRegistry.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number } | undefined;
    const b = (await c.req.json()) as Record<string, unknown>;
    const personId = Number(b.person_id);
    if (!Number.isFinite(personId) || personId <= 0) {
      return c.json({ error: 'person_id is required', code: 'MISSING_PERSON' }, 400);
    }
    if (typeof b.description !== 'string' || !b.description.trim()) {
      return c.json({ error: 'Description is required', code: 'MISSING_DESCRIPTION' }, 400);
    }
    const result = await execute(
      db,
      `INSERT INTO offender_alerts
         (person_id, alert_type, severity, status, description,
          expiration_date, notes, created_by, effective_date,
          alert_enabled, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, date('now'), 1, datetime('now'), datetime('now'))`,
      personId,
      String(b.alert_type || 'watch_list'),
      String(b.severity || 'caution'),
      b.description.trim(),
      (typeof b.expiration_date === 'string' && b.expiration_date) ? b.expiration_date : null,
      (typeof b.notes === 'string' && b.notes) ? b.notes : null,
      user?.id ?? null,
    );
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    console.error('POST /offender-registry error:', err);
    return c.json({ error: 'Failed to create alert', code: 'CREATE_ERROR' }, 500);
  }
});

// ── PUT /:id/clear — deactivate alert ───────────────────────
offenderRegistry.put('/:id/clear', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const result = await execute(
      db,
      `UPDATE offender_alerts SET status = 'cleared', alert_enabled = 0, updated_at = datetime('now') WHERE id = ?`,
      id,
    );
    if (result.meta.changes === 0) return c.json({ error: 'Alert not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /offender-registry/:id/clear error:', err);
    return c.json({ error: 'Failed to clear alert', code: 'CLEAR_ERROR' }, 500);
  }
});

// ── POST /reconcile-flags — sync persons.is_sex_offender ────
// Keeps the two stores consistent: a person with an ACTIVE, unexpired
// sex_offender alert should also carry persons.is_sex_offender so the
// DL-scan deep sweep and the persons-flag screening branch fire on them.
// One-way + idempotent: only sets the flag on, never clears it (a cleared
// alert shouldn't silently un-flag a person who may be flagged elsewhere).
offenderRegistry.post('/reconcile-flags', async (c) => {
  try {
    const user = c.get('user') as { id: number; role: string } | undefined;
    if (!user || !['admin', 'manager', 'supervisor'].includes(user.role)) {
      return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
    }
    const db = getDb(c.env);
    const result = await execute(db, `
      UPDATE persons SET is_sex_offender = 1, updated_at = datetime('now')
      WHERE COALESCE(is_sex_offender, 0) <> 1
        AND id IN (
          SELECT person_id FROM offender_alerts
          WHERE alert_type = 'sex_offender' AND status = 'active'
            AND (expiration_date IS NULL OR expiration_date = '' OR expiration_date >= date('now'))
            AND person_id IS NOT NULL
        )`);
    return c.json({ success: true, flagged: result.meta.changes ?? 0 });
  } catch (err) {
    console.error('POST /offender-registry/reconcile-flags error:', err);
    return c.json({ error: 'Failed to reconcile flags', code: 'RECONCILE_ERROR' }, 500);
  }
});

// ── GET /:id/risk-score — computed assessment ───────────────
offenderRegistry.get('/:id/risk-score', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const alert = await queryFirst<Record<string, unknown>>(
      db, `${ALERT_SELECT} WHERE a.id = ?`, id,
    );
    if (!alert) return c.json({ error: 'Alert not found', code: 'NOT_FOUND' }, 404);

    // Transparent additive score — each factor is reported alongside
    // the total so officers can see WHY a subject scored high.
    const factors: { factor: string; points: number }[] = [];
    const sevPts: Record<string, number> = { danger: 40, warning: 25, caution: 12, info: 5 };
    factors.push({ factor: `Severity: ${alert.severity}`, points: sevPts[String(alert.severity)] ?? 5 });
    const typePts: Record<string, number> = {
      violent_history: 30, sex_offender: 25, gang_member: 20, warrant_flag: 20,
      ban_zone: 12, parole: 10, probation: 8, mental_health: 8, watch_list: 5,
    };
    factors.push({ factor: `Type: ${alert.alert_type}`, points: typePts[String(alert.alert_type)] ?? 5 });
    if (alert.last_compliance_result === 'non_compliant') {
      factors.push({ factor: 'Last compliance check: non-compliant', points: 20 });
    }
    if (alert.is_sex_offender) factors.push({ factor: 'Flagged sex offender (person record)', points: 10 });
    if (alert.gang_affiliation && !['none', 'None', 'N/A', '0', ''].includes(String(alert.gang_affiliation))) {
      factors.push({ factor: `Gang affiliation: ${alert.gang_affiliation}`, points: 10 });
    }
    const otherActive = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM offender_alerts WHERE person_id = ? AND id != ? AND status = 'active'`,
      alert.person_id, id,
    );
    if ((otherActive?.n ?? 0) > 0) {
      factors.push({ factor: `${otherActive!.n} other active alert(s)`, points: Math.min(20, otherActive!.n * 5) });
    }
    const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
    const level = score >= 70 ? 'high' : score >= 40 ? 'elevated' : 'standard';
    return c.json({ data: { score, level, factors } });
  } catch (err) {
    console.error('GET /offender-registry/:id/risk-score error:', err);
    return c.json({ error: 'Risk assessment failed', code: 'RISK_ERROR' }, 500);
  }
});

// ── GET /:id/contacts + POST /:id/contact — contact log ─────
offenderRegistry.get('/:id/contacts', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT oc.*, u.full_name AS officer_name
       FROM offender_contacts oc LEFT JOIN users u ON u.id = oc.officer_id
       WHERE oc.alert_id = ? ORDER BY oc.created_at DESC LIMIT 200`,
      id,
    );
    return c.json({ data: rows });
  } catch (err) {
    console.error('GET /offender-registry/:id/contacts error:', err);
    return c.json({ data: [] }, 200);
  }
});

offenderRegistry.post('/:id/contact', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const user = c.get('user') as { id: number } | undefined;
    const b = (await c.req.json()) as { contact_type?: string; notes?: string };
    const alert = await queryFirst<{ id: number }>(db, 'SELECT id FROM offender_alerts WHERE id = ?', id);
    if (!alert) return c.json({ error: 'Alert not found', code: 'NOT_FOUND' }, 404);
    await execute(
      db,
      `INSERT INTO offender_contacts (alert_id, officer_id, contact_type, notes, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      id, user?.id ?? null, String(b.contact_type || 'field_contact'), b.notes || null,
    );
    // A logged contact doubles as a compliance touch.
    await execute(
      db,
      `UPDATE offender_alerts SET last_compliance_check = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      id,
    );
    return c.json({ success: true });
  } catch (err) {
    console.error('POST /offender-registry/:id/contact error:', err);
    return c.json({ error: 'Failed to log contact', code: 'CONTACT_ERROR' }, 500);
  }
});

// ── GET /export/csv ─────────────────────────────────────────
offenderRegistry.get('/export/csv', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db, `${ALERT_SELECT} ORDER BY a.created_at DESC LIMIT 10000`,
    );
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cols = ['id', 'person_name', 'alert_type', 'severity', 'status', 'description', 'location_address', 'expiration_date', 'created_at'];
    const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="offender_registry_export.csv"');
    return c.body(csv);
  } catch (err) {
    console.error('GET /offender-registry/export/csv error:', err);
    return c.json({ url: null, count: 0, message: 'export failed' }, 200);
  }
});

offenderRegistry.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);

    const totals = await queryFirst<Record<string, number>>(db, `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high_severity,
        SUM(CASE WHEN last_compliance_result = 'non_compliant' THEN 1 ELSE 0 END) AS non_compliant
      FROM offender_alerts
    `);

    const byType = await query<{ alert_type: string; count: number }>(db, `
      SELECT COALESCE(alert_type, 'unknown') AS alert_type, COUNT(*) AS count
      FROM offender_alerts GROUP BY alert_type ORDER BY count DESC
    `);

    const bySeverity = await query<{ severity: string; count: number }>(db, `
      SELECT COALESCE(severity, 'unknown') AS severity, COUNT(*) AS count
      FROM offender_alerts GROUP BY severity ORDER BY count DESC
    `);
    // OffenderRegistryPage reads by_severity.<key> (an object), total_alerts,
    // total_persons and expiring_soon — none of which the array shape provided,
    // so every stat tile showed 0.
    const bySeverityMap: Record<string, number> = {};
    for (const r of bySeverity) bySeverityMap[String(r.severity)] = Number(r.count) || 0;
    const personsRow = await queryFirst<{ n: number }>(
      db, 'SELECT COUNT(DISTINCT person_id) AS n FROM offender_alerts',
    );

    return c.json({
      data: {
        total: totals?.total ?? 0,
        total_alerts: totals?.total ?? 0,
        total_persons: personsRow?.n ?? 0,
        active: totals?.active ?? 0,
        expired: totals?.expired ?? 0,
        high_severity: totals?.high_severity ?? 0,
        non_compliant: totals?.non_compliant ?? 0,
        expiring_soon: 0, // no expiry column on offender_alerts yet
        by_type: byType,
        by_severity: bySeverityMap,
      },
    });
  } catch (err) {
    console.error('GET /offender-registry/stats error:', err);
    return c.json({ data: {} }, 200);
  }
});

export default offenderRegistry;
