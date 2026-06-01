-- 0058_fleet_other_costs_and_budgets.sql
-- ============================================================
-- Fleet Costs tab: user-defined "Other Costs" + per-category monthly budgets.
-- Also backfills fleet_loans (was a live-only patch, no prior migration file).
-- All DDL idempotent (CREATE TABLE IF NOT EXISTS).
-- Applied to live D1 directly via d1_database_query 2026-05-31 (deploy step
-- has continue-on-error, so live creation is the reliable path).
-- ============================================================

CREATE TABLE IF NOT EXISTS fleet_other_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  cost_type TEXT,
  provider TEXT,
  amount REAL,
  frequency TEXT DEFAULT 'one_time',
  incurred_date TEXT,
  period_end TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fleet_cost_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  category TEXT,
  monthly_budget REAL,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(vehicle_id, category)
);

-- fleet_loans had no migration file (was a live-only patch); add for reproducibility:
CREATE TABLE IF NOT EXISTS fleet_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  lender TEXT,
  original_amount REAL,
  current_balance REAL,
  monthly_payment REAL,
  interest_rate REAL,
  term_months INTEGER,
  start_date TEXT,
  payoff_date TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
