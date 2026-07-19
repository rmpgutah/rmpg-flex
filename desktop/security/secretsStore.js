// ============================================================
// RMPG Flex — Secrets Store
// Local-data-protection hardening: OS-keychain-backed secret
// encryption (Electron safeStorage), plaintext-secret migration,
// cached password_hash encryption, secure cache deletion, local
// DB integrity verification, SQLite file permission restriction.
// Every function takes its Electron/Node dependency as a
// parameter rather than requiring it internally, so this file
// has zero real-runtime dependency and is fully unit-testable.
// ============================================================

'use strict';

/**
 * Encrypts plaintext via Electron's safeStorage (OS keychain-backed on
 * macOS Keychain / Windows DPAPI / Linux Secret Service) and returns a
 * base64 string suitable for storage in a SQLite TEXT column.
 */
function encryptSecretForStorage(plaintext, safeStorage) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('plaintext must be a string');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption is not available on this machine');
  }
  return safeStorage.encryptString(plaintext).toString('base64');
}

/** Inverse of encryptSecretForStorage. */
function decryptSecretForStorage(ciphertextBase64, safeStorage) {
  if (typeof ciphertextBase64 !== 'string') {
    throw new TypeError('ciphertextBase64 must be a string');
  }
  return safeStorage.decryptString(Buffer.from(ciphertextBase64, 'base64'));
}

const OFFLINE_SECRET_KEYS = ['admin_offline_secret', 'all_user_secrets', 'my_offline_secret'];
// Every value this module encrypts is base64 — plaintext legacy values
// are plain JSON/strings and will not parse as valid base64-of-our-format.
// We detect "already migrated" by attempting a decrypt: if it succeeds,
// it was already ciphertext; if safeStorage throws, treat it as plaintext
// still needing migration. This makes the migration self-idempotent
// without a separate sentinel key that could itself drift out of sync.
function looksAlreadyMigrated(value, safeStorage) {
  try {
    decryptSecretForStorage(value, safeStorage);
    return true;
  } catch {
    return false;
  }
}

/**
 * One-time migration moving the three plaintext offline-PIN secrets
 * (desktop/pinManager.js:80,103-104) out of local_config's plaintext
 * storage into safeStorage-encrypted form, in place (same keys).
 * Safe to call on every startup — already-migrated keys are skipped.
 */
function migrateOfflineSecretsToSafeStorage({ getConfig, setConfig, safeStorage }) {
  const migrated = [];
  const skipped = [];
  for (const key of OFFLINE_SECRET_KEYS) {
    const value = getConfig(key);
    if (!value) {
      skipped.push(key);
      continue;
    }
    if (looksAlreadyMigrated(value, safeStorage)) {
      skipped.push(key);
      continue;
    }
    setConfig(key, encryptSecretForStorage(value, safeStorage));
    migrated.push(key);
  }
  return { migrated, skipped };
}

/**
 * Semantically-named wrappers around encryptSecretForStorage/
 * decryptSecretForStorage for the cached users.password_hash column
 * specifically — same mechanism today, kept as distinct exports so a
 * future password-hash-specific change (e.g. an added integrity tag)
 * doesn't ripple into unrelated secret call sites.
 */
function encryptPasswordHashForCache(passwordHash, safeStorage) {
  return encryptSecretForStorage(passwordHash, safeStorage);
}

function decryptPasswordHashFromCache(ciphertext, safeStorage) {
  return decryptSecretForStorage(ciphertext, safeStorage);
}

/**
 * Fail-safe variant of decryptPasswordHashFromCache for read sites that may
 * encounter a users.password_hash value written before the encrypted-write
 * path (localDb.js's upsertUserWithEncryptedHash) was wired into
 * syncManager.js — i.e. rows still holding a legacy plaintext bcrypt hash.
 * Same "attempt decrypt, fall back to raw on failure" shape as
 * pinManager.js's readSecretConfig(). A decrypt failure here is an expected
 * transitional state (every un-migrated cached user hits it until the sync
 * side is cut over), not an anomaly — do not log at error/warn level.
 */
function decryptPasswordHashOrFallback(hash, safeStorage) {
  if (!hash) return hash;
  try {
    return decryptPasswordHashFromCache(hash, safeStorage);
  } catch {
    // Not our ciphertext — treat as an already-plaintext legacy value
    // rather than throwing and breaking offline login.
    return hash;
  }
}

/** SQLite's own secure-delete: overwrites freed page content with zeros. */
function enableSecureDelete(db) {
  db.pragma('secure_delete = ON');
}

/**
 * Deletes all rows from an allowlisted table. The allowlist is passed in
 * by the caller (rather than hardcoded here) so this stays a generic,
 * reusable primitive — Group C's future clearLocalCache(table) handler
 * is expected to be the real caller, passing the actual mirror-table
 * list from localDb.js's schema.
 */
function secureDeleteLocalCache(db, table, allowedTables) {
  if (!allowedTables.includes(table)) {
    return { ok: false, error: `table "${table}" is not in the allowed list` };
  }
  db.prepare(`DELETE FROM ${table}`).run();
  return { ok: true };
}

/**
 * Runs SQLite's built-in integrity_check. A healthy database returns
 * exactly one row, { integrity_check: 'ok' } — anything else (including
 * multiple rows) indicates corruption/tampering.
 */
function verifyLocalDbIntegrity(db) {
  const rows = db.pragma('integrity_check');
  if (rows.length === 1 && rows[0].integrity_check === 'ok') {
    return { ok: true };
  }
  return { ok: false, errors: rows.map((r) => r.integrity_check) };
}

/**
 * Restricts the local SQLite database file — and its WAL-mode sidecar
 * files, which can hold the same sensitive row data mid-transaction —
 * to owner-only read/write (0600). Best-effort: a missing sidecar (not
 * yet created, WAL mode not yet active) is not an error.
 */
function restrictLocalDbFilePermissions(dbPath, fsModule) {
  const chmoded = [];
  try {
    fsModule.chmodSync(dbPath, 0o600);
    chmoded.push(dbPath);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fsModule.existsSync(sidecar)) {
      try {
        fsModule.chmodSync(sidecar, 0o600);
        chmoded.push(sidecar);
      } catch (err) {
        // Sidecar chmod failures are logged but non-fatal (see doc comment
        // above) — a WAL/SHM sidecar can vanish between the existsSync
        // check and this call (checkpoint race), or hit a permission
        // error independent of the main db file. Either way, local DB
        // init must not crash over a sidecar-only failure.
        console.error(`[LOCAL-DB] Failed to restrict permissions on sidecar ${sidecar}:`, err.message);
      }
    }
  }
  return { ok: true, chmoded };
}

module.exports = {
  encryptSecretForStorage,
  decryptSecretForStorage,
  migrateOfflineSecretsToSafeStorage,
  encryptPasswordHashForCache,
  decryptPasswordHashFromCache,
  decryptPasswordHashOrFallback,
  enableSecureDelete,
  secureDeleteLocalCache,
  verifyLocalDbIntegrity,
  restrictLocalDbFilePermissions,
};
