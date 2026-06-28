-- New table: speed_zones
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
-- New table: premise_alerts
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
-- New table: forensic_cases
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
-- New table: forensic_exhibits
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
-- New table: forensic_analyses
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
-- New table: forensic_activity_log
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
-- New table: email_templates
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
-- New table: email_logs
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
-- New table: email_preferences
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
-- New table: email_cache
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
-- New table: email_rules
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
-- New table: email_rule_matches
CREATE TABLE IF NOT EXISTS email_rule_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_cache_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    executed_at TEXT NOT NULL,
    action_result TEXT,
    FOREIGN KEY (email_cache_id) REFERENCES email_cache(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_id) REFERENCES email_rules(id) ON DELETE CASCADE
  )`).run();
-- New table: email_folders
CREATE TABLE IF NOT EXISTS email_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    graph_id TEXT UNIQUE NOT NULL,
    display_name TEXT,
    parent_folder_id TEXT,
    total_count INTEGER DEFAULT 0,
    unread_count INTEGER DEFAULT 0,
    synced_at TEXT
  )`).run();
-- New table: email_links
CREATE TABLE IF NOT EXISTS email_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_graph_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT
  )`).run();
-- New table: user_graph_tokens
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
-- New table: scheduled_emails
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
-- New table: config_change_history
CREATE TABLE IF NOT EXISTS config_change_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_by INTEGER NOT NULL,
        changed_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (changed_by) REFERENCES users(id)
      );
-- New table: record_locks
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
-- New table: broadcast_templates
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
-- New table: system_announcements
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
-- New table: hr_documents
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
-- New table: hr_handbook_acknowledgments
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
-- New table: hr_grievances
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
-- New table: hr_workers_comp
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
-- New table: hr_exit_interviews
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
