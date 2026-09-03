// ============================================================
// RMPG Flex — Skiptracer (Cloudflare Worker)
// ============================================================
// Read-only surface over the legacy skiptracer tables PLUS local
// person-search endpoints used by the Skip Tracker page. The legacy
// VPS worker was decommissioned (2026-06-15) so the upstream Microbilt /
// RapidAPI round-trip is no longer reachable; this router serves
// every search mode the client invokes (byname/byaddress/byphone/byemail/
// bynameaddress + person detail + CSV export) from the rewrite's own
// D1 corpus: `persons`, `dl_records`, and the historical
// `microbilt_searches` cache.
//
// Tables read:
//   skiptracer_dossiers — manually-built subject dossiers
//   microbilt_searches  — every Microbilt round-trip the legacy worker logged
//                         (treated as a read-only search cache)
//   persons             — the rewrite's RMS (richer than legacy on live)
//   dl_records          — driver's-license rows captured by DL Search
//
// Why we don't just 503 with "not_configured":
//   The page deep-links from NcicQueryPanel (QS) and was used pre-cutover.
//   Returning empty JSON with a `source: 'LOCAL'` discriminator matches
//   DlSearchPage's stance: honest about what's available, never silently
//   pretending an external query happened.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { recordAudit } from '../utils/auditLog';

import { dbErrorResponse } from '../utils/dbErrors';
const skiptracer = new Hono<Env>();

function requireRole(
  c: { get: (k: 'user') => { role: string } | undefined },
  ...roles: string[]
): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ── Shared person row → PeopleDetails shape ──────────────────
// The client renders Name / "Person ID" / Age / "Lives in" /
// "Used to live in" / "Related to" / Link (the legacy Microbilt
// "ByName" payload keys). Map our local persons row to that shape so
// the client code (NcicQueryPanel + SkipTracerPage) doesn't need a
// branch for "local vs external".
interface PersonRow {
  id: number;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  dob: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function personToPeopleDetails(p: PersonRow): Record<string, unknown> {
  const name = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim() || `Person #${p.id}`;
  const livesIn = [p.city, p.state].filter(Boolean).join(', ');
  return {
    Name: name,
    'Person ID': `LOCAL-${p.id}`,
    Age: ageFromDob(p.dob),
    'Lives in': livesIn || null,
    phones: [p.phone].filter(Boolean) as string[],
    emails: [p.email].filter(Boolean) as string[],
    addresses: p.address ? [{ address: p.address, city: p.city || '', state: p.state || '', postal_code: p.zip || '' }] : [],
    source: 'LOCAL',
    _local_person_id: p.id,
  };
}

const PER_PAGE = 25;

// GET /status — dashboard polls this on mount. The rewrite has no
// external job-state store, so "running" can't be detected truthfully;
// hardcode 'idle' per the task spec rather than fabricating state.
skiptracer.get('/status', async (c) => {
  try {
    const db = getDb(c.env);
    const last = await queryFirst<{ last_run: string | null }>(
      db,
      `SELECT MAX(created_at) as last_run FROM microbilt_searches`,
    );
    return c.json({
      status: 'idle',
      running_searches: 0,
      last_run: last?.last_run ?? null,
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to get skiptracer status', 'STATUS_ERROR');
  }
});

// GET /stats — dashboard tile + Skiptracer page header
skiptracer.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ count: number }>(
      db, `SELECT COUNT(*) as count FROM microbilt_searches`,
    ))?.count ?? 0;

    // SQLite-style "start of current month" — UTC, matching the column
    // default (datetime('now')). Avoids timezone drift between INSERT
    // and SELECT that bit us on call_number generation.
    const thisMonth = (await queryFirst<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM microbilt_searches
       WHERE created_at >= strftime('%Y-%m-01 00:00:00', 'now')`,
    ))?.count ?? 0;

    // subject_name aliased to `name` so the client doesn't need a
    // schema-aware mapping layer — matches the field name the legacy
    // proxy stub was returning.
    const recent = await query<Record<string, unknown>>(
      db,
      `SELECT id, subject_name AS name, created_at
         FROM skiptracer_dossiers
        ORDER BY created_at DESC
        LIMIT 10`,
    );

    return c.json({
      total_searches: total,
      searches_this_month: thisMonth,
      recent_dossiers: recent,
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to get skiptracer stats', 'STATS_ERROR');
  }
});

// ── Search modes ──────────────────────────────────────────────
// Every route returns the legacy Microbilt envelope shape:
//   { PeopleDetails: [...], Records: N, Page: P, source: 'LOCAL' }
// The client uses optional chaining (`results?.PeopleDetails`) so any
// missing field degrades to an empty list rather than throwing.

skiptracer.get('/search/byname', async (c) => {
  try {
    const db = getDb(c.env);
    const name = (c.req.query('name') || '').trim();
    if (!name) return c.json({ error: 'Missing name', code: 'BAD_REQUEST' }, 400);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const offset = (page - 1) * PER_PAGE;

    // Split on whitespace and search any column that could carry that
    // token — first, middle, last, or full alias string. LIKE is
    // case-insensitive in SQLite for ASCII; sufficient for our corpus.
    const tokens = name.split(/\s+/).filter(Boolean).slice(0, 4);
    if (tokens.length === 0) return c.json({ PeopleDetails: [], Records: 0, Page: page, source: 'LOCAL' });

    const where = tokens.map(() =>
      '(first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ? OR alias_nickname LIKE ? OR aliases LIKE ?)'
    ).join(' AND ');
    const params: unknown[] = [];
    for (const t of tokens) {
      const wild = `%${t.slice(0, 48)}%`; // D1 LIKE cap: pattern >50 chars silently returns nothing
      params.push(wild, wild, wild, wild, wild);
    }

    const total = (await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) as n FROM persons WHERE ${where}`, ...params,
    ))?.n ?? 0;
    const rows = await query<PersonRow>(
      db,
      `SELECT id, first_name, middle_name, last_name, dob, phone, email,
              address, city, state, zip
         FROM persons
        WHERE ${where}
        ORDER BY last_name, first_name
        LIMIT ? OFFSET ?`,
      ...params, PER_PAGE, offset,
    );

    await recordAudit(c, {
      action: 'SKIPTRACER_SEARCH',
      entityType: 'skiptracer',
      details: { mode: 'name', query: name, hits: rows.length, page },
    });
    return c.json({
      PeopleDetails: rows.map(personToPeopleDetails),
      Records: total, Page: page, source: 'LOCAL',
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Search failed', 'SEARCH_ERROR');
  }
});

skiptracer.get('/search/byaddress', async (c) => {
  try {
    const db = getDb(c.env);
    const addr = (c.req.query('address') || '').trim();
    if (!addr) return c.json({ error: 'Missing address', code: 'BAD_REQUEST' }, 400);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const offset = (page - 1) * PER_PAGE;

    const wild = `%${addr.slice(0, 48)}%`; // D1 LIKE cap: pattern >50 chars silently returns nothing
    const total = (await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) as n FROM persons
        WHERE address LIKE ? OR city LIKE ? OR zip LIKE ?`,
      wild, wild, wild,
    ))?.n ?? 0;
    const rows = await query<PersonRow>(
      db,
      `SELECT id, first_name, middle_name, last_name, dob, phone, email,
              address, city, state, zip
         FROM persons
        WHERE address LIKE ? OR city LIKE ? OR zip LIKE ?
        ORDER BY last_name, first_name
        LIMIT ? OFFSET ?`,
      wild, wild, wild, PER_PAGE, offset,
    );

    await recordAudit(c, {
      action: 'SKIPTRACER_SEARCH',
      entityType: 'skiptracer',
      details: { mode: 'address', query: addr, hits: rows.length, page },
    });
    return c.json({
      PeopleDetails: rows.map(personToPeopleDetails),
      Records: total, Page: page, source: 'LOCAL',
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Search failed', 'SEARCH_ERROR');
  }
});

skiptracer.get('/search/bynameaddress', async (c) => {
  try {
    const db = getDb(c.env);
    const name = (c.req.query('name') || '').trim();
    const addr = (c.req.query('address') || '').trim();
    if (!name || !addr) return c.json({ error: 'Missing name or address', code: 'BAD_REQUEST' }, 400);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const offset = (page - 1) * PER_PAGE;

    const tokens = name.split(/\s+/).filter(Boolean).slice(0, 4);
    const nameWhere = tokens.length
      ? tokens.map(() => '(first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ?)').join(' AND ')
      : '1=1';
    const addrWhere = '(address LIKE ? OR city LIKE ?)';
    const params: unknown[] = [];
    // D1 LIKE cap: pattern >50 chars silently returns nothing
    for (const t of tokens) { const w = `%${t.slice(0, 48)}%`; params.push(w, w, w); }
    const aw = `%${addr.slice(0, 48)}%`;
    params.push(aw, aw);

    const where = `${nameWhere} AND ${addrWhere}`;
    const total = (await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) as n FROM persons WHERE ${where}`, ...params,
    ))?.n ?? 0;
    const rows = await query<PersonRow>(
      db,
      `SELECT id, first_name, middle_name, last_name, dob, phone, email,
              address, city, state, zip
         FROM persons
        WHERE ${where}
        ORDER BY last_name, first_name
        LIMIT ? OFFSET ?`,
      ...params, PER_PAGE, offset,
    );

    await recordAudit(c, {
      action: 'SKIPTRACER_SEARCH',
      entityType: 'skiptracer',
      details: { mode: 'nameaddress', name, address: addr, hits: rows.length, page },
    });
    return c.json({
      PeopleDetails: rows.map(personToPeopleDetails),
      Records: total, Page: page, source: 'LOCAL',
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Search failed', 'SEARCH_ERROR');
  }
});

skiptracer.get('/search/byphone', async (c) => {
  try {
    const db = getDb(c.env);
    const phone = (c.req.query('phone') || '').trim();
    if (!phone) return c.json({ error: 'Missing phone', code: 'BAD_REQUEST' }, 400);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const offset = (page - 1) * PER_PAGE;

    // Phone matching: strip non-digits from query, match against the
    // last 10 digits of stored phones (handles +1 prefix, dashes, spaces).
    const digits = phone.replace(/\D/g, '');
    const last10 = digits.slice(-10);
    const last7 = digits.slice(-7);
    const candidates = [digits, last10, last7].filter((s, i, a) => s && a.indexOf(s) === i);
    if (candidates.length === 0) return c.json({ PeopleDetails: [], Records: 0, Page: page, source: 'LOCAL' });

    const where = candidates.map(() =>
      '(REPLACE(REPLACE(REPLACE(REPLACE(phone,\'-\',\'\'),\' \',\'\'),\'(\',\'\'),\')\',\'\') LIKE ? OR ' +
      'REPLACE(REPLACE(REPLACE(REPLACE(phone_secondary,\'-\',\'\'),\' \',\'\'),\'(\',\'\'),\')\',\'\') LIKE ?)'
    ).join(' OR ');
    const params: unknown[] = [];
    // D1 LIKE cap: pattern >50 chars silently returns nothing
    for (const c2 of candidates) { const w = `%${String(c2).slice(0, 48)}%`; params.push(w, w); }

    const total = (await queryFirst<{ n: number }>(
      db, `SELECT COUNT(*) as n FROM persons WHERE ${where}`, ...params,
    ))?.n ?? 0;
    const rows = await query<PersonRow>(
      db,
      `SELECT id, first_name, middle_name, last_name, dob, phone, email,
              address, city, state, zip
         FROM persons
        WHERE ${where}
        ORDER BY last_name, first_name
        LIMIT ? OFFSET ?`,
      ...params, PER_PAGE, offset,
    );

    await recordAudit(c, {
      action: 'SKIPTRACER_SEARCH',
      entityType: 'skiptracer',
      details: { mode: 'phone', query: phone, hits: rows.length, page },
    });
    return c.json({
      PeopleDetails: rows.map(personToPeopleDetails),
      Records: total, Page: page, source: 'LOCAL',
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Search failed', 'SEARCH_ERROR');
  }
});

skiptracer.get('/search/byemail', async (c) => {
  try {
    const db = getDb(c.env);
    const email = (c.req.query('email') || '').trim();
    if (!email) return c.json({ error: 'Missing email', code: 'BAD_REQUEST' }, 400);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const offset = (page - 1) * PER_PAGE;

    const wild = `%${email.slice(0, 48)}%`; // D1 LIKE cap: pattern >50 chars silently returns nothing
    const total = (await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) as n FROM persons WHERE email LIKE ? OR email_secondary LIKE ?`,
      wild, wild,
    ))?.n ?? 0;
    const rows = await query<PersonRow>(
      db,
      `SELECT id, first_name, middle_name, last_name, dob, phone, email,
              address, city, state, zip
         FROM persons
        WHERE email LIKE ? OR email_secondary LIKE ?
        ORDER BY last_name, first_name
        LIMIT ? OFFSET ?`,
      wild, wild, PER_PAGE, offset,
    );

    await recordAudit(c, {
      action: 'SKIPTRACER_SEARCH',
      entityType: 'skiptracer',
      details: { mode: 'email', query: email, hits: rows.length, page },
    });
    return c.json({
      PeopleDetails: rows.map(personToPeopleDetails),
      Records: total, Page: page, source: 'LOCAL',
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Search failed', 'SEARCH_ERROR');
  }
});

// GET /person/:id — full detail for one local person record. ID format
// is `LOCAL-<n>` (the shape returned by the search endpoints above);
// raw numeric ids are also accepted for backward compatibility with
// any historical caller that passed an unprefixed person id.
skiptracer.get('/person/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const raw = c.req.param('id');
    const id = parseInt(raw.replace(/^LOCAL-/, ''), 10);
    if (Number.isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const p = await queryFirst<Record<string, unknown>>(
      db, `SELECT * FROM persons WHERE id = ?`, id,
    );
    if (!p) return c.json({ error: 'Person not found', code: 'NOT_FOUND' }, 404);

    await recordAudit(c, {
      action: 'SKIPTRACER_PERSON_VIEW',
      entityType: 'person',
      entityId: id,
      details: { source: 'skiptracer' },
    });

    // Wrap the row in the legacy "person detail" envelope: a few
    // synthesised arrays (phones/emails/addresses) so the client's
    // renderArraySection helper has something to render alongside the
    // flat field list, plus the raw row for the JSON drawer.
    const phones = [p.phone, p.phone_secondary, p.home_phone, p.work_phone].filter(Boolean);
    const emails = [p.email, p.email_secondary].filter(Boolean);
    const addresses = p.address ? [{
      address: p.address, city: p.city, state: p.state, postal_code: p.zip,
    }] : [];
    return c.json({
      ...p,
      Name: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '),
      'Person ID': `LOCAL-${id}`,
      Age: ageFromDob((p.dob as string) ?? null),
      'Lives in': [p.city, p.state].filter(Boolean).join(', ') || null,
      phones, emails, addresses,
      source: 'LOCAL',
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Person lookup failed', 'LOOKUP_ERROR');
  }
});

// GET /export/csv — flat dump of recent searches for audit/court hand-off.
// The previous ExportButton wired to /api/skiptracer/export/csv 404'd.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

skiptracer.get('/export/csv', async (c) => {
  try {
    const db = getDb(c.env);
    const limit = Math.min(5000, Math.max(1, parseInt(c.req.query('limit') || '500', 10) || 500));
    const rows = await query<{
      id: number; product: string; search_type: string; search_input: string;
      hit: number; subject_count: number; searched_by: number | null;
      linked_incident: string | null; created_at: string;
    }>(
      db,
      `SELECT id, product, search_type, search_input, hit, subject_count,
              searched_by, linked_incident, created_at
         FROM microbilt_searches
        ORDER BY created_at DESC
        LIMIT ?`,
      limit,
    );
    const header = ['ID','Product','Type','Input','Hit','Subjects','Searched By','Linked Incident','Created At'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push([
        r.id, r.product, r.search_type, r.search_input, r.hit ? 'Y' : 'N',
        r.subject_count, r.searched_by ?? '', r.linked_incident ?? '', r.created_at,
      ].map(csvCell).join(','));
    }
    const body = lines.join('\n');
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="skip-traces.csv"`,
      },
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'CSV export failed', 'EXPORT_ERROR');
  }
});

// GET /dossiers — paginated list, admin/manager only.
// Cap per_page at 50 (the table can hold large search_results JSON
// per row; even 100 rows × ~50 KB blob is a 5 MB response).
skiptracer.get('/dossiers', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(q('per_page') || '25', 10) || 25));
    const offset = (page - 1) * perPage;

    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    const status = q('status');
    if (status) { conditions.push('status = ?'); params.push(status); }
    const search = q('search');
    if (search) {
      conditions.push('(subject_name LIKE ? OR notes LIKE ?)');
      const s = `%${search.slice(0, 48)}%`; // D1 LIKE cap: pattern >50 chars silently returns nothing
      params.push(s, s);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM skiptracer_dossiers ${where}`, ...params,
    );

    // Deliberately NOT selecting search_results in the list — it can
    // be a multi-MB JSON blob per row. Detail endpoint serves it.
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT sd.id, sd.subject_name, sd.subject_dob, sd.notes, sd.status,
              sd.created_by, sd.created_at, sd.updated_at,
              u.full_name AS created_by_name
         FROM skiptracer_dossiers sd
         LEFT JOIN users u ON sd.created_by = u.id
         ${where}
         ORDER BY sd.created_at DESC, sd.id DESC
         LIMIT ? OFFSET ?`,
      ...params, perPage, offset,
    );

    const total = countRow?.total ?? 0;
    return c.json({
      data: rows,
      pagination: {
        page, per_page: perPage, total,
        totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0,
      },
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to list dossiers', 'DOSSIERS_LIST_ERROR');
  }
});

// GET /dossiers/:id — single dossier, admin/manager only.
// search_results is a JSON string column on disk; surface it as
// parsed JSON when possible so the client doesn't double-parse.
skiptracer.get('/dossiers/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT sd.*, u.full_name AS created_by_name
         FROM skiptracer_dossiers sd
         LEFT JOIN users u ON sd.created_by = u.id
         WHERE sd.id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'Dossier not found', code: 'NOT_FOUND' }, 404);

    if (typeof row.search_results === 'string' && row.search_results) {
      try { row.search_results = JSON.parse(row.search_results); }
      catch { /* leave as-is; client tolerates raw string */ }
    }
    return c.json({ data: row });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to get dossier', 'DOSSIER_GET_ERROR');
  }
});

export default skiptracer;
