// ============================================================
// POST /:id/status — Dial Connect status webhook
// ============================================================
// Fire-and-forget outbound notification to Dial Connect when a CFS
// created via the Dial Connect integration push changes status, so
// Dial Connect's own Incident row doesn't go stale. See the
// "Dial Connect status webhook" block in src/routes/dispatch/calls.ts.
//
// Follows the recordingDb/buildApp conventions from
// tests/callsBroadcasts.test.ts (this router's existing test file for
// the same handler) rather than an ad-hoc mock, since it already
// covers this exact route's auth/env wiring.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import calls from '../src/routes/dispatch/calls';
import type { Env } from '../src/types';
import { recordingDb } from './helpers/fakeD1';

// Spy on emitAlert the same way callsBroadcasts.test.ts does, so the
// broadcastAll('dispatch_update', ...) call at the end of the handler
// (which uses the ws module, not emitAlert, but shares the same import
// timing concern) doesn't need a live WebSocket/DO environment.
vi.mock('../src/routes/ws', () => ({
  broadcastAll: vi.fn(),
  sendToUser: vi.fn(),
}));

function buildApp(db: D1Database, env: Record<string, unknown> = {}) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role: 'admin', full_name: 'Test User' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/dispatch/calls', calls);
  return (path: string, init?: RequestInit) =>
    app.request(path, init, { DB: db, JWT_SECRET: 'test', ...env });
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

const WEBHOOK_ENV = {
  DIAL_CONNECT_WEBHOOK_URL: 'https://dialer.rmpgutah.us/api/webhooks/flex/cfs-status',
  DIAL_CONNECT_WEBHOOK_SECRET: 'test-webhook-secret',
};

function statusCanned(externalSourceSystem: string | null) {
  return [
    { match: /SELECT id FROM calls_for_service WHERE id = \?/, rows: [{ id: 42 }] },
    { match: /SELECT \* FROM calls_for_service WHERE id = \?/, rows: [{ id: 42, call_number: 'CFS26-00042', status: 'onscene', assigned_unit_ids: '[]' }] },
    { match: /FROM calls_for_service_ext WHERE id = \?/, rows: [{ external_source_system: externalSourceSystem }] },
  ];
}

describe('POST /api/dispatch/calls/:id/status webhook', () => {
  beforeEach(() => {
    vi.stubEnv('DIAL_CONNECT_WEBHOOK_URL', WEBHOOK_ENV.DIAL_CONNECT_WEBHOOK_URL);
    vi.stubEnv('DIAL_CONNECT_WEBHOOK_SECRET', WEBHOOK_ENV.DIAL_CONNECT_WEBHOOK_SECRET);
  });

  it('fires webhook when external_source_system is dial_connect', async () => {
    const { db } = recordingDb(statusCanned('dial_connect'));
    const request = buildApp(db, WEBHOOK_ENV);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await request('/api/dispatch/calls/42/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'onscene' }),
    });
    expect(res.status).toBe(200);

    // The webhook fetch is fire-and-forget (not awaited by the route), so
    // give the microtask queue a tick before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledWith(
      WEBHOOK_ENV.DIAL_CONNECT_WEBHOOK_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: WEBHOOK_ENV.DIAL_CONNECT_WEBHOOK_SECRET }),
      })
    );
    const callArgs = fetchMock.mock.calls[0][1] as { body: string };
    expect(JSON.parse(callArgs.body)).toEqual({ cfsId: 42, callNumber: 'CFS26-00042', status: 'onscene' });
  });

  it('does not fire webhook for a non-Dial-Connect call', async () => {
    const { db } = recordingDb(statusCanned(null));
    const request = buildApp(db, WEBHOOK_ENV);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await request('/api/dispatch/calls/42/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'onscene' }),
    });
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('status transition still succeeds even if the webhook fetch rejects', async () => {
    const { db } = recordingDb(statusCanned('dial_connect'));
    const request = buildApp(db, WEBHOOK_ENV);
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const res = await request('/api/dispatch/calls/42/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'onscene' }),
    });
    expect(res.status).toBe(200);
  });
});
