-- ============================================================
-- 0209_serve_receipt_integrity.sql
--
-- Two defects found auditing the acknowledgement subsystem, both of
-- which put a false fact on a real serve job.
--
-- 1. VOIDING A RECEIPT LEFT THE JOB MARKED SERVED.
--    Signing advances serve_queue.status to 'served'. Voiding the
--    receipt reversed nothing, so a job whose only acknowledgement had
--    been struck still read as served — and the officer had no signal
--    that it needed re-attempting. Observed live 2026-07-27.
--
--    Reverting needs the status the job actually had BEFORE the receipt
--    advanced it. Guessing 'in_progress' would be wrong for a job that
--    was 'pending' when served on the first attempt, and inventing a
--    plausible-looking status on a legal record is worse than the bug.
--    So it is captured at insert time and restored on void.
--
-- 2. NOTHING PREVENTED MULTIPLE SIGNED RECEIPTS PER JOB.
--    Three independent write paths exist — the subject's phone, a
--    transcribed paper form, and an officer-attested refusal. The token
--    burn stops ONE of them from running twice; it does nothing about
--    two different paths both firing for the same doorstep. Two signed
--    acknowledgements for one service is not a richer record, it is a
--    contradiction someone has to litigate.
--
-- Idempotent DDL (D1 prod schema is dirty — see migrations/README.md).
-- ============================================================

-- ── 1. Remember what to restore ─────────────────────────────
-- D1 does not support IF NOT EXISTS on ADD COLUMN; a re-apply fails
-- here with "duplicate column name" and that is expected and harmless.
-- serve_receipts is nowhere near the 100-column cap.
ALTER TABLE serve_receipts ADD COLUMN job_status_before TEXT;

-- ── 2. One signed acknowledgement per job ───────────────────
-- PARTIAL index: voided receipts are excluded, so a supervisor can void
-- a mistaken one and the correct one can then be recorded. Without the
-- WHERE clause a void would permanently poison the job.
--
-- This is a real constraint with teeth — the second write path to fire
-- for a job now fails at the database rather than quietly creating a
-- contradiction. Handlers translate it into a stated conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_serve_receipts_one_signed
  ON serve_receipts(serve_queue_id)
  WHERE status = 'signed';
