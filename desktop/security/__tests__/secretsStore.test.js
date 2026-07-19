'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptSecretForStorage, decryptSecretForStorage } = require('../secretsStore');

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
