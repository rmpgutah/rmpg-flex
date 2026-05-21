-- ============================================================
-- RMPG Flex — Production D1 Schema Sync Migration
-- Generated: 2026-05-21T06:50:56.317618
-- Summary: 680 columns added, 105 new tables
-- ============================================================

-- ═══ NEW TABLES — Not yet in production D1 ═══

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

CREATE TABLE IF NOT EXISTS case_evidence_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      evidence_id INTEGER NOT NULL,
      relationship TEXT DEFAULT 'linked',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(case_id, evidence_id),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS case_incident_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      incident_id INTEGER NOT NULL,
      relationship TEXT DEFAULT 'linked',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(case_id, incident_id),
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS config_change_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_by INTEGER NOT NULL,
        changed_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (changed_by) REFERENCES users(id)
      );

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

CREATE TABLE IF NOT EXISTS cpgps_officer_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      cpgps_vehicle_id TEXT NOT NULL,
      call_sign TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(officer_id, cpgps_vehicle_id)
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
    );

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
  );

CREATE TABLE IF NOT EXISTS email_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    graph_id TEXT UNIQUE NOT NULL,
    display_name TEXT,
    parent_folder_id TEXT,
    total_count INTEGER DEFAULT 0,
    unread_count INTEGER DEFAULT 0,
    synced_at TEXT
  );

CREATE TABLE IF NOT EXISTS email_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_graph_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT
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

CREATE TABLE IF NOT EXISTS email_rule_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_cache_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    executed_at TEXT NOT NULL,
    action_result TEXT,
    FOREIGN KEY (email_cache_id) REFERENCES email_cache(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_id) REFERENCES email_rules(id) ON DELETE CASCADE
  );

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

CREATE TABLE IF NOT EXISTS evidence_temperature_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
      temperature REAL NOT NULL,
      recorded_by INTEGER REFERENCES users(id),
      recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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

CREATE TABLE IF NOT EXISTS fleet_vehicle_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL REFERENCES users(id),
      from_vehicle_id INTEGER REFERENCES fleet_vehicles(id),
      to_vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id),
      reason TEXT,
      swapped_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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

CREATE TABLE IF NOT EXISTS forensic_case_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      linked_type TEXT NOT NULL,
      linked_id INTEGER NOT NULL,
      linked_label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (case_id) REFERENCES forensic_cases(id)
    );

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

CREATE TABLE IF NOT EXISTS integration_health_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('healthy','degraded','error')),
      response_time_ms INTEGER,
      error_message TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

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

CREATE TABLE IF NOT EXISTS ofac_sdn_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ent_num INTEGER NOT NULL,
      alt_num INTEGER,
      alt_type TEXT,
      alt_name TEXT NOT NULL,
      alt_remarks TEXT,
      FOREIGN KEY (ent_num) REFERENCES ofac_sdn_entries(ent_num) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS offline_pin_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      secret TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      rotated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

CREATE TABLE IF NOT EXISTS owntracks_device_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracker_id TEXT NOT NULL UNIQUE,
      unit_id INTEGER NOT NULL,
      device_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (unit_id) REFERENCES units(id)
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
    );

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

-- ═══ MISSING COLUMNS on existing production tables ═══

ALTER TABLE arrest_records ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE bolos ADD COLUMN auto_expire_hours INTEGER DEFAULT NULL;
ALTER TABLE bolos ADD COLUMN expired_at TEXT DEFAULT NULL;
ALTER TABLE bolos ADD COLUMN photos TEXT DEFAULT '[]';
ALTER TABLE call_persons ADD COLUMN added_by TEXT DEFAULT NULL;
ALTER TABLE call_persons ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE call_persons ADD COLUMN role TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN assigned_units TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN cleared_at TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN closed_at TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN created_by TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN dispatched_at TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN disposition TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN ending_mileage TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN enroute_at TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN is_weekend TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN note TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN onscene_at TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN responding_vehicle_id TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN starting_mileage TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN status TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN time_window TEXT DEFAULT NULL;
ALTER TABLE call_visit_history ADD COLUMN visit_number TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN beat_descriptor TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN beat_id TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN beat_name TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN caller_address TEXT DEFAULT '';
ALTER TABLE calls_for_service ADD COLUMN case_id INTEGER DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN case_number TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN contact_method TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN contract_id TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN cross_street TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN direction_of_travel TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN dispatch_code TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN ending_mileage REAL DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN lighting_conditions TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN location_building TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN location_floor TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN location_room TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN num_subjects INTEGER DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN num_victims INTEGER DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN onscene_duration_seconds REAL DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN overdue_notified TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN responding_officer TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN response_time_seconds REAL DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN scene_safety TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN secondary_type TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN section_name TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN sector_id TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN sector_name TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN starting_mileage REAL DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN subject_description TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN tags TEXT DEFAULT '[]';
ALTER TABLE calls_for_service ADD COLUMN vehicle_description TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN weather_conditions TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN zone_beat TEXT DEFAULT '';
ALTER TABLE calls_for_service ADD COLUMN zone_id TEXT DEFAULT NULL;
ALTER TABLE calls_for_service ADD COLUMN zone_name TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN archived_at TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN assigned_at TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN assigned_employees TEXT DEFAULT '[]';
ALTER TABLE cases ADD COLUMN assigned_officers TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN audit_log TEXT DEFAULT '[]';
ALTER TABLE cases ADD COLUMN case_type TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN closed_date TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN deadline TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN disposition TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN disposition_date TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN due_date TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN lead_investigator_id TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN linked_calls TEXT DEFAULT '[]';
ALTER TABLE cases ADD COLUMN linked_citations TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN linked_evidence TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN linked_field_interviews TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN linked_incidents TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN linked_persons TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN narrative TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN opened_date TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN sla_hours INTEGER DEFAULT NULL;
ALTER TABLE cases ADD COLUMN solvability_factors TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN solvability_score TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN summary TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN account_manager TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN auto_renew INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN avatar TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN billing_address TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN billing_cycle TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN billing_day INTEGER DEFAULT NULL;
ALTER TABLE clients ADD COLUMN billing_email TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN client_code TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN client_since TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN contract_type TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN contract_value REAL DEFAULT NULL;
ALTER TABLE clients ADD COLUMN discount_percent REAL DEFAULT 0;
ALTER TABLE clients ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN incident_count INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN industry TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN language_preference TEXT DEFAULT 'en';
ALTER TABLE clients ADD COLUMN last_active_at TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN last_incident_date TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN late_fee_percent REAL DEFAULT 0;
ALTER TABLE clients ADD COLUMN outstanding_balance REAL DEFAULT 0;
ALTER TABLE clients ADD COLUMN payment_method TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN payment_terms TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN priority_client INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN rate_per_cfs REAL DEFAULT NULL;
ALTER TABLE clients ADD COLUMN rate_per_hour REAL DEFAULT NULL;
ALTER TABLE clients ADD COLUMN rate_per_incident REAL DEFAULT NULL;
ALTER TABLE clients ADD COLUMN tax_id TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN total_invoiced REAL DEFAULT 0;
ALTER TABLE clients ADD COLUMN total_paid REAL DEFAULT 0;
ALTER TABLE clients ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN verification_token TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN website TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN bail_amount REAL DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN bond_status TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN case_id TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN citation_id TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN continuance_count INTEGER DEFAULT 0;
ALTER TABLE court_events ADD COLUMN continuance_log TEXT DEFAULT '[]';
ALTER TABLE court_events ADD COLUMN court_case_number TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN court_fees TEXT DEFAULT '{}';
ALTER TABLE court_events ADD COLUMN court_name TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN courtroom TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN created_by TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN defendant_dob TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN defendant_name TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN defendant_person_id TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN defense_attorney TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN documents TEXT DEFAULT '[]';
ALTER TABLE court_events ADD COLUMN event_date TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN event_number TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN event_time TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN event_type TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN fine_amount TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN incident_id TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN judge_name TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN judge_notes TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN officer_confirmations TEXT DEFAULT '{}';
ALTER TABLE court_events ADD COLUMN officers_required TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN outcome TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN prosecutor TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN prosecutor_email TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN prosecutor_phone TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN sentence TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN status TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN surety_info TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE court_events ADD COLUMN witnesses TEXT DEFAULT '[]';
ALTER TABLE credentials ADD COLUMN issuing_authority TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN active TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN assigned_unit TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN backup_unit TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN beat_descriptor TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN beat_name TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN beat_number INTEGER DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN dispatch_code TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN district_letter TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN hazard_notes TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN patrol_frequency TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN population_estimate TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN premise_alerts TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN priority_modifier TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN sq_miles TEXT DEFAULT NULL;
ALTER TABLE dispatch_beats ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE dispatch_sectors ADD COLUMN active TEXT DEFAULT NULL;
ALTER TABLE dispatch_sectors ADD COLUMN county_nbr TEXT DEFAULT NULL;
ALTER TABLE dispatch_sectors ADD COLUMN fips_code TEXT DEFAULT NULL;
ALTER TABLE dispatch_sectors ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE dispatch_sectors ADD COLUMN radio_channel TEXT DEFAULT NULL;
ALTER TABLE dispatch_sectors ADD COLUMN sector_name TEXT DEFAULT NULL;
ALTER TABLE dispatch_sectors ADD COLUMN supervisor TEXT DEFAULT NULL;
ALTER TABLE dispatch_sectors ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN active TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN backup_unit TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN hazard_notes TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN population_estimate TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN primary_unit TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN radio_channel TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN sq_miles TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN ugrc_code TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN zone_name TEXT DEFAULT NULL;
ALTER TABLE dispatch_zones ADD COLUMN zone_type TEXT DEFAULT 'municipality';
ALTER TABLE evidence ADD COLUMN brand TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN category TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN collected_date TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN condition TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN dimensions TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN disposal_authorized_by TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN disposal_date TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN disposal_method TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN disposition TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN estimated_value REAL DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN is_biological INTEGER DEFAULT 0;
ALTER TABLE evidence ADD COLUMN lab_case_number TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN lab_name TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN lab_submitted INTEGER DEFAULT 0;
ALTER TABLE evidence ADD COLUMN location_found TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN model TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN packaging_type TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN photo_taken INTEGER DEFAULT 0;
ALTER TABLE evidence ADD COLUMN quantity INTEGER DEFAULT 1;
ALTER TABLE evidence ADD COLUMN release_authorized_by TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN release_date TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN released_to TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN retention_until TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN serial_number TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN storage_temperature REAL DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE evidence ADD COLUMN weight TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN action_taken TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN archived_at TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN associated_call_id TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN associated_incident_id TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN beat_id INTEGER DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN contact_reason TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN contact_type TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN date TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN fi_number TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN gang_affiliation TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN latitude TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN location TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN longitude TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN narrative TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN officer_id TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN officer_name TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN person_id TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN property_id TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN section_id INTEGER DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN status TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_clothing TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_description TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_dob TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_eye TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_first_name TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_gender TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_hair TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_height TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_last_name TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_race TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN subject_weight TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN vehicle_description TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN vehicle_id TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN vehicle_plate TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN zone_beat TEXT DEFAULT NULL;
ALTER TABLE field_interviews ADD COLUMN zone_id INTEGER DEFAULT NULL;
ALTER TABLE fleet_fuel_logs ADD COLUMN created_at TEXT DEFAULT NULL;
ALTER TABLE fleet_fuel_logs ADD COLUMN created_by TEXT DEFAULT NULL;
ALTER TABLE fleet_fuel_logs ADD COLUMN distance REAL DEFAULT NULL;
ALTER TABLE fleet_fuel_logs ADD COLUMN efficiency REAL DEFAULT NULL;
ALTER TABLE fleet_fuel_logs ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE fleet_fuel_logs ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE fleet_fuel_logs ADD COLUMN station TEXT DEFAULT NULL;
ALTER TABLE fleet_inspections ADD COLUMN checklist TEXT DEFAULT '[]';
ALTER TABLE fleet_inspections ADD COLUMN created_by TEXT DEFAULT NULL;
ALTER TABLE fleet_inspections ADD COLUMN inspection_type TEXT DEFAULT NULL;
ALTER TABLE fleet_inspections ADD COLUMN inspector_name TEXT DEFAULT NULL;
ALTER TABLE fleet_inspections ADD COLUMN items TEXT DEFAULT NULL;
ALTER TABLE fleet_inspections ADD COLUMN mileage TEXT DEFAULT NULL;
ALTER TABLE fleet_inspections ADD COLUMN overall_result TEXT DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN description TEXT DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN labor_cost REAL DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN mileage_at_service TEXT DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN next_due_date TEXT DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN next_due_mileage TEXT DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN performed_at TEXT DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN performed_by TEXT DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN service_tasks TEXT DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE fleet_maintenance ADD COLUMN type TEXT DEFAULT NULL;
ALTER TABLE fleet_maintenance ADD COLUMN vendor TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN avg_mpg REAL DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN color TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN current_mileage TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN equipment TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN insurance_expiry TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN last_service_date TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN next_service_due TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN plate_state TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN registration_expiry TEXT DEFAULT NULL;
ALTER TABLE fleet_vehicles ADD COLUMN total_fuel_cost REAL DEFAULT 0;
ALTER TABLE fleet_vehicles ADD COLUMN total_maintenance_cost REAL DEFAULT 0;
ALTER TABLE fleet_vehicles ADD COLUMN total_trips INTEGER DEFAULT 0;
ALTER TABLE fleet_vehicles ADD COLUMN vehicle_number TEXT DEFAULT NULL;
ALTER TABLE geofences ADD COLUMN alert_on_enter TEXT DEFAULT NULL;
ALTER TABLE geofences ADD COLUMN alert_on_exit TEXT DEFAULT NULL;
ALTER TABLE geofences ADD COLUMN color TEXT DEFAULT NULL;
ALTER TABLE geofences ADD COLUMN created_by TEXT DEFAULT NULL;
ALTER TABLE geofences ADD COLUMN polygon_coords TEXT DEFAULT NULL;
ALTER TABLE geofences ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE geofences ADD COLUMN zone_type TEXT DEFAULT NULL;
ALTER TABLE gps_breadcrumbs ADD COLUMN nearest_intersection TEXT DEFAULT NULL;
ALTER TABLE gps_breadcrumbs ADD COLUMN road_name TEXT DEFAULT NULL;
ALTER TABLE gps_breadcrumbs ADD COLUMN source TEXT DEFAULT 'unknown';
ALTER TABLE incident_links ADD COLUMN added_by TEXT DEFAULT NULL;
ALTER TABLE incident_links ADD COLUMN created_at TEXT DEFAULT NULL;
ALTER TABLE incident_links ADD COLUMN link_reason TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN added_by TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN attempted_completed TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN bias_motivation TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN counts TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN created_at TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN criminal_activity TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN disposition TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN disposition_date TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN location_type TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN nibrs_code TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN suspect_person_id TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN ucr_code TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN victim_person_id TEXT DEFAULT NULL;
ALTER TABLE incident_offenses ADD COLUMN weapon_force TEXT DEFAULT NULL;
ALTER TABLE incident_officers ADD COLUMN action_taken TEXT DEFAULT NULL;
ALTER TABLE incident_officers ADD COLUMN added_by TEXT DEFAULT NULL;
ALTER TABLE incident_officers ADD COLUMN arrived_at TEXT DEFAULT NULL;
ALTER TABLE incident_officers ADD COLUMN created_at TEXT DEFAULT NULL;
ALTER TABLE incident_officers ADD COLUMN departed_at TEXT DEFAULT NULL;
ALTER TABLE incident_officers ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN assigned_detective_id INTEGER DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN citation_fine REAL DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN client_id INTEGER DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN contract_id TEXT DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN section_id TEXT DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN statute_citation TEXT DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN statute_id INTEGER DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN weather_recorded_at TEXT DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN weather_temperature REAL DEFAULT NULL;
ALTER TABLE messages ADD COLUMN acknowledgments TEXT DEFAULT '{}';
ALTER TABLE messages ADD COLUMN attachment_name TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN attachment_url TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN case_id INTEGER DEFAULT NULL;
ALTER TABLE messages ADD COLUMN delivered_at TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN delivery_status TEXT DEFAULT 'sent';
ALTER TABLE messages ADD COLUMN draft_updated_at TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN edited_at TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN file_url TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN is_draft INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN is_template INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'text';
ALTER TABLE messages ADD COLUMN parent_id INTEGER DEFAULT NULL;
ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '[]';
ALTER TABLE messages ADD COLUMN read_receipts TEXT DEFAULT '{}';
ALTER TABLE messages ADD COLUMN scheduled_at TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'open';
ALTER TABLE messages ADD COLUMN subject TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN template_name TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN thread_id TEXT DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN body TEXT DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN is_read TEXT DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN user_id TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN alert_address TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN alert_enabled INTEGER DEFAULT 1;
ALTER TABLE offender_alerts ADD COLUMN alert_latitude REAL DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN alert_longitude REAL DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN alert_type TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN created_by TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN description TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN effective_date TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN expiration_date TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN person_id TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN restricted_properties TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN restricted_zones TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN restriction_radius_ft TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN severity TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN source_case_id TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN source_citation_id TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN source_incident_id TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN status TEXT DEFAULT NULL;
ALTER TABLE offender_alerts ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN audio_duration_seconds TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN audio_file_id TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN call_id TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN escalation_level TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN location_address TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN message TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN resolution_notes TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN resolved_by TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN responder_unit_ids TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN trigger_method TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE panic_alerts ADD COLUMN user_id TEXT DEFAULT NULL;
ALTER TABLE patrol_checkpoints ADD COLUMN assigned_officer_id INTEGER DEFAULT NULL;
ALTER TABLE patrol_checkpoints ADD COLUMN location_description TEXT DEFAULT NULL;
ALTER TABLE patrol_checkpoints ADD COLUMN special_instructions TEXT DEFAULT NULL;
ALTER TABLE patrol_scans ADD COLUMN weather_json TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN alias_dob TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN aliases TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN date_last_seen TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN disability_flags TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN distinguishing_features TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN education_level TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN email_secondary TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN fbi_number TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN height_feet INTEGER DEFAULT NULL;
ALTER TABLE persons ADD COLUMN height_inches INTEGER DEFAULT NULL;
ALTER TABLE persons ADD COLUMN home_phone TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN identifying_marks_location TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN immigration_status TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN location_last_seen TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN medication_notes TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN mental_health_flags TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN military_branch TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN military_status TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN ncic_number TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN passport_country TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN passport_number TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN photo TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN piercing_description TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN scar_description TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN sor_number TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN state_id_number TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN substance_abuse TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN tattoo_description TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN tribal_affiliation TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN watchlist_checked_at TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN watchlist_match TEXT DEFAULT NULL;
ALTER TABLE persons ADD COLUMN work_phone TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN access_instructions TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN business_type TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN city TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE properties ADD COLUMN key_holder_name TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN key_holder_phone TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN key_holder_relationship TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN last_inspection_date TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN number_of_stories TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN occupancy_status TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN owner_name TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN owner_phone TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN security_features TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN square_footage TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN state TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN structure_type TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN year_built TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN zip TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN attempt_at TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN attempt_number TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN attempt_type TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN latitude TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN longitude TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN officer_id TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN photo_ids TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN result TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN serve_queue_id TEXT DEFAULT NULL;
ALTER TABLE serve_attempts ADD COLUMN signature_data TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN attempt_count TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN attorney_name TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN call_id TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN case_number TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN client_name TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN court_name TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN deadline TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN document_type TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN jurisdiction TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN max_attempts TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN officer_id TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN priority TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN property_id INTEGER DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN recipient_address TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN recipient_city TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN recipient_lat TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN recipient_lng TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN recipient_name TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN recipient_person_id INTEGER DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN recipient_state TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN recipient_zip TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN serve_date TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN service_instructions TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN sm_job_id TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN sort_order TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN status TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN time_window TEXT DEFAULT NULL;
ALTER TABLE serve_queue ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN end_lat TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN end_lng TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN officer_id TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN optimized_order_json TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN route_date TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN start_lat TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN start_lng TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN total_distance_miles TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN total_time_minutes TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE serve_routes ADD COLUMN waypoints_json TEXT DEFAULT NULL;
ALTER TABLE serve_skip_traces ADD COLUMN addresses_found_json TEXT DEFAULT NULL;
ALTER TABLE serve_skip_traces ADD COLUMN results_json TEXT DEFAULT NULL;
ALTER TABLE serve_skip_traces ADD COLUMN search_query TEXT DEFAULT NULL;
ALTER TABLE serve_skip_traces ADD COLUMN search_type TEXT DEFAULT NULL;
ALTER TABLE serve_skip_traces ADD COLUMN searched_at TEXT DEFAULT NULL;
ALTER TABLE serve_skip_traces ADD COLUMN searched_by TEXT DEFAULT NULL;
ALTER TABLE serve_skip_traces ADD COLUMN serve_queue_id TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN acknowledged_at TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN acknowledged_by TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN badge_number TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN beat_id TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN call_sign TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN current_call_id TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN current_call_number TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN duration_seconds TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN nearest_intersection TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN officer_name TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN overage_mph TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN speed_mps TEXT DEFAULT NULL;
ALTER TABLE speed_violations ADD COLUMN zone_id TEXT DEFAULT NULL;
ALTER TABLE supplemental_reports ADD COLUMN approved_at TEXT DEFAULT NULL;
ALTER TABLE supplemental_reports ADD COLUMN approved_by TEXT DEFAULT NULL;
ALTER TABLE supplemental_reports ADD COLUMN narrative TEXT DEFAULT NULL;
ALTER TABLE supplemental_reports ADD COLUMN status TEXT DEFAULT NULL;
ALTER TABLE supplemental_reports ADD COLUMN subject TEXT DEFAULT NULL;
ALTER TABLE supplemental_reports ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE time_entries ADD COLUMN edit_reason TEXT DEFAULT NULL;
ALTER TABLE time_entries ADD COLUMN edited_at TEXT DEFAULT NULL;
ALTER TABLE time_entries ADD COLUMN edited_by INTEGER DEFAULT NULL;
ALTER TABLE time_entries ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN archived_at TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN authorized_by TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN conditions TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN duration_days TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN effective_date TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN expiration_date TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN issued_by TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN issued_by_name TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN location TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN order_number TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN order_type TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN originating_call_id TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN originating_incident_id TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN person_id TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN property_id TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN property_name TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN reason TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN served_at TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN served_by TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN status TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN subject_description TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN subject_dob TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN subject_first_name TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN subject_last_name TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN subject_photo_url TEXT DEFAULT NULL;
ALTER TABLE trespass_orders ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE units ADD COLUMN assigned_beat TEXT DEFAULT NULL;
ALTER TABLE units ADD COLUMN mileage REAL DEFAULT NULL;
ALTER TABLE users ADD COLUMN active_case_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN address TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN allergies TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN assignment_history TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN availability TEXT DEFAULT '{}';
ALTER TABLE users ADD COLUMN blood_type TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN certifications TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN city TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN commendations TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN date_of_birth TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN department TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN dl_expiry TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN dl_number TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN dl_state TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN emergency_contact_name TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN emergency_contact_phone TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN emergency_contact_relationship TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN employee_id TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN favorites TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN fitness_scores TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN font_size_preference TEXT DEFAULT 'medium';
ALTER TABLE users ADD COLUMN hire_date TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN last_password_change TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN middle_name TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN notes TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN notification_prefs TEXT DEFAULT '{}';
ALTER TABLE users ADD COLUMN password_changed_at TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN performance TEXT DEFAULT '{}';
ALTER TABLE users ADD COLUMN photo TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN profile_image TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN rank TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN recently_viewed TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN shift_preference TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN ssn_last4 TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN state TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN status_history TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN termination_date TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN territory_zips TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN theme_preference TEXT DEFAULT 'dark';
ALTER TABLE users ADD COLUMN totp_pending_secret TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN uniform_size TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN zip TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN commercial_vehicle INTEGER DEFAULT 0;
ALTER TABLE vehicles_records ADD COLUMN damage_description TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN distinguishing_features TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN drive_type TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN engine_type TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN equipment_notes TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN estimated_value REAL DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN exterior_condition TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN fuel_type TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN hazmat INTEGER DEFAULT 0;
ALTER TABLE vehicles_records ADD COLUMN insurance_expiry TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN insurance_status TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN insurance_verified_at TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN insurance_verified_by INTEGER DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN interior_condition TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN is_stolen INTEGER DEFAULT 0;
ALTER TABLE vehicles_records ADD COLUMN lien_holder TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN modifications TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN ncic_entry_number TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN odometer TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN owner_address TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN owner_dl_number TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN owner_dob TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN owner_name TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN owner_phone TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN plate_type TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN primary_driver_name TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN recovery_date TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN registered_owner TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN registration_state TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN stolen_date TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN stolen_status TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN title_status TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN tow_company TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN tow_date TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN tow_location TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN tow_lot_location TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN tow_reason TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN tow_release_date TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN tow_release_to TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN tow_status TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN transmission TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN trim TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN updated_at TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN vehicle_use TEXT DEFAULT NULL;
ALTER TABLE vehicles_records ADD COLUMN window_tint TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN avg_parse_count REAL DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN circuit_broken TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN consecutive_errors TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN content_hash TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN content_hash_updated_at TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN county TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN enabled TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN etag TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN jitter_seed INTEGER DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN last_error TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN last_modified TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN last_run_at TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN last_scrape_at TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN last_success_at TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN p95_latency_ms INTEGER DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN priority INTEGER DEFAULT 3;
ALTER TABLE warrant_scraper_config ADD COLUMN scrape_interval_minutes TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN source_key TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN source_name TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN source_type TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN source_url TEXT DEFAULT NULL;
ALTER TABLE warrant_scraper_config ADD COLUMN state TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN auto_created INTEGER DEFAULT 0;
ALTER TABLE warrants ADD COLUMN bail_amount TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN charge_description TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN expires_at TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN external_source_key TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN external_warrant_id TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN issuing_court TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN issuing_judge TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN offense_level TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN served_at TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN served_location TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN statute_citation TEXT DEFAULT NULL;
ALTER TABLE warrants ADD COLUMN statute_id INTEGER DEFAULT NULL;
