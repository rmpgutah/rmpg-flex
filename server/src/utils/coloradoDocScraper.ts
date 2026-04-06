// ============================================================
// Colorado DOC Offender Search — Live Query Proxy
// ============================================================
// Searches the Colorado Department of Corrections public offender
// search at https://www.doc.state.co.us/oss/ in real-time when a
// user queries a name. Results are cached locally in the
// colorado_doc_offenders table for faster repeat lookups.
//
// Flow:
//   1. User searches a name in Offender Registry or NCIC QP
//   2. Server queries CDOC public search API
//   3. Results cached in colorado_doc_offenders table for 24h
//   4. Cross-links against existing persons table
//   5. Fresh results returned to user immediately
//
// NOTE: The CDOC offender search is a publicly accessible
// government resource. No API key required.
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';

// ── API endpoints ────────────────────────────────────────────
const CDOC_SEARCH_URL = 'https://www.doc.state.co.us/oss/api/offender/search';

// ── Config ───────────────────────────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2_000;

// ── Types ────────────────────────────────────────────────────

export interface CdocOffenderResult {
  doc_number: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  dob: string | null;
  gender: string | null;
  race: string | null;
  facility: string | null;
  status: string | null;
  parole_eligibility: string | null;
  release_date: string | null;
  photo_url: string | null;
  offenses: string | null; // JSON array
  source: string;
  fetched_at: string;
}

// ── Fetch helper ─────────────────────────────────────────────

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) return resp;
      if (resp.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      return resp;
    } catch (err: any) {
      if (attempt < retries && (err.name === 'AbortError' || err.code === 'ECONNRESET')) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

// ── Search CDOC ──────────────────────────────────────────────

export async function searchCdocOffenders(
  lastName: string,
  firstName?: string,
): Promise<CdocOffenderResult[]> {
  const now = localNow();

  if (!lastName || lastName.trim().length < 2) {
    return [];
  }

  // Check cache first
  const cached = getCachedResults(lastName, firstName);
  if (cached.length > 0) {
    return cached;
  }

  // Query the CDOC public search
  try {
    const searchParams = new URLSearchParams({
      lastName: lastName.trim().toUpperCase(),
    });
    if (firstName && firstName.trim().length > 0) {
      searchParams.set('firstName', firstName.trim().toUpperCase());
    }

    const resp = await fetchWithRetry(
      `${CDOC_SEARCH_URL}?${searchParams.toString()}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RMPG-Flex/1.0 Law-Enforcement-CAD',
        },
      }
    );

    if (!resp.ok) {
      // If the CDOC API is unavailable, return cached or empty
      console.warn(`[CDOC Search] API returned ${resp.status} — using local cache only`);
      return getLocalResults(lastName, firstName);
    }

    const data = await resp.json() as any;
    const offenders = Array.isArray(data) ? data : (data?.offenders || data?.results || []);

    const results: CdocOffenderResult[] = offenders.map((o: any) => ({
      doc_number: o.docNumber || o.doc_number || o.id || '',
      first_name: o.firstName || o.first_name || '',
      last_name: o.lastName || o.last_name || '',
      middle_name: o.middleName || o.middle_name || null,
      dob: o.dateOfBirth || o.dob || null,
      gender: o.gender || o.sex || null,
      race: o.race || o.ethnicity || null,
      facility: o.facility || o.currentFacility || o.location || null,
      status: o.status || o.legalStatus || null,
      parole_eligibility: o.paroleEligibilityDate || o.parole_eligibility || null,
      release_date: o.mandatoryReleaseDate || o.release_date || null,
      photo_url: o.photoUrl || o.photo_url || o.mugshot || null,
      offenses: o.offenses ? JSON.stringify(o.offenses) : (o.charges ? JSON.stringify(o.charges) : null),
      source: 'cdoc_api',
      fetched_at: now,
    }));

    // Cache results
    cacheResults(results);

    // Cross-link with persons table
    crossLinkOffenders(results);

    return results;
  } catch (err: any) {
    console.warn(`[CDOC Search] Live search failed: ${err.message} — returning local data`);
    return getLocalResults(lastName, firstName);
  }
}

// ── Cache Management ─────────────────────────────────────────

function getCachedResults(lastName: string, firstName?: string): CdocOffenderResult[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();

  let sql = 'SELECT * FROM colorado_doc_offenders WHERE UPPER(last_name) LIKE ? AND fetched_at > ?';
  const params: any[] = [`%${lastName.trim().toUpperCase()}%`, cutoff];

  if (firstName && firstName.trim().length > 0) {
    sql += ' AND UPPER(first_name) LIKE ?';
    params.push(`%${firstName.trim().toUpperCase()}%`);
  }

  sql += ' ORDER BY last_name, first_name LIMIT 100';

  try {
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      ...r,
      source: 'cache',
    }));
  } catch {
    return [];
  }
}

function getLocalResults(lastName: string, firstName?: string): CdocOffenderResult[] {
  const db = getDb();

  let sql = 'SELECT * FROM colorado_doc_offenders WHERE UPPER(last_name) LIKE ?';
  const params: any[] = [`%${lastName.trim().toUpperCase()}%`];

  if (firstName && firstName.trim().length > 0) {
    sql += ' AND UPPER(first_name) LIKE ?';
    params.push(`%${firstName.trim().toUpperCase()}%`);
  }

  sql += ' ORDER BY last_name, first_name LIMIT 100';

  try {
    return db.prepare(sql).all(...params) as CdocOffenderResult[];
  } catch {
    return [];
  }
}

function cacheResults(results: CdocOffenderResult[]): void {
  if (results.length === 0) return;
  const db = getDb();

  try {
    const upsert = db.prepare(`
      INSERT INTO colorado_doc_offenders (doc_number, first_name, last_name, middle_name, dob, gender, race, facility, status, parole_eligibility, release_date, photo_url, offenses, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(doc_number) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        facility = excluded.facility,
        status = excluded.status,
        parole_eligibility = excluded.parole_eligibility,
        release_date = excluded.release_date,
        photo_url = excluded.photo_url,
        offenses = excluded.offenses,
        fetched_at = excluded.fetched_at
    `);

    const tx = db.transaction(() => {
      for (const r of results) {
        if (!r.doc_number) continue;
        upsert.run(
          r.doc_number, r.first_name, r.last_name, r.middle_name,
          r.dob, r.gender, r.race, r.facility, r.status,
          r.parole_eligibility, r.release_date, r.photo_url,
          r.offenses, r.fetched_at
        );
      }
    });
    tx();
  } catch (err: any) {
    console.error('[CDOC Cache] Failed to cache results:', err.message);
  }
}

// ── Cross-link with persons ──────────────────────────────────

function crossLinkOffenders(results: CdocOffenderResult[]): void {
  const db = getDb();

  try {
    const findPerson = db.prepare(`
      SELECT id FROM persons
      WHERE UPPER(last_name) = UPPER(?) AND UPPER(first_name) = UPPER(?)
      LIMIT 1
    `);

    const linkPerson = db.prepare(`
      UPDATE colorado_doc_offenders SET person_id = ? WHERE doc_number = ?
    `);

    for (const r of results) {
      if (!r.doc_number || !r.last_name || !r.first_name) continue;
      const person = findPerson.get(r.last_name, r.first_name) as { id: number } | undefined;
      if (person) {
        linkPerson.run(person.id, r.doc_number);
      }
    }
  } catch (err: any) {
    console.error('[CDOC CrossLink] Failed:', err.message);
  }
}

// ── Get by DOC number ────────────────────────────────────────

export function getCdocOffender(docNumber: string): CdocOffenderResult | null {
  const db = getDb();
  try {
    return db.prepare('SELECT * FROM colorado_doc_offenders WHERE doc_number = ?').get(docNumber) as CdocOffenderResult | null;
  } catch {
    return null;
  }
}

// ── Stats ────────────────────────────────────────────────────

export function getCdocStats(): { total: number; facilities: { facility: string; count: number }[] } {
  const db = getDb();
  try {
    const total = (db.prepare('SELECT COUNT(*) as count FROM colorado_doc_offenders').get() as any)?.count || 0;
    const facilities = db.prepare(
      "SELECT COALESCE(facility, 'Unknown') as facility, COUNT(*) as count FROM colorado_doc_offenders GROUP BY facility ORDER BY count DESC LIMIT 20"
    ).all() as { facility: string; count: number }[];
    return { total, facilities };
  } catch {
    return { total: 0, facilities: [] };
  }
}
