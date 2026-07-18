// Regression test for a routing-collision bug: geocode.ts and shiftPlans.ts
// both mount at the bare `/api` prefix (src/routesConfig.ts:646/648) and used
// to gate their own sub-paths with `router.use('*', authMiddleware)`. Hono's
// `app.route('/api', router)` merges that '*' into the PARENT app's route
// table as a genuinely global `/api/*` pattern — indistinguishable from
// `app.use('/api/*', authMiddleware)` in index.ts, the exact blanket-block
// PR #627 already taught this codebase to avoid. Because geocode/shiftPlans
// are registered before other public bare-`/api` routers (mobileCfs,
// downloads, stubs' diagnostics/updates mounts), their blanket middleware
// silently 401'd every one of those routers' own handlers.
//
// Fixed 2026-07-18 by scoping each router's `.use()` calls to the literal
// sub-paths it owns (see the in-router comments in geocode.ts/shiftPlans.ts).
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

const SECRET = 'test-jwt-secret-do-not-use-in-prod';

function testEnv() {
  return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET };
}

const AUTH_REQUIRED_BODY = { error: 'Authentication required' };

describe('bare-/api router mounts do not blanket-block each other', () => {
  it('mobileCfs QR challenge (unauthenticated by design) is reachable, not swallowed by geocode/shiftPlans', async () => {
    // No Authorization header — the mobile PSO QR flow is explicitly
    // unauthenticated at this step ("the phone has no session yet", see the
    // file-header comment in src/routes/mobileCfs.ts). A regression here
    // means authMiddleware — mounted globally by an unrelated router's
    // over-broad `use('*', ...)` — intercepted the request before it ever
    // reached mobileCfs's own handler.
    const res = await app.request('/api/mobile/cfs/501/challenge?t=x', {}, testEnv());

    expect(res.status).not.toBe(401);
    if (res.status === 401) {
      const body = await res.json();
      expect(body).not.toEqual(AUTH_REQUIRED_BODY);
    }
  });

  it('stubs diagnostics ui-trap (intentionally public) is reachable', async () => {
    // Documented in stubs.ts as intentionally public/unauthenticated — a
    // frozen or logged-out client must still be able to report freeze state.
    const res = await app.request(
      '/api/diagnostics/ui-trap',
      { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'freeze-report' },
      testEnv(),
    );

    expect(res.status).not.toBe(401);
    const body = await res.json();
    expect(body).not.toEqual(AUTH_REQUIRED_BODY);
  });

  it('downloads info (public download page, no auth of its own) is reachable', async () => {
    const res = await app.request('/api/downloads/info', {}, testEnv());

    expect(res.status).not.toBe(401);
  });

  it('geocode still gates its OWN sub-paths (scoping did not just delete the auth)', async () => {
    const res = await app.request('/api/geocode/search?q=main+st', {}, testEnv());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(AUTH_REQUIRED_BODY);
  });

  it('shiftPlans still gates its OWN sub-paths (scoping did not just delete the auth)', async () => {
    const res = await app.request('/api/shift-plans', {}, testEnv());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(AUTH_REQUIRED_BODY);
  });
});
