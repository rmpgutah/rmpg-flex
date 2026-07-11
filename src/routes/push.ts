// ============================================================
// Device push token registration.
// ============================================================
// Storage/registration only. The iOS PushManager already computes an APNs
// device token on launch (UIApplicationDelegate's didRegisterForRemoteNotifications
// callback) but had nowhere on this Worker to send it — no route or table
// existed anywhere to persist it, so registering for push has never actually
// reached the server; every install's token was computed and then discarded.
//
// Actually SENDING a push via APNs is a separate, later step: it needs an
// Apple Push Notification Auth Key (.p8), Team ID, and Key ID provisioned as
// Worker secrets (APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID) so the Worker can sign
// a JWT and call api.push.apple.com over HTTP/2 — none of that exists yet.
//
//   POST   /api/push/register    {device_token, platform?}   upsert my token
//   DELETE /api/push/register    {device_token}               remove on logout
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, execute } from '../utils/db';

const push = new Hono<Env>();

push.post('/register', async (c) => {
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ device_token?: string; platform?: string }>().catch(() => ({} as any));
  const deviceToken = typeof body.device_token === 'string' ? body.device_token.trim() : '';
  if (!deviceToken) return c.json({ error: 'device_token required' }, 400);
  const platform = typeof body.platform === 'string' && body.platform ? body.platform : 'ios';

  const db = getDb(c.env);
  try {
    // Upsert keyed on the unique device_token — the same physical device
    // re-registering (relaunch, reinstall under the same user) updates the
    // owner instead of erroring on the UNIQUE constraint or creating a
    // duplicate row for the same token.
    await execute(
      db,
      `INSERT INTO push_tokens (user_id, device_token, platform, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(device_token) DO UPDATE SET
         user_id = excluded.user_id, platform = excluded.platform, updated_at = datetime('now')`,
      userId, deviceToken, platform,
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to register device token' }, 500);
  }
});

push.delete('/register', async (c) => {
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ device_token?: string }>().catch(() => ({} as any));
  const deviceToken = typeof body.device_token === 'string' ? body.device_token.trim() : '';
  if (!deviceToken) return c.json({ error: 'device_token required' }, 400);

  const db = getDb(c.env);
  try {
    await execute(db, 'DELETE FROM push_tokens WHERE device_token = ? AND user_id = ?', deviceToken, userId);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to unregister device token' }, 500);
  }
});

push.get('/status', async (c) => {
  const userId = c.get('userId') as number;
  const db = getDb(c.env);
  const tokens = await query<{ device_token: string; platform: string; updated_at: string }>(
    db, 'SELECT device_token, platform, updated_at FROM push_tokens WHERE user_id = ? ORDER BY updated_at DESC', userId,
  );
  return c.json({ registered: tokens.length > 0, tokens });
});

export default push;
