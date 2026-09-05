-- ============================================================
-- 0279_serve_schedule_requests.sql
-- Subject-initiated "schedule a delivery" requests from the public Notice of
-- Attempt landing page (rmpgutahps.us/notice-of-attempt → POST
-- /api/verify/schedule-request). One row per submission; the officer accepts
-- or declines from the serve job card. Idempotent.
-- Spec: docs/superpowers/specs/2026-09-05-rmpgutahps-notice-integration-design.md
-- ============================================================
CREATE TABLE IF NOT EXISTS serve_schedule_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  job_ref          TEXT    NOT NULL,                 -- AGENCY REF ID as printed, e.g. "JOB-122"
  job_id           INTEGER REFERENCES serve_queue(id) ON DELETE CASCADE,
  preferred_window TEXT    NOT NULL
                     CHECK(preferred_window IN ('morning','afternoon','evening','weekend')),
  contact_method   TEXT    NOT NULL CHECK(contact_method IN ('phone','email')),
  contact_value    TEXT    NOT NULL,
  note             TEXT,
  ip_address       TEXT,
  user_agent       TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','accepted','declined')),
  resolved_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ssr_job_status ON serve_schedule_requests(job_id, status);
CREATE INDEX IF NOT EXISTS idx_ssr_job_ref    ON serve_schedule_requests(job_ref);
