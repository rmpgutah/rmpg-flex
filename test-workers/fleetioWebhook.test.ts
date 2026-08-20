// Miniflare (workerd) integration test for the Fleet.io webhook receiver.
// Tests the full POST /api/fleetio/webhook path: Authorization-header echo
// verify, body parsing, event insertion, and error handling.
//
// Run with: npx vitest run --config vitest.workers.config.mts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import fleetioWebhook from '../src/routes/fleetioWebhook';

// Build a standalone app — same mount path as src/routes/fleetio.ts
const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
app.route('/api/fleetio', fleetioWebhook);

// Miniflare's D1 starts empty per test file — no migrations are auto-applied
// (see other test-workers/*.test.ts for the same pattern). Create just the
// tables this route touches: fleetio_events (dedup queue), audit_log
// (bad-auth/unparseable logging), users + notification_rules + notifications
// (the probe-detected alert path via evaluateNotificationRules).
beforeAll(async () => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS fleetio_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
      event_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id INTEGER,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      payload_json TEXT NOT NULL,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      processed_at TEXT
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetio_events_dedup ON fleetio_events(direction, event_id)`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      user_id INTEGER,
      action TEXT,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      ip_address TEXT
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      role TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS notification_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, description TEXT, trigger_event TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '{}', target_roles TEXT NOT NULL DEFAULT '[]',
      target_user_ids TEXT NOT NULL DEFAULT '[]', notification_type TEXT NOT NULL DEFAULT 'in_app',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER, created_by_name TEXT,
      last_fired_at TEXT, fire_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL DEFAULT 'info',
      priority TEXT NOT NULL DEFAULT 'normal',
      title TEXT NOT NULL,
      message TEXT,
      entity_type TEXT,
      entity_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ).run();
  // resolveTargets() in notificationEngine.ts needs at least one active admin
  // for target_roles=["admin"] to resolve to a real user_id.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, status)
     VALUES (1, 'test-admin', 'x', 'Test Admin', 'admin', 'active')`,
  ).run();
});

const SECRET = 'test-webhook-secret-abc123';
const BAD_SECRET = 'wrong-secret';

function baseRequest(body?: unknown, auth?: string, ip?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== undefined) headers['authorization'] = auth;
  if (ip !== undefined) headers['cf-connecting-ip'] = ip;
  return new Request('http://localhost/api/fleetio/webhook', {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/fleetio/webhook — auth', () => {
  it('returns 200 + skipped when FLEETIO_WEBHOOK_SECRET is unset', async () => {
    const res = await app.request(
      baseRequest({ event: 'vehicle_updated', payload: { id: 1 } }, 'Bearer ' + SECRET, '203.0.113.100'),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: '' } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { skipped?: boolean; code?: string };
    expect(body.skipped).toBe(true);
    expect(body.code).toBe('FLEETIO_WEBHOOK_SECRET_UNSET');
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.request(
      baseRequest({ event: 'vehicle_updated', payload: { id: 1 } }, undefined, '203.0.113.101'),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('missing authorization');
  });

  it('returns 401 when Authorization header does not match secret', async () => {
    const res = await app.request(
      baseRequest({ event: 'vehicle_updated', payload: { id: 1 } }, 'Bearer ' + BAD_SECRET, '203.0.113.102'),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('invalid authorization');
  });
});

describe('POST /api/fleetio/webhook — body parsing', () => {
  it('returns 200 + parsed=false for invalid JSON', async () => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + SECRET,
      'cf-connecting-ip': '203.0.113.103',
    };
    const req = new Request('http://localhost/api/fleetio/webhook', {
      method: 'POST',
      headers,
      body: 'not-json-at-all{{{',
    });
    const res = await app.request(
      req,
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { parsed?: boolean; reason?: string };
    expect(body.parsed).toBe(false);
    expect(body.reason).toBe('invalid_json');
  });

  it('returns 200 + parsed=false for unsupported event type', async () => {
    const res = await app.request(
      baseRequest({ id: 123, random_field: 'hello' }, 'Bearer ' + SECRET, '203.0.113.104'),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { parsed?: boolean; reason?: string };
    expect(body.parsed).toBe(false);
    expect(body.reason).toBe('unsupported_event_type');
  });
});

describe('POST /api/fleetio/webhook — happy path', () => {
  it('accepts a valid Fleet.io vehicle_updated webhook (event+payload convention)', async () => {
    const res = await app.request(
      baseRequest(
        { event: 'vehicle_updated', payload: { id: 42, vehicle_id: 42, name: 'Unit 101', make: 'Ford' } },
        'Bearer ' + SECRET,
        '203.0.113.105',
      ),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { received?: boolean; event_id?: string; queued?: boolean };
    expect(body.received).toBe(true);
    expect(typeof body.event_id).toBe('string');
    expect(body.event_id!.length).toBeGreaterThan(0);
    expect(body.queued).toBe(true);
  });

  it('accepts a valid Fleet.io fuel_entry_created webhook (underscore convention)', async () => {
    const res = await app.request(
      baseRequest(
        { event: 'fuel_entry_created', payload: { id: 99, fuel_entry_id: 99, us_gallons: 15.5, cost: 45.0 } },
        'Bearer ' + SECRET,
        '203.0.113.106',
      ),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { received?: boolean; parsed?: boolean };
    expect(body.received).toBe(true);
    expect(body.parsed).not.toBe(false);
  });

  it('accepts a webhook with Token prefix Authorization (no Bearer)', async () => {
    const res = await app.request(
      baseRequest(
        { event_type: 'vehicle.update', data: { id: 7 } },
        'Token ' + SECRET,
        '203.0.113.107',
      ),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { received?: boolean };
    expect(body.received).toBe(true);
  });

  it('deduplicates via UNIQUE constraint — second identical event returns queued=true but is idempotent', async () => {
    const payload = { event: 'vehicle_destroyed', payload: { id: 999, vehicle_id: 999 } };
    const reqOpts = { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>;

    const res1 = await app.request(baseRequest(payload, 'Bearer ' + SECRET, '203.0.113.108'), {}, reqOpts);
    expect((await res1.json() as { queued?: boolean }).queued).toBe(true);

    const res2 = await app.request(baseRequest(payload, 'Bearer ' + SECRET, '203.0.113.108'), {}, reqOpts);
    expect(res2.status).toBe(200);
  });
});

describe('POST /api/fleetio/webhook — rate limiting', () => {
  it('returns 429 once an IP has hit the 30-req/60s cap, without touching D1', async () => {
    const ip = '203.0.113.10'; // TEST-NET-3, RFC 5737 — safe non-routable example IP
    const windowStart = Math.floor(Date.now() / 1000);
    const bucketWindowStart = windowStart - (windowStart % 60);
    await env.KV.put(`rl:fleetio-webhook:${ip}:${bucketWindowStart}`, '30', { expirationTtl: 120 });

    const req = new Request('http://localhost/api/fleetio/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET, 'cf-connecting-ip': ip },
      body: JSON.stringify({ event: 'vehicle_updated', payload: { id: 1 } }),
    });
    const res = await app.request(req, {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(429);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('rate_limited');
  });

  it('allows a request from an IP well under the cap', async () => {
    const ip = '203.0.113.11';
    const req = new Request('http://localhost/api/fleetio/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET, 'cf-connecting-ip': ip },
      body: JSON.stringify({ event: 'vehicle_updated', payload: { id: 2 } }),
    });
    const res = await app.request(req, {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/fleetio/webhook — bad-auth counting, alerting, and bounded audit logging', () => {
  function badAuthRequest(ip: string): Request {
    return new Request('http://localhost/api/fleetio/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-secret', 'cf-connecting-ip': ip },
      body: JSON.stringify({ event: 'vehicle_updated', payload: { id: 1 } }),
    });
  }

  it('writes an audit_log row for the first bad-auth attempt from a fresh IP', async () => {
    const ip = '203.0.113.20';
    const res = await app.request(badAuthRequest(ip), {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action='FLEETIO_WEBHOOK_BAD_AUTH' AND details LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();
    expect(row?.n).toBeGreaterThanOrEqual(1);
  });

  it('stops writing audit_log rows after 5 bad-auth attempts from the same IP in one window, but still returns 401', async () => {
    const ip = '203.0.113.21';
    const windowStart = Math.floor(Date.now() / 1000);
    const bucketWindowStart = windowStart - (windowStart % 600);
    // Pre-seed the bad-auth counter at 5 so this single request is the 6th.
    await env.KV.put(`rl:fleetio-webhook-badauth:${ip}:${bucketWindowStart}`, '5', { expirationTtl: 1200 });

    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action='FLEETIO_WEBHOOK_BAD_AUTH' AND details LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();

    const res = await app.request(badAuthRequest(ip), {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);

    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action='FLEETIO_WEBHOOK_BAD_AUTH' AND details LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();
    expect(after?.n).toBe(before?.n ?? 0);
  });

  it('fires the probe-detected notification exactly once when the bad-auth count reaches 10', async () => {
    const ip = '203.0.113.22';
    const windowStart = Math.floor(Date.now() / 1000);
    const bucketWindowStart = windowStart - (windowStart % 600);
    // Pre-seed at 9 so this request is the 10th — the exact trigger point.
    await env.KV.put(`rl:fleetio-webhook-badauth:${ip}:${bucketWindowStart}`, '9', { expirationTtl: 1200 });

    await env.DB.prepare(
      `INSERT OR IGNORE INTO notification_rules (name, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active)
       VALUES ('test rule', 'fleetio_webhook_probe_detected', '{}', '["admin"]', '[]', 'in_app', 1)`,
    ).run();

    const res = await app.request(badAuthRequest(ip), {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);

    const notified = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE title LIKE '%probe%' OR message LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();
    expect(notified?.n).toBeGreaterThanOrEqual(1);

    // An 11th attempt in the SAME window must NOT fire a second notification.
    await env.KV.put(`rl:fleetio-webhook-badauth:${ip}:${bucketWindowStart}`, '10', { expirationTtl: 1200 });
    await app.request(badAuthRequest(ip), {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    const notifiedAfter = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE title LIKE '%probe%' OR message LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();
    expect(notifiedAfter?.n).toBe(notified?.n);
  });
});
