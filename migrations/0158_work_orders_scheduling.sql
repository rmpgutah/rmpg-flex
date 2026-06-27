-- Repair feature advances: work order scheduling + tracking columns
--
-- Adds columns to work_orders for:
--   - Scheduled date and priority for planning
--   - Labor hours tracking for technician time
--   - Failure/cause analysis (category, cause code, failure tier)
--   - Call cross-link (dispatch call that triggered this WO)
--   - Unit cross-link (dispatch unit that reported the issue)
--   - Work order templates table for recurring repairs
--   - Parts usage tracking for inventory reconciliation
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN guarded
-- by columnExists() in the route layer.

-- ===================================================================
-- work_orders — new scheduling/tracking columns
-- ===================================================================

ALTER TABLE work_orders ADD COLUMN scheduled_date TEXT;
ALTER TABLE work_orders ADD COLUMN estimated_hours REAL;
ALTER TABLE work_orders ADD COLUMN labor_hours REAL;
ALTER TABLE work_orders ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low','normal','high','emergency'));
ALTER TABLE work_orders ADD COLUMN failure_category TEXT;
ALTER TABLE work_orders ADD COLUMN cause_code TEXT;
ALTER TABLE work_orders ADD COLUMN failure_tier TEXT;
ALTER TABLE work_orders ADD COLUMN call_id INTEGER;
ALTER TABLE work_orders ADD COLUMN unit_id INTEGER;
ALTER TABLE work_orders ADD COLUMN reported_by_user_id INTEGER;
ALTER TABLE work_orders ADD COLUMN wait_started_at TEXT;
ALTER TABLE work_orders ADD COLUMN vendor_eta TEXT;
ALTER TABLE work_orders ADD COLUMN vendor_quote REAL;
ALTER TABLE work_orders ADD COLUMN approved_at TEXT;
ALTER TABLE work_orders ADD COLUMN approved_by_user_id INTEGER;
ALTER TABLE work_orders ADD COLUMN inspection_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_work_orders_scheduled
  ON work_orders (scheduled_date, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_priority
  ON work_orders (priority, opened_at);
CREATE INDEX IF NOT EXISTS idx_work_orders_call
  ON work_orders (call_id)
  WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_unit
  ON work_orders (unit_id)
  WHERE unit_id IS NOT NULL;

-- ===================================================================
-- work_order_templates — reusable templates for common repairs
-- ===================================================================

CREATE TABLE IF NOT EXISTS work_order_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_code TEXT,
  summary TEXT,
  estimated_hours REAL,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','emergency')),
  template_items_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wo_templates_category
  ON work_order_templates (category_code);

-- ===================================================================
-- work_order_parts_usage — track parts consumption against inventory
-- ===================================================================

CREATE TABLE IF NOT EXISTS work_order_parts_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  line_item_id INTEGER,
  part_sku TEXT,
  part_name TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_cost REAL,
  total_cost REAL,
  vendor_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wo_parts_usage_wo
  ON work_order_parts_usage (work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_parts_usage_sku
  ON work_order_parts_usage (part_sku)
  WHERE part_sku IS NOT NULL;

-- ===================================================================
-- work_order_status_history — append-only status change log
-- ===================================================================

CREATE TABLE IF NOT EXISTS work_order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by_user_id INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wo_status_history_wo
  ON work_order_status_history (work_order_id, created_at);

-- ===================================================================
-- shift_plan_templates — reusable shift pattern templates
-- ===================================================================

CREATE TABLE IF NOT EXISTS shift_plan_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  shift_type TEXT NOT NULL DEFAULT 'day',
  pattern_json TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shift_plan_templates_type
  ON shift_plan_templates (shift_type);
