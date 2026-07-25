// ============================================================
// Regression tests for the second-wave authorization hardening.
//
// Each fix closed a route that was reachable by a role that should not have
// had it. The router-level role gates here reject BEFORE any DB access, so we
// can assert the boundary directly by injecting a user context and checking the
// status. These lock in that:
//   - the external-facing roles (contract_manager, client_viewer) cannot reach
//     CJIS intel routers (gang / narcotics / field-interviews / intel-AI),
//   - a non-admin cannot drive the ServeManager integration,
//   - external roles cannot read the clients router (parallel door to the
//     admin client hardening).
// A 403 proves the gate fired; an allowed role getting through (non-403) proves
// the gate isn't over-broad.
// ============================================================
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

import gangIntel from '../src/routes/gangIntel';
import narcotics from '../src/routes/narcotics';
import fieldInterviews from '../src/routes/fieldInterviews';
import intelAi from '../src/routes/intelAi';
import serveManagerRoutes from '../src/routes/serveManagerRoutes';
import clients from '../src/routes/clients';

// Mount a router behind a middleware that injects the given role, mimicking
// what authMiddleware would set after a valid session.
function appWith(router: Hono<any>, role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 42, role, username: 'tester', full_name: 'Test User' });
    c.set('userId', 42);
    await next();
  });
  app.route('/', router);
  return app;
}

function req(app: Hono<any>, path: string, method = 'GET', body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return app.request(path, init, env as unknown as Record<string, unknown>);
}

const EXTERNAL_ROLES = ['contract_manager', 'client_viewer'];

describe('intel confidentiality — external roles are denied (CJIS)', () => {
  const cases: Array<[string, Hono<any>, string]> = [
    ['gang-intel list', gangIntel, '/'],
    ['gang-intel gangs', gangIntel, '/gangs'],
    ['narcotics cases', narcotics, '/cases'],
    ['field-interviews list', fieldInterviews, '/'],
  ];

  for (const [label, router, path] of cases) {
    for (const role of EXTERNAL_ROLES) {
      it(`403s ${role} on ${label}`, async () => {
        const res = await req(appWith(router, role), path);
        expect(res.status).toBe(403);
      });
    }

    it(`allows officer on ${label} (gate does not fire)`, async () => {
      const res = await req(appWith(router, 'officer'), path);
      expect(res.status).not.toBe(403);
    });
  }

  it('403s contract_manager on POST /api/intel/ai/ask', async () => {
    const res = await req(appWith(intelAi, 'contract_manager'), '/ask', 'POST', { question: 'list informants' });
    expect(res.status).toBe(403);
  });

  it('does not 403 officer on POST /api/intel/ai/ask (reaches handler)', async () => {
    const res = await req(appWith(intelAi, 'officer'), '/ask', 'POST', { question: 'x' });
    expect(res.status).not.toBe(403);
  });
});

describe('ServeManager integration — mutations require admin/manager', () => {
  for (const role of ['officer', 'dispatcher', 'contract_manager']) {
    it(`403s ${role} on PUT /api-key`, async () => {
      const res = await req(appWith(serveManagerRoutes, role), '/api-key', 'PUT', { api_key: 'attacker' });
      expect(res.status).toBe(403);
    });
  }

  it('does not 403 a GET /status for a viewer role (reads stay open)', async () => {
    const res = await req(appWith(serveManagerRoutes, 'officer'), '/status');
    expect(res.status).not.toBe(403);
  });

  it('does not 403 admin on PUT /api-key', async () => {
    const res = await req(appWith(serveManagerRoutes, 'admin'), '/api-key', 'PUT', { api_key: 'k' });
    expect(res.status).not.toBe(403);
  });
});

describe('clients router — external roles denied, writes require supervisory role', () => {
  for (const role of EXTERNAL_ROLES) {
    it(`403s ${role} on GET /`, async () => {
      const res = await req(appWith(clients, role), '/');
      expect(res.status).toBe(403);
    });
  }

  it('403s officer on POST / (writes are supervisory-only)', async () => {
    const res = await req(appWith(clients, 'officer'), '/', 'POST', { name: 'X' });
    expect(res.status).toBe(403);
  });

  it('does not 403 dispatcher on GET / (picker read allowed)', async () => {
    const res = await req(appWith(clients, 'dispatcher'), '/');
    expect(res.status).not.toBe(403);
  });

  it('does not 403 manager on POST /', async () => {
    const res = await req(appWith(clients, 'manager'), '/', 'POST', { name: 'Acme' });
    expect(res.status).not.toBe(403);
  });
});
