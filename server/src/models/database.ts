import Database from 'better-sqlite3';
import bcryptjs from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { migrateIncidentNumbers } from '../utils/caseNumbers';
import { localNow } from '../utils/timeUtils';
import { seedUtahStatutes } from '../seeds/utahStatutes';

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
      source TEXT DEFAULT 'phone' CHECK(source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','other')),
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
          source TEXT DEFAULT 'phone' CHECK(source IN ('phone','radio','alarm','walk_in','email','patrol','online','dispatch','other')),
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
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
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

  console.log('Schema migration completed.');
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
  `);
}

function seedData(): void {
  const now = localNow();

  // ─── ADMIN USER (only if no users exist) ──────────
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const hash = (pw: string) => bcryptjs.hashSync(pw, 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, email, role, badge_number, phone, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run('admin', hash('admin123'), 'System Administrator', 'admin@rmpgsecurity.com', 'admin', 'A001', '801-555-0100', now, now);
    console.log('Admin user created.');
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
      ['ARR', 'Arrest / Detained'], ['REF', 'Referred to Law Enforcement'],
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

  console.log('Seed data initialized (admin user + system config).');
}

export default { initDatabase, getDb };
