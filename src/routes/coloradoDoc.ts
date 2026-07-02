// ============================================================
// Colorado DOC Offender Search
// ============================================================
// Backs OffenderRegistryPage's CDOC panel + ColoradoDocPage, which
// call /api/colorado-doc/* . That prefix was never mounted, so every
// call 404'd and the client silently showed "no results".
//
// IMPORTANT reality check (verified 2026-06-15): the legacy JSON API
// (/oss/api/offender/search) is dead (404), and the CURRENT Colorado
// DOC public search (POST /oss/controller/ctl_ajax.php) is hard
// CAPTCHA-gated — a server (and Firecrawl) cannot query it
// automatically. So this router does NOT pretend to do live search.
// Instead it:
//   • makes the endpoint EXIST (no more dead-button 404),
//   • serves repeat lookups from a local D1 cache,
//   • returns honest metadata (live_search_available:false + the
//     official portal URL) so the UI tells the truth instead of a
//     false "no results",
//   • lets an admin POST /import to build the cache manually.
// Swap in a real source if Colorado ever exposes a keyed API or the
// team adopts a CAPTCHA-solving path.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { dbErrorResponse } from '../utils/dbErrors';
const coloradoDoc = new Hono<Env>();

const PORTAL_URL = 'https://www.doc.state.co.us/oss/';
const LIVE_NOTE = 'Live Colorado DOC offender search is CAPTCHA-protected and cannot be queried automatically. Results below are from the local cache; use the official portal for a live lookup.';

let tableReady = false;
async function ensureTable(db: any): Promise<void> {
  if (tableReady) return;
  await execute(db, `
    CREATE TABLE IF NOT EXISTS colorado_doc_offenders (
      doc_number TEXT PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      middle_name TEXT,
      dob TEXT,
      gender TEXT,
      race TEXT,
      facility TEXT,
      status TEXT,
      parole_eligibility TEXT,
      release_date TEXT,
      photo_url TEXT,
      offenses TEXT,
      person_id INTEGER,
      source TEXT DEFAULT 'manual',
      fetched_at TEXT DEFAULT (datetime('now'))
    )`);
  tableReady = true;
}

function isAdmin(c: any): boolean {
  const user = c.get('user') as { role?: string } | undefined;
  return ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
}

// GET /api/colorado-doc/search?lastName=&firstName=  → cache + honest metadata
coloradoDoc.get('/search', async (c) => {
  try {
    const db = getDb(c.env);
    await ensureTable(db);
    const lastName = (c.req.query('lastName') || '').trim();
    const firstName = (c.req.query('firstName') || '').trim();
    if (lastName.length < 2) {
      return c.json({ error: 'lastName is required (minimum 2 characters)', code: 'LASTNAME_REQUIRED' }, 400);
    }
    let sql = 'SELECT * FROM colorado_doc_offenders WHERE UPPER(last_name) LIKE ?';
    const params: unknown[] = [`%${lastName.toUpperCase()}%`];
    if (firstName) { sql += ' AND UPPER(first_name) LIKE ?'; params.push(`%${firstName.toUpperCase()}%`); }
    sql += ' ORDER BY last_name, first_name LIMIT 100';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json({
      data: rows,
      total: rows.length,
      source: 'cache',
      live_search_available: false,
      portal_url: PORTAL_URL,
      note: LIVE_NOTE,
    });
  } catch (err) {
    return dbErrorResponse(c, err, 'Colorado DOC search failed');
  }
});

// GET /api/colorado-doc/offender/:docNumber  → cached offender or 404
coloradoDoc.get('/offender/:docNumber', async (c) => {
  try {
    const db = getDb(c.env);
    await ensureTable(db);
    const docNumber = (c.req.param('docNumber') || '').trim();
    if (!docNumber || docNumber.length > 20 || !/^[A-Za-z0-9-]+$/.test(docNumber)) {
      return c.json({ error: 'docNumber must be alphanumeric (max 20 characters)', code: 'BAD_DOCNUMBER' }, 400);
    }
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM colorado_doc_offenders WHERE doc_number = ?', docNumber);
    if (!row) {
      return c.json({ error: 'Offender not found in local cache', code: 'OFFENDER_NOT_FOUND', live_search_available: false, portal_url: PORTAL_URL, note: LIVE_NOTE }, 404);
    }
    return c.json(row);
  } catch (err) {
    return dbErrorResponse(c, err, 'Colorado DOC lookup failed');
  }
});

// GET /api/colorado-doc/stats  → cache size + facility breakdown
coloradoDoc.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    await ensureTable(db);
    const total = await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM colorado_doc_offenders');
    const facilities = await query<{ facility: string; count: number }>(db,
      "SELECT COALESCE(facility, 'Unknown') AS facility, COUNT(*) AS count FROM colorado_doc_offenders GROUP BY facility ORDER BY count DESC LIMIT 20");
    return c.json({ total: total?.count ?? 0, facilities, live_search_available: false, portal_url: PORTAL_URL });
  } catch (err) {
    return dbErrorResponse(c, err, 'Colorado DOC stats failed');
  }
});

// POST /api/colorado-doc/import  (admin) → manually add/update a cached offender.
// Lets the team build the cache from manual portal lookups.
coloradoDoc.post('/import', async (c) => {
  try {
    if (!isAdmin(c)) return c.json({ error: 'Admin role required', code: 'FORBIDDEN' }, 403);
    const db = getDb(c.env);
    await ensureTable(db);
    const body = await c.req.json<Record<string, any>>();
    const list: Record<string, any>[] = Array.isArray(body) ? body : (Array.isArray(body?.offenders) ? body.offenders : [body]);
    let saved = 0;
    for (const o of list) {
      const docNumber = String(o.doc_number ?? o.docNumber ?? '').trim();
      if (!docNumber) continue;
      await execute(db,
        `INSERT INTO colorado_doc_offenders
           (doc_number, first_name, last_name, middle_name, dob, gender, race, facility, status, parole_eligibility, release_date, photo_url, offenses, source, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', datetime('now'))
         ON CONFLICT(doc_number) DO UPDATE SET
           first_name = excluded.first_name, last_name = excluded.last_name, middle_name = excluded.middle_name,
           dob = excluded.dob, gender = excluded.gender, race = excluded.race, facility = excluded.facility,
           status = excluded.status, parole_eligibility = excluded.parole_eligibility, release_date = excluded.release_date,
           photo_url = excluded.photo_url, offenses = excluded.offenses, fetched_at = excluded.fetched_at`,
        docNumber, o.first_name ?? o.firstName ?? null, o.last_name ?? o.lastName ?? null, o.middle_name ?? null,
        o.dob ?? null, o.gender ?? null, o.race ?? null, o.facility ?? null, o.status ?? null,
        o.parole_eligibility ?? null, o.release_date ?? null, o.photo_url ?? null,
        o.offenses ? (typeof o.offenses === 'string' ? o.offenses : JSON.stringify(o.offenses)) : null);
      saved++;
    }
    return c.json({ success: true, saved });
  } catch (err) {
    return dbErrorResponse(c, err, 'Colorado DOC import failed');
  }
});

export default coloradoDoc;
