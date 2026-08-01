// Route-level smoke test (Miniflare/workerd) for the driver-performance API.
//
// Harness pattern follows test-workers/auth.test.ts: build a small Hono app,
// inject a fake `user` via middleware (bypassing real JWT verification,
// which is exercised separately in auth.test.ts), and mount the real router
// under test. This repo has no shared `./helpers` module with
// makeRequest/tokenFor — that harness does not exist here, so this file
// builds the same pattern auth.test.ts already uses instead of inventing one.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../src/middleware/auth';
import driverPerformance from '../src/routes/driverPerformance';

type FakeUser = { id: number; role: string; username: string; full_name: string };

/** Builds an app with a fake authenticated user, mounting the real router under test. */
function appAs(user: FakeUser) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('userId', user.id);
    await next();
  });
  app.route('/api/driver-performance', driverPerformance);
  return app;
}

function request(user: FakeUser, path: string, init?: RequestInit) {
  return appAs(user).request(path, init, env as unknown as Record<string, unknown>);
}

const DENIED = ['officer', 'dispatcher', 'client_viewer', 'contract_manager'];
const ALLOWED = ['admin', 'manager', 'supervisor', 'human_resources'];
const READ_PATHS = ['/api/driver-performance/roster', '/api/driver-performance/officer/1'];

describe('driver-performance RBAC', () => {
  for (const role of DENIED) {
    for (const path of READ_PATHS) {
      it(`denies ${role} on GET ${path}`, async () => {
        const res = await request({ id: 1, role, username: role, full_name: role }, path);
        expect(res.status).toBe(403);
      });
    }
  }

  for (const role of ALLOWED) {
    it(`allows ${role} on GET /roster`, async () => {
      const res = await request(
        { id: 1, role, username: role, full_name: role },
        '/api/driver-performance/roster',
      );
      expect(res.status).toBe(200);
    });
  }

  it('rejects an unauthenticated request', async () => {
    // Exercise the REAL auth middleware here (not the fake-user injector
    // used above) — this is the only way to prove a missing token actually
    // 401s rather than merely proving requireRole rejects a set role.
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.route('/api/driver-performance', driverPerformance);
    const res = await app.request(
      '/api/driver-performance/roster',
      {},
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
  });

  it('denies a non-admin on POST /recompute', async () => {
    const res = await request(
      { id: 1, role: 'supervisor', username: 'supervisor', full_name: 'Supervisor' },
      '/api/driver-performance/recompute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '2026-03-01', to: '2026-03-02' }),
      },
    );
    expect(res.status).toBe(403);
  });
});

describe('weights owner gate', () => {
  // While SCORE_VERSION contains 'placeholder', no score is served. Once the
  // owner sets real weights, DELETE this test and un-skip the roster-shape
  // tests below — that swap is the intended, visible handover.
  it('refuses to serve scores while severity weights are unreviewed', async () => {
    const res = await request(
      { id: 1, role: 'supervisor', username: 'supervisor', full_name: 'Supervisor' },
      '/api/driver-performance/roster',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('weights_pending_review');
  });

  it('gates the officer detail endpoint too', async () => {
    const res = await request(
      { id: 1, role: 'supervisor', username: 'supervisor', full_name: 'Supervisor' },
      '/api/driver-performance/officer/1',
    );
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('weights_pending_review');
  });

  it('applies RBAC BEFORE the weights gate — a denied role still gets 403', async () => {
    // Order matters: if the gate ran first, client_viewer would receive a 200
    // instead of a 403, and the RBAC tests above would pass for the wrong reason.
    const res = await request(
      { id: 1, role: 'client_viewer', username: 'client_viewer', full_name: 'Client Viewer' },
      '/api/driver-performance/roster',
    );
    expect(res.status).toBe(403);
  });
});

describe.skip('roster shape (un-skip once weights are reviewed)', () => {
  it('separates unranked insufficient-exposure officers from the ranked list', async () => {
    const res = await request(
      { id: 1, role: 'supervisor', username: 'supervisor', full_name: 'Supervisor' },
      '/api/driver-performance/roster?from=2026-03-01&to=2026-03-31',
    );
    const body = await res.json() as { ranked: unknown[]; insufficient_data: unknown[] };
    expect(Array.isArray(body.ranked)).toBe(true);
    expect(Array.isArray(body.insufficient_data)).toBe(true);
  });
});
