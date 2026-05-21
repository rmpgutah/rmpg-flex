-- New table: cpgps_sync_log
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
-- New table: offline_pin_secrets
CREATE TABLE IF NOT EXISTS offline_pin_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      secret TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      rotated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
-- New table: company_documents
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
-- New table: ai_dev_chat
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
-- New table: ai_activity_log
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
-- New table: ai_prompt_templates
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
-- New table: ai_model_presets
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
-- New table: arrest_cross_links
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
-- New table: notifications_v2
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
-- New table: record_links
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
-- New table: utah_statutes
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
-- New table: entity_statutes
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
-- New table: invoices
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
-- New table: invoice_line_items
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
-- New table: payments
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
-- New table: client_persons
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
-- New table: criminal_history
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
-- New table: case_notes
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
-- New table: case_person_links
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
-- New table: case_incident_links
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
-- New table: case_evidence_links
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
-- New table: connection_investigations
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
-- New table: code_violations
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
-- New table: vehicle_tows
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
-- New table: daily_activity_reports
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
