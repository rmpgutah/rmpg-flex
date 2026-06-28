// ============================================================
// Warrant Helpers
// ============================================================
// Shared helpers for the warrants surface area:
//   - Lazy schema initializers (survive process restart order)
//   - Priority / age / freshness computation for list UI + PDF
// ============================================================

import type Database from 'better-sqlite3';

// ── Priority bucket ──────────────────────────────────────────
export type PriorityBucket = 'critical' | 'high' | 'medium' | 'low';

export function computePriorityBucket(
  score: number | null | undefined
): PriorityBucket {
  if (score == null) return 'low';
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

// ── Age formatting ───────────────────────────────────────────
export function formatAge(days: number | null | undefined): string {
  if (days == null) return '—';
  const d = Math.floor(days);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

// ── Freshness (time since last scraper refresh) ──────────────
export type FreshnessClass = 'fresh' | 'recent' | 'stale' | 'old' | 'manual';

export function computeFreshnessClass(
  daysSinceScrape: number | null | undefined
): FreshnessClass {
  if (daysSinceScrape == null) return 'manual';
  if (daysSinceScrape < 1) return 'fresh';
  if (daysSinceScrape < 7) return 'recent';
  if (daysSinceScrape < 30) return 'stale';
  return 'old';
}

// ── Lazy schema: columns ─────────────────────────────────────
// Three new columns on `warrants`, all nullable, idempotent.
// Must be called from each handler that reads/writes these
// fields — DO NOT call at module load (see CLAUDE.md gotcha #24).

let reviewColumnsEnsured = false;

export function ensureWarrantReviewColumns(db: Database.Database): void {
  if (reviewColumnsEnsured) return;
  try {
    const cols = db
      .prepare("PRAGMA table_info(warrants)")
      .all() as { name: string }[];
    if (!cols.some((c) => c.name === 'reviewed_at')) {
      db.prepare('ALTER TABLE warrants ADD COLUMN reviewed_at TEXT').run();
    }
    if (!cols.some((c) => c.name === 'reviewed_by')) {
      db.prepare('ALTER TABLE warrants ADD COLUMN reviewed_by INTEGER').run();
    }
    if (!cols.some((c) => c.name === 'last_scraped_at')) {
      db.prepare('ALTER TABLE warrants ADD COLUMN last_scraped_at TEXT').run();
    }
    // Phase 1 list/PDF columns — used by filter/sort query, bulk-archive, and PDF v2.
    // Added here (not in a separate helper) so every handler that reads/writes warrants
    // gets them idempotently. All nullable.
    if (!cols.some((c) => c.name === 'priority_score')) {
      db.prepare('ALTER TABLE warrants ADD COLUMN priority_score INTEGER').run();
    }
    if (!cols.some((c) => c.name === 'issue_date')) {
      db.prepare('ALTER TABLE warrants ADD COLUMN issue_date TEXT').run();
    }
    if (!cols.some((c) => c.name === 'archived_by')) {
      db.prepare('ALTER TABLE warrants ADD COLUMN archived_by INTEGER').run();
    }
    reviewColumnsEnsured = true;
  } catch {
    // table doesn't exist yet — retry on next call
  }
}

// ── Lazy schema: indexes ─────────────────────────────────────
// NOTE: call ensureWarrantReviewColumns(db) BEFORE this function on a
// fresh schema. idx_warrants_last_scraped references last_scraped_at,
// which only exists after the column helper has run.
let indexesEnsured = false;

export function ensureWarrantIndexes(db: Database.Database): void {
  if (indexesEnsured) return;
  try {
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_priority ON warrants(priority_score)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_issue_date ON warrants(issue_date)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_subject_person ON warrants(subject_person_id)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_source ON warrants(source)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_warrants_last_scraped ON warrants(last_scraped_at)'
    ).run();
    indexesEnsured = true;
  } catch {
    // retry next call
  }
}

// Exposed for tests
export function _resetEnsuredForTests(): void {
  reviewColumnsEnsured = false;
  indexesEnsured = false;
}
