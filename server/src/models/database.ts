import Database from 'better-sqlite3';
import bcryptjs from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrateIncidentNumbers } from '../utils/caseNumbers';
import crypto from 'crypto';
import { localNow } from '../utils/timeUtils';
import { seedUtahStatutes } from '../seeds/utahStatutes';
import { DISPATCH_DISTRICTS } from '../seeds/dispatchDistricts';
import { identifyBeat } from '../utils/geofence';
import { reverseGeocodeDetailed } from '../utils/geocode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use RMPG_DATA_DIR env var if provided (set by Electron desktop app for
// writable user-data location), otherwise fall back to project-relative path
const DATA_DIR = process.env.RMPG_DATA_DIR || path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'rmpg-flex.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(): Database.Database {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  migrateSchema();
  createIndexes();
  seedData();
  seedUtahStatutes(db);

  console.log('Database initialized successfully at', DB_PATH);
  return db;
}

function createTables(): void {
  db.exec(`
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
      source TEXT DEFAULT 'phone' CHECK(source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','panic','other')),
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
      status TEXT NOT NULL DEFAULT 'off_duty' CHECK(status IN ('available','dispatched','enroute','onscene','busy','off_duty')),
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_key_value ON system_config(config_key, config_value);

    -- OFAC SDN (Specially Designated Nationals) — scraped from U.S. Treasury
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
    CREATE INDEX IF NOT EXISTS idx_ofac_sdn_name ON ofac_sdn_entries(sdn_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_ofac_sdn_type ON ofac_sdn_entries(sdn_type);

    CREATE TABLE IF NOT EXISTS ofac_sdn_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ent_num INTEGER NOT NULL,
      alt_num INTEGER,
      alt_type TEXT,
      alt_name TEXT NOT NULL,
      alt_remarks TEXT,
      FOREIGN KEY (ent_num) REFERENCES ofac_sdn_entries(ent_num) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ofac_alias_name ON ofac_sdn_aliases(alt_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_ofac_alias_ent ON ofac_sdn_aliases(ent_num);

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
    CREATE INDEX IF NOT EXISTS idx_ofac_addr_ent ON ofac_sdn_addresses(ent_num);

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
    CREATE INDEX IF NOT EXISTS idx_ofac_ids_ent ON ofac_sdn_ids(ent_num);

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

    -- Utah State Warrants — scraped from warrants.utah.gov
    CREATE TABLE IF NOT EXISTS utah_warrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utah_person_id TEXT NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      age INTEGER,
      city TEXT,
      utah_warrant_id TEXT NOT NULL,
      issue_date TEXT,
      court_name TEXT,
      case_id TEXT,
      charges TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_utah_warrant_name
      ON utah_warrants(last_name COLLATE NOCASE, first_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_utah_warrant_person
      ON utah_warrants(utah_person_id);

    CREATE TABLE IF NOT EXISTS utah_warrant_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      persons_found INTEGER DEFAULT 0,
      warrants_found INTEGER DEFAULT 0,
      requests_made INTEGER DEFAULT 0,
      search_strategy TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      duration_ms INTEGER,
      synced_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- ── ARREST RECORDS — JailBase county arrest data ──
    CREATE TABLE IF NOT EXISTS arrest_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jailbase_id TEXT,
      source_id TEXT,
      source_name TEXT,
      full_name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      middle_name TEXT,
      date_of_birth TEXT,
      booking_date TEXT,
      release_date TEXT,
      charges TEXT,
      mugshot_url TEXT,
      details_url TEXT,
      county TEXT,
      status TEXT DEFAULT 'active',
      raw_record TEXT,
      fetched_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(jailbase_id, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_arrest_full_name ON arrest_records(full_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_arrest_last_name ON arrest_records(last_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_arrest_first_name ON arrest_records(first_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_arrest_booking ON arrest_records(booking_date);
    CREATE INDEX IF NOT EXISTS idx_arrest_source ON arrest_records(source_id);
    CREATE INDEX IF NOT EXISTS idx_arrest_county ON arrest_records(county);

    CREATE TABLE IF NOT EXISTS arrest_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT,
      records_count INTEGER DEFAULT 0,
      counties_synced INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      duration_ms INTEGER,
      synced_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS arrest_cross_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arrest_record_id INTEGER NOT NULL,
      linked_type TEXT NOT NULL,
      linked_id INTEGER NOT NULL,
      match_type TEXT DEFAULT 'name',
      match_confidence REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (arrest_record_id) REFERENCES arrest_records(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_crosslink_arrest ON arrest_cross_links(arrest_record_id);
    CREATE INDEX IF NOT EXISTS idx_crosslink_type ON arrest_cross_links(linked_type, linked_id);

    -- ── Jail Roster Scraper ──────────────────────────
    CREATE TABLE IF NOT EXISTS jail_roster_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      county TEXT NOT NULL,
      records_found INTEGER DEFAULT 0,
      records_new INTEGER DEFAULT 0,
      records_updated INTEGER DEFAULT 0,
      records_released INTEGER DEFAULT 0,
      details_fetched INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      duration_ms INTEGER,
      synced_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_jail_sync_county ON jail_roster_sync_log(county);

    CREATE TABLE IF NOT EXISTS jail_roster_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      county TEXT NOT NULL UNIQUE,
      display_name TEXT,
      roster_url TEXT,
      roster_type TEXT DEFAULT 'html',
      enabled INTEGER DEFAULT 0,
      scrape_interval_minutes INTEGER DEFAULT 30,
      last_scrape_at TEXT,
      consecutive_errors INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
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
    CREATE INDEX IF NOT EXISTS idx_mb_search_product ON microbilt_searches(product);
    CREATE INDEX IF NOT EXISTS idx_mb_search_date ON microbilt_searches(created_at);

    -- Driver's License records (structured local store — captured from MicroBilt API)
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
    CREATE INDEX IF NOT EXISTS idx_dl_number_state ON dl_records(dl_number, dl_state);
    CREATE INDEX IF NOT EXISTS idx_dl_last_name ON dl_records(last_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_dl_first_name ON dl_records(first_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_dl_dob ON dl_records(date_of_birth);

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
    CREATE INDEX IF NOT EXISTS idx_dl_addr_record ON dl_addresses(dl_record_id);

    -- Warrants
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

    -- Notifications
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

    -- Call Templates
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

    -- Supplemental Reports
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

    -- Fleet Vehicles
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

    -- Fleet Maintenance
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

    -- Fleet Fuel Logs
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

    -- Fleet Inspections
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

    -- Fleet Assignment History
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

    -- Fleet Personnel Notes
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

    -- Junction tables for linking persons and vehicles to incidents
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

    -- Training Records
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

    -- Training Requirements
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

    -- Deployments
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

    -- Officer Equipment
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

    CREATE INDEX IF NOT EXISTS idx_officer_equipment_officer ON officer_equipment(officer_id);
    CREATE INDEX IF NOT EXISTS idx_officer_equipment_status ON officer_equipment(status);
    CREATE INDEX IF NOT EXISTS idx_officer_equipment_type ON officer_equipment(equipment_type);

    -- Body cameras — dedicated device tracking
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

    CREATE INDEX IF NOT EXISTS idx_body_cameras_officer ON body_cameras(officer_id);
    CREATE INDEX IF NOT EXISTS idx_body_cameras_status ON body_cameras(status);

    -- Body camera video footage
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

    CREATE INDEX IF NOT EXISTS idx_bodycam_videos_camera ON bodycam_videos(camera_id);
    CREATE INDEX IF NOT EXISTS idx_bodycam_videos_officer ON bodycam_videos(officer_id);
    CREATE INDEX IF NOT EXISTS idx_bodycam_videos_case ON bodycam_videos(case_number);

    -- Dash camera video footage (table created via migration if not existing)

    -- ── Two-Factor Authentication ─────────────────────────
    CREATE TABLE IF NOT EXISTS user_totp_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      encrypted_secret TEXT NOT NULL,
      encryption_iv TEXT NOT NULL,
      encryption_tag TEXT NOT NULL,
      is_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_backup_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL,
      is_used INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trusted_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_fingerprint TEXT NOT NULL,
      device_name TEXT,
      ip_address TEXT,
      trusted_until TEXT NOT NULL,
      last_used_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS security_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN (
        'new_device_login','suspicious_login','password_changed',
        '2fa_enabled','2fa_disabled','2fa_reset','device_revoked',
        'session_revoked','password_expiring','failed_login_threshold'
      )),
      title TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      device_info TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Radio transmission transcripts — permanent log of PTT voice comms
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

    CREATE INDEX IF NOT EXISTS idx_radio_transcripts_channel ON radio_transcripts(channel);
    CREATE INDEX IF NOT EXISTS idx_radio_transcripts_user ON radio_transcripts(user_id);
    CREATE INDEX IF NOT EXISTS idx_radio_transcripts_time ON radio_transcripts(transmitted_at);

    -- ═══ Offline Support ═══════════════════════════════════

    -- Pre-shared secrets for offline PIN generation (one per user)
    CREATE TABLE IF NOT EXISTS offline_pin_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      secret TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      rotated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- ═══ Company Documents (Policies, SOPs, Training Manuals) ═════
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

    CREATE INDEX IF NOT EXISTS idx_company_docs_category ON company_documents(category);
    CREATE INDEX IF NOT EXISTS idx_company_docs_published ON company_documents(published);

    -- ClearPathGPS device-to-unit mappings
    CREATE TABLE IF NOT EXISTS cpg_device_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpg_device_id TEXT NOT NULL UNIQUE,
      cpg_display_name TEXT,
      cpg_serial_number TEXT,
      unit_id INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    );
    CREATE INDEX IF NOT EXISTS idx_cpg_mappings_unit ON cpg_device_mappings(unit_id);
    CREATE INDEX IF NOT EXISTS idx_cpg_mappings_device ON cpg_device_mappings(cpg_device_id);

    -- ClearPathGPS dashcam video events
    CREATE TABLE IF NOT EXISTS dashcam_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpg_device_id TEXT NOT NULL,
      unit_id INTEGER,
      dashcam_id TEXT,
      event_type TEXT NOT NULL,
      event_timestamp TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      heading REAL,
      speed_mph REAL,
      address TEXT,
      status_code TEXT,
      status_code_text TEXT,
      video_available INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    );
    CREATE INDEX IF NOT EXISTS idx_dashcam_events_device_time ON dashcam_events(cpg_device_id, event_timestamp);
    CREATE INDEX IF NOT EXISTS idx_dashcam_events_unit ON dashcam_events(unit_id);
    CREATE INDEX IF NOT EXISTS idx_dashcam_events_type ON dashcam_events(event_type);

    -- IPED Digital Forensics — processing job tracking
    CREATE TABLE IF NOT EXISTS iped_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id INTEGER,
      job_type TEXT NOT NULL CHECK(job_type IN ('hash','process','triage','csam_scan')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
      profile TEXT DEFAULT 'forensic',
      input_path TEXT NOT NULL,
      output_path TEXT,
      source_type TEXT,
      started_at TEXT,
      completed_at TEXT,
      progress_percent INTEGER DEFAULT 0,
      items_found INTEGER DEFAULT 0,
      items_processed INTEGER DEFAULT 0,
      error_message TEXT,
      result_summary TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (evidence_id) REFERENCES evidence(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_iped_jobs_evidence ON iped_jobs(evidence_id);
    CREATE INDEX IF NOT EXISTS idx_iped_jobs_status ON iped_jobs(status);

    -- IPED Digital Forensics — hash results for evidence files
    CREATE TABLE IF NOT EXISTS digital_evidence_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id INTEGER,
      attachment_id INTEGER,
      iped_job_id INTEGER,
      file_name TEXT NOT NULL,
      file_path TEXT,
      file_size INTEGER,
      mime_type TEXT,
      md5 TEXT,
      sha1 TEXT,
      sha256 TEXT,
      sha512 TEXT,
      photodna_hash TEXT,
      phash TEXT,
      dhash TEXT,
      hash_set_match INTEGER DEFAULT 0,
      hash_set_name TEXT,
      hash_set_category TEXT,
      match_confidence REAL,
      flagged INTEGER DEFAULT 0,
      flag_reason TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (evidence_id) REFERENCES evidence(id),
      FOREIGN KEY (attachment_id) REFERENCES attachments(id),
      FOREIGN KEY (iped_job_id) REFERENCES iped_jobs(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_deh_evidence_id ON digital_evidence_hashes(evidence_id);
    CREATE INDEX IF NOT EXISTS idx_deh_md5 ON digital_evidence_hashes(md5);
    CREATE INDEX IF NOT EXISTS idx_deh_sha256 ON digital_evidence_hashes(sha256);
    CREATE INDEX IF NOT EXISTS idx_deh_photodna ON digital_evidence_hashes(photodna_hash);
    CREATE INDEX IF NOT EXISTS idx_deh_flagged ON digital_evidence_hashes(flagged);
  `);
}

/**
 * Safe schema migration — adds new columns to existing tables.
 * Uses try/catch per ALTER TABLE so it's idempotent (won't fail if column already exists).
 */
function migrateSchema(): void {
  const addCol = (table: string, col: string, typedef: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`);
    } catch {
      // Column already exists — safe to ignore
    }
  };

  // ── PERSONS — new identifying fields ──────────────────
  addCol('persons', 'middle_name', 'TEXT');
  addCol('persons', 'alias_nickname', 'TEXT');
  addCol('persons', 'ssn_last4', 'TEXT');
  addCol('persons', 'dl_number', 'TEXT');
  addCol('persons', 'dl_state', 'TEXT');
  addCol('persons', 'dl_expiry', 'TEXT');
  addCol('persons', 'dl_class', 'TEXT');
  addCol('persons', 'employer', 'TEXT');
  addCol('persons', 'occupation', 'TEXT');
  addCol('persons', 'emergency_contact_name', 'TEXT');
  addCol('persons', 'emergency_contact_phone', 'TEXT');
  addCol('persons', 'city', 'TEXT');
  addCol('persons', 'state', 'TEXT');
  addCol('persons', 'zip', 'TEXT');
  addCol('persons', 'build', 'TEXT');
  addCol('persons', 'complexion', 'TEXT');
  addCol('persons', 'clothing_description', 'TEXT');
  addCol('persons', 'gang_affiliation', 'TEXT');
  addCol('persons', 'is_sex_offender', "INTEGER DEFAULT 0");
  addCol('persons', 'is_veteran', "INTEGER DEFAULT 0");
  addCol('persons', 'language', 'TEXT');
  addCol('persons', 'updated_at', "TEXT");
  addCol('persons', 'place_of_birth', 'TEXT');
  addCol('persons', 'citizenship', 'TEXT');
  addCol('persons', 'marital_status', 'TEXT');
  addCol('persons', 'hair_length', 'TEXT');
  addCol('persons', 'hair_style', 'TEXT');
  addCol('persons', 'facial_hair', 'TEXT');
  addCol('persons', 'glasses', 'TEXT');
  addCol('persons', 'shoe_size', 'TEXT');
  addCol('persons', 'blood_type', 'TEXT');
  addCol('persons', 'phone_secondary', 'TEXT');
  addCol('persons', 'social_media', 'TEXT');
  addCol('persons', 'probation_parole', 'TEXT');
  addCol('persons', 'probation_parole_officer', 'TEXT');
  addCol('persons', 'known_associates', 'TEXT');
  addCol('persons', 'emergency_contact_relationship', 'TEXT');
  addCol('persons', 'caution_flags', 'TEXT');
  addCol('persons', 'ssn_full', 'TEXT');
  addCol('persons', 'id_image_url', 'TEXT');
  addCol('persons', 'id_type', 'TEXT');
  addCol('persons', 'id_number', 'TEXT');
  addCol('persons', 'id_state', 'TEXT');
  addCol('persons', 'id_expiry', 'TEXT');

  // ── VEHICLES — new detail fields ──────────────────────
  addCol('vehicles_records', 'body_style', 'TEXT');
  addCol('vehicles_records', 'doors', 'INTEGER');
  addCol('vehicles_records', 'secondary_color', 'TEXT');
  addCol('vehicles_records', 'insurance_company', 'TEXT');
  addCol('vehicles_records', 'insurance_policy', 'TEXT');
  addCol('vehicles_records', 'registration_expiry', 'TEXT');
  addCol('vehicles_records', 'damage_description', 'TEXT');
  addCol('vehicles_records', 'distinguishing_features', 'TEXT');
  addCol('vehicles_records', 'updated_at', "TEXT");

  // ── VEHICLES — extended detail fields ───────────────────
  addCol('vehicles_records', 'trim', 'TEXT');
  addCol('vehicles_records', 'engine_type', 'TEXT');
  addCol('vehicles_records', 'fuel_type', 'TEXT');
  addCol('vehicles_records', 'transmission', 'TEXT');
  addCol('vehicles_records', 'drive_type', 'TEXT');
  addCol('vehicles_records', 'tow_status', 'TEXT');
  addCol('vehicles_records', 'tow_company', 'TEXT');
  addCol('vehicles_records', 'tow_date', 'TEXT');
  addCol('vehicles_records', 'plate_type', 'TEXT');
  addCol('vehicles_records', 'commercial_vehicle', 'INTEGER DEFAULT 0');
  addCol('vehicles_records', 'hazmat', 'INTEGER DEFAULT 0');
  addCol('vehicles_records', 'odometer', 'TEXT');
  addCol('vehicles_records', 'owner_address', 'TEXT');
  addCol('vehicles_records', 'owner_phone', 'TEXT');
  addCol('vehicles_records', 'lien_holder', 'TEXT');
  addCol('vehicles_records', 'stolen_status', 'TEXT');
  addCol('vehicles_records', 'stolen_date', 'TEXT');
  addCol('vehicles_records', 'recovery_date', 'TEXT');

  // ── CALLS_FOR_SERVICE — new dispatcher fields ─────────
  addCol('calls_for_service', 'caller_relationship', "TEXT DEFAULT ''");
  addCol('calls_for_service', 'caller_address', 'TEXT');
  addCol('calls_for_service', 'zone_beat', 'TEXT');
  addCol('calls_for_service', 'section_id', 'TEXT');
  addCol('calls_for_service', 'zone_id', 'TEXT');
  addCol('calls_for_service', 'beat_id', 'TEXT');
  addCol('calls_for_service', 'cross_street', 'TEXT');
  addCol('calls_for_service', 'location_building', 'TEXT');
  addCol('calls_for_service', 'location_floor', 'TEXT');
  addCol('calls_for_service', 'location_room', 'TEXT');
  addCol('calls_for_service', 'weapons_involved', 'TEXT');
  addCol('calls_for_service', 'injuries_reported', "INTEGER DEFAULT 0");
  addCol('calls_for_service', 'num_subjects', 'INTEGER');
  addCol('calls_for_service', 'subject_description', 'TEXT');
  addCol('calls_for_service', 'vehicle_description', 'TEXT');
  addCol('calls_for_service', 'direction_of_travel', 'TEXT');
  addCol('calls_for_service', 'archived_at', 'TEXT');
  addCol('calls_for_service', 'caller_address', "TEXT DEFAULT ''");
  addCol('calls_for_service', 'zone_beat', "TEXT DEFAULT ''");
  addCol('calls_for_service', 'responding_officer', 'TEXT');
  addCol('calls_for_service', 'secondary_type', 'TEXT');
  addCol('calls_for_service', 'contact_method', 'TEXT');
  addCol('calls_for_service', 'scene_safety', 'TEXT');
  addCol('calls_for_service', 'weather_conditions', 'TEXT');
  addCol('calls_for_service', 'lighting_conditions', 'TEXT');
  addCol('calls_for_service', 'num_victims', 'INTEGER');
  addCol('calls_for_service', 'alcohol_involved', 'INTEGER DEFAULT 0');
  addCol('calls_for_service', 'drugs_involved', 'INTEGER DEFAULT 0');
  addCol('calls_for_service', 'domestic_violence', 'INTEGER DEFAULT 0');
  addCol('calls_for_service', 'supervisor_notified', 'INTEGER DEFAULT 0');
  addCol('calls_for_service', 'le_notified', 'INTEGER DEFAULT 0');
  addCol('calls_for_service', 'le_agency', 'TEXT');
  addCol('calls_for_service', 'le_case_number', 'TEXT');
  addCol('calls_for_service', 'damage_estimate', 'REAL');
  addCol('calls_for_service', 'damage_description', 'TEXT');
  addCol('calls_for_service', 'action_taken', 'TEXT');
  addCol('calls_for_service', 'updated_at', 'TEXT');

  // ── calls_for_service — expand source CHECK constraint ─────────────
  // The original CHECK only allowed: phone, radio, alarm, walk_in, email
  // Frontend supports: phone, radio, alarm, walk_in, email, patrol, online, dispatch, other
  // SQLite doesn't support ALTER CHECK — must rebuild the table.
  try {
    const cfsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='calls_for_service'").get() as any;
    if (cfsSchema && cfsSchema.sql && !cfsSchema.sql.includes("'patrol'")) {
      // Disable FK checks for the table rebuild (re-enabled after)
      db.pragma('foreign_keys = OFF');
      db.exec(`DROP TABLE IF EXISTS calls_for_service_new`);
      db.exec(`
        CREATE TABLE calls_for_service_new (
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
          source TEXT DEFAULT 'phone' CHECK(source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','panic','other')),
          assigned_unit_ids TEXT DEFAULT '[]',
          dispatcher_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          dispatched_at TEXT,
          enroute_at TEXT,
          onscene_at TEXT,
          cleared_at TEXT,
          closed_at TEXT,
          disposition TEXT,
          caller_address TEXT,
          zone_beat TEXT,
          cross_street TEXT,
          location_building TEXT,
          location_floor TEXT,
          location_room TEXT,
          weapons_involved TEXT,
          injuries_reported INTEGER DEFAULT 0,
          num_subjects INTEGER,
          subject_description TEXT,
          vehicle_description TEXT,
          direction_of_travel TEXT,
          archived_at TEXT,
          responding_officer TEXT,
          secondary_type TEXT,
          contact_method TEXT,
          scene_safety TEXT,
          weather_conditions TEXT,
          lighting_conditions TEXT,
          num_victims INTEGER,
          alcohol_involved INTEGER DEFAULT 0,
          drugs_involved INTEGER DEFAULT 0,
          domestic_violence INTEGER DEFAULT 0,
          supervisor_notified INTEGER DEFAULT 0,
          le_notified INTEGER DEFAULT 0,
          le_agency TEXT,
          le_case_number TEXT,
          damage_estimate REAL,
          damage_description TEXT,
          action_taken TEXT,
          section_id TEXT,
          zone_id TEXT,
          beat_id TEXT,
          client_id INTEGER,
          updated_at TEXT,
          FOREIGN KEY (property_id) REFERENCES properties(id),
          FOREIGN KEY (dispatcher_id) REFERENCES users(id)
        )
      `);
      // Copy existing data (use PRAGMA to get actual column list)
      const cfsCols = db.prepare("PRAGMA table_info(calls_for_service)").all() as any[];
      const cfsColNames = cfsCols.map((c: any) => c.name).join(', ');
      db.exec(`INSERT INTO calls_for_service_new (${cfsColNames}) SELECT ${cfsColNames} FROM calls_for_service`);
      db.exec(`DROP TABLE calls_for_service`);
      db.exec(`ALTER TABLE calls_for_service_new RENAME TO calls_for_service`);
      db.pragma('foreign_keys = ON');
      console.log('Migrated calls_for_service: source CHECK now includes patrol, online, dispatch, other');
    }
  } catch (err) {
    db.pragma('foreign_keys = ON');
    console.log('calls_for_service source migration skipped or already done:', (err as Error).message);
  }

  // ── calls_for_service — add 'panic' to source CHECK constraint ──────
  // The panic button needs source='panic' but it wasn't in the original list.
  try {
    const cfsSchema2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='calls_for_service'").get() as any;
    if (cfsSchema2 && cfsSchema2.sql && !cfsSchema2.sql.includes("'panic'")) {
      db.pragma('foreign_keys = OFF');
      db.exec(`DROP TABLE IF EXISTS calls_for_service_new`);
      // Rebuild with 'panic' added to the source CHECK constraint
      const currentSql = cfsSchema2.sql as string;
      const newSql = currentSql
        .replace('calls_for_service', 'calls_for_service_new')
        .replace(
          "source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','other')",
          "source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','panic','other')"
        );
      db.exec(newSql);
      const cfsCols2 = db.prepare("PRAGMA table_info(calls_for_service)").all() as any[];
      const cfsColNames2 = cfsCols2.map((c: any) => c.name).join(', ');
      db.exec(`INSERT INTO calls_for_service_new (${cfsColNames2}) SELECT ${cfsColNames2} FROM calls_for_service`);
      db.exec(`DROP TABLE calls_for_service`);
      db.exec(`ALTER TABLE calls_for_service_new RENAME TO calls_for_service`);
      db.pragma('foreign_keys = ON');
      console.log("Migrated calls_for_service: source CHECK now includes 'panic'");
    }
  } catch (err) {
    db.pragma('foreign_keys = ON');
    console.log('calls_for_service panic source migration skipped or already done:', (err as Error).message);
  }

  // ── calls_for_service — add 'on_hold' to status CHECK constraint ─────
  // Call hold/resume feature: dispatchers can put calls on hold (amber state).
  try {
    const cfsSchema3 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='calls_for_service'").get() as any;
    if (cfsSchema3 && cfsSchema3.sql && !cfsSchema3.sql.includes("'on_hold'")) {
      db.pragma('foreign_keys = OFF');
      db.exec(`DROP TABLE IF EXISTS calls_for_service_new`);
      const currentSql = cfsSchema3.sql as string;
      const newSql = currentSql
        .replace('calls_for_service', 'calls_for_service_new')
        .replace(
          "status IN ('pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived')",
          "status IN ('pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived','on_hold')"
        );
      db.exec(newSql);
      const cfsCols3 = db.prepare("PRAGMA table_info(calls_for_service)").all() as any[];
      const cfsColNames3 = cfsCols3.map((c: any) => c.name).join(', ');
      db.exec(`INSERT INTO calls_for_service_new (${cfsColNames3}) SELECT ${cfsColNames3} FROM calls_for_service`);
      db.exec(`DROP TABLE calls_for_service`);
      db.exec(`ALTER TABLE calls_for_service_new RENAME TO calls_for_service`);
      db.pragma('foreign_keys = ON');
      console.log("Migrated calls_for_service: status CHECK now includes 'on_hold'");
    }
  } catch (err) {
    db.pragma('foreign_keys = ON');
    console.log('calls_for_service on_hold status migration skipped or already done:', (err as Error).message);
  }

  // ── calls_for_service — add previous_status column for hold/resume ──
  addCol('calls_for_service', 'previous_status', 'TEXT');

  // ── INCIDENTS — new detail fields ─────────────────────
  addCol('incidents', 'occurred_date', 'TEXT');
  addCol('incidents', 'occurred_time', 'TEXT');
  addCol('incidents', 'end_date', 'TEXT');
  addCol('incidents', 'end_time', 'TEXT');
  addCol('incidents', 'weather_conditions', 'TEXT');
  addCol('incidents', 'lighting_conditions', 'TEXT');
  addCol('incidents', 'injuries', "INTEGER DEFAULT 0");
  addCol('incidents', 'injury_description', 'TEXT');
  addCol('incidents', 'damage_estimate', 'REAL');
  addCol('incidents', 'damage_description', 'TEXT');
  addCol('incidents', 'weapons_involved', 'TEXT');
  addCol('incidents', 'alcohol_involved', "INTEGER DEFAULT 0");
  addCol('incidents', 'drugs_involved', "INTEGER DEFAULT 0");
  addCol('incidents', 'domestic_violence', "INTEGER DEFAULT 0");
  addCol('incidents', 'review_notes', 'TEXT');
  addCol('incidents', 'disposition', 'TEXT');
  addCol('incidents', 'zone_beat', 'TEXT');
  addCol('incidents', 'section_id', 'TEXT');
  addCol('incidents', 'zone_id', 'TEXT');
  addCol('incidents', 'beat_id', 'TEXT');
  addCol('incidents', 'responding_le_agency', 'TEXT');
  addCol('incidents', 'le_case_number', 'TEXT');

  // ── INCIDENTS — sub-type-specific fields ────────────
  // Vehicle/Traffic
  addCol('incidents', 'road_conditions', 'TEXT');
  addCol('incidents', 'traffic_control', 'TEXT');
  addCol('incidents', 'vehicle_1_info', 'TEXT');
  addCol('incidents', 'vehicle_2_info', 'TEXT');
  addCol('incidents', 'diagram_notes', 'TEXT');
  // Medical
  addCol('incidents', 'patient_status', 'TEXT');
  addCol('incidents', 'ems_transport', 'TEXT');
  addCol('incidents', 'patient_vitals', 'TEXT');
  addCol('incidents', 'treatment_rendered', 'TEXT');
  // Trespass
  addCol('incidents', 'trespass_warning_issued', 'INTEGER DEFAULT 0');
  addCol('incidents', 'trespass_effective_date', 'TEXT');
  addCol('incidents', 'trespass_expiry_date', 'TEXT');
  addCol('incidents', 'property_boundaries', 'TEXT');
  // Use of Force
  addCol('incidents', 'force_type', 'TEXT');
  addCol('incidents', 'force_justification', 'TEXT');
  addCol('incidents', 'subject_injuries', 'TEXT');
  addCol('incidents', 'officer_injuries', 'TEXT');
  addCol('incidents', 'de_escalation_attempts', 'TEXT');

  // ── USERS / PERSONNEL — new profile fields ────────────
  addCol('users', 'first_name', 'TEXT');
  addCol('users', 'last_name', 'TEXT');
  addCol('users', 'middle_name', 'TEXT');
  addCol('users', 'date_of_birth', 'TEXT');
  addCol('users', 'ssn_last4', 'TEXT');
  addCol('users', 'address', 'TEXT');
  addCol('users', 'city', 'TEXT');
  addCol('users', 'state', 'TEXT');
  addCol('users', 'zip', 'TEXT');
  addCol('users', 'emergency_contact_name', 'TEXT');
  addCol('users', 'emergency_contact_phone', 'TEXT');
  addCol('users', 'emergency_contact_relationship', 'TEXT');
  addCol('users', 'hire_date', 'TEXT');
  addCol('users', 'termination_date', 'TEXT');
  addCol('users', 'rank', 'TEXT');
  addCol('users', 'department', 'TEXT');
  addCol('users', 'shift_preference', 'TEXT');
  addCol('users', 'dl_number', 'TEXT');
  addCol('users', 'dl_state', 'TEXT');
  addCol('users', 'dl_expiry', 'TEXT');
  addCol('users', 'blood_type', 'TEXT');
  addCol('users', 'allergies', 'TEXT');
  addCol('users', 'uniform_size', 'TEXT');
  addCol('users', 'employee_id', 'TEXT');
  addCol('users', 'certifications', 'TEXT');
  addCol('users', 'notes', 'TEXT');
  addCol('users', 'profile_image', 'TEXT');
  addCol('users', 'last_password_change', 'TEXT');
  addCol('users', 'login_count', 'INTEGER DEFAULT 0');
  addCol('users', 'last_login_at', 'TEXT');
  addCol('users', 'must_change_password', 'INTEGER DEFAULT 0');

  // ── USERS — Two-Factor Authentication (TOTP) ──────────
  addCol('users', 'totp_secret_enc', 'TEXT');              // AES-256-GCM encrypted TOTP secret
  addCol('users', 'totp_enabled', 'INTEGER DEFAULT 0');    // 0 = disabled, 1 = enabled
  addCol('users', 'totp_backup_codes', 'TEXT');            // JSON array of bcrypt-hashed one-time codes
  addCol('users', 'totp_pending_secret', 'TEXT');          // Temp secret during enrollment (before verify)

  // ── USERS — Password history & expiry ─────────────────
  addCol('users', 'password_history', 'TEXT');             // JSON array of previous bcrypt hashes
  addCol('users', 'password_changed_at', 'TEXT');          // ISO timestamp of last password change

  // ── USERS — Digital Signature (PNG base64 data URL) ──
  addCol('users', 'digital_signature', 'TEXT');            // base64 data:image/png;base64,... stored per officer

  // ── USERS — WebAuthn / YubiKey hardware key auth ──────
  addCol('users', 'webauthn_enabled', 'INTEGER DEFAULT 0'); // 0 = disabled, 1 = enabled

  // ── NOTIFICATIONS — widen type CHECK for login_alert / security ──
  try {
    // SQLite can't ALTER CHECK constraints, so recreate the table
    const hasLoginAlert = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='notifications'`
    ).get() as { sql: string } | undefined;
    if (hasLoginAlert?.sql && !hasLoginAlert.sql.includes('login_alert')) {
      db.exec(`
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
        INSERT INTO notifications_v2 SELECT * FROM notifications;
        DROP TABLE notifications;
        ALTER TABLE notifications_v2 RENAME TO notifications;
      `);
      console.log('[migrate] Widened notifications type constraint for login_alert/security');
    }
  } catch { /* Already migrated or table structure compatible */ }

  // ── CLIENTS — new contract fields ─────────────────────
  addCol('clients', 'billing_email', 'TEXT');
  addCol('clients', 'billing_address', 'TEXT');
  addCol('clients', 'contract_type', 'TEXT');
  addCol('clients', 'contract_value', 'REAL');
  addCol('clients', 'payment_terms', 'TEXT');
  addCol('clients', 'auto_renew', "INTEGER DEFAULT 0");
  addCol('clients', 'updated_at', "TEXT");
  addCol('clients', 'client_code', 'TEXT');
  addCol('clients', 'industry', 'TEXT');
  addCol('clients', 'website', 'TEXT');
  addCol('clients', 'tax_id', 'TEXT');
  addCol('clients', 'payment_method', 'TEXT');
  addCol('clients', 'billing_cycle', 'TEXT');
  addCol('clients', 'billing_day', 'INTEGER');
  addCol('clients', 'discount_percent', 'REAL DEFAULT 0');
  addCol('clients', 'late_fee_percent', 'REAL DEFAULT 0');
  addCol('clients', 'total_invoiced', 'REAL DEFAULT 0');
  addCol('clients', 'total_paid', 'REAL DEFAULT 0');
  addCol('clients', 'outstanding_balance', 'REAL DEFAULT 0');
  addCol('clients', 'incident_count', 'INTEGER DEFAULT 0');
  addCol('clients', 'last_incident_date', 'TEXT');
  addCol('clients', 'account_manager', 'TEXT');
  addCol('clients', 'priority_client', 'INTEGER DEFAULT 0');
  addCol('clients', 'client_since', 'TEXT');

  // ── UNITS — missing columns ────────────────────────────
  addCol('units', 'updated_at', "TEXT DEFAULT (datetime('now','localtime'))");
  addCol('units', 'gps_source', "TEXT DEFAULT 'browser'");

  // ── EVIDENCE — new chain-of-custody fields ────────────
  addCol('evidence', 'evidence_number', 'TEXT');
  addCol('evidence', 'location_found', 'TEXT');
  addCol('evidence', 'condition', 'TEXT');
  addCol('evidence', 'quantity', "INTEGER DEFAULT 1");
  addCol('evidence', 'release_authorized_by', 'TEXT');
  addCol('evidence', 'released_to', 'TEXT');
  addCol('evidence', 'release_date', 'TEXT');

  // ── EVIDENCE — extended detail fields ───────────────────
  addCol('evidence', 'collected_date', 'TEXT');
  addCol('evidence', 'packaging_type', 'TEXT');
  addCol('evidence', 'dimensions', 'TEXT');
  addCol('evidence', 'weight', 'TEXT');
  addCol('evidence', 'photo_taken', 'INTEGER DEFAULT 0');
  addCol('evidence', 'lab_submitted', 'INTEGER DEFAULT 0');
  addCol('evidence', 'lab_case_number', 'TEXT');
  addCol('evidence', 'lab_name', 'TEXT');
  addCol('evidence', 'disposal_method', 'TEXT');
  addCol('evidence', 'disposal_date', 'TEXT');
  addCol('evidence', 'disposal_authorized_by', 'TEXT');
  addCol('evidence', 'serial_number', 'TEXT');
  addCol('evidence', 'brand', 'TEXT');
  addCol('evidence', 'model', 'TEXT');
  addCol('evidence', 'estimated_value', 'REAL');
  addCol('evidence', 'category', 'TEXT');
  addCol('evidence', 'notes', 'TEXT');
  addCol('evidence', 'updated_at', 'TEXT');

  // ── PROPERTIES — new detail fields ─────────────────────
  addCol('properties', 'city', 'TEXT');
  addCol('properties', 'state', 'TEXT');
  addCol('properties', 'zip', 'TEXT');
  addCol('properties', 'access_instructions', 'TEXT');
  addCol('properties', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addCol('properties', 'updated_at', 'TEXT');

  // ── EVIDENCE — make incident_id nullable ──────────────
  // SQLite doesn't support ALTER COLUMN, so we rebuild the table with a hardcoded schema
  try {
    const evidenceSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='evidence'").get() as any;
    if (evidenceSchema && evidenceSchema.sql && evidenceSchema.sql.includes('incident_id INTEGER NOT NULL')) {
      db.exec(`DROP TABLE IF EXISTS evidence_new`);
      db.exec(`
        CREATE TABLE evidence_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          evidence_number TEXT,
          incident_id INTEGER,
          description TEXT,
          evidence_type TEXT,
          storage_location TEXT,
          collected_by INTEGER,
          status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_storage','submitted_to_le','released','disposed')),
          chain_of_custody TEXT DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          location_found TEXT,
          condition TEXT,
          quantity INTEGER DEFAULT 1,
          release_authorized_by TEXT,
          released_to TEXT,
          release_date TEXT,
          collected_date TEXT,
          packaging_type TEXT,
          dimensions TEXT,
          weight TEXT,
          photo_taken INTEGER DEFAULT 0,
          lab_submitted INTEGER DEFAULT 0,
          lab_case_number TEXT,
          lab_name TEXT,
          disposal_method TEXT,
          disposal_date TEXT,
          disposal_authorized_by TEXT,
          serial_number TEXT,
          brand TEXT,
          model TEXT,
          estimated_value REAL,
          category TEXT,
          archived_at TEXT,
          notes TEXT,
          updated_at TEXT,
          FOREIGN KEY (incident_id) REFERENCES incidents(id),
          FOREIGN KEY (collected_by) REFERENCES users(id)
        )
      `);
      // Copy existing data
      const cols = db.prepare("PRAGMA table_info(evidence)").all() as any[];
      const colNames = cols.map((c: any) => c.name).join(', ');
      db.exec(`INSERT INTO evidence_new (${colNames}) SELECT ${colNames} FROM evidence`);
      db.exec(`DROP TABLE evidence`);
      db.exec(`ALTER TABLE evidence_new RENAME TO evidence`);
      console.log('Migrated evidence table: incident_id now nullable');
    }
  } catch (err) {
    console.log('Evidence table migration skipped or already done:', (err as Error).message);
  }

  // ── RECORD LINKS — cross-record connections ───────────
  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  // ── CREDENTIALS — issuing authority ───────────────────
  addCol('credentials', 'issuing_authority', 'TEXT');

  // Auto-number evidence entries that don't have a number
  try {
    const rows = db.prepare("SELECT id FROM evidence WHERE evidence_number IS NULL OR evidence_number = ''").all() as any[];
    const yr = new Date().getFullYear();
    for (const row of rows) {
      const num = `EV-${yr}-${String(row.id).padStart(5, '0')}`;
      db.prepare("UPDATE evidence SET evidence_number = ? WHERE id = ?").run(num, row.id);
    }
  } catch { /* ignore */ }

  // Populate first_name / last_name from full_name for existing users
  try {
    const users = db.prepare("SELECT id, full_name, first_name FROM users WHERE first_name IS NULL OR first_name = ''").all() as any[];
    for (const u of users) {
      const parts = (u.full_name || '').trim().split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || '';
      db.prepare("UPDATE users SET first_name = ?, last_name = ? WHERE id = ?").run(firstName, lastName, u.id);
    }
  } catch { /* ignore */ }

  // ── INJURIES — fix INTEGER→TEXT mismatch ─────────────
  // Column was created as INTEGER but form sends TEXT values ('none','minor','major','fatal','unknown').
  // SQLite stores them fine regardless, but convert any leftover 0 values to 'none' for consistency.
  try {
    db.prepare("UPDATE incidents SET injuries = 'none' WHERE injuries = '0' OR injuries = 0 OR injuries IS NULL").run();
  } catch { /* ignore */ }

  // Migrate existing INC-YYYY-NNNNN and RMP- incident numbers to RKY format
  migrateIncidentNumbers(db);

  // ── TIME ENTRIES — break tracking fields ──────────────
  addCol('time_entries', 'break_start', 'TEXT');
  addCol('time_entries', 'break_minutes', 'REAL NOT NULL DEFAULT 0');

  // ── PATROL CHECKPOINTS — officer assignment + location text ───
  addCol('patrol_checkpoints', 'assigned_officer_id', 'INTEGER');
  addCol('patrol_checkpoints', 'location_description', 'TEXT');

  // ── ARCHIVE SUPPORT — add archived_at to all archivable tables ───
  const archiveTables = [
    'incidents', 'persons', 'vehicles_records', 'properties', 'evidence',
    'warrants', 'bolos',
    'fleet_vehicles', 'fleet_maintenance', 'fleet_fuel_logs', 'fleet_inspections',
    'users', 'schedules', 'credentials', 'training_records', 'deployments',
    'clients', 'supplemental_reports', 'patrol_checkpoints',
  ];
  for (const tbl of archiveTables) {
    addCol(tbl, 'archived_at', 'TEXT');
  }

  // ── MESSAGES — email format: subject, threading ────
  addCol('messages', 'subject', 'TEXT');
  addCol('messages', 'parent_id', 'INTEGER');
  addCol('messages', 'thread_id', 'INTEGER');

  // ── WARRANTS — statute linkage ────────────────────
  addCol('warrants', 'statute_id', 'INTEGER');
  addCol('warrants', 'statute_citation', 'TEXT');

  // ── UTAH STATUTES — criminal/vehicle code reference ──
  try {
    db.exec(`
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_statutes_citation ON utah_statutes(citation);
      CREATE INDEX IF NOT EXISTS idx_statutes_category ON utah_statutes(category);
      CREATE INDEX IF NOT EXISTS idx_statutes_title ON utah_statutes(title);
      CREATE INDEX IF NOT EXISTS idx_statutes_offense ON utah_statutes(offense_level);
    `);
  } catch { /* table/indexes already exist */ }

  // ── ENTITY_STATUTES — link statutes to warrants/incidents/calls ──
  try {
    db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_entity_statutes_entity ON entity_statutes(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_entity_statutes_statute ON entity_statutes(statute_id);
    `);
  } catch { /* table/indexes already exist */ }

  // ── UTAH STATUTES — citation fine amount for traffic/infractions ──
  addCol('utah_statutes', 'citation_fine', 'REAL');

  // Ensure the citation index is UNIQUE (needed for ON CONFLICT in seed)
  try {
    db.exec('DROP INDEX IF EXISTS idx_statutes_citation');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_statutes_citation ON utah_statutes(citation)');
  } catch { /* already unique */ }

  // ── INCIDENTS — statute linkage for charge/citation ──
  addCol('incidents', 'statute_id', 'INTEGER');
  addCol('incidents', 'statute_citation', 'TEXT');
  addCol('incidents', 'citation_fine', 'REAL');

  // ── PERSONS — separate height feet/inches fields ──
  addCol('persons', 'height_feet', 'INTEGER');
  addCol('persons', 'height_inches', 'INTEGER');

  // ── CITATIONS / SUMMONS TABLE ──────────────────────
  db.exec(`
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

  // ── CLIENT LINKAGE — direct client_id on CFS and incidents ──
  addCol('calls_for_service', 'client_id', 'INTEGER');
  addCol('incidents', 'client_id', 'INTEGER');

  // ── CLIENT BILLING RATES ──
  addCol('clients', 'rate_per_hour', 'REAL');
  addCol('clients', 'rate_per_incident', 'REAL');
  addCol('clients', 'rate_per_cfs', 'REAL');

  // ── INVOICES TABLE ─────────────────────────────────
  db.exec(`
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

  // ── INVOICE LINE ITEMS TABLE ───────────────────────
  db.exec(`
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

  // ── PAYMENTS TABLE ─────────────────────────────────
  db.exec(`
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

  // ── CLIENT_PERSONS — link persons to clients ──────────────
  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  // ── CRIMINAL_HISTORY — criminal records for persons ──────────────
  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  // ── Field Interview (FI) Cards ──
  try {
    db.exec(`
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
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fi_person ON field_interviews(person_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fi_officer ON field_interviews(officer_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fi_property ON field_interviews(property_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fi_created ON field_interviews(created_at)`);
  } catch { /* table already exists */ }

  // ── Trespass / Exclusion Orders ──
  try {
    db.exec(`
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
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_to_person ON trespass_orders(person_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_to_property ON trespass_orders(property_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_to_status ON trespass_orders(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_to_created ON trespass_orders(created_at)`);
  } catch { /* table already exists */ }

  // ── FIX CORRUPTED DATA — undo HTML entity encoding of quotes/apostrophes ──
  // The old sanitize middleware was encoding ' → &#x27; and " → &quot; in stored data
  const corruptionTables = ['persons', 'incidents', 'warrants', 'calls_for_service', 'bolos', 'vehicles_records', 'properties', 'clients'];
  for (const tbl of corruptionTables) {
    try {
      // Get all TEXT columns for this table
      const cols = db.prepare(`PRAGMA table_info(${tbl})`).all() as { name: string; type: string }[];
      const textCols = cols.filter(c => c.type.toUpperCase().includes('TEXT'));
      for (const col of textCols) {
        db.exec(`UPDATE ${tbl} SET ${col.name} = REPLACE(${col.name}, '&#x27;', '''') WHERE ${col.name} LIKE '%&#x27;%'`);
        db.exec(`UPDATE ${tbl} SET ${col.name} = REPLACE(${col.name}, '&quot;', '"') WHERE ${col.name} LIKE '%&quot;%'`);
        db.exec(`UPDATE ${tbl} SET ${col.name} = REPLACE(${col.name}, '&#039;', '''') WHERE ${col.name} LIKE '%&#039;%'`);
        db.exec(`UPDATE ${tbl} SET ${col.name} = REPLACE(${col.name}, '&amp;', '&') WHERE ${col.name} LIKE '%&amp;%'`);
      }
    } catch { /* table may not exist */ }
  }

  // ── TIME ENTRIES — add 'on_break' to CHECK constraint (production fix) ──
  // Production DBs created before 'on_break' was added to the schema still have the old
  // CHECK(status IN ('active','completed','edited')). Recreate the table to update.
  try {
    const teInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='time_entries'").get() as { sql: string } | undefined;
    if (teInfo && !teInfo.sql.includes('on_break')) {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE time_entries_new (
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
        )
      `);
      const teCols = db.prepare("PRAGMA table_info(time_entries)").all() as any[];
      const teColNames = teCols.map((c: any) => c.name).join(', ');
      db.exec(`INSERT INTO time_entries_new (${teColNames}) SELECT ${teColNames} FROM time_entries`);
      db.exec(`DROP TABLE time_entries`);
      db.exec(`ALTER TABLE time_entries_new RENAME TO time_entries`);
      db.pragma('foreign_keys = ON');
      console.log("Migrated time_entries: status CHECK now includes 'on_break'");
    }
  } catch (err) {
    try { db.pragma('foreign_keys = ON'); } catch {}
    console.log('time_entries CHECK migration skipped or already done:', (err as Error).message);
  }

  // ── CASES — investigative case management ──
  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  // ── FORENSIC LAB CASES — lab management for evidence analysis ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS forensic_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lab_case_number TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        case_type TEXT DEFAULT 'digital' CHECK(case_type IN (
          'digital','biological','chemical','ballistics','latent_prints',
          'questioned_documents','trace','toxicology','dna','firearms','other'
        )),
        status TEXT DEFAULT 'submitted' CHECK(status IN (
          'submitted','intake','assigned','in_progress','analysis_complete',
          'report_draft','report_final','closed','cancelled'
        )),
        priority TEXT DEFAULT 'routine' CHECK(priority IN ('routine','expedited','urgent','rush')),
        incident_id INTEGER,
        evidence_ids TEXT DEFAULT '[]',
        requesting_officer_id INTEGER,
        requesting_officer_name TEXT,
        assigned_examiner_id INTEGER,
        assigned_examiner_name TEXT,
        lab_location TEXT,
        synopsis TEXT,
        findings TEXT,
        conclusion TEXT,
        methodology TEXT,
        received_date TEXT DEFAULT (datetime('now','localtime')),
        due_date TEXT,
        started_date TEXT,
        completed_date TEXT,
        report_date TEXT,
        turnaround_days INTEGER,
        notes TEXT,
        created_by INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        archived_at TEXT,
        FOREIGN KEY (incident_id) REFERENCES incidents(id),
        FOREIGN KEY (requesting_officer_id) REFERENCES users(id),
        FOREIGN KEY (assigned_examiner_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_forensic_cases_status ON forensic_cases(status);
      CREATE INDEX IF NOT EXISTS idx_forensic_cases_examiner ON forensic_cases(assigned_examiner_id);
      CREATE INDEX IF NOT EXISTS idx_forensic_cases_number ON forensic_cases(lab_case_number);
    `);
  } catch { /* table already exists */ }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS forensic_exhibits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        forensic_case_id INTEGER NOT NULL,
        exhibit_number TEXT NOT NULL,
        evidence_id INTEGER,
        description TEXT NOT NULL,
        item_type TEXT,
        condition_received TEXT,
        examination_requested TEXT,
        examination_performed TEXT,
        results TEXT,
        status TEXT DEFAULT 'received' CHECK(status IN ('received','examining','complete','returned','disposed')),
        received_date TEXT DEFAULT (datetime('now','localtime')),
        returned_date TEXT,
        photos TEXT DEFAULT '[]',
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (forensic_case_id) REFERENCES forensic_cases(id) ON DELETE CASCADE,
        FOREIGN KEY (evidence_id) REFERENCES evidence(id)
      );
      CREATE INDEX IF NOT EXISTS idx_forensic_exhibits_case ON forensic_exhibits(forensic_case_id);
    `);
  } catch { /* table already exists */ }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS forensic_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        forensic_case_id INTEGER NOT NULL,
        exhibit_id INTEGER,
        analysis_type TEXT NOT NULL CHECK(analysis_type IN (
          'dna','fingerprint','drug_analysis','digital_extraction','ballistics',
          'document_analysis','trace_analysis','toxicology','tool_marks',
          'blood_spatter','fire_debris','serology','microscopy','photography','other'
        )),
        examiner_id INTEGER,
        examiner_name TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','complete','inconclusive','cancelled')),
        methodology TEXT,
        instruments_used TEXT,
        results TEXT,
        conclusion TEXT,
        started_at TEXT,
        completed_at TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (forensic_case_id) REFERENCES forensic_cases(id) ON DELETE CASCADE,
        FOREIGN KEY (exhibit_id) REFERENCES forensic_exhibits(id),
        FOREIGN KEY (examiner_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_forensic_analyses_case ON forensic_analyses(forensic_case_id);
    `);
  } catch { /* table already exists */ }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS forensic_timeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        forensic_case_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        description TEXT,
        performed_by INTEGER,
        performed_by_name TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (forensic_case_id) REFERENCES forensic_cases(id) ON DELETE CASCADE,
        FOREIGN KEY (performed_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_forensic_timeline_case ON forensic_timeline(forensic_case_id);
    `);
  } catch { /* table already exists */ }

  // ── CODE VIOLATIONS — municipal code enforcement ──
  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  // ── VEHICLE TOWS — tow tracking and lifecycle ──
  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  // ── COURT EVENTS — court date and legal tracking ──
  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  // ── DAILY ACTIVITY REPORTS — structured shift reports ──
  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  // ── OFFENDER ALERTS — known offender registry ──
  try {
    db.exec(`
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
    `);
  } catch { /* table already exists */ }

  // ── Migrate existing height text into feet/inches ──
  try {
    const persons = db.prepare("SELECT id, height FROM persons WHERE height IS NOT NULL AND height != '' AND height_feet IS NULL").all() as { id: number; height: string }[];
    for (const p of persons) {
      // Parse patterns like "6'2", "5'11\"", "5'-02", "6'02", "510" (5ft 10in)
      const h = p.height.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/[""]/g, '');
      const match = h.match(/(\d+)\s*['\-]\s*(\d{1,2})/);
      if (match) {
        const feet = parseInt(match[1], 10);
        const inches = parseInt(match[2], 10);
        if (feet >= 1 && feet <= 8 && inches >= 0 && inches <= 11) {
          db.prepare('UPDATE persons SET height_feet = ?, height_inches = ? WHERE id = ?').run(feet, inches, p.id);
        }
      }
    }
  } catch { /* ignore parse errors */ }

  // ── gps_breadcrumbs — road name and cross-street columns ──
  addCol('gps_breadcrumbs', 'road_name', 'TEXT');
  addCol('gps_breadcrumbs', 'nearest_intersection', 'TEXT');
  addCol('gps_breadcrumbs', 'gps_source', "TEXT DEFAULT 'browser'");

  // ── gps_breadcrumbs — position source (gps/wifi/ip/unknown) ──
  // Tracks how each breadcrumb position was obtained for audit trail visibility
  // on maps. WiFi/IP points have reduced accuracy vs hardware GPS.
  addCol('gps_breadcrumbs', 'source', "TEXT DEFAULT 'unknown'");

  // ── Async backfill: geocode past breadcrumbs missing road/cross-street data ──
  // Runs in the background after startup so it doesn't block the server.
  // Samples distinct locations (rounded to ~100m grid) to minimize API calls.
  const breadcrumbsNeedingGeocode = db.prepare(`
    SELECT COUNT(*) as cnt FROM gps_breadcrumbs
    WHERE road_name IS NULL AND latitude IS NOT NULL
  `).get() as any;

  if (breadcrumbsNeedingGeocode?.cnt > 0) {
    console.log(`[migrate] ${breadcrumbsNeedingGeocode.cnt} breadcrumbs need road/cross-street data — backfilling async...`);

    // Kick off async backfill after a short delay to let the server finish starting
    setTimeout(() => backfillBreadcrumbRoads(), 10_000);
  }

  // ── Backfill beat/zone/sector for calls & incidents with GPS but no beat ──
  try {
    const callsToBackfill = db.prepare(`
      SELECT id, latitude, longitude FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND (beat_id IS NULL OR beat_id = '')
    `).all() as any[];

    if (callsToBackfill.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE calls_for_service SET beat_id = ?, zone_id = ?, section_id = ?, zone_beat = ?
        WHERE id = ?
      `);
      let filled = 0;
      for (const c of callsToBackfill) {
        try {
          const beat = identifyBeat(c.latitude, c.longitude);
          if (beat) {
            updateStmt.run(
              beat.beat_id,
              `${beat.city} ${beat.district_letter}${beat.beat_number}`,
              beat.district_letter,
              beat.beat_code,
              c.id
            );
            filled++;
          }
        } catch { /* skip individual failures */ }
      }
      if (filled > 0) console.log(`[migrate] Backfilled beat/zone for ${filled} calls`);
    }

    const incidentsToBackfill = db.prepare(`
      SELECT id, latitude, longitude FROM incidents
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND (beat_id IS NULL OR beat_id = '')
    `).all() as any[];

    if (incidentsToBackfill.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE incidents SET beat_id = ?, zone_id = ?, section_id = ?, zone_beat = ?
        WHERE id = ?
      `);
      let filled = 0;
      for (const inc of incidentsToBackfill) {
        try {
          const beat = identifyBeat(inc.latitude, inc.longitude);
          if (beat) {
            updateStmt.run(
              beat.beat_id,
              `${beat.city} ${beat.district_letter}${beat.beat_number}`,
              beat.district_letter,
              beat.beat_code,
              inc.id
            );
            filled++;
          }
        } catch { /* skip */ }
      }
      if (filled > 0) console.log(`[migrate] Backfilled beat/zone for ${filled} incidents`);
    }
  } catch (err) {
    console.log('[migrate] Beat/zone backfill skipped:', (err as Error).message);
  }

  // ── DISPATCH DISTRICTS — 3-Tier lookup table ───────────────
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dispatch_districts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id TEXT NOT NULL,
        zone_id TEXT NOT NULL,
        beat_id TEXT NOT NULL,
        dispatch_code TEXT NOT NULL UNIQUE,
        section_name TEXT NOT NULL,
        zone_name TEXT NOT NULL,
        beat_name TEXT NOT NULL,
        beat_descriptor TEXT
      )
    `);
  } catch { /* already exists */ }

  // Seed dispatch_districts if empty
  try {
    const districtCount = db.prepare('SELECT COUNT(*) as cnt FROM dispatch_districts').get() as any;
    if (districtCount?.cnt === 0) {
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO dispatch_districts (section_id, zone_id, beat_id, dispatch_code, section_name, zone_name, beat_name, beat_descriptor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const d of DISPATCH_DISTRICTS) {
        insertStmt.run(d.section_id, d.zone_id, d.beat_id, d.dispatch_code, d.section_name, d.zone_name, d.beat_name, d.beat_descriptor);
      }
      console.log(`[migrate] Seeded ${DISPATCH_DISTRICTS.length} dispatch districts from 3-tier data`);
    }
  } catch (err) {
    console.log('[migrate] dispatch_districts seed skipped:', (err as Error).message);
  }

  // ── FLEET — fuel log enrichment for Simply Fleet imports ──
  addCol('fleet_fuel_logs', 'distance', 'REAL');
  addCol('fleet_fuel_logs', 'efficiency', 'REAL');
  addCol('fleet_fuel_logs', 'source', "TEXT DEFAULT 'manual'");

  // ── FLEET — maintenance labor cost tracking ──────────────
  addCol('fleet_maintenance', 'labor_cost', 'REAL');
  addCol('fleet_maintenance', 'service_tasks', 'TEXT');
  addCol('fleet_maintenance', 'source', "TEXT DEFAULT 'manual'");

  // ── CALLS_FOR_SERVICE — unit mileage tracking ──────────────
  addCol('calls_for_service', 'starting_mileage', 'REAL');
  addCol('calls_for_service', 'ending_mileage', 'REAL');

  // ── DISPATCH ↔ CASE bidirectional linkage ──────────────────
  addCol('calls_for_service', 'case_id', 'INTEGER');
  addCol('calls_for_service', 'case_number', 'TEXT');
  addCol('calls_for_service', 'dispatch_code', 'TEXT');
  addCol('cases', 'linked_calls', "TEXT DEFAULT '[]'");

  // ── Dispatch district name fields on calls (green columns) ──
  addCol('calls_for_service', 'section_name', 'TEXT');
  addCol('calls_for_service', 'zone_name', 'TEXT');
  addCol('calls_for_service', 'beat_name', 'TEXT');
  addCol('calls_for_service', 'beat_descriptor', 'TEXT');

  // ── Contract ID for PSO Client Request incidents ──
  addCol('calls_for_service', 'contract_id', 'TEXT');
  addCol('incidents', 'contract_id', 'TEXT');

  // ── Additional operational flags for calls and incidents ──
  const flagTables = ['calls_for_service', 'incidents'] as const;
  for (const tbl of flagTables) {
    addCol(tbl, 'mental_health_crisis', 'INTEGER DEFAULT 0');
    addCol(tbl, 'juvenile_involved', 'INTEGER DEFAULT 0');
    addCol(tbl, 'felony_in_progress', 'INTEGER DEFAULT 0');
    addCol(tbl, 'officer_safety_caution', 'INTEGER DEFAULT 0');
    addCol(tbl, 'k9_requested', 'INTEGER DEFAULT 0');
    addCol(tbl, 'ems_requested', 'INTEGER DEFAULT 0');
    addCol(tbl, 'fire_requested', 'INTEGER DEFAULT 0');
    addCol(tbl, 'hazmat', 'INTEGER DEFAULT 0');
    addCol(tbl, 'gang_related', 'INTEGER DEFAULT 0');
    addCol(tbl, 'evidence_collected', 'INTEGER DEFAULT 0');
    addCol(tbl, 'body_camera_active', 'INTEGER DEFAULT 0');
    addCol(tbl, 'photos_taken', 'INTEGER DEFAULT 0');
    addCol(tbl, 'trespass_issued', 'INTEGER DEFAULT 0');
    addCol(tbl, 'vehicle_pursuit', 'INTEGER DEFAULT 0');
    addCol(tbl, 'foot_pursuit', 'INTEGER DEFAULT 0');
  }

  // ── PSO / Process Service fields ────────────────────────────
  for (const tbl of flagTables) {
    addCol(tbl, 'pso_requestor_name', 'TEXT');
    addCol(tbl, 'pso_requestor_phone', 'TEXT');
    addCol(tbl, 'pso_requestor_email', 'TEXT');
    addCol(tbl, 'pso_service_type', 'TEXT');        // patrol, standing_post, escort, process_service, alarm_response, event_security
    addCol(tbl, 'pso_billing_code', 'TEXT');
    addCol(tbl, 'pso_authorization', 'TEXT');        // auth/PO number from client
  }
  // Process service specific
  addCol('calls_for_service', 'process_service_type', 'TEXT'); // subpoena, summons, complaint, eviction, restraining_order, other
  addCol('calls_for_service', 'process_served_to', 'TEXT');
  addCol('calls_for_service', 'process_served_address', 'TEXT');
  addCol('calls_for_service', 'process_attempts', 'INTEGER DEFAULT 0');
  addCol('calls_for_service', 'process_served_at', 'TEXT');
  addCol('calls_for_service', 'process_service_result', 'TEXT'); // served, unable_to_serve, refused, substitute_service

  // ── Backfill dispatch district names on existing calls ──────────
  try {
    const callsNeedingDistrict = db.prepare(`
      SELECT c.id, c.section_id, c.zone_id, c.beat_id
      FROM calls_for_service c
      WHERE c.dispatch_code IS NULL AND c.section_id IS NOT NULL AND c.section_id != ''
    `).all() as any[];

    if (callsNeedingDistrict.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE calls_for_service
        SET dispatch_code = ?, section_name = ?, zone_name = ?, beat_name = ?, beat_descriptor = ?
        WHERE id = ?
      `);

      for (const call of callsNeedingDistrict) {
        // Look up the district by section_id — need to find matching zone_id (stored as zone_name in old data)
        const district = db.prepare(
          `SELECT * FROM dispatch_districts WHERE section_id = ? LIMIT 1`
        ).get(call.section_id) as any;

        if (district) {
          updateStmt.run(
            district.dispatch_code, district.section_name,
            district.zone_name, district.beat_name, district.beat_descriptor,
            call.id,
          );
        }
      }
      if (callsNeedingDistrict.length > 0) {
        console.log(`  Backfilled dispatch district data on ${callsNeedingDistrict.length} calls`);
      }
    }
  } catch { /* safe to ignore */ }

  // ── Migrate existing case numbers to YY-######-XX format ──────
  try {
    const oldCases = db.prepare(
      "SELECT id, case_number, case_type FROM cases WHERE case_number LIKE 'CASE-%'"
    ).all() as { id: number; case_number: string; case_type: string }[];

    for (const c of oldCases) {
      const match = c.case_number.match(/CASE-(\d{4})-(\d+)/);
      if (match) {
        const yy = match[1].slice(-2);
        const seq = String(parseInt(match[2], 10)).padStart(6, '0');
        const caseTypeCodes: Record<string, string> = {
          general: 'GN', criminal: 'CR', traffic: 'TR', medical: 'MD',
          security: 'SE', disorder: 'DS', service: 'SV', fire: 'FR',
          admin: 'AD', civil: 'CV', use_of_force: 'UF', property: 'PR',
          missing_person: 'MP', narcotics: 'NR', fraud: 'FD', juvenile: 'JV',
          domestic: 'DM', accident: 'AC', death: 'DT', theft: 'TH',
          assault: 'AS', burglary: 'BG', other: 'OT',
        };
        const typeCode = caseTypeCodes[c.case_type] || 'GN';
        const newNumber = `${yy}-${seq}-${typeCode}`;
        db.prepare('UPDATE cases SET case_number = ? WHERE id = ?').run(newNumber, c.id);
      }
    }
    if (oldCases.length > 0) {
      console.log(`  Migrated ${oldCases.length} case numbers to YY-######-XX format`);
    }
  } catch { /* safe to ignore */ }

  // ── ONE-TIME DATA CLEANUP: Remove specific breadcrumb entries ──
  try {
    db.prepare(`
      DELETE FROM gps_breadcrumbs
      WHERE (recorded_at LIKE '2026-02-27 07:14:46%' AND latitude BETWEEN 37.785 AND 37.786)
         OR (recorded_at LIKE '2026-02-27 17:03:49%' AND latitude BETWEEN 40.723 AND 40.725)
         OR (recorded_at LIKE '2026-02-27 17:04:32%' AND latitude BETWEEN 40.723 AND 40.725)
         OR (recorded_at LIKE '2026-02-28 23:04:12%' AND latitude BETWEEN 40.694 AND 40.695)
    `).run();
  } catch { /* table may not exist yet — safe to ignore */ }

  // ── WEBAUTHN CREDENTIALS -- FIDO2/YubiKey hardware keys ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        sign_count INTEGER NOT NULL DEFAULT 0,
        device_name TEXT DEFAULT 'Security Key',
        transports TEXT DEFAULT '[]',
        device_type TEXT DEFAULT 'unknown',
        backed_up INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
      CREATE INDEX IF NOT EXISTS idx_webauthn_cred_id ON webauthn_credentials(credential_id);
    `);
  } catch { /* table already exists */ }

  // ── CLEARPATHGPS -- enriched device data (vehicle info, ignition, odometer) ──
  addCol('cpg_device_mappings', 'vehicle_make', 'TEXT');
  addCol('cpg_device_mappings', 'vehicle_model', 'TEXT');
  addCol('cpg_device_mappings', 'vehicle_vin', 'TEXT');
  addCol('cpg_device_mappings', 'license_plate', 'TEXT');
  addCol('cpg_device_mappings', 'ignition_state', 'TEXT');
  addCol('cpg_device_mappings', 'last_odometer', 'REAL');
  addCol('cpg_device_mappings', 'driver_name', 'TEXT');
  addCol('cpg_device_mappings', 'gts_device_id', 'TEXT');

  // ── CLEARPATHGPS -- enriched breadcrumb data ──
  addCol('gps_breadcrumbs', 'odometer', 'REAL');
  addCol('gps_breadcrumbs', 'satellite_count', 'INTEGER');
  addCol('gps_breadcrumbs', 'ignition', 'INTEGER');

  // ── CLEARPATHGPS -- enriched dashcam event data ──
  addCol('dashcam_events', 'odometer', 'REAL');
  addCol('dashcam_events', 'ignition', 'INTEGER');
  addCol('dashcam_events', 'driver_name', 'TEXT');
  addCol('dashcam_events', 'city', 'TEXT');
  addCol('dashcam_events', 'state_province', 'TEXT');
  addCol('dashcam_events', 'satellite_count', 'INTEGER');

  // ── OFAC tables -- fix column names to match Treasury CSV format ──
  try {
    const aliasInfo = db.prepare("PRAGMA table_info(ofac_sdn_aliases)").all() as any[];
    const hasOldName = aliasInfo.some((c: any) => c.name === 'alias_name');
    if (hasOldName) {
      db.prepare('DROP TABLE IF EXISTS ofac_sdn_ids').run();
      db.prepare('DROP TABLE IF EXISTS ofac_sdn_addresses').run();
      db.prepare('DROP TABLE IF EXISTS ofac_sdn_aliases').run();
      db.prepare('DROP TABLE IF EXISTS ofac_sdn_entries').run();
      db.prepare('DROP TABLE IF EXISTS ofac_sync_log').run();
      // Recreate with correct schema
      createTables();
      console.log('[migrate] Recreated OFAC tables with corrected column names');
    }
  } catch { /* tables may not exist yet */ }

  addCol('ofac_sdn_addresses', 'add_num', 'INTEGER');
  addCol('ofac_sdn_addresses', 'add_remarks', 'TEXT');
  addCol('ofac_sdn_ids', 'remarks', 'TEXT');

  // ── OFAC consolidated sanctions -- add source_list column ──
  addCol('ofac_sdn_entries', 'source_list', "TEXT DEFAULT 'SDN'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ofac_source_list ON ofac_sdn_entries(source_list)");

  // ── Person watchlist auto-screening flag ──
  addCol('persons', 'watchlist_match', 'TEXT DEFAULT NULL');
  addCol('persons', 'watchlist_checked_at', 'TEXT DEFAULT NULL');

  // ── Security / 2FA columns ──────────────────────────
  addCol('users', 'totp_enabled', 'INTEGER DEFAULT 0');
  addCol('users', 'totp_setup_required', 'INTEGER DEFAULT 1');
  addCol('users', 'password_expires_at', 'TEXT');
  addCol('users', 'force_password_change', 'INTEGER DEFAULT 0');
  addCol('users', 'password_changed_at', 'TEXT');

  addCol('login_attempts', 'user_agent', 'TEXT');
  addCol('login_attempts', 'device_fingerprint', 'TEXT');

  addCol('sessions', 'device_fingerprint', 'TEXT');
  addCol('sessions', 'device_name', 'TEXT');

  // ── ARREST RECORDS -- JailBase county arrest data tables ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS arrest_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jailbase_id TEXT,
        source_id TEXT,
        source_name TEXT,
        full_name TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        middle_name TEXT,
        date_of_birth TEXT,
        booking_date TEXT,
        release_date TEXT,
        charges TEXT,
        mugshot_url TEXT,
        details_url TEXT,
        county TEXT,
        status TEXT DEFAULT 'active',
        raw_record TEXT,
        fetched_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(jailbase_id, source_id)
      );
      CREATE INDEX IF NOT EXISTS idx_arrest_full_name ON arrest_records(full_name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_arrest_last_name ON arrest_records(last_name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_arrest_first_name ON arrest_records(first_name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_arrest_booking ON arrest_records(booking_date);
      CREATE INDEX IF NOT EXISTS idx_arrest_source ON arrest_records(source_id);
      CREATE INDEX IF NOT EXISTS idx_arrest_county ON arrest_records(county);

      CREATE TABLE IF NOT EXISTS arrest_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT,
        records_count INTEGER DEFAULT 0,
        counties_synced INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        duration_ms INTEGER,
        synced_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS arrest_cross_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        arrest_record_id INTEGER NOT NULL,
        linked_type TEXT NOT NULL,
        linked_id INTEGER NOT NULL,
        match_type TEXT DEFAULT 'name',
        match_confidence REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (arrest_record_id) REFERENCES arrest_records(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_crosslink_arrest ON arrest_cross_links(arrest_record_id);
      CREATE INDEX IF NOT EXISTS idx_crosslink_type ON arrest_cross_links(linked_type, linked_id);
    `);
  } catch { /* tables already exist */ }

  // ── ARREST / JAIL ROSTER — manual entry columns ──
  addCol('arrest_records', 'booking_number', 'TEXT');
  addCol('arrest_records', 'agency', 'TEXT');
  addCol('arrest_records', 'gender', 'TEXT');
  addCol('arrest_records', 'race', 'TEXT');
  addCol('arrest_records', 'height', 'TEXT');
  addCol('arrest_records', 'weight', 'TEXT');
  addCol('arrest_records', 'hair_color', 'TEXT');
  addCol('arrest_records', 'eye_color', 'TEXT');
  addCol('arrest_records', 'address', 'TEXT');
  addCol('arrest_records', 'bail_amount', 'REAL');
  addCol('arrest_records', 'hold_reason', 'TEXT');
  addCol('arrest_records', 'notes', 'TEXT');
  addCol('arrest_records', 'entry_source', "TEXT DEFAULT 'api'");
  addCol('arrest_records', 'entered_by', 'INTEGER');
  addCol('arrest_records', 'created_at', "TEXT DEFAULT (datetime('now','localtime'))");
  addCol('arrest_records', 'detail_fetched', 'INTEGER DEFAULT 0');
  addCol('arrest_records', 'person_id', 'INTEGER');  // Manual link to persons table

  // ── Jail Roster Scraper seed data ──
  try {
    const hasConfig = db.prepare("SELECT COUNT(*) as cnt FROM jail_roster_config").get() as any;
    if (!hasConfig || hasConfig.cnt === 0) {
      db.prepare(`INSERT OR IGNORE INTO jail_roster_config (county, display_name, roster_url, roster_type, enabled) VALUES
        ('weber', 'Weber County', 'https://www.webercountyutah.gov/sheriff/roster/index.php', 'html', 1),
        ('davis', 'Davis County', 'https://www.daviscountyutah.gov/sheriff/inmate-roster', 'html', 0),
        ('iron', 'Iron County', 'https://api2025.ironcounty.net/inmate-bookings', 'json', 0),
        ('uinta', 'Uinta County', 'https://inmateroster.uintacounty.com/CURRENT_INMATE_LIST.pdf', 'pdf', 0),
        ('summit', 'Summit County', 'https://www.summitcountysheriff.org/DocumentCenter/View/24970/Inmates20250305', 'pdf', 0),
        ('salt_lake', 'Salt Lake County', 'https://iml.saltlakecounty.gov/IML', 'html', 0)
      `).run();
    }
  } catch { /* table may already be seeded */ }

  // ── IPED Digital Forensics tables ──
  addCol('evidence', 'iped_processed', 'INTEGER DEFAULT 0');
  addCol('evidence', 'iped_last_job_id', 'INTEGER');
  addCol('evidence', 'hash_count', 'INTEGER DEFAULT 0');
  addCol('evidence', 'flagged_hash_count', 'INTEGER DEFAULT 0');

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS iped_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        evidence_id INTEGER,
        job_type TEXT NOT NULL CHECK(job_type IN ('hash','process','triage','csam_scan')),
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
        profile TEXT DEFAULT 'forensic',
        input_path TEXT NOT NULL,
        output_path TEXT,
        source_type TEXT,
        started_at TEXT,
        completed_at TEXT,
        progress_percent INTEGER DEFAULT 0,
        items_found INTEGER DEFAULT 0,
        items_processed INTEGER DEFAULT 0,
        error_message TEXT,
        result_summary TEXT,
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (evidence_id) REFERENCES evidence(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_iped_jobs_evidence ON iped_jobs(evidence_id);
      CREATE INDEX IF NOT EXISTS idx_iped_jobs_status ON iped_jobs(status);

      CREATE TABLE IF NOT EXISTS digital_evidence_hashes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        evidence_id INTEGER,
        attachment_id INTEGER,
        iped_job_id INTEGER,
        file_name TEXT NOT NULL,
        file_path TEXT,
        file_size INTEGER,
        mime_type TEXT,
        md5 TEXT,
        sha1 TEXT,
        sha256 TEXT,
        sha512 TEXT,
        photodna_hash TEXT,
        phash TEXT,
        dhash TEXT,
        hash_set_match INTEGER DEFAULT 0,
        hash_set_name TEXT,
        hash_set_category TEXT,
        match_confidence REAL,
        flagged INTEGER DEFAULT 0,
        flag_reason TEXT,
        reviewed_by INTEGER,
        reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (evidence_id) REFERENCES evidence(id),
        FOREIGN KEY (attachment_id) REFERENCES attachments(id),
        FOREIGN KEY (iped_job_id) REFERENCES iped_jobs(id),
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_deh_evidence_id ON digital_evidence_hashes(evidence_id);
      CREATE INDEX IF NOT EXISTS idx_deh_md5 ON digital_evidence_hashes(md5);
      CREATE INDEX IF NOT EXISTS idx_deh_sha256 ON digital_evidence_hashes(sha256);
      CREATE INDEX IF NOT EXISTS idx_deh_photodna ON digital_evidence_hashes(photodna_hash);
      CREATE INDEX IF NOT EXISTS idx_deh_flagged ON digital_evidence_hashes(flagged);
    `);
  } catch { /* tables already exist */ }

  // ── VIDEO OVERLAY -- bodycam overlay processing columns ──
  addCol('bodycam_videos', 'overlay_status', "TEXT DEFAULT 'pending'");
  addCol('bodycam_videos', 'processed_file_path', 'TEXT');
  addCol('bodycam_videos', 'overlay_error', 'TEXT');

  // ── DASHCAM VIDEOS -- add vehicle_id + overlay columns (table may exist from ClearPathGPS) ──
  addCol('dashcam_videos', 'vehicle_id', 'INTEGER');
  addCol('dashcam_videos', 'overlay_status', "TEXT DEFAULT 'pending'");
  addCol('dashcam_videos', 'processed_file_path', 'TEXT');
  addCol('dashcam_videos', 'overlay_error', 'TEXT');

  // ── DIGITAL EVIDENCE HASHES — link to forensic cases/exhibits ──
  addCol('digital_evidence_hashes', 'forensic_case_id', 'INTEGER');
  addCol('digital_evidence_hashes', 'exhibit_id', 'INTEGER');
  addCol('digital_evidence_hashes', 'notes', 'TEXT');
  addCol('digital_evidence_hashes', 'updated_at', "TEXT");
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_deh_forensic_case ON digital_evidence_hashes(forensic_case_id)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_deh_exhibit ON digital_evidence_hashes(exhibit_id)'); } catch {}

  // ── FORENSIC CASE LINKS — universal cross-module evidence linkage ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS forensic_case_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        forensic_case_id INTEGER NOT NULL,
        linked_type TEXT NOT NULL CHECK(linked_type IN (
          'bodycam_video','dashcam_video','evidence','attachment',
          'incident','supplemental_report','case','radio_transcript',
          'field_interview','citation','daily_activity_report'
        )),
        linked_id INTEGER NOT NULL,
        relationship TEXT DEFAULT 'associated' CHECK(relationship IN (
          'associated','primary_evidence','supporting','reference',
          'chain_of_custody','suspect_device','victim_device','witness_statement',
          'forensic_source','comparison_sample'
        )),
        relevance TEXT DEFAULT 'standard' CHECK(relevance IN ('critical','high','standard','low','reference_only')),
        notes TEXT,
        linked_by INTEGER NOT NULL,
        linked_by_name TEXT,
        linked_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (forensic_case_id) REFERENCES forensic_cases(id) ON DELETE CASCADE,
        FOREIGN KEY (linked_by) REFERENCES users(id),
        UNIQUE(forensic_case_id, linked_type, linked_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fcl_case ON forensic_case_links(forensic_case_id);
      CREATE INDEX IF NOT EXISTS idx_fcl_type_id ON forensic_case_links(linked_type, linked_id);
    `);
  } catch { /* table already exists */ }

  console.log('Schema migration completed.');
}

/**
 * Async backfill: geocode past breadcrumbs that are missing road/cross-street data.
 * Groups breadcrumbs by approximate location (~100m grid cells) and geocodes
 * one representative point per cell, then applies the result to all nearby points.
 * Capped at 200 API calls per run to avoid quota exhaustion.
 */
async function backfillBreadcrumbRoads(): Promise<void> {
  try {
    // Find distinct approximate locations that need geocoding
    // Round to ~100m grid (0.001 degrees ≈ 111m)
    const distinctLocations = db.prepare(`
      SELECT
        ROUND(latitude, 3) as lat_r,
        ROUND(longitude, 3) as lng_r,
        AVG(latitude) as lat_avg,
        AVG(longitude) as lng_avg,
        COUNT(*) as cnt
      FROM gps_breadcrumbs
      WHERE road_name IS NULL AND latitude IS NOT NULL
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      ORDER BY cnt DESC
      LIMIT 200
    `).all() as any[];

    if (distinctLocations.length === 0) {
      console.log('[backfill] No breadcrumbs need road data');
      return;
    }

    console.log(`[backfill] Geocoding ${distinctLocations.length} distinct locations for ${distinctLocations.reduce((s: number, l: any) => s + l.cnt, 0)} breadcrumbs...`);

    const updateStmt = db.prepare(`
      UPDATE gps_breadcrumbs
      SET road_name = ?, nearest_intersection = ?
      WHERE road_name IS NULL
        AND ROUND(latitude, 3) = ? AND ROUND(longitude, 3) = ?
    `);

    let filled = 0;
    let apiCalls = 0;

    for (const loc of distinctLocations) {
      try {
        const geo = await reverseGeocodeDetailed(loc.lat_avg, loc.lng_avg);
        apiCalls++;

        if (geo && (geo.road_name || geo.nearest_intersection)) {
          const result = updateStmt.run(
            geo.road_name, geo.nearest_intersection,
            loc.lat_r, loc.lng_r
          );
          filled += result.changes;
        }

        // Small delay between API calls to avoid rate limiting (50ms)
        if (apiCalls % 10 === 0) {
          await new Promise(r => setTimeout(r, 200));
        }
      } catch {
        // Skip individual failures
      }
    }

    if (filled > 0) {
      console.log(`[backfill] Updated ${filled} breadcrumbs with road/cross-street data (${apiCalls} API calls)`);
    } else {
      console.log(`[backfill] No road data found for any locations (${apiCalls} API calls)`);
    }
  } catch (err) {
    console.error('[backfill] Breadcrumb road backfill error:', (err as Error).message);
  }
}

function createIndexes(): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_users_badge ON users(badge_number);

    CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

    CREATE INDEX IF NOT EXISTS idx_properties_client ON properties(client_id);

    CREATE INDEX IF NOT EXISTS idx_cfs_call_number ON calls_for_service(call_number);
    CREATE INDEX IF NOT EXISTS idx_cfs_status ON calls_for_service(status);
    CREATE INDEX IF NOT EXISTS idx_cfs_priority ON calls_for_service(priority);
    CREATE INDEX IF NOT EXISTS idx_cfs_created ON calls_for_service(created_at);
    CREATE INDEX IF NOT EXISTS idx_cfs_property ON calls_for_service(property_id);
    CREATE INDEX IF NOT EXISTS idx_cfs_dispatcher ON calls_for_service(dispatcher_id);

    CREATE INDEX IF NOT EXISTS idx_units_status ON units(status);
    CREATE INDEX IF NOT EXISTS idx_units_officer ON units(officer_id);
    CREATE INDEX IF NOT EXISTS idx_units_call ON units(current_call_id);

    CREATE INDEX IF NOT EXISTS idx_incidents_number ON incidents(incident_number);
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_officer ON incidents(officer_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at);
    CREATE INDEX IF NOT EXISTS idx_incidents_call ON incidents(call_id);

    CREATE INDEX IF NOT EXISTS idx_persons_name ON persons(last_name, first_name);
    CREATE INDEX IF NOT EXISTS idx_persons_dob ON persons(dob);

    CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles_records(plate_number);
    CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles_records(vin);

    CREATE INDEX IF NOT EXISTS idx_bolos_status ON bolos(status);
    CREATE INDEX IF NOT EXISTS idx_bolos_created ON bolos(created_at);

    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

    CREATE INDEX IF NOT EXISTS idx_evidence_incident ON evidence(incident_id);

    CREATE INDEX IF NOT EXISTS idx_schedules_officer ON schedules(officer_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(shift_date);
    CREATE INDEX IF NOT EXISTS idx_schedules_property ON schedules(property_id);

    CREATE INDEX IF NOT EXISTS idx_time_entries_officer ON time_entries(officer_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_status ON time_entries(status);

    CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);

    CREATE INDEX IF NOT EXISTS idx_credentials_officer ON credentials(officer_id);
    CREATE INDEX IF NOT EXISTS idx_credentials_status ON credentials(status);

    CREATE INDEX IF NOT EXISTS idx_patrol_checkpoints_property ON patrol_checkpoints(property_id);
    CREATE INDEX IF NOT EXISTS idx_patrol_scans_checkpoint ON patrol_scans(checkpoint_id);
    CREATE INDEX IF NOT EXISTS idx_patrol_scans_officer ON patrol_scans(officer_id);

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);

    CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at);

    CREATE INDEX IF NOT EXISTS idx_attachments_file_id ON attachments(file_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by ON attachments(uploaded_by);

    CREATE INDEX IF NOT EXISTS idx_incident_persons_incident ON incident_persons(incident_id);
    CREATE INDEX IF NOT EXISTS idx_incident_persons_person ON incident_persons(person_id);
    CREATE INDEX IF NOT EXISTS idx_incident_vehicles_incident ON incident_vehicles(incident_id);
    CREATE INDEX IF NOT EXISTS idx_incident_vehicles_vehicle ON incident_vehicles(vehicle_id);

    CREATE INDEX IF NOT EXISTS idx_persons_dl ON persons(dl_number);
    CREATE INDEX IF NOT EXISTS idx_vehicles_registration ON vehicles_records(registration_expiry);
    CREATE INDEX IF NOT EXISTS idx_users_hire_date ON users(hire_date);
    CREATE INDEX IF NOT EXISTS idx_evidence_number ON evidence(evidence_number);

    -- Warrants indexes
    CREATE INDEX IF NOT EXISTS idx_warrants_status ON warrants(status);
    CREATE INDEX IF NOT EXISTS idx_warrants_type ON warrants(type);
    CREATE INDEX IF NOT EXISTS idx_warrants_subject ON warrants(subject_person_id);
    CREATE INDEX IF NOT EXISTS idx_warrants_number ON warrants(warrant_number);
    CREATE INDEX IF NOT EXISTS idx_warrants_created ON warrants(created_at);

    -- Notifications indexes
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

    -- Call templates indexes
    CREATE INDEX IF NOT EXISTS idx_call_templates_active ON call_templates(is_active);

    -- Supplemental reports indexes
    CREATE INDEX IF NOT EXISTS idx_supplements_incident ON supplemental_reports(incident_id);
    CREATE INDEX IF NOT EXISTS idx_supplements_author ON supplemental_reports(author_id);
    CREATE INDEX IF NOT EXISTS idx_supplements_status ON supplemental_reports(status);

    -- Fleet indexes
    CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_status ON fleet_vehicles(status);
    CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_unit ON fleet_vehicles(assigned_unit_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_maintenance_vehicle ON fleet_maintenance(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_maintenance_date ON fleet_maintenance(performed_at);

    -- Fleet fuel log indexes
    CREATE INDEX IF NOT EXISTS idx_fleet_fuel_logs_vehicle ON fleet_fuel_logs(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_fuel_logs_date ON fleet_fuel_logs(fuel_date);

    -- Record links indexes
    CREATE INDEX IF NOT EXISTS idx_record_links_source ON record_links(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_record_links_target ON record_links(target_type, target_id);

    -- Fleet inspection indexes
    CREATE INDEX IF NOT EXISTS idx_fleet_inspections_vehicle ON fleet_inspections(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_inspections_date ON fleet_inspections(inspection_date);
    CREATE INDEX IF NOT EXISTS idx_fleet_inspections_result ON fleet_inspections(overall_result);

    -- Fleet assignment history indexes
    CREATE INDEX IF NOT EXISTS idx_fleet_assignments_vehicle ON fleet_assignments(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_assignments_unit ON fleet_assignments(unit_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_assignments_dates ON fleet_assignments(assigned_at, unassigned_at);

    -- Fleet personnel notes indexes
    CREATE INDEX IF NOT EXISTS idx_fleet_personnel_notes_vehicle ON fleet_personnel_notes(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_personnel_notes_officer ON fleet_personnel_notes(officer_id);

    -- Invoice indexes
    CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(period_start, period_end);
    CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);

    -- Invoice line items indexes
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_line_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_type ON invoice_line_items(line_type);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_linked ON invoice_line_items(linked_entity_type, linked_entity_id);

    -- Payments indexes
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

    -- Client linkage indexes
    CREATE INDEX IF NOT EXISTS idx_cfs_client ON calls_for_service(client_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_client ON incidents(client_id);

    -- Client-person junction indexes
    CREATE INDEX IF NOT EXISTS idx_client_persons_client ON client_persons(client_id);
    CREATE INDEX IF NOT EXISTS idx_client_persons_person ON client_persons(person_id);
    CREATE INDEX IF NOT EXISTS idx_client_persons_relationship ON client_persons(relationship);

    -- Criminal history indexes
    CREATE INDEX IF NOT EXISTS idx_criminal_history_person ON criminal_history(person_id);
    CREATE INDEX IF NOT EXISTS idx_criminal_history_type ON criminal_history(record_type);
    CREATE INDEX IF NOT EXISTS idx_criminal_history_date ON criminal_history(offense_date);

    -- Officer equipment indexes
    CREATE INDEX IF NOT EXISTS idx_officer_equipment_officer ON officer_equipment(officer_id);
    CREATE INDEX IF NOT EXISTS idx_officer_equipment_status ON officer_equipment(status);
    CREATE INDEX IF NOT EXISTS idx_officer_equipment_type ON officer_equipment(equipment_type);

    -- GPS breadcrumb indexes
    CREATE INDEX IF NOT EXISTS idx_breadcrumbs_unit_time ON gps_breadcrumbs(unit_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_breadcrumbs_officer ON gps_breadcrumbs(officer_id);
    CREATE INDEX IF NOT EXISTS idx_breadcrumbs_recorded ON gps_breadcrumbs(recorded_at);

    -- Cases indexes
    CREATE INDEX IF NOT EXISTS idx_cases_number ON cases(case_number);
    CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
    CREATE INDEX IF NOT EXISTS idx_cases_type ON cases(case_type);
    CREATE INDEX IF NOT EXISTS idx_cases_investigator ON cases(lead_investigator_id);
    CREATE INDEX IF NOT EXISTS idx_cases_created ON cases(created_at);
    CREATE INDEX IF NOT EXISTS idx_case_notes_case ON case_notes(case_id);
    CREATE INDEX IF NOT EXISTS idx_case_notes_author ON case_notes(author_id);

    -- Code violations indexes
    CREATE INDEX IF NOT EXISTS idx_code_violations_number ON code_violations(violation_number);
    CREATE INDEX IF NOT EXISTS idx_code_violations_status ON code_violations(status);
    CREATE INDEX IF NOT EXISTS idx_code_violations_type ON code_violations(violation_type);
    CREATE INDEX IF NOT EXISTS idx_code_violations_property ON code_violations(property_id);
    CREATE INDEX IF NOT EXISTS idx_code_violations_officer ON code_violations(reporting_officer_id);

    -- Vehicle tows indexes
    CREATE INDEX IF NOT EXISTS idx_vehicle_tows_number ON vehicle_tows(tow_number);
    CREATE INDEX IF NOT EXISTS idx_vehicle_tows_status ON vehicle_tows(status);
    CREATE INDEX IF NOT EXISTS idx_vehicle_tows_plate ON vehicle_tows(vehicle_plate);
    CREATE INDEX IF NOT EXISTS idx_vehicle_tows_officer ON vehicle_tows(officer_id);
    CREATE INDEX IF NOT EXISTS idx_vehicle_tows_created ON vehicle_tows(created_at);

    -- Court events indexes
    CREATE INDEX IF NOT EXISTS idx_court_events_number ON court_events(event_number);
    CREATE INDEX IF NOT EXISTS idx_court_events_status ON court_events(status);
    CREATE INDEX IF NOT EXISTS idx_court_events_date ON court_events(event_date);
    CREATE INDEX IF NOT EXISTS idx_court_events_type ON court_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_court_events_citation ON court_events(citation_id);
    CREATE INDEX IF NOT EXISTS idx_court_events_case ON court_events(case_id);
    CREATE INDEX IF NOT EXISTS idx_court_events_defendant ON court_events(defendant_person_id);

    -- Daily activity reports indexes
    CREATE INDEX IF NOT EXISTS idx_dar_number ON daily_activity_reports(dar_number);
    CREATE INDEX IF NOT EXISTS idx_dar_status ON daily_activity_reports(status);
    CREATE INDEX IF NOT EXISTS idx_dar_officer ON daily_activity_reports(officer_id);
    CREATE INDEX IF NOT EXISTS idx_dar_date ON daily_activity_reports(shift_date);
    CREATE INDEX IF NOT EXISTS idx_dar_property ON daily_activity_reports(property_id);

    -- Offender alerts indexes
    CREATE INDEX IF NOT EXISTS idx_offender_alerts_person ON offender_alerts(person_id);
    CREATE INDEX IF NOT EXISTS idx_offender_alerts_type ON offender_alerts(alert_type);
    CREATE INDEX IF NOT EXISTS idx_offender_alerts_status ON offender_alerts(status);
    CREATE INDEX IF NOT EXISTS idx_offender_alerts_severity ON offender_alerts(severity);

    -- 2FA / Security indexes
    CREATE INDEX IF NOT EXISTS idx_totp_secrets_user ON user_totp_secrets(user_id);
    CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON user_backup_codes(user_id);
    CREATE INDEX IF NOT EXISTS idx_backup_codes_unused ON user_backup_codes(user_id, is_used);
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_fingerprint ON trusted_devices(device_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_expiry ON trusted_devices(trusted_until);
    CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_security_notifs_user ON security_notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_security_notifs_read ON security_notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_security_notifs_created ON security_notifications(created_at);
  `);
}

function seedData(): void {
  const now = localNow();

  // ─── ADMIN USER (only if no users exist) ──────────
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const randomPassword = crypto.randomBytes(16).toString('hex');
    const hash = (pw: string) => bcryptjs.hashSync(pw, 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, email, role, badge_number, phone, status, must_change_password, password_changed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)
    `).run('admin', hash(randomPassword), 'System Administrator', 'admin@rmpgsecurity.com', 'admin', 'A001', '801-555-0100', now, now, now);
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  INITIAL ADMIN CREDENTIALS                      ║');
    console.log(`║  Username: admin                                 ║`);
    console.log(`║  Password: ${randomPassword}        ║`);
    console.log('║  You MUST change this password on first login.   ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
  }

  // ─── SYSTEM CONFIG (always ensure these exist) ────
  const insertConfig = db.prepare(`
    INSERT OR IGNORE INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const configTx = db.transaction(() => {
    const incidentTypes = [
      'alarm_response', 'suspicious_activity', 'trespass', 'theft', 'vandalism',
      'disturbance', 'welfare_check', 'parking_violation', 'traffic_accident',
      'medical_emergency', 'fire', 'escort', 'lock_unlock', 'patrol_check',
      'access_control', 'other',
    ];
    incidentTypes.forEach((type, i) => {
      insertConfig.run('incident_type', type, 'incident_types', i, now, now);
    });

    const dispositions = [
      ['RPT', 'Report Taken'], ['GOA', 'Gone on Arrival'], ['UTL', 'Unable to Locate'],
      ['FA', 'False Alarm'], ['WAR', 'Warning Issued'], ['TRE', 'Trespass Warning Issued'],
      ['ARR', 'Arrest / Detained'], ['REF', 'Referred to External Agency'],
      ['AMA', 'Against Medical Advice'], ['CAN', 'Cancelled'], ['UNF', 'Unfounded'],
      ['SEC', 'Secured / All Clear'],
      ['ADV', 'Advised / Counseled'], ['CIT', 'Citation Issued'], ['DET', 'Detained'],
      ['EVA', 'Eviction Assistance'], ['MED', 'Medical Response'], ['NOA', 'No Action Required'],
      ['OTH', 'Other (See Notes)'], ['PSE', 'Property Secured'], ['TOW', 'Vehicle Towed'],
      ['TFR', 'Transferred to Another Agency'], ['PAT', 'Patrol Check Completed'],
      ['SRV', 'Served (Warrant/Papers)'], ['PTS', 'Pre-Trial Supervision Alert'],
    ];
    dispositions.forEach(([code, desc], i) => {
      insertConfig.run('disposition_code', JSON.stringify({ code, description: desc }), 'dispositions', i, now, now);
    });
  });
  configTx();

  // ─── EVIDENCE STORAGE LOCATIONS ─────────────
  const evidenceLocations = [
    ['Main Evidence Locker', 'Primary secured evidence storage room'],
    ['Temporary Hold Bin', 'Short-term holding for intake processing'],
    ['Firearms Vault', 'Secured firearms and weapons storage'],
    ['Narcotics Safe', 'Controlled substance storage'],
    ['Large Item Storage', 'Oversized evidence and property'],
    ['Digital Evidence Server', 'Electronic devices and digital media'],
    ['Cold Case Archive', 'Long-term archived evidence'],
    ['Lab Submission Outbox', 'Awaiting lab pickup'],
    ['Release Staging', 'Approved for owner release'],
  ];
  evidenceLocations.forEach(([name, desc], i) => {
    insertConfig.run(name, JSON.stringify({ description: desc }), 'evidence_location', i, now, now);
  });

  // Video overlay agency name (configurable in Admin)
  insertConfig.run('video_overlay_agency_name', 'ROCKY MOUNTAIN PROTECTIVE GROUP', 'video_overlay', 0, now, now);

  console.log('Seed data initialized (admin user + system config).');
}

export default { initDatabase, getDb };
