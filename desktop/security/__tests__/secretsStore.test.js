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
