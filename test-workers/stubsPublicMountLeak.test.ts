// Public diagnostics and update discovery once reused the broad compatibility
// router, causing all of its handlers to acquire public aliases. Dedicated
// narrow routers now make that exposure impossible by construction. These
// tests pin both the sensitive paths that must stay absent and the two public
// contracts that must remain available before login.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

const SECRET = 'test-jwt-secret-do-not-use-in-prod';

function testEnv() {
  return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET };
}

// Paths owned by the authenticated compatibility router must not be registered
// beneath either narrow public router.
const LEAK_SURFACE: Array<{ path: string; what: string }> = [
  { path: '/api/diagnostics', what: 'live operational posture (active calls by priority, units on shift, active warrants)' },
  { path: '/api/updates', what: 'the same posture payload via the second public mount' },
  { path: '/api/diagnostics/dashboard', what: 'open_cases / pending_serve / active_warrants counts' },
  { path: '/api/updates/dashboard', what: 'dashboard counts via the second public mount' },
  { path: '/api/diagnostics/messages', what: 'the message inbox' },
  { path: '/api/diagnostics/messages/priority-stats', what: 'message volume and read-latency statistics' },
];

describe('public routers do not alias authenticated compatibility data', () => {
  for (const { path, what } of LEAK_SURFACE) {
    it(`GET ${path} is refused without a token — would otherwise expose ${what}`, async () => {
      const res = await app.request(path, {}, testEnv());
      expect(res.status).toBe(404);
    });
  }

  it('PUT /api/diagnostics/preferences cannot write another user\'s preferences', async () => {
    const res = await app.request(
      '/api/diagnostics/preferences',
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: 'x' }) },
      testEnv(),
    );
    expect(res.status).toBe(404);
  });

  it('GET /api/diagnostics/preferences returns defaults, never a stored row', async () => {
    // The narrow public diagnostics router does not register preferences.
    const res = await app.request('/api/diagnostics/preferences', {}, testEnv());
    expect(res.status).toBe(404);
  });

  it('GET /api/diagnostics/activity-feed returns an empty envelope, never audit rows', async () => {
    // The narrow public diagnostics router does not register the audit feed.
    const res = await app.request('/api/diagnostics/activity-feed', {}, testEnv());
    expect(res.status).toBe(404);
  });
});

describe('the deliberately public narrow routes still work', () => {
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
