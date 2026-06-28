-- Fleet.io PR 5 — Work-orders subsystem.
-- Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md (PR 5 row)
-- Diff:  docs/superpowers/specs/2026-06-21-fleetio-schema-diff.md (append per-PR)
--
-- Adds 4 new tables (work_orders + line_items + attachments + comments) +
-- 6 columns on fleet_maintenance for cross-linking back to the WO.
--
-- Idempotency conventions per the existing migration pattern (0064, 0136,
-- 0137): tables use CREATE TABLE IF NOT EXISTS; ALTER TABLE ADD COLUMN is
-- not IF-NOT-EXISTS-safe in D1, so a re-apply errors on the already-present
-- columns — that's expected and the deploy step is continue-on-error.
-- Apply DIRECTLY to live D1 785de7ae after merge and verify with
-- `pragma_table_info('work_orders')`, etc.
--
-- Pre-state on live D1 785de7ae (verified 2026-06-21):
--   work_orders / work_order_line_items / work_order_attachments /
--   work_order_comments — none exist.
--   fleet_maintenance — 17 columns; +6 → 23 columns. Safely under D1 cap.

-- ===================================================================
-- work_orders — header row
-- ===================================================================

CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','waiting_parts','completed','cancelled')),
  number TEXT,                                    -- shop's WO number; nullable until issued
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  summary TEXT,
  vendor_id INTEGER,                              -- soft FK -> ref_vendors(id) (kind='shop')
  category_code TEXT,                             -- soft FK -> ref_work_order_categories(code)
  assigned_to_user_id INTEGER,                    -- soft FK -> users(id)
  est_cost REAL,
  actual_cost REAL,
  odometer_at_open INTEGER,
  odometer_at_close INTEGER,
  vmrs_system_code TEXT,
  vmrs_assembly_code TEXT,
  vmrs_component_code TEXT,
  notes TEXT,
  custom_fields_json TEXT,                        -- Fleet.io custom-field passthrough (Phase 2 UI)
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle
  ON work_orders (vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_status
  ON work_orders (status, opened_at);
CREATE INDEX IF NOT EXISTS idx_work_orders_vendor
  ON work_orders (vendor_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_open_only
  ON work_orders (vehicle_id, opened_at)
  WHERE status NOT IN ('completed','cancelled');

-- ===================================================================
-- work_order_line_items — labor / part / fee rows
-- ===================================================================

CREATE TABLE IF NOT EXISTS work_order_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,                 -- soft FK -> work_orders(id)
  kind TEXT NOT NULL
    CHECK (kind IN ('labor','part','fee')),
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_cost REAL,                                 -- per-unit cost; nullable for fees w/ only total
  total_cost REAL,                                -- the route layer keeps qty*unit_cost in sync on write
  part_sku TEXT,                                  -- soft FK -> ref_parts(sku) (kind='part' rows)
  vmrs_system_code TEXT,
  vmrs_assembly_code TEXT,
  vmrs_component_code TEXT,
  labor_rate_code TEXT,                           -- soft FK -> ref_labor_rates(code) (kind='labor' rows)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_order_line_items_wo
  ON work_order_line_items (work_order_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_work_order_line_items_part
  ON work_order_line_items (part_sku)
  WHERE part_sku IS NOT NULL;

-- ===================================================================
-- work_order_attachments — receipts, photos, PDFs (in R2 UPLOADS bucket)
-- ===================================================================

CREATE TABLE IF NOT EXISTS work_order_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  r2_key TEXT NOT NULL,                           -- key in UPLOADS bucket
  filename TEXT,
  mime TEXT,
  size_bytes INTEGER,
  uploaded_by INTEGER,                            -- soft FK -> users(id)
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_order_attachments_wo
  ON work_order_attachments (work_order_id);

-- ===================================================================
-- work_order_comments — thread on a WO
-- ===================================================================

CREATE TABLE IF NOT EXISTS work_order_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,                       -- soft FK -> users(id)
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_order_comments_wo
  ON work_order_comments (work_order_id, created_at);

-- ===================================================================
-- fleet_maintenance — +6 columns to cross-link back to work_orders +
-- the VMRS code triple + arbitrary attachments / customs
-- ===================================================================

ALTER TABLE fleet_maintenance ADD COLUMN work_order_id INTEGER;           -- soft FK -> work_orders(id)
ALTER TABLE fleet_maintenance ADD COLUMN vmrs_system_code TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN vmrs_assembly_code TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN vmrs_component_code TEXT;
ALTER TABLE fleet_maintenance ADD COLUMN attachments_json TEXT;           -- inline thumbnail list (UI shortcut)
ALTER TABLE fleet_maintenance ADD COLUMN custom_fields_json TEXT;

CREATE INDEX IF NOT EXISTS idx_fleet_maintenance_wo
  ON fleet_maintenance (work_order_id)
  WHERE work_order_id IS NOT NULL;
