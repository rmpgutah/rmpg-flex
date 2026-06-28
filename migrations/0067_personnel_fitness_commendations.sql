-- 0067_personnel_fitness_commendations.sql
-- Backing tables for the Personnel detail tabs that were 404ing in prod:
--   GET/POST /api/personnel/fitness/:id        → personnel_fitness
--   GET/POST /api/personnel/commendations/:id  → personnel_commendations
-- (The /api/personnel/activity/:id feed reuses the existing audit_log +
--  activity_log tables — no new table needed.)
--
-- Applied directly to live D1 (785de7ae-…) on 2026-06-02; this file is the
-- repo record. Idempotent — safe to re-apply.

CREATE TABLE IF NOT EXISTS personnel_fitness (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  date TEXT,
  score REAL,
  run_time TEXT,
  pushups INTEGER,
  situps INTEGER,
  notes TEXT,
  recorded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_personnel_fitness_officer ON personnel_fitness(officer_id);

CREATE TABLE IF NOT EXISTS personnel_commendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  date TEXT,
  type TEXT,
  description TEXT,
  awarded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_personnel_commendations_officer ON personnel_commendations(officer_id);
