-- ============================================================
-- 0207 — serve_attempts.attempt_at timezone repair
-- ============================================================
-- EditServeAttemptModal wrote the officer's Mountain-Time wall-clock into
-- serve_attempts.attempt_at with no zone marker, while every reader
-- (parseTimestamp) treats a naive timestamp as UTC. Result: any attempt whose
-- timestamp an operator corrected in the modal printed 6 hours early on the
-- Notice of Attempt -- a 07:35 MDT attempt printed as 01:35. The writer is
-- fixed in client/src/components/serve/EditServeAttemptModal.tsx (it now uses
-- the canonical mtDatetimeLocalToUtc); this migration repairs the rows that
-- were already written before that fix landed.
--
-- Scope: 16 rows identified on live D1 785de7ae by a three-way signature --
-- attempt_at 5.5-7.5h behind created_at, ':00' seconds (the datetime-local
-- input's fingerprint), and an MDT-era date. Every one measured 6.00-6.29h,
-- consistent with a single fixed UTC-6 shift; a genuinely backfilled attempt
-- would show a scattered gap, not a tight cluster. Ids are pinned literally
-- rather than recomputed from a predicate so this migration can never widen
-- its blast radius against a different dataset.
--
-- All 16 fall in June/July 2026, entirely within Mountain DAYLIGHT time, so
-- the correction is a flat +6 hours. Do NOT generalize this to +7 for MST
-- rows without re-deriving the affected set -- there are none here.
--
-- These are process-service records, i.e. evidence in active legal matters,
-- so the originals are copied to serve_attempts_tz_backup before any write.
-- ============================================================

CREATE TABLE IF NOT EXISTS serve_attempts_tz_backup (
  attempt_id          INTEGER PRIMARY KEY,
  serve_queue_id      INTEGER,
  attempt_at_original TEXT NOT NULL,
  created_at_snapshot TEXT,
  backed_up_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Snapshot the originals. INSERT OR IGNORE + the PK make a re-apply a no-op
-- and, critically, prevent a second run from overwriting a good backup with
-- an already-corrected value.
INSERT OR IGNORE INTO serve_attempts_tz_backup
  (attempt_id, serve_queue_id, attempt_at_original, created_at_snapshot)
SELECT id, serve_queue_id, attempt_at, created_at
  FROM serve_attempts
 WHERE id IN (29, 32, 43, 46, 47, 48, 57, 62, 63, 64, 66, 69, 70, 77, 79, 85);

-- Shift MT wall-clock -> UTC. The correlated guard means a row is only touched
-- while its stored value still matches the backed-up original, so re-applying
-- this migration cannot double-shift a row that was already corrected.
UPDATE serve_attempts
   SET attempt_at = datetime(attempt_at, '+6 hours')
 WHERE id IN (
   SELECT b.attempt_id
     FROM serve_attempts_tz_backup b
    WHERE b.attempt_id = serve_attempts.id
      AND b.attempt_at_original = serve_attempts.attempt_at
 );
