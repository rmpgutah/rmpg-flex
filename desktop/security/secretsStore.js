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

module.exports = {
  encryptSecretForStorage,
  decryptSecretForStorage,
};
