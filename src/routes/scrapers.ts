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
import { getDb, query } from '../utils/db';
import { isCircuitOpen } from '../utils/warrantSources/resilience';
import { runUtahWarrantScan } from '../utils/utahWarrantPoller';
import { getEnabledAdapters } from '../utils/warrantSources/registry';
import { getConfigAdapters } from '../utils/warrantSources/configRegistry';
import { runFullListLeg } from '../utils/warrantSources/runScan';

const scrapers = new Hono<Env>();

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
    last_success_at: string | null; status_distribution: Record<string, number>; health_grade: null;
  };
}

function zeroedMetrics(sourceKey: string, lastError: string | null, lastSuccessAt: string | null): MergedSource['metrics_24h'] {
  return {
    source_key: sourceKey, window_hours: 24, total_runs: 0, successful_runs: 0, unchanged_runs: 0,
    failed_runs: 0, success_rate: 0, avg_duration_ms: 0, p50_duration_ms: 0, p95_duration_ms: 0,
    avg_parsed: 0, total_inserted: 0, total_updated: 0, last_error: lastError,
    last_error_at: null, last_success_at: lastSuccessAt, status_distribution: {}, health_grade: null,
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
      metrics_24h: zeroedMetrics(key, row.last_error, row.last_success_at),
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
      metrics_24h: zeroedMetrics(row.source_key, null, null),
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
      return c.json({ success: true, source_key: key, result });
    } catch (err) {
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }

  const codeAdapters = await getEnabledAdapters(db);
  const codeMatch = codeAdapters.find((a) => a.meta.key === key);
  if (codeMatch) {
    const configRow = await query<{ enabled: number }>(
      db,
      'SELECT enabled FROM warrant_scraper_config WHERE source_name = ?',
      key,
    );
    if (configRow.length > 0 && configRow[0].enabled === 0) {
      return c.json({ error: 'This source is disabled — enable it before triggering' }, 400);
    }
    try {
      const summaries = await runFullListLeg(db, [codeMatch]);
      return c.json({ success: true, source_key: key, result: summaries[0] ?? null });
    } catch (err) {
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }

  const configAdapters = await getConfigAdapters(db);
  const configMatch = configAdapters.find((a) => a.meta.key === key);
  if (configMatch) {
    try {
      const summaries = await runFullListLeg(db, [configMatch]);
      return c.json({ success: true, source_key: key, result: summaries[0] ?? null });
    } catch (err) {
      return c.json({ error: 'Trigger failed', detail: (err as Error).message }, 502);
    }
  }

  return c.json({ error: `Unknown source key: ${key}` }, 404);
});

export default scrapers;
