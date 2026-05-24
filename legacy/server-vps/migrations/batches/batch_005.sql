CREATE TABLE IF NOT EXISTS fleet_vehicle_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL REFERENCES users(id),
      from_vehicle_id INTEGER REFERENCES fleet_vehicles(id),
      to_vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id),
      reason TEXT,
      swapped_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
CREATE TABLE IF NOT EXISTS warrant_watch_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT UNIQUE,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      persons_checked INTEGER DEFAULT 0,
      new_warrants_found INTEGER DEFAULT 0,
      warrants_cleared INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
CREATE TABLE IF NOT EXISTS warrant_watch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER,
      person_name TEXT,
      event TEXT NOT NULL,
      utah_warrant_id TEXT,
      utah_person_id TEXT,
      court_name TEXT,
      case_id TEXT,
      charges TEXT,
      issue_date TEXT,
      scan_run_id TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
CREATE TABLE IF NOT EXISTS utah_warrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utah_person_id TEXT,
      first_name TEXT,
      middle_name TEXT,
      last_name TEXT,
      age INTEGER,
      city TEXT,
      utah_warrant_id TEXT,
      issue_date TEXT,
      court_name TEXT,
      case_id TEXT,
      charges TEXT,
      fetched_at TEXT DEFAULT (datetime('now','localtime'))
    );
CREATE TABLE IF NOT EXISTS scraped_warrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT,
      full_name TEXT,
      first_name TEXT,
      last_name TEXT,
      date_of_birth TEXT,
      warrant_type TEXT,
      charge_description TEXT,
      court_name TEXT,
      case_number TEXT,
      bail_amount REAL,
      offense_level TEXT,
      issue_date TEXT,
      status TEXT DEFAULT 'active',
      warrant_id TEXT,
      person_id INTEGER,
      scraped_at TEXT DEFAULT (datetime('now','localtime'))
    );
CREATE TABLE IF NOT EXISTS owntracks_device_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracker_id TEXT NOT NULL UNIQUE,
      unit_id INTEGER NOT NULL,
      device_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    )
  `).run();
CREATE TABLE IF NOT EXISTS warrant_scraper_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        http_status INTEGER,
        bytes_received INTEGER,
        parsed_count INTEGER DEFAULT 0,
        inserted_count INTEGER DEFAULT 0,
        updated_count INTEGER DEFAULT 0,
        skipped_reason TEXT,
        error_message TEXT,
        parser_used TEXT
      );
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
CREATE TABLE IF NOT EXISTS cpgps_officer_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      cpgps_vehicle_id TEXT NOT NULL,
      call_sign TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(officer_id, cpgps_vehicle_id)
    );
CREATE TABLE IF NOT EXISTS forensic_case_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      linked_type TEXT NOT NULL,
      linked_id INTEGER NOT NULL,
      linked_label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (case_id) REFERENCES forensic_cases(id)
    );
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
CREATE TABLE IF NOT EXISTS integration_health_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('healthy','degraded','error')),
      response_time_ms INTEGER,
      error_message TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
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
ALTER TABLE users ADD COLUMN shift_preference TEXT;
ALTER TABLE users ADD COLUMN dl_number TEXT;
ALTER TABLE users ADD COLUMN dl_state TEXT;
ALTER TABLE users ADD COLUMN dl_expiry TEXT;
ALTER TABLE users ADD COLUMN blood_type TEXT;
ALTER TABLE users ADD COLUMN allergies TEXT;
ALTER TABLE users ADD COLUMN uniform_size TEXT;
ALTER TABLE users ADD COLUMN employee_id TEXT;
ALTER TABLE users ADD COLUMN certifications TEXT;
ALTER TABLE users ADD COLUMN notes TEXT;
ALTER TABLE users ADD COLUMN profile_image TEXT;
ALTER TABLE users ADD COLUMN last_password_change TEXT;
ALTER TABLE users ADD COLUMN totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN photo TEXT;
ALTER TABLE users ADD COLUMN active_case_count INTEGER;
ALTER TABLE clients ADD COLUMN billing_email TEXT;
ALTER TABLE clients ADD COLUMN billing_address TEXT;
ALTER TABLE clients ADD COLUMN contract_type TEXT;
ALTER TABLE clients ADD COLUMN contract_value REAL;
ALTER TABLE clients ADD COLUMN payment_terms TEXT;
ALTER TABLE clients ADD COLUMN auto_renew INTEGER;
ALTER TABLE clients ADD COLUMN updated_at TEXT;
ALTER TABLE clients ADD COLUMN client_code TEXT;
ALTER TABLE clients ADD COLUMN industry TEXT;
ALTER TABLE clients ADD COLUMN website TEXT;
ALTER TABLE clients ADD COLUMN tax_id TEXT;
ALTER TABLE clients ADD COLUMN payment_method TEXT;
ALTER TABLE clients ADD COLUMN billing_cycle TEXT;
ALTER TABLE clients ADD COLUMN billing_day INTEGER;
ALTER TABLE clients ADD COLUMN discount_percent REAL;
ALTER TABLE clients ADD COLUMN late_fee_percent REAL;
ALTER TABLE clients ADD COLUMN total_invoiced REAL;
ALTER TABLE clients ADD COLUMN total_paid REAL;
ALTER TABLE clients ADD COLUMN outstanding_balance REAL;
ALTER TABLE clients ADD COLUMN incident_count INTEGER;
ALTER TABLE clients ADD COLUMN last_incident_date TEXT;
ALTER TABLE clients ADD COLUMN account_manager TEXT;
ALTER TABLE clients ADD COLUMN priority_client INTEGER;
ALTER TABLE clients ADD COLUMN client_since TEXT;
ALTER TABLE clients ADD COLUMN rate_per_hour REAL;
ALTER TABLE clients ADD COLUMN rate_per_incident REAL;
ALTER TABLE clients ADD COLUMN rate_per_cfs REAL;
ALTER TABLE clients ADD COLUMN email_verified INTEGER;
ALTER TABLE clients ADD COLUMN verification_token TEXT;
ALTER TABLE clients ADD COLUMN avatar TEXT;
ALTER TABLE clients ADD COLUMN last_active_at TEXT;
ALTER TABLE properties ADD COLUMN city TEXT;
ALTER TABLE properties ADD COLUMN state TEXT;
ALTER TABLE properties ADD COLUMN zip TEXT;
ALTER TABLE properties ADD COLUMN access_instructions TEXT;
ALTER TABLE properties ADD COLUMN is_active INTEGER NOT NULL;
ALTER TABLE properties ADD COLUMN updated_at TEXT;
ALTER TABLE properties ADD COLUMN notes TEXT;
ALTER TABLE properties ADD COLUMN business_type TEXT;
ALTER TABLE properties ADD COLUMN structure_type TEXT;
ALTER TABLE properties ADD COLUMN occupancy_status TEXT;
ALTER TABLE properties ADD COLUMN year_built TEXT;
ALTER TABLE properties ADD COLUMN square_footage TEXT;
ALTER TABLE properties ADD COLUMN number_of_stories TEXT;
ALTER TABLE properties ADD COLUMN security_features TEXT;
ALTER TABLE properties ADD COLUMN key_holder_name TEXT;
ALTER TABLE properties ADD COLUMN key_holder_phone TEXT;
ALTER TABLE properties ADD COLUMN key_holder_relationship TEXT;
ALTER TABLE properties ADD COLUMN owner_name TEXT;
ALTER TABLE properties ADD COLUMN owner_phone TEXT;
ALTER TABLE properties ADD COLUMN last_inspection_date TEXT;
ALTER TABLE calls_for_service ADD COLUMN caller_address TEXT;
ALTER TABLE calls_for_service ADD COLUMN zone_beat TEXT;
ALTER TABLE calls_for_service ADD COLUMN sector_id TEXT;
ALTER TABLE calls_for_service ADD COLUMN zone_id TEXT;
ALTER TABLE calls_for_service ADD COLUMN beat_id TEXT;
ALTER TABLE calls_for_service ADD COLUMN cross_street TEXT;
ALTER TABLE calls_for_service ADD COLUMN location_building TEXT;
ALTER TABLE calls_for_service ADD COLUMN location_floor TEXT;
ALTER TABLE calls_for_service ADD COLUMN location_room TEXT;
ALTER TABLE calls_for_service ADD COLUMN num_subjects INTEGER;
ALTER TABLE calls_for_service ADD COLUMN subject_description TEXT;
ALTER TABLE calls_for_service ADD COLUMN vehicle_description TEXT;
ALTER TABLE calls_for_service ADD COLUMN direction_of_travel TEXT;
ALTER TABLE calls_for_service ADD COLUMN responding_officer TEXT;
ALTER TABLE calls_for_service ADD COLUMN secondary_type TEXT;
ALTER TABLE calls_for_service ADD COLUMN contact_method TEXT;
ALTER TABLE calls_for_service ADD COLUMN scene_safety TEXT;
ALTER TABLE calls_for_service ADD COLUMN weather_conditions TEXT;
ALTER TABLE calls_for_service ADD COLUMN lighting_conditions TEXT;
ALTER TABLE calls_for_service ADD COLUMN num_victims INTEGER;
ALTER TABLE calls_for_service ADD COLUMN starting_mileage REAL;
ALTER TABLE calls_for_service ADD COLUMN ending_mileage REAL;
ALTER TABLE calls_for_service ADD COLUMN case_id INTEGER;
ALTER TABLE calls_for_service ADD COLUMN case_number TEXT;
ALTER TABLE calls_for_service ADD COLUMN dispatch_code TEXT;
ALTER TABLE calls_for_service ADD COLUMN section_name TEXT;
ALTER TABLE calls_for_service ADD COLUMN sector_name TEXT;
ALTER TABLE calls_for_service ADD COLUMN zone_name TEXT;
ALTER TABLE calls_for_service ADD COLUMN beat_name TEXT;
ALTER TABLE calls_for_service ADD COLUMN beat_descriptor TEXT;
ALTER TABLE calls_for_service ADD COLUMN contract_id TEXT;
ALTER TABLE calls_for_service ADD COLUMN response_time_seconds REAL;
ALTER TABLE calls_for_service ADD COLUMN onscene_duration_seconds REAL;
ALTER TABLE calls_for_service ADD COLUMN overdue_notified TEXT;
ALTER TABLE units ADD COLUMN assigned_beat TEXT;
ALTER TABLE units ADD COLUMN mileage REAL;
ALTER TABLE incidents ADD COLUMN section_id TEXT;
ALTER TABLE incidents ADD COLUMN statute_id INTEGER;
ALTER TABLE incidents ADD COLUMN statute_citation TEXT;
ALTER TABLE incidents ADD COLUMN citation_fine REAL;
ALTER TABLE incidents ADD COLUMN contract_id TEXT;
ALTER TABLE incidents ADD COLUMN assigned_detective_id INTEGER;
ALTER TABLE incidents ADD COLUMN weather_temperature REAL;
ALTER TABLE incidents ADD COLUMN weather_recorded_at TEXT;
ALTER TABLE persons ADD COLUMN height_feet INTEGER;
ALTER TABLE persons ADD COLUMN height_inches INTEGER;
ALTER TABLE persons ADD COLUMN watchlist_match TEXT;
ALTER TABLE persons ADD COLUMN watchlist_checked_at TEXT;
ALTER TABLE persons ADD COLUMN aliases TEXT;
ALTER TABLE persons ADD COLUMN photo TEXT;
ALTER TABLE persons ADD COLUMN ncic_number TEXT;
ALTER TABLE persons ADD COLUMN sor_number TEXT;
ALTER TABLE persons ADD COLUMN fbi_number TEXT;
ALTER TABLE persons ADD COLUMN state_id_number TEXT;
ALTER TABLE persons ADD COLUMN passport_number TEXT;
ALTER TABLE persons ADD COLUMN passport_country TEXT;
ALTER TABLE persons ADD COLUMN immigration_status TEXT;
ALTER TABLE persons ADD COLUMN disability_flags TEXT;
ALTER TABLE persons ADD COLUMN mental_health_flags TEXT;
ALTER TABLE persons ADD COLUMN substance_abuse TEXT;
ALTER TABLE persons ADD COLUMN medication_notes TEXT;
ALTER TABLE persons ADD COLUMN education_level TEXT;
ALTER TABLE persons ADD COLUMN military_branch TEXT;
ALTER TABLE persons ADD COLUMN military_status TEXT;
ALTER TABLE persons ADD COLUMN tribal_affiliation TEXT;
ALTER TABLE persons ADD COLUMN identifying_marks_location TEXT;
ALTER TABLE persons ADD COLUMN tattoo_description TEXT;
ALTER TABLE persons ADD COLUMN scar_description TEXT;
ALTER TABLE persons ADD COLUMN piercing_description TEXT;
ALTER TABLE persons ADD COLUMN distinguishing_features TEXT;
ALTER TABLE persons ADD COLUMN email_secondary TEXT;
ALTER TABLE persons ADD COLUMN date_last_seen TEXT;
ALTER TABLE persons ADD COLUMN location_last_seen TEXT;
ALTER TABLE persons ADD COLUMN alias_dob TEXT;
ALTER TABLE persons ADD COLUMN home_phone TEXT;
ALTER TABLE persons ADD COLUMN work_phone TEXT;
