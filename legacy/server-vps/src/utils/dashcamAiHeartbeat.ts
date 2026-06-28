// ============================================================
// dashcam-ai heartbeat — pure handler
// ============================================================
// Edge runners post fleet-health every 30s. Single row per unit
// in dashcam_health, upserted on each tick. Drives the fleet
// dashboard health LEDs and (future) "dashcam down" stale-alert
// logic mirroring gpsStaleWatchdog.

import type { Database } from 'better-sqlite3';
import { verifyDashcamSignature } from './dashcamAiHmac';
import { localNow } from './timeUtils';
import { logger } from './logger';

export interface HeartbeatInput {
  rawBody: Buffer;
  headers: {
    'x-dashcam-signature'?: string;
    'x-dashcam-timestamp'?: string;
    [k: string]: string | undefined;
  };
  secret: string;
  db: Database;
}

export interface HeartbeatResult {
  status: number;
  body: any;
}

export async function handleHeartbeat(input: HeartbeatInput): Promise<HeartbeatResult> {
  const { rawBody, headers, secret, db } = input;

  const verify = verifyDashcamSignature({
    body: rawBody,
    timestamp: headers['x-dashcam-timestamp'],
    signature: headers['x-dashcam-signature'],
    secret,
  });
  if (!verify.ok) {
    logger.warn({ reason: verify.reason }, 'dashcam-ai-heartbeat: rejected');
    return { status: 401, body: { error: 'unauthorized' } };
  }

  let p: any;
  try {
    p = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }

  if (typeof p.unit_id !== 'number') return { status: 400, body: { error: 'missing unit_id' } };
  if (!p.device_id) return { status: 400, body: { error: 'missing device_id' } };

  const now = localNow();

  // Upsert by unit_id (UNIQUE constraint on dashcam_health.unit_id)
  db.prepare(`
    INSERT INTO dashcam_health (
      unit_id, device_id, device_kind, last_heartbeat_at,
      firmware_version, model_version,
      gpu_temp_c, cpu_temp_c, disk_used_pct, ram_used_pct,
      network_status, lte_rssi_dbm, last_error, uptime_sec, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit_id) DO UPDATE SET
      device_id = excluded.device_id,
      device_kind = excluded.device_kind,
      last_heartbeat_at = excluded.last_heartbeat_at,
      firmware_version = excluded.firmware_version,
      model_version = excluded.model_version,
      gpu_temp_c = excluded.gpu_temp_c,
      cpu_temp_c = excluded.cpu_temp_c,
      disk_used_pct = excluded.disk_used_pct,
      ram_used_pct = excluded.ram_used_pct,
      network_status = excluded.network_status,
      lte_rssi_dbm = excluded.lte_rssi_dbm,
      last_error = excluded.last_error,
      uptime_sec = excluded.uptime_sec,
      updated_at = excluded.updated_at
  `).run(
    p.unit_id,
    p.device_id,
    p.device_kind ?? 'flex_ai',
    now,
    p.firmware_version ?? null,
    p.model_version ?? null,
    p.gpu_temp_c ?? null,
    p.cpu_temp_c ?? null,
    p.disk_used_pct ?? null,
    p.ram_used_pct ?? null,
    p.network_status ?? null,
    p.lte_rssi_dbm ?? null,
    p.last_error ?? null,
    p.uptime_sec ?? null,
    now,
  );

  return { status: 200, body: { ok: true } };
}
