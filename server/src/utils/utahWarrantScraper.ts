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

import * as https from 'node:https';
import * as http from 'node:http';
import * as url from 'node:url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { escapeLike } from '../middleware/sanitize';

// ── Proxy config (set WARRANT_PROXY_URL in .env to route via proxy) ──────────
// Format: http://user:pass@host:port  OR  socks5://user:pass@host:port
const PROXY_URL = process.env.WARRANT_PROXY_URL || null;
const proxyAgent: https.Agent | null = PROXY_URL
  ? new HttpsProxyAgent(PROXY_URL)
  : null;

if (PROXY_URL) {
  console.log(`[Utah Warrants] Proxy enabled: ${PROXY_URL.replace(/:\/\/[^@]+@/, '://***@')}`);
}

// ── IP rotation — rotates X-Forwarded-For on each request ────────────────────
// Residential IP ranges (Comcast, Charter, AT&T, Cox, Xfinity Utah)
function _r(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
const IP_GENERATORS: (() => string)[] = [
  () => `73.${_r(1, 254)}.${_r(1, 254)}.${_r(1, 254)}`,    // Comcast
  () => `24.${_r(1, 254)}.${_r(1, 254)}.${_r(1, 254)}`,    // Charter/Spectrum
  () => `99.${_r(1, 254)}.${_r(1, 254)}.${_r(1, 254)}`,    // AT&T
  () => `68.${_r(1, 254)}.${_r(1, 254)}.${_r(1, 254)}`,    // Cox
  () => `71.${_r(1, 254)}.${_r(1, 254)}.${_r(1, 254)}`,    // Comcast West
  () => `75.${_r(1, 254)}.${_r(1, 254)}.${_r(1, 254)}`,    // Xfinity Utah
];
function randomForwardedIp(): string {
  return IP_GENERATORS[Math.floor(Math.random() * IP_GENERATORS.length)]();
}

// ── API endpoints ────────────────────────────────────────────
const BASE_URL = 'https://warrants.utah.gov/api/v1';
const PERSONS_URL = `${BASE_URL}/persons`;
const WARRANTS_URL = (personId: string) => `${BASE_URL}/persons/${personId}/warrants`;

// ── Config ───────────────────────────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_TIMEOUT_MS = 15_000;          // 15 second timeout per request
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

// Adaptive rate-limit tracker — increases delay when 403s are detected
let _consecutiveRateLimits = 0;
let _lastRateLimitAt = 0;

/** Get current scan delay based on rate-limit history */
export function getAdaptiveScanDelay(): number {
  const base = 5000; // 5 second base delay (was 3s — too aggressive)
  if (_consecutiveRateLimits === 0) return base;
  // Exponential backoff: 5s → 10s → 20s → 40s, capped at 60s
  return Math.min(base * Math.pow(2, _consecutiveRateLimits), 60_000);
}

function onRateLimit(): void {
  _consecutiveRateLimits = Math.min(_consecutiveRateLimits + 1, 5);
  _lastRateLimitAt = Date.now();
}

function onSuccess(): void {
  // Decay rate-limit counter after sustained success
  if (_consecutiveRateLimits > 0 && Date.now() - _lastRateLimitAt > 30_000) {
    _consecutiveRateLimits = Math.max(0, _consecutiveRateLimits - 1);
  }
}

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

// Track if our IP is blocked by CloudFront WAF
let _ipBlocked = false;
let _ipBlockedUntil = 0;
const IP_BLOCK_COOLDOWN_MS = 4 * 60 * 60 * 1000; // Wait 4h before retrying after IP block (CloudFront blocks typically last this long)

/** Check if we're currently IP-blocked */
export function isUtahApiBlocked(): boolean {
  if (!_ipBlocked) return false;
  if (Date.now() > _ipBlockedUntil) {
    _ipBlocked = false;
    console.log('[Utah Warrants] IP block cooldown expired — will retry on next request');
    return false;
  }
  return true;
}

/** Manually clear the in-memory IP block — call from admin endpoint when VPS is unblocked */
export function clearUtahApiBlock(): void {
  _ipBlocked = false;
  _ipBlockedUntil = 0;
  _consecutiveRateLimits = 0;
  console.log('[Utah Warrants] IP block manually cleared by admin');
}

/** Make an HTTPS request, routing through proxy if WARRANT_PROXY_URL is set */
function httpsRequest(
  targetUrl: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(targetUrl);
    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method,
      headers,
      agent: proxyAgent || undefined,
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode ?? 0,
          text: () => Promise.resolve(rawBody),
        });
      });
      res.on('error', reject);
    });

    req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchJson<T>(targetUrl: string, options: RequestInit, retries = MAX_RETRIES): Promise<T | null> {
  // Skip if IP is currently blocked
  if (isUtahApiBlocked()) return null;

  const forwardedIp = randomForwardedIp();

  const headers: Record<string, string> = {
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
    // NOTE: Do NOT send CF-Connecting-IP, True-Client-IP, or X-Real-IP to CloudFront.
    // Those are headers that CloudFront *sets* on requests it forwards to the origin —
    // sending them in an outgoing request to CloudFront triggers managed WAF injection
    // rules and causes a persistent IP block. X-Forwarded-For is safe to include.
    'X-Forwarded-For': forwardedIp,
    ...((options.headers as Record<string, string>) || {}),
  };

  const bodyStr = options.body ? String(options.body) : undefined;
  const method = (options.method || 'GET').toUpperCase();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await httpsRequest(targetUrl, method, headers, bodyStr);

      if (res.status === 200 || res.status === 201) {
        onSuccess();
        const text = await res.text();
        return JSON.parse(text) as T;
      }

      if (res.status === 403) {
        const bodyText = await res.text();
        const isCloudFrontBlock = bodyText.includes('cloudfront') || bodyText.includes('CloudFront');

        if (isCloudFrontBlock) {
          console.error(`[Utah Warrants] CloudFront WAF blocked our IP — entering ${IP_BLOCK_COOLDOWN_MS / 60000} min cooldown`);
          _ipBlocked = true;
          _ipBlockedUntil = Date.now() + IP_BLOCK_COOLDOWN_MS;
          return null;
        }

        onRateLimit();
        const backoff = getAdaptiveScanDelay();
        if (attempt < retries) {
          console.warn(`[Utah Warrants] 403 rate-limited (forwarded=${forwardedIp}) — backing off ${(backoff / 1000).toFixed(0)}s (attempt ${attempt + 1}/${retries})`);
          await sleep(backoff);
          continue;
        }
      }

      console.warn(`[Utah Warrants] HTTP ${res.status} from ${targetUrl}`);
      return null;
    } catch (err: any) {
      if (err.message === 'Request timeout') {
        console.warn(`[Utah Warrants] Request timeout for ${targetUrl}`);
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
): Promise<UtahWarrantResult[] | null> {
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

  // null = API failure (timeout/error) — caller must not treat as "no warrants"
  if (personData === null) return null;

  if (!personData?.persons?.length) return [];

  // Step 2: For each person, fetch their warrants
  let anyWarrantFetchFailed = false;
  for (const person of personData.persons) {
    const warrantData = await fetchJson<{ warrants?: UtahApiWarrant[] }>(
      WARRANTS_URL(person.id),
      { method: 'GET' }
    );

    if (warrantData === null) {
      anyWarrantFetchFailed = true;
      continue; // Skip this person's warrants — don't treat as empty
    }

    if (warrantData?.warrants?.length) {
      for (const w of warrantData.warrants) {
        results.push({
          utah_person_id: person.id,
          first_name: person.name.first || '',
          middle_name: person.name.middle || null,
          last_name: person.name.last || '',
          age: person.age != null ? (parseInt(String(person.age), 10) || null) : null,
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

  // If any warrant fetch failed, flag partial data — caller must not
  // use partial results to mark warrants as cleared
  if (anyWarrantFetchFailed && results.length === 0) {
    return null;
  }

  // Step 3: Cache results locally for repeat lookups
  if (results.length > 0) {
    cacheResults(results);
  }

  // Attach partial failure flag so callers know data may be incomplete
  if (anyWarrantFetchFailed && results.length > 0) {
    (results as any).__hasPartialErrors = true;
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
      const p0 = escapeLike(parts[0]);
      const p1 = escapeLike(parts[1]);
      rows = db.prepare(`
        SELECT utah_person_id, first_name, middle_name, last_name, age, city,
               utah_warrant_id, issue_date, court_name, case_id, charges, fetched_at
        FROM utah_warrants
        WHERE (first_name LIKE ? ESCAPE '\\' AND last_name LIKE ? ESCAPE '\\')
           OR (first_name LIKE ? ESCAPE '\\' AND last_name LIKE ? ESCAPE '\\')
        ORDER BY last_name, first_name
        LIMIT ?
      `).all(
        `%${p0}%`, `%${p1}%`,
        `%${p1}%`, `%${p0}%`,
        limit
      ) as UtahWarrantResult[];
    } else {
      const p0 = escapeLike(parts[0]);
      rows = db.prepare(`
        SELECT utah_person_id, first_name, middle_name, last_name, age, city,
               utah_warrant_id, issue_date, court_name, case_id, charges, fetched_at
        FROM utah_warrants
        WHERE first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\'
        ORDER BY last_name, first_name
        LIMIT ?
      `).all(`%${p0}%`, `%${p0}%`, limit) as UtahWarrantResult[];
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
    if (liveResults && liveResults.length > 0) return liveResults;

    // Try reversed "last first" ordering
    const reversedResults = await searchUtahWarrantsLive(parts[parts.length - 1], parts[0]);
    if (reversedResults && reversedResults.length > 0) return reversedResults;
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

/** Base delay between person searches (adaptive backoff applies on top) */
const SCAN_DELAY_MS = 5000;

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
let _scanInProgress = false;

export async function runWarrantWatchScan(): Promise<{
  personsChecked: number;
  newWarrants: number;
  clearedWarrants: number;
  errors: number;
}> {
  if (_scanInProgress) {
    console.warn('[Warrant Watch] Scan already in progress, skipping');
    return { personsChecked: 0, newWarrants: 0, clearedWarrants: 0, errors: 0 };
  }
  _scanInProgress = true;
  try {
    return await _runWarrantWatchScanImpl();
  } finally {
    _scanInProgress = false;
  }
}

async function _runWarrantWatchScanImpl(): Promise<{
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

        // null = API failure — skip this person entirely (don't clear their warrants)
        if (results === null) {
          errors++;
          continue;
        }

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

        // Check for CLEARED warrants — only if we got results that matched this person's name.
        // If the API returned zero name-matched results, the warrant may still be active
        // but not returned due to API inconsistency — do NOT clear in that case.
        const previouslyKnown = warrantsByPerson.get(person.id);
        if (previouslyKnown && foundWarrantIds.size > 0) {
          // We found at least one warrant for this person — safe to check for clears
          for (const prevWarrantId of previouslyKnown) {
            if (!foundWarrantIds.has(prevWarrantId)) {
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
        } else if (previouslyKnown && foundWarrantIds.size === 0 && results.length > 0) {
          // API returned results but none matched this person's name — possible name mismatch, skip clearing
          console.log(`[Warrant Watch] ⚠️  SKIP CLEAR: ${personName} — API returned ${results.length} results but none matched name, keeping ${previouslyKnown.size} existing warrants`);
        }

        // Adaptive throttle — slows down when 403s are detected
        if (personsChecked < persons.length) {
          const delay = Math.max(SCAN_DELAY_MS, getAdaptiveScanDelay());
          await sleep(delay);
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

/** Scan interval — every 6 hours (reduced from 4h to respect Utah API limits) */
const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Startup delay before first scan — 90 seconds (let other services start first) */
const SCAN_STARTUP_DELAY_MS = 90_000;

let scanInterval: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

export function scheduleUtahWarrantSync(): void {
  console.log('[Utah Warrants] Live search mode active — queries warrants.utah.gov on demand');
  console.log('[Warrant Watch] Automated bulk scan enabled — runs every 6 hours');

  // Initial scan after startup delay
  startupTimer = setTimeout(async () => {
    console.log('[Warrant Watch] Running initial warrant scan...');
    await runWarrantWatchScan();

    // Then schedule hourly recurring scans
    scanInterval = setInterval(() => {
      console.log('[Warrant Watch] Starting 6-hour warrant scan...');
      runWarrantWatchScan().catch(err => console.error('[Warrant Watch] Scan error:', err.message || err));
    }, SCAN_INTERVAL_MS);

    if (scanInterval.unref) scanInterval.unref();
  }, SCAN_STARTUP_DELAY_MS);

  if (startupTimer.unref) startupTimer.unref();

  // Clean up stale cache entries older than 7 days every 6 hours
  cleanupIntervalHandle = setInterval(() => {
    try {
      const db = getDb();
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = db.prepare('DELETE FROM utah_warrants WHERE fetched_at < ?').run(cutoff);
      if (deleted.changes > 0) {
        console.log(`[Utah Warrants] Cache cleanup: removed ${deleted.changes} stale entries`);
      }
    } catch (e: any) { console.warn('[Utah Warrants] Cleanup error:', e?.message); }
  }, 6 * 60 * 60 * 1000);

  if (cleanupIntervalHandle.unref) cleanupIntervalHandle.unref();
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
  if (cleanupIntervalHandle) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
  }
}
