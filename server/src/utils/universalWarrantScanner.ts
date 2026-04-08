// ── Universal Warrant Scanner ────────────────────────────────
// Single entry-point to check ALL warrant sources for a person,
// auto-create local warrant records, and flag persons.

import { getDb } from '../models/database';
import { searchUtahWarrantsLive, getAdaptiveScanDelay } from './utahWarrantScraper';
import { broadcast } from './websocket';
import { localNow } from './timeUtils';

// ── Types ────────────────────────────────────────────────────

export interface ScanResult {
  personId: number;
  personName: string;
  hitsFound: number;
  warrantsCreated: number;
  warrantsCleared: number;
  errors: string[];
}

export interface ScanSummary {
  personsChecked: number;
  hitsFound: number;
  warrantsCreated: number;
  warrantsCleared: number;
  errors: string[];
}

interface UnifiedHit {
  external_warrant_id: string;
  external_source_key: string;
  source: 'utah_api' | 'scraper';
  charge_description: string;
  warrant_type: string;
  issuing_court: string | null;
  bail_amount: number | null;
  offense_level: string | null;
}

// Cooldown tracker: personId → last check timestamp (ms)
const lastCheckMap = new Map<number, number>();
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 5000;

// Periodically prune stale entries to prevent unbounded memory growth
function pruneLastCheckMap(): void {
  if (lastCheckMap.size <= MAX_CACHE_SIZE) return;
  const cutoff = Date.now() - COOLDOWN_MS;
  for (const [key, ts] of lastCheckMap) {
    if (ts < cutoff) lastCheckMap.delete(key);
  }
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Infer warrant type from charge description text.
 */
export function inferWarrantType(charge: string): string {
  const lower = (charge || '').toLowerCase();
  if (/bench|fta|failure\s+to\s+appear/i.test(lower)) return 'bench';
  if (/search/i.test(lower)) return 'search';
  if (/civil|eviction/i.test(lower)) return 'civil';
  return 'arrest';
}

/**
 * Infer offense level from charge description text.
 */
function inferOffenseLevel(charge: string): string {
  const lower = (charge || '').toLowerCase();
  if (/felony|f[1-3]/i.test(lower)) return 'felony';
  if (/misdemeanor|class\s+[abc]/i.test(lower)) return 'misdemeanor';
  if (/infraction/i.test(lower)) return 'infraction';
  return 'misdemeanor';
}

const SEVERITY_ORDER: Record<string, number> = {
  felony: 4,
  misdemeanor: 3,
  infraction: 2,
  civil: 1,
  unknown: 0,
};

function highestSeverity(levels: string[]): string {
  let best = 'unknown';
  let bestRank = 0;
  for (const lvl of levels) {
    const rank = SEVERITY_ORDER[lvl] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = lvl;
    }
  }
  return best;
}

/**
 * Generate warrant number from a rowid in EXT-YYYY-NNNNN format.
 * Called AFTER insert using lastInsertRowid to avoid race conditions.
 */
function extWarrantNumber(rowId: number | bigint): string {
  const year = new Date().getFullYear();
  return `EXT-${year}-${String(rowId).padStart(5, '0')}`;
}

/**
 * Check if DOB/age match within tolerance.
 * personDob is "YYYY-MM-DD" string, apiAge is approximate age number.
 */
function dobAgeMatch(personDob: string | null, apiAge: number | null): boolean {
  if (!personDob || apiAge === null || apiAge === undefined) return true; // no data to compare → don't exclude
  const dobYear = new Date(personDob).getFullYear();
  const currentYear = new Date().getFullYear();
  const personAge = currentYear - dobYear;
  return Math.abs(personAge - apiAge) <= 1;
}

// ── updatePersonWarrantFlag ──────────────────────────────────

export function updatePersonWarrantFlag(personId: number): void {
  const db = getDb();
  const now = localNow();

  // Count active warrants for this person
  const activeWarrants = db.prepare(
    `SELECT offense_level FROM warrants WHERE subject_person_id = ? AND status = 'active'`
  ).all(personId) as { offense_level: string | null }[];

  // Parse existing flags
  const person = db.prepare(`SELECT flags FROM persons WHERE id = ?`).get(personId) as { flags: string | null } | undefined;
  if (!person) return;

  let flags: Array<Record<string, unknown>> = [];
  try {
    flags = JSON.parse(person.flags || '[]');
    if (!Array.isArray(flags)) flags = [];
  } catch {
    flags = [];
  }

  // Remove old ACTIVE_WARRANT entries
  flags = flags.filter((f) => f.type !== 'ACTIVE_WARRANT');

  if (activeWarrants.length > 0) {
    const levels = activeWarrants.map((w) => w.offense_level || 'unknown');
    const severity = highestSeverity(levels);
    flags.push({
      type: 'ACTIVE_WARRANT',
      severity,
      count: activeWarrants.length,
      updated_at: now,
    });
  }

  db.prepare(`UPDATE persons SET flags = ? WHERE id = ?`).run(JSON.stringify(flags), personId);
}

// ── universalWarrantCheck ────────────────────────────────────

export async function universalWarrantCheck(
  personId: number,
  force = false
): Promise<ScanResult> {
  const db = getDb();
  const now = localNow();
  const errors: string[] = [];
  let hitsFound = 0;
  let warrantsCreated = 0;
  let warrantsCleared = 0;

  // Cooldown check
  pruneLastCheckMap();
  if (!force) {
    const lastTs = lastCheckMap.get(personId);
    if (lastTs) {
      const elapsed = Date.now() - lastTs;
      if (elapsed < COOLDOWN_MS) {
        return { personId, personName: '', hitsFound: 0, warrantsCreated: 0, warrantsCleared: 0, errors: [] };
      }
    }
  }

  // Load person
  const person = db.prepare(
    `SELECT id, first_name, last_name, dob, archived_at FROM persons WHERE id = ?`
  ).get(personId) as { id: number; first_name: string; last_name: string; dob: string | null; archived_at: string | null } | undefined;

  if (!person) {
    return { personId, personName: 'Unknown', hitsFound: 0, warrantsCreated: 0, warrantsCleared: 0, errors: ['Person not found'] };
  }

  const personName = `${person.first_name} ${person.last_name}`;

  if (person.archived_at) {
    return { personId, personName, hitsFound: 0, warrantsCreated: 0, warrantsCleared: 0, errors: ['Person is archived'] };
  }

  if (!person.first_name?.trim() || !person.last_name?.trim()) {
    return { personId, personName, hitsFound: 0, warrantsCreated: 0, warrantsCleared: 0, errors: ['Missing name'] };
  }

  // ── Collect unified hits from all sources ──────────────────
  const allHits = new Map<string, UnifiedHit>();
  let sourceErrors = false;

  // Source 1: Utah API
  try {
    const utahResults = await searchUtahWarrantsLive(person.first_name, person.last_name);

    if (utahResults === null) {
      // API failure — don't clear warrants later
      sourceErrors = true;
      errors.push('Utah API unavailable');
    } else {
      for (const r of utahResults) {
        // Name match: case-insensitive
        if (
          r.first_name.toLowerCase() !== person.first_name.toLowerCase() ||
          r.last_name.toLowerCase() !== person.last_name.toLowerCase()
        ) {
          continue;
        }

        // DOB/age verification
        if (!dobAgeMatch(person.dob, r.age)) continue;

        // Parse charges (JSON array string)
        let charges: string[] = [];
        try {
          charges = r.charges ? JSON.parse(r.charges) : [];
        } catch {
          charges = r.charges ? [r.charges] : [];
        }

        const chargeDesc = charges.join('; ') || 'Warrant (no charge details)';
        const extId = `utah_api:${r.utah_warrant_id}`;

        if (!allHits.has(extId)) {
          allHits.set(extId, {
            external_warrant_id: extId,
            external_source_key: 'utah_api',
            source: 'utah_api',
            charge_description: chargeDesc,
            warrant_type: inferWarrantType(chargeDesc),
            issuing_court: r.court_name || null,
            bail_amount: null,
            offense_level: inferOffenseLevel(chargeDesc),
          });
        }
      }
    }
  } catch (err: unknown) {
    sourceErrors = true;
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Utah API error: ${msg}`);
  }

  // Source 2: Scraped warrants DB
  try {
    const scraped = db.prepare(
      `SELECT * FROM scraped_warrants
       WHERE (person_id = ? OR (LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)))
         AND status = 'active'`
    ).all(personId, person.first_name, person.last_name) as Array<{
      warrant_id: string;
      source_key: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      warrant_type: string | null;
      charge_description: string | null;
      court_name: string | null;
      case_number: string | null;
      issue_date: string | null;
      bail_amount: string | null;
      offense_level: string | null;
      status: string | null;
      person_id: number | null;
    }>;

    for (const s of scraped) {
      const extId = `scraper:${s.source_key}:${s.warrant_id}`;
      if (!allHits.has(extId)) {
        const chargeDesc = s.charge_description || 'Warrant (scraped)';
        allHits.set(extId, {
          external_warrant_id: extId,
          external_source_key: s.source_key,
          source: 'scraper',
          charge_description: chargeDesc,
          warrant_type: s.warrant_type || inferWarrantType(chargeDesc),
          issuing_court: s.court_name || null,
          bail_amount: s.bail_amount ? parseFloat(s.bail_amount) : null,
          offense_level: s.offense_level || inferOffenseLevel(chargeDesc),
        });
      }
    }
  } catch (err: unknown) {
    sourceErrors = true;
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Scraped warrants error: ${msg}`);
  }

  hitsFound = allHits.size;

  // ── Create new warrant records ─────────────────────────────
  const insertStmt = db.prepare(
    `INSERT INTO warrants (
      warrant_number, type, status, subject_person_id, charge_description,
      issuing_court, bail_amount, offense_level, entered_by, notes,
      source, external_warrant_id, external_source_key, auto_created,
      created_at, updated_at
    ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)`
  );

  for (const [extId, hit] of allHits) {
    // Check if already exists
    const existing = db.prepare(
      `SELECT id FROM warrants WHERE external_warrant_id = ?`
    ).get(extId) as { id: number } | undefined;

    if (!existing) {
      const info = insertStmt.run(
        '__PENDING__',
        hit.warrant_type,
        personId,
        hit.charge_description,
        hit.issuing_court,
        hit.bail_amount,
        hit.offense_level,
        `Auto-created by universal warrant scanner from ${hit.source}`,
        hit.source,
        hit.external_warrant_id,
        hit.external_source_key,
        now,
        now
      );
      // Derive warrant number from the actual row ID (race-safe)
      const warrantNum = extWarrantNumber(info.lastInsertRowid);
      db.prepare('UPDATE warrants SET warrant_number = ? WHERE id = ?').run(warrantNum, info.lastInsertRowid);
      warrantsCreated++;

      broadcast('alerts', 'warrant', {
        action: 'hit',
        personId,
        personName,
        warrantNumber: warrantNum,
        source: hit.source,
        charge: hit.charge_description,
        severity: hit.offense_level,
      });
    }
  }

  // ── Clear check ────────────────────────────────────────────
  // Only if no source errors — don't clear warrants when we can't confirm they're gone
  if (!sourceErrors) {
    const currentExtIds = Array.from(allHits.keys());
    const placeholders = currentExtIds.map(() => '?').join(',');

    let clearQuery: string;
    let clearParams: unknown[];

    if (currentExtIds.length > 0) {
      clearQuery = `SELECT id, warrant_number, external_warrant_id FROM warrants
        WHERE subject_person_id = ? AND auto_created = 1 AND status = 'active'
          AND external_warrant_id IS NOT NULL
          AND external_warrant_id NOT IN (${placeholders})`;
      clearParams = [personId, ...currentExtIds];
    } else {
      clearQuery = `SELECT id, warrant_number, external_warrant_id FROM warrants
        WHERE subject_person_id = ? AND auto_created = 1 AND status = 'active'
          AND external_warrant_id IS NOT NULL`;
      clearParams = [personId];
    }

    const toRecall = db.prepare(clearQuery).all(...clearParams) as Array<{
      id: number;
      warrant_number: string;
      external_warrant_id: string;
    }>;

    if (toRecall.length > 0) {
      const recallStmt = db.prepare(
        `UPDATE warrants SET status = 'recalled', updated_at = ? WHERE id = ?`
      );
      for (const w of toRecall) {
        recallStmt.run(now, w.id);
        warrantsCleared++;

        broadcast('alerts', 'warrant', {
          action: 'cleared',
          personId,
          personName,
          warrantNumber: w.warrant_number,
          externalWarrantId: w.external_warrant_id,
        });
      }
    }
  }

  // ── Update person flags ────────────────────────────────────
  updatePersonWarrantFlag(personId);

  // Only stamp cooldown if at least one source responded successfully
  if (!sourceErrors) {
    lastCheckMap.set(personId, Date.now());
  }

  return { personId, personName, hitsFound, warrantsCreated, warrantsCleared, errors };
}

// ── runUniversalWarrantScan ──────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let _universalScanInProgress = false;

export async function runUniversalWarrantScan(): Promise<ScanSummary> {
  if (_universalScanInProgress) {
    console.warn('[WarrantScanner] Scan already in progress, skipping');
    return { personsChecked: 0, hitsFound: 0, warrantsCreated: 0, warrantsCleared: 0, errors: ['Scan already in progress'] };
  }
  _universalScanInProgress = true;

  try {
  const db = getDb();

  // Clean up any stuck "running" warrant watch runs from previous crashes
  try {
    const stuck = db.prepare(
      `UPDATE warrant_watch_runs SET status = 'failed', error_message = 'Server restarted during scan', completed_at = datetime('now')
       WHERE status = 'running'`
    ).run();
    if (stuck.changes > 0) {
      console.log(`[WarrantScanner] Cleaned up ${stuck.changes} stuck scan runs`);
    }
  } catch {}

  console.log('[WarrantScanner] Starting universal warrant scan...');

  const persons = db.prepare(
    `SELECT id FROM persons
     WHERE archived_at IS NULL
       AND first_name IS NOT NULL AND first_name != ''
       AND last_name IS NOT NULL AND last_name != ''`
  ).all() as { id: number }[];

  console.log(`[WarrantScanner] ${persons.length} persons to check`);

  const summary: ScanSummary = {
    personsChecked: 0,
    hitsFound: 0,
    warrantsCreated: 0,
    warrantsCleared: 0,
    errors: [],
  };

  for (const p of persons) {
    try {
      const result = await universalWarrantCheck(p.id, true);
      summary.personsChecked++;
      summary.hitsFound += result.hitsFound;
      summary.warrantsCreated += result.warrantsCreated;
      summary.warrantsCleared += result.warrantsCleared;
      if (result.errors.length) {
        summary.errors.push(...result.errors.map((e) => `Person ${p.id}: ${e}`));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`Person ${p.id}: ${msg}`);
    }

    // Adaptive rate limit — slows down when Utah API returns 403s
    const delay = Math.max(5000, getAdaptiveScanDelay());
    await sleep(delay);
  }

  console.log(
    `[WarrantScanner] Scan complete — ${summary.personsChecked} checked, ` +
    `${summary.hitsFound} hits, ${summary.warrantsCreated} created, ` +
    `${summary.warrantsCleared} cleared, ${summary.errors.length} errors`
  );

  return summary;
  } finally {
    _universalScanInProgress = false;
  }
}
