// ============================================================
// Utah State Warrants — Real-Time Search Proxy
// ============================================================
// Searches warrants.utah.gov's public API in real-time when a
// dispatcher queries a name. The API requires BOTH first and
// last name (no bulk download possible), so we proxy live
// queries and cache results locally for faster repeat lookups.
//
// Flow:
//   1. User searches "KARL TURLEY" in Warrants page or NCIC QW
//   2. Server queries warrants.utah.gov/api/v1/persons (POST)
//   3. For each person returned, fetches their warrants (GET)
//   4. Results cached in utah_warrants table for 24h
//   5. Fresh results returned to user immediately
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';

// ── API endpoints ────────────────────────────────────────────
const BASE_URL = 'https://warrants.utah.gov/api/v1';
const PERSONS_URL = `${BASE_URL}/persons`;
const WARRANTS_URL = (personId: string) => `${BASE_URL}/persons/${personId}/warrants`;

// ── Config ───────────────────────────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_TIMEOUT_MS = 10_000;          // 10 second timeout per request
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

// ── Types ────────────────────────────────────────────────────

interface UtahApiPerson {
  id: string;
  name: { first: string; middle: string; last: string };
  homeAddress?: { city: string };
  age?: number | string;
}

interface UtahApiWarrant {
  id: string;
  issueDate: string;
  court: { name: string; caseId: string };
  charges: string[];
}

export interface UtahWarrantResult {
  utah_person_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  age: number | null;
  city: string | null;
  utah_warrant_id: string;
  issue_date: string | null;
  court_name: string | null;
  case_id: string | null;
  charges: string | null; // JSON array string
  fetched_at?: string;
  source?: string;
}

// ── Helpers ──────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Origin': 'https://warrants.utah.gov',
          'Referer': 'https://warrants.utah.gov/',
          'sec-ch-ua': '"Chromium";v="122", "Google Chrome";v="122"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          ...(options.headers || {}),
        },
      });

      clearTimeout(timeout);

      if (res.ok || res.status === 201) {
        return await res.json() as T;
      }

      if (res.status === 403 && attempt < retries) {
        console.warn(`[Utah Warrants] 403 rate-limited — retrying in ${RETRY_DELAY_MS / 1000}s`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      console.warn(`[Utah Warrants] HTTP ${res.status} from ${url}`);
      return null;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn(`[Utah Warrants] Request timeout for ${url}`);
      } else if (attempt < retries) {
        await sleep(RETRY_DELAY_MS);
        continue;
      } else {
        console.warn(`[Utah Warrants] Fetch error: ${err.message}`);
      }
      return null;
    }
  }
  return null;
}

// ── Core: Live search warrants.utah.gov ──────────────────────

export async function searchUtahWarrantsLive(
  firstName: string,
  lastName: string
): Promise<UtahWarrantResult[]> {
  if (!firstName.trim() || !lastName.trim()) return [];

  const results: UtahWarrantResult[] = [];

  // Step 1: Search for persons matching this name
  const personData = await fetchJson<{ persons?: UtahApiPerson[] }>(PERSONS_URL, {
    method: 'POST',
    body: JSON.stringify({
      name: {
        first: firstName.trim().toUpperCase(),
        last: lastName.trim().toUpperCase(),
      },
    }),
  });

  if (!personData?.persons?.length) return [];

  // Step 2: For each person, fetch their warrants
  for (const person of personData.persons) {
    const warrantData = await fetchJson<{ warrants?: UtahApiWarrant[] }>(
      WARRANTS_URL(person.id),
      { method: 'GET' }
    );

    if (warrantData?.warrants?.length) {
      for (const w of warrantData.warrants) {
        results.push({
          utah_person_id: person.id,
          first_name: person.name.first || '',
          middle_name: person.name.middle || null,
          last_name: person.name.last || '',
          age: person.age ? parseInt(String(person.age), 10) || null : null,
          city: person.homeAddress?.city || null,
          utah_warrant_id: w.id,
          issue_date: w.issueDate || null,
          court_name: w.court?.name || null,
          case_id: w.court?.caseId || null,
          charges: JSON.stringify(w.charges || []),
          source: 'UTAH_STATE',
        });
      }
    }
  }

  // Step 3: Cache results locally for repeat lookups
  if (results.length > 0) {
    cacheResults(results);
  }

  return results;
}

// ── Cache management ─────────────────────────────────────────

function cacheResults(results: UtahWarrantResult[]): void {
  try {
    const db = getDb();
    const now = localNow();

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO utah_warrants
        (utah_person_id, first_name, middle_name, last_name, age, city,
         utah_warrant_id, issue_date, court_name, case_id, charges, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const cacheTransaction = db.transaction(() => {
      for (const r of results) {
        // Delete old entries for this person before inserting fresh ones
        db.prepare('DELETE FROM utah_warrants WHERE utah_person_id = ?').run(r.utah_person_id);
      }
      for (const r of results) {
        insertStmt.run(
          r.utah_person_id, r.first_name, r.middle_name, r.last_name,
          r.age, r.city, r.utah_warrant_id, r.issue_date,
          r.court_name, r.case_id, r.charges, now
        );
      }
    });

    cacheTransaction();
  } catch (err: any) {
    console.warn('[Utah Warrants] Cache write failed:', err.message);
  }
}

// ── Search cached Utah warrants (fallback / offline) ─────────

export function searchUtahWarrantsCache(
  name: string,
  options?: { limit?: number }
): UtahWarrantResult[] {
  try {
    const db = getDb();
    const limit = options?.limit ?? 50;

    const parts = name.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length === 0) return [];

    let rows: UtahWarrantResult[];

    if (parts.length >= 2) {
      rows = db.prepare(`
        SELECT utah_person_id, first_name, middle_name, last_name, age, city,
               utah_warrant_id, issue_date, court_name, case_id, charges, fetched_at
        FROM utah_warrants
        WHERE (first_name LIKE ? AND last_name LIKE ?)
           OR (first_name LIKE ? AND last_name LIKE ?)
        ORDER BY last_name, first_name
        LIMIT ?
      `).all(
        `%${parts[0]}%`, `%${parts[1]}%`,
        `%${parts[1]}%`, `%${parts[0]}%`,
        limit
      ) as UtahWarrantResult[];
    } else {
      rows = db.prepare(`
        SELECT utah_person_id, first_name, middle_name, last_name, age, city,
               utah_warrant_id, issue_date, court_name, case_id, charges, fetched_at
        FROM utah_warrants
        WHERE first_name LIKE ? OR last_name LIKE ?
        ORDER BY last_name, first_name
        LIMIT ?
      `).all(`%${parts[0]}%`, `%${parts[0]}%`, limit) as UtahWarrantResult[];
    }

    return rows;
  } catch {
    return [];
  }
}

// ── Combined search: live first, cache fallback ──────────────

export async function searchUtahWarrants(
  query: string
): Promise<UtahWarrantResult[]> {
  const parts = query.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return [];

  // Need at least first + last name for live search
  if (parts.length >= 2) {
    // Try "first last" ordering
    const liveResults = await searchUtahWarrantsLive(parts[0], parts[parts.length - 1]);
    if (liveResults.length > 0) return liveResults;

    // Try reversed "last first" ordering
    const reversedResults = await searchUtahWarrantsLive(parts[parts.length - 1], parts[0]);
    if (reversedResults.length > 0) return reversedResults;
  }

  // Fall back to cache if live search fails or only one name part
  return searchUtahWarrantsCache(query);
}

// ── Status info ──────────────────────────────────────────────

export function getUtahWarrantSyncStatus(): {
  lastSync: string | null;
  warrantCount: number;
  status: string;
  lastError: string | null;
} {
  try {
    const db = getDb();

    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM utah_warrants').get() as { cnt: number };

    // Find the most recent cached entry
    const latest = db.prepare(
      'SELECT fetched_at FROM utah_warrants ORDER BY fetched_at DESC LIMIT 1'
    ).get() as { fetched_at: string } | undefined;

    return {
      lastSync: latest?.fetched_at || null,
      warrantCount: countRow.cnt,
      status: countRow.cnt > 0 ? 'live_search' : 'ready',
      lastError: null,
    };
  } catch {
    return { lastSync: null, warrantCount: 0, status: 'ready', lastError: null };
  }
}

// ══════════════════════════════════════════════════════════════
// WARRANT WATCH — Automated Bulk Scan
// ══════════════════════════════════════════════════════════════
// Runs every hour for officer safety.
// Iterates every person in the persons table, queries Utah
// warrants API, logs NEW hits and CLEARED warrants.
// ══════════════════════════════════════════════════════════════

/** Delay between person searches to avoid rate-limiting (3 seconds) */
const SCAN_DELAY_MS = 3000;

/** Generate a unique run ID for each scan */
function generateRunId(): string {
  return `SCAN-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
}

/**
 * Run a full warrant watch scan against all persons in the database.
 * For each person with a first + last name, queries warrants.utah.gov
 * and compares results against the previous scan to detect new warrants
 * and cleared warrants.
 */
export async function runWarrantWatchScan(): Promise<{
  personsChecked: number;
  newWarrants: number;
  clearedWarrants: number;
  errors: number;
}> {
  const db = getDb();
  const now = localNow();
  const runId = generateRunId();

  // Create scan run record
  db.prepare(`
    INSERT INTO warrant_watch_runs (run_id, started_at, status)
    VALUES (?, ?, 'running')
  `).run(runId, now);

  console.log(`[Warrant Watch] ═══ Starting bulk scan ${runId} ═══`);

  let personsChecked = 0;
  let newWarrants = 0;
  let clearedWarrants = 0;
  let errors = 0;

  try {
    // Get all persons with first + last name (required by Utah API)
    // Include DOB for age-based verification to reduce false positive warrant matches
    const persons = db.prepare(`
      SELECT id, first_name, last_name, dob
      FROM persons
      WHERE first_name IS NOT NULL AND first_name != ''
        AND last_name IS NOT NULL AND last_name != ''
        AND archived_at IS NULL
      ORDER BY last_name, first_name
    `).all() as { id: number; first_name: string; last_name: string; dob: string | null }[];

    console.log(`[Warrant Watch] Scanning ${persons.length} persons against warrants.utah.gov`);

    // Get all currently-known warrant matches from previous scans
    // (most recent warrant_found event per person that hasn't been cleared)
    const previousHits = db.prepare(`
      SELECT DISTINCT person_id, utah_warrant_id
      FROM warrant_watch_log
      WHERE event = 'warrant_found'
        AND NOT EXISTS (
          SELECT 1 FROM warrant_watch_log wl2
          WHERE wl2.person_id = warrant_watch_log.person_id
            AND wl2.utah_warrant_id = warrant_watch_log.utah_warrant_id
            AND wl2.event = 'warrant_cleared'
            AND wl2.created_at > warrant_watch_log.created_at
        )
    `).all() as { person_id: number; utah_warrant_id: string }[];

    // Build a Set of "personId:warrantId" for fast lookup
    const activeWarrantKeys = new Set(
      previousHits.map(h => `${h.person_id}:${h.utah_warrant_id}`)
    );

    // Build a Map of personId → Set<warrantId> for cleared-warrant detection
    const warrantsByPerson = new Map<number, Set<string>>();
    for (const h of previousHits) {
      if (!warrantsByPerson.has(h.person_id)) warrantsByPerson.set(h.person_id, new Set());
      warrantsByPerson.get(h.person_id)!.add(h.utah_warrant_id);
    }

    // Prepared statements for logging
    const insertLog = db.prepare(`
      INSERT INTO warrant_watch_log
        (person_id, person_name, event, utah_warrant_id, utah_person_id,
         court_name, case_id, charges, issue_date, scan_run_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const person of persons) {
      try {
        const results = await searchUtahWarrantsLive(person.first_name, person.last_name);
        personsChecked++;

        const personName = `${person.first_name} ${person.last_name}`;

        // Track which warrants we found this scan for this person
        const foundWarrantIds = new Set<string>();

        for (const r of results) {
          // Name matching (case-insensitive)
          const nameMatch =
            r.first_name.toUpperCase() === person.first_name.toUpperCase() &&
            r.last_name.toUpperCase() === person.last_name.toUpperCase();

          if (!nameMatch) continue;

          // DOB verification — if both records have DOB, require match to reduce false positives
          if (person.dob && r.age != null) {
            // Utah API returns age, not DOB directly. Verify age matches ±1 year
            const personDob = new Date(person.dob);
            if (!isNaN(personDob.getTime())) {
              const now = new Date();
              const expectedAge = now.getFullYear() - personDob.getFullYear();
              const ageDiff = Math.abs(expectedAge - r.age);
              if (ageDiff > 1) {
                // Age mismatch by more than 1 year — likely a different person
                continue;
              }
            }
          }

          foundWarrantIds.add(r.utah_warrant_id);

          const key = `${person.id}:${r.utah_warrant_id}`;
          if (!activeWarrantKeys.has(key)) {
            // NEW warrant found
            insertLog.run(
              person.id, personName, 'warrant_found',
              r.utah_warrant_id, r.utah_person_id,
              r.court_name, r.case_id, r.charges, r.issue_date,
              runId, now
            );
            activeWarrantKeys.add(key);
            newWarrants++;
            console.log(`[Warrant Watch] 🔴 NEW WARRANT: ${personName} — ${r.court_name} (${r.utah_warrant_id})`);
          }
        }

        // Check for CLEARED warrants (previously active but no longer returned)
        const previouslyKnown = warrantsByPerson.get(person.id);
        if (previouslyKnown) {
          for (const prevWarrantId of previouslyKnown) {
            if (!foundWarrantIds.has(prevWarrantId)) {
              // Warrant was cleared / no longer active
              insertLog.run(
                person.id, personName, 'warrant_cleared',
                prevWarrantId, null,
                null, null, null, null,
                runId, now
              );
              clearedWarrants++;
              console.log(`[Warrant Watch] 🟢 CLEARED: ${personName} — warrant ${prevWarrantId} no longer active`);
            }
          }
        }

        // Throttle to avoid rate-limiting
        if (personsChecked < persons.length) {
          await sleep(SCAN_DELAY_MS);
        }
      } catch (err: any) {
        errors++;
        console.warn(`[Warrant Watch] Error scanning ${person.first_name} ${person.last_name}: ${err.message}`);
      }
    }

    // Update scan run record
    db.prepare(`
      UPDATE warrant_watch_runs
      SET completed_at = ?, persons_checked = ?, new_warrants_found = ?,
          warrants_cleared = ?, errors = ?, status = 'completed'
      WHERE run_id = ?
    `).run(localNow(), personsChecked, newWarrants, clearedWarrants, errors, runId);

    console.log(`[Warrant Watch] ═══ Scan complete: ${personsChecked} checked, ${newWarrants} new, ${clearedWarrants} cleared, ${errors} errors ═══`);

  } catch (err: any) {
    console.error(`[Warrant Watch] Scan failed:`, err.message);
    db.prepare(`
      UPDATE warrant_watch_runs
      SET completed_at = ?, persons_checked = ?, new_warrants_found = ?,
          warrants_cleared = ?, errors = ?, status = 'failed', error_message = ?
      WHERE run_id = ?
    `).run(localNow(), personsChecked, newWarrants, clearedWarrants, errors, err.message, runId);
  }

  return { personsChecked, newWarrants, clearedWarrants, errors };
}

// ── Scheduler ────────────────────────────────────────────────
// Runs warrant watch scan every hour for maximum officer safety.
// Also cleans up stale cache entries every 6 hours.

/** Hourly scan interval — 60 minutes */
const SCAN_INTERVAL_MS = 60 * 60 * 1000;

/** Startup delay before first scan — 90 seconds (let other services start first) */
const SCAN_STARTUP_DELAY_MS = 90_000;

let scanInterval: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleUtahWarrantSync(): void {
  console.log('[Utah Warrants] Live search mode active — queries warrants.utah.gov on demand');
  console.log('[Warrant Watch] Automated bulk scan enabled — runs every hour for officer safety');

  // Initial scan after startup delay
  startupTimer = setTimeout(async () => {
    console.log('[Warrant Watch] Running initial warrant scan...');
    await runWarrantWatchScan();

    // Then schedule hourly recurring scans
    scanInterval = setInterval(async () => {
      console.log('[Warrant Watch] Starting hourly warrant scan...');
      await runWarrantWatchScan();
    }, SCAN_INTERVAL_MS);

    if (scanInterval.unref) scanInterval.unref();
  }, SCAN_STARTUP_DELAY_MS);

  if (startupTimer.unref) startupTimer.unref();

  // Clean up stale cache entries older than 7 days every 6 hours
  const cleanupInterval = setInterval(() => {
    try {
      const db = getDb();
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = db.prepare('DELETE FROM utah_warrants WHERE fetched_at < ?').run(cutoff);
      if (deleted.changes > 0) {
        console.log(`[Utah Warrants] Cache cleanup: removed ${deleted.changes} stale entries`);
      }
    } catch { /* ignore cleanup errors */ }
  }, 6 * 60 * 60 * 1000);

  if (cleanupInterval.unref) cleanupInterval.unref();
}

export function stopUtahWarrantSync(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}
