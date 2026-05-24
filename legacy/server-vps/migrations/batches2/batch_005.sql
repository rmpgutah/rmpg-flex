-- New table: cpgps_dashcam_events
CREATE TABLE IF NOT EXISTS cpgps_dashcam_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpgps_vehicle_id TEXT,
      vehicle_id INTEGER,
      officer_id INTEGER,
      event_type TEXT NOT NULL DEFAULT 'unknown',
      severity TEXT DEFAULT 'info',
      description TEXT,
      lat REAL,
      lon REAL,
      speed REAL,
      media_url TEXT,
      media_local_path TEXT,
      media_synced INTEGER DEFAULT 0,
      event_at TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
-- New table: cpgps_officer_mappings
CREATE TABLE IF NOT EXISTS cpgps_officer_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      cpgps_vehicle_id TEXT NOT NULL,
      call_sign TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(officer_id, cpgps_vehicle_id)
    );
-- New table: forensic_case_links
CREATE TABLE IF NOT EXISTS forensic_case_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      linked_type TEXT NOT NULL,
      linked_id INTEGER NOT NULL,
      linked_label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (case_id) REFERENCES forensic_cases(id)
    );
-- New table: forensic_hash_results
CREATE TABLE IF NOT EXISTS forensic_hash_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      file_name TEXT,
      file_hash TEXT,
      hash_type TEXT DEFAULT 'md5',
      match_found INTEGER DEFAULT 0,
      match_set_name TEXT,
      match_category TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (case_id) REFERENCES forensic_cases(id)
    );
-- New table: skiptracer_dossiers
CREATE TABLE IF NOT EXISTS skiptracer_dossiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_name TEXT NOT NULL,
      subject_dob TEXT,
      notes TEXT,
      search_results TEXT,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
-- New table: iped_imports
CREATE TABLE IF NOT EXISTS iped_imports (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      forensic_case_id    INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
      import_type         TEXT NOT NULL CHECK(import_type IN ('case_link','findings','timeline','report','bookmarks','items')),
      iped_case_id        TEXT NOT NULL,
      iped_case_name      TEXT,
      source_query        TEXT,
      item_count          INTEGER DEFAULT 0,
      imported_data       TEXT DEFAULT '[]',
      summary             TEXT,
      imported_by         INTEGER REFERENCES users(id),
      imported_by_name    TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
-- New table: forensic_hash_sets
CREATE TABLE IF NOT EXISTS forensic_hash_sets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      set_type      TEXT NOT NULL CHECK(set_type IN ('nsrl','projectvic','custom','known_good','known_bad')),
      description   TEXT,
      hash_count    INTEGER DEFAULT 0,
      source_file   TEXT,
      version       TEXT,
      imported_by   INTEGER REFERENCES users(id),
      imported_by_name TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
-- New table: forensic_hash_entries
CREATE TABLE IF NOT EXISTS forensic_hash_entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      hash_set_id   INTEGER NOT NULL REFERENCES forensic_hash_sets(id) ON DELETE CASCADE,
      hash_value    TEXT NOT NULL,
      hash_type     TEXT NOT NULL CHECK(hash_type IN ('md5','sha1','sha256')),
      file_name     TEXT,
      file_size     INTEGER,
      category      TEXT,
      UNIQUE(hash_set_id, hash_value, hash_type)
    );
-- New table: integration_health_log
CREATE TABLE IF NOT EXISTS integration_health_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('healthy','degraded','error')),
      response_time_ms INTEGER,
      error_message TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
-- New table: time_entry_edits
CREATE TABLE IF NOT EXISTS time_entry_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time_entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
      edited_by INTEGER NOT NULL REFERENCES users(id),
      edited_by_name TEXT NOT NULL,
      edit_type TEXT NOT NULL CHECK(edit_type IN ('clock_in_changed','clock_out_changed','deleted','notes_changed','break_adjusted')),
      old_value TEXT,
      new_value TEXT,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
-- New table: citation_payments
CREATE TABLE IF NOT EXISTS citation_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      citation_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_date TEXT,
      payment_method TEXT,
      reference_number TEXT,
      notes TEXT,
      recorded_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (citation_id) REFERENCES citations(id),
      FOREIGN KEY (recorded_by) REFERENCES users(id)
    );
-- Missing columns for users (30)
ALTER TABLE users ADD COLUMN middle_name TEXT;
ALTER TABLE users ADD COLUMN date_of_birth TEXT;
ALTER TABLE users ADD COLUMN ssn_last4 TEXT;
ALTER TABLE users ADD COLUMN address TEXT;
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN state TEXT;
ALTER TABLE users ADD COLUMN zip TEXT;
ALTER TABLE users ADD COLUMN emergency_contact_name TEXT;
ALTER TABLE users ADD COLUMN emergency_contact_phone TEXT;
ALTER TABLE users ADD COLUMN emergency_contact_relationship TEXT;
ALTER TABLE users ADD COLUMN hire_date TEXT;
ALTER TABLE users ADD COLUMN termination_date TEXT;
ALTER TABLE users ADD COLUMN rank TEXT;
ALTER TABLE users ADD COLUMN department TEXT;
