// ============================================================
// RMPG Flex — Symmetric envelope encryption (data-at-rest)
// ------------------------------------------------------------
// AES-256-GCM envelope encryption for DB columns, config blobs, and
// any at-rest payload.
//
// ── enc-v3 (current — fixes the enc-v2 IV-reuse vulnerability) ──
// The enc-v2 format used the raw master key DIRECTLY under AES-GCM
// for every field, with only a 12-byte random IV. After ~2^32 fields
// under the same long-lived key, the birthday bound makes IV collision
// likely — and a SINGLE IV reuse breaks AES-GCM catastrophically
// (two-time-pad on the keystream → plaintext recovery + tag forgery).
// For a CAD system encrypting millions of field values over years,
// this is within reach. enc-v3 fixes it by deriving a UNIQUE 256-bit
// subkey PER FIELD via HKDF(masterKey, salt=freshNonce, info), so a
// nonce collision requires BOTH the 128-bit HKDF salt AND the 96-bit
// GCM IV to repeat under the same subkey — effectively impossible
// (2^128 field budget). The master key never directly touches AES-GCM.
//
// Stored format:
//   enc-v3:<base64(nonce16)>:<base64(iv12)>:<base64(ciphertext||tag)>
//   - nonce = 16 random bytes → HKDF salt (per-field subkey derivation)
//   - iv    = 12 random bytes → AES-GCM nonce under the derived subkey
//   - the 16-byte GCM auth tag is appended by WebCrypto
//   - optional caller AAD is authenticated but not stored
//
// Key source: env.RMPG_PQ_MASTER_KEY (base64 32 bytes). Fail closed.
//
// Backward compat: enc-v2 blobs still decrypt (decryptBytes detects the
// version and uses the legacy direct-key path). New encryptions always
// emit enc-v3. Rotate by re-encrypting stored v2 blobs when convenient.
// ============================================================

import { CryptoConfigError, CryptoVerificationError } from './errors';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64decode,
  b64encode,
  fromUtf8,
  hkdf,
  importAesKey,
  importMasterKey,
  utf8,
} from './primitives';

const ENV_KEY_NAME = 'RMPG_PQ_MASTER_KEY';
const FORMAT_V3 = 'enc-v3';
const FORMAT_V2 = 'enc-v2';
const FIELD_KEY_INFO = utf8('RMPG-FLEX/envelope/field-key/v3');

export function isEncrypted(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  return value.startsWith(`${FORMAT_V3}:`) || value.startsWith(`${FORMAT_V2}:`);
}

/** Encrypt a UTF-8 string field. Returns `enc-v3:nonce:iv:ct`. */
export async function encryptField(
  plaintext: string,
  keyB64: string | undefined,
  aad?: Uint8Array,
): Promise<string> {
  return encryptBytes(utf8(plaintext), keyB64, aad);
}

/** Decrypt an `enc-v3:nonce:iv:ct` (or legacy `enc-v2:iv:ct`) blob to UTF-8. */
export async function decryptField(
  stored: string,
  keyB64: string | undefined,
  aad?: Uint8Array,
): Promise<string> {
  return fromUtf8(await decryptBytes(stored, keyB64, aad));
}

/** Encrypt raw bytes. Returns `enc-v3:nonce:iv:ct`. */
export async function encryptBytes(
  plaintext: Uint8Array,
  keyB64: string | undefined,
  aad?: Uint8Array,
): Promise<string> {
  const masterRaw = await importMasterKey(keyB64, ENV_KEY_NAME);
  try {
    // Per-field subkey: HKDF(masterKey, salt=freshNonce, info) → 32B CEK.
    // The salt is stored alongside the ciphertext so the same master key
    // re-derives the same subkey at decrypt time. A fresh salt per call
    // means every field has a UNIQUE AES key — IV collision under the
    // same subkey now requires the 16-byte salt to repeat first.
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(masterRaw, nonce, FIELD_KEY_INFO, 32);
    let key: CryptoKey;
    try {
      key = await importAesKey(cek);
    } finally {
      cek.fill(0); // zeroize the derived key bytes (limit A9: best-effort)
    }
    const { iv, ciphertext } = await aesGcmEncrypt(key, plaintext, aad);
    return `${FORMAT_V3}:${b64encode(nonce)}:${b64encode(iv)}:${b64encode(ciphertext)}`;
  } finally {
    masterRaw.fill(0); // zeroize the raw master key bytes after use
  }
}

export async function decryptBytes(
  stored: string,
  keyB64: string | undefined,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const parts = stored.split(':');

  // Legacy enc-v2 path: master-key-direct AES-GCM (pre-hardening).
  // Kept so already-stored v2 blobs keep decrypting; new writes go to v3.
  if (parts.length === 3 && parts[0] === FORMAT_V2) {
    return decryptV2(parts, keyB64, aad);
  }

  if (parts.length !== 4 || parts[0] !== FORMAT_V3) {
    throw new CryptoVerificationError(`Stored value is not in ${FORMAT_V3} or ${FORMAT_V2} format`);
  }

  const masterRaw = await importMasterKey(keyB64, ENV_KEY_NAME);
  try {
    let nonce: Uint8Array;
    let iv: Uint8Array;
    let ct: Uint8Array;
    try {
      nonce = b64decode(parts[1]);
      iv = b64decode(parts[2]);
      ct = b64decode(parts[3]);
    } catch {
      throw new CryptoVerificationError('Stored envelope has invalid base64');
    }
    if (nonce.length !== 16 || iv.length !== 12) {
      throw new CryptoVerificationError('Stored envelope has invalid field lengths');
    }
    const cek = await hkdf(masterRaw, nonce, FIELD_KEY_INFO, 32);
    let key: CryptoKey;
    try {
      key = await importAesKey(cek);
    } finally {
      cek.fill(0);
    }
    try {
      return await aesGcmDecrypt(key, iv, ct, aad);
    } catch {
      throw new CryptoVerificationError('Envelope failed AEAD verification (bad key or tampered value)');
    }
  } finally {
    masterRaw.fill(0);
  }
}

/** Legacy v2 decryptor — direct master key under AES-GCM (pre-hardening). */
async function decryptV2(
  parts: string[],
  keyB64: string | undefined,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const masterRaw = await importMasterKey(keyB64, ENV_KEY_NAME);
  try {
    const key = await importAesKey(masterRaw);
    let iv: Uint8Array;
    let ct: Uint8Array;
    try {
      iv = b64decode(parts[1]);
      ct = b64decode(parts[2]);
    } catch {
      throw new CryptoVerificationError('Stored v2 envelope has invalid base64');
    }
    if (iv.length !== 12) {
      throw new CryptoVerificationError('Stored v2 envelope has invalid IV length');
    }
    try {
      return await aesGcmDecrypt(key, iv, ct, aad);
    } catch {
      throw new CryptoVerificationError('v2 envelope failed AEAD verification');
    }
  } finally {
    masterRaw.fill(0);
  }
}

/** Encrypt a freshly generated per-record DEK with the master KEK, returning
 *  wrapped-dek material suitable for storing alongside the record. Uses the
 *  v3 per-field-subkey derivation so DEK wraps are also IV-collision-safe. */
export async function wrapDek(
  masterKeyB64: string | undefined,
): Promise<{ dek: Uint8Array; wrapped: string }> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await encryptBytes(dek, masterKeyB64);
  return { dek, wrapped };
}

export async function unwrapDek(masterKeyB64: string | undefined, wrapped: string): Promise<Uint8Array> {
  return decryptBytes(wrapped, masterKeyB64);
}

export { CryptoConfigError, CryptoVerificationError };