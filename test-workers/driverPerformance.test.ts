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

describe('window validation (from/to)', () => {
  // These run BEFORE the weights gate (see windowFrom() ordering in
  // driverPerformance.ts), so they're reachable even while SCORE_VERSION is
  // still a placeholder — a malformed window must 400 regardless of gate state.
  const SUP = { id: 1, role: 'supervisor', username: 'supervisor', full_name: 'Supervisor' };

  it('rejects an impossible calendar date (2026-13-45) with 400, not 200 or 500', async () => {
    const res = await request(SUP, '/api/driver-performance/roster?from=2026-13-45&to=2026-03-31');
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('INVALID_WINDOW');
  });

  it('rejects a from value containing a quote with 400, not 200 or 500', async () => {
    const res = await request(
      SUP,
      `/api/driver-performance/roster?${new URLSearchParams({ from: '2026-03-01"', to: '2026-03-31' })}`,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('INVALID_WINDOW');
  });

  it('rejects a malformed window on /officer/:id too', async () => {
    const res = await request(SUP, '/api/driver-performance/officer/1?to=2026-02-30');
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('INVALID_WINDOW');
  });

  it('rejects a malformed window on the export endpoint before any DB work, with a clean Content-Disposition', async () => {
    const res = await request(
      SUP,
      `/api/driver-performance/officer/1/export?${new URLSearchParams({ to: '2026-03-01"\r\nX-Injected: 1' })}`,
    );
    expect(res.status).toBe(400);
    // Never a malformed/injected header — the 400 must return before the
    // Content-Disposition string is ever built.
    expect(res.headers.get('X-Injected')).toBeNull();
    const cd = res.headers.get('Content-Disposition');
    expect(cd === null || !/[\r\n]/.test(cd)).toBe(true);
  });

  it('leaves the existing valid-window behavior unchanged (weights-pending JSON, not a validation error)', async () => {
    const res = await request(SUP, '/api/driver-performance/roster?from=2026-03-01&to=2026-03-31');
    expect(res.status).toBe(200);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('weights_pending_review');
  });

  it('still returns 403 for a denied role even with a malformed window (RBAC runs first)', async () => {
    const res = await request(
      { id: 1, role: 'client_viewer', username: 'client_viewer', full_name: 'Client Viewer' },
      '/api/driver-performance/roster?from=not-a-date',
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
