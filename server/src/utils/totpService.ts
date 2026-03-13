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
  // Derive a 32-byte key from the configured hex string
  const keyHex = twoFactorConfig().encryptionKey;
  if (!keyHex) throw new Error('TOTP encryption key is not configured. Check config.twoFactor.encryptionKey.');
  return Buffer.from(keyHex.slice(0, 64).padEnd(64, '0'), 'hex');
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
// Codes with window=1 are valid for ~90 seconds, so we keep
// entries for 120 seconds to cover clock skew safely.

const REPLAY_WINDOW_MS = 120_000; // 2 minutes
const MAX_REPLAY_ENTRIES = 1000;   // cap to prevent unbounded growth
const usedCodes = new Map<string, number>(); // "userId:code" → timestamp

// Clean up expired entries every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - REPLAY_WINDOW_MS;
  for (const [key, ts] of usedCodes) {
    if (ts < cutoff) usedCodes.delete(key);
  }
}, REPLAY_WINDOW_MS).unref();

/** Check if a TOTP code was already used for this user within the replay window. */
export function isTotpCodeUsed(userId: number, code: string): boolean {
  const key = `${userId}:${code}`;
  const ts = usedCodes.get(key);
  if (!ts) return false;
  // Expired entries are treated as unused
  return (Date.now() - ts) < REPLAY_WINDOW_MS;
}

/** Mark a TOTP code as used for this user. */
export function markTotpCodeUsed(userId: number, code: string): void {
  // Enforce size cap — evict oldest entries if at limit
  if (usedCodes.size >= MAX_REPLAY_ENTRIES) {
    const oldest = [...usedCodes.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < Math.ceil(MAX_REPLAY_ENTRIES / 4); i++) {
      usedCodes.delete(oldest[i][0]);
    }
  }
  usedCodes.set(`${userId}:${code}`, Date.now());
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
    // 8-character alphanumeric codes (uppercase for readability)
    const bytes = crypto.randomBytes(5);
    const code = bytes.toString('hex').slice(0, 8).toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  // Normalize: remove dashes, uppercase
  const normalized = code.replace(/-/g, '').toUpperCase();
  return bcryptjs.hashSync(normalized, 10);
}

export function verifyBackupCode(code: string, hash: string): boolean {
  const normalized = code.replace(/-/g, '').toUpperCase();
  return bcryptjs.compareSync(normalized, hash);
}
