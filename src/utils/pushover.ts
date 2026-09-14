// ============================================================
// Pushover push notification client — Worker-safe (fetch only, no node:*)
//
// Pushover requires two credentials per send:
//   token     = app API token (org-level, stored as config_item 'pushover_api_key'
//               OR as Worker secret PUSHOVER_APP_TOKEN — env binding takes priority)
//   user      = recipient's Pushover user key (per-user, stored in user_settings
//               JSON as pushover_user_key)
//
// Priority:
//   -2  lowest (no notification)
//   -1  quiet  (no sound/vibration)
//    0  normal
//    1  high   (bypasses quiet hours)
//    2  emergency — requires retry + expire (not used here; use priority 1 for critical)
//
// Sounds: pushover, bike, bugle, cashregister, classical, cosmic, falling, gamelan,
//         incoming, intermission, magic, mechanical, pianobar, siren, spacealarm,
//         tugboat, alien, climb, persistent, echo, updown, vibrate, none
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, query } from './db';
import { log } from './logger';

const PUSHOVER_API = 'https://api.pushover.net/1/messages.json';
const SEND_TIMEOUT_MS = 8_000;

export interface PushoverMessage {
  title?: string;
  message: string;
  /** -1 | 0 | 1  (we never use 2 — emergency requires ACK loop) */
  priority?: -2 | -1 | 0 | 1;
  sound?: string;
  /** Unix timestamp to show as the notification's time */
  timestamp?: number;
  /** URL to attach */
  url?: string;
  url_title?: string;
}

export interface PushoverSendResult {
  ok: boolean;
  status?: number;
  errors?: string[];
}

/**
 * Fire a single Pushover message. Returns a typed result — never throws.
 */
export async function sendPushover(
  appToken: string,
  userKey: string,
  msg: PushoverMessage,
): Promise<PushoverSendResult> {
  const params = new URLSearchParams({
    token: appToken,
    user: userKey,
    message: msg.message,
  });
  if (msg.title) params.set('title', msg.title);
  if (msg.priority !== undefined) params.set('priority', String(msg.priority));
  if (msg.sound) params.set('sound', msg.sound);
  if (msg.timestamp !== undefined) params.set('timestamp', String(msg.timestamp));
  if (msg.url) params.set('url', msg.url);
  if (msg.url_title) params.set('url_title', msg.url_title);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(PUSHOVER_API, {
      method: 'POST',
      body: params,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await res.json<{ status: number; errors?: string[] }>();
    if (!res.ok || json.status !== 1) {
      return { ok: false, status: res.status, errors: json.errors ?? [String(res.status)] };
    }
    return { ok: true };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, errors: [(err as Error).message ?? 'timeout'] };
  }
}

/**
 * Resolve the Pushover app token.
 * Priority: PUSHOVER_APP_TOKEN env secret > config_items.pushover_api_key in DB.
 */
export async function resolveAppToken(
  db: D1Database,
  envToken?: string,
): Promise<string | null> {
  if (envToken) return envToken;
  const row = await queryFirst<{ value: string }>(
    db,
    `SELECT value FROM config_items WHERE config_key = 'pushover_api_key' LIMIT 1`,
  ).catch(() => null);
  return row?.value ?? null;
}

/**
 * Send a Pushover notification to multiple users. Looks up each user's
 * pushover_user_key from user_settings JSON. Silently skips users without a key.
 * Never throws — failure is logged.
 */
export async function sendPushoverToUsers(
  db: D1Database,
  userIds: number[],
  msg: PushoverMessage,
  appToken: string,
): Promise<{ sent: number; failed: number }> {
  if (userIds.length === 0) return { sent: 0, failed: 0 };

  // Fetch user_settings for all targeted users in one query (chunked if > 99)
  const CHUNK = 90;
  const rows: { user_id: number; settings_json: string }[] = [];
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const batch = await query<{ user_id: number; settings_json: string }>(
      db,
      `SELECT user_id, settings_json FROM user_settings WHERE user_id IN (${placeholders})`,
      ...chunk,
    ).catch(() => []);
    rows.push(...batch);
  }

  const userKeyMap = new Map<number, string>();
  for (const row of rows) {
    try {
      const blob = JSON.parse(row.settings_json ?? '{}');
      if (typeof blob?.pushover_user_key === 'string' && blob.pushover_user_key.trim()) {
        userKeyMap.set(row.user_id, blob.pushover_user_key.trim());
      }
    } catch { /* malformed JSON — skip */ }
  }

  let sent = 0;
  let failed = 0;
  for (const uid of userIds) {
    const userKey = userKeyMap.get(uid);
    if (!userKey) continue;
    const result = await sendPushover(appToken, userKey, msg);
    if (result.ok) {
      sent++;
    } else {
      failed++;
      log.warn('Pushover send failed', { userId: uid, errors: result.errors });
    }
  }
  return { sent, failed };
}

/**
 * Map the CAD notification priority string to a Pushover numeric priority.
 * 'critical' / 'urgent' → 1 (high, bypasses quiet hours)
 * 'high'                → 0 (normal with sound)
 * everything else       → -1 (quiet — already delivered in-app)
 */
export function cadPriorityToPushover(priority: string): -2 | -1 | 0 | 1 {
  const p = priority?.toLowerCase?.() ?? '';
  if (p === 'critical' || p === 'urgent') return 1;
  if (p === 'high') return 0;
  return -1;
}
