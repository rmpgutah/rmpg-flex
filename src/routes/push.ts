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
import { getDb, query, queryFirst, execute } from '../utils/db';
import { log } from '../utils/logger';
import { sendPushover, resolveAppToken } from '../utils/pushover';

const push = new Hono<Env>();

// ── Pushover per-user key management ──────────────────────────────────────────

/**
 * GET /api/push/pushover/status
 * Returns whether this user has a Pushover user key configured and whether
 * the org-level app token is available.
 */
push.get('/pushover/status', async (c) => {
  const userId = c.get('userId') as number;
  const db = getDb(c.env);
  const [row, appToken] = await Promise.all([
    queryFirst<{ settings_json: string }>(db, 'SELECT settings_json FROM user_settings WHERE user_id = ?', userId),
    resolveAppToken(db, c.env.PUSHOVER_APP_TOKEN),
  ]);
  let hasUserKey = false;
  try {
    const blob = JSON.parse(row?.settings_json ?? '{}');
    hasUserKey = typeof blob?.pushover_user_key === 'string' && blob.pushover_user_key.trim().length > 0;
  } catch { /* ignore */ }
  return c.json({ configured: hasUserKey, app_token_available: !!appToken });
});

/**
 * POST /api/push/pushover/register
 * Body: { user_key: string }
 * Saves the Pushover user key into this user's settings JSON blob.
 */
push.post('/pushover/register', async (c) => {
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ user_key?: string }>().catch(() => ({} as any));
  const userKey = typeof body.user_key === 'string' ? body.user_key.trim() : '';
  if (!userKey) return c.json({ error: 'user_key required' }, 400);
  // Validate format: Pushover user keys are 30 chars, alphanumeric
  if (!/^[a-z0-9]{20,40}$/i.test(userKey)) {
    return c.json({ error: 'Invalid Pushover user key format' }, 400);
  }

  const db = getDb(c.env);
  try {
    const existing = await queryFirst<{ settings_json: string }>(
      db, 'SELECT settings_json FROM user_settings WHERE user_id = ?', userId,
    );
    let blob: Record<string, unknown> = {};
    try { blob = JSON.parse(existing?.settings_json ?? '{}'); } catch { /* ignore */ }
    blob.pushover_user_key = userKey;
    await execute(
      db,
      `INSERT INTO user_settings (user_id, settings_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = datetime('now')`,
      userId, JSON.stringify(blob),
    );
    return c.json({ success: true });
  } catch (err) {
    log.error('POST /push/pushover/register failed', { userId }, err);
    return c.json({ error: 'Failed to save Pushover user key' }, 500);
  }
});

/**
 * DELETE /api/push/pushover/register
 * Removes the Pushover user key from this user's settings.
 */
push.delete('/pushover/register', async (c) => {
  const userId = c.get('userId') as number;
  const db = getDb(c.env);
  try {
    const existing = await queryFirst<{ settings_json: string }>(
      db, 'SELECT settings_json FROM user_settings WHERE user_id = ?', userId,
    );
    let blob: Record<string, unknown> = {};
    try { blob = JSON.parse(existing?.settings_json ?? '{}'); } catch { /* ignore */ }
    delete blob.pushover_user_key;
    await execute(
      db,
      `INSERT INTO user_settings (user_id, settings_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = datetime('now')`,
      userId, JSON.stringify(blob),
    );
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /push/pushover/register failed', { userId }, err);
    return c.json({ error: 'Failed to remove Pushover user key' }, 500);
  }
});

/**
 * POST /api/push/pushover/test
 * Fires a test Pushover notification to the calling user using their saved key.
 * Requires the org-level app token to be configured.
 */
push.post('/pushover/test', async (c) => {
  const userId = c.get('userId') as number;
  const db = getDb(c.env);

  const [row, appToken] = await Promise.all([
    queryFirst<{ settings_json: string }>(db, 'SELECT settings_json FROM user_settings WHERE user_id = ?', userId),
    resolveAppToken(db, c.env.PUSHOVER_APP_TOKEN),
  ]);

  if (!appToken) {
    return c.json({ ok: false, code: 'app_token_not_configured',
      message: 'Pushover app token is not configured. Ask an admin to set the pushover_api_key in Admin → Integrations.' }, 200);
  }

  let userKey = '';
  try {
    const blob = JSON.parse(row?.settings_json ?? '{}');
    if (typeof blob?.pushover_user_key === 'string') userKey = blob.pushover_user_key.trim();
  } catch { /* ignore */ }

  if (!userKey) {
    return c.json({ ok: false, code: 'user_key_not_configured',
      message: 'No Pushover user key found. Register your key first at Profile → Notifications.' }, 200);
  }

  const result = await sendPushover(appToken, userKey, {
    title: 'RMPG Flex — Test Notification',
    message: 'Push notifications are working correctly for your account.',
    priority: 0,
    sound: 'magic',
    timestamp: Math.floor(Date.now() / 1000),
  });

  if (result.ok) {
    return c.json({ ok: true, message: 'Test notification sent successfully.' });
  }
  return c.json({ ok: false, code: 'send_failed', errors: result.errors }, 200);
});

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
    log.error('POST /register failed', { src: 'src/routes/push.ts' }, err);
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
    log.error('DELETE /register failed', { src: 'src/routes/push.ts' }, err);
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
