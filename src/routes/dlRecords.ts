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
// the legacy code used datetime('now'), which double-shifted
// on display.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { runUtahSorPoll, importSorRows } from '../utils/utahSorPoller';
import { lookupCourtRecords } from '../utils/courtRecordsLookup';
import { lookupFbiWanted } from '../utils/fbiWantedLookup';

import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';
import { containsAnyClause } from '../utils/searchText';
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

// ── upsertDlRecord — shared upsert-on-(dl_number, dl_state) logic ──
// Extracted from the POST / handler so `from-dl-scan` in records.ts can
// populate dl_records from the same scan that creates the person, instead
// of the two write paths staying disconnected. Behavior-preserving: same
// validation messages, same upsert semantics, same dl_addresses handling.
// Distinguishes the two intentional input-validation checks in
// upsertDlRecord from genuine runtime failures (bad column, constraint
// violation, bind error). Callers should only convert THIS error type
// into a 400 — anything else must propagate to the normal 500 path.
export class DlRecordValidationError extends Error {}

export async function upsertDlRecord(
  db: ReturnType<typeof getDb>, body: Record<string, any>,
): Promise<{ recordId: number; created: boolean }> {
  if (!body.dl_number || !body.dl_state) {
    throw new DlRecordValidationError('DL number and state are required');
  }
  if (!body.last_name || !body.first_name) {
    throw new DlRecordValidationError('First and last name are required');
  }

  const fullName = `${body.first_name || ''} ${body.middle_name || ''} ${body.last_name || ''}`
    .replace(/\s+/g, ' ').trim();
  const source = typeof body.source === 'string' && body.source ? body.source : 'MANUAL_ENTRY';
  // Scanner payloads use `dl_expiry`; the manual form uses `dl_expiration`.
  // Accept either so a scanned license's expiry is never silently dropped.
  const dlExpiration = body.dl_expiration || body.dl_expiry || '';
  // Preserve the complete scanned payload — including fields with no
  // dedicated column (REAL ID, organ donor, veteran, country, document
  // discriminator) — so nothing from the scan is lost on persist.
  const rawRecord = typeof body.raw_record === 'string'
    ? body.raw_record.slice(0, 32_000)
    : JSON.stringify(body).slice(0, 32_000);

  // Upsert keyed on (dl_number, dl_state) — matches the legacy
  // dlRecordStore contract (one row per physical license).
  const existing = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM dl_records WHERE dl_number = ? AND dl_state = ?',
    body.dl_number, body.dl_state,
  );

  let recordId: number;
  let created = false;
  if (existing) {
    await execute(
      db,
      `UPDATE dl_records SET
         dl_class = ?, dl_status = ?, dl_expiration = ?, dl_issue_date = ?,
         dl_restrictions = ?, dl_endorsements = ?,
         first_name = ?, middle_name = ?, last_name = ?, full_name = ?, suffix = ?,
         date_of_birth = ?, gender = ?, height = ?, weight = ?,
         eye_color = ?, hair_color = ?, race = ?,
         source = ?, raw_record = ?, updated_at = datetime('now')
       WHERE id = ?`,
      body.dl_class || '', body.dl_status || '', dlExpiration, body.dl_issue_date || '',
      body.dl_restrictions || '', body.dl_endorsements || '',
      body.first_name || '', body.middle_name || '', body.last_name || '', fullName, body.suffix || '',
      body.date_of_birth || '', body.gender || '', body.height || '', body.weight || '',
      body.eye_color || '', body.hair_color || '', body.race || '',
      source, rawRecord, existing.id,
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
         source, raw_record, fetched_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      body.dl_number, body.dl_state, body.dl_class || '', body.dl_status || '',
      dlExpiration, body.dl_issue_date || '',
      body.dl_restrictions || '', body.dl_endorsements || '',
      body.first_name || '', body.middle_name || '', body.last_name || '', fullName, body.suffix || '',
      body.date_of_birth || '', body.gender || '', body.height || '', body.weight || '',
      body.eye_color || '', body.hair_color || '', body.race || '',
      source, rawRecord,
    );
    recordId = Number(result.meta.last_row_id);
    created = true;
  }

  // Build address from the manual-form shape (address_state || dl_state).
  if (body.address || body.city) {
    const addr: DlAddress = {
      address: body.address || '', address2: body.address2 || '', city: body.city || '',
      state: body.address_state || body.dl_state || '', postal_code: body.postal_code || '',
      country: 'US',
    };
    await execute(
      db,
      `INSERT INTO dl_addresses (dl_record_id, address, address2, city, state, postal_code, country)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      recordId, addr.address, addr.address2, addr.city, addr.state, addr.postal_code, addr.country,
    );
  }

  return { recordId, created };
}

// ── POST / — manual create/upsert ───────────────────────────
dlRecords.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const b = await c.req.json<Record<string, any>>();

    let recordId: number;
    let created: boolean;
    try {
      ({ recordId, created } = await upsertDlRecord(db, b));
    } catch (validationErr: any) {
      if (!(validationErr instanceof DlRecordValidationError)) throw validationErr;
      const code = validationErr.message.includes('name') ? 'FIRST_AND_LAST_NAME' : 'DL_NUMBER_AND_STATE';
      return c.json({ error: validationErr.message, code }, 400);
    }
    void created;

    await audit(
      db, userId, 'dl_record_manual_entry', recordId,
      `Manual DL entry: ${b.dl_number} (${b.dl_state}) — ${b.last_name}, ${b.first_name}`,
    );

    return c.json({ success: true, recordId, message: 'DL record saved' });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to save DL record', 'FAILED_TO_SAVE_DL');
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
      const m = containsAnyClause(['full_name', 'dl_number', 'last_name', 'first_name']);
      where += ` AND ${m.sql}`; params.push(...m.binds(search));
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
    log.error('GET / failed', { src: 'src/routes/dlRecords.ts' }, err);
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
    const userId = (c.get('userId') as number | undefined) ?? null;
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
    return dbErrorResponse(c, err, 'Failed to relay scan', 'FAILED_TO_RELAY');
  }
});

// ── GET /scan-relay/poll — desktop picks up the scan ────────
dlRecords.get('/scan-relay/poll', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
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

// ============================================================
// POST /scan-log — link + log every scan into the system
// ============================================================
// Officer-safety requirement: every ID scan and what it found is a
// system record. Writes dl_scan_log, upserts the dl_records store
// (source DL_SCAN → license history), and adds an activity_log entry.
dlRecords.post('/scan-log', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const b = await c.req.json<Record<string, any>>();
    const findings = JSON.stringify(b.findings ?? {}).slice(0, 32_000);

    const result = await execute(db, `
      INSERT INTO dl_scan_log (user_id, scan_method, dl_number, dl_state, subject_name, dob, person_id, findings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      userId, b.scan_method || 'PDF417', b.dl_number || '', b.dl_state || '',
      b.subject_name || '', b.dob || '', b.person_id ?? null, findings,
    );

    // License history link — every scanned license lands in dl_records.
    if (b.dl_number && b.dl_state && b.last_name) {
      try {
        const existing = await queryFirst<{ id: number }>(
          db, 'SELECT id FROM dl_records WHERE dl_number = ? AND dl_state = ?', b.dl_number, b.dl_state);
        if (!existing) {
          // Capture the full scanned record — every field the client sends,
          // including restrictions/endorsements/suffix and the complete
          // raw_record payload — so the system-of-record link isn't a stub.
          const rawRecord = typeof b.raw_record === 'string'
            ? b.raw_record.slice(0, 32_000)
            : JSON.stringify(b).slice(0, 32_000);
          await execute(db, `
            INSERT INTO dl_records (dl_number, dl_state, dl_class, dl_expiration, dl_issue_date,
              dl_restrictions, dl_endorsements, suffix,
              first_name, middle_name, last_name, full_name, date_of_birth, gender,
              height, weight, eye_color, hair_color, raw_record, source, fetched_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DL_SCAN', datetime('now'), datetime('now'))`,
            b.dl_number, b.dl_state, b.dl_class || '', b.dl_expiry || '', b.dl_issue_date || '',
            b.dl_restrictions || '', b.dl_endorsements || '', b.suffix || '',
            b.first_name || '', b.middle_name || '', b.last_name || '',
            `${b.first_name || ''} ${b.last_name || ''}`.trim(), b.dob || '', b.gender || '',
            b.height || '', b.weight || '', b.eye_color || '', b.hair_color || '', rawRecord);
        }
      } catch { /* link is best-effort; the log row is the record */ }
    }

    await audit(db, userId, 'dl_scan', Number(result.meta.last_row_id),
      `ID scan: ${b.subject_name || 'unknown'} ${b.dl_number ? `· ${b.dl_number} (${b.dl_state})` : ''} · ${b.scan_method || 'PDF417'}${b.person_id ? ` · linked person #${b.person_id}` : ''}`);

    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    log.error('POST /scan-log failed', { src: 'src/routes/dlRecords.ts' }, err);
    return c.json({ success: false, error: 'Failed to log scan' }, 500);
  }
});

// ── GET /scan-log — review scan history (audit / officer safety) ────
dlRecords.get('/scan-log', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
    const search = (c.req.query('search') || '').trim();
    // mine=1 scopes to the current user's own scans.
    const mine = c.req.query('mine') === '1';
    const userId = (c.get('userId') as number | undefined) ?? null;

    let where = '1=1';
    const params: unknown[] = [];
    if (mine && userId) { where += ' AND l.user_id = ?'; params.push(userId); }
    if (search) {
      const m = containsAnyClause(['l.subject_name', 'l.dl_number']);
      where += ` AND ${m.sql}`; params.push(...m.binds(search));
    }

    // Display name from the live users schema (full_name/username — there is
    // no `name` column). Fall back to a stable "Officer <id>" label.
    const rows = await query<Record<string, unknown>>(db, `
      SELECT l.id, l.scanned_at, l.scan_method, l.dl_number, l.dl_state, l.subject_name,
             l.dob, l.person_id, l.findings,
             COALESCE(NULLIF(u.full_name, ''), NULLIF(u.username, ''), 'Officer ' || l.user_id) AS officer
      FROM dl_scan_log l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE ${where}
      ORDER BY l.id DESC LIMIT ?`, ...params, limit);

    // Parse findings JSON so the client doesn't double-decode.
    for (const r of rows) {
      if (typeof r.findings === 'string') {
        try { r.findings = JSON.parse(r.findings as string); } catch { r.findings = null; }
      }
    }
    return c.json({ data: rows, count: rows.length });
  } catch (err) {
    log.error('GET /scan-log failed', { src: 'src/routes/dlRecords.ts' }, err);
    return c.json({ data: [], count: 0, error: 'Failed to list scans' }, 500);
  }
});

// ============================================================
// Data-source configuration (admin) — feed URLs / API keys
// ============================================================
// Lets an admin wire the external data sources (Utah SOR feed,
// CourtListener token) without touching the DB. Secrets are masked on
// read. system_config has no UNIQUE(config_key) on live, so writes are
// update-then-insert (mirrors admin.ts).
const SOURCE_CONFIG_KEYS = ['sor_feed_url', 'sor_feed_key', 'courtlistener_token'] as const;

async function readConfigValue(db: ReturnType<typeof getDb>, key: string): Promise<string> {
  const r = await queryFirst<{ config_value: string }>(
    db, `SELECT config_value FROM system_config WHERE config_key = ? ORDER BY id DESC LIMIT 1`, key);
  return (r?.config_value || '').trim();
}

async function writeConfigValue(db: ReturnType<typeof getDb>, key: string, value: string): Promise<void> {
  const r = await execute(db,
    `UPDATE system_config SET config_value = ?, updated_at = datetime('now') WHERE config_key = ?`, value, key);
  if (!r.meta.changes) {
    await execute(db,
      `INSERT INTO system_config (config_key, config_value, category) VALUES (?, ?, 'integrations')`, key, value);
  }
}

function maskSecret(v: string): string {
  if (!v) return '';
  return v.length <= 6 ? '••••' : `${v.slice(0, 3)}••••${v.slice(-2)}`;
}

dlRecords.get('/sources-config', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const url = await readConfigValue(db, 'sor_feed_url');
    const key = await readConfigValue(db, 'sor_feed_key');
    const clToken = await readConfigValue(db, 'courtlistener_token');
    const sorCount = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) n FROM utah_sex_offenders').catch(() => null);
    const lastRun = await queryFirst<Record<string, any>>(
      db, 'SELECT ran_at, status, records_seen, records_upserted FROM utah_sor_runs ORDER BY id DESC LIMIT 1').catch(() => null);
    const courtCache = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) n FROM court_records_cache').catch(() => null);
    return c.json({
      sor_feed_url: url,                       // URL is not a secret — show in full
      sor_feed_key_set: !!key, sor_feed_key_mask: maskSecret(key),
      courtlistener_token_set: !!clToken, courtlistener_token_mask: maskSecret(clToken),
      sor_records: sorCount?.n ?? 0,
      sor_last_run: lastRun ?? null,
      court_cache: courtCache?.n ?? 0,
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to read config');
  }
});

dlRecords.put('/sources-config', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, any>>();
    // Only write keys that are present. An empty string explicitly clears a
    // value; `undefined` (key absent) leaves it untouched.
    const written: string[] = [];
    for (const k of SOURCE_CONFIG_KEYS) {
      if (b[k] === undefined) continue;
      const v = String(b[k] ?? '').trim();
      if (k === 'sor_feed_url' && v && !/^https:\/\//i.test(v)) {
        return c.json({ error: 'SOR feed URL must be HTTPS', code: 'BAD_URL' }, 400);
      }
      await writeConfigValue(db, k, v);
      written.push(k);
    }
    await audit(db, (c.get('userId') as number | undefined) ?? null, 'sources_config_update', 0,
      `Updated data-source config: ${written.join(', ') || 'none'}`);
    return c.json({ success: true, updated: written });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to save config');
  }
});

// ============================================================
// Utah Sex Offender Registry — status, import, manual poll
// ============================================================
// GET  /sor/status  — feed configured? row count + last run
// POST /sor/import  — bulk-load offender rows the agency lawfully holds
// POST /sor/poll    — trigger the configured feed pull on demand
dlRecords.get('/sor/status', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const count = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) n FROM utah_sex_offenders');
    const cfg = await queryFirst<{ config_value: string }>(
      db, `SELECT config_value FROM system_config WHERE config_key = 'sor_feed_url' ORDER BY id DESC LIMIT 1`);
    const lastRun = await queryFirst<Record<string, any>>(
      db, 'SELECT ran_at, status, records_seen, records_upserted, detail FROM utah_sor_runs ORDER BY id DESC LIMIT 1');
    return c.json({
      records: count?.n ?? 0,
      feed_configured: !!(cfg?.config_value && /^https:\/\//i.test(cfg.config_value)),
      last_run: lastRun ?? null,
    });
  } catch (err) { log.error('GET failed', { src: 'src/routes/dlRecords.ts' }, err); return c.json({ records: 0, feed_configured: false, last_run: null }); }
});

dlRecords.post('/sor/import', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<{ rows?: Record<string, any>[] }>();
    if (!Array.isArray(b.rows) || b.rows.length === 0) {
      return c.json({ error: 'rows[] required', code: 'NO_ROWS' }, 400);
    }
    const r = await importSorRows(db, b.rows);
    await audit(db, (c.get('userId') as number | undefined) ?? null, 'sor_import', r.imported,
      `Imported ${r.imported} Utah SOR record(s)`);
    return c.json({ success: true, imported: r.imported });
  } catch (err) {
    return dbErrorResponse(c, err, 'Import failed');
  }
});

dlRecords.post('/sor/poll', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const r = await runUtahSorPoll(getDb(c.env));
    return c.json(r);
  } catch (err) {
    log.error('POST /sor/poll failed', { src: 'src/routes/dlRecords.ts' }, err);
    return c.json({ configured: false, seen: 0, upserted: 0, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ============================================================
// GET /court-lookup — open-source federal court records (CourtListener)
// ============================================================
// Separate from the deep sweep because it makes an external API call;
// the client fires it in parallel so D1 sweep latency is unaffected.
dlRecords.get('/court-lookup', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const r = await lookupCourtRecords(getDb(c.env), c.req.query('last') || '', c.req.query('first') || '');
    return c.json(r);
  } catch (err) { log.error('GET failed', { src: 'src/routes/dlRecords.ts' }, err); return c.json({ source: 'COURTLISTENER', records: [], cached: false }); }
});

// GET /fbi-lookup — FBI Wanted bulletins by name (official public API).
dlRecords.get('/fbi-lookup', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const r = await lookupFbiWanted(getDb(c.env), c.req.query('last') || '', c.req.query('first') || '');
    return c.json(r);
  } catch (err) { log.error('GET failed', { src: 'src/routes/dlRecords.ts' }, err); return c.json({ source: 'FBI_WANTED', records: [], cached: false }); }
});

// ============================================================
// Deep records sweep — hard-to-find LE sources by name
// ============================================================
// When a scanned name pings, sweep the LE tables that the basic
// person match never touches: statewide scraped warrants, arrest/
// booking records, citations, field interviews, gang intel, trespass
// orders, BOLOs, civil process. Every sub-query is soft-guarded —
// a drifted table returns [] rather than failing the sweep.
// Column names verified against live D1 2026-06-11.
dlRecords.get('/deep-sweep', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const last = (c.req.query('last') || '').trim();
    const first = (c.req.query('first') || '').trim();
    const dob = (c.req.query('dob') || '').trim(); // YYYY-MM-DD, refinement only
    if (last.length < 2) return c.json({ error: 'last name (min 2 chars) required', code: 'LAST_REQUIRED' }, 400);

    const lastLike = `${last.slice(0, 49)}%`;
    const firstLike = first ? `${first.slice(0, 49)}%` : '%';
    const bothLike = `%${last.slice(0, 48)}%`;
    const firstAny = first ? `%${first.slice(0, 48)}%` : '%';

    const soft = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
      try { return await fn(); } catch { return []; }
    };

    // MVR keys: exact-ish DL number (normalised) when supplied by the scan.
    const dlNum = (c.req.query('dl') || '').trim().replace(/\W/g, '');
    const dlLike = dlNum ? `%${dlNum.slice(0, 48)}%` : null;

    const [utahWarrants, arrests, cites, fis, gang, trespass, serves, boloRows,
           sexOffenders, watchlist, aliasHits, caseHits, mvrCitations, dlHistory, utahSor] = await Promise.all([
      // Statewide scraped Utah warrants — NOT in the local warrants table.
      soft(() => query<Record<string, any>>(db, `
        SELECT id, first_name, middle_name, last_name, age, city, charges, court_name,
               issue_date, is_active, last_seen_at
        FROM utah_warrants
        WHERE last_name LIKE ? AND first_name LIKE ?
        ORDER BY is_active DESC, issue_date DESC LIMIT 10`, lastLike, firstLike)),
      soft(() => query<Record<string, any>>(db, `
        SELECT id, full_name, first_name, last_name, date_of_birth, booking_date,
               charges, county, agency, status, release_date, bail_amount, mugshot_url
        FROM arrest_records
        WHERE (last_name LIKE ? AND first_name LIKE ?) OR full_name LIKE (? || '%' )
        ORDER BY booking_date DESC LIMIT 10`, lastLike, firstLike, last)),
      soft(() => query<Record<string, any>>(db, `
        SELECT id, citation_number, citation_date, violation_description, violation,
               fine_amount, status, disposition, person_name, violator_name, person_dob
        FROM citations
        WHERE (violator_name LIKE ? AND violator_name LIKE ?)
           OR (person_name LIKE ? AND person_name LIKE ?)
        ORDER BY citation_date DESC LIMIT 10`, bothLike, firstAny, bothLike, firstAny)),
      soft(() => query<Record<string, any>>(db, `
        SELECT id, fi_number, interview_date, date, location, contact_reason,
               subject_first_name, subject_last_name, subject_dob, gang_affiliation, disposition
        FROM field_interviews
        WHERE subject_last_name LIKE ? AND subject_first_name LIKE ?
        ORDER BY COALESCE(interview_date, date) DESC LIMIT 10`, lastLike, firstLike)),
      soft(() => query<Record<string, any>>(db, `
        SELECT id, name, moniker, gang_name, status, threat_level
        FROM gang_intel_members
        WHERE name LIKE ? AND name LIKE ?
        ORDER BY threat_level DESC LIMIT 10`, bothLike, firstAny)),
      soft(() => query<Record<string, any>>(db, `
        SELECT id, order_number, status, subject_name, subject_first_name, subject_last_name,
               subject_dob, property_name, property_address, order_type, expiration_date
        FROM trespass_orders
        WHERE (subject_last_name LIKE ? AND subject_first_name LIKE ?)
           OR (subject_name LIKE ? AND subject_name LIKE ?)
        ORDER BY created_at DESC LIMIT 10`, lastLike, firstLike, bothLike, firstAny)),
      soft(() => query<Record<string, any>>(db, `
        SELECT id, case_number, status, document_type, court_name, deadline,
               COALESCE(recipient_name, defendant_name) AS subject_name
        FROM serve_queue
        WHERE (recipient_name LIKE ? AND recipient_name LIKE ?)
           OR (defendant_name LIKE ? AND defendant_name LIKE ?)
        ORDER BY created_at DESC LIMIT 10`, bothLike, firstAny, bothLike, firstAny)),
      soft(() => query<Record<string, any>>(db, `
        SELECT id, bolo_number, type, title, description, subject_description, status, priority, created_at
        FROM bolos
        WHERE status = 'active'
          AND (title LIKE ? OR description LIKE ? OR subject_description LIKE ?)
        ORDER BY created_at DESC LIMIT 10`, bothLike, bothLike, bothLike)),
      // Sex Offender Registry — flagged persons + SOR numbers.
      soft(() => query<Record<string, any>>(db, `
        SELECT id, first_name, last_name, dob, sor_number, address, city, state,
               gang_affiliation, caution_flags
        FROM persons
        WHERE (is_sex_offender = 1 OR (sor_number IS NOT NULL AND sor_number != ''))
          AND last_name LIKE ? AND first_name LIKE ?
        ORDER BY last_name LIMIT 10`, lastLike, firstLike)),
      // Watchlist / caution / probation-parole flagged persons.
      soft(() => query<Record<string, any>>(db, `
        SELECT id, first_name, last_name, dob, watchlist_match, caution_flags,
               gang_affiliation, probation_parole, probation_parole_officer,
               mental_health_flags, substance_abuse
        FROM persons
        WHERE last_name LIKE ? AND first_name LIKE ?
          AND (watchlist_match IS NOT NULL AND watchlist_match != '' AND watchlist_match != '0'
               OR (caution_flags IS NOT NULL AND caution_flags != '' AND caution_flags != '[]')
               OR (probation_parole IS NOT NULL AND probation_parole != '' AND probation_parole NOT IN ('None','N/A','No','0')))
        ORDER BY last_name LIMIT 10`, lastLike, firstLike)),
      // Alias hits — the scanned name appearing as someone ELSE's alias.
      soft(() => query<Record<string, any>>(db, `
        SELECT id, first_name, last_name, dob, aliases, alias_nickname
        FROM persons
        WHERE (aliases LIKE ? OR alias_nickname LIKE ?)
          AND NOT (last_name LIKE ? AND first_name LIKE ?)
        ORDER BY last_name LIMIT 10`, bothLike, bothLike, lastLike, firstLike)),
      // Case involvement — case_persons carries free-text person_name.
      soft(() => query<Record<string, any>>(db, `
        SELECT cp.id, cp.person_name, cp.role, c.id AS case_id, c.case_number,
               c.title, c.status, c.created_at
        FROM case_persons cp
        LEFT JOIN cases c ON c.id = cp.case_id
        WHERE cp.person_name LIKE ? AND cp.person_name LIKE ?
        ORDER BY cp.created_at DESC LIMIT 10`, bothLike, firstAny)),
      // MVR: driving record keyed on the scanned DL number — citations
      // store person_dl free-text, so these never surface via person links.
      dlLike
        ? soft(() => query<Record<string, any>>(db, `
            SELECT id, citation_number, citation_date, violation_description, violation,
                   status, disposition, fine_amount, is_warning, speed_clocked, speed_limit,
                   dui_related, accident_related, bac_level, vehicle_plate, vehicle_state
            FROM citations
            WHERE REPLACE(REPLACE(COALESCE(person_dl, ''), '-', ''), ' ', '') LIKE ?
            ORDER BY citation_date DESC LIMIT 15`, dlLike))
        : Promise.resolve([] as Record<string, any>[]),
      // DL record history — prior fetches/verifications of this license.
      dlLike
        ? soft(() => query<Record<string, any>>(db, `
            SELECT id, dl_number, dl_state, dl_status, dl_class, dl_expiration,
                   source, fetched_at, updated_at
            FROM dl_records
            WHERE REPLACE(REPLACE(dl_number, '-', ''), ' ', '') LIKE ?
            ORDER BY updated_at DESC LIMIT 10`, dlLike))
        : Promise.resolve([] as Record<string, any>[]),
      // Utah Sex Offender Registry — the agency-fed local store.
      soft(() => query<Record<string, any>>(db, `
        SELECT id, registry_id, first_name, last_name, date_of_birth, address, city, zip,
               offense, risk_level, registration_status, compliance_status, photo_url, aliases
        FROM utah_sex_offenders
        WHERE last_name LIKE ? AND first_name LIKE ?
        ORDER BY last_name LIMIT 10`, lastLike, firstLike)),
    ]);

    // ── Full subject profile when a person record is already matched ──
    // The scan flow passes the best person match's id; pull everything
    // safety-relevant in one shot: flags off the person row, criminal
    // history, registry alerts, linked vehicles, FIs and citations.
    const personId = parseInt(c.req.query('person_id') || '', 10);
    let profile: Record<string, unknown> | null = null;
    if (Number.isFinite(personId) && personId > 0) {
      const [person, crimHistory, regAlerts, vehicles, personFis, personCites, personTrespass, incidents, calls] = await Promise.all([
        (async () => { try {
          return await queryFirst<Record<string, any>>(db, `
            SELECT id, first_name, last_name, dob, is_sex_offender, sor_number,
                   gang_affiliation, caution_flags, flags, watchlist_match, watchlist_checked_at,
                   probation_parole, probation_parole_officer, known_associates,
                   mental_health_flags, substance_abuse, ncic_number, fbi_number,
                   state_id_number, aliases, alias_nickname, scars_marks_tattoos,
                   tattoo_description, distinguishing_features, date_last_seen, location_last_seen,
                   fi_count, last_fi_date, photo_url, photo, id_image_url
            FROM persons WHERE id = ?`, personId);
        } catch { return null; } })(),
        soft(() => query<Record<string, any>>(db, `
          SELECT record_type, offense, offense_level, statute, case_number, agency,
                 jurisdiction, offense_date, disposition, sentence
          FROM criminal_history WHERE person_id = ? ORDER BY offense_date DESC LIMIT 25`, personId)),
        soft(() => query<Record<string, any>>(db, `
          SELECT alert_type, status, severity, description, alert_address,
                 last_compliance_check, last_compliance_result, expiration_date
          FROM offender_alerts WHERE person_id = ? ORDER BY created_at DESC LIMIT 10`, personId)),
        soft(() => query<Record<string, any>>(db, `
          SELECT id, plate_number, state, make, model, color, year, is_stolen,
                 stolen_status AS status
          FROM vehicles_records WHERE owner_person_id = ? LIMIT 10`, personId)),
        soft(() => query<Record<string, any>>(db, `
          SELECT id, fi_number, interview_date, date, location, contact_reason, gang_affiliation
          FROM field_interviews WHERE person_id = ? ORDER BY COALESCE(interview_date, date) DESC LIMIT 10`, personId)),
        soft(() => query<Record<string, any>>(db, `
          SELECT id, citation_number, citation_date, violation_description, violation, status
          FROM citations WHERE person_id = ? ORDER BY citation_date DESC LIMIT 10`, personId)),
        soft(() => query<Record<string, any>>(db, `
          SELECT id, order_number, status, property_name, property_address, expiration_date
          FROM trespass_orders WHERE person_id = ? ORDER BY created_at DESC LIMIT 10`, personId)),
        // Incident reports the subject is a party to.
        soft(() => query<Record<string, any>>(db, `
          SELECT i.id, i.incident_number, i.incident_type, i.status, i.occurred_date,
                 i.location_address, i.disposition, ip.role,
                 i.weapons_involved, i.domestic_violence, i.gang_related, i.dui_related
          FROM incident_persons ip JOIN incidents i ON i.id = ip.incident_id
          WHERE ip.person_id = ? ORDER BY i.occurred_date DESC LIMIT 15`, personId)),
        // CAD calls the subject is attached to.
        soft(() => query<Record<string, any>>(db, `
          SELECT c2.id, c2.call_number, c2.incident_type AS call_type, c2.status, c2.created_at,
                 c2.location_address, cp.role, cp.person_type
          FROM call_persons cp JOIN calls_for_service c2 ON c2.id = cp.call_id
          WHERE cp.person_id = ? ORDER BY c2.created_at DESC LIMIT 15`, personId)),
      ]);
      if (person) {
        profile = {
          person, criminal_history: crimHistory, registry_alerts: regAlerts,
          vehicles, field_interviews: personFis, citations: personCites, trespass_orders: personTrespass,
          incidents, calls,
        };
      }
    }

    // DOB refinement: when a row carries a DOB and the scan supplied one,
    // a mismatch demotes (kept, flagged) rather than drops — names recur,
    // but officers should see near-misses with the discrepancy visible.
    const dobFlag = (rowDob: unknown) => {
      if (!dob || !rowDob) return null;
      return String(rowDob).slice(0, 10) === dob;
    };

    const sources = [
      {
        key: 'utah_warrants', label: 'Utah Statewide Warrants', danger: utahWarrants.some(w => w.is_active),
        rows: utahWarrants.map(w => ({
          id: w.id, dob_match: null,
          danger: !!w.is_active,
          summary: `${w.last_name}, ${w.first_name}${w.middle_name ? ' ' + w.middle_name : ''}${w.age ? ` (${w.age})` : ''} — ${w.is_active ? 'ACTIVE' : 'cleared'} · ${w.charges || 'charges n/a'} · ${w.court_name || ''} ${w.issue_date || ''}`.trim(),
        })),
      },
      {
        key: 'arrests', label: 'Arrest / Booking Records', danger: false,
        rows: arrests.map(a => ({
          id: a.id, dob_match: dobFlag(a.date_of_birth), danger: false,
          image: a.mugshot_url || null,
          summary: `${a.full_name || `${a.last_name}, ${a.first_name}`} — booked ${a.booking_date || 'n/a'} · ${a.charges || 'charges n/a'} · ${a.county || a.agency || ''}${a.status ? ` · ${a.status}` : ''}`,
        })),
      },
      {
        key: 'citations', label: 'Citations', danger: false,
        rows: cites.map(ct => ({
          id: ct.id, dob_match: dobFlag(ct.person_dob), danger: false,
          summary: `#${ct.citation_number || ct.id} ${ct.citation_date || ''} — ${ct.violation_description || ct.violation || 'violation n/a'} · ${ct.status || ''}${ct.fine_amount ? ` · $${ct.fine_amount}` : ''}`,
        })),
      },
      {
        key: 'field_interviews', label: 'Field Interviews', danger: false,
        rows: fis.map(f => ({
          id: f.id, dob_match: dobFlag(f.subject_dob), danger: !!f.gang_affiliation,
          summary: `${f.fi_number || `FI-${f.id}`} ${f.interview_date || f.date || ''} — ${f.contact_reason || 'contact'} @ ${f.location || 'n/a'}${f.gang_affiliation ? ` · GANG: ${f.gang_affiliation}` : ''}`,
        })),
      },
      {
        key: 'gang_intel', label: 'Gang Intelligence', danger: gang.length > 0,
        rows: gang.map(g => ({
          id: g.id, dob_match: null, danger: true,
          summary: `${g.name}${g.moniker ? ` "${g.moniker}"` : ''} — ${g.gang_name || 'gang n/a'} · threat: ${g.threat_level || 'n/a'} · ${g.status || ''}`,
        })),
      },
      {
        key: 'trespass', label: 'Trespass Orders', danger: false,
        rows: trespass.map(t => ({
          id: t.id, dob_match: dobFlag(t.subject_dob),
          danger: t.status === 'active',
          summary: `${t.order_number || `TO-${t.id}`} ${t.status || ''} — ${t.property_name || t.property_address || 'property n/a'}${t.expiration_date ? ` · expires ${t.expiration_date}` : ''}`,
        })),
      },
      {
        key: 'civil_process', label: 'Civil Process (Serve Queue)', danger: false,
        rows: serves.map(s => ({
          id: s.id, dob_match: null, danger: false,
          summary: `${s.subject_name || ''} — ${s.document_type || 'document'} · ${s.status || ''} · ${s.court_name || ''}${s.deadline ? ` · due ${s.deadline}` : ''}`,
        })),
      },
      {
        key: 'bolos', label: 'Active BOLOs (text match)', danger: boloRows.length > 0,
        rows: boloRows.map(b => ({
          id: b.id, dob_match: null, danger: true,
          summary: `${b.bolo_number || `BOLO-${b.id}`} [${b.priority || 'n/a'}] ${b.title || ''} — ${(b.subject_description || b.description || '').slice(0, 120)}`,
        })),
      },
      {
        key: 'sex_offenders', label: 'Sex Offender Registry (flagged persons)', danger: sexOffenders.length > 0,
        rows: sexOffenders.map(p => ({
          id: p.id, dob_match: dobFlag(p.dob), danger: true,
          summary: `${p.last_name}, ${p.first_name}${p.dob ? ` DOB ${String(p.dob).slice(0, 10)}` : ''} — REGISTERED SEX OFFENDER${p.sor_number ? ` · SOR# ${p.sor_number}` : ''}${p.address ? ` · ${p.address}, ${p.city || ''}` : ''}`,
        })),
      },
      {
        key: 'utah_sor', label: 'Utah Sex Offender Registry', danger: utahSor.length > 0,
        rows: utahSor.map(o => ({
          id: o.id, dob_match: dobFlag(o.date_of_birth), danger: true,
          image: o.photo_url || null,
          summary: `${o.last_name}, ${o.first_name}${o.date_of_birth ? ` DOB ${String(o.date_of_birth).slice(0, 10)}` : ''} — UTAH SOR${o.risk_level ? ` · ${o.risk_level} RISK` : ''}${o.registration_status ? ` · ${o.registration_status}` : ''}${o.compliance_status ? ` · ${o.compliance_status}` : ''} · ${o.offense || 'offense n/a'}${o.address ? ` · ${o.address}, ${o.city || ''} ${o.zip || ''}` : ''}`,
        })),
      },
      {
        key: 'watchlist', label: 'Watchlist / Caution / Supervision', danger: watchlist.length > 0,
        rows: watchlist.map(p => {
          const bits: string[] = [];
          if (p.watchlist_match && p.watchlist_match !== '0') bits.push(`WATCHLIST: ${p.watchlist_match}`);
          if (p.caution_flags && p.caution_flags !== '[]') bits.push(`CAUTION: ${String(p.caution_flags).replace(/[[\]"]/g, '')}`);
          if (p.probation_parole && !/^(none|n\/a|no|0)$/i.test(p.probation_parole)) bits.push(`SUPERVISION: ${p.probation_parole}${p.probation_parole_officer ? ` (PO: ${p.probation_parole_officer})` : ''}`);
          return {
            id: p.id, dob_match: dobFlag(p.dob), danger: true,
            summary: `${p.last_name}, ${p.first_name}${p.dob ? ` DOB ${String(p.dob).slice(0, 10)}` : ''} — ${bits.join(' · ') || 'flagged'}`,
          };
        }),
      },
      {
        key: 'alias_hits', label: 'Known Alias Of (different identity)', danger: aliasHits.length > 0,
        rows: aliasHits.map(p => ({
          id: p.id, dob_match: null, danger: true,
          summary: `Scanned name matches a known alias of ${p.last_name}, ${p.first_name}${p.dob ? ` DOB ${String(p.dob).slice(0, 10)}` : ''} (#${p.id}) — aliases: ${p.aliases || p.alias_nickname}`,
        })),
      },
      {
        key: 'cases', label: 'Case Involvement', danger: false,
        rows: caseHits.map(ch => ({
          id: ch.case_id || ch.id, dob_match: null, danger: false,
          summary: `${ch.case_number || `CASE-${ch.case_id}`} (${ch.status || 'n/a'}) — ${ch.title || ''} · role: ${ch.role || 'involved'} · as "${ch.person_name}"`,
        })),
      },
      {
        key: 'mvr', label: 'Driving Record / MVR (by DL number)',
        danger: mvrCitations.some(m => m.dui_related || m.accident_related),
        rows: mvrCitations.map(m => {
          const bits: string[] = [];
          if (m.dui_related) bits.push(`DUI${m.bac_level ? ` BAC ${m.bac_level}` : ''}`);
          if (m.accident_related) bits.push('ACCIDENT');
          if (m.speed_clocked) bits.push(`${m.speed_clocked}/${m.speed_limit || '?'} mph`);
          if (m.is_warning) bits.push('warning only');
          return {
            id: m.id, dob_match: null,
            danger: !!(m.dui_related || m.accident_related),
            summary: `#${m.citation_number || m.id} ${m.citation_date || ''} — ${m.violation_description || m.violation || 'violation n/a'}${bits.length ? ` · ${bits.join(' · ')}` : ''}${m.vehicle_plate ? ` · ${m.vehicle_plate} ${m.vehicle_state || ''}` : ''} · ${m.disposition || m.status || ''}`,
          };
        }),
      },
      {
        key: 'dl_history', label: 'License Record History', danger: false,
        rows: dlHistory.map(h => ({
          id: h.id, dob_match: null,
          danger: /suspend|revok|cancel|denied/i.test(h.dl_status || ''),
          summary: `${h.dl_number} (${h.dl_state}) — ${h.dl_status || 'status n/a'} · class ${h.dl_class || '?'} · exp ${h.dl_expiration || 'n/a'} · via ${h.source || 'n/a'} ${String(h.fetched_at || h.updated_at || '').slice(0, 10)}`,
        })),
      },
    ].filter(s => s.rows.length > 0);

    return c.json({ sources, total: sources.reduce((n, s) => n + s.rows.length, 0), profile });
  } catch (err) {
    return c.json({ sources: [], total: 0, degraded: true });
  }
});

// ── GET /:id — single record (+ addresses) ──────────────────
dlRecords.get('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer', 'dispatcher');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const record = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM dl_records WHERE id = ?', id);
    if (!record) return c.json({ error: 'DL record not found', code: 'DL_NOT_FOUND' }, 404);

    const addresses = await query<DlAddress>(
      db,
      'SELECT address, address2, city, state, postal_code, country FROM dl_addresses WHERE dl_record_id = ?',
      id,
    );
    return c.json({ ...record, addresses });
  } catch (err) {
    log.error('GET /:id failed', { src: 'src/routes/dlRecords.ts' }, err);
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
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

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
    await audit(db, (c.get('userId') as number | undefined) ?? null, 'dl_record_update', id, `Updated DL record #${id}`);

    return c.json({ success: true, data: updated });
  } catch (err) {
    log.error('PUT /:id failed', { src: 'src/routes/dlRecords.ts' }, err);
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
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{ dl_number: string; dl_state: string; last_name: string; first_name: string }>(
      db, 'SELECT dl_number, dl_state, last_name, first_name FROM dl_records WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'DL record not found', code: 'DL_NOT_FOUND' }, 404);

    // dl_addresses has ON DELETE CASCADE (FK), so children clean up with the parent.
    await execute(db, 'DELETE FROM dl_records WHERE id = ?', id);
    await audit(
      db, (c.get('userId') as number | undefined) ?? null, 'dl_record_delete', id,
      `Deleted DL record: ${existing.dl_number} (${existing.dl_state}) — ${existing.last_name}, ${existing.first_name}`,
    );

    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id failed', { src: 'src/routes/dlRecords.ts' }, err);
    return c.json({ error: 'Failed to delete DL record', code: 'FAILED_TO_DELETE_DL' }, 500);
  }
});

// ── POST /sync-from-persons — backfill dl_records from the RMS ───────
// The persons table is the richest local DL source (8 records with DL
// numbers on live at build time vs 2 in dl_records). This idempotent
// upsert gives the DL SEARCH page a real local corpus and keeps it in
// step as person records accumulate. Safe to run repeatedly — keyed on
// (dl_number, dl_state); person data only fills dl_records, never the
// reverse.
dlRecords.post('/sync-from-persons', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const persons = await query<any>(
      db,
      `SELECT id, first_name, middle_name, last_name, dob, gender, height, weight,
              eye_color, hair_color, race, dl_number, dl_state, dl_class, dl_expiry,
              address, city, state, zip
       FROM persons WHERE COALESCE(dl_number,'') != ''`,
    );
    let created = 0, updated = 0;
    for (const p of persons) {
      const dlState = p.dl_state || 'UT';
      const fullName = `${p.first_name || ''} ${p.middle_name || ''} ${p.last_name || ''}`
        .replace(/\s+/g, ' ').trim();
      const existing = await queryFirst<{ id: number; source: string }>(
        db, 'SELECT id, source FROM dl_records WHERE dl_number = ? AND dl_state = ?',
        p.dl_number, dlState,
      );
      if (existing) {
        // Only refresh rows we own — never clobber MICROBILT_DL / OCR /
        // MANUAL_ENTRY data with person-record fields.
        if (existing.source === 'PERSONS_SYNC') {
          await execute(
            db,
            `UPDATE dl_records SET first_name=?, middle_name=?, last_name=?, full_name=?,
               date_of_birth=?, gender=?, height=?, weight=?, eye_color=?, hair_color=?, race=?,
               dl_class=?, dl_expiration=?, updated_at=datetime('now')
             WHERE id=?`,
            p.first_name || '', p.middle_name || '', p.last_name || '', fullName,
            p.dob || '', p.gender || '', p.height || '', p.weight || '',
            p.eye_color || '', p.hair_color || '', p.race || '',
            p.dl_class || '', p.dl_expiry || '', existing.id,
          );
          updated++;
        }
        continue;
      }
      const result = await execute(
        db,
        `INSERT INTO dl_records (
           dl_number, dl_state, dl_class, dl_status, dl_expiration, dl_issue_date,
           dl_restrictions, dl_endorsements, first_name, middle_name, last_name,
           full_name, suffix, date_of_birth, gender, height, weight, eye_color,
           hair_color, race, source, fetched_at, updated_at
         ) VALUES (?,?,?,'', ?, '', '', '', ?,?,?,?, '', ?,?,?,?,?,?,?, 'PERSONS_SYNC', datetime('now'), datetime('now'))`,
        p.dl_number, dlState, p.dl_class || '', p.dl_expiry || '',
        p.first_name || '', p.middle_name || '', p.last_name || '', fullName,
        p.dob || '', p.gender || '', p.height || '', p.weight || '',
        p.eye_color || '', p.hair_color || '', p.race || '',
      );
      const recordId = Number(result.meta.last_row_id);
      if (p.address) {
        await execute(
          db,
          `INSERT INTO dl_addresses (dl_record_id, address, address2, city, state, postal_code, country)
           VALUES (?, ?, '', ?, ?, ?, 'US')`,
          recordId, p.address || '', p.city || '', p.state || dlState, p.zip || '',
        );
      }
      created++;
    }
    await audit(
      db, (c.get('userId') as number | undefined) ?? null, 'dl_sync_from_persons', 0,
      `DL sync from persons: ${created} created, ${updated} refreshed (of ${persons.length} persons with DL)`,
    );
    return c.json({ success: true, scanned: persons.length, created, updated });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to sync DL records from persons', 'DL_SYNC_FAILED');
  }
});

// ── POST /ocr-scan — DL image → structured fields (Workers AI vision) ──
// The DL SEARCH page's "SCAN DL" button uploads a license photo here and
// expects { parsed: { first_name, ..., dl_number, dl_expiry } }. This was
// never ported (the proxy served a "not yet ported" stub). Implemented with
// the same vision model the serve-intake OCR pipeline uses.
const DL_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const DL_MAX_IMAGE_BYTES = 4 * 1024 * 1024; // model gateway rejects >~5MB
const DL_OCR_TIMEOUT_MS = 35_000;

const DL_OCR_PROMPT = `You are reading a photo of a US driver's license (AAMVA format).
Extract the fields below and respond with ONLY a JSON object — no prose, no markdown fences.
Use empty string "" for anything not visible. Dates as MM/DD/YYYY.

{"first_name":"","middle_name":"","last_name":"","date_of_birth":"","gender":"","height":"","weight":"","eye_color":"","hair_color":"","address":"","city":"","state":"","zip":"","dl_number":"","dl_state":"","dl_class":"","dl_expiry":"","dl_issue_date":"","dl_restrictions":"","dl_endorsements":""}

Notes: dl_state is the 2-letter code of the issuing state (the big state name
at the top). dl_number is labeled "DL", "LIC#", "DLN" or "4d". gender is M or F.
The address block is under the name. dl_class is labeled "CLASS" or "9".`;

function parseDlModelJson(out: unknown): Record<string, string> | null {
  const text =
    typeof out === 'string' ? out :
    (out as any)?.response ?? (out as any)?.result ?? (out as any)?.description ?? '';
  if (typeof text !== 'string' || !text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (!obj || typeof obj !== 'object') return null;
    const parsed: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) parsed[k] = typeof v === 'string' ? v.trim() : String(v ?? '');
    return parsed;
  } catch { return null; }
}

dlRecords.post('/ocr-scan', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);

  let form: FormData;
  try { form = await c.req.formData(); } catch (err) { log.error('GET failed', { src: 'src/routes/dlRecords.ts' }, err); return c.json({ error: 'Expected multipart/form-data (field: image)' }, 400); }
  const file = (form.get('image') ?? form.get('file')) as File | null;
  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return c.json({ error: 'Missing image file' }, 400);
  }
  if (file.size === 0 || file.size > DL_MAX_IMAGE_BYTES) {
    return c.json({ error: `Image size out of range (0 < n <= ${DL_MAX_IMAGE_BYTES} bytes) — retake or downscale the photo` }, 400);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const run = c.env.AI.run(DL_VISION_MODEL as any, {
      image: Array.from(bytes),
      prompt: DL_OCR_PROMPT,
      max_tokens: 1024,
      temperature: 0.1,
    } as any);
    const out = await Promise.race([
      run,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Vision OCR timed out')), DL_OCR_TIMEOUT_MS)),
    ]);
    const parsed = parseDlModelJson(out);
    if (!parsed || (!parsed.dl_number && !parsed.last_name)) {
      return c.json({ parsed: null, error: 'Could not read license fields from the image — try a sharper, glare-free photo' }, 422);
    }
    // Normalize a couple of model quirks the client relies on.
    if (parsed.gender) parsed.gender = parsed.gender.charAt(0).toUpperCase();
    if (parsed.dl_state) parsed.dl_state = parsed.dl_state.toUpperCase().slice(0, 2);
    if (parsed.state) parsed.state = parsed.state.toUpperCase().slice(0, 2);

    await audit(
      getDb(c.env), (c.get('userId') as number | undefined) ?? null, 'dl_ocr_scan', parsed.dl_number || 'unknown',
      `DL OCR scan: ${parsed.last_name || '?'}, ${parsed.first_name || '?'} (${parsed.dl_state || '??'})`,
    );
    return c.json({ success: true, parsed, model: DL_VISION_MODEL });
  } catch (err) {
    log.error('POST /ocr-scan failed', { src: 'src/routes/dlRecords.ts' }, err);
    return c.json({
      error: err instanceof Error ? err.message : 'DL scan failed',
      code: 'DL_OCR_FAILED',
    }, 500);
  }
});

export default dlRecords;
