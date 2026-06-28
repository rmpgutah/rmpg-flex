-- ============================================================
-- 0157 — Complete HR tables for Worker-era HR module
--
-- Creates all tables needed by the HR API endpoints in
-- src/routes/hr.ts: Payroll, Grievances, Documents, Attendance,
-- PIPs. All tables use CREATE TABLE IF NOT EXISTS for
-- idempotency. Columns that may already exist on live D1
-- are reconciled at Worker boot (see ensureTimeEntryColumns
-- in src/utils/db.ts pattern).
--
-- 🔴 After merge: apply DIRECTLY to live D1 (785de7ae) via
--    scripts/apply-migration.sh 0157_hr_tables_complete.sql
-- ============================================================

-- ── Payroll: Pay Periods ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_pay_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','processing','finalized','paid','closed')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ── Payroll: Pay Rates ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_pay_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pay_type TEXT NOT NULL DEFAULT 'hourly',
  rate REAL NOT NULL DEFAULT 0,
  overtime_rate REAL NOT NULL DEFAULT 1.5,
  holiday_rate REAL NOT NULL DEFAULT 1.5,
  effective_date TEXT NOT NULL,
  end_date TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ── Payroll: Entries ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_payroll_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pay_period_id INTEGER NOT NULL,
  pay_rate_id INTEGER,
  regular_hours REAL NOT NULL DEFAULT 0,
  overtime_hours REAL NOT NULL DEFAULT 0,
  holiday_hours REAL NOT NULL DEFAULT 0,
  pto_hours REAL NOT NULL DEFAULT 0,
  sick_hours REAL NOT NULL DEFAULT 0,
  other_hours REAL NOT NULL DEFAULT 0,
  other_hours_description TEXT,
  base_pay REAL NOT NULL DEFAULT 0,
  overtime_pay REAL NOT NULL DEFAULT 0,
  holiday_pay REAL NOT NULL DEFAULT 0,
  gross_pay REAL NOT NULL DEFAULT 0,
  total_deductions REAL NOT NULL DEFAULT 0,
  net_pay REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','paid')),
  notes TEXT,
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (pay_period_id) REFERENCES hr_pay_periods(id) ON DELETE CASCADE,
  FOREIGN KEY (pay_rate_id) REFERENCES hr_pay_rates(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- ── Overtime Requests ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overtime_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  officer_name TEXT,
  requested_date TEXT NOT NULL,
  hours_requested REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','denied')),
  reviewed_by INTEGER,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- ── Grievances ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_grievances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'filed' CHECK(status IN ('filed','under_review','investigation','mediation','resolved','dismissed','appealed')),
  priority TEXT DEFAULT 'normal',
  assigned_to INTEGER,
  resolution TEXT,
  filed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

-- ── HR Documents ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'policy',
  description TEXT,
  file_path TEXT,
  file_name TEXT,
  file_size INTEGER DEFAULT 0,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- ── Handbook Acknowledgments ─────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_handbook_acknowledgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL,
  acknowledged_at TEXT NOT NULL,
  signature TEXT,
  ip_address TEXT,
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (document_id) REFERENCES hr_documents(id),
  UNIQUE(officer_id, document_id)
);

-- ── Attendance ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'absent' CHECK(type IN ('absent','tardy','early_departure','no_call_no_show')),
  minutes_late INTEGER DEFAULT 0,
  reason TEXT,
  excused INTEGER DEFAULT 0,
  documented_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (documented_by) REFERENCES users(id)
);

-- ── Performance Improvement Plans (PIPs) ─────────────────────
CREATE TABLE IF NOT EXISTS hr_pips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  supervisor_id INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  goals TEXT NOT NULL DEFAULT '[]',
  milestones TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','extended','failed','cancelled')),
  outcome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (supervisor_id) REFERENCES users(id)
);
