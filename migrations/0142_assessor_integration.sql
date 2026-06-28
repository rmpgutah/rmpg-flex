-- ── Focused subset on businesses (auto-fillable, queryable) ──
ALTER TABLE businesses ADD COLUMN parcel_number TEXT;
ALTER TABLE businesses ADD COLUMN owner_of_record TEXT;
ALTER TABLE businesses ADD COLUMN owner_type TEXT;          -- individual|entity|mixed|unknown
ALTER TABLE businesses ADD COLUMN owner_mailing_address TEXT;
ALTER TABLE businesses ADD COLUMN year_built INTEGER;
ALTER TABLE businesses ADD COLUMN total_market_value INTEGER;
ALTER TABLE businesses ADD COLUMN land_sqft INTEGER;
ALTER TABLE businesses ADD COLUMN last_sale_date TEXT;
ALTER TABLE businesses ADD COLUMN last_sale_price INTEGER;
ALTER TABLE businesses ADD COLUMN legal_description TEXT;
ALTER TABLE businesses ADD COLUMN tax_district TEXT;
ALTER TABLE businesses ADD COLUMN assessor_last_synced_at TEXT;
ALTER TABLE businesses ADD COLUMN assessor_source_url TEXT;

-- ── Same subset on properties ──
ALTER TABLE properties ADD COLUMN parcel_number TEXT;
ALTER TABLE properties ADD COLUMN owner_of_record TEXT;
ALTER TABLE properties ADD COLUMN owner_type TEXT;
ALTER TABLE properties ADD COLUMN owner_mailing_address TEXT;
ALTER TABLE properties ADD COLUMN year_built INTEGER;
ALTER TABLE properties ADD COLUMN total_market_value INTEGER;
ALTER TABLE properties ADD COLUMN land_sqft INTEGER;
ALTER TABLE properties ADD COLUMN last_sale_date TEXT;
ALTER TABLE properties ADD COLUMN last_sale_price INTEGER;
ALTER TABLE properties ADD COLUMN legal_description TEXT;
ALTER TABLE properties ADD COLUMN tax_district TEXT;
ALTER TABLE properties ADD COLUMN assessor_last_synced_at TEXT;
ALTER TABLE properties ADD COLUMN assessor_source_url TEXT;

CREATE INDEX IF NOT EXISTS idx_businesses_parcel ON businesses(parcel_number);
CREATE INDEX IF NOT EXISTS idx_properties_parcel ON properties(parcel_number);

-- ── Full verbatim parcel records ──
CREATE TABLE IF NOT EXISTS parcel_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_number TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'sl_county_assessor',
  source_url TEXT,
  account_number TEXT,
  serial_number TEXT,
  tax_district TEXT,
  owner_of_record TEXT,
  owner_type TEXT,
  owner_mailing_address TEXT,
  situs_address TEXT,
  situs_city TEXT,
  situs_zip TEXT,
  subdivision TEXT,
  land_acres REAL,
  land_sqft INTEGER,
  land_value INTEGER,
  zoning TEXT,
  year_built INTEGER,
  effective_year_built INTEGER,
  total_bldg_sqft INTEGER,
  finished_sqft INTEGER,
  basement_sqft INTEGER,
  garage_sqft INTEGER,
  stories REAL,
  bedrooms INTEGER,
  bathrooms REAL,
  construction_type TEXT,
  improvement_class TEXT,
  improvement_value INTEGER,
  market_value_total INTEGER,
  market_value_land INTEGER,
  market_value_improvement INTEGER,
  taxable_value INTEGER,
  assessed_value INTEGER,
  tax_year INTEGER,
  legal_description TEXT,
  plat TEXT,
  lot TEXT,
  block TEXT,
  raw_data_json TEXT,                  -- every field we parsed, verbatim, for forward-compat
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_parcel_records_situs ON parcel_records(situs_address);
CREATE INDEX IF NOT EXISTS idx_parcel_records_owner ON parcel_records(owner_of_record);

-- ── 1:N sale history ──
CREATE TABLE IF NOT EXISTS parcel_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_record_id INTEGER NOT NULL,
  sale_date TEXT,
  sale_price INTEGER,
  doc_number TEXT,
  buyer TEXT,
  seller TEXT,
  sale_type TEXT,
  FOREIGN KEY (parcel_record_id) REFERENCES parcel_records(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_parcel_sales_record ON parcel_sales(parcel_record_id);

-- ── Backfill job queue (resumable, audit trail) ──
CREATE TABLE IF NOT EXISTS assessor_backfill_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL CHECK(record_type IN ('business','property')),
  record_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','applied','no_match','ambiguous','unfetchable','error')),
  matches_json TEXT,
  applied_parcel_number TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(record_type, record_id)
);
CREATE INDEX IF NOT EXISTS idx_backfill_pending
  ON assessor_backfill_jobs(status, retry_count) WHERE status = 'pending';
