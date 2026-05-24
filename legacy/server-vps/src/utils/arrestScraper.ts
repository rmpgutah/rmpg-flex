// ============================================================
// JailBase Arrest Record Scraper & Local Search Engine
// ============================================================
// Fetches county jail arrest/booking records from JailBase via
// RapidAPI, stores them locally in SQLite, and cross-links them
// against existing warrants, court events, and known persons.
//
// Hourly sync fetches recent bookings for all enabled Utah
// counties. On-demand search also hits the live API and caches.
//
// JailBase API (RapidAPI):
//   GET /recent?source_id={id}  — Recent arrests by county
//   GET /search?name={name}     — Search by name
//   GET /sources                — List available data sources
//
// NOTE: As of early 2026, the JailBase upstream API appears to be
// offline (jailbase.com now serves a blank Strapi instance).
// All endpoints return 404. The code is kept intact in case the
// service is restored, but the sync scheduler will detect the outage
// and surface a clear message in the admin panel.
// ============================================================

import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import crypto from 'crypto';
import config from '../config';

// ── Constants ───────────────────────────────────────────────
const JAILBASE_HOST = 'jailbase-jailbase.p.rapidapi.com';
const JAILBASE_BASE = `https://${JAILBASE_HOST}`;

// Sync every hour
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

// Stagger between county fetches to respect rate limits
const COUNTY_FETCH_DELAY_MS = 2_000;

// Request settings
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3_000;

let syncIntervalHandle: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;
// Backoff: 1h → 2h → 4h → 8h → 24h max. After 24 consecutive failures (~3 days), switch to once-daily.
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
const DAILY_CHECK_THRESHOLD = 24;  // After this many failures, only check once per day

// ── Encryption (same as microbilt.ts) ───────────────────────

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

function decrypt(stored: string): string {
  const key = deriveKey();
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Config helpers ──────────────────────────────────────────

const CONFIG_KEYS = {
  apiKey: 'jailbase_rapidapi_key',
  enabled: 'jailbase_enabled',
  enabledCounties: 'jailbase_enabled_counties',
} as const;

function getConfigValue(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

function getDecryptedValue(key: string): string | null {
  const val = getConfigValue(key);
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

function getApiKey(): string | null {
  return getDecryptedValue(CONFIG_KEYS.apiKey);
}

function isEnabled(): boolean {
  return getConfigValue(CONFIG_KEYS.enabled) === 'true';
}

function getEnabledCounties(): string[] {
  const val = getConfigValue(CONFIG_KEYS.enabledCounties);
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}

// ── Default Utah county sources ─────────────────────────────
// JailBase source IDs for Utah counties.
// These are discovered via the /sources endpoint and can be
// overridden through the admin panel.

export const UTAH_COUNTY_DEFAULTS: { name: string; sourceId: string }[] = [
  { name: 'Salt Lake County', sourceId: 'ut-slco' },
  { name: 'Utah County', sourceId: 'ut-utco' },
  { name: 'Davis County', sourceId: 'ut-daco' },
  { name: 'Weber County', sourceId: 'ut-weco' },
  { name: 'Cache County', sourceId: 'ut-caco' },
  { name: 'Washington County', sourceId: 'ut-waco' },
  { name: 'Iron County', sourceId: 'ut-irco' },
  { name: 'Box Elder County', sourceId: 'ut-beco' },
  { name: 'Tooele County', sourceId: 'ut-toco' },
  { name: 'Summit County', sourceId: 'ut-suco' },
  { name: 'Uintah County', sourceId: 'ut-uico' },
  { name: 'Sanpete County', sourceId: 'ut-snco' },
  { name: 'Sevier County', sourceId: 'ut-seco' },
  { name: 'Grand County', sourceId: 'ut-grco' },
  { name: 'Beaver County', sourceId: 'ut-bvco' },
  { name: 'Duchesne County', sourceId: 'ut-duco' },
  { name: 'Carbon County', sourceId: 'ut-crco' },
  { name: 'Emery County', sourceId: 'ut-emco' },
  { name: 'Juab County', sourceId: 'ut-juco' },
  { name: 'Millard County', sourceId: 'ut-mlco' },
  { name: 'Morgan County', sourceId: 'ut-moco' },
  { name: 'Rich County', sourceId: 'ut-rico' },
  { name: 'San Juan County', sourceId: 'ut-sjco' },
  { name: 'Wasatch County', sourceId: 'ut-wsco' },
  { name: 'Wayne County', sourceId: 'ut-wyco' },
  { name: 'Garfield County', sourceId: 'ut-gaco' },
  { name: 'Kane County', sourceId: 'ut-kaco' },
  { name: 'Piute County', sourceId: 'ut-pico' },
  { name: 'Daggett County', sourceId: 'ut-dgco' },
];

// ── JailBase API caller ─────────────────────────────────────

interface JailBaseRecord {
  id?: string;
  name?: string;
  date?: string;          // Booking date
  charges?: string[];
  mugshot?: string;
  details?: string;       // URL
  more_info_url?: string;
  source?: string;
  book_date_formatted?: string;
  // Additional fields JailBase may return
  [key: string]: any;
}

interface JailBaseResponse {
  status?: number;
  records?: JailBaseRecord[];
  total_records?: number;
  next_page?: string;
  error?: string;
}

async function callJailBase(
  endpoint: string,
  params: Record<string, string>,
  apiKey: string,
  retries = 0,
): Promise<JailBaseResponse> {
  const url = new URL(`${JAILBASE_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': JAILBASE_HOST,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 403) {
      // 403 = auth failure — never retry, clear diagnostic message
      throw new Error(
        'JailBase API returned 403 Forbidden. Your RapidAPI key may be invalid, expired, or the JailBase API subscription is inactive. ' +
        'Visit https://rapidapi.com/jailbase/api/jailbase to verify your subscription status.'
      );
    }

    if (res.status === 429 && retries < MAX_RETRIES) {
      // Rate limited — wait and retry
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (retries + 1)));
      return callJailBase(endpoint, params, apiKey, retries + 1);
    }

    if (res.status === 404) {
      // 404 on all endpoints means the JailBase API is offline/deprecated
      throw new Error(
        'JailBase API returned 404 Not Found. The JailBase service appears to be offline or deprecated. ' +
        'All endpoints are returning 404, which indicates the upstream API is no longer available. ' +
        'Check https://rapidapi.com/jailbase/api/jailbase for current status. ' +
        'Existing cached records remain searchable.'
      );
    }

    if (!res.ok) {
      throw new Error(`JailBase API error: ${res.status} ${res.statusText}`);
    }

    return await res.json() as JailBaseResponse;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      if (retries < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        return callJailBase(endpoint, params, apiKey, retries + 1);
      }
      throw new Error('JailBase request timed out');
    }
    throw err;
  }
}

// ── Name splitting ──────────────────────────────────────────

function splitName(fullName: string): { first: string; middle: string; last: string } {
  const cleaned = (fullName || '').trim();
  if (!cleaned) return { first: '', middle: '', last: '' };

  // Handle "LAST, FIRST MIDDLE" format
  if (cleaned.includes(',')) {
    const [last, rest] = cleaned.split(',', 2).map(s => s.trim());
    const parts = (rest || '').split(/\s+/);
    return {
      first: parts[0] || '',
      middle: parts.slice(1).join(' '),
      last,
    };
  }

  // Handle "FIRST MIDDLE LAST" format
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return {
    first: parts[0],
    middle: parts.slice(1, -1).join(' '),
    last: parts[parts.length - 1],
  };
}

// ── Parse & upsert arrest records ───────────────────────────

function parseAndUpsert(records: JailBaseRecord[], sourceId: string, sourceName: string): number {
  const db = getDb();
  const now = localNow();

  // Extract county from source name (e.g. "Salt Lake County Sheriff, UT" → "Salt Lake")
  const county = sourceName.replace(/\s*(County|Sheriff|Jail|Police|Department|,\s*UT).*$/gi, '').trim();

  const upsert = db.prepare(`
    INSERT INTO arrest_records (jailbase_id, source_id, source_name, full_name, first_name, last_name, middle_name,
      date_of_birth, booking_date, charges, mugshot_url, details_url, county, status, raw_record, fetched_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(jailbase_id, source_id) DO UPDATE SET
      full_name=excluded.full_name, first_name=excluded.first_name, last_name=excluded.last_name,
      booking_date=excluded.booking_date, charges=excluded.charges, mugshot_url=excluded.mugshot_url,
      details_url=excluded.details_url, status='active', raw_record=excluded.raw_record, updated_at=excluded.updated_at
  `);

  let count = 0;
  const upsertTx = db.transaction(() => {
    for (const rec of records) {
      const jailbaseId = rec.id || `${sourceId}-${crypto.createHash('md5').update((rec.name || '') + (rec.date || '')).digest('hex').slice(0, 12)}`;
      const { first, middle, last } = splitName(rec.name || '');
      const charges = rec.charges ? JSON.stringify(rec.charges) : '[]';
      const bookingDate = rec.book_date_formatted || rec.date || null;

      upsert.run(
        jailbaseId, sourceId, sourceName,
        rec.name || 'UNKNOWN',
        first, last, middle,
        null, // DOB not always in JailBase
        bookingDate,
        charges,
        rec.mugshot || null,
        rec.more_info_url || rec.details || null,
        county,
        JSON.stringify(rec),
        now, now,
      );
      count++;
    }
  });
  upsertTx();

  return count;
}

// ── Cross-linking engine ────────────────────────────────────

export function crossLinkArrests(): { warrants: number; courtEvents: number; persons: number } {
  const db = getDb();
  const now = localNow();
  let warrants = 0, courtEvents = 0, persons = 0;

  // Get arrest records that haven't been cross-linked yet
  const unchecked = db.prepare(`
    SELECT ar.id, ar.first_name, ar.last_name, ar.date_of_birth
    FROM arrest_records ar
    LEFT JOIN arrest_cross_links acl ON acl.arrest_record_id = ar.id
    WHERE acl.id IS NULL AND ar.last_name IS NOT NULL AND ar.last_name != ''
  `).all() as { id: number; first_name: string; last_name: string; date_of_birth: string | null }[];

  if (unchecked.length === 0) return { warrants, courtEvents, persons };

  const insertLink = db.prepare(`
    INSERT OR IGNORE INTO arrest_cross_links (arrest_record_id, linked_type, linked_id, match_type, match_confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const linkTx = db.transaction(() => {
    for (const arrest of unchecked) {
      if (!arrest.first_name || !arrest.last_name) continue;

      // 1. Check local warrants (active) — join through persons table
      try {
        const warrantMatches = db.prepare(`
          SELECT w.id FROM warrants w
          JOIN persons p ON w.subject_person_id = p.id
          WHERE w.status = 'active'
            AND UPPER(p.last_name) = UPPER(?)
            AND UPPER(p.first_name) = UPPER(?)
        `).all(arrest.last_name, arrest.first_name) as { id: number }[];

        for (const wm of warrantMatches) {
          insertLink.run(arrest.id, 'warrant', wm.id, 'name', 0.8, now);
          warrants++;
        }
      } catch (e: any) { console.warn('[ArrestCrossLink] Warrant check failed:', e?.message); }

      // 2. Check Utah state warrants
      try {
        const utahMatches = db.prepare(`
          SELECT id FROM utah_warrants
          WHERE UPPER(last_name) = UPPER(?)
            AND UPPER(first_name) = UPPER(?)
        `).all(arrest.last_name, arrest.first_name) as { id: number }[];

        for (const um of utahMatches) {
          insertLink.run(arrest.id, 'utah_warrant', um.id, 'name', 0.75, now);
          warrants++;
        }
      } catch (e: any) { console.warn('[ArrestCrossLink] Utah warrant check failed:', e?.message); }

      // 3. Check court events by defendant_name
      try {
        const courtMatches = db.prepare(`
          SELECT id FROM court_events
          WHERE UPPER(defendant_name) LIKE '%' || UPPER(?) || '%'
            AND UPPER(defendant_name) LIKE '%' || UPPER(?) || '%'
        `).all(arrest.last_name, arrest.first_name) as { id: number }[];

        for (const cm of courtMatches) {
          insertLink.run(arrest.id, 'court_event', cm.id, 'name', 0.6, now);
          courtEvents++;
        }
      } catch (e: any) { console.warn('[ArrestCrossLink] Court event check failed:', e?.message); }

      // 4. Check known persons
      try {
        const personMatches = db.prepare(`
          SELECT id FROM persons
          WHERE UPPER(last_name) = UPPER(?)
            AND UPPER(first_name) = UPPER(?)
        `).all(arrest.last_name, arrest.first_name) as { id: number }[];

        for (const pm of personMatches) {
          insertLink.run(arrest.id, 'person', pm.id, 'name', 0.7, now);
          persons++;
        }
      } catch (e: any) { console.warn('[ArrestCrossLink] Person check failed:', e?.message); }
    }
  });
  linkTx();

  return { warrants, courtEvents, persons };
}

// ── Hourly Sync ─────────────────────────────────────────────

export async function syncArrestData(): Promise<{
  totalRecords: number;
  countiesSynced: number;
  crossLinks: { warrants: number; courtEvents: number; persons: number };
  duration: number;
}> {
  const startTime = Date.now();
  const db = getDb();
  const now = localNow();
  let totalRecords = 0;
  let countiesSynced = 0;
  let errorMessage: string | null = null;

  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('JailBase API key not configured');
    }

    if (!isEnabled()) {
      throw new Error('JailBase integration is disabled');
    }

    const enabledCounties = getEnabledCounties();
    const sources = enabledCounties.length > 0
      ? UTAH_COUNTY_DEFAULTS.filter(c => enabledCounties.includes(c.sourceId))
      : UTAH_COUNTY_DEFAULTS; // If none explicitly enabled, try all

    console.log(`[Arrest Sync] Starting sync for ${sources.length} Utah counties...`);

    let consecutive404s = 0;
    const MAX_CONSECUTIVE_404 = 3; // If first 3 counties all 404, the API is down

    for (const source of sources) {
      try {
        const data = await callJailBase('/recent', {
          source_id: source.sourceId,
        }, apiKey);

        consecutive404s = 0; // Reset on success

        if (data.records && data.records.length > 0) {
          const count = parseAndUpsert(data.records, source.sourceId, source.name);
          totalRecords += count;
          console.log(`[Arrest Sync]   ${source.name}: ${count} records`);
        }

        countiesSynced++;

        // Stagger requests to avoid rate limiting
        if (sources.indexOf(source) < sources.length - 1) {
          await new Promise(r => setTimeout(r, COUNTY_FETCH_DELAY_MS));
        }
      } catch (err: any) {
        // Detect API-wide outage: if first N counties all return 404, stop immediately
        if (err.message.includes('404')) {
          consecutive404s++;
          if (consecutive404s >= MAX_CONSECUTIVE_404) {
            console.warn(`[Arrest Sync] JailBase API appears offline — ${consecutive404s} consecutive 404 errors. Aborting sync. Cached records remain searchable.`);
            throw new Error(
              'JailBase API is offline — all endpoints returning 404. ' +
              'The upstream JailBase service appears to be deprecated or temporarily down. ' +
              'Cached arrest records remain available for local search.'
            );
          }
        }

        // Log per-county errors but continue with other counties
        console.warn(`[Arrest Sync]   ${source.name}: FAILED — ${err.message}`);
        if (err.message.includes('429') || err.message.includes('rate')) {
          // Rate limited — increase delay for remaining counties
          await new Promise(r => setTimeout(r, COUNTY_FETCH_DELAY_MS * 3));
        }
      }
    }

    // Run cross-linking after all counties synced
    const crossLinks = crossLinkArrests();
    if (crossLinks.warrants + crossLinks.courtEvents + crossLinks.persons > 0) {
      console.log(`[Arrest Sync] Cross-links: ${crossLinks.warrants} warrants, ${crossLinks.courtEvents} court events, ${crossLinks.persons} persons`);
    }

    const duration = Date.now() - startTime;

    // Log success
    db.prepare(`
      INSERT INTO arrest_sync_log (source_id, records_count, counties_synced, status, duration_ms, synced_at)
      VALUES (NULL, ?, ?, 'success', ?, ?)
    `).run(totalRecords, countiesSynced, duration, now);

    console.log(`[Arrest Sync] Complete: ${totalRecords} records from ${countiesSynced} counties in ${duration}ms`);

    return { totalRecords, countiesSynced, crossLinks, duration };

  } catch (err: any) {
    errorMessage = err.message;
    const duration = Date.now() - startTime;

    db.prepare(`
      INSERT INTO arrest_sync_log (source_id, records_count, counties_synced, status, error_message, duration_ms, synced_at)
      VALUES (NULL, ?, ?, 'error', ?, ?, ?)
    `).run(totalRecords, countiesSynced, errorMessage, duration, now);

    console.error(`[Arrest Sync] Failed: ${errorMessage}`);
    return { totalRecords, countiesSynced, crossLinks: { warrants: 0, courtEvents: 0, persons: 0 }, duration };
  }
}

// ── On-demand search ────────────────────────────────────────

export async function searchArrestsLive(name: string): Promise<{
  hit: boolean;
  records: any[];
  resultCount: number;
  cached: boolean;
}> {
  const apiKey = getApiKey();
  if (!apiKey) {
    // Fall back to cache only
    return searchArrestsCache(name);
  }

  try {
    const data = await callJailBase('/search', { name }, apiKey);

    if (data.records && data.records.length > 0) {
      // Cache results — use 'search' as pseudo source_id
      for (const rec of data.records) {
        const sourceId = rec.source || 'search';
        const sourceName = rec.source || 'JailBase Search';
        parseAndUpsert([rec], sourceId, sourceName);
      }
    }

    // Now query from local cache (enriched with cross-links)
    return searchArrestsCache(name);
  } catch (err: any) {
    console.warn(`[Arrest Search] Live search failed for "${name}": ${err.message}`);
    // Fall back to cache
    return searchArrestsCache(name);
  }
}

export function searchArrestsCache(name: string): {
  hit: boolean;
  records: any[];
  resultCount: number;
  cached: boolean;
} {
  const db = getDb();

  // Split search name
  const parts = name.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return { hit: false, records: [], resultCount: 0, cached: true };

  let query: string;
  let params: string[];

  if (parts.length === 1) {
    // Single name — search last_name or full_name
    query = `
      SELECT ar.*, GROUP_CONCAT(acl.linked_type || ':' || acl.linked_id || ':' || acl.match_confidence, '|') as cross_link_data
      FROM arrest_records ar
      LEFT JOIN arrest_cross_links acl ON acl.arrest_record_id = ar.id
      WHERE UPPER(ar.last_name) = UPPER(?) OR UPPER(ar.first_name) = UPPER(?) OR UPPER(ar.full_name) LIKE ?
      GROUP BY ar.id
      ORDER BY ar.booking_date DESC
      LIMIT 25
    `;
    params = [parts[0], parts[0], `%${parts[0]}%`];
  } else {
    // Two+ names — try FIRST LAST and LAST FIRST
    const a = parts[0], b = parts[parts.length - 1];
    query = `
      SELECT ar.*, GROUP_CONCAT(acl.linked_type || ':' || acl.linked_id || ':' || acl.match_confidence, '|') as cross_link_data
      FROM arrest_records ar
      LEFT JOIN arrest_cross_links acl ON acl.arrest_record_id = ar.id
      WHERE (UPPER(ar.first_name) = UPPER(?) AND UPPER(ar.last_name) = UPPER(?))
         OR (UPPER(ar.first_name) = UPPER(?) AND UPPER(ar.last_name) = UPPER(?))
         OR (UPPER(ar.full_name) LIKE ? AND UPPER(ar.full_name) LIKE ?)
      GROUP BY ar.id
      ORDER BY ar.booking_date DESC
      LIMIT 25
    `;
    params = [a, b, b, a, `%${a}%`, `%${b}%`];
  }

  const rows = db.prepare(query).all(...params) as any[];

  // Enrich with cross-link details
  const records = rows.map(row => enrichWithCrossLinks(row));

  return {
    hit: records.length > 0,
    records,
    resultCount: records.length,
    cached: true,
  };
}

export async function searchArrests(name: string): Promise<{
  hit: boolean;
  records: any[];
  resultCount: number;
  cached: boolean;
}> {
  // Try live first (which also caches), fall back to cache
  if (isEnabled() && getApiKey()) {
    return searchArrestsLive(name);
  }
  return searchArrestsCache(name);
}

// ── Enrich records with cross-link details ──────────────────

function enrichWithCrossLinks(row: any): any {
  const db = getDb();
  const record: any = {
    id: row.id,
    full_name: row.full_name,
    first_name: row.first_name,
    last_name: row.last_name,
    middle_name: row.middle_name,
    date_of_birth: row.date_of_birth,
    booking_date: row.booking_date,
    release_date: row.release_date,
    charges: [],
    county: row.county,
    source_name: row.source_name,
    mugshot_url: row.mugshot_url,
    status: row.status,
    // Manual booking fields
    booking_number: row.booking_number || null,
    agency: row.agency || null,
    gender: row.gender || null,
    race: row.race || null,
    height: row.height || null,
    weight: row.weight || null,
    hair_color: row.hair_color || null,
    eye_color: row.eye_color || null,
    address: row.address || null,
    bail_amount: row.bail_amount || null,
    hold_reason: row.hold_reason || null,
    notes: row.notes || null,
    entry_source: row.entry_source || 'api',
    cross_links: { warrants: [], court_events: [], persons: [] },
  };

  // Parse charges JSON
  try {
    record.charges = JSON.parse(row.charges || '[]');
  } catch (e: any) { console.warn('[Arrest] Charges parse failed:', e?.message); record.charges = []; }

  // Get cross-link details
  const links = db.prepare(`
    SELECT linked_type, linked_id, match_confidence FROM arrest_cross_links
    WHERE arrest_record_id = ?
  `).all(row.id) as { linked_type: string; linked_id: number; match_confidence: number }[];

  for (const link of links) {
    try {
      if (link.linked_type === 'warrant') {
        const w = db.prepare(`
          SELECT warrant_number, charge_description, status, bail_amount FROM warrants WHERE id = ?
        `).get(link.linked_id) as any;
        if (w) record.cross_links.warrants.push(w);
      } else if (link.linked_type === 'utah_warrant') {
        const uw = db.prepare(`
          SELECT utah_warrant_id as warrant_number, charges as charge_description, 'active' as status FROM utah_warrants WHERE id = ?
        `).get(link.linked_id) as any;
        if (uw) record.cross_links.warrants.push(uw);
      } else if (link.linked_type === 'court_event') {
        const ce = db.prepare(`
          SELECT event_number, event_type, court_name, event_date FROM court_events WHERE id = ?
        `).get(link.linked_id) as any;
        if (ce) record.cross_links.court_events.push(ce);
      } else if (link.linked_type === 'person') {
        const p = db.prepare(`
          SELECT id, first_name, last_name FROM persons WHERE id = ?
        `).get(link.linked_id) as any;
        if (p) record.cross_links.persons.push(p);
      }
    } catch (e: any) { console.warn('[Arrest] Cross-link lookup failed:', e?.message); }
  }

  return record;
}

// ── Sync Status ─────────────────────────────────────────────

export function getArrestSyncStatus(): {
  lastSync: string | null;
  recordsCount: number;
  countiesSynced: number;
  status: string;
  lastError: string | null;
} {
  const db = getDb();

  const lastLog = db.prepare(
    "SELECT status, records_count, counties_synced, error_message, synced_at FROM arrest_sync_log ORDER BY id DESC LIMIT 1"
  ).get() as { status: string; records_count: number; counties_synced: number; error_message: string | null; synced_at: string } | undefined;

  const recordCount = (db.prepare('SELECT COUNT(*) as count FROM arrest_records').get() as any)?.count || 0;

  return {
    lastSync: lastLog?.synced_at || null,
    recordsCount: recordCount,
    countiesSynced: lastLog?.counties_synced || 0,
    status: lastLog?.status || 'never_synced',
    lastError: lastLog?.status === 'error' ? lastLog.error_message : null,
  };
}

export function isArrestDataStale(): boolean {
  const db = getDb();
  const lastSuccess = db.prepare(
    "SELECT synced_at FROM arrest_sync_log WHERE status = 'success' ORDER BY id DESC LIMIT 1"
  ).get() as { synced_at: string } | undefined;

  if (!lastSuccess) return true;

  const lastSyncTime = new Date(lastSuccess.synced_at).getTime();
  return Date.now() - lastSyncTime > SYNC_INTERVAL_MS;
}

// ── Usage Stats ─────────────────────────────────────────────

export function getArrestUsageStats(): {
  totalRecords: number;
  totalCounties: number;
  totalSyncs: number;
  last30DaysSyncs: number;
  crossLinkCounts: { warrants: number; courtEvents: number; persons: number };
  recentSyncs: { synced_at: string; records_count: number; counties_synced: number; status: string }[];
} {
  const db = getDb();

  const totalRecords = (db.prepare('SELECT COUNT(*) as c FROM arrest_records').get() as any)?.c || 0;
  const totalCounties = (db.prepare('SELECT COUNT(DISTINCT source_id) as c FROM arrest_records').get() as any)?.c || 0;
  const totalSyncs = (db.prepare('SELECT COUNT(*) as c FROM arrest_sync_log').get() as any)?.c || 0;
  const last30 = (db.prepare("SELECT COUNT(*) as c FROM arrest_sync_log WHERE synced_at > datetime('now', '-30 days')").get() as any)?.c || 0;

  const warrantLinks = (db.prepare("SELECT COUNT(*) as c FROM arrest_cross_links WHERE linked_type IN ('warrant','utah_warrant')").get() as any)?.c || 0;
  const courtLinks = (db.prepare("SELECT COUNT(*) as c FROM arrest_cross_links WHERE linked_type = 'court_event'").get() as any)?.c || 0;
  const personLinks = (db.prepare("SELECT COUNT(*) as c FROM arrest_cross_links WHERE linked_type = 'person'").get() as any)?.c || 0;

  const recentSyncs = db.prepare(
    "SELECT synced_at, records_count, counties_synced, status FROM arrest_sync_log ORDER BY id DESC LIMIT 24"
  ).all() as any[];

  return {
    totalRecords,
    totalCounties,
    totalSyncs,
    last30DaysSyncs: last30,
    crossLinkCounts: { warrants: warrantLinks, courtEvents: courtLinks, persons: personLinks },
    recentSyncs,
  };
}

// ── County record counts ────────────────────────────────────

export function getCountyRecordCounts(): { sourceId: string; name: string; count: number }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT source_id, source_name, COUNT(*) as count
    FROM arrest_records
    GROUP BY source_id
    ORDER BY count DESC
  `).all() as { source_id: string; source_name: string; count: number }[];

  return rows.map(r => ({ sourceId: r.source_id, name: r.source_name, count: r.count }));
}

// ── Scheduler (with exponential backoff) ─────────────────────

function getBackoffMs(): number {
  if (consecutiveFailures === 0) return SYNC_INTERVAL_MS;
  // Exponential: 1h, 2h, 4h, 8h, capped at 24h
  const backoff = SYNC_INTERVAL_MS * Math.pow(2, Math.min(consecutiveFailures - 1, 5));
  return Math.min(backoff, MAX_BACKOFF_MS);
}

function formatInterval(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 24) return '24h';
  if (hours >= 1) return `${hours.toFixed(0)}h`;
  return `${(ms / 60000).toFixed(0)}m`;
}

function scheduleNextSync(): void {
  const delay = getBackoffMs();
  syncIntervalHandle = setTimeout(async () => {
    try {
      if (!isEnabled() || !getApiKey()) {
        scheduleNextSync(); // Keep checking but don't sync
        return;
      }

      // Suppress verbose logging after many failures — only log every 24th attempt
      const isQuiet = consecutiveFailures >= DAILY_CHECK_THRESHOLD;
      if (!isQuiet) {
        console.log('[Arrest Sync] Scheduled sync...');
      }

      await syncArrestData();

      // Success — reset backoff
      if (consecutiveFailures > 0) {
        console.log(`[Arrest Sync] Recovered after ${consecutiveFailures} consecutive failure(s)`);
      }
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      const nextDelay = getBackoffMs();

      if (consecutiveFailures <= 3) {
        // First few failures: log normally
        console.error('[Arrest Sync] Scheduled sync failed:', (err as Error).message);
        console.log(`[Arrest Sync] Next retry in ${formatInterval(nextDelay)} (failure #${consecutiveFailures})`);
      } else if (consecutiveFailures === DAILY_CHECK_THRESHOLD) {
        // Threshold: log once that we're switching to daily checks
        console.warn(
          `[Arrest Sync] ${consecutiveFailures} consecutive failures — switching to daily checks. ` +
          'Upstream API appears offline. Cached records remain searchable.'
        );
      }
      // After threshold: silent (no logging on every attempt)
    }

    // Schedule the next run
    if (syncIntervalHandle !== null) {
      scheduleNextSync();
    }
  }, delay);
  if (syncIntervalHandle && syncIntervalHandle.unref) syncIntervalHandle.unref();
}

export function scheduleArrestSync(): void {
  if (syncIntervalHandle) return; // Already running

  // Restore backoff state from DB so server restarts don't reset the counter
  try {
    const db = getDb();
    const recentFails = db.prepare(
      "SELECT COUNT(*) as c FROM arrest_sync_log WHERE status = 'error' AND id > COALESCE((SELECT MAX(id) FROM arrest_sync_log WHERE status = 'success'), 0)"
    ).get() as { c: number };
    if (recentFails.c > 0) {
      consecutiveFailures = recentFails.c;
    }
  } catch { /* DB not ready yet — start fresh */ }

  if (consecutiveFailures >= DAILY_CHECK_THRESHOLD) {
    console.log(`[Arrest Sync] Scheduler starting — upstream API offline (${consecutiveFailures} failures), checking daily`);
  } else if (consecutiveFailures > 0) {
    console.log(`[Arrest Sync] Scheduler starting — resuming backoff (${consecutiveFailures} prior failures, next in ${formatInterval(getBackoffMs())})`);
  } else {
    console.log('[Arrest Sync] Scheduler starting — will sync hourly (with backoff on failures)');
  }

  // Check on startup if data is stale (wait 20s to avoid blocking startup)
  setTimeout(async () => {
    try {
      if (!isEnabled() || !getApiKey()) {
        console.log('[Arrest Sync] Not configured — skipping initial sync (configure in Admin > Integrations > Arrest Records)');
        scheduleNextSync();
        return;
      }

      // If already in deep backoff, skip the initial sync attempt
      if (consecutiveFailures >= DAILY_CHECK_THRESHOLD) {
        const status = getArrestSyncStatus();
        console.log(`[Arrest Sync] Skipping initial sync — upstream offline. Cached: ${status.recordsCount} records`);
        scheduleNextSync();
        return;
      }

      if (isArrestDataStale()) {
        console.log('[Arrest Sync] Data is stale or missing — triggering initial sync...');
        await syncArrestData();
        consecutiveFailures = 0;
      } else {
        const status = getArrestSyncStatus();
        console.log(`[Arrest Sync] Data is current (${status.recordsCount} records, last sync: ${status.lastSync})`);
      }
    } catch (err) {
      consecutiveFailures++;
      console.error(`[Arrest Sync] Initial sync failed — next retry in ${formatInterval(getBackoffMs())}:`, (err as Error).message);
    }

    scheduleNextSync();
  }, 20_000);
}

export function stopArrestSync(): void {
  if (syncIntervalHandle) {
    clearTimeout(syncIntervalHandle);
    syncIntervalHandle = null;
    consecutiveFailures = 0;
    console.log('[Arrest Sync] Scheduler stopped');
  }
}

// ── Discover available sources ──────────────────────────────

export async function discoverUtahSources(): Promise<{ name: string; sourceId: string }[]> {
  const apiKey = getApiKey();
  if (!apiKey) return UTAH_COUNTY_DEFAULTS;

  try {
    const data = await callJailBase('/sources', { state: 'UT' }, apiKey);
    if (data.records && data.records.length > 0) {
      return data.records.map((r: any) => ({
        name: r.name || r.source_name || 'Unknown',
        sourceId: r.source_id || r.id || '',
      })).filter((s: any) => s.sourceId);
    }
  } catch (err: any) {
    console.warn('[Arrest Sync] Failed to discover sources:', err.message);
  }

  return UTAH_COUNTY_DEFAULTS;
}
