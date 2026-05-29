// Warrants routes for the CF Worker. Initially minimal — surfaces the
// warrant-watch run history that the legacy server's /warrants page
// + dashboard widget consume. The CRUD warrant routes (list, create,
// archive, etc.) stay on the legacy server until the full warrants
// subsystem is migrated.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, execute } from '../utils/db';
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
// Scraper Sources — WarrantsPage Sources/Scrapers tab + Layout badge
// ============================================================
// Surfaces /warrants/scrapers + /scrapers/health, fed by warrant_scraper_config
// (one config row per source) joined with run-derived metrics from
// warrant_watch_runs. Legacy implemented NONE of these; the tab was 404-empty.
//
// Per-source presentation metadata (display name, URL, state) lives here as a
// small registry rather than on warrant_scraper_config — adding a new source
// in the future = one entry here + one seed row in the table.
const SOURCE_REGISTRY: Record<string, { display_name: string; state: string; county: string | null; source_url: string }> = {
  'utah-warrant-watch': {
    display_name: 'Utah Warrant Watch',
    state: 'UT',
    county: null,
    source_url: 'https://warrants.utah.gov',
  },
};

function gradeFromSuccessRate(rate: number, totalRuns: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (totalRuns === 0) return 'A'; // no runs in window → no failure signal
  if (rate >= 0.95) return 'A';
  if (rate >= 0.85) return 'B';
  if (rate >= 0.70) return 'C';
  if (rate >= 0.50) return 'D';
  return 'F';
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// Computes 24h SourceMetrics + presentation fields for one config row.
async function buildScraperSource(c: Context<Env>, config: Record<string, any>) {
  const db = getDb(c.env);
  const sourceKey = config.source_name;
  const meta = SOURCE_REGISTRY[sourceKey] ?? {
    display_name: sourceKey, state: '', county: null, source_url: '',
  };

  const runs = await query<Record<string, any>>(
    db,
    `SELECT started_at, completed_at, status, persons_checked, new_warrants_found,
            warrants_cleared, errors, error_message
       FROM warrant_watch_runs
      WHERE started_at >= datetime('now', '-24 hours')
      ORDER BY started_at DESC`,
  );

  const total = runs.length;
  const successful = runs.filter((r) => r.status === 'completed').length;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const unchanged = runs.filter((r) => r.status === 'completed' && (r.new_warrants_found ?? 0) === 0).length;
  const successRate = total > 0 ? successful / total : 1;
  const grade = gradeFromSuccessRate(successRate, total);

  const durations = runs
    .filter((r) => r.completed_at && r.started_at)
    .map((r) => new Date(r.completed_at).getTime() - new Date(r.started_at).getTime())
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);
  const avgDuration = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;

  const totalInserted = runs.reduce((s, r) => s + (r.new_warrants_found ?? 0), 0);
  const totalUpdated = runs.reduce((s, r) => s + (r.warrants_cleared ?? 0), 0);
  const lastFailed = runs.find((r) => r.status === 'failed');
  const lastCompleted = runs.find((r) => r.status === 'completed');

  // Consecutive failures at the head (most recent first) → circuit-broken
  // heuristic. 3+ consecutive failures = broken; self-clears on next success.
  let consecutiveErrors = 0;
  for (const r of runs) {
    if (r.status === 'failed') consecutiveErrors++;
    else break;
  }
  const circuitBroken = consecutiveErrors >= 3 ? 1 : 0;

  const warrantCountRows = await query<{ warrant_count: number }>(
    db, 'SELECT COUNT(*) AS warrant_count FROM utah_warrants WHERE source = ? AND is_active = 1', sourceKey);
  const warrant_count = warrantCountRows[0]?.warrant_count ?? 0;

  return {
    source_key: sourceKey,
    display_name: meta.display_name,
    state: meta.state,
    county: meta.county,
    source_url: meta.source_url,
    source_type: config.source_type ?? 'api',
    enabled: 1 as 1,
    circuit_broken: circuitBroken as 0 | 1,
    priority: (config.priority ?? 1) as 1 | 2 | 3 | 4,
    consecutive_errors: consecutiveErrors,
    warrant_count,
    last_scrape_at: config.last_run_at ?? lastCompleted?.completed_at ?? lastCompleted?.started_at ?? null,
    last_success_at: config.last_success_at ?? lastCompleted?.completed_at ?? null,
    last_error: config.last_error ?? lastFailed?.error_message ?? null,
    avg_parse_count: config.avg_parse_count ?? null,
    p95_latency_ms: config.p95_latency_ms ?? (durations.length ? percentile(durations, 95) : null),
    metrics_24h: {
      source_key: sourceKey,
      window_hours: 24,
      total_runs: total,
      successful_runs: successful,
      unchanged_runs: unchanged,
      failed_runs: failed,
      success_rate: Math.round(successRate * 1000) / 1000,
      avg_duration_ms: avgDuration,
      p50_duration_ms: percentile(durations, 50),
      p95_duration_ms: percentile(durations, 95),
      avg_parsed: total > 0 ? Math.round(totalInserted / total) : 0,
      total_inserted: totalInserted,
      total_updated: totalUpdated,
      last_error: lastFailed?.error_message ?? null,
      last_error_at: lastFailed?.started_at ?? null,
      last_success_at: lastCompleted?.completed_at ?? null,
      status_distribution: { completed: successful, failed, running: total - successful - failed },
      health_grade: grade,
    },
  };
}

// GET /warrants/scrapers — list configured sources with synthesized metrics.
warrants.get('/scrapers', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const configs = await query<Record<string, any>>(
      db, 'SELECT * FROM warrant_scraper_config ORDER BY priority, source_name');
    const sources = await Promise.all(configs.map((cfg) => buildScraperSource(c, cfg)));
    return c.json({ sources });
  } catch (err) {
    console.error('[warrants] scrapers list error', err);
    return c.json({ sources: [] });
  }
});

// GET /warrants/scrapers/health — aggregate over the sources list. Also drives
// the global header badge in Layout.tsx (polled every 30s).
warrants.get('/scrapers/health', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const configs = await query<Record<string, any>>(db, 'SELECT * FROM warrant_scraper_config');
    const sources = await Promise.all(configs.map((cfg) => buildScraperSource(c, cfg)));

    let healthy = 0, degraded = 0, failed = 0, circuit_broken = 0;
    for (const s of sources) {
      if (s.circuit_broken) circuit_broken++;
      const g = s.metrics_24h.health_grade;
      if (g === 'A' || g === 'B') healthy++;
      else if (g === 'C' || g === 'D') degraded++;
      else failed++;
    }

    const hourly = await query<{ runs: number; inserted: number }>(
      db,
      `SELECT COUNT(*) AS runs, COALESCE(SUM(new_warrants_found), 0) AS inserted
         FROM warrant_watch_runs WHERE started_at >= datetime('now', '-1 hour')`,
    );

    return c.json({
      healthy, degraded, failed, circuit_broken,
      total: sources.length,
      last_hour_runs: hourly[0]?.runs ?? 0,
      last_hour_inserted: hourly[0]?.inserted ?? 0,
    });
  } catch (err) {
    console.error('[warrants] scrapers health error', err);
    return c.json({
      healthy: 0, degraded: 0, failed: 0, circuit_broken: 0,
      total: 0, last_hour_runs: 0, last_hour_inserted: 0,
    });
  }
});

// POST /warrants/scrapers/:source_key/trigger — manual on-demand run.
// utah-warrant-watch is the only source today; fires runUtahWarrantScan
// fire-and-forget (same async pattern as the cron + /watch/scan).
warrants.post('/scrapers/:source_key/trigger', requireRole(...SCAN_ROLES), async (c) => {
  const sourceKey = c.req.param('source_key');
  if (sourceKey !== 'utah-warrant-watch') {
    return c.json({ error: `Unknown source '${sourceKey}'`, code: 'UNKNOWN_SOURCE' }, 404);
  }
  const db = getDb(c.env);
  c.executionCtx.waitUntil(
    runUtahWarrantScan(db).catch((err) => console.error('[scrapers] manual trigger failed:', err)),
  );
  return c.json({ success: true, started: true, source_key: sourceKey }, 202);
});

// POST /warrants/scrapers/:source_key/reset-circuit — operator clears the
// circuit-broken state by zeroing the persisted last_error on the config row.
// circuit_broken itself is DERIVED (consecutive_errors>=3 head of run window),
// so it self-clears on the next successful run; this endpoint is the
// "I've looked at the error, move on" acknowledgment gesture.
warrants.post('/scrapers/:source_key/reset-circuit', requireRole(...SCAN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const sourceKey = c.req.param('source_key');
    const cfg = await query<{ id: number }>(db, 'SELECT id FROM warrant_scraper_config WHERE source_name = ?', sourceKey);
    if (cfg.length === 0) return c.json({ error: 'Unknown source', code: 'UNKNOWN_SOURCE' }, 404);
    await execute(db, 'UPDATE warrant_scraper_config SET last_error = NULL WHERE id = ?', cfg[0].id);
    return c.json({ success: true, source_key: sourceKey });
  } catch (err) {
    console.error('[warrants] reset-circuit error', err);
    return c.json({ error: 'Failed to reset circuit', code: 'RESET_CIRCUIT_ERR' }, 500);
  }
});

export default warrants;
