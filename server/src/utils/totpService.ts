import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcryptjs from 'bcryptjs';
import config from '../config';

const ALGORITHM = 'aes-256-gcm';

// Safe accessors with fallbacks in case config.twoFactor is undefined
const twoFactorConfig = () => config.twoFactor || {} as Record<string, any>;

// ─── TOTP Secret Generation ──────────────────────────

export function generateTotpSecret(username: string): { secret: OTPAuth.Secret; uri: string } {
  const totp = new OTPAuth.TOTP({
    issuer: twoFactorConfig().issuer || 'RMPG Flex',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });

  return {
    secret: totp.secret,
    uri: totp.toString(),
  };
}

// ─── AES-256-GCM Encryption ─────────────────────────

function getEncryptionKey(): Buffer {
  // Derive a 32-byte key using HKDF-SHA256 from the configured key material.
  // This is safe regardless of input length and avoids the old slice+pad weakness.
  const keyMaterial = twoFactorConfig().encryptionKey;
  if (!keyMaterial) throw new Error('TOTP encryption key is not configured. Check config.twoFactor.encryptionKey.');
  return Buffer.from(crypto.hkdfSync('sha256', keyMaterial, '', 'rmpg-totp-encryption', 32));
}

export function encryptSecret(plainSecret: string): { encrypted: string; iv: string; tag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decryptSecret(encrypted: string, ivHex: string, tagHex: string): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─── QR Code Generation ─────────────────────────────

export async function generateQRCodeDataUri(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, {
    width: 256,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

// ─── TOTP Replay Protection ──────────────────────────
// Track used TOTP codes per user to prevent replay attacks.
// Persisted to SQLite so replay protection survives server restarts.
// Codes with window=1 are valid for ~90 seconds, so we keep
// entries for 120 seconds to cover clock skew safely.

import { getDb } from '../models/database';

const REPLAY_WINDOW_SECONDS = 120; // 2 minutes

let replayTableInitialized = false;
function ensureReplayTable(): void {
  if (replayTableInitialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS totp_used_codes (
      user_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, code_hash)
    )
  `);
  replayTableInitialized = true;
}

// Clean up expired entries every 2 minutes
setInterval(() => {
  try {
    ensureReplayTable();
    const db = getDb();
    const cutoff = Math.floor(Date.now() / 1000);
    db.prepare('DELETE FROM totp_used_codes WHERE expires_at < ?').run(cutoff);
  } catch { /* DB may not be ready yet */ }
}, 120_000).unref();

function hashCode(userId: number, code: string): string {
  return crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

/** Check if a TOTP code was already used for this user within the replay window. */
export function isTotpCodeUsed(userId: number, code: string): boolean {
  ensureReplayTable();
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    'SELECT 1 FROM totp_used_codes WHERE user_id = ? AND code_hash = ? AND expires_at > ?'
  ).get(userId, hashCode(userId, code), now);
  return !!row;
}

/** Mark a TOTP code as used for this user. */
export function markTotpCodeUsed(userId: number, code: string): void {
  ensureReplayTable();
  const db = getDb();
  const expiresAt = Math.floor(Date.now() / 1000) + REPLAY_WINDOW_SECONDS;
  db.prepare(
    'INSERT OR REPLACE INTO totp_used_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)'
  ).run(userId, hashCode(userId, code), expiresAt);
}

// ─── TOTP Verification ──────────────────────────────

export function verifyTotpToken(secretBase32: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });

  // Window of 1 allows current, previous, and next period (±30 seconds)
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

// ─── Backup Code Generation ─────────────────────────

export function generateBackupCodes(count: number = twoFactorConfig().backupCodeCount || 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 12-character hex codes (48 bits of entropy) formatted as XXXX-XXXX-XXXX
    const bytes = crypto.randomBytes(6); // 6 bytes = 48 bits
    const hex = bytes.toString('hex').toUpperCase(); // 12 hex chars
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  // Normalize: remove dashes, uppercase
  const normalized = code.replace(/-/g, '').toUpperCase();
  return bcryptjs.hashSync(normalized, 12);
}

export function verifyBackupCode(code: string, hash: string): boolean {
  const normalized = code.replace(/-/g, '').toUpperCase();
  return bcryptjs.compareSync(normalized, hash);
}
