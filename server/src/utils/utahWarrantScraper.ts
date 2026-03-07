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

// ── Scheduler (no-op — live search doesn't need bulk sync) ───

export function scheduleUtahWarrantSync(): void {
  console.log('[Utah Warrants] Real-time search mode — queries warrants.utah.gov live on demand');
  console.log('[Utah Warrants] No bulk sync needed — results are always current');

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

  // Don't prevent process exit
  if (cleanupInterval.unref) cleanupInterval.unref();
}

export function stopUtahWarrantSync(): void {
  // No-op for real-time mode
}
