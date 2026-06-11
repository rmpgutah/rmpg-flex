// ============================================================
// RMPG Flex — DL Records (local DL store, Cloudflare Worker)
// ============================================================
// Local driver's-license record store. Ports the data-layer subset
// of the legacy Express router (legacy/server-vps/src/routes/dlRecords.ts
// + utils/dlRecordStore.ts) onto D1.
//
// Why this exists: POST /api/dl-records was falling through the proxy
// to env.LEGACY (the deployed `rmpg-flex` worker), whose port of this
// handler 500s — the live `dl_records` table had 0 rows, i.e. manual
// saves never persisted. Tables verified present on live D1 (dl_records
// 25 cols, dl_addresses) so the failure was in the legacy worker, not
// the schema.
//
// Scope (data layer only — the external-API endpoints stay on legacy):
//   POST   /            — manual create/upsert (keyed on dl_number+dl_state)
//   GET    /            — list with search + pagination
//   GET    /:id         — single record (+ addresses)
//   PUT    /:id         — update mutable fields
//   DELETE /:id         — delete (admin only)
//
// NOT ported (still env.LEGACY via the proxy's numeric-id-only rule):
//   POST   /verify      — RapidAPI DL verification (external round-trip)
//   POST   /ocr-scan    — DL image OCR (external/AI round-trip)
//
// Timestamps are UTC (`datetime('now')`) per the UTC-storage standard —
// the legacy code used datetime('now','localtime'), which double-shifted
// on display.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const dlRecords = new Hono<Env>();

// ── Inline role gate (mirrors arrests.ts) ───────────────────
function requireRole(
  c: { get: (k: 'user') => { role: string } | undefined },
  ...roles: string[]
): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// Fields the client/legacy contract allows to be set on a record.
const RECORD_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'suffix', 'full_name',
  'date_of_birth', 'gender', 'height', 'weight', 'eye_color', 'hair_color', 'race',
  'dl_number', 'dl_state', 'dl_class', 'dl_status', 'dl_expiration',
  'dl_issue_date', 'dl_restrictions', 'dl_endorsements',
] as const;

interface DlAddress {
  address: string; address2: string; city: string;
  state: string; postal_code: string; country: string;
}

// Audit writes are best-effort: a failed activity_log insert must NEVER
// turn a successful record save into a 500 (the legacy handler's latent
// "error shown but row saved" bug). Swallow + log instead.
async function audit(
  db: ReturnType<typeof getDb>,
  userId: number | null,
  action: string,
  entityId: number | string,
  details: string,
): Promise<void> {
  try {
    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, 'dl_record', ?, ?, 'worker')`,
      userId, action, entityId, details,
    );
  } catch (err) {
    console.error('[DL Records] audit log failed (non-fatal):', err);
  }
}

// ── POST / — manual create/upsert ───────────────────────────
dlRecords.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number) ?? null;
    const b = await c.req.json<Record<string, any>>();

    if (!b.dl_number || !b.dl_state) {
      return c.json({ error: 'DL number and state are required', code: 'DL_NUMBER_AND_STATE' }, 400);
    }
    if (!b.last_name || !b.first_name) {
      return c.json({ error: 'First and last name are required', code: 'FIRST_AND_LAST_NAME' }, 400);
    }

    const fullName = `${b.first_name || ''} ${b.middle_name || ''} ${b.last_name || ''}`
      .replace(/\s+/g, ' ').trim();
    const source = typeof b.source === 'string' && b.source ? b.source : 'MANUAL_ENTRY';

    // Upsert keyed on (dl_number, dl_state) — matches the legacy
    // dlRecordStore contract (one row per physical license).
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM dl_records WHERE dl_number = ? AND dl_state = ?',
      b.dl_number, b.dl_state,
    );

    let recordId: number;
    if (existing) {
      await execute(
        db,
        `UPDATE dl_records SET
           dl_class = ?, dl_status = ?, dl_expiration = ?, dl_issue_date = ?,
           dl_restrictions = ?, dl_endorsements = ?,
           first_name = ?, middle_name = ?, last_name = ?, full_name = ?, suffix = ?,
           date_of_birth = ?, gender = ?, height = ?, weight = ?,
           eye_color = ?, hair_color = ?, race = ?,
           source = ?, updated_at = datetime('now')
         WHERE id = ?`,
        b.dl_class || '', b.dl_status || '', b.dl_expiration || '', b.dl_issue_date || '',
        b.dl_restrictions || '', b.dl_endorsements || '',
        b.first_name || '', b.middle_name || '', b.last_name || '', fullName, b.suffix || '',
        b.date_of_birth || '', b.gender || '', b.height || '', b.weight || '',
        b.eye_color || '', b.hair_color || '', b.race || '',
        source, existing.id,
      );
      recordId = existing.id;
      await execute(db, 'DELETE FROM dl_addresses WHERE dl_record_id = ?', recordId);
    } else {
      const result = await execute(
        db,
        `INSERT INTO dl_records (
           dl_number, dl_state, dl_class, dl_status, dl_expiration, dl_issue_date,
           dl_restrictions, dl_endorsements,
           first_name, middle_name, last_name, full_name, suffix,
           date_of_birth, gender, height, weight, eye_color, hair_color, race,
           source, fetched_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        b.dl_number, b.dl_state, b.dl_class || '', b.dl_status || '',
        b.dl_expiration || '', b.dl_issue_date || '',
        b.dl_restrictions || '', b.dl_endorsements || '',
        b.first_name || '', b.middle_name || '', b.last_name || '', fullName, b.suffix || '',
        b.date_of_birth || '', b.gender || '', b.height || '', b.weight || '',
        b.eye_color || '', b.hair_color || '', b.race || '',
        source,
      );
      recordId = Number(result.meta.last_row_id);
    }

    // Build address from the manual-form shape (address_state || dl_state).
    if (b.address || b.city) {
      const addr: DlAddress = {
        address: b.address || '', address2: b.address2 || '', city: b.city || '',
        state: b.address_state || b.dl_state || '', postal_code: b.postal_code || '',
        country: 'US',
      };
      await execute(
        db,
        `INSERT INTO dl_addresses (dl_record_id, address, address2, city, state, postal_code, country)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        recordId, addr.address, addr.address2, addr.city, addr.state, addr.postal_code, addr.country,
      );
    }

    await audit(
      db, userId, 'dl_record_manual_entry', recordId,
      `Manual DL entry: ${b.dl_number} (${b.dl_state}) — ${b.last_name}, ${b.first_name}`,
    );

    return c.json({ success: true, recordId, message: 'DL record saved' });
  } catch (err) {
    return c.json({
      error: 'Failed to save DL record', code: 'FAILED_TO_SAVE_DL',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── GET / — list with search + pagination ───────────────────
dlRecords.get('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const perPage = Math.min(100000, Math.max(1, parseInt(c.req.query('per_page') || '100000', 10) || 100000));
    const search = (c.req.query('search') || '').trim();

    let where = '1=1';
    const params: unknown[] = [];
    if (search) {
      where += ' AND (full_name LIKE ? OR dl_number LIKE ? OR last_name LIKE ? OR first_name LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const totalRow = await queryFirst<{ cnt: number }>(
      db, `SELECT COUNT(*) as cnt FROM dl_records WHERE ${where}`, ...params,
    );
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM dl_records WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      ...params, perPage, (page - 1) * perPage,
    );

    return c.json({ data: rows, total: totalRow?.cnt ?? 0, page, per_page: perPage });
  } catch (err) {
    return c.json({ error: 'Failed to list DL records', code: 'FAILED_TO_LIST_DL' }, 500);
  }
});

// ============================================================
// Phone → desktop scan relay
// ============================================================
// An officer scans a license with their phone; the parsed result is
// POSTed here and the logged-in desktop session (same user) picks it
// up by polling. D1 is strongly consistent, so a row written from the
// phone is visible to the very next desktop poll — unlike KV, whose
// cross-colo propagation can take up to a minute.

// ── POST /scan-relay — phone pushes a scan ──────────────────
dlRecords.post('/scan-relay', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number) ?? null;
    if (!userId) return c.json({ error: 'No user', code: 'NO_USER' }, 401);
    const b = await c.req.json<{ payload?: Record<string, unknown> }>();
    if (!b.payload || typeof b.payload !== 'object') {
      return c.json({ error: 'payload object required', code: 'NO_PAYLOAD' }, 400);
    }
    const json = JSON.stringify(b.payload);
    if (json.length > 64_000) return c.json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }, 413);

    // A new scan supersedes any unconsumed one — and stale rows age out.
    await execute(db, `DELETE FROM dl_scan_relay WHERE user_id = ? OR created_at < datetime('now', '-1 hour')`, userId);
    const result = await execute(
      db,
      `INSERT INTO dl_scan_relay (user_id, payload) VALUES (?, ?)`,
      userId, json,
    );
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    return c.json({
      error: 'Failed to relay scan', code: 'FAILED_TO_RELAY',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── GET /scan-relay/poll — desktop picks up the scan ────────
dlRecords.get('/scan-relay/poll', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number) ?? null;
    if (!userId) return c.json({ error: 'No user', code: 'NO_USER' }, 401);

    const row = await queryFirst<{ id: number; payload: string; created_at: string }>(
      db,
      `SELECT id, payload, created_at FROM dl_scan_relay
       WHERE user_id = ? AND consumed_at IS NULL AND created_at > datetime('now', '-10 minutes')
       ORDER BY id DESC LIMIT 1`,
      userId,
    );
    if (!row) return c.json({ payload: null });

    await execute(db, `UPDATE dl_scan_relay SET consumed_at = datetime('now') WHERE id = ?`, row.id);
    let payload: unknown = null;
    try { payload = JSON.parse(row.payload); } catch { /* corrupt row — treat as none */ }
    return c.json({ payload, created_at: row.created_at });
  } catch (err) {
    // Poll failures must be quiet — the client retries on its next tick.
    return c.json({ payload: null });
  }
});

// ── GET /:id — single record (+ addresses) ──────────────────
dlRecords.get('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const record = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM dl_records WHERE id = ?', id);
    if (!record) return c.json({ error: 'DL record not found', code: 'DL_NOT_FOUND' }, 404);

    const addresses = await query<DlAddress>(
      db,
      'SELECT address, address2, city, state, postal_code, country FROM dl_addresses WHERE dl_record_id = ?',
      id,
    );
    return c.json({ ...record, addresses });
  } catch (err) {
    return c.json({ error: 'Failed to get DL record', code: 'FAILED_TO_GET_DL' }, 500);
  }
});

// ── PUT /:id — update mutable fields ────────────────────────
dlRecords.put('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM dl_records WHERE id = ?', id);
    if (!existing) return c.json({ error: 'DL record not found', code: 'DL_NOT_FOUND' }, 404);

    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const key of RECORD_FIELDS) {
      if (b[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(b[key] ?? null);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'DL_NO_FIELDS' }, 400);

    sets.push(`updated_at = datetime('now')`);
    vals.push(id);
    await execute(db, `UPDATE dl_records SET ${sets.join(', ')} WHERE id = ?`, ...vals);

    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM dl_records WHERE id = ?', id);
    await audit(db, (c.get('userId') as number) ?? null, 'dl_record_update', id, `Updated DL record #${id}`);

    return c.json({ success: true, data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update DL record', code: 'FAILED_TO_UPDATE_DL' }, 500);
  }
});

// ── DELETE /:id — admin only ────────────────────────────────
dlRecords.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ dl_number: string; dl_state: string; last_name: string; first_name: string }>(
      db, 'SELECT dl_number, dl_state, last_name, first_name FROM dl_records WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'DL record not found', code: 'DL_NOT_FOUND' }, 404);

    // dl_addresses has ON DELETE CASCADE (FK), so children clean up with the parent.
    await execute(db, 'DELETE FROM dl_records WHERE id = ?', id);
    await audit(
      db, (c.get('userId') as number) ?? null, 'dl_record_delete', id,
      `Deleted DL record: ${existing.dl_number} (${existing.dl_state}) — ${existing.last_name}, ${existing.first_name}`,
    );

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete DL record', code: 'FAILED_TO_DELETE_DL' }, 500);
  }
});

export default dlRecords;
