// ============================================================
// Regression tests for two authMiddleware hardening fixes.
//
// 1. TOKEN PURPOSE. Several flows mint short-lived JWTs signed with the SAME
//    JWT_SECRET the session middleware trusts (`type: 'refresh'`,
//    `'2fa_pending'`, `'pwd_reset'`, and mobileCfs's `scope: 'pso-mobile'`).
//    authMiddleware used to check only the signature, so a pre-2FA handle was
//    accepted as a full API session — a complete MFA bypass, and a route to
//    account takeover via POST /auth/login/change-password.
//
// 2. MEDIA PASSTHROUGH DEFAULT-DENY. A header-less GET carrying sig+exp used
//    to be forwarded to ANY handler matching isMediaPath() without the
//    signature being verified, on the unenforceable promise that the handler
//    verified it itself. Handlers that didn't (dashcam, FlexCam, ClearPath,
//    field photos, email proxy) were therefore fully public. The passthrough
//    is now restricted to an explicit audited list.
//
// These assert the SECURITY boundary, so a future refactor that reopens
// either hole fails here rather than in production.
// ============================================================
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../src/middleware/auth';
import { getDb, execute, queryFirst } from '../src/utils/db';
import { sign } from 'hono/jwt';

const JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';

function testEnv() {
  return { ...(env as unknown as Record<string, unknown>), JWT_SECRET };
}

// Minimal app: authMiddleware in front of a handler that only reports
// whether it was reached at all.
function protectedApp() {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
  app.use('*', authMiddleware);
  app.get('/api/dispatch/calls', (c) => c.json({ reached: true }));
  return app;
}

let userId: number;

beforeAll(async () => {
  const db = getDb(env as unknown as { DB: D1Database });
  await execute(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'officer',
    status TEXT NOT NULL DEFAULT 'active'
  )`);
  await execute(db,
    `INSERT OR IGNORE INTO users (username, password_hash, full_name, role, status)
     VALUES ('token_purpose_user', 'x', 'Token Purpose User', 'officer', 'active')`);
  const row = await queryFirst<{ id: number }>(
    db, `SELECT id FROM users WHERE username = 'token_purpose_user'`);
  userId = row!.id;
});

function claims(extra: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: String(userId),
    userId,
    username: 'token_purpose_user',
    role: 'officer',
    iat: now,
    exp: now + 600,
    ...extra,
  };
}

async function callWith(token: string): Promise<number> {
  const res = await protectedApp().request(
    '/api/dispatch/calls',
    { headers: { Authorization: `Bearer ${token}` } },
    testEnv(),
  );
  return res.status;
}

describe('authMiddleware — token purpose enforcement', () => {
  it('accepts a normal access token', async () => {
    // Baseline: proves the rejections below are about the purpose claim and
    // not a broken fixture (a test that only asserts 401 would pass even if
    // every token were rejected).
    const token = await sign(claims({ type: 'access' }), JWT_SECRET);
    expect(await callWith(token)).toBe(200);
  });

  it('accepts a legacy token with no `type` claim', async () => {
    // The check is a DENY-list precisely so this keeps working — an
    // allow-list on 'access' would 401 every legacy-issued session on deploy.
    const token = await sign(claims({}), JWT_SECRET);
    expect(await callWith(token)).toBe(200);
  });

  it('rejects a pre-2FA tempToken (MFA bypass)', async () => {
    // POST /auth/login returns this BEFORE the second factor is checked.
    const token = await sign(claims({ type: '2fa_pending' }), JWT_SECRET);
    expect(await callWith(token)).toBe(401);
  });

  it('rejects a refresh token used as an access token', async () => {
    const token = await sign(claims({ type: 'refresh' }), JWT_SECRET);
    expect(await callWith(token)).toBe(401);
  });

  it('rejects a password-reset token', async () => {
    const token = await sign(claims({ type: 'pwd_reset' }), JWT_SECRET);
    expect(await callWith(token)).toBe(401);
  });

  it('rejects a scoped pso-mobile token (privilege escalation)', async () => {
    // mobileCfs mints this from a QR code PRINTED on paperwork handed to
    // clients. It carries no `type`, so it must be caught by the `scope`
    // check. /api/mobile is mounted public and verifies the scope itself, so
    // rejecting it here does not break the PSO field flow.
    const token = await sign(claims({ scope: 'pso-mobile', callId: 42 }), JWT_SECRET);
    expect(await callWith(token)).toBe(401);
  });
});

describe('authMiddleware — media passthrough is default-deny', () => {
  // Builds an app whose handler records whether it ran, so we can tell
  // "handler reached" apart from "handler returned 401 on its own".
  function mediaApp(path: string) {
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.get(path, (c) => c.json({ reached: true }));
    return app;
  }

  it('forwards an audited self-verifying path (bodycam thumbnail)', async () => {
    // On the allow-list: the handler calls verifySignedResource() itself, so
    // the middleware correctly defers. Signature validity is checked there.
    const res = await mediaApp('/api/personnel/bodycam-videos/:id/thumbnail').request(
      '/api/personnel/bodycam-videos/5/thumbnail?sig=deadbeef&exp=9999999999',
      {},
      testEnv(),
    );
    expect(res.status).toBe(200);
  });

  it('forwards the dashcam stream path', async () => {
    const res = await mediaApp('/api/fleet/dashcam-videos/:id/stream').request(
      '/api/fleet/dashcam-videos/7/stream?sig=deadbeef&exp=9999999999',
      {},
      testEnv(),
    );
    expect(res.status).toBe(200);
  });

  it('401s an UNLISTED path that merely ends in /stream', async () => {
    // The core regression: previously ANY path ending in /stream inherited
    // the unverified passthrough, so adding a new media route silently made
    // it public. A hypothetical future route must now fail closed.
    const app = mediaApp('/api/some-new-feature/:id/stream');
    const res = await app.request(
      '/api/some-new-feature/1/stream?sig=deadbeef&exp=9999999999',
      {},
      testEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('401s an unlisted /audio path', async () => {
    const res = await mediaApp('/api/other/:id/audio').request(
      '/api/other/1/audio?sig=x&exp=9999999999',
      {},
      testEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('401s a listed path when sig/exp are absent entirely', async () => {
    const res = await mediaApp('/api/fleet/dashcam-videos/:id/stream').request(
      '/api/fleet/dashcam-videos/7/stream',
      {},
      testEnv(),
    );
    expect(res.status).toBe(401);
  });
});
