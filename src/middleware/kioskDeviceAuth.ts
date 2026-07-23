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
  const token = authHeader.slice(7);
  const deviceId = c.req.param('id');
  if (!deviceId) {
    return c.json({ error: 'Device id is required' }, 400);
  }
  const device = await authenticateDeviceToken(kioskDb, deviceId, token);
  if (!device) {
    return c.json({ error: 'Invalid or revoked device token' }, 401);
  }
  c.set('kioskDevice', device);
  await next();
}
