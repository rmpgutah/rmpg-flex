// Route-level smoke test (Miniflare/workerd) for the Dial Connect SSO
// relying-party routes: GET /check, GET /login, GET /callback, POST /exchange.
//
// Config source: Dialer OIDC config comes from Wrangler vars/secrets
// (env.DIALER_OIDC_*), NOT the system_config DB table — see wrangler.toml
// and src/utils/sso.ts. DIALER_OIDC_ISSUER is the full discovery-DOCUMENT
// URL, so any test that needs the router to resolve real endpoints stubs
// global fetch to serve a synthetic discovery document at that URL (see
// the vi.stubGlobal('fetch', ...) precedent in test-workers/mapboxBoundaries.test.ts),
// and passes the DIALER_OIDC_* vars inline via `{ ...env, ... }` (see the
// precedent in test-workers/fleetioWebhook.test.ts).
//
// The Miniflare D1 binding (env.DB, see vitest.workers.config.mts) starts
// completely empty on every run -- there is no migration-application step
// for it. Following the self-provisioning pattern used elsewhere in this
// suite (see the "self-provisioning alpr_captures table" comment in
// alprCapture.test.ts and the CREATE TABLE IF NOT EXISTS pattern in
// src/routes/alpr.ts), this file provisions a minimal `users` table itself
// in beforeAll, using the column definitions from migrations/baseline/schema.sql
// (plus the sso_enabled column added by migrations/0164_add_sso_enabled_to_users.sql)
// so the test schema doesn't silently diverge from the real one.
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
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import ssoAuth from '../src/routes/ssoAuth';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
app.route('/api/oidc/dialer', ssoAuth);

const testEnv = env as unknown as Record<string, unknown> & { DB: D1Database; KV: KVNamespace };

const DISCOVERY_URL = 'https://dialer.rmpgutah.us/api/oidc/.well-known/openid-configuration';
const DISCOVERY_DOC = {
  issuer: 'https://dialer.rmpgutah.us/api/oidc',
  authorization_endpoint: 'https://dialer.rmpgutah.us/api/oidc/auth',
  token_endpoint: 'https://dialer.rmpgutah.us/api/oidc/token',
  jwks_uri: 'https://dialer.rmpgutah.us/api/oidc/jwks',
};

const DIALER_ENV_VARS = {
  DIALER_OIDC_ISSUER: DISCOVERY_URL,
  DIALER_OIDC_CLIENT_ID: 'test-client-id',
  DIALER_OIDC_CLIENT_SECRET: 'test-client-secret',
  DIALER_OIDC_REDIRECT_URI: 'https://rmpgutah.us/api/oidc/dialer/callback',
};

// Serves the synthetic discovery document at DISCOVERY_URL, 404s anything
// else — proves the relying party actually fetches + parses a real-shaped
// discovery response (authorization_endpoint/token_endpoint/jwks_uri/issuer)
// rather than guessing endpoint paths off the bare issuer.
function stubDiscoveryFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === DISCOVERY_URL) {
      return new Response(JSON.stringify(DISCOVERY_DOC), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }));
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/oidc/dialer/check', () => {
  it('returns ssoEnabled:true for an sso_enabled active user matching by email', async () => {
    const res = await app.request('/api/oidc/dialer/check?email=sso-active@example.com', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ssoEnabled: boolean };
    expect(body.ssoEnabled).toBe(true);
  });

  it('returns ssoEnabled:false for an account with sso disabled', async () => {
    const res = await app.request('/api/oidc/dialer/check?email=sso-disabled@example.com', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ssoEnabled: boolean };
    expect(body.ssoEnabled).toBe(false);
  });

  it('returns ssoEnabled:false for a nonexistent email — same shape as a disabled account', async () => {
    const res = await app.request('/api/oidc/dialer/check?email=nobody@example.com', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ssoEnabled: boolean };
    expect(body.ssoEnabled).toBe(false);
  });

  it('returns ssoEnabled:false for an sso_enabled but inactive account', async () => {
    const res = await app.request('/api/oidc/dialer/check?email=sso-inactive@example.com', {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as { ssoEnabled: boolean };
    expect(body.ssoEnabled).toBe(false);
  });
});

describe('GET /api/oidc/dialer/login', () => {
  it('returns 503 when DIALER_OIDC_* vars are not set', async () => {
    const res = await app.request('/api/oidc/dialer/login', { redirect: 'manual' }, testEnv);
    expect(res.status).toBe(503);
  });

  it('returns 503 when vars are set but the discovery-document fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const withVars = { ...testEnv, ...DIALER_ENV_VARS };
    const res = await app.request('/api/oidc/dialer/login', { redirect: 'manual' }, withVars);
    expect(res.status).toBe(503);
  });

  it('redirects to the discovery document\'s authorization_endpoint with PKCE params and sets the pkce cookie', async () => {
    stubDiscoveryFetch();
    const withVars = { ...testEnv, ...DIALER_ENV_VARS };

    const res = await app.request('/api/oidc/dialer/login', { redirect: 'manual' }, withVars);
    expect(res.status).toBe(302);

    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    const url = new URL(location!);
    // Resolved from the discovery document, NOT guessed from the bare issuer.
    expect(`${url.origin}${url.pathname}`).toBe(DISCOVERY_DOC.authorization_endpoint);
    expect(url.searchParams.get('client_id')).toBe(DIALER_ENV_VARS.DIALER_OIDC_CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    // redirect_uri must match DIALER_OIDC_REDIRECT_URI exactly -- a mismatch
    // here vs. the token-exchange request would fail the flow at the IdP.
    expect(url.searchParams.get('redirect_uri')).toBe(DIALER_ENV_VARS.DIALER_OIDC_REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/^sso_pkce=/);
  });
});

describe('GET /api/oidc/dialer/callback', () => {
  it('redirects to /login?error=sso_failed when the PKCE cookie is missing', async () => {
    const res = await app.request(
      '/api/oidc/dialer/callback?code=abc&state=xyz',
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
      '/api/oidc/dialer/callback?code=abc&state=different-state',
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

  it('redirects to /login?error=sso_failed when the discovery-document fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const pkce = { verifier: 'v', state: 'match-state', nonce: 'n' };
    const withVars = { ...testEnv, ...DIALER_ENV_VARS };
    const res = await app.request(
      '/api/oidc/dialer/callback?code=abc&state=match-state',
      {
        redirect: 'manual',
        headers: { cookie: `sso_pkce=${encodeURIComponent(JSON.stringify(pkce))}` },
      },
      withVars,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBe('https://rmpgutah.us/login?error=sso_failed');
  });
});

describe('POST /api/oidc/dialer/exchange', () => {
  it('returns 400 for an unknown code', async () => {
    const res = await app.request(
      '/api/oidc/dialer/exchange',
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
      '/api/oidc/dialer/exchange',
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
      '/api/oidc/dialer/exchange',
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
      '/api/oidc/dialer/exchange',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      testEnv,
    );
    expect(res.status).toBe(400);
  });
});
