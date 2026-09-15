// Miniflare integration test for POST /api/safewatch/ingest.
// Covers HMAC auth, the quarantine write, idempotency under a race,
// dispatcher notification fan-out, and the containment invariant that
// ingest never touches an authoritative record.
import { createHmac } from 'node:crypto';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import safewatchIngest from '../src/routes/safewatch';

const SECRET = 'test-safewatch-webhook-secret';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
app.route('/api/safewatch/ingest', safewatchIngest);

const COMMUNITY = {
  external_id: 'sw_abc123',
  source_kind: 'community',
  source: 'safewatch',
  alert_type: 'suspicious_activity',
  severity: 'urgent',
  headline: 'Group loitering behind the strip mall',
  body: 'Three people, one carrying a crowbar.',
  location_text: '900 S State St, Salt Lake City, UT',
  latitude: 40.7508,
  longitude: -111.888,
};

function post(body: string, opts: { secret?: string | null; sigSecret?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.sigSecret !== undefined) headers['x-rmpg-flex-hmac-sha256'] = sign(body, opts.sigSecret);
  const bindings = { ...(env as unknown as Record<string, unknown>) };
  if (opts.secret === null) delete bindings.SAFEWATCH_WEBHOOK_SECRET;
  else bindings.SAFEWATCH_WEBHOOK_SECRET = opts.secret ?? SECRET;
  return app.request('/api/safewatch/ingest', { method: 'POST', headers, body }, bindings);
}

async function countAlerts(): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM safewatch_alerts').first<{ n: number }>();
  return r?.n ?? 0;
}

describe('POST /api/safewatch/ingest', () => {
  beforeEach(async () => {
    // Miniflare's D1 binding starts empty (migrations are not run in this
    // pool — same pattern as deliveriesWebhook.test.ts). The route itself
    // reconciles safewatch_alerts, so only its dependencies are seeded here.
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, status TEXT, full_name TEXT
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, priority TEXT, title TEXT, message TEXT,
      entity_type TEXT, entity_id INTEGER, user_id INTEGER, is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS calls_for_service (
      id INTEGER PRIMARY KEY AUTOINCREMENT, call_number TEXT, incident_type TEXT,
      location_address TEXT, status TEXT
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tip_number TEXT, tip_text TEXT,
      is_anonymous INTEGER, category TEXT, location TEXT, priority TEXT, status TEXT DEFAULT 'new'
    )`).run();
    await env.DB.prepare(`DROP TABLE IF EXISTS safewatch_alerts`).run();
    for (const t of ['notifications', 'users', 'calls_for_service', 'public_tips']) {
      await env.DB.prepare(`DELETE FROM ${t}`).run().catch(() => undefined);
    }
    await env.DB.prepare(
      `INSERT INTO users (id, username, role, status, full_name)
       VALUES (1,'disp','dispatcher','active','D One'), (2,'off','officer','active','O Two')`).run();
  });

  it('returns not_configured and writes nothing when the secret is unset', async () => {
    const res = await post(JSON.stringify(COMMUNITY), { secret: null, sigSecret: SECRET });
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).code).toBe('not_configured');
    await expect(countAlerts()).rejects.toThrow(); // table never created
  });

  it('rejects a missing signature header', async () => {
    const res = await post(JSON.stringify(COMMUNITY));
    expect(res.status).toBe(401);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const res = await post(JSON.stringify(COMMUNITY), { sigSecret: 'wrong-secret' });
    expect(res.status).toBe(401);
  });

  it('accepts a signed community report and quarantines it as status new', async () => {
    const body = JSON.stringify(COMMUNITY);
    const res = await post(body, { sigSecret: SECRET });
    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; alert_id: number };
    expect(json.ok).toBe(true);

    const row = await env.DB.prepare('SELECT * FROM safewatch_alerts WHERE id = ?')
      .bind(json.alert_id).first<Record<string, unknown>>();
    expect(row?.status).toBe('new');
    expect(row?.source_kind).toBe('community');
    expect(row?.headline).toBe(COMMUNITY.headline);
    expect(row?.raw_payload).toBe(body);
  });

  it('accepts an aggregated third-party feed item and keeps its provenance', async () => {
    const feed = { ...COMMUNITY, external_id: 'nws_991', source_kind: 'feed', source: 'nws' };
    const body = JSON.stringify(feed);
    const res = await post(body, { sigSecret: SECRET });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare(
      'SELECT source, source_kind FROM safewatch_alerts WHERE external_id = ?').bind('nws_991')
      .first<Record<string, unknown>>();
    expect(row?.source).toBe('nws');
    expect(row?.source_kind).toBe('feed');
  });

  it('never writes to calls_for_service or public_tips on ingest', async () => {
    await post(JSON.stringify(COMMUNITY), { sigSecret: SECRET });
    const calls = await env.DB.prepare('SELECT COUNT(*) AS n FROM calls_for_service').first<{ n: number }>();
    const tips = await env.DB.prepare('SELECT COUNT(*) AS n FROM public_tips').first<{ n: number }>();
    expect(calls?.n).toBe(0);
    expect(tips?.n).toBe(0);
  });

  it('is idempotent on a repeated external_id', async () => {
    const body = JSON.stringify(COMMUNITY);
    const a = await post(body, { sigSecret: SECRET });
    const b = await post(body, { sigSecret: SECRET });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await countAlerts()).toBe(1);
  });

  it('converges on one row when two deliveries race', async () => {
    const body = JSON.stringify(COMMUNITY);
    const results = await Promise.all([
      post(body, { sigSecret: SECRET }),
      post(body, { sigSecret: SECRET }),
      post(body, { sigSecret: SECRET }),
    ]);
    for (const r of results) expect(r.status).toBe(201);
    expect(await countAlerts()).toBe(1);
  });

  it('does not reset triage state when an alert is redelivered', async () => {
    const body = JSON.stringify(COMMUNITY);
    const first = await post(body, { sigSecret: SECRET });
    const { alert_id } = await first.json() as { alert_id: number };
    await env.DB.prepare(`UPDATE safewatch_alerts SET status = 'dismissed' WHERE id = ?`)
      .bind(alert_id).run();

    await post(body, { sigSecret: SECRET });
    const row = await env.DB.prepare('SELECT status FROM safewatch_alerts WHERE id = ?')
      .bind(alert_id).first<{ status: string }>();
    expect(row?.status).toBe('dismissed');
  });

  it('notifies dispatch staff on an urgent alert but not the officer', async () => {
    const res = await post(JSON.stringify(COMMUNITY), { sigSecret: SECRET });
    expect((await res.json() as { notified: number }).notified).toBe(1);
    const rows = await env.DB.prepare(
      `SELECT user_id, priority, type FROM notifications`).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].user_id).toBe(1);
    expect(rows.results[0].priority).toBe('high');
    expect(rows.results[0].type).toBe('safewatch_alert');
  });

  it('does not notify on a routine info-severity report', async () => {
    const res = await post(JSON.stringify({ ...COMMUNITY, severity: 'info' }), { sigSecret: SECRET });
    expect((await res.json() as { notified: number }).notified).toBe(0);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    const res = await post('{not json', { sigSecret: SECRET });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid payload with 400 and writes nothing', async () => {
    const res = await post(JSON.stringify({ ...COMMUNITY, external_id: '' }), { sigSecret: SECRET });
    expect(res.status).toBe(400);
    await expect(countAlerts()).rejects.toThrow();
  });

  it('rejects an oversized body with 413', async () => {
    const huge = JSON.stringify({ ...COMMUNITY, body: 'x'.repeat(70 * 1024) });
    const res = await post(huge, { sigSecret: SECRET });
    expect(res.status).toBe(413);
  });
});
