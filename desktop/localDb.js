// ============================================================
// RMPG Flex — Local SQLite Database for Offline Operation
// Maintains a mirror of critical server tables so the app can
// function during internet outages. Admin (CHZAMO5000) always
// has full local access; employees need a 24-hour PIN.
// ============================================================

const path = require('path');
const { app } = require('electron');
const fs = require('fs');

let db = null;

function getDbPath() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'offline-data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, 'rmpg-local.db');
}

function init() {
  if (db) return db;

  const Database = require('better-sqlite3');
  const dbPath = getDbPath();
  console.log('[LocalDB] Opening:', dbPath);
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  console.log('[LocalDB] Initialized');
  return db;
}

function getDb() {
  if (!db) throw new Error('LocalDB not initialized');
  return db;
}

function close() {
  if (db) {
    console.log('[LocalDB] Closing');
    db.close();
    db = null;
  }
}

function createTables() {
  db.exec(`
    -- Mirror tables (subset of server schema)

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      full_name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'officer',
      badge_number TEXT,
      status TEXT DEFAULT 'active',
      offline_secret TEXT,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      contact_name TEXT,
      contact_phone TEXT,
      status TEXT DEFAULT 'active',
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      client_id INTEGER,
      latitude REAL,
      longitude REAL,
      status TEXT DEFAULT 'active',
      synced_at TEXT,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS calls_for_service (
      id INTEGER PRIMARY KEY,
      server_id INTEGER,
      local_id TEXT,
      call_number TEXT,
      incident_type TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      caller_name TEXT,
      caller_phone TEXT,
      location_address TEXT NOT NULL,
      property_id INTEGER,
      client_id INTEGER,
      latitude REAL,
      longitude REAL,
      description TEXT,
      notes TEXT,
      source TEXT DEFAULT 'phone',
      assigned_unit_ids TEXT DEFAULT '[]',
      dispatcher_id INTEGER,
      disposition TEXT,
      created_at TEXT,
      dispatched_at TEXT,
      enroute_at TEXT,
      onscene_at TEXT,
      cleared_at TEXT,
      closed_at TEXT,
      updated_at TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY,
      call_sign TEXT,
      officer_id INTEGER,
      officer_name TEXT,
      status TEXT DEFAULT 'off_duty',
      latitude REAL,
      longitude REAL,
      current_call_id INTEGER,
      last_status_change TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY,
      server_id INTEGER,
      local_id TEXT,
      incident_number TEXT,
      incident_type TEXT,
      priority TEXT,
      status TEXT DEFAULT 'open',
      location_address TEXT,
      property_id INTEGER,
      description TEXT,
      narrative TEXT,
      officer_id INTEGER,
      created_at TEXT,
      updated_at TEXT,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY,
      server_id INTEGER,
      local_id TEXT,
      officer_id INTEGER NOT NULL,
      clock_in TEXT,
      clock_out TEXT,
      total_hours REAL,
      status TEXT DEFAULT 'active',
      vehicle_id INTEGER,
      mileage_start INTEGER,
      mileage_end INTEGER,
      property_id INTEGER,
      is_dirty INTEGER DEFAULT 0,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      date_of_birth TEXT,
      gender TEXT,
      race TEXT,
      height TEXT,
      weight TEXT,
      hair_color TEXT,
      eye_color TEXT,
      address TEXT,
      phone TEXT,
      id_number TEXT,
      id_state TEXT,
      flags TEXT DEFAULT '[]',
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS vehicles_records (
      id INTEGER PRIMARY KEY,
      plate_number TEXT,
      plate_state TEXT,
      make TEXT,
      model TEXT,
      year INTEGER,
      color TEXT,
      vin TEXT,
      owner_name TEXT,
      flags TEXT DEFAULT '[]',
      synced_at TEXT
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
      recorded_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0
    );

    -- Local-only tables

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      body TEXT,
      local_id TEXT,
      table_name TEXT,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS pin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      expires_at TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pin_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      success INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      table_name TEXT PRIMARY KEY,
      last_pull TEXT,
      last_push TEXT,
      row_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS local_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_local_cfs_status ON calls_for_service(status);
    CREATE INDEX IF NOT EXISTS idx_local_cfs_dirty ON calls_for_service(is_dirty);
    CREATE INDEX IF NOT EXISTS idx_local_units_status ON units(status);
    CREATE INDEX IF NOT EXISTS idx_local_gps_synced ON gps_breadcrumbs(is_synced);
    CREATE INDEX IF NOT EXISTS idx_local_sync_queue_status ON sync_queue(status);
    CREATE INDEX IF NOT EXISTS idx_local_pin_sessions_active ON pin_sessions(is_active, expires_at);
    CREATE INDEX IF NOT EXISTS idx_local_pin_attempts_user ON pin_attempts(user_id, attempted_at);
  `);
}

function upsertRows(tableName, rows) {
  if (!rows || rows.length === 0) return 0;
  const columns = Object.keys(rows[0]).filter(k => k !== 'is_dirty');
  const placeholders = columns.map(() => '?').join(',');
  const updateCols = columns.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(',');

  const stmt = db.prepare(`
    INSERT INTO ${tableName} (${columns.join(',')})
    VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updateCols}, synced_at = datetime('now','localtime')
    WHERE is_dirty IS NULL OR is_dirty = 0
  `);

  const insertMany = db.transaction((items) => {
    let count = 0;
    for (const row of items) {
      try {
        stmt.run(...columns.map(c => row[c] ?? null));
        count++;
      } catch (err) {
        console.error('[LocalDB] Upsert error in ' + tableName + ':', err.message);
      }
    }
    return count;
  });

  return insertMany(rows);
}

function upsertRowsSimple(tableName, rows) {
  if (!rows || rows.length === 0) return 0;
  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => '?').join(',');
  const updateCols = columns.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(',');

  const stmt = db.prepare(`
    INSERT INTO ${tableName} (${columns.join(',')})
    VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updateCols}, synced_at = datetime('now','localtime')
  `);

  const insertMany = db.transaction((items) => {
    let count = 0;
    for (const row of items) {
      try {
        stmt.run(...columns.map(c => row[c] ?? null));
        count++;
      } catch (err) {
        console.error('[LocalDB] Upsert error in ' + tableName + ':', err.message);
      }
    }
    return count;
  });

  return insertMany(rows);
}

function getDirtyRows(tableName) {
  return db.prepare('SELECT * FROM ' + tableName + ' WHERE is_dirty = 1').all();
}

function clearDirtyFlag(tableName, id) {
  db.prepare('UPDATE ' + tableName + ' SET is_dirty = 0, synced_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(id);
}

function getLocalStats() {
  const tables = ['users', 'clients', 'properties', 'calls_for_service', 'units', 'incidents', 'time_entries', 'persons', 'vehicles_records'];
  const stats = {};
  for (const t of tables) {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM ' + t).get();
      stats[t] = row.count;
    } catch { stats[t] = 0; }
  }
  stats.sync_queue_pending = db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'").get().count;
  stats.gps_unsynced = db.prepare('SELECT COUNT(*) as count FROM gps_breadcrumbs WHERE is_synced = 0').get().count;

  try {
    const dbPath = getDbPath();
    const stat = fs.statSync(dbPath);
    stats.db_size_mb = Math.round(stat.size / 1048576 * 10) / 10;
  } catch { stats.db_size_mb = 0; }

  return stats;
}

module.exports = {
  init, getDb, close, getDbPath,
  upsertRows, upsertRowsSimple,
  getDirtyRows, clearDirtyFlag, getLocalStats,
};
