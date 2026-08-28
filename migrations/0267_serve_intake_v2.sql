-- ============================================================
-- Migration 0267: Serve Intake v2 — pre-serve intel storage
-- ============================================================
-- Stores the pre-serve intelligence cross-reference results in
-- serve_queue.parsed_data JSON at $._intake.pre_serve_intel.
-- No new columns needed — the JSON path is written by the
-- serveIntakePreServeIntel module at commit time.
--
-- Also adds an index on serve_queue.recipient_person_id for
-- faster prior-serve lookups.
-- ============================================================

-- Index for prior-serve lookups (PR E4).
CREATE INDEX IF NOT EXISTS idx_serve_queue_recipient_person
  ON serve_queue(recipient_person_id)
  WHERE recipient_person_id IS NOT NULL;

-- Index for BOLO checks on comms_bolos (PR E3).
CREATE INDEX IF NOT EXISTS idx_comms_bolos_active_subject
  ON comms_bolos(subject_name)
  WHERE active = 1;
