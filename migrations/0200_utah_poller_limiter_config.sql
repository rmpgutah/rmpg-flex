-- ============================================================
-- 0200_utah_poller_limiter_config.sql
-- ============================================================
-- Makes the Utah warrant poller's per-run person cap (previously the
-- hardcoded MAX_PERSONS_PER_RUN = 50 in src/utils/utahWarrantPoller.ts)
-- live-tunable from warrant_scraper_config instead of requiring a
-- redeploy, and adds a resume cursor so successive cron runs sweep
-- fresh slices of the persons roster instead of always restarting at
-- the same alphabetically-first rows.
--
-- D1 doesn't support IF NOT EXISTS on ADD COLUMN — see CLAUDE.md.
-- ============================================================

ALTER TABLE warrant_scraper_config ADD COLUMN max_persons_per_run INTEGER DEFAULT 150;
ALTER TABLE warrant_scraper_config ADD COLUMN persons_cursor_id INTEGER DEFAULT 0;

-- Seed the utah-warrant-watch row if it somehow doesn't exist yet (it
-- should from earlier migrations, but keep this idempotent).
INSERT INTO warrant_scraper_config (source_name, source_type, priority, max_persons_per_run, persons_cursor_id)
SELECT 'utah-warrant-watch', 'state', 1, 150, 0
WHERE NOT EXISTS (
  SELECT 1 FROM warrant_scraper_config WHERE source_name = 'utah-warrant-watch'
);
