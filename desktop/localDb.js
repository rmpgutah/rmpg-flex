// ============================================================
// RMPG Flex — Local SQLite Database Manager
// Mirrors a subset of the server's tables for offline operation.
// Stored at: app.getPath('userData')/rmpg-local.db
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');
const { encryptPasswordHashForCache, decryptPasswordHashFromCache, enableSecureDelete, verifyLocalDbIntegrity, restrictLocalDbFilePermissions } = require('./security/secretsStore');

let db = null;

// ─── Public API ──────────────────────────────────────────────

function getLocalDb() {
  if (!db) throw new Error('Local DB not initialized. Call initLocalDb() first.');
  return db;
}

/**
 * Resolves the local SQLite cache file path. Takes Electron's `app` and
 * Node's `path` modules as parameters (mirroring fileOps.js's pattern) so
 * this stays unit-testable, and so 'rmpg-local.db' is written in exactly
 * one place in this file.
 */
function getLocalDbPath(appModule, pathModule) {
  return pathModule.join(appModule.getPath('userData'), 'rmpg-local.db');
}

function initLocalDb() {
  const dbDir = app.getPath('userData');
  const dbPath = getLocalDbPath(app, path);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  console.log('[LOCAL-DB] Initializing at:', dbPath);
  db = new Database(dbPath);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // journal_mode = WAL above is what creates the -wal/-shm sidecar files,
  // so the permission restriction must run after it to actually find and
  // protect them (see restrictLocalDbFilePermissions doc comment).
  const permsResult = restrictLocalDbFilePermissions(dbPath, fs);
  if (!permsResult.ok) {
    console.error('[LOCAL-DB] Failed to restrict file permissions:', permsResult.error);
  }

  enableSecureDelete(db);

  const integrityResult = verifyLocalDbIntegrity(db);
  if (!integrityResult.ok) {
    console.error('[LOCAL-DB] Integrity check failed — local cache may be corrupted:', integrityResult.errors);
  }

  createMirrorTables();
  createLocalTables();

  // Reconciliation: add pin_sessions.device_id for installs whose local DB
  // predates device-binding (the CREATE TABLE IF NOT EXISTS above only
  // applies to genuinely fresh installs — it's a no-op against an existing
  // table, so upgrades need this explicit ALTER). Must run after
  // createLocalTables() so the pin_sessions table is guaranteed to exist
  // first. Idempotent: a second run against a DB that already has the
  // column hits SQLite's "duplicate column name" error, which is swallowed;
  // any other failure is rethrown.
  try {
    db.exec('ALTER TABLE pin_sessions ADD COLUMN device_id TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }

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
      created_at TEXT NOT NULL,
      device_id TEXT
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

function replaceTable(tableName, rows) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM ${tableName}`).run();
    for (const row of rows) {
      upsertRow(tableName, row);
    }
    updateSyncMeta(tableName, rows.length);
  });
  tx();
}

// ─── Helper: Full-replace the users table (encrypted password_hash) ─
// Same transactional shape as replaceTable() above, but for the 'users'
// table specifically: each row goes through upsertUserWithEncryptedHash()
// instead of the generic upsertRow(), so the cached password_hash is
// encrypted via safeStorage before it ever touches disk. syncManager.js's
// pullTable() calls this instead of replaceTable('users', rows) — see its
// applyPulledRows() helper for the dispatch (Group C Task 10; closes a gap
// left by Group H, which built upsertUserWithEncryptedHash() but never
// wired it into the sync pull path).

function replaceUsersTable(rows) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM users`).run();
    for (const row of rows) {
      upsertUserWithEncryptedHash(row);
    }
    updateSyncMeta('users', rows.length);
  });
  tx();
}

// ─── Helper: Delta-upsert operational data ───────────────────
// Only updates rows that are NOT dirty locally (local writes take precedence)

function deltaSync(tableName, rows) {
  const tx = db.transaction(() => {
    for (const row of rows) {
      const local = db.prepare(`SELECT is_dirty FROM ${tableName} WHERE id = ?`).get(row.id);
      if (!local || !local.is_dirty) {
        upsertRow(tableName, { ...row, is_dirty: 0, synced_at: new Date().toISOString() });
      }
    }
    const count = db.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get().c;
    updateSyncMeta(tableName, count);
  });
  tx();
}

// ─── Helper: Upsert a users row with password_hash encrypted ─

/**
 * Upserts a single users row with password_hash encrypted via safeStorage
 * before it touches disk. Callers (syncManager.js's user mirror sync)
 * should use this instead of the generic upsertRow('users', row) for
 * rows that include a password_hash field.
 */
function upsertUserWithEncryptedHash(row) {
  const encryptedRow = row.password_hash
    ? { ...row, password_hash: encryptPasswordHashForCache(row.password_hash, safeStorage) }
    : row;
  upsertRow('users', encryptedRow);
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

/**
 * Reads the most recent sync error (written by syncManager.js's pullTable/
 * pushAll catch blocks) for the diagnostics UI. Returns null if no sync
 * error has ever been recorded, or if the stored value is somehow malformed
 * JSON (defensive — this plan controls the only writer, but a corrupted
 * local_config row shouldn't throw and crash the diagnostics UI).
 */
function getLastSyncError() {
  const raw = getConfig('last_sync_error');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

/**
 * Returns per-item detail for the sync queue's pending + failed rows (for
 * diagnostics UI), ordered so the most-retried (most likely stuck) items
 * surface first. Unlike getPendingQueue() (pending only, replay payload),
 * this also surfaces 'failed' rows and only the fields relevant to a
 * human-readable status display.
 */
function getSyncQueueDetail(limit = 100) {
  const rows = db.prepare(
    `SELECT id, table_name, method, attempts, error FROM sync_queue WHERE status IN ('pending', 'failed') ORDER BY attempts DESC, created_at ASC LIMIT ?`
  ).all(limit);
  return rows.map((row) => ({
    id: row.id,
    table: row.table_name,
    action: row.method,
    failCount: row.attempts,
    lastError: row.error,
  }));
}

/**
 * Resets a single sync_queue row back to a fresh 'pending' state so it will
 * be replayed on the next sync cycle. Performs its own existence check —
 * ipcGuard's validateSyncQueueIdInput() only validates shape (positive
 * integer), per its own doc comment ("no existence check — that's deferred
 * to the handler itself"); this function is that handler-side check.
 * Resets attempts/error too (not just status) so a fresh retry doesn't
 * immediately look like it already failed several times.
 */
function retrySyncQueueItem(id) {
  const existing = db.prepare('SELECT id FROM sync_queue WHERE id = ?').get(id);
  if (!existing) {
    return { ok: false, error: 'no sync queue item with that id' };
  }
  db.prepare(`
    UPDATE sync_queue
    SET status = 'pending', attempts = 0, error = NULL
    WHERE id = ?
  `).run(id);
  return { ok: true };
}

/**
 * Bulk-clears every 'failed' sync_queue row (e.g. after an operator has
 * reviewed and given up on retrying them via the diagnostics UI). Returns
 * the actual number of rows removed via better-sqlite3's `.run().changes`,
 * not a re-query — cheaper and immune to a race with a concurrent insert.
 */
function clearFailedSyncItems() {
  const result = db.prepare(`DELETE FROM sync_queue WHERE status = 'failed'`).run();
  return { cleared: result.changes };
}

// ─── Force Full Resync (destructive mirrored-cache wipe) ─────

/**
 * Deletes every row from each given mirrored/reference cache table (the
 * tables pullTable()/replaceTable() in syncManager.js populate FROM the
 * server) plus that table's sync_metadata bookkeeping row, so the next
 * pull has no last_pull_at to diff against and is treated as a full pull.
 *
 * The table list is intentionally a caller-supplied parameter rather than
 * a constant duplicated/owned here: syncManager.js's PULL_INTERVALS object
 * is the single source of truth for which tables count as "mirrored cache"
 * (see its keys), and syncManager.js already requires FROM localDb.js —
 * localDb.js importing back from syncManager.js would create a circular
 * require. The caller (syncManager.js's forceFullResync()) passes
 * Object.keys(PULL_INTERVALS).
 *
 * Table names are NEVER accepted from renderer/IPC input here — this only
 * runs against the trusted, code-defined PULL_INTERVALS key list, so the
 * `DELETE FROM ${table}` string interpolation is safe (not the same risk
 * class as a renderer-supplied table name).
 *
 * Deliberately does NOT touch sync_queue (locally-created writes not yet
 * pushed to the server) or gps_breadcrumbs (same reasoning) — those hold
 * real officer work that hasn't synced yet, and wiping them would silently
 * destroy it. This function only ever gets a mirrored-cache table list.
 */
function wipeMirroredCacheTables(tableNames) {
  const tx = db.transaction(() => {
    for (const table of tableNames) {
      db.exec(`DELETE FROM ${table}`);
      db.prepare('DELETE FROM sync_metadata WHERE table_name = ?').run(table);
    }
  });
  tx();
}

// ─── Local Cache Stats (read-only reporting) ──────────────────

/**
 * The mirrored/reference cache table list, duplicated here from
 * syncManager.js's PULL_INTERVALS keys rather than imported from it.
 *
 * Design note (Task 7): getLocalCacheStats() below is called from a
 * guardedHandle('sync:cache-stats', ...) IPC handler in main.js that's
 * meant to work for an offline-status panel — i.e. it must return something
 * useful even when the app has never come online this session. main.js's
 * `syncManager` module reference is lazily assigned (`let syncManager =
 * null`, only `require('./syncManager')`'d after connectivity resolves —
 * see main.js's "Initialize offline modules" block), so a handler that
 * needs to work while offline cannot read PULL_INTERVALS off of that
 * lazy reference.
 *
 * Requiring './syncManager' unconditionally at the top of main.js (bypassing
 * the lazy `let syncManager` variable) was considered and rejected:
 * syncManager.js itself does `require('./localDb')` at its own top level
 * (unconditionally), and localDb.js does `require('better-sqlite3')`
 * unconditionally at ITS top level — which is exactly the native-module
 * load failure main.js's existing `let initLocalDb, ... ; try { ... } catch`
 * block around `require('./localDb')` exists to survive gracefully (see
 * that comment further up in main.js). Requiring syncManager.js from a new
 * unconditional top-level require in main.js would reintroduce that same
 * crash-before-splash risk (or require duplicating the try/catch and its
 * stub-fallback plumbing) for the sole purpose of reading one constant.
 *
 * So: this constant is localDb.js's own copy, matching PULL_INTERVALS'
 * keys as of this writing (users, clients, properties, units,
 * calls_for_service, incidents, time_entries, persons, vehicles_records).
 * localDb.js cannot import FROM syncManager.js either way — syncManager.js
 * already imports FROM localDb.js, so the reverse would be a circular
 * require (the same constraint wipeMirroredCacheTables() above documents).
 *
 * ⚠️ Keep in sync with syncManager.js's PULL_INTERVALS by hand — there is
 * no automated check tying these two lists together. If a mirrored table
 * is added/removed there, update this list too.
 */
const MIRRORED_CACHE_TABLE_NAMES = [
  'users',
  'clients',
  'properties',
  'units',
  'calls_for_service',
  'incidents',
  'time_entries',
  'persons',
  'vehicles_records',
];

/**
 * Read-only per-table row-count + on-disk-byte-size report for the local
 * SQLite cache, intended for an offline-status/diagnostics panel.
 *
 * Unlike wipeMirroredCacheTables() (mirrored cache tables only, by design —
 * see its doc comment), this ALSO reports 'sync_queue' and
 * 'gps_breadcrumbs': those hold real not-yet-pushed officer work rather
 * than mirrored server data, but an operator looking at "how much local
 * data do I have / how much is pending" reasonably wants to see queue size
 * too. This is purely additive to the report — it does not change what
 * wipeMirroredCacheTables() wipes, and this function never deletes anything.
 *
 * `bytes` comes from SQLite's `dbstat` virtual table, a compile-time option
 * that may not be present in every better-sqlite3 build. If that query
 * throws, `bytes` is reported as null for that table rather than a
 * fabricated estimate.
 *
 * Table names here are always from the trusted, code-defined lists above
 * (never renderer/IPC input), so the `FROM ${table}` string interpolation
 * is safe — same reasoning as wipeMirroredCacheTables().
 */
function getLocalCacheStats() {
  const tables = [...MIRRORED_CACHE_TABLE_NAMES, 'sync_queue', 'gps_breadcrumbs'];
  return tables.map((table) => {
    const rows = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
    let bytes;
    try {
      bytes = db.prepare('SELECT SUM(pgsize) as b FROM dbstat WHERE name = ?').get(table)?.b ?? null;
    } catch {
      bytes = null;
    }
    return { table, rows, bytes };
  });
}

/**
 * Clear a single mirrored cache table, by name, on demand from a
 * renderer/IPC-originated diagnostics action (e.g. "clear cache for just
 * this table" in an offline-status panel), as opposed to
 * wipeMirroredCacheTables() above (code-driven, always the full trusted
 * list — see forceFullResync() in syncManager.js).
 *
 * ⚠️ SECURITY: unlike every other `${table}`-interpolating function in this
 * file, `table` here originates directly from renderer/IPC input (see
 * main.js's `guardedHandle('sync:clear-cache', (event, table) =>
 * clearLocalCache(table))`), not from a trusted, code-defined list. It MUST
 * be validated against MIRRORED_CACHE_TABLE_NAMES BEFORE it ever reaches a
 * SQL string — a crafted table name (e.g. 'sqlite_master', or
 * "users; DROP TABLE users;--") must be rejected outright rather than
 * interpolated. This is the same SQL-injection-via-identifier discipline
 * syncManager.js's ALLOWED_SYNC_TABLES check already applies before its
 * `UPDATE ${item.table_name}` call.
 *
 * better-sqlite3 has no parameterized-identifier support (bind params only
 * work for values, never table/column names), so an allowlist check is the
 * only defense here — there is no query-builder escaping to fall back on.
 */
function clearLocalCache(table) {
  if (!MIRRORED_CACHE_TABLE_NAMES.includes(table)) {
    return { ok: false, error: 'unknown or non-clearable table' };
  }
  db.transaction(() => {
    db.exec(`DELETE FROM ${table}`);
    db.prepare('DELETE FROM sync_metadata WHERE table_name = ?').run(table);
  })();
  return { ok: true };
}

module.exports = {
  initLocalDb,
  getLocalDb,
  getLocalDbPath,
  closeLocalDb,
  upsertRow,
  replaceTable,
  replaceUsersTable,
  deltaSync,
  upsertUserWithEncryptedHash,
  getSyncMeta,
  updateSyncMeta,
  getConfig,
  setConfig,
  getLastSyncError,
  enqueue,
  getPendingQueue,
  markQueueItem,
  getQueueDepth,
  getSyncQueueDetail,
  retrySyncQueueItem,
  clearFailedSyncItems,
  wipeMirroredCacheTables,
  getLocalCacheStats,
  clearLocalCache,
  MIRRORED_CACHE_TABLE_NAMES,
};
