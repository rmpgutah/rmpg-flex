// ============================================================
// Court Records Search — Open Source Public Records
// ============================================================
// Searches publicly available court record systems for criminal
// history, case records, and disposition data. Integrates with
// the warrant/person screening system to provide officers with
// complete background information during dispatch operations.
//
// Sources:
//   1. Utah Courts (courtlink.utcourts.gov) — XChange search
//   2. Multi-state open court record portals
//   3. Federal PACER (limited public info)
//
// Architecture:
//   - court_records table caches search results (24h TTL)
//   - Live search on demand + scheduled bulk scan of known persons
//   - Cross-links with persons table for repeat lookups
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { escapeLike } from '../middleware/sanitize';

// ── Constants ───────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SCAN_DELAY_MS = 3000; // Delay between person searches to avoid rate-limiting
const SCAN_INTERVAL_MS = 2 * 60 * 60 * 1000; // Bulk scan every 2 hours

// ── Types ───────────────────────────────────────────────────

export interface CourtRecord {
  case_number: string;
  court_name: string;
  state: string;
  case_type: string;           // criminal, civil, traffic, family, etc.
  filing_date: string;
  disposition: string;         // convicted, dismissed, pending, etc.
  disposition_date: string;
  charges: string;             // JSON array of charge descriptions
  offense_level: string;       // felony, misdemeanor, infraction
  defendant_name: string;
  defendant_dob: string;
  judge: string;
  source_url: string;
  source_system: string;       // utah_xchange, co_courts, etc.
}

interface CourtSearchResult {
  records: CourtRecord[];
  source: string;
  searched_at: string;
}

// ── HTTP Helper ─────────────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(options.headers || {}),
      },
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── HTML parsing helpers ────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .trim();
}

// ════════════════════════════════════════════════════════════
//  UTAH COURTS — XChange Public Search
// ════════════════════════════════════════════════════════════
// Utah's public court record system at courtlink.utcourts.gov
// provides case search by name. The site uses server-rendered
// HTML that we can parse for case details.

async function searchUtahCourts(firstName: string, lastName: string): Promise<CourtRecord[]> {
  const records: CourtRecord[] = [];

  try {
    // Utah XChange search endpoint
    const searchUrl = `https://www.utcourts.gov/cal/search?first=${encodeURIComponent(firstName)}&last=${encodeURIComponent(lastName)}&type=criminal`;
    const res = await fetchWithTimeout(searchUrl);
    if (!res || !res.ok) return records;

    const html = await res.text();

    // Parse case entries from the search results
    // Utah courts uses table-based layouts for search results
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const rowHtml = match[1];
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
        cells.push(stripHtml(tdMatch[1]));
      }

      if (cells.length < 3) continue;
      // Skip header rows
      if (cells[0].match(/^(Case|Number|#|ID)$/i)) continue;

      // Extract case information from cells
      let caseNumber = '';
      let courtName = '';
      let filingDate = '';
      let caseType = '';
      let charges = '';
      let disposition = '';

      for (const cell of cells) {
        if (!caseNumber && cell.match(/^\d{3,}-?\d*/)) {
          caseNumber = cell;
        } else if (cell.match(/district|justice|juvenile|court/i) && !courtName) {
          courtName = cell;
        } else if (cell.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/) && !filingDate) {
          filingDate = cell;
        } else if (cell.match(/criminal|misdemeanor|felony|traffic|civil/i) && !caseType) {
          caseType = cell.toLowerCase();
        } else if (cell.match(/dismiss|convict|acquit|pending|guilty|not guilty/i) && !disposition) {
          disposition = cell;
        } else if (cell.length > 10 && !charges) {
          charges = cell;
        }
      }

      if (!caseNumber) continue;

      // Determine offense level from case type or charges
      let offenseLevel = '';
      const caseText = `${caseType} ${charges}`.toLowerCase();
      if (caseText.includes('felony') || caseText.match(/\bF\d\b/)) offenseLevel = 'felony';
      else if (caseText.includes('misdemeanor') || caseText.match(/\bM[ABC]\b/i)) offenseLevel = 'misdemeanor';
      else if (caseText.includes('infraction')) offenseLevel = 'infraction';

      records.push({
        case_number: caseNumber,
        court_name: courtName || 'Utah District Court',
        state: 'UT',
        case_type: caseType || 'criminal',
        filing_date: filingDate,
        disposition: disposition || 'unknown',
        disposition_date: '',
        charges: JSON.stringify(charges ? [charges] : []),
        offense_level: offenseLevel,
        defendant_name: `${firstName} ${lastName}`,
        defendant_dob: '',
        judge: '',
        source_url: searchUrl,
        source_system: 'utah_xchange',
      });
    }
  } catch (err: any) {
    console.warn(`[Court Records] Utah search error: ${err?.message || "Unknown error"}`);
  }

  return records;
}

// ════════════════════════════════════════════════════════════
//  GENERIC STATE COURT SEARCH
// ════════════════════════════════════════════════════════════
// Many state court systems use similar HTML patterns. This
// generic parser handles common court record page layouts.

interface StateCourtConfig {
  state: string;
  systemName: string;
  searchUrl: (first: string, last: string) => string;
}

const STATE_COURT_CONFIGS: StateCourtConfig[] = [
  {
    state: 'CO',
    systemName: 'co_courts',
    searchUrl: (first, last) =>
      `https://www.courts.state.co.us/dockets/index.cfm?action=search&type=name&last_name=${encodeURIComponent(last)}&first_name=${encodeURIComponent(first)}`,
  },
  {
    state: 'ID',
    systemName: 'id_courts',
    searchUrl: (first, last) =>
      `https://www.idcourts.us/repository/caseSearch.do?first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}`,
  },
  {
    state: 'WY',
    systemName: 'wy_courts',
    searchUrl: (first, last) =>
      `https://www.courts.state.wy.us/cases/search?name=${encodeURIComponent(last)}+${encodeURIComponent(first)}`,
  },
  {
    state: 'NV',
    systemName: 'nv_courts',
    searchUrl: (first, last) =>
      `https://www.clarkcountycourts.us/portal/search?last=${encodeURIComponent(last)}&first=${encodeURIComponent(first)}`,
  },
];

async function searchStateCourts(
  firstName: string,
  lastName: string,
  config: StateCourtConfig
): Promise<CourtRecord[]> {
  const records: CourtRecord[] = [];

  try {
    const url = config.searchUrl(firstName, lastName);
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) return records;

    const html = await res.text();

    // Generic table row parsing for court records
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;
    let rowIdx = 0;

    while ((match = rowRegex.exec(html)) !== null) {
      const rowHtml = match[1];
      const cells: string[] = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
        cells.push(stripHtml(tdMatch[1]));
      }
      if (cells.length < 2) continue;
      if (cells[0].match(/^(Case|Number|#|ID|Date)$/i)) continue;

      rowIdx++;

      let caseNumber = '';
      let courtName = '';
      let filingDate = '';
      let charges = '';
      let disposition = '';

      for (const cell of cells) {
        if (!caseNumber && (cell.match(/^\d{2,4}-[A-Z]*-?\d+/i) || cell.match(/^[A-Z]{2,}-\d+/i))) {
          caseNumber = cell;
        } else if (cell.match(/court|district|municipal|justice/i) && !courtName) {
          courtName = cell;
        } else if (cell.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/) && !filingDate) {
          filingDate = cell;
        } else if (cell.match(/dismiss|convict|guilty|acquit|pending/i) && !disposition) {
          disposition = cell;
        } else if (cell.length > 8 && !charges) {
          charges = cell;
        }
      }

      if (!caseNumber && rowIdx > 20) break; // Stop parsing if no cases found after 20 rows

      if (caseNumber) {
        records.push({
          case_number: caseNumber,
          court_name: courtName || `${config.state} Court`,
          state: config.state,
          case_type: 'criminal',
          filing_date: filingDate,
          disposition: disposition || 'unknown',
          disposition_date: '',
          charges: JSON.stringify(charges ? [charges] : []),
          offense_level: '',
          defendant_name: `${firstName} ${lastName}`,
          defendant_dob: '',
          judge: '',
          source_url: config.searchUrl(firstName, lastName),
          source_system: config.systemName,
        });
      }
    }
  } catch (err: any) {
    console.warn(`[Court Records] ${config.state} search error: ${err?.message || "Unknown error"}`);
  }

  return records;
}

// ════════════════════════════════════════════════════════════
//  CACHE MANAGEMENT
// ════════════════════════════════════════════════════════════

function cacheCourtRecords(personName: string, records: CourtRecord[]): void {
  try {
    const db = getDb();
    const now = localNow();

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO court_records
        (case_number, court_name, state, case_type, filing_date, disposition,
         disposition_date, charges, offense_level, defendant_name, defendant_dob,
         judge, source_url, source_system, fetched_at, person_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Try to find a matching person for cross-linking
    const nameParts = personName.split(' ');
    let personId: number | null = null;
    if (nameParts.length >= 2) {
      const person = db.prepare(`
        SELECT id FROM persons
        WHERE UPPER(first_name) = UPPER(?) AND UPPER(last_name) = UPPER(?)
        AND archived_at IS NULL
        LIMIT 1
      `).get(nameParts[0], nameParts[nameParts.length - 1]) as { id: number } | undefined;
      if (person) personId = person.id;
    }

    const txn = db.transaction(() => {
      for (const r of records) {
        insertStmt.run(
          r.case_number, r.court_name, r.state, r.case_type, r.filing_date,
          r.disposition, r.disposition_date, r.charges, r.offense_level,
          r.defendant_name, r.defendant_dob, r.judge, r.source_url,
          r.source_system, now, personId
        );
      }
    });
    txn();
  } catch (err: any) {
    console.warn(`[Court Records] Cache write failed: ${err?.message || "Unknown error"}`);
  }
}

// ════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════

/**
 * Search court records for a person by name.
 * Tries live search first, falls back to cache.
 */
export async function searchCourtRecords(
  firstName: string,
  lastName: string,
  options?: { states?: string[]; useCache?: boolean }
): Promise<CourtSearchResult> {
  const now = localNow();
  const allRecords: CourtRecord[] = [];

  // Check cache first if requested
  if (options?.useCache !== false) {
    const cached = getCachedCourtRecords(firstName, lastName);
    if (cached.length > 0) {
      // Check if cache is fresh (within TTL)
      const newest = cached[0];
      if (newest.fetched_at) {
        const fetchedTime = new Date(newest.fetched_at).getTime();
        if (Date.now() - fetchedTime < CACHE_TTL_MS) {
          return { records: cached, source: 'cache', searched_at: now };
        }
      }
    }
  }

  // Live search — Utah first (most relevant for RMPG)
  const utahResults = await searchUtahCourts(firstName, lastName);
  allRecords.push(...utahResults);

  // Search surrounding state courts
  const targetStates = options?.states || ['CO', 'ID', 'WY', 'NV'];
  for (const config of STATE_COURT_CONFIGS) {
    if (targetStates.includes(config.state)) {
      const stateResults = await searchStateCourts(firstName, lastName, config);
      allRecords.push(...stateResults);
      // Throttle between state searches
      await sleep(1000);
    }
  }

  // Cache results
  if (allRecords.length > 0) {
    cacheCourtRecords(`${firstName} ${lastName}`, allRecords);
  }

  return { records: allRecords, source: 'live', searched_at: now };
}

/**
 * Get cached court records for a person.
 */
export function getCachedCourtRecords(
  firstName: string,
  lastName: string,
  options?: { limit?: number }
): (CourtRecord & { fetched_at?: string })[] {
  try {
    const db = getDb();
    const limit = options?.limit ?? 100;
    const name = `${firstName} ${lastName}`;

    return db.prepare(`
      SELECT * FROM court_records
      WHERE UPPER(defendant_name) = UPPER(?)
        OR (defendant_name LIKE ? ESCAPE '\\' AND defendant_name LIKE ? ESCAPE '\\')
      ORDER BY filing_date DESC
      LIMIT ?
    `).all(name, `%${escapeLike(firstName)}%`, `%${escapeLike(lastName)}%`, limit) as (CourtRecord & { fetched_at?: string })[];
  } catch {
    return [];
  }
}

/**
 * Search court records by person_id (cross-linked).
 */
export function getCourtRecordsByPersonId(personId: number): CourtRecord[] {
  try {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM court_records
      WHERE person_id = ?
      ORDER BY filing_date DESC
    `).all(personId) as CourtRecord[];
  } catch {
    return [];
  }
}

/**
 * Get court record stats for the admin dashboard.
 */
export function getCourtRecordStats(): {
  total_records: number;
  by_state: Record<string, number>;
  by_type: Record<string, number>;
  by_disposition: Record<string, number>;
} {
  try {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as c FROM court_records').get() as any)?.c ?? 0;

    const byState: Record<string, number> = {};
    const stateRows = db.prepare('SELECT state, COUNT(*) as c FROM court_records GROUP BY state').all() as { state: string; c: number }[];
    for (const row of stateRows) byState[row.state] = row.c;

    const byType: Record<string, number> = {};
    const typeRows = db.prepare('SELECT case_type, COUNT(*) as c FROM court_records GROUP BY case_type').all() as { case_type: string; c: number }[];
    for (const row of typeRows) byType[row.case_type] = row.c;

    const byDisposition: Record<string, number> = {};
    const dispRows = db.prepare('SELECT disposition, COUNT(*) as c FROM court_records GROUP BY disposition').all() as { disposition: string; c: number }[];
    for (const row of dispRows) byDisposition[row.disposition] = row.c;

    return { total_records: total, by_state: byState, by_type: byType, by_disposition: byDisposition };
  } catch {
    return { total_records: 0, by_state: {}, by_type: {}, by_disposition: {} };
  }
}

// ════════════════════════════════════════════════════════════
//  BULK SCAN — Scheduled
// ════════════════════════════════════════════════════════════
// Runs every 2 hours, searches court records for all known
// persons in the database with criminal history or warrants.

let scanInterval: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

async function runCourtRecordsScan(): Promise<{
  personsChecked: number;
  recordsFound: number;
  errors: number;
}> {
  const db = getDb();
  let personsChecked = 0;
  let recordsFound = 0;
  let errors = 0;

  try {
    // Get persons with criminal history or active warrants — prioritize these
    const persons = db.prepare(`
      SELECT DISTINCT p.id, p.first_name, p.last_name, p.dob
      FROM persons p
      WHERE p.first_name IS NOT NULL AND p.first_name != ''
        AND p.last_name IS NOT NULL AND p.last_name != ''
        AND p.archived_at IS NULL
        AND (
          EXISTS (SELECT 1 FROM criminal_history ch WHERE ch.person_id = p.id)
          OR EXISTS (SELECT 1 FROM scraped_warrants sw WHERE sw.person_id = p.id AND sw.status = 'active')
          OR EXISTS (SELECT 1 FROM warrant_watch_log wl WHERE wl.person_id = p.id AND wl.event = 'warrant_found')
        )
      ORDER BY p.last_name, p.first_name
      LIMIT 200
    `).all() as { id: number; first_name: string; last_name: string; dob: string | null }[];

    console.log(`[Court Records] Bulk scan: checking ${persons.length} persons with known history/warrants`);

    for (const person of persons) {
      try {
        // Only search Utah courts in bulk scan (most relevant, least rate-limiting risk)
        const utahResults = await searchUtahCourts(person.first_name, person.last_name);

        if (utahResults.length > 0) {
          cacheCourtRecords(`${person.first_name} ${person.last_name}`, utahResults);
          recordsFound += utahResults.length;
        }

        personsChecked++;

        // Throttle
        if (personsChecked < persons.length) {
          await sleep(SCAN_DELAY_MS);
        }
      } catch {
        errors++;
      }
    }

    console.log(`[Court Records] Bulk scan complete: ${personsChecked} checked, ${recordsFound} records found, ${errors} errors`);
  } catch (err: any) {
    console.error(`[Court Records] Bulk scan failed: ${err?.message || "Unknown error"}`);
  }

  return { personsChecked, recordsFound, errors };
}

/**
 * Start the court records scheduler.
 * Runs a bulk scan 3 minutes after startup, then every 2 hours.
 */
export function scheduleCourtRecordsScan(): void {
  console.log('[Court Records] Court records scraper initializing — bulk scan every 2 hours');

  startupTimer = setTimeout(async () => {
    console.log('[Court Records] Running initial court records scan...');
    await runCourtRecordsScan();

    scanInterval = setInterval(() => {
      console.log('[Court Records] Starting scheduled court records scan...');
      runCourtRecordsScan().catch(err => console.error('[Court Records] Scan error:', err.message || err));
    }, SCAN_INTERVAL_MS);

    if (scanInterval.unref) scanInterval.unref();
  }, 3 * 60 * 1000); // 3 minutes after startup

  if (startupTimer.unref) startupTimer.unref();

  // Cache cleanup — remove entries older than 30 days
  cleanupTimer = setInterval(() => {
    try {
      const db = getDb();
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = db.prepare('DELETE FROM court_records WHERE fetched_at < ?').run(cutoff);
      if (deleted.changes > 0) {
        console.log(`[Court Records] Cache cleanup: removed ${deleted.changes} stale entries`);
      }
    } catch { /* ignore */ }
  }, 12 * 60 * 60 * 1000); // Every 12 hours

  if (cleanupTimer.unref) cleanupTimer.unref();
}

export function stopCourtRecordsScan(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
