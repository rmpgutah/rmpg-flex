// ============================================================
// RMPG Flex — D1 Database Adapter
// ============================================================
// Provides a SQLite-compatible interface over Cloudflare D1.
// This adapter bridges better-sqlite3 patterns to D1's async API.
// ============================================================

import { D1Database, D1PreparedStatement, D1Result, D1ExecResult } from '@cloudflare/workers-types';

// ─── Types ────────────────────────────────────────────────
export interface D1Row {
  [key: string]: any;
}

export interface D1Adapter {
  prepare(sql: string): D1Statement;
  exec(sql: string): Promise<D1ExecResult>;
  pragma(query: string): Promise<any>;
  close(): void;
  transaction<T>(fn: () => T): T;
}

export interface D1Statement {
  get(...params: any[]): Promise<D1Row | undefined>;
  all(...params: any[]): Promise<D1Row[]>;
  run(...params: any[]): Promise<D1Result>;
}

// ─── Global D1 Instance (Workers singleton pattern) ──────
let globalDb: D1Database | null = null;

export function setD1Instance(db: D1Database): void {
  globalDb = db;
}

export function getD1(): D1Database {
  if (!globalDb) {
    throw new Error('D1 database not initialized. Call setD1Instance() first.');
  }
  return globalDb;
}

// ─── D1 Statement Wrapper ────────────────────────────────
class D1StatementWrapper implements D1Statement {
  private stmt: D1PreparedStatement;

  constructor(db: D1Database, sql: string) {
    this.stmt = db.prepare(sql);
  }

  bind(...params: any[]): D1StatementWrapper {
    this.stmt = this.stmt.bind(...params);
    return this;
  }

  async get(...params: any[]): Promise<D1Row | undefined> {
    const stmt = params.length > 0 ? this.stmt.bind(...params) : this.stmt;
    const result = await stmt.first();
    return result || undefined;
  }

  async all(...params: any[]): Promise<D1Row[]> {
    const stmt = params.length > 0 ? this.stmt.bind(...params) : this.stmt;
    const result = await stmt.all();
    return result.results || [];
  }

  async run(...params: any[]): Promise<D1Result> {
    const stmt = params.length > 0 ? this.stmt.bind(...params) : this.stmt;
    return await stmt.run();
  }
}

// ─── D1 Adapter (SQLite-compatible interface) ────────────
export class D1DatabaseAdapter implements D1Adapter {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  prepare(sql: string): D1Statement {
    return new D1StatementWrapper(this.db, sql);
  }

  async exec(sql: string): Promise<D1ExecResult> {
    return await this.db.exec(sql);
  }

  async pragma(query: string): Promise<any> {
    // D1 doesn't support PRAGMA directly — return defaults
    const pragmaMap: Record<string, any> = {
      'journal_mode': 'wal',
      'foreign_keys': 1,
      'synchronous': 1,
      'wal_autocheckpoint': 1000,
      'busy_timeout': 5000,
      'mmap_size': 268435456,
      'temp_store': 'memory',
    };

    const key = query.split('=')[0].trim();
    return pragmaMap[key];
  }

  close(): void {
    // D1 connections are managed by Cloudflare — no explicit close needed
  }

  transaction<T>(fn: () => T): T {
    // D1 doesn't support synchronous transactions in Workers
    // Use batch() for async transactions instead
    return fn();
  }
}

// ─── Migration Helper ────────────────────────────────────
export async function runMigrations(db: D1Database): Promise<void> {
  const migrations = [
    // Core tables
    `CREATE TABLE IF NOT EXISTS users (
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
    )`,

    `CREATE TABLE IF NOT EXISTS user_preferences (
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
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      success INTEGER DEFAULT 0
    )`,

    // Dispatch tables
    `CREATE TABLE IF NOT EXISTS calls_for_service (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_number TEXT UNIQUE NOT NULL,
      incident_type TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'PENDING',
      description TEXT,
      address TEXT,
      latitude REAL,
      longitude REAL,
      assigned_unit_id INTEGER,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      cleared_at TEXT,
      FOREIGN KEY (assigned_unit_id) REFERENCES units(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`,

    `CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      call_sign TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      type TEXT,
      latitude REAL,
      longitude REAL,
      heading REAL,
      speed REAL,
      last_update TEXT,
      officer_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (officer_id) REFERENCES users(id)
    )`,

    // Incidents
    `CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_number TEXT UNIQUE NOT NULL,
      incident_type TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      description TEXT,
      location TEXT,
      latitude REAL,
      longitude REAL,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`,

    // Warrants
    `CREATE TABLE IF NOT EXISTS warrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warrant_number TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`,

    // System config
    `CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,

    // Security questions (for forgot-password flow)
    `CREATE TABLE IF NOT EXISTS user_security_questions (
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
    )`,

    // Migration version tracking
    `CREATE TABLE IF NOT EXISTS migration_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0,
      last_migrated_at TEXT
    )`,
  ];

  for (const sql of migrations) {
    try {
      await db.exec(sql);
    } catch (err: any) {
      console.error('Migration failed:', err.message, '\nSQL:', sql);
      throw err;
    }
  }

  // ── Column additions for existing tables (safe to re-run) ──
  const columnAdditions = [
    // Warrants — add columns from the database.ts schema
    "ALTER TABLE warrants ADD COLUMN subject_person_id INTEGER",
    "ALTER TABLE warrants ADD COLUMN issuing_court TEXT",
    "ALTER TABLE warrants ADD COLUMN issuing_judge TEXT",
    "ALTER TABLE warrants ADD COLUMN charge_description TEXT",
    "ALTER TABLE warrants ADD COLUMN bail_amount REAL",
    "ALTER TABLE warrants ADD COLUMN offense_level TEXT",
    "ALTER TABLE warrants ADD COLUMN entered_by INTEGER",
    "ALTER TABLE warrants ADD COLUMN served_by INTEGER",
    "ALTER TABLE warrants ADD COLUMN served_at TEXT",
    "ALTER TABLE warrants ADD COLUMN served_location TEXT",
    "ALTER TABLE warrants ADD COLUMN expires_at TEXT",
    "ALTER TABLE warrants ADD COLUMN notes TEXT",
    "ALTER TABLE warrants ADD COLUMN archived_at TEXT",
    "ALTER TABLE warrants ADD COLUMN priority_score REAL DEFAULT 0",
    "ALTER TABLE warrants ADD COLUMN statute_id INTEGER",
    "ALTER TABLE warrants ADD COLUMN statute_citation TEXT",
    // Properties — add archived_at (used by records-worker)
    "ALTER TABLE properties ADD COLUMN archived_at TEXT",
  ];
  for (const sql of columnAdditions) {
    try { await db.exec(sql); } catch { /* column may already exist */ }
  }

  // ── Additional tables ──
  const tableStatements = [
    `CREATE TABLE IF NOT EXISTS cases (
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
    )`,
    `CREATE TABLE IF NOT EXISTS panic_alerts (
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
      FOREIGN KEY (call_id) REFERENCES calls_for_service(id)
    )`,
    `CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth TEXT,
      ssn TEXT,
      driver_license TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      photo_url TEXT,
      race TEXT,
      sex TEXT,
      height TEXT,
      weight TEXT,
      eye_color TEXT,
      hair_color TEXT,
      scars_marks TEXT,
      occupation TEXT,
      place_of_employment TEXT,
      alias_names TEXT DEFAULT '[]',
      gang_affiliation TEXT,
      warning_flags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id TEXT UNIQUE,
      type TEXT,
      owner_name TEXT,
      owner_id TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip_code TEXT,
      latitude REAL,
      longitude REAL,
      parcel_number TEXT,
      property_use TEXT,
      zoning TEXT,
      assessed_value REAL,
      market_value REAL,
      year_built INTEGER,
      lot_size_sqft REAL,
      building_sqft REAL,
      bedrooms INTEGER,
      bathrooms REAL,
      stories INTEGER,
      pool INTEGER DEFAULT 0,
      garage_spaces INTEGER DEFAULT 0,
      alarm_system INTEGER DEFAULT 0,
      security_cameras INTEGER DEFAULT 0,
      has_prior_incidents INTEGER DEFAULT 0,
      prior_incident_count INTEGER DEFAULT 0,
      risk_score REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
  ];
  for (const sql of tableStatements) {
    try { await db.exec(sql); } catch { /* table may already exist */ }
  }

  // Initialize migration version if not exists
  const versionRow = await db.prepare('SELECT version FROM migration_version WHERE id = 1').first() as any;
  if (!versionRow) {
    await db.prepare("INSERT INTO migration_version (id, version, last_migrated_at) VALUES (1, 1, datetime('now','localtime'))").run();
  }

  console.log('D1 migrations completed');
}

// ─── Helper: Convert D1 result to SQLite-like format ─────
export function d1ToSQLite(result: D1Result): { changes: number; lastInsertRowid: number } {
  return {
    changes: result.meta?.changes || 0,
    lastInsertRowid: result.meta?.last_row_id || 0,
  };
}

// ─── Helper: Safe string conversion ──────────────────────
export function safeStr(v: any): string {
  return v == null ? '' : String(v);
}

// ─── Helper: Local time (D1 uses UTC by default) ─────────
export function localNow(): string {
  const now = new Date();
  // America/Denver offset (handles DST automatically)
  const denverTime = now.toLocaleString('en-US', { timeZone: 'America/Denver' });
  return denverTime.replace(',', '');
}
