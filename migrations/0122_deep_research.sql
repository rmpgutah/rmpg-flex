-- 0122_deep_research.sql — Overwatch Deep Research: jobs, sources, findings, runs.
-- All new tables (well under D1's 100-column cap). Idempotent.

CREATE TABLE IF NOT EXISTS deep_research_jobs (
  id TEXT PRIMARY KEY,
  org_id INTEGER,
  created_by INTEGER,
  subject TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'topic',
  context TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  stage_detail TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  angles_json TEXT,
  report_md TEXT,
  error TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  finding_count INTEGER NOT NULL DEFAULT 0,
  linked_entity_type TEXT,
  linked_entity_id INTEGER,
  monitor_interval_days INTEGER,
  next_run_at TEXT,
  last_run_at TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drj_org ON deep_research_jobs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drj_monitor ON deep_research_jobs(monitor_interval_days, next_run_at);

CREATE TABLE IF NOT EXISTS research_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  run_no INTEGER NOT NULL DEFAULT 1,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  angle TEXT,
  scraped INTEGER NOT NULL DEFAULT 0,
  markdown_excerpt TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rsrc_job ON research_sources(job_id, run_no);

CREATE TABLE IF NOT EXISTS research_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  run_no INTEGER NOT NULL DEFAULT 1,
  org_id INTEGER,
  finding_type TEXT NOT NULL DEFAULT 'fact',
  title TEXT NOT NULL,
  detail TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  trust REAL NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'uncertain',
  source_urls_json TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  entity_ref_type TEXT,
  entity_ref_id INTEGER,
  is_delta INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rfind_job ON research_findings(job_id, run_no);

CREATE TABLE IF NOT EXISTS research_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  run_no INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  new_findings INTEGER NOT NULL DEFAULT 0,
  changed_findings INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rrun_job ON research_runs(job_id, run_no);
