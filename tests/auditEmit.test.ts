import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import auditEmit from '../src/routes/auditEmit';

describe('POST /api/audit-emit', () => {
  let app: Hono<any>;

  beforeEach(() => {
    app = new Hono();
    // Pretend the user is authed (the real middleware sets c.var.user).
    app.use('*', async (c, next) => {
      c.set('user', { id: 7, username: 'tester', role: 'officer' });
      c.set('userId', 7);
      // Stub env.DB so recordAudit doesn't blow up. recordAudit catches its own
      // INSERT failure, but the analytics emit reads c.env.EVENTS which we
      // leave undefined — emitAnalytics tolerates undefined binding.
      // The route doesn't await the analytics, so undefined is fine.
      (c as any).env = { DB: undefined, EVENTS: undefined } as any;
      await next();
    });
    app.route('/api/audit-emit', auditEmit);
  });

  it('accepts FLEET_V2_VIEW action', async () => {
    const res = await app.request('/api/audit-emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'FLEET_V2_VIEW', entityType: 'fleet_ui_page', details: { kind: 'FLEET_V2_VIEW', route: '/fleet/v2', viewport_width: 1440 } }),
    });
    expect(res.status).toBe(202);
  });

  it('accepts FLEET_V2_API_ERROR action', async () => {
    const res = await app.request('/api/audit-emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'FLEET_V2_API_ERROR', entityType: 'fleet_ui_page', details: { kind: 'FLEET_V2_API_ERROR', endpoint: '/api/fleet', status: 500, message: 'boom' } }),
    });
    expect(res.status).toBe(202);
  });

  it('rejects an action not on the allow-list (400)', async () => {
    const res = await app.request('/api/audit-emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ANYTHING_ELSE', entityType: 'x', details: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not allowed/i);
  });

  it('rejects a missing action (400)', async () => {
    const res = await app.request('/api/audit-emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityType: 'x', details: {} }),
    });
    expect(res.status).toBe(400);
  });
});
