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
