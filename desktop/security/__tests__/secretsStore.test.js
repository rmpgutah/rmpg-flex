'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptSecretForStorage, decryptSecretForStorage } = require('../secretsStore');
const { migrateOfflineSecretsToSafeStorage } = require('../secretsStore');

function fakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    // Fake "encryption": reverse the string and wrap in a marker, just
    // enough to prove encrypt/decrypt round-trip through this module's
    // own base64 handling without needing real OS keychain access.
    encryptString: (plaintext) => Buffer.from(`ENC:${plaintext.split('').reverse().join('')}`, 'utf8'),
    decryptString: (buf) => {
      const raw = buf.toString('utf8');
      if (!raw.startsWith('ENC:')) throw new Error('bad ciphertext');
      return raw.slice(4).split('').reverse().join('');
    },
  };
}

test('encryptSecretForStorage: round-trips through decryptSecretForStorage', () => {
  const safeStorage = fakeSafeStorage();
  const ciphertext = encryptSecretForStorage('my-secret-value', safeStorage);
  assert.equal(typeof ciphertext, 'string');
  assert.notEqual(ciphertext, 'my-secret-value');
  assert.equal(decryptSecretForStorage(ciphertext, safeStorage), 'my-secret-value');
});

test('encryptSecretForStorage: throws when encryption is unavailable', () => {
  const safeStorage = fakeSafeStorage({ available: false });
  assert.throws(() => encryptSecretForStorage('x', safeStorage), /encryption is not available/);
});

test('encryptSecretForStorage: throws for a non-string plaintext', () => {
  const safeStorage = fakeSafeStorage();
  assert.throws(() => encryptSecretForStorage(123, safeStorage), /must be a string/);
});

test('decryptSecretForStorage: throws for a non-string ciphertext', () => {
  const safeStorage = fakeSafeStorage();
  assert.throws(() => decryptSecretForStorage(null, safeStorage), /must be a string/);
});

function fakeConfigStore(initial) {
  const store = { ...initial };
  return {
    getConfig: (key) => (key in store ? store[key] : null),
    setConfig: (key, value) => { store[key] = value; },
    _dump: () => ({ ...store }),
  };
}

test('migrateOfflineSecretsToSafeStorage: migrates all three plaintext secrets present', () => {
  const { getConfig, setConfig, _dump } = fakeConfigStore({
    admin_offline_secret: 'admin-plain',
    all_user_secrets: '[{"user_id":1,"secret":"user-plain"}]',
    my_offline_secret: 'my-plain',
  });
  const safeStorage = fakeSafeStorage();
  const result = migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage });
  assert.deepEqual(result.migrated.sort(), ['admin_offline_secret', 'all_user_secrets', 'my_offline_secret']);
  assert.deepEqual(result.skipped, []);
  // Each value in the store is now the encrypted form, decryptable back to the original
  const dumped = _dump();
  assert.equal(decryptSecretForStorage(dumped.admin_offline_secret, safeStorage), 'admin-plain');
});

test('migrateOfflineSecretsToSafeStorage: skips a key that is absent', () => {
  const { getConfig, setConfig } = fakeConfigStore({ admin_offline_secret: 'admin-plain' });
  const safeStorage = fakeSafeStorage();
  const result = migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage });
  assert.deepEqual(result.migrated, ['admin_offline_secret']);
  assert.deepEqual(result.skipped, ['all_user_secrets', 'my_offline_secret']);
});

test('migrateOfflineSecretsToSafeStorage: is idempotent — a second run skips already-migrated keys', () => {
  const { getConfig, setConfig } = fakeConfigStore({ admin_offline_secret: 'admin-plain' });
  const safeStorage = fakeSafeStorage();
  migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage });
  const second = migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage });
  assert.deepEqual(second.migrated, []);
  assert.deepEqual(second.skipped, ['admin_offline_secret', 'all_user_secrets', 'my_offline_secret']);
});

const { encryptPasswordHashForCache, decryptPasswordHashFromCache, decryptPasswordHashOrFallback } = require('../secretsStore');

test('encryptPasswordHashForCache: round-trips through decryptPasswordHashFromCache', () => {
  const safeStorage = fakeSafeStorage();
  const ciphertext = encryptPasswordHashForCache('$2b$10$examplehash', safeStorage);
  assert.notEqual(ciphertext, '$2b$10$examplehash');
  assert.equal(decryptPasswordHashFromCache(ciphertext, safeStorage), '$2b$10$examplehash');
});

test('decryptPasswordHashOrFallback: decrypts a genuinely-encrypted hash normally', () => {
  const safeStorage = fakeSafeStorage();
  const ciphertext = encryptPasswordHashForCache('$2b$10$examplehash', safeStorage);
  assert.equal(decryptPasswordHashOrFallback(ciphertext, safeStorage), '$2b$10$examplehash');
});

test('decryptPasswordHashOrFallback: falls back to the raw value when decrypt fails (pre-Group-C plaintext row)', () => {
  const safeStorage = fakeSafeStorage();
  const plaintextHash = '$2b$10$plaintextlegacyhash';
  // A real bcrypt hash does not start with "ENC:", so fakeSafeStorage's
  // decryptString throws — exactly the shape of a not-yet-migrated row.
  assert.equal(decryptPasswordHashOrFallback(plaintextHash, safeStorage), plaintextHash);
});

test('decryptPasswordHashOrFallback: returns falsy input unchanged without calling safeStorage', () => {
  const safeStorage = {
    decryptString: () => { throw new Error('should not be called'); },
  };
  assert.equal(decryptPasswordHashOrFallback(null, safeStorage), null);
  assert.equal(decryptPasswordHashOrFallback('', safeStorage), '');
  assert.equal(decryptPasswordHashOrFallback(undefined, safeStorage), undefined);
});

const { enableSecureDelete, secureDeleteLocalCache } = require('../secretsStore');

function fakeDb() {
  const calls = [];
  return {
    pragma: (stmt) => { calls.push({ type: 'pragma', stmt }); },
    prepare: (sql) => ({ run: () => { calls.push({ type: 'run', sql }); } }),
    _calls: calls,
  };
}

test('enableSecureDelete: issues the secure_delete pragma', () => {
  const db = fakeDb();
  enableSecureDelete(db);
  assert.deepEqual(db._calls, [{ type: 'pragma', stmt: 'secure_delete = ON' }]);
});

test('secureDeleteLocalCache: deletes an allowlisted table', () => {
  const db = fakeDb();
  const result = secureDeleteLocalCache(db, 'gps_breadcrumbs', ['gps_breadcrumbs', 'pin_attempts']);
  assert.equal(result.ok, true);
  assert.equal(db._calls[0].sql, 'DELETE FROM gps_breadcrumbs');
});

test('secureDeleteLocalCache: rejects a table not on the allowlist', () => {
  const db = fakeDb();
  const result = secureDeleteLocalCache(db, 'users', ['gps_breadcrumbs', 'pin_attempts']);
  assert.equal(result.ok, false);
  assert.equal(db._calls.length, 0, 'must not run any SQL for a disallowed table');
});

const { verifyLocalDbIntegrity } = require('../secretsStore');

test('verifyLocalDbIntegrity: ok when the pragma returns the single "ok" row', () => {
  const db = { pragma: () => [{ integrity_check: 'ok' }] };
  assert.deepEqual(verifyLocalDbIntegrity(db), { ok: true });
});

test('verifyLocalDbIntegrity: reports errors when the pragma returns problem rows', () => {
  const db = { pragma: () => [{ integrity_check: 'row 4 missing from index idx_foo' }, { integrity_check: '*** in database main ***' }] };
  const result = verifyLocalDbIntegrity(db);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

const { restrictLocalDbFilePermissions } = require('../secretsStore');

function fakeFs({ existing = [], throwOnChmod = [] } = {}) {
  const chmoded = [];
  return {
    existsSync: (p) => existing.includes(p),
    chmodSync: (p, mode) => {
      if (throwOnChmod.includes(p)) {
        throw new Error(`EPERM: operation not permitted, chmod '${p}'`);
      }
      chmoded.push({ path: p, mode });
    },
    _chmoded: chmoded,
  };
}

test('restrictLocalDbFilePermissions: chmods the main db file to 0600', () => {
  const fs = fakeFs({ existing: ['/data/rmpg-local.db'] });
  const result = restrictLocalDbFilePermissions('/data/rmpg-local.db', fs);
  assert.equal(result.ok, true);
  assert.deepEqual(fs._chmoded[0], { path: '/data/rmpg-local.db', mode: 0o600 });
});

test('restrictLocalDbFilePermissions: also chmods -wal/-shm sidecars when present', () => {
  const fs = fakeFs({ existing: ['/data/rmpg-local.db', '/data/rmpg-local.db-wal', '/data/rmpg-local.db-shm'] });
  const result = restrictLocalDbFilePermissions('/data/rmpg-local.db', fs);
  assert.equal(result.chmoded.length, 3);
  assert.ok(result.chmoded.includes('/data/rmpg-local.db-wal'));
  assert.ok(result.chmoded.includes('/data/rmpg-local.db-shm'));
});

test('restrictLocalDbFilePermissions: skips sidecars that do not exist yet', () => {
  const fs = fakeFs({ existing: ['/data/rmpg-local.db'] });
  const result = restrictLocalDbFilePermissions('/data/rmpg-local.db', fs);
  assert.deepEqual(result.chmoded, ['/data/rmpg-local.db']);
});

test('restrictLocalDbFilePermissions: a sidecar whose chmodSync throws is logged and non-fatal', () => {
  const fs = fakeFs({
    existing: ['/data/rmpg-local.db', '/data/rmpg-local.db-wal', '/data/rmpg-local.db-shm'],
    throwOnChmod: ['/data/rmpg-local.db-wal'],
  });
  const originalConsoleError = console.error;
  const errorCalls = [];
  console.error = (...args) => { errorCalls.push(args); };
  let result;
  try {
    assert.doesNotThrow(() => {
      result = restrictLocalDbFilePermissions('/data/rmpg-local.db', fs);
    });
  } finally {
    console.error = originalConsoleError;
  }
  // Overall result still reflects success — the main db file chmod (the
  // only fatal path) succeeded; a sidecar-only failure is non-fatal.
  assert.equal(result.ok, true);
  // The failed sidecar was never actually chmoded, so it must not appear
  // in the returned chmoded list — but the main file and the other,
  // successfully-chmoded sidecar still should.
  assert.deepEqual(result.chmoded, ['/data/rmpg-local.db', '/data/rmpg-local.db-shm']);
  assert.ok(!result.chmoded.includes('/data/rmpg-local.db-wal'));
  // The failure was logged, not swallowed silently.
  assert.equal(errorCalls.length, 1);
  assert.ok(String(errorCalls[0][0]).includes('/data/rmpg-local.db-wal'));
});

const { redactSensitiveFieldsInLogs } = require('../secretsStore');

test('redactSensitiveFieldsInLogs: redacts a JWT-shaped token', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const redacted = redactSensitiveFieldsInLogs(`Authorization: Bearer ${jwt}`);
  assert.doesNotMatch(redacted, /eyJ/);
  assert.match(redacted, /\[REDACTED\]/);
});

test('redactSensitiveFieldsInLogs: redacts a PIN following the word "pin"', () => {
  const redacted = redactSensitiveFieldsInLogs('Employee entered PIN 482913 for auth');
  assert.doesNotMatch(redacted, /482913/);
  assert.match(redacted, /\[REDACTED\]/);
});

test('redactSensitiveFieldsInLogs: redacts known secret-key substrings', () => {
  const redacted = redactSensitiveFieldsInLogs('config lookup failed for admin_offline_secret');
  assert.doesNotMatch(redacted, /admin_offline_secret/);
});

test('redactSensitiveFieldsInLogs: leaves ordinary text untouched', () => {
  const text = 'Sync completed for calls_for_service: 42 rows';
  assert.equal(redactSensitiveFieldsInLogs(text), text);
});

const { encryptDiagnosticsBundleOnExport } = require('../secretsStore');

test('encryptDiagnosticsBundleOnExport: redacts sensitive content, then encrypts', () => {
  const safeStorage = fakeSafeStorage();
  const raw = 'Log dump — PIN 482913 was entered, admin_offline_secret lookup failed';
  const ciphertext = encryptDiagnosticsBundleOnExport(raw, safeStorage);
  // The ciphertext must not, even accidentally, contain the raw secret values
  assert.doesNotMatch(ciphertext, /482913/);
  // Decrypting recovers the REDACTED form, not the original raw secrets
  const decrypted = decryptSecretForStorage(ciphertext, safeStorage);
  assert.doesNotMatch(decrypted, /482913/);
  assert.match(decrypted, /\[REDACTED\]/);
});

const { validateBackupFileBeforeImport } = require('../secretsStore');

test('validateBackupFileBeforeImport: accepts a buffer starting with the SQLite magic header', () => {
  const header = Buffer.from('SQLite format 3\0', 'utf8');
  const fakeDbFile = Buffer.concat([header, Buffer.from('...rest of file...')]);
  assert.deepEqual(validateBackupFileBeforeImport(fakeDbFile), { ok: true });
});

test('validateBackupFileBeforeImport: rejects a buffer without the magic header', () => {
  const result = validateBackupFileBeforeImport(Buffer.from('not a sqlite file'));
  assert.equal(result.ok, false);
});

test('validateBackupFileBeforeImport: rejects a buffer shorter than the header', () => {
  const result = validateBackupFileBeforeImport(Buffer.from('short'));
  assert.equal(result.ok, false);
});

test('validateBackupFileBeforeImport: rejects a non-Buffer input', () => {
  const result = validateBackupFileBeforeImport('not a buffer');
  assert.equal(result.ok, false);
});

const { wipeSecretsOnLogout } = require('../secretsStore');

test('wipeSecretsOnLogout: wipes all three OFFLINE_SECRET_KEYS and reports them', () => {
  const { getConfig, setConfig } = fakeConfigStore({
    admin_offline_secret: 'admin-plain',
    all_user_secrets: '[{"user_id":1,"secret":"user-plain"}]',
    my_offline_secret: 'my-plain',
  });
  const result = wipeSecretsOnLogout(setConfig);
  assert.deepEqual(result.wiped.sort(), ['admin_offline_secret', 'all_user_secrets', 'my_offline_secret']);
  assert.equal(getConfig('admin_offline_secret'), '');
  assert.equal(getConfig('all_user_secrets'), '');
  assert.equal(getConfig('my_offline_secret'), '');
});
