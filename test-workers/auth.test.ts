// Route-level smoke test (Miniflare/workerd) for auth middleware.
// Verifies that auth-required routes return 401 without a token,
// and that the health endpoint (public) returns 200 without auth.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware, readOnlyRoleGuard, requireRole } from '../src/middleware/auth';

describe('auth middleware — unauthenticated access', () => {
  it('returns 401 when Authorization header is missing', async () => {
    // Apply authMiddleware to an endpoint and verify 401 without a token
    const authApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    authApp.use('*', authMiddleware);
    authApp.get('/profile', (c) => c.json({ ok: true }));

    const res = await authApp.request('/profile', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);
  });

  it('requireRole returns 403 for wrong role', async () => {
    // Build a minimal app with auth + role guard
    const rbacApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    rbacApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'officer', username: 'test', full_name: 'Test Officer' });
      c.set('userId', 1);
      await next();
    });
    rbacApp.get('/admin', requireRole('admin'), (c) => c.json({ admin: true }));

    const res = await rbacApp.request('/admin', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Insufficient permissions');
  });

  it('requireRole allows matching role', async () => {
    const rbacApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    rbacApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'admin', username: 'admin', full_name: 'Admin User' });
      c.set('userId', 1);
      await next();
    });
    rbacApp.get('/admin', requireRole('admin'), (c) => c.json({ admin: true }));

    const res = await rbacApp.request('/admin', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { admin: boolean };
    expect(body.admin).toBe(true);
  });
});

describe('readOnlyRoleGuard', () => {
  it('blocks POST for client_viewer role', async () => {
    const guardApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    guardApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'client_viewer', username: 'viewer', full_name: 'Viewer' });
      c.set('userId', 1);
      await next();
    });
    guardApp.use('*', readOnlyRoleGuard);
    guardApp.post('/data', (c) => c.json({ ok: true }));

    const res = await guardApp.request('/data', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('allows GET for client_viewer role', async () => {
    const guardApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    guardApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'client_viewer', username: 'viewer', full_name: 'Viewer' });
      c.set('userId', 1);
      await next();
    });
    guardApp.use('*', readOnlyRoleGuard);
    guardApp.get('/data', (c) => c.json({ ok: true }));

    const res = await guardApp.request('/data', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });

  it('allows POST for officer role', async () => {
    const guardApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    guardApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'officer', username: 'officer', full_name: 'Officer' });
      c.set('userId', 1);
      await next();
    });
    guardApp.use('*', readOnlyRoleGuard);
    guardApp.post('/data', (c) => c.json({ ok: true }));

    const res = await guardApp.request('/data', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});

describe('auth middleware — media-path query-auth passthrough', () => {
  // GET /:id/thumbnail (bodycam storage-architecture phase) is fetched by an
  // <img> tag, which can't send an Authorization header — same constraint as
  // /stream and /audio. It must be recognized by isMediaPath() so the
  // signed-URL (sig/exp) and legacy query-token passthroughs apply; a Task-4
  // regression shipped this route without updating isMediaPath(), which
  // silently 401'd every thumbnail request in production despite Miniflare
  // tests passing (those tests bypass authMiddleware entirely by injecting
  // a fake user directly — see test-workers/entry.ts).
  it('lets a signed-URL request through to the handler for a /thumbnail path', async () => {
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.get('/api/personnel/bodycam-videos/:id/thumbnail', (c) => c.json({ ok: true }));

    const res = await app.request(
      '/api/personnel/bodycam-videos/5/thumbnail?sig=deadbeef&exp=9999999999',
      {},
      env as unknown as Record<string, unknown>,
    );
    // The middleware's job is only to pass the request through when sig+exp
    // are present on a recognized media path — actual signature validity is
    // verified downstream in the route handler via verifySignedResource().
    expect(res.status).toBe(200);
  });

  it('still 401s a /thumbnail request with no token and no signature', async () => {
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.get('/api/personnel/bodycam-videos/:id/thumbnail', (c) => c.json({ ok: true }));

    const res = await app.request(
      '/api/personnel/bodycam-videos/5/thumbnail',
      {},
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
  });
});
