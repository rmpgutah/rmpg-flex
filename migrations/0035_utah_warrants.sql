-- ============================================================
-- 0035_utah_warrants.sql
-- ============================================================
-- Persists warrants fetched from warrants.utah.gov so they're
-- queryable instead of throwaway. Today src/utils/utahWarrantPoller.ts
-- iterates persons → queries the upstream API → COUNTS warrants → writes
-- only the run summary to warrant_watch_runs. The actual warrant rows
-- (charges, court, case_id, issue date) are lost after each cron firing.
--
-- This table fixes that. Each upstream warrant becomes (or updates) one
-- row here, linked back to the local person whose name produced the hit.
--
-- Schema mostly mirrors legacy/server-vps utah_warrants (see
-- legacy/server-vps/migrations/0001_full_sync.sql:2739) so a future
-- backfill from the live D1 doesn't need a column rename. The additions
-- vs legacy are first_seen_at + last_seen_at + person_id (FK) so we can
-- answer "when did this warrant first appear?" and "what warrants are
-- attached to person X?" without a separate join table.
--
-- Migration is idempotent (CREATE TABLE IF NOT EXISTS, CREATE INDEX
-- IF NOT EXISTS) — D1 doesn't support IF NOT EXISTS on ADD COLUMN so
-- additive schema changes go in a new migration file, never in-place.

CREATE TABLE IF NOT EXISTS utah_warrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Upstream identifiers — what warrants.utah.gov returns.
  utah_person_id  TEXT NOT NULL,           -- API: person.id
  utah_warrant_id TEXT NOT NULL,           -- API: warrant.id (the stable
                                           -- per-warrant key; see DEDUP
                                           -- NOTE in the poller for how
                                           -- this is used)

  -- Person identity as the upstream API saw it (separate from local
  -- persons row so we keep the upstream version if a local edit
  -- diverges later).
  first_name  TEXT NOT NULL,
  middle_name TEXT,
  last_name   TEXT NOT NULL,
  age         INTEGER,
  city        TEXT,

  -- Warrant details as fetched.
  issue_date TEXT,                         -- API: warrant.issueDate (ISO-ish)
  court_name TEXT,                         -- API: warrant.court.name
  case_id    TEXT,                         -- API: warrant.court.caseId
  charges    TEXT,                         -- JSON array of charge strings

  -- Local link. NULL if we matched a name that doesn't correspond to a
  -- local persons row (shouldn't happen with the current poller, but
  -- keep nullable so a manual insert from an ad-hoc search works).
  person_id INTEGER REFERENCES persons(id),

  -- Lifecycle. Updated by every successful run that returns this warrant.
  -- A warrant is "cleared" (locally) when last_seen_at falls behind the
  -- latest run's started_at by more than CLEARED_AFTER_RUNS — see
  -- TODO in the poller for the operator-visible threshold.
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_active     INTEGER NOT NULL DEFAULT 1, -- 1 = seen in latest run, 0 = cleared

  -- Provenance for audit.
  source TEXT NOT NULL DEFAULT 'utah-warrant-watch'
);

-- One row per (person, warrant) pair from upstream. UNIQUE makes the
-- ON CONFLICT clause in the poller's UPSERT a hard contract: we never
-- accidentally insert a duplicate even if the cron fires twice during
-- a Worker rollout.
CREATE UNIQUE INDEX IF NOT EXISTS idx_utah_warrants_unique
  ON utah_warrants(utah_person_id, utah_warrant_id);

-- "What warrants does local person X have?" — primary read query.
CREATE INDEX IF NOT EXISTS idx_utah_warrants_person
  ON utah_warrants(person_id, is_active);

-- "What's active right now?" — dashboard widget query.
CREATE INDEX IF NOT EXISTS idx_utah_warrants_active
  ON utah_warrants(is_active, last_seen_at DESC);

-- "When was each one first seen / last seen?" — audit/timeline queries.
CREATE INDEX IF NOT EXISTS idx_utah_warrants_last_seen
  ON utah_warrants(last_seen_at DESC);
