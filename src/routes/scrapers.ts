// ============================================================
// RMPG Flex — Warrant Scraper Ops (Cloudflare Worker)
// ============================================================
// Backs BOTH client tabs that manage warrant-source scrapers:
//   - client/src/pages/warrants/ScrapersTab.tsx (list/health/trigger/
//     reset-circuit)
//   - client/src/pages/admin/AdminWarrantScrapersTab.tsx (bulk enable/
//     disable)
// Neither had a matching backend route before this PR — a broken-
// functionality audit (2026-07-04) found the entire /api/warrants/
// scrapers* surface unbuilt on the Worker.
//
// Two warrant-source frameworks coexist and both show up in one merged
// list here:
//   - warrant_scraper_config (code-resident ADAPTERS in
//     src/utils/warrantSources/registry.ts — Utah + a few counties)
//   - national_warrant_sources (the federated Socrata/ArcGIS/PDF pull,
//     PR #1221+)
//
// No run-history table this round (see design doc) — metrics_24h ships
// zeroed/null. circuit_broken is derived per-request from
// consecutive_errors via the existing isCircuitOpen() pure function —
// no separate stored flag to drift out of sync.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { execute, getDb, query } from '../utils/db';
import { isCircuitOpen } from '../utils/warrantSources/resilience';
import { runUtahWarrantScan } from '../utils/utahWarrantPoller';
import { ADAPTERS, getEnabledAdapters } from '../utils/warrantSources/registry';
import { getConfigAdapters } from '../utils/warrantSources/configRegistry';
import { runFullListLeg } from '../utils/warrantSources/runScan';
import { insertScraperRunRow } from '../utils/warrantSources/logScanResult';
import { computeHealthGrade, MAX_RUNS_CONSIDERED, type HealthGrade } from '../utils/warrantSources/healthGrade';

const scrapers = new Hono<Env>();

// Best-effort scraper_runs INSERT for a single manual trigger attempt — logging
// must never break the trigger response, matching the pattern established for
// the cron path's logScanResult.ts (Task 3). Shares its row-insert SQL with
// logScanResult via insertScraperRunRow() so the two paths can't drift out of
// sync on column list/order or the success-derivation rule. NOT routed through
// logScanResult() itself: that helper is shaped for the cron sweep's
// AllSourceScanResult (Utah + array of scraped summaries), whereas a manual
// trigger only ever scans ONE source per request.
async function logManualRun(
  db: D1Database,
  sourceKey: string,
  counts: { checked: number; found: number; cleared: number; errors: number },
): Promise<void> {
  try {
    await insertScraperRunRow(db, sourceKey, counts, 'manual');
  } catch (err) {
    console.error(`scraper_runs insert failed for ${sourceKey}:`, err instanceof Error ? err.message : String(err));
  }
}

// isCircuitOpen() expects a trailing per-run error-count history (newest
// first) and counts a *consecutive* streak of failed runs from the front of
// the array. We don't have per-run history yet (see design doc) — only a
// single running `consecutive_errors` tally per source. Expanding it into a
// same-length array of that count (e.g. errors=6 -> [6,6,6,6,6,6]) is
// equivalent for this function's purposes: every entry is "failed" (>0), so
// the consecutive streak equals the array length, which reaches the
// CIRCUIT_THRESHOLD (5) once consecutive_errors itself is >= 5.
function circuitOpenFromConsecutiveErrors(consecutiveErrors: number): boolean {
  if (consecutiveErrors <= 0) return false;
  return isCircuitOpen(Array(consecutiveErrors).fill(consecutiveErrors));
}

interface MergedSource {
  source_key: string;
  display_name: string;
  state: string;
  county: string | null;
  source_url: string;
  source_type: string;
  enabled: 0 | 1;
  circuit_broken: 0 | 1;
  priority: number;
  consecutive_errors: number;
  warrant_count: number;
  last_scrape_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  avg_parse_count: number | null;
  p95_latency_ms: number | null;
  metrics_24h: {
    source_key: string; window_hours: number; total_runs: number; successful_runs: number;
    unchanged_runs: number; failed_runs: number; success_rate: number; avg_duration_ms: number;
    p50_duration_ms: number; p95_duration_ms: number; avg_parsed: number; total_inserted: number;
    total_updated: number; last_error: string | null; last_error_at: string | null;
    last_success_at: string | null; status_distribution: Record<string, number>; health_grade: HealthGrade | null;
  };
}

interface ScraperRunRow {
  source_key: string;
  success: number;
  checked: number;
  found: number;
  cleared: number;
  errors: number;
  duration_ms: number | null;
  started_at: string;
  finished_at: string;
}

// Builds real metrics_24h from a source's own run-history slice (already
// ordered newest-first and capped to the last 20 by the caller). Replaces
// the old zeroedMetrics() placeholder now that scraper_runs exists — see
// docs/superpowers/specs/2026-07-04-scraper-health-grades-design.md.
function buildMetrics(
  sourceKey: string,
  runs: ScraperRunRow[],
  lastError: string | null,
  lastSuccessAt: string | null,
): MergedSource['metrics_24h'] {
  const totalRuns = runs.length;
  const successfulRuns = runs.filter((r) => r.success === 1).length;
  const failedRuns = totalRuns - successfulRuns;
  const successRate = totalRuns === 0 ? 0 : successfulRuns / totalRuns;

  const durations = runs
    .map((r) => r.duration_ms)
    .filter((d): d is number => d != null);
  const avgDurationMs = durations.length === 0
    ? 0
    : durations.reduce((sum, d) => sum + d, 0) / durations.length;

  return {
    source_key: sourceKey,
    window_hours: 24,
    total_runs: totalRuns,
    successful_runs: successfulRuns,
    unchanged_runs: 0,
    failed_runs: failedRuns,
    success_rate: successRate,
    avg_duration_ms: avgDurationMs,
    p50_duration_ms: 0,
    p95_duration_ms: 0,
    avg_parsed: 0,
    total_inserted: 0,
    total_updated: 0,
    last_error: lastError,
    last_error_at: null,
    last_success_at: lastSuccessAt,
    status_distribution: {},
    health_grade: computeHealthGrade(runs.map((r) => ({ success: r.success === 1 }))),
  };
}

async function getMergedSources(db: D1Database): Promise<MergedSource[]> {
  const configRows = await query<{
    source_name: string; last_error: string | null; source_type: string | null; priority: number | null;
    last_run_at: string | null; last_success_at: string | null; avg_parse_count: number | null;
    p95_latency_ms: number | null; enabled: number; consecutive_errors: number;
  }>(db, `SELECT source_name, last_error, source_type, priority, last_run_at, last_success_at,
    avg_parse_count, p95_latency_ms, enabled, consecutive_errors FROM warrant_scraper_config`);

  const nationalRows = await query<{
    source_key: string; display_name: string; state: string | null; jurisdiction: string | null;
    format: string; enabled: number; priority: number; consecutive_errors: number;
  }>(db, `SELECT source_key, display_name, state, jurisdiction, format, enabled, priority, consecutive_errors
    FROM national_warrant_sources`);

  // Single grouped query for all sources' active warrant counts, instead of
  // one COUNT(*) per source row (N+1) — this file is expected to grow more
  // routes (health/trigger/reset-circuit), so batching this now avoids the
  // pattern getting copy-pasted forward.
  const countRows = await query<{ source_key: string; n: number }>(
    db, `SELECT source_key, COUNT(*) as n FROM scraped_warrants WHERE status = 'active' GROUP BY source_key`,
  );
  const countsByKey = new Map(countRows.map((r) => [r.source_key, r.n]));

  // Single batched query for ALL scraper_runs, grouped client-side per
  // source_key — same anti-N+1 pattern as countRows above. Ordered
  // source_key, started_at DESC so each source's array is already
  // newest-first; sliced to the last 20 entries per source below before
  // being handed to computeHealthGrade/buildMetrics.
  const runRows = await query<ScraperRunRow>(
    db, `SELECT source_key, success, checked, found, cleared, errors, duration_ms, started_at, finished_at
      FROM scraper_runs ORDER BY source_key, started_at DESC`,
  );
  const runsByKey = new Map<string, ScraperRunRow[]>();
  for (const row of runRows) {
    const list = runsByKey.get(row.source_key);
    if (list) {
      list.push(row);
    } else {
      runsByKey.set(row.source_key, [row]);
    }
  }

  const out: MergedSource[] = [];

  for (const row of configRows) {
    const key = row.source_name;
    out.push({
      source_key: key,
      display_name: key, // no human-readable name column on this table yet — intentional, not a bug
      state: '', county: null, source_url: '', // not tracked by warrant_scraper_config today
      source_type: row.source_type ?? 'unknown',
      enabled: (row.enabled ?? 1) ? 1 : 0,
      circuit_broken: circuitOpenFromConsecutiveErrors(row.consecutive_errors) ? 1 : 0,
      priority: row.priority ?? 3,
      consecutive_errors: row.consecutive_errors,
      warrant_count: countsByKey.get(key) ?? 0,
      last_scrape_at: row.last_run_at,
      last_success_at: row.last_success_at,
      last_error: row.last_error,
      avg_parse_count: row.avg_parse_count,
      p95_latency_ms: row.p95_latency_ms,
      metrics_24h: buildMetrics(key, (runsByKey.get(key) ?? []).slice(0, MAX_RUNS_CONSIDERED), row.last_error, row.last_success_at),
    });
  }

  for (const row of nationalRows) {
    out.push({
      source_key: row.source_key,
      display_name: row.display_name,
      state: row.state ?? '',
      county: row.jurisdiction,
      source_url: '', // national_warrant_sources.base_url exists but isn't a client-facing URL — left blank for now
      source_type: row.format,
      enabled: row.enabled ? 1 : 0,
      circuit_broken: circuitOpenFromConsecutiveErrors(row.consecutive_errors) ? 1 : 0,
      priority: row.priority,
      consecutive_errors: row.consecutive_errors,
      warrant_count: countsByKey.get(row.source_key) ?? 0,
      last_scrape_at: null,
      last_success_at: null,
      last_error: null,
      avg_parse_count: null,
      p95_latency_ms: null,
      metrics_24h: buildMetrics(row.source_key, (runsByKey.get(row.source_key) ?? []).slice(0, MAX_RUNS_CONSIDERED), null, null),
    });
  }

  return out;
}

scrapers.get('/', async (c) => {
  const db = getDb(c.env);
  const sources = await getMergedSources(db);
  return c.json({ sources });
});

scrapers.get('/health', async (c) => {
  const db = getDb(c.env);
  const sources = await getMergedSources(db);
  const circuit_broken = sources.filter((s) => s.circuit_broken === 1).length;
  const failed = sources.filter((s) => s.last_error && s.circuit_broken === 0).length;
  const healthy = sources.length - circuit_broken - failed;
  // `failed` is always 0: distinguishing "fully dead" from "degraded but
  // still running" needs per-run history we don't have yet (see the
  // no-run-history-table note at the top of this file). A source with a
  // lingering last_error that hasn't tripped the circuit breaker is
  // reported as `degraded`, not `failed` — don't "fix" this by swapping
  // the two without also adding the history table that would justify it.
  return c.json({
    healthy,
    degraded: failed,
    failed: 0,
    circuit_broken,
    total: sources.length,
    last_hour_runs: 0,
    last_hour_inserted: 0,
  });
});

scrapers.post('/:key/trigger', async (c) => {
  const user = c.get('user') as { role?: string } | undefined;
  if (!user?.role || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const db = getDb(c.env);
  const key = c.req.param('key');

  if (key === 'utah-warrant-watch') {
    try {
      const result = await runUtahWarrantScan(db);
      await logManualRun(db, key, {
        checked: result.persons_checked, found: result.new_warrants_found,
        cleared: result.warrants_cleared, errors: result.errors,
      });
      return c.json({ success: true, source_key: key, result });
    } catch (err) {
      await logManualRun(db, key, { checked: 0, found: 0, cleared: 0, errors: 1 });
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }

  // getEnabledAdapters() now filters out disabled sources at the query level
  // (WHERE enabled = 1 in warrant_scraper_config — see registry.ts), so a
  // disabled code-resident source simply never appears in codeAdapters here.
  const codeAdapters = await getEnabledAdapters(db);
  const codeMatch = codeAdapters.find((a) => a.meta.key === key);
  if (codeMatch) {
    try {
      const summaries = await runFullListLeg(db, [codeMatch]);
      const result = summaries[0] ?? null;
      if (result) {
        await logManualRun(db, key, {
          checked: result.checked, found: result.found, cleared: result.cleared, errors: result.errors,
        });
      }
      return c.json({ success: true, source_key: key, result });
    } catch (err) {
      await logManualRun(db, key, { checked: 0, found: 0, cleared: 0, errors: 1 });
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }

  const configAdapters = await getConfigAdapters(db);
  const configMatch = configAdapters.find((a) => a.meta.key === key);
  if (configMatch) {
    try {
      const summaries = await runFullListLeg(db, [configMatch]);
      const result = summaries[0] ?? null;
      if (result) {
        await logManualRun(db, key, {
          checked: result.checked, found: result.found, cleared: result.cleared, errors: result.errors,
        });
      }
      return c.json({ success: true, source_key: key, result });
    } catch (err) {
      await logManualRun(db, key, { checked: 0, found: 0, cleared: 0, errors: 1 });
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }

  // Key not found in either enabled adapter set. If it's a KNOWN
  // code-resident adapter (in ADAPTERS) that's simply disabled in config,
  // surface a clear "disabled" message instead of a generic 404 — a single
  // lightweight lookup, only on this not-found fallback path (no duplication
  // of the unconditional query the code used to run on every trigger).
  const knownAdapter = ADAPTERS.find((a) => a.meta.key === key);
  if (knownAdapter) {
    const configRow = await query<{ enabled: number }>(
      db,
      'SELECT enabled FROM warrant_scraper_config WHERE source_name = ?',
      key,
    );
    if (configRow.length > 0 && configRow[0].enabled === 0) {
      return c.json({ error: 'This source is disabled — enable it before triggering' }, 400);
    }
  }

  return c.json({ error: `Unknown source key: ${key}` }, 404);
});

scrapers.post('/:key/reset-circuit', async (c) => {
  const user = c.get('user') as { role?: string } | undefined;
  if (!user?.role || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const db = getDb(c.env);
  const key = c.req.param('key');

  // circuit_broken is derived from consecutive_errors (see
  // circuitOpenFromConsecutiveErrors() above) — there's no separate stored
  // flag to close, so zeroing consecutive_errors on whichever framework's
  // table the key belongs to reopens the circuit for both list/health reads.
  const configResult = await execute(
    db, `UPDATE warrant_scraper_config SET consecutive_errors = 0 WHERE source_name = ?`, key,
  );
  if (configResult.meta.changes > 0) return c.json({ success: true, source_key: key });

  const nationalResult = await execute(
    db, `UPDATE national_warrant_sources SET consecutive_errors = 0 WHERE source_key = ?`, key,
  );
  if (nationalResult.meta.changes > 0) return c.json({ success: true, source_key: key });

  return c.json({ error: `Unknown source key: ${key}` }, 404);
});

type BulkAction = 'enable' | 'disable' | 'reset' | 'set_priority';
const VALID_BULK_ACTIONS: BulkAction[] = ['enable', 'disable', 'reset', 'set_priority'];
const MIN_PRIORITY = 1;
const MAX_PRIORITY = 4;

// Applies a single per-key UPDATE across both warrant-source frameworks —
// try warrant_scraper_config (code-resident ADAPTERS) first, fall back to
// national_warrant_sources (the federated Socrata/ArcGIS/PDF pull) if the
// key didn't match there. Mirrors the dual-table fallback used by
// POST /:key/reset-circuit above, generalized for the 4 bulk actions.
async function applyToKey(
  db: ReturnType<typeof getDb>,
  key: string,
  configSql: string,
  nationalSql: string,
  value: number,
): Promise<boolean> {
  const configResult = await execute(db, configSql, value, key);
  if (configResult.meta.changes > 0) return true;

  const nationalResult = await execute(db, nationalSql, value, key);
  return nationalResult.meta.changes > 0;
}

scrapers.post('/bulk', async (c) => {
  const user = c.get('user') as { role?: string } | undefined;
  if (!user?.role || !['admin', 'manager'].includes(user.role)) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const body = await c.req.json<{ source_keys?: string[]; action?: string; priority?: number }>();
  if (!Array.isArray(body.source_keys) || body.source_keys.length === 0) {
    return c.json({ error: 'source_keys (non-empty array) is required' }, 400);
  }
  if (!body.action || !VALID_BULK_ACTIONS.includes(body.action as BulkAction)) {
    return c.json({ error: `action must be one of: ${VALID_BULK_ACTIONS.join(', ')}` }, 400);
  }
  const action = body.action as BulkAction;

  if (action === 'set_priority') {
    if (typeof body.priority !== 'number' || body.priority < MIN_PRIORITY || body.priority > MAX_PRIORITY) {
      return c.json({ error: `priority must be a number between ${MIN_PRIORITY} and ${MAX_PRIORITY}` }, 400);
    }
  }

  const db = getDb(c.env);
  let affected = 0;

  for (const key of body.source_keys) {
    let matched = false;
    switch (action) {
      case 'enable':
        matched = await applyToKey(
          db, key,
          `UPDATE warrant_scraper_config SET enabled = ? WHERE source_name = ?`,
          `UPDATE national_warrant_sources SET enabled = ? WHERE source_key = ?`,
          1,
        );
        break;
      case 'disable':
        matched = await applyToKey(
          db, key,
          `UPDATE warrant_scraper_config SET enabled = ? WHERE source_name = ?`,
          `UPDATE national_warrant_sources SET enabled = ? WHERE source_key = ?`,
          0,
        );
        break;
      case 'reset':
        matched = await applyToKey(
          db, key,
          `UPDATE warrant_scraper_config SET consecutive_errors = ? WHERE source_name = ?`,
          `UPDATE national_warrant_sources SET consecutive_errors = ? WHERE source_key = ?`,
          0,
        );
        break;
      case 'set_priority':
        matched = await applyToKey(
          db, key,
          `UPDATE warrant_scraper_config SET priority = ? WHERE source_name = ?`,
          `UPDATE national_warrant_sources SET priority = ? WHERE source_key = ?`,
          body.priority as number,
        );
        break;
    }
    if (matched) affected++;
  }

  return c.json({ success: true, affected });
});

export default scrapers;
