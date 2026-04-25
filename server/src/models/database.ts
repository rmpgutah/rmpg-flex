import Database from 'better-sqlite3';
import bcryptjs from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrateIncidentNumbers } from '../utils/caseNumbers';
import crypto from 'crypto';
import { localNow } from '../utils/timeUtils';
import { seedUtahStatutes } from '../seeds/utahStatutes';
// DISPATCH_DISTRICTS legacy constant import removed (Phase 2 of geography rebuild)
import { seedGeographyFromGeoJSON } from '../seeds/geographySeed';
import { identifyBeat } from '../utils/geofence';
import { reverseGeocodeDetailed } from '../utils/geocode';
import { registerSqliteFunctions } from './sqliteFunctions';
import { backfillCaseLinks } from '../migrations/2026-04-19-case-links-backfill';

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
  registerSqliteFunctions(db);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // [FIX 64] Set synchronous to NORMAL for WAL mode (safe and faster than FULL)
  db.pragma('synchronous = NORMAL');
  // [FIX 65] Increase WAL autocheckpoint threshold for better write performance
  db.pragma('wal_autocheckpoint = 1000');
  // [FIX 66] Set busy timeout to prevent SQLITE_BUSY errors on concurrent access
  db.pragma('busy_timeout = 5000');
  // [FIX 67] Enable memory-mapped I/O for faster reads (256MB)
  db.pragma('mmap_size = 268435456');
  // [FIX 68] Set temp_store to memory for faster temp table operations
  db.pragma('temp_store = MEMORY');

  createTables();
  migrateSchema();
  ensureRequiredColumns();
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

    -- ═══ Dash Cameras ══════════════════════════════════════

    -- Dash cameras — mounted in fleet vehicles
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

    CREATE INDEX IF NOT EXISTS idx_dash_cameras_vehicle ON dash_cameras(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_dash_cameras_status ON dash_cameras(status);

    -- Dash camera video footage
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

    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_vehicle ON dashcam_videos(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_case ON dashcam_videos(case_number);

    -- ═══ ClearPathGPS Integration ══════════════════════════

    -- ClearPathGPS synced vehicle data
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

    CREATE INDEX IF NOT EXISTS idx_cpgps_vehicles_vehicle ON cpgps_vehicles(vehicle_id);

    -- ClearPathGPS trip history
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

    CREATE INDEX IF NOT EXISTS idx_cpgps_trips_vehicle ON cpgps_trips(cpgps_vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_cpgps_trips_start ON cpgps_trips(trip_start);

    -- ClearPathGPS location breadcrumbs
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

    CREATE INDEX IF NOT EXISTS idx_cpgps_locations_vehicle ON cpgps_locations(cpgps_vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_cpgps_locations_time ON cpgps_locations(reported_at);

    -- ClearPathGPS alerts
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

    CREATE INDEX IF NOT EXISTS idx_cpgps_alerts_vehicle ON cpgps_alerts(cpgps_vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_cpgps_alerts_time ON cpgps_alerts(triggered_at);

    -- ClearPathGPS sync log
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
    CREATE INDEX IF NOT EXISTS idx_ai_dev_chat_session ON ai_dev_chat(session_id);

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
    CREATE INDEX IF NOT EXISTS idx_ai_activity_created ON ai_activity_log(created_at);

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
  `);

  // ─── PANIC ALERTS TABLE ────────────────────────────
  // Uses db.prepare().run() pattern per CLAUDE.md Gotcha #42
  db.prepare(`
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

  // ─── GPS STALE ALERTS TABLE ───────────────────────
  // Server-side watchdog for officer GPS heartbeat loss.
  // Uses db.prepare().run() pattern per CLAUDE.md Gotcha #42.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS gps_stale_alerts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id             INTEGER NOT NULL,
      call_sign           TEXT NOT NULL,
      officer_id          INTEGER,
      officer_name        TEXT,
      last_gps_at         TEXT NOT NULL,
      stale_detected_at   TEXT NOT NULL,
      last_escalated_at   TEXT NOT NULL,
      escalation_level    INTEGER NOT NULL DEFAULT 1,
      recovered_at        TEXT,
      duration_sec        INTEGER,
      last_lat            REAL,
      last_lng            REAL,
      last_source         TEXT,
      notes               TEXT
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_gps_stale_open ON gps_stale_alerts(unit_id, recovered_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_gps_stale_time ON gps_stale_alerts(stale_detected_at)`).run();
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
  addCol('calls_for_service', 'sector_id', 'TEXT');
  // Migration: rename legacy section_id → sector_id on calls_for_service
  try {
    const cols = db.prepare('PRAGMA table_info(calls_for_service)').all() as any[];
    const hasOld = cols.some((c) => c.name === 'section_id');
    if (hasOld) {
      db.prepare('UPDATE calls_for_service SET sector_id = section_id WHERE section_id IS NOT NULL AND sector_id IS NULL').run();
      console.log('[migrate] calls_for_service.section_id -> sector_id (data copied)');
    }
  } catch (err: any) {
    console.log('[migrate] calls_for_service sector_id copy skipped:', err.message);
  }
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
  addCol('calls_for_service', 'received_at', 'TEXT');

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
          sector_id TEXT,
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
  addCol('incidents', 'section_id', 'TEXT');  // legacy column, kept for rolling upgrade compat
  addCol('incidents', 'sector_id', 'TEXT');
  addCol('incidents', 'zone_id', 'TEXT');
  addCol('incidents', 'beat_id', 'TEXT');
  // Migration: copy section_id → sector_id for existing rows
  try {
    const cols = db.prepare('PRAGMA table_info(incidents)').all() as any[];
    const hasOld = cols.some((c) => c.name === 'section_id');
    if (hasOld) {
      db.prepare('UPDATE incidents SET sector_id = section_id WHERE section_id IS NOT NULL AND sector_id IS NULL').run();
      console.log('[migrate] incidents.section_id -> sector_id (data copied)');
    }
  } catch (err: any) {
    console.log('[migrate] incidents sector_id copy skipped:', err.message);
  }
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
  addCol('users', 'totp_exempt', 'INTEGER DEFAULT 0');     // 1 = exempt from mandatory 2FA even if role requires it

  // ── USERS — Password history & expiry ─────────────────
  addCol('users', 'password_history', 'TEXT');             // JSON array of previous bcrypt hashes
  addCol('users', 'password_changed_at', 'TEXT');          // ISO timestamp of last password change

  // ── USERS — Digital Signature (PNG base64 data URL) ──
  addCol('users', 'digital_signature', 'TEXT');            // base64 data:image/png;base64,... stored per officer

  // ── USERS — Voice persona (Dispatcher Brain TTS preferences) ──
  addCol('users', 'voice_persona', "TEXT DEFAULT 'en-US-JennyNeural'");
  addCol('users', 'voice_rate', 'REAL DEFAULT 1.0');
  addCol('users', 'voice_pitch', 'REAL DEFAULT 0');
  addCol('users', 'voice_terseness', "TEXT DEFAULT 'standard'");
  addCol('users', 'voice_brain_enabled', 'INTEGER DEFAULT 0');
  // Assigned beat for geofence-breach detection (Phase 3). When NULL
  // the breach check is skipped for that unit so this is opt-in per
  // unit — e.g. a utility/admin unit with no specific beat has no
  // expected area.
  addCol('units', 'assigned_beat', 'TEXT');

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

  // ── SERVE INTAKE: vendor lookup columns ──────────────────
  addCol('clients', 'billing_code', 'TEXT');
  addCol('clients', 'requestor_email', 'TEXT');
  addCol('clients', 'vendor_fingerprint', 'TEXT');
  addCol('clients', 'caller_phone', 'TEXT');

  // ── SERVE INTAKE: role-tagged persons for legal parties ──
  addCol('persons', 'role_tag', 'TEXT');        // 'defendant' | 'plaintiff' | 'attorney' | 'resident'
  addCol('persons', 'entity_type', 'TEXT');     // 'individual' | 'organization'
  addCol('persons', 'bar_number', 'TEXT');
  addCol('persons', 'firm_name', 'TEXT');

  // ── SERVE INTAKE: pre-planned attempt windows ─────────────
  addCol('serve_attempts', 'planned_at', 'TEXT');
  addCol('serve_attempts', 'window', 'TEXT');
  addCol('serve_attempts', 'status', 'TEXT');   // 'planned' | 'attempted' | 'served' | 'failed'

  // Seed ICU Investigations vendor fingerprint (idempotent — only fills null/empty fields)
  try {
    const existing = db.prepare("SELECT id FROM clients WHERE name LIKE 'ICU Investigations%' OR vendor_fingerprint = ? LIMIT 1").get('ICU Investigations, LLC') as any;
    if (existing) {
      db.prepare(`UPDATE clients SET
        billing_code = COALESCE(NULLIF(billing_code, ''), '0175'),
        requestor_email = COALESCE(NULLIF(requestor_email, ''), 'a1processserver@gmail.com'),
        vendor_fingerprint = COALESCE(NULLIF(vendor_fingerprint, ''), 'ICU Investigations, LLC'),
        caller_phone = COALESCE(NULLIF(caller_phone, ''), '(435) 986-1200')
        WHERE id = ?`).run(existing.id);
    } else {
      db.prepare(`INSERT INTO clients (name, billing_code, requestor_email, vendor_fingerprint, caller_phone, status)
        VALUES (?, ?, ?, ?, ?, 'active')`).run(
        'ICU Investigations, LLC', '0175', 'a1processserver@gmail.com', 'ICU Investigations, LLC', '(435) 986-1200');
    }
  } catch (err) {
    // Non-fatal on first run before addCol() has completed
  }

  // ── UNITS — missing columns ────────────────────────────
  addCol('units', 'updated_at', "TEXT DEFAULT (datetime('now','localtime'))");

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
  addCol('properties', 'notes', 'TEXT');
  addCol('properties', 'business_type', 'TEXT');
  addCol('properties', 'structure_type', 'TEXT');
  addCol('properties', 'occupancy_status', 'TEXT');
  addCol('properties', 'year_built', 'TEXT');
  addCol('properties', 'square_footage', 'TEXT');
  addCol('properties', 'number_of_stories', 'TEXT');
  addCol('properties', 'security_features', 'TEXT');
  addCol('properties', 'key_holder_name', 'TEXT');
  addCol('properties', 'key_holder_phone', 'TEXT');
  addCol('properties', 'key_holder_relationship', 'TEXT');
  addCol('properties', 'owner_name', 'TEXT');
  addCol('properties', 'owner_phone', 'TEXT');
  addCol('properties', 'last_inspection_date', 'TEXT');

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

  // ── TIME ENTRIES — edit audit tracking ──────────────
  addCol('time_entries', 'notes', 'TEXT');
  addCol('time_entries', 'edit_reason', 'TEXT');
  addCol('time_entries', 'edited_by', 'INTEGER');
  addCol('time_entries', 'edited_at', 'TEXT');

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

  // ── PSO QR Tokens (mobile quick-login for field PSOs) ──
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS pso_qr_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      scans_used INTEGER NOT NULL DEFAULT 0,
      max_scans INTEGER NOT NULL DEFAULT 5,
      admin_override INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      expires_at TEXT,
      last_scanned_at TEXT,
      last_scanned_by INTEGER,
      revoked_at TEXT
    )`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_pso_qr_token ON pso_qr_tokens(token)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_pso_qr_call ON pso_qr_tokens(call_id)`).run();
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

  // ── CASE JUNCTION TABLES — indexed replacement for JSON LIKE scans in Connections traversal ──
  // Task 3.1 of Connections Analyst Tool. Task 3.2 backfills from cases.linked_persons/
  // linked_incidents/linked_evidence JSON arrays; Task 3.3 switches routes/connections.ts
  // to these indexed joins instead of `LIKE '%id%'` full-table scans.
  db.prepare(`
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_cpl_case ON case_person_links(case_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_cpl_person ON case_person_links(person_id)`).run();

  db.prepare(`
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_cil_case ON case_incident_links(case_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_cil_incident ON case_incident_links(incident_id)`).run();

  db.prepare(`
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_cel_case ON case_evidence_links(case_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_cel_evidence ON case_evidence_links(evidence_id)`).run();

  // Connections Analyst Tool — saved investigations (Phase 4.2)
  // An investigation is a user-owned graph workspace: seed nodes + pinned
  // layout + free-text annotations. Private by default; read-shared via the
  // explicit `shared_user_ids` JSON array. Only the owner can update/delete.
  db.prepare(`
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ci_user ON connection_investigations(user_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ci_updated ON connection_investigations(updated_at)`).run();

  // Backfill case_*_links from legacy JSON columns (idempotent, one-time).
  // Only runs when junction tables are empty AND there is legacy JSON data to
  // migrate. Safe to leave in place: the guard short-circuits after first run.
  try {
    const linksCount = db.prepare('SELECT COUNT(*) as c FROM case_person_links').get() as any;
    const anyJsonPopulated = db.prepare(
      "SELECT COUNT(*) as c FROM cases WHERE (linked_persons IS NOT NULL AND linked_persons != '[]' AND linked_persons != '') OR (linked_incidents IS NOT NULL AND linked_incidents != '[]' AND linked_incidents != '') OR (linked_evidence IS NOT NULL AND linked_evidence != '[]' AND linked_evidence != '')"
    ).get() as any;

    if (linksCount.c === 0 && anyJsonPopulated.c > 0) {
      backfillCaseLinks(db);
    }
  } catch (err: any) {
    console.error('[DB] case links backfill failed:', err?.message);
    // Non-fatal — leave legacy JSON columns and proceed
  }

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

  // ── gps_breadcrumbs — position source (gps/wifi/ip/unknown) ──
  // Tracks how each breadcrumb position was obtained for audit trail visibility
  // on maps. WiFi/IP points have reduced accuracy vs hardware GPS.
  addCol('gps_breadcrumbs', 'source', "TEXT DEFAULT 'unknown'");

  // ── SPEED VIOLATIONS — logs when officers exceed speed thresholds ──
  db.prepare(`
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

  // ── SPEED ZONES — geographic areas with custom speed limits ──
  db.prepare(`
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

  // ── Speed violation indexes ──
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_speed_violations_unit_time ON speed_violations (unit_id, recorded_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_speed_violations_officer ON speed_violations (officer_id, recorded_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_speed_violations_unack ON speed_violations (acknowledged_by) WHERE acknowledged_by IS NULL`).run();

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
        UPDATE calls_for_service SET beat_id = ?, zone_id = ?, sector_id = ?, zone_beat = ?
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
        UPDATE incidents SET beat_id = ?, zone_id = ?, sector_id = ?, zone_beat = ?
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

  // ── DISPATCH DISTRICTS — obsolete 3-tier flat table, dropped in Phase 2
  //    of the geography rebuild. Replaced by the 4-tier normalized
  //    dispatch_areas / sectors / zones / beats model seeded from GeoJSON.
  try {
    db.prepare('DROP TABLE IF EXISTS dispatch_districts').run();
  } catch (err: any) {
    console.log('[migrate] dispatch_districts drop skipped:', err.message);
  }

  // ── DISPATCH GEOGRAPHY — Normalized Section / Zone / Beat / Area tables ──
  try {
    db.exec(`
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
    // Migration: rename existing dispatch_sections → dispatch_sectors (if present)
    // Runs before the CREATE below so fresh DBs skip the rename entirely.
    try {
      const oldExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dispatch_sections'"
      ).get();
      const newExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dispatch_sectors'"
      ).get();
      if (oldExists && !newExists) {
        db.prepare('ALTER TABLE dispatch_sections RENAME TO dispatch_sectors').run();
        console.log('[migrate] Renamed dispatch_sections -> dispatch_sectors');
      }
    } catch (err: any) {
      console.log('[migrate] dispatch_sections rename skipped:', err.message);
    }
    db.prepare(`
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
    // addCol migrations for existing DBs missing the new columns
    try { addCol('dispatch_sectors', 'county_nbr', 'TEXT'); } catch { /* ignore */ }
    try { addCol('dispatch_sectors', 'fips_code', 'TEXT'); } catch { /* ignore */ }
    // Migration: rename legacy section_code/section_name columns on dispatch_sectors
    try {
      const cols = db.prepare('PRAGMA table_info(dispatch_sectors)').all() as any[];
      const hasOldName = cols.some((c) => c.name === 'section_name');
      const hasNewName = cols.some((c) => c.name === 'sector_name');
      if (hasOldName && !hasNewName) {
        db.prepare('ALTER TABLE dispatch_sectors RENAME COLUMN section_name TO sector_name').run();
        console.log('[migrate] dispatch_sectors.section_name -> sector_name');
      }
      const hasOldCode = cols.some((c) => c.name === 'section_code');
      const hasNewCode = cols.some((c) => c.name === 'sector_code');
      if (hasOldCode && !hasNewCode) {
        db.prepare('ALTER TABLE dispatch_sectors RENAME COLUMN section_code TO sector_code').run();
        console.log('[migrate] dispatch_sectors.section_code -> sector_code');
      }
    } catch (err: any) {
      console.log('[migrate] dispatch_sectors column rename skipped:', err.message);
    }
    db.prepare(`
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
    try { addCol('dispatch_zones', 'zone_type', "TEXT DEFAULT 'municipality'"); } catch { /* ignore */ }
    try { addCol('dispatch_zones', 'ugrc_code', 'TEXT'); } catch { /* ignore */ }
    // Migration: rename dispatch_zones.section_id -> sector_id if legacy column exists
    try {
      const cols = db.prepare('PRAGMA table_info(dispatch_zones)').all() as any[];
      const hasOld = cols.some((c) => c.name === 'section_id');
      const hasNew = cols.some((c) => c.name === 'sector_id');
      if (hasOld && !hasNew) {
        db.prepare('ALTER TABLE dispatch_zones RENAME COLUMN section_id TO sector_id').run();
        console.log('[migrate] dispatch_zones.section_id -> sector_id');
      }
    } catch (err: any) {
      console.log('[migrate] dispatch_zones column rename skipped:', err.message);
    }
    db.prepare(`
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
    try { addCol('dispatch_beats', 'district_letter', 'TEXT'); } catch { /* ignore */ }
    try { addCol('dispatch_beats', 'beat_number', 'INTEGER'); } catch { /* ignore */ }
    db.exec(`
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
    db.exec(`
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
    db.exec(`CREATE INDEX IF NOT EXISTS idx_premise_alerts_address ON premise_alerts(address)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_premise_alerts_coords ON premise_alerts(latitude, longitude)`);

    // Utah Roads import (AGRC): authoritative street centerlines with address ranges,
    // postal/MSAG community, ESN, ZIP, one-way, speed limit, and DOT functional class.
    db.prepare(`CREATE TABLE IF NOT EXISTS roads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      utah_road_unique_id TEXT UNIQUE NOT NULL,
      unique_id TEXT,
      full_name TEXT,
      street_name TEXT,
      pre_dir TEXT,
      post_type TEXT,
      post_dir TEXT,
      left_from INTEGER,
      left_to INTEGER,
      right_from INTEGER,
      right_to INTEGER,
      parity_left TEXT,
      parity_right TEXT,
      postal_community_left TEXT,
      postal_community_right TEXT,
      zip_left TEXT,
      zip_right TEXT,
      esn_left TEXT,
      esn_right TEXT,
      msag_community_left TEXT,
      msag_community_right TEXT,
      one_way TEXT,
      posted_speed INTEGER,
      dot_functional_class TEXT,
      county_left TEXT,
      county_right TEXT
    )`).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_roads_street_community
      ON roads(street_name, postal_community_left)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_roads_zip_left
      ON roads(zip_left)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_roads_esn_left
      ON roads(esn_left)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_roads_esn_right
      ON roads(esn_right)`).run();

    db.prepare(`CREATE TABLE IF NOT EXISTS road_segments_geom (
      utah_road_unique_id TEXT PRIMARY KEY,
      geom_json TEXT NOT NULL,
      FOREIGN KEY (utah_road_unique_id) REFERENCES roads(utah_road_unique_id)
    )`).run();
  } catch (err) {
    console.log('[migrate] Dispatch geography tables:', (err as Error).message);
  }

  // Seed dispatch_areas / sectors / zones / beats from Utah GeoJSON.
  // Runs only when all 4 tables are empty (idempotent guard in the seed module).
  try {
    const geojsonDir = path.resolve(__dirname, '../../../client/public/geojson');
    seedGeographyFromGeoJSON(db, geojsonDir);
  } catch (err) {
    console.log('[migrate] Geography seed skipped:', (err as Error).message);
  }

  // Seed default dispatch codes if empty
  try {
    const codeCount = db.prepare('SELECT COUNT(*) as cnt FROM dispatch_codes').get() as any;
    if (codeCount?.cnt === 0) {
      const defaultCodes: [string, string, string, string, string, number, number, number, number][] = [
        ['10-0', 'Officer Down', 'emergency', 'P1', '#ef4444', 1, 1, 1, 0],
        ['10-00', 'Officer Needs Emergency Assistance', 'emergency', 'P1', '#ef4444', 1, 1, 0, 0],
        ['10-10', 'Fight In Progress', 'violent', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['10-14', 'Prowler Report', 'property', 'P2', '#f59e0b', 0, 0, 0, 0],
        ['10-15', 'Domestic Disturbance', 'violent', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['10-16', 'Domestic Violence', 'violent', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['10-18', 'Urgent — Complete Assignment Quickly', 'emergency', 'P1', '#f97316', 1, 1, 0, 0],
        ['10-31', 'Burglary In Progress', 'property', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['10-32', 'Person With Weapon', 'violent', 'P2', '#f59e0b', 1, 1, 0, 0],
        ['10-33', 'Emergency Traffic — Clear Channel', 'emergency', 'P1', '#ef4444', 0, 0, 0, 0],
        ['10-34', 'Riot', 'violent', 'P1', '#ef4444', 1, 1, 1, 0],
        ['10-52', 'Ambulance Needed', 'medical', 'P2', '#f59e0b', 0, 0, 1, 0],
        ['10-70', 'Fire Alarm', 'fire', 'P2', '#f59e0b', 0, 0, 0, 1],
        ['10-71', 'Shooting', 'violent', 'P1', '#ef4444', 1, 1, 1, 0],
        ['10-72', 'Knife Attack / Stabbing', 'violent', 'P1', '#ef4444', 1, 1, 1, 0],
        ['10-80', 'Pursuit In Progress', 'pursuit', 'P1', '#ef4444', 1, 1, 0, 0],
        ['10-6', 'Busy — Stand By', 'status', 'P3', '#6b7280', 0, 0, 0, 0],
        ['10-7', 'Out of Service', 'status', 'P3', '#6b7280', 0, 0, 0, 0],
        ['10-8', 'In Service', 'status', 'P3', '#6b7280', 0, 0, 0, 0],
        ['10-9', 'Repeat Last Transmission', 'comm', 'P4', '#6b7280', 0, 0, 0, 0],
        ['10-11', 'Animal Problem', 'community', 'P3', '#6b7280', 0, 0, 0, 0],
        ['10-17', 'Meet Complainant', 'community', 'P3', '#6b7280', 0, 0, 0, 0],
        ['10-20', 'Location / What Is Your Location', 'status', 'P4', '#6b7280', 0, 0, 0, 0],
        ['10-21', 'Call by Phone', 'comm', 'P4', '#6b7280', 0, 0, 0, 0],
        ['10-22', 'Disregard Last Message', 'comm', 'P4', '#6b7280', 0, 0, 0, 0],
        ['10-23', 'Arrived at Scene', 'status', 'P3', '#6b7280', 0, 0, 0, 0],
        ['10-24', 'Assignment Completed', 'status', 'P3', '#6b7280', 0, 0, 0, 0],
        ['10-26', 'Detaining Subject', 'enforcement', 'P3', '#3b82f6', 0, 0, 0, 0],
        ['10-27', 'Driver License Check', 'enforcement', 'P3', '#3b82f6', 0, 0, 0, 0],
        ['10-28', 'Vehicle Registration Check', 'enforcement', 'P3', '#3b82f6', 0, 0, 0, 0],
        ['10-29', 'Warrant Check', 'enforcement', 'P3', '#3b82f6', 0, 0, 0, 0],
        ['10-35', 'Major Crime Alert', 'violent', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['10-37', 'Suspicious Vehicle', 'property', 'P3', '#3b82f6', 0, 0, 0, 0],
        ['10-38', 'Traffic Stop', 'traffic', 'P3', '#3b82f6', 0, 0, 0, 0],
        ['10-40', 'Silent Run — No Lights/Siren', 'enforcement', 'P3', '#3b82f6', 0, 0, 0, 0],
        ['10-41', 'Beginning Tour of Duty', 'status', 'P4', '#6b7280', 0, 0, 0, 0],
        ['10-42', 'Ending Tour of Duty', 'status', 'P4', '#6b7280', 0, 0, 0, 0],
        ['10-50', 'Accident — Injury', 'traffic', 'P2', '#f59e0b', 0, 0, 1, 0],
        ['10-51', 'Accident — Non-Injury', 'traffic', 'P3', '#6b7280', 0, 0, 0, 0],
        ['10-55', 'Intoxicated Driver', 'traffic', 'P2', '#f59e0b', 0, 0, 0, 0],
        ['10-57', 'Hit and Run', 'traffic', 'P2', '#f59e0b', 0, 0, 0, 0],
        ['10-78', 'Need Assistance', 'emergency', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['10-79', 'Notify Coroner', 'medical', 'P2', '#f59e0b', 0, 0, 1, 0],
        ['10-89', 'Bomb Threat', 'emergency', 'P1', '#ef4444', 1, 1, 1, 1],
        ['10-90', 'Bank Alarm', 'property', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['10-95', 'Subject In Custody', 'enforcement', 'P3', '#3b82f6', 0, 0, 0, 0],
        ['10-96', 'Mental Subject', 'medical', 'P2', '#f59e0b', 0, 0, 1, 0],
        ['10-98', 'Prison / Jail Break', 'emergency', 'P1', '#ef4444', 1, 1, 0, 0],
        ['10-99', 'Wanted / Stolen Indicated', 'enforcement', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['CODE-1', 'Respond Without Lights/Siren', 'response', 'P3', '#6b7280', 0, 0, 0, 0],
        ['CODE-2', 'Respond Urgent — No Lights/Siren', 'response', 'P2', '#f59e0b', 0, 0, 0, 0],
        ['CODE-3', 'Respond Emergency — Lights and Siren', 'response', 'P1', '#ef4444', 0, 0, 0, 0],
        ['CODE-4', 'Scene Is Secure — No Further Assistance', 'response', 'P4', '#22c55e', 0, 0, 0, 0],
        ['187', 'Homicide', 'violent', 'P1', '#ef4444', 1, 1, 1, 0],
        ['211', 'Robbery', 'violent', 'P1', '#ef4444', 1, 1, 0, 0],
        ['240', 'Assault', 'violent', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['245', 'Assault with Deadly Weapon', 'violent', 'P1', '#ef4444', 1, 1, 1, 0],
        ['415', 'Disturbance / Noise Complaint', 'community', 'P3', '#6b7280', 0, 0, 0, 0],
        ['459', 'Burglary', 'property', 'P2', '#f59e0b', 1, 0, 0, 0],
        ['484', 'Petty Theft', 'property', 'P3', '#6b7280', 0, 0, 0, 0],
        ['487', 'Grand Theft', 'property', 'P2', '#f59e0b', 0, 0, 0, 0],
        ['502', 'Drunk Driver', 'traffic', 'P2', '#f59e0b', 0, 0, 0, 0],
        ['594', 'Malicious Mischief / Vandalism', 'property', 'P3', '#6b7280', 0, 0, 0, 0],
        ['901', 'Ambulance Call', 'medical', 'P2', '#f59e0b', 0, 0, 1, 0],
        ['904', 'Fire', 'fire', 'P2', '#f59e0b', 0, 0, 0, 1],
        ['925', 'Suspicious Person', 'community', 'P3', '#3b82f6', 0, 0, 0, 0],
        ['998', 'Officer Involved Shooting', 'emergency', 'P1', '#ef4444', 1, 1, 1, 0],
        ['999', 'Officer Needs Help — Emergency', 'emergency', 'P1', '#ef4444', 1, 1, 1, 0],
      ];
      const insertCode = db.prepare('INSERT OR IGNORE INTO dispatch_codes (code, description, category, priority, color, requires_backup, officer_safety, ems_needed, fire_needed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const c of defaultCodes) {
        insertCode.run(...c);
      }
      console.log('[migrate] Seeded ' + defaultCodes.length + ' dispatch codes (10-codes + signal codes)');
    }
  } catch (err) {
    console.log('[migrate] Dispatch codes seed:', (err as Error).message);
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
  addCol('calls_for_service', 'section_name', 'TEXT');  // legacy, kept for rolling upgrade
  addCol('calls_for_service', 'sector_name', 'TEXT');
  addCol('calls_for_service', 'zone_name', 'TEXT');
  addCol('calls_for_service', 'beat_name', 'TEXT');
  addCol('calls_for_service', 'beat_descriptor', 'TEXT');
  // Copy section_name → sector_name for any existing rows
  try {
    const cols = db.prepare('PRAGMA table_info(calls_for_service)').all() as any[];
    const hasOld = cols.some((c) => c.name === 'section_name');
    if (hasOld) {
      db.prepare('UPDATE calls_for_service SET sector_name = section_name WHERE section_name IS NOT NULL AND sector_name IS NULL').run();
    }
  } catch (err: any) {
    console.log('[migrate] calls_for_service sector_name copy skipped:', err.message);
  }

  // ── Contract ID for PSO Client Request incidents ──
  addCol('calls_for_service', 'contract_id', 'TEXT');
  addCol('incidents', 'contract_id', 'TEXT');

  // ── SECTIONS → SECTORS Phase 2a: Backfill sector_id from section_id ─
  // Safe, idempotent backfill. Runs every startup but only copies rows
  // where sector_id is NULL, so it's a no-op after the first run.
  try {
    db.prepare("UPDATE calls_for_service SET sector_id = section_id WHERE sector_id IS NULL AND section_id IS NOT NULL").run();
    db.prepare("UPDATE incidents SET sector_id = section_id WHERE sector_id IS NULL AND section_id IS NOT NULL").run();
  } catch { /* columns may not exist on very old DBs — ignore */ }

  // ── SECTIONS → SECTORS Phase 2b: Drop obsolete dual-write triggers ──
  // Phase 2a triggers mirrored section_id → sector_id during the rename
  // transition. Now that all code uses sector_id natively, these triggers
  // are obsolete and crash on fresh DBs (section_id column doesn't exist).
  try {
    db.prepare('DROP TRIGGER IF EXISTS trg_calls_for_service_sector_mirror').run();
    db.prepare('DROP TRIGGER IF EXISTS trg_calls_for_service_sector_mirror_upd').run();
    db.prepare('DROP TRIGGER IF EXISTS trg_incidents_sector_mirror').run();
    db.prepare('DROP TRIGGER IF EXISTS trg_incidents_sector_mirror_upd').run();
  } catch { /* ignore */ }

  // ── Businesses table ──
  try {
    db.prepare(`
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
        annual_revenue TEXT,
        status TEXT DEFAULT 'active',
        notes TEXT,
        flags TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )
    `).run();
  } catch { /* already exists */ }

  // ── Document Folders (desktop-style file browser hierarchy) ──
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS document_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES document_folders(id) ON DELETE CASCADE,
        folder_path TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE(folder_path)
      )
    `).run();
  } catch { /* already exists */ }
  addCol('attachments', 'folder_id', 'INTEGER');

  // ── CITATIONS — Spillman Flex enhancements ─────────────────
  addCol('citations', 'section_id', 'TEXT');  // legacy
  addCol('citations', 'sector_id', 'TEXT');
  addCol('citations', 'zone_id', 'TEXT');
  addCol('citations', 'beat_id', 'TEXT');
  addCol('citations', 'zone_beat', 'TEXT');
  // Copy section_id → sector_id on citations for existing rows
  try {
    const cols = db.prepare('PRAGMA table_info(citations)').all() as any[];
    const hasOld = cols.some((c) => c.name === 'section_id');
    if (hasOld) {
      db.prepare('UPDATE citations SET sector_id = section_id WHERE section_id IS NOT NULL AND sector_id IS NULL').run();
    }
  } catch (err: any) {
    console.log('[migrate] citations sector_id copy skipped:', err.message);
  }
  addCol('citations', 'latitude', 'REAL');
  addCol('citations', 'longitude', 'REAL');
  addCol('citations', 'vehicle_vin', 'TEXT');
  addCol('citations', 'vehicle_year', 'TEXT');
  addCol('citations', 'vehicle_make', 'TEXT');
  addCol('citations', 'vehicle_model', 'TEXT');
  addCol('citations', 'vehicle_color', 'TEXT');
  addCol('citations', 'vehicle_id', 'INTEGER');
  addCol('citations', 'speed_recorded', 'INTEGER');
  addCol('citations', 'speed_limit', 'INTEGER');
  addCol('citations', 'radar_type', 'TEXT');
  addCol('citations', 'bac_level', 'REAL');
  addCol('citations', 'bond_amount', 'REAL');
  addCol('citations', 'bond_type', 'TEXT');
  addCol('citations', 'is_warning', 'INTEGER DEFAULT 0');
  addCol('citations', 'is_equipment_violation', 'INTEGER DEFAULT 0');
  addCol('citations', 'weather_conditions', 'TEXT');
  addCol('citations', 'road_conditions', 'TEXT');
  addCol('citations', 'accident_related', 'INTEGER DEFAULT 0');
  addCol('citations', 'dui_related', 'INTEGER DEFAULT 0');
  addCol('citations', 'school_zone', 'INTEGER DEFAULT 0');
  addCol('citations', 'construction_zone', 'INTEGER DEFAULT 0');
  addCol('citations', 'commercial_vehicle', 'INTEGER DEFAULT 0');
  addCol('citations', 'hazmat', 'INTEGER DEFAULT 0');
  addCol('citations', 'voided_reason', 'TEXT');
  addCol('citations', 'voided_by', 'INTEGER');
  addCol('citations', 'voided_at', 'TEXT');
  addCol('citations', 'court_time', 'TEXT');
  addCol('citations', 'court_room', 'TEXT');
  addCol('citations', 'appearance_required', 'INTEGER DEFAULT 0');
  addCol('citations', 'plea', 'TEXT');
  addCol('citations', 'verdict', 'TEXT');
  addCol('citations', 'sentence', 'TEXT');
  addCol('citations', 'disposition_date', 'TEXT');
  addCol('citations', 'case_id', 'INTEGER');

  // SECTIONS → SECTORS Phase 2b: citations backfill + drop obsolete triggers
  try {
    db.prepare("UPDATE citations SET sector_id = section_id WHERE sector_id IS NULL AND section_id IS NOT NULL").run();
    db.prepare('DROP TRIGGER IF EXISTS trg_citations_sector_mirror').run();
    db.prepare('DROP TRIGGER IF EXISTS trg_citations_sector_mirror_upd').run();
  } catch { /* ignore */ }

  // Citation violations — multiple violations per citation
  try {
    db.exec(`
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
    db.exec('CREATE INDEX IF NOT EXISTS idx_citation_violations_citation ON citation_violations(citation_id)');
  } catch { /* already exists */ }

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
    addCol(tbl, 'pso_72hr_deadline', 'TEXT');         // ISO timestamp: 72hr re-dispatch deadline after clear/close
    addCol(tbl, 'pso_72hr_notified', 'TEXT');         // 'overdue'|'resolved'|NULL — tracks 72hr notification state
    addCol(tbl, 'pso_service_windows', 'TEXT');       // JSON: {early_morning,daytime,evening,weekend} compliance
    addCol(tbl, 'responding_vehicle_id', 'INTEGER');  // FK to fleet_vehicles — responding unit's vehicle
  }
  // Process service specific — must exist on BOTH calls_for_service AND incidents
  // Bug: incidents POST route INSERTs these columns but they were only added to
  // calls_for_service, causing every incident create to fail with SQLITE_ERROR.
  for (const tbl of flagTables) {
    addCol(tbl, 'pso_attempt_number', 'INTEGER DEFAULT 1');
    addCol(tbl, 'process_service_type', 'TEXT'); // subpoena, summons, complaint, eviction, restraining_order, other
    addCol(tbl, 'process_served_to', 'TEXT');
    addCol(tbl, 'process_served_address', 'TEXT');
    addCol(tbl, 'process_attempts', 'INTEGER DEFAULT 0');
    addCol(tbl, 'process_served_at', 'TEXT');
    addCol(tbl, 'process_service_result', 'TEXT'); // served, unable_to_serve, refused, substitute_service
    // LE notification + reporting flags also missing from incidents
    addCol(tbl, 'le_notified', 'INTEGER DEFAULT 0');
    addCol(tbl, 'supervisor_notified', 'INTEGER DEFAULT 0');
    addCol(tbl, 'injuries_reported', 'INTEGER DEFAULT 0');
  }

  // ── Backfill dispatch district names on existing calls ──────────
  // REMOVED in Phase 2 of geography rebuild: the dispatch_districts table
  // is dropped earlier in this migration. The backfill would always find
  // 0 rows and the SELECT * FROM dispatch_districts would throw. Existing
  // calls that had section_id set will need manual geography reassignment
  // via the new Geography admin page.

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

  // ── OFAC tables — fix column names to match Treasury CSV format ──
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

  // ── OFAC consolidated sanctions — add source_list column ──
  addCol('ofac_sdn_entries', 'source_list', "TEXT DEFAULT 'SDN'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ofac_source_list ON ofac_sdn_entries(source_list)");

  // ── Person watchlist auto-screening flag ──
  addCol('persons', 'watchlist_match', 'TEXT DEFAULT NULL');
  addCol('persons', 'watchlist_checked_at', 'TEXT DEFAULT NULL');
  addCol('persons', 'aliases', 'TEXT');
  addCol('persons', 'photo', 'TEXT');

  // ── Persons: extended identification, medical, military, LE fields ──
  // Bug: these columns existed in production but were never added to the
  // codebase schema migration. Fresh installs had no support for them.
  // The client PersonFormModal renders inputs for ALL of these, so users
  // typed data into fields that the POST/PUT routes then silently dropped.
  // Route fixes in records.ts complete the repair; this migration lets
  // fresh installs receive the same columns production already has.
  addCol('persons', 'ncic_number', 'TEXT');
  addCol('persons', 'sor_number', 'TEXT');
  addCol('persons', 'fbi_number', 'TEXT');
  addCol('persons', 'state_id_number', 'TEXT');
  addCol('persons', 'passport_number', 'TEXT');
  addCol('persons', 'passport_country', 'TEXT');
  addCol('persons', 'immigration_status', 'TEXT');
  addCol('persons', 'disability_flags', 'TEXT');
  addCol('persons', 'mental_health_flags', 'TEXT');
  addCol('persons', 'substance_abuse', 'TEXT');
  addCol('persons', 'medication_notes', 'TEXT');
  addCol('persons', 'education_level', 'TEXT');
  addCol('persons', 'military_branch', 'TEXT');
  addCol('persons', 'military_status', 'TEXT');
  addCol('persons', 'tribal_affiliation', 'TEXT');
  addCol('persons', 'identifying_marks_location', 'TEXT');
  addCol('persons', 'tattoo_description', 'TEXT');
  addCol('persons', 'scar_description', 'TEXT');
  addCol('persons', 'piercing_description', 'TEXT');
  addCol('persons', 'distinguishing_features', 'TEXT');
  addCol('persons', 'email_secondary', 'TEXT');
  addCol('persons', 'date_last_seen', 'TEXT');
  addCol('persons', 'location_last_seen', 'TEXT');
  addCol('persons', 'alias_dob', 'TEXT');
  addCol('persons', 'home_phone', 'TEXT');
  addCol('persons', 'work_phone', 'TEXT');

  // Feature 27/37: Report approval and case assignment columns
  addCol('incidents', 'approved_at', 'TEXT');
  addCol('incidents', 'assigned_detective_id', 'INTEGER');

  // Feature 38: Evidence retention tracking
  addCol('evidence', 'retention_until', 'TEXT');
  addCol('evidence', 'disposition', 'TEXT');

  // ── FORENSICS — Lab case management tables ─────────────────
  try {
    db.exec(`
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
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_forensic_cases_status ON forensic_cases(status);
      CREATE INDEX IF NOT EXISTS idx_forensic_cases_lab ON forensic_cases(lab_number);
      CREATE INDEX IF NOT EXISTS idx_forensic_exhibits_case ON forensic_exhibits(forensic_case_id);
      CREATE INDEX IF NOT EXISTS idx_forensic_analyses_case ON forensic_analyses(forensic_case_id);
      CREATE INDEX IF NOT EXISTS idx_forensic_activity_case ON forensic_activity_log(forensic_case_id);
    `);
  } catch { /* tables already exist */ }

  // ── EMAIL SYSTEM — Templates, Logs, Preferences ────────────
  try {
    db.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_email);
      CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
      CREATE INDEX IF NOT EXISTS idx_email_logs_context ON email_logs(context_type, context_id);
      CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
    `);
  } catch { /* tables already exist */ }

  // ── MESSAGES — thread + type fields ───────────────────────
  addCol('messages', 'case_id', 'INTEGER');
  addCol('messages', 'thread_id', 'TEXT');
  addCol('messages', 'message_type', "TEXT DEFAULT 'text'");
  addCol('messages', 'file_url', 'TEXT');
  addCol('messages', 'status', "TEXT DEFAULT 'open'");
  addCol('messages', 'edited_at', 'TEXT');
  addCol('messages', 'reactions', "TEXT DEFAULT '[]'");
  addCol('messages', 'subject', 'TEXT');

  // ── CLIENTS — engagement fields ───────────────────────────
  addCol('clients', 'email_verified', 'INTEGER DEFAULT 0');
  addCol('clients', 'verification_token', 'TEXT');
  addCol('clients', 'language_preference', "TEXT DEFAULT 'en'");
  addCol('clients', 'avatar', 'TEXT');
  addCol('clients', 'last_active_at', 'TEXT');

  // ── CASES — audit + assignment fields ─────────────────────
  addCol('cases', 'audit_log', "TEXT DEFAULT '[]'");
  addCol('cases', 'assigned_employees', "TEXT DEFAULT '[]'");
  addCol('cases', 'deadline', 'TEXT');
  addCol('cases', 'sla_hours', 'INTEGER');

  // ── SERVE INTAKE: civil-case metadata ─────────────────────
  addCol('cases', 'court_case_number', 'TEXT');
  addCol('cases', 'court_id', 'INTEGER');
  addCol('cases', 'plaintiff_person_id', 'INTEGER');
  addCol('cases', 'defendant_person_id', 'INTEGER');
  addCol('cases', 'attorney_person_id', 'INTEGER');
  addCol('cases', 'signed_filed_date', 'TEXT');
  addCol('cases', 'response_deadline_days', 'INTEGER');
  addCol('cases', 'amount_demanded', 'REAL');
  addCol('cases', 'cause_of_action', 'TEXT');

  // ── USERS/EMPLOYEES — territory + performance fields ──────
  addCol('users', 'photo', 'TEXT');
  addCol('users', 'territory_zips', "TEXT DEFAULT '[]'");
  addCol('users', 'availability', "TEXT DEFAULT '{}'");
  addCol('users', 'active_case_count', 'INTEGER DEFAULT 0');
  addCol('users', 'performance', "TEXT DEFAULT '{}'");

  // ── COURT EVENTS — continuance, bail, confirmation, judge notes, documents ──
  addCol('court_events', 'continuance_count', 'INTEGER DEFAULT 0');
  addCol('court_events', 'continuance_log', "TEXT DEFAULT '[]'");
  // Bug: court.ts POST route INSERTs defendant_dob but no migration added it.
  // Every court event create threw 500 "no such column: defendant_dob".
  addCol('court_events', 'defendant_dob', 'TEXT');
  addCol('court_events', 'bail_amount', 'REAL');
  addCol('court_events', 'bond_status', 'TEXT');
  addCol('court_events', 'surety_info', 'TEXT');
  addCol('court_events', 'officer_confirmations', "TEXT DEFAULT '{}'");
  addCol('court_events', 'judge_notes', 'TEXT');
  addCol('court_events', 'documents', "TEXT DEFAULT '[]'");
  addCol('court_events', 'witnesses', "TEXT DEFAULT '[]'");
  addCol('court_events', 'court_fees', "TEXT DEFAULT '{}'");
  addCol('court_events', 'prosecutor_phone', 'TEXT');
  addCol('court_events', 'prosecutor_email', 'TEXT');

  // Defensive: these tables existed historically but had no CREATE in source.
  db.prepare(`CREATE TABLE IF NOT EXISTS email_cache (
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_cache_folder ON email_cache(folder_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_cache_received ON email_cache(received_at DESC)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_cache_conv ON email_cache(conversation_id)`).run();

  // FTS5 standalone table for full-text search over email bodies.
  // We cannot use external-content=email_cache because `body_text` is
  // derived (html_to_text(body_html)) and not a real column — FTS5
  // bookkeeping would fail with `no such column: T.body_text` at init.
  // Standalone trades ~2x disk for correctness; triggers below keep it synced.
  db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS email_cache_fts USING fts5(
    subject, from_address, from_name, body_text,
    tokenize='porter unicode61'
  )`).run();

  db.prepare(`CREATE TRIGGER IF NOT EXISTS email_cache_ai AFTER INSERT ON email_cache BEGIN
    INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text)
    VALUES (new.id, COALESCE(new.subject,''), COALESCE(new.from_address,''), COALESCE(new.from_name,''), html_to_text(new.body_html));
  END`).run();

  db.prepare(`CREATE TRIGGER IF NOT EXISTS email_cache_ad AFTER DELETE ON email_cache BEGIN
    INSERT INTO email_cache_fts(email_cache_fts, rowid, subject, from_address, from_name, body_text)
    VALUES ('delete', old.id, COALESCE(old.subject,''), COALESCE(old.from_address,''), COALESCE(old.from_name,''), html_to_text(old.body_html));
  END`).run();

  db.prepare(`CREATE TRIGGER IF NOT EXISTS email_cache_au AFTER UPDATE ON email_cache BEGIN
    INSERT INTO email_cache_fts(email_cache_fts, rowid, subject, from_address, from_name, body_text)
    VALUES ('delete', old.id, COALESCE(old.subject,''), COALESCE(old.from_address,''), COALESCE(old.from_name,''), html_to_text(old.body_html));
    INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text)
    VALUES (new.id, COALESCE(new.subject,''), COALESCE(new.from_address,''), COALESCE(new.from_name,''), html_to_text(new.body_html));
  END`).run();

  // Idempotent backfill — any rows already in email_cache that aren't indexed yet
  db.prepare(`INSERT INTO email_cache_fts(rowid, subject, from_address, from_name, body_text)
    SELECT id, COALESCE(subject,''), COALESCE(from_address,''), COALESCE(from_name,''), html_to_text(body_html)
    FROM email_cache
    WHERE id NOT IN (SELECT rowid FROM email_cache_fts)`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS email_rules (
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_rules_enabled ON email_rules(enabled, priority)`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS email_rule_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_cache_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    executed_at TEXT NOT NULL,
    action_result TEXT,
    FOREIGN KEY (email_cache_id) REFERENCES email_cache(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_id) REFERENCES email_rules(id) ON DELETE CASCADE
  )`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_rule_matches_email ON email_rule_matches(email_cache_id)`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS email_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    graph_id TEXT UNIQUE NOT NULL,
    display_name TEXT,
    parent_folder_id TEXT,
    total_count INTEGER DEFAULT 0,
    unread_count INTEGER DEFAULT 0,
    synced_at TEXT
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS email_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_graph_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT
  )`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_links_email ON email_links(email_graph_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_links_entity ON email_links(entity_type, entity_id)`).run();
  addCol('email_links', 'auto_linked', 'INTEGER DEFAULT 0');

  addCol('email_cache',      'owner_user_id', 'INTEGER');
  addCol('email_folders',    'owner_user_id', 'INTEGER');
  addCol('email_rules',      'owner_user_id', 'INTEGER');

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_cache_owner    ON email_cache(owner_user_id, folder_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_folders_owner  ON email_folders(owner_user_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_rules_owner    ON email_rules(owner_user_id, enabled, priority)`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS user_graph_tokens (
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

  // Seed email auto-link allowlist + tip-line folder config if missing.
  const existingAllowlist = db.prepare(`SELECT config_value FROM system_config WHERE config_key = 'email_autolink_allowlist'`).get();
  if (!existingAllowlist) {
    db.prepare(`INSERT INTO system_config (config_key, config_value) VALUES (?, ?)`)
      .run('email_autolink_allowlist', JSON.stringify(['rmpgutah.us', '.gov', '.state.ut.us', 'ut.gov', 'slco.org']));
  }
  const existingTipFolder = db.prepare(`SELECT config_value FROM system_config WHERE config_key = 'email_tip_line_folder_id'`).get();
  if (!existingTipFolder) {
    db.prepare(`INSERT INTO system_config (config_key, config_value) VALUES (?, ?)`).run('email_tip_line_folder_id', '');
  }
  const existingTipOwner = db.prepare(`SELECT config_value FROM system_config WHERE config_key = 'email_tip_line_owner_user_id'`).get();
  if (!existingTipOwner) {
    db.prepare(`INSERT INTO system_config (config_key, config_value) VALUES (?, ?)`).run('email_tip_line_owner_user_id', '');
  }

  db.prepare(`CREATE TABLE IF NOT EXISTS scheduled_emails (
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_scheduled_emails_status ON scheduled_emails(status, scheduled_at)`).run();
  addCol('scheduled_emails', 'owner_user_id', 'INTEGER');
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_scheduled_owner      ON scheduled_emails(owner_user_id, status)`).run();

  // ── PHASE 4: pre-Phase-4 email data isolation ──
  // The original Phase 4 design called for wiping pre-Phase-4 email data on
  // first deploy, but the wipe failed in production because the existing
  // email_cache_fts virtual table's AFTER DELETE trigger references a
  // contentless FTS5 'delete' command path that errored on real prod data
  // (commit ddc6fcb7 / 2026-04-18 deploy). Since every per-user route filters
  // by `WHERE owner_user_id = ?` and pre-Phase-4 rows have owner_user_id=NULL,
  // the dormant data is already invisible to officers' inboxes, rule queries,
  // schedule listings, and link lookups. No wipe is needed.
  //
  // The shared-mailbox OAuth tokens (ms_email_access_token, etc.) also stay
  // in system_config — they are dead code under Phase 4 (no caller invokes
  // the global getGraphClient()) and will be cleaned up by an admin tool in a
  // follow-up rather than by an automatic destructive migration.

  // ── EMAIL_CACHE — categories for auto-tagging ──
  addCol('email_cache', 'categories', "TEXT DEFAULT '[]'");

  // ── TRAINING_RECORDS — attendance, assessments ──
  addCol('training_records', 'attendance', "TEXT DEFAULT '[]'");
  addCol('training_records', 'assessments', "TEXT DEFAULT '[]'");

  // ── MESSAGES — read receipts, acknowledgments, scheduling, attachments, priority ──
  addCol('messages', 'read_receipts', "TEXT DEFAULT '{}'");
  addCol('messages', 'acknowledgments', "TEXT DEFAULT '{}'");
  addCol('messages', 'scheduled_at', 'TEXT');
  addCol('messages', 'attachment_url', 'TEXT');
  addCol('messages', 'attachment_name', 'TEXT');
  addCol('messages', 'is_template', 'INTEGER DEFAULT 0');
  addCol('messages', 'template_name', 'TEXT');

  // ── BOLOS — expiration config ──
  addCol('bolos', 'auto_expire_hours', 'INTEGER');
  addCol('bolos', 'expired_at', 'TEXT');

  // ── USERS — notification prefs, theme, font size, favorites, recently viewed ──
  addCol('users', 'notification_prefs', "TEXT DEFAULT '{}'");
  addCol('users', 'theme_preference', "TEXT DEFAULT 'dark'");
  addCol('users', 'font_size_preference', "TEXT DEFAULT 'medium'");
  addCol('users', 'favorites', "TEXT DEFAULT '[]'");
  addCol('users', 'recently_viewed', "TEXT DEFAULT '[]'");

  // ── USER_PREFERENCES — persisted per-user UI settings ───────
  const userPreferenceColumns: Array<[string, string]> = [
    ['notify_dispatch_email', 'INTEGER DEFAULT 1'],
    ['notify_dispatch_inapp', 'INTEGER DEFAULT 1'],
    ['notify_bolo_email', 'INTEGER DEFAULT 1'],
    ['notify_bolo_inapp', 'INTEGER DEFAULT 1'],
    ['notify_warrant_email', 'INTEGER DEFAULT 0'],
    ['notify_warrant_inapp', 'INTEGER DEFAULT 1'],
    ['notify_system_email', 'INTEGER DEFAULT 0'],
    ['notify_system_inapp', 'INTEGER DEFAULT 1'],
    ['notify_credential_email', 'INTEGER DEFAULT 1'],
    ['notify_credential_inapp', 'INTEGER DEFAULT 1'],
    ['notify_pso_email', 'INTEGER DEFAULT 1'],
    ['notify_pso_inapp', 'INTEGER DEFAULT 1'],
    ['quiet_hours_start', 'TEXT'],
    ['quiet_hours_end', 'TEXT'],
    ['font_scale', 'REAL DEFAULT 1.0'],
    ['compact_mode', 'INTEGER DEFAULT 0'],
    ['show_map_labels', 'INTEGER DEFAULT 1'],
    ['default_map_style', "TEXT DEFAULT 'dark'"],
    ['dashboard_widgets', 'TEXT'],
    ['dispatch_sort', "TEXT DEFAULT 'priority'"],
    ['dispatch_show_cleared', 'INTEGER DEFAULT 0'],
    ['theme_preference', "TEXT DEFAULT 'dark'"],
    ['font_size_preference', "TEXT DEFAULT 'medium'"],
    ['created_at', "TEXT DEFAULT (datetime('now','localtime'))"],
    ['updated_at', "TEXT DEFAULT (datetime('now','localtime'))"],
  ];
  for (const [col, type] of userPreferenceColumns) {
    addCol('user_preferences', col, type);
  }

  // ── CONFIG CHANGE HISTORY table ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS config_change_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        changed_by INTEGER NOT NULL,
        changed_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (changed_by) REFERENCES users(id)
      );
    `);
  } catch { /* already exists */ }

  // ── RECORD LOCKS table ──
  try {
    db.exec(`
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
    `);
  } catch { /* already exists */ }

  // ── BROADCAST TEMPLATES table ──
  try {
    db.exec(`
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
    `);
  } catch { /* already exists */ }

  // ── SYSTEM ANNOUNCEMENTS table ──
  try {
    db.exec(`
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
    `);
  } catch { /* already exists */ }

  // ── PERSONNEL — fitness tracking, commendations, status history ──────
  addCol('users', 'fitness_scores', "TEXT DEFAULT '[]'");
  addCol('users', 'commendations', "TEXT DEFAULT '[]'");
  addCol('users', 'status_history', "TEXT DEFAULT '[]'");
  addCol('users', 'assignment_history', "TEXT DEFAULT '[]'");

  // ── HR — new tracking tables ────────────────────────────────────────
  try {
    db.exec(`
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
    `);
  } catch { /* tables already exist */ }

  // ── FLEET — tire tracking, damage, recalls, fuel cards ──────────────
  try {
    db.exec(`
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
    `);
  } catch { /* tables already exist */ }

  addCol('fleet_vehicles', 'total_maintenance_cost', 'REAL DEFAULT 0');
  addCol('fleet_vehicles', 'total_fuel_cost', 'REAL DEFAULT 0');
  addCol('fleet_vehicles', 'total_trips', 'INTEGER DEFAULT 0');
  addCol('fleet_vehicles', 'avg_mpg', 'REAL');
  // Bug: fleet.ts POST route INSERTs next_service_mileage but the column
  // was never added to the schema — every fleet vehicle create threw 500.
  addCol('fleet_vehicles', 'next_service_mileage', 'INTEGER');
  addCol('fleet_inspections', 'checklist', "TEXT DEFAULT '[]'");

  // ── HR — performance review template field ──
  addCol('performance_reviews', 'template_name', 'TEXT');

  // ══════════════════════════════════════════════════════════
  // NEW FEATURES — Schema extensions (features 1-45)
  // ══════════════════════════════════════════════════════════

  // Feature 5: Guard Tour Verification
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS patrol_tour_verifications (
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
  } catch { /* already exists */ }

  // Feature 8: Weather on patrol scans
  addCol('patrol_scans', 'weather_json', 'TEXT');

  // Feature 16: Photo on trespass orders
  addCol('trespass_orders', 'subject_photo_url', 'TEXT');

  // Feature 21: Proximity alerts on offenders
  addCol('offender_alerts', 'alert_latitude', 'REAL');
  addCol('offender_alerts', 'alert_longitude', 'REAL');
  addCol('offender_alerts', 'alert_address', 'TEXT');
  addCol('offender_alerts', 'alert_enabled', 'INTEGER DEFAULT 1');

  // Forensic cases — missing columns for indexes
  addCol('forensic_cases', 'linked_incident_id', 'INTEGER');
  addCol('forensic_cases', 'lab_number', 'TEXT');
  addCol('forensic_cases', 'lead_examiner_id', 'INTEGER');
  addCol('forensic_cases', 'linked_case_id', 'INTEGER');

  // Dashcam videos — incident linkage
  addCol('dashcam_videos', 'incident_id', 'INTEGER');

  // Serve queue — person/property FK links for connection graph
  addCol('serve_queue', 'recipient_person_id', 'INTEGER');
  addCol('serve_queue', 'property_id', 'INTEGER');

  // Training records/requirements — missing columns
  addCol('training_records', 'training_type', 'TEXT');
  addCol('training_records', 'expiration_date', 'TEXT');
  addCol('training_requirements', 'required_for_role', 'TEXT');
  addCol('training_requirements', 'is_active', 'INTEGER DEFAULT 1');

  // HR tables — missing columns
  addCol('hr_documents', 'officer_id', 'INTEGER');
  addCol('hr_documents', 'document_type', 'TEXT');
  addCol('hr_grievances', 'officer_id', 'INTEGER');
  addCol('hr_workers_comp', 'injury_date', 'TEXT');
  addCol('hr_attendance', 'attendance_date', 'TEXT');

  // Fleet tables — missing columns
  addCol('fleet_tires', 'status', 'TEXT DEFAULT "active"');
  addCol('fleet_damage_reports', 'status', 'TEXT DEFAULT "pending"');
  addCol('fleet_damage_reports', 'reported_at', 'TEXT');

  // Email logs
  addCol('email_logs', 'to_email', 'TEXT');

  // Patrol breaks
  addCol('patrol_breaks', 'start_time', 'TEXT');

  // Person associates
  addCol('person_associates', 'associated_person_id', 'INTEGER');

  // CPGPS tables
  addCol('cpgps_vehicles', 'unit_number', 'TEXT');
  addCol('cpgps_trips', 'start_time', 'TEXT');
  addCol('cpgps_locations', 'timestamp', 'TEXT');

  // Warrant watch
  addCol('warrant_watch_runs', 'created_at', 'TEXT');
  addCol('warrant_watch_log', 'run_id', 'INTEGER');

  // Record locks
  addCol('record_locks', 'user_id', 'INTEGER');

  // Utah statutes
  addCol('utah_statutes', 'statute_code', 'TEXT');

  // Feature 26: Evidence intake extended fields
  addCol('forensic_exhibits', 'condition_on_receipt', 'TEXT');
  addCol('forensic_exhibits', 'packaging_type', 'TEXT');
  addCol('forensic_exhibits', 'packaging_sealed', 'INTEGER DEFAULT 0');
  addCol('forensic_exhibits', 'collected_by', 'TEXT');
  addCol('forensic_exhibits', 'collected_date', 'TEXT');
  addCol('forensic_exhibits', 'collected_location', 'TEXT');
  addCol('forensic_exhibits', 'received_from', 'TEXT');
  addCol('forensic_exhibits', 'storage_location', 'TEXT');
  addCol('forensic_exhibits', 'storage_requirements', 'TEXT');
  addCol('forensic_exhibits', 'is_hazardous', 'INTEGER DEFAULT 0');
  addCol('forensic_exhibits', 'is_biohazard', 'INTEGER DEFAULT 0');
  addCol('forensic_exhibits', 'current_custodian', 'TEXT');
  addCol('forensic_exhibits', 'current_custodian_id', 'INTEGER');
  // Client form sends `examination_requested` (what examination the intake officer
  // wants performed) — was silently dropped before 2026-04-19.
  addCol('forensic_exhibits', 'examination_requested', 'TEXT');

  // Feature 42-43: Vehicle registration & insurance
  addCol('vehicles_records', 'registration_expiry', 'TEXT');
  addCol('vehicles_records', 'insurance_company', 'TEXT');
  addCol('vehicles_records', 'insurance_policy', 'TEXT');
  addCol('vehicles_records', 'insurance_status', 'TEXT');
  addCol('vehicles_records', 'insurance_expiry', 'TEXT');
  addCol('vehicles_records', 'insurance_verified_at', 'TEXT');
  addCol('vehicles_records', 'insurance_verified_by', 'INTEGER');
  addCol('vehicles_records', 'is_stolen', 'INTEGER DEFAULT 0');

  // ── CRM: Leads ──
  // Bug: Production has this table but it was never added to the schema
  // migration. Any fresh install had no CRM functionality.
  db.prepare(`
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_crm_leads_source ON crm_leads(source)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(pipeline_stage)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_crm_leads_score ON crm_leads(lead_score DESC)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON crm_leads(assigned_to)`).run();

  // Activity log for leads (audit trail of stage changes, calls, etc.)
  // Same missing-from-schema issue as crm_leads.
  db.prepare(`
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_crm_lead_activity_lead ON crm_lead_activity(lead_id)`).run();

  // ── HR: Leave Requests ──
  // Bug: This table exists in production but was never added to the schema
  // migration. Any fresh install (including test DBs) had no HR functionality.
  // No CHECK constraints on type/status — route enum list has drifted from
  // the production CHECK list, so permissive TEXT avoids silent constraint
  // violations (e.g. route accepts 'military', 'jury_duty' which old CHECK rejects).
  db.prepare(`
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_leave_requests_officer ON leave_requests(officer_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status)`).run();

  // ── HR: Disciplinary Records ──
  // Same missing-from-schema issue as leave_requests. No CHECK constraints
  // on type/status to accommodate route enum values that drifted from the
  // production CHECK list (route sends 'probation', 'other', 'pending_review'
  // which old production CHECK constraints rejected).
  db.prepare(`
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
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_disciplinary_officer ON disciplinary_records(officer_id)`).run();

  // ── PDF v2: rendered PDF artifacts attached to records ──
  // Stores PDFs generated by the v2 engine (renderer consumes FormSchema) and
  // attached to case/incident/warrant/evidence records. The blob lives on disk
  // at <uploads>/pdf/<form_type>/<YYYY>/<MM>/<sha256>.pdf; only the path +
  // SHA-256 hash are stored here for dedupe + tamper detection.
  db.prepare(`
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
  db.prepare('CREATE INDEX IF NOT EXISTS idx_pdf_artifacts_rec ON pdf_artifacts(record_type, record_id)').run();

  // ── Feature 3: Call tag system ──
  addCol('calls_for_service', 'tags', "TEXT DEFAULT '[]'");

  // ── Dispatch analytics columns ──
  addCol('calls_for_service', 'priority_score', 'INTEGER DEFAULT 0');
  addCol('calls_for_service', 'response_time_seconds', 'REAL');
  addCol('calls_for_service', 'status_changed_at', 'TEXT');
  addCol('calls_for_service', 'onscene_duration_seconds', 'REAL');

  // ── Calls: overdue notification tracking (prevent duplicate alerts) ──
  // Used by callAgingMonitor to track which aging thresholds (30m/60m/72h) have
  // already been notified. Cleared when call transitions to cleared/closed/cancelled.
  // Bug: This column was referenced in callActions.ts clear-status path but never
  // added to the schema — every call-clear threw "no such column" 500 errors.
  addCol('calls_for_service', 'overdue_notified', 'TEXT');

  // ── Calls: received_at timestamp (when call was first received) ──
  // Bug: calls.ts:576 INSERT and calls.ts:1213 UPDATE both reference this
  // column but no migration added it — every call create threw 500 errors.
  addCol('calls_for_service', 'received_at', 'TEXT');

  // ── Dispatch advanced UX: pinned calls (float-to-top sticky flag) ──
  addCol('calls_for_service', 'pinned', 'INTEGER DEFAULT 0');

  // ── Feature 5: Shift handoff notes ──
  // Stored in system_config table with config_key='shift_handoff_notes'

  // ── Feature 6: Person known associates ──
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_person_associates_person ON person_associates(person_id);
    CREATE INDEX IF NOT EXISTS idx_person_associates_associate ON person_associates(associate_id);
  `);

  // ── Feature 7: Vehicle tow tracking ──
  addCol('vehicles_records', 'tow_status', 'TEXT');
  addCol('vehicles_records', 'tow_company', 'TEXT');
  addCol('vehicles_records', 'tow_lot_location', 'TEXT');
  addCol('vehicles_records', 'tow_date', 'TEXT');
  addCol('vehicles_records', 'tow_release_date', 'TEXT');
  addCol('vehicles_records', 'tow_release_to', 'TEXT');
  addCol('vehicles_records', 'tow_reason', 'TEXT');

  // ── Vehicles: owner/condition/registration extended fields ──
  // Bug: VehicleFormModal renders inputs for all of these but the schema
  // migration never added them. Production has them (from an earlier
  // manual migration); fresh installs did not. Route fixes in records.ts
  // add these to the shared VEHICLE_FIELD_MAP so POST and PUT accept them.
  addCol('vehicles_records', 'registration_state', 'TEXT');
  addCol('vehicles_records', 'owner_name', 'TEXT');
  addCol('vehicles_records', 'owner_dl_number', 'TEXT');
  addCol('vehicles_records', 'owner_dob', 'TEXT');
  addCol('vehicles_records', 'primary_driver_name', 'TEXT');
  addCol('vehicles_records', 'registered_owner', 'TEXT');
  addCol('vehicles_records', 'exterior_condition', 'TEXT');
  addCol('vehicles_records', 'interior_condition', 'TEXT');
  addCol('vehicles_records', 'title_status', 'TEXT');
  addCol('vehicles_records', 'window_tint', 'TEXT');
  addCol('vehicles_records', 'modifications', 'TEXT');
  addCol('vehicles_records', 'equipment_notes', 'TEXT');
  addCol('vehicles_records', 'vehicle_use', 'TEXT');
  addCol('vehicles_records', 'ncic_entry_number', 'TEXT');
  addCol('vehicles_records', 'estimated_value', 'REAL');
  addCol('vehicles_records', 'tow_location', 'TEXT');
  addCol('vehicles_records', 'insurance_expiry', 'TEXT');

  // ── Feature 8: Evidence temperature tracking ──
  addCol('evidence', 'storage_temperature', 'REAL');
  addCol('evidence', 'is_biological', 'INTEGER DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_temperature_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
      temperature REAL NOT NULL,
      recorded_by INTEGER REFERENCES users(id),
      recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_temp_logs ON evidence_temperature_logs(evidence_id);
  `);

  // ── Feature 9: Incident weather at time ──
  addCol('incidents', 'weather_conditions', 'TEXT');
  addCol('incidents', 'weather_temperature', 'REAL');
  addCol('incidents', 'weather_recorded_at', 'TEXT');

  // ── Feature 10: Case priority auto-calculation (uses existing priority field on cases) ──
  // No schema change needed - logic is in backend route

  // ── Feature 12: Property special instructions ──
  addCol('patrol_checkpoints', 'special_instructions', 'TEXT');

  // ── Feature 13: Patrol break tracking ──
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_patrol_breaks_officer ON patrol_breaks(officer_id, shift_date);
  `);

  // ── Feature 16: Vehicle pre-trip checklist ──
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_fleet_pretrip_vehicle ON fleet_pretrip_checklists(vehicle_id, shift_date);
  `);

  // ── Feature 19: Vehicle swap logging ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS fleet_vehicle_swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL REFERENCES users(id),
      from_vehicle_id INTEGER REFERENCES fleet_vehicles(id),
      to_vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id),
      reason TEXT,
      swapped_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_fleet_swaps_officer ON fleet_vehicle_swaps(officer_id);
  `);

  // ── Feature 26: Message drafts ──
  addCol('messages', 'is_draft', 'INTEGER DEFAULT 0');
  addCol('messages', 'draft_updated_at', 'TEXT');

  // ── Feature 27: BOLO photo attachment ──
  addCol('bolos', 'photos', "TEXT DEFAULT '[]'");

  // ── Feature 29: Message delivery confirmation ──
  addCol('messages', 'delivered_at', 'TEXT');
  addCol('messages', 'delivery_status', "TEXT DEFAULT 'sent'");

  // ── Feature 21: Password expiry tracking (already have password_changed_at on users) ──
  // No schema change needed — use existing password_changed_at + config for expiry days

  // ── Feature 23: Per-user notification sound toggle ──
  // Stored in user_preferences table with pref_key='notification_sounds_enabled'

  // ── PSO visit history — tracks each dispatch attempt's timestamps + service windows ──
  db.prepare(`
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
  db.prepare('CREATE INDEX IF NOT EXISTS idx_call_visit_call ON call_visit_history(call_id)').run();

  // ── Ensure call_persons junction table exists (used by dispatch person linking) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      role TEXT,
      notes TEXT,
      added_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_call_persons_call ON call_persons(call_id);
    CREATE INDEX IF NOT EXISTS idx_call_persons_person ON call_persons(person_id);
  `);

  // ══════════════════════════════════════════════════════════════
  // Warrant Scanner / Watch Tables
  // ══════════════════════════════════════════════════════════════

  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_utah_warrants_name ON utah_warrants(last_name, first_name);
    CREATE INDEX IF NOT EXISTS idx_utah_warrants_fetched ON utah_warrants(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_warrant_watch_log_person ON warrant_watch_log(person_id);
    CREATE INDEX IF NOT EXISTS idx_scraped_warrants_name ON scraped_warrants(last_name, first_name);
  `);

  // New columns on warrants table for external source tracking
  addCol('warrants', 'source', "TEXT DEFAULT 'manual'");
  addCol('warrants', 'external_warrant_id', 'TEXT');
  addCol('warrants', 'external_source_key', 'TEXT');
  addCol('warrants', 'auto_created', 'INTEGER DEFAULT 0');

  // ── units mileage + GPS source columns ──
  addCol('units', 'mileage', 'REAL');
  addCol('units', 'gps_source', 'TEXT');           // 'device'|'manual'|'dispatch'|'mdtWebSocket' — GPS source priority
  addCol('units', 'gps_updated_at', 'TEXT');        // ISO timestamp of last GPS position update

  // ── OwnTracks / Traccar device-to-unit mapping table ──
  db.prepare(`
    CREATE TABLE IF NOT EXISTS owntracks_device_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracker_id TEXT NOT NULL UNIQUE,
      unit_id INTEGER NOT NULL,
      device_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    )
  `).run();

  // ── units: add 'out_of_service' to CHECK constraint (production fix) ──
  try {
    const uInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='units'").get() as { sql: string } | undefined;
    if (uInfo && !uInfo.sql.includes('out_of_service')) {
      db.pragma('foreign_keys = OFF');
      // Use the original CREATE TABLE SQL but replace the CHECK constraint
      const newSql = uInfo.sql
        .replace(/CREATE TABLE units/i, 'CREATE TABLE units_new')
        .replace(
          /CHECK\(status IN \([^)]+\)\)/i,
          "CHECK(status IN ('available','dispatched','enroute','onscene','busy','off_duty','out_of_service'))"
        );
      const cols = db.prepare("PRAGMA table_info(units)").all() as any[];
      const colNames = cols.map((c: any) => c.name).join(', ');
      db.prepare(newSql).run();
      db.prepare(`INSERT INTO units_new (${colNames}) SELECT ${colNames} FROM units`).run();
      db.prepare('DROP TABLE units').run();
      db.prepare('ALTER TABLE units_new RENAME TO units').run();
      db.pragma('foreign_keys = ON');
    }
  } catch (e) { console.warn('[DB] units CHECK migration skipped:', e instanceof Error ? e.message : e); }

  // ── calls_for_service: add 'intake','servemanager' to source CHECK constraint ──
  for (const tbl of ['calls_for_service', 'incidents']) {
    try {
      const info = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tbl}'`).get() as { sql: string } | undefined;
      if (info && !info.sql.includes("'intake'")) {
        db.pragma('foreign_keys = OFF');
        const newSql = info.sql
          .replace(new RegExp(`CREATE TABLE ${tbl}`, 'i'), `CREATE TABLE ${tbl}_new`)
          .replace(
            /CHECK\(source IN \([^)]+\)\)/i,
            "CHECK(source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','panic','servemanager','intake','other'))"
          );
        const cols = db.prepare(`PRAGMA table_info(${tbl})`).all() as any[];
        const colNames = cols.map((c: any) => c.name).join(', ');
        db.prepare(newSql).run();
        db.prepare(`INSERT INTO ${tbl}_new (${colNames}) SELECT ${colNames} FROM ${tbl}`).run();
        db.prepare(`DROP TABLE ${tbl}`).run();
        db.prepare(`ALTER TABLE ${tbl}_new RENAME TO ${tbl}`).run();
        db.pragma('foreign_keys = ON');
      }
    } catch (e) { console.warn(`[DB] ${tbl} source CHECK migration skipped:`, e instanceof Error ? e.message : e); }
  }

  // ── warrant_scraper_config missing columns ──
  addCol('warrant_scraper_config', 'source_name', 'TEXT');
  addCol('warrant_scraper_config', 'last_run_at', 'TEXT');
  addCol('warrant_scraper_config', 'last_error', 'TEXT');
  // `source_type` ('api'|'html'|'search_form') needed by the seed below and
  // the circuit-breaker query in servemanager; wasn't in CREATE TABLE so it
  // must be lazy-added before the INSERT references it.
  addCol('warrant_scraper_config', 'source_type', 'TEXT');

  // Warrant scraper enhancement — Phase 1 columns
  addCol('warrant_scraper_config', 'priority', 'INTEGER DEFAULT 3');
  addCol('warrant_scraper_config', 'content_hash', 'TEXT');
  addCol('warrant_scraper_config', 'content_hash_updated_at', 'TEXT');
  addCol('warrant_scraper_config', 'etag', 'TEXT');
  addCol('warrant_scraper_config', 'last_modified', 'TEXT');
  addCol('warrant_scraper_config', 'last_success_at', 'TEXT');
  addCol('warrant_scraper_config', 'avg_parse_count', 'REAL');
  addCol('warrant_scraper_config', 'p95_latency_ms', 'INTEGER');
  addCol('warrant_scraper_config', 'jitter_seed', 'INTEGER');

  // Warrant scraper enhancement — Phase 1 runs metrics table
  try {
    db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_scraper_runs_source_time
        ON warrant_scraper_runs (source_key, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scraper_runs_started_at
        ON warrant_scraper_runs (started_at DESC);
    `);
  } catch (e) { /* */ }

  // ── scraped_warrants missing columns ──
  addCol('scraped_warrants', 'middle_name', 'TEXT');
  addCol('scraped_warrants', 'age', 'INTEGER');
  addCol('scraped_warrants', 'gender', 'TEXT');
  addCol('scraped_warrants', 'race', 'TEXT');
  addCol('scraped_warrants', 'city', 'TEXT');
  addCol('scraped_warrants', 'state', 'TEXT');
  addCol('scraped_warrants', 'photo_url', 'TEXT');
  addCol('scraped_warrants', 'detail_url', 'TEXT');
  addCol('scraped_warrants', 'first_seen_at', 'TEXT');
  addCol('scraped_warrants', 'last_seen_at', 'TEXT');
  addCol('scraped_warrants', 'cleared_at', 'TEXT');
  addCol('scraped_warrants', 'dob_verified', 'INTEGER DEFAULT 0');
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_scraped_warrants_state ON scraped_warrants(state)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_scraped_warrants_source ON scraped_warrants(source_key)'); } catch (e) { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_scraped_warrants_offense ON scraped_warrants(offense_level)'); } catch (e) { /* */ }

  // ── Seed warrant scraper sources — All 50 US States + Federal ──
  {
    const s = db.prepare('INSERT OR IGNORE INTO warrant_scraper_config (source_key, state, county, source_url, source_name, source_type, scrape_interval_minutes, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    // Federal
    s.run('federal_fbi_wanted', 'US', '', 'https://api.fbi.gov/wanted/v1/list', 'FBI Most Wanted', 'api', 360, 1);
    s.run('federal_usmarshals', 'US', '', 'https://www.usmarshals.gov/what-we-do/fugitive-investigations/15-most-wanted-fugitive', 'US Marshals Most Wanted', 'html', 1440, 0);
    // Alabama
    s.run('al_jefferson_warrants', 'AL', 'Jefferson', 'https://www.jeffcosheriffal.com/most-wanted', 'Jefferson County AL', 'html', 720, 0);
    // Alaska
    s.run('ak_anchorage_warrants', 'AK', 'Anchorage', 'https://www.muni.org/departments/prior/APD/Pages/MostWanted.aspx', 'Anchorage PD', 'html', 720, 0);
    // Arizona
    s.run('az_maricopa_warrants', 'AZ', 'Maricopa', 'https://www.mcso.org/Most-Wanted', 'Maricopa County SO', 'html', 720, 1);
    s.run('az_pima_warrants', 'AZ', 'Pima', 'https://88crime.org/category/wanted-fugitives/', 'Pima County 88-CRIME', 'html', 720, 1);
    // Arkansas
    s.run('ar_pulaski_warrants', 'AR', 'Pulaski', 'https://www.littlerock.gov/city-administration/city-departments/police/most-wanted/', 'Little Rock PD', 'html', 720, 0);
    // California
    s.run('ca_los_angeles_warrants', 'CA', 'Los Angeles', 'https://www.lapdonline.org/most-wanted/', 'LAPD Most Wanted', 'html', 720, 1);
    s.run('ca_san_diego_warrants', 'CA', 'San Diego', 'https://www.sdcda.org/helping/fugitives.html', 'San Diego DA Fugitives', 'html', 720, 0);
    // Colorado
    s.run('co_el_paso_warrants', 'CO', 'El Paso', 'https://www.epcsheriffsoffice.com/active-warrants', 'El Paso County SO', 'html', 720, 1);
    s.run('co_denver_warrants', 'CO', 'Denver', 'https://www.metrodenvercrimestoppers.com/', 'Metro Denver Crime Stoppers', 'html', 720, 1);
    s.run('co_adams_warrants', 'CO', 'Adams', 'https://adamscosheriff.net/portal/MostWanted', 'Adams County SO', 'html', 720, 0);
    // Connecticut
    s.run('ct_hartford_warrants', 'CT', 'Hartford', 'https://www.manchesterct.gov/Police-Department/Most-Wanted', 'Hartford Area', 'html', 720, 0);
    // Delaware
    s.run('de_new_castle_warrants', 'DE', 'New Castle', 'https://www.tipsubmit.com/WebTips.aspx?AgencyID=256', 'Delaware Crime Stoppers', 'html', 720, 0);
    // Florida
    s.run('fl_miami_warrants', 'FL', 'Miami-Dade', 'https://www.crimestoppersmiami.com/mostwanted', 'Miami-Dade Crime Stoppers', 'html', 720, 1);
    s.run('fl_hillsborough_warrants', 'FL', 'Hillsborough', 'https://www.hcso.tampa.fl.us/Community/Most-Wanted', 'Hillsborough County SO', 'html', 720, 0);
    // Georgia
    s.run('ga_fulton_warrants', 'GA', 'Fulton', 'https://www.fultoncountyga.gov/services/sheriff-s-office/most-wanted', 'Fulton County GA', 'html', 720, 0);
    // Hawaii
    s.run('hi_honolulu_warrants', 'HI', 'Honolulu', 'https://www.crimestoppershonolulu.org/', 'Honolulu Crime Stoppers', 'html', 1440, 0);
    // Idaho
    s.run('id_ada_warrants', 'ID', 'Ada', 'https://apps.adacounty.id.gov/sheriff/reports/warrants.aspx', 'Ada County', 'search_form', 720, 0);
    // Illinois
    s.run('il_cook_warrants', 'IL', 'Cook', 'https://www.cookcountysheriff.org/most-wanted/', 'Cook County SO', 'html', 720, 1);
    // Indiana
    s.run('in_marion_warrants', 'IN', 'Marion', 'https://www.indycrimestoppers.org/', 'Indianapolis Crime Stoppers', 'html', 720, 0);
    // Iowa
    s.run('ia_polk_warrants', 'IA', 'Polk', 'https://www.polkcountyiowa.gov/county-sheriff/most-wanted/', 'Polk County IA', 'html', 720, 0);
    // Kansas
    s.run('ks_sedgwick_warrants', 'KS', 'Sedgwick', 'https://www.sedgwickcounty.org/sheriff/most-wanted/', 'Sedgwick County KS', 'html', 720, 0);
    // Kentucky
    s.run('ky_jefferson_warrants', 'KY', 'Jefferson', 'https://www.lmpd.org/wanted.html', 'Louisville Metro PD', 'html', 720, 0);
    // Louisiana
    s.run('la_orleans_warrants', 'LA', 'Orleans', 'https://www.crimestoppersgno.org/mostwanted', 'New Orleans Crime Stoppers', 'html', 720, 0);
    // Maine
    s.run('me_cumberland_warrants', 'ME', 'Cumberland', 'https://www.maine.gov/dps/msp/wanted-missing', 'Maine State Police', 'html', 720, 0);
    // Maryland
    s.run('md_baltimore_warrants', 'MD', 'Baltimore', 'https://www.baltimorepolice.org/most-wanted', 'Baltimore PD', 'html', 720, 0);
    // Massachusetts
    s.run('ma_suffolk_warrants', 'MA', 'Suffolk', 'https://www.mass.gov/most-wanted', 'Massachusetts Most Wanted', 'html', 720, 1);
    // Michigan
    s.run('mi_wayne_warrants', 'MI', 'Wayne', 'https://www.crimestoppers.com/', 'Detroit Crime Stoppers', 'html', 720, 0);
    // Minnesota
    s.run('mn_hennepin_warrants', 'MN', 'Hennepin', 'https://www.hennepinsheriff.org/jail-warrants/warrants', 'Hennepin County', 'html', 720, 0);
    // Mississippi
    s.run('ms_hinds_warrants', 'MS', 'Hinds', 'https://www.mscrimestoppers.com/mostwanted', 'Mississippi Crime Stoppers', 'html', 720, 0);
    // Missouri
    s.run('mo_jackson_warrants', 'MO', 'Jackson', 'https://www.kcpd.org/crime/most-wanted/', 'Kansas City PD', 'html', 720, 0);
    // Montana
    s.run('mt_flathead_warrants', 'MT', 'Flathead', 'https://apps.flathead.mt.gov/warrants/warrants_list.php', 'Flathead County', 'html', 720, 1);
    // Nebraska
    s.run('ne_douglas_warrants', 'NE', 'Douglas', 'https://www.omahacrimestoppers.org/mostwanted', 'Omaha Crime Stoppers', 'html', 720, 0);
    // Nevada
    s.run('nv_clark_warrants', 'NV', 'Clark', 'https://www.lvmpd.com/en-us/Pages/MostWanted.aspx', 'LVMPD Most Wanted', 'html', 720, 1);
    s.run('nv_washoe_warrants', 'NV', 'Washoe', 'https://secretwitness.com/current-cases/current-fugitive-cases/', 'Washoe County Secret Witness', 'html', 720, 1);
    // New Hampshire
    s.run('nh_hillsborough_warrants', 'NH', 'Hillsborough', 'https://www.manchesternh.gov/Departments/Police/Most-Wanted', 'Manchester NH PD', 'html', 720, 0);
    // New Jersey
    s.run('nj_essex_warrants', 'NJ', 'Essex', 'https://www.njsp.org/wanted/index.shtml', 'NJ State Police', 'html', 720, 1);
    // New Mexico
    s.run('nm_bernalillo_warrants', 'NM', 'Bernalillo', 'https://bcapp.bernco.gov/BCSO_WarrantInterWITS/', 'Bernalillo County WITS', 'search_form', 720, 0);
    // New York
    s.run('ny_new_york_warrants', 'NY', 'New York', 'https://www.nyc.gov/nypd/most-wanted', 'NYPD Most Wanted', 'html', 720, 1);
    // North Carolina
    s.run('nc_mecklenburg_warrants', 'NC', 'Mecklenburg', 'https://www.crimestoppersofcharlotte.org/', 'Charlotte Crime Stoppers', 'html', 720, 0);
    // North Dakota
    s.run('nd_cass_warrants', 'ND', 'Cass', 'https://www.fargond.gov/city-government/departments/police/most-wanted', 'Fargo PD', 'html', 720, 0);
    // Ohio
    s.run('oh_cuyahoga_warrants', 'OH', 'Cuyahoga', 'https://www.cuyahogacounty.gov/sheriff/most-wanted', 'Cuyahoga County', 'html', 720, 0);
    // Oklahoma
    s.run('ok_oklahoma_warrants', 'OK', 'Oklahoma', 'https://www.okcpd.org/about-us/most-wanted/', 'Oklahoma City PD', 'html', 720, 0);
    // Oregon
    s.run('or_multnomah_warrants', 'OR', 'Multnomah', 'https://www.mcso.us/warrants/', 'Multnomah County', 'html', 720, 0);
    // Pennsylvania
    s.run('pa_philadelphia_warrants', 'PA', 'Philadelphia', 'https://www.phillypolice.com/forms/most-wanted/', 'Philadelphia PD', 'html', 720, 1);
    // Rhode Island
    s.run('ri_providence_warrants', 'RI', 'Providence', 'https://www.riag.ri.gov/most-wanted', 'Rhode Island AG', 'html', 720, 0);
    // South Carolina
    s.run('sc_richland_warrants', 'SC', 'Richland', 'https://www.rcsd.net/most-wanted', 'Richland County SC', 'html', 720, 0);
    // South Dakota
    s.run('sd_minnehaha_warrants', 'SD', 'Minnehaha', 'https://www.siouxfallspolice.com/resources/most-wanted', 'Sioux Falls PD', 'html', 720, 0);
    // Tennessee
    s.run('tn_davidson_warrants', 'TN', 'Davidson', 'https://www.nashville.gov/departments/police/most-wanted', 'Nashville PD', 'html', 720, 0);
    // Texas
    s.run('tx_harris_warrants', 'TX', 'Harris', 'https://www.crime-stoppers.org/mostwanted', 'Houston Crime Stoppers', 'html', 720, 1);
    s.run('tx_dallas_warrants', 'TX', 'Dallas', 'https://www.ntcrimestoppers.com/fugitives', 'North Texas Crime Stoppers', 'html', 720, 0);
    // Utah (statewide API handled by utahWarrantScraper.ts)
    s.run('ut_statewide', 'UT', '', 'https://warrants.utah.gov/api/v1', 'Utah State Warrants API', 'api', 360, 1);
    // Vermont
    s.run('vt_chittenden_warrants', 'VT', 'Chittenden', 'https://www.burlingtonvt.gov/Police/Most-Wanted', 'Burlington VT PD', 'html', 1440, 0);
    // Virginia
    s.run('va_fairfax_warrants', 'VA', 'Fairfax', 'https://www.fairfaxcounty.gov/police/wanted', 'Fairfax County PD', 'html', 720, 0);
    // Washington
    s.run('wa_king_warrants', 'WA', 'King', 'https://www.kingcounty.gov/en/dept/dajd/courts-jails-legal/warrants', 'King County WA', 'html', 720, 0);
    // West Virginia
    s.run('wv_kanawha_warrants', 'WV', 'Kanawha', 'https://www.wvsp.gov/pages/Most-Wanted.aspx', 'WV State Police', 'html', 720, 0);
    // Wisconsin
    s.run('wi_milwaukee_warrants', 'WI', 'Milwaukee', 'https://www.milwaukeecountywi.gov/county-departments/sheriff/most-wanted/', 'Milwaukee County', 'html', 720, 0);
    // Wyoming
    s.run('wy_laramie_warrants', 'WY', 'Laramie', 'https://www.laramiecountywy.gov/County-Government/Elected-Officials/Laramie-County-Sheriffs-Office/Most-Wanted', 'Laramie County', 'html', 720, 0);

    // ── Additional State Sources (expanded coverage) ──────────────────
    // Alaska
    s.run('ak_state_troopers', 'AK', '', 'https://www.prior.dps.alaska.gov/ast/AKMostWanted/MostWanted.aspx', 'Alaska State Troopers', 'html', 1440, 1);
    s.run('ak_mat_su_warrants', 'AK', 'Mat-Su', 'https://www.prior.matsugov.us/sheriff/wanted', 'Mat-Su Borough', 'html', 720, 1);
    // Alabama
    s.run('al_mobile_warrants', 'AL', 'Mobile', 'https://www.mobilecountysheriffal.com/most-wanted/', 'Mobile County SO', 'html', 720, 1);
    s.run('al_state_crimestop', 'AL', '', 'https://www.crime-stoppers.org/al/mostwanted', 'Alabama Crime Stoppers', 'html', 720, 1);
    // Arizona
    s.run('az_yavapai_warrants', 'AZ', 'Yavapai', 'https://yavapaisw.com/wanted-fugitives/', 'Yavapai Silent Witness', 'html', 720, 1);
    // Arkansas
    s.run('ar_benton_warrants', 'AR', 'Benton', 'https://www.bentoncountycrimestoppers.org/', 'Benton County Crime Stoppers', 'html', 720, 1);
    // California
    s.run('ca_riverside_warrants', 'CA', 'Riverside', 'https://www.riversidesheriff.org/810/Most-Wanted', 'Riverside County SO', 'html', 720, 1);
    s.run('ca_sacramento_warrants', 'CA', 'Sacramento', 'https://www.sacsheriff.com/pages/most_wanted.aspx', 'Sacramento County SO', 'html', 720, 1);
    s.run('ca_fresno_warrants', 'CA', 'Fresno', 'https://www.valleycrimestoppers.org/most-wanted', 'Fresno Valley Crime Stoppers', 'html', 720, 1);
    s.run('ca_kern_warrants', 'CA', 'Kern', 'https://www.kerncounty.com/government/sheriff/most-wanted', 'Kern County SO', 'html', 720, 1);
    s.run('ca_san_bernardino_warrants', 'CA', 'San Bernardino', 'https://www.ieanonymoustips.org/', 'IE Crime Stoppers', 'html', 720, 1);
    // Colorado
    s.run('co_pueblo_warrants', 'CO', 'Pueblo', 'https://www.pueblocrimestoppers.com/', 'Pueblo Crime Stoppers', 'html', 720, 1);
    s.run('co_larimer_warrants', 'CO', 'Larimer', 'https://www.nococrimestoppers.com/', 'Northern CO Crime Stoppers', 'html', 720, 1);
    s.run('co_weld_warrants', 'CO', 'Weld', 'https://www.weldcountysheriff.com/most-wanted', 'Weld County SO', 'html', 720, 1);
    s.run('co_mesa_warrants', 'CO', 'Mesa', 'https://www.mesacounty.us/sheriff/most-wanted', 'Mesa County SO', 'html', 720, 1);
    s.run('co_arapahoe_warrants', 'CO', 'Arapahoe', 'https://www.arapahoegov.com/847/Most-Wanted', 'Arapahoe County', 'html', 720, 1);
    s.run('co_jefferson_warrants', 'CO', 'Jefferson', 'https://www.jeffco.us/3847/Most-Wanted', 'Jefferson County SO', 'html', 720, 1);
    s.run('co_boulder_warrants', 'CO', 'Boulder', 'https://www.northerncoloradocrimestoppers.com/', 'Boulder Area Crime Stoppers', 'html', 720, 1);
    s.run('co_springs_warrants', 'CO', 'El Paso', 'https://www.crimestoppersandpikespeakregion.com/', 'Pikes Peak Crime Stoppers', 'html', 720, 1);
    // Connecticut
    s.run('ct_state_police', 'CT', '', 'https://portal.ct.gov/DESPP/Division-of-State-Police/Most-Wanted', 'CT State Police', 'html', 720, 1);
    // Delaware
    s.run('de_state_police', 'DE', '', 'https://dsp.delaware.gov/crime-stoppers/', 'Delaware State Police', 'html', 720, 1);
    // Florida
    s.run('fl_broward_warrants', 'FL', 'Broward', 'https://www.browardsheriff.org/community/most-wanted', 'Broward County SO', 'html', 720, 1);
    s.run('fl_orange_warrants', 'FL', 'Orange', 'https://www.ocso.com/most-wanted/', 'Orange County SO', 'html', 720, 1);
    s.run('fl_duval_warrants', 'FL', 'Duval', 'https://www.fccrimestoppers.com/', 'First Coast Crime Stoppers', 'html', 720, 1);
    // Georgia
    s.run('ga_dekalb_warrants', 'GA', 'DeKalb', 'https://www.dekalbcountyga.gov/sheriff/most-wanted', 'DeKalb County SO', 'html', 720, 1);
    s.run('ga_gwinnett_warrants', 'GA', 'Gwinnett', 'https://www.atlantacrimestoppers.com/', 'Atlanta Crime Stoppers', 'html', 720, 1);
    // Hawaii
    s.run('hi_maui_warrants', 'HI', 'Maui', 'https://www.mpd.maui.gov/crime-stoppers/', 'Maui Crime Stoppers', 'html', 1440, 1);
    // Idaho
    s.run('id_canyon_warrants', 'ID', 'Canyon', 'https://www.canyoncounty.id.gov/sheriff/most-wanted', 'Canyon County SO', 'html', 720, 1);
    s.run('id_bonneville_warrants', 'ID', 'Bonneville', 'https://www.co.bonneville.id.us/sheriff/most-wanted', 'Bonneville County SO', 'html', 720, 1);
    s.run('id_kootenai_warrants', 'ID', 'Kootenai', 'https://www.kcgov.us/154/Most-Wanted', 'Kootenai County SO', 'html', 720, 1);
    s.run('id_twin_falls_warrants', 'ID', 'Twin Falls', 'https://www.twinfallscounty.org/sheriff/most-wanted', 'Twin Falls County SO', 'html', 720, 1);
    s.run('id_state_police', 'ID', '', 'https://isp.idaho.gov/wanted/', 'Idaho State Police', 'html', 720, 1);
    // Illinois
    s.run('il_dupage_warrants', 'IL', 'DuPage', 'https://www.crimestoppersil.com/', 'Illinois Crime Stoppers', 'html', 720, 1);
    // Indiana
    s.run('in_allen_warrants', 'IN', 'Allen', 'https://www.allencountyindianawarrants.org/', 'Allen County Warrants', 'html', 720, 1);
    // Iowa
    s.run('ia_linn_warrants', 'IA', 'Linn', 'https://www.linncountyiowa.gov/1112/Most-Wanted', 'Linn County SO', 'html', 720, 1);
    s.run('ia_state_crimestop', 'IA', '', 'https://iowacrimestoppers.org/', 'Iowa Crime Stoppers', 'html', 720, 1);
    // Kansas
    s.run('ks_johnson_warrants', 'KS', 'Johnson', 'https://www.jocosheriff.org/most-wanted', 'Johnson County SO', 'html', 720, 1);
    // Kentucky
    s.run('ky_fayette_warrants', 'KY', 'Fayette', 'https://www.bluegrasscrimestoppers.com/', 'Bluegrass Crime Stoppers', 'html', 720, 1);
    // Louisiana
    s.run('la_east_baton_rouge', 'LA', 'East Baton Rouge', 'https://www.crimestoppersbr.org/most-wanted', 'Baton Rouge Crime Stoppers', 'html', 720, 1);
    // Maine
    s.run('me_state_police', 'ME', '', 'https://www.maine.gov/dps/msp/wanted-missing', 'Maine State Police', 'html', 720, 1);
    // Maryland
    s.run('md_prince_georges', 'MD', 'Prince Georges', 'https://www.pgcrimesolvers.com/most-wanted', 'Prince Georges Crime Solvers', 'html', 720, 1);
    // Michigan
    s.run('mi_kent_warrants', 'MI', 'Kent', 'https://www.silentobserver.org/', 'Kent County Silent Observer', 'html', 720, 1);
    s.run('mi_oakland_warrants', 'MI', 'Oakland', 'https://www.oaklandsheriff.com/most-wanted', 'Oakland County SO', 'html', 720, 1);
    // Minnesota
    s.run('mn_ramsey_warrants', 'MN', 'Ramsey', 'https://www.crimestoppersmn.org/', 'Minnesota Crime Stoppers', 'html', 720, 1);
    // Mississippi
    s.run('ms_harrison_warrants', 'MS', 'Harrison', 'https://www.mscoastcrimestoppers.com/', 'MS Coast Crime Stoppers', 'html', 720, 1);
    // Missouri
    s.run('mo_st_louis_warrants', 'MO', 'St. Louis', 'https://www.stlrcs.org/most-wanted', 'St. Louis Crime Stoppers', 'html', 720, 1);
    // Montana
    s.run('mt_cascade_warrants', 'MT', 'Cascade', 'https://www.cascadecountymt.gov/departments/sheriff/most-wanted', 'Cascade County SO', 'html', 720, 1);
    s.run('mt_yellowstone_warrants', 'MT', 'Yellowstone', 'https://www.co.yellowstone.mt.gov/sheriff/most-wanted', 'Yellowstone County SO', 'html', 720, 1);
    // Nebraska
    s.run('ne_lancaster_warrants', 'NE', 'Lancaster', 'https://www.lincoln.ne.gov/City/Departments/Police-Department/Most-Wanted', 'Lincoln PD', 'html', 720, 1);
    // New Hampshire
    s.run('nh_state_police', 'NH', '', 'https://www.nh.gov/safety/divisions/nhsp/wanted/', 'NH State Police', 'html', 720, 1);
    // New Jersey
    s.run('nj_camden_warrants', 'NJ', 'Camden', 'https://www.camdencountypd.org/most-wanted', 'Camden County PD', 'html', 720, 1);
    s.run('nj_passaic_warrants', 'NJ', 'Passaic', 'https://www.passaicsheriff.com/wanted/', 'Passaic County SO', 'html', 720, 1);
    // New Mexico
    s.run('nm_state_police', 'NM', '', 'https://www.nmsp.dps.state.nm.us/', 'NM State Police', 'html', 720, 1);
    // New York
    s.run('ny_suffolk_warrants', 'NY', 'Suffolk', 'https://www.suffolkcountyny.gov/sheriff/most-wanted', 'Suffolk County SO', 'html', 720, 1);
    // North Carolina
    s.run('nc_wake_warrants', 'NC', 'Wake', 'https://www.raleighcrimestoppers.org/', 'Raleigh Crime Stoppers', 'html', 720, 1);
    s.run('nc_guilford_warrants', 'NC', 'Guilford', 'https://www.crimestoppersgso.org/', 'Greensboro Crime Stoppers', 'html', 720, 1);
    // North Dakota
    s.run('nd_burleigh_warrants', 'ND', 'Burleigh', 'https://www.bismarcknd.gov/1082/Most-Wanted', 'Bismarck PD', 'html', 720, 1);
    // Ohio
    s.run('oh_hamilton_warrants', 'OH', 'Hamilton', 'https://www.crimestoppers.com/cincinnati', 'Cincinnati Crime Stoppers', 'html', 720, 1);
    s.run('oh_franklin_warrants', 'OH', 'Franklin', 'https://www.centralohiocrimestoppers.org/', 'Central Ohio Crime Stoppers', 'html', 720, 1);
    // Oklahoma
    s.run('ok_tulsa_warrants', 'OK', 'Tulsa', 'https://www.tulsacrimestoppers.org/most-wanted', 'Tulsa Crime Stoppers', 'html', 720, 1);
    // Oregon
    s.run('or_clackamas_warrants', 'OR', 'Clackamas', 'https://www.clackamas.us/sheriff/mostwanted', 'Clackamas County SO', 'html', 720, 1);
    s.run('or_lane_warrants', 'OR', 'Lane', 'https://www.lanecountyor.gov/sheriff/most-wanted', 'Lane County SO', 'html', 720, 1);
    // Pennsylvania
    s.run('pa_allegheny_warrants', 'PA', 'Allegheny', 'https://www.pittsburghcrimestoppers.com/', 'Pittsburgh Crime Stoppers', 'html', 720, 1);
    // Rhode Island
    s.run('ri_state_police', 'RI', '', 'https://www.risp.ri.gov/most-wanted', 'RI State Police', 'html', 720, 1);
    // South Carolina
    s.run('sc_charleston_warrants', 'SC', 'Charleston', 'https://www.charlestoncrimestoppers.com/', 'Charleston Crime Stoppers', 'html', 720, 1);
    // South Dakota
    s.run('sd_pennington_warrants', 'SD', 'Pennington', 'https://www.rapidcity.com/police-department/most-wanted', 'Rapid City PD', 'html', 720, 1);
    // Tennessee
    s.run('tn_shelby_warrants', 'TN', 'Shelby', 'https://www.crimestopmem.org/mostwanted', 'Memphis Crime Stoppers', 'html', 720, 1);
    s.run('tn_knox_warrants', 'TN', 'Knox', 'https://www.knoxcrimestoppers.com/', 'Knoxville Crime Stoppers', 'html', 720, 1);
    // Texas
    s.run('tx_bexar_warrants', 'TX', 'Bexar', 'https://www.sacrimestoppers.com/most-wanted', 'San Antonio Crime Stoppers', 'html', 720, 1);
    s.run('tx_tarrant_warrants', 'TX', 'Tarrant', 'https://www.tarrantcrimestoppers.org/', 'Tarrant County Crime Stoppers', 'html', 720, 1);
    s.run('tx_el_paso_warrants', 'TX', 'El Paso', 'https://www.crimestoppersofelpaso.org/most-wanted', 'El Paso Crime Stoppers', 'html', 720, 1);
    s.run('tx_travis_warrants', 'TX', 'Travis', 'https://www.austincrimestoppers.org/', 'Austin Crime Stoppers', 'html', 720, 1);
    // US Federal (additional)
    s.run('federal_dea_fugitives', 'US', '', 'https://www.dea.gov/fugitives', 'DEA Fugitives', 'html', 1440, 1);
    s.run('federal_atf_wanted', 'US', '', 'https://www.atf.gov/most-wanted', 'ATF Most Wanted', 'html', 1440, 1);
    s.run('federal_ice_wanted', 'US', '', 'https://www.ice.gov/most-wanted', 'ICE Most Wanted', 'html', 1440, 1);
    s.run('federal_secret_service', 'US', '', 'https://www.secretservice.gov/investigation/most-wanted', 'Secret Service Most Wanted', 'html', 1440, 1);
    s.run('federal_usms_top15', 'US', '', 'https://www.usmarshals.gov/what-we-do/fugitive-investigations/most-wanted-fugitives', 'US Marshals 15 Most Wanted', 'html', 1440, 1);
    s.run('federal_postal_inspectors', 'US', '', 'https://www.uspis.gov/investigations/wanted-fugitives', 'US Postal Inspectors', 'html', 1440, 1);
    // Virginia
    s.run('va_henrico_warrants', 'VA', 'Henrico', 'https://henrico.us/police/most-wanted/', 'Henrico County PD', 'html', 720, 1);
    // Vermont
    s.run('vt_state_police', 'VT', '', 'https://vsp.vermont.gov/wanted', 'Vermont State Police', 'html', 1440, 1);
    // Washington
    s.run('wa_pierce_warrants', 'WA', 'Pierce', 'https://www.piercecountywa.gov/2090/Most-Wanted', 'Pierce County SO', 'html', 720, 1);
    s.run('wa_spokane_warrants', 'WA', 'Spokane', 'https://www.crimestoppersinlandnw.org/', 'Inland NW Crime Stoppers', 'html', 720, 1);
    s.run('wa_snohomish_warrants', 'WA', 'Snohomish', 'https://snohomishcountywa.gov/282/Most-Wanted', 'Snohomish County SO', 'html', 720, 1);
    // West Virginia
    s.run('wv_kanawha_crimestop', 'WV', 'Kanawha', 'https://www.p3tips.com/TipForm.aspx?ID=104', 'Charleston WV Crime Stoppers', 'html', 720, 1);
    // Wisconsin
    s.run('wi_dane_warrants', 'WI', 'Dane', 'https://www.madisoncrimestoppers.com/', 'Madison Crime Stoppers', 'html', 720, 1);
    // Wyoming
    s.run('wy_natrona_warrants', 'WY', 'Natrona', 'https://www.natronacounty-wy.gov/603/Most-Wanted', 'Natrona County SO', 'html', 720, 1);
    s.run('wy_sweetwater_warrants', 'WY', 'Sweetwater', 'https://www.sweet.wy.us/sheriff/most-wanted', 'Sweetwater County SO', 'html', 720, 1);
    s.run('wy_albany_warrants', 'WY', 'Albany', 'https://www.co.albany.wy.us/sheriff/most-wanted', 'Albany County SO', 'html', 720, 1);
    s.run('wy_fremont_warrants', 'WY', 'Fremont', 'https://www.fremontcountywy.org/sheriff/most-wanted', 'Fremont County SO', 'html', 720, 1);
  }

  // Enable ALL warrant scraper sources — circuit breaker auto-disables sources that fail 5 times
  db.prepare("UPDATE warrant_scraper_config SET enabled = 1 WHERE enabled = 0 AND source_type != 'search_form'").run();
  // ── Radio transcripts — audio recording columns ──
  addCol("radio_transcripts", "audio_file", "TEXT");
  addCol("radio_transcripts", "file_size", "INTEGER");
  addCol("radio_transcripts", "linked_call_id", "INTEGER");

  // ── ClearPathGPS dashcam events + officer mappings ──
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_cpgps_dashcam_events_vehicle ON cpgps_dashcam_events(cpgps_vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_cpgps_dashcam_events_officer ON cpgps_dashcam_events(officer_id);
    CREATE INDEX IF NOT EXISTS idx_cpgps_dashcam_events_time ON cpgps_dashcam_events(event_at);

    CREATE TABLE IF NOT EXISTS cpgps_officer_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      cpgps_vehicle_id TEXT NOT NULL,
      call_sign TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(officer_id, cpgps_vehicle_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cpgps_mappings_officer ON cpgps_officer_mappings(officer_id);

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
    CREATE INDEX IF NOT EXISTS idx_forensic_hash_results_case ON forensic_hash_results(case_id);

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
  `);

  // ── FIELD INTERVIEWS — columns referenced by INSERT but missing from CREATE TABLE ──
  // Route handler (server/src/routes/fieldInterviews.ts) inserts these; production DB
  // has them via ad-hoc ALTER, but fresh DBs would crash with
  // "table field_interviews has no column named X" on first FI creation.
  addCol('field_interviews', 'date', 'TEXT');
  addCol('field_interviews', 'gang_affiliation', 'TEXT');
  addCol('field_interviews', 'section_id', 'INTEGER');
  addCol('field_interviews', 'zone_id', 'INTEGER');
  addCol('field_interviews', 'beat_id', 'INTEGER');
  addCol('field_interviews', 'zone_beat', 'TEXT');
  addCol('field_interviews', 'updated_at', 'TEXT');

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

/** Ensure critical columns exist — prevents "no such column" runtime crashes */
function ensureRequiredColumns(): void {
  const required: Record<string, string[]> = {
    calls_for_service: ['priority_score', 'response_time_seconds', 'status_changed_at'],
  };
  for (const [table, columns] of Object.entries(required)) {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(r => r.name)
    );
    for (const col of columns) {
      if (!existing.has(col)) {
        const colType = col.includes('score') ? 'INTEGER DEFAULT 0'
          : col.includes('seconds') ? 'REAL DEFAULT NULL'
          : 'TEXT';
        try {
          db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${colType}`).run();
          console.log(`[Schema] Added missing column ${table}.${col} (${colType})`);
        } catch (e: any) {
          if (!e?.message?.includes('duplicate column')) {
            console.error(`[Schema] Failed to add ${table}.${col}:`, e?.message);
          }
        }
      }
    }
  }
}

function createIndexes(): void {
  try {
  // Execute each index individually to avoid crashing if a table doesn't exist
  const indexes = `
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

    -- ═══ IPED Digital Forensics Integration ═══

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

    CREATE INDEX IF NOT EXISTS idx_iped_imports_case ON iped_imports(forensic_case_id);
    CREATE INDEX IF NOT EXISTS idx_iped_imports_iped ON iped_imports(iped_case_id);
    CREATE INDEX IF NOT EXISTS idx_iped_imports_type ON iped_imports(import_type);
  `;

  // Run each CREATE INDEX individually so a missing table doesn't block the rest
  for (const line of indexes.split('\n')) {
    const sql = line.trim();
    if (sql.startsWith('CREATE INDEX')) {
      try { db.prepare(sql).run(); } catch { /* table may not exist yet — skip */ }
    }
  }

  // ── Forensic Hash Sets ───────────────────────────────
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_hash_entries_value ON forensic_hash_entries(hash_value);
    CREATE INDEX IF NOT EXISTS idx_hash_entries_set ON forensic_hash_entries(hash_set_id);

    CREATE TABLE IF NOT EXISTS integration_health_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('healthy','degraded','error')),
      response_time_ms INTEGER,
      error_message TEXT,
      checked_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_health_log_integration ON integration_health_log(integration_id, checked_at);

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

    CREATE INDEX IF NOT EXISTS idx_time_entry_edits_entry ON time_entry_edits(time_entry_id);

    -- Citations indexes (missing foreign key and date indexes)
    CREATE INDEX IF NOT EXISTS idx_citations_number ON citations(citation_number);
    CREATE INDEX IF NOT EXISTS idx_citations_status ON citations(status);
    CREATE INDEX IF NOT EXISTS idx_citations_type ON citations(type);
    CREATE INDEX IF NOT EXISTS idx_citations_person ON citations(person_id);
    CREATE INDEX IF NOT EXISTS idx_citations_officer ON citations(issuing_officer_id);
    CREATE INDEX IF NOT EXISTS idx_citations_date ON citations(violation_date);
    CREATE INDEX IF NOT EXISTS idx_citations_incident ON citations(incident_id);
    CREATE INDEX IF NOT EXISTS idx_citations_call ON citations(call_id);
    CREATE INDEX IF NOT EXISTS idx_citations_created ON citations(created_at);

    -- Citation payments table (was previously lazy-created in citations route)
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

    -- Citation payments indexes
    CREATE INDEX IF NOT EXISTS idx_citation_payments_citation ON citation_payments(citation_id);
    CREATE INDEX IF NOT EXISTS idx_citation_payments_date ON citation_payments(payment_date);

    -- Field interviews indexes
    CREATE INDEX IF NOT EXISTS idx_field_interviews_number ON field_interviews(fi_number);
    CREATE INDEX IF NOT EXISTS idx_field_interviews_officer ON field_interviews(officer_id);
    CREATE INDEX IF NOT EXISTS idx_field_interviews_person ON field_interviews(person_id);
    CREATE INDEX IF NOT EXISTS idx_field_interviews_status ON field_interviews(status);
    CREATE INDEX IF NOT EXISTS idx_field_interviews_created ON field_interviews(created_at);
    CREATE INDEX IF NOT EXISTS idx_field_interviews_archived ON field_interviews(archived_at);
    CREATE INDEX IF NOT EXISTS idx_field_interviews_location ON field_interviews(latitude, longitude);

    -- Trespass orders indexes
    CREATE INDEX IF NOT EXISTS idx_trespass_orders_number ON trespass_orders(order_number);
    CREATE INDEX IF NOT EXISTS idx_trespass_orders_status ON trespass_orders(status);
    CREATE INDEX IF NOT EXISTS idx_trespass_orders_person ON trespass_orders(person_id);
    CREATE INDEX IF NOT EXISTS idx_trespass_orders_property ON trespass_orders(property_id);
    CREATE INDEX IF NOT EXISTS idx_trespass_orders_expiration ON trespass_orders(expiration_date);
    CREATE INDEX IF NOT EXISTS idx_trespass_orders_created ON trespass_orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_trespass_orders_archived ON trespass_orders(archived_at);

    -- Forensic cases indexes
    CREATE INDEX IF NOT EXISTS idx_forensic_cases_number ON forensic_cases(lab_number);
    CREATE INDEX IF NOT EXISTS idx_forensic_cases_status ON forensic_cases(status);
    CREATE INDEX IF NOT EXISTS idx_forensic_cases_type ON forensic_cases(case_type);
    CREATE INDEX IF NOT EXISTS idx_forensic_cases_priority ON forensic_cases(priority);
    CREATE INDEX IF NOT EXISTS idx_forensic_cases_examiner ON forensic_cases(lead_examiner_id);
    CREATE INDEX IF NOT EXISTS idx_forensic_cases_incident ON forensic_cases(linked_incident_id);
    CREATE INDEX IF NOT EXISTS idx_forensic_cases_case ON forensic_cases(linked_case_id);

    -- Forensic exhibits and analyses indexes
    CREATE INDEX IF NOT EXISTS idx_forensic_exhibits_case ON forensic_exhibits(forensic_case_id);
    CREATE INDEX IF NOT EXISTS idx_forensic_analyses_case ON forensic_analyses(forensic_case_id);
    CREATE INDEX IF NOT EXISTS idx_forensic_analyses_status ON forensic_analyses(status);
    CREATE INDEX IF NOT EXISTS idx_forensic_activity_case ON forensic_activity_log(forensic_case_id);

    -- Geofences indexes
    CREATE INDEX IF NOT EXISTS idx_geofences_active ON geofences(is_active);
    CREATE INDEX IF NOT EXISTS idx_geofences_zone_type ON geofences(zone_type);

    -- Arrest records indexes
    CREATE INDEX IF NOT EXISTS idx_arrest_records_name ON arrest_records(last_name, first_name);
    CREATE INDEX IF NOT EXISTS idx_arrest_records_booking ON arrest_records(booking_date);
    CREATE INDEX IF NOT EXISTS idx_arrest_records_status ON arrest_records(status);
    CREATE INDEX IF NOT EXISTS idx_arrest_cross_links_record ON arrest_cross_links(arrest_record_id);
    CREATE INDEX IF NOT EXISTS idx_arrest_cross_links_linked ON arrest_cross_links(linked_type, linked_id);

    -- Serve queue indexes
    CREATE INDEX IF NOT EXISTS idx_serve_queue_status ON serve_queue(status);
    CREATE INDEX IF NOT EXISTS idx_serve_queue_officer ON serve_queue(officer_id);
    CREATE INDEX IF NOT EXISTS idx_serve_queue_deadline ON serve_queue(deadline);
    CREATE INDEX IF NOT EXISTS idx_serve_attempts_queue ON serve_attempts(serve_queue_id);
    CREATE INDEX IF NOT EXISTS idx_serve_routes_officer ON serve_routes(officer_id);
    CREATE INDEX IF NOT EXISTS idx_serve_routes_date ON serve_routes(route_date);
    CREATE INDEX IF NOT EXISTS idx_serve_skip_traces_queue ON serve_skip_traces(serve_queue_id);

    -- Calls for service incident type index (high-frequency filter)
    CREATE INDEX IF NOT EXISTS idx_cfs_incident_type ON calls_for_service(incident_type);

    -- Shift plans indexes
    CREATE INDEX IF NOT EXISTS idx_shift_plans_date ON shift_plans(date);
    CREATE INDEX IF NOT EXISTS idx_shift_plans_status ON shift_plans(status);

    -- Dashcam videos indexes
    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_unit ON dashcam_videos(unit_id);
    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_officer ON dashcam_videos(officer_id);
    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_date ON dashcam_videos(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_incident ON dashcam_videos(incident_id);

    -- Activity log action index for filtering
    CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);

    -- Patrol scans date index
    CREATE INDEX IF NOT EXISTS idx_patrol_scans_date ON patrol_scans(scanned_at);

    -- Properties location index
    CREATE INDEX IF NOT EXISTS idx_properties_location ON properties(latitude, longitude);

    -- Cases priority and archived indexes
    CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
    CREATE INDEX IF NOT EXISTS idx_cases_archived ON cases(archived_at);

    -- Training records indexes
    CREATE INDEX IF NOT EXISTS idx_training_records_officer ON training_records(officer_id);
    CREATE INDEX IF NOT EXISTS idx_training_records_type ON training_records(training_type);
    CREATE INDEX IF NOT EXISTS idx_training_records_status ON training_records(status);
    CREATE INDEX IF NOT EXISTS idx_training_records_date ON training_records(completed_date);
    CREATE INDEX IF NOT EXISTS idx_training_records_expiry ON training_records(expiration_date);

    -- Training requirements indexes
    CREATE INDEX IF NOT EXISTS idx_training_requirements_role ON training_requirements(required_for_role);
    CREATE INDEX IF NOT EXISTS idx_training_requirements_active ON training_requirements(is_active);

    -- Deployments indexes
    CREATE INDEX IF NOT EXISTS idx_deployments_officer ON deployments(officer_id);
    CREATE INDEX IF NOT EXISTS idx_deployments_property ON deployments(property_id);
    CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
    CREATE INDEX IF NOT EXISTS idx_deployments_date ON deployments(start_date);

    -- HR documents indexes
    CREATE INDEX IF NOT EXISTS idx_hr_documents_officer ON hr_documents(officer_id);
    CREATE INDEX IF NOT EXISTS idx_hr_documents_type ON hr_documents(document_type);
    CREATE INDEX IF NOT EXISTS idx_hr_documents_created ON hr_documents(created_at);

    -- HR grievances indexes
    CREATE INDEX IF NOT EXISTS idx_hr_grievances_officer ON hr_grievances(officer_id);
    CREATE INDEX IF NOT EXISTS idx_hr_grievances_status ON hr_grievances(status);
    CREATE INDEX IF NOT EXISTS idx_hr_grievances_created ON hr_grievances(created_at);

    -- HR workers comp indexes
    CREATE INDEX IF NOT EXISTS idx_hr_workers_comp_officer ON hr_workers_comp(officer_id);
    CREATE INDEX IF NOT EXISTS idx_hr_workers_comp_status ON hr_workers_comp(status);
    CREATE INDEX IF NOT EXISTS idx_hr_workers_comp_date ON hr_workers_comp(injury_date);

    -- HR salary history indexes
    CREATE INDEX IF NOT EXISTS idx_hr_salary_officer ON hr_salary_history(officer_id);
    CREATE INDEX IF NOT EXISTS idx_hr_salary_effective ON hr_salary_history(effective_date);

    -- HR attendance indexes
    CREATE INDEX IF NOT EXISTS idx_hr_attendance_officer ON hr_attendance(officer_id);
    CREATE INDEX IF NOT EXISTS idx_hr_attendance_date ON hr_attendance(attendance_date);
    CREATE INDEX IF NOT EXISTS idx_hr_attendance_type ON hr_attendance(type);

    -- HR PIPs indexes
    CREATE INDEX IF NOT EXISTS idx_hr_pips_officer ON hr_pips(officer_id);
    CREATE INDEX IF NOT EXISTS idx_hr_pips_status ON hr_pips(status);

    -- HR benefits indexes
    CREATE INDEX IF NOT EXISTS idx_hr_benefits_officer ON hr_benefits(officer_id);
    CREATE INDEX IF NOT EXISTS idx_hr_benefits_type ON hr_benefits(benefit_type);

    -- Fleet tires indexes
    CREATE INDEX IF NOT EXISTS idx_fleet_tires_vehicle ON fleet_tires(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_tires_status ON fleet_tires(status);

    -- Fleet damage reports indexes
    CREATE INDEX IF NOT EXISTS idx_fleet_damage_vehicle ON fleet_damage_reports(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_damage_status ON fleet_damage_reports(status);
    CREATE INDEX IF NOT EXISTS idx_fleet_damage_date ON fleet_damage_reports(reported_at);

    -- Fleet recalls indexes
    CREATE INDEX IF NOT EXISTS idx_fleet_recalls_vehicle ON fleet_recalls(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_recalls_status ON fleet_recalls(status);

    -- Fleet fuel cards indexes
    CREATE INDEX IF NOT EXISTS idx_fleet_fuel_cards_vehicle ON fleet_fuel_cards(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_fleet_fuel_cards_status ON fleet_fuel_cards(status);

    -- Company documents indexes
    CREATE INDEX IF NOT EXISTS idx_company_docs_category ON company_documents(category);
    CREATE INDEX IF NOT EXISTS idx_company_docs_created ON company_documents(created_at);

    -- Email logs indexes
    CREATE INDEX IF NOT EXISTS idx_email_logs_created ON email_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
    CREATE INDEX IF NOT EXISTS idx_email_logs_to ON email_logs(to_email);

    -- Patrol breaks indexes
    CREATE INDEX IF NOT EXISTS idx_patrol_breaks_officer ON patrol_breaks(officer_id);
    CREATE INDEX IF NOT EXISTS idx_patrol_breaks_date ON patrol_breaks(start_time);

    -- Fleet pretrip checklists indexes
    CREATE INDEX IF NOT EXISTS idx_pretrip_vehicle ON fleet_pretrip_checklists(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_pretrip_officer ON fleet_pretrip_checklists(officer_id);
    CREATE INDEX IF NOT EXISTS idx_pretrip_date ON fleet_pretrip_checklists(created_at);

    -- Evidence temperature logs indexes
    CREATE INDEX IF NOT EXISTS idx_evidence_temp_evidence ON evidence_temperature_logs(evidence_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_temp_recorded ON evidence_temperature_logs(recorded_at);

    -- Person associates indexes
    CREATE INDEX IF NOT EXISTS idx_person_assoc_person ON person_associates(person_id);
    CREATE INDEX IF NOT EXISTS idx_person_assoc_associated ON person_associates(associated_person_id);

    -- ClearPath GPS indexes
    CREATE INDEX IF NOT EXISTS idx_cpgps_vehicles_unit ON cpgps_vehicles(unit_number);
    CREATE INDEX IF NOT EXISTS idx_cpgps_trips_vehicle ON cpgps_trips(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_cpgps_trips_date ON cpgps_trips(start_time);
    CREATE INDEX IF NOT EXISTS idx_cpgps_locations_vehicle ON cpgps_locations(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_cpgps_locations_time ON cpgps_locations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_cpgps_alerts_vehicle ON cpgps_alerts(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_cpgps_alerts_type ON cpgps_alerts(alert_type);

    -- Warrant watch indexes
    CREATE INDEX IF NOT EXISTS idx_warrant_watch_runs_created ON warrant_watch_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_warrant_watch_log_run ON warrant_watch_log(run_id);
    CREATE INDEX IF NOT EXISTS idx_scraped_warrants_name ON scraped_warrants(last_name, first_name);
    CREATE INDEX IF NOT EXISTS idx_scraped_warrants_status ON scraped_warrants(status);

    -- Skiptracer dossiers indexes
    CREATE INDEX IF NOT EXISTS idx_skiptracer_created ON skiptracer_dossiers(created_at);
    CREATE INDEX IF NOT EXISTS idx_skiptracer_status ON skiptracer_dossiers(status);

    -- Call persons indexes
    CREATE INDEX IF NOT EXISTS idx_call_persons_call ON call_persons(call_id);
    CREATE INDEX IF NOT EXISTS idx_call_persons_person ON call_persons(person_id);

    -- Breadcrumbs call_sign index for real-time GPS lookups
    CREATE INDEX IF NOT EXISTS idx_breadcrumbs_callsign ON gps_breadcrumbs(call_sign);

    -- System announcements indexes
    CREATE INDEX IF NOT EXISTS idx_announcements_active ON system_announcements(is_active);
    CREATE INDEX IF NOT EXISTS idx_announcements_expires ON system_announcements(expires_at);

    -- Record locks indexes
    CREATE INDEX IF NOT EXISTS idx_record_locks_entity ON record_locks(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_record_locks_user ON record_locks(user_id);

    -- Time entries date range index for shift queries
    CREATE INDEX IF NOT EXISTS idx_time_entries_clockin ON time_entries(clock_in);
    CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(DATE(clock_in));

    -- Schedules composite index for shift lookups
    CREATE INDEX IF NOT EXISTS idx_schedules_officer_date ON schedules(officer_id, shift_date);

    -- Utah statutes lookup indexes
    CREATE INDEX IF NOT EXISTS idx_utah_statutes_code ON utah_statutes(statute_code);
    CREATE INDEX IF NOT EXISTS idx_utah_statutes_category ON utah_statutes(category);

    -- Entity statutes indexes
    CREATE INDEX IF NOT EXISTS idx_entity_statutes_entity ON entity_statutes(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_statutes_statute ON entity_statutes(statute_id);

    -- [FIX 69] Composite index for status+priority dispatch queries (common filter pattern)
    CREATE INDEX IF NOT EXISTS idx_cfs_status_priority ON calls_for_service(status, priority);

    -- [FIX 70] Composite index for sessions user+active lookup
    CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, is_active);

    -- [FIX 71] Index on trusted_devices for user+fingerprint lookups
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_fp ON trusted_devices(user_id, device_fingerprint);

    -- [FIX 72] Index on password_history for user+created_at ordering
    CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id, created_at);

    -- [FIX 73] Index for call_units junction table common queries
    CREATE INDEX IF NOT EXISTS idx_call_units_call ON call_units(call_id, unassigned_at);
    CREATE INDEX IF NOT EXISTS idx_call_units_unit ON call_units(unit_id, unassigned_at);

    -- [FIX 74] Index on radio_transcripts for channel+time queries
    CREATE INDEX IF NOT EXISTS idx_radio_transcripts_channel ON radio_transcripts(channel, transmitted_at);

    -- [FIX 75] Index for security_notifications user lookup
    CREATE INDEX IF NOT EXISTS idx_security_notifications_user ON security_notifications(user_id);

    -- Panic alerts indexes
    CREATE INDEX IF NOT EXISTS idx_panic_alerts_user ON panic_alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_panic_alerts_status ON panic_alerts(status);
    CREATE INDEX IF NOT EXISTS idx_panic_alerts_created ON panic_alerts(created_at);
    CREATE INDEX IF NOT EXISTS idx_panic_alerts_call ON panic_alerts(call_id);
    CREATE INDEX IF NOT EXISTS idx_panic_alerts_escalation ON panic_alerts(escalation_level);
  `);
  } catch (err: any) {
    console.warn('[DB] createIndexes partially failed (non-fatal):', err?.message || 'Unknown error');
  }
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

  // ─── PANIC / RADIO CONFIG DEFAULTS ─────────────────
  const panicConfigs = [
    { key: 'panic_audio_duration_seconds', value: '60', category: 'panic' },
    { key: 'panic_escalation_1_seconds', value: '30', category: 'panic' },
    { key: 'panic_escalation_2_seconds', value: '60', category: 'panic' },
    { key: 'panic_escalation_3_seconds', value: '90', category: 'panic' },
    { key: 'emergency_talkgroup_timeout_minutes', value: '30', category: 'radio' },
    { key: 'radio_encryption_default', value: 'secure', category: 'radio' },
  ];
  const insertPanicConfig = db.prepare('INSERT OR IGNORE INTO system_config (config_key, config_value, category) VALUES (?, ?, ?)');
  for (const c of panicConfigs) {
    insertPanicConfig.run(c.key, c.value, c.category);
  }

  console.log('Seed data initialized (admin user + system config).');

  // ─── AI MODEL PRESETS (seed defaults if empty) ────
  const existingPresets = db.prepare('SELECT COUNT(*) as count FROM ai_model_presets').get() as { count: number };
  if (existingPresets.count === 0) {
    const insertPreset = db.prepare('INSERT OR IGNORE INTO ai_model_presets (name, temperature, max_tokens, top_p, repeat_penalty, is_default) VALUES (?, ?, ?, ?, ?, ?)');
    insertPreset.run('Precise', 0.1, 300, 0.8, 1.2, 0);
    insertPreset.run('Balanced', 0.3, 500, 0.9, 1.1, 1);
    insertPreset.run('Creative', 0.7, 1024, 0.95, 1.0, 0);
    insertPreset.run('Verbose', 0.5, 2048, 0.9, 1.0, 0);
  }
}

export default { initDatabase, getDb };
