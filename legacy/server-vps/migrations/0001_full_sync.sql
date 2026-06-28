-- D1 Schema Sync 2026-05-21T13:28:13.863Z

-- Tables: 168, Columns: 559

CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin','manager','dispatcher','supervisor','officer','client_viewer')),
      badge_number TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','terminated')),
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY,
      notify_dispatch_email INTEGER DEFAULT 1,
      notify_dispatch_inapp INTEGER DEFAULT 1,
      notify_bolo_email INTEGER DEFAULT 1,
      notify_bolo_inapp INTEGER DEFAULT 1,
      notify_warrant_email INTEGER DEFAULT 0,
      notify_warrant_inapp INTEGER DEFAULT 1,
      notify_system_email INTEGER DEFAULT 0,
      notify_system_inapp INTEGER DEFAULT 1,
      notify_credential_email INTEGER DEFAULT 1,
      notify_credential_inapp INTEGER DEFAULT 1,
      notify_pso_email INTEGER DEFAULT 1,
      notify_pso_inapp INTEGER DEFAULT 1,
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      font_scale REAL DEFAULT 1.0,
      compact_mode INTEGER DEFAULT 0,
      show_map_labels INTEGER DEFAULT 1,
      default_map_style TEXT DEFAULT 'dark',
      dashboard_widgets TEXT,
      dispatch_sort TEXT DEFAULT 'priority',
      dispatch_show_cleared INTEGER DEFAULT 0,
      theme_preference TEXT DEFAULT 'dark',
      font_size_preference TEXT DEFAULT 'medium',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      address TEXT,
      contract_start TEXT,
      contract_end TEXT,
      sla_response_minutes INTEGER DEFAULT 15,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      property_type TEXT,
      gate_code TEXT,
      alarm_code TEXT,
      emergency_contact TEXT,
      post_orders TEXT,
      hazard_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

CREATE TABLE IF NOT EXISTS calls_for_service (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_number TEXT UNIQUE,
      incident_type TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('P1','P2','P3','P4')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived')),
      caller_name TEXT,
      caller_phone TEXT,
      caller_relationship TEXT,
      location_address TEXT NOT NULL,
      property_id INTEGER,
      latitude REAL,
      longitude REAL,
      description TEXT,
      notes TEXT,
      source TEXT DEFAULT 'phone' CHECK(source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','panic','servemanager','intake','other')),
      assigned_unit_ids TEXT DEFAULT '[]',
      dispatcher_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      dispatched_at TEXT,
      enroute_at TEXT,
      onscene_at TEXT,
      cleared_at TEXT,
      closed_at TEXT,
      disposition TEXT,
      FOREIGN KEY (property_id) REFERENCES properties(id),
      FOREIGN KEY (dispatcher_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id INTEGER NOT NULL,
      officer_id INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      heading REAL,
      speed REAL,
      unit_status TEXT,
      call_sign TEXT,
      officer_name TEXT,
      badge_number TEXT,
      current_call_id INTEGER,
      current_call_number TEXT,
      current_call_type TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (unit_id) REFERENCES units(id),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_sign TEXT UNIQUE NOT NULL,
      officer_id INTEGER,
      status TEXT NOT NULL DEFAULT 'off_duty' CHECK(status IN ('available','dispatched','enroute','onscene','busy','off_duty','out_of_service')),
      latitude REAL,
      longitude REAL,
      vehicle_id TEXT,
      capabilities TEXT DEFAULT '[]',
      current_call_id INTEGER,
      last_status_change TEXT DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (current_call_id) REFERENCES calls_for_service(id)
    );

CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_number TEXT UNIQUE,
      call_id INTEGER,
      incident_type TEXT NOT NULL,
      priority TEXT DEFAULT 'P3',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','under_review','approved','returned')),
      location_address TEXT,
      property_id INTEGER,
      latitude REAL,
      longitude REAL,
      narrative TEXT,
      officer_id INTEGER NOT NULL,
      supervisor_id INTEGER,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
      FOREIGN KEY (property_id) REFERENCES properties(id),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (supervisor_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      dob TEXT,
      gender TEXT,
      race TEXT,
      height TEXT,
      weight TEXT,
      hair_color TEXT,
      eye_color TEXT,
      scars_marks_tattoos TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      photo_url TEXT,
      flags TEXT DEFAULT '[]',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS vehicles_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate_number TEXT,
      state TEXT,
      make TEXT,
      model TEXT,
      year INTEGER,
      color TEXT,
      vin TEXT,
      owner_person_id INTEGER,
      flags TEXT DEFAULT '[]',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (owner_person_id) REFERENCES persons(id)
    );

CREATE TABLE IF NOT EXISTS bolos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bolo_number TEXT UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('person','vehicle','other')),
      title TEXT NOT NULL,
      description TEXT,
      subject_description TEXT,
      vehicle_description TEXT,
      photo_url TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','cancelled')),
      priority TEXT DEFAULT 'P3',
      issued_by INTEGER NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (issued_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER,
      channel TEXT NOT NULL DEFAULT 'direct' CHECK(channel IN ('direct','dispatch','broadcast','zone')),
      content TEXT NOT NULL,
      priority TEXT DEFAULT 'routine' CHECK(priority IN ('routine','urgent','emergency')),
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_number TEXT,
      incident_id INTEGER NOT NULL,
      description TEXT,
      evidence_type TEXT,
      storage_location TEXT,
      collected_by INTEGER,
      status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_storage','submitted_to_le','released','disposed')),
      chain_of_custody TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id),
      FOREIGN KEY (collected_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      property_id INTEGER,
      shift_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','active','completed','cancelled')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (property_id) REFERENCES properties(id)
    );

CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      schedule_id INTEGER,
      clock_in TEXT NOT NULL,
      clock_out TEXT,
      clock_in_latitude REAL,
      clock_in_longitude REAL,
      total_hours REAL,
      break_start TEXT,
      break_minutes REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','edited','on_break')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (schedule_id) REFERENCES schedules(id)
    );

CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      credential_type TEXT NOT NULL,
      credential_number TEXT,
      issued_date TEXT,
      expiry_date TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','pending_renewal')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS patrol_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      latitude REAL,
      longitude REAL,
      qr_code TEXT,
      sequence_order INTEGER DEFAULT 0,
      scan_required_interval_minutes INTEGER NOT NULL DEFAULT 60,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (property_id) REFERENCES properties(id)
    );

CREATE TABLE IF NOT EXISTS patrol_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkpoint_id INTEGER NOT NULL,
      officer_id INTEGER NOT NULL,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      latitude REAL,
      longitude REAL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'on_time' CHECK(status IN ('on_time','late','missed')),
      FOREIGN KEY (checkpoint_id) REFERENCES patrol_checkpoints(id),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      refresh_token_hash TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      last_used_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip_address TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT UNIQUE NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      uploaded_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT NOT NULL,
      config_value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS ofac_sdn_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ent_num INTEGER UNIQUE NOT NULL,
      sdn_name TEXT NOT NULL,
      sdn_type TEXT,
      program TEXT,
      title TEXT,
      remarks TEXT,
      call_sign TEXT,
      vessel_type TEXT,
      tonnage TEXT,
      grt TEXT,
      vessel_flag TEXT,
      vessel_owner TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS ofac_sdn_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ent_num INTEGER NOT NULL,
      alt_num INTEGER,
      alt_type TEXT,
      alt_name TEXT NOT NULL,
      alt_remarks TEXT,
      FOREIGN KEY (ent_num) REFERENCES ofac_sdn_entries(ent_num) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS ofac_sdn_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ent_num INTEGER NOT NULL,
      add_num INTEGER,
      address TEXT,
      city TEXT,
      state_province TEXT,
      postal_code TEXT,
      country TEXT,
      add_remarks TEXT,
      FOREIGN KEY (ent_num) REFERENCES ofac_sdn_entries(ent_num) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS ofac_sdn_ids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ent_num INTEGER NOT NULL,
      id_type TEXT,
      id_number TEXT,
      id_country TEXT,
      issue_date TEXT,
      expiration_date TEXT,
      remarks TEXT,
      FOREIGN KEY (ent_num) REFERENCES ofac_sdn_entries(ent_num) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS ofac_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      entries_count INTEGER DEFAULT 0,
      aliases_count INTEGER DEFAULT 0,
      addresses_count INTEGER DEFAULT 0,
      ids_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      duration_ms INTEGER,
      synced_at TEXT DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS microbilt_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product TEXT NOT NULL,
      search_type TEXT NOT NULL,
      search_input TEXT NOT NULL,
      response_data TEXT NOT NULL,
      hit INTEGER DEFAULT 0,
      subject_count INTEGER DEFAULT 0,
      searched_by INTEGER,
      linked_incident TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS dl_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dl_number TEXT,
      dl_state TEXT,
      dl_class TEXT,
      dl_status TEXT,
      dl_expiration TEXT,
      dl_issue_date TEXT,
      dl_restrictions TEXT,
      dl_endorsements TEXT,
      first_name TEXT,
      middle_name TEXT,
      last_name TEXT,
      full_name TEXT,
      suffix TEXT,
      date_of_birth TEXT,
      gender TEXT,
      height TEXT,
      weight TEXT,
      eye_color TEXT,
      hair_color TEXT,
      race TEXT,
      raw_record TEXT,
      source TEXT DEFAULT 'MICROBILT',
      fetched_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(dl_number, dl_state)
    );

CREATE TABLE IF NOT EXISTS dl_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dl_record_id INTEGER NOT NULL,
      address TEXT,
      address2 TEXT,
      city TEXT,
      state TEXT,
      postal_code TEXT,
      country TEXT DEFAULT 'US',
      FOREIGN KEY (dl_record_id) REFERENCES dl_records(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS warrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warrant_number TEXT UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('arrest','search','bench','civil','other')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','served','recalled','expired','quashed')),
      subject_person_id INTEGER,
      issuing_court TEXT,
      issuing_judge TEXT,
      charge_description TEXT NOT NULL,
      bail_amount REAL,
      offense_level TEXT CHECK(offense_level IN ('felony','misdemeanor','infraction','civil')),
      entered_by INTEGER NOT NULL,
      served_by INTEGER,
      served_at TEXT,
      served_location TEXT,
      expires_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (subject_person_id) REFERENCES persons(id),
      FOREIGN KEY (entered_by) REFERENCES users(id),
      FOREIGN KEY (served_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('bolo','warrant','dispatch','system','message','credential_expiry','patrol_missed')),
      title TEXT NOT NULL,
      body TEXT,
      entity_type TEXT,
      entity_id INTEGER,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high','critical')),
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS call_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      incident_type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'P3',
      description_template TEXT,
      default_notes TEXT,
      source TEXT NOT NULL DEFAULT 'dispatch',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS supplemental_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_number TEXT UNIQUE,
      incident_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      report_type TEXT NOT NULL DEFAULT 'supplemental' CHECK(report_type IN ('supplemental','follow_up','witness_statement','forensic','supervisor_review')),
      subject TEXT NOT NULL,
      narrative TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved')),
      approved_by INTEGER,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id),
      FOREIGN KEY (author_id) REFERENCES users(id),
      FOREIGN KEY (approved_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS fleet_vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_number TEXT UNIQUE NOT NULL,
      make TEXT,
      model TEXT,
      year INTEGER,
      color TEXT,
      vin TEXT,
      plate_number TEXT,
      plate_state TEXT,
      status TEXT NOT NULL DEFAULT 'in_service' CHECK(status IN ('in_service','out_of_service','maintenance','retired')),
      assigned_unit_id INTEGER,
      current_mileage INTEGER,
      last_service_date TEXT,
      next_service_due TEXT,
      insurance_expiry TEXT,
      registration_expiry TEXT,
      equipment TEXT DEFAULT '[]',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (assigned_unit_id) REFERENCES units(id)
    );

CREATE TABLE IF NOT EXISTS fleet_maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      type TEXT CHECK(type IN ('oil_change','tire_rotation','brake_service','inspection','repair','other')),
      description TEXT NOT NULL,
      mileage_at_service INTEGER,
      cost REAL,
      vendor TEXT,
      performed_by TEXT,
      performed_at TEXT DEFAULT (datetime('now','localtime')),
      next_due_date TEXT,
      next_due_mileage INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
    );

CREATE TABLE IF NOT EXISTS fleet_fuel_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      fuel_date TEXT NOT NULL,
      gallons REAL NOT NULL,
      cost_per_gallon REAL,
      total_cost REAL,
      odometer_reading INTEGER,
      fuel_type TEXT NOT NULL DEFAULT 'regular' CHECK(fuel_type IN ('regular','premium','diesel')),
      station TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS fleet_inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      inspection_type TEXT NOT NULL CHECK(inspection_type IN ('pre_trip','post_trip','monthly','annual')),
      inspector_name TEXT NOT NULL,
      inspection_date TEXT NOT NULL,
      overall_result TEXT NOT NULL CHECK(overall_result IN ('pass','fail','needs_attention')),
      mileage INTEGER,
      items TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS fleet_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      unit_id INTEGER,
      unit_call_sign TEXT,
      officer_name TEXT,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      unassigned_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    );

CREATE TABLE IF NOT EXISTS fleet_personnel_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      officer_id TEXT,
      officer_name TEXT,
      note TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS incident_persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'involved' CHECK(role IN ('suspect','victim','witness','reporting_party','involved','other')),
      notes TEXT,
      added_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id),
      UNIQUE(incident_id, person_id)
    );

CREATE TABLE IF NOT EXISTS incident_vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      vehicle_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'involved' CHECK(role IN ('suspect_vehicle','victim_vehicle','witness_vehicle','involved','evidence','other')),
      notes TEXT,
      added_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id),
      UNIQUE(incident_id, vehicle_id)
    );

CREATE TABLE IF NOT EXISTS incident_offenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      offense_code TEXT NOT NULL,
      statute_id INTEGER,
      description TEXT NOT NULL,
      offense_date TEXT,
      offense_level TEXT DEFAULT 'misdemeanor' CHECK(offense_level IN ('infraction','misdemeanor','felony','other')),
      ucr_code TEXT,
      nibrs_code TEXT,
      attempted_completed TEXT DEFAULT 'completed' CHECK(attempted_completed IN ('attempted','completed')),
      suspect_person_id INTEGER,
      victim_person_id INTEGER,
      location_type TEXT,
      weapon_force TEXT,
      criminal_activity TEXT,
      bias_motivation TEXT,
      disposition TEXT,
      disposition_date TEXT,
      counts INTEGER DEFAULT 1,
      notes TEXT,
      added_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY (statute_id) REFERENCES utah_statutes(id),
      FOREIGN KEY (suspect_person_id) REFERENCES persons(id),
      FOREIGN KEY (victim_person_id) REFERENCES persons(id),
      FOREIGN KEY (added_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS incident_officers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      officer_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'responding' CHECK(role IN ('primary','responding','backup','supervisor','investigator','evidence_tech','other')),
      arrived_at TEXT,
      departed_at TEXT,
      action_taken TEXT,
      notes TEXT,
      added_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (added_by) REFERENCES users(id),
      UNIQUE(incident_id, officer_id)
    );

CREATE TABLE IF NOT EXISTS incident_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      linked_type TEXT NOT NULL CHECK(linked_type IN ('incident','call','case','warrant','citation','arrest')),
      linked_id INTEGER NOT NULL,
      link_reason TEXT,
      added_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id),
      UNIQUE(incident_id, linked_type, linked_id)
    );

CREATE TABLE IF NOT EXISTS training_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      course_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('firearms','defensive_tactics','first_aid','legal','communication','driving','technology','leadership','compliance','other')),
      provider TEXT,
      completed_date TEXT,
      expiry_date TEXT,
      score REAL,
      hours REAL NOT NULL DEFAULT 0,
      certificate_number TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('completed','in_progress','scheduled','overdue','expired')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS training_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      required_for_roles TEXT NOT NULL DEFAULT '["officer"]',
      renewal_period_months INTEGER NOT NULL DEFAULT 12,
      minimum_hours REAL NOT NULL DEFAULT 1,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      property_id INTEGER NOT NULL,
      position TEXT NOT NULL DEFAULT 'Patrol',
      start_date TEXT NOT NULL,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','scheduled','cancelled')),
      hours_per_week REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (property_id) REFERENCES properties(id)
    );

CREATE TABLE IF NOT EXISTS officer_equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id TEXT NOT NULL,
      equipment_type TEXT NOT NULL CHECK(equipment_type IN (
        'radio','body_camera','firearm','taser','baton','handcuffs',
        'vest','badge','id_card','keys','flashlight','vehicle_key',
        'laptop','phone','other'
      )),
      make TEXT,
      model TEXT,
      serial_number TEXT,
      asset_tag TEXT,
      condition TEXT NOT NULL DEFAULT 'good' CHECK(condition IN ('new','good','fair','poor','damaged','lost')),
      status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','returned','lost','damaged','retired','maintenance')),
      issued_date TEXT,
      returned_date TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS body_cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      camera_id TEXT NOT NULL UNIQUE,
      make TEXT,
      model TEXT,
      firmware_version TEXT,
      storage_capacity_gb INTEGER DEFAULT 32,
      status TEXT NOT NULL DEFAULT 'available',
      condition TEXT NOT NULL DEFAULT 'good',
      assigned_at TEXT,
      returned_at TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS bodycam_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id INTEGER NOT NULL,
      officer_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER,
      mime_type TEXT DEFAULT 'video/mp4',
      recorded_at TEXT,
      case_number TEXT,
      classification TEXT DEFAULT 'routine',
      retention_status TEXT DEFAULT 'active',
      notes TEXT,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (camera_id) REFERENCES body_cameras(id),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS radio_transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      full_name TEXT,
      channel TEXT NOT NULL,
      transcript TEXT,
      duration INTEGER NOT NULL DEFAULT 0,
      transmitted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS dash_cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      camera_id TEXT NOT NULL UNIQUE,
      make TEXT,
      model TEXT,
      firmware_version TEXT,
      storage_capacity_gb INTEGER DEFAULT 32,
      channel_count INTEGER DEFAULT 2,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','installed','maintenance','damaged','lost')),
      condition TEXT NOT NULL DEFAULT 'good' CHECK(condition IN ('good','fair','poor')),
      installed_at TEXT,
      removed_at TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
    );

CREATE TABLE IF NOT EXISTS dashcam_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id INTEGER NOT NULL,
      vehicle_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER,
      mime_type TEXT DEFAULT 'video/mp4',
      recorded_at TEXT,
      case_number TEXT,
      classification TEXT DEFAULT 'routine' CHECK(classification IN ('routine','evidence','flagged','restricted')),
      retention_status TEXT DEFAULT 'active',
      gps_lat REAL,
      gps_lon REAL,
      notes TEXT,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (camera_id) REFERENCES dash_cameras(id),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
    );

CREATE TABLE IF NOT EXISTS cpgps_vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpgps_id TEXT UNIQUE NOT NULL,
      vehicle_id INTEGER,
      name TEXT,
      vin TEXT,
      make TEXT,
      model TEXT,
      year INTEGER,
      license_plate TEXT,
      device_serial TEXT,
      last_lat REAL,
      last_lon REAL,
      last_speed REAL,
      last_heading REAL,
      last_reported_at TEXT,
      odometer REAL,
      engine_hours REAL,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
    );

CREATE TABLE IF NOT EXISTS cpgps_trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpgps_vehicle_id TEXT NOT NULL,
      vehicle_id INTEGER,
      trip_start TEXT,
      trip_end TEXT,
      start_lat REAL,
      start_lon REAL,
      end_lat REAL,
      end_lon REAL,
      start_address TEXT,
      end_address TEXT,
      distance_miles REAL,
      max_speed REAL,
      avg_speed REAL,
      idle_duration_seconds INTEGER,
      drive_duration_seconds INTEGER,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
    );

CREATE TABLE IF NOT EXISTS cpgps_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpgps_vehicle_id TEXT NOT NULL,
      vehicle_id INTEGER,
      lat REAL,
      lon REAL,
      speed REAL,
      heading REAL,
      reported_at TEXT NOT NULL,
      address TEXT,
      ignition_on INTEGER,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
    );

CREATE TABLE IF NOT EXISTS cpgps_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpgps_vehicle_id TEXT NOT NULL,
      vehicle_id INTEGER,
      alert_type TEXT,
      severity TEXT,
      message TEXT,
      triggered_at TEXT,
      lat REAL,
      lon REAL,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
    );

CREATE TABLE IF NOT EXISTS cpgps_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      records_fetched INTEGER DEFAULT 0,
      records_stored INTEGER DEFAULT 0,
      oldest_record TEXT,
      newest_record TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at TEXT
    );

CREATE TABLE IF NOT EXISTS offline_pin_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      secret TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      rotated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS company_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'general'
        CHECK(category IN ('general','policy','procedure','sop','training_manual','form','reference')),
      file_id TEXT,
      content_type TEXT NOT NULL DEFAULT 'file'
        CHECK(content_type IN ('file','link')),
      external_url TEXT,
      is_required_reading INTEGER NOT NULL DEFAULT 0,
      published INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS ai_dev_chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      tokens_used INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS ai_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      prompt_preview TEXT,
      full_prompt TEXT,
      full_response TEXT,
      tokens_used INTEGER DEFAULT 0,
      rating INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS ai_prompt_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      user_prompt_template TEXT,
      variables TEXT DEFAULT '[]',
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS ai_model_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      temperature REAL NOT NULL DEFAULT 0.3,
      max_tokens INTEGER NOT NULL DEFAULT 300,
      top_p REAL NOT NULL DEFAULT 0.9,
      repeat_penalty REAL NOT NULL DEFAULT 1.1,
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS geofences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      zone_type TEXT NOT NULL DEFAULT 'general',
      polygon_coords TEXT,
      alert_on_enter INTEGER DEFAULT 1,
      alert_on_exit INTEGER DEFAULT 0,
      color TEXT DEFAULT '#ff0000',
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS arrest_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jailbase_id TEXT,
      source_id TEXT,
      source_name TEXT,
      full_name TEXT,
      first_name TEXT,
      last_name TEXT,
      middle_name TEXT,
      date_of_birth TEXT,
      booking_date TEXT,
      charges TEXT,
      mugshot_url TEXT,
      details_url TEXT,
      county TEXT,
      status TEXT DEFAULT 'active',
      raw_record TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(jailbase_id, source_id)
    );

CREATE TABLE IF NOT EXISTS arrest_cross_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arrest_record_id INTEGER NOT NULL,
      linked_type TEXT NOT NULL,
      linked_id INTEGER NOT NULL,
      match_type TEXT,
      match_confidence REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (arrest_record_id) REFERENCES arrest_records(id),
      UNIQUE(arrest_record_id, linked_type, linked_id)
    );

CREATE TABLE IF NOT EXISTS serve_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER,
      sm_job_id INTEGER,
      officer_id INTEGER,
      serve_date TEXT,
      recipient_name TEXT,
      recipient_address TEXT,
      recipient_city TEXT,
      recipient_state TEXT,
      recipient_zip TEXT,
      recipient_lat REAL,
      recipient_lng REAL,
      document_type TEXT,
      case_number TEXT,
      court_name TEXT,
      jurisdiction TEXT,
      client_name TEXT,
      attorney_name TEXT,
      priority TEXT DEFAULT 'normal',
      time_window TEXT,
      deadline TEXT,
      max_attempts INTEGER DEFAULT 3,
      service_instructions TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      attempt_count INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS serve_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serve_queue_id INTEGER NOT NULL,
      attempt_number INTEGER DEFAULT 1,
      attempt_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      officer_id INTEGER,
      result TEXT,
      latitude REAL,
      longitude REAL,
      notes TEXT,
      attempt_type TEXT,
      photo_ids TEXT,
      signature_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (serve_queue_id) REFERENCES serve_queue(id),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS serve_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      route_date TEXT,
      optimized_order_json TEXT,
      waypoints_json TEXT,
      total_distance_miles REAL,
      total_time_minutes REAL,
      start_lat REAL,
      start_lng REAL,
      end_lat REAL,
      end_lng REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS serve_skip_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serve_queue_id INTEGER NOT NULL,
      searched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      search_type TEXT,
      search_query TEXT,
      results_json TEXT,
      addresses_found_json TEXT,
      searched_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (serve_queue_id) REFERENCES serve_queue(id),
      FOREIGN KEY (searched_by) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS panic_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      call_id INTEGER,
      trigger_method TEXT NOT NULL DEFAULT 'ui_button',
      message TEXT,
      latitude REAL,
      longitude REAL,
      location_address TEXT,
      audio_file_id TEXT,
      audio_duration_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      escalation_level INTEGER DEFAULT 0,
      acknowledged_at TEXT,
      acknowledged_by INTEGER,
      resolved_at TEXT,
      resolved_by INTEGER,
      resolution_notes TEXT,
      responder_unit_ids TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
      FOREIGN KEY (acknowledged_by) REFERENCES users(id),
      FOREIGN KEY (resolved_by) REFERENCES users(id)
    )
  `).run();

CREATE TABLE IF NOT EXISTS notifications_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          entity_type TEXT,
          entity_id INTEGER,
          priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high','critical')),
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (user_id) REFERENCES users(id)
        );

CREATE TABLE IF NOT EXISTS record_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL CHECK(source_type IN ('person','vehicle','property','evidence')),
        source_id INTEGER NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('person','vehicle','property','evidence')),
        target_id INTEGER NOT NULL,
        relationship TEXT NOT NULL DEFAULT 'associated',
        notes TEXT,
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (created_by) REFERENCES users(id),
        UNIQUE(source_type, source_id, target_type, target_id)
      );

CREATE TABLE IF NOT EXISTS utah_statutes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title INTEGER NOT NULL,
        chapter INTEGER,
        section TEXT NOT NULL,
        subsection TEXT,
        citation TEXT NOT NULL,
        short_title TEXT NOT NULL,
        description TEXT,
        offense_level TEXT CHECK(offense_level IN ('capital_felony','first_degree_felony','second_degree_felony','third_degree_felony','class_a_misdemeanor','class_b_misdemeanor','class_c_misdemeanor','infraction','enhancement',NULL)),
        category TEXT NOT NULL CHECK(category IN ('criminal','vehicle')),
        subcategory TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

CREATE TABLE IF NOT EXISTS entity_statutes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('warrant','incident','call')),
        entity_id INTEGER NOT NULL,
        statute_id INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (statute_id) REFERENCES utah_statutes(id),
        UNIQUE(entity_type, entity_id, statute_id)
      );

CREATE TABLE IF NOT EXISTS citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      citation_number TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'traffic' CHECK(type IN ('traffic','criminal','parking','warning')),
      status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','paid','contested','dismissed','warrant_issued','voided')),
      -- Subject
      person_id INTEGER,
      person_name TEXT,
      person_dob TEXT,
      person_dl TEXT,
      person_address TEXT,
      -- Vehicle (for traffic/parking)
      vehicle_description TEXT,
      vehicle_plate TEXT,
      vehicle_state TEXT,
      -- Violation
      statute_id INTEGER,
      statute_citation TEXT,
      violation_description TEXT,
      offense_level TEXT,
      fine_amount REAL,
      -- Location / Occurrence
      violation_date TEXT NOT NULL,
      violation_time TEXT,
      location TEXT,
      -- Linkage
      incident_id INTEGER,
      call_id INTEGER,
      -- Officer
      issuing_officer_id INTEGER,
      issuing_officer_name TEXT,
      badge_number TEXT,
      -- Court
      court_date TEXT,
      court_name TEXT,
      court_address TEXT,
      -- Notes
      notes TEXT,
      -- Tracking
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (person_id) REFERENCES persons(id),
      FOREIGN KEY (statute_id) REFERENCES utah_statutes(id),
      FOREIGN KEY (incident_id) REFERENCES incidents(id),
      FOREIGN KEY (issuing_officer_id) REFERENCES users(id)
    )
  `);

CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      client_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','paid','partial','overdue','void','cancelled')),
      -- Billing period
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      -- Dates
      issue_date TEXT,
      due_date TEXT,
      paid_date TEXT,
      -- Amounts
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      late_fee_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL DEFAULT 0,
      -- Terms (snapshot from client at creation)
      payment_terms TEXT,
      billing_email TEXT,
      billing_address TEXT,
      -- Notes
      notes TEXT,
      internal_notes TEXT,
      -- Tracking
      created_by INTEGER NOT NULL,
      sent_at TEXT,
      voided_at TEXT,
      voided_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      archived_at TEXT,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (voided_by) REFERENCES users(id)
    )
  `);

CREATE TABLE IF NOT EXISTS invoice_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      line_type TEXT NOT NULL CHECK(line_type IN ('contract_base','service_hours','incident_response','dispatch_call','citation','custom','late_fee','discount')),
      description TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      -- Linkage to source records (nullable)
      linked_entity_type TEXT CHECK(linked_entity_type IN ('call_for_service','incident','citation','schedule','time_entry',NULL)),
      linked_entity_id INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )
  `);

CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT CHECK(payment_method IN ('check','ach','wire','credit_card','cash','other')),
      reference_number TEXT,
      notes TEXT,
      recorded_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by) REFERENCES users(id)
    )
  `);

CREATE TABLE IF NOT EXISTS client_persons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        person_id INTEGER NOT NULL,
        relationship TEXT NOT NULL DEFAULT 'contact' CHECK(relationship IN ('employee','contact','tenant','owner','manager','subject','trespass_warning','frequent_visitor','banned','other')),
        title TEXT,
        notes TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id),
        UNIQUE(client_id, person_id)
      );

CREATE TABLE IF NOT EXISTS criminal_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL,
        record_type TEXT NOT NULL DEFAULT 'arrest' CHECK(record_type IN ('arrest','conviction','charge','booking','probation','parole','court_order','restraining_order','sex_offense','dui','other')),
        offense TEXT NOT NULL,
        offense_level TEXT CHECK(offense_level IN ('felony','misdemeanor','infraction','civil','unknown')),
        statute TEXT,
        case_number TEXT,
        agency TEXT,
        jurisdiction TEXT,
        offense_date TEXT,
        disposition TEXT,
        disposition_date TEXT,
        sentence TEXT,
        source TEXT,
        notes TEXT,
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS field_interviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fi_number TEXT UNIQUE NOT NULL,
        person_id INTEGER,
        subject_first_name TEXT,
        subject_last_name TEXT,
        subject_dob TEXT,
        subject_gender TEXT,
        subject_race TEXT,
        subject_height TEXT,
        subject_weight TEXT,
        subject_hair TEXT,
        subject_eye TEXT,
        subject_clothing TEXT,
        subject_description TEXT,
        location TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        property_id INTEGER,
        contact_reason TEXT NOT NULL DEFAULT 'other',
        contact_type TEXT DEFAULT 'field',
        action_taken TEXT DEFAULT 'none',
        narrative TEXT,
        vehicle_plate TEXT,
        vehicle_description TEXT,
        vehicle_id INTEGER,
        associated_call_id TEXT,
        associated_incident_id TEXT,
        officer_id INTEGER NOT NULL,
        officer_name TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        archived_at TEXT,
        FOREIGN KEY (person_id) REFERENCES persons(id),
        FOREIGN KEY (property_id) REFERENCES properties(id),
        FOREIGN KEY (officer_id) REFERENCES users(id),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id)
      );

CREATE TABLE IF NOT EXISTS trespass_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        person_id INTEGER,
        subject_first_name TEXT NOT NULL,
        subject_last_name TEXT NOT NULL,
        subject_dob TEXT,
        subject_description TEXT,
        property_id INTEGER,
        property_name TEXT,
        location TEXT NOT NULL,
        order_type TEXT DEFAULT 'trespass_warning',
        status TEXT DEFAULT 'active',
        reason TEXT,
        conditions TEXT,
        duration_days INTEGER,
        effective_date TEXT DEFAULT (datetime('now','localtime')),
        expiration_date TEXT,
        served_at TEXT,
        served_by INTEGER,
        originating_call_id TEXT,
        originating_incident_id TEXT,
        issued_by INTEGER NOT NULL,
        issued_by_name TEXT,
        authorized_by TEXT,
        notes TEXT,
        archived_at TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (person_id) REFERENCES persons(id),
        FOREIGN KEY (property_id) REFERENCES properties(id),
        FOREIGN KEY (issued_by) REFERENCES users(id),
        FOREIGN KEY (served_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_number TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        case_type TEXT DEFAULT 'general',
        status TEXT DEFAULT 'open',
        priority TEXT DEFAULT 'normal',
        lead_investigator_id INTEGER,
        assigned_officers TEXT DEFAULT '[]',
        assigned_at TEXT,
        solvability_score INTEGER DEFAULT 0,
        solvability_factors TEXT DEFAULT '{}',
        linked_incidents TEXT DEFAULT '[]',
        linked_citations TEXT DEFAULT '[]',
        linked_evidence TEXT DEFAULT '[]',
        linked_persons TEXT DEFAULT '[]',
        linked_field_interviews TEXT DEFAULT '[]',
        summary TEXT,
        narrative TEXT,
        disposition TEXT,
        disposition_date TEXT,
        opened_date TEXT DEFAULT (datetime('now','localtime')),
        due_date TEXT,
        closed_date TEXT,
        created_by INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        archived_at TEXT,
        FOREIGN KEY (lead_investigator_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS case_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        author_id INTEGER NOT NULL,
        author_name TEXT,
        note_type TEXT DEFAULT 'general',
        content TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (case_id) REFERENCES cases(id),
        FOREIGN KEY (author_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS case_person_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      relationship TEXT DEFAULT 'linked',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(case_id, person_id),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
    )
  `).run();

CREATE TABLE IF NOT EXISTS case_incident_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      incident_id INTEGER NOT NULL,
      relationship TEXT DEFAULT 'linked',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(case_id, incident_id),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    )
  `).run();

CREATE TABLE IF NOT EXISTS case_evidence_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      evidence_id INTEGER NOT NULL,
      relationship TEXT DEFAULT 'linked',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(case_id, evidence_id),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
    )
  `).run();

CREATE TABLE IF NOT EXISTS connection_investigations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      seed_nodes TEXT NOT NULL DEFAULT '[]',
      pinned_layout TEXT,
      annotations TEXT,
      shared_user_ids TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

CREATE TABLE IF NOT EXISTS code_violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        violation_number TEXT UNIQUE NOT NULL,
        violation_type TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        location TEXT NOT NULL,
        property_id INTEGER,
        latitude REAL,
        longitude REAL,
        person_id INTEGER,
        violator_name TEXT,
        violator_contact TEXT,
        description TEXT NOT NULL,
        code_section TEXT,
        severity TEXT DEFAULT 'minor',
        compliance_deadline TEXT,
        resolved_date TEXT,
        resolution_notes TEXT,
        fine_amount REAL DEFAULT 0,
        reporting_officer_id INTEGER NOT NULL,
        reporting_officer_name TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (property_id) REFERENCES properties(id),
        FOREIGN KEY (person_id) REFERENCES persons(id),
        FOREIGN KEY (reporting_officer_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS vehicle_tows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tow_number TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'ordered',
        vehicle_plate TEXT,
        vehicle_state TEXT,
        vehicle_vin TEXT,
        vehicle_year TEXT,
        vehicle_make TEXT,
        vehicle_model TEXT,
        vehicle_color TEXT,
        vehicle_id INTEGER,
        tow_from TEXT NOT NULL,
        tow_to TEXT,
        latitude REAL,
        longitude REAL,
        tow_reason TEXT NOT NULL,
        authorization TEXT,
        tow_company TEXT,
        tow_driver TEXT,
        tow_company_phone TEXT,
        call_id TEXT,
        citation_id INTEGER,
        incident_id INTEGER,
        ordered_at TEXT DEFAULT (datetime('now','localtime')),
        dispatched_at TEXT,
        completed_at TEXT,
        released_at TEXT,
        released_to TEXT,
        tow_fee REAL DEFAULT 0,
        storage_fee_daily REAL DEFAULT 0,
        officer_id INTEGER NOT NULL,
        officer_name TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id),
        FOREIGN KEY (officer_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS court_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_number TEXT UNIQUE NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT DEFAULT 'scheduled',
        event_date TEXT NOT NULL,
        event_time TEXT,
        court_name TEXT,
        courtroom TEXT,
        judge_name TEXT,
        court_case_number TEXT,
        citation_id INTEGER,
        incident_id INTEGER,
        case_id INTEGER,
        defendant_person_id INTEGER,
        defendant_name TEXT,
        prosecutor TEXT,
        defense_attorney TEXT,
        officers_required TEXT DEFAULT '[]',
        outcome TEXT,
        sentence TEXT,
        fine_amount REAL,
        notes TEXT,
        created_by INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (citation_id) REFERENCES citations(id),
        FOREIGN KEY (incident_id) REFERENCES incidents(id),
        FOREIGN KEY (case_id) REFERENCES cases(id),
        FOREIGN KEY (defendant_person_id) REFERENCES persons(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS daily_activity_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dar_number TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'draft',
        officer_id INTEGER NOT NULL,
        officer_name TEXT,
        shift_date TEXT NOT NULL,
        shift_start TEXT,
        shift_end TEXT,
        property_id INTEGER,
        property_name TEXT,
        post_assignment TEXT,
        calls_handled TEXT DEFAULT '[]',
        incidents_created TEXT DEFAULT '[]',
        citations_issued TEXT DEFAULT '[]',
        patrols_completed TEXT DEFAULT '[]',
        activities_narrative TEXT,
        notable_events TEXT,
        equipment_issues TEXT,
        safety_concerns TEXT,
        recommendations TEXT,
        reviewed_by INTEGER,
        reviewed_by_name TEXT,
        reviewed_at TEXT,
        review_notes TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        submitted_at TEXT,
        FOREIGN KEY (officer_id) REFERENCES users(id),
        FOREIGN KEY (property_id) REFERENCES properties(id),
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS offender_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL,
        alert_type TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        description TEXT NOT NULL,
        severity TEXT DEFAULT 'caution',
        restricted_properties TEXT DEFAULT '[]',
        restricted_zones TEXT DEFAULT '[]',
        restriction_radius_ft INTEGER,
        effective_date TEXT DEFAULT (datetime('now','localtime')),
        expiration_date TEXT,
        source_incident_id INTEGER,
        source_citation_id INTEGER,
        source_case_id INTEGER,
        created_by INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (person_id) REFERENCES persons(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS speed_violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id INTEGER NOT NULL,
      officer_id INTEGER,
      call_sign TEXT,
      officer_name TEXT,
      badge_number TEXT,
      speed_mps REAL NOT NULL,
      speed_mph REAL NOT NULL,
      speed_limit_mph REAL NOT NULL DEFAULT 80,
      overage_mph REAL NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      road_name TEXT,
      nearest_intersection TEXT,
      beat_id INTEGER,
      zone_id INTEGER,
      duration_seconds INTEGER DEFAULT 0,
      current_call_id INTEGER,
      current_call_number TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      acknowledged_by INTEGER,
      acknowledged_at TEXT,
      notes TEXT,
      FOREIGN KEY (unit_id) REFERENCES units(id),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (acknowledged_by) REFERENCES users(id)
    )
  `).run();

CREATE TABLE IF NOT EXISTS speed_zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      speed_limit_mph REAL NOT NULL,
      polygon_coords TEXT NOT NULL,
      zone_type TEXT NOT NULL DEFAULT 'custom',
      active_hours TEXT,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `).run();

CREATE TABLE IF NOT EXISTS dispatch_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        area_code TEXT NOT NULL UNIQUE,
        area_name TEXT NOT NULL,
        color TEXT DEFAULT '#6366f1',
        description TEXT,
        commander TEXT,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

CREATE TABLE IF NOT EXISTS dispatch_sectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sector_code TEXT NOT NULL UNIQUE,
        sector_name TEXT NOT NULL,
        area_id INTEGER REFERENCES dispatch_areas(id) ON DELETE SET NULL,
        county_nbr TEXT,
        fips_code TEXT,
        color TEXT DEFAULT '#808080',
        description TEXT,
        supervisor TEXT,
        radio_channel TEXT,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

CREATE TABLE IF NOT EXISTS dispatch_zones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zone_code TEXT NOT NULL UNIQUE,
        zone_name TEXT NOT NULL,
        sector_id INTEGER REFERENCES dispatch_sectors(id) ON DELETE SET NULL,
        zone_type TEXT DEFAULT 'municipality',
        ugrc_code TEXT,
        color TEXT,
        description TEXT,
        primary_unit TEXT,
        backup_unit TEXT,
        radio_channel TEXT,
        hazard_notes TEXT,
        notes TEXT,
        population_estimate INTEGER,
        sq_miles REAL,
        sort_order INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

CREATE TABLE IF NOT EXISTS dispatch_beats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        beat_code TEXT NOT NULL UNIQUE,
        beat_name TEXT NOT NULL,
        beat_descriptor TEXT,
        zone_id INTEGER REFERENCES dispatch_zones(id) ON DELETE SET NULL,
        district_letter TEXT,
        beat_number INTEGER,
        dispatch_code TEXT,
        color TEXT,
        assigned_unit TEXT,
        backup_unit TEXT,
        hazard_notes TEXT,
        premise_alerts TEXT DEFAULT '[]',
        patrol_frequency TEXT DEFAULT 'normal',
        priority_modifier INTEGER DEFAULT 0,
        population_estimate INTEGER,
        sq_miles REAL,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

CREATE TABLE IF NOT EXISTS dispatch_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        priority TEXT DEFAULT 'P3',
        color TEXT DEFAULT '#6b7280',
        requires_backup INTEGER DEFAULT 0,
        officer_safety INTEGER DEFAULT 0,
        ems_needed INTEGER DEFAULT 0,
        fire_needed INTEGER DEFAULT 0,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

CREATE TABLE IF NOT EXISTS premise_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        alert_type TEXT NOT NULL DEFAULT 'caution',
        alert_level TEXT DEFAULT 'info',
        title TEXT NOT NULL,
        description TEXT,
        flags TEXT DEFAULT '[]',
        expires_at TEXT,
        created_by INTEGER,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

CREATE TABLE IF NOT EXISTS citation_violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        citation_id INTEGER NOT NULL,
        violation_number INTEGER NOT NULL DEFAULT 1,
        statute_id INTEGER,
        statute_citation TEXT,
        violation_description TEXT NOT NULL,
        offense_level TEXT DEFAULT 'infraction',
        fine_amount REAL DEFAULT 0,
        speed_recorded INTEGER,
        speed_limit INTEGER,
        plea TEXT,
        verdict TEXT,
        disposition TEXT,
        disposition_date TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE,
        FOREIGN KEY (statute_id) REFERENCES utah_statutes(id)
      )
    `);

CREATE TABLE IF NOT EXISTS forensic_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lab_number TEXT UNIQUE NOT NULL,
        case_type TEXT NOT NULL DEFAULT 'general' CHECK(case_type IN (
          'general','homicide','sexual_assault','narcotics','arson','fraud',
          'burglary','robbery','digital','traffic','cold_case','other'
        )),
        status TEXT NOT NULL DEFAULT 'received' CHECK(status IN (
          'received','in_progress','analysis_complete','report_drafted','reviewed','released','cancelled'
        )),
        priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('routine','normal','rush','urgent')),
        title TEXT NOT NULL,
        description TEXT,
        requesting_agency TEXT DEFAULT 'RMPG',
        requesting_officer TEXT,
        lead_examiner_id INTEGER REFERENCES users(id),
        linked_incident_id INTEGER REFERENCES incidents(id),
        linked_case_id INTEGER REFERENCES cases(id),
        linked_incident_number TEXT,
        linked_case_number TEXT,
        received_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        due_date TEXT,
        completed_date TEXT,
        released_date TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

CREATE TABLE IF NOT EXISTS forensic_exhibits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
        exhibit_number TEXT NOT NULL,
        exhibit_type TEXT NOT NULL DEFAULT 'other' CHECK(exhibit_type IN (
          'biological','chemical','digital','document','drug','explosive',
          'fingerprint','firearm','trace','clothing','dna_sample','tool_mark',
          'glass','paint','fiber','soil','impression','other'
        )),
        description TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        condition_received TEXT,
        storage_location TEXT,
        storage_temp TEXT,
        collected_by TEXT,
        collected_date TEXT,
        collection_method TEXT,
        hash_md5 TEXT,
        hash_sha256 TEXT,
        chain_of_custody TEXT DEFAULT '[]',
        disposition TEXT DEFAULT 'in_lab' CHECK(disposition IN (
          'in_lab','returned','destroyed','transferred','in_storage'
        )),
        disposition_date TEXT,
        disposition_notes TEXT,
        photos TEXT DEFAULT '[]',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE(forensic_case_id, exhibit_number)
      );

CREATE TABLE IF NOT EXISTS forensic_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
        exhibit_id INTEGER REFERENCES forensic_exhibits(id) ON DELETE SET NULL,
        analysis_type TEXT NOT NULL CHECK(analysis_type IN (
          'dna','fingerprint','drug_analysis','toxicology','ballistics',
          'digital_forensics','document_exam','trace_evidence','serology',
          'arson_analysis','tool_mark','glass_analysis','paint_analysis',
          'fiber_analysis','blood_spatter','gunshot_residue','other'
        )),
        methodology TEXT,
        equipment_used TEXT,
        examiner_id INTEGER REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
          'pending','in_progress','completed','inconclusive','cancelled'
        )),
        started_at TEXT,
        completed_at TEXT,
        results TEXT,
        conclusion TEXT,
        limitations TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

CREATE TABLE IF NOT EXISTS forensic_activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        forensic_case_id INTEGER NOT NULL REFERENCES forensic_cases(id) ON DELETE CASCADE,
        exhibit_id INTEGER REFERENCES forensic_exhibits(id),
        action TEXT NOT NULL,
        details TEXT,
        performed_by INTEGER REFERENCES users(id),
        performed_by_name TEXT,
        performed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

CREATE TABLE IF NOT EXISTS email_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'internal' CHECK(category IN ('billing','case_updates','marketing','internal','legal','onboarding')),
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        plain_text TEXT,
        variables TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 1,
        version INTEGER DEFAULT 1,
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS email_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT,
        subject TEXT NOT NULL,
        status TEXT DEFAULT 'queued' CHECK(status IN ('queued','sent','delivered','opened','clicked','bounced','failed')),
        sent_at TEXT,
        opened_at TEXT,
        clicked_at TEXT,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        context_type TEXT,
        context_id TEXT,
        sent_by TEXT,
        scheduled_for TEXT,
        attachments TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (template_id) REFERENCES email_templates(id)
      );

CREATE TABLE IF NOT EXISTS email_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL UNIQUE,
        case_updates INTEGER DEFAULT 1,
        payment_receipts INTEGER DEFAULT 1,
        invoice_reminders INTEGER DEFAULT 1,
        new_messages INTEGER DEFAULT 1,
        marketing INTEGER DEFAULT 1,
        weekly_digest INTEGER DEFAULT 0,
        unsubscribed_all INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (client_id) REFERENCES clients(id)
      );

CREATE TABLE IF NOT EXISTS email_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    graph_id TEXT UNIQUE NOT NULL,
    conversation_id TEXT,
    folder_id TEXT,
    subject TEXT,
    from_address TEXT,
    from_name TEXT,
    to_addresses TEXT,
    cc_addresses TEXT,
    body_preview TEXT,
    body_html TEXT,
    has_attachments INTEGER DEFAULT 0,
    is_read INTEGER DEFAULT 0,
    is_flagged INTEGER DEFAULT 0,
    importance TEXT DEFAULT 'normal',
    received_at TEXT,
    sent_at TEXT,
    synced_at TEXT
  )`).run();

CREATE TABLE IF NOT EXISTS email_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    enabled INTEGER NOT NULL DEFAULT 1,
    conditions_json TEXT NOT NULL,
    actions_json TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();

CREATE TABLE IF NOT EXISTS email_rule_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_cache_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    executed_at TEXT NOT NULL,
    action_result TEXT,
    FOREIGN KEY (email_cache_id) REFERENCES email_cache(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_id) REFERENCES email_rules(id) ON DELETE CASCADE
  )`).run();

CREATE TABLE IF NOT EXISTS email_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    graph_id TEXT UNIQUE NOT NULL,
    display_name TEXT,
    parent_folder_id TEXT,
    total_count INTEGER DEFAULT 0,
    unread_count INTEGER DEFAULT 0,
    synced_at TEXT
  )`).run();

CREATE TABLE IF NOT EXISTS email_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_graph_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT
  )`).run();

CREATE TABLE IF NOT EXISTS user_graph_tokens (
  user_id INTEGER PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at INTEGER NOT NULL,
  mailbox TEXT,
  scopes TEXT,
  enrolled_at TEXT NOT NULL,
  last_sync_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`).run();

CREATE TABLE IF NOT EXISTS scheduled_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_addresses TEXT NOT NULL,
    cc_addresses TEXT,
    bcc_addresses TEXT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    attachments TEXT,
    scheduled_at TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at TEXT,
    error_message TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();

CREATE TABLE IF NOT EXISTS config_change_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_by INTEGER NOT NULL,
        changed_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (changed_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS record_locks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        locked_by INTEGER NOT NULL,
        locked_at TEXT DEFAULT (datetime('now','localtime')),
        expires_at TEXT NOT NULL,
        FOREIGN KEY (locked_by) REFERENCES users(id),
        UNIQUE(entity_type, entity_id)
      );

CREATE TABLE IF NOT EXISTS broadcast_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        subject TEXT,
        content TEXT NOT NULL,
        priority TEXT DEFAULT 'routine',
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS system_announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        priority TEXT DEFAULT 'info',
        active INTEGER DEFAULT 1,
        show_on_login INTEGER DEFAULT 1,
        created_by INTEGER,
        expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS hr_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'policy',
        description TEXT,
        file_path TEXT,
        file_name TEXT,
        file_size INTEGER DEFAULT 0,
        uploaded_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS hr_handbook_acknowledgments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        officer_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        acknowledged_at TEXT NOT NULL,
        signature TEXT,
        ip_address TEXT,
        FOREIGN KEY (officer_id) REFERENCES users(id),
        FOREIGN KEY (document_id) REFERENCES hr_documents(id),
        UNIQUE(officer_id, document_id)
      );

CREATE TABLE IF NOT EXISTS hr_grievances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        officer_id INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'general',
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'filed' CHECK(status IN ('filed','under_review','investigation','mediation','resolved','dismissed','appealed')),
        priority TEXT DEFAULT 'normal',
        assigned_to INTEGER,
        resolution TEXT,
        filed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (officer_id) REFERENCES users(id),
        FOREIGN KEY (assigned_to) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS hr_workers_comp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        officer_id INTEGER NOT NULL,
        incident_date TEXT NOT NULL,
        injury_type TEXT NOT NULL,
        body_part TEXT,
        description TEXT NOT NULL,
        location TEXT,
        witnesses TEXT,
        treatment TEXT,
        physician TEXT,
        lost_days INTEGER DEFAULT 0,
        osha_recordable INTEGER DEFAULT 0,
        osha_case_number TEXT,
        status TEXT NOT NULL DEFAULT 'reported' CHECK(status IN ('reported','under_review','approved','denied','closed')),
        claim_number TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (officer_id) REFERENCES users(id)
      );

CREATE TABLE IF NOT EXISTS hr_exit_interviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        officer_id INTEGER NOT NULL,
        interview_date TEXT NOT NULL,
        interviewer_id INTEGER,
        reason_for_leaving TEXT,
        satisfaction_rating INTEGER,
        would_return INTEGER DEFAULT 0,
        what_liked TEXT,
        what_disliked TEXT,
        suggestions TEXT,
        management_feedback TEXT,
        work_environment_rating INTEGER,
        compensation_rating INTEGER,
        training_rating INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (officer_id) REFERENCES users(id),
        FOREIGN KEY (interviewer_id) REFERENCES users(id)
      );

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

CREATE TABLE IF NOT EXISTS evidence_temperature_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
      temperature REAL NOT NULL,
      recorded_by INTEGER REFERENCES users(id),
      recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

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

CREATE TABLE IF NOT EXISTS fleet_vehicle_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL REFERENCES users(id),
      from_vehicle_id INTEGER REFERENCES fleet_vehicles(id),
      to_vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id),
      reason TEXT,
      swapped_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

CREATE TABLE IF NOT EXISTS call_visit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL,
      visit_number INTEGER NOT NULL,
      status TEXT,
      dispatched_at TEXT,
      enroute_at TEXT,
      onscene_at TEXT,
      cleared_at TEXT,
      closed_at TEXT,
      assigned_units TEXT,
      responding_vehicle_id INTEGER,
      starting_mileage REAL,
      ending_mileage REAL,
      disposition TEXT,
      note TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      time_window TEXT,
      is_weekend INTEGER DEFAULT 0
    )
  `).run();

CREATE TABLE IF NOT EXISTS call_persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      role TEXT,
      notes TEXT,
      added_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
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

CREATE TABLE IF NOT EXISTS warrant_scraper_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT UNIQUE,
      state TEXT,
      county TEXT,
      source_url TEXT,
      enabled INTEGER DEFAULT 1,
      scrape_interval_minutes INTEGER DEFAULT 360,
      last_scrape_at TEXT,
      consecutive_errors INTEGER DEFAULT 0,
      circuit_broken INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
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

-- persons: add 76 missing columns
ALTER TABLE persons ADD COLUMN middle_name TEXT;
ALTER TABLE persons ADD COLUMN alias_nickname TEXT;
ALTER TABLE persons ADD COLUMN ssn_last4 TEXT;
ALTER TABLE persons ADD COLUMN dl_number TEXT;
ALTER TABLE persons ADD COLUMN dl_state TEXT;
ALTER TABLE persons ADD COLUMN dl_expiry TEXT;
ALTER TABLE persons ADD COLUMN dl_class TEXT;
ALTER TABLE persons ADD COLUMN employer TEXT;
ALTER TABLE persons ADD COLUMN occupation TEXT;
ALTER TABLE persons ADD COLUMN emergency_contact_name TEXT;
ALTER TABLE persons ADD COLUMN emergency_contact_phone TEXT;
ALTER TABLE persons ADD COLUMN city TEXT;
ALTER TABLE persons ADD COLUMN state TEXT;
ALTER TABLE persons ADD COLUMN zip TEXT;
ALTER TABLE persons ADD COLUMN build TEXT;
ALTER TABLE persons ADD COLUMN complexion TEXT;
ALTER TABLE persons ADD COLUMN clothing_description TEXT;
ALTER TABLE persons ADD COLUMN gang_affiliation TEXT;
ALTER TABLE persons ADD COLUMN is_sex_offender INTEGER;
ALTER TABLE persons ADD COLUMN is_veteran INTEGER;
ALTER TABLE persons ADD COLUMN language TEXT;
ALTER TABLE persons ADD COLUMN updated_at TEXT;
ALTER TABLE persons ADD COLUMN place_of_birth TEXT;
ALTER TABLE persons ADD COLUMN citizenship TEXT;
ALTER TABLE persons ADD COLUMN marital_status TEXT;
ALTER TABLE persons ADD COLUMN hair_length TEXT;
ALTER TABLE persons ADD COLUMN hair_style TEXT;
ALTER TABLE persons ADD COLUMN facial_hair TEXT;
ALTER TABLE persons ADD COLUMN glasses TEXT;
ALTER TABLE persons ADD COLUMN shoe_size TEXT;
ALTER TABLE persons ADD COLUMN blood_type TEXT;
ALTER TABLE persons ADD COLUMN phone_secondary TEXT;
ALTER TABLE persons ADD COLUMN social_media TEXT;
ALTER TABLE persons ADD COLUMN probation_parole TEXT;
ALTER TABLE persons ADD COLUMN probation_parole_officer TEXT;
ALTER TABLE persons ADD COLUMN known_associates TEXT;
ALTER TABLE persons ADD COLUMN emergency_contact_relationship TEXT;
ALTER TABLE persons ADD COLUMN caution_flags TEXT;
ALTER TABLE persons ADD COLUMN ssn_full TEXT;
ALTER TABLE persons ADD COLUMN id_image_url TEXT;
ALTER TABLE persons ADD COLUMN id_type TEXT;
ALTER TABLE persons ADD COLUMN id_number TEXT;
ALTER TABLE persons ADD COLUMN id_state TEXT;
ALTER TABLE persons ADD COLUMN id_expiry TEXT;
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

-- vehicles_records: add 59 missing columns
ALTER TABLE vehicles_records ADD COLUMN body_style TEXT;
ALTER TABLE vehicles_records ADD COLUMN doors INTEGER;
ALTER TABLE vehicles_records ADD COLUMN secondary_color TEXT;
ALTER TABLE vehicles_records ADD COLUMN insurance_company TEXT;
ALTER TABLE vehicles_records ADD COLUMN insurance_policy TEXT;
ALTER TABLE vehicles_records ADD COLUMN registration_expiry TEXT;
ALTER TABLE vehicles_records ADD COLUMN damage_description TEXT;
ALTER TABLE vehicles_records ADD COLUMN distinguishing_features TEXT;
ALTER TABLE vehicles_records ADD COLUMN updated_at TEXT;
ALTER TABLE vehicles_records ADD COLUMN trim TEXT;
ALTER TABLE vehicles_records ADD COLUMN engine_type TEXT;
ALTER TABLE vehicles_records ADD COLUMN fuel_type TEXT;
ALTER TABLE vehicles_records ADD COLUMN transmission TEXT;
ALTER TABLE vehicles_records ADD COLUMN drive_type TEXT;
ALTER TABLE vehicles_records ADD COLUMN tow_status TEXT;
ALTER TABLE vehicles_records ADD COLUMN tow_company TEXT;
ALTER TABLE vehicles_records ADD COLUMN tow_date TEXT;
ALTER TABLE vehicles_records ADD COLUMN plate_type TEXT;
ALTER TABLE vehicles_records ADD COLUMN commercial_vehicle INTEGER;
ALTER TABLE vehicles_records ADD COLUMN hazmat INTEGER;
ALTER TABLE vehicles_records ADD COLUMN odometer TEXT;
ALTER TABLE vehicles_records ADD COLUMN owner_address TEXT;
ALTER TABLE vehicles_records ADD COLUMN owner_phone TEXT;
ALTER TABLE vehicles_records ADD COLUMN lien_holder TEXT;
ALTER TABLE vehicles_records ADD COLUMN stolen_status TEXT;
ALTER TABLE vehicles_records ADD COLUMN stolen_date TEXT;
ALTER TABLE vehicles_records ADD COLUMN recovery_date TEXT;
ALTER TABLE vehicles_records ADD COLUMN registration_expiry TEXT;
ALTER TABLE vehicles_records ADD COLUMN insurance_company TEXT;
ALTER TABLE vehicles_records ADD COLUMN insurance_policy TEXT;
ALTER TABLE vehicles_records ADD COLUMN insurance_status TEXT;
ALTER TABLE vehicles_records ADD COLUMN insurance_expiry TEXT;
ALTER TABLE vehicles_records ADD COLUMN insurance_verified_at TEXT;
ALTER TABLE vehicles_records ADD COLUMN insurance_verified_by INTEGER;
ALTER TABLE vehicles_records ADD COLUMN is_stolen INTEGER;
ALTER TABLE vehicles_records ADD COLUMN tow_status TEXT;
ALTER TABLE vehicles_records ADD COLUMN tow_company TEXT;
ALTER TABLE vehicles_records ADD COLUMN tow_lot_location TEXT;
ALTER TABLE vehicles_records ADD COLUMN tow_date TEXT;
ALTER TABLE vehicles_records ADD COLUMN tow_release_date TEXT;
ALTER TABLE vehicles_records ADD COLUMN tow_release_to TEXT;
ALTER TABLE vehicles_records ADD COLUMN tow_reason TEXT;
ALTER TABLE vehicles_records ADD COLUMN registration_state TEXT;
ALTER TABLE vehicles_records ADD COLUMN owner_name TEXT;
ALTER TABLE vehicles_records ADD COLUMN owner_dl_number TEXT;
ALTER TABLE vehicles_records ADD COLUMN owner_dob TEXT;
ALTER TABLE vehicles_records ADD COLUMN primary_driver_name TEXT;
ALTER TABLE vehicles_records ADD COLUMN registered_owner TEXT;
ALTER TABLE vehicles_records ADD COLUMN exterior_condition TEXT;
ALTER TABLE vehicles_records ADD COLUMN interior_condition TEXT;
ALTER TABLE vehicles_records ADD COLUMN title_status TEXT;
ALTER TABLE vehicles_records ADD COLUMN window_tint TEXT;
ALTER TABLE vehicles_records ADD COLUMN modifications TEXT;
ALTER TABLE vehicles_records ADD COLUMN equipment_notes TEXT;
ALTER TABLE vehicles_records ADD COLUMN vehicle_use TEXT;
ALTER TABLE vehicles_records ADD COLUMN ncic_entry_number TEXT;
ALTER TABLE vehicles_records ADD COLUMN estimated_value REAL;
ALTER TABLE vehicles_records ADD COLUMN tow_location TEXT;
ALTER TABLE vehicles_records ADD COLUMN insurance_expiry TEXT;

-- calls_for_service: add 54 missing columns
ALTER TABLE calls_for_service ADD COLUMN caller_address TEXT;
ALTER TABLE calls_for_service ADD COLUMN zone_beat TEXT;
ALTER TABLE calls_for_service ADD COLUMN sector_id TEXT;
ALTER TABLE calls_for_service ADD COLUMN zone_id TEXT;
ALTER TABLE calls_for_service ADD COLUMN beat_id TEXT;
ALTER TABLE calls_for_service ADD COLUMN cross_street TEXT;
ALTER TABLE calls_for_service ADD COLUMN location_building TEXT;
ALTER TABLE calls_for_service ADD COLUMN location_floor TEXT;
ALTER TABLE calls_for_service ADD COLUMN location_room TEXT;
ALTER TABLE calls_for_service ADD COLUMN weapons_involved TEXT;
ALTER TABLE calls_for_service ADD COLUMN injuries_reported INTEGER;
ALTER TABLE calls_for_service ADD COLUMN num_subjects INTEGER;
ALTER TABLE calls_for_service ADD COLUMN subject_description TEXT;
ALTER TABLE calls_for_service ADD COLUMN vehicle_description TEXT;
ALTER TABLE calls_for_service ADD COLUMN direction_of_travel TEXT;
ALTER TABLE calls_for_service ADD COLUMN archived_at TEXT;
ALTER TABLE calls_for_service ADD COLUMN responding_officer TEXT;
ALTER TABLE calls_for_service ADD COLUMN secondary_type TEXT;
ALTER TABLE calls_for_service ADD COLUMN contact_method TEXT;
ALTER TABLE calls_for_service ADD COLUMN scene_safety TEXT;
ALTER TABLE calls_for_service ADD COLUMN weather_conditions TEXT;
ALTER TABLE calls_for_service ADD COLUMN lighting_conditions TEXT;
ALTER TABLE calls_for_service ADD COLUMN num_victims INTEGER;
ALTER TABLE calls_for_service ADD COLUMN alcohol_involved INTEGER;
ALTER TABLE calls_for_service ADD COLUMN drugs_involved INTEGER;
ALTER TABLE calls_for_service ADD COLUMN domestic_violence INTEGER;
ALTER TABLE calls_for_service ADD COLUMN supervisor_notified INTEGER;
ALTER TABLE calls_for_service ADD COLUMN le_notified INTEGER;
ALTER TABLE calls_for_service ADD COLUMN le_agency TEXT;
ALTER TABLE calls_for_service ADD COLUMN le_case_number TEXT;
ALTER TABLE calls_for_service ADD COLUMN damage_estimate REAL;
ALTER TABLE calls_for_service ADD COLUMN damage_description TEXT;
ALTER TABLE calls_for_service ADD COLUMN action_taken TEXT;
ALTER TABLE calls_for_service ADD COLUMN updated_at TEXT;
ALTER TABLE calls_for_service ADD COLUMN received_at TEXT;
ALTER TABLE calls_for_service ADD COLUMN previous_status TEXT;
ALTER TABLE calls_for_service ADD COLUMN client_id INTEGER;
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
ALTER TABLE calls_for_service ADD COLUMN priority_score INTEGER;
ALTER TABLE calls_for_service ADD COLUMN response_time_seconds REAL;
ALTER TABLE calls_for_service ADD COLUMN status_changed_at TEXT;
ALTER TABLE calls_for_service ADD COLUMN onscene_duration_seconds REAL;
ALTER TABLE calls_for_service ADD COLUMN overdue_notified TEXT;
ALTER TABLE calls_for_service ADD COLUMN received_at TEXT;

-- incidents: add 51 missing columns
ALTER TABLE incidents ADD COLUMN occurred_date TEXT;
ALTER TABLE incidents ADD COLUMN occurred_time TEXT;
ALTER TABLE incidents ADD COLUMN end_date TEXT;
ALTER TABLE incidents ADD COLUMN end_time TEXT;
ALTER TABLE incidents ADD COLUMN weather_conditions TEXT;
ALTER TABLE incidents ADD COLUMN lighting_conditions TEXT;
ALTER TABLE incidents ADD COLUMN injuries INTEGER;
ALTER TABLE incidents ADD COLUMN injury_description TEXT;
ALTER TABLE incidents ADD COLUMN damage_estimate REAL;
ALTER TABLE incidents ADD COLUMN damage_description TEXT;
ALTER TABLE incidents ADD COLUMN weapons_involved TEXT;
ALTER TABLE incidents ADD COLUMN alcohol_involved INTEGER;
ALTER TABLE incidents ADD COLUMN drugs_involved INTEGER;
ALTER TABLE incidents ADD COLUMN domestic_violence INTEGER;
ALTER TABLE incidents ADD COLUMN review_notes TEXT;
ALTER TABLE incidents ADD COLUMN disposition TEXT;
ALTER TABLE incidents ADD COLUMN zone_beat TEXT;
ALTER TABLE incidents ADD COLUMN section_id TEXT;
ALTER TABLE incidents ADD COLUMN sector_id TEXT;
ALTER TABLE incidents ADD COLUMN zone_id TEXT;
ALTER TABLE incidents ADD COLUMN beat_id TEXT;
ALTER TABLE incidents ADD COLUMN responding_le_agency TEXT;
ALTER TABLE incidents ADD COLUMN le_case_number TEXT;
ALTER TABLE incidents ADD COLUMN road_conditions TEXT;
ALTER TABLE incidents ADD COLUMN traffic_control TEXT;
ALTER TABLE incidents ADD COLUMN vehicle_1_info TEXT;
ALTER TABLE incidents ADD COLUMN vehicle_2_info TEXT;
ALTER TABLE incidents ADD COLUMN diagram_notes TEXT;
ALTER TABLE incidents ADD COLUMN patient_status TEXT;
ALTER TABLE incidents ADD COLUMN ems_transport TEXT;
ALTER TABLE incidents ADD COLUMN patient_vitals TEXT;
ALTER TABLE incidents ADD COLUMN treatment_rendered TEXT;
ALTER TABLE incidents ADD COLUMN trespass_warning_issued INTEGER;
ALTER TABLE incidents ADD COLUMN trespass_effective_date TEXT;
ALTER TABLE incidents ADD COLUMN trespass_expiry_date TEXT;
ALTER TABLE incidents ADD COLUMN property_boundaries TEXT;
ALTER TABLE incidents ADD COLUMN force_type TEXT;
ALTER TABLE incidents ADD COLUMN force_justification TEXT;
ALTER TABLE incidents ADD COLUMN subject_injuries TEXT;
ALTER TABLE incidents ADD COLUMN officer_injuries TEXT;
ALTER TABLE incidents ADD COLUMN de_escalation_attempts TEXT;
ALTER TABLE incidents ADD COLUMN statute_id INTEGER;
ALTER TABLE incidents ADD COLUMN statute_citation TEXT;
ALTER TABLE incidents ADD COLUMN citation_fine REAL;
ALTER TABLE incidents ADD COLUMN client_id INTEGER;
ALTER TABLE incidents ADD COLUMN contract_id TEXT;
ALTER TABLE incidents ADD COLUMN approved_at TEXT;
ALTER TABLE incidents ADD COLUMN assigned_detective_id INTEGER;
ALTER TABLE incidents ADD COLUMN weather_conditions TEXT;
ALTER TABLE incidents ADD COLUMN weather_temperature REAL;
ALTER TABLE incidents ADD COLUMN weather_recorded_at TEXT;

-- users: add 44 missing columns
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
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
ALTER TABLE users ADD COLUMN login_count INTEGER;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER;
ALTER TABLE users ADD COLUMN totp_secret_enc TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER;
ALTER TABLE users ADD COLUMN totp_backup_codes TEXT;
ALTER TABLE users ADD COLUMN totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN totp_exempt INTEGER;
ALTER TABLE users ADD COLUMN password_history TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN digital_signature TEXT;
ALTER TABLE users ADD COLUMN voice_rate REAL;
ALTER TABLE users ADD COLUMN voice_pitch REAL;
ALTER TABLE users ADD COLUMN voice_brain_enabled INTEGER;
ALTER TABLE users ADD COLUMN photo TEXT;
ALTER TABLE users ADD COLUMN active_case_count INTEGER;

-- units: add 4 missing columns
ALTER TABLE units ADD COLUMN assigned_beat TEXT;
ALTER TABLE units ADD COLUMN mileage REAL;
ALTER TABLE units ADD COLUMN gps_source TEXT;
ALTER TABLE units ADD COLUMN gps_updated_at TEXT;

-- clients: add 31 missing columns
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

-- evidence: add 29 missing columns
ALTER TABLE evidence ADD COLUMN evidence_number TEXT;
ALTER TABLE evidence ADD COLUMN location_found TEXT;
ALTER TABLE evidence ADD COLUMN condition TEXT;
ALTER TABLE evidence ADD COLUMN quantity INTEGER;
ALTER TABLE evidence ADD COLUMN release_authorized_by TEXT;
ALTER TABLE evidence ADD COLUMN released_to TEXT;
ALTER TABLE evidence ADD COLUMN release_date TEXT;
ALTER TABLE evidence ADD COLUMN collected_date TEXT;
ALTER TABLE evidence ADD COLUMN packaging_type TEXT;
ALTER TABLE evidence ADD COLUMN dimensions TEXT;
ALTER TABLE evidence ADD COLUMN weight TEXT;
ALTER TABLE evidence ADD COLUMN photo_taken INTEGER;
ALTER TABLE evidence ADD COLUMN lab_submitted INTEGER;
ALTER TABLE evidence ADD COLUMN lab_case_number TEXT;
ALTER TABLE evidence ADD COLUMN lab_name TEXT;
ALTER TABLE evidence ADD COLUMN disposal_method TEXT;
ALTER TABLE evidence ADD COLUMN disposal_date TEXT;
ALTER TABLE evidence ADD COLUMN disposal_authorized_by TEXT;
ALTER TABLE evidence ADD COLUMN serial_number TEXT;
ALTER TABLE evidence ADD COLUMN brand TEXT;
ALTER TABLE evidence ADD COLUMN model TEXT;
ALTER TABLE evidence ADD COLUMN estimated_value REAL;
ALTER TABLE evidence ADD COLUMN category TEXT;
ALTER TABLE evidence ADD COLUMN notes TEXT;
ALTER TABLE evidence ADD COLUMN updated_at TEXT;
ALTER TABLE evidence ADD COLUMN retention_until TEXT;
ALTER TABLE evidence ADD COLUMN disposition TEXT;
ALTER TABLE evidence ADD COLUMN storage_temperature REAL;
ALTER TABLE evidence ADD COLUMN is_biological INTEGER;

-- properties: add 20 missing columns
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

-- credentials: add 1 missing columns
ALTER TABLE credentials ADD COLUMN issuing_authority TEXT;

-- time_entries: add 6 missing columns
ALTER TABLE time_entries ADD COLUMN break_start TEXT;
ALTER TABLE time_entries ADD COLUMN break_minutes REAL NOT NULL;
ALTER TABLE time_entries ADD COLUMN notes TEXT;
ALTER TABLE time_entries ADD COLUMN edit_reason TEXT;
ALTER TABLE time_entries ADD COLUMN edited_by INTEGER;
ALTER TABLE time_entries ADD COLUMN edited_at TEXT;

-- patrol_checkpoints: add 3 missing columns
ALTER TABLE patrol_checkpoints ADD COLUMN assigned_officer_id INTEGER;
ALTER TABLE patrol_checkpoints ADD COLUMN location_description TEXT;
ALTER TABLE patrol_checkpoints ADD COLUMN special_instructions TEXT;

-- messages: add 16 missing columns
ALTER TABLE messages ADD COLUMN subject TEXT;
ALTER TABLE messages ADD COLUMN parent_id INTEGER;
ALTER TABLE messages ADD COLUMN thread_id INTEGER;
ALTER TABLE messages ADD COLUMN case_id INTEGER;
ALTER TABLE messages ADD COLUMN thread_id TEXT;
ALTER TABLE messages ADD COLUMN file_url TEXT;
ALTER TABLE messages ADD COLUMN edited_at TEXT;
ALTER TABLE messages ADD COLUMN subject TEXT;
ALTER TABLE messages ADD COLUMN scheduled_at TEXT;
ALTER TABLE messages ADD COLUMN attachment_url TEXT;
ALTER TABLE messages ADD COLUMN attachment_name TEXT;
ALTER TABLE messages ADD COLUMN is_template INTEGER;
ALTER TABLE messages ADD COLUMN template_name TEXT;
ALTER TABLE messages ADD COLUMN is_draft INTEGER;
ALTER TABLE messages ADD COLUMN draft_updated_at TEXT;
ALTER TABLE messages ADD COLUMN delivered_at TEXT;

-- warrants: add 5 missing columns
ALTER TABLE warrants ADD COLUMN statute_id INTEGER;
ALTER TABLE warrants ADD COLUMN statute_citation TEXT;
ALTER TABLE warrants ADD COLUMN external_warrant_id TEXT;
ALTER TABLE warrants ADD COLUMN external_source_key TEXT;
ALTER TABLE warrants ADD COLUMN auto_created INTEGER;

-- utah_statutes: add 2 missing columns
ALTER TABLE utah_statutes ADD COLUMN citation_fine REAL;
ALTER TABLE utah_statutes ADD COLUMN statute_code TEXT;

-- gps_breadcrumbs: add 2 missing columns
ALTER TABLE gps_breadcrumbs ADD COLUMN road_name TEXT;
ALTER TABLE gps_breadcrumbs ADD COLUMN nearest_intersection TEXT;

-- dispatch_sectors: add 2 missing columns
ALTER TABLE dispatch_sectors ADD COLUMN county_nbr TEXT;
ALTER TABLE dispatch_sectors ADD COLUMN fips_code TEXT;

-- dispatch_zones: add 1 missing columns
ALTER TABLE dispatch_zones ADD COLUMN ugrc_code TEXT;

-- dispatch_beats: add 2 missing columns
ALTER TABLE dispatch_beats ADD COLUMN district_letter TEXT;
ALTER TABLE dispatch_beats ADD COLUMN beat_number INTEGER;

-- fleet_fuel_logs: add 2 missing columns
ALTER TABLE fleet_fuel_logs ADD COLUMN distance REAL;
ALTER TABLE fleet_fuel_logs ADD COLUMN efficiency REAL;

-- fleet_maintenance: add 2 missing columns
ALTER TABLE fleet_maintenance ADD COLUMN labor_cost REAL;
ALTER TABLE fleet_maintenance ADD COLUMN service_tasks TEXT;

-- citations: add 40 missing columns
ALTER TABLE citations ADD COLUMN section_id TEXT;
ALTER TABLE citations ADD COLUMN sector_id TEXT;
ALTER TABLE citations ADD COLUMN zone_id TEXT;
ALTER TABLE citations ADD COLUMN beat_id TEXT;
ALTER TABLE citations ADD COLUMN zone_beat TEXT;
ALTER TABLE citations ADD COLUMN latitude REAL;
ALTER TABLE citations ADD COLUMN longitude REAL;
ALTER TABLE citations ADD COLUMN vehicle_vin TEXT;
ALTER TABLE citations ADD COLUMN vehicle_year TEXT;
ALTER TABLE citations ADD COLUMN vehicle_make TEXT;
ALTER TABLE citations ADD COLUMN vehicle_model TEXT;
ALTER TABLE citations ADD COLUMN vehicle_color TEXT;
ALTER TABLE citations ADD COLUMN vehicle_id INTEGER;
ALTER TABLE citations ADD COLUMN speed_recorded INTEGER;
ALTER TABLE citations ADD COLUMN speed_limit INTEGER;
ALTER TABLE citations ADD COLUMN radar_type TEXT;
ALTER TABLE citations ADD COLUMN bac_level REAL;
ALTER TABLE citations ADD COLUMN bond_amount REAL;
ALTER TABLE citations ADD COLUMN bond_type TEXT;
ALTER TABLE citations ADD COLUMN is_warning INTEGER;
ALTER TABLE citations ADD COLUMN is_equipment_violation INTEGER;
ALTER TABLE citations ADD COLUMN weather_conditions TEXT;
ALTER TABLE citations ADD COLUMN road_conditions TEXT;
ALTER TABLE citations ADD COLUMN accident_related INTEGER;
ALTER TABLE citations ADD COLUMN dui_related INTEGER;
ALTER TABLE citations ADD COLUMN school_zone INTEGER;
ALTER TABLE citations ADD COLUMN construction_zone INTEGER;
ALTER TABLE citations ADD COLUMN commercial_vehicle INTEGER;
ALTER TABLE citations ADD COLUMN hazmat INTEGER;
ALTER TABLE citations ADD COLUMN voided_reason TEXT;
ALTER TABLE citations ADD COLUMN voided_by INTEGER;
ALTER TABLE citations ADD COLUMN voided_at TEXT;
ALTER TABLE citations ADD COLUMN court_time TEXT;
ALTER TABLE citations ADD COLUMN court_room TEXT;
ALTER TABLE citations ADD COLUMN appearance_required INTEGER;
ALTER TABLE citations ADD COLUMN plea TEXT;
ALTER TABLE citations ADD COLUMN verdict TEXT;
ALTER TABLE citations ADD COLUMN sentence TEXT;
ALTER TABLE citations ADD COLUMN disposition_date TEXT;
ALTER TABLE citations ADD COLUMN case_id INTEGER;

-- ofac_sdn_addresses: add 2 missing columns
ALTER TABLE ofac_sdn_addresses ADD COLUMN add_num INTEGER;
ALTER TABLE ofac_sdn_addresses ADD COLUMN add_remarks TEXT;

-- ofac_sdn_ids: add 1 missing columns
ALTER TABLE ofac_sdn_ids ADD COLUMN remarks TEXT;

-- cases: add 2 missing columns
ALTER TABLE cases ADD COLUMN deadline TEXT;
ALTER TABLE cases ADD COLUMN sla_hours INTEGER;

-- court_events: add 8 missing columns
ALTER TABLE court_events ADD COLUMN continuance_count INTEGER;
ALTER TABLE court_events ADD COLUMN defendant_dob TEXT;
ALTER TABLE court_events ADD COLUMN bail_amount REAL;
ALTER TABLE court_events ADD COLUMN bond_status TEXT;
ALTER TABLE court_events ADD COLUMN surety_info TEXT;
ALTER TABLE court_events ADD COLUMN judge_notes TEXT;
ALTER TABLE court_events ADD COLUMN prosecutor_phone TEXT;
ALTER TABLE court_events ADD COLUMN prosecutor_email TEXT;

-- email_links: add 1 missing columns
ALTER TABLE email_links ADD COLUMN auto_linked INTEGER;

-- email_cache: add 1 missing columns
ALTER TABLE email_cache ADD COLUMN owner_user_id INTEGER;

-- email_folders: add 1 missing columns
ALTER TABLE email_folders ADD COLUMN owner_user_id INTEGER;

-- email_rules: add 1 missing columns
ALTER TABLE email_rules ADD COLUMN owner_user_id INTEGER;

-- scheduled_emails: add 1 missing columns
ALTER TABLE scheduled_emails ADD COLUMN owner_user_id INTEGER;

-- bolos: add 2 missing columns
ALTER TABLE bolos ADD COLUMN auto_expire_hours INTEGER;
ALTER TABLE bolos ADD COLUMN expired_at TEXT;

-- fleet_vehicles: add 5 missing columns
ALTER TABLE fleet_vehicles ADD COLUMN total_maintenance_cost REAL;
ALTER TABLE fleet_vehicles ADD COLUMN total_fuel_cost REAL;
ALTER TABLE fleet_vehicles ADD COLUMN total_trips INTEGER;
ALTER TABLE fleet_vehicles ADD COLUMN avg_mpg REAL;
ALTER TABLE fleet_vehicles ADD COLUMN next_service_mileage INTEGER;

-- performance_reviews: add 1 missing columns
ALTER TABLE performance_reviews ADD COLUMN template_name TEXT;

-- patrol_scans: add 1 missing columns
ALTER TABLE patrol_scans ADD COLUMN weather_json TEXT;

-- trespass_orders: add 1 missing columns
ALTER TABLE trespass_orders ADD COLUMN subject_photo_url TEXT;

-- offender_alerts: add 4 missing columns
ALTER TABLE offender_alerts ADD COLUMN alert_latitude REAL;
ALTER TABLE offender_alerts ADD COLUMN alert_longitude REAL;
ALTER TABLE offender_alerts ADD COLUMN alert_address TEXT;
ALTER TABLE offender_alerts ADD COLUMN alert_enabled INTEGER;

-- forensic_cases: add 4 missing columns
ALTER TABLE forensic_cases ADD COLUMN linked_incident_id INTEGER;
ALTER TABLE forensic_cases ADD COLUMN lab_number TEXT;
ALTER TABLE forensic_cases ADD COLUMN lead_examiner_id INTEGER;
ALTER TABLE forensic_cases ADD COLUMN linked_case_id INTEGER;

-- dashcam_videos: add 1 missing columns
ALTER TABLE dashcam_videos ADD COLUMN incident_id INTEGER;

-- serve_queue: add 2 missing columns
ALTER TABLE serve_queue ADD COLUMN recipient_person_id INTEGER;
ALTER TABLE serve_queue ADD COLUMN property_id INTEGER;

-- training_records: add 2 missing columns
ALTER TABLE training_records ADD COLUMN training_type TEXT;
ALTER TABLE training_records ADD COLUMN expiration_date TEXT;

-- training_requirements: add 2 missing columns
ALTER TABLE training_requirements ADD COLUMN required_for_role TEXT;
ALTER TABLE training_requirements ADD COLUMN is_active INTEGER;

-- hr_documents: add 2 missing columns
ALTER TABLE hr_documents ADD COLUMN officer_id INTEGER;
ALTER TABLE hr_documents ADD COLUMN document_type TEXT;

-- hr_grievances: add 1 missing columns
ALTER TABLE hr_grievances ADD COLUMN officer_id INTEGER;

-- hr_workers_comp: add 1 missing columns
ALTER TABLE hr_workers_comp ADD COLUMN injury_date TEXT;

-- hr_attendance: add 1 missing columns
ALTER TABLE hr_attendance ADD COLUMN attendance_date TEXT;

-- fleet_damage_reports: add 1 missing columns
ALTER TABLE fleet_damage_reports ADD COLUMN reported_at TEXT;

-- email_logs: add 1 missing columns
ALTER TABLE email_logs ADD COLUMN to_email TEXT;

-- patrol_breaks: add 1 missing columns
ALTER TABLE patrol_breaks ADD COLUMN start_time TEXT;

-- person_associates: add 1 missing columns
ALTER TABLE person_associates ADD COLUMN associated_person_id INTEGER;

-- cpgps_vehicles: add 1 missing columns
ALTER TABLE cpgps_vehicles ADD COLUMN unit_number TEXT;

-- cpgps_trips: add 1 missing columns
ALTER TABLE cpgps_trips ADD COLUMN start_time TEXT;

-- cpgps_locations: add 1 missing columns
ALTER TABLE cpgps_locations ADD COLUMN timestamp TEXT;

-- warrant_watch_runs: add 1 missing columns
ALTER TABLE warrant_watch_runs ADD COLUMN created_at TEXT;

-- warrant_watch_log: add 1 missing columns
ALTER TABLE warrant_watch_log ADD COLUMN run_id INTEGER;

-- record_locks: add 1 missing columns
ALTER TABLE record_locks ADD COLUMN user_id INTEGER;

-- forensic_exhibits: add 14 missing columns
ALTER TABLE forensic_exhibits ADD COLUMN condition_on_receipt TEXT;
ALTER TABLE forensic_exhibits ADD COLUMN packaging_type TEXT;
ALTER TABLE forensic_exhibits ADD COLUMN packaging_sealed INTEGER;
ALTER TABLE forensic_exhibits ADD COLUMN collected_by TEXT;
ALTER TABLE forensic_exhibits ADD COLUMN collected_date TEXT;
ALTER TABLE forensic_exhibits ADD COLUMN collected_location TEXT;
ALTER TABLE forensic_exhibits ADD COLUMN received_from TEXT;
ALTER TABLE forensic_exhibits ADD COLUMN storage_location TEXT;
ALTER TABLE forensic_exhibits ADD COLUMN storage_requirements TEXT;
ALTER TABLE forensic_exhibits ADD COLUMN is_hazardous INTEGER;
ALTER TABLE forensic_exhibits ADD COLUMN is_biohazard INTEGER;
ALTER TABLE forensic_exhibits ADD COLUMN current_custodian TEXT;
ALTER TABLE forensic_exhibits ADD COLUMN current_custodian_id INTEGER;
ALTER TABLE forensic_exhibits ADD COLUMN examination_requested TEXT;

-- warrant_scraper_config: add 13 missing columns
ALTER TABLE warrant_scraper_config ADD COLUMN source_name TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN last_run_at TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN last_error TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN source_type TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN priority INTEGER;
ALTER TABLE warrant_scraper_config ADD COLUMN content_hash TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN content_hash_updated_at TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN etag TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN last_modified TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN last_success_at TEXT;
ALTER TABLE warrant_scraper_config ADD COLUMN avg_parse_count REAL;
ALTER TABLE warrant_scraper_config ADD COLUMN p95_latency_ms INTEGER;
ALTER TABLE warrant_scraper_config ADD COLUMN jitter_seed INTEGER;

-- scraped_warrants: add 12 missing columns
ALTER TABLE scraped_warrants ADD COLUMN middle_name TEXT;
ALTER TABLE scraped_warrants ADD COLUMN age INTEGER;
ALTER TABLE scraped_warrants ADD COLUMN gender TEXT;
ALTER TABLE scraped_warrants ADD COLUMN race TEXT;
ALTER TABLE scraped_warrants ADD COLUMN city TEXT;
ALTER TABLE scraped_warrants ADD COLUMN state TEXT;
ALTER TABLE scraped_warrants ADD COLUMN photo_url TEXT;
ALTER TABLE scraped_warrants ADD COLUMN detail_url TEXT;
ALTER TABLE scraped_warrants ADD COLUMN first_seen_at TEXT;
ALTER TABLE scraped_warrants ADD COLUMN last_seen_at TEXT;
ALTER TABLE scraped_warrants ADD COLUMN cleared_at TEXT;
ALTER TABLE scraped_warrants ADD COLUMN dob_verified INTEGER;

-- radio_transcripts: add 3 missing columns
ALTER TABLE radio_transcripts ADD COLUMN audio_file TEXT;
ALTER TABLE radio_transcripts ADD COLUMN file_size INTEGER;
ALTER TABLE radio_transcripts ADD COLUMN linked_call_id INTEGER;

-- field_interviews: add 7 missing columns
ALTER TABLE field_interviews ADD COLUMN date TEXT;
ALTER TABLE field_interviews ADD COLUMN gang_affiliation TEXT;
ALTER TABLE field_interviews ADD COLUMN section_id INTEGER;
ALTER TABLE field_interviews ADD COLUMN zone_id INTEGER;
ALTER TABLE field_interviews ADD COLUMN beat_id INTEGER;
ALTER TABLE field_interviews ADD COLUMN zone_beat TEXT;
ALTER TABLE field_interviews ADD COLUMN updated_at TEXT;

