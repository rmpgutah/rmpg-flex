-- 0119_model_registry.sql — which trained adapter is live per target + its eval metric.
CREATE TABLE IF NOT EXISTS model_registry (
  target TEXT PRIMARY KEY,
  adapter_version TEXT,
  base_model TEXT,
  holdout_metric REAL,
  beats_baseline INTEGER DEFAULT 0,
  promoted_at TEXT,
  notes TEXT
);
