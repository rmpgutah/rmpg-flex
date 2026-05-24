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
