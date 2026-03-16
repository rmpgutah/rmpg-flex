// ============================================================
// RMPG Flex — TOTP Two-Factor Authentication Utilities
// Handles secret generation, QR codes, verification, backup
// codes, and AES-256-GCM encryption for secrets at rest.
// ============================================================

import crypto from 'crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import bcryptjs from 'bcryptjs';
import config from '../config';

// ----------------------------------------------------------
// AES-256-GCM Encryption for TOTP secrets at rest
// ----------------------------------------------------------

function deriveKey(): Buffer {
  const key = config.totp?.encryptionKey || config.jwt.secret;
  // Derive a 32-byte key from the config secret using SHA-256
  return crypto.createHash('sha256').update(key).digest();
}

/** Encrypt a TOTP secret for storage. Returns `iv:authTag:ciphertext` in hex. */
export function encryptSecret(secret: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt a stored TOTP secret. */
export function decryptSecret(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = deriveKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  const secret = decrypted.toString('utf8');
  if (!/^[A-Z2-7]+=*$/.test(secret)) {
    throw new Error('Decrypted TOTP secret is not valid base32');
  }
  return secret;
}

// ----------------------------------------------------------
// TOTP Generation & Verification
// ----------------------------------------------------------

const ISSUER = 'RMPG Flex';
const DIGITS = 6;
const PERIOD = 30; // seconds

/** Generate a new TOTP secret and otpauth URI for a user. */
export function generateTotpSecret(username: string): {
  secret: string;       // Base32-encoded secret
  otpauthUrl: string;   // Full otpauth:// URI for authenticator apps
} {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD,
  });

  return {
    secret: totp.secret.base32,
    otpauthUrl: totp.toString(),
  };
}

/** Generate a QR code data URL (PNG) from an otpauth URI. */
export async function generateQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, {
    width: 256,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

/**
 * Verify a 6-digit TOTP code against a Base32 secret.
 * Allows a window of ±1 period (30s) to accommodate clock drift.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  // validate() returns the time step difference (0 = exact match, ±1 = drift)
  // or null if invalid
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

// ----------------------------------------------------------
// Backup / Recovery Codes
// ----------------------------------------------------------

/** Generate one-time backup codes. Returns plain (shown once) and hashed (stored). */
export function generateBackupCodes(count: number = 10): {
  plain: string[];    // Show these to user exactly once
  hashed: string[];   // Store these (bcrypt-hashed)
} {
  const plain: string[] = [];
  const hashed: string[] = [];

  for (let i = 0; i < count; i++) {
    // 8-character alphanumeric code, grouped as XXXX-XXXX for readability
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    plain.push(formatted);
    hashed.push(bcryptjs.hashSync(formatted.replace('-', ''), 12)); // Hash without dash
  }

  return { plain, hashed };
}

/**
 * Verify a backup code against stored hashes. One-time use — if valid, the
 * matching hash is removed from the array.
 * Returns the updated hashes array (caller must persist).
 */
export function verifyBackupCode(
  code: string,
  hashedCodes: string[],
): { valid: boolean; remainingCodes: string[] } {
  const normalized = code.replace(/[-\s]/g, '').toUpperCase();

  for (let i = 0; i < hashedCodes.length; i++) {
    if (bcryptjs.compareSync(normalized, hashedCodes[i])) {
      // Remove the used code
      const remainingCodes = [...hashedCodes.slice(0, i), ...hashedCodes.slice(i + 1)];
      return { valid: true, remainingCodes };
    }
  }

  return { valid: false, remainingCodes: hashedCodes };
}
