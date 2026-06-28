// server/src/utils/traccarServerPoller.ts
//
// Optional Traccar Server REST API pull mode.
//
// When the admin sets all three of `traccar_server_url`,
// `traccar_server_email`, and `traccar_server_password` in system_config,
// this poller runs every POLL_INTERVAL_MS and pulls fresh positions
// from the Traccar Server's /api/positions endpoint, ingesting each
// via the same internal helper (`ingestTraccarPosition`) the webhook
// path uses.
//
// Auth uses Traccar Server's session cookie:
//   POST {url}/api/session  body=email=...&password=... (form-encoded)
//   captures Set-Cookie 'JSESSIONID=...'
//   subsequent calls send Cookie header
// On 401 we re-login on the next tick.
//
// API reference: https://www.traccar.org/api-reference/

import crypto from 'crypto';
import { getDb } from '../models/database';
import { ingestTraccarPosition } from '../routes/dispatch/gps';
import config from '../config';

/**
 * Decrypt a value stored by admin.ts encryptValue() (AES-256-GCM with
 * key = SHA-256(JWT_SECRET), 16-byte IV, format `iv:authTag:ciphertext`
 * as 3 hex strings). Returns the input untouched if it's not in the
 * encrypted format — that lets URL / enabled / poll_interval be
 * stored as plaintext while email / password are encrypted.
 */
function maybeDecrypt(value: string): string {
  if (!value) return value;
  // Encrypted format: 32 hex (IV) + ':' + 32 hex (authTag) + ':' + ciphertext hex
  if (!/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i.test(value)) return value;
  try {
    const [ivHex, authTagHex, ctHex] = value.split(':');
    const key = crypto.createHash('sha256').update(config.jwt.secret).digest();
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let plain = decipher.update(ctHex, 'hex', 'utf8');
    plain += decipher.final('utf8');
    return plain;
  } catch {
    // Bad ciphertext / wrong key — return original so the caller errors out
    // visibly when the value can't be used.
    return value;
  }
}

const POLL_INTERVAL_MS = 15_000;
const SESSION_PATH = '/api/session';
const POSITIONS_PATH = '/api/positions';
const DEVICES_PATH = '/api/devices';

let pollerHandle: ReturnType<typeof setInterval> | null = null;
let cookie: string | null = null;
let lastFromIso: string | null = null;
let consecutiveFailures = 0;
let deviceUniqueIdCache = new Map<number, string>(); // Traccar device.id → uniqueId

/**
 * Read pull-mode config from system_config. Returns null if any of the
 * three fields is missing — the caller skips the tick.
 */
function readConfig(): { url: string; email: string; password: string; enabled: boolean; intervalMs: number } | null {
  const db = getDb();
  const rows = db.prepare(`
    SELECT config_key, config_value FROM system_config
    WHERE config_key IN ('traccar_url','traccar_email','traccar_password','traccar_enabled','traccar_poll_interval')
      AND is_active = 1
  `).all() as Array<{ config_key: string; config_value: string }>;
  const m = new Map(rows.map((r) => [r.config_key, r.config_value]));
  const url = m.get('traccar_url')?.trim();
  // Email + password are AES-encrypted at rest by the admin route. Plain
  // values pass through unchanged (maybeDecrypt is a no-op for non-encrypted).
  const email = maybeDecrypt(m.get('traccar_email') ?? '').trim();
  const password = maybeDecrypt(m.get('traccar_password') ?? '').trim();
  if (!url || !email || !password) return null;
  const enabledRaw = (m.get('traccar_enabled') ?? 'true').toLowerCase();
  const enabled = enabledRaw !== 'false' && enabledRaw !== '0' && enabledRaw !== 'no';
  if (!enabled) return null;
  const intervalSec = Math.max(5, Math.min(300, parseInt(m.get('traccar_poll_interval') ?? '15', 10) || 15));
  return { url: url.replace(/\/$/, ''), email, password, enabled, intervalMs: intervalSec * 1000 };
}

function setStatus(value: string): void {
  try {
    const db = getDb();
    // The compound UNIQUE on (config_key, config_value) means every distinct
    // status string is a fresh row — so neither INSERT-OR-IGNORE nor UPDATE
    // alone collapses history. Wrap delete+insert in a transaction to keep
    // exactly one heartbeat row per tick.
    const tx = db.transaction((v: string) => {
      db.prepare("DELETE FROM system_config WHERE config_key = 'traccar_pull_status'").run();
      db.prepare(
        "INSERT INTO system_config (config_key, config_value, category, is_active) VALUES ('traccar_pull_status', ?, 'integrations', 1)",
      ).run(v);
    });
    tx(value);
  } catch { /* non-critical */ }
}

async function login(cfg: { url: string; email: string; password: string }): Promise<boolean> {
  const body = `email=${encodeURIComponent(cfg.email)}&password=${encodeURIComponent(cfg.password)}`;
  try {
    const res = await fetch(`${cfg.url}${SESSION_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body,
    });
    if (!res.ok) {
      console.warn(`[Traccar pull] login failed: HTTP ${res.status}`);
      setStatus(`error: login HTTP ${res.status}`);
      cookie = null;
      return false;
    }
    // Capture JSESSIONID. fetch's Headers may have multiple Set-Cookie entries.
    const setCookie = res.headers.get('set-cookie') || '';
    const m = setCookie.match(/JSESSIONID=([^;]+)/i);
    if (m) {
      cookie = `JSESSIONID=${m[1]}`;
      return true;
    }
    setStatus('error: no JSESSIONID in login response');
    return false;
  } catch (err: any) {
    console.warn('[Traccar pull] login network error:', err?.message || err);
    setStatus(`error: ${err?.message || 'network'}`);
    return false;
  }
}

async function refreshDevices(cfg: { url: string }): Promise<void> {
  if (!cookie) return;
  try {
    const res = await fetch(`${cfg.url}${DEVICES_PATH}`, {
      headers: { Cookie: cookie, Accept: 'application/json' },
    });
    if (res.status === 401) { cookie = null; return; }
    if (!res.ok) return;
    const arr = await res.json() as Array<{ id: number; uniqueId: string }>;
    deviceUniqueIdCache = new Map(arr.map((d) => [d.id, d.uniqueId]));
  } catch { /* non-critical */ }
}

async function fetchPositions(cfg: { url: string }): Promise<any[] | null> {
  if (!cookie) return null;
  const now = new Date();
  const from = lastFromIso ?? new Date(now.getTime() - 60_000).toISOString();
  const to = now.toISOString();
  const url = `${cfg.url}${POSITIONS_PATH}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  try {
    const res = await fetch(url, {
      headers: { Cookie: cookie, Accept: 'application/json' },
    });
    if (res.status === 401) { cookie = null; return null; }
    if (!res.ok) {
      consecutiveFailures++;
      setStatus(`error: positions HTTP ${res.status}`);
      return null;
    }
    const arr = await res.json() as any[];
    lastFromIso = to;
    consecutiveFailures = 0;
    return arr;
  } catch (err: any) {
    consecutiveFailures++;
    setStatus(`error: ${err?.message || 'network'}`);
    return null;
  }
}

/**
 * One poll tick. Logs in if needed, refreshes device cache periodically,
 * pulls positions, ingests each into RMPG Flex.
 */
async function tick(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) {
    setStatus('disabled: missing config');
    return;
  }
  if (!cookie) {
    const ok = await login(cfg);
    if (!ok) return;
    await refreshDevices(cfg);
  }
  const positions = await fetchPositions(cfg);
  if (!positions) return;
  let ingested = 0;
  let skipped = 0;
  for (const p of positions) {
    // Map Traccar device.id → uniqueId (the trackerId we use for unit lookup).
    const uniqueId = typeof p.deviceId === 'number'
      ? deviceUniqueIdCache.get(p.deviceId) ?? String(p.deviceId)
      : String(p.deviceId ?? '');
    const result = ingestTraccarPosition({
      trackerId: uniqueId,
      lat: Number(p.latitude),
      lng: Number(p.longitude),
      accuracy: p.accuracy != null ? Number(p.accuracy) : null,
      heading: p.course != null ? Number(p.course) : null,
      // Traccar Server reports speed in knots
      speedMs: p.speed != null ? Number(p.speed) * 0.514444 : null,
      timestamp: p.fixTime || p.deviceTime || p.serverTime || null,
    });
    if ('error' in result) skipped++;
    else ingested++;
  }
  setStatus(`ok: pulled ${positions.length} (${ingested} ingested, ${skipped} unmapped) at ${new Date().toISOString()}`);
}

export function startTraccarPoller(): void {
  if (pollerHandle) return;
  console.log('[Traccar pull] poller started (15s interval, opt-in via system_config)');
  // Run once after 5s, then every interval.
  setTimeout(() => { tick().catch(() => { /* swallowed */ }); }, 5_000);
  pollerHandle = setInterval(() => { tick().catch(() => { /* swallowed */ }); }, POLL_INTERVAL_MS);
}

export function stopTraccarPoller(): void {
  if (pollerHandle) {
    clearInterval(pollerHandle);
    pollerHandle = null;
  }
}
