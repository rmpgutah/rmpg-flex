// Route-level smoke test (Miniflare/workerd) for the Dial Connect SSO
// relying-party routes: GET /check, GET /login, GET /callback, POST /exchange.
//
// The Miniflare D1 binding (env.DB, see vitest.workers.config.mts) starts
// completely empty on every run -- there is no migration-application step
// for it. Following the self-provisioning pattern used elsewhere in this
// suite (see the "self-provisioning alpr_captures table" comment in
// alprCapture.test.ts and the CREATE TABLE IF NOT EXISTS pattern in
// src/routes/alpr.ts), this file provisions minimal `users` and
// `system_config` tables itself in beforeAll, using the column definitions
// from migrations/baseline/schema.sql (plus the sso_enabled column added by
// migrations/0164_add_sso_enabled_to_users.sql) so the test schema doesn't
// silently diverge from the real one.
//
// NOTE on coverage: the full success path of GET /callback (real token
// exchange + JWKS-verified id_token + issueLoginTokens) is NOT covered here.
// issueLoginTokens (src/routes/auth.ts) also writes to a `sessions` table
// and reads/writes JWT_SECRET-signed tokens, none of which this file's
// minimal self-provisioned schema sets up, and exercising it would require
// mocking both the token-exchange `fetch` call AND jose's remote JWKS
// verification (createRemoteJWKSet performs its own fetch + signature
// check against a real keypair). Per the task instructions, that full
// success path is deferred to Task 4's manual end-to-end verification
// against the live Dial Connect deployment instead of being faked here.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import ssoAuth from '../src/routes/ssoAuth';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
app.route('/api/auth/sso', ssoAuth);

const testEnv = env as unknown as Record<string, unknown> & { DB: D1Database; KV: KVNamespace };

beforeAll(async () => {
  const db = testEnv.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL,
    badge_number TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    avatar_url TEXT,
    must_change_password INTEGER DEFAULT 0,
    totp_enabled INTEGER DEFAULT 0,
    first_name TEXT,
    last_name TEXT,
    sso_enabled INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT NOT NULL,
    config_value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`).run();

  const insertUser = async (opts: {
    username: string; email: string; ssoEnabled: number; status?: string;
  }) => {
    await db.prepare(
      `INSERT INTO users (username, password_hash, full_name, email, role, status, sso_enabled)
       VALUES (?, 'x', ?, ?, 'officer', ?, ?)`,
    ).bind(opts.username, opts.username, opts.email, opts.status ?? 'active', opts.ssoEnabled).run();
  };

  await insertUser({ username: 'sso-active', email: 'sso-active@example.com', ssoEnabled: 1 });
  await insertUser({ username: 'sso-disabled', email: 'sso-disabled@example.com', ssoEnabled: 0 });
  await insertUser({ username: 'sso-inactive', email: 'sso-inactive@example.com', ssoEnabled: 1, status: 'inactive' });
});

describe('GET /api/auth/sso/check', () => {
  it('returns ssoEnabled:true for an sso_enabled active user matching by email', async () => {
    const res = await app.request('/api/auth/sso/check?email=sso-active@example.com', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ssoEnabled: boolean };
    expect(body.ssoEnabled).toBe(true);
  });

  it('returns ssoEnabled:false for an account with sso disabled', async () => {
    const res = await app.request('/api/auth/sso/check?email=sso-disabled@example.com', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ssoEnabled: boolean };
    expect(body.ssoEnabled).toBe(false);
  });

  it('returns ssoEnabled:false for a nonexistent email — same shape as a disabled account', async () => {
    const res = await app.request('/api/auth/sso/check?email=nobody@example.com', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ssoEnabled: boolean };
    expect(body.ssoEnabled).toBe(false);
  });

  it('returns ssoEnabled:false for an sso_enabled but inactive account', async () => {
    const res = await app.request('/api/auth/sso/check?email=sso-inactive@example.com', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ssoEnabled: boolean };
    expect(body.ssoEnabled).toBe(false);
  });
});

describe('GET /api/auth/sso/login', () => {
  it('returns 503 when SSO config is not seeded', async () => {
    const res = await app.request('/api/auth/sso/login', { redirect: 'manual' }, testEnv);
    expect(res.status).toBe(503);
  });

  it('redirects to the issuer /auth endpoint with PKCE params and sets the pkce cookie', async () => {
    const db = testEnv.DB;
    await db.prepare(
      `INSERT INTO system_config (config_key, config_value, category) VALUES ('dial_connect_client_id', 'test-client-id', 'sso')`,
    ).run();
    await db.prepare(
      `INSERT INTO system_config (config_key, config_value, category) VALUES ('dial_connect_issuer', 'https://dialer.rmpgutah.us/api/oidc', 'sso')`,
    ).run();

    const res = await app.request('/api/auth/sso/login', { redirect: 'manual' }, testEnv);
    expect(res.status).toBe(302);

    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    const url = new URL(location!);
    expect(`${url.origin}${url.pathname}`).toBe('https://dialer.rmpgutah.us/api/oidc/auth');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/^sso_pkce=/);
  });
});

describe('GET /api/auth/sso/callback', () => {
  it('redirects to /login?error=sso_failed when the PKCE cookie is missing', async () => {
    const res = await app.request(
      '/api/auth/sso/callback?code=abc&state=xyz',
      { redirect: 'manual' },
      testEnv,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBe('https://rmpgutah.us/login?error=sso_failed');
  });

  it('redirects to /login?error=sso_failed when state does not match the cookie', async () => {
    const pkce = { verifier: 'v', state: 'cookie-state', nonce: 'n' };
    const res = await app.request(
      '/api/auth/sso/callback?code=abc&state=different-state',
      {
        redirect: 'manual',
        headers: { cookie: `sso_pkce=${encodeURIComponent(JSON.stringify(pkce))}` },
      },
      testEnv,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBe('https://rmpgutah.us/login?error=sso_failed');
  });
});

describe('POST /api/auth/sso/exchange', () => {
  it('returns 400 for an unknown code', async () => {
    const res = await app.request(
      '/api/auth/sso/exchange',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'does-not-exist' }),
      },
      testEnv,
    );
    expect(res.status).toBe(400);
  });

  it('returns the stored bundle once for a valid code, then 400 on reuse', async () => {
    const code = 'test-exchange-code-123';
    const bundle = { token: 'access-token', refreshToken: 'refresh-token', sessionId: 'sess-1', user: { id: 1 } };
    await testEnv.KV.put(`sso_exchange:${code}`, JSON.stringify(bundle), { expirationTtl: 60 });

    const res1 = await app.request(
      '/api/auth/sso/exchange',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      },
      testEnv,
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1).toEqual(bundle);

    const res2 = await app.request(
      '/api/auth/sso/exchange',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      },
      testEnv,
    );
    expect(res2.status).toBe(400);
  });

  it('returns 400 when no code is provided', async () => {
    const res = await app.request(
      '/api/auth/sso/exchange',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      testEnv,
    );
    expect(res.status).toBe(400);
  });
});
