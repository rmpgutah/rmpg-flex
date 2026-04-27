// ============================================================
// RMPG Flex — Business Alarm Field Encryption
// AES-256-GCM helpers for encrypting sensitive business
// fields (alarm codes, gate codes, key-holder PINs) at rest.
//
// Key derivation uses `JWT_SECRET + ':business-alarm'` so a
// JWT_SECRET rotation does not cross-contaminate with TOTP
// secrets (which derive from JWT_SECRET alone). Mirrors the
// stylistic conventions of `server/src/utils/totp.ts`.
//
// Ciphertext format: `<base64-iv>:<base64-tag>:<base64-data>`
// ============================================================

import crypto from 'crypto';

function deriveKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET required for alarm field encryption — refusing to encrypt with empty key');
  }
  // Domain separation from TOTP encryption — append a unique label
  return crypto.createHash('sha256').update(secret + ':business-alarm').digest();
}

/** Encrypt a business alarm field for storage. Returns `iv:tag:ciphertext` in base64. */
export function encryptAlarmField(plaintext: string | null): string | null {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Decrypt a stored alarm field. Returns null on malformed/tampered ciphertext. */
export function decryptAlarmField(ciphertext: string | null): string | null {
  if (ciphertext == null || ciphertext === '') return null;
  try {
    const [ivB64, tagB64, dataB64] = ciphertext.split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Malformed ciphertext or auth-tag mismatch — graceful failure
    return null;
  }
}
