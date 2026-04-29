import type Database from 'better-sqlite3';

// Traccar integration schema.
//
// Mirrors the convention used by cpgps_* tables (server/src/models/database.ts).
// Each table has explicit columns for indexed/queried fields plus a `raw_json`
// column with the full Traccar payload. This is the documented ETL pattern in
// the codebase: queries on lat/lng/time stay fast, but no Traccar field is
// ever lost — when Traccar adds a new attribute we keep it for free.
//
// Run as part of database init. Idempotent (CREATE IF NOT EXISTS) so safe on
// re-init and on schema upgrades.

export function ensureTraccarSchema(db: Database.Database): void {
  const stmts: string[] = [
    // ─── Devices ────────────────────────────────────────────
    // One row per Traccar device (each tracker / unit / vehicle).
    `CREATE TABLE IF NOT EXISTS traccar_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traccar_id INTEGER UNIQUE NOT NULL,
      vehicle_id INTEGER,
      name TEXT,
      unique_id TEXT,
      status TEXT,
      disabled INTEGER DEFAULT 0,
      last_update TEXT,
      position_id INTEGER,
      group_id INTEGER,
      phone TEXT,
      model TEXT,
      contact TEXT,
      category TEXT,
      attributes_json TEXT,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_devices_unique ON traccar_devices(unique_id)`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_devices_vehicle ON traccar_devices(vehicle_id)`,

    // ─── Positions (the bulk of historical data) ────────────
    `CREATE TABLE IF NOT EXISTS traccar_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traccar_id INTEGER UNIQUE NOT NULL,
      traccar_device_id INTEGER NOT NULL,
      vehicle_id INTEGER,
      protocol TEXT,
      server_time TEXT,
      device_time TEXT,
      fix_time TEXT NOT NULL,
      valid INTEGER,
      outdated INTEGER,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude REAL,
      speed REAL,
      course REAL,
      address TEXT,
      accuracy REAL,
      network TEXT,
      attributes_json TEXT,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    // Compound index — primary query pattern (per-device timeline).
    `CREATE INDEX IF NOT EXISTS idx_traccar_pos_device_time ON traccar_positions(traccar_device_id, fix_time)`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_pos_vehicle_time ON traccar_positions(vehicle_id, fix_time)`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_pos_time ON traccar_positions(fix_time)`,
    // Bounding-box queries for map viewport filtering.
    `CREATE INDEX IF NOT EXISTS idx_traccar_pos_latlng ON traccar_positions(latitude, longitude)`,

    // ─── Events ─────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS traccar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traccar_id INTEGER UNIQUE NOT NULL,
      type TEXT,
      event_time TEXT NOT NULL,
      traccar_device_id INTEGER,
      vehicle_id INTEGER,
      position_id INTEGER,
      geofence_id INTEGER,
      maintenance_id INTEGER,
      attributes_json TEXT,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_events_time ON traccar_events(event_time)`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_events_device ON traccar_events(traccar_device_id, event_time)`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_events_type ON traccar_events(type)`,

    // ─── Trips ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS traccar_trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traccar_device_id INTEGER NOT NULL,
      vehicle_id INTEGER,
      device_name TEXT,
      driver_unique_id TEXT,
      driver_name TEXT,
      start_time TEXT,
      end_time TEXT,
      start_address TEXT,
      end_address TEXT,
      start_lat REAL,
      start_lon REAL,
      end_lat REAL,
      end_lon REAL,
      start_odometer REAL,
      end_odometer REAL,
      distance REAL,
      average_speed REAL,
      max_speed REAL,
      duration INTEGER,
      spent_fuel REAL,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_trips_device ON traccar_trips(traccar_device_id, start_time)`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_trips_vehicle ON traccar_trips(vehicle_id, start_time)`,

    // ─── Stops ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS traccar_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traccar_device_id INTEGER NOT NULL,
      vehicle_id INTEGER,
      device_name TEXT,
      driver_unique_id TEXT,
      driver_name TEXT,
      start_time TEXT,
      end_time TEXT,
      address TEXT,
      lat REAL,
      lon REAL,
      odometer REAL,
      duration INTEGER,
      engine_hours INTEGER,
      spent_fuel REAL,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_stops_device ON traccar_stops(traccar_device_id, start_time)`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_stops_vehicle ON traccar_stops(vehicle_id, start_time)`,

    // ─── Geofences ──────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS traccar_geofences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traccar_id INTEGER UNIQUE NOT NULL,
      name TEXT,
      description TEXT,
      area TEXT,
      calendar_id INTEGER,
      attributes_json TEXT,
      raw_json TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,

    // ─── Sync jobs ──────────────────────────────────────────
    // One row per sync run — tracks progress and errors.
    `CREATE TABLE IF NOT EXISTS traccar_sync_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      date_from TEXT,
      date_to TEXT,
      device_filter TEXT,
      devices_synced INTEGER DEFAULT 0,
      positions_synced INTEGER DEFAULT 0,
      events_synced INTEGER DEFAULT 0,
      trips_synced INTEGER DEFAULT 0,
      stops_synced INTEGER DEFAULT 0,
      geofences_synced INTEGER DEFAULT 0,
      error_message TEXT,
      progress_percent REAL DEFAULT 0,
      triggered_by_user_id INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at TEXT,
      FOREIGN KEY (triggered_by_user_id) REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_traccar_sync_jobs_status ON traccar_sync_jobs(status, started_at)`,
  ];

  for (const sql of stmts) {
    db.prepare(sql).run();
  }
}
