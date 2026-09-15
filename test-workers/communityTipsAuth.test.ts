// Pins the auth posture of POST /api/community/tips through the REAL app
// (src/index.ts, built from ROUTE_REGISTRY), not an isolated harness.
//
// The handler in src/routes/community.ts carried the comment "Public
// endpoint — no auth required for anonymous tips" while /api/community has
// always been registered auth: 'required' — both arrived in the same commit,
// so the comment was never true. Anyone acting on it would either think
// anonymous intake worked (it never has) or "fix" the mismatch by opening
// the prefix, which would create an unauthenticated INSERT into a
// law-enforcement system with no HMAC, rate limit, or captcha.
//
// This test makes the intended posture executable so it can't drift back to
// a comment nobody can verify.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { ROUTE_REGISTRY } from '../src/routesConfig';

const bindings = () => env as unknown as Record<string, unknown>;

describe('/api/community auth posture', () => {
  it('is registered auth: required in ROUTE_REGISTRY', () => {
    const mount = ROUTE_REGISTRY.find((m) => m.prefix === '/api/community');
    expect(mount, '/api/community must stay mounted').toBeDefined();
    expect(mount!.auth).toBe('required');
  });

  it('rejects an unauthenticated POST /tips with 401, never 201', async () => {
    const res = await app.request(
      '/api/community/tips',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tip_text: 'unauthenticated submission attempt' }),
      },
      bindings(),
    );
    // 401 (not 404) proves the request reached authMiddleware for THIS mount
    // and was refused there. A 201 would mean the prefix was opened up and an
    // anonymous caller can now write to public_tips.
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated GET /tips with 401', async () => {
    const res = await app.request('/api/community/tips', {}, bindings());
    expect(res.status).toBe(401);
  });

  it('rejects the bare prefix unauthenticated too', async () => {
    // Hono's /path/* glob does not match the bare /path, so the registry
    // deliberately registers both. Without the bare line an unauthenticated
    // request to the exact prefix slips past auth entirely.
    const res = await app.request('/api/community', {}, bindings());
    expect(res.status).toBe(401);
  });
});
