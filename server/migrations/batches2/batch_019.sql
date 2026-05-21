ALTER TABLE warrant_scraper_config ADD COLUMN last_success_at TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN avg_parse_count REAL;
ALTER TABLE warrant_scraper_config ADD COLUMN p95_latency_ms INTEGER;
ALTER TABLE warrant_scraper_config ADD COLUMN jitter_seed INTEGER;
