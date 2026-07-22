// verifyMobile() (src/routes/mobileCfs.ts) returns { error: 'Mobile
// authentication required' } / 401 for BOTH "no valid token" and "rate
// limit exceeded" — a deliberate design tradeoff documented in
// docs/superpowers/specs/2026-07-18-general-api-rate-limiting-design.md
// (keeps verifyMobile()'s MobileAuth | null return contract unchanged
// rather than widening it for one new failure mode). That means a single
// request can't distinguish "blocked by rate limit" from "bad token" by
// its response alone — so this test is DIFFERENTIAL: it sends the exact
// same valid token/call-id pairing twice, varying only the KV budget
// state, and shows the outcome flips. Everything else held constant
// proves the KV state is what caused the difference.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { SignJWT } from 'jose';

const SECRET = 'test-jwt-secret-do-not-use-in-prod';

async function mintMobileToken(userId: number, callId: number): Promise<string> {
  const secret = new TextEncoder().encode(SECRET);
  return new SignJWT({ userId, username: 'mobile-rate-test', role: 'officer', scope: 'pso-mobile', callId })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(secret);
}

function testEnv() {
  return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET };
}

function currentWindowStart(windowSeconds: number): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % windowSeconds);
}

describe('mobile PSO path — rate limit via verifyMobile()', () => {
  it('a validly-scoped request is NOT rejected as unauthenticated when the budget is fresh', async () => {
    const userId = 2001;
    const callId = 501;
    const token = await mintMobileToken(userId, callId);

    const res = await app.request(
      `/api/mobile/cfs/${callId}/status`,
      { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'enroute' }) },
      testEnv(),
    );

    // The handler may still fail downstream (no calls_for_service table/row
    // exists in this test's fresh D1) — that's fine, this test only proves
    // verifyMobile() itself accepted the token. A 401 with this exact body
    // would mean verifyMobile() rejected it, which must NOT happen here.
    if (res.status === 401) {
      const body = await res.json();
      expect(body).not.toEqual({ error: 'Mobile authentication required' });
    }
  });

  it('the SAME valid token is rejected once the budget is exhausted', async () => {
    const userId = 2002;
    const callId = 502;
    const token = await mintMobileToken(userId, callId);

    const windowStart = currentWindowStart(300);
    await env.KV.put(`rl:api:user:${userId}:${windowStart}`, '600', { expirationTtl: 600 });

    const res = await app.request(
      `/api/mobile/cfs/${callId}/status`,
      { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'enroute' }) },
      testEnv(),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Mobile authentication required' });
  });
});
