// Multi-source warrant scan orchestrator (Task 12 — the integration linchpin).
//
// Runs the LIVE Utah pipeline UNCHANGED (delegating to runUtahWarrantScan) and,
// alongside it, scans every ENABLED non-Utah (scraped) source against the local
// persons roster, persists raw hits to scraped_warrants, reconciles cross-source
// duplicates per person, and promotes CONFIRMED canonical hits into the canonical
// `warrants` records table.
//
// Hard separation of concerns:
//   - Utah ('api' kind) is owned end-to-end by utahWarrantPoller.ts. We call it
//     as-is and EXCLUDE it from the scraped leg so it is never double-run.
//   - Scraped sources (html/browser/portal kinds) flow through this file's
//     generic store + reconcile + local promotion helpers.
//
// The promotion + watch-log helpers below are LOCAL re-implementations that
// MIRROR the poller's syncLocalWarrantRecord / logWatchEvent. The poller's
// versions are intentionally NOT exported and NOT modified — keeping the Utah
// path byte-identical is the #1 rule of this task.
//
// Order: scraped leg runs FIRST (cheap DB roster read + per-source pacing),
// then the Utah leg. Either way both run; the order is documented for
// reproducibility and has no correctness coupling between legs.

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from '../db';
import {
  runUtahWarrantScan,
  type WatchRunResult,
} from '../utahWarrantPoller';
import { getEnabledAdapters, getAllEnabledAdapters } from './registry';
import { upsertScrapedWarrant, bulkUpsertScrapedWarrants, markScrapedCleared } from './store';
import { reconcileHits, type CanonicalHit } from './reconcile';
import { normalizeCharge } from './chargeNormalize';
import { jitterDelayMs } from './resilience';
import type { WarrantSourceAdapter, RawWarrantHit, PersonRow } from './types';

// Cap each firing to the SAME roster slice the Utah poller uses, so the scraped
// leg's CPU/time budget mirrors the proven Utah path.
const MAX_PERSONS_PER_RUN = 50;

// Base inter-person delay for the scraped leg (mirrors the poller's 8s polite
// pacing). Overridable via opts.delayMs for tests (pass () => 0).
const BASE_DELAY_MS = 8_000;

const sleep = (ms: number) => new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()));

/** Per-scraped-source summary returned to the caller. */
export interface ScrapedSourceSummary {
  source_key: string;
  checked: number;
  found: number;
  cleared: number;
  errors: number;
}

export interface AllSourceScanResult {
  utah: WatchRunResult;
  scraped: ScrapedSourceSummary[];
}

export interface RunAllSourceScansOptions {
  /** Inject fake adapters (tests). Defaults to enabled non-api adapters. */
  adapters?: WarrantSourceAdapter[];
  /** Inject persons (tests). Defaults to the poller-style filtered SELECT. */
  persons?: PersonRow[];
  /** Inter-person delay provider. Defaults to deterministic jitter. Pass () => 0 in tests. */
  delayMs?: (i: number) => number;
  /** Skip the live Utah fetch (tests). Defaults to false — Utah ALWAYS runs in prod. */
  skipUtah?: boolean;
}

// ── Local promotion helper (mirrors poller.syncLocalWarrantRecord) ──────────
// Promotes ONE confirmed canonical hit into the canonical `warrants` records
// table. Idempotent on (external_warrant_id, external_source_key): a re-pull
// UPDATEs the existing row (and un-archives it if it had cleared). Only called
// for CONFIRMED hits — unverified namesakes stay in scraped_warrants as leads,
// mirroring the shipped Utah confirmed-only policy. Returns true when this call
// INSERTED a brand-new warrants row (a notify-worthy first appearance).
async function promoteCanonicalWarrant(
  db: D1Database,
  hit: CanonicalHit,
  localPersonId: number,
): Promise<boolean> {
  const norm = normalizeCharge(hit.charge_description ?? null);
  const chargeText = norm.normalized || (hit.charge_description ?? '') || '';
  const offenseLevel = norm.severity; // felony | misdemeanor | infraction | unknown
  const subjectName =
    hit.full_name ?? ([hit.first_name, hit.last_name].filter(Boolean).join(' ').trim() || null);
  const sourceKey = hit.source_key;
  const courtName = hit.court_name ?? null;
  const issuedDate = hit.issue_date ?? null;

  const existing = await queryFirst<{ id: number }>(
    db,
    'SELECT id FROM warrants WHERE external_warrant_id = ? AND external_source_key = ?',
    hit.warrant_id, sourceKey,
  );

  if (existing) {
    await execute(
      db,
      `UPDATE warrants SET
         status='active', archived_at=NULL,
         subject_person_id=?, subject_name=?, subject_first_name=?, subject_last_name=?,
         charge_description=?, offense=?, offense_level=?, issuing_court=?, court=?, issued_date=?,
         scraped_source=?, scraped_raw=?, confirmed=1, auto_created=1,
         last_checked_at=datetime('now'), last_check_result='active',
         updated_at=datetime('now')
       WHERE id=?`,
      localPersonId, subjectName, hit.first_name ?? null, hit.last_name ?? null,
      chargeText, chargeText, offenseLevel, courtName, courtName, issuedDate,
      sourceKey, JSON.stringify(hit), existing.id,
    );
    return false;
  }

  // warrant_number is UNIQUE; <source_key>-<warrant_id> is deterministic.
  try {
    await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, warrant_type, status,
         subject_person_id, subject_name, subject_first_name, subject_last_name,
         charge_description, offense, offense_level, issuing_court, court, issued_date,
         source, external_warrant_id, external_source_key, scraped_source, scraped_raw,
         auto_created, confirmed, last_checked_at, last_check_result, created_at, updated_at
       ) VALUES (?, 'arrest', 'arrest', 'active',
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         1, 1, datetime('now'), 'active', datetime('now'), datetime('now'))`,
      `${sourceKey}-${hit.warrant_id}`,
      localPersonId, subjectName, hit.first_name ?? null, hit.last_name ?? null,
      chargeText, chargeText, offenseLevel, courtName, courtName, issuedDate,
      sourceKey, hit.warrant_id, sourceKey, sourceKey, JSON.stringify(hit),
    );
    return true;
  } catch (err) {
    // Non-fatal: a UNIQUE collision on warrant_number (e.g. a manual record
    // already claimed this number) must not abort the whole scan.
    console.warn(
      `[warrantSources.runScan] promotion skipped for ${sourceKey}/${hit.warrant_id}:`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

// ── Local watch-log helper (mirrors poller.logWatchEvent) ────────────────────
// Best-effort warrant_watch_log append for the scraped leg. A logging failure
// must never abort the scan.
async function logScrapedWatchEvent(
  db: D1Database,
  event: 'warrant_found' | 'warrant_cleared',
  hit: CanonicalHit,
  personId: number | null,
  runId: string,
): Promise<void> {
  try {
    const name =
      hit.full_name ?? ([hit.first_name, hit.last_name].filter(Boolean).join(' ').trim() || null);
    await execute(
      db,
      `INSERT INTO warrant_watch_log (
         person_id, person_name, event, utah_warrant_id, utah_person_id,
         court_name, case_id, charges, issue_date, scan_run_id, run_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      personId, name, event, hit.warrant_id, null,
      hit.court_name ?? null, hit.case_number ?? null, hit.charge_description ?? null,
      hit.issue_date ?? null, runId, runId,
    );
  } catch (err) {
    console.warn(
      '[warrantSources.runScan] watch_log insert failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Poller-identical filtered person SELECT (org rows / long names excluded). */
async function loadPersons(db: D1Database): Promise<PersonRow[]> {
  return query<PersonRow>(
    db,
    `SELECT id, first_name, middle_name, last_name, dob
       FROM persons
      WHERE first_name IS NOT NULL AND first_name != ''
        AND last_name  IS NOT NULL AND last_name  != ''
        AND first_name NOT LIKE '%(%' AND first_name NOT LIKE '%)%'
        AND first_name NOT LIKE '%,%'
        AND last_name  NOT LIKE '%(%' AND last_name  NOT LIKE '%)%'
        AND last_name  NOT LIKE '%,%'
        AND length(first_name) <= 30
        AND length(last_name)  <= 30
      ORDER BY last_name, first_name
      LIMIT ?`,
    MAX_PERSONS_PER_RUN,
  );
}

/**
 * Full-list leg: fetch each full-list source's entire warrant roster, upsert
 * every hit into scraped_warrants (with person_id=null — person matching/
 * promotion happens via the reconcile/search paths), then clear-sweep rows for
 * that source not seen this run. Isolated per adapter: a throwing source does
 * not abort the remaining adapters. Returns one ScrapedSourceSummary per adapter.
 */
export async function runFullListLeg(
  db: D1Database,
  adapters: WarrantSourceAdapter[],
): Promise<ScrapedSourceSummary[]> {
  const out: ScrapedSourceSummary[] = [];
  for (const adapter of adapters) {
    if (adapter.mode !== 'full-list' || typeof adapter.fetchAll !== 'function') continue;
    const runStartedAt = new Date().toISOString();
    let found = 0;
    let errors = 0;
    let cleared = 0;
    try {
      const hits = await adapter.fetchAll({ DB: db });
      const MAX_FULL_LIST_HITS = 200000;  // raised: batched ingest handles large rosters efficiently
      const truncated = hits.length > MAX_FULL_LIST_HITS;
      const toStore = truncated ? hits.slice(0, MAX_FULL_LIST_HITS) : hits;
      if (truncated) {
        console.warn(`[warrantSources] ${adapter.meta.key} returned ${hits.length} hits; capping to ${MAX_FULL_LIST_HITS} this run.`);
      }
      try {
        found = await bulkUpsertScrapedWarrants(db, adapter.meta.key, toStore);
      } catch (err) {
        errors++;
        console.warn(
          `[warrantSources.runScan.fullList] ${adapter.meta.key} bulk upsert failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      // Clear-sweep ONLY on a clean, non-empty, NON-TRUNCATED ingest. A failed/empty fetch
      // must NOT wipe a source's active warrants (a transient hiccup would otherwise mark real
      // warrants 'cleared' — the worst false-negative for a warrant system). And on a truncated
      // roster the un-ingested tail (rows beyond the cap) wasn't refreshed this run, so sweeping
      // would wrongly clear those still-valid warrants — skip the sweep until the source fits.
      if (errors === 0 && found > 0 && !truncated) {
        cleared = await markScrapedCleared(db, adapter.meta.key, runStartedAt).catch((err) => {
          console.warn(
            `[warrantSources.runScan.fullList] ${adapter.meta.key} clear sweep failed:`,
            err instanceof Error ? err.message : String(err),
          );
          return 0;
        });
      }
    } catch (err) {
      // fetchAll itself threw — count as a single adapter-level error.
      errors++;
      console.warn(
        `[warrantSources.runScan.fullList] ${adapter.meta.key} fetchAll failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    out.push({ source_key: adapter.meta.key, checked: 0, found, cleared, errors });
  }
  return out;
}

/**
 * Run BOTH legs:
 *   1. Scraped leg — every enabled non-api source × persons → scraped_warrants,
 *      then per-person reconcile + confirmed-only promotion to `warrants`.
 *   2. Utah leg — the UNCHANGED runUtahWarrantScan(db).
 *
 * Each scraped adapter and each person fetch is wrapped in try/catch so one bad
 * source/person can't abort the run. Utah runs in its own path with its own
 * error handling (unchanged).
 */
export async function runAllSourceScans(
  db: D1Database,
  opts: RunAllSourceScansOptions = {},
): Promise<AllSourceScanResult> {
  const runId = `multi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const delayMs = opts.delayMs ?? ((i: number) => jitterDelayMs(BASE_DELAY_MS, 1, i));

  // ── Scraped leg ────────────────────────────────────────────────────────────
  const adapters =
    opts.adapters ?? (await getAllEnabledAdapters(db)).filter((a) => a.meta.kind !== 'api');
  const persons = opts.persons ?? (await loadPersons(db));

  const scraped: ScrapedSourceSummary[] = [];

  // Per-person scraped hits ACROSS ALL sources, accumulated as each adapter
  // runs. Reconciliation happens ONCE per person after every source has been
  // scanned (below) so a warrant reported by multiple sources collapses into a
  // single canonical hit and is promoted exactly once. Keyed by person id.
  const hitsByPerson = new Map<number, RawWarrantHit[]>();

  // Only per-person adapters participate in the per-person leg. Full-list
  // adapters (fetchAll) run separately in runFullListLeg below.
  const perPersonAdapters = adapters.filter(
    (a) => a.mode === 'per-person' && typeof a.fetchForPerson === 'function',
  );

  for (const adapter of perPersonAdapters) {
    const sourceKey = adapter.meta.key;
    const runStartedAt = new Date().toISOString();
    const summary: ScrapedSourceSummary = {
      source_key: sourceKey,
      checked: 0,
      found: 0,
      cleared: 0,
      errors: 0,
    };

    // TODO(phase-2): gate each source on circuit-breaker state derived from
    // per-source run history (isCircuitOpen over trailing error counts) once a
    // per-source run-history table exists. For now every adapter is attempted
    // and each person fetch is individually try/caught.

    for (let i = 0; i < persons.length; i++) {
      const person = persons[i];
      try {
        const hits = await adapter.fetchForPerson!(person, { DB: db });
        for (const h of hits) {
          await upsertScrapedWarrant(db, h, person.id);
          summary.found++;
        }
        if (hits.length > 0) {
          const acc = hitsByPerson.get(person.id) ?? [];
          acc.push(...hits);
          hitsByPerson.set(person.id, acc);
        }
      } catch (err) {
        summary.errors++;
        console.warn(
          `[warrantSources.runScan] ${sourceKey} ${person.first_name} ${person.last_name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      summary.checked++;
      if (i < persons.length - 1) await sleep(delayMs(i));
    }

    // Per-source clear sweep (rows of THIS source not seen since runStartedAt).
    // ONLY when every person fetch succeeded — mirrors the full-list leg's guard.
    // If any fetch errored, this run's last_seen_at refreshes are incomplete, so a
    // sweep would wrongly clear warrants for persons we failed to re-check (a total
    // endpoint outage would otherwise wipe the whole source's active roster).
    if (summary.errors === 0) {
      try {
        summary.cleared = await markScrapedCleared(db, sourceKey, runStartedAt);
      } catch (err) {
        console.warn(
          `[warrantSources.runScan] ${sourceKey} clear sweep failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Persist scraper state (mirror the poller's CASE update). Best-effort.
    try {
      const status = summary.errors > 0 ? 'failed' : 'completed';
      const errMsg = summary.errors > 0 ? `${summary.errors} fetch error(s)` : null;
      await execute(
        db,
        `UPDATE warrant_scraper_config
            SET last_run_at = datetime('now'),
                last_success_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE last_success_at END,
                last_error      = CASE WHEN ? = 'failed'    THEN ? ELSE NULL END
          WHERE source_name = ?`,
        status, status, errMsg, sourceKey,
      );
    } catch (err) {
      console.warn(
        `[warrantSources.runScan] ${sourceKey} config update failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    scraped.push(summary);
  }

  // ── Reconcile + promote ACROSS sources, per person ──────────────────────────
  // After every source has run, reconcile each person's accumulated hits. A
  // warrant reported by multiple sources dedups to ONE canonical hit, so the
  // CONFIRMED-only promotion below INSERTs it once (never double-creates a
  // record). UNVERIFIED canonical hits stay in scraped_warrants as leads —
  // mirroring the shipped Utah confirmed-only policy.
  for (const [personId, rawHits] of hitsByPerson) {
    const person = persons.find((p) => p.id === personId);
    if (!person) continue;
    const canonical = reconcileHits(rawHits, person);
    for (const hit of canonical) {
      if (hit.confidence !== 'confirmed') continue;
      // Isolate each promotion: a single failing promote (transient D1 error,
      // future schema drift, a CHECK violation on a written column) must not
      // abort the remaining promotions — same one-bad-hit-can't-kill-the-run
      // contract the rest of this file's try/catch lattice enforces.
      try {
        const isNew = await promoteCanonicalWarrant(db, hit, personId);
        if (isNew) await logScrapedWatchEvent(db, 'warrant_found', hit, personId, runId);
      } catch (err) {
        console.warn(
          `[warrantSources.runScan] promote failed for ${hit.source_key}/${hit.warrant_id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // ── Full-list leg ────────────────────────────────────────────────────────────
  // Full-list adapters (FBI / Utah County / Socrata / ArcGIS) fetch the entire
  // published warrant roster in one call. Hits are stored with person_id=null
  // here; local person-matching / promotion is handled by the reconcile/search
  // paths in a later PR. The clear-sweep marks rows for this source that were
  // NOT seen this run as 'cleared', mirroring the per-person leg's sweep.
  const fullListSummaries = await runFullListLeg(
    db,
    adapters.filter((a) => a.mode === 'full-list'),
  );
  for (const s of fullListSummaries) scraped.push(s);

  // ── Utah leg (UNCHANGED) ─────────────────────────────────────────────────────
  // runUtahWarrantScan owns utah_warrants + Utah promotion + Utah watch-log +
  // its own warrant_watch_runs row. Call as-is; do not reimplement.
  let utah: WatchRunResult;
  if (opts.skipUtah) {
    utah = {
      run_id: 'skipped',
      status: 'completed',
      persons_checked: 0,
      new_warrants_found: 0,
      warrants_cleared: 0,
      errors: 0,
    };
  } else {
    utah = await runUtahWarrantScan(db);
  }

  return { utah, scraped };
}
