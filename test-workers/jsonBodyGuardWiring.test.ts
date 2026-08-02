// Miniflare test for the jsonBodyGuard WIRING in src/index.ts.
//
// The unit tests (tests/jsonBodyGuard.test.ts) prove the middleware itself.
// This file proves it is mounted correctly in the REAL app — a separate
// question, with two ordering hazards that both depend on Hono's registration
// order (load-bearing in this repo, so asserted rather than assumed):
//
//   1. It must run BEFORE handlers, or malformed JSON is still a 500.
//   2. It must run AFTER authMiddleware, so an unauthenticated caller sending
//      garbage still gets 401 — a 400 there would confirm to someone who has
//      not authenticated that the endpoint exists.
//
// Imports the exported `app` from src/index.ts rather than using SELF, because
// the Miniflare entrypoint for this suite is test-workers/entry.ts, which
// mounts a handful of routers WITHOUT the registry or the guard. Testing
// through SELF would silently prove nothing.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  app.request(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body },
    env as unknown as Record<string, unknown>,
  );

describe('jsonBodyGuard wiring in src/index.ts', () => {
  it('401 still beats 400 on an authenticated route (guard runs AFTER auth)', async () => {
    const res = await post('/api/dispatch/calls', '{not json');
    expect(res.status).toBe(401);
  });

  it('returns 400 — not 500 — for malformed JSON on a public route', async () => {
    const res = await post('/api/auth/login', '{not json');
    expect(res.status).toBe(400);
    expect((await res.json() as { code?: string }).code).toBe('INVALID_JSON');
  });

  it('a well-formed body still reaches the handler', async () => {
    // Bad credentials, but valid JSON: the guard must let it through so the
    // login handler answers. Asserting on the exact status would be testing
    // this suite's DB fixture (there is no `users` table here, so the handler
    // legitimately errors) rather than the guard — what matters is that the
    // response did NOT come from the guard.
    const res = await post('/api/auth/login', JSON.stringify({ username: 'nope', password: 'nope' }));
    const body = await res.json().catch(() => ({})) as { code?: string };
    expect(body.code).not.toBe('INVALID_JSON');
    expect(res.status).not.toBe(400);
  });

  it('leaves an empty body alone (tolerant handlers keep working)', async () => {
    const res = await post('/api/auth/login', '');
    // Whatever the handler decides, it must not be the guard's 400.
    expect((await res.json().catch(() => ({})) as { code?: string }).code).not.toBe('INVALID_JSON');
  });

  it('does not intercept GET requests', async () => {
    const res = await app.request('/api/health', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});
