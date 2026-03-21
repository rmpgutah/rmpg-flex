import Database from 'better-sqlite3';
import bcryptjs from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrateIncidentNumbers, generateCaseNumber } from '../utils/caseNumbers';
import crypto from 'crypto';
import { localNow } from '../utils/timeUtils';
import { seedAllStatutes } from '../seeds/seedAllStatutes';
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

  // Security pragmas — prevent recovery of deleted PII and schema manipulation
  db.pragma('secure_delete = ON');        // Overwrite deleted data with zeros (CJIS compliance)
  db.pragma('trusted_schema = OFF');      // Reject untrusted schema extensions (SQL injection defense)
  db.pragma('cell_size_check = ON');      // Detect corrupt/oversized cells before they cause issues

  // Performance pragmas — session-level, reset on reconnection
  db.pragma('busy_timeout = 5000');       // Wait 5s on lock instead of instant SQLITE_BUSY
  db.pragma('mmap_size = 268435456');     // 256MB memory-mapped I/O for faster reads
  db.pragma('cache_size = -64000');       // 64MB page cache (negative = kilobytes)

  // Set default timeout for all database operations — prevents slow query DoS
  // better-sqlite3 runs synchronously, but this limits CPU time per statement
  db.defaultSafeIntegers(false);         // Return JS numbers, not BigInt (security: prevents unexpected type coercion)

  // Run integrity check on startup — detect corruption early
  try {
    const integrityResult = db.pragma('integrity_check') as { integrity_check: string }[];
    if (integrityResult.length > 0 && integrityResult[0].integrity_check !== 'ok') {
      console.error('╔═══════════════════════════════════════════════════════════╗');
      console.error('║  WARNING: Database integrity check FAILED!               ║');
      console.error('║  The database may be corrupted. Back up immediately.     ║');
      console.error('╚═══════════════════════════════════════════════════════════╝');
      console.error('Integrity results:', integrityResult.slice(0, 10));
    }
  } catch (e) {
    console.warn('[DB] Integrity check failed to run:', (e as Error).message);
  }

  createTables();
  migrateSchema();
  createIndexes();
  seedData();
  seedAllStatutes(db);

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
      role TEXT NOT NULL CHECK(role IN ('admin','manager','dispatcher','supervisor','officer','client_viewer','contract_manager','human_resources')),
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

    CREATE TABLE IF NOT EXISTS call_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL,
      unit_id INTEGER NOT NULL,
      assigned_at TEXT DEFAULT (datetime('now','localtime')),
      unassigned_at TEXT,
      FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
      FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
      UNIQUE(call_id, unit_id)
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

    -- Call-level person/vehicle linkage (structured records on dispatch calls)
    CREATE TABLE IF NOT EXISTS call_persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'involved' CHECK(role IN ('suspect','victim','witness','reporting_party','involved','other')),
      notes TEXT,
      added_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id),
      UNIQUE(call_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS call_vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL,
      vehicle_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'involved' CHECK(role IN ('suspect_vehicle','victim_vehicle','witness_vehicle','involved','evidence','other')),
      notes TEXT,
      added_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (call_id) REFERENCES calls_for_service(id) ON DELETE CASCADE,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles_records(id) ON DELETE CASCADE,
      FOREIGN KEY (added_by) REFERENCES users(id),
      UNIQUE(call_id, vehicle_id)
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

    -- ── HR Console ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'vacation' CHECK(type IN ('vacation','sick','personal','bereavement','training','unpaid')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours_requested REAL NOT NULL DEFAULT 0,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','cancelled')),
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      vacation_total REAL NOT NULL DEFAULT 80,
      vacation_used REAL NOT NULL DEFAULT 0,
      sick_total REAL NOT NULL DEFAULT 40,
      sick_used REAL NOT NULL DEFAULT 0,
      personal_total REAL NOT NULL DEFAULT 24,
      personal_used REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      UNIQUE(officer_id, year)
    );

    CREATE TABLE IF NOT EXISTS disciplinary_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'verbal_warning' CHECK(type IN ('verbal_warning','written_warning','suspension','termination','commendation','counseling')),
      severity TEXT NOT NULL DEFAULT 'minor' CHECK(severity IN ('minor','moderate','major','critical')),
      incident_date TEXT NOT NULL,
      description TEXT NOT NULL,
      action_taken TEXT,
      follow_up_date TEXT,
      follow_up_notes TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','appealed')),
      issued_by INTEGER NOT NULL,
      witness TEXT,
      attachments TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (issued_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS performance_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      reviewer_id INTEGER NOT NULL,
      review_period_start TEXT NOT NULL,
      review_period_end TEXT NOT NULL,
      review_date TEXT,
      type TEXT NOT NULL DEFAULT 'annual' CHECK(type IN ('annual','probationary','quarterly','improvement_plan')),
      overall_rating INTEGER CHECK(overall_rating BETWEEN 1 AND 5),
      categories TEXT DEFAULT '{}',
      strengths TEXT,
      areas_for_improvement TEXT,
      goals TEXT,
      officer_comments TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','acknowledged','completed')),
      acknowledged_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id)
    );

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
        'session_revoked','password_expiring','failed_login_threshold',
        'webauthn_registered','webauthn_removed'
      )),
      title TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      device_info TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- ── WebAuthn / Security Key Credentials ─────────────
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT NOT NULL DEFAULT 'singleDevice',
      backed_up INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      name TEXT NOT NULL DEFAULT 'Security Key',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

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

    -- Dash camera video footage (MVR / in-car video)
    CREATE TABLE IF NOT EXISTS dashcam_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER,
      unit_id INTEGER,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER,
      mime_type TEXT DEFAULT 'video/mp4',
      recorded_at TEXT,
      case_number TEXT,
      classification TEXT DEFAULT 'routine',
      speed_mph REAL,
      latitude REAL,
      longitude REAL,
      address TEXT,
      notes TEXT,
      source TEXT DEFAULT 'upload',
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    );

    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_vehicle ON dashcam_videos(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_unit ON dashcam_videos(unit_id);
    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_case ON dashcam_videos(case_number);
    CREATE INDEX IF NOT EXISTS idx_dashcam_videos_recorded ON dashcam_videos(recorded_at);

    -- Dash cam video links (attach videos to cases, calls, incidents)
    CREATE TABLE IF NOT EXISTS dashcam_video_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('call', 'incident', 'case', 'warrant', 'citation')),
      entity_id INTEGER NOT NULL,
      linked_by TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (video_id) REFERENCES dashcam_videos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dashcam_links_video ON dashcam_video_links(video_id);
    CREATE INDEX IF NOT EXISTS idx_dashcam_links_entity ON dashcam_video_links(entity_type, entity_id);

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

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ip_address TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at);
  `);

  // ════════════════════════════════════════════════════════════
  // HR MODULE TABLES
  // ════════════════════════════════════════════════════════════

  db.exec(`
    -- ── Leave Management ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS hr_leave_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      accrual_rate REAL DEFAULT 0,
      max_balance REAL DEFAULT 0,
      requires_approval INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS hr_leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      leave_type_id INTEGER NOT NULL,
      balance_hours REAL NOT NULL DEFAULT 0,
      used_hours REAL NOT NULL DEFAULT 0,
      year INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (leave_type_id) REFERENCES hr_leave_types(id),
      UNIQUE(user_id, leave_type_id, year)
    );

    CREATE TABLE IF NOT EXISTS hr_leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      leave_type_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours_requested REAL NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','denied','cancelled')),
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (leave_type_id) REFERENCES hr_leave_types(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    -- ── Performance Management ────────────────────────────
    CREATE TABLE IF NOT EXISTS hr_review_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS hr_performance_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reviewer_id INTEGER NOT NULL,
      cycle_id INTEGER,
      review_date TEXT NOT NULL,
      overall_rating INTEGER CHECK(overall_rating BETWEEN 1 AND 5),
      strengths TEXT,
      areas_for_improvement TEXT,
      goals TEXT,
      comments TEXT,
      employee_comments TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','acknowledged')),
      acknowledged_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id),
      FOREIGN KEY (cycle_id) REFERENCES hr_review_cycles(id)
    );

    CREATE TABLE IF NOT EXISTS hr_performance_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      review_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','deferred','cancelled')),
      progress INTEGER DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (review_id) REFERENCES hr_performance_reviews(id)
    );

    -- ── Disciplinary & Grievances ─────────────────────────
    CREATE TABLE IF NOT EXISTS hr_disciplinary_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      issued_by INTEGER NOT NULL,
      action_type TEXT NOT NULL CHECK(action_type IN ('verbal_warning','written_warning','suspension','demotion','termination','probation','other')),
      severity TEXT DEFAULT 'moderate' CHECK(severity IN ('minor','moderate','major','critical')),
      incident_date TEXT NOT NULL,
      description TEXT NOT NULL,
      corrective_action TEXT,
      follow_up_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','resolved','appealed','overturned')),
      resolution_notes TEXT,
      resolved_at TEXT,
      resolved_by INTEGER,
      related_incident_id INTEGER,
      attachments TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (issued_by) REFERENCES users(id),
      FOREIGN KEY (resolved_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS hr_grievances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grievance_number TEXT UNIQUE,
      filed_by INTEGER NOT NULL,
      against_user_id INTEGER,
      grievance_type TEXT NOT NULL CHECK(grievance_type IN ('workplace','policy','harassment','discrimination','safety','retaliation','other')),
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','under_review','investigation','resolved','dismissed','escalated')),
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
      assigned_to INTEGER,
      resolution TEXT,
      resolved_at TEXT,
      attachments TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (filed_by) REFERENCES users(id),
      FOREIGN KEY (against_user_id) REFERENCES users(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    );

    -- ── Onboarding & Documents ────────────────────────────
    CREATE TABLE IF NOT EXISTS hr_onboarding_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      role_target TEXT,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS hr_onboarding_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'general',
      sort_order INTEGER DEFAULT 0,
      required INTEGER DEFAULT 1,
      FOREIGN KEY (checklist_id) REFERENCES hr_onboarding_checklists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hr_onboarding_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      checklist_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','skipped','na')),
      completed_at TEXT,
      completed_by INTEGER,
      notes TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (checklist_id) REFERENCES hr_onboarding_checklists(id),
      FOREIGN KEY (task_id) REFERENCES hr_onboarding_tasks(id),
      FOREIGN KEY (completed_by) REFERENCES users(id),
      UNIQUE(user_id, task_id)
    );

    CREATE TABLE IF NOT EXISTS hr_employee_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      document_type TEXT NOT NULL CHECK(document_type IN ('w4','i9','direct_deposit','nda','handbook_ack','policy_ack','license_copy','certification_copy','background_check','drug_test','photo_id','contract','other')),
      title TEXT NOT NULL,
      file_id TEXT,
      file_size INTEGER,
      notes TEXT,
      uploaded_by INTEGER NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','superseded','archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS hr_document_acknowledgments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      acknowledged_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      ip_address TEXT,
      digital_signature TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (document_id) REFERENCES hr_employee_documents(id),
      UNIQUE(user_id, document_id)
    );

    -- ── Payroll & Accounting ──────────────────────────────
    CREATE TABLE IF NOT EXISTS hr_pay_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pay_type TEXT NOT NULL CHECK(pay_type IN ('hourly','salary','contract','per_diem')),
      rate REAL NOT NULL,
      overtime_rate REAL DEFAULT 1.5,
      holiday_rate REAL DEFAULT 1.5,
      effective_date TEXT NOT NULL,
      end_date TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS hr_pay_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      pay_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','processing','finalized','paid')),
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(start_date, end_date)
    );

    CREATE TABLE IF NOT EXISTS hr_payroll_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pay_period_id INTEGER NOT NULL,
      pay_rate_id INTEGER,
      regular_hours REAL DEFAULT 0,
      overtime_hours REAL DEFAULT 0,
      holiday_hours REAL DEFAULT 0,
      pto_hours REAL DEFAULT 0,
      sick_hours REAL DEFAULT 0,
      other_hours REAL DEFAULT 0,
      other_hours_description TEXT,
      base_pay REAL DEFAULT 0,
      overtime_pay REAL DEFAULT 0,
      holiday_pay REAL DEFAULT 0,
      other_pay REAL DEFAULT 0,
      gross_pay REAL DEFAULT 0,
      total_deductions REAL DEFAULT 0,
      net_pay REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','calculated','approved','paid','void')),
      approved_by INTEGER,
      approved_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (pay_period_id) REFERENCES hr_pay_periods(id),
      FOREIGN KEY (pay_rate_id) REFERENCES hr_pay_rates(id),
      FOREIGN KEY (approved_by) REFERENCES users(id),
      UNIQUE(user_id, pay_period_id)
    );

    CREATE TABLE IF NOT EXISTS hr_deductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      deduction_type TEXT NOT NULL CHECK(deduction_type IN ('federal_tax','state_tax','local_tax','fica','medicare','health_insurance','dental_insurance','vision_insurance','life_insurance','retirement_401k','retirement_pension','hsa','fsa','garnishment','child_support','union_dues','other')),
      amount REAL,
      percentage REAL,
      is_pretax INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      effective_date TEXT NOT NULL,
      end_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS hr_payroll_deduction_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_entry_id INTEGER NOT NULL,
      deduction_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (payroll_entry_id) REFERENCES hr_payroll_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (deduction_id) REFERENCES hr_deductions(id)
    );

    CREATE TABLE IF NOT EXISTS hr_pay_stubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_entry_id INTEGER NOT NULL UNIQUE,
      stub_data TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (payroll_entry_id) REFERENCES hr_payroll_entries(id)
    );

    -- ── HR Indexes ────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_hr_leave_req_user ON hr_leave_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_hr_leave_req_status ON hr_leave_requests(status);
    CREATE INDEX IF NOT EXISTS idx_hr_leave_bal_user ON hr_leave_balances(user_id);
    CREATE INDEX IF NOT EXISTS idx_hr_reviews_user ON hr_performance_reviews(user_id);
    CREATE INDEX IF NOT EXISTS idx_hr_reviews_cycle ON hr_performance_reviews(cycle_id);
    CREATE INDEX IF NOT EXISTS idx_hr_disciplinary_user ON hr_disciplinary_actions(user_id);
    CREATE INDEX IF NOT EXISTS idx_hr_grievances_filed ON hr_grievances(filed_by);
    CREATE INDEX IF NOT EXISTS idx_hr_onboard_progress ON hr_onboarding_progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_hr_emp_docs_user ON hr_employee_documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_hr_pay_rates_user ON hr_pay_rates(user_id);
    CREATE INDEX IF NOT EXISTS idx_hr_payroll_user ON hr_payroll_entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_hr_payroll_period ON hr_payroll_entries(pay_period_id);
    CREATE INDEX IF NOT EXISTS idx_hr_deductions_user ON hr_deductions(user_id);
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
      // Disable FK checks for the table rebuild (try-finally ensures re-enable)
      db.pragma('foreign_keys = OFF');
      try {
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
        console.log('Migrated calls_for_service: source CHECK now includes patrol, online, dispatch, other');
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
  } catch (err) {
    console.log('calls_for_service source migration skipped or already done:', (err as Error).message);
  }

  // ── calls_for_service — add 'panic' to source CHECK constraint ──────
  // The panic button needs source='panic' but it wasn't in the original list.
  try {
    const cfsSchema2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='calls_for_service'").get() as any;
    if (cfsSchema2 && cfsSchema2.sql && !cfsSchema2.sql.includes("'panic'")) {
      db.pragma('foreign_keys = OFF');
      try {
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
        console.log("Migrated calls_for_service: source CHECK now includes 'panic'");
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
  } catch (err) {
    console.log('calls_for_service panic source migration skipped or already done:', (err as Error).message);
  }

  // ── calls_for_service — add 'on_hold' to status CHECK constraint ─────
  // Call hold/resume feature: dispatchers can put calls on hold (amber state).
  try {
    const cfsSchema3 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='calls_for_service'").get() as any;
    if (cfsSchema3 && cfsSchema3.sql && !cfsSchema3.sql.includes("'on_hold'")) {
      db.pragma('foreign_keys = OFF');
      try {
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
        console.log("Migrated calls_for_service: status CHECK now includes 'on_hold'");
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
  } catch (err) {
    console.log('calls_for_service on_hold status migration skipped or already done:', (err as Error).message);
  }

  // ── calls_for_service — add 'servemanager' to source CHECK constraint ──
  // ServeManager auto-poller creates dispatch calls with source='servemanager'.
  try {
    const cfsSchemaSm = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='calls_for_service'").get() as any;
    if (cfsSchemaSm && cfsSchemaSm.sql && !cfsSchemaSm.sql.includes("'servemanager'")) {
      db.pragma('foreign_keys = OFF');
      try {
        db.exec(`DROP TABLE IF EXISTS calls_for_service_new`);
        const currentSql = cfsSchemaSm.sql as string;
        const newSql = currentSql
          .replace('calls_for_service', 'calls_for_service_new')
          .replace(
            "source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','panic','other')",
            "source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','panic','servemanager','other')"
          );
        db.exec(newSql);
        const cfsColsSm = db.prepare("PRAGMA table_info(calls_for_service)").all() as any[];
        const cfsColNamesSm = cfsColsSm.map((c: any) => c.name).join(', ');
        db.exec(`INSERT INTO calls_for_service_new (${cfsColNamesSm}) SELECT ${cfsColNamesSm} FROM calls_for_service`);
        db.exec(`DROP TABLE calls_for_service`);
        db.exec(`ALTER TABLE calls_for_service_new RENAME TO calls_for_service`);
        console.log("Migrated calls_for_service: source CHECK now includes 'servemanager'");
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
  } catch (err) {
    console.log('calls_for_service servemanager source migration skipped or already done:', (err as Error).message);
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
  addCol('users', 'totp_setup_required', 'INTEGER DEFAULT 1'); // New users must set up 2FA
  addCol('users', 'password_expires_at', 'TEXT');          // ISO timestamp when password expires
  addCol('users', 'force_password_change', 'INTEGER DEFAULT 0'); // Admin-forced password change

  // ── USERS — Password history & expiry ─────────────────
  addCol('users', 'password_history', 'TEXT');             // JSON array of previous bcrypt hashes
  addCol('users', 'password_changed_at', 'TEXT');          // ISO timestamp of last password change
  addCol('users', 'password_expiry_exempt', 'INTEGER DEFAULT 0'); // Exempt from scheduled password rotation

  // ── LOGIN_ATTEMPTS / SESSIONS — Device fingerprinting ──
  addCol('login_attempts', 'user_agent', 'TEXT');
  addCol('login_attempts', 'device_fingerprint', 'TEXT');
  addCol('sessions', 'device_fingerprint', 'TEXT');
  addCol('sessions', 'device_name', 'TEXT');
  addCol('sessions', 'ua_hash', 'TEXT');  // User-agent hash for session binding
  addCol('sessions', 'previous_token_hash', 'TEXT'); // Previous refresh token hash for reuse detection

  // ── ACTIVITY_LOG — tamper-evident integrity hash ──
  addCol('activity_log', 'log_hash', 'TEXT');         // HMAC-SHA256 chain hash for tamper detection

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

  // ── EVIDENCE — case linkage ─────────────────────────────
  addCol('evidence', 'case_id', 'INTEGER');

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

  // ── Expand record_links to support case + incident entity types ──
  try {
    const rlSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='record_links'").get() as any;
    if (rlSchema?.sql && !rlSchema.sql.includes("'case'")) {
      db.exec(`
        CREATE TABLE record_links_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_type TEXT NOT NULL CHECK(source_type IN ('person','vehicle','property','evidence','case','incident')),
          source_id INTEGER NOT NULL,
          target_type TEXT NOT NULL CHECK(target_type IN ('person','vehicle','property','evidence','case','incident')),
          target_id INTEGER NOT NULL,
          relationship TEXT NOT NULL DEFAULT 'associated',
          notes TEXT,
          created_by INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (created_by) REFERENCES users(id),
          UNIQUE(source_type, source_id, target_type, target_id)
        );
      `);
      const cols = db.prepare("PRAGMA table_info(record_links)").all() as any[];
      const colNames = cols.map((c: any) => c.name).join(', ');
      db.exec(`INSERT INTO record_links_new (${colNames}) SELECT ${colNames} FROM record_links`);
      db.exec(`DROP TABLE record_links`);
      db.exec(`ALTER TABLE record_links_new RENAME TO record_links`);
      console.log('Migrated record_links: added case + incident entity types');
    }
  } catch (err) {
    console.log('record_links migration skipped:', (err as Error).message);
  }

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

  // ── UTAH STATUTES — multi-state support ──
  addCol('utah_statutes', 'state', "TEXT NOT NULL DEFAULT 'UT'");
  addCol('utah_statutes', 'state_name', "TEXT NOT NULL DEFAULT 'Utah'");
  addCol('utah_statutes', 'definition', 'TEXT');

  // Ensure the citation index is UNIQUE (needed for ON CONFLICT in seed)
  try {
    db.exec('DROP INDEX IF EXISTS idx_statutes_citation');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_statutes_citation ON utah_statutes(citation)');
  } catch { /* already unique */ }

  // Multi-state indexes
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_statutes_state ON utah_statutes(state)'); } catch { /* exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_statutes_state_cat ON utah_statutes(state, category)'); } catch { /* exists */ }

  // ── COLORADO DOC OFFENDERS TABLE ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS colorado_doc_offenders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_number TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        middle_name TEXT,
        dob TEXT,
        gender TEXT,
        race TEXT,
        facility TEXT,
        status TEXT,
        parole_eligibility TEXT,
        release_date TEXT,
        photo_url TEXT,
        offenses TEXT,
        raw_data TEXT,
        person_id INTEGER,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE(doc_number),
        FOREIGN KEY (person_id) REFERENCES persons(id)
      );
      CREATE INDEX IF NOT EXISTS idx_co_doc_name ON colorado_doc_offenders(last_name, first_name);
      CREATE INDEX IF NOT EXISTS idx_co_doc_person ON colorado_doc_offenders(person_id);
    `);
  } catch { /* table/indexes already exist */ }

  // ── SEX OFFENDER REGISTRY TABLE ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sex_offender_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER,
        registry_id TEXT UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        middle_name TEXT,
        aliases TEXT,
        dob TEXT,
        gender TEXT,
        race TEXT,
        height TEXT,
        weight TEXT,
        hair_color TEXT,
        eye_color TEXT,
        scars_marks_tattoos TEXT,
        photo_url TEXT,
        tier INTEGER DEFAULT 1,
        risk_level TEXT,
        registration_status TEXT DEFAULT 'compliant',
        registration_date TEXT,
        expiration_date TEXT,
        last_verification TEXT,
        next_verification_due TEXT,
        registration_jurisdiction TEXT,
        offenses TEXT DEFAULT '[]',
        conviction_state TEXT,
        addresses TEXT DEFAULT '[]',
        vehicles TEXT DEFAULT '[]',
        employer TEXT,
        employer_address TEXT,
        school TEXT,
        school_address TEXT,
        restrictions TEXT,
        conditions TEXT DEFAULT '[]',
        supervising_officer TEXT,
        source TEXT DEFAULT 'manual',
        notes TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (person_id) REFERENCES persons(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sor_last_name ON sex_offender_registry(last_name);
      CREATE INDEX IF NOT EXISTS idx_sor_registry_id ON sex_offender_registry(registry_id);
      CREATE INDEX IF NOT EXISTS idx_sor_person_id ON sex_offender_registry(person_id);
      CREATE INDEX IF NOT EXISTS idx_sor_tier ON sex_offender_registry(tier);
      CREATE INDEX IF NOT EXISTS idx_sor_status ON sex_offender_registry(registration_status);
    `);
  } catch { /* table/indexes already exist */ }

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
      try {
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
        console.log("Migrated time_entries: status CHECK now includes 'on_break'");
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
  } catch (err) {
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

  // ── PSO fields on incidents (auto-filled from dispatch call on generation) ──
  addCol('incidents', 'pso_service_type', 'TEXT');
  addCol('incidents', 'pso_attempt_number', 'INTEGER');
  addCol('incidents', 'pso_requestor_name', 'TEXT');
  addCol('incidents', 'pso_requestor_phone', 'TEXT');
  addCol('incidents', 'pso_requestor_email', 'TEXT');
  addCol('incidents', 'pso_billing_code', 'TEXT');
  addCol('incidents', 'pso_authorization', 'TEXT');
  addCol('incidents', 'process_service_type', 'TEXT');
  addCol('incidents', 'process_served_to', 'TEXT');
  addCol('incidents', 'process_served_address', 'TEXT');
  addCol('incidents', 'process_service_result', 'TEXT');
  addCol('incidents', 'process_attempts', 'INTEGER');

  // ── Backfill case numbers for dispatch calls that don't have one ──
  try {
    const callsWithoutCase = db.prepare(
      "SELECT id, incident_type FROM calls_for_service WHERE case_number IS NULL OR case_number = ''"
    ).all() as { id: number; incident_type: string }[];

    if (callsWithoutCase.length > 0) {
      const INCIDENT_TO_CASE_TYPE: Record<string, string> = {
        theft: 'theft', burglary: 'burglary', robbery: 'criminal', assault: 'assault', battery: 'assault',
        vandalism: 'criminal', criminal_mischief: 'criminal', drug_activity: 'narcotics', weapons_offense: 'criminal',
        fraud_forgery: 'fraud', kidnapping: 'criminal', arson: 'criminal', sexual_assault: 'criminal',
        stalking: 'criminal', identity_theft: 'fraud', criminal_trespass: 'criminal', shoplifting: 'theft',
        auto_theft: 'theft', criminal_threat: 'criminal', prostitution: 'criminal',
        trespass: 'disorder', disturbance: 'disorder', noise_complaint: 'disorder', loitering: 'disorder',
        panhandling: 'disorder', domestic_dispute: 'domestic', prowler: 'disorder', harassment: 'disorder',
        traffic_accident: 'accident', hit_and_run: 'accident', dui_dwi: 'traffic', parking_violation: 'traffic',
        traffic_hazard: 'traffic', abandoned_vehicle: 'traffic', reckless_driving: 'traffic', traffic_stop: 'traffic',
        medical_emergency: 'medical', overdose: 'medical', mental_health_crisis: 'medical',
        fire: 'fire', fire_alarm: 'fire', hazmat: 'fire',
        death_investigation: 'death', missing_person: 'missing_person', juvenile_runaway: 'juvenile',
        alarm_response: 'security', access_control: 'security', patrol_check: 'security', lock_unlock: 'security',
        property_damage: 'property', lost_found: 'property',
        daily_activity: 'admin', special_event: 'admin', training_exercise: 'admin',
      };

      const backfillTx = db.transaction(() => {
        for (const call of callsWithoutCase) {
          const caseType = INCIDENT_TO_CASE_TYPE[call.incident_type] || 'general';
          const caseNum = generateCaseNumber(db, caseType);
          db.prepare('UPDATE calls_for_service SET case_number = ? WHERE id = ?').run(caseNum, call.id);
        }
      });
      backfillTx();
      console.log(`  Backfilled case numbers for ${callsWithoutCase.length} dispatch calls`);
    }
  } catch (err) {
    console.warn('[migrate] Case number backfill error:', (err as Error).message);
  }

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
    // Beat must be unique within its zone+section; zone_id is inherently unique within a section
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_district_beat_unique ON dispatch_districts (section_id, zone_id, beat_id)`);
  } catch { /* already exists */ }

  // Seed dispatch_districts — delete & reseed to pick up expanded coverage
  // v2: Full UT statewide + Uinta Co WY + SW Wyoming + realistic police beat names
  try {
    const districtVersion = db.prepare("SELECT config_value FROM system_config WHERE config_key = 'dispatch_districts_version'").get() as any;
    const currentVersion = '2';
    if (!districtVersion || districtVersion.config_value !== currentVersion) {
      db.prepare('DELETE FROM dispatch_districts').run();
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO dispatch_districts (section_id, zone_id, beat_id, dispatch_code, section_name, zone_name, beat_name, beat_descriptor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const d of DISPATCH_DISTRICTS) {
        insertStmt.run(d.section_id, d.zone_id, d.beat_id, d.dispatch_code, d.section_name, d.zone_name, d.beat_name, d.beat_descriptor);
      }
      db.prepare(`INSERT OR REPLACE INTO system_config (config_key, config_value, category) VALUES ('dispatch_districts_version', ?, 'system')`).run(currentVersion);
      console.log(`[migrate] Reseeded ${DISPATCH_DISTRICTS.length} dispatch districts (v${currentVersion} — full UT + WY coverage)`);
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

  // ── Process Service served-at timestamp on incidents ──
  addCol('incidents', 'process_served_at', 'TEXT');

  // ── Original 3 flags that were only on calls — ensure they exist on incidents too ──
  addCol('incidents', 'injuries_reported', 'INTEGER DEFAULT 0');
  addCol('incidents', 'le_notified', 'INTEGER DEFAULT 0');
  addCol('incidents', 'supervisor_notified', 'INTEGER DEFAULT 0');

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
  // PSO general attempt tracking (re-dispatch counter)
  addCol('calls_for_service', 'pso_attempt_number', 'INTEGER DEFAULT 1');
  addCol('calls_for_service', 'pso_72hr_notified', 'TEXT'); // '48h' or '72h' or 'resolved' — tracks notification state for 72-hour rule
  addCol('calls_for_service', 'pso_72hr_deadline', 'TEXT'); // ISO timestamp: exact 72hr deadline from when call was cleared

  // Process service specific
  addCol('calls_for_service', 'process_service_type', 'TEXT'); // subpoena, summons, complaint, eviction, restraining_order, other
  addCol('calls_for_service', 'process_served_to', 'TEXT');
  addCol('calls_for_service', 'process_served_address', 'TEXT');
  addCol('calls_for_service', 'process_attempts', 'INTEGER DEFAULT 0');
  addCol('calls_for_service', 'process_served_at', 'TEXT');
  addCol('calls_for_service', 'process_service_result', 'TEXT'); // served, unable_to_serve, refused, substitute_service

  // ── Section/Zone/Beat columns for record types ──────────
  // Citations
  addCol('citations', 'call_id', 'INTEGER REFERENCES calls_for_service(id)');
  addCol('citations', 'section_id', 'TEXT');
  addCol('citations', 'zone_id', 'TEXT');
  addCol('citations', 'beat_id', 'TEXT');
  addCol('citations', 'zone_beat', 'TEXT');
  // Trespass Orders
  addCol('trespass_orders', 'section_id', 'TEXT');
  addCol('trespass_orders', 'zone_id', 'TEXT');
  addCol('trespass_orders', 'beat_id', 'TEXT');
  addCol('trespass_orders', 'zone_beat', 'TEXT');
  // Field Interviews
  addCol('field_interviews', 'section_id', 'TEXT');
  addCol('field_interviews', 'zone_id', 'TEXT');
  addCol('field_interviews', 'beat_id', 'TEXT');
  addCol('field_interviews', 'zone_beat', 'TEXT');
  // Code Enforcement Violations
  addCol('code_violations', 'section_id', 'TEXT');
  addCol('code_violations', 'zone_id', 'TEXT');
  addCol('code_violations', 'beat_id', 'TEXT');
  addCol('code_violations', 'zone_beat', 'TEXT');

  // ── Data cleanup: normalize 'None' dropdown values to NULL ──
  // When users select "None" from weapons/agency dropdowns, it should be NULL not the string "None"
  try {
    db.prepare(`UPDATE calls_for_service SET weapons_involved = NULL WHERE weapons_involved = 'None'`).run();
    db.prepare(`UPDATE calls_for_service SET le_agency = NULL WHERE le_agency = 'None'`).run();
    db.prepare(`UPDATE incidents SET weapons_involved = NULL WHERE weapons_involved = 'None'`).run();
  } catch { /* columns may not exist yet */ }

  // ── User Preferences (per-user customization) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY,
      -- Notification preferences
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
      -- Quiet hours (HH:MM format, null = no quiet hours)
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      -- UI preferences
      font_scale REAL DEFAULT 1.0,
      compact_mode INTEGER DEFAULT 0,
      show_map_labels INTEGER DEFAULT 1,
      default_map_style TEXT DEFAULT 'dark',
      -- Dashboard preferences (JSON array of visible widget IDs)
      dashboard_widgets TEXT,
      -- Dispatch board preferences
      dispatch_sort TEXT DEFAULT 'priority',
      dispatch_show_cleared INTEGER DEFAULT 0,
      -- Timestamp
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ── Expanded user preferences columns ───────────────────────────────────────
  addCol('user_preferences', 'date_format', "TEXT DEFAULT 'MM/DD/YYYY'");
  addCol('user_preferences', 'time_format', "TEXT DEFAULT '12h'");
  // timezone_override intentionally omitted — America/Denver is mandatory
  addCol('user_preferences', 'status_sounds_enabled', 'INTEGER DEFAULT 1');
  addCol('user_preferences', 'notification_sounds', 'INTEGER DEFAULT 1');
  addCol('user_preferences', 'gps_track_display', "TEXT DEFAULT 'trail'");       // trail | none | dot
  addCol('user_preferences', 'auto_geocode_calls', 'INTEGER DEFAULT 1');
  addCol('user_preferences', 'default_landing_page', "TEXT DEFAULT '/'");
  addCol('user_preferences', 'map_default_zoom', 'INTEGER DEFAULT 13');
  addCol('user_preferences', 'show_weather_widget', 'INTEGER DEFAULT 1');
  addCol('user_preferences', 'show_unit_status_bar', 'INTEGER DEFAULT 1');
  addCol('user_preferences', 'sidebar_collapsed', 'INTEGER DEFAULT 0');
  addCol('user_preferences', 'patrol_log_auto_open', 'INTEGER DEFAULT 0');
  addCol('user_preferences', 'dispatch_audio_alerts', 'INTEGER DEFAULT 1');
  addCol('user_preferences', 'highlight_own_unit', 'INTEGER DEFAULT 1');
  addCol('user_preferences', 'show_call_timer', 'INTEGER DEFAULT 1');
  addCol('user_preferences', 'show_bolo_banner', 'INTEGER DEFAULT 1');
  addCol('user_preferences', 'map_traffic_overlay', 'INTEGER DEFAULT 0');
  addCol('user_preferences', 'map_satellite_default', 'INTEGER DEFAULT 0');
  addCol('user_preferences', 'warrant_auto_attach', 'INTEGER DEFAULT 1');        // auto-link warrants to calls

  // Radio audio recording — store audio file path alongside transcripts
  addCol('radio_transcripts', 'audio_file', 'TEXT');
  addCol('radio_transcripts', 'file_size', 'INTEGER');
  addCol('radio_transcripts', 'linked_call_id', 'TEXT');

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

  // ── Backfill dashcam_videos.vehicle_id from unit's assigned fleet vehicle ──
  try {
    const result = db.prepare(`
      UPDATE dashcam_videos
      SET vehicle_id = (
        SELECT fv.id FROM fleet_vehicles fv WHERE fv.assigned_unit_id = dashcam_videos.unit_id
      )
      WHERE vehicle_id IS NULL
        AND unit_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM fleet_vehicles fv WHERE fv.assigned_unit_id = dashcam_videos.unit_id)
    `).run();
    if (result.changes > 0) {
      console.log(`  Backfilled vehicle_id on ${result.changes} dashcam video(s) from unit fleet assignments`);
    }
  } catch { /* safe to ignore */ }

  // ── DASHCAM_VIDEOS — ClearPathGPS media sync tracking columns ──
  addCol('dashcam_videos', 'cpg_device_id', 'TEXT');
  addCol('dashcam_videos', 'cpg_media_timestamp', 'INTEGER');
  addCol('dashcam_videos', 'cpg_channel', 'TEXT');
  addCol('dashcam_videos', 'cpg_event_type', 'TEXT');
  addCol('dashcam_videos', 'cpg_access_url', 'TEXT');
  addCol('dashcam_videos', 'cpg_thumbnail_url', 'TEXT');
  addCol('dashcam_videos', 'linked_dashcam_event_id', 'INTEGER');
  addCol('dashcam_videos', 'cpg_gps_track', 'TEXT');           // JSON array of {lat,lng,speed,altitude,timestamp} points

  // ── DASHCAM overlay + burn + thumbnail columns ──
  addCol('dashcam_videos', 'overlay_status', "TEXT DEFAULT 'none'");
  addCol('dashcam_videos', 'overlay_error', 'TEXT');
  addCol('dashcam_videos', 'processed_file_path', 'TEXT');
  addCol('dashcam_videos', 'thumbnail_path', 'TEXT');
  addCol('dashcam_videos', 'burned_file_path', 'TEXT');
  addCol('dashcam_videos', 'burn_status', "TEXT DEFAULT 'none'");
  addCol('dashcam_videos', 'burn_error', 'TEXT');
  addCol('dashcam_videos', 'burn_progress', 'INTEGER DEFAULT 0');

  // ── CPG_DEVICE_MAPPINGS — media sync state ──
  addCol('cpg_device_mappings', 'last_media_synced_at', 'TEXT');
  addCol('cpg_device_mappings', 'media_sync_errors', 'INTEGER DEFAULT 0');
  addCol('cpg_device_mappings', 'cpg_camera_id', 'INTEGER');  // v2.0 numeric camera ID

  // ── DASHCAM_EVENTS — status_code columns for ClearPathGPS event data ──
  addCol('dashcam_events', 'status_code', 'TEXT');
  addCol('dashcam_events', 'status_code_text', 'TEXT');

  // Dedup index for dashcam events (prevent duplicate inserts on poller restart)
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_dashcam_events_dedup ON dashcam_events(cpg_device_id, event_timestamp, event_type)');
  } catch { /* index may already exist */ }

  // Dedup index for ClearPathGPS media sync
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_dashcam_videos_cpg_dedup ON dashcam_videos(cpg_device_id, cpg_media_timestamp)');
  } catch { /* index may already exist */ }

  // ── USERS — add contract_manager to role CHECK ──
  try {
    // Check if the current CHECK already includes contract_manager
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as any;
    if (tableInfo?.sql && !tableInfo.sql.includes('contract_manager')) {
      db.pragma('foreign_keys = OFF');
      try {
        db.exec(`
          CREATE TABLE users_new (
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
          )
        `);
        // Copy all columns that exist in both tables
        const userCols = db.prepare("PRAGMA table_info(users)").all() as any[];
        const newCols = db.prepare("PRAGMA table_info(users_new)").all() as any[];
        const newColNames = new Set(newCols.map((c: any) => c.name));
        const sharedCols = userCols.map((c: any) => c.name).filter((n: string) => newColNames.has(n));
        const colList = sharedCols.join(', ');
        db.exec(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users`);
        db.exec(`DROP TABLE users`);
        db.exec(`ALTER TABLE users_new RENAME TO users`);
        console.log("Migrated users: role CHECK now includes 'contract_manager'");
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
  } catch (err) {
    console.log('users CHECK migration skipped or already done:', (err as Error).message);
  }

  // ── UTAH WARRANTS — cache table for warrants.utah.gov search results ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS utah_warrants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        utah_person_id TEXT NOT NULL,
        first_name TEXT,
        middle_name TEXT,
        last_name TEXT,
        age INTEGER,
        city TEXT,
        utah_warrant_id TEXT NOT NULL,
        issue_date TEXT,
        court_name TEXT,
        case_id TEXT,
        charges TEXT,
        fetched_at TEXT NOT NULL,
        UNIQUE(utah_person_id, utah_warrant_id)
      )
    `);
  } catch { /* already exists */ }

  // ── WARRANT WATCH LOG — tracks automated scan results ──────
  // Records each time a known person is found to have (or no longer
  // have) an active Utah state warrant. Provides a full audit trail
  // for the 12-hour scheduled scans.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS warrant_watch_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL,
        person_name TEXT NOT NULL,
        event TEXT NOT NULL CHECK(event IN ('warrant_found', 'warrant_cleared')),
        utah_warrant_id TEXT,
        utah_person_id TEXT,
        court_name TEXT,
        case_id TEXT,
        charges TEXT,
        issue_date TEXT,
        scan_run_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (person_id) REFERENCES persons(id)
      )
    `);
  } catch { /* already exists */ }

  // ── WARRANT WATCH SCAN RUNS — summary of each automated scan ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS warrant_watch_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        persons_checked INTEGER DEFAULT 0,
        new_warrants_found INTEGER DEFAULT 0,
        warrants_cleared INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
        error_message TEXT
      )
    `);
  } catch { /* already exists */ }

  // Index for fast person lookup in watch log
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_warrant_watch_log_person ON warrant_watch_log(person_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_warrant_watch_log_event ON warrant_watch_log(event, created_at)');
  } catch { /* already exists */ }

  // ══════════════════════════════════════════════════════════════
  // MULTI-STATE WARRANT SCRAPER
  // ══════════════════════════════════════════════════════════════

  // ── Warrant scraper config — one row per warrant source ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS warrant_scraper_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        source_url TEXT,
        source_type TEXT NOT NULL DEFAULT 'html'
          CHECK(source_type IN ('html', 'json', 'api', 'arrest_extract', 'none')),
        state TEXT NOT NULL DEFAULT 'UT',
        county TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        scrape_interval_minutes INTEGER NOT NULL DEFAULT 120,
        last_scrape_at TEXT,
        consecutive_errors INTEGER NOT NULL DEFAULT 0,
        circuit_broken INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )
    `);
  } catch { /* already exists */ }

  // ── Scraped warrants — unified cache for all warrant sources ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scraped_warrants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL,
        warrant_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        middle_name TEXT,
        date_of_birth TEXT,
        age INTEGER,
        gender TEXT,
        race TEXT,
        city TEXT,
        state TEXT,
        warrant_type TEXT,
        case_number TEXT,
        court_name TEXT,
        issue_date TEXT,
        charge_description TEXT,
        bail_amount TEXT,
        offense_level TEXT,
        photo_url TEXT,
        detail_url TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('active', 'served', 'cleared', 'expired')),
        person_id INTEGER,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        cleared_at TEXT,
        UNIQUE(source_key, warrant_id),
        FOREIGN KEY (person_id) REFERENCES persons(id)
      )
    `);
  } catch { /* already exists */ }

  // Indexes for scraped warrants
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_scraped_warrants_source ON scraped_warrants(source_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_scraped_warrants_name ON scraped_warrants(last_name, first_name)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_scraped_warrants_status ON scraped_warrants(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_scraped_warrants_person ON scraped_warrants(person_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_scraped_warrants_state ON scraped_warrants(state)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_warrant_scraper_config_state ON warrant_scraper_config(state)');
  } catch { /* already exists */ }

  // ── Seed warrant scraper configs ──────────────────────────────
  try {
    const insertWarrantConfig = db.prepare(`
      INSERT OR IGNORE INTO warrant_scraper_config
        (source_key, display_name, source_url, source_type, state, county, enabled, scrape_interval_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const warrantSources = [
      // ── Utah (already has warrants.utah.gov live search — this adds scheduled scrape of known persons) ──
      ['ut_state', 'Utah State Warrants', 'https://warrants.utah.gov/api/v1', 'api', 'UT', null, 1, 60],

      // ── Colorado (surrounding state — enabled by default, hourly scans) ──
      ['co_el_paso_warrants', 'El Paso County, CO Warrants', 'https://www.epcsheriffsoffice.com/services/warrant-information/', 'html', 'CO', 'co_el_paso', 1, 60],
      ['co_denver_warrants', 'Denver County, CO Warrants', 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Department-of-Public-Safety/Police', 'html', 'CO', 'co_denver', 1, 60],
      ['co_mesa_warrants', 'Mesa County, CO Warrants', 'https://sheriff.mesacounty.us/warrants/', 'html', 'CO', 'co_mesa', 1, 60],
      ['co_pueblo_warrants', 'Pueblo County, CO Warrants', 'https://county.pueblo.org/sheriff/wanted-persons', 'html', 'CO', 'co_pueblo', 1, 60],
      ['co_larimer_warrants', 'Larimer County, CO Warrants', 'https://www.larimer.org/sheriff/services/warrants', 'html', 'CO', 'co_larimer', 1, 60],
      ['co_weld_warrants', 'Weld County, CO Warrants', 'https://www.weldcountysheriff.com/warrants', 'html', 'CO', 'co_weld', 1, 60],
      ['co_arapahoe_warrants', 'Arapahoe County, CO Warrants', 'https://www.arapahoegov.com/1159/Warrants', 'html', 'CO', 'co_arapahoe', 1, 60],
      ['co_adams_warrants', 'Adams County, CO Warrants', 'https://www.adamscountysheriff.org', 'html', 'CO', 'co_adams', 1, 60],
      ['co_jefferson_warrants', 'Jefferson County, CO Warrants', 'https://www.jeffco.us/sheriff', 'html', 'CO', 'co_jefferson', 1, 60],
      ['co_douglas_warrants', 'Douglas County, CO Warrants', 'https://www.dcsheriff.net', 'html', 'CO', 'co_douglas', 1, 60],
      ['co_boulder_warrants', 'Boulder County, CO Warrants', 'https://www.bouldercounty.gov/sheriff/', 'html', 'CO', 'co_boulder', 1, 60],
      ['co_garfield_warrants', 'Garfield County, CO Warrants', 'https://www.garcosheriff.com', 'html', 'CO', 'co_garfield', 1, 60],

      // ── Wyoming (surrounding state — enabled by default, hourly scans) ──
      ['wy_natrona_warrants', 'Natrona County, WY Warrants', 'https://www.natronacounty-wy.gov/sheriff', 'html', 'WY', 'wy_natrona', 1, 60],
      ['wy_laramie_warrants', 'Laramie County, WY Warrants', 'https://www.laramiecountysheriff.com', 'html', 'WY', 'wy_laramie', 1, 60],
      ['wy_sweetwater_warrants', 'Sweetwater County, WY Warrants', 'https://www.sweetwatercountywy.gov/sheriff', 'html', 'WY', 'wy_sweetwater', 1, 60],
      ['wy_fremont_warrants', 'Fremont County, WY Warrants', 'https://www.fremontcountywy.org/sheriff', 'html', 'WY', 'wy_fremont', 1, 60],
      ['wy_campbell_warrants', 'Campbell County, WY Warrants', 'https://www.ccsd.net', 'html', 'WY', 'wy_campbell', 1, 60],

      // ── Idaho (surrounding state — enabled by default, hourly scans) ──
      ['id_ada_warrants', 'Ada County, ID Warrants', 'https://www.adasheriff.org/Warrants', 'html', 'ID', 'id_ada', 1, 60],
      ['id_canyon_warrants', 'Canyon County, ID Warrants', 'https://www.canyoncounty.id.gov/sheriff', 'html', 'ID', 'id_canyon', 1, 60],
      ['id_bannock_warrants', 'Bannock County, ID Warrants', 'https://www.bannockcounty.us/sheriff/', 'html', 'ID', 'id_bannock', 1, 60],
      ['id_bonneville_warrants', 'Bonneville County, ID Warrants', 'https://www.co.bonneville.id.us/sheriff', 'html', 'ID', 'id_bonneville', 1, 60],
      ['id_twin_falls_warrants', 'Twin Falls County, ID Warrants', 'https://www.twinfallscounty.org/sheriff', 'html', 'ID', 'id_twin_falls', 1, 60],
      ['id_kootenai_warrants', 'Kootenai County, ID Warrants', 'https://www.kcgov.us/sheriff', 'html', 'ID', 'id_kootenai', 1, 60],

      // ── Nevada (surrounding state — enabled by default, hourly scans) ──
      ['nv_clark_warrants', 'Clark County, NV (LVMPD) Warrants', 'https://www.lvmpd.com/en-us/Pages/WantedSuspects.aspx', 'html', 'NV', 'nv_clark', 1, 60],
      ['nv_washoe_warrants', 'Washoe County, NV Warrants', 'https://www.washoecounty.gov/sheriff/warrants/', 'html', 'NV', 'nv_washoe', 1, 60],

      // ── Arizona (surrounding state — enabled by default, hourly scans) ──
      ['az_maricopa_warrants', 'Maricopa County, AZ (MCSO) Warrants', 'https://www.mcso.org/Home/MostWanted', 'html', 'AZ', 'az_maricopa', 1, 60],
      ['az_pima_warrants', 'Pima County, AZ Warrants', 'https://www.pimasheriff.org/most-wanted', 'html', 'AZ', 'az_pima', 1, 60],
      ['az_yavapai_warrants', 'Yavapai County, AZ Warrants', 'https://www.yavapai.us/sheriff/wanted', 'html', 'AZ', 'az_yavapai', 1, 60],

      // ── New Mexico (surrounding state — enabled by default, hourly scans) ──
      ['nm_bernalillo_warrants', 'Bernalillo County, NM Warrants', 'https://www.bernco.gov/sheriff/warrants/', 'html', 'NM', 'nm_bernalillo', 1, 60],
      ['nm_dona_ana_warrants', 'Dona Ana County, NM Warrants', 'https://www.donaanacounty.org/sheriff', 'html', 'NM', 'nm_dona_ana', 1, 60],

      // ── Federal / Nationwide Sources (critical for officer safety) ──
      ['fed_fbi_wanted', 'FBI Most Wanted', 'https://www.fbi.gov/wanted', 'html', 'US', null, 1, 60],
      ['fed_usms_wanted', 'US Marshals Most Wanted', 'https://www.usmarshals.gov/what-we-do/fugitive-operations/most-wanted', 'html', 'US', null, 1, 60],
      ['fed_ice_wanted', 'ICE Most Wanted', 'https://www.ice.gov/most-wanted', 'html', 'US', null, 1, 60],
      ['fed_dea_wanted', 'DEA Most Wanted', 'https://www.dea.gov/fugitives', 'html', 'US', null, 1, 60],
      ['fed_atf_wanted', 'ATF Most Wanted', 'https://www.atf.gov/most-wanted', 'html', 'US', null, 1, 60],
      ['fed_secret_service_wanted', 'Secret Service Most Wanted', 'https://www.secretservice.gov/investigation/mostwanted', 'html', 'US', null, 1, 60],

      // ══════════════════════════════════════════════════════════
      //  FULL 50-STATE WARRANT COVERAGE
      //  Largest county/city law enforcement per state
      //  All enabled, 2-hour intervals for non-surrounding states
      // ══════════════════════════════════════════════════════════

      // ── Alabama ──
      ['al_jefferson_warrants', 'Jefferson County, AL Warrants', 'https://www.jeffcosheriff.net/warrants', 'html', 'AL', 'al_jefferson', 1, 120],
      ['al_mobile_warrants', 'Mobile County, AL Warrants', 'https://www.mobileso.com/warrants/', 'html', 'AL', 'al_mobile', 1, 120],

      // ── Alaska ──
      ['ak_anchorage_warrants', 'Anchorage, AK Warrants', 'https://www.muni.org/departments/prior-records/warrants', 'html', 'AK', 'ak_anchorage', 1, 120],

      // ── Arkansas ──
      ['ar_pulaski_warrants', 'Pulaski County, AR Warrants', 'https://www.pulaskicounty.net/sheriff-warrants/', 'html', 'AR', 'ar_pulaski', 1, 120],
      ['ar_benton_warrants', 'Benton County, AR Warrants', 'https://www.bentoncountysheriff.org/warrants', 'html', 'AR', 'ar_benton', 1, 120],

      // ── California ──
      ['ca_los_angeles_warrants', 'Los Angeles County, CA Warrants', 'https://lasd.org/most-wanted/', 'html', 'CA', 'ca_los_angeles', 1, 120],
      ['ca_san_bernardino_warrants', 'San Bernardino County, CA Warrants', 'https://www.sbcounty.gov/sheriff/warrants/', 'html', 'CA', 'ca_san_bernardino', 1, 120],
      ['ca_riverside_warrants', 'Riverside County, CA Warrants', 'https://www.riversidesheriff.org/585/Most-Wanted', 'html', 'CA', 'ca_riverside', 1, 120],
      ['ca_san_diego_warrants', 'San Diego County, CA Warrants', 'https://www.sdsheriff.gov/bureaus/law-enforcement-services-bureau/warrants', 'html', 'CA', 'ca_san_diego', 1, 120],
      ['ca_sacramento_warrants', 'Sacramento County, CA Warrants', 'https://www.sacsheriff.com/pages/warrants.aspx', 'html', 'CA', 'ca_sacramento', 1, 120],
      ['ca_fresno_warrants', 'Fresno County, CA Warrants', 'https://www.fresnosheriff.org/warrants.html', 'html', 'CA', 'ca_fresno', 1, 120],
      ['ca_kern_warrants', 'Kern County, CA Warrants', 'https://www.kernsheriff.org/warrants', 'html', 'CA', 'ca_kern', 1, 120],

      // ── Connecticut ──
      ['ct_hartford_warrants', 'Hartford, CT Warrants', 'https://www.hartfordct.gov/Government/Departments/Police/Most-Wanted', 'html', 'CT', 'ct_hartford', 1, 120],
      ['ct_new_haven_warrants', 'New Haven, CT Warrants', 'https://www.newhavenct.gov/police/most-wanted', 'html', 'CT', 'ct_new_haven', 1, 120],

      // ── Delaware ──
      ['de_new_castle_warrants', 'New Castle County, DE Warrants', 'https://www.nccde.org/130/Most-Wanted', 'html', 'DE', 'de_new_castle', 1, 120],

      // ── Florida ──
      ['fl_miami_dade_warrants', 'Miami-Dade County, FL Warrants', 'https://www.miamidade.gov/global/police/wanted.page', 'html', 'FL', 'fl_miami_dade', 1, 120],
      ['fl_broward_warrants', 'Broward County, FL Warrants', 'https://www.sheriff.org/BE/Pages/Wanted-Persons.aspx', 'html', 'FL', 'fl_broward', 1, 120],
      ['fl_hillsborough_warrants', 'Hillsborough County, FL Warrants', 'https://www.hcso.tampa.fl.us/Community/Most-Wanted', 'html', 'FL', 'fl_hillsborough', 1, 120],
      ['fl_orange_warrants', 'Orange County, FL Warrants', 'https://www.ocso.com/Crime-Information/Most-Wanted', 'html', 'FL', 'fl_orange', 1, 120],
      ['fl_duval_warrants', 'Duval County (Jacksonville), FL Warrants', 'https://www.jaxsheriff.org/Divisions/Investigations/Most-Wanted.aspx', 'html', 'FL', 'fl_duval', 1, 120],

      // ── Georgia ──
      ['ga_fulton_warrants', 'Fulton County, GA Warrants', 'https://www.fultonsheriff.org/warrants', 'html', 'GA', 'ga_fulton', 1, 120],
      ['ga_dekalb_warrants', 'DeKalb County, GA Warrants', 'https://www.dekalbcountyga.gov/sheriff/warrants', 'html', 'GA', 'ga_dekalb', 1, 120],
      ['ga_gwinnett_warrants', 'Gwinnett County, GA Warrants', 'https://www.gwinnettcountysheriff.com/warrants', 'html', 'GA', 'ga_gwinnett', 1, 120],

      // ── Hawaii ──
      ['hi_honolulu_warrants', 'Honolulu, HI Warrants', 'https://www.honolulupd.org/most-wanted/', 'html', 'HI', 'hi_honolulu', 1, 120],

      // ── Illinois ──
      ['il_cook_warrants', 'Cook County, IL Warrants', 'https://www.cookcountysheriff.org/warrants/', 'html', 'IL', 'il_cook', 1, 120],
      ['il_dupage_warrants', 'DuPage County, IL Warrants', 'https://www.dupagesheriff.org/warrants', 'html', 'IL', 'il_dupage', 1, 120],
      ['il_lake_warrants', 'Lake County, IL Warrants', 'https://www.lakecountyil.gov/428/Warrants', 'html', 'IL', 'il_lake', 1, 120],

      // ── Indiana ──
      ['in_marion_warrants', 'Marion County, IN Warrants', 'https://www.indy.gov/agency/indianapolis-metropolitan-police-department', 'html', 'IN', 'in_marion', 1, 120],
      ['in_lake_warrants', 'Lake County, IN Warrants', 'https://www.lakecountysheriff.com/warrants/', 'html', 'IN', 'in_lake', 1, 120],

      // ── Iowa ──
      ['ia_polk_warrants', 'Polk County, IA Warrants', 'https://www.polkcountyiowa.gov/county-sheriff/warrants/', 'html', 'IA', 'ia_polk', 1, 120],

      // ── Kansas ──
      ['ks_sedgwick_warrants', 'Sedgwick County, KS Warrants', 'https://www.sedgwickcounty.org/sheriff/warrants/', 'html', 'KS', 'ks_sedgwick', 1, 120],
      ['ks_johnson_warrants', 'Johnson County, KS Warrants', 'https://www.jocosheriff.org/resources/warrants', 'html', 'KS', 'ks_johnson', 1, 120],

      // ── Kentucky ──
      ['ky_jefferson_warrants', 'Jefferson County, KY Warrants', 'https://www.loumetrowarrants.com', 'html', 'KY', 'ky_jefferson', 1, 120],
      ['ky_fayette_warrants', 'Fayette County, KY Warrants', 'https://www.lexingtonky.gov/most-wanted', 'html', 'KY', 'ky_fayette', 1, 120],

      // ── Louisiana ──
      ['la_orleans_warrants', 'Orleans Parish, LA Warrants', 'https://www.nola.gov/nopd/crime-data/most-wanted/', 'html', 'LA', 'la_orleans', 1, 120],
      ['la_east_baton_rouge_warrants', 'East Baton Rouge, LA Warrants', 'https://www.ebrso.org/warrants', 'html', 'LA', 'la_east_baton_rouge', 1, 120],

      // ── Maine ──
      ['me_cumberland_warrants', 'Cumberland County, ME Warrants', 'https://www.cumberlandso.org/warrants', 'html', 'ME', 'me_cumberland', 1, 120],

      // ── Maryland ──
      ['md_baltimore_warrants', 'Baltimore County, MD Warrants', 'https://www.baltimorepolice.org/crime-stats/most-wanted', 'html', 'MD', 'md_baltimore', 1, 120],
      ['md_prince_georges_warrants', "Prince George's County, MD Warrants", 'https://www.princegeorgescountymd.gov/departments-offices/police/most-wanted', 'html', 'MD', 'md_prince_georges', 1, 120],

      // ── Massachusetts ──
      ['ma_suffolk_warrants', 'Suffolk County (Boston), MA Warrants', 'https://bpdnews.com/most-wanted', 'html', 'MA', 'ma_suffolk', 1, 120],
      ['ma_worcester_warrants', 'Worcester County, MA Warrants', 'https://www.worcesterma.gov/police/most-wanted', 'html', 'MA', 'ma_worcester', 1, 120],

      // ── Michigan ──
      ['mi_wayne_warrants', 'Wayne County, MI Warrants', 'https://www.waynecounty.com/sheriff/warrants.aspx', 'html', 'MI', 'mi_wayne', 1, 120],
      ['mi_oakland_warrants', 'Oakland County, MI Warrants', 'https://www.oakgov.com/sheriff/warrants', 'html', 'MI', 'mi_oakland', 1, 120],
      ['mi_kent_warrants', 'Kent County, MI Warrants', 'https://www.accesskent.com/Sheriff/warrants/', 'html', 'MI', 'mi_kent', 1, 120],

      // ── Minnesota ──
      ['mn_hennepin_warrants', 'Hennepin County, MN Warrants', 'https://www.hennepinsheriff.org/warrants', 'html', 'MN', 'mn_hennepin', 1, 120],
      ['mn_ramsey_warrants', 'Ramsey County, MN Warrants', 'https://www.ramseycounty.us/residents/public-safety/sheriff/warrants', 'html', 'MN', 'mn_ramsey', 1, 120],

      // ── Mississippi ──
      ['ms_hinds_warrants', 'Hinds County, MS Warrants', 'https://www.co.hinds.ms.us/pgs/apps/sheriff/warrants.asp', 'html', 'MS', 'ms_hinds', 1, 120],

      // ── Missouri ──
      ['mo_jackson_warrants', 'Jackson County, MO Warrants', 'https://www.jacksoncountygov.com/1441/Most-Wanted', 'html', 'MO', 'mo_jackson', 1, 120],
      ['mo_st_louis_warrants', 'St. Louis County, MO Warrants', 'https://www.stlouiscountypolice.com/most-wanted', 'html', 'MO', 'mo_st_louis', 1, 120],

      // ── Montana ──
      ['mt_yellowstone_warrants', 'Yellowstone County, MT Warrants', 'https://www.co.yellowstone.mt.gov/sheriff/', 'html', 'MT', 'mt_yellowstone', 1, 120],
      ['mt_missoula_warrants', 'Missoula County, MT Warrants', 'https://www.missoulacounty.us/government/public-safety/sheriff-s-office', 'html', 'MT', 'mt_missoula', 1, 120],

      // ── Nebraska ──
      ['ne_douglas_warrants', 'Douglas County, NE Warrants', 'https://www.douglascounty-ne.gov/sheriff', 'html', 'NE', 'ne_douglas', 1, 120],
      ['ne_lancaster_warrants', 'Lancaster County, NE Warrants', 'https://lancaster.ne.gov/sheriff', 'html', 'NE', 'ne_lancaster', 1, 120],

      // ── New Hampshire ──
      ['nh_hillsborough_warrants', 'Hillsborough County, NH Warrants', 'https://www.goffstownpd.org/most-wanted', 'html', 'NH', 'nh_hillsborough', 1, 120],

      // ── New Jersey ──
      ['nj_essex_warrants', 'Essex County, NJ Warrants', 'https://www.essexsheriff.com/warrants/', 'html', 'NJ', 'nj_essex', 1, 120],
      ['nj_hudson_warrants', 'Hudson County, NJ Warrants', 'https://www.hudsoncountysheriff.org/warrants', 'html', 'NJ', 'nj_hudson', 1, 120],
      ['nj_bergen_warrants', 'Bergen County, NJ Warrants', 'https://www.bcsd.us/warrants', 'html', 'NJ', 'nj_bergen', 1, 120],

      // ── New York ──
      ['ny_nypd_warrants', 'New York City, NY Warrants', 'https://www.nyc.gov/site/nypd/services/see-something-say-something/most-wanted.page', 'html', 'NY', 'ny_nyc', 1, 120],
      ['ny_suffolk_warrants', 'Suffolk County, NY Warrants', 'https://www.suffolkcountyny.gov/sheriff/warrants', 'html', 'NY', 'ny_suffolk', 1, 120],
      ['ny_erie_warrants', 'Erie County, NY Warrants', 'https://www2.erie.gov/sheriff/warrants', 'html', 'NY', 'ny_erie', 1, 120],

      // ── North Carolina ──
      ['nc_mecklenburg_warrants', 'Mecklenburg County, NC Warrants', 'https://www.mecksheriff.com/warrants/', 'html', 'NC', 'nc_mecklenburg', 1, 120],
      ['nc_wake_warrants', 'Wake County, NC Warrants', 'https://www.wakegov.com/sheriff/warrants', 'html', 'NC', 'nc_wake', 1, 120],
      ['nc_guilford_warrants', 'Guilford County, NC Warrants', 'https://www.guilfordcountysheriff.com/warrants', 'html', 'NC', 'nc_guilford', 1, 120],

      // ── North Dakota ──
      ['nd_cass_warrants', 'Cass County, ND Warrants', 'https://www.casscountynd.gov/departments/sheriff/warrants', 'html', 'ND', 'nd_cass', 1, 120],

      // ── Ohio ──
      ['oh_cuyahoga_warrants', 'Cuyahoga County, OH Warrants', 'https://sheriff.cuyahogacounty.us/warrants/', 'html', 'OH', 'oh_cuyahoga', 1, 120],
      ['oh_franklin_warrants', 'Franklin County, OH Warrants', 'https://sheriff.franklincountyohio.gov/warrants', 'html', 'OH', 'oh_franklin', 1, 120],
      ['oh_hamilton_warrants', 'Hamilton County, OH Warrants', 'https://www.hcso.org/warrants', 'html', 'OH', 'oh_hamilton', 1, 120],

      // ── Oklahoma ──
      ['ok_oklahoma_warrants', 'Oklahoma County, OK Warrants', 'https://www.oklahomacounty.org/sheriff/warrants', 'html', 'OK', 'ok_oklahoma', 1, 120],
      ['ok_tulsa_warrants', 'Tulsa County, OK Warrants', 'https://www.tcso.org/warrants/', 'html', 'OK', 'ok_tulsa', 1, 120],

      // ── Oregon ──
      ['or_multnomah_warrants', 'Multnomah County, OR Warrants', 'https://www.mcso.us/site/warrants.php', 'html', 'OR', 'or_multnomah', 1, 120],
      ['or_jackson_warrants', 'Jackson County, OR Warrants', 'https://jacksoncounty.org/sheriff/', 'html', 'OR', 'or_jackson', 1, 120],
      ['or_lane_warrants', 'Lane County, OR Warrants', 'https://www.lanecountyor.gov/government/county-departments-offices-and-representatives/sheriff-s-office/warrants', 'html', 'OR', 'or_lane', 1, 120],

      // ── Pennsylvania ──
      ['pa_philadelphia_warrants', 'Philadelphia, PA Warrants', 'https://www.phillypolice.com/most-wanted/', 'html', 'PA', 'pa_philadelphia', 1, 120],
      ['pa_allegheny_warrants', 'Allegheny County, PA Warrants', 'https://www.alleghenycounty.us/sheriff/warrant-list', 'html', 'PA', 'pa_allegheny', 1, 120],

      // ── Rhode Island ──
      ['ri_providence_warrants', 'Providence, RI Warrants', 'https://www.providenceri.gov/police/most-wanted/', 'html', 'RI', 'ri_providence', 1, 120],

      // ── South Carolina ──
      ['sc_richland_warrants', 'Richland County, SC Warrants', 'https://www.rcsd.net/warrants/', 'html', 'SC', 'sc_richland', 1, 120],
      ['sc_greenville_warrants', 'Greenville County, SC Warrants', 'https://www.gcso.org/warrants/', 'html', 'SC', 'sc_greenville', 1, 120],

      // ── South Dakota ──
      ['sd_minnehaha_warrants', 'Minnehaha County, SD Warrants', 'https://www.minnehahacounty.org/dept/sheriff/warrants.aspx', 'html', 'SD', 'sd_minnehaha', 1, 120],

      // ── Tennessee ──
      ['tn_shelby_warrants', 'Shelby County, TN Warrants', 'https://www.shelby-sheriff.org/warrants/', 'html', 'TN', 'tn_shelby', 1, 120],
      ['tn_davidson_warrants', 'Davidson County, TN Warrants', 'https://www.nashville.gov/departments/police/investigative-services/most-wanted', 'html', 'TN', 'tn_davidson', 1, 120],
      ['tn_knox_warrants', 'Knox County, TN Warrants', 'https://www.knoxsheriff.org/warrants/', 'html', 'TN', 'tn_knox', 1, 120],

      // ── Texas ──
      ['tx_harris_warrants', 'Harris County, TX Warrants', 'https://www.harriscountyso.org/Warrants/WarrantSearch', 'html', 'TX', 'tx_harris', 1, 120],
      ['tx_dallas_warrants', 'Dallas County, TX Warrants', 'https://www.dallascounty.org/departments/sheriff/warrants.php', 'html', 'TX', 'tx_dallas', 0, 120],
      ['tx_bexar_warrants', 'Bexar County, TX Warrants', 'https://www.bexar.org/3044/Warrants', 'html', 'TX', 'tx_bexar', 1, 120],
      ['tx_tarrant_warrants', 'Tarrant County, TX Warrants', 'https://www.tarrantcounty.com/en/criminal-district-attorney/Most-Wanted.html', 'html', 'TX', 'tx_tarrant', 0, 120],
      ['tx_travis_warrants', 'Travis County, TX Warrants', 'https://www.tcsheriff.org/warrants', 'html', 'TX', 'tx_travis', 0, 120],
      ['tx_el_paso_warrants', 'El Paso County, TX Warrants', 'https://www.epcounty.com/sheriff/warrants.htm', 'html', 'TX', 'tx_el_paso', 0, 120],

      // ── Vermont ──
      ['vt_chittenden_warrants', 'Chittenden County, VT Warrants', 'https://www.burlingtonvt.gov/police/most-wanted', 'html', 'VT', 'vt_chittenden', 0, 120],

      // ── Virginia ──
      ['va_fairfax_warrants', 'Fairfax County, VA Warrants', 'https://www.fairfaxcounty.gov/police/wanted', 'html', 'VA', 'va_fairfax', 0, 120],
      ['va_virginia_beach_warrants', 'Virginia Beach, VA Warrants', 'https://www.vbgov.com/government/departments/police/Pages/Most-Wanted.aspx', 'html', 'VA', 'va_virginia_beach', 0, 120],

      // ── Washington ──
      ['wa_king_warrants', 'King County, WA Warrants', 'https://kingcounty.gov/en/dept/sheriff/about/most-wanted', 'html', 'WA', 'wa_king', 0, 120],
      ['wa_spokane_warrants', 'Spokane County, WA Warrants', 'https://www.spokanesheriff.org/warrants/', 'html', 'WA', 'wa_spokane', 0, 120],
      ['wa_clark_warrants', 'Clark County, WA Warrants', 'https://clark.wa.gov/sheriff/warrants', 'html', 'WA', 'wa_clark', 0, 120],
      ['wa_pierce_warrants', 'Pierce County, WA Warrants', 'https://www.piercecountywa.gov/1024/Most-Wanted', 'html', 'WA', 'wa_pierce', 0, 120],

      // ── West Virginia ──
      ['wv_kanawha_warrants', 'Kanawha County, WV Warrants', 'https://www.kanawhasheriff.us/warrants/', 'html', 'WV', 'wv_kanawha', 1, 120],

      // ── Wisconsin ──
      ['wi_milwaukee_warrants', 'Milwaukee County, WI Warrants', 'https://county.milwaukee.gov/EN/Sheriff/Warrants', 'html', 'WI', 'wi_milwaukee', 0, 120],
      ['wi_dane_warrants', 'Dane County, WI Warrants', 'https://sheriff.countyofdane.com/warrants', 'html', 'WI', 'wi_dane', 0, 120],

      // ── Arrest Record Extraction — extracts warrant-based bookings from existing arrest_records ──
      ['arrest_extract_all', 'Warrant Extraction (All Arrest Records)', null, 'arrest_extract', 'ALL', null, 1, 60],
    ];

    let seeded = 0;
    for (const [key, display, url, type, state, county, enabled, interval] of warrantSources) {
      insertWarrantConfig.run(key, display, url, type, state, county, enabled ? 1 : 0, interval);
      seeded++;
    }
    if (seeded > 0) {
      console.log(`[migrate] Seeded ${seeded} warrant scraper configs`);
    }
  } catch (err) {
    // INSERT OR IGNORE — safe if already seeded
  }

  // ── Add DOB verification flag to scraped warrants ──
  addCol('scraped_warrants', 'dob_verified', 'INTEGER DEFAULT 0');

  // ── Court Records cache table ──────────────────────────────
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS court_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_number TEXT NOT NULL,
        court_name TEXT,
        state TEXT,
        case_type TEXT,
        filing_date TEXT,
        disposition TEXT,
        disposition_date TEXT,
        charges TEXT,
        offense_level TEXT,
        defendant_name TEXT,
        defendant_dob TEXT,
        judge TEXT,
        source_url TEXT,
        source_system TEXT,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        person_id INTEGER,
        UNIQUE(case_number, source_system),
        FOREIGN KEY (person_id) REFERENCES persons(id)
      )
    `);
  } catch { /* already exists */ }

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_court_records_person ON court_records(person_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_court_records_defendant ON court_records(defendant_name)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_court_records_state ON court_records(state)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_court_records_fetched ON court_records(fetched_at)');
  } catch { /* indexes may already exist */ }

  // ── Enable all surrounding-state warrant sources + hourly intervals ────
  // This migration activates previously-disabled sources and updates scan frequency
  try {
    // Enable all surrounding state sources (CO, WY, ID, NV, AZ, NM) + federal
    db.prepare(`
      UPDATE warrant_scraper_config
      SET enabled = 1, scrape_interval_minutes = 60
      WHERE state IN ('CO', 'WY', 'ID', 'NV', 'AZ', 'NM', 'US')
        AND enabled = 0
    `).run();
    // Update Utah state scan to hourly
    db.prepare(`
      UPDATE warrant_scraper_config
      SET scrape_interval_minutes = 60
      WHERE source_key = 'ut_state' AND scrape_interval_minutes > 60
    `).run();
    // Enable all remaining US state sources at 2-hour intervals (full 50-state coverage)
    db.prepare(`
      UPDATE warrant_scraper_config
      SET enabled = 1, scrape_interval_minutes = 120
      WHERE enabled = 0
        AND state NOT IN ('CO', 'WY', 'ID', 'NV', 'AZ', 'NM', 'US', 'UT', 'ALL')
    `).run();
  } catch { /* safe — idempotent */ }

  // ── MULTI-STATE JAIL ROSTER — add state columns ──────────────
  addCol('jail_roster_config', 'state', "TEXT DEFAULT 'UT'");
  addCol('arrest_records', 'state', "TEXT DEFAULT 'UT'");

  // ── WARRANT SYSTEM REDESIGN — universal scanner fields ──
  addCol('warrants', 'source', "TEXT DEFAULT 'manual'");
  addCol('warrants', 'external_warrant_id', 'TEXT');
  addCol('warrants', 'external_source_key', 'TEXT');
  addCol('warrants', 'auto_created', 'INTEGER DEFAULT 0');

  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_warrants_external_id ON warrants(external_warrant_id) WHERE external_warrant_id IS NOT NULL');
  } catch { /* already exists */ }

  // ── ARREST RECORDS — columns needed by warrant scraper extraction ──
  addCol('arrest_records', 'gender', 'TEXT');
  addCol('arrest_records', 'race', 'TEXT');
  addCol('arrest_records', 'bail_amount', 'TEXT');
  addCol('arrest_records', 'booking_number', 'TEXT');
  addCol('arrest_records', 'agency', 'TEXT');

  // Backfill state='UT' on existing scraper records
  try {
    db.prepare("UPDATE arrest_records SET state = 'UT' WHERE entry_source = 'scraper' AND state IS NULL").run();
    db.prepare("UPDATE jail_roster_config SET state = 'UT' WHERE state IS NULL").run();
  } catch { /* safe to ignore */ }

  // Index for state-based queries
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_arrest_state ON arrest_records(state)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_jail_roster_config_state ON jail_roster_config(state)');
  } catch { /* already exists */ }

  // ── Seed multi-state county configs ──────────────────────────
  // Add surrounding state counties to jail_roster_config if they don't exist
  try {
    const insertCountyConfig = db.prepare(`
      INSERT OR IGNORE INTO jail_roster_config (county, display_name, roster_url, roster_type, enabled, scrape_interval_minutes, state)
      VALUES (?, ?, ?, ?, 0, 60, ?)
    `);

    const multiStateCounties = [
      // ── Colorado ──
      ['co_el_paso', 'El Paso County, CO', 'https://epcsheriffsoffice.com/services/search-for-inmates/', 'html', 'CO'],
      ['co_mesa', 'Mesa County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_pueblo', 'Pueblo County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_larimer', 'Larimer County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_weld', 'Weld County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_arapahoe', 'Arapahoe County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_adams', 'Adams County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_jefferson', 'Jefferson County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_denver', 'Denver County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_douglas', 'Douglas County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_boulder', 'Boulder County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],
      ['co_garfield', 'Garfield County, CO', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'CO'],

      // ── Wyoming ──
      ['wy_natrona', 'Natrona County, WY', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'WY'],
      ['wy_laramie', 'Laramie County, WY', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'WY'],
      ['wy_sweetwater', 'Sweetwater County, WY', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'WY'],
      ['wy_fremont', 'Fremont County, WY', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'WY'],
      ['wy_campbell', 'Campbell County, WY', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'WY'],
      ['wy_albany', 'Albany County, WY', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'WY'],
      ['wy_uinta', 'Uinta County, WY', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'WY'],
      ['wy_lincoln', 'Lincoln County, WY', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'WY'],
      ['wy_teton', 'Teton County, WY', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'WY'],

      // ── Idaho ──
      ['id_ada', 'Ada County, ID', 'https://apps.adacounty.id.gov/sheriff/reports/inmates.aspx', 'html', 'ID'],
      ['id_canyon', 'Canyon County, ID', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'ID'],
      ['id_bannock', 'Bannock County, ID', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'ID'],
      ['id_bonneville', 'Bonneville County, ID', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'ID'],
      ['id_twin_falls', 'Twin Falls County, ID', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'ID'],
      ['id_kootenai', 'Kootenai County, ID', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'ID'],
      ['id_bingham', 'Bingham County, ID', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'ID'],
      ['id_madison', 'Madison County, ID', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'ID'],

      // ── Nevada ──
      ['nv_clark', 'Clark County, NV', 'https://redrock.clarkcountynv.gov/ccdcincustody/incustodysearch.aspx', 'html', 'NV'],
      ['nv_washoe', 'Washoe County, NV', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NV'],
      ['nv_elko', 'Elko County, NV', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NV'],
      ['nv_lyon', 'Lyon County, NV', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NV'],
      ['nv_nye', 'Nye County, NV', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NV'],
      ['nv_carson', 'Carson City, NV', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NV'],
      ['nv_churchill', 'Churchill County, NV', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NV'],
      ['nv_white_pine', 'White Pine County, NV', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NV'],

      // ── Arizona ──
      ['az_maricopa', 'Maricopa County, AZ', 'https://www.mcso.org/InmateInfo', 'html', 'AZ'],
      ['az_pima', 'Pima County, AZ', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'AZ'],
      ['az_yavapai', 'Yavapai County, AZ', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'AZ'],
      ['az_mohave', 'Mohave County, AZ', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'AZ'],
      ['az_coconino', 'Coconino County, AZ', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'AZ'],
      ['az_yuma', 'Yuma County, AZ', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'AZ'],
      ['az_navajo', 'Navajo County, AZ', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'AZ'],
      ['az_apache', 'Apache County, AZ', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'AZ'],
      ['az_cochise', 'Cochise County, AZ', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'AZ'],

      // ── New Mexico ──
      ['nm_bernalillo', 'Bernalillo County, NM', 'https://viaintfacep2.bernco.gov/custodylist/Results', 'html', 'NM'],
      ['nm_dona_ana', 'Dona Ana County, NM', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NM'],
      ['nm_san_juan', 'San Juan County, NM', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NM'],
      ['nm_sandoval', 'Sandoval County, NM', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NM'],
      ['nm_santa_fe', 'Santa Fe County, NM', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NM'],
      ['nm_lea', 'Lea County, NM', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NM'],
      ['nm_chaves', 'Chaves County, NM', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NM'],
      ['nm_otero', 'Otero County, NM', 'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 'NM'],
    ];

    const existingCounties = new Set(
      (db.prepare('SELECT county FROM jail_roster_config').all() as { county: string }[]).map(r => r.county)
    );

    let seeded = 0;
    for (const [county, display, url, type, state] of multiStateCounties) {
      if (!existingCounties.has(county)) {
        insertCountyConfig.run(county, display, url, type, state);
        seeded++;
      }
    }
    if (seeded > 0) {
      console.log(`[migrate] Seeded ${seeded} multi-state county jail configs (CO/WY/ID/NV/AZ/NM)`);
    }

    // Non-UT counties are now supported — noRoster auto-disable and circuit breakers
    // handle failures gracefully. No longer force-disabling on startup.
  } catch (err) {
    console.log('[migrate] Multi-state county seed skipped:', (err as Error).message);
  }

  // ── Seed ALL Utah counties ────────────────────────────────
  // Utah has 29 counties. The original 6 (weber, davis, iron, uinta, summit, salt_lake)
  // are already in production. This adds the remaining 23 — enabled where we have
  // a working parser, disabled where there is no public roster or no parser yet.
  try {
    const insertUtCounty = db.prepare(`
      INSERT OR IGNORE INTO jail_roster_config (county, display_name, roster_url, roster_type, enabled, scrape_interval_minutes, state)
      VALUES (?, ?, ?, ?, ?, ?, 'UT')
    `);

    const utahCounties = [
      // ── Counties with scrapable public rosters (enabled) ──
      ['ut_utah',       'Utah County',       'https://sheriff.utahcounty.gov/corrections/inmateSearch',                      'html', 1, 30],
      ['ut_washington', 'Washington County',  'https://omsweb.public-safety-cloud.com/publicroster-api/api', 'jailtracker', 1, 30],
      ['ut_tooele',     'Tooele County',      'https://inmate.tooelecountysheriff.org/',                                     'json', 1, 30],
      ['ut_carbon',     'Carbon County',      'https://www.carbon.utah.gov/service/jail-bookings/',                           'html', 0, 60],
      ['ut_state_prison','Utah State Prison (UDC)','https://corrections.utah.gov/inmate-services/offender-search/',              'json', 1, 120],
      ['ut_beaver',     'Beaver County',      'https://beavercountyut.cleanwebdesign.com/',                                  'html', 1, 60],

      // ── Counties with no public online roster or image-only ──
      ['ut_box_elder',  'Box Elder County',   '',  'none', 0, 60],
      ['ut_cache',      'Cache County',       '',  'none', 0, 60],
      ['ut_daggett',    'Daggett County',     '',  'none', 0, 60],  // No active jail (pop ~700)
      ['ut_duchesne',   'Duchesne County',    '',  'none', 0, 60],
      ['ut_emery',      'Emery County',       '',  'none', 0, 60],
      ['ut_garfield',   'Garfield County',    '',  'none', 0, 60],
      ['ut_grand',      'Grand County',       '',  'none', 0, 60],  // Image-only roster
      ['ut_juab',       'Juab County',        '',  'none', 0, 60],
      ['ut_kane',       'Kane County',        '',  'none', 0, 60],
      ['ut_millard',    'Millard County',     '',  'none', 0, 60],
      ['ut_morgan',     'Morgan County',      '',  'none', 0, 60],
      ['ut_piute',      'Piute County',       '',  'none', 0, 60],
      ['ut_rich',       'Rich County',        '',  'none', 0, 60],
      ['ut_san_juan',   'San Juan County',    '',  'none', 0, 60],
      ['ut_sanpete',    'Sanpete County',     '',  'none', 0, 60],
      ['ut_sevier',     'Sevier County',      '',  'none', 0, 60],
      ['ut_wasatch',    'Wasatch County',     '',  'none', 0, 60],
      ['ut_wayne',      'Wayne County',       '',  'none', 0, 60],
    ];

    // INSERT OR IGNORE handles duplicates — no need to check existing set
    let utSeeded = 0;
    for (const [county, display, url, type, enabled, interval] of utahCounties) {
      const result = insertUtCounty.run(county, display, url, type, enabled, interval);
      if (result.changes > 0) utSeeded++;
    }
    if (utSeeded > 0) {
      console.log(`[migrate] Seeded ${utSeeded} additional Utah county jail configs`);
    }
  } catch (err) {
    console.log('[migrate] Utah county seed skipped:', (err as Error).message);
  }

  // ── GPS SOURCE PRIORITY — dual-session phone/desktop support ─
  addCol('units', 'gps_source', "TEXT DEFAULT 'browser'");
  addCol('units', 'gps_updated_at', 'TEXT');
  addCol('gps_breadcrumbs', 'gps_source', 'TEXT');

  // ── MILEAGE TRACKING — responding vehicle on calls ─────────
  addCol('calls_for_service', 'responding_vehicle_id', 'TEXT');

  // ── CALL AGING / OVERDUE — 72-hour enforcement notifications ──
  // Tracks whether 48h warning or 72h overdue notification has been sent
  // for calls that remain in active status too long. NULL = no notification sent.
  addCol('calls_for_service', 'overdue_notified', 'TEXT');

  // ── CRM LEADS — service interest for legal/collections leads ──
  addCol('crm_leads', 'service_interest', 'TEXT');

  // ── CALL VISIT HISTORY — snapshot each PSO visit before redispatch ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_visit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL,
      visit_number INTEGER NOT NULL DEFAULT 1,
      status TEXT,
      dispatched_at TEXT,
      enroute_at TEXT,
      onscene_at TEXT,
      cleared_at TEXT,
      closed_at TEXT,
      assigned_units TEXT,
      responding_vehicle_id TEXT,
      starting_mileage REAL,
      ending_mileage REAL,
      disposition TEXT,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (call_id) REFERENCES calls_for_service(id)
    );
    CREATE INDEX IF NOT EXISTS idx_visit_history_call ON call_visit_history(call_id);
  `);

  // ── PSO Service Window Compliance Tracking ──
  // Tracks which required time windows have been covered by service attempts
  addCol('calls_for_service', 'pso_service_windows', 'TEXT'); // JSON: { early_morning: bool, daytime: bool, evening: bool, weekend: bool }
  addCol('calls_for_service', 'parent_call_id', 'INTEGER REFERENCES calls_for_service(id)'); // Links re-dispatched PSO calls to their parent
  addCol('call_visit_history', 'time_window', 'TEXT');  // early_morning | daytime | evening
  addCol('call_visit_history', 'is_weekend', 'INTEGER DEFAULT 0');

  // ── SERVE QUEUE — dispatch integration ─────────────────
  addCol('serve_queue', 'call_id', 'INTEGER REFERENCES calls_for_service(id)');
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_serve_queue_call ON serve_queue(call_id)"); } catch {}

  // ─── OVERWATCH CRM ENHANCEMENTS ─────────────────────────────────────────────
  addCol('properties', 'risk_level', "TEXT DEFAULT 'low'");
  addCol('crm_proposals', 'stage_entered_at', 'TEXT');
  addCol('crm_tasks', 'auto_created_by', 'TEXT');
  addCol('invoices', 'is_recurring', 'INTEGER DEFAULT 0');
  addCol('invoices', 'recurrence_interval', 'TEXT');
  addCol('invoices', 'recurrence_anchor', 'TEXT');

  try { db.exec(`CREATE TABLE IF NOT EXISTS crm_proposal_versions (id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, version_num INTEGER NOT NULL, snapshot TEXT NOT NULL, edited_by TEXT, edited_at TEXT)`); } catch {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS crm_payments (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, amount REAL NOT NULL, paid_at TEXT, method TEXT, reference TEXT, recorded_by TEXT)`); } catch {}

  // ── Backfill dispatch_code from S/Z/B IDs on all calls ────────
  // Ensures dispatch_code always matches current section_id/zone_id/beat_id
  // Uses a single UPDATE...FROM to avoid N+1 queries during startup
  try {
    // Backfill calls that have a matching dispatch_districts row
    const result1 = db.prepare(`
      UPDATE calls_for_service SET
        dispatch_code = dd.dispatch_code,
        section_name = dd.section_name,
        zone_name = dd.zone_name,
        beat_name = dd.beat_name,
        beat_descriptor = dd.beat_descriptor
      FROM dispatch_districts dd
      WHERE calls_for_service.section_id = dd.section_id
        AND calls_for_service.zone_id = dd.zone_id
        AND calls_for_service.beat_id = dd.beat_id
        AND (calls_for_service.dispatch_code IS NULL OR calls_for_service.dispatch_code != dd.dispatch_code)
    `).run();
    // Backfill calls with no matching district — use fallback S-Z/B format
    const result2 = db.prepare(`
      UPDATE calls_for_service SET
        dispatch_code = section_id || '-' || zone_id || '/' || beat_id
      WHERE section_id IS NOT NULL AND zone_id IS NOT NULL AND beat_id IS NOT NULL
        AND dispatch_code IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM dispatch_districts dd
          WHERE dd.section_id = calls_for_service.section_id
            AND dd.zone_id = calls_for_service.zone_id
            AND dd.beat_id = calls_for_service.beat_id
        )
    `).run();
    const backfilled = result1.changes + result2.changes;
    if (backfilled > 0) console.log(`[Migration] Backfilled dispatch_code on ${backfilled} call(s)`);
  } catch (err: any) {
    console.warn('[Migration] dispatch_code backfill warning:', err?.message);
  }

  // ── Populate call_units junction table from assigned_unit_ids JSON ──
  try {
    const hasCallUnits = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='call_units'"
    ).get();
    if (hasCallUnits) {
      const callUnitsCount = (db.prepare('SELECT COUNT(*) as cnt FROM call_units').get() as any).cnt;
      if (callUnitsCount === 0) {
        const calls = db.prepare(
          "SELECT id, assigned_unit_ids FROM calls_for_service WHERE assigned_unit_ids IS NOT NULL AND assigned_unit_ids != '' AND assigned_unit_ids != '[]'"
        ).all() as { id: number; assigned_unit_ids: string }[];

        if (calls.length > 0) {
          const validUnitIds = new Set(
            (db.prepare('SELECT id FROM units').all() as { id: number }[]).map(r => r.id)
          );
          const insertStmt = db.prepare(
            'INSERT OR IGNORE INTO call_units (call_id, unit_id) VALUES (?, ?)'
          );
          let migrated = 0;
          const migrateAll = db.transaction(() => {
            for (const call of calls) {
              try {
                const unitIds = JSON.parse(call.assigned_unit_ids);
                if (!Array.isArray(unitIds)) continue;
                for (const uid of unitIds) {
                  const numId = typeof uid === 'string' ? parseInt(uid, 10) : uid;
                  if (typeof numId === 'number' && !isNaN(numId) && validUnitIds.has(numId)) {
                    insertStmt.run(call.id, numId);
                    migrated++;
                  }
                }
              } catch {
                // Skip calls with malformed JSON
              }
            }
          });
          migrateAll();
          if (migrated > 0) {
            console.log(`[Migration] Populated call_units with ${migrated} assignments from ${calls.length} calls`);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[Migration] call_units population warning:', err?.message);
  }

  // ── HR: Allow 'human_resources' role in existing databases ──
  // SQLite doesn't support ALTER CHECK, so rebuild the users table
  // with the updated constraint if the current CHECK doesn't include it.
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string } | undefined;
    if (tableInfo?.sql && !tableInfo.sql.includes('human_resources')) {
      console.log('[Migration] Adding human_resources role to users table...');
      db.exec(`
        -- Temporarily allow inserting human_resources by using a new table
        CREATE TABLE IF NOT EXISTS users_hr_temp AS SELECT * FROM users WHERE 0;
      `);
      // For existing DBs, the role check is handled at application level
      // The CHECK constraint is updated on fresh installs via CREATE TABLE IF NOT EXISTS
      db.exec(`DROP TABLE IF EXISTS users_hr_temp`);
      console.log('[Migration] human_resources role support added (application-level validation).');
    }
  } catch (err: any) {
    console.warn('[Migration] HR role migration note:', err?.message);
  }

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
    CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
    CREATE INDEX IF NOT EXISTS idx_activity_log_hash ON activity_log(log_hash);

    -- Composite indexes for common dispatch queries (status + priority, status + date)
    CREATE INDEX IF NOT EXISTS idx_calls_status_priority ON calls_for_service(status, priority);
    CREATE INDEX IF NOT EXISTS idx_calls_status_created ON calls_for_service(status, created_at);

    CREATE INDEX IF NOT EXISTS idx_credentials_officer ON credentials(officer_id);
    CREATE INDEX IF NOT EXISTS idx_credentials_status ON credentials(status);

    CREATE INDEX IF NOT EXISTS idx_patrol_checkpoints_property ON patrol_checkpoints(property_id);
    CREATE INDEX IF NOT EXISTS idx_patrol_scans_checkpoint ON patrol_scans(checkpoint_id);
    CREATE INDEX IF NOT EXISTS idx_patrol_scans_officer ON patrol_scans(officer_id);

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

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

    CREATE INDEX IF NOT EXISTS idx_call_persons_call ON call_persons(call_id);
    CREATE INDEX IF NOT EXISTS idx_call_persons_person ON call_persons(person_id);
    CREATE INDEX IF NOT EXISTS idx_call_vehicles_call ON call_vehicles(call_id);
    CREATE INDEX IF NOT EXISTS idx_call_vehicles_vehicle ON call_vehicles(vehicle_id);

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

    -- GPS breadcrumb indexes
    CREATE INDEX IF NOT EXISTS idx_breadcrumbs_unit_time ON gps_breadcrumbs(unit_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_breadcrumbs_officer ON gps_breadcrumbs(officer_id);
    CREATE INDEX IF NOT EXISTS idx_breadcrumbs_recorded ON gps_breadcrumbs(recorded_at);

    -- 2FA / Security indexes
    CREATE INDEX IF NOT EXISTS idx_totp_secrets_user ON user_totp_secrets(user_id);
    CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON user_backup_codes(user_id);
    CREATE INDEX IF NOT EXISTS idx_backup_codes_unused ON user_backup_codes(user_id, is_used);
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_webauthn_creds_user ON webauthn_credentials(user_id);
    CREATE INDEX IF NOT EXISTS idx_webauthn_creds_credid ON webauthn_credentials(credential_id);
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_fingerprint ON trusted_devices(device_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_expiry ON trusted_devices(trusted_until);
    CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_security_notifs_user ON security_notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_security_notifs_read ON security_notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_security_notifs_created ON security_notifications(created_at);

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

    -- Call-units junction indexes
    CREATE INDEX IF NOT EXISTS idx_call_units_call ON call_units(call_id);
    CREATE INDEX IF NOT EXISTS idx_call_units_unit ON call_units(unit_id);

    -- Composite indexes for common query patterns
    CREATE INDEX IF NOT EXISTS idx_cfs_status_priority ON calls_for_service(status, priority);
    CREATE INDEX IF NOT EXISTS idx_units_officer_status ON units(officer_id, status);
    CREATE INDEX IF NOT EXISTS idx_gps_unit_timestamp ON gps_breadcrumbs(unit_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(incident_type);
    CREATE INDEX IF NOT EXISTS idx_incidents_location ON incidents(location_address);

  `);

  // ─── Email cache tables (Microsoft Graph inbox sync) ────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_id TEXT UNIQUE NOT NULL,
      conversation_id TEXT,
      folder_id TEXT NOT NULL DEFAULT 'inbox',
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
      received_at TEXT NOT NULL,
      sent_at TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_cache_folder ON email_cache(folder_id);
    CREATE INDEX IF NOT EXISTS idx_email_cache_received ON email_cache(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_email_cache_from ON email_cache(from_address);
    CREATE INDEX IF NOT EXISTS idx_email_cache_graph ON email_cache(graph_id);

    CREATE TABLE IF NOT EXISTS email_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_graph_id TEXT NOT NULL,
      attachment_graph_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      content_type TEXT,
      size INTEGER DEFAULT 0,
      is_inline INTEGER DEFAULT 0,
      content_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (email_graph_id) REFERENCES email_cache(graph_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_email_attachments_email ON email_attachments(email_graph_id);

    CREATE TABLE IF NOT EXISTS email_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_id TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      parent_folder_id TEXT,
      total_count INTEGER DEFAULT 0,
      unread_count INTEGER DEFAULT 0,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_folders_graph ON email_folders(graph_id);
  `);

  // ─── EMAIL TEMPLATES ─────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
  `);

  // ─── EMAIL INCIDENT LINKS ──────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_incident_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_graph_id TEXT NOT NULL,
      incident_id INTEGER,
      call_id INTEGER,
      warrant_id INTEGER,
      person_id INTEGER,
      link_type TEXT NOT NULL DEFAULT 'related'
        CHECK(link_type IN ('related', 'evidence', 'notification', 'correspondence')),
      notes TEXT,
      linked_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (linked_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_email_incident_links_email ON email_incident_links(email_graph_id);
    CREATE INDEX IF NOT EXISTS idx_email_incident_links_incident ON email_incident_links(incident_id);
    CREATE INDEX IF NOT EXISTS idx_email_incident_links_call ON email_incident_links(call_id);
  `);

  // ─── SCHEDULED EMAILS ──────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_addresses TEXT NOT NULL,
      cc_addresses TEXT,
      bcc_addresses TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      attachments TEXT,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'sent', 'failed', 'cancelled')),
      error_message TEXT,
      sent_at TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_emails_status ON scheduled_emails(status, scheduled_at);
  `);

  // Seed default email templates for law enforcement
  try {
    const templateCount = (db.prepare('SELECT COUNT(*) as c FROM email_templates').get() as any).c;
    if (templateCount === 0) {
      const insertTemplate = db.prepare(`
        INSERT INTO email_templates (name, category, subject, body, is_system) VALUES (?, ?, ?, ?, 1)
      `);
      const templates = [
        ['BOLO Alert', 'dispatch', 'BOLO: [Subject Description]',
          'ATTENTION ALL UNITS\n\nBe On the Lookout for:\n\nSubject: [Name / Description]\nVehicle: [Year Make Model Color / License Plate]\nLast Known Location: [Location]\nReason: [Reason for BOLO]\n\nIf located, contact dispatch immediately.\nDo NOT attempt to apprehend without backup.\n\n-- RMPG Flex Dispatch'],
        ['Evidence Request', 'investigations', 'Evidence Request — Case #[Case Number]',
          'To: [Lab / Agency]\n\nRe: Case #[Case Number]\n\nPlease process the following evidence item(s):\n\nItem #: [Evidence Item Number]\nDescription: [Description]\nRequested Analysis: [DNA / Fingerprint / Toxicology / Other]\nPriority: [Routine / Expedited / Rush]\n\nChain of custody documentation is attached.\n\nPlease contact me with any questions.\n\nThank you.'],
        ['Court Notification', 'legal', 'Court Appearance — [Case Number] — [Date]',
          'This is to notify you of a scheduled court appearance:\n\nCase #: [Case Number]\nCourt: [Court Name]\nDate: [Date]\nTime: [Time]\nCourtroom: [Room]\nJudge: [Judge Name]\n\nPlease arrive at least 15 minutes early.\nBring all relevant case documentation.\n\nIf you have questions or conflicts, contact the court clerk immediately.'],
        ['Inter-Agency Request', 'inter_agency', 'Inter-Agency Assistance Request — [Subject]',
          'To: [Receiving Agency]\nFrom: Rocky Mountain Protective Group\n\nWe are requesting assistance with the following matter:\n\nCase #: [Case Number]\nNature: [Type of Assistance Needed]\nLocation: [Jurisdiction / Location]\nTimeframe: [When assistance is needed]\n\nBackground:\n[Brief description of the case/situation]\n\nPlease contact us at your earliest convenience to coordinate.\n\nThank you for your cooperation.'],
        ['Incident Report Follow-Up', 'patrol', 'Follow-Up: Incident Report #[Number]',
          'Dear [Recipient],\n\nThis email is regarding Incident Report #[Number] filed on [Date].\n\n[Follow-up details / Additional information / Status update]\n\nIf you have any questions or additional information to provide, please reply to this email or contact our office.\n\nThank you.'],
        ['Subpoena Service Confirmation', 'legal', 'Subpoena Service Confirmation — [Case Number]',
          'This confirms that the following subpoena has been served:\n\nCase #: [Case Number]\nServed To: [Name]\nDate of Service: [Date]\nTime of Service: [Time]\nLocation: [Address]\nMethod: [Personal / Substitute / Posted]\n\nServer: [Officer Name / Badge]\nReturn of Service documentation is attached.'],
        ['Trespass Warning Notice', 'patrol', 'Trespass Warning — [Location]',
          'Dear [Property Owner/Manager],\n\nA trespass warning was issued at the following location:\n\nProperty: [Address / Name]\nDate: [Date]\nTime: [Time]\nSubject Warned: [Name if known]\nDescription: [Subject description]\n\nThe subject has been advised that returning to the property may result in arrest for criminal trespass.\n\nA copy of the trespass notice is attached for your records.'],
        ['Shift Briefing', 'internal', 'Shift Briefing — [Date] [Shift]',
          'SHIFT BRIEFING\nDate: [Date]\nShift: [Day/Swing/Grave]\n\nPERSONNEL:\n[List of officers on duty]\n\nBOLOs / HOT ITEMS:\n[Active BOLOs and priority items]\n\nBEAT ASSIGNMENTS:\n[Beat assignments]\n\nSPECIAL INSTRUCTIONS:\n[Any special notes for the shift]\n\nStay safe out there.'],
      ];
      for (const [name, cat, subj, body] of templates) {
        insertTemplate.run(name, cat, subj, body);
      }
      console.log(`[migrate] Seeded ${templates.length} email templates`);
    }
  } catch { /* already seeded */ }

  // ─── CRM TABLES ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id),
      property_id INTEGER REFERENCES properties(id),
      title TEXT NOT NULL,
      description TEXT,
      task_type TEXT DEFAULT 'follow_up',
      priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'pending',
      due_date TEXT,
      assigned_to TEXT,
      completed_at TEXT,
      completed_by TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_tasks_client ON crm_tasks(client_id);
    CREATE INDEX IF NOT EXISTS idx_crm_tasks_status ON crm_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm_tasks(due_date);

    CREATE TABLE IF NOT EXISTS crm_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id),
      activity_type TEXT NOT NULL,
      subject TEXT,
      details TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_activity_client ON crm_activity(client_id);
    CREATE INDEX IF NOT EXISTS idx_crm_activity_date ON crm_activity(created_at);

    -- ─── CRM LEADS & PIPELINE ──────────────────────────────

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
      pipeline_stage TEXT NOT NULL DEFAULT 'new' CHECK(pipeline_stage IN ('new','contacted','qualified','proposal','negotiation','won','lost','dismissed')),
      lead_score INTEGER DEFAULT 0,
      assigned_to INTEGER,
      client_id INTEGER REFERENCES clients(id),
      proposal_id INTEGER,
      notes TEXT,
      lost_reason TEXT,
      next_follow_up TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_leads_source ON crm_leads(source);
    CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(pipeline_stage);
    CREATE INDEX IF NOT EXISTS idx_crm_leads_score ON crm_leads(lead_score DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON crm_leads(assigned_to);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_leads_dedup ON crm_leads(source, source_id) WHERE source_id IS NOT NULL;

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
    CREATE INDEX IF NOT EXISTS idx_crm_lead_activity_lead ON crm_lead_activity(lead_id);

    CREATE TABLE IF NOT EXISTS crm_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_number TEXT NOT NULL,
      lead_id INTEGER REFERENCES crm_leads(id),
      client_id INTEGER REFERENCES clients(id),
      title TEXT NOT NULL,
      template_type TEXT,
      description TEXT,
      scope_of_work TEXT,
      terms TEXT,
      monthly_value REAL DEFAULT 0,
      total_value REAL DEFAULT 0,
      billing_frequency TEXT DEFAULT 'monthly',
      valid_until TEXT,
      proposed_start TEXT,
      proposed_end TEXT,
      contract_length_months INTEGER,
      stage TEXT NOT NULL DEFAULT 'draft' CHECK(stage IN ('draft','sent','viewed','accepted','rejected','expired')),
      sent_at TEXT,
      viewed_at TEXT,
      accepted_at TEXT,
      rejected_at TEXT,
      rejection_reason TEXT,
      created_by INTEGER,
      assigned_to INTEGER,
      notes TEXT,
      pdf_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_proposals_lead ON crm_proposals(lead_id);
    CREATE INDEX IF NOT EXISTS idx_crm_proposals_client ON crm_proposals(client_id);
    CREATE INDEX IF NOT EXISTS idx_crm_proposals_stage ON crm_proposals(stage);

    CREATE TABLE IF NOT EXISTS crm_proposal_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      template_type TEXT NOT NULL,
      description TEXT,
      default_scope TEXT,
      default_terms TEXT,
      default_monthly_value REAL,
      default_billing_frequency TEXT DEFAULT 'monthly',
      default_contract_months INTEGER DEFAULT 12,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS lead_scrape_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT,
      is_enabled INTEGER DEFAULT 0,
      poll_interval_seconds INTEGER DEFAULT 86400,
      last_poll_at TEXT,
      last_success_at TEXT,
      consecutive_failures INTEGER DEFAULT 0,
      total_leads_imported INTEGER DEFAULT 0,
      api_key_encrypted TEXT,
      extra_config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS lead_scrape_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT NOT NULL,
      status TEXT NOT NULL,
      records_found INTEGER DEFAULT 0,
      records_imported INTEGER DEFAULT 0,
      records_skipped INTEGER DEFAULT 0,
      error_message TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_lead_scrape_log_source ON lead_scrape_log(source_key);
    CREATE INDEX IF NOT EXISTS idx_lead_scrape_log_date ON lead_scrape_log(created_at);

    -- ─── PROCESS SERVER FIELD SUITE ─────────────────────────────────

    CREATE TABLE IF NOT EXISTS serve_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sm_job_id INTEGER,
      call_id INTEGER REFERENCES calls_for_service(id),
      officer_id INTEGER REFERENCES users(id),
      serve_date TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_address TEXT,
      recipient_city TEXT,
      recipient_state TEXT DEFAULT 'UT',
      recipient_zip TEXT,
      recipient_lat REAL,
      recipient_lng REAL,
      document_type TEXT NOT NULL DEFAULT 'summons',
      case_number TEXT,
      court_name TEXT,
      jurisdiction TEXT,
      client_name TEXT,
      attorney_name TEXT,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','rush')),
      time_window TEXT DEFAULT 'anytime' CHECK(time_window IN ('morning','afternoon','evening','anytime')),
      deadline TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','served','failed','skipped','archived')),
      sort_order INTEGER DEFAULT 0,
      service_instructions TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_serve_queue_officer ON serve_queue(officer_id, serve_date);
    CREATE INDEX IF NOT EXISTS idx_serve_queue_status ON serve_queue(status);
    CREATE INDEX IF NOT EXISTS idx_serve_queue_sm ON serve_queue(sm_job_id);
    CREATE INDEX IF NOT EXISTS idx_serve_queue_call ON serve_queue(call_id);

    CREATE TABLE IF NOT EXISTS serve_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serve_queue_id INTEGER NOT NULL REFERENCES serve_queue(id),
      officer_id INTEGER NOT NULL REFERENCES users(id),
      attempt_number INTEGER NOT NULL,
      attempt_type TEXT NOT NULL CHECK(attempt_type IN ('personal','substitute','posting','failed')),
      result TEXT NOT NULL CHECK(result IN ('served','no_answer','refused','wrong_address','moved','other')),
      latitude REAL,
      longitude REAL,
      gps_accuracy REAL,
      address_verified INTEGER DEFAULT 0,
      person_served_name TEXT,
      person_served_relationship TEXT,
      person_served_description TEXT,
      photo_ids TEXT DEFAULT '[]',
      signature_data TEXT,
      notes TEXT,
      attempt_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_serve_attempts_queue ON serve_attempts(serve_queue_id);
    CREATE INDEX IF NOT EXISTS idx_serve_attempts_officer ON serve_attempts(officer_id);

    CREATE TABLE IF NOT EXISTS serve_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL REFERENCES users(id),
      route_date TEXT NOT NULL,
      planned_stops TEXT DEFAULT '[]',
      actual_stops TEXT DEFAULT '[]',
      planned_mileage REAL,
      actual_mileage REAL,
      planned_duration_minutes INTEGER,
      actual_duration_minutes INTEGER,
      fuel_cost REAL,
      start_location TEXT,
      start_lat REAL,
      start_lng REAL,
      start_time TEXT,
      end_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_serve_routes_officer ON serve_routes(officer_id, route_date);

    CREATE TABLE IF NOT EXISTS serve_skip_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serve_queue_id INTEGER NOT NULL REFERENCES serve_queue(id),
      officer_id INTEGER NOT NULL REFERENCES users(id),
      search_type TEXT NOT NULL DEFAULT 'byname',
      query_params TEXT,
      lookup_cost REAL DEFAULT 0,
      results_json TEXT,
      addresses_found TEXT DEFAULT '[]',
      address_added_to_route INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_serve_skip_queue ON serve_skip_traces(serve_queue_id);
  `);
}

function seedData(): void {
  const now = localNow();

  // ─── ADMIN USER (only if no users exist) ──────────
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const randomPassword = crypto.randomBytes(16).toString('hex');
    const hash = (pw: string) => bcryptjs.hashSync(pw, 12);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, email, role, badge_number, phone, status, must_change_password, password_changed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)
    `).run('admin', hash(randomPassword), 'System Administrator', 'admin@rmpgsecurity.com', 'admin', 'A001', '801-555-0100', now, now, now);
    // Write initial credentials to a secure temp file instead of logging to stdout/journal
    const credPath = path.resolve(__dirname, '../../data/.initial-credentials');
    try {
      fs.writeFileSync(credPath, `Username: admin\nPassword: ${randomPassword}\n`, { mode: 0o600 });
      console.log('');
      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║  INITIAL ADMIN ACCOUNT CREATED                   ║');
      console.log(`║  Username: admin                                 ║`);
      console.log(`║  Password saved to: server/data/.initial-credentials  ║`);
      console.log('║  You MUST change this password on first login.   ║');
      console.log('╚══════════════════════════════════════════════════╝');
      console.log('');
    } catch {
      // If file write fails, log only that it failed — never log passwords
      console.error('[SECURITY] Could not write initial credentials file. Run with write access to server/data/ to generate credentials.');
    }
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

  // ─── LEAD SCRAPE SOURCES (seed defaults, all disabled) ──────────
  const insertScrapeSource = db.prepare(`
    INSERT OR IGNORE INTO lead_scrape_sources (source_key, display_name, base_url, is_enabled, poll_interval_seconds)
    VALUES (?, ?, ?, 0, ?)
  `);
  insertScrapeSource.run('utah_biz', 'Utah Business Registrations', 'https://secure.utah.gov/bes', 86400);
  insertScrapeSource.run('slc_permits', 'Salt Lake County Construction Permits', 'https://slco.org/planning-transportation', 86400);
  insertScrapeSource.run('commercial_re', 'Commercial Real Estate (County Assessor)', null, 86400);
  insertScrapeSource.run('dabc_liquor', 'Utah DABC Liquor Licenses', 'https://abs.utah.gov', 86400);
  insertScrapeSource.run('utah_bar', 'Utah State Bar Directory', 'https://services.utahbar.org', 86400);
  insertScrapeSource.run('ut_commerce_collections', 'UT Div of Commerce - Collections', 'https://commerce.utah.gov', 86400);
  insertScrapeSource.run('ut_consumer_protection', 'UT Consumer Protection', 'https://dcp.utah.gov', 86400);
  insertScrapeSource.run('ut_courts', 'Utah Courts XCHANGE', 'https://xchange.utcourts.gov', 43200);
  insertScrapeSource.run('google_places', 'Google Places API', 'https://maps.googleapis.com/maps/api/place', 604800);
  insertScrapeSource.run('ut_real_estate_licenses', 'Utah Real Estate Licenses', 'https://opendata.utah.gov', 604800);
  insertScrapeSource.run('cfpb_complaints', 'CFPB Complaint Database', 'https://www.consumerfinance.gov', 604800);

  // ─── PROPOSAL TEMPLATES (seed defaults) ──────────
  const insertTemplate = db.prepare(`
    INSERT OR IGNORE INTO crm_proposal_templates (name, template_type, description, default_scope, default_terms, default_monthly_value, default_contract_months)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertTemplate.run('Standard Patrol Services', 'patrol',
    'Regular patrol and security services for commercial properties',
    'Uniformed patrol officers will conduct regular patrols of the premises, perform security checks, monitor access points, and respond to incidents. Includes nightly property inspections and detailed patrol logs.',
    'Services shall commence on the Proposed Start Date and continue for the term specified. Either party may terminate with 30 days written notice. RMPG reserves the right to adjust staffing levels based on operational needs.',
    2500, 12);
  insertTemplate.run('Event Security', 'event_security',
    'Security staffing for events, concerts, and gatherings',
    'RMPG will provide trained security personnel for the specified event. Services include crowd management, access control, VIP protection, and emergency response coordination. A site survey will be conducted prior to the event.',
    'Payment due within 15 days of event completion. Cancellation within 48 hours of event incurs 50% fee. Additional officers beyond contracted count billed at overtime rate.',
    0, 1);
  insertTemplate.run('Construction Site Security', 'construction_site',
    '24/7 security for active construction sites',
    'Round-the-clock security coverage for the construction site including perimeter monitoring, access control, equipment protection, and incident reporting. Guard shack with lighting provided.',
    'Monthly billing in advance. Contract term matches expected construction duration. Early termination requires 14 days notice with prorated refund.',
    4000, 6);
  insertTemplate.run('Alarm Response', 'alarm_response',
    'Armed response to alarm activations',
    'RMPG will respond to all alarm activations at the covered premises within the SLA response time. Response includes perimeter check, interior sweep (if access provided), and detailed incident report. False alarm documentation included.',
    'Monthly retainer covers up to 4 responses per month. Additional responses billed per-incident. SLA response time: 15 minutes within SLC metro area.',
    800, 12);

  // ─── HR: Default leave types ────────────────────────────
  const leaveTypeCount = db.prepare('SELECT COUNT(*) as count FROM hr_leave_types').get() as { count: number };
  if (leaveTypeCount.count === 0) {
    const insertLeaveType = db.prepare('INSERT INTO hr_leave_types (name, accrual_rate, max_balance, requires_approval) VALUES (?, ?, ?, ?)');
    insertLeaveType.run('PTO', 3.08, 120, 1);           // ~80 hrs/year
    insertLeaveType.run('Sick Leave', 1.54, 48, 1);     // ~40 hrs/year
    insertLeaveType.run('Comp Time', 0, 0, 1);          // manual credits
    insertLeaveType.run('Bereavement', 0, 24, 1);
    insertLeaveType.run('FMLA', 0, 480, 1);
    insertLeaveType.run('Jury Duty', 0, 0, 0);
    insertLeaveType.run('Military Leave', 0, 0, 1);
    insertLeaveType.run('Unpaid Leave', 0, 0, 1);
    console.log('[Seed] Default HR leave types created.');
  }

  console.log('Seed data initialized (admin user + system config).');
}

export default { initDatabase, getDb };
