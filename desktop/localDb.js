// ============================================================
// RMPG Flex — Local SQLite Database Manager
// Mirrors a subset of the server's tables for offline operation.
// Stored at: app.getPath('userData')/rmpg-local.db
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;

// ─── Public API ──────────────────────────────────────────────

function getLocalDb() {
  if (!db) throw new Error('Local DB not initialized. Call initLocalDb() first.');
  return db;
}

function initLocalDb() {
  const dbDir = app.getPath('userData');
  const dbPath = path.join(dbDir, 'rmpg-local.db');

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  console.log('[LOCAL-DB] Initializing at:', dbPath);
  db = new Database(dbPath);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  createMirrorTables();
  createLocalTables();

  console.log('[LOCAL-DB] Ready');
  return db;
}

function closeLocalDb() {
  if (db) {
    console.log('[LOCAL-DB] Closing database');
    db.close();
    db = null;
  }
}

// ─── Mirror Tables (synced from server) ──────────────────────

function createMirrorTables() {
  db.exec(`
    -- Users (cached for offline auth — includes password_hash)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL,
      badge_number TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      avatar_url TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    -- Clients (reference data, read-only locally)
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      contact_name TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      address TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      sla_response_minutes INTEGER DEFAULT 15,
      created_at TEXT,
      updated_at TEXT
    );

    -- Properties (reference data, read-only locally)
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY,
      client_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      property_type TEXT,
      gate_code TEXT,
      alarm_code TEXT,
      post_orders TEXT,
      hazard_notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );

    -- Calls for Service (read/write offline)
    CREATE TABLE IF NOT EXISTS calls_for_service (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT UNIQUE,
      server_id INTEGER,
      call_number TEXT,
      incident_type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'P3',
      status TEXT NOT NULL DEFAULT 'pending',
      caller_name TEXT,
      caller_phone TEXT,
      location_address TEXT NOT NULL,
      property_id INTEGER,
      client_id INTEGER,
      latitude REAL,
      longitude REAL,
      description TEXT,
      notes TEXT DEFAULT '[]',
      source TEXT DEFAULT 'dispatch',
      assigned_unit_ids TEXT DEFAULT '[]',
      dispatcher_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      dispatched_at TEXT,
      enroute_at TEXT,
      onscene_at TEXT,
      cleared_at TEXT,
      closed_at TEXT,
      disposition TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    -- Units (read/write offline)
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY,
      call_sign TEXT UNIQUE NOT NULL,
      officer_id INTEGER,
      officer_name TEXT,
      status TEXT NOT NULL DEFAULT 'off_duty',
      latitude REAL,
      longitude REAL,
      current_call_id INTEGER,
      last_status_change TEXT,
      capabilities TEXT DEFAULT '[]',
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    -- Incidents (read/write offline)
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT UNIQUE,
      server_id INTEGER,
      incident_number TEXT,
      call_id INTEGER,
      incident_type TEXT NOT NULL,
      priority TEXT DEFAULT 'P3',
      status TEXT NOT NULL DEFAULT 'draft',
      location_address TEXT,
      property_id INTEGER,
      narrative TEXT,
      officer_id INTEGER NOT NULL,
      supervisor_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    -- Time Entries (read/write offline)
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT UNIQUE,
      server_id INTEGER,
      officer_id INTEGER NOT NULL,
      schedule_id INTEGER,
      clock_in TEXT NOT NULL,
      clock_out TEXT,
      clock_in_latitude REAL,
      clock_in_longitude REAL,
      clock_out_latitude REAL,
      clock_out_longitude REAL,
      total_hours REAL,
      break_minutes INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    -- Persons (read-only locally — search cache)
    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      dob TEXT,
      gender TEXT,
      race TEXT,
      address TEXT,
      phone TEXT,
      dl_number TEXT,
      dl_state TEXT,
      flags TEXT DEFAULT '[]',
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    -- Vehicles (read-only locally — search cache)
    CREATE TABLE IF NOT EXISTS vehicles_records (
      id INTEGER PRIMARY KEY,
      plate_number TEXT,
      state TEXT,
      make TEXT,
      model TEXT,
      year INTEGER,
      color TEXT,
      vin TEXT,
      owner_person_id INTEGER,
      flags TEXT DEFAULT '[]',
      stolen_status TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    -- GPS Breadcrumbs (write-only locally, push to server)
    CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id INTEGER,
      officer_id INTEGER NOT NULL,
      call_sign TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      heading REAL,
      speed REAL,
      unit_status TEXT,
      recorded_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0
    );

    -- Citations (read/write offline)
    CREATE TABLE IF NOT EXISTS citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT UNIQUE,
      server_id INTEGER,
      citation_number TEXT,
      citation_type TEXT NOT NULL DEFAULT 'traffic',
      person_id INTEGER,
      person_name TEXT,
      vehicle_id INTEGER,
      officer_id INTEGER NOT NULL,
      location_address TEXT,
      latitude REAL,
      longitude REAL,
      violation_code TEXT,
      violation_description TEXT,
      fine_amount REAL,
      court_date TEXT,
      court_location TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      call_id INTEGER,
      incident_id INTEGER,
      issued_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    -- Field Interviews (read/write offline)
    CREATE TABLE IF NOT EXISTS field_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT UNIQUE,
      server_id INTEGER,
      fi_number TEXT,
      officer_id INTEGER NOT NULL,
      person_name TEXT,
      person_description TEXT,
      dob TEXT,
      address TEXT,
      location_address TEXT,
      latitude REAL,
      longitude REAL,
      reason TEXT,
      narrative TEXT,
      associated_call_id INTEGER,
      person_id INTEGER,
      vehicle_description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    -- Evidence/Property (read/write offline)
    CREATE TABLE IF NOT EXISTS evidence_property (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT UNIQUE,
      server_id INTEGER,
      evidence_number TEXT,
      incident_id INTEGER,
      case_id INTEGER,
      item_type TEXT NOT NULL,
      description TEXT NOT NULL,
      location_found TEXT,
      collected_by INTEGER NOT NULL,
      collected_date TEXT NOT NULL,
      serial_number TEXT,
      make TEXT,
      model TEXT,
      quantity INTEGER DEFAULT 1,
      unit_of_measure TEXT DEFAULT 'each',
      estimated_value REAL,
      status TEXT NOT NULL DEFAULT 'in_custody',
      storage_location TEXT,
      notes TEXT,
      latitude REAL,
      longitude REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );
  `);
}

// ─── Local-Only Tables ───────────────────────────────────────

function createLocalTables() {
  db.exec(`
    -- Sync Queue: queued write operations to replay to server
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      body TEXT,
      local_id TEXT,
      table_name TEXT,
      created_at TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_attempt_at TEXT,
      status TEXT DEFAULT 'pending',
      server_response TEXT,
      error TEXT
    );

    -- PIN Sessions: active 24h offline authorization windows
    CREATE TABLE IF NOT EXISTS pin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      authorized_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    -- PIN Attempts: brute-force tracking
    CREATE TABLE IF NOT EXISTS pin_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      success INTEGER NOT NULL DEFAULT 0,
      attempted_at TEXT NOT NULL
    );

    -- Sync Metadata: per-table last pull/push timestamps
    CREATE TABLE IF NOT EXISTS sync_metadata (
      table_name TEXT PRIMARY KEY,
      last_pull_at TEXT,
      last_push_at TEXT,
      row_count INTEGER DEFAULT 0
    );

    -- Local Config: cached settings (offline secrets, etc.)
    CREATE TABLE IF NOT EXISTS local_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
    CREATE INDEX IF NOT EXISTS idx_pin_sessions_active ON pin_sessions(user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_pin_attempts_user ON pin_attempts(user_id, attempted_at);
    CREATE INDEX IF NOT EXISTS idx_gps_synced ON gps_breadcrumbs(is_synced);
    CREATE INDEX IF NOT EXISTS idx_cfs_dirty ON calls_for_service(is_dirty);
    CREATE INDEX IF NOT EXISTS idx_cfs_local_id ON calls_for_service(local_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_dirty ON incidents(is_dirty);
    CREATE INDEX IF NOT EXISTS idx_incidents_local_id ON incidents(local_id);
    CREATE INDEX IF NOT EXISTS idx_units_dirty ON units(is_dirty);
    CREATE INDEX IF NOT EXISTS idx_citations_dirty ON citations(is_dirty);
    CREATE INDEX IF NOT EXISTS idx_citations_local_id ON citations(local_id);
    CREATE INDEX IF NOT EXISTS idx_fi_dirty ON field_interviews(is_dirty);
    CREATE INDEX IF NOT EXISTS idx_fi_local_id ON field_interviews(local_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_dirty ON evidence_property(is_dirty);
    CREATE INDEX IF NOT EXISTS idx_evidence_local_id ON evidence_property(local_id);
  `);
}

// ─── Helper: Upsert a row into a mirror table ────────────────

function upsertRow(tableName, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter(c => c !== 'id')
    .map(c => `${c} = excluded.${c}`)
    .join(', ');

  const sql = `
    INSERT INTO ${tableName} (${columns.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updates}
  `;

  db.prepare(sql).run(...columns.map(c => row[c] ?? null));
}

// ─── Helper: Full-replace a reference table ──────────────────
// Processes in chunks to avoid blocking the event loop on large datasets

function replaceTable(tableName, rows) {
  const CHUNK = 100;
  db.prepare(`DELETE FROM ${tableName}`).run();

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const tx = db.transaction(() => {
      for (const row of chunk) {
        upsertRow(tableName, row);
      }
    });
    tx();
  }
  updateSyncMeta(tableName, rows.length);
}

// ─── Helper: Delta-upsert operational data ───────────────────
// Only updates rows that are NOT dirty locally (local writes take precedence)
// Processes in chunks to avoid blocking the event loop

function deltaSync(tableName, rows) {
  const CHUNK = 100;
  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const tx = db.transaction(() => {
      for (const row of chunk) {
        const local = db.prepare(`SELECT is_dirty FROM ${tableName} WHERE id = ?`).get(row.id);
        if (!local || !local.is_dirty) {
          upsertRow(tableName, { ...row, is_dirty: 0, synced_at: now });
        }
      }
    });
    tx();
  }
  const count = db.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get().c;
  updateSyncMeta(tableName, count);
}

// ─── Sync Metadata ───────────────────────────────────────────

function updateSyncMeta(tableName, rowCount) {
  db.prepare(`
    INSERT INTO sync_metadata (table_name, last_pull_at, row_count)
    VALUES (?, ?, ?)
    ON CONFLICT(table_name) DO UPDATE SET last_pull_at = excluded.last_pull_at, row_count = excluded.row_count
  `).run(tableName, new Date().toISOString(), rowCount);
}

function getSyncMeta(tableName) {
  return db.prepare('SELECT * FROM sync_metadata WHERE table_name = ?').get(tableName) || {
    table_name: tableName,
    last_pull_at: null,
    last_push_at: null,
    row_count: 0,
  };
}

// ─── Local Config ────────────────────────────────────────────

function getConfig(key) {
  const row = db.prepare('SELECT value FROM local_config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare(`
    INSERT INTO local_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

// ─── Sync Queue ──────────────────────────────────────────────

function enqueue(method, endpoint, body, localId, tableName) {
  db.prepare(`
    INSERT INTO sync_queue (method, endpoint, body, local_id, table_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(method, endpoint, body ? JSON.stringify(body) : null, localId, tableName, new Date().toISOString());
}

function getPendingQueue(limit = 50) {
  return db.prepare(
    `SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`
  ).all(limit);
}

function markQueueItem(id, status, serverResponse, error) {
  db.prepare(`
    UPDATE sync_queue
    SET status = ?, server_response = ?, error = ?, attempts = attempts + 1, last_attempt_at = ?
    WHERE id = ?
  `).run(status, serverResponse, error, new Date().toISOString(), id);
}

function getQueueDepth() {
  return db.prepare(`SELECT COUNT(*) as c FROM sync_queue WHERE status = 'pending'`).get().c;
}

module.exports = {
  initLocalDb,
  getLocalDb,
  closeLocalDb,
  upsertRow,
  replaceTable,
  deltaSync,
  getSyncMeta,
  updateSyncMeta,
  getConfig,
  setConfig,
  enqueue,
  getPendingQueue,
  markQueueItem,
  getQueueDepth,
};
