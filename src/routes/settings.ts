// ============================================================
// RMPG Flex — User + Org Settings Sync
//
// Stores an opaque JSON blob of client preferences (voice, tones, map,
// ptt) so they follow a user across devices, and an org-wide defaults
// blob an admin can publish. Precedence is applied CLIENT-side
// (settingsSync.ts): org defaults < user blob < local edit.
//
//   GET  /api/settings        → { org, user, system }   (current user)
//   PUT  /api/settings/user   → upsert this user's blob
//   PUT  /api/settings/org    → upsert org defaults  (admin/manager)
//
// `system` is the effective flat map of the system_settings table
// (value ?? default_value) — the org-wide config edited in Admin →
// Console Settings. Every authenticated client receives it so it can
// actually APPLY branding/display/localization/report settings
// (SystemSettingsProvider on the client). Before this, Console Settings
// wrote 458 rows that nothing read.
//
// Tables created in migrations/0045_settings_sync.sql + 0049/0050 (system_settings).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { log } from '../utils/logger';

import { dbErrorResponse } from '../utils/dbErrors';
const settings = new Hono<Env>();

const ADMIN_ROLES = new Set(['admin', 'manager']);

function parseBlob(s: string | undefined | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// GET /api/settings → { org, user, system }
settings.get('/', async (c) => {
  const actor = c.get('user') as { id: number; role: string } | undefined;
  if (!actor) return c.json({ error: 'Authentication required' }, 401);

  try {
    const db = getDb(c.env);
    const [orgRow, userRow, systemRows] = await Promise.all([
      queryFirst<{ settings_json: string }>(db, 'SELECT settings_json FROM org_settings WHERE id = 1'),
      queryFirst<{ settings_json: string }>(db, 'SELECT settings_json FROM user_settings WHERE user_id = ?', actor.id),
      query<{ key: string; value: string | null; default_value: string | null }>(
        db, 'SELECT key, value, default_value FROM system_settings',
      ).catch(() => [] as { key: string; value: string | null; default_value: string | null }[]),
    ]);
    // Effective system map: admin value falls back to seeded default.
    const system: Record<string, string> = {};
    for (const r of systemRows) {
      const v = r.value ?? r.default_value;
      if (v != null) system[r.key] = v;
    }
    return c.json({ org: parseBlob(orgRow?.settings_json), user: parseBlob(userRow?.settings_json), system });
  } catch (err) {
    log.error('GET /settings failed', {}, err instanceof Error ? err : new Error(String(err)));
    // Soft-fail so the client falls back to local prefs rather than erroring.
    return c.json({ org: {}, user: {}, system: {} });
  }
});

// PUT /api/settings/user → upsert this user's blob
settings.put('/user', async (c) => {
  const actor = c.get('user') as { id: number; role: string } | undefined;
  if (!actor) return c.json({ error: 'Authentication required' }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Body must be a JSON object' }, 400);
  }

  try {
    const db = getDb(c.env);
    await execute(
      db,
      `INSERT INTO user_settings (user_id, settings_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = datetime('now')`,
      actor.id,
      JSON.stringify(body),
    );
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /settings/user failed', {}, err instanceof Error ? err : new Error(String(err)));
    return dbErrorResponse(c, err, 'Failed to save');
  }
});

// PUT /api/settings/org → upsert org defaults (admin/manager only)
settings.put('/org', async (c) => {
  const actor = c.get('user') as { id: number; role: string } | undefined;
  if (!actor) return c.json({ error: 'Authentication required' }, 401);
  if (!ADMIN_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Body must be a JSON object' }, 400);
  }

  try {
    const db = getDb(c.env);
    await execute(
      db,
      `INSERT INTO org_settings (id, settings_json, updated_at)
       VALUES (1, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = datetime('now')`,
      JSON.stringify(body),
    );
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /settings/org failed', {}, err instanceof Error ? err : new Error(String(err)));
    return dbErrorResponse(c, err, 'Failed to save');
  }
});

export default settings;
