// ============================================================
// RMPG Flex — Field-Level Encryption (libsodium)
// ============================================================
// CJIS-compliant encryption for PII fields in SQLite using
// libsodium's authenticated encryption (XChaCha20-Poly1305).
// Provides encrypt/decrypt for individual field values,
// plus utilities for hashing and key derivation.
// ============================================================

import sodium from 'libsodium-wrappers';
import { logger } from './logger';

let initialized = false;

/**
 * Initialize libsodium (must be called once before using other functions).
 * Safe to call multiple times — idempotent.
 */
export async function initEncryption(): Promise<void> {
  if (initialized) return;
  await sodium.ready;
  initialized = true;
  logger.info('libsodium encryption engine initialized');
}

/**
 * Derive a 256-bit encryption key from a passphrase using Argon2id.
 * The salt should be stored alongside encrypted data (it's not secret).
 */
export function deriveKey(passphrase: string, salt?: Uint8Array): { key: Uint8Array; salt: Uint8Array } {
  ensureInit();
  const s = salt || sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    s,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
  return { key, salt: s };
}

/**
 * Generate a random 256-bit encryption key.
 */
export function generateKey(): Uint8Array {
  ensureInit();
  return sodium.crypto_secretbox_keygen();
}

/**
 * Encrypt a string value using XChaCha20-Poly1305 (authenticated encryption).
 * Returns a base64-encoded string containing nonce + ciphertext.
 * Format: base64(nonce || ciphertext)
 */
export function encryptField(plaintext: string, key: Uint8Array): string {
  ensureInit();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(
    sodium.from_string(plaintext),
    nonce,
    key
  );
  // Concatenate nonce + ciphertext and base64-encode
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  return sodium.to_base64(combined, sodium.base64_variants.ORIGINAL);
}

/**
 * Decrypt a field value encrypted with encryptField().
 * Returns the original plaintext string, or null if decryption fails
 * (wrong key, tampered data, etc.)
 */
export function decryptField(encrypted: string, key: Uint8Array): string | null {
  ensureInit();
  try {
    const combined = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL);
    const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
    if (combined.length < nonceLen + sodium.crypto_secretbox_MACBYTES) {
      return null; // Too short to be valid
    }
    const nonce = combined.slice(0, nonceLen);
    const ciphertext = combined.slice(nonceLen);
    const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
    return sodium.to_string(plaintext);
  } catch {
    return null; // Decryption failed — wrong key or tampered data
  }
}

/**
 * Hash a value deterministically (e.g., for indexing encrypted fields).
 * Uses BLAKE2b-256. NOT reversible — for lookups, not storage.
 */
export function hashValue(value: string, context = ''): string {
  ensureInit();
  const input = context ? `${context}:${value}` : value;
  const hash = sodium.crypto_generichash(32, sodium.from_string(input), null);
  return sodium.to_hex(hash);
}

/**
 * Generate a secure random token (for API keys, session tokens, etc.)
 */
export function generateToken(bytes = 32): string {
  ensureInit();
  return sodium.to_base64(
    sodium.randombytes_buf(bytes),
    sodium.base64_variants.URLSAFE_NO_PADDING
  );
}

/**
 * Constant-time string comparison (prevents timing attacks).
 */
export function secureCompare(a: string, b: string): boolean {
  ensureInit();
  // Pad to same length to avoid length-leak
  const maxLen = Math.max(a.length, b.length);
  const aBuf = sodium.from_string(a.padEnd(maxLen, '\0'));
  const bBuf = sodium.from_string(b.padEnd(maxLen, '\0'));
  return sodium.memcmp(aBuf, bBuf) && a.length === b.length;
}

/**
 * Sign data with Ed25519 (for tamper-evident audit entries).
 * Returns base64-encoded signature.
 */
export function signData(
  data: string,
  privateKey: Uint8Array
): string {
  ensureInit();
  const signature = sodium.crypto_sign_detached(
    sodium.from_string(data),
    privateKey
  );
  return sodium.to_base64(signature, sodium.base64_variants.ORIGINAL);
}

/**
 * Verify an Ed25519 signature.
 */
export function verifySignature(
  data: string,
  signature: string,
  publicKey: Uint8Array
): boolean {
  ensureInit();
  try {
    const sig = sodium.from_base64(signature, sodium.base64_variants.ORIGINAL);
    return sodium.crypto_sign_verify_detached(
      sig,
      sodium.from_string(data),
      publicKey
    );
  } catch {
    return false;
  }
}

/**
 * Generate an Ed25519 keypair for signing.
 */
export function generateSigningKeypair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  ensureInit();
  const keypair = sodium.crypto_sign_keypair();
  return { publicKey: keypair.publicKey, privateKey: keypair.privateKey };
}

// ── Internal ──────────────────────────────────────────────

function ensureInit(): void {
  if (!initialized) {
    throw new Error('Encryption not initialized — call initEncryption() first');
  }
}
