import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

const featureFlags = new Hono<Env>();

// The 4 keys this endpoint is allowed to ever return. Deliberately an
// allowlist, not a SELECT * — system_config also stores plaintext
// third-party secrets (see the SECRET_KEY_PATTERN guard on the admin/manager-
// only GET /admin/system-settings), and this endpoint is open to every
// authenticated role, so it must never be able to leak a secret-shaped key
// even if one were accidentally saved under a similar name.
const FLAG_KEYS = [
  'feature_warrants',
  'feature_fleet',
  'feature_evidence',
  'feature_patrol_checkpoints',
] as const;

featureFlags.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ config_key: string; config_value: string }>(
      db,
      `SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?, ?)`,
      ...FLAG_KEYS,
    );
    const saved = new Map(rows.map((r) => [r.config_key, r.config_value]));
    const result: Record<string, boolean> = {};
    for (const key of FLAG_KEYS) {
      // Fail-open: an unsaved key means "no admin has touched this yet", which
      // must mean enabled (matches DEFAULT_SYSTEM_SETTINGS in AdminSystemTab.tsx,
      // where all 4 toggles default to '1'). Only an explicit '0' disables.
      result[key] = saved.get(key) !== '0';
    }
    return c.json(result);
  } catch (err) {
    // If system_config is missing or has the wrong schema, fail open — all
    // features default to enabled (matches the DEFAULT_SYSTEM_SETTINGS defaults).
    const result: Record<string, boolean> = {};
    for (const key of FLAG_KEYS) {
      result[key] = true;
    }
    return c.json(result);
  }
});

export default featureFlags;
