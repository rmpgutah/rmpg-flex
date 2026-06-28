-- 0059_crm_core_tables.sql
-- Real CRM backend tables (leads / lead-activity / proposals / templates /
-- tasks / activity). Created directly on live D1 (785de7ae) on 2026-06-01 via
-- the D1 MCP; this file records them for repo parity + fresh environments.
-- All idempotent (CREATE TABLE IF NOT EXISTS). Shapes mirror the client
-- CrmLead / CrmProposal / CrmProposalTemplate types in client/src/types/index.ts.
-- src/routes/crm.ts serves these; the proxy CRM fake-data stubs were deleted
-- the same pass so real data flows.

CREATE TABLE IF NOT EXISTS crm_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT DEFAULT 'manual', source_id TEXT, source_url TEXT,
  business_name TEXT NOT NULL, industry TEXT, sic_code TEXT, business_type TEXT,
  contact_name TEXT, contact_email TEXT, contact_phone TEXT, contact_title TEXT,
  address TEXT, city TEXT, state TEXT DEFAULT 'UT', zip TEXT,
  latitude REAL, longitude REAL, estimated_value REAL,
  permit_number TEXT, registration_date TEXT, license_number TEXT,
  project_type TEXT, property_size TEXT,
  pipeline_stage TEXT DEFAULT 'new', lead_score INTEGER DEFAULT 0,
  assigned_to INTEGER, client_id INTEGER, proposal_id INTEGER,
  notes TEXT, service_interest TEXT, lost_reason TEXT, next_follow_up TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crm_lead_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  activity_type TEXT, subject TEXT, details TEXT,
  old_value TEXT, new_value TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crm_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_number TEXT, lead_id INTEGER, client_id INTEGER,
  title TEXT, template_type TEXT, description TEXT, scope_of_work TEXT, terms TEXT,
  monthly_value REAL DEFAULT 0, total_value REAL DEFAULT 0,
  billing_frequency TEXT DEFAULT 'monthly',
  valid_until TEXT, proposed_start TEXT, proposed_end TEXT, contract_length_months INTEGER,
  stage TEXT DEFAULT 'draft',
  sent_at TEXT, viewed_at TEXT, accepted_at TEXT, rejected_at TEXT, rejection_reason TEXT,
  created_by INTEGER, assigned_to INTEGER, notes TEXT, pdf_path TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crm_proposal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, template_type TEXT, description TEXT,
  default_scope TEXT, default_terms TEXT,
  default_monthly_value REAL, default_billing_frequency TEXT DEFAULT 'monthly',
  default_contract_months INTEGER, is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crm_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER, lead_id INTEGER,
  title TEXT, description TEXT, due_date TEXT,
  priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending',
  assigned_to INTEGER, created_by INTEGER, completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crm_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER, lead_id INTEGER,
  activity_type TEXT, subject TEXT, details TEXT,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_crm_leads_source ON crm_leads(source);
CREATE INDEX IF NOT EXISTS idx_crm_lead_activity_lead ON crm_lead_activity(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_proposals_stage ON crm_proposals(stage);
