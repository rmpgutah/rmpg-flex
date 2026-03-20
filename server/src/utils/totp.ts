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
  if (!key || key.length < 16) {
    throw new Error('TOTP encryption key is not configured or too short. Set TOTP_ENCRYPTION_KEY or JWT_SECRET (min 16 chars).');
  }
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

// ----------------------------------------------------------
// TOTP Replay Protection
// ----------------------------------------------------------
// Track recently used codes per user to prevent replay attacks.
// Key: `${userId}:${code}`, Value: expiry timestamp.
// Codes are valid for at most 90s (window ±1), so we expire entries after 120s.
const usedCodes = new Map<string, number>();
const REPLAY_TTL_MS = 120_000; // 2 minutes — covers full TOTP window + buffer

// Periodic cleanup to prevent memory growth (runs every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, expiry] of usedCodes) {
    if (now > expiry) usedCodes.delete(key);
  }
}, 300_000).unref();

/**
 * Verify a 6-digit TOTP code against a Base32 secret.
 * Allows a window of ±1 period (30s) to accommodate clock drift.
 * Includes replay protection: each code can only be used once per user within its validity window.
 * @param userId - User ID for replay tracking (pass 0 to skip replay check, e.g. during setup)
 * @param replayKey - Optional alternative key for replay tracking (e.g. username during login before userId is known)
 */
export function verifyTotpCode(secret: string, code: string, userId: number = 0, replayKey?: string): boolean {
  // Validate code format early — TOTP codes are exactly 6 digits.
  // Rejecting malformed input prevents unnecessary crypto operations.
  if (!/^\d{6}$/.test(code)) return false;

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
  if (delta === null) return false;

  // Replay protection: reject if this exact code was already used by this user.
  // When replayKey is provided (e.g. username during login), use it even if userId is 0.
  const effectiveKey = replayKey || (userId > 0 ? `${userId}` : '');
  if (effectiveKey) {
    const mapKey = `${effectiveKey}:${code}`;
    const now = Date.now();
    if (usedCodes.has(mapKey) && now <= usedCodes.get(mapKey)!) {
      return false; // Code already consumed — replay attempt
    }
    // Mark code as used
    usedCodes.set(mapKey, now + REPLAY_TTL_MS);
    // Cap map size to prevent memory exhaustion (10k entries max)
    if (usedCodes.size > 10_000) {
      // First pass: evict all expired entries
      for (const [k, expiry] of usedCodes) {
        if (now > expiry) usedCodes.delete(k);
      }
      // If still over limit after expiry cleanup, evict oldest 10%
      if (usedCodes.size > 10_000) {
        let toRemove = Math.ceil(usedCodes.size * 0.1);
        for (const k of usedCodes.keys()) {
          if (toRemove-- <= 0) break;
          usedCodes.delete(k);
        }
      }
    }
  }

  return true;
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
    hashed.push(bcryptjs.hashSync(formatted.replace('-', ''), config.security.bcryptRounds));
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

  // Validate format before bcrypt — backup codes are always 8 hex chars (XXXX-XXXX).
  // Rejecting malformed input early prevents bcrypt DoS with arbitrarily long strings.
  if (!/^[A-F0-9]{8}$/.test(normalized)) {
    return { valid: false, remainingCodes: hashedCodes };
  }

  for (let i = 0; i < hashedCodes.length; i++) {
    if (bcryptjs.compareSync(normalized, hashedCodes[i])) {
      // Remove the used code
      const remainingCodes = [...hashedCodes.slice(0, i), ...hashedCodes.slice(i + 1)];
      return { valid: true, remainingCodes };
    }
  }

  return { valid: false, remainingCodes: hashedCodes };
}
