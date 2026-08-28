-- Skip Tracker 3.5 (skiptracer-v2) — search history + dossier profile column.
-- The V2 page expects profile_snapshot on dossiers and skip_tracer_searches_v
-- for the History tab. Baseline skiptracer_dossiers only had search_results.

CREATE TABLE IF NOT EXISTS skip_tracer_searches_v (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_type TEXT NOT NULL DEFAULT 'general',
  query_params TEXT NOT NULL,
  sources_queried TEXT NOT NULL DEFAULT '[]',
  sources_responded TEXT NOT NULL DEFAULT '[]',
  total_results INTEGER NOT NULL DEFAULT 0,
  searcher_id INTEGER,
  cost_total REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (searcher_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_skip_tracer_searches_v_created
  ON skip_tracer_searches_v(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_skip_tracer_searches_v_searcher
  ON skip_tracer_searches_v(searcher_id);
