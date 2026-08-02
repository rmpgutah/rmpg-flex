// ============================================================
// RMPG Flex — Daily Blotter: nightly generation
// ============================================================
// Runs at 00:05 America/Denver off the existing per-minute cron.
// Generates yesterday, then backfills any of the previous N Denver days
// missing from R2 — self-healing after an outage, bounded so it can
// never run long. Days with no activity produce no object and are
// re-checked cheaply each night (head + a short-circuited collect).
// ============================================================

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { denverToday, previousDenverDays } from './dates';
import { collectDailyReport, isEmpty } from './collect';
import { renderDailyReport } from './render';
import { hasReport, putReport } from './store';

export const DEFAULT_BACKFILL_DAYS = 7;

export interface NightlyResult {
  generated: string[];
  skipped: string[];
}

export async function runNightlyBlotter(
  db: D1Database,
  bucket: R2Bucket,
  nowMs: number,
  backfillDays: number = DEFAULT_BACKFILL_DAYS,
): Promise<NightlyResult> {
  const today = denverToday(nowMs);
  const candidates = previousDenverDays(today, Math.max(1, backfillDays));
  const generated: string[] = [];
  const skipped: string[] = [];

  for (const date of candidates) {
    if (await hasReport(bucket, date)) { skipped.push(date); continue; }
    const data = await collectDailyReport(db, date);
    if (isEmpty(data)) { skipped.push(date); continue; }
    await putReport(bucket, date, await renderDailyReport(data));
    generated.push(date);
  }

  return { generated, skipped };
}
