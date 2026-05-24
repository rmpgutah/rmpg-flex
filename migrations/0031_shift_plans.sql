-- ============================================================
-- 0031_shift_plans.sql
-- ============================================================
-- Shift planning, swap requests, overtime/staffing analytics.
-- Phase 1 port — full feature parity with legacy /server/.
--
-- shift_plans uses TEXT primary key (client-generated IDs like
-- "plan_2026-05-24_day") so the same ID can be used for upsert
-- across draft/active transitions without re-issuing.
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'day' CHECK(shift_type IN (
    'day','swing','night','graveyard','custom'
  )),
  assignments TEXT NOT NULL DEFAULT '[]',   -- JSON array of {officer_id, name, call_sign, hours, ...}
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
    'draft','active','completed','cancelled'
  )),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_shift_plans_date ON shift_plans(date);
CREATE INDEX IF NOT EXISTS idx_shift_plans_status ON shift_plans(status);

-- ── shift_swap_requests — officer swap workflow ──
CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  requester_name TEXT,
  target_id INTEGER REFERENCES users(id),
  target_name TEXT,
  plan_id TEXT REFERENCES shift_plans(id),
  shift_date TEXT NOT NULL,
  original_shift TEXT,
  requested_shift TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','approved','denied','cancelled'
  )),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_shift_swaps_status ON shift_swap_requests(status);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_date ON shift_swap_requests(shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_requester ON shift_swap_requests(requester_id);
