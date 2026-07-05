// Pure function: turns a slice of scraper_runs rows into an A-F health
// grade, or null if there's no run history yet. Deliberately takes the
// FIRST `MAX_RUNS_CONSIDERED` entries of whatever array it's given — the
// caller (src/routes/scrapers.ts) is responsible for querying/ordering
// scraper_runs so the most recent runs are first before calling this.
//
// Thresholds are a judgment call, not derived from any external standard:
// >=95% A, >=85% B, >=70% C, >=50% D, else F. A 20-run window is roughly
// 3+ days of 4-hourly cron runs — small enough to react to recent behavior,
// large enough that one bad run doesn't swing a grade from A to F.

// Exported so callers (src/routes/scrapers.ts) can slice scraper_runs to the
// same window before computing total_runs/success_rate — otherwise those
// fields and health_grade could silently disagree if this constant ever
// changed without updating the caller's own hardcoded slice length.
export const MAX_RUNS_CONSIDERED = 20;

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export function computeHealthGrade(runs: Array<{ success: boolean }>): HealthGrade | null {
  if (runs.length === 0) return null;

  const considered = runs.slice(0, MAX_RUNS_CONSIDERED);
  const successCount = considered.filter((r) => r.success).length;
  const rate = successCount / considered.length;

  if (rate >= 0.95) return 'A';
  if (rate >= 0.85) return 'B';
  if (rate >= 0.70) return 'C';
  if (rate >= 0.50) return 'D';
  return 'F';
}
