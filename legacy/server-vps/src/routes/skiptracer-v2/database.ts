import { getDb } from '../../models/database';

/**
 * Creates all Skip Tracker 3.5 tables if they don't already exist.
 * Called lazily before any v2 route handler touches the database.
 */
export function ensureSkipTracerV2Tables(): void {
  const db = getDb();

  // ── people_index — accumulated scraped/fetched people data ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS people_index (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name        TEXT,
      last_name         TEXT,
      middle_name       TEXT,
      full_name         TEXT NOT NULL,
      dob               TEXT,
      age               INTEGER,
      aliases           TEXT NOT NULL DEFAULT '[]',
      addresses         TEXT NOT NULL DEFAULT '[]',
      phones            TEXT NOT NULL DEFAULT '[]',
      emails            TEXT NOT NULL DEFAULT '[]',
      social_profiles   TEXT NOT NULL DEFAULT '[]',
      associates        TEXT NOT NULL DEFAULT '[]',
      court_records     TEXT NOT NULL DEFAULT '[]',
      property_records  TEXT NOT NULL DEFAULT '[]',
      licenses          TEXT NOT NULL DEFAULT '[]',
      vehicles          TEXT NOT NULL DEFAULT '[]',
      business_records  TEXT NOT NULL DEFAULT '[]',
      watchlist_flags   TEXT NOT NULL DEFAULT '[]',
      sex_offender_status TEXT,
      custody_status    TEXT,
      sources           TEXT NOT NULL DEFAULT '[]',
      confidence_score  REAL DEFAULT 0,
      photo_url         TEXT,
      last_updated_at   TEXT DEFAULT (datetime('now','localtime')),
      created_at        TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_people_index_name
      ON people_index (last_name, first_name);

    CREATE INDEX IF NOT EXISTS idx_people_index_fullname
      ON people_index (full_name);

    CREATE INDEX IF NOT EXISTS idx_people_index_dob
      ON people_index (dob);
  `);

  // ── dossiers — saved investigations ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS dossiers (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_name        TEXT NOT NULL,
      people_index_id     INTEGER REFERENCES people_index(id),
      profile_snapshot    TEXT NOT NULL,
      notes               TEXT,
      tags                TEXT NOT NULL DEFAULT '[]',
      linked_incident_id  INTEGER,
      linked_case_id      INTEGER,
      linked_call_id      INTEGER,
      created_by          INTEGER REFERENCES users(id),
      is_archived         INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT DEFAULT (datetime('now','localtime')),
      updated_at          TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_dossiers_subject_name
      ON dossiers (subject_name);
  `);

  // ── skip_tracer_searches_v2 — search audit log ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS skip_tracer_searches_v2 (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      search_type       TEXT NOT NULL,
      query_params      TEXT NOT NULL,
      sources_queried   TEXT NOT NULL DEFAULT '[]',
      sources_responded TEXT NOT NULL DEFAULT '[]',
      total_results     INTEGER NOT NULL DEFAULT 0,
      dossier_id        INTEGER REFERENCES dossiers(id),
      searched_by       INTEGER REFERENCES users(id),
      cost_total        REAL DEFAULT 0,
      duration_ms       INTEGER,
      created_at        TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // ── scrape_jobs — scrape/fetch job tracking ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      source         TEXT NOT NULL,
      query_params   TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      results_count  INTEGER NOT NULL DEFAULT 0,
      error_message  TEXT,
      started_at     TEXT,
      completed_at   TEXT,
      created_by     INTEGER REFERENCES users(id),
      created_at     TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
}
