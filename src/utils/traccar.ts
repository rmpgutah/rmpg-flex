// ============================================================
// RMPG Flex — Traccar GPS client (Worker-native)
// ============================================================
// Traccar (traccar.org) is a self-hosted / cloud GPS tracking server with a
// plain REST API — unlike ClearPath's account-scoped Basic/Bearer split,
// Traccar accepts HTTP Basic auth (email:password) directly on every request
// against a single server URL the operator controls.
//
// The admin tab (client/src/pages/admin/AdminTraccarTab.tsx) is the contract
// of record: it sends { url, email, password } and expects the raw Traccar
// device shape ({ id, name, uniqueId, status, lastUpdate, model, category,
// phone, attributes }) back from /devices.
//
// Phase A (this file + src/routes/traccar.ts): connectivity — credentials
// (password encrypted at rest, reusing the ClearPath AES-GCM helpers),
// test connection, device discovery, device↔unit mappings, settings.
// Phase B (continuous position polling → gps_breadcrumbs / units, and
// telemetry-event ingestion → traccar_events) is NOT implemented here — it
// needs a cron trigger / queue design of its own, mirroring how ClearPath's
// media-sync (Phase B/C) shipped as a separate pass after Phase A landed.
// GET /devices and GET /dashcam-events are real reads; there is just no
// writer populating traccar_events yet, so it returns an honest empty list.
// ============================================================

import { decryptSecret, encryptSecret, isEncrypted, CpgCryptoError } from './cpgCrypto';
import { queryFirst, execute } from './db';

// ── Typed errors ─────────────────────────────────────────────

export class TraccarAuthError extends Error {
  constructor(msg = 'Invalid Traccar credentials') { super(msg); this.name = 'TraccarAuthError'; }
}
export class TraccarHttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.name = 'TraccarHttpError'; this.status = status; }
}
export class TraccarConfigError extends Error {
  constructor(msg: string) { super(msg); this.name = 'TraccarConfigError'; }
}

// ── Types ────────────────────────────────────────────────────

export interface TraccarCredentials {
  url: string;      // server base URL, e.g. http://localhost:8082
  email: string;
  password: string;
}

/** The raw Traccar device shape the admin tab renders directly. */
export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status: string;
  lastUpdate: string;
  model: string;
  category: string;
  phone: string;
  attributes: Record<string, unknown>;
}

// ── Auth ─────────────────────────────────────────────────────

export function authToken(creds: Pick<TraccarCredentials, 'email' | 'password'>): string {
  return btoa(`${creds.email}:${creds.password}`);
}

// ── Credential storage (system_config, category 'integrations') ──
// Same DELETE-then-INSERT upsert pattern as clearpathGps.ts — system_config's
// UNIQUE constraint is the composite (config_key, config_value), not
// config_key alone, so ON CONFLICT(config_key) throws.

const KEYS = {
  url: 'traccar_url',
  email: 'traccar_email',
  password: 'traccar_password',
  enabled: 'traccar_enabled',
  pollInterval: 'traccar_poll_interval',
  historyBackfill: 'traccar_history_backfill',
} as const;
export const TRACCAR_KEYS = KEYS;

type DB = D1Database;

export async function getConfigValue(db: DB, key: string): Promise<string | null> {
  try {
    const row = await queryFirst<{ config_value: string }>(
      db,
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1",
      key,
    );
    return row?.config_value ?? null;
  } catch { return null; }
}

export async function setConfigValue(db: DB, key: string, value: string): Promise<void> {
  await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'", key);
  await execute(
    db,
    "INSERT INTO system_config (config_key, config_value, category, is_active) VALUES (?, ?, 'integrations', 1)",
    key, value,
  );
}

export async function deleteConfigValue(db: DB, key: string): Promise<void> {
  try { await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'", key); }
  catch { /* best-effort */ }
}

/** Load + decrypt credentials. Returns null when incomplete. Reuses the
 *  ClearPath AES-GCM helpers (generic, keyed by whatever secret is passed
 *  in) under a dedicated TRACCAR_ENC_KEY secret — a separate key from
 *  CPG_ENC_KEY so the two integrations' credentials aren't cross-decryptable. */
export async function getCredentials(db: DB, env: { TRACCAR_ENC_KEY?: string }): Promise<TraccarCredentials | null> {
  const url = await getConfigValue(db, KEYS.url);
  const email = await getConfigValue(db, KEYS.email);
  const storedPw = await getConfigValue(db, KEYS.password);
  if (!url || !email || !storedPw) return null;
  let password = storedPw;
  if (isEncrypted(storedPw)) {
    password = await decryptSecret(storedPw, env.TRACCAR_ENC_KEY);
  }
  return { url, email, password };
}

export { encryptSecret, isEncrypted, CpgCryptoError };

export async function isEnabled(db: DB): Promise<boolean> {
  const v = await getConfigValue(db, KEYS.enabled);
  return v === '1' || v === 'true';
}

// ── HTTP helpers ─────────────────────────────────────────────

async function traccarFetch<T>(creds: TraccarCredentials, endpoint: string): Promise<T> {
  const base = creds.url.replace(/\/+$/, '');
  const res = await fetch(`${base}/api${endpoint}`, {
    method: 'GET',
    headers: { Authorization: `Basic ${authToken(creds)}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new TraccarAuthError();
  if (!res.ok) throw new TraccarHttpError(res.status, `Traccar server responded ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Public methods ───────────────────────────────────────────

/** GET /api/devices — the full device list, in Traccar's native shape. */
export async function listDevices(creds: TraccarCredentials): Promise<TraccarDevice[]> {
  const data = await traccarFetch<unknown>(creds, '/devices');
  return Array.isArray(data) ? (data as TraccarDevice[]) : [];
}

/** Test connectivity by fetching the device list; returns the device count. */
export async function testConnection(creds: TraccarCredentials): Promise<number> {
  const devices = await listDevices(creds);
  return devices.length;
}
