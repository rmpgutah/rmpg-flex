-- ============================================================
-- Migration 0288: Serve Job Flags
-- Supervisor flagging system for jobs needing manual review.
-- Flags are additive (a job can have multiple open flags),
-- resolved by supervisors/managers, and used to drive the
-- flagged-queue endpoint.
-- ============================================================

CREATE TABLE IF NOT EXISTS serve_job_flags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id  INTEGER NOT NULL REFERENCES serve_queue(id) ON DELETE CASCADE,
  flagged_by      INTEGER REFERENCES users(id),
  flag_type       TEXT NOT NULL DEFAULT 'review' CHECK(flag_type IN (
                    'review', 'suspicious_address', 'incomplete_docs',
                    'identity_question', 'safety_concern', 'billing_dispute',
                    'legal_hold', 'other'
                  )),
  flag_reason     TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
  resolved_by     INTEGER REFERENCES users(id),
  resolved_at     TEXT,
  resolved_note   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_serve_job_flags_queue   ON serve_job_flags(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_job_flags_status  ON serve_job_flags(status);
CREATE INDEX IF NOT EXISTS idx_serve_job_flags_created ON serve_job_flags(created_at);
