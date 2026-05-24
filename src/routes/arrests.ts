// ============================================================
// RMPG Flex — Arrests (manual subset, Cloudflare Worker)
// ============================================================
// Officer-completed booking / arrest records. Phase 1 RMS.
//
// Migration: 0026_arrests_manual.sql.
//
// Scope: the manual booking subsystem only. The legacy arrests.ts
// also bundled an external JailBase poller integration (~20
// endpoints for credentials, /toggle, /poller/*, /sync, etc).
// Per the retirement plan §Phase 2, pollers convert to scheduled()
// cron handlers — that work lands in a separate PR.
//
// Endpoints (14):
//   POST   /manual                       — create booking record
//   GET    /manual/:id                   — single record
//   PUT    /manual/:id                   — update
//   DELETE /manual/:id                   — admin/manager only
//   GET    /recent                       — recent records (manual + future poller)
//   GET    /search?q=                    — name search
//   GET    /export/csv                   — supervisor+ only
//   GET    /:id/cross-links              — linked records
//   PUT    /:id/link-person              — manual link to person
//   DELETE /:id/link-person              — unlink
//   GET    /manual/:id/checklist         — booking checklist (JSON column)
//   PUT    /manual/:id/checklist         — toggle checklist item
//   GET    /manual/:id/property          — property inventory (JSON column)
//   POST   /manual/:id/property          — add item
//   DELETE /manual/:id/property/:itemId  — remove item
//   GET    /manual/:id/miranda           — Miranda record (JSON column)
//   POST   /manual/:id/miranda           — record Miranda reading
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const arrests = new Hono<Env>();

// ── Allowed values ─────────────────────────────────────────
const ARREST_STATUSES = new Set(['active', 'released', 'transferred', 'bonded', 'closed']);
// Future generic /link endpoint will accept any of these; current PR
// only exposes /:id/link-person, so we don't need a runtime check yet.
// Kept the list documented inline for the future port.
// LINKED_TYPES = 'person' | 'citation' | 'court_event' | 'warrant' | 'call'

// Standard booking checklist — definition stays in code (not DB) so
// adding/removing items is a code change, not a data migration. Matches
// legacy contract exactly. `required` items must be completed before
// `is_complete: true` flips.
const STANDARD_CHECKLIST = [
  { key: 'miranda_read', label: 'Miranda Rights Read', required: true },
  { key: 'miranda_acknowledged', label: 'Miranda Acknowledged', required: true },
  { key: 'personal_search', label: 'Personal Search Completed', required: true },
  { key: 'property_inventory', label: 'Property Inventory Completed', required: true },
  { key: 'fingerprinted', label: 'Fingerprinted', required: true },
  { key: 'photographed', label: 'Booking Photo Taken', required: true },
  { key: 'medical_screening', label: 'Medical Screening', required: true },
  { key: 'phone_call_offered', label: 'Phone Call Offered', required: true },
  { key: 'warrant_verified', label: 'Warrant Verified', required: false },
  { key: 'vehicle_secured', label: 'Vehicle Secured/Towed', required: false },
  { key: 'evidence_secured', label: 'Evidence Secured', required: false },
  { key: 'supervisor_notified', label: 'Supervisor Notified', required: false },
  { key: 'bail_info_provided', label: 'Bail Information Provided', required: false },
] as const;

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function splitName(full: string): { first: string; middle: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: '', middle: '', last: '' };
  if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] };
}

function parseJsonCol<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = typeof v === 'string' ? v : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// ── POST /manual — create booking record ────────────────────
arrests.post('/manual', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();

    const fullName = typeof b.full_name === 'string' ? b.full_name.trim() : '';
    if (fullName.length < 2) {
      return c.json({ error: 'Full name is required (min 2 characters)', code: 'FULL_NAME_REQUIRED' }, 400);
    }
    const status = typeof b.status === 'string' && ARREST_STATUSES.has(b.status) ? b.status : 'active';

    // Charges may be array or string; serialize to JSON either way for
    // schema consistency. Cap at 100 entries to bound payload size.
    const chargesJson = Array.isArray(b.charges)
      ? JSON.stringify((b.charges as unknown[]).slice(0, 100))
      : typeof b.charges === 'string' ? b.charges : '[]';

    const { first, middle, last } = splitName(fullName);

    // Sentinel jailbase_id for manual rows preserves the UNIQUE
    // (jailbase_id, source_id) constraint while still letting many
    // manual rows coexist — each gets a unique synthetic id.
    const sentinel = `manual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const result = await execute(
      db,
      `INSERT INTO arrest_records (
         jailbase_id, source_id, source_name,
         full_name, first_name, last_name, middle_name,
         date_of_birth, gender, race, height, weight, hair_color, eye_color, address,
         booking_date, release_date, booking_number, agency, county, state,
         charges, bail_amount, hold_reason, notes, status,
         entry_source, entered_by
       ) VALUES (
         ?, 'manual', 'Manual Entry',
         ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         'manual', ?
       )`,
      sentinel,
      fullName, first || (b.first_name ?? null), last || (b.last_name ?? null), middle || (b.middle_name ?? null),
      b.date_of_birth ?? null, b.gender ?? null, b.race ?? null,
      b.height ?? null, b.weight ?? null, b.hair_color ?? null, b.eye_color ?? null, b.address ?? null,
      b.booking_date ?? null, b.release_date ?? null, b.booking_number ?? null,
      b.agency ?? null, b.county ?? null, b.state ?? 'UT',
      chargesJson, b.bail_amount ?? null, b.hold_reason ?? null, b.notes ?? null, status,
      userId,
    );
    const newId = Number(result.meta.last_row_id);

    // Active-warrant hit detection — non-blocking. Returns the count
    // so the UI can surface a chip; future port should wire the
    // notification system (createNotification + createNotificationForRoles).
    let warrantHitCount = 0;
    try {
      const row = await queryFirst<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM warrants
         WHERE status = 'active'
           AND LOWER(TRIM(subject_name)) = LOWER(TRIM(?))`,
        fullName,
      );
      warrantHitCount = row?.count ?? 0;
    } catch { /* warrants schema variant — non-fatal */ }

    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM arrest_records WHERE id = ?', newId);
    return c.json({ success: true, id: newId, data: created, warrant_hits: warrantHitCount }, 201);
  } catch (err) {
    return c.json({
      error: 'Failed to create arrest record', code: 'CREATE_ARREST_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── GET /manual/:id — single record ─────────────────────────
arrests.get('/manual/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM arrest_records WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);
    return c.json({ data: row });
  } catch (err) {
    return c.json({ error: 'Failed to get arrest record', code: 'GET_ARREST_ERROR' }, 500);
  }
});

// ── PUT /manual/:id — update ────────────────────────────────
const UPDATABLE_FIELDS: Record<string, true> = {
  full_name: true, first_name: true, last_name: true, middle_name: true,
  date_of_birth: true, gender: true, race: true, height: true, weight: true,
  hair_color: true, eye_color: true, address: true,
  booking_date: true, release_date: true, booking_number: true, agency: true,
  county: true, state: true, bail_amount: true, hold_reason: true, notes: true,
  status: true, mugshot_url: true, details_url: true,
};

arrests.put('/manual/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM arrest_records WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (!UPDATABLE_FIELDS[k]) continue;
      if (k === 'status' && (typeof v !== 'string' || !ARREST_STATUSES.has(v))) continue;
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }
    // Charges field — special handling (serialize array)
    if (b.charges !== undefined) {
      sets.push('charges = ?');
      vals.push(Array.isArray(b.charges)
        ? JSON.stringify((b.charges as unknown[]).slice(0, 100))
        : typeof b.charges === 'string' ? b.charges : '[]');
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);

    sets.push(`updated_at = datetime('now')`);
    vals.push(id);
    await execute(db, `UPDATE arrest_records SET ${sets.join(', ')} WHERE id = ?`, ...vals);

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM arrest_records WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update arrest record', code: 'UPDATE_ARREST_ERROR' }, 500);
  }
});

// ── DELETE /manual/:id — admin/manager only ─────────────────
arrests.delete('/manual/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM arrest_records WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);
    await execute(db, 'DELETE FROM arrest_records WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete arrest record', code: 'DELETE_ARREST_ERROR' }, 500);
  }
});

// ── GET /recent ─────────────────────────────────────────────
arrests.get('/recent', async (c) => {
  try {
    const db = getDb(c.env);
    const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
    const source = c.req.query('source'); // optional filter: 'manual' | 'jailbase'
    const sql = source
      ? `SELECT * FROM arrest_records WHERE entry_source = ? ORDER BY COALESCE(booking_date, fetched_at) DESC LIMIT ?`
      : `SELECT * FROM arrest_records ORDER BY COALESCE(booking_date, fetched_at) DESC LIMIT ?`;
    const rows = source
      ? await query<Record<string, unknown>>(db, sql, source, limit)
      : await query<Record<string, unknown>>(db, sql, limit);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list recent arrests', code: 'RECENT_ARRESTS_ERROR' }, 500);
  }
});

// ── GET /search?q= ──────────────────────────────────────────
arrests.get('/search', async (c) => {
  try {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) return c.json({ data: [] });
    const db = getDb(c.env);
    const like = `%${q}%`;
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM arrest_records
       WHERE full_name LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR booking_number LIKE ?
       ORDER BY COALESCE(booking_date, fetched_at) DESC LIMIT 100`,
      like, like, like, like,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to search arrests', code: 'SEARCH_ARRESTS_ERROR' }, 500);
  }
});

// ── GET /:id/cross-links — linked records ───────────────────
// Static `/recent`, `/search`, `/manual/*`, `/export` all match earlier
// via Hono's segment trie, so the parametric `/:id/*` family at the
// end is the natural placement.
arrests.get('/:id/cross-links', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const links = await query<Record<string, unknown>>(
      db,
      `SELECT id, linked_type, linked_id, match_type, match_confidence, created_at
       FROM arrest_cross_links WHERE arrest_record_id = ? ORDER BY created_at DESC`,
      id,
    );
    return c.json({ data: links });
  } catch (err) {
    return c.json({ error: 'Failed to get cross-links', code: 'CROSS_LINKS_ERROR' }, 500);
  }
});

// ── PUT /:id/link-person ────────────────────────────────────
arrests.put('/:id/link-person', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const arrestId = parseInt(c.req.param('id'), 10);
    if (isNaN(arrestId)) return c.json({ error: 'Invalid arrest ID', code: 'INVALID_ID' }, 400);
    const body = await c.req.json<{ person_id?: number; match_type?: string; match_confidence?: number }>();
    if (!body.person_id) return c.json({ error: 'person_id required', code: 'PERSON_ID_REQUIRED' }, 400);

    const person = await queryFirst<{ id: number }>(db, 'SELECT id FROM persons WHERE id = ?', body.person_id);
    if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);

    // INSERT OR IGNORE — the unique constraint dedupes if the link
    // already exists (idempotent re-link).
    await execute(
      db,
      `INSERT OR IGNORE INTO arrest_cross_links (arrest_record_id, linked_type, linked_id, match_type, match_confidence)
       VALUES (?, 'person', ?, ?, ?)`,
      arrestId, body.person_id, body.match_type || 'manual', body.match_confidence ?? null,
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to link person', code: 'LINK_PERSON_ERROR' }, 500);
  }
});

// ── DELETE /:id/link-person?person_id= ──────────────────────
arrests.delete('/:id/link-person', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const arrestId = parseInt(c.req.param('id'), 10);
    const personId = parseInt(c.req.query('person_id') || '', 10);
    if (isNaN(arrestId) || isNaN(personId)) return c.json({ error: 'arrest id and person_id required', code: 'INVALID_IDS' }, 400);
    await execute(
      db,
      `DELETE FROM arrest_cross_links WHERE arrest_record_id = ? AND linked_type = 'person' AND linked_id = ?`,
      arrestId, personId,
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to unlink person', code: 'UNLINK_PERSON_ERROR' }, 500);
  }
});

// ── GET /export/csv — supervisor+ only ──────────────────────
arrests.get('/export/csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (dateFrom) { where.push('booking_date >= ?'); params.push(dateFrom); }
    if (dateTo) { where.push('booking_date <= ?'); params.push(dateTo); }

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, full_name, date_of_birth, booking_date, booking_number, agency, county, state,
              charges, status, bail_amount, entry_source, created_at
       FROM arrest_records
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(booking_date, fetched_at) DESC LIMIT 10000`,
      ...params,
    );

    const headers = [
      { key: 'id', label: 'ID' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'date_of_birth', label: 'DOB' },
      { key: 'booking_date', label: 'Booking Date' },
      { key: 'booking_number', label: 'Booking #' },
      { key: 'agency', label: 'Agency' },
      { key: 'county', label: 'County' },
      { key: 'state', label: 'State' },
      { key: 'charges', label: 'Charges' },
      { key: 'status', label: 'Status' },
      { key: 'bail_amount', label: 'Bail' },
      { key: 'entry_source', label: 'Source' },
      { key: 'created_at', label: 'Created' },
    ];
    const head = headers.map((h) => csvEscape(h.label)).join(',');
    const body = rows.map((r) => headers.map((h) => csvEscape(r[h.key])).join(',')).join('\n');
    const csv = `${head}\n${body}\n`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="arrests_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to export arrests', code: 'EXPORT_ARRESTS_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// CHECKLIST — JSON column on arrest_records.booking_checklist
// ═══════════════════════════════════════════════════════════════

arrests.get('/manual/:id/checklist', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const record = await queryFirst<{ booking_checklist: string | null }>(
      db, 'SELECT booking_checklist FROM arrest_records WHERE id = ?', id,
    );
    if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

    const checklist = parseJsonCol<Record<string, { at?: string; by?: string; notes?: string }>>(
      record.booking_checklist, {},
    );

    const items = STANDARD_CHECKLIST.map((item) => ({
      ...item,
      completed: !!checklist[item.key],
      completed_at: checklist[item.key]?.at ?? null,
      completed_by: checklist[item.key]?.by ?? null,
      notes: checklist[item.key]?.notes ?? null,
    }));

    const completedCount = items.filter((i) => i.completed).length;
    const requiredCount = STANDARD_CHECKLIST.filter((i) => i.required).length;
    const requiredCompleted = items.filter((i) => i.required && i.completed).length;

    return c.json({
      data: {
        arrest_id: id,
        items,
        total_items: STANDARD_CHECKLIST.length,
        completed_count: completedCount,
        required_count: requiredCount,
        required_completed: requiredCompleted,
        is_complete: requiredCompleted >= requiredCount,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to get checklist', code: 'CHECKLIST_GET_ERROR' }, 500);
  }
});

arrests.put('/manual/:id/checklist', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const userId = c.get('userId') as number;
    const { item_key, completed, notes } = await c.req.json<{ item_key?: string; completed?: boolean; notes?: string }>();
    if (!item_key) return c.json({ error: 'item_key required', code: 'ITEM_KEY_REQUIRED' }, 400);

    const record = await queryFirst<{ booking_checklist: string | null }>(
      db, 'SELECT booking_checklist FROM arrest_records WHERE id = ?', id,
    );
    if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

    const checklist = parseJsonCol<Record<string, unknown>>(record.booking_checklist, {});
    if (completed) {
      const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
      checklist[item_key] = {
        at: new Date().toISOString(),
        by: user?.full_name ?? '',
        by_id: userId,
        notes: notes ?? '',
      };
    } else {
      delete checklist[item_key];
    }

    await execute(
      db,
      `UPDATE arrest_records SET booking_checklist = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(checklist), id,
    );
    return c.json({ data: { arrest_id: id, item_key, completed: !!completed } });
  } catch (err) {
    return c.json({ error: 'Failed to update checklist', code: 'CHECKLIST_PUT_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PROPERTY INVENTORY — JSON column on arrest_records.property_inventory
// ═══════════════════════════════════════════════════════════════

arrests.get('/manual/:id/property', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const record = await queryFirst<{ property_inventory: string | null }>(
      db, 'SELECT property_inventory FROM arrest_records WHERE id = ?', id,
    );
    if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);
    const inventory = parseJsonCol<unknown[]>(record.property_inventory, []);
    return c.json({ data: { arrest_id: id, items: inventory, total_items: inventory.length } });
  } catch (err) {
    return c.json({ error: 'Failed to get property inventory', code: 'PROPERTY_GET_ERROR' }, 500);
  }
});

arrests.post('/manual/:id/property', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const userId = c.get('userId') as number;
    const b = await c.req.json<{
      description?: string; category?: string; quantity?: number;
      serial_number?: string; estimated_value?: number; disposition?: string; notes?: string;
    }>();
    if (!b.description) return c.json({ error: 'description required', code: 'DESCRIPTION_REQUIRED' }, 400);

    const record = await queryFirst<{ property_inventory: string | null }>(
      db, 'SELECT property_inventory FROM arrest_records WHERE id = ?', id,
    );
    if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

    const inventory = parseJsonCol<Record<string, unknown>[]>(record.property_inventory, []);
    const user = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);

    const item = {
      id: `PROP-${Date.now()}-${inventory.length + 1}`,
      description: b.description,
      category: b.category ?? 'personal_item',
      quantity: b.quantity ?? 1,
      serial_number: b.serial_number ?? null,
      estimated_value: b.estimated_value ?? null,
      disposition: b.disposition ?? 'held',
      notes: b.notes ?? '',
      logged_by: user?.full_name ?? '',
      logged_by_id: userId,
      logged_at: new Date().toISOString(),
    };
    inventory.push(item);

    await execute(
      db,
      `UPDATE arrest_records SET property_inventory = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(inventory), id,
    );
    return c.json({ data: item }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to add property item', code: 'PROPERTY_POST_ERROR' }, 500);
  }
});

arrests.delete('/manual/:id/property/:itemId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const itemId = c.req.param('itemId');

    const record = await queryFirst<{ property_inventory: string | null }>(
      db, 'SELECT property_inventory FROM arrest_records WHERE id = ?', id,
    );
    if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

    const inventory = parseJsonCol<Array<{ id: string }>>(record.property_inventory, []);
    const filtered = inventory.filter((i) => i.id !== itemId);
    if (filtered.length === inventory.length) {
      return c.json({ error: 'Item not found', code: 'ITEM_NOT_FOUND' }, 404);
    }
    await execute(
      db,
      `UPDATE arrest_records SET property_inventory = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(filtered), id,
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to remove property item', code: 'PROPERTY_DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// MIRANDA — JSON column on arrest_records.miranda_data + auto-tick
// of the booking_checklist miranda_read/acknowledged entries
// ═══════════════════════════════════════════════════════════════

arrests.get('/manual/:id/miranda', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const record = await queryFirst<{ miranda_data: string | null }>(
      db, 'SELECT miranda_data FROM arrest_records WHERE id = ?', id,
    );
    if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);
    return c.json({ data: parseJsonCol<Record<string, unknown> | null>(record.miranda_data, null) });
  } catch (err) {
    return c.json({ error: 'Failed to get miranda record', code: 'MIRANDA_GET_ERROR' }, 500);
  }
});

arrests.post('/manual/:id/miranda', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const userId = c.get('userId') as number;
    const b = await c.req.json<{
      acknowledged?: boolean; witness_officer_id?: number; method?: string; notes?: string;
    }>();

    const record = await queryFirst<{ booking_checklist: string | null }>(
      db, 'SELECT booking_checklist FROM arrest_records WHERE id = ?', id,
    );
    if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

    const reader = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', userId);
    const witness = b.witness_officer_id
      ? await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', b.witness_officer_id)
      : null;
    const now = new Date().toISOString();

    const mirandaData = {
      read_at: now,
      read_by_id: userId,
      read_by: reader?.full_name ?? '',
      method: b.method ?? 'verbal',
      acknowledged: !!b.acknowledged,
      acknowledged_at: b.acknowledged ? now : null,
      witness_officer_id: b.witness_officer_id ?? null,
      witness_officer_name: witness?.full_name ?? null,
      notes: b.notes ?? '',
    };

    // Also auto-tick the checklist items so the booking checklist
    // reflects reality without the dispatcher having to do it twice.
    const checklist = parseJsonCol<Record<string, unknown>>(record.booking_checklist, {});
    checklist.miranda_read = { at: now, by: reader?.full_name ?? '', by_id: userId };
    if (b.acknowledged) {
      checklist.miranda_acknowledged = { at: now, by: reader?.full_name ?? '', by_id: userId };
    }

    await execute(
      db,
      `UPDATE arrest_records SET miranda_data = ?, booking_checklist = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(mirandaData), JSON.stringify(checklist), id,
    );
    return c.json({ data: mirandaData }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to record miranda', code: 'MIRANDA_POST_ERROR' }, 500);
  }
});

export default arrests;
