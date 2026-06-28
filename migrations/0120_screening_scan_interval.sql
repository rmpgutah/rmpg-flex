-- 0120_screening_scan_interval.sql
-- Per-source scrape cadence for screening sources (SOR / INTERPOL / OFAC).
--
-- A newly-added source has next_run_at = NULL, which the scheduler reads as
-- "due now" → it is scraped on the next cron tick (effectively immediate).
-- After each successful scrape the scheduler stamps
--   next_run_at = datetime('now', '+' || scan_interval_days || ' days')
-- so the source re-scrapes once every `scan_interval_days` (default 180 = ~6 months),
-- OVERRIDING the global 4h scan for that source. Manual triggers bypass the gate.
--
-- D1 does NOT support `IF NOT EXISTS` on ADD COLUMN; the Worker also reconciles
-- these columns at runtime (ensureScreeningScheduleColumns), so a re-apply
-- failure here is expected and harmless.

ALTER TABLE screening_source_state ADD COLUMN scan_interval_days INTEGER NOT NULL DEFAULT 180;
ALTER TABLE screening_source_state ADD COLUMN next_run_at TEXT;
