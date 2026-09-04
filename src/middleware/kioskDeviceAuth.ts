import type { Context, Next } from 'hono';
import bcrypt from 'bcryptjs';
import type { D1Database } from '@cloudflare/workers-types';

interface DeviceRow {
  id: string;
  label: string;
  token_hash: string;
  status: string;
}

/**
 * Looks up device `deviceId` and bcrypt-compares `token` against its stored
 * hash. Returns the device's public identity on success, or null on any
 * failure (unknown device, wrong token, revoked status) — deliberately
 * undifferentiated so a caller can't probe which device ids exist.
 */
export async function authenticateDeviceToken(
  db: D1Database,
  deviceId: string,
  token: string,
): Promise<{ id: string; label: string } | null> {
  const row = await db
    .prepare('SELECT id, label, token_hash, status FROM kiosk_devices WHERE id = ?')
    .bind(deviceId)
    .first<DeviceRow>();
  if (!row || row.status !== 'active') return null;
  const matches = await bcrypt.compare(token, row.token_hash);
  if (!matches) return null;
  return { id: row.id, label: row.label };
}

// UUID v4 format: 8-4-4-4-12 hex groups
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hono middleware for device-authenticated Kiosk Linux endpoints
 * (check-in, upload). Distinct from the JWT authMiddleware — devices have
 * no user account and no JWT, only their per-device bearer token.
 */
export async function deviceAuthMiddleware(c: Context, next: Next) {
  const kioskDb = (c.env as { KIOSK_DB?: D1Database }).KIOSK_DB;
  if (!kioskDb) {
    return c.json({ ok: false, code: 'not_configured' }, 200);
  }
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  // Trim whitespace so a token with trailing newline/space doesn't fail bcrypt.
  const token = authHeader.slice(7).trim();
  const deviceId = c.req.param('id');
  if (!deviceId) {
    return c.json({ error: 'Device id is required' }, 400);
  }
  // Reject non-UUID ids before hitting D1 — our ids are always crypto.randomUUID().
  if (!UUID_RE.test(deviceId)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const device = await authenticateDeviceToken(kioskDb, deviceId, token);
  if (!device) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('kioskDevice', device);
  await next();
}
