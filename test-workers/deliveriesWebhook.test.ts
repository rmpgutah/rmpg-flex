// Miniflare integration test for POST /api/deliveries/webhook.
// Verifies HMAC auth, the calls_for_service + calls_for_service_ext write,
// and idempotency on repeat delivery_slot_id.
import { createHmac } from 'node:crypto';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import deliveriesWebhook from '../src/routes/deliveriesWebhook';

const SECRET = 'test-rmpg-flex-webhook-secret';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
app.route('/api/deliveries/webhook', deliveriesWebhook);

const VALID_BODY = JSON.stringify({
  slot_id: 42,
  case_number: 'CASE-2026-001',
  slot_date: '2026-09-20',
  time_window: '9am-11am',
  name: 'Jane Subject',
  phone: '555-0100',
  address: '123 Main St, Salt Lake City, UT',
});

async function envWithSecret(): Promise<Record<string, unknown>> {
  return { ...(env as unknown as Record<string, unknown>), RMPG_FLEX_WEBHOOK_SECRET: SECRET };
}

describe('POST /api/deliveries/webhook', () => {
  beforeEach(async () => {
    // Miniflare's D1 binding starts empty (no migrations run in this pool —
    // see test-workers/dbEnsureDeliveryExtColumns.test.ts for the same
    // pattern), so the minimal shape of both tables is created here.
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS calls_for_service (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_number TEXT UNIQUE,
      incident_type TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('P1','P2','P3','P4')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived','on_hold')),
      caller_name TEXT,
      caller_phone TEXT,
      location_address TEXT NOT NULL,
      notes TEXT,
      source TEXT DEFAULT 'phone',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS calls_for_service_ext (
      id INTEGER PRIMARY KEY,
      external_source_system TEXT,
      FOREIGN KEY (id) REFERENCES calls_for_service(id) ON DELETE CASCADE
    )`).run();
    await env.DB.prepare(`DELETE FROM calls_for_service_ext`).run().catch(() => undefined);
    await env.DB.prepare(`DELETE FROM calls_for_service`).run().catch(() => undefined);
  });

  it('rejects a missing signature header', async () => {
    const res = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: VALID_BODY,
    }, await envWithSecret());
    expect(res.status).toBe(401);
  });

  it('rejects an invalid signature', async () => {
    const res = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': 'not-the-right-hash' },
      body: VALID_BODY,
    }, await envWithSecret());
    expect(res.status).toBe(401);
  });

  it('returns 200 not_configured when RMPG_FLEX_WEBHOOK_SECRET is unset', async () => {
    const res = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': sign(VALID_BODY, SECRET) },
      body: VALID_BODY,
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; code: string };
    expect(json.ok).toBe(false);
    expect(json.code).toBe('not_configured');
  });

  it('creates a dispatchable calls_for_service row on a valid signed request', async () => {
    const res = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': sign(VALID_BODY, SECRET) },
      body: VALID_BODY,
    }, await envWithSecret());
    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; call_id: number; created: boolean };
    expect(json.ok).toBe(true);
    expect(json.created).toBe(true);

    const call = await env.DB.prepare(`SELECT * FROM calls_for_service WHERE id = ?`).bind(json.call_id).first<Record<string, unknown>>();
    expect(call?.incident_type).toBe('delivery');
    expect(call?.source).toBe('other');
    expect(call?.location_address).toBe('123 Main St, Salt Lake City, UT');
    expect(call?.status).toBe('pending');

    const ext = await env.DB.prepare(`SELECT * FROM calls_for_service_ext WHERE id = ?`).bind(json.call_id).first<Record<string, unknown>>();
    expect(ext?.delivery_slot_id).toBe(42);
    expect(ext?.delivery_case_number).toBe('CASE-2026-001');
    expect(ext?.external_source_system).toBe('delivery_scheduler');
  });

  it('is idempotent: a repeat webhook for the same slot_id updates, not duplicates', async () => {
    const firstRes = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': sign(VALID_BODY, SECRET) },
      body: VALID_BODY,
    }, await envWithSecret());
    const first = await firstRes.json() as { call_id: number };

    const updatedBody = JSON.stringify({
      slot_id: 42,
      case_number: 'CASE-2026-001',
      slot_date: '2026-09-20',
      time_window: '11am-1pm',
      name: 'Jane Subject',
      address: '123 Main St, Salt Lake City, UT',
    });
    const secondRes = await app.request('/api/deliveries/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rmpg-flex-hmac-sha256': sign(updatedBody, SECRET) },
      body: updatedBody,
    }, await envWithSecret());
    expect(secondRes.status).toBe(200);
    const second = await secondRes.json() as { call_id: number; created: boolean };
    expect(second.created).toBe(false);
    expect(second.call_id).toBe(first.call_id);

    const rows = await env.DB.prepare(`SELECT COUNT(*) as n FROM calls_for_service`).first<{ n: number }>();
    expect(rows?.n).toBe(1);

    const ext = await env.DB.prepare(`SELECT delivery_time_window FROM calls_for_service_ext WHERE id = ?`).bind(first.call_id).first<{ delivery_time_window: string }>();
    expect(ext?.delivery_time_window).toBe('11am-1pm');
  });
});
