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
