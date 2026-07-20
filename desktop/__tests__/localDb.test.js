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

const { initLocalDb, getLocalDb, closeLocalDb, getSyncQueueDetail, retrySyncQueueItem } = require('../localDb');

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
