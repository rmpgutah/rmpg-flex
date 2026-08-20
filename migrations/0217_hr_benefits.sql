-- 0217_hr_benefits.sql
-- HR Console → Benefits tab. The route was a deliberate stub: GET /hr/benefits
-- returned a hardcoded [] with the comment "Real handler lands with the
-- hr_benefits table in a follow-up", and POST /hr/benefits was never written at
-- all — so BenefitsTab's "Add benefit" submit 404'd and its catch showed only
-- "Failed to add benefit". This is the table that follow-up needed.
--
-- Column set is exactly the client contract (the Benefit interface and
-- EMPTY_BENEFIT_FORM in client/src/pages/hr/tabs/BenefitsTab.tsx), so no
-- guessing: benefit_type, plan_name, provider, coverage_level, employee_cost,
-- employer_cost, effective_date, end_date, status.
CREATE TABLE IF NOT EXISTS hr_benefits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  benefit_type TEXT NOT NULL,
  plan_name TEXT,
  provider TEXT,
  coverage_level TEXT NOT NULL DEFAULT 'individual',
  employee_cost REAL NOT NULL DEFAULT 0,
  employer_cost REAL NOT NULL DEFAULT 0,
  effective_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_benefits_officer ON hr_benefits(officer_id);
CREATE INDEX IF NOT EXISTS idx_hr_benefits_status ON hr_benefits(status);
CREATE INDEX IF NOT EXISTS idx_hr_benefits_type ON hr_benefits(benefit_type);
