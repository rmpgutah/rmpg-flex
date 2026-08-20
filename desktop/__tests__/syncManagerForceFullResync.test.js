'use strict';

// Dedicated test file (rather than folding into syncManager.test.js) because
// this is the one syncManager test that needs a REAL, initialized local DB —
// forceFullResync()'s regression check ("does the wipe actually happen or
// not?") can only be proven by seeding a real row and checking whether it
// survives. Every other syncManager test deliberately relies on localDb's
// module-level `db` handle staying null for the life of the process (see the
// discriminator comments in syncManager.test.js) — initializing a real DB in
// that file would invalidate those tests. `node --test` isolates each test
// file in its own process by default, so this file's real DB init cannot
// leak into (or be affected by) syncManager.test.js's null-db assumptions.
//
// Same electron-module override trick as localDb.test.js, for the same
// reason: localDb.js does `const { app, safeStorage } = require('electron');`
// at module load time and calls `app.getPath('userData')` inside
// initLocalDb(). Under plain `node --test` there is no real Electron
// runtime, so this pre-seeds require.cache for electron's resolved path
// before anything requires localDb.js (via syncManager.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmpg-syncmanager-resync-test-'));

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: { getPath: () => tmpUserDataDir },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (plaintext) => Buffer.from(`ENC:${plaintext.split('').reverse().join('')}`, 'utf8'),
      decryptString: (buf) => {
        const raw = buf.toString('utf8');
        if (!raw.startsWith('ENC:')) throw new Error('bad ciphertext');
        return raw.slice(4).split('').reverse().join('');
      },
    },
  },
};

const { initLocalDb, closeLocalDb, getLocalDb } = require('../localDb');
const syncManager = require('../syncManager');

test.before(() => {
  initLocalDb();
});

test.after(() => {
  closeLocalDb();
  fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
});

test('forceFullResync: while paused, bails out BEFORE wiping — returns {ok:false, error} and leaves mirrored cache tables untouched', async () => {
  const db = getLocalDb();
  db.exec('DELETE FROM units');

  // Seed a row in a mirrored/reference cache table (same table + shape used
  // by localDb.test.js's wipeMirroredCacheTables test). This is the
  // load-bearing setup: if forceFullResync() wipes-then-checks instead of
  // checks-then-wipes, this row will be gone by the time the assertions run,
  // even though the function still reports {ok:false}.
  db.prepare(`
    INSERT INTO units (id, call_sign, status)
    VALUES (1, 'U-1', 'on_duty')
  `).run();

  syncManager.resumeSync();
  syncManager.pauseSync();
  try {
    const result = await syncManager.forceFullResync();

    assert.deepEqual(result, {
      ok: false,
      error: 'cannot force a full resync while sync is paused — resume sync first',
    });

    const row = db.prepare('SELECT * FROM units WHERE id = 1').get();
    assert.ok(row, 'seeded row must survive a paused forceFullResync() call — the wipe must not run at all');
    assert.equal(row.call_sign, 'U-1');
  } finally {
    syncManager.resumeSync();
  }
});
