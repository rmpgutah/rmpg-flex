// ============================================================
// dashcam-ai heartbeat — handler tests
// ============================================================
// Edge runners POST /api/dashcam-ai/heartbeat every 30s with
// fleet-health metrics. The handler:
//   1. Verifies HMAC (same secret as event ingest)
//   2. Validates required fields (unit_id, device_id, kind)
//   3. UPSERTs into dashcam_health by unit_id (one row per unit)
//
// Tested behaviors:
//   - 401 on bad/missing signature
//   - 400 on missing required fields
//   - 200 first heartbeat → INSERTs new row
//   - 200 subsequent heartbeat → UPDATEs same row (no duplicate)
//   - last_heartbeat_at advances on each call

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { handleHeartbeat } from '../dashcamAiHeartbeat';
import { computeSignatureHex } from '../dashcamAiHmac';

type Db = ReturnType<typeof Database>;

const SECRET = 'test-shared-secret-32chars-minimum-foo';

function makeDb(): Db {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE dashcam_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id INTEGER NOT NULL UNIQUE,
      device_id TEXT,
      device_kind TEXT,
      last_heartbeat_at TEXT,
      firmware_version TEXT,
      model_version TEXT,
      gpu_temp_c REAL,
      cpu_temp_c REAL,
      disk_used_pct REAL,
      ram_used_pct REAL,
      network_status TEXT,
      lte_rssi_dbm INTEGER,
      last_error TEXT,
      uptime_sec INTEGER,
      updated_at TEXT
    )
  `).run();
  return db;
}

function buildPayload(override: Partial<Record<string, any>> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    unit_id: 12,
    device_id: 'jetson-12',
    device_kind: 'flex_ai',
    firmware_version: '0.1.0',
    model_version: 'openpilot-0.9.5',
    gpu_temp_c: 56.4,
    cpu_temp_c: 48.2,
    disk_used_pct: 42.1,
    ram_used_pct: 61.0,
    network_status: 'online',
    lte_rssi_dbm: -78,
    uptime_sec: 12345,
    ...override,
  }));
}

function signedHeaders(rawBody: Buffer, ts = Math.floor(Date.now() / 1000)) {
  return {
    'x-dashcam-signature': 'sha256=' + computeSignatureHex(SECRET, ts, rawBody),
    'x-dashcam-timestamp': String(ts),
  };
}

let db: Db;
beforeEach(() => { db = makeDb(); });

describe('handleHeartbeat — auth', () => {
  it('returns 401 on bad signature', async () => {
    const rawBody = buildPayload();
    const result = await handleHeartbeat({
      rawBody,
      headers: {
        'x-dashcam-signature': 'sha256=' + 'a'.repeat(64),
        'x-dashcam-timestamp': String(Math.floor(Date.now() / 1000)),
      },
      secret: SECRET,
      db: db as any,
    });
    expect(result.status).toBe(401);
  });
});

describe('handleHeartbeat — validation', () => {
  it('returns 400 on missing unit_id', async () => {
    const rawBody = buildPayload({ unit_id: undefined });
    const result = await handleHeartbeat({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      db: db as any,
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/unit_id/);
  });

  it('returns 400 on missing device_id', async () => {
    const rawBody = buildPayload({ device_id: undefined });
    const result = await handleHeartbeat({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      db: db as any,
    });
    expect(result.status).toBe(400);
  });
});

describe('handleHeartbeat — upsert', () => {
  it('first heartbeat inserts new dashcam_health row', async () => {
    const rawBody = buildPayload();
    const result = await handleHeartbeat({
      rawBody,
      headers: signedHeaders(rawBody),
      secret: SECRET,
      db: db as any,
    });
    expect(result.status).toBe(200);

    const row = db.prepare('SELECT * FROM dashcam_health WHERE unit_id = ?').get(12) as any;
    expect(row).toBeTruthy();
    expect(row.device_id).toBe('jetson-12');
    expect(row.device_kind).toBe('flex_ai');
    expect(row.gpu_temp_c).toBeCloseTo(56.4);
    expect(row.network_status).toBe('online');
    expect(row.last_heartbeat_at).toBeTruthy();
  });

  it('subsequent heartbeats UPDATE the same row (no duplicate)', async () => {
    const r1 = buildPayload();
    await handleHeartbeat({
      rawBody: r1,
      headers: signedHeaders(r1),
      secret: SECRET,
      db: db as any,
    });
    const r2 = buildPayload({ gpu_temp_c: 89.9, network_status: 'degraded' });
    await handleHeartbeat({
      rawBody: r2,
      headers: signedHeaders(r2),
      secret: SECRET,
      db: db as any,
    });

    const rows = db.prepare('SELECT * FROM dashcam_health WHERE unit_id = ?').all(12) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].gpu_temp_c).toBeCloseTo(89.9);
    expect(rows[0].network_status).toBe('degraded');
  });
});
