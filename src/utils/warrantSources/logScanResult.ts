import type { D1Database } from '@cloudflare/workers-types';
import { execute } from '../db';
import type { AllSourceScanResult } from './runScan';

/**
 * Writes one scraper_runs row for the Utah leg plus one per scraped source,
 * from the result of runAllSourceScans(). Used by the cron sweep (which
 * genuinely has both an Utah result AND a scraped-source array from one
 * call to runAllSourceScans).
 */
export async function logScanResult(
  db: D1Database,
  result: AllSourceScanResult,
  trigger: 'cron' | 'manual',
): Promise<void> {
  const now = new Date().toISOString();

  const inserts = [
    execute(
      db,
      `INSERT INTO scraper_runs (source_key, started_at, finished_at, success, checked, found, cleared, errors, trigger)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'utah-warrant-watch', now, now, result.utah.errors === 0 ? 1 : 0,
      result.utah.persons_checked, result.utah.new_warrants_found, result.utah.warrants_cleared,
      result.utah.errors, trigger,
    ),
    ...result.scraped.map((s) =>
      execute(
        db,
        `INSERT INTO scraper_runs (source_key, started_at, finished_at, success, checked, found, cleared, errors, trigger)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.source_key, now, now, s.errors === 0 ? 1 : 0,
        s.checked, s.found, s.cleared, s.errors, trigger,
      ),
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
