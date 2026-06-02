-- ============================================================
-- migrations/baseline/schema.sql  — LOCAL-DEV BASELINE SNAPSHOT
-- ============================================================
-- Authoritative schema snapshot of LIVE D1 `rmpg-flex`
-- (785de7ae-3e7a-4e01-93bb-d24ddd813f6b), the source of truth.
--
-- WHY THIS EXISTS: the historical migrations/*.sql files are NOT replayable
-- from scratch (dirty-schema rehoming artifact — two conflicting 0001 files,
-- ordering violations, non-constant ADD COLUMN defaults). `npm run migrate:local`
-- bootstraps a fresh local D1 from THIS snapshot instead of replaying history,
-- then applies any migrations newer than the snapshot (0072+) via wrangler.
--
-- NOT applied to remote and NOT picked up by `wrangler d1 migrations apply`
-- (wrangler only reads *.sql in migrations/, not subdirectories).
--
-- SCHEMA ONLY — no rows. Never dump live data here (PII: persons/calls).
--
-- REGENERATE (after a batch of new migrations, to re-squash):
--   CLOUDFLARE_ACCOUNT_ID=<acct> npx wrangler d1 export rmpg-flex --remote \
--     --no-data --output=/tmp/live_schema_raw.sql
--   then re-run scripts/build-baseline (adds IF NOT EXISTS + tracker seed).
-- Generated 2026-06-02 from `wrangler d1 export --no-data`.
-- ============================================================

PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','dispatcher','supervisor','officer','client_viewer','contract_manager','human_resources')),
  badge_number TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','terminated')),
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
, totp_enabled INTEGER DEFAULT 0, totp_secret_enc TEXT, totp_backup_codes TEXT, must_change_password INTEGER DEFAULT 0, digital_signature TEXT, first_name TEXT, last_name TEXT, assigned_unit_id INTEGER, login_count INTEGER DEFAULT 0, last_login_at TEXT, password_history TEXT, totp_exempt INTEGER DEFAULT 0, voice_persona TEXT, voice_rate REAL, voice_pitch REAL, voice_terseness TEXT, voice_brain_enabled INTEGER DEFAULT 0, email_signature TEXT, middle_name TEXT, date_of_birth TEXT, ssn_last4 TEXT, address TEXT, city TEXT, state TEXT, zip TEXT, emergency_contact_name TEXT, emergency_contact_phone TEXT, emergency_contact_relationship TEXT, hire_date TEXT, termination_date TEXT, rank TEXT, department TEXT, shift_preference TEXT, dl_number TEXT, dl_state TEXT, dl_expiry TEXT, blood_type TEXT, allergies TEXT, uniform_size TEXT, employee_id TEXT, certifications TEXT, notes TEXT, profile_image TEXT, last_password_change TEXT, totp_pending_secret TEXT, password_changed_at TEXT, photo TEXT, active_case_count INTEGER, territory_zips TEXT DEFAULT '[]', availability TEXT DEFAULT '{}', performance TEXT DEFAULT '{}', notification_prefs TEXT DEFAULT '{}', theme_preference TEXT DEFAULT 'dark', font_size_preference TEXT DEFAULT 'medium', favorites TEXT DEFAULT '[]', recently_viewed TEXT DEFAULT '[]', fitness_scores TEXT DEFAULT '[]', commendations TEXT DEFAULT '[]', status_history TEXT DEFAULT '[]', assignment_history TEXT DEFAULT '[]', archived_at TEXT);
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
, billing_email TEXT, billing_address TEXT, contract_type TEXT, contract_value REAL, payment_terms TEXT, auto_renew INTEGER, updated_at TEXT, client_code TEXT, industry TEXT, website TEXT, tax_id TEXT, payment_method TEXT, billing_cycle TEXT, billing_day INTEGER, discount_percent REAL, late_fee_percent REAL, total_invoiced REAL, total_paid REAL, outstanding_balance REAL, incident_count INTEGER, last_incident_date TEXT, account_manager TEXT, priority_client INTEGER, client_since TEXT, rate_per_hour REAL, rate_per_incident REAL, rate_per_cfs REAL, email_verified INTEGER, verification_token TEXT, avatar TEXT, last_active_at TEXT);
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), city TEXT, state TEXT, zip TEXT, access_instructions TEXT, is_active INTEGER NOT NULL, updated_at TEXT, notes TEXT, business_type TEXT, structure_type TEXT, occupancy_status TEXT, year_built TEXT, square_footage TEXT, number_of_stories TEXT, security_features TEXT, key_holder_name TEXT, key_holder_phone TEXT, key_holder_relationship TEXT, owner_name TEXT, owner_phone TEXT, last_inspection_date TEXT, archived_at TEXT, alarm_account TEXT, alarm_company TEXT, alarm_system TEXT, camera_system TEXT, closing_hours TEXT, contact_email TEXT, inspection_status TEXT, known_hazards TEXT, opening_hours TEXT, parking_info TEXT, patrol_frequency TEXT, roof_access TEXT, secondary_contact_name TEXT, secondary_contact_phone TEXT, utility_shutoffs TEXT, phone TEXT, email TEXT, dba_name TEXT, ein TEXT, license_number TEXT, website TEXT, contact_name TEXT, contact_phone TEXT, industry TEXT, employee_count TEXT, annual_revenue TEXT, status TEXT DEFAULT 'active',
  FOREIGN KEY (client_id) REFERENCES clients(id)
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
  recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), gps_source TEXT, call_number TEXT, call_type TEXT, road_name TEXT, nearest_intersection TEXT,
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
  updated_at TEXT DEFAULT (datetime('now','localtime')), gps_source TEXT DEFAULT 'manual', gps_updated_at TEXT, assigned_beat TEXT, mileage REAL, audio_mode TEXT DEFAULT 'audible', gps_heading REAL, gps_speed REAL, emergency_active INTEGER DEFAULT 0, emergency_call_id INTEGER, emergency_since TEXT,
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), occurred_date TEXT, occurred_time TEXT, end_date TEXT, end_time TEXT, weather_conditions TEXT, lighting_conditions TEXT, injuries INTEGER DEFAULT 0, injury_description TEXT, damage_estimate REAL, damage_description TEXT, weapons_involved TEXT, alcohol_involved INTEGER DEFAULT 0, drugs_involved INTEGER DEFAULT 0, domestic_violence INTEGER DEFAULT 0, review_notes TEXT, disposition TEXT, zone_beat TEXT, sector_id TEXT, zone_id TEXT, beat_id TEXT, responding_le_agency TEXT, le_case_number TEXT, road_conditions TEXT, traffic_control TEXT, vehicle_1_info TEXT, vehicle_2_info TEXT, diagram_notes TEXT, patient_status TEXT, ems_transport TEXT, patient_vitals TEXT, treatment_rendered TEXT, trespass_warning_issued INTEGER DEFAULT 0, trespass_effective_date TEXT, trespass_expiry_date TEXT, property_boundaries TEXT, force_type TEXT, force_justification TEXT, subject_injuries TEXT, officer_injuries TEXT, de_escalation_attempts TEXT, mental_health_crisis INTEGER DEFAULT 0, juvenile_involved INTEGER DEFAULT 0, gang_related INTEGER DEFAULT 0, dui_related INTEGER DEFAULT 0, hit_and_run INTEGER DEFAULT 0, stolen_vehicle INTEGER DEFAULT 0, assault_weapon INTEGER DEFAULT 0, mass_casualty INTEGER DEFAULT 0, officer_involved_shooting INTEGER DEFAULT 0, pursuit INTEGER DEFAULT 0, use_of_force_reported INTEGER DEFAULT 0, k9_deployment INTEGER DEFAULT 0, srt_activation INTEGER DEFAULT 0, bomb_threat INTEGER DEFAULT 0, terrorism INTEGER DEFAULT 0, cybercrime INTEGER DEFAULT 0, assigned_unit_ids TEXT, response_time_sec INTEGER, client_id INTEGER, archived_at TEXT, section_id TEXT, statute_id INTEGER, statute_citation TEXT, citation_fine REAL, contract_id TEXT, assigned_detective_id INTEGER, weather_temperature REAL, weather_recorded_at TEXT, area_code TEXT, area_name TEXT,
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
, middle_name TEXT, alias_nickname TEXT, ssn_last4 TEXT, dl_number TEXT, dl_state TEXT, dl_expiry TEXT, dl_class TEXT, employer TEXT, occupation TEXT, emergency_contact_name TEXT, emergency_contact_phone TEXT, city TEXT, state TEXT, zip TEXT, build TEXT, complexion TEXT, clothing_description TEXT, gang_affiliation TEXT, is_sex_offender INTEGER DEFAULT 0, is_veteran INTEGER DEFAULT 0, language TEXT, updated_at TEXT, place_of_birth TEXT, citizenship TEXT, marital_status TEXT, hair_length TEXT, hair_style TEXT, facial_hair TEXT, glasses TEXT, shoe_size TEXT, blood_type TEXT, phone_secondary TEXT, social_media TEXT, probation_parole TEXT, probation_parole_officer TEXT, known_associates TEXT, emergency_contact_relationship TEXT, caution_flags TEXT, ssn_full TEXT, id_image_url TEXT, id_type TEXT, id_number TEXT, id_state TEXT, id_expiry TEXT, height_feet INTEGER, height_inches INTEGER, watchlist_match TEXT, watchlist_checked_at TEXT, aliases TEXT, photo TEXT, ncic_number TEXT, sor_number TEXT, fbi_number TEXT, state_id_number TEXT, passport_number TEXT, passport_country TEXT, immigration_status TEXT, disability_flags TEXT, mental_health_flags TEXT, substance_abuse TEXT, medication_notes TEXT, education_level TEXT, military_branch TEXT, military_status TEXT, tribal_affiliation TEXT, identifying_marks_location TEXT, tattoo_description TEXT, scar_description TEXT, piercing_description TEXT, distinguishing_features TEXT, email_secondary TEXT, date_last_seen TEXT, location_last_seen TEXT, alias_dob TEXT, home_phone TEXT, work_phone TEXT);
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), body_style TEXT, doors INTEGER, secondary_color TEXT, insurance_company TEXT, insurance_policy TEXT, registration_expiry TEXT, damage_description TEXT, distinguishing_features TEXT, updated_at TEXT, trim TEXT, engine_type TEXT, fuel_type TEXT, transmission TEXT, drive_type TEXT, tow_status TEXT, tow_company TEXT, tow_date TEXT, plate_type TEXT, commercial_vehicle INTEGER, hazmat INTEGER, odometer TEXT, owner_address TEXT, owner_phone TEXT, lien_holder TEXT, stolen_status TEXT, stolen_date TEXT, recovery_date TEXT, insurance_status TEXT, insurance_expiry TEXT, insurance_verified_at TEXT, insurance_verified_by INTEGER, is_stolen INTEGER, tow_lot_location TEXT, tow_release_date TEXT, tow_release_to TEXT, tow_reason TEXT, registration_state TEXT, owner_name TEXT, owner_dl_number TEXT, owner_dob TEXT, primary_driver_name TEXT, registered_owner TEXT, exterior_condition TEXT, interior_condition TEXT, title_status TEXT, window_tint TEXT, modifications TEXT, equipment_notes TEXT, vehicle_use TEXT, ncic_entry_number TEXT, estimated_value REAL, tow_location TEXT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), auto_expire_hours INTEGER, expired_at TEXT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), subject TEXT, parent_id INTEGER, thread_id TEXT, case_id INTEGER, file_url TEXT, edited_at TEXT, scheduled_at TEXT, attachment_url TEXT, attachment_name TEXT, is_template INTEGER, template_name TEXT, is_draft INTEGER, draft_updated_at TEXT, delivered_at TEXT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), location_found TEXT, condition TEXT, quantity INTEGER, release_authorized_by TEXT, released_to TEXT, release_date TEXT, collected_date TEXT, packaging_type TEXT, dimensions TEXT, weight TEXT, photo_taken INTEGER, lab_submitted INTEGER, lab_case_number TEXT, lab_name TEXT, disposal_method TEXT, disposal_date TEXT, disposal_authorized_by TEXT, serial_number TEXT, brand TEXT, model TEXT, estimated_value REAL, category TEXT, notes TEXT, updated_at TEXT, retention_until TEXT, disposition TEXT, storage_temperature REAL, is_biological INTEGER,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), notes TEXT, edit_reason TEXT, edited_by INTEGER, edited_at TEXT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), issuing_authority TEXT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), assigned_officer_id INTEGER, location_description TEXT, special_instructions TEXT, archived_at TEXT,
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
  status TEXT NOT NULL DEFAULT 'on_time' CHECK(status IN ('on_time','late','missed')), weather_json TEXT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), folder_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL,
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
, config_key_backup TEXT);
CREATE TABLE IF NOT EXISTS warrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warrant_number TEXT UNIQUE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  subject_name TEXT,
  subject_dob TEXT,
  offense TEXT,
  court TEXT,
  judge TEXT,
  bond_amount REAL,
  issued_date TEXT,
  expiry_date TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), archived_at TEXT, subject_first_name TEXT, subject_last_name TEXT, warrant_type TEXT, source TEXT DEFAULT 'manual', priority TEXT DEFAULT 'P3', issuing_agency TEXT, confirmed INTEGER DEFAULT 0, confirmed_at TEXT, confirmed_by INTEGER, notes TEXT, subject_person_id INTEGER, offense_description TEXT, bond_type TEXT, extradition_limit TEXT, service_date TEXT, served_by INTEGER, return_date TEXT, notification_sent INTEGER DEFAULT 0, entered_by INTEGER, last_checked_at TEXT, check_frequency_hours INTEGER DEFAULT 24, last_check_result TEXT, scraped_source TEXT, scraped_raw TEXT, statute_id INTEGER, statute_citation TEXT, external_warrant_id TEXT, external_source_key TEXT, auto_created INTEGER, issuing_court TEXT, issuing_judge TEXT, charge_description TEXT, bail_amount REAL, offense_level TEXT, expires_at TEXT, served_at TEXT, priority_score INTEGER, person_id INTEGER, severity TEXT, description TEXT, served_location TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS migration_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  last_migrated_at TEXT
);
CREATE TABLE IF NOT EXISTS call_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  person_type TEXT DEFAULT 'subject',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), role TEXT DEFAULT 'subject', notes TEXT, added_by INTEGER, added_at TEXT,
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
  FOREIGN KEY (person_id) REFERENCES persons(id)
);
CREATE TABLE IF NOT EXISTS call_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  vehicle_role TEXT DEFAULT 'involved',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), role TEXT DEFAULT 'subject', notes TEXT, added_by INTEGER, added_at TEXT,
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id)
);
CREATE TABLE IF NOT EXISTS citations (id INTEGER PRIMARY KEY AUTOINCREMENT, citation_number TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')), citation_date TEXT, location_address TEXT, latitude REAL, longitude REAL, officer_id INTEGER, person_id INTEGER, vehicle_plate TEXT, vehicle_state TEXT, vehicle_make TEXT, vehicle_model TEXT, vehicle_color TEXT, vehicle_year INTEGER, speed_limit INTEGER, speed_clocked INTEGER, speed_device TEXT, zone_beat TEXT, fine_amount REAL, court_date TEXT, court_location TEXT, status TEXT, disposition TEXT, notes TEXT, violation_code TEXT, violation_description TEXT, type TEXT, violation_date TEXT, section_id TEXT, sector_id TEXT, zone_id TEXT, beat_id TEXT, vehicle_vin TEXT, vehicle_id INTEGER, speed_recorded INTEGER, radar_type TEXT, bac_level REAL, bond_amount REAL, bond_type TEXT, is_warning INTEGER, is_equipment_violation INTEGER, weather_conditions TEXT, road_conditions TEXT, accident_related INTEGER, dui_related INTEGER, school_zone INTEGER, construction_zone INTEGER, commercial_vehicle INTEGER, hazmat INTEGER, voided_reason TEXT, voided_by INTEGER, voided_at TEXT, court_time TEXT, court_room TEXT, appearance_required INTEGER, plea TEXT, verdict TEXT, sentence TEXT, disposition_date TEXT, case_id INTEGER, person_name TEXT, person_dob TEXT, person_dl TEXT, person_address TEXT, vehicle_description TEXT, statute_id INTEGER, statute_citation TEXT, offense_level TEXT, violation_time TEXT, location TEXT, incident_id INTEGER, call_id INTEGER, issuing_officer_id INTEGER, issuing_officer_name TEXT, badge_number TEXT, court_name TEXT, court_address TEXT, violation TEXT, violator_name TEXT);
CREATE TABLE IF NOT EXISTS court_events (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), continuance_count INTEGER, defendant_dob TEXT, bail_amount REAL, bond_status TEXT, surety_info TEXT, judge_notes TEXT, prosecutor_phone TEXT, prosecutor_email TEXT, event_number TEXT, event_type TEXT, status TEXT, event_date TEXT, event_time TEXT, court_name TEXT, courtroom TEXT, judge_name TEXT, court_case_number TEXT, citation_id INTEGER, incident_id INTEGER, case_id INTEGER, defendant_person_id INTEGER, defendant_name TEXT, prosecutor TEXT, defense_attorney TEXT, officers_required TEXT, notes TEXT, created_by INTEGER, updated_at TEXT, outcome TEXT, sentence TEXT, fine_amount REAL, continuance_log TEXT, officer_confirmations TEXT, documents TEXT, court_fees TEXT, witnesses TEXT, verdict_data TEXT);
CREATE TABLE IF NOT EXISTS offender_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), alert_latitude REAL, alert_longitude REAL, alert_address TEXT, alert_enabled INTEGER, person_id INTEGER, alert_type TEXT, status TEXT, severity TEXT, description TEXT, last_compliance_check TEXT, last_compliance_result TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS warrant_scraper_config (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), source_name TEXT, last_run_at TEXT, last_error TEXT, source_type TEXT, priority INTEGER, content_hash TEXT, content_hash_updated_at TEXT, etag TEXT, last_modified TEXT, last_success_at TEXT, avg_parse_count REAL, p95_latency_ms INTEGER, jitter_seed INTEGER);
CREATE TABLE IF NOT EXISTS dispatch_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, description TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), category TEXT DEFAULT 'general', priority TEXT DEFAULT 'P3', color TEXT DEFAULT '#6b7280', requires_backup INTEGER DEFAULT 0, officer_safety INTEGER DEFAULT 0, ems_needed INTEGER DEFAULT 0, fire_needed INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, priority TEXT, title TEXT, message TEXT, entity_type TEXT, entity_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), user_id INTEGER, read_at TEXT, sender_id INTEGER, is_read INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS case_records (id INTEGER PRIMARY KEY AUTOINCREMENT, case_number TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS field_interviews (id INTEGER PRIMARY KEY AUTOINCREMENT, interview_date TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), date TEXT, gang_affiliation TEXT, section_id INTEGER, zone_id INTEGER, beat_id INTEGER, zone_beat TEXT, updated_at TEXT, fi_number TEXT, officer_id INTEGER, person_id INTEGER, vehicle_id INTEGER, location TEXT, latitude REAL, longitude REAL, contact_reason TEXT, contact_type TEXT, action_taken TEXT, narrative TEXT, subject_first_name TEXT, subject_last_name TEXT, subject_dob TEXT, subject_gender TEXT, subject_race TEXT, subject_height TEXT, subject_weight TEXT, subject_hair TEXT, subject_eye TEXT, subject_clothing TEXT, subject_description TEXT, vehicle_plate TEXT, vehicle_description TEXT, associated_call_id INTEGER, associated_incident_id INTEGER, archived_at TEXT, disposition TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS trespass_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), subject_photo_url TEXT, order_number TEXT, status TEXT, person_id INTEGER, subject_first_name TEXT, subject_last_name TEXT, subject_dob TEXT, subject_description TEXT, subject_name TEXT, property_id INTEGER, property_name TEXT, property_address TEXT, location TEXT, order_type TEXT, reason TEXT, conditions TEXT, duration_days INTEGER, effective_date TEXT, expiration_date TEXT, originating_call_id INTEGER, originating_incident_id INTEGER, issued_by INTEGER, issued_by_name TEXT, authorized_by TEXT, notes TEXT, section_id INTEGER, sector_id INTEGER, zone_id INTEGER, beat_id INTEGER, zone_beat TEXT, served_at TEXT, served_by INTEGER, updated_at TEXT, archived_at TEXT);
CREATE TABLE IF NOT EXISTS use_of_force (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS serve_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), recipient_person_id INTEGER, property_id INTEGER, client_id INTEGER, case_number TEXT, defendant_name TEXT, plaintiff_name TEXT, defendant_address TEXT, defendant_city TEXT, defendant_state TEXT, defendant_zip TEXT, instructions TEXT, document_text TEXT, parsed_data TEXT, status TEXT DEFAULT 'pending', assigned_officer_id INTEGER, created_by INTEGER, updated_at TEXT, sm_job_id INTEGER, officer_id INTEGER, call_id INTEGER, serve_date TEXT, recipient_name TEXT, recipient_address TEXT, recipient_city TEXT, recipient_state TEXT, recipient_zip TEXT, recipient_lat REAL, recipient_lng REAL, document_type TEXT, court_name TEXT, jurisdiction TEXT, client_name TEXT, attorney_name TEXT, priority TEXT, time_window TEXT, deadline TEXT, max_attempts INTEGER, service_instructions TEXT, notes TEXT, attempt_count INTEGER, sort_order INTEGER, court_date TEXT);
CREATE TABLE IF NOT EXISTS serve_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), serve_queue_id INTEGER, attempt_number INTEGER DEFAULT 1, attempt_at TEXT, officer_id INTEGER, result TEXT, latitude REAL, longitude REAL, notes TEXT, attempt_type TEXT, photo_ids TEXT, signature_data TEXT);
CREATE TABLE IF NOT EXISTS serve_routes (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), officer_id INTEGER, route_date TEXT, optimized_order_json TEXT, waypoints_json TEXT, total_distance_miles REAL, total_time_minutes REAL, start_lat REAL, start_lng REAL, end_lat REAL, end_lng REAL, notes TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), user_id INTEGER, action TEXT, entity_type TEXT, entity_id TEXT, details TEXT, ip_address TEXT);
CREATE TABLE IF NOT EXISTS patrol_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS patrol_incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS invoice_items (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS invoice_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS serve_skip_traces (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')), serve_queue_id INTEGER, searched_at TEXT, search_type TEXT, search_query TEXT, results_json TEXT, addresses_found_json TEXT, searched_by INTEGER);
CREATE TABLE IF NOT EXISTS geofences (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS dispatch_areas (id INTEGER PRIMARY KEY AUTOINCREMENT, area_code TEXT NOT NULL, name TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), sort_order INTEGER DEFAULT 0, description TEXT, color TEXT, area_name TEXT, commander TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS dispatch_sectors (id INTEGER PRIMARY KEY AUTOINCREMENT, sector_code TEXT NOT NULL, area_id INTEGER, name TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), sort_order INTEGER DEFAULT 0, description TEXT, color TEXT, county_nbr TEXT, fips_code TEXT, supervisor TEXT, radio_channel TEXT, active INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now','localtime')), sector_name TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS dispatch_zones (id INTEGER PRIMARY KEY AUTOINCREMENT, zone_code TEXT NOT NULL, sector_id INTEGER, name TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), sort_order INTEGER DEFAULT 0, description TEXT, color TEXT, ugrc_code TEXT, zone_type TEXT, primary_unit TEXT, backup_unit TEXT, radio_channel TEXT, hazard_notes TEXT, population_estimate INTEGER, sq_miles REAL, active INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now','localtime')), zone_name TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS dispatch_beats (id INTEGER PRIMARY KEY AUTOINCREMENT, beat_code TEXT NOT NULL, zone_id INTEGER, name TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), sort_order INTEGER DEFAULT 0, description TEXT, geometry TEXT, color TEXT, district_letter TEXT, beat_number INTEGER, beat_descriptor TEXT, dispatch_code TEXT, assigned_unit TEXT, backup_unit TEXT, hazard_notes TEXT, premise_alerts TEXT DEFAULT '[]', patrol_frequency TEXT DEFAULT 'normal', priority_modifier INTEGER DEFAULT 0, population_estimate INTEGER, sq_miles REAL, min_lat REAL, max_lat REAL, min_lng REAL, max_lng REAL, notes TEXT, active INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now','localtime')), beat_name TEXT);
CREATE TABLE IF NOT EXISTS fleet_vehicles (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_name TEXT, make TEXT, model TEXT, year INTEGER, vin TEXT, plate_number TEXT, status TEXT DEFAULT 'active', vehicle_type TEXT, assigned_unit_id INTEGER, next_service_mileage INTEGER, next_service_date TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')), total_maintenance_cost REAL, total_fuel_cost REAL, total_trips INTEGER, avg_mpg REAL, vehicle_number TEXT, current_mileage INTEGER, next_service_due TEXT, color TEXT, plate_state TEXT, last_service_date TEXT, insurance_expiry TEXT, registration_expiry TEXT, equipment TEXT, notes TEXT, archived_at TEXT, msrp REAL, title_number TEXT, title_state TEXT, title_status TEXT, lienholder TEXT, acquisition_method TEXT, acquisition_date TEXT, purchase_date TEXT, purchase_price REAL, purchase_vendor TEXT, purchase_order_number TEXT, funding_source TEXT, grant_number TEXT, lease_company TEXT, lease_start_date TEXT, lease_end_date TEXT, lease_monthly_payment REAL, lease_mileage_cap INTEGER, asset_tag TEXT, cost_center TEXT, in_service_date TEXT, expected_retirement_date TEXT, expected_retirement_mileage INTEGER, replacement_cycle_months INTEGER, warranty_provider TEXT, warranty_expiry_date TEXT, warranty_miles INTEGER, emissions_due_date TEXT, usage_class TEXT, is_pursuit_rated INTEGER DEFAULT 0, is_take_home INTEGER DEFAULT 0, garage_location TEXT);
CREATE TABLE IF NOT EXISTS fleet_maintenance (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, service_type TEXT, service_date TEXT, cost REAL, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), labor_cost REAL, service_tasks TEXT, type TEXT, description TEXT, mileage_at_service TEXT, vendor TEXT, performed_by TEXT, performed_at TEXT, next_due_date TEXT, next_due_mileage INTEGER);
CREATE TABLE IF NOT EXISTS fleet_fuel_log (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, fuel_date TEXT, gallons REAL, cost REAL, odometer INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), cost_per_gallon REAL, fuel_type TEXT, station TEXT, total_cost REAL, notes TEXT, is_full_tank INTEGER DEFAULT 1, payment_method TEXT, driver_name TEXT, location TEXT, mpg REAL);
CREATE TABLE IF NOT EXISTS fleet_inspections (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, inspection_date TEXT, inspector TEXT, passed INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), overall_result TEXT, inspector_id INTEGER, mileage_at_inspection TEXT, inspection_type TEXT, checklist TEXT);
CREATE TABLE IF NOT EXISTS incident_offenses (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id INTEGER NOT NULL, offense_code TEXT NOT NULL, statute_id INTEGER, description TEXT NOT NULL, offense_date TEXT, offense_level TEXT, ucr_code TEXT, nibrs_code TEXT, attempted_completed TEXT DEFAULT 'completed', counts INTEGER DEFAULT 1, weapon_force TEXT, notes TEXT, created_by INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS incident_officers (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id INTEGER NOT NULL, officer_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'responding', arrived_at TEXT, departed_at TEXT, action_taken TEXT, notes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS citation_violations (id INTEGER PRIMARY KEY AUTOINCREMENT, citation_id INTEGER NOT NULL, violation_code TEXT NOT NULL, description TEXT, fine_amount REAL, points INTEGER);
CREATE TABLE IF NOT EXISTS arrest_records (id INTEGER PRIMARY KEY AUTOINCREMENT, jailbase_id TEXT, source_id TEXT, source_name TEXT, full_name TEXT, first_name TEXT, last_name TEXT, middle_name TEXT, date_of_birth TEXT, booking_date TEXT, charges TEXT, mugshot_url TEXT, details_url TEXT, county TEXT, status TEXT DEFAULT 'active', raw_record TEXT, fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), entry_source TEXT, entered_by INTEGER, address TEXT, gender TEXT, race TEXT, height TEXT, weight TEXT, hair_color TEXT, eye_color TEXT, agency TEXT, state TEXT, release_date TEXT, hold_reason TEXT, bail_amount REAL, notes TEXT, booking_number TEXT, booking_checklist TEXT, property_inventory TEXT, miranda_data TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS supplemental_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, report_number TEXT, incident_id INTEGER NOT NULL, author_id INTEGER NOT NULL, report_type TEXT NOT NULL DEFAULT 'supplemental', content TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), subject TEXT, status TEXT DEFAULT 'draft', updated_at TEXT);
CREATE TABLE IF NOT EXISTS call_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, incident_type TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'P3', description_template TEXT, default_notes TEXT, source TEXT NOT NULL DEFAULT 'dispatch', is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS fleet_fuel_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER NOT NULL, fuel_date TEXT NOT NULL, gallons REAL NOT NULL, cost_per_gallon REAL, total_cost REAL, odometer_reading INTEGER, fuel_type TEXT NOT NULL DEFAULT 'regular', distance REAL, efficiency REAL);
CREATE TABLE IF NOT EXISTS call_visit_history (id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER NOT NULL, property_id INTEGER, visit_date TEXT NOT NULL, officer_id INTEGER, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS panic_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER NOT NULL, latitude REAL, longitude REAL, status TEXT NOT NULL DEFAULT 'active', acknowledged_by INTEGER, acknowledged_at TEXT, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), user_id INTEGER, call_id INTEGER, trigger_method TEXT NOT NULL DEFAULT 'ui_button', message TEXT, location_address TEXT, audio_file_id TEXT, audio_duration_seconds INTEGER, escalation_level INTEGER DEFAULT 0, resolved_by INTEGER, resolution_notes TEXT, responder_unit_ids TEXT DEFAULT '[]', updated_at TEXT);
CREATE TABLE IF NOT EXISTS speed_violations (id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER NOT NULL, officer_id INTEGER, latitude REAL, longitude REAL, speed_mph REAL NOT NULL, speed_limit_mph REAL, road_name TEXT, recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), acknowledged INTEGER DEFAULT 0, call_sign TEXT, officer_name TEXT, badge_number TEXT, speed_mps REAL, overage_mph REAL, nearest_intersection TEXT, beat_id INTEGER, zone_id INTEGER, duration_seconds INTEGER DEFAULT 0, current_call_id INTEGER, current_call_number TEXT, acknowledged_by INTEGER, acknowledged_at TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS cases (id INTEGER PRIMARY KEY AUTOINCREMENT, case_number TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'open', priority TEXT DEFAULT 'normal', assigned_to INTEGER, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT, deadline TEXT, sla_hours INTEGER, case_type TEXT, lead_investigator_id INTEGER, summary TEXT, narrative TEXT, disposition TEXT, disposition_date TEXT, due_date TEXT, opened_date TEXT, closed_date TEXT, archived_at TEXT, assigned_at TEXT, assigned_officers TEXT, solvability_score REAL, solvability_factors TEXT, approval_status TEXT, approved_by INTEGER, approved_at TEXT, return_reason TEXT, linked_calls TEXT, linked_persons TEXT, linked_incidents TEXT, linked_evidence TEXT, linked_citations TEXT, linked_field_interviews TEXT);
CREATE TABLE IF NOT EXISTS equipment_checkout_log (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER NOT NULL, officer_id INTEGER NOT NULL, checkout_date TEXT NOT NULL, return_date TEXT, condition_at_checkout TEXT, condition_at_return TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), equipment_name TEXT, action TEXT, condition_notes TEXT, checked_by INTEGER);
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
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), user_id INTEGER, content TEXT,
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), training_type TEXT, expiration_date TEXT,
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
    , required_for_role TEXT, is_active INTEGER DEFAULT 1);
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), incident_id INTEGER, unit_id INTEGER, speed_mph REAL, latitude REAL, longitude REAL, address TEXT, source TEXT, burn_status TEXT,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), unit_number TEXT,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), start_time TEXT,
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
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), timestamp TEXT,
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
    , run_id INTEGER);
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
    , is_active INTEGER NOT NULL DEFAULT 1, first_seen_at TEXT, last_seen_at TEXT, person_id INTEGER, source TEXT NOT NULL DEFAULT 'utah-warrant-watch');
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
    , middle_name TEXT, age INTEGER, gender TEXT, race TEXT, city TEXT, state TEXT, photo_url TEXT, detail_url TEXT, first_seen_at TEXT, last_seen_at TEXT, cleared_at TEXT, dob_verified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS email_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, conditions TEXT NOT NULL, actions TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), owner_user_id INTEGER, updated_at TEXT);
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
CREATE TABLE IF NOT EXISTS email_cache (id INTEGER PRIMARY KEY AUTOINCREMENT, cache_key TEXT UNIQUE NOT NULL, data TEXT, expires_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), owner_user_id INTEGER);
CREATE TABLE IF NOT EXISTS warrant_service_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warrant_id INTEGER NOT NULL,
  attempted_by INTEGER NOT NULL,
  attempted_at TEXT NOT NULL,
  location TEXT,
  method TEXT DEFAULT 'in_person',
  result TEXT DEFAULT 'unsuccessful',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS shift_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'day',
  assignments TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS call_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  assigned_at TEXT DEFAULT (datetime('now','localtime')),
  unassigned_at TEXT
);
CREATE TABLE IF NOT EXISTS password_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS trusted_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_name TEXT,
  ip_address TEXT,
  trusted_until TEXT,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS security_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  device_info TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS user_security_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  question_1 TEXT NOT NULL,
  answer_1_hash TEXT NOT NULL,
  question_2 TEXT NOT NULL,
  answer_2_hash TEXT NOT NULL,
  question_3 TEXT NOT NULL,
  answer_3_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS serve_queue_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'defendant',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (serve_queue_id) REFERENCES serve_queue(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS integration_api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  scopes TEXT NOT NULL DEFAULT '["service_request"]',
  last_used_at TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
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
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
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
  supervisor_notified INTEGER DEFAULT 0,
  le_notified INTEGER DEFAULT 0,
  le_agency TEXT,
  le_case_number TEXT,
  damage_estimate REAL,
  damage_description TEXT,
  action_taken TEXT,
  updated_at TEXT,
  received_at TEXT,
  previous_status TEXT,
  client_id INTEGER,
  reporting_officer_id INTEGER,
  priority_score INTEGER DEFAULT 0,
  weapons_involved TEXT DEFAULT NULL,
  domestic_violence INTEGER DEFAULT 0,
  injuries_reported INTEGER DEFAULT 0,
  alcohol_involved INTEGER DEFAULT 0,
  drugs_involved INTEGER DEFAULT 0,
  archived_at TEXT,
  status_changed_at TEXT,
  caller_address TEXT,
  zone_beat TEXT,
  sector_id TEXT,
  zone_id TEXT,
  beat_id TEXT,
  cross_street TEXT,
  location_building TEXT,
  location_floor TEXT,
  location_room TEXT,
  num_subjects INTEGER,
  subject_description TEXT,
  vehicle_description TEXT,
  direction_of_travel TEXT,
  responding_officer TEXT,
  secondary_type TEXT,
  contact_method TEXT,
  scene_safety TEXT,
  weather_conditions TEXT,
  lighting_conditions TEXT,
  num_victims INTEGER,
  starting_mileage REAL,
  ending_mileage REAL,
  case_id INTEGER,
  case_number TEXT,
  dispatch_code TEXT,
  section_name TEXT,
  sector_name TEXT,
  zone_name TEXT,
  beat_name TEXT,
  beat_descriptor TEXT,
  contract_id TEXT,
  response_time_seconds REAL,
  onscene_duration_seconds REAL,
  overdue_notified TEXT,
  pso_requestor_name TEXT,
  pso_requestor_phone TEXT,
  pso_requestor_email TEXT,
  pso_service_type TEXT,
  pso_billing_code TEXT,
  pso_authorization TEXT,
  pso_attempt_number INTEGER,
  pso_service_windows TEXT,
  process_service_type TEXT,
  process_served_to TEXT,
  process_served_address TEXT,
  process_attempts INTEGER,
  process_served_at TEXT,
  process_service_result TEXT, unit_call_signs TEXT, responding_vehicle_id INTEGER, mental_health_crisis INTEGER DEFAULT 0, juvenile_involved INTEGER DEFAULT 0, felony_in_progress INTEGER DEFAULT 0, officer_safety_caution INTEGER DEFAULT 0, k9_requested INTEGER DEFAULT 0, ems_requested INTEGER DEFAULT 0,
  FOREIGN KEY (dispatcher_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS code_violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  violation_number TEXT,
  violation_type TEXT,
  status TEXT,
  priority TEXT,
  severity TEXT,
  location TEXT,
  property_id INTEGER,
  person_id INTEGER,
  violator_name TEXT,
  violator_contact TEXT,
  description TEXT,
  code_section TEXT,
  compliance_deadline TEXT,
  fine_amount REAL,
  amount_paid REAL,
  payment_history TEXT,
  reporting_officer_id INTEGER,
  reporting_officer_name TEXT,
  reported_by TEXT,
  assigned_officer TEXT,
  resolved_date TEXT,
  resolution_notes TEXT,
  escalation_level TEXT,
  escalation_history TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS vehicle_tows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tow_number TEXT,
  status TEXT,
  vehicle_plate TEXT,
  vehicle_state TEXT,
  vehicle_vin TEXT,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  vehicle_id INTEGER,
  tow_from TEXT,
  tow_to TEXT,
  tow_reason TEXT,
  authorization TEXT,
  tow_company TEXT,
  tow_driver TEXT,
  tow_company_phone TEXT,
  call_id INTEGER,
  citation_id INTEGER,
  incident_id INTEGER,
  tow_fee REAL,
  storage_fee_daily REAL,
  officer_id INTEGER,
  officer_name TEXT,
  notes TEXT,
  ordered_at TEXT,
  dispatched_at TEXT,
  completed_at TEXT,
  released_at TEXT,
  released_to TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS daily_activity_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dar_number TEXT,
  status TEXT,
  officer_id INTEGER,
  officer_name TEXT,
  shift_date TEXT,
  shift_start TEXT,
  shift_end TEXT,
  property_id INTEGER,
  property_name TEXT,
  post_assignment TEXT,
  calls_handled TEXT,
  incidents_created TEXT,
  citations_issued TEXT,
  patrols_completed TEXT,
  activities_narrative TEXT,
  notable_events TEXT,
  equipment_issues TEXT,
  safety_concerns TEXT,
  recommendations TEXT,
  submitted_at TEXT,
  reviewed_by INTEGER,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS howen_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  imei TEXT,
  iccid TEXT,
  label TEXT,
  unit_id INTEGER,
  vehicle_id INTEGER,
  plate_number TEXT,
  is_active INTEGER DEFAULT 1,
  last_connection_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS howen_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  event_type TEXT,
  severity TEXT,
  event_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS performance_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER,
  reviewer_id INTEGER,
  review_period_start TEXT,
  review_period_end TEXT,
  review_date TEXT,
  type TEXT,
  overall_rating REAL,
  categories TEXT,
  strengths TEXT,
  areas_for_improvement TEXT,
  goals TEXT,
  status TEXT,
  officer_comments TEXT,
  acknowledged_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hr_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER,
  reviewer_id INTEGER,
  review_type TEXT,
  review_date TEXT,
  status TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL,
  requester_name TEXT,
  target_id INTEGER,
  target_name TEXT,
  plan_id TEXT,
  shift_date TEXT NOT NULL,
  original_shift TEXT,
  requested_shift TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forensic_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_number TEXT,
  case_type TEXT,
  status TEXT,
  priority TEXT,
  title TEXT,
  description TEXT,
  requesting_agency TEXT,
  requesting_officer TEXT,
  lead_examiner_id INTEGER,
  linked_incident_id INTEGER,
  linked_case_id INTEGER,
  linked_incident_number TEXT,
  linked_case_number TEXT,
  received_date TEXT,
  due_date TEXT,
  completed_date TEXT,
  released_date TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS forensic_exhibits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER,
  exhibit_number TEXT,
  exhibit_type TEXT,
  evidence_type TEXT,
  description TEXT,
  quantity INTEGER,
  condition_received TEXT,
  condition_on_receipt TEXT,
  packaging_type TEXT,
  packaging_sealed INTEGER,
  storage_location TEXT,
  storage_temp TEXT,
  storage_requirements TEXT,
  device_make TEXT,
  device_model TEXT,
  device_serial TEXT,
  collected_by TEXT,
  collected_date TEXT,
  collected_location TEXT,
  collection_method TEXT,
  received_from TEXT,
  hash_md5 TEXT,
  hash_sha256 TEXT,
  chain_of_custody TEXT,
  is_hazardous INTEGER,
  is_biohazard INTEGER,
  examination_requested TEXT,
  disposition TEXT,
  disposition_date TEXT,
  disposition_notes TEXT,
  status TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS forensic_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER,
  exhibit_id INTEGER,
  analysis_type TEXT,
  methodology TEXT,
  equipment_used TEXT,
  examiner_id INTEGER,
  status TEXT,
  started_at TEXT,
  completed_at TEXT,
  results TEXT,
  conclusion TEXT,
  limitations TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS forensic_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forensic_case_id INTEGER,
  action TEXT,
  performed_by INTEGER,
  performed_by_name TEXT,
  performed_at TEXT,
  details TEXT,
  created_at TEXT
, exhibit_id INTEGER);
CREATE TABLE IF NOT EXISTS criminal_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  record_type TEXT,
  offense TEXT NOT NULL,
  offense_level TEXT,
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
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS client_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  relationship TEXT DEFAULT 'contact',
  title TEXT,
  notes TEXT,
  is_primary INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(client_id, person_id)
);
CREATE TABLE IF NOT EXISTS record_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship TEXT DEFAULT 'associated',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(source_type, source_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS cpgps_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_type TEXT,
  status TEXT,
  records_fetched INTEGER,
  records_stored INTEGER,
  error_message TEXT,
  started_at TEXT DEFAULT (datetime('now','localtime')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS sm_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_type TEXT,
  status TEXT,
  jobs_synced INTEGER,
  attempts_synced INTEGER,
  error_message TEXT,
  started_at TEXT DEFAULT (datetime('now','localtime')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS sm_jobs (
  id TEXT PRIMARY KEY,
  sm_job_number TEXT,
  job_status TEXT,
  service_status TEXT,
  client_job_number TEXT,
  rush INTEGER,
  due_date TEXT,
  service_instructions TEXT,
  recipient_name TEXT,
  recipient_description TEXT,
  client_company_name TEXT,
  client_company_id TEXT,
  process_server_name TEXT,
  employee_process_server_id TEXT,
  court_case_number TEXT,
  court_case_id TEXT,
  attempt_count INTEGER,
  last_attempt_at TEXT,
  addresses_json TEXT,
  documents_json TEXT,
  archived_at TEXT,
  sm_created_at TEXT,
  sm_updated_at TEXT,
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS sm_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  description TEXT,
  success INTEGER,
  service_status TEXT,
  serve_type TEXT,
  served_at TEXT,
  lat REAL,
  lng REAL,
  gps_timestamp TEXT,
  server_name TEXT,
  recipient_name TEXT,
  attachments_json TEXT,
  sm_created_at TEXT,
  sm_updated_at TEXT,
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS calls_for_service_ext (
  id INTEGER PRIMARY KEY,
  pso_requestor_name TEXT,
  pso_requestor_phone TEXT,
  pso_requestor_email TEXT,
  pso_service_type TEXT,
  pso_billing_code TEXT,
  pso_authorization TEXT,
  pso_72hr_deadline TEXT,
  pso_72hr_notified TEXT,
  pso_service_windows TEXT,
  pso_attempt_number INTEGER DEFAULT 1,
  process_service_type TEXT,
  process_served_to TEXT,
  process_served_address TEXT,
  process_attempts INTEGER DEFAULT 0,
  process_served_at TEXT,
  process_service_result TEXT, fire_requested INTEGER DEFAULT 0, hazmat INTEGER DEFAULT 0, gang_related INTEGER DEFAULT 0, evidence_collected INTEGER DEFAULT 0, body_camera_active INTEGER DEFAULT 0, photos_taken INTEGER DEFAULT 0, trespass_issued INTEGER DEFAULT 0, vehicle_pursuit INTEGER DEFAULT 0, foot_pursuit INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, run_card_id INTEGER, run_card_applied_at TEXT, held_at TEXT, parent_call_id INTEGER, area_code TEXT, area_name TEXT,
  FOREIGN KEY (id) REFERENCES calls_for_service(id) ON DELETE CASCADE
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
  citation_fine REAL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  hours_requested REAL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  denial_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disciplinary_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  severity TEXT,
  incident_date TEXT,
  description TEXT,
  action_taken TEXT,
  follow_up_date TEXT,
  follow_up_notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  issued_by INTEGER,
  witness TEXT,
  attachments TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS radio_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT,
  talkgroup TEXT,
  color TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS radio_transmissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER REFERENCES radio_channels(id),
  user_id INTEGER REFERENCES users(id),
  unit_label TEXT,
  transmitted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  duration_seconds REAL NOT NULL DEFAULT 0,
  transcript TEXT,
  audio_url TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  call_id INTEGER REFERENCES calls_for_service(id)
);
CREATE TABLE IF NOT EXISTS radio_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transmission_id INTEGER NOT NULL REFERENCES radio_transmissions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT,
  notes TEXT,
  color TEXT,
  bookmark_seconds REAL,
  loop_start_seconds REAL,
  loop_end_seconds REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS nibrs_offense_codes (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  ucr_group TEXT NOT NULL DEFAULT 'A',
  category TEXT NOT NULL,
  attempted_completed_required INTEGER NOT NULL DEFAULT 0,
  victim_required INTEGER NOT NULL DEFAULT 0,
  weapon_required INTEGER NOT NULL DEFAULT 0,
  bias_required INTEGER NOT NULL DEFAULT 0,
  property_required INTEGER NOT NULL DEFAULT 0,
  drug_required INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS nibrs_location_codes (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_weapon_codes (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_bias_codes (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_property_descriptions (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_property_loss_types (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dba_name TEXT,
  business_type TEXT,
  ein TEXT,
  license_number TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  industry TEXT,
  employee_count TEXT,
  notes TEXT,
  archived_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS business_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'other',
  notes TEXT,
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id) ON DELETE CASCADE,
  UNIQUE(business_id, vehicle_id)
);
CREATE TABLE IF NOT EXISTS business_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  officer_id INTEGER NOT NULL,
  latitude REAL,
  longitude REAL,
  notes TEXT,
  visit_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (officer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS business_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  caption TEXT,
  category TEXT CHECK(category IN ('storefront','interior','exterior','parking','other')),
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS call_businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  business_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'involved',
  notes TEXT,
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  UNIQUE(call_id, business_id, role)
);
CREATE TABLE IF NOT EXISTS document_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  folder_path TEXT NOT NULL UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_id) REFERENCES document_folders(id) ON DELETE CASCADE,
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
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS case_person_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  relationship TEXT DEFAULT 'linked',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(case_id, person_id),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS patrol_breaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  shift_date TEXT NOT NULL,
  break_start TEXT NOT NULL,
  break_end TEXT,
  break_type TEXT NOT NULL DEFAULT 'break' CHECK(break_type IN ('break','meal','rest')),
  duration_minutes REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS patrol_tour_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  tour_date TEXT NOT NULL,
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','rejected','pending')),
  notes TEXT,
  total_scans INTEGER NOT NULL DEFAULT 0,
  on_time_scans INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(officer_id, tour_date)
);
CREATE TABLE IF NOT EXISTS dispatch_run_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  default_priority TEXT NOT NULL DEFAULT 'P3',
  required_units INTEGER NOT NULL DEFAULT 1,
  backup_units INTEGER NOT NULL DEFAULT 0,
  required_roles TEXT NOT NULL DEFAULT '[]',
  auto_flags TEXT NOT NULL DEFAULT '{}',
  recommended_codes TEXT NOT NULL DEFAULT '[]',
  officer_safety_alert INTEGER NOT NULL DEFAULT 0,
  silent_response_default INTEGER NOT NULL DEFAULT 0,
  ems_requested INTEGER NOT NULL DEFAULT 0,
  fire_requested INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS arrest_cross_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arrest_record_id INTEGER NOT NULL,
  linked_type TEXT NOT NULL,
  linked_id INTEGER NOT NULL,
  match_type TEXT,
  match_confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (arrest_record_id) REFERENCES arrest_records(id) ON DELETE CASCADE,
  UNIQUE(arrest_record_id, linked_type, linked_id)
);
CREATE TABLE IF NOT EXISTS incident_links (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id INTEGER NOT NULL, linked_type TEXT NOT NULL CHECK(linked_type IN ('incident','call','case','warrant','citation','arrest','field_interview')), linked_id INTEGER NOT NULL, link_reason TEXT, added_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(incident_id, linked_type, linked_id));
CREATE TABLE IF NOT EXISTS case_persons (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, person_id INTEGER, person_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'involved', notes TEXT, added_by INTEGER, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS case_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, call_id INTEGER NOT NULL, added_by INTEGER, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE, FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE, UNIQUE(case_id, call_id));
CREATE TABLE IF NOT EXISTS case_incidents (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, incident_id INTEGER NOT NULL, added_by INTEGER, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE, FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE, UNIQUE(case_id, incident_id));
CREATE TABLE IF NOT EXISTS case_vehicles (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, vehicle_id INTEGER NOT NULL, role TEXT DEFAULT 'involved', notes TEXT, added_by INTEGER, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE, UNIQUE(case_id, vehicle_id));
CREATE TABLE IF NOT EXISTS case_properties (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, property_id INTEGER NOT NULL, role TEXT DEFAULT 'scene', added_by INTEGER, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE, FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE, UNIQUE(case_id, property_id));
CREATE TABLE IF NOT EXISTS case_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, evidence_id INTEGER NOT NULL, added_by INTEGER, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE, UNIQUE(case_id, evidence_id));
CREATE TABLE IF NOT EXISTS case_warrants (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, warrant_id INTEGER NOT NULL, added_by INTEGER, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE, UNIQUE(case_id, warrant_id));
CREATE TABLE IF NOT EXISTS case_citations (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, citation_id INTEGER NOT NULL, added_by INTEGER, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE, UNIQUE(case_id, citation_id));
CREATE TABLE IF NOT EXISTS case_incident_links (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, incident_id INTEGER NOT NULL, relationship TEXT DEFAULT 'linked', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(case_id, incident_id), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE, FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS case_evidence_links (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, evidence_id INTEGER NOT NULL, relationship TEXT DEFAULT 'linked', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(case_id, evidence_id), FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE, FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS serve_intake_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER REFERENCES serve_queue(id) ON DELETE SET NULL,
  uploaded_by INTEGER REFERENCES users(id),
  file_name TEXT,
  file_type TEXT,                          
  r2_key TEXT,                             
  size_bytes INTEGER,
  page_count INTEGER,                      
  raw_text TEXT,                           
  ocr_used INTEGER NOT NULL DEFAULT 0,     
  ocr_engine TEXT,                         
  doc_type TEXT,                           
  fields_json TEXT,                        
  confidence REAL,                         
  extraction_model TEXT,                   
  extraction_ms INTEGER,                   
  status TEXT NOT NULL DEFAULT 'extracted' CHECK(status IN (
    'pending','extracting','extracted','failed','unmatched','archived'
  )),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS pso_qr_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  scans_used INTEGER NOT NULL DEFAULT 0,
  max_scans INTEGER NOT NULL DEFAULT 5,
  admin_override INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  last_scanned_at TEXT,
  last_scanned_by INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,          -- 'unassigned_call' | 'overdue_onscene' | …
  severity TEXT NOT NULL,            -- 'critical' | 'high' | 'medium' | 'low'
  title TEXT NOT NULL,
  details TEXT,
  zone_beat TEXT,                    -- beat label/id when the anomaly is location-scoped
  dedup_key TEXT,                    -- stable per live condition; drives upsert
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id       INTEGER PRIMARY KEY,
  settings_json TEXT    NOT NULL DEFAULT '{}',
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS org_settings (
  id            INTEGER PRIMARY KEY,   
  settings_json TEXT    NOT NULL DEFAULT '{}',
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inmates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_number TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  middle_name   TEXT,
  dob           TEXT,
  gender        TEXT,
  race          TEXT,
  height_inches INTEGER,
  weight_lbs    INTEGER,
  hair_color    TEXT,
  eye_color     TEXT,
  skin_tone     TEXT,
  marks_scars_tattoos TEXT,
  housing_unit  TEXT,
  housing_cell  TEXT,
  booking_date  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  arresting_agency TEXT,
  arresting_officer_id INTEGER,
  arrest_incident_id INTEGER,
  bail_amount   REAL,
  bond_type     TEXT,
  status        TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','housed','court','medical','released','transferred')),
  release_date  TEXT,
  release_reason TEXT,
  notes         TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS inmate_charges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  charge_description TEXT NOT NULL,
  statute_code  TEXT,
  offense_level TEXT,
  warrant_number TEXT,
  court_docket  TEXT,
  bond_amount   REAL,
  disposition   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS inmate_visitors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  visitor_name  TEXT NOT NULL,
  relationship  TEXT,
  visit_date    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  visit_type    TEXT DEFAULT 'in_person' CHECK(visit_type IN ('in_person','video','phone','attorney')),
  check_in      TEXT,
  check_out     TEXT,
  officer_id    INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS inmate_property (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  item_description TEXT NOT NULL,
  item_category TEXT,
  quantity      INTEGER DEFAULT 1,
  value_estimate REAL,
  stored_location TEXT,
  status        TEXT DEFAULT 'held' CHECK(status IN ('held','returned','transferred','destroyed')),
  returned_date TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS inmate_medical (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  screening_type TEXT NOT NULL,
  findings      TEXT,
  prescribed_med TEXT,
  allergies     TEXT,
  suicide_risk  INTEGER DEFAULT 0,
  cleared_for_booking INTEGER DEFAULT 1,
  screened_by TEXT,
  screened_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS inmate_disciplinary (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  violation     TEXT NOT NULL,
  violation_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reported_by   INTEGER,
  sanction      TEXT,
  hearing_date  TEXT,
  hearing_outcome TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS inmate_transports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inmate_id     INTEGER NOT NULL,
  destination   TEXT NOT NULL,
  reason        TEXT,
  depart_date   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  return_date   TEXT,
  transporting_officer_id INTEGER,
  vehicle_id    INTEGER,
  status        TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_transit','completed','cancelled')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ia_complaints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_number TEXT NOT NULL,
  complainant_name TEXT,
  complainant_contact TEXT,
  subject_officer_id INTEGER,
  complaint_type TEXT CHECK(complaint_type IN ('excessive_force','discourtesy','dishonesty','policy_violation','criminal','other')),
  description   TEXT NOT NULL,
  incident_date TEXT,
  incident_location TEXT,
  witnesses     TEXT,
  evidence_list TEXT,
  status        TEXT DEFAULT 'received' CHECK(status IN ('received','assigned','under_investigation','sustained','not_sustained','exonerated','unfounded','closed')),
  assigned_to   INTEGER,
  finding       TEXT,
  discipline    TEXT,
  closed_date   TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS ia_investigations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id  INTEGER NOT NULL,
  investigator_id INTEGER,
  started_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at  TEXT,
  summary       TEXT,
  findings      TEXT,
  recommendations TEXT,
  reviewed_by   INTEGER,
  reviewed_at   TEXT,
  status        TEXT DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','reviewed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS early_intervention_flags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id    INTEGER NOT NULL,
  flag_type     TEXT CHECK(flag_type IN ('use_of_force_frequency','complaint_threshold','sick_leave_pattern','pursuit_frequency','overtime_threshold','other')),
  trigger_value REAL,
  threshold     REAL,
  description   TEXT,
  flagged_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_at   TEXT,
  resolution    TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS asset_inventory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_tag     TEXT NOT NULL,
  asset_type    TEXT CHECK(asset_type IN ('weapon','body_camera','radio','taserr','computer','vehicle_accessory','uniform','ppe','k9_equipment','other')),
  make          TEXT,
  model         TEXT,
  serial_number TEXT,
  status        TEXT DEFAULT 'available' CHECK(status IN ('available','issued','maintenance','retired','lost')),
  assigned_to   INTEGER,
  issued_date   TEXT,
  return_date   TEXT,
  purchase_date TEXT,
  purchase_cost REAL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS asset_checkouts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      INTEGER NOT NULL,
  checked_out_to INTEGER NOT NULL,
  checkout_date TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expected_return TEXT,
  actual_return TEXT,
  condition_out TEXT,
  condition_in  TEXT,
  authorized_by INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS weapon_inventory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  weapon_type   TEXT CHECK(weapon_type IN ('handgun','shotgun','rifle','less_lethal','taser','baton','oc_spray','other')),
  make          TEXT,
  model         TEXT,
  caliber       TEXT,
  serial_number TEXT NOT NULL,
  status        TEXT DEFAULT 'armory' CHECK(status IN ('armory','issued','maintenance','destroyed','lost_stolen')),
  assigned_to   INTEGER,
  issued_date   TEXT,
  last_qualified TEXT,
  next_qual_due TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS ammunition_inventory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ammo_type     TEXT NOT NULL,
  caliber       TEXT NOT NULL,
  manufacturer  TEXT,
  lot_number    TEXT,
  quantity_rounds INTEGER NOT NULL DEFAULT 0,
  quantity_issued INTEGER DEFAULT 0,
  issued_to     INTEGER,
  issued_date   TEXT,
  expiration_date TEXT,
  storage_location TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS k9_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  k9_name       TEXT NOT NULL,
  breed         TEXT,
  handler_id    INTEGER,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','medical_leave','retired','deceased')),
  certified_date TEXT,
  cert_expiry   TEXT,
  specialties   TEXT,
  vet_last_visit TEXT,
  vet_next_due  TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS community_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name    TEXT NOT NULL,
  event_type    TEXT CHECK(event_type IN ('outreach','training','meeting','fundraiser','patrol_ride_along','other')),
  description   TEXT,
  location      TEXT,
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  organizer_id  INTEGER,
  attendees_count INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','cancelled')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS public_tips (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tip_number    TEXT NOT NULL,
  submitter_name TEXT,
  submitter_contact TEXT,
  is_anonymous  INTEGER DEFAULT 0,
  tip_text      TEXT NOT NULL,
  category      TEXT,
  location      TEXT,
  priority      TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
  status        TEXT DEFAULT 'new' CHECK(status IN ('new','assigned','under_review','actioned','closed','unfounded')),
  assigned_to   INTEGER,
  resolution    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS neighborhood_watch_groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name    TEXT NOT NULL,
  neighborhood  TEXT,
  beat_id       INTEGER,
  coordinator_name TEXT,
  coordinator_contact TEXT,
  member_count  INTEGER DEFAULT 0,
  last_meeting  TEXT,
  next_meeting  TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS community_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_title   TEXT NOT NULL,
  alert_text    TEXT NOT NULL,
  alert_type    TEXT CHECK(alert_type IN ('safety','crime','weather','missing_person','traffic','other')),
  severity      TEXT DEFAULT 'info' CHECK(severity IN ('info','warning','critical','emergency')),
  target_area   TEXT,
  target_beat_ids TEXT,
  sent_via_email INTEGER DEFAULT 0,
  sent_via_sms   INTEGER DEFAULT 0,
  sent_via_push  INTEGER DEFAULT 0,
  sent_at       TEXT,
  expires_at    TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS task_assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_title    TEXT NOT NULL,
  description   TEXT,
  task_type     TEXT DEFAULT 'general',
  priority      TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','review','completed','cancelled')),
  assigned_to   INTEGER,
  assigned_by   INTEGER,
  due_date      TEXT,
  completed_at  TEXT,
  linked_entity_type TEXT,
  linked_entity_id   INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS task_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  comment_text  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS notification_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_name TEXT NOT NULL,
  subject       TEXT,
  body          TEXT NOT NULL,
  channel       TEXT DEFAULT 'email' CHECK(channel IN ('email','sms','push','all')),
  category      TEXT DEFAULT 'general',
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS notification_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_name    TEXT,
  template_id   INTEGER,
  channel       TEXT,
  recipient_count INTEGER DEFAULT 0,
  sent_count    INTEGER DEFAULT 0,
  failed_count  INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','partial','failed')),
  sent_at       TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS notification_recipients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      INTEGER NOT NULL,
  recipient_name TEXT,
  contact       TEXT NOT NULL,
  channel       TEXT,
  status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  sent_at       TEXT,
  error_message TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS training_courses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_name   TEXT NOT NULL,
  course_code   TEXT,
  description   TEXT,
  category      TEXT CHECK(category IN ('firearms','defensive_tactics','legal','first_aid','de_escalation','professionalism','technical','other')),
  duration_hours REAL,
  instructor_id INTEGER,
  location      TEXT,
  max_seats     INTEGER,
  is_mandatory  INTEGER DEFAULT 0,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS training_enrollments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id     INTEGER NOT NULL,
  officer_id    INTEGER NOT NULL,
  status        TEXT DEFAULT 'enrolled' CHECK(status IN ('enrolled','attended','no_show','completed','failed')),
  score         REAL,
  completed_date TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS certification_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_name     TEXT NOT NULL,
  issuing_body  TEXT,
  description   TEXT,
  renewal_period_months INTEGER,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS officer_certifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id    INTEGER NOT NULL,
  cert_type_id  INTEGER NOT NULL,
  cert_number   TEXT,
  issued_date   TEXT,
  expiration_date TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','expired','revoked','pending')),
  document_url  TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS firearms_qualifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id    INTEGER NOT NULL,
  weapon_type   TEXT,
  course_name   TEXT,
  qualification_date TEXT NOT NULL,
  score         REAL,
  max_score     REAL DEFAULT 100,
  pass_fail     TEXT CHECK(pass_fail IN ('pass','fail')),
  range_officer_id INTEGER,
  ammo_used     INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS qa_reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  review_number TEXT NOT NULL,
  review_type   TEXT CHECK(review_type IN ('call_audit','report_review','bodycam_audit','investigation_review','dispatch_audit','other')),
  entity_type   TEXT,
  entity_id     INTEGER,
  reviewer_id   INTEGER,
  reviewed_officer_id INTEGER,
  score         REAL,
  max_score     REAL DEFAULT 100,
  status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','disputed','resolved')),
  review_date   TEXT,
  findings      TEXT,
  recommendations TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS qa_criteria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  review_type   TEXT NOT NULL,
  criterion     TEXT NOT NULL,
  description   TEXT,
  max_points    REAL DEFAULT 5,
  weight        REAL DEFAULT 1,
  is_active     INTEGER DEFAULT 1,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS qa_scores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id     INTEGER NOT NULL,
  criterion_id  INTEGER NOT NULL,
  score         REAL NOT NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS customer_satisfaction_surveys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_type   TEXT CHECK(survey_type IN ('call_response','officer_interaction','patrol_service','other')),
  entity_id     INTEGER,
  respondent_name TEXT,
  respondent_contact TEXT,
  rating        INTEGER CHECK(rating >= 1 AND rating <= 5),
  comments      TEXT,
  would_recommend INTEGER,
  submitted_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS client_contracts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL,
  contract_number TEXT,
  contract_type TEXT,
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  billing_cycle TEXT DEFAULT 'monthly' CHECK(billing_cycle IN ('weekly','biweekly','monthly','quarterly','annual','one_time')),
  rate_amount   REAL,
  rate_type     TEXT DEFAULT 'flat' CHECK(rate_type IN ('flat','hourly','per_call','per_officer','other')),
  status        TEXT DEFAULT 'active' CHECK(status IN ('draft','active','suspended','expired','terminated')),
  auto_renew    INTEGER DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  client_id     INTEGER,
  contract_id   INTEGER,
  issue_date    TEXT NOT NULL DEFAULT (date('now')),
  due_date      TEXT,
  subtotal      REAL DEFAULT 0,
  tax_rate      REAL DEFAULT 0,
  tax_amount    REAL DEFAULT 0,
  total_amount  REAL DEFAULT 0,
  paid_amount   REAL DEFAULT 0,
  status        TEXT DEFAULT 'draft' CHECK(status IN ('draft','sent','partial','paid','overdue','void','cancelled')),
  notes         TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL,
  description   TEXT NOT NULL,
  quantity      REAL DEFAULT 1,
  unit_price    REAL DEFAULT 0,
  line_total    REAL DEFAULT 0,
  tax_applied   INTEGER DEFAULT 1,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER,
  client_id     INTEGER,
  payment_date  TEXT NOT NULL DEFAULT (date('now')),
  amount        REAL NOT NULL,
  payment_method TEXT DEFAULT 'check' CHECK(payment_method IN ('check','ach','wire','credit_card','cash','other')),
  reference_number TEXT,
  notes         TEXT,
  recorded_by   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS expense_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_number TEXT NOT NULL,
  submitter_id  INTEGER NOT NULL,
  category      TEXT,
  description   TEXT,
  amount        REAL NOT NULL,
  expense_date  TEXT NOT NULL DEFAULT (date('now')),
  receipt_url   TEXT,
  status        TEXT DEFAULT 'submitted' CHECK(status IN ('draft','submitted','approved','rejected','reimbursed')),
  approved_by   INTEGER,
  approved_at   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS risk_assessments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_number TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER,
  risk_level    TEXT DEFAULT 'low' CHECK(risk_level IN ('low','moderate','high','critical')),
  risk_category TEXT,
  description   TEXT,
  assessed_by   INTEGER,
  assessed_date TEXT NOT NULL DEFAULT (date('now')),
  mitigation_plan TEXT,
  review_date   TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','mitigated','accepted','closed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS safety_inspections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_number TEXT NOT NULL,
  location      TEXT NOT NULL,
  inspection_type TEXT CHECK(inspection_type IN ('facility','vehicle','equipment','fire_safety','hazmat','general')),
  inspector_id  INTEGER,
  inspection_date TEXT NOT NULL DEFAULT (date('now')),
  pass_fail     TEXT CHECK(pass_fail IN ('pass','fail','conditional')),
  findings      TEXT,
  corrective_actions TEXT,
  next_inspection_due TEXT,
  status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','corrected')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS insurance_claims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_number  TEXT NOT NULL,
  claim_type    TEXT CHECK(claim_type IN ('auto','general_liability','workers_comp','property','professional_liability','other')),
  incident_date TEXT NOT NULL,
  description   TEXT NOT NULL,
  reported_by   INTEGER,
  reported_date TEXT NOT NULL DEFAULT (date('now')),
  insurer_name  TEXT,
  policy_number TEXT,
  claim_amount  REAL,
  settlement_amount REAL,
  status        TEXT DEFAULT 'reported' CHECK(status IN ('reported','under_review','approved','denied','settled','closed')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS interagency_partners (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_name   TEXT NOT NULL,
  agency_type   TEXT,
  jurisdiction  TEXT,
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  data_share_level TEXT DEFAULT 'none' CHECK(data_share_level IN ('none','basic','partial','full')),
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','pending','suspended','inactive')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS data_share_agreements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id    INTEGER NOT NULL,
  agreement_name TEXT NOT NULL,
  agreement_type TEXT CHECK(agreement_type IN ('moa','mou','nda','data_share','fusion_center','other')),
  effective_date TEXT NOT NULL,
  expiration_date TEXT,
  data_scope    TEXT,
  signed_by      TEXT,
  signed_date   TEXT,
  status        TEXT DEFAULT 'draft' CHECK(status IN ('draft','active','expired','terminated')),
  document_url  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS data_exchange_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id    INTEGER,
  agreement_id  INTEGER,
  exchange_type TEXT CHECK(exchange_type IN ('query','push','pull','broadcast')),
  data_type     TEXT,
  record_count  INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'success' CHECK(status IN ('success','partial','failed')),
  initiated_by  INTEGER,
  initiated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at  TEXT,
  error_message TEXT
);
CREATE TABLE IF NOT EXISTS geofence_zones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_name     TEXT NOT NULL,
  zone_type     TEXT CHECK(zone_type IN ('exclusion','inclusion','alert','patrol_required')),
  geojson_data  TEXT NOT NULL,
  description   TEXT,
  color         TEXT DEFAULT '#d4a017',
  is_active     INTEGER DEFAULT 1,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS crime_heatmap_data (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  data_date     TEXT NOT NULL,
  geohash       TEXT NOT NULL,
  incident_count INTEGER DEFAULT 0,
  crime_category TEXT,
  severity_weight REAL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS response_time_zones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_label    TEXT NOT NULL,
  centroid_lat  REAL NOT NULL,
  centroid_lng  REAL NOT NULL,
  target_response_minutes INTEGER NOT NULL,
  actual_avg_minutes_30d   REAL,
  beat_id       INTEGER,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS gang_intel_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  moniker       TEXT,
  gang_name     TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','incarcerated','deceased')),
  threat_level  TEXT DEFAULT 'low' CHECK(threat_level IN ('low','medium','high','critical')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS gang_intel_gangs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  colors        TEXT,
  member_count  INTEGER DEFAULT 0,
  threat_level  TEXT DEFAULT 'low' CHECK(threat_level IN ('low','medium','high','critical')),
  territory     TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS gang_graffiti_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location      TEXT NOT NULL,
  description   TEXT,
  gang_name     TEXT,
  photo_url     TEXT,
  reported_date TEXT NOT NULL DEFAULT (date('now')),
  status        TEXT DEFAULT 'documented' CHECK(status IN ('documented','removed','investigating')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS narcotics_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number   TEXT NOT NULL,
  case_type     TEXT CHECK(case_type IN ('investigation','buy_bust','ci_management','surveillance','other')),
  subject_name  TEXT,
  location      TEXT,
  substance     TEXT,
  quantity      TEXT,
  street_value  REAL DEFAULT 0,
  status        TEXT DEFAULT 'open' CHECK(status IN ('open','active','closed','pending_review')),
  priority      TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  officer_id    INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS special_ops_callouts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  call_type     TEXT NOT NULL,
  location      TEXT,
  resolution    TEXT,
  duration_minutes INTEGER,
  team_size     INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS special_ops_equipment (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_type TEXT NOT NULL,
  serial_number TEXT,
  condition     TEXT DEFAULT 'ready' CHECK(condition IN ('ready','repair','retired','lost')),
  assigned_to   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS crisis_response_incidents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_number TEXT NOT NULL,
  incident_type TEXT CHECK(incident_type IN ('mental_health','suicide_ideation','substance_abuse','domestic','welfare_check','other')),
  location      TEXT,
  subject_name  TEXT,
  disposition   TEXT,
  cit_team_used INTEGER DEFAULT 0,
  resolved_on_scene INTEGER DEFAULT 0,
  diverted      INTEGER DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS victim_services_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  victim_name   TEXT NOT NULL,
  case_number   TEXT,
  crime_type    TEXT,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','closed','referred','pending')),
  advocate_id   INTEGER,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  safety_plan   INTEGER DEFAULT 0,
  protective_order INTEGER DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS alarm_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_number TEXT NOT NULL,
  account_name  TEXT NOT NULL,
  address       TEXT NOT NULL,
  contact_name  TEXT,
  contact_phone TEXT,
  permit_number TEXT,
  permit_status TEXT DEFAULT 'active' CHECK(permit_status IN ('active','expired','suspended','pending')),
  permit_expiry TEXT,
  alarm_type    TEXT CHECK(alarm_type IN ('burglary','robbery','panic','fire','medical','other')),
  false_alarm_count INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','no_response')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS accreditation_standards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  standard_number TEXT NOT NULL,
  standard_name TEXT NOT NULL,
  category      TEXT,
  description   TEXT,
  compliance_status TEXT DEFAULT 'pending' CHECK(compliance_status IN ('compliant','non_compliant','pending','in_progress')),
  last_reviewed TEXT,
  next_review   TEXT,
  proof_url     TEXT,
  assigned_to   INTEGER,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS recruitment_candidates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_name TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  position      TEXT,
  stage         TEXT DEFAULT 'applied' CHECK(stage IN ('applied','screening','testing','oral_board','background','conditional_offer','academy','fto','hired','rejected','withdrawn')),
  applied_date  TEXT NOT NULL DEFAULT (date('now')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS fleet_insurance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  carrier TEXT,
  policy_number TEXT,
  coverage_type TEXT,
  coverage_amount REAL,
  premium REAL,
  effective_date TEXT,
  expiry_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
, premium_frequency TEXT DEFAULT 'monthly', deductible REAL, liability_limit REAL, status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS fleet_registration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  state TEXT DEFAULT 'UT',
  registration_number TEXT,
  effective_date TEXT,
  expiry_date TEXT,
  renewal_status TEXT DEFAULT 'current'
    CHECK(renewal_status IN ('current','pending','expired')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_pretrip_checklists ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, officer_id INTEGER, check_date TEXT, lights TEXT, brakes TEXT, radio TEXT, mdt TEXT, dashcam TEXT, tires TEXT, fluids TEXT, exterior TEXT, interior TEXT, emergency_equip TEXT, notes TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_tires ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, tire_position TEXT, brand TEXT, model TEXT, size TEXT, dot_code TEXT, tread_depth REAL, pressure_psi REAL, installed_date TEXT, installed_mileage INTEGER, cost REAL, notes TEXT, removed_date TEXT, removed_mileage INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_damage ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, damage_type TEXT, location TEXT, severity TEXT, description TEXT, reported_by TEXT, reported_date TEXT, repair_cost REAL, repair_status TEXT, repair_date TEXT, photo_urls TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_recalls ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, nhtsa_number TEXT, description TEXT, severity TEXT, issue_date TEXT, remedy_date TEXT, status TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_parts ( id INTEGER PRIMARY KEY AUTOINCREMENT, part_number TEXT, name TEXT, category TEXT, description TEXT, unit_cost REAL, quantity_on_hand INTEGER, reorder_point INTEGER, supplier TEXT, compatible_vehicles TEXT, location TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_warranties ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, coverage_type TEXT, provider TEXT, policy_number TEXT, coverage_details TEXT, start_date TEXT, expiry_date TEXT, expiry_mileage INTEGER, deductible REAL, contact_info TEXT, status TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_keys ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, key_number TEXT, key_type TEXT, rfid_tag TEXT, status TEXT, current_holder TEXT, last_checkout TEXT, last_return TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_key_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, key_id INTEGER, action TEXT, holder_name TEXT, timestamp TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_accidents ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, accident_date TEXT, location TEXT, severity TEXT, description TEXT, driver_id INTEGER, weather_conditions TEXT, road_conditions TEXT, police_report_number TEXT, insurance_claim_number TEXT, estimated_damage TEXT, injuries TEXT, fault_determination TEXT, status TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_service_providers ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, provider_type TEXT, phone TEXT, email TEXT, address TEXT, contact_name TEXT, tax_id INTEGER, preferred INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_fuel_cards ( id INTEGER PRIMARY KEY AUTOINCREMENT, card_number TEXT, provider TEXT, assigned_vehicle_id INTEGER, pin TEXT, credit_limit REAL, status TEXT, expiration_date TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_budgets ( id INTEGER PRIMARY KEY AUTOINCREMENT, fiscal_year TEXT, category TEXT, allocated_amount REAL, spent_amount REAL, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_depreciation ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, purchase_price REAL, salvage_value REAL, useful_life_months INTEGER, depreciation_method REAL, monthly_depreciation REAL, accumulated_depreciation REAL, current_book_value REAL, calculated_date TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_replacement_plan ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, replacement_year TEXT, replacement_reason TEXT, estimated_replacement_cost REAL, priority TEXT, status TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_fuel_vendors ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, location TEXT, brand TEXT, current_price_per_gallon REAL, last_updated TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_fuel_reconciliation ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, period_start TEXT, period_end TEXT, card_total TEXT, manual_total TEXT, variance TEXT, notes TEXT, reconciled_by TEXT, reconciled_at TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_alt_fuel_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, fuel_type TEXT, charge_kwh REAL, gge_equivalent REAL, cost REAL, charge_start TEXT, charge_end TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_vendor_ratings ( id INTEGER PRIMARY KEY AUTOINCREMENT, service_provider_id INTEGER, maintenance_id INTEGER, rating TEXT, review_text TEXT, rated_by REAL, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_tsbs ( id INTEGER PRIMARY KEY AUTOINCREMENT, tsb_number TEXT, title TEXT, description TEXT, manufacturer TEXT, applicable_makes TEXT, applicable_models TEXT, applicable_years INTEGER, severity TEXT, issue_date TEXT, notes TEXT, completed INTEGER DEFAULT 0, completed_date TEXT, completed_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_warranty_claims ( id INTEGER PRIMARY KEY AUTOINCREMENT, warranty_id INTEGER, vehicle_id INTEGER, claim_number TEXT, claim_date TEXT, description TEXT, amount REAL, maintenance_id INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) , approved INTEGER DEFAULT 0, approved_date TEXT);
CREATE TABLE IF NOT EXISTS fleet_service_contracts ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, provider TEXT, contract_number TEXT, coverage_type TEXT, coverage_details TEXT, start_date TEXT, expiry_date TEXT, annual_cost REAL, deductible REAL, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_maintenance_parts ( id INTEGER PRIMARY KEY AUTOINCREMENT, maintenance_id INTEGER, part_id INTEGER, quantity INTEGER, unit_cost REAL, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_roadside_assistance ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, incident_date TEXT, location TEXT, issue_type TEXT, provider TEXT, response_time_minutes INTEGER, resolution TEXT, cost REAL, driver_id INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_bay_schedule ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, bay_number TEXT, scheduled_start TEXT, scheduled_end TEXT, service_type TEXT, technician TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_trade_in_estimates ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, estimated_value REAL, source TEXT, valuation_date TEXT, condition_score REAL, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_disposals ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, disposal_type TEXT, disposal_date TEXT, sale_price REAL, buyer TEXT, auction_house TEXT, lot_number TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_leases ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, lessor TEXT, lease_number TEXT, start_date TEXT, end_date TEXT, monthly_payment REAL, residual_value REAL, mileage_allowance REAL, current_mileage INTEGER, excess_mileage_rate INTEGER, buyout_option TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_condition_scores ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, exterior_score REAL, interior_score REAL, mechanical_score REAL, overall_score REAL, scored_by REAL, scored_date REAL, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_purchase_orders ( id INTEGER PRIMARY KEY AUTOINCREMENT, po_number TEXT, vehicle_description TEXT, vendor TEXT, quantity INTEGER, unit_price REAL, total_price REAL, order_date TEXT, expected_delivery TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_delivery_checklists ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, purchase_order_id INTEGER, checklist_data TEXT, inspected_by TEXT, inspection_date TEXT, passed INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_fmcsa_compliance ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, checklist_date TEXT, annual_inspection_due TEXT, annual_inspection_completed INTEGER, eld_compliant INTEGER, ifta_registered INTEGER, hazmat_certified INTEGER, carrier_operating_authority TEXT, last_audit_date TEXT, next_audit_due TEXT, violations_count INTEGER, safety_rating TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_ifta_data ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, quarter TEXT, year TEXT, state TEXT, total_miles REAL, total_gallons REAL, tax_paid REAL, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_safety_recalls ( id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id INTEGER, completed_by INTEGER, completed_date INTEGER, verification_method TEXT, documentation_url TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_defect_reports ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, reported_by TEXT, defect_type TEXT, description TEXT, severity TEXT, reported_date TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) , resolved INTEGER DEFAULT 0, resolved_date TEXT, resolution TEXT);
CREATE TABLE IF NOT EXISTS fleet_safety_equipment ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, equipment_type TEXT, quantity INTEGER, last_inspected TEXT, next_inspection_due TEXT, expiration_date TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_load_compliance ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, gvwr REAL, curb_weight REAL, max_payload REAL, last_weigh_date TEXT, weigh_station TEXT, measured_weight REAL, compliance_status TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_cost_centers ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT, department TEXT, budget_annual REAL, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_cost_allocations ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, cost_center_id INTEGER, allocation_pct REAL, effective_date TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_grants ( id INTEGER PRIMARY KEY AUTOINCREMENT, grant_name TEXT, grantor TEXT, grant_number TEXT, amount REAL, award_date TEXT, expiration_date TEXT, purpose TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_grant_allocations ( id INTEGER PRIMARY KEY AUTOINCREMENT, grant_id INTEGER, vehicle_id INTEGER, amount_allocated REAL, allocation_date TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_capital_assets ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, asset_class TEXT, capitalization_date TEXT, capitalized_cost REAL, useful_life_years INTEGER, depreciation_method REAL, annual_depreciation REAL, net_book_value REAL, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_asset_register ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, asset_tag TEXT, acquisition_date TEXT, acquisition_cost REAL, funding_source TEXT, custodian TEXT, physical_location TEXT, last_verified TEXT, verified_by TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_pool_reservations ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, reserved_by TEXT, reservation_start TEXT, reservation_end TEXT, purpose TEXT, destination TEXT, passengers INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) , status TEXT, checked_out TEXT, checked_in TEXT);
CREATE TABLE IF NOT EXISTS fleet_vehicle_transfers ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, from_location TEXT, to_location TEXT, from_unit_id INTEGER, to_unit_id INTEGER, transfer_date TEXT, reason TEXT, approved_by TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_vehicle_decals ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, decal_type TEXT, decal_number TEXT, location_on_vehicle TEXT, applied_date TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_upfits ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, upfit_type TEXT, description TEXT, vendor TEXT, cost REAL, install_date TEXT, warranty_expiry TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_detailing_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, scheduled_date TEXT, detail_type TEXT, vendor TEXT, cost REAL, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_custom_metrics ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, metric_type TEXT, unit TEXT, description TEXT, target_value REAL, warning_threshold TEXT, critical_threshold TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_custom_metric_values ( id INTEGER PRIMARY KEY AUTOINCREMENT, metric_id INTEGER, vehicle_id INTEGER, value REAL, recorded_date TEXT, recorded_by TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_driver_certs ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, cert_type TEXT, cert_number TEXT, issuer TEXT, issue_date TEXT, expiry_date TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_driver_incidents ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, vehicle_id INTEGER, incident_type TEXT, incident_date TEXT, description TEXT, severity TEXT, action_taken TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_driver_vehicle_training ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, vehicle_id INTEGER, training_type TEXT, trained_date TEXT, trainer_id INTEGER, expiry_date TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_driver_feedback ( id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, vehicle_id INTEGER, rating TEXT, feedback_text TEXT, category TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_equipment_calibrations ( id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_type TEXT, equipment_id INTEGER, vehicle_id INTEGER, last_calibrated REAL, next_calibration_due TEXT, calibration_standard TEXT, passed INTEGER, technician TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_vehicle_theft ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, theft_date TEXT, location TEXT, police_report_number TEXT, insurance_claim_number TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) , recovered INTEGER DEFAULT 0, recovery_date TEXT, recovery_condition TEXT);
CREATE TABLE IF NOT EXISTS fleet_vehicle_specs ( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, vehicle_type TEXT, make TEXT, model TEXT, base_cost REAL, equipment_package TEXT, ordering_code TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_procurement_orders ( id INTEGER PRIMARY KEY AUTOINCREMENT, spec_id INTEGER, order_number TEXT, vendor TEXT, quantity INTEGER, unit_price REAL, total_price REAL, order_date TEXT, expected_delivery TEXT, approved_by TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_vendor_bids ( id INTEGER PRIMARY KEY AUTOINCREMENT, procurement_order_id INTEGER, vendor TEXT, bid_amount REAL, delivery_days INTEGER, warranty_details TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) , selected INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS fleet_decommissioning ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, decommission_date TEXT, reason TEXT, completed_by INTEGER, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) , salvage_value REAL, disposal_method TEXT, equipment_stripped INTEGER DEFAULT 0, data_wiped INTEGER DEFAULT 0, environmental_cleared INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS fleet_accessories ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, name TEXT, category TEXT, installed_date TEXT, removed_date TEXT, cost REAL, vendor TEXT, warranty_expiry TEXT, serial_number TEXT, status TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_fuel_anomalies ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, fuel_log_id INTEGER, anomaly_type TEXT, detected_date TEXT, severity TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_fuel_efficiency ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, vehicle_number TEXT, period_start TEXT, period_end TEXT, total_gallons REAL, total_miles REAL, mpg REAL, cost_per_mile REAL, created_at TEXT DEFAULT (datetime('now','localtime')) );
CREATE TABLE IF NOT EXISTS fleet_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  lender TEXT,
  original_amount REAL,
  current_balance REAL,
  monthly_payment REAL,
  interest_rate REAL,
  term_months INTEGER,
  start_date TEXT,
  payoff_date TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_utility_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  category TEXT,
  provider TEXT,
  cost_amount REAL,
  cost_frequency TEXT DEFAULT 'monthly',
  period_start TEXT,
  period_end TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  default_value TEXT,
  type TEXT NOT NULL DEFAULT 'string',    -- string|number|boolean|json|color|select
  label TEXT NOT NULL,
  description TEXT,
  options TEXT,                            -- JSON array for select type
  min_value REAL,
  max_value REAL,
  required_role TEXT DEFAULT 'admin',      -- minimum role to change this setting
  ui_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  latitude REAL,
  longitude REAL,
  speed_mph REAL,
  heading INTEGER,
  engine_rpm INTEGER,
  fuel_level_pct REAL,
  odometer INTEGER,
  battery_voltage REAL,
  dtc_codes TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS fleet_vehicle_detail ( id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER NOT NULL UNIQUE, engine_displacement_liters REAL, engine_cylinders INTEGER, engine_config TEXT, horsepower INTEGER, torque_lb_ft INTEGER, aspiration TEXT, transmission_speeds INTEGER, transfer_case TEXT, fuel_economy_combined REAL, secondary_fuel_type TEXT, secondary_fuel_capacity REAL, def_capacity REAL, oil_capacity_qts REAL, coolant_capacity REAL, gross_combined_weight INTEGER, payload_capacity_lbs INTEGER, towing_capacity_lbs INTEGER, cargo_volume_cuft REAL, bed_length_in REAL, wheelbase_in REAL, overall_length_in REAL, overall_width_in REAL, overall_height_in REAL, ground_clearance_in REAL, turning_radius_ft REAL, wheel_size_in REAL, front_tire_size TEXT, rear_tire_size TEXT, battery_group_size TEXT, alternator_amps INTEGER, paint_code TEXT, interior_color TEXT, upholstery_type TEXT, key_code TEXT, telematics_provider TEXT, telematics_device_serial TEXT, telematics_sim_iccid TEXT, dashcam_provider TEXT, dashcam_device_id TEXT, fuel_card_number TEXT, toll_transponder_id TEXT, dmv_record_id TEXT, insurer_system_id TEXT, external_asset_id TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')) );
CREATE TABLE IF NOT EXISTS fleet_other_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  cost_type TEXT,
  provider TEXT,
  amount REAL,
  frequency TEXT DEFAULT 'one_time',
  incurred_date TEXT,
  period_end TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fleet_cost_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  category TEXT,
  monthly_budget REAL,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(vehicle_id, category)
);
CREATE TABLE IF NOT EXISTS crm_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT DEFAULT 'manual', source_id TEXT, source_url TEXT,
  business_name TEXT NOT NULL, industry TEXT, sic_code TEXT, business_type TEXT,
  contact_name TEXT, contact_email TEXT, contact_phone TEXT, contact_title TEXT,
  address TEXT, city TEXT, state TEXT DEFAULT 'UT', zip TEXT,
  latitude REAL, longitude REAL, estimated_value REAL,
  permit_number TEXT, registration_date TEXT, license_number TEXT,
  project_type TEXT, property_size TEXT,
  pipeline_stage TEXT DEFAULT 'new', lead_score INTEGER DEFAULT 0,
  assigned_to INTEGER, client_id INTEGER, proposal_id INTEGER,
  notes TEXT, service_interest TEXT, lost_reason TEXT, next_follow_up TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_lead_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  activity_type TEXT, subject TEXT, details TEXT,
  old_value TEXT, new_value TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_number TEXT, lead_id INTEGER, client_id INTEGER,
  title TEXT, template_type TEXT, description TEXT, scope_of_work TEXT, terms TEXT,
  monthly_value REAL DEFAULT 0, total_value REAL DEFAULT 0,
  billing_frequency TEXT DEFAULT 'monthly',
  valid_until TEXT, proposed_start TEXT, proposed_end TEXT, contract_length_months INTEGER,
  stage TEXT DEFAULT 'draft',
  sent_at TEXT, viewed_at TEXT, accepted_at TEXT, rejected_at TEXT, rejection_reason TEXT,
  created_by INTEGER, assigned_to INTEGER, notes TEXT, pdf_path TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_proposal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, template_type TEXT, description TEXT,
  default_scope TEXT, default_terms TEXT,
  default_monthly_value REAL, default_billing_frequency TEXT DEFAULT 'monthly',
  default_contract_months INTEGER, is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER, lead_id INTEGER,
  title TEXT, description TEXT, due_date TEXT,
  priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending',
  assigned_to INTEGER, created_by INTEGER, completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
, task_type TEXT DEFAULT 'follow_up');
CREATE TABLE IF NOT EXISTS crm_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER, lead_id INTEGER,
  activity_type TEXT, subject TEXT, details TEXT,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS personnel_fitness (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  date TEXT,
  score REAL,
  run_time TEXT,
  pushups INTEGER,
  situps INTEGER,
  notes TEXT,
  recorded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS personnel_commendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  date TEXT,
  type TEXT,
  description TEXT,
  awarded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, code TEXT, description TEXT,
  parent_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, body TEXT,
  type TEXT NOT NULL DEFAULT 'info', priority TEXT NOT NULL DEFAULT 'normal',
  target_roles TEXT NOT NULL DEFAULT '[]', is_active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT, expires_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS notification_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, description TEXT, trigger_event TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '{}', target_roles TEXT NOT NULL DEFAULT '[]',
  target_user_ids TEXT NOT NULL DEFAULT '[]', notification_type TEXT NOT NULL DEFAULT 'in_app',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_by_name TEXT,
  last_fired_at TEXT, fire_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
DELETE FROM sqlite_sequence;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_key_value ON system_config(config_key, config_value);
CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_unit_recorded ON gps_breadcrumbs(unit_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_call_sign_recorded ON gps_breadcrumbs(call_sign, recorded_at);
CREATE INDEX IF NOT EXISTS idx_call_units_call ON call_units(call_id, unassigned_at);
CREATE INDEX IF NOT EXISTS idx_call_units_unit ON call_units(unit_id, unassigned_at);
CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_fp ON trusted_devices(user_id, device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_security_notifications_user ON security_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_shift_plans_date ON shift_plans(date);
CREATE INDEX IF NOT EXISTS idx_shift_plans_status ON shift_plans(status);
CREATE INDEX IF NOT EXISTS idx_serve_queue_persons_queue ON serve_queue_persons(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_queue_persons_person ON serve_queue_persons(person_id);
CREATE INDEX IF NOT EXISTS idx_integration_api_keys_active ON integration_api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_properties_archived ON properties(archived_at);
CREATE INDEX IF NOT EXISTS idx_call_visit_call ON call_visit_history(call_id);
CREATE INDEX IF NOT EXISTS idx_premise_alerts_address ON premise_alerts(address);
CREATE INDEX IF NOT EXISTS idx_premise_alerts_coords ON premise_alerts(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_dispatch_beats_mbr ON dispatch_beats(min_lat, max_lat, min_lng, max_lng);
CREATE INDEX IF NOT EXISTS idx_calls_lat_lng_created ON calls_for_service(latitude, longitude, created_at);
CREATE INDEX IF NOT EXISTS idx_code_violations_status ON code_violations(status);
CREATE INDEX IF NOT EXISTS idx_code_violations_violation_number ON code_violations(violation_number);
CREATE INDEX IF NOT EXISTS idx_code_violations_violation_type ON code_violations(violation_type);
CREATE INDEX IF NOT EXISTS idx_code_violations_compliance_deadline ON code_violations(compliance_deadline);
CREATE INDEX IF NOT EXISTS idx_code_violations_created_at ON code_violations(created_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_tows_status ON vehicle_tows(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_tows_tow_number ON vehicle_tows(tow_number);
CREATE INDEX IF NOT EXISTS idx_vehicle_tows_created_at ON vehicle_tows(created_at);
CREATE INDEX IF NOT EXISTS idx_dar_status ON daily_activity_reports(status);
CREATE INDEX IF NOT EXISTS idx_dar_officer_id ON daily_activity_reports(officer_id);
CREATE INDEX IF NOT EXISTS idx_dar_shift_date ON daily_activity_reports(shift_date);
CREATE INDEX IF NOT EXISTS idx_howen_devices_device_id ON howen_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_howen_devices_is_active ON howen_devices(is_active);
CREATE INDEX IF NOT EXISTS idx_howen_events_device_id ON howen_events(device_id);
CREATE INDEX IF NOT EXISTS idx_howen_events_event_at ON howen_events(event_at);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_officer_id ON performance_reviews(officer_id);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_status ON performance_reviews(status);
CREATE INDEX IF NOT EXISTS idx_hr_reviews_officer_id ON hr_reviews(officer_id);
CREATE INDEX IF NOT EXISTS idx_hr_reviews_status ON hr_reviews(status);
CREATE INDEX IF NOT EXISTS idx_shift_swap_requests_status ON shift_swap_requests(status);
CREATE INDEX IF NOT EXISTS idx_shift_swap_requests_shift_date ON shift_swap_requests(shift_date);
CREATE INDEX IF NOT EXISTS idx_forensic_cases_lab_number ON forensic_cases(lab_number);
CREATE INDEX IF NOT EXISTS idx_forensic_cases_status ON forensic_cases(status);
CREATE INDEX IF NOT EXISTS idx_forensic_exhibits_forensic_case_id ON forensic_exhibits(forensic_case_id);
CREATE INDEX IF NOT EXISTS idx_forensic_analyses_forensic_case_id ON forensic_analyses(forensic_case_id);
CREATE INDEX IF NOT EXISTS idx_forensic_activity_log_forensic_case_id ON forensic_activity_log(forensic_case_id);
CREATE INDEX IF NOT EXISTS idx_criminal_history_person_id ON criminal_history(person_id);
CREATE INDEX IF NOT EXISTS idx_criminal_history_offense_date ON criminal_history(offense_date);
CREATE INDEX IF NOT EXISTS idx_client_persons_client_id ON client_persons(client_id);
CREATE INDEX IF NOT EXISTS idx_client_persons_person_id ON client_persons(person_id);
CREATE INDEX IF NOT EXISTS idx_record_links_source ON record_links(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_record_links_target ON record_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_cpgps_sync_log_started_at ON cpgps_sync_log(started_at);
CREATE INDEX IF NOT EXISTS idx_sm_sync_log_started_at ON sm_sync_log(started_at);
CREATE INDEX IF NOT EXISTS idx_sm_jobs_job_status ON sm_jobs(job_status);
CREATE INDEX IF NOT EXISTS idx_sm_jobs_service_status ON sm_jobs(service_status);
CREATE INDEX IF NOT EXISTS idx_sm_attempts_job_id ON sm_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_cfs_status ON calls_for_service(status);
CREATE INDEX IF NOT EXISTS idx_cfs_priority ON calls_for_service(priority);
CREATE INDEX IF NOT EXISTS idx_cfs_zone ON calls_for_service(zone_id);
CREATE INDEX IF NOT EXISTS idx_cfs_beat ON calls_for_service(beat_id);
CREATE INDEX IF NOT EXISTS idx_cfs_case ON calls_for_service(case_id);
CREATE INDEX IF NOT EXISTS idx_cfs_client ON calls_for_service(client_id);
CREATE INDEX IF NOT EXISTS idx_utah_statutes_citation ON utah_statutes(citation);
CREATE INDEX IF NOT EXISTS idx_utah_statutes_active ON utah_statutes(is_active);
CREATE INDEX IF NOT EXISTS idx_utah_statutes_category ON utah_statutes(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_leave_requests_officer ON leave_requests(officer_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_disciplinary_records_officer ON disciplinary_records(officer_id);
CREATE INDEX IF NOT EXISTS idx_disciplinary_records_status ON disciplinary_records(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_persons_link ON call_persons(call_id, person_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_vehicles_link ON call_vehicles(call_id, vehicle_id, role);
CREATE INDEX IF NOT EXISTS idx_radio_channels_active ON radio_channels(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_radio_channels_sort ON radio_channels(sort_order, id);
CREATE INDEX IF NOT EXISTS idx_radio_tx_channel_time ON radio_transmissions(channel_id, transmitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_tx_user_time ON radio_transmissions(user_id, transmitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_tx_time ON radio_transmissions(transmitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_tx_call ON radio_transmissions(call_id);
CREATE INDEX IF NOT EXISTS idx_radio_rec_user ON radio_recordings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_rec_tx ON radio_recordings(transmission_id);
CREATE INDEX IF NOT EXISTS idx_nibrs_offense_group ON nibrs_offense_codes(ucr_group, active);
CREATE INDEX IF NOT EXISTS idx_businesses_name ON businesses(name);
CREATE INDEX IF NOT EXISTS idx_businesses_ein ON businesses(ein) WHERE ein IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_archived ON businesses(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_business_vehicles_business ON business_vehicles(business_id);
CREATE INDEX IF NOT EXISTS idx_business_vehicles_vehicle ON business_vehicles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_business_visits_business_visit_at ON business_visits(business_id, visit_at);
CREATE INDEX IF NOT EXISTS idx_business_photos_business ON business_photos(business_id);
CREATE INDEX IF NOT EXISTS idx_call_businesses_call ON call_businesses(call_id);
CREATE INDEX IF NOT EXISTS idx_call_businesses_business_created ON call_businesses(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_attachments_folder ON attachments(folder_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_case ON case_notes(case_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_pinned ON case_notes(case_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_cpl_case ON case_person_links(case_id);
CREATE INDEX IF NOT EXISTS idx_cpl_person ON case_person_links(person_id);
CREATE INDEX IF NOT EXISTS idx_patrol_breaks_officer ON patrol_breaks(officer_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_patrol_tour_verifications_officer ON patrol_tour_verifications(officer_id);
CREATE INDEX IF NOT EXISTS idx_patrol_tour_verifications_date ON patrol_tour_verifications(tour_date);
CREATE INDEX IF NOT EXISTS idx_run_cards_active ON dispatch_run_cards(active, incident_type);
CREATE INDEX IF NOT EXISTS idx_arrest_links_arrest ON arrest_cross_links(arrest_record_id);
CREATE INDEX IF NOT EXISTS idx_arrest_links_linked ON arrest_cross_links(linked_type, linked_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_case_persons_case ON case_persons(case_id);
CREATE INDEX IF NOT EXISTS idx_case_calls_case ON case_calls(case_id);
CREATE INDEX IF NOT EXISTS idx_case_incidents_case ON case_incidents(case_id);
CREATE INDEX IF NOT EXISTS idx_case_vehicles_case ON case_vehicles(case_id);
CREATE INDEX IF NOT EXISTS idx_case_properties_case ON case_properties(case_id);
CREATE INDEX IF NOT EXISTS idx_case_evidence_case ON case_evidence(case_id);
CREATE INDEX IF NOT EXISTS idx_case_warrants_case ON case_warrants(case_id);
CREATE INDEX IF NOT EXISTS idx_case_citations_case ON case_citations(case_id);
CREATE INDEX IF NOT EXISTS idx_cil_case ON case_incident_links(case_id);
CREATE INDEX IF NOT EXISTS idx_cil_incident ON case_incident_links(incident_id);
CREATE INDEX IF NOT EXISTS idx_cel_case ON case_evidence_links(case_id);
CREATE INDEX IF NOT EXISTS idx_cel_evidence ON case_evidence_links(evidence_id);
CREATE INDEX IF NOT EXISTS idx_serve_intake_docs_queue ON serve_intake_documents(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_intake_docs_user ON serve_intake_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_serve_intake_docs_status ON serve_intake_documents(status);
CREATE INDEX IF NOT EXISTS idx_serve_intake_docs_created ON serve_intake_documents(created_at);
CREATE INDEX IF NOT EXISTS idx_pso_qr_token ON pso_qr_tokens(token);
CREATE INDEX IF NOT EXISTS idx_pso_qr_call ON pso_qr_tokens(call_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_utah_warrants_unique ON utah_warrants(utah_person_id, utah_warrant_id);
CREATE INDEX IF NOT EXISTS idx_utah_warrants_person ON utah_warrants(person_id, is_active);
CREATE INDEX IF NOT EXISTS idx_utah_warrants_active ON utah_warrants(is_active, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_utah_warrants_last_seen ON utah_warrants(last_seen_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_dedup_active
  ON anomaly_alerts(dedup_key) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_anomaly_active
  ON anomaly_alerts(acknowledged_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conn_inv_user ON connection_investigations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_time ON fleet_telemetry(vehicle_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_crm_leads_source ON crm_leads(source);
CREATE INDEX IF NOT EXISTS idx_crm_lead_activity_lead ON crm_lead_activity(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_proposals_stage ON crm_proposals(stage);
CREATE INDEX IF NOT EXISTS idx_personnel_fitness_officer ON personnel_fitness(officer_id);
CREATE INDEX IF NOT EXISTS idx_personnel_commendations_officer ON personnel_commendations(officer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_warrants_src_wid ON scraped_warrants(source_key, warrant_id);
CREATE INDEX IF NOT EXISTS idx_scraped_warrants_src_status ON scraped_warrants(source_key, status);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_notif_rules_trigger ON notification_rules(trigger_event, is_active);


-- ============================================================
-- Migration tracker seed: mark every historical migration through the
-- snapshot point as applied, so `wrangler d1 migrations apply --local`
-- only runs migrations added AFTER this baseline (0072+).
-- ============================================================
INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0001_initial.sql'),
  ('0001_initial_schema.sql'),
  ('0002_seed.sql'),
  ('0002_serve_queue_persons.sql'),
  ('0003_calls_for_service_extended.sql'),
  ('0003_serve_queue_columns.sql'),
  ('0004_serve_queue_remaining.sql'),
  ('0005_serve_tables_columns.sql'),
  ('0006_integration_api_keys.sql'),
  ('0008_users_columns.sql'),
  ('0009_calls_for_service_columns.sql'),
  ('0010_dispatch_geography.sql'),
  ('0011_add_missing_tables_columns.sql'),
  ('0012_seed_geography.sql'),
  ('0013_spillman_codes.sql'),
  ('0014_dispatch_run_cards.sql'),
  ('0015_nibrs_codes.sql'),
  ('0016_dv_pursuit_supplements.sql'),
  ('0017_field_interview_link.sql'),
  ('0018_units_audio_mode.sql'),
  ('0019_warrant_watch.sql'),
  ('0021_panic_alerts.sql'),
  ('0022_call_links.sql'),
  ('0023_business_records.sql'),
  ('0024_document_folders.sql'),
  ('0025_field_interviews.sql'),
  ('0026_arrests_manual.sql'),
  ('0027_citations.sql'),
  ('0028_cases.sql'),
  ('0029_forensics.sql'),
  ('0030_serve_intake.sql'),
  ('0031_shift_plans.sql'),
  ('0032_court_events.sql'),
  ('0033_serve_ensure.sql'),
  ('0034_patrol.sql'),
  ('0034_serve_intake_documents.sql'),
  ('0035_utah_warrants.sql'),
  ('0036_utah_statutes.sql'),
  ('0037_offline_sync_table_backports.sql'),
  ('0038_radio.sql'),
  ('0039_case_junction_tables.sql'),
  ('0040_utah_warrants_lifecycle_reconcile.sql'),
  ('0041_calls_ext_add_held_at.sql'),
  ('0041_geography_create_columns.sql'),
  ('0042_anomaly_alerts.sql'),
  ('0043_connection_investigations.sql'),
  ('0044_calls_ext_add_parent_call_id.sql'),
  ('0045_settings_sync.sql'),
  ('0046_warrants_null_out_sentinels.sql'),
  ('0047_spillman_modules.sql'),
  ('0048_specialized_modules.sql'),
  ('0049_admin_settings.sql'),
  ('0050_advanced_settings.sql'),
  ('0052_fleet_tables.sql'),
  ('0053_fleet_extended_tables.sql'),
  ('0054_fleet_100_upgrades.sql'),
  ('0055_fleet_100_more_upgrades.sql'),
  ('0057_fleet_schema_alignment.sql'),
  ('0058_fleet_other_costs_and_budgets.sql'),
  ('0059_crm_core_tables.sql'),
  ('0060_fleet_fuel_mpg.sql'),
  ('0061_business_property_columns.sql'),
  ('0062_fleet_inspection_type_checklist.sql'),
  ('0063_crm_tasks_task_type.sql'),
  ('0064_incident_subresource_columns.sql'),
  ('0064_warrants_served_location.sql'),
  ('0065_units_gps_heading_speed.sql'),
  ('0066_geography_area_columns.sql'),
  ('0067_forensic_activity_log_exhibit_id.sql'),
  ('0067_personnel_fitness_commendations.sql'),
  ('0067_seed_multi_source_scrapers.sql'),
  ('0068_patrol_checkpoints_archived_at.sql'),
  ('0069_fleet_write_handler_columns.sql'),
  ('0070_admin_departments_announcements_notif_rules.sql'),
  ('0070_unincorporated_zone_sector_fixes.sql'),
  ('0071_units_emergency_overlay.sql');
