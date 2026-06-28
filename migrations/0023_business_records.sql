-- ============================================================
-- 0023_business_records.sql
-- ============================================================
-- Business records cluster: the businesses table + its three
-- junctions (vehicles, visits, photos) + the call linkage table.
--
-- Drives:
--   /api/business-vehicles (PR-E)
--   /api/business-visits   (PR-E)
--   /api/business-photos   (PR-E)
--   /api/records/subjects/search business arm  (PR-D, was a no-op)
--   future /api/dispatch/calls/:id/businesses link endpoints
-- ============================================================

-- ── businesses ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dba_name TEXT,
  business_type TEXT,
  ein TEXT,
  license_number TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  industry TEXT,
  employee_count TEXT,
  notes TEXT,
  archived_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_businesses_name ON businesses(name);
CREATE INDEX IF NOT EXISTS idx_businesses_ein ON businesses(ein) WHERE ein IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_archived ON businesses(archived_at) WHERE archived_at IS NULL;

-- ── business_vehicles (M:N junction to vehicles_records) ─────
-- relationship: fleet | owner_employee | frequent_visitor | other
CREATE TABLE IF NOT EXISTS business_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'other',
  notes TEXT,
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id) ON DELETE CASCADE,
  UNIQUE(business_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS idx_business_vehicles_business ON business_vehicles(business_id);
CREATE INDEX IF NOT EXISTS idx_business_vehicles_vehicle ON business_vehicles(vehicle_id);

-- ── business_visits (append-only patrol log) ─────────────────
-- officer_id is taken from JWT at the route layer, never from
-- request body (Spillman parity — see PR-E business-visits.ts).
CREATE TABLE IF NOT EXISTS business_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  officer_id INTEGER NOT NULL,
  latitude REAL,
  longitude REAL,
  notes TEXT,
  visit_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (officer_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_business_visits_business_visit_at ON business_visits(business_id, visit_at);

-- ── business_photos (R2-backed images) ───────────────────────
-- url stores the API path the client uses to fetch the bytes back
-- (/api/business-photos/file/<r2-key>). Auth flows through the
-- Worker, not a publicly-readable R2 bucket — important for
-- premise photos that may show client site interiors.
CREATE TABLE IF NOT EXISTS business_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  caption TEXT,
  category TEXT CHECK(category IN ('storefront','interior','exterior','parking','other')),
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_business_photos_business ON business_photos(business_id);

-- ── call_businesses (M:N junction to calls_for_service) ──────
-- Mirrors call_persons + call_vehicles from 0022_call_links.sql.
-- subjectSearch (PR-D) counts recent links here for the
-- "incident_count" badge. Future PR will add the corresponding
-- /api/dispatch/calls/:id/businesses link endpoints.
CREATE TABLE IF NOT EXISTS call_businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  business_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'involved',
  notes TEXT,
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  UNIQUE(call_id, business_id, role)
);
CREATE INDEX IF NOT EXISTS idx_call_businesses_call ON call_businesses(call_id);
CREATE INDEX IF NOT EXISTS idx_call_businesses_business_created ON call_businesses(business_id, created_at);
