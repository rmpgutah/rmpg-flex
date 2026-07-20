'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// localDb.js does `const { app, safeStorage } = require('electron');` at
// module load time and calls `app.getPath('userData')` inside initLocalDb().
// Under a plain `node --test` run there is no real Electron runtime, so
// `require('electron')` resolves to the path of the Electron binary (a
// string) rather than the {app, safeStorage} API surface — initLocalDb()
// would crash calling `.getPath` on `undefined`.
//
// Node's `require` consults `require.cache` (keyed by resolved file path)
// before doing any real module loading, so pre-seeding the cache entry for
// electron's resolved path with a fake module is enough to swap in test
// doubles for `app`/`safeStorage` without any special loader, transpile
// step, or mocking framework. `node --test` isolates each test file in its
// own process by default, so this override cannot leak into other test
// files even though it mutates the shared `require.cache`.
const tmpUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmpg-localdb-test-'));

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: { getPath: () => tmpUserDataDir },
    safeStorage: {
      // Not exercised by initLocalDb() or getSyncQueueDetail() — only
      // upsertUserWithEncryptedHash() touches safeStorage, which this
      // test file never calls.
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error('safeStorage.encryptString should not be called by this test'); },
      decryptString: () => { throw new Error('safeStorage.decryptString should not be called by this test'); },
    },
  },
};

const { initLocalDb, getLocalDb, closeLocalDb, getSyncQueueDetail, retrySyncQueueItem, clearFailedSyncItems, setConfig, getLastSyncError, wipeMirroredCacheTables, getLocalCacheStats, clearLocalCache, MIRRORED_CACHE_TABLE_NAMES } = require('../localDb');

test.before(() => {
  initLocalDb();
});

test.after(() => {
  closeLocalDb();
  fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
});

function seedQueueRow(db, overrides) {
  const row = {
    method: 'POST',
    endpoint: '/api/x',
    body: '{}',
    local_id: 'local-1',
    table_name: 'calls_for_service',
    created_at: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    error: null,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO sync_queue (method, endpoint, body, local_id, table_name, created_at, attempts, status, error)
    VALUES (@method, @endpoint, @body, @local_id, @table_name, @created_at, @attempts, @status, @error)
  `).run(row);
}

test('getSyncQueueDetail: maps rows to {id, table, action, failCount, lastError} and excludes synced rows', () => {
  const db = getLocalDb();
  db.exec('DELETE FROM sync_queue');

  seedQueueRow(db, {
    method: 'POST',
    table_name: 'calls_for_service',
    created_at: '2026-07-19T00:00:00.000Z',
    attempts: 3,
    status: 'failed',
    error: 'network timeout',
  });
  seedQueueRow(db, {
    method: 'PUT',
    table_name: 'units',
    created_at: '2026-07-19T00:01:00.000Z',
    attempts: 0,
    status: 'pending',
    error: null,
  });
  seedQueueRow(db, {
    method: 'POST',
    table_name: 'incidents',
    created_at: '2026-07-19T00:02:00.000Z',
    attempts: 5,
    status: 'synced',
    error: null,
  });

  const detail = getSyncQueueDetail();

  assert.equal(detail.length, 2, 'the synced row must not appear');
  assert.ok(!detail.some((row) => row.table === 'incidents'), 'synced row leaked into result');

  const failedRow = detail.find((row) => row.table === 'calls_for_service');
  assert.ok(failedRow, 'failed row must be present');
  assert.deepEqual(failedRow, {
    id: failedRow.id,
    table: 'calls_for_service',
    action: 'POST',
    failCount: 3,
    lastError: 'network timeout',
  });

  const pendingRow = detail.find((row) => row.table === 'units');
  assert.ok(pendingRow, 'pending row must be present');
  assert.deepEqual(pendingRow, {
    id: pendingRow.id,
    table: 'units',
    action: 'PUT',
    failCount: 0,
    lastError: null,
  });

  // ORDER BY attempts DESC, created_at ASC — the 3-attempt failed row sorts
  // before the 0-attempt pending row.
  assert.equal(detail[0].table, 'calls_for_service');
  assert.equal(detail[1].table, 'units');
});

test('getSyncQueueDetail: respects the limit parameter', () => {
  const db = getLocalDb();
  db.exec('DELETE FROM sync_queue');

  for (let i = 0; i < 5; i++) {
    seedQueueRow(db, {
      table_name: 'calls_for_service',
      created_at: `2026-07-19T00:0${i}:00.000Z`,
      attempts: i,
      status: 'pending',
      local_id: `local-${i}`,
    });
  }

  const detail = getSyncQueueDetail(2);
  assert.equal(detail.length, 2);
});

test('getSyncQueueDetail: defaults to a limit of 100', () => {
  const db = getLocalDb();
  db.exec('DELETE FROM sync_queue');

  for (let i = 0; i < 3; i++) {
    seedQueueRow(db, {
      table_name: 'calls_for_service',
      created_at: `2026-07-19T00:0${i}:00.000Z`,
      attempts: 0,
      status: 'pending',
      local_id: `local-default-${i}`,
    });
  }

  const detail = getSyncQueueDetail();
  assert.equal(detail.length, 3);
});

test('retrySyncQueueItem: resets an existing failed row to pending/attempts=0/error=null', () => {
  const db = getLocalDb();
  db.exec('DELETE FROM sync_queue');

  seedQueueRow(db, {
    method: 'POST',
    table_name: 'calls_for_service',
    attempts: 5,
    status: 'failed',
    error: 'some error',
  });
  const seeded = db.prepare('SELECT id FROM sync_queue').get();

  const result = retrySyncQueueItem(seeded.id);
  assert.deepEqual(result, { ok: true });

  const row = db.prepare('SELECT status, attempts, error FROM sync_queue WHERE id = ?').get(seeded.id);
  assert.deepEqual(row, { status: 'pending', attempts: 0, error: null });
});

test('retrySyncQueueItem: non-existent id returns {ok:false, error} without touching other rows', () => {
  const db = getLocalDb();
  db.exec('DELETE FROM sync_queue');

  seedQueueRow(db, {
    method: 'POST',
    table_name: 'units',
    attempts: 2,
    status: 'failed',
    error: 'unrelated error',
  });
  const unrelated = db.prepare('SELECT id, status, attempts, error FROM sync_queue').get();

  const missingId = unrelated.id + 9999;
  const result = retrySyncQueueItem(missingId);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');

  const unchanged = db.prepare('SELECT id, status, attempts, error FROM sync_queue WHERE id = ?').get(unrelated.id);
  assert.deepEqual(unchanged, unrelated, 'unrelated row must be untouched');
});

test('clearFailedSyncItems: deletes only failed rows and returns {cleared: N}', () => {
  const db = getLocalDb();
  db.exec('DELETE FROM sync_queue');

  seedQueueRow(db, {
    method: 'POST',
    table_name: 'calls_for_service',
    attempts: 3,
    status: 'failed',
    error: 'boom',
  });
  seedQueueRow(db, {
    method: 'PUT',
    table_name: 'units',
    attempts: 4,
    status: 'failed',
    error: 'also boom',
  });
  seedQueueRow(db, {
    method: 'POST',
    table_name: 'persons',
    attempts: 0,
    status: 'pending',
    error: null,
  });
  seedQueueRow(db, {
    method: 'POST',
    table_name: 'warrants',
    attempts: 1,
    status: 'synced',
    error: null,
  });

  const result = clearFailedSyncItems();
  assert.deepEqual(result, { cleared: 2 });

  const remaining = db.prepare('SELECT status FROM sync_queue ORDER BY status').all();
  assert.deepEqual(remaining.map((r) => r.status).sort(), ['pending', 'synced']);
});

test('getLastSyncError: returns null when the config key is unset', () => {
  const db = getLocalDb();
  db.exec(`DELETE FROM local_config WHERE key = 'last_sync_error'`);

  assert.equal(getLastSyncError(), null);
});

test('getLastSyncError: returns the parsed object for a well-formed stored value', () => {
  const db = getLocalDb();
  db.exec(`DELETE FROM local_config WHERE key = 'last_sync_error'`);

  setConfig('last_sync_error', JSON.stringify({ message: 'x', at: '2026-01-01T00:00:00Z' }));

  assert.deepEqual(getLastSyncError(), { message: 'x', at: '2026-01-01T00:00:00Z' });
});

test('getLastSyncError: returns null (not a throw) for malformed JSON in the stored value', () => {
  const db = getLocalDb();
  db.exec(`DELETE FROM local_config WHERE key = 'last_sync_error'`);

  setConfig('last_sync_error', 'not valid json{');

  assert.doesNotThrow(() => getLastSyncError());
  assert.equal(getLastSyncError(), null);
});

test('wipeMirroredCacheTables: empties the given mirror tables + their sync_metadata rows, but leaves sync_queue completely untouched', () => {
  const db = getLocalDb();
  db.exec('DELETE FROM sync_queue');
  db.exec('DELETE FROM sync_metadata');
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM units');

  // Seed rows in two mirrored cache tables.
  db.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role)
    VALUES (1, 'jdoe', 'hash', 'Jane Doe', 'officer')
  `).run();
  db.prepare(`
    INSERT INTO units (id, call_sign, status)
    VALUES (1, 'U-1', 'on_duty')
  `).run();

  // Seed sync_metadata rows for both, so we can assert they get cleared.
  db.prepare(`
    INSERT INTO sync_metadata (table_name, last_pull_at, row_count)
    VALUES ('users', '2026-07-18T00:00:00.000Z', 1), ('units', '2026-07-18T00:00:00.000Z', 1)
  `).run();

  // Seed a sync_queue row — this represents a locally-created, not-yet-pushed
  // write and must NOT be touched by the wipe (this is the load-bearing
  // assertion: "wipe local cache" means the mirrored read cache only, never
  // sync_queue).
  seedQueueRow(db, {
    method: 'POST',
    table_name: 'calls_for_service',
    local_id: 'unsynced-1',
    attempts: 1,
    status: 'pending',
    error: null,
  });
  const queueBefore = db.prepare('SELECT * FROM sync_queue').all();
  assert.equal(queueBefore.length, 1);

  wipeMirroredCacheTables(['users', 'units']);

  assert.equal(db.prepare('SELECT COUNT(*) as c FROM users').get().c, 0, 'users table must be empty');
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM units').get().c, 0, 'units table must be empty');

  const metaAfter = db.prepare(`SELECT table_name FROM sync_metadata WHERE table_name IN ('users', 'units')`).all();
  assert.equal(metaAfter.length, 0, 'sync_metadata rows for wiped tables must be gone');

  const queueAfter = db.prepare('SELECT * FROM sync_queue').all();
  assert.deepEqual(queueAfter, queueBefore, 'sync_queue must be completely untouched by the wipe');
});

test('getLocalCacheStats: reports {table, rows, bytes} for every mirrored table plus sync_queue/gps_breadcrumbs, with correct row counts including empty tables', () => {
  const db = getLocalDb();

  // Clear every table this function reports on, so counts are deterministic.
  for (const table of [...MIRRORED_CACHE_TABLE_NAMES, 'sync_queue', 'gps_breadcrumbs']) {
    db.exec(`DELETE FROM ${table}`);
  }

  // Seed a couple of rows in two mirrored tables — reusing the seed pattern
  // from the wipeMirroredCacheTables test above (users/units) — and one
  // sync_queue row, to prove non-mirrored tables are counted too.
  db.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role)
    VALUES (1, 'jdoe', 'hash', 'Jane Doe', 'officer')
  `).run();
  db.prepare(`
    INSERT INTO units (id, call_sign, status)
    VALUES (1, 'U-1', 'on_duty'), (2, 'U-2', 'off_duty')
  `).run();
  seedQueueRow(db, {
    method: 'POST',
    table_name: 'calls_for_service',
    local_id: 'unsynced-2',
    attempts: 0,
    status: 'pending',
    error: null,
  });

  const stats = getLocalCacheStats();

  const expectedTables = [...MIRRORED_CACHE_TABLE_NAMES, 'sync_queue', 'gps_breadcrumbs'];
  assert.deepEqual(
    stats.map((s) => s.table).sort(),
    [...expectedTables].sort(),
    'every mirrored table plus sync_queue/gps_breadcrumbs must be reported, and nothing else'
  );

  const byTable = Object.fromEntries(stats.map((s) => [s.table, s]));

  assert.equal(byTable.users.rows, 1);
  assert.equal(byTable.units.rows, 2);
  assert.equal(byTable.sync_queue.rows, 1);
  assert.equal(byTable.gps_breadcrumbs.rows, 0, 'unseeded table must report rows: 0, not be omitted');
  assert.equal(byTable.clients.rows, 0, 'unseeded mirrored table must report rows: 0');

  // dbstat availability is environment-dependent — assert the shape, not a
  // specific value.
  for (const entry of stats) {
    assert.ok(
      typeof entry.bytes === 'number' || entry.bytes === null,
      `bytes for ${entry.table} must be a number or null, got ${typeof entry.bytes}`
    );
  }
});

test('clearLocalCache: for a table in the allowlist, empties it + its sync_metadata row, returns {ok:true}', () => {
  const db = getLocalDb();
  db.exec('DELETE FROM sync_metadata');
  db.exec('DELETE FROM units');

  db.prepare(`
    INSERT INTO units (id, call_sign, status)
    VALUES (1, 'U-1', 'on_duty'), (2, 'U-2', 'off_duty')
  `).run();
  db.prepare(`
    INSERT INTO sync_metadata (table_name, last_pull_at, row_count)
    VALUES ('units', '2026-07-18T00:00:00.000Z', 2)
  `).run();

  const result = clearLocalCache('units');

  assert.deepEqual(result, { ok: true });
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM units').get().c, 0, 'units table must be empty');
  const metaAfter = db.prepare(`SELECT table_name FROM sync_metadata WHERE table_name = 'units'`).all();
  assert.equal(metaAfter.length, 0, 'sync_metadata row for the cleared table must be gone');
});

test('clearLocalCache: rejects a table not in MIRRORED_CACHE_TABLE_NAMES (e.g. sqlite_master) with {ok:false, error}, and executes no SQL against it', () => {
  const result = clearLocalCache('sqlite_master');

  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
});

test('clearLocalCache: SECURITY — a crafted/malicious table name is rejected BEFORE any SQL string is built, leaving real, unrelated tables completely untouched', () => {
  const db = getLocalDb();
  db.exec('DELETE FROM units');

  // Seed a row in a real, unrelated allowlisted table to prove the rejected
  // call never executed ANY SQL against real tables — not just that the
  // literal attacked table name survived unharmed.
  db.prepare(`
    INSERT INTO units (id, call_sign, status)
    VALUES (1, 'U-1', 'on_duty')
  `).run();
  const before = db.prepare('SELECT * FROM units').all();
  assert.equal(before.length, 1);

  const maliciousNames = [
    'sqlite_master',
    "users; DROP TABLE units;--",
    'not-a-real-table; DROP TABLE users;--',
  ];

  for (const name of maliciousNames) {
    const result = clearLocalCache(name);
    assert.deepEqual(result, { ok: false, error: 'unknown or non-clearable table' });
  }

  // If the allowlist check were bypassed or ordered incorrectly, this table
  // (or the `units` table targeted by the injected DROP) would be gone or
  // altered. It must still exist, untouched, with the same row.
  const after = db.prepare('SELECT * FROM units').all();
  assert.deepEqual(after, before, 'units table must be completely untouched by rejected calls');

  // The `users` table (targeted by the DROP TABLE payload) must still exist
  // as a table at all — a successful injection would drop it entirely.
  const usersTableExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`
  ).get();
  assert.ok(usersTableExists, 'users table must still exist — DROP TABLE payload must never have executed');
});
