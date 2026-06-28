import crypto from 'crypto';

/**
 * Hash an API key using HMAC-SHA256 with a server-side secret.
 * HMAC prevents rainbow table attacks even if the database is compromised.
 * Falls back to a static key if JWT_SECRET is not set (dev only).
 */
const HMAC_SECRET = process.env.JWT_SECRET || 'rmpg-flex-secret-change-me-in-production-2024';

export function hashApiKey(apiKey: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(apiKey).digest('hex');
}
