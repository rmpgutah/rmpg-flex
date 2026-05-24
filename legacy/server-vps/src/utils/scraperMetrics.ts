// ============================================================
// Scraper Metrics — Rolling aggregates from warrant_scraper_runs
// ============================================================
// Computes per-source success rates, latency percentiles, and
// health grades from the warrant_scraper_runs table. Used by
// the scrapers API endpoints and the admin dashboard.
// ============================================================

import Database from 'better-sqlite3';
import { getDb } from '../models/database';

export type ScraperHealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface SourceMetrics {
  source_key: string;
  window_hours: number;
  total_runs: number;
  successful_runs: number;
  unchanged_runs: number;
  failed_runs: number;
  success_rate: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  avg_parsed: number;
  total_inserted: number;
  total_updated: number;
  last_error: string | null;
  last_error_at: string | null;
  last_success_at: string | null;
  status_distribution: Record<string, number>;
  health_grade: ScraperHealthGrade;
}

export interface HealthSummary {
  healthy: number;
  degraded: number;
  failed: number;
  circuit_broken: number;
  total: number;
  last_hour_runs: number;
  last_hour_inserted: number;
}

interface RunRow {
  started_at: string;
  duration_ms: number | null;
  http_status: number | null;
  parsed_count: number | null;
  inserted_count: number | null;
  updated_count: number | null;
  skipped_reason: string | null;
  error_message: string | null;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  const clamped = Math.max(0, Math.min(sortedValues.length - 1, idx));
  return sortedValues[clamped];
}

export function computeHealthGrade(
  successRate: number,
  lastSuccessAt: string | null,
  intervalHours: number
): ScraperHealthGrade {
  if (!lastSuccessAt) return 'F';
  const hoursSinceSuccess = (Date.now() - new Date(lastSuccessAt).getTime()) / 3_600_000;
  const staleMultiple = hoursSinceSuccess / intervalHours;

  if (successRate >= 0.95 && staleMultiple < 2) return 'A';
  if (successRate >= 0.8 && staleMultiple < 4) return 'B';
  if (successRate >= 0.5 && staleMultiple < 12) return 'C';
  if (successRate >= 0.2 && staleMultiple < 24) return 'D';
  return 'F';
}

export function getSourceMetrics(
  sourceKey: string,
  windowHours: number = 24,
  dbOverride?: Database.Database
): SourceMetrics {
  const db = dbOverride ?? getDb();

  const rows = db
    .prepare(
      `SELECT started_at, duration_ms, http_status, parsed_count,
              inserted_count, updated_count, skipped_reason, error_message
       FROM warrant_scraper_runs
       WHERE source_key = ?
         AND started_at >= datetime('now', '-' || ? || ' hours')
       ORDER BY started_at DESC`
    )
    .all(sourceKey, windowHours) as RunRow[];

  const total_runs = rows.length;

  const successful_runs = rows.filter(
    (r) => r.http_status === 200 && (r.parsed_count ?? 0) > 0
  ).length;

  const unchanged_runs = rows.filter(
    (r) =>
      r.skipped_reason === 'content_unchanged' ||
      r.skipped_reason === 'not_modified' ||
      r.http_status === 304
  ).length;

  const failed_runs = rows.filter(
    (r) =>
      r.error_message != null ||
      (r.http_status != null && r.http_status >= 400 && r.http_status !== 404)
  ).length;

  const success_rate =
    total_runs === 0 ? 0 : (successful_runs + unchanged_runs) / total_runs;

  const durations = rows
    .map((r) => r.duration_ms)
    .filter((d): d is number => typeof d === 'number')
    .sort((a, b) => a - b);

  const avg_duration_ms =
    durations.length === 0
      ? 0
      : durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const p50_duration_ms = percentile(durations, 50);
  const p95_duration_ms = percentile(durations, 95);

  const avg_parsed =
    total_runs === 0
      ? 0
      : rows.reduce((sum, r) => sum + (r.parsed_count ?? 0), 0) / total_runs;

  const total_inserted = rows.reduce((sum, r) => sum + (r.inserted_count ?? 0), 0);
  const total_updated = rows.reduce((sum, r) => sum + (r.updated_count ?? 0), 0);

  const errorRow = rows.find((r) => r.error_message != null);
  const last_error = errorRow?.error_message ?? null;
  const last_error_at = errorRow?.started_at ?? null;
  const last_success_at = rows.find((r) => r.http_status === 200)?.started_at ?? null;

  const status_distribution: Record<string, number> = {};
  for (const r of rows) {
    let key: string;
    if (r.error_message != null) {
      key = 'error';
    } else if (r.http_status != null) {
      key = String(r.http_status);
    } else {
      key = 'unknown';
    }
    status_distribution[key] = (status_distribution[key] ?? 0) + 1;
  }

  const health_grade = computeHealthGrade(success_rate, last_success_at, windowHours);

  return {
    source_key: sourceKey,
    window_hours: windowHours,
    total_runs,
    successful_runs,
    unchanged_runs,
    failed_runs,
    success_rate,
    avg_duration_ms,
    p50_duration_ms,
    p95_duration_ms,
    avg_parsed,
    total_inserted,
    total_updated,
    last_error,
    last_error_at,
    last_success_at,
    status_distribution,
    health_grade,
  };
}

export function getHealthSummary(dbOverride?: Database.Database): HealthSummary {
  const db = dbOverride ?? getDb();

  const circuitRow = db
    .prepare(
      `SELECT COUNT(*) as n FROM warrant_scraper_config
       WHERE circuit_broken = 1 AND enabled = 1`
    )
    .get() as { n: number };
  const circuit_broken = circuitRow.n;

  const sources = db
    .prepare(`SELECT source_key FROM warrant_scraper_config WHERE enabled = 1`)
    .all() as { source_key: string }[];

  let healthy = 0;
  let degraded = 0;
  let failed = 0;
  for (const s of sources) {
    const m = getSourceMetrics(s.source_key, 24, dbOverride);
    if (m.health_grade === 'A' || m.health_grade === 'B') healthy++;
    else if (m.health_grade === 'C') degraded++;
    else failed++;
  }

  const lastHour = db
    .prepare(
      `SELECT COUNT(*) as n, COALESCE(SUM(inserted_count), 0) as inserted
       FROM warrant_scraper_runs
       WHERE started_at >= datetime('now', '-1 hour')`
    )
    .get() as { n: number; inserted: number };

  return {
    healthy,
    degraded,
    failed,
    circuit_broken,
    total: sources.length,
    last_hour_runs: lastHour.n,
    last_hour_inserted: lastHour.inserted,
  };
}
