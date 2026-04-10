/**
 * Shared AES-256-GCM encryption/decryption for system_config values.
 * Used by admin routes, geocode, DL records, lead scraper, etc.
 */
import crypto from 'crypto';
import { config } from '../config';

/** Derive the AES-256 key from JWT secret. */
function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

/** Encrypt a plaintext value using AES-256-GCM. Returns iv:authTag:ciphertext hex string. */
export function encryptConfigValue(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/** Decrypt an AES-256-GCM encrypted value (iv:authTag:ciphertext hex string). */
export function decryptConfigValue(stored: string): string {
  const key = deriveKey();
  const [ivHex, authTagHex, ciphertext] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Read and decrypt a config value from system_config by config_key.
 * Returns the decrypted value, or undefined if not found / decryption fails.
 */
export function readEncryptedConfig(configKey: string): string | undefined {
  try {
    // Lazy import to avoid circular dependency at module load time
    const { getDb } = require('../models/database');
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1"
    ).get(configKey) as { config_value: string } | undefined;
    if (row?.config_value) {
      return decryptConfigValue(row.config_value);
    }
  } catch {
    // DB not ready or decryption failed
  }
  return undefined;
}

/**
 * Resolve the Google Maps API key.
 * Priority: system_config (admin-managed) → GOOGLE_MAPS_API_KEY env var.
 */
export function resolveGoogleMapsApiKey(): string | undefined {
  return readEncryptedConfig('google_maps_api_key') || process.env.GOOGLE_MAPS_API_KEY;
}
