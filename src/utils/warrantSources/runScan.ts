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
// Order: the Utah leg runs FIRST so a large chunked scraped source can never
// consume the tick's budget before RMPG's home jurisdiction is scanned; the
// scraped + full-list legs follow. Neither leg has a correctness dependency on
// the other — the order is a resource-starvation safeguard.

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from '../db';
import {
  runUtahWarrantScan,
  type WatchRunResult,
} from '../utahWarrantPoller';
import { getAllEnabledAdapters } from './registry';
import {
  upsertScrapedWarrant, markScrapedCleared, bulkUpsertScrapedWarrants,
  upsertScrapedWarrantsBatch, readSourceProgress, saveSourceProgress, completeSourceCycle,
} from './store';
import { reconcileHits, type CanonicalHit } from './reconcile';
import { normalizeCharge } from './chargeNormalize';
import { jitterDelayMs, isCircuitOpen } from './resilience';
import type { WarrantSourceAdapter, RawWarrantHit, PersonRow } from './types';

// Upper bound on how many persons are loaded for the per-person leg to work
// through. Historically pinned to the Utah poller's old default (50) "so the
// scraped leg's CPU/time budget mirrors the proven Utah path" — but the Utah
// poller's own cap is now separately configurable (warrant_scraper_config
// .max_persons_per_run, default 150) and this leg has its OWN hard wall-clock
// guard (PER_PERSON_LEG_BUDGET_MS below) that already truncates the loop
// regardless of how many persons were loaded — so raising this cap doesn't
// change per-tick runtime, only how many persons are ELIGIBLE to be reached
// before the budget cuts the loop off. Bumped to match Utah's default so a
// small persons roster (fewer than the budget would otherwise get through)
// isn't artificially starved to 50 rows.
const MAX_PERSONS_PER_RUN = 150;

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
  degraded: boolean;
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
  /** Wall-clock budget (ms) for the whole per-person leg. Defaults to PER_PERSON_LEG_BUDGET_MS; override in tests. */
  perPersonBudgetMs?: number;
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
         charge_description=?, offense_level=?, issuing_court=?, issued_date=?,
         scraped_source=?, scraped_raw=?, confirmed=1, auto_created=1,
         last_checked_at=datetime('now'), last_check_result='active',
         updated_at=datetime('now')
       WHERE id=?`,
      localPersonId, subjectName, hit.first_name ?? null, hit.last_name ?? null,
      chargeText, offenseLevel, courtName, issuedDate,
      sourceKey, JSON.stringify(hit), existing.id,
    );
    return false;
  }

  // warrant_number is UNIQUE; <source_key>-<warrant_id> is deterministic.
  try {
    await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, status,
         subject_person_id, subject_name, subject_first_name, subject_last_name,
         charge_description, offense_level, issuing_court, issued_date,
         source, external_warrant_id, external_source_key, scraped_source, scraped_raw,
         auto_created, confirmed, last_checked_at, last_check_result, created_at, updated_at
       ) VALUES (?, 'arrest', 'active',
         ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         1, 1, datetime('now'), 'active', datetime('now'), datetime('now'))`,
      `${sourceKey}-${hit.warrant_id}`,
      localPersonId, subjectName, hit.first_name ?? null, hit.last_name ?? null,
      chargeText, offenseLevel, courtName, issuedDate,
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
// Wall-clock budget for the WHOLE full-list leg (all adapters combined), not
// per-adapter. 2026-07-22 incident: even with every individual fetch() now
// timeout-guarded (fetchTimeout.ts), a source that iterates many sequential
// pages (e.g. ohio-drc-pval: up to 26 letters × 25 pages = 650 requests) can
// still legitimately or pathologically consume the entire cron invocation's
// execution budget, starving every OTHER enabled source queued after it in
// this loop — the same "one bad source silently kills the whole run"
// signature as the original incident, just moved one level up. A skipped
// adapter gets no scraper_runs row this tick and is simply retried next
// cron tick, same effect as a transient failure.
const FULL_LIST_LEG_BUDGET_MS = 90_000;

// Mirrors the warrant_scraper_config consecutive_errors fix above, for the
// OTHER health-tracking table: config-driven full-list sources (socrata/
// arcgis/pdf/xml/csv) live in national_warrant_sources, which had ZERO
// write path from the cron at all — consecutive_errors (and therefore
// ScrapersTab's circuit-breaker/health-grade display for these sources)
// could only ever change via a human clicking "reset" or a manual trigger.
// A no-op for code-resident adapters (FBI/Utah County/Ohio DRC) that have
// no row in this table — the UPDATE simply matches zero rows for those.
async function updateNationalSourceHealth(db: D1Database, sourceKey: string, hadErrors: boolean): Promise<void> {
  try {
    await execute(
      db,
      `UPDATE national_warrant_sources
          SET consecutive_errors = CASE WHEN ? THEN consecutive_errors + 1 ELSE 0 END
        WHERE source_key = ?`,
      hadErrors ? 1 : 0, sourceKey,
    );
  } catch (err) {
    console.warn(
      `[warrantSources.runScan.fullList] ${sourceKey} national_warrant_sources health update failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function runFullListLeg(
  db: D1Database,
  adapters: WarrantSourceAdapter[],
  opts: { now?: () => string; budgetMs?: number } = {},
): Promise<ScrapedSourceSummary[]> {
  const now = opts.now ?? (() => new Date().toISOString());
  const budgetMs = opts.budgetMs ?? FULL_LIST_LEG_BUDGET_MS;
  const legStartedAt = Date.now();
  const out: ScrapedSourceSummary[] = [];
  for (const adapter of adapters) {
    if (adapter.mode !== 'full-list') continue;
    if (Date.now() - legStartedAt > budgetMs) {
      console.warn(
        `[warrantSources.runScan.fullList] leg budget (${budgetMs}ms) exceeded; skipping remaining adapters this tick (starting at ${adapter.meta.key}), will retry next cron tick.`,
      );
      break;
    }

    // ── Chunked path (cursor-driven; large rosters across many ticks) ────────
    if (typeof adapter.fetchChunk === 'function') {
      const key = adapter.meta.key;
      let found = 0;
      let errors = 0;
      let cleared = 0;
      let degraded = false;
      try {
        const prog = await readSourceProgress(db, key);
        const cycleStartedAt = prog?.cycle_started_at ?? now();
        const cursor = prog?.cursor ?? null;

        const { hits, nextCursor, done, degraded: chunkDegraded } = await adapter.fetchChunk(cursor, { DB: db });
        degraded = chunkDegraded ?? false;
        const r = await upsertScrapedWarrantsBatch(db, hits, null);
        found = r.found;
        errors += r.errors;

        if (errors > 0) {
          // Writes were unreliable this tick. NEVER clear-sweep when we couldn't
          // store reliably — a sweep here would clear active warrants that merely
          // failed to re-store (the feature's #1 invariant: never wrongly clear).
          // Don't advance past the failed window either: persist the SAME incoming
          // cursor so the next tick retries it. The batched upsert is idempotent
          // (ON CONFLICT), so re-running the window is safe.
          await saveSourceProgress(db, key, cursor, cycleStartedAt, (prog?.rows_this_cycle ?? 0) + found);
        } else if (done) {
          // Full pass complete → clear rows of THIS source not seen during the
          // entire cycle (scoped to cycle_started_at, NOT this tick), then reset.
          cleared = await markScrapedCleared(db, key, cycleStartedAt).catch((err) => {
            console.warn(`[warrantSources.runScan.chunk] ${key} clear sweep failed:`, err instanceof Error ? err.message : String(err));
            return 0;
          });
          // Guard separately so a completion failure logs accurately (not as a
          // misleading "fetchChunk failed" in the outer catch) and doesn't inflate
          // the error count — the sweep is idempotent, so the next tick re-completes.
          await completeSourceCycle(db, key, now()).catch((err) => {
            console.warn(`[warrantSources.runScan.chunk] ${key} completeSourceCycle failed:`, err instanceof Error ? err.message : String(err));
          });
        } else {
          // Mid-cycle / truncated → persist cursor, SKIP the clear-sweep so the
          // un-ingested tail (and prior chunks) are never wrongly cleared.
          await saveSourceProgress(db, key, nextCursor, cycleStartedAt, (prog?.rows_this_cycle ?? 0) + found);
        }
      } catch (err) {
        errors++;
        console.warn(`[warrantSources.runScan.chunk] ${key} chunk tick failed:`, err instanceof Error ? err.message : String(err));
      }
      // checked:0 — the chunked leg walks the REMOTE roster, not the local persons
      // list, so the per-person 'checked' metric doesn't apply here.
      await updateNationalSourceHealth(db, key, errors > 0);
      out.push({ source_key: key, checked: 0, found, cleared, errors, degraded });
      continue;
    }

    if (typeof adapter.fetchAll !== 'function') continue;
    const runStartedAt = new Date().toISOString();
    let found = 0;
    let errors = 0;
    let cleared = 0;
    let degraded = false;
    try {
      const { hits, degraded: fetchDegraded } = await adapter.fetchAll({ DB: db });
      degraded = fetchDegraded ?? false;
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
    await updateNationalSourceHealth(db, adapter.meta.key, errors > 0);
    out.push({ source_key: adapter.meta.key, checked: 0, found, cleared, errors, degraded });
  }
  return out;
}

/**
 * Run BOTH legs:
 *   1. Utah leg — the UNCHANGED runUtahWarrantScan(db), runs FIRST so a large
 *      chunked scraped source can never starve RMPG's home jurisdiction.
 *   2. Scraped leg — every enabled non-api source × persons → scraped_warrants,
 *      then per-person reconcile + confirmed-only promotion to `warrants`.
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

  // ── Utah leg (UNCHANGED) ─────────────────────────────────────────────────────
  // Runs FIRST so large chunked scraped sources can never starve RMPG's home
  // jurisdiction. runUtahWarrantScan owns utah_warrants + Utah promotion +
  // Utah watch-log + its own warrant_watch_runs row. Call as-is; do not reimplement.
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
    try {
      utah = await runUtahWarrantScan(db);
    } catch (err) {
      // Utah runs first now; a throw must NOT abort the independent scraped/
      // full-list legs. Degrade to a failed result and continue.
      console.warn('[warrantSources.runScan] Utah leg threw:', err instanceof Error ? err.message : String(err));
      utah = { run_id: 'utah-error', status: 'failed', persons_checked: 0, new_warrants_found: 0, warrants_cleared: 0, errors: 1 };
    }
  }

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

  // Wall-clock budget for the WHOLE per-person leg (all adapters combined).
  // 2026-07-22 incident, part 2: even after the full-list leg got timeout +
  // budget protection (see runFullListLeg), the cron STILL produced zero
  // scraper_runs/error_log rows — including for the separately-implemented
  // Utah leg, which sometimes succeeds and sometimes doesn't. Root cause:
  // this leg has a DELIBERATE ~8-9s rate-limit sleep between each person
  // (to stay under small county sites' anti-scraper heuristics), with no
  // overall cap — up to 50 persons × 2 adapters (ada-county, natrona) ≈ 15
  // minutes of pure pacing sleep alone, stacked before the full-list leg
  // ever runs, on top of the Utah leg's own similarly-paced ~7.5 minutes.
  // That total plausibly exceeds whatever wall-clock ceiling Cloudflare
  // enforces on a scheduled event's waitUntil work, silently truncating the
  // ENTIRE invocation with no exception ever thrown. A budget here — same
  // pattern as runFullListLeg's — guarantees the leg (and therefore the
  // whole runAllSourceScans call) always finishes in bounded time, even if
  // that means checking fewer persons this tick and picking up the rest
  // next tick, rather than risking the whole cron going dark again.
  const PER_PERSON_LEG_BUDGET_MS = opts.perPersonBudgetMs ?? 120_000;
  const perPersonLegStartedAt = Date.now();
  let perPersonBudgetExceeded = false;

  for (const adapter of perPersonAdapters) {
    if (perPersonBudgetExceeded) break;
    const sourceKey = adapter.meta.key;
    const runStartedAt = new Date().toISOString();
    const summary: ScrapedSourceSummary = {
      source_key: sourceKey,
      checked: 0,
      found: 0,
      cleared: 0,
      errors: 0,
      degraded: false,
    };

    // Circuit breaker: mirrors the same isCircuitOpen(consecutive_errors)
    // trick circuitOpenFromConsecutiveErrors() uses for the ScrapersTab
    // badge (src/routes/scrapers.ts) and runUtahWarrantScan now uses to gate
    // itself — no separate per-source run-history table needed, the single
    // running tally is enough. Before this, a source could rack up dozens of
    // real consecutive cron-tick failures (ada-county-id hit 50 in one tick
    // on 2026-07-18) while every subsequent tick kept hammering it anyway;
    // this closes that gap for the per-person adapters (ada-county, natrona).
    const cfgRow = await queryFirst<{ consecutive_errors: number | null }>(
      db, 'SELECT consecutive_errors FROM warrant_scraper_config WHERE source_name = ?', sourceKey,
    );
    if (isCircuitOpen(Array(cfgRow?.consecutive_errors ?? 0).fill(1))) {
      console.warn(
        `[warrantSources.runScan] ${sourceKey} circuit open (${cfgRow?.consecutive_errors} consecutive failures) — skipping this tick.`,
      );
      scraped.push(summary);
      continue;
    }

    for (let i = 0; i < persons.length; i++) {
      if (Date.now() - perPersonLegStartedAt > PER_PERSON_LEG_BUDGET_MS) {
        perPersonBudgetExceeded = true;
        console.warn(
          `[warrantSources.runScan] per-person leg budget (${PER_PERSON_LEG_BUDGET_MS}ms) exceeded ` +
          `at ${sourceKey} (${i}/${persons.length} persons checked this adapter); ` +
          `stopping this tick, will resume next cron tick.`,
        );
        break;
      }
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
    // ONLY when every person fetch succeeded AND the leg budget didn't cut this
    // adapter's pass short — mirrors the full-list leg's guard. If any fetch
    // errored, or we bailed early on the budget, this run's last_seen_at
    // refreshes are incomplete, so a sweep would wrongly clear warrants for
    // persons we failed (or didn't get to) re-check (a total endpoint outage,
    // or a budget cutoff, would otherwise wipe the whole source's active roster).
    if (summary.errors === 0 && !perPersonBudgetExceeded) {
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
    // consecutive_errors drives ScrapersTab's circuit-breaker/health-grade UI
    // (src/routes/scrapers.ts's circuitOpenFromConsecutiveErrors) but this
    // cron sweep — the ONLY thing that runs unattended — never updated it,
    // so the column only ever moved via a human clicking "reset" or a manual
    // per-source trigger. A source could rack up dozens of real consecutive
    // cron-tick failures (ada-county-id hit 50 fetch errors in one tick on
    // 2026-07-18) while the UI kept showing it as healthy/circuit-closed.
    // Found during the 2026-07-22 warrant-poller audit.
    try {
      const status = summary.errors > 0 ? 'failed' : 'completed';
      const errMsg = summary.errors > 0 ? `${summary.errors} fetch error(s)` : null;
      await execute(
        db,
        `UPDATE warrant_scraper_config
            SET last_run_at = datetime('now'),
                last_success_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE last_success_at END,
                last_error      = CASE WHEN ? = 'failed'    THEN ? ELSE NULL END,
                consecutive_errors = CASE WHEN ? = 'failed' THEN consecutive_errors + 1 ELSE 0 END
          WHERE source_name = ?`,
        status, status, errMsg, status, sourceKey,
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

  return { utah, scraped };
}
