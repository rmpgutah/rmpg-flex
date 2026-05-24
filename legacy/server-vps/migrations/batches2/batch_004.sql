-- New table: hr_salary_history
CREATE TABLE IF NOT EXISTS hr_salary_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        officer_id INTEGER NOT NULL,
        effective_date TEXT NOT NULL,
        salary_amount REAL NOT NULL,
        pay_type TEXT DEFAULT 'hourly',
        reason TEXT,
        approved_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (officer_id) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id)
      );
-- New table: hr_benefits
CREATE TABLE IF NOT EXISTS hr_benefits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        officer_id INTEGER NOT NULL,
        benefit_type TEXT NOT NULL,
        plan_name TEXT,
        provider TEXT,
        coverage_level TEXT,
        employee_cost REAL DEFAULT 0,
        employer_cost REAL DEFAULT 0,
        effective_date TEXT,
        end_date TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (officer_id) REFERENCES users(id)
      );
-- New table: hr_pips
CREATE TABLE IF NOT EXISTS hr_pips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        officer_id INTEGER NOT NULL,
        supervisor_id INTEGER,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        goals TEXT NOT NULL DEFAULT '[]',
        milestones TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','extended','failed','cancelled')),
        outcome TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (officer_id) REFERENCES users(id),
        FOREIGN KEY (supervisor_id) REFERENCES users(id)
      );
-- New table: hr_attendance
CREATE TABLE IF NOT EXISTS hr_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        officer_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'absent' CHECK(type IN ('absent','tardy','early_departure','no_call_no_show')),
        minutes_late INTEGER DEFAULT 0,
        reason TEXT,
        excused INTEGER DEFAULT 0,
        documented_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (officer_id) REFERENCES users(id),
        FOREIGN KEY (documented_by) REFERENCES users(id)
      );
-- New table: fleet_tires
CREATE TABLE IF NOT EXISTS fleet_tires (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        position TEXT NOT NULL,
        brand TEXT,
        model TEXT,
        size TEXT,
        install_date TEXT,
        tread_depth REAL,
        last_measured TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
      );
-- New table: fleet_damage_reports
CREATE TABLE IF NOT EXISTS fleet_damage_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        reported_by INTEGER,
        damage_date TEXT NOT NULL,
        damage_type TEXT NOT NULL,
        location_on_vehicle TEXT,
        severity TEXT DEFAULT 'minor' CHECK(severity IN ('minor','moderate','major','totaled')),
        description TEXT NOT NULL,
        repair_estimate REAL,
        repair_cost REAL,
        repair_status TEXT DEFAULT 'reported' CHECK(repair_status IN ('reported','estimated','approved','in_repair','completed','insurance_claim')),
        photos TEXT DEFAULT '[]',
        insurance_claim_number TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
        FOREIGN KEY (reported_by) REFERENCES users(id)
      );
-- New table: fleet_recalls
CREATE TABLE IF NOT EXISTS fleet_recalls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        recall_number TEXT NOT NULL,
        manufacturer TEXT,
        description TEXT NOT NULL,
        severity TEXT DEFAULT 'standard',
        status TEXT DEFAULT 'open' CHECK(status IN ('open','scheduled','completed','not_applicable')),
        remedy TEXT,
        scheduled_date TEXT,
        completed_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
      );
-- New table: fleet_fuel_cards
CREATE TABLE IF NOT EXISTS fleet_fuel_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_number TEXT NOT NULL UNIQUE,
        vehicle_id INTEGER,
        provider TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','cancelled','lost')),
        monthly_limit REAL,
        pin_last4 TEXT,
        expiry_date TEXT,
        notes TEXT,
        assigned_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
      );
-- New table: patrol_tour_verifications
CREATE TABLE IF NOT EXISTS patrol_tour_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      tour_date TEXT NOT NULL,
      verified_by INTEGER,
      verified_at TEXT,
      status TEXT DEFAULT 'approved',
      notes TEXT,
      total_scans INTEGER DEFAULT 0,
      on_time_scans INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(officer_id, tour_date)
    )`);
-- New table: crm_leads
CREATE TABLE IF NOT EXISTS crm_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT,
      source_url TEXT,
      business_name TEXT NOT NULL,
      industry TEXT,
      sic_code TEXT,
      business_type TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      contact_title TEXT,
      address TEXT,
      city TEXT,
      state TEXT DEFAULT 'UT',
      zip TEXT,
      latitude REAL,
      longitude REAL,
      estimated_value REAL,
      permit_number TEXT,
      registration_date TEXT,
      license_number TEXT,
      project_type TEXT,
      property_size TEXT,
      pipeline_stage TEXT NOT NULL DEFAULT 'new',
      lead_score INTEGER DEFAULT 0,
      assigned_to INTEGER,
      client_id INTEGER,
      proposal_id INTEGER,
      notes TEXT,
      lost_reason TEXT,
      next_follow_up TEXT,
      service_interest TEXT,
      enrichment_status TEXT,
      enrichment_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `).run();
-- New table: crm_lead_activity
CREATE TABLE IF NOT EXISTS crm_lead_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL,
      subject TEXT,
      details TEXT,
      old_value TEXT,
      new_value TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `).run();
-- New table: leave_requests
CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'vacation',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours_requested REAL NOT NULL DEFAULT 0,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    )
  `).run();
-- New table: disciplinary_records
CREATE TABLE IF NOT EXISTS disciplinary_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'verbal_warning',
      severity TEXT NOT NULL DEFAULT 'minor',
      incident_date TEXT NOT NULL,
      description TEXT NOT NULL,
      action_taken TEXT,
      follow_up_date TEXT,
      follow_up_notes TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      issued_by INTEGER NOT NULL,
      witness TEXT,
      attachments TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (issued_by) REFERENCES users(id)
    )
  `).run();
-- New table: pdf_artifacts
CREATE TABLE IF NOT EXISTS pdf_artifacts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      form_type       TEXT NOT NULL,
      form_version    TEXT NOT NULL,
      record_type     TEXT NOT NULL,
      record_id       INTEGER NOT NULL,
      blob_path       TEXT NOT NULL,
      sha256          TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      created_by      INTEGER NOT NULL,
      title           TEXT
    )
  `).run();
-- New table: person_associates
CREATE TABLE IF NOT EXISTS person_associates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      associate_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL DEFAULT 'associate' CHECK(relationship_type IN ('family','friend','gang','associate','coworker','neighbor','romantic','other')),
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(person_id, associate_id)
    );
-- New table: evidence_temperature_logs
CREATE TABLE IF NOT EXISTS evidence_temperature_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
      temperature REAL NOT NULL,
      recorded_by INTEGER REFERENCES users(id),
      recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
-- New table: patrol_breaks
CREATE TABLE IF NOT EXISTS patrol_breaks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL REFERENCES users(id),
      shift_date TEXT NOT NULL,
      break_start TEXT NOT NULL,
      break_end TEXT,
      break_type TEXT DEFAULT 'break' CHECK(break_type IN ('break','meal','rest')),
      duration_minutes REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
-- New table: fleet_pretrip_checklists
CREATE TABLE IF NOT EXISTS fleet_pretrip_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id),
      officer_id INTEGER NOT NULL REFERENCES users(id),
      shift_date TEXT NOT NULL,
      lights_ok INTEGER DEFAULT 0,
      brakes_ok INTEGER DEFAULT 0,
      radio_ok INTEGER DEFAULT 0,
      mdt_ok INTEGER DEFAULT 0,
      camera_ok INTEGER DEFAULT 0,
      tires_ok INTEGER DEFAULT 0,
      fluids_ok INTEGER DEFAULT 0,
      exterior_ok INTEGER DEFAULT 0,
      interior_ok INTEGER DEFAULT 0,
      emergency_equipment_ok INTEGER DEFAULT 0,
      notes TEXT,
      overall_pass INTEGER DEFAULT 0,
      completed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
-- New table: fleet_vehicle_swaps
CREATE TABLE IF NOT EXISTS fleet_vehicle_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL REFERENCES users(id),
      from_vehicle_id INTEGER REFERENCES fleet_vehicles(id),
      to_vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id),
      reason TEXT,
      swapped_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
-- New table: warrant_watch_runs
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
-- New table: warrant_watch_log
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
-- New table: utah_warrants
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
-- New table: scraped_warrants
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
-- New table: owntracks_device_map
CREATE TABLE IF NOT EXISTS owntracks_device_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracker_id TEXT NOT NULL UNIQUE,
      unit_id INTEGER NOT NULL,
      device_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    )
  `).run();
-- New table: warrant_scraper_runs
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
