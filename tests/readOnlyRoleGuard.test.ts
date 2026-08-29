// ============================================================
// readOnlyRoleGuard — the RBAC floor for read-only roles
// ============================================================
// `requireRole` is opt-in per handler, so a GET written as a plain
// `get(path, handler)` is reachable by EVERY authenticated role. This guard is
// the default-deny floor beneath that.
//
// It used to cover WRITES ONLY. Audited 2026-07-31: across jail/records/intel/
// warrants/billing/useOfForce/flexcam, every write was gated and NOT ONE read
// was -- ~120 endpoints exposing inmate medical screenings, visitor PII, full
// person records, intel products, warrant subjects, every client's invoices and
// video evidence to any authenticated session, including client_viewer.
//
// These tests EXERCISE the middleware rather than grepping for it: an RBAC
// assertion that only checks source text cannot tell an enforced rule from a
// commented-out one.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readOnlyRoleGuard, __readOnlyGuardInternals } from '../src/middleware/auth';

const { READ_ONLY_DENIED_PREFIXES } = __readOnlyGuardInternals;

/** Minimal Hono-ish context: just what the guard actually touches. */
function ctx(role: string | undefined, method: string, path: string) {
  let jsonBody: unknown = null;
  let status = 0;
  return {
    ctx: {
      get: (k: string) => (k === 'user' ? (role ? { role } : undefined) : undefined),
      req: { method, path },
      json: (b: unknown, s?: number) => { jsonBody = b; status = s ?? 200; return { b, s }; },
    } as never,
    result: () => ({ jsonBody, status }),
  };
}

async function run(role: string | undefined, method: string, path: string) {
  const { ctx: c, result } = ctx(role, method, path);
  let nextCalled = false;
  await readOnlyRoleGuard(c, async () => { nextCalled = true; });
  return { nextCalled, ...result() };
}

describe('client_viewer cannot READ sensitive resources', () => {
  const SAMPLES = [
    ['/api/jail/inmates/1/medical', 'inmate medical screenings (PHI)'],
    ['/api/jail/inmates/1/visitors', 'third-party visitor PII'],
    ['/api/records/persons/search', 'full person PII'],
    ['/api/intel/search', 'intelligence products'],
    ['/api/warrants/person/1/profile', 'warrant subject PII'],
    ['/api/billing/invoices', "every client's invoices"],
    ['/api/flexcam/footage/1/chunk/0/stream', 'video evidence'],
    ['/api/use-of-force/1', 'use-of-force reports'],
    ['/api/hr/disciplinary', 'HR disciplinary records'],
    ['/api/personnel/credentials', 'officer credentials'],
    ['/api/dial-connect-recordings', 'Dial Connect call recordings and transcripts'],
  ] as const;

  for (const [path, what] of SAMPLES) {
    it(`GET ${path} is denied (${what})`, async () => {
      const r = await run('client_viewer', 'GET', path);
      expect(r.nextCalled, 'guard let the request through').toBe(false);
      expect(r.status).toBe(403);
    });
  }

  it('denies child paths of every listed prefix, not just exact matches', async () => {
    for (const p of READ_ONLY_DENIED_PREFIXES) {
      const r = await run('client_viewer', 'GET', `${p}/some/nested/resource`);
      expect(r.nextCalled, `${p} child path leaked`).toBe(false);
    }
  });

  it('does not deny by accidental prefix collision', async () => {
    // '/api/serve' must not swallow an unrelated '/api/served-something' route
    // that merely starts with the same characters.
    const r = await run('client_viewer', 'GET', '/api/servicedesk/tickets');
    expect(r.nextCalled).toBe(true);
  });
});

describe('the guard does not over-reach', () => {
  it('operational roles keep full read access', async () => {
    for (const role of ['admin', 'manager', 'supervisor', 'officer', 'dispatcher']) {
      const r = await run(role, 'GET', '/api/jail/inmates/1/medical');
      expect(r.nextCalled, `${role} was wrongly denied`).toBe(true);
    }
  });

  it('client_viewer keeps access to non-sensitive reads', async () => {
    for (const path of ['/api/health', '/api/settings', '/api/assessor/parcel/1', '/api/voice-persona']) {
      const r = await run('client_viewer', 'GET', path);
      expect(r.nextCalled, `${path} wrongly denied`).toBe(true);
    }
  });

  it('an unauthenticated context is left to authMiddleware', async () => {
    const r = await run(undefined, 'GET', '/api/jail/inmates/1/medical');
    expect(r.nextCalled).toBe(true);
  });
});

describe('the original write floor still holds', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    it(`${m} is denied for client_viewer even on a non-listed path`, async () => {
      const r = await run('client_viewer', m, '/api/anything-at-all');
      expect(r.nextCalled).toBe(false);
      expect(r.status).toBe(403);
    });
  }
});
