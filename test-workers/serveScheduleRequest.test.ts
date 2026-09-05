// Route-level (Miniflare) tests for POST /api/verify/schedule-request — the
// only PUBLIC write on the Worker. Pins the defence layers in order: config
// gate → body validation → KV rate limits → Turnstile → persistence + officer
// notification. Turnstile's siteverify is mocked via global fetch.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { serveQrScan } from '../src/routes/serveQrScan';

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api/verify', serveQrScan);

const baseEnv = env as unknown as Record<string, unknown>;
const withSecret = { ...baseEnv, TURNSTILE_SECRET_KEY: 'test-secret' };

function post(body: unknown, e: Record<string, unknown> = withSecret, ip = '203.0.113.7') {
  return app.request('/api/verify/schedule-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  }, e);
}

const good = {
  ref: 'JOB-1',
  preferred_window: 'evening',
  contact_method: 'phone',
  contact_value: '(385) 555-0100',
  note: 'Gate code 4411',
  turnstile_token: 'tok',
};

beforeAll(async () => {
  const db = env.DB as D1Database;
  await db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS serve_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER, recipient_name TEXT, next_attempt_note TEXT, updated_at TEXT)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS serve_job_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, serve_queue_id INTEGER NOT NULL, author_id INTEGER, author_name TEXT NOT NULL DEFAULT 'System', author_role TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), edited_at TEXT, is_system INTEGER NOT NULL DEFAULT 0, parent_id INTEGER)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, priority TEXT, title TEXT, message TEXT, entity_type TEXT, entity_id INTEGER, user_id INTEGER, is_read INTEGER, created_at TEXT)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS serve_schedule_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, job_ref TEXT NOT NULL, job_id INTEGER, preferred_window TEXT NOT NULL, contact_method TEXT NOT NULL, contact_value TEXT NOT NULL, note TEXT, ip_address TEXT, user_agent TEXT, status TEXT NOT NULL DEFAULT 'pending', resolved_by INTEGER, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await db.prepare(`INSERT OR IGNORE INTO serve_queue (id, officer_id, recipient_name) VALUES (1, 42, 'Jane Doe')`).run();
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('challenges.cloudflare.com/turnstile')) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

describe('POST /api/verify/schedule-request', () => {
  it('reports not_configured (200) when TURNSTILE_SECRET_KEY is unset', async () => {
    const res = await post(good, baseEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, code: 'not_configured' });
  });

  it('rejects a malformed ref before touching KV or Turnstile', async () => {
    const res = await post({ ...good, ref: 'CFS26-00074' });
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects bad enums and short phone numbers', async () => {
    expect((await post({ ...good, preferred_window: 'dawn' })).status).toBe(400);
    expect((await post({ ...good, contact_method: 'fax' })).status).toBe(400);
    expect((await post({ ...good, contact_value: '555' })).status).toBe(400);
    expect((await post({ ...good, contact_method: 'email', contact_value: 'nope' })).status).toBe(400);
  });

  it('persists the request, comments the job, and notifies the officer', async () => {
    const res = await post({ ...good, ref: 'job-1' }, withSecret, '198.51.100.10');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; requestId: number; ref: string };
    expect(body.ok).toBe(true);
    expect(body.ref).toBe('JOB-1');

    const db = env.DB as D1Database;
    const row = await db.prepare('SELECT * FROM serve_schedule_requests WHERE id = ?').bind(body.requestId).first<Record<string, unknown>>();
    expect(row?.job_id).toBe(1);
    expect(row?.status).toBe('pending');
    expect(row?.note).toBe('Gate code 4411');

    const note = await db.prepare(`SELECT body, is_system, author_role FROM serve_job_comments WHERE serve_queue_id = 1 ORDER BY id DESC LIMIT 1`).first<Record<string, unknown>>();
    expect(note?.is_system).toBe(1);
    expect(note?.author_role).toBe('subject');
    expect(String(note?.body)).toContain('Evening (after 5 PM)');

    const notif = await db.prepare(`SELECT type, user_id, entity_id FROM notifications WHERE type = 'serve_schedule_request' ORDER BY id DESC LIMIT 1`).first<Record<string, unknown>>();
    expect(notif?.user_id).toBe(42);
    expect(notif?.entity_id).toBe(1);
  });

  it('accepts an unknown ref quietly without notifying anyone (no id enumeration)', async () => {
    const db = env.DB as D1Database;
    const before = (await db.prepare(`SELECT COUNT(*) AS n FROM notifications`).first<{ n: number }>())!.n;
    const res = await post({ ...good, ref: 'JOB-999999' }, withSecret, '198.51.100.11');
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
    const after = (await db.prepare(`SELECT COUNT(*) AS n FROM notifications`).first<{ n: number }>())!.n;
    expect(after).toBe(before);
  });

  it('returns 403 when Turnstile rejects the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    const res = await post(good, withSecret, '198.51.100.12');
    expect(res.status).toBe(403);
  });

  it('rate-limits the 6th request from one IP within the hour', async () => {
    const ip = '198.51.100.99';
    for (let i = 0; i < 5; i++) {
      const r = await post({ ...good, ref: `JOB-${1000 + i}` }, withSecret, ip);
      expect(r.status).toBe(200);
    }
    const sixth = await post({ ...good, ref: 'JOB-2000' }, withSecret, ip);
    expect(sixth.status).toBe(429);
  });
});

describe('GET /api/verify — public response contract', () => {
  it('exposes the same support channels as the printed panel and never recipient PII', async () => {
    const res = await app.request('/api/verify?ref=JOB-1', {}, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.matched).toBe(true);
    expect(body.email).toBe('server@rmpgutah.us');
    expect(body.support_url).toBe('https://rmpgutahps.us/support');
    expect(body.notice_info_url).toBe('https://rmpgutahps.us/notice-of-attempt');
    expect(body.phone_route).toBe('press 1, then 1, then 3');
    expect(JSON.stringify(body)).not.toContain('Jane Doe');
  });
});
