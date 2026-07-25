// `stubs` is ONE Hono router instance mounted at EIGHT prefixes in
// src/routesConfig.ts. Six are `auth: 'required'` — but `/api/diagnostics` and
// `/api/updates` are `auth: 'public'`, and Hono's `app.route(prefix, router)`
// registers EVERY path the router defines under EVERY mount. So all 58 stub
// routes answer unauthenticated at /api/diagnostics/* and /api/updates/*,
// including the DB-backed ones written for the auth-required mounts.
//
// That was a live unauthenticated disclosure, not a hypothetical: the in-file
// comments in src/routes/stubs.ts record that bare `GET /api/diagnostics`
// "returned live operational posture (active call count by priority, units
// currently on shift, active warrants)" and that /dashboard was "publishing
// live open_cases / pending_serve / active_warrants counts to anyone".
//
// It is closed today by a hand-written `if (c.get('userId') == null)` at the top
// of each DB-touching handler. That is a convention holding a security boundary
// — nothing enforced it, so deleting one guard, or adding a new DB-backed stub
// route without one, silently re-opens the leak with no failing test. These
// tests pin it from the outside, through the real app and its real registry.
//
// Note these assertions do not depend on D1 being reachable under Miniflare:
// the guard returns BEFORE any DB access, so a removed guard shows up as a 500
// or a data payload rather than a 401 either way.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

const SECRET = 'test-jwt-secret-do-not-use-in-prod';

function testEnv() {
  return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET };
}

// Every DB-backed stub path, addressed through BOTH public mounts. These are
// defined for the auth-required mounts (/api/stats, /api/comms, /api/user, …)
// and are only reachable here because the router instance is shared.
const LEAK_SURFACE: Array<{ path: string; what: string }> = [
  { path: '/api/diagnostics', what: 'live operational posture (active calls by priority, units on shift, active warrants)' },
  { path: '/api/updates', what: 'the same posture payload via the second public mount' },
  { path: '/api/diagnostics/dashboard', what: 'open_cases / pending_serve / active_warrants counts' },
  { path: '/api/updates/dashboard', what: 'dashboard counts via the second public mount' },
  { path: '/api/diagnostics/messages', what: 'the message inbox' },
  { path: '/api/diagnostics/messages/priority-stats', what: 'message volume and read-latency statistics' },
];

describe('public stub mounts do not serve authenticated data', () => {
  for (const { path, what } of LEAK_SURFACE) {
    it(`GET ${path} is refused without a token — would otherwise expose ${what}`, async () => {
      const res = await app.request(path, {}, testEnv());
      expect(res.status).toBe(401);
    });
  }

  it('PUT /api/diagnostics/preferences cannot write another user\'s preferences', async () => {
    const res = await app.request(
      '/api/diagnostics/preferences',
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: 'x' }) },
      testEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/diagnostics/preferences returns defaults, never a stored row', async () => {
    // This one intentionally answers 200 rather than 401 so a logged-out client
    // can still render. What matters is that it cannot return a real user's row.
    const res = await app.request('/api/diagnostics/preferences', {}, testEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.user_id).toBeUndefined();
  });

  it('GET /api/diagnostics/activity-feed returns an empty envelope, never audit rows', async () => {
    // Also 200-by-design, but the audit_log join carries user names, badge
    // numbers, roles and IP addresses — it must stay empty without a session.
    const res = await app.request('/api/diagnostics/activity-feed', {}, testEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; total: number };
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe('the deliberately public stub routes still work', () => {
  // The counterweight: these tests must not be "fixable" by bolting
  // authMiddleware onto the whole stubs router. Two of its routes are public on
  // purpose, and a blanket gate would break both.
  it('POST /api/diagnostics/ui-trap stays reachable for a logged-out or frozen client', async () => {
    const res = await app.request(
      '/api/diagnostics/ui-trap',
      { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'freeze-report' },
      testEnv(),
    );
    expect(res.status).not.toBe(401);
  });

  it('GET /api/updates/check stays reachable so a client can discover an update', async () => {
    const res = await app.request('/api/updates/check?currentVersion=1.0.0', {}, testEnv());
    expect(res.status).not.toBe(401);
    const body = await res.json() as { updateAvailable: boolean };
    expect(body.updateAvailable).toBe(false);
  });
});
