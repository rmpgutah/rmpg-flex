// ============================================================
// RMPG Flex — GPS Breadcrumb Decimator
// ============================================================
// Tiered storage policy: keeps recent trails at full resolution
// and thins out older data so the breadcrumb table does not
// grow unboundedly.
//
//   Age window      │  Keep-every-N  │  Effective rate
//   ────────────────┼────────────────┼──────────────────
//   0–24h           │  all           │  ~1 Hz (OwnTracks)
//   24–48h          │  every 15th    │  1 point / 15s
//   48–72h          │  every 30th    │  1 point / 30s
//   72h+            │  every 45th    │  1 point / 45s
//
// Runs hourly. Uses ROW_NUMBER() per unit within each age band
// to compute which rows to drop, then a single DELETE per band
// wrapped in one transaction. Index on (unit_id, recorded_at)
// keeps the window scans fast.
//
// Why row-number modulo and not bucket-and-average?
//   • Display-only use case — a trail is for visual inspection,
//     not analytics. Keeping every Nth raw point preserves
//     authentic GPS detail (true speed, heading, accuracy).
//   • Simpler to reason about and reverse-engineer if needed.
// ============================================================

import { getDb } from '../models/database';
import { logger } from './logger';

// Tiers in ascending age order. Each tier defines:
//   minHours: lower bound (exclusive, older than this)
//   maxHours: upper bound (inclusive, younger than or equal)
//   keepEvery: keep every Nth point per unit within this window
interface DecimationTier {
  label: string;
  minHours: number;
  maxHours: number | null;  // null = unbounded (oldest tier)
  keepEvery: number;
}

const TIERS: DecimationTier[] = [
  { label: '24-48h', minHours: 24, maxHours: 48, keepEvery: 15 },
  { label: '48-72h', minHours: 48, maxHours: 72, keepEvery: 30 },
  { label: '72h+',   minHours: 72, maxHours: null, keepEvery: 45 },
];

interface DecimationResult {
  tier: string;
  scanned: number;
  deleted: number;
}

/**
 * Run one decimation pass across all tiers.
 * Safe to call repeatedly — each pass is a no-op once rows are already
 * thinned (ROW_NUMBER re-numbers only surviving rows, so modulo is stable).
 */
export function decimateBreadcrumbs(): DecimationResult[] {
  const db = getDb();
  const results: DecimationResult[] = [];

  for (const tier of TIERS) {
    // Build the age-window predicate.
    // `recorded_at` is stored in mixed formats (ISO-UTC from OwnTracks,
    // localtime from browser). SQLite's datetime() coerces both to a
    // comparable scalar as long as the string is parseable.
    const lowerBound = `datetime('now','localtime','-${tier.maxHours ?? 100_000} hours')`;
    const upperBound = `datetime('now','localtime','-${tier.minHours} hours')`;
    const ageClause = tier.maxHours === null
      ? `datetime(recorded_at) < ${upperBound}`
      : `datetime(recorded_at) >= ${lowerBound} AND datetime(recorded_at) < ${upperBound}`;

    // Count before deletion so we can report scanned vs deleted.
    const scannedRow = db.prepare(
      `SELECT COUNT(*) AS n FROM gps_breadcrumbs WHERE ${ageClause}`
    ).get() as { n: number };
    const scanned = scannedRow?.n ?? 0;

    if (scanned === 0) {
      results.push({ tier: tier.label, scanned: 0, deleted: 0 });
      continue;
    }

    // Use ROW_NUMBER() to number points per unit within this window,
    // then delete rows whose rank is NOT divisible by keepEvery.
    // We keep rank=1 (earliest in window) to guarantee at least one anchor
    // point per unit even for sparse data.
    const deleteStmt = db.prepare(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY unit_id ORDER BY recorded_at ASC
               ) AS rn
        FROM gps_breadcrumbs
        WHERE ${ageClause}
      )
      DELETE FROM gps_breadcrumbs
      WHERE id IN (
        SELECT id FROM ranked
        WHERE rn > 1 AND (rn % ?) != 0
      )
    `);

    const info = db.transaction(() => deleteStmt.run(tier.keepEvery))();
    const deleted = Number(info?.changes ?? 0);
    results.push({ tier: tier.label, scanned, deleted });
  }

  return results;
}

// ── Scheduler ──────────────────────────────────────────────

let decimatorHandle: ReturnType<typeof setInterval> | null = null;
const DECIMATOR_INTERVAL_MS = 60 * 60 * 1000; // hourly

/**
 * Start hourly decimation sweeps. Runs immediately on startup to
 * catch any backlog, then every hour after.
 */
export function startBreadcrumbDecimator(): void {
  if (decimatorHandle) return;

  const runOnce = () => {
    try {
      const results = decimateBreadcrumbs();
      const total = results.reduce((sum, r) => sum + r.deleted, 0);
      if (total > 0) {
        logger.info({ results, total }, 'breadcrumb decimation complete');
      } else {
        logger.debug({ results }, 'breadcrumb decimation — nothing to prune');
      }
    } catch (err) {
      logger.error({ err }, 'breadcrumb decimation failed');
    }
  };

  // Initial delay — wait 60s after boot so we don't compete with startup I/O.
  setTimeout(runOnce, 60_000);
  decimatorHandle = setInterval(runOnce, DECIMATOR_INTERVAL_MS);
  logger.info({ intervalMs: DECIMATOR_INTERVAL_MS, tiers: TIERS }, 'breadcrumb decimator scheduler started');
}

export function stopBreadcrumbDecimator(): void {
  if (decimatorHandle) {
    clearInterval(decimatorHandle);
    decimatorHandle = null;
  }
}
