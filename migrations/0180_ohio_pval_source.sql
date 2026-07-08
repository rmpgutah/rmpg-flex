-- 0180: Register the Ohio DRC "Parole Violators at Large" adapter
-- (src/utils/warrantSources/adapters/ohioPval.ts) so getEnabledAdapters()
-- includes it. Unlike every other code adapter besides Utah/FBI, this one is
-- a genuinely STATEWIDE public roster (browsable A-Z, not scoped to one
-- county) — see the adapter's header comment for the source URL + shape.
--
-- warrant_scraper_config has NO UNIQUE constraint on source_name on live D1
-- (see migration 0067's note), so INSERT OR IGNORE would not dedupe on
-- re-apply — use INSERT ... SELECT ... WHERE NOT EXISTS instead.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is continue-on-error).
INSERT INTO warrant_scraper_config (source_name, source_type, priority, enabled)
SELECT 'ohio-drc-pval', 'html', 2, 1
WHERE NOT EXISTS (
  SELECT 1 FROM warrant_scraper_config WHERE source_name = 'ohio-drc-pval'
);
