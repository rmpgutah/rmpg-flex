// Warrants routes for the CF Worker. Initially minimal — surfaces the
// warrant-watch run history that the legacy server's /warrants page
// + dashboard widget consume. The CRUD warrant routes (list, create,
// archive, etc.) stay on the legacy server until the full warrants
// subsystem is migrated.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { runUtahWarrantScan } from '../utils/utahWarrantPoller';

const warrants = new Hono<Env>();

// authMiddleware (mounted per-prefix in routesConfig) only verifies a valid
// JWT — it does NOT enforce a role. Every other sensitive route adds an inline
// requireRole gate; these match that convention. READ covers all internal
// dispatch/records roles but excludes client_viewer (read-only external) and
// human_resources from pulling subject warrant data. SCAN is stricter — it
// fires an ~80s external scan, so limit it to dispatch supervisors+.
const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const SCAN_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher'] as const;

// GET /warrants/watch/runs?limit=N — recent warrant watch runs
// Used by:
//   - client/src/pages/DashboardPage.tsx (widget — limit=1)
//   - client/src/pages/WarrantsPage.tsx Sources tab (limit=20)
// Returns { data: WatchRun[] } shape to match legacy server.
warrants.get('/watch/runs', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const limitRaw = c.req.query('limit');
    const limit = Math.min(Math.max(parseInt(limitRaw || '20', 10) || 20, 1), 100);
    const rows = await query<Record<string, unknown>>(
      db,
      'SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT ?',
      limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    // Tables may not yet exist on a fresh D1 — return empty rather than 500
    // so the dashboard widget shows "—" instead of error noise.
    return c.json({ data: [] });
  }
});

// POST /warrants/watch/scan — manually trigger a scan ("Scan Now" button).
// FIRE-AND-FORGET: a full scan paces ~8s/person and runs ~80s+, which blows
// past the browser/request timeout if awaited. We hand it to
// executionCtx.waitUntil (same async pattern as the cron) and return 202
// immediately; the UI polls /watch/runs to observe the run row complete.
warrants.post('/watch/scan', requireRole(...SCAN_ROLES), async (c) => {
  const db = getDb(c.env);
  c.executionCtx.waitUntil(
    runUtahWarrantScan(db).catch((err) => {
      console.error('[warrants] manual scan failed:', err);
    }),
  );
  return c.json({ success: true, started: true, message: 'Scan started; poll /watch/runs for completion.' }, 202);
});

// GET /warrants/utah — list scraped Utah warrants (the new utah_warrants
// table populated by runUtahWarrantScan in src/utils/utahWarrantPoller.ts).
// Query params:
//   active=1|0   filter by is_active (default 1 = currently-active only)
//   person_id=N  filter by local persons.id
//   limit=N      default 100, capped at 500
// Returns flat array; client paginates with `offset` (deferred to v2 when
// total roster makes that needed).
warrants.get('/utah', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const active = c.req.query('active') ?? '1';
    const personIdRaw = c.req.query('person_id');
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);

    const filters: string[] = [];
    const params: unknown[] = [];
    if (active === '1' || active === '0') {
      filters.push('is_active = ?');
      params.push(Number(active));
    }
    if (personIdRaw) {
      const pid = parseInt(personIdRaw, 10);
      if (Number.isFinite(pid)) {
        filters.push('person_id = ?');
        params.push(pid);
      }
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, utah_person_id, utah_warrant_id,
              first_name, middle_name, last_name, age, city,
              issue_date, court_name, case_id, charges,
              person_id, first_seen_at, last_seen_at, is_active
         FROM utah_warrants
         ${where}
         ORDER BY last_seen_at DESC, last_name, first_name
         LIMIT ?`,
      ...params, limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    // Pre-migration: table doesn't exist on a fresh D1. Return empty so
    // the WarrantsPage Utah tab degrades gracefully instead of 500-spamming
    // the dashboard.
    return c.json({ data: [] });
  }
});

// POST /warrants/search-all — unified cross-source warrant search backing the
// WarrantsPage "SEARCH ALL" tab. Searches the LOCAL warrants table + the
// utah_warrants table (the cron poller's cache) and returns the SPA's
// UnifiedSearchResults shape { local, utah, scraped, meta }. Was 404 in both
// Workers → the tab threw "API endpoint not found" and the unhandled rejection
// surfaced in the console. `scraped` is empty: there is no separate scraped
// table on live D1 (the rewrite synthesizes scrapers from utah_warrants), so
// folding scraped results in would double-list the Utah hits.
warrants.post('/search-all', requireRole(...READ_ROLES), async (c) => {
  const startedAt = Date.now();
  let body: Record<string, unknown> = {};
  try { body = await c.req.json<Record<string, unknown>>(); } catch { body = {}; }

  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const firstName = s(body.firstName);
  const lastName = s(body.lastName);
  const dob = s(body.dob);
  const warrantNumber = s(body.warrantNumber);
  const court = s(body.court);
  const source = s(body.source);
  const offenseLevel = s(body.offenseLevel);
  const status = s(body.status);
  const type = s(body.type);
  const chargeKeyword = s(body.chargeKeyword);
  const dateFrom = s(body.dateFrom);
  const dateTo = s(body.dateTo);

  // Escape LIKE wildcards so a search for "50%" isn't a match-everything query.
  const like = (v: string) => `%${v.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const db = getDb(c.env);

  // ── Local warrants ──
  let local: Record<string, unknown>[] = [];
  try {
    const f: string[] = [];
    const p: unknown[] = [];
    if (firstName) { f.push("subject_first_name LIKE ? ESCAPE '\\'"); p.push(like(firstName)); }
    if (lastName) { f.push("subject_last_name LIKE ? ESCAPE '\\'"); p.push(like(lastName)); }
    if (dob) { f.push('subject_dob = ?'); p.push(dob); }
    if (warrantNumber) { f.push("warrant_number LIKE ? ESCAPE '\\'"); p.push(like(warrantNumber)); }
    if (court) { f.push("(issuing_court LIKE ? ESCAPE '\\' OR court LIKE ? ESCAPE '\\')"); p.push(like(court), like(court)); }
    if (source) { f.push('source = ?'); p.push(source); }
    if (offenseLevel) { f.push('offense_level = ?'); p.push(offenseLevel); }
    if (status) { f.push('status = ?'); p.push(status); }
    if (type) { f.push('type = ?'); p.push(type); }
    if (chargeKeyword) {
      f.push("(charge_description LIKE ? ESCAPE '\\' OR offense_description LIKE ? ESCAPE '\\' OR offense LIKE ? ESCAPE '\\')");
      p.push(like(chargeKeyword), like(chargeKeyword), like(chargeKeyword));
    }
    if (dateFrom) { f.push('COALESCE(issued_date, created_at) >= ?'); p.push(dateFrom); }
    if (dateTo) { f.push('COALESCE(issued_date, created_at) <= ?'); p.push(dateTo); }
    const where = f.length ? `WHERE ${f.join(' AND ')}` : '';
    local = await query<Record<string, unknown>>(
      db,
      `SELECT id, warrant_number, type, status,
              COALESCE(charge_description, offense_description, offense) AS charge_description,
              subject_first_name, subject_last_name,
              COALESCE(issuing_court, court) AS issuing_court,
              COALESCE(bail_amount, bond_amount) AS bail_amount,
              offense_level, created_at
         FROM warrants
         ${where}
         ORDER BY created_at DESC
         LIMIT 100`,
      ...p,
    );
  } catch (err) {
    console.error('[warrants] search-all local query error:', (err as Error)?.message);
    local = [];
  }

  // ── Utah warrants (cron poller cache) ──
  // Only run when there's a name/court/charge/number filter — an unfiltered
  // query would dump the entire active roster into the results panel.
  let utah: Record<string, unknown>[] = [];
  try {
    const hasUtahFilter = firstName || lastName || court || chargeKeyword || warrantNumber;
    if (hasUtahFilter) {
      const f: string[] = ['is_active = 1'];
      const p: unknown[] = [];
      if (firstName) { f.push("first_name LIKE ? ESCAPE '\\'"); p.push(like(firstName)); }
      if (lastName) { f.push("last_name LIKE ? ESCAPE '\\'"); p.push(like(lastName)); }
      if (court) { f.push("court_name LIKE ? ESCAPE '\\'"); p.push(like(court)); }
      if (chargeKeyword) { f.push("charges LIKE ? ESCAPE '\\'"); p.push(like(chargeKeyword)); }
      if (warrantNumber) { f.push("(utah_warrant_id LIKE ? ESCAPE '\\' OR case_id LIKE ? ESCAPE '\\')"); p.push(like(warrantNumber), like(warrantNumber)); }
      utah = await query<Record<string, unknown>>(
        db,
        `SELECT utah_warrant_id, first_name, middle_name, last_name, age, city,
                issue_date, court_name, case_id, charges
           FROM utah_warrants
           WHERE ${f.join(' AND ')}
           ORDER BY last_seen_at DESC
           LIMIT 100`,
        ...p,
      );
    }
  } catch (err) {
    console.error('[warrants] search-all utah query error:', (err as Error)?.message);
    utah = [];
  }

  const scraped: Record<string, unknown>[] = [];

  return c.json({
    local,
    utah,
    scraped,
    meta: {
      duration: Date.now() - startedAt,
      sources: ['local', 'utah'],
      utahBlocked: false,
      searchedAt: new Date().toISOString(),
      totalHits: local.length + utah.length + scraped.length,
    },
  });
});

// GET /warrants/person/:id/profile — the WarrantsPage person drawer.
// Surfaces a local person's Utah warrants (from the cron poller's
// utah_warrants table, filtered by person_id) shaped into the SPA's
// PersonProfile { person, warrants[], scanHistory[], lastChecked }.
// Was 404 everywhere → the person drawer silently failed to open.
warrants.get('/person/:id/profile', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid person id' }, 400);

    const person = await query<Record<string, any>>(
      db, 'SELECT id, first_name, last_name, dob, photo_url, flags FROM persons WHERE id = ?', id);
    if (person.length === 0) return c.json({ error: 'Person not found' }, 404);
    const p = person[0];

    const uw = await query<Record<string, any>>(
      db, 'SELECT * FROM utah_warrants WHERE person_id = ? ORDER BY last_seen_at DESC', id);

    // Map each Utah warrant to the SPA's Warrant shape. Utah only carries
    // citation/court/charges/dates — other Warrant fields stay null and the
    // UI renders with optional chaining.
    const warrantList = uw.map((w) => {
      let chargeText = '';
      try { const arr = JSON.parse(w.charges || '[]'); chargeText = Array.isArray(arr) ? arr.join('; ') : String(w.charges || ''); }
      catch { chargeText = String(w.charges || ''); }
      return {
        id: w.id,
        warrant_number: w.utah_warrant_id,
        type: 'arrest',
        status: w.is_active ? 'active' : 'recalled',
        subject_person_id: w.person_id,
        subject_first_name: w.first_name,
        subject_last_name: w.last_name,
        subject_name: [w.first_name, w.last_name].filter(Boolean).join(' '),
        subject_dob: p.dob ?? null,
        issuing_court: w.court_name,
        charge_description: chargeText,
        case_number: w.case_id,
        issue_date: w.issue_date,
        source: 'utah-warrant-watch',
        city: w.city,
        first_seen_at: w.first_seen_at,
        last_seen_at: w.last_seen_at,
      };
    });

    const lastChecked = uw.length ? uw[0].last_seen_at : null;

    return c.json({
      person: {
        id: p.id, first_name: p.first_name, last_name: p.last_name,
        dob: p.dob ?? undefined, photo_url: p.photo_url ?? null, flags: p.flags ?? undefined,
      },
      warrants: warrantList,
      scanHistory: [],   // no per-person scan log table; runs are global (see /watch/runs)
      lastChecked,
    });
  } catch (err) {
    console.error('[warrants] person profile error', err);
    return c.json({ error: 'Failed to load person profile' }, 500);
  }
});

// Next firing of the `0 */4 * * *` cron (00,04,08,12,16,20 UTC), as ISO.
// Computed from the schedule rather than stored — kept in lockstep with
// wrangler.toml as long as both say every-4-hours.
function nextScheduledRun(now: Date): string {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  const nextBoundary = (Math.floor(now.getUTCHours() / 4) + 1) * 4; // strictly after current block
  if (nextBoundary >= 24) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(nextBoundary - 24);
  } else {
    next.setUTCHours(nextBoundary);
  }
  return next.toISOString();
}

// Shared status payload for all three status surfaces the SPA polls
// (/utah/sync-status, /utah-search/auto-poll-status, /scraped/status).
// Returns a superset; each client component reads the keys it needs.
// One builder = the three endpoints can't drift apart.
async function buildUtahStatus(c: Context<Env>) {
  const db = getDb(c.env);
  const runs = await query<Record<string, any>>(
    db, 'SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 1');
  const latest = runs[0] ?? null;
  // COUNT(*) always returns one row on an existing table; the ?? guards the
  // pre-migration window where the driver could hand back an empty array,
  // so we never destructure undefined.
  const activeRows = await query<{ active: number }>(
    db, 'SELECT COUNT(*) AS active FROM utah_warrants WHERE is_active = 1');
  const active = activeRows[0]?.active ?? 0;
  const running = latest?.status === 'running';

  return {
    // canonical
    lastSync: latest ? latest.completed_at ?? latest.started_at : null,
    lastStatus: latest ? latest.status : null,
    lastPersonsChecked: latest ? latest.persons_checked ?? 0 : 0,
    lastNewWarrants: latest ? latest.new_warrants_found ?? 0 : 0,
    lastWarrantsCleared: latest ? latest.warrants_cleared ?? 0 : 0,
    lastErrors: latest ? latest.errors ?? 0 : 0,
    activeWarrants: active ?? 0,
    nextScheduledRun: nextScheduledRun(new Date()),
    isRunning: running,
    // aliases some components read (auto-poll-status / scraped/status)
    enabled: true,
    polling: running,
    lastRunAt: latest ? latest.completed_at ?? latest.started_at : null,
    lastRunStatus: latest ? latest.status : null,
  };
}

// Empty-status fallback for the pre-migration / table-missing path. Built
// fresh per request so nextScheduledRun is always a real ISO string (the
// helper is pure and can't throw) — matching the live shape so cold-D1
// clients never see a null where they expect a date.
function emptyStatus() {
  return {
    lastSync: null, lastStatus: null, lastPersonsChecked: 0, lastNewWarrants: 0,
    lastWarrantsCleared: 0, lastErrors: 0, activeWarrants: 0,
    nextScheduledRun: nextScheduledRun(new Date()), isRunning: false,
    enabled: true, polling: false, lastRunAt: null, lastRunStatus: null,
  };
}
for (const path of ['/utah/sync-status', '/utah-search/auto-poll-status', '/scraped/status']) {
  warrants.get(path, requireRole(...READ_ROLES), async (c) => {
    try {
      return c.json(await buildUtahStatus(c));
    } catch (err) {
      // Pre-migration / table-missing → harmless empty status.
      return c.json(emptyStatus());
    }
  });
}

// ============================================================
// /scrapers — Sources tab on WarrantsPage + AdminWarrantScrapersTab
// ============================================================
// Live `warrant_scraper_config` carries only operational state
// (source_name + timestamps + errors + perf hints). Display metadata
// (display_name, state, county, source_url) is code-resident in
// SOURCE_REGISTRY below so adding a new scraper is a 5-line patch
// rather than a schema migration. The client's ScraperSource shape
// (client/src/types/scrapers.ts) is the contract; we synthesize it
// from JOIN(warrant_scraper_config, warrant_watch_runs, utah_warrants).
//
// `circuit_broken` and `consecutive_errors` are DERIVED from the
// trailing run history — live schema has no backing columns. The
// reset-circuit endpoint nulls `last_error` (the surfaced symptom);
// the next successful run keeps it null on its own via the poller's
// CASE statement (see src/utils/utahWarrantPoller.ts).

interface ScraperRegistryEntry {
  display_name: string;
  state: string;
  county: string | null;
  source_url: string;
  source_type: string;
  priority: 1 | 2 | 3 | 4;
}

const SOURCE_REGISTRY: Record<string, ScraperRegistryEntry> = {
  'utah-warrant-watch': {
    display_name: 'Utah State Warrants',
    state: 'UT',
    county: null,
    source_url: 'https://warrants.utah.gov',
    source_type: 'api',
    priority: 1,
  },
};

// A-F grade per client/src/types/scrapers.ts cutoffs. Threshold-only —
// no time-of-day weighting; if you want "today only," filter the input
// by started_at first.
function gradeFromSuccessRate(rate: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (rate >= 0.95) return 'A';
  if (rate >= 0.85) return 'B';
  if (rate >= 0.70) return 'C';
  if (rate >= 0.50) return 'D';
  return 'F';
}

// Nearest-rank percentile on a pre-sorted ascending array. Inputs are
// duration-or-other numeric arrays from warrant_watch_runs; size is
// always small (≤ a few hundred rows / window) so the O(n log n) sort
// is cheap.
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * sortedAsc.length)));
  return sortedAsc[idx];
}

interface RunRow {
  started_at: string;
  completed_at: string | null;
  status: string;
  errors: number | null;
  persons_checked: number | null;
  new_warrants_found: number | null;
  warrants_cleared: number | null;
  error_message: string | null;
}

// Read the run history once and project it into:
//   - the rich `metrics_24h` block returned per source
//   - the trailing `consecutive_errors` count (used for circuit derivation)
//   - last_error_at (the started_at of the most recent failed run)
function summarizeRuns(runs24h: RunRow[], trailingRuns: RunRow[]) {
  const total = runs24h.length;
  const failed = runs24h.filter((r) => r.errors && r.errors > 0).length;
  const successful = total - failed;
  // "unchanged" runs = successful runs that found and cleared nothing —
  // the steady-state with no roster churn. Matters because the dashboard
  // wants to distinguish "nothing happened" from "scan didn't run."
  const unchanged = runs24h.filter(
    (r) => (!r.errors || r.errors === 0) && !r.new_warrants_found && !r.warrants_cleared,
  ).length;

  const durations: number[] = runs24h
    .filter((r) => r.completed_at)
    .map((r) => new Date(r.completed_at!).getTime() - new Date(r.started_at).getTime())
    .filter((d) => d > 0 && d < 24 * 60 * 60 * 1000) // discard zombies
    .sort((a, b) => a - b);

  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const successRate = total > 0 ? successful / total : 0;

  // Trailing consecutive failures, walking from most-recent backwards.
  // Stops at the first success (or at the start of history).
  let consecutiveErrors = 0;
  for (const r of trailingRuns) {
    if (r.errors && r.errors > 0) consecutiveErrors++;
    else break;
  }

  // last_error_at: started_at of the most recent failed run in the 24h
  // window. Distinct from `last_error` (the message), which lives on
  // warrant_scraper_config and survives across the window.
  const lastFailed = runs24h.find((r) => r.errors && r.errors > 0);

  return {
    total_runs: total,
    successful_runs: successful,
    unchanged_runs: unchanged,
    failed_runs: failed,
    success_rate: Number(successRate.toFixed(4)),
    avg_duration_ms: avgDuration,
    p50_duration_ms: percentile(durations, 0.5),
    p95_duration_ms: percentile(durations, 0.95),
    avg_parsed: total
      ? Number(
          (runs24h.reduce((a, r) => a + (r.new_warrants_found ?? 0), 0) / total).toFixed(2),
        )
      : 0,
    total_inserted: runs24h.reduce((a, r) => a + (r.new_warrants_found ?? 0), 0),
    total_updated: runs24h.reduce((a, r) => a + (r.warrants_cleared ?? 0), 0),
    last_error_at: lastFailed ? lastFailed.started_at : null,
    consecutive_errors: consecutiveErrors,
    health_grade: gradeFromSuccessRate(successRate),
  };
}

// GET /warrants/scrapers — { sources: ScraperSource[] }
// Polled by WarrantsPage Sources tab + AdminWarrantScrapersTab on mount.
warrants.get('/scrapers', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const configRows = await query<Record<string, any>>(
      db,
      'SELECT * FROM warrant_scraper_config ORDER BY priority, source_name',
    );

    const sources = await Promise.all(
      configRows.map(async (cfg) => {
        const sourceKey = String(cfg.source_name);
        const registry = SOURCE_REGISTRY[sourceKey] ?? {
          // Unknown source — show its key as the display name so it's
          // visible (not silently dropped) and an operator can decide
          // whether to register it or remove the row.
          display_name: sourceKey,
          state: '',
          county: null,
          source_url: '',
          source_type: cfg.source_type ?? 'unknown',
          priority: (cfg.priority as 1 | 2 | 3 | 4) ?? 4,
        };

        const runs24h = await query<RunRow>(
          db,
          `SELECT started_at, completed_at, status, errors, persons_checked,
                  new_warrants_found, warrants_cleared, error_message
             FROM warrant_watch_runs
            WHERE started_at >= datetime('now', '-24 hours')
            ORDER BY started_at DESC`,
        );
        const trailingRuns = await query<RunRow>(
          db,
          `SELECT started_at, completed_at, status, errors, persons_checked,
                  new_warrants_found, warrants_cleared, error_message
             FROM warrant_watch_runs
            ORDER BY started_at DESC
            LIMIT 10`,
        );
        const metrics = summarizeRuns(runs24h, trailingRuns);

        const warrantCountRow = await query<{ n: number }>(
          db,
          `SELECT COUNT(*) AS n FROM utah_warrants
            WHERE COALESCE(source, 'utah-warrant-watch') = ? AND is_active = 1`,
          sourceKey,
        );
        const warrant_count = warrantCountRow[0]?.n ?? 0;

        // Circuit derivation: 5+ consecutive failures = circuit broken.
        // Keeps the dashboard usable when a scrape is wedged — operator
        // hits "Reset Circuit" which clears last_error so the next
        // successful run renders healthy.
        const circuit_broken: 0 | 1 = metrics.consecutive_errors >= 5 ? 1 : 0;

        return {
          source_key: sourceKey,
          display_name: registry.display_name,
          state: registry.state,
          county: registry.county,
          source_url: registry.source_url,
          source_type: registry.source_type,
          enabled: 1 as const,
          circuit_broken,
          priority: registry.priority,
          consecutive_errors: metrics.consecutive_errors,
          warrant_count,
          last_scrape_at: cfg.last_run_at ?? null,
          last_success_at: cfg.last_success_at ?? null,
          // Sticky-error gotcha: the poller's CASE clears last_error on
          // every successful run, so a stale message here means the most
          // recent run actually failed. Don't synthetically null it on
          // "consecutive_errors === 0" — that hides legitimate state.
          last_error: cfg.last_error ?? null,
          avg_parse_count: cfg.avg_parse_count ?? null,
          p95_latency_ms: cfg.p95_latency_ms ?? null,
          metrics_24h: {
            source_key: sourceKey,
            window_hours: 24,
            ...metrics,
            last_success_at: cfg.last_success_at ?? null,
            last_error: cfg.last_error ?? null,
            // Client SourceMetrics expects status_distribution but the
            // legacy `warrant_scraper_runs` table doesn't exist here —
            // we project the same insight from run statuses we DO have.
            status_distribution: {
              completed: metrics.successful_runs,
              failed: metrics.failed_runs,
            } as Record<string, number>,
          },
        };
      }),
    );

    return c.json({ sources });
  } catch (err) {
    console.error('[warrants] /scrapers error', err);
    // Empty shape is what the legacy handler returned on its own (broken)
    // schema queries. Keep the same degraded UX so the page renders.
    return c.json({ sources: [] });
  }
});

// GET /warrants/scrapers/health — header badge in Layout.tsx (30s poll).
// Aggregates each source's grade into healthy/degraded/failed buckets so
// the badge can show "🟢 3/3 healthy" / "🟡 2/3 degraded" / "🔴 1/3 failed."
warrants.get('/scrapers/health', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const configRows = await query<Record<string, any>>(
      db,
      'SELECT source_name FROM warrant_scraper_config',
    );
    let healthy = 0;
    let degraded = 0;
    let failed = 0;
    let circuit_broken = 0;
    const total = configRows.length;

    for (const cfg of configRows) {
      const runs24h = await query<RunRow>(
        db,
        `SELECT started_at, completed_at, status, errors, persons_checked,
                new_warrants_found, warrants_cleared, error_message
           FROM warrant_watch_runs
          WHERE started_at >= datetime('now', '-24 hours')
          ORDER BY started_at DESC`,
      );
      const trailing = await query<RunRow>(
        db,
        `SELECT started_at, completed_at, status, errors, persons_checked,
                new_warrants_found, warrants_cleared, error_message
           FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 10`,
      );
      const m = summarizeRuns(runs24h, trailing);
      // Same A-F → 3-bucket roll-up as the legacy handler so the badge
      // colors don't shift when this Worker takes over the path.
      if (m.total_runs === 0) failed++;
      else if (m.health_grade === 'A' || m.health_grade === 'B') healthy++;
      else if (m.health_grade === 'C' || m.health_grade === 'D') degraded++;
      else failed++;
      if (m.consecutive_errors >= 5) circuit_broken++;
    }

    // Last-hour activity is read directly from runs because it's a
    // global figure (not per-source) — the badge shows "12 runs in the
    // last hour" as a freshness hint.
    const lastHourRow = await query<{ runs: number; inserted: number }>(
      db,
      `SELECT COUNT(*) AS runs,
              COALESCE(SUM(new_warrants_found), 0) AS inserted
         FROM warrant_watch_runs
        WHERE started_at >= datetime('now', '-1 hour')`,
    );
    const last_hour_runs = lastHourRow[0]?.runs ?? 0;
    const last_hour_inserted = lastHourRow[0]?.inserted ?? 0;

    return c.json({
      healthy,
      degraded,
      failed,
      circuit_broken,
      total,
      last_hour_runs,
      last_hour_inserted,
    });
  } catch (err) {
    console.error('[warrants] /scrapers/health error', err);
    // Degraded UX > 500. The badge will render "0/0 healthy" which is
    // a self-evidently weird state and the operator opens the Sources
    // tab to dig in (where the real error surfaces).
    return c.json({
      healthy: 0,
      degraded: 0,
      failed: 0,
      circuit_broken: 0,
      total: 0,
      last_hour_runs: 0,
      last_hour_inserted: 0,
    });
  }
});

// POST /warrants/scrapers/:source_key/trigger — "Scan Now" button on a
// specific scraper card. Same fire-and-forget pattern as /watch/scan
// (waitUntil → return 202 immediately) because a full scan paces
// ~8s/person and blows past the request timeout if awaited.
//
// Tighter role gate (SCAN_ROLES) than reads — triggering pulls an
// external API for every roster row.
warrants.post('/scrapers/:source_key/trigger', requireRole(...SCAN_ROLES), async (c) => {
  const sourceKey = c.req.param('source_key');
  if (sourceKey !== 'utah-warrant-watch') {
    // Future-proofing: when a second scraper lands, dispatch on
    // sourceKey to its own runner. For now, refuse loudly so we
    // don't silently pretend to scan something unimplemented.
    return c.json({ error: `No scraper registered for source_key '${sourceKey}'` }, 404);
  }
  const db = getDb(c.env);
  c.executionCtx.waitUntil(
    runUtahWarrantScan(db).catch((err) => {
      console.error('[warrants] scrapers/:key/trigger scan failed:', err);
    }),
  );
  return c.json(
    { success: true, started: true, message: `Scan started for ${sourceKey}; poll /watch/runs.` },
    202,
  );
});

// POST /warrants/scrapers/:source_key/reset-circuit — "Reset Circuit"
// button. We have no circuit_broken column to flip, so clearing
// last_error is the operationally equivalent action: the dashboard
// derives circuit state from consecutive_errors (which falls to 0
// the moment the next run succeeds). Nulling last_error lets the
// next render show a clean state without waiting for a run.
warrants.post('/scrapers/:source_key/reset-circuit', requireRole(...SCAN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const sourceKey = c.req.param('source_key');
    const result = await db
      .prepare('UPDATE warrant_scraper_config SET last_error = NULL WHERE source_name = ?')
      .bind(sourceKey)
      .run();
    // changes === 0 means no row matched. Honest 404 prevents the
    // user from thinking they cleared a circuit they didn't.
    if ((result.meta?.changes ?? 0) === 0) {
      return c.json({ error: `No scraper registered for source_key '${sourceKey}'` }, 404);
    }
    return c.json({ success: true, message: `Circuit reset for ${sourceKey}` });
  } catch (err) {
    console.error('[warrants] reset-circuit error', err);
    return c.json({ error: 'Failed to reset circuit' }, 500);
  }
});

export default warrants;
