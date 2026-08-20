import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import webBrowser from '../src/routes/webBrowser';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role });
    await next();
  });
  app.route('/', webBrowser);
  return app;
}

describe('POST /session role restriction', () => {
  it('blocks client_viewer', async () => {
    const app = buildApp('client_viewer');
    const res = await app.request('/session', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('blocks contract_manager', async () => {
    const app = buildApp('contract_manager');
    const res = await app.request('/session', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('allows officer', async () => {
    const env = { WEB_BROWSER_SESSION: { idFromName: () => 'fake-id', get: () => ({ fetch: vi.fn() }) } };
    const app = buildApp('officer');
    const res = await app.request('/session', { method: 'POST' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { sessionId: string };
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(0);
  });
});
