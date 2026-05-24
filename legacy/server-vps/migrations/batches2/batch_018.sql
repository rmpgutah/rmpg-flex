ALTER TABLE court_events ADD COLUMN defendant_dob TEXT;
ALTER TABLE court_events ADD COLUMN bail_amount REAL;
ALTER TABLE court_events ADD COLUMN bond_status TEXT;
ALTER TABLE court_events ADD COLUMN surety_info TEXT;
ALTER TABLE court_events ADD COLUMN judge_notes TEXT;
ALTER TABLE court_events ADD COLUMN prosecutor_phone TEXT;
ALTER TABLE court_events ADD COLUMN prosecutor_email TEXT;
-- Missing columns for offender_alerts (4)
ALTER TABLE offender_alerts ADD COLUMN alert_latitude REAL;
ALTER TABLE offender_alerts ADD COLUMN alert_longitude REAL;
ALTER TABLE offender_alerts ADD COLUMN alert_address TEXT;
ALTER TABLE offender_alerts ADD COLUMN alert_enabled INTEGER;
-- Missing columns for dispatch_sectors (2)
ALTER TABLE dispatch_sectors ADD COLUMN county_nbr TEXT;
ALTER TABLE dispatch_sectors ADD COLUMN fips_code TEXT;
-- Missing columns for dispatch_zones (1)
ALTER TABLE dispatch_zones ADD COLUMN ugrc_code TEXT;
-- Missing columns for dispatch_beats (2)
ALTER TABLE dispatch_beats ADD COLUMN district_letter TEXT;
ALTER TABLE dispatch_beats ADD COLUMN beat_number INTEGER;
-- Missing columns for warrant_scraper_config (13)
ALTER TABLE warrant_scraper_config ADD COLUMN source_name TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN last_run_at TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN last_error TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN source_type TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN priority INTEGER;
ALTER TABLE warrant_scraper_config ADD COLUMN content_hash TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN content_hash_updated_at TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN etag TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN last_modified TEXT;
