// ============================================================
// RMPG Flex — Trespass Orders
// ============================================================
// Replaces the 23-line stub that hardcoded empty responses. The stub's own
// comment said "until the real trespass orders module is ported" — this is that
// port. It was serving production via routesConfig.ts, which meant:
//
//   • TrespassOrdersPage.tsx listed nothing regardless of stored data, and its
//     create/edit/delete/bulk/lift/renew/serve/violate/calendar/export calls all
//     404'd — the entire page was non-functional.
//   • GET /check answered a hardcoded { orders: [], count: 0 }. PremiseHistory
//     plays a WARNING TONE when count > 0, so that alert could never fire: every
//     address read as "no active trespass orders". A false clear of the same
//     class as the hardcoded `{stolen:false}` fixed in the 2026-06-10 audit
//     (see records.ts stolen-check history).
//
// `trespass_orders` already exists on live D1 with all 36 columns used here, so
// there is NO migration in this change — verified via pragma_table_info.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { dbErrorResponse } from '../utils/dbErrors';
import { containsAnyClause } from '../utils/searchText';
import { recordAudit } from '../utils/auditLog';

const trespass = new Hono<Env>();

/** Create / edit / serve / lift / violate / renew. Mirrors the client's
 *  MANAGE_ROLES in TrespassOrdersPage.tsx — officers and dispatchers are
 *  read-only, but they DO get /check (it feeds the dispatch premise panel). */
const MANAGE_ROLES = ['admin', 'manager', 'supervisor'] as const;

/**
 * Which statuses mean "this order is still enforceable right now".
 *
 * This is the safety-critical predicate of the whole module — it decides whether
 * a dispatcher gets a trespass warning on an address.
 *
 *   active   → in force
 *   served   → delivered to the subject and in force
 *   violated → the subject already breached it; the order still stands, and this
 *              is the MOST safety-relevant case to surface, not the least
 *
 * Deliberately excluded: `lifted` (enforcement removed) and `expired`.
 * A date check is applied on top, so an `active` row past its expiration_date
 * does not surface.
 */
const ENFORCEABLE_STATUSES = ['active', 'served', 'violated'] as const;

/** SQL fragment: the order is enforceable today. `t` is the table alias. */
const ENFORCEABLE_SQL = `
  t.archived_at IS NULL
  AND t.status IN (${ENFORCEABLE_STATUSES.map(() => '?').join(', ')})
  AND (t.expiration_date IS NULL OR date(t.expiration_date) >= date('now'))
`;

/**
 * Joined projection. `days_remaining` and the linked_* / *_name fields are what
 * the client's TrespassOrder type reads but the table does not store.
 *
 * `violation_count` is intentionally absent: there is no trespass_violations
 * table on live D1, so any number here would be fabricated. It is optional on
 * the client type, so leaving it undefined is honest.
 */
const SELECT_ORDER = `
  SELECT t.*,
         p.first_name AS linked_person_first,
         p.last_name  AS linked_person_last,
         pr.name      AS linked_property_name,
         sv.full_name AS served_by_name,
         CASE WHEN t.expiration_date IS NULL THEN NULL
              ELSE CAST(julianday(date(t.expiration_date)) - julianday(date('now')) AS INTEGER)
         END AS days_remaining
  FROM trespass_orders t
  LEFT JOIN persons    p  ON p.id  = t.person_id
  LEFT JOIN properties pr ON pr.id = t.property_id
  LEFT JOIN users      sv ON sv.id = t.served_by
`;

/**
 * Next order number, TO-YYYY-NNNN.
 *
 * The FOUR-digit year matches the order already on live D1 ("TO-2026-0001") —
 * codeEnforcement.ts's nextNumber() uses a two-digit year, but copying that here
 * would emit "TO-26-0001", which both breaks the existing format and fails to
 * match the LIKE prefix, silently restarting the sequence at 0001.
 */
async function nextOrderNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const prefix = `TO-${new Date(Date.now()).getUTCFullYear()}-`;
  const last = await queryFirst<{ n: string }>(
    db,
    'SELECT order_number AS n FROM trespass_orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1',
    `${prefix}%`,
  );
  let seq = 1;
  if (last?.n) {
    const m = last.n.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/** Body → column values shared by create, bulk create, and update. */
function orderFields(body: Record<string, any>) {
  const first = (body.subject_first_name ?? '').toString().trim();
  const last = (body.subject_last_name ?? '').toString().trim();
  return {
    person_id: body.person_id ?? null,
    subject_first_name: first,
    subject_last_name: last,
    // Denormalized for search + the premise panel's display line.
    subject_name: [first, last].filter(Boolean).join(' ') || null,
    subject_dob: body.subject_dob || null,
    subject_description: body.subject_description || null,
    property_id: body.property_id ?? null,
    property_name: body.property_name || null,
    property_address: body.property_address || body.location || null,
    location: (body.location ?? '').toString().trim(),
    order_type: body.order_type || 'trespass_warning',
    reason: body.reason || null,
    conditions: body.conditions || null,
    duration_days: body.duration_days ?? null,
    authorized_by: body.authorized_by || null,
    notes: body.notes || null,
    originating_call_id: body.originating_call_id || null,
    originating_incident_id: body.originating_incident_id || null,
    sector_id: body.sector_id || null,
    zone_id: body.zone_id || null,
    beat_id: body.beat_id || null,
    zone_beat: body.zone_beat || null,
  };
}

/** expiration_date = effective + duration_days, or null for an open-ended order. */
function expirationFrom(effective: string, durationDays: unknown): string | null {
  const d = typeof durationDays === 'number' ? durationDays : parseInt(String(durationDays ?? ''), 10);
  if (!Number.isFinite(d) || d <= 0) return null;
  const base = new Date(`${effective}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + d);
  return base.toISOString().slice(0, 10);
}

function todayUtc(): string {
  return new Date(Date.now()).toISOString().slice(0, 10);
}

// ── Static paths MUST precede /:id or Hono matches them as an id ─────────────

// GET /check?property_id=… | ?address=…
// Officer-safety premise check. Feeds PremiseHistory.tsx, which plays a warning
// tone when count > 0. Read-only for every authenticated role.
trespass.get('/check', async (c) => {
  try {
    const db = getDb(c.env);
    const propertyId = c.req.query('property_id');
    const address = (c.req.query('address') || '').trim();

    // No usable selector — say so rather than returning an empty list, which
    // would read as "checked, nothing found".
    if (!propertyId && address.length < 3) {
      return c.json({
        orders: [], count: 0, checked: false,
        message: 'No address or property supplied — this is not a clearance.',
      });
    }

    let where: string;
    const params: unknown[] = [...ENFORCEABLE_STATUSES];
    if (propertyId) {
      where = 't.property_id = ?';
      params.push(propertyId);
    } else {
      // instr(), not LIKE — D1 caps LIKE patterns at 50 chars and a street
      // address routinely exceeds that. See searchText.ts.
      const m = containsAnyClause(['t.location', 't.property_address']);
      where = m.sql;
      params.push(...m.binds(address));
    }

    const orders = await query<Record<string, unknown>>(
      db,
      `${SELECT_ORDER} WHERE ${ENFORCEABLE_SQL} AND ${where}
       ORDER BY t.effective_date DESC, t.id DESC LIMIT 25`,
      ...params,
    );
    return c.json({ orders, count: orders.length, checked: true });
  } catch (err) {
    // Deliberately NOT `{ orders: [], count: 0 }`. An empty result on a trespass
    // check is indistinguishable from a clearance, and the client's own
    // .catch() already collapses failures to empty — so a swallow here would
    // silently tell an officer the address is clear. Fail loudly instead.
    return dbErrorResponse(c, err, 'Trespass check failed');
  }
});

// GET /expiration-calendar — orders expiring within the next 90 days, grouped by
// month. Client reads { total, by_month: { 'YYYY-MM': [...] } }.
trespass.get('/expiration-calendar', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      `${SELECT_ORDER}
       WHERE ${ENFORCEABLE_SQL}
         AND t.expiration_date IS NOT NULL
         AND date(t.expiration_date) <= date('now', '+90 days')
       ORDER BY date(t.expiration_date) ASC LIMIT 500`,
      ...ENFORCEABLE_STATUSES,
    );
    const byMonth: Record<string, Record<string, unknown>[]> = {};
    for (const r of rows) {
      const month = String(r.expiration_date ?? '').slice(0, 7);
      if (!month) continue;
      (byMonth[month] ||= []).push(r);
    }
    return c.json({ total: rows.length, by_month: byMonth });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to load expiration calendar'); }
});

// GET /export/csv
trespass.get('/export/csv', requireRole(...MANAGE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, any>>(
      db,
      `${SELECT_ORDER} WHERE t.archived_at IS NULL ORDER BY t.id DESC LIMIT 2500`,
    );
    const cols = [
      'order_number', 'status', 'order_type', 'subject_first_name', 'subject_last_name',
      'subject_dob', 'location', 'property_name', 'reason', 'conditions',
      'effective_date', 'expiration_date', 'days_remaining', 'served_at',
      'issued_by_name', 'authorized_by', 'zone_beat', 'notes', 'created_at',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
    return c.newResponse(csv, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=trespass_orders_export.csv',
    });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to export trespass orders'); }
});

// POST /bulk — one order per person, sharing location/type/reason.
trespass.post('/bulk', requireRole(...MANAGE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; full_name?: string } | undefined;
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const persons = Array.isArray(body.persons) ? body.persons : [];
    const valid = persons.filter((p: any) => p?.first_name && p?.last_name);
    if (valid.length === 0) return c.json({ error: 'At least one person with a first and last name is required' }, 400);
    if (!body.location) return c.json({ error: 'location is required' }, 400);
    if (valid.length > 100) return c.json({ error: 'Bulk create is limited to 100 orders per request' }, 400);

    const effective = todayUtc();
    const expiration = expirationFrom(effective, body.duration_days);
    const created: Record<string, unknown>[] = [];

    for (const p of valid) {
      const f = orderFields({
        ...body,
        subject_first_name: p.first_name,
        subject_last_name: p.last_name,
        subject_dob: p.dob,
        subject_description: p.description,
        person_id: p.person_id ?? null,
      });
      const orderNumber = await nextOrderNumber(db);
      const res = await execute(
        db,
        `INSERT INTO trespass_orders (
           order_number, status, person_id, subject_first_name, subject_last_name, subject_name,
           subject_dob, subject_description, property_id, property_name, property_address, location,
           order_type, reason, conditions, duration_days, effective_date, expiration_date,
           originating_call_id, originating_incident_id, issued_by, issued_by_name, authorized_by,
           notes, sector_id, zone_id, beat_id, zone_beat, created_at, updated_at
         ) VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        orderNumber, f.person_id, f.subject_first_name, f.subject_last_name, f.subject_name,
        f.subject_dob, f.subject_description, f.property_id, f.property_name, f.property_address, f.location,
        f.order_type, f.reason, f.conditions, f.duration_days, effective, expiration,
        f.originating_call_id, f.originating_incident_id, user?.id ?? null, user?.full_name ?? null, f.authorized_by,
        f.notes, f.sector_id, f.zone_id, f.beat_id, f.zone_beat,
      );
      created.push({ id: res.meta.last_row_id, order_number: orderNumber });
    }

    await recordAudit(c, {
      action: 'TRESPASS_BULK_CREATE', entityType: 'trespass_order', entityId: null,
      details: { count: created.length, location: body.location, order_type: body.order_type },
    });
    return c.json({ success: true, count: created.length, created }, 201);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to bulk create trespass orders'); }
});

// GET / — paginated list. Params: page, per_page, search, status, archived.
trespass.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(c.req.query('per_page') || '50', 10) || 50));
    const search = (c.req.query('search') || '').trim();
    const status = (c.req.query('status') || '').trim();
    const archived = c.req.query('archived');

    const wheres: string[] = [];
    const params: unknown[] = [];
    if (archived === 'true') wheres.push('t.archived_at IS NOT NULL');
    else if (archived !== 'all') wheres.push('t.archived_at IS NULL');
    if (status) { wheres.push('t.status = ?'); params.push(status); }
    if (search) {
      // instr(), not LIKE — D1's 50-char LIKE pattern cap. See searchText.ts.
      const m = containsAnyClause([
        't.order_number', 't.subject_first_name', 't.subject_last_name',
        't.subject_name', 't.location', 't.property_name',
      ]);
      wheres.push(m.sql);
      params.push(...m.binds(search));
    }
    const whereClause = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

    const totalRow = await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) AS n FROM trespass_orders t ${whereClause}`, ...params,
    );
    const total = totalRow?.n ?? 0;
    const rows = await query<Record<string, unknown>>(
      db,
      `${SELECT_ORDER} ${whereClause} ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
      ...params, perPage, (page - 1) * perPage,
    );
    return c.json({
      data: rows,
      pagination: { page, limit: perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to list trespass orders'); }
});

// POST / — create one order.
trespass.post('/', requireRole(...MANAGE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; full_name?: string } | undefined;
    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const f = orderFields(body);
    if (!f.subject_first_name || !f.subject_last_name) {
      return c.json({ error: 'subject_first_name and subject_last_name are required' }, 400);
    }
    if (!f.location) return c.json({ error: 'location is required' }, 400);

    const effective = body.effective_date || todayUtc();
    const expiration = body.expiration_date || expirationFrom(effective, f.duration_days);
    const orderNumber = await nextOrderNumber(db);

    const res = await execute(
      db,
      `INSERT INTO trespass_orders (
         order_number, status, person_id, subject_first_name, subject_last_name, subject_name,
         subject_dob, subject_description, property_id, property_name, property_address, location,
         order_type, reason, conditions, duration_days, effective_date, expiration_date,
         originating_call_id, originating_incident_id, issued_by, issued_by_name, authorized_by,
         notes, sector_id, zone_id, beat_id, zone_beat, created_at, updated_at
       ) VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      orderNumber, f.person_id, f.subject_first_name, f.subject_last_name, f.subject_name,
      f.subject_dob, f.subject_description, f.property_id, f.property_name, f.property_address, f.location,
      f.order_type, f.reason, f.conditions, f.duration_days, effective, expiration,
      f.originating_call_id, f.originating_incident_id, user?.id ?? null, user?.full_name ?? null, f.authorized_by,
      f.notes, f.sector_id, f.zone_id, f.beat_id, f.zone_beat,
    );
    const id = res.meta.last_row_id;
    await recordAudit(c, {
      action: 'TRESPASS_CREATE', entityType: 'trespass_order', entityId: id,
      details: { order_number: orderNumber, order_type: f.order_type, location: f.location },
    });
    const created = await queryFirst<Record<string, unknown>>(db, `${SELECT_ORDER} WHERE t.id = ?`, id);
    return c.json(created, 201);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to create trespass order'); }
});

// GET /:id
trespass.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(String(c.req.param('id')), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid trespass order id' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db, `${SELECT_ORDER} WHERE t.id = ?`, id);
    if (!row) return c.json({ error: 'Trespass order not found' }, 404);
    return c.json(row);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to load trespass order'); }
});

// PUT /:id — edit. Status transitions go through the action routes below.
trespass.put('/:id', requireRole(...MANAGE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(String(c.req.param('id')), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid trespass order id' }, 400);
    const existing = await queryFirst<{ id: number; effective_date: string | null }>(
      db, 'SELECT id, effective_date FROM trespass_orders WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Trespass order not found' }, 404);

    const body = await c.req.json<Record<string, any>>().catch(() => ({} as Record<string, any>));
    const f = orderFields(body);
    if (!f.subject_first_name || !f.subject_last_name) {
      return c.json({ error: 'subject_first_name and subject_last_name are required' }, 400);
    }
    if (!f.location) return c.json({ error: 'location is required' }, 400);

    const effective = body.effective_date || existing.effective_date || todayUtc();
    const expiration = body.expiration_date ?? expirationFrom(effective, f.duration_days);

    await execute(
      db,
      `UPDATE trespass_orders SET
         person_id = ?, subject_first_name = ?, subject_last_name = ?, subject_name = ?,
         subject_dob = ?, subject_description = ?, property_id = ?, property_name = ?,
         property_address = ?, location = ?, order_type = ?, reason = ?, conditions = ?,
         duration_days = ?, effective_date = ?, expiration_date = ?, authorized_by = ?,
         notes = ?, sector_id = ?, zone_id = ?, beat_id = ?, zone_beat = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      f.person_id, f.subject_first_name, f.subject_last_name, f.subject_name,
      f.subject_dob, f.subject_description, f.property_id, f.property_name,
      f.property_address, f.location, f.order_type, f.reason, f.conditions,
      f.duration_days, effective, expiration, f.authorized_by,
      f.notes, f.sector_id, f.zone_id, f.beat_id, f.zone_beat,
      id,
    );
    await recordAudit(c, {
      action: 'TRESPASS_UPDATE', entityType: 'trespass_order', entityId: id,
      details: { order_type: f.order_type, location: f.location },
    });
    const updated = await queryFirst<Record<string, unknown>>(db, `${SELECT_ORDER} WHERE t.id = ?`, id);
    return c.json(updated);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to update trespass order'); }
});

// DELETE /:id — soft delete (archive). A trespass order is an enforcement
// record; hard-deleting one destroys the history behind any later charge.
trespass.delete('/:id', requireRole(...MANAGE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(String(c.req.param('id')), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid trespass order id' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM trespass_orders WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Trespass order not found' }, 404);
    await execute(
      db,
      "UPDATE trespass_orders SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      id,
    );
    await recordAudit(c, { action: 'TRESPASS_ARCHIVE', entityType: 'trespass_order', entityId: id });
    return c.json({ success: true, archived: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to archive trespass order'); }
});

/** Shared status-transition handler for serve / lift / violate. */
function statusAction(
  next: string, action: string, extraSql = '',
) {
  return async (c: any) => {
    try {
      const db = getDb(c.env);
      const id = parseInt(String(c.req.param('id')), 10);
      if (!Number.isFinite(id)) return c.json({ error: 'Invalid trespass order id' }, 400);
      const existing = await queryFirst<{ id: number; status: string }>(
        db, 'SELECT id, status FROM trespass_orders WHERE id = ?', id,
      );
      if (!existing) return c.json({ error: 'Trespass order not found' }, 404);
      const user = c.get('user') as { id: number } | undefined;

      const sets = [`status = '${next}'`, "updated_at = datetime('now')"];
      const params: unknown[] = [];
      if (extraSql) sets.push(extraSql);
      if (next === 'served') params.push(user?.id ?? null);

      await execute(db, `UPDATE trespass_orders SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
      await recordAudit(c, {
        action, entityType: 'trespass_order', entityId: id,
        details: { from: existing.status, to: next },
      });
      const updated = await queryFirst<Record<string, unknown>>(db, `${SELECT_ORDER} WHERE t.id = ?`, id);
      return c.json(updated);
    } catch (err) { return dbErrorResponse(c, err, `Failed to ${action.toLowerCase()} trespass order`); }
  };
}

// PUT /:id/serve — subject was served. Records who and when.
trespass.put('/:id/serve', requireRole(...MANAGE_ROLES),
  statusAction('served', 'TRESPASS_SERVE', "served_at = datetime('now'), served_by = ?"));

// PUT /:id/lift — enforcement removed. Excluded from ENFORCEABLE_STATUSES, so
// the order stops surfacing on premise checks immediately.
trespass.put('/:id/lift', requireRole(...MANAGE_ROLES),
  statusAction('lifted', 'TRESPASS_LIFT'));

// PUT /:id/violate — subject breached the order. Still enforceable (and the most
// safety-relevant state), so it stays in ENFORCEABLE_STATUSES.
trespass.put('/:id/violate', requireRole(...MANAGE_ROLES),
  statusAction('violated', 'TRESPASS_VIOLATE'));

// POST /:id/renew — expire the old order and issue a fresh one carrying the same
// terms, with a new order_number. The client expects the NEW order back.
trespass.post('/:id/renew', requireRole(...MANAGE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(String(c.req.param('id')), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid trespass order id' }, 400);
    const prev = await queryFirst<Record<string, any>>(
      db, 'SELECT * FROM trespass_orders WHERE id = ?', id,
    );
    if (!prev) return c.json({ error: 'Trespass order not found' }, 404);

    const user = c.get('user') as { id: number; full_name?: string } | undefined;
    const effective = todayUtc();
    const expiration = expirationFrom(effective, prev.duration_days);
    const orderNumber = await nextOrderNumber(db);

    const res = await execute(
      db,
      `INSERT INTO trespass_orders (
         order_number, status, person_id, subject_first_name, subject_last_name, subject_name,
         subject_dob, subject_description, property_id, property_name, property_address, location,
         order_type, reason, conditions, duration_days, effective_date, expiration_date,
         originating_call_id, originating_incident_id, issued_by, issued_by_name, authorized_by,
         notes, sector_id, zone_id, beat_id, zone_beat, created_at, updated_at
       ) VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      orderNumber, prev.person_id, prev.subject_first_name, prev.subject_last_name, prev.subject_name,
      prev.subject_dob, prev.subject_description, prev.property_id, prev.property_name,
      prev.property_address, prev.location, prev.order_type, prev.reason, prev.conditions,
      prev.duration_days, effective, expiration, prev.originating_call_id, prev.originating_incident_id,
      user?.id ?? null, user?.full_name ?? null, prev.authorized_by,
      prev.notes, prev.sector_id, prev.zone_id, prev.beat_id, prev.zone_beat,
    );
    const newId = res.meta.last_row_id;
    await execute(
      db,
      "UPDATE trespass_orders SET status = 'expired', updated_at = datetime('now') WHERE id = ?",
      id,
    );
    await recordAudit(c, {
      action: 'TRESPASS_RENEW', entityType: 'trespass_order', entityId: newId,
      details: { renewed_from: id, previous_order_number: prev.order_number, order_number: orderNumber },
    });
    const created = await queryFirst<Record<string, unknown>>(db, `${SELECT_ORDER} WHERE t.id = ?`, newId);
    return c.json(created, 201);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to renew trespass order'); }
});

export default trespass;
