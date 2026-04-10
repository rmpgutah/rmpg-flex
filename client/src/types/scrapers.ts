// ============================================================
// Scraper Types — Shared between WarrantsPage/ScrapersTab and AdminPage
// ============================================================
// These shapes mirror server/src/utils/scraperMetrics.ts and the
// API responses from /api/warrants/scrapers/*. Keep in sync manually —
// the codebase does not use a shared types package.
// ============================================================

export type ScraperHealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type ScraperPriority = 1 | 2 | 3 | 4;

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

export interface ScraperSource {
  source_key: string;
  display_name: string;
  state: string;
  county: string | null;
  source_url: string;
  source_type: string;
  enabled: 0 | 1;
  circuit_broken: 0 | 1;
  priority: ScraperPriority;
  consecutive_errors: number;
  warrant_count: number;
  last_scrape_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  avg_parse_count: number | null;
  p95_latency_ms: number | null;
  metrics_24h: SourceMetrics;
}

export interface ScraperHealthSummary {
  healthy: number;
  degraded: number;
  failed: number;
  circuit_broken: number;
  total: number;
  last_hour_runs: number;
  last_hour_inserted: number;
}

export interface ScraperRun {
  id: number;
  source_key: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  http_status: number | null;
  bytes_received: number | null;
  parsed_count: number;
  inserted_count: number;
  updated_count: number;
  skipped_reason: string | null;
  error_message: string | null;
  parser_used: 'custom' | 'generic' | 'fallback' | null;
}

export interface ScraperMetricsSummary {
  window_hours: number;
  total_sources: number;
  total_runs: number;
  total_warrants_inserted: number;
  total_warrants_updated: number;
  avg_success_rate: number;
  grade_distribution: Record<ScraperHealthGrade, number>;
}

/**
 * WebSocket events broadcast on the 'scraper_events' channel.
 * Discriminated union on `event` field.
 */
export type ScraperWsEvent =
  | {
      event: 'run_started';
      source_key: string;
      display_name: string;
      priority: ScraperPriority | number;
      started_at: string;
    }
  | {
      event: 'run_completed';
      source_key: string;
      display_name: string;
      http_status: number;
      parsed: number;
      inserted: number;
      updated: number;
      unchanged: boolean;
      parser_used: 'custom' | 'generic' | 'fallback';
    }
  | {
      event: 'run_failed';
      source_key: string;
      display_name: string;
      error: string;
    }
  | {
      event: 'circuit_broken';
      source_key: string;
      display_name: string;
      consecutive_errors: number;
      recovery_at: string;
      backoff_hours: number;
    }
  | {
      event: 'circuit_restored';
      source_key: string;
      display_name: string;
    };
