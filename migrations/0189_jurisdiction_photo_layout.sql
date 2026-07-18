-- Jurisdiction override (manual county correction on top of the automatic
-- resolveCountyFromAddress router) + photo/layout scraping support.
ALTER TABLE businesses ADD COLUMN jurisdiction_override TEXT;
ALTER TABLE properties ADD COLUMN jurisdiction_override TEXT;

-- Scraped-from-assessor image references (most counties/synthetic fixtures
-- leave these null — best-effort only, see parser.ts comments per county).
ALTER TABLE parcel_records ADD COLUMN photo_url TEXT;
ALTER TABLE parcel_records ADD COLUMN layout_url TEXT;

-- kind distinguishes a property/site photo from a floor-plan/site-plan
-- layout image without touching the existing CHECK-constrained `category`
-- column (SQLite can't ALTER a CHECK constraint without a table rebuild).
ALTER TABLE business_photos ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo';

-- No existing photo infra for properties (a real-estate/security-client
-- site, distinct from the evidence "properties" concept elsewhere in the
-- app) — mirrors business_photos' shape.
CREATE TABLE IF NOT EXISTS property_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  caption TEXT,
  category TEXT,
  kind TEXT NOT NULL DEFAULT 'photo',
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_property_photos_property ON property_photos(property_id);
