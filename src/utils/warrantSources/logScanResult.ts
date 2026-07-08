import type { D1Database } from '@cloudflare/workers-types';
import { execute } from '../db';
import type { AllSourceScanResult } from './runScan';

/**
 * Single-row scraper_runs INSERT shared by the cron path (logScanResult,
 * below) and the manual-trigger path (logManualRun in src/routes/scrapers.ts)
 * so the two callers can't drift out of sync on column list/order or the
 * success-derivation rule.
 *
 * `degraded` defaults to false so existing manual-trigger call sites (which
 * don't have a per-adapter degraded signal to report) keep compiling and
 * behaving exactly as before.
 */
export function insertScraperRunRow(
  db: D1Database,
  sourceKey: string,
  counts: { checked: number; found: number; cleared: number; errors: number },
  trigger: 'cron' | 'manual',
  degraded = false,
): Promise<unknown> {
  const now = new Date().toISOString();
  // success=1 only when the run had zero errors AND wasn't degraded — a source
  // that caught a fetch/parse failure and quietly returned an empty result set
  // must not still grade as a clean success (see healthGrade.ts).
  const success = counts.errors === 0 && !degraded ? 1 : 0;
  return execute(
    db,
    `INSERT INTO scraper_runs (source_key, started_at, finished_at, success, checked, found, cleared, errors, trigger, degraded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sourceKey, now, now, success,
    counts.checked, counts.found, counts.cleared, counts.errors, trigger, degraded ? 1 : 0,
  );
}

/**
 * Writes one scraper_runs row for the Utah leg plus one per scraped source,
 * from the result of runAllSourceScans(). Used by the cron sweep (which
 * genuinely has both a Utah result AND a scraped-source array from one
 * call to runAllSourceScans).
 */
export async function logScanResult(
  db: D1Database,
  result: AllSourceScanResult,
  trigger: 'cron' | 'manual',
): Promise<void> {
  const inserts = [
    insertScraperRunRow(db, 'utah-warrant-watch', {
      checked: result.utah.persons_checked,
      found: result.utah.new_warrants_found,
      cleared: result.utah.warrants_cleared,
      errors: result.utah.errors,
    }, trigger, false),
    ...result.scraped.map((s) =>
      insertScraperRunRow(db, s.source_key, {
        checked: s.checked, found: s.found, cleared: s.cleared, errors: s.errors,
      }, trigger, s.degraded),
    ),
  ];

  // Each row insert is independent — one bad row (transient D1 error) must
  // not prevent the rest of the sources' scraper_runs history from being
  // recorded, since that history is the sole input to health grading.
  const results = await Promise.allSettled(inserts);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const sourceKey = i === 0 ? 'utah-warrant-watch' : result.scraped[i - 1].source_key;
      console.error(`scraper_runs insert failed for ${sourceKey}:`, r.reason);
    }
  });
}
