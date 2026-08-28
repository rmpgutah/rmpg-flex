// Miniflare integration test for POST /api/servemanager-webhook.
// Verifies HMAC auth against the documented ServeManager header/algorithm
// and that a valid POST returns 200 without a JWT.
import { createHmac } from 'node:crypto';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { serveManagerWebhookRouter } from '../src/routes/serveManagerRoutes';

const SECRET = 'test-sm-webhook-secret';
const BODY = '{"meta":{"webhook_name":"RMPG Flex"},"data":[{"type":"job","id":42,"webhook_events":[{"event":"jobs:created"}]}]}';

function smSig(payload: string, secret: string): string {
  const hashedPayload = Buffer.from(payload, 'utf8').toString('base64');
  return createHmac('sha256', secret).update(hashedPayload).digest('base64');
}

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
app.route('/api/servemanager-webhook', serveManagerWebhookRouter);

beforeAll(async () => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT NOT NULL,
      config_value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO system_config (config_key, config_value, category, is_active)
     VALUES ('servemanager_webhook_secret', ?, 'integrations', 1)`,
  ).bind(SECRET).run();
});

describe('POST /api/servemanager-webhook', () => {
  it('accepts a valid X-SM-HMAC-SHA256 signature without a JWT', async () => {
    const res = await app.request('/api/servemanager-webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-SM-HMAC-SHA256': smSig(BODY, SECRET),
      },
      body: BODY,
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; job_ids: number[] };
    expect(json.ok).toBe(true);
    expect(json.job_ids).toEqual([42]);
  });

  it('401s the previous GitHub-style sha256=<hex> header', async () => {
    const githubHex = createHmac('sha256', SECRET).update(BODY).digest('hex');
    const res = await app.request('/api/servemanager-webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-ServeManager-Signature': `sha256=${githubHex}`,
      },
      body: BODY,
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('Invalid signature');
  });

  it('401s a missing signature header', async () => {
    const res = await app.request('/api/servemanager-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: BODY,
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);
  });
});
