import { execute, columnExists } from '../db';

let ensured = false;

/** Self-heal V2 tables/columns so a silently-failed migration can't 500 the page. */
export async function ensureSkipTracerV2Schema(db: D1Database): Promise<void> {
  if (ensured) return;

  await execute(db, `CREATE TABLE IF NOT EXISTS skip_tracer_searches_v (
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
  )`);
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_skip_tracer_searches_v_created
    ON skip_tracer_searches_v(created_at DESC)`);

  await execute(db, `CREATE TABLE IF NOT EXISTS enrichment_cache (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key    TEXT NOT NULL UNIQUE,
    seed_json    TEXT NOT NULL,
    results_json TEXT NOT NULL,
    match_tier   TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    anchors_json TEXT,
    source_count INTEGER NOT NULL DEFAULT 0,
    searched_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT NOT NULL,
    searched_by  INTEGER,
    org_id       TEXT
  )`);

  for (const col of ['profile_snapshot', 'tags', 'linked_incident_id', 'linked_case_id']) {
    if (!(await columnExists(db, 'skiptracer_dossiers', col))) {
      try {
        await execute(db, `ALTER TABLE skiptracer_dossiers ADD COLUMN ${col} TEXT`);
      } catch { /* column may have landed via migration */ }
    }
  }

  ensured = true;
}
