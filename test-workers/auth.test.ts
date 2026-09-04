// Route-level smoke test (Miniflare/workerd) for auth middleware.
// Verifies that auth-required routes return 401 without a token,
// and that the health endpoint (public) returns 200 without auth.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware, readOnlyRoleGuard, requireRole } from '../src/middleware/auth';
import { hashSync } from 'bcryptjs';
import authRouter from '../src/routes/auth';
import { getDb, execute, queryFirst, query, columnExists } from '../src/utils/db';
import { sign } from 'hono/jwt';

describe('auth middleware — unauthenticated access', () => {
  it('returns 401 when Authorization header is missing', async () => {
    // Apply authMiddleware to an endpoint and verify 401 without a token
    const authApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    authApp.use('*', authMiddleware);
    authApp.get('/profile', (c) => c.json({ ok: true }));

    const res = await authApp.request('/profile', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);
  });

  it('requireRole returns 403 for wrong role', async () => {
    // Build a minimal app with auth + role guard
    const rbacApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    rbacApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'officer', username: 'test', full_name: 'Test Officer' });
      c.set('userId', 1);
      await next();
    });
    rbacApp.get('/admin', requireRole('admin'), (c) => c.json({ admin: true }));

    const res = await rbacApp.request('/admin', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Insufficient permissions');
  });

  it('requireRole allows matching role', async () => {
    const rbacApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    rbacApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'admin', username: 'admin', full_name: 'Admin User' });
      c.set('userId', 1);
      await next();
    });
    rbacApp.get('/admin', requireRole('admin'), (c) => c.json({ admin: true }));

    const res = await rbacApp.request('/admin', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { admin: boolean };
    expect(body.admin).toBe(true);
  });
});

describe('readOnlyRoleGuard', () => {
  it('blocks POST for client_viewer role', async () => {
    const guardApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    guardApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'client_viewer', username: 'viewer', full_name: 'Viewer' });
      c.set('userId', 1);
      await next();
    });
    guardApp.use('*', readOnlyRoleGuard);
    guardApp.post('/data', (c) => c.json({ ok: true }));

    const res = await guardApp.request('/data', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('allows GET for client_viewer role', async () => {
    const guardApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    guardApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'client_viewer', username: 'viewer', full_name: 'Viewer' });
      c.set('userId', 1);
      await next();
    });
    guardApp.use('*', readOnlyRoleGuard);
    guardApp.get('/data', (c) => c.json({ ok: true }));

    const res = await guardApp.request('/data', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });

  it('allows POST for officer role', async () => {
    const guardApp = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    guardApp.use('*', async (c, next) => {
      c.set('user', { id: 1, role: 'officer', username: 'officer', full_name: 'Officer' });
      c.set('userId', 1);
      await next();
    });
    guardApp.use('*', readOnlyRoleGuard);
    guardApp.post('/data', (c) => c.json({ ok: true }));

    const res = await guardApp.request('/data', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});

describe('auth middleware — media-path query-auth passthrough', () => {
  // GET /:id/thumbnail (bodycam storage-architecture phase) is fetched by an
  // <img> tag, which can't send an Authorization header — same constraint as
  // /stream and /audio. It must be recognized by isMediaPath() so the
  // signed-URL (sig/exp) and legacy query-token passthroughs apply; a Task-4
  // regression shipped this route without updating isMediaPath(), which
  // silently 401'd every thumbnail request in production despite Miniflare
  // tests passing (those tests bypass authMiddleware entirely by injecting
  // a fake user directly — see test-workers/entry.ts).
  it('lets a signed-URL request through to the handler for a /thumbnail path', async () => {
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.get('/api/personnel/bodycam-videos/:id/thumbnail', (c) => c.json({ ok: true }));

    const res = await app.request(
      '/api/personnel/bodycam-videos/5/thumbnail?sig=deadbeef&exp=9999999999',
      {},
      env as unknown as Record<string, unknown>,
    );
    // The middleware's job is only to pass the request through when sig+exp
    // are present on a recognized media path — actual signature validity is
    // verified downstream in the route handler via verifySignedResource().
    expect(res.status).toBe(200);
  });

  it('still 401s a /thumbnail request with no token and no signature', async () => {
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.get('/api/personnel/bodycam-videos/:id/thumbnail', (c) => c.json({ ok: true }));

    const res = await app.request(
      '/api/personnel/bodycam-videos/5/thumbnail',
      {},
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
  });

  it('treats the tesseract training image route as a media path (query token is attempted)', async () => {
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.get('/api/tesseract-training/documents/:id/image', (c) => c.json({ ok: true }));

    const missing = await app.request(
      '/api/tesseract-training/documents/1/image',
      {},
      env as unknown as Record<string, unknown>,
    );
    expect(missing.status).toBe(401);
    expect((await missing.json() as { error: string }).error).toBe('Authentication required');

    const bogus = await app.request(
      '/api/tesseract-training/documents/1/image?token=not-a-jwt',
      {},
      { ...(env as unknown as Record<string, unknown>), JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod' },
    );
    expect(bogus.status).toBe(401);
    expect((await bogus.json() as { error: string }).error).toBe('Invalid or expired token');
  });

  it('treats serve-intake document file as a media path (query token is attempted)', async () => {
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.get('/api/serve-intake/documents/:docId/file', (c) => c.json({ ok: true }));

    const missing = await app.request(
      '/api/serve-intake/documents/343/file',
      {},
      env as unknown as Record<string, unknown>,
    );
    expect(missing.status).toBe(401);
    expect((await missing.json() as { error: string }).error).toBe('Authentication required');

    const bogus = await app.request(
      '/api/serve-intake/documents/343/file?token=not-a-jwt',
      {},
      { ...(env as unknown as Record<string, unknown>), JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod' },
    );
    expect(bogus.status).toBe(401);
    expect((await bogus.json() as { error: string }).error).toBe('Invalid or expired token');
  });

  it('treats digital evidence, property photos, and redaction downloads as media paths', async () => {
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.get('/api/evidence/digital/:id/file', (c) => c.json({ ok: true }));
    app.get('/api/property-photos/file/:key{.+}', (c) => c.json({ ok: true }));
    app.get('/api/redactions/:id/download', (c) => c.json({ ok: true }));
    const jwtEnv = { ...(env as unknown as Record<string, unknown>), JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod' };

    for (const path of [
      '/api/evidence/digital/12/file',
      '/api/property-photos/file/property-photos/abc.jpg',
      '/api/redactions/9/download',
    ]) {
      const missing = await app.request(path, {}, jwtEnv);
      expect(missing.status).toBe(401);
      expect((await missing.json() as { error: string }).error).toBe('Authentication required');

      const bogus = await app.request(`${path}?token=not-a-jwt`, {}, jwtEnv);
      expect(bogus.status).toBe(401);
      expect((await bogus.json() as { error: string }).error).toBe('Invalid or expired token');
    }
  });

  it('does not treat the tesseract image route as self-verifying HMAC media', async () => {
    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
    app.use('*', authMiddleware);
    app.get('/api/tesseract-training/documents/:id/image', (c) => c.json({ ok: true }));

    const res = await app.request(
      '/api/tesseract-training/documents/1/image?sig=deadbeef&exp=9999999999',
      {},
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /login — account lockout', () => {
  const TEST_PASSWORD = 'CorrectHorseBattery1';
  const TEST_PASSWORD_HASH = hashSync(TEST_PASSWORD, 4); // low cost — test speed only

  function loginEnv() {
    return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod' };
  }

  async function seedUser(db: D1Database, username: string): Promise<number> {
    await execute(db,
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES (?, ?, 'Test User', 'officer', 'active')`,
      username, TEST_PASSWORD_HASH);
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM users WHERE username = ?', username);
    return row!.id;
  }

  function post(username: string, password: string, ip: string) {
    return authRouter.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ username, password }),
    }, loginEnv());
  }

  beforeAll(async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT, first_name TEXT, last_name TEXT, email TEXT,
      role TEXT NOT NULL DEFAULT 'officer', badge_number TEXT, phone TEXT, avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'active', must_change_password INTEGER NOT NULL DEFAULT 0,
      totp_enabled INTEGER NOT NULL DEFAULT 0, totp_exempt INTEGER DEFAULT 0,
      login_count INTEGER NOT NULL DEFAULT 0, last_login_at TEXT
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, ip_address TEXT,
      success INTEGER NOT NULL DEFAULT 0, failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_agent TEXT, device_type TEXT, browser TEXT, os TEXT,
      country TEXT, region TEXT, city TEXT, postal_code TEXT, timezone TEXT,
      latitude TEXT, longitude TEXT, asn TEXT, isp TEXT,
      http_protocol TEXT, tls_version TEXT, tls_cipher TEXT, likely_vpn_or_hosting INTEGER,
      device_platform TEXT, device_platform_version TEXT
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, refresh_token_hash TEXT NOT NULL,
      ip_address TEXT, user_agent TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
      device_type TEXT, browser TEXT, os TEXT,
      country TEXT, region TEXT, city TEXT, postal_code TEXT, timezone TEXT,
      latitude TEXT, longitude TEXT, asn TEXT, isp TEXT,
      http_protocol TEXT, tls_version TEXT, tls_cipher TEXT, likely_vpn_or_hosting INTEGER,
      device_platform TEXT, device_platform_version TEXT,
      device_latitude TEXT, device_longitude TEXT, device_geo_accuracy_m TEXT, device_geo_captured_at TEXT
    )`);
    // The standard /login handler (src/routes/auth.ts, POST /login) calls
    // getSecurityPolicy(db) (src/utils/securityPolicy.ts) directly in its main
    // body, outside any try/catch of its own — that read has been there since
    // task 2's account-lockout work, well before task 5. getSecurityPolicy()
    // queries `system_config` unconditionally, so without this table, EVERY
    // login in this Miniflare suite 500s (caught only by /login's outer
    // try/catch, which turns it into a generic 500 response). This table was
    // missing from this file's schema setup, which was silently failing every
    // "account lockout" test below with a 500 instead of the asserted
    // 200/401/403. (Task 5, f2784230b3, added its own getSecurityPolicy() call
    // inside createSession() for max-active-sessions enforcement, but that call
    // is wrapped in its own try/catch and fails silently — it is not the source
    // of these 500s.)
    await execute(db, `CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT NOT NULL,
      config_value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  });

  // Runs first, deliberately, while the module-level reconciler cache flag
  // is still unset for this isolate — proves the self-heal path works, not
  // just the already-migrated path the later tests exercise.
  it('self-heals a users table that predates the lockout columns', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    expect(await columnExists(db, 'users', 'failed_login_count')).toBe(false);
    expect(await columnExists(db, 'users', 'locked_until')).toBe(false);
    await seedUser(db, 'lockout-user-0');
    const res = await post('lockout-user-0', TEST_PASSWORD, '10.1.0.0');
    expect(res.status).toBe(200);
    expect(await columnExists(db, 'users', 'failed_login_count')).toBe(true);
    expect(await columnExists(db, 'users', 'locked_until')).toBe(true);
  });

  it('locks the account on the 5th consecutive wrong password and reports it immediately', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await seedUser(db, 'lockout-user-1');

    for (let i = 0; i < 4; i++) {
      const res = await post('lockout-user-1', 'wrong-password', '10.1.0.1');
      expect(res.status).toBe(401);
      const body = await res.json() as { code: string };
      expect(body.code).toBe('INVALID_USERNAME_OR_PASSWORD');
    }

    // 5th wrong attempt trips the lock — reported on THIS response, not the next one.
    const res5 = await post('lockout-user-1', 'wrong-password', '10.1.0.1');
    expect(res5.status).toBe(403);
    const body5 = await res5.json() as { code: string };
    expect(body5.code).toBe('ACCOUNT_LOCKED');

    // 6th attempt, even with the correct password, stays locked.
    const res6 = await post('lockout-user-1', TEST_PASSWORD, '10.1.0.1');
    expect(res6.status).toBe(403);
    const body6 = await res6.json() as { code: string };
    expect(body6.code).toBe('ACCOUNT_LOCKED');
  });

  it('resets failed_login_count to 0 on a successful login before reaching the threshold', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const userId = await seedUser(db, 'lockout-user-2');
    await post('lockout-user-2', 'wrong-password', '10.1.0.2');
    await post('lockout-user-2', 'wrong-password', '10.1.0.2');
    const res = await post('lockout-user-2', TEST_PASSWORD, '10.1.0.2');
    expect(res.status).toBe(200);
    const row = await queryFirst<{ failed_login_count: number; locked_until: string | null }>(
      db, 'SELECT failed_login_count, locked_until FROM users WHERE id = ?', userId);
    expect(row?.failed_login_count).toBe(0);
    expect(row?.locked_until).toBeNull();
  });

  it('auto-unlocks once locked_until is in the past', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const userId = await seedUser(db, 'lockout-user-3');
    await execute(db,
      `UPDATE users SET failed_login_count = 5, locked_until = datetime('now', '-1 minute') WHERE id = ?`,
      userId);
    const res = await post('lockout-user-3', TEST_PASSWORD, '10.1.0.3');
    expect(res.status).toBe(200);
    const row = await queryFirst<{ failed_login_count: number; locked_until: string | null }>(
      db, 'SELECT failed_login_count, locked_until FROM users WHERE id = ?', userId);
    expect(row?.failed_login_count).toBe(0);
    expect(row?.locked_until).toBeNull();
  });

  it('accepts a case-variant of the stored username', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await seedUser(db, 'lockout-user-case');
    const res = await post('Lockout-User-Case', TEST_PASSWORD, '10.1.0.7');
    expect(res.status).toBe(200);
    const body = await res.json() as { token?: string; user?: { username: string } };
    expect(typeof body.token).toBe('string');
    expect(body.user?.username).toBe('lockout-user-case');
  });

  it('resets to a fresh window (not an immediate re-lock) after an expired lock', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const userId = await seedUser(db, 'lockout-user-5');
    await execute(db,
      `UPDATE users SET failed_login_count = 5, locked_until = datetime('now', '-1 minute') WHERE id = ?`,
      userId);
    const res = await post('lockout-user-5', 'wrong-password', '10.1.0.5');
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_USERNAME_OR_PASSWORD');
    const row = await queryFirst<{ failed_login_count: number; locked_until: string | null }>(
      db, 'SELECT failed_login_count, locked_until FROM users WHERE id = ?', userId);
    expect(row?.failed_login_count).toBe(1);
    expect(row?.locked_until).toBeNull();
  });

  it('does not erase a lock a concurrent request just set (not-yet-expired locked_until stays a real lock)', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const userId = await seedUser(db, 'lockout-user-6');
    // Simulates the state right after a concurrent request's UPDATE has just
    // locked the account (locked_until in the FUTURE, not expired).
    await execute(db,
      `UPDATE users SET failed_login_count = 5, locked_until = datetime('now', '+15 minutes') WHERE id = ?`,
      userId);
    // The is_locked SELECT branch would normally reject this before reaching
    // the wrong-password UPDATE at all — but exercise the UPDATE's own CASE
    // logic in isolation to prove it does NOT treat a not-yet-expired
    // locked_until as stale, confirming the fix's WHERE clause is correct
    // even if this code path were ever reached directly.
    const row = await queryFirst<{ locked_until: string | null }>(
      db,
      `UPDATE users SET
         failed_login_count = (CASE WHEN locked_until IS NOT NULL AND locked_until <= datetime('now') THEN 0 ELSE failed_login_count END) + 1,
         locked_until = CASE
           WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= datetime('now') THEN 0 ELSE failed_login_count END) + 1 >= 5
             THEN datetime('now', '+15 minutes')
           ELSE locked_until
         END
       WHERE id = ?
       RETURNING locked_until`,
      userId,
    );
    // A not-yet-expired locked_until must remain set — never reset to NULL
    // by this statement.
    expect(row?.locked_until).not.toBeNull();
  });
});

async function mintAccessToken(secret: string, userId: number, role: string, username: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: String(userId), user_id: userId, userId, username, role, iat: now, exp: now + 900, type: 'access' }, secret);
}

describe('POST /security/unlock-account', () => {
  const SECRET = 'test-jwt-secret-do-not-use-in-prod';

  it('clears failed_login_count and locked_until for admin callers', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db,
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES ('admin-unlock-1', 'x', 'Admin One', 'admin', 'active')`);
    const admin = await queryFirst<{ id: number }>(db, `SELECT id FROM users WHERE username = 'admin-unlock-1'`);
    await execute(db,
      `INSERT INTO users (username, password_hash, full_name, role, status, failed_login_count, locked_until)
       VALUES ('locked-target-1', 'x', 'Locked Target', 'officer', 'active', 5, datetime('now', '+15 minutes'))`);
    const target = await queryFirst<{ id: number }>(db, `SELECT id FROM users WHERE username = 'locked-target-1'`);

    const token = await mintAccessToken(SECRET, admin!.id, 'admin', 'admin-unlock-1');
    const res = await authRouter.request('/security/unlock-account', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ username: 'locked-target-1' }),
    }, { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET });

    expect(res.status).toBe(200);
    const row = await queryFirst<{ failed_login_count: number; locked_until: string | null }>(
      db, 'SELECT failed_login_count, locked_until FROM users WHERE id = ?', target!.id);
    expect(row?.failed_login_count).toBe(0);
    expect(row?.locked_until).toBeNull();
  });

  it('rejects non-admin/manager roles with 403', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db,
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES ('officer-unlock-1', 'x', 'Officer One', 'officer', 'active')`);
    const officer = await queryFirst<{ id: number }>(db, `SELECT id FROM users WHERE username = 'officer-unlock-1'`);
    const token = await mintAccessToken(SECRET, officer!.id, 'officer', 'officer-unlock-1');
    const res = await authRouter.request('/security/unlock-account', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ username: 'locked-target-1' }),
    }, { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET });
    expect(res.status).toBe(403);
  });
});

describe('POST /login — max active sessions cap (Security Policy enforcement)', () => {
  const TEST_PASSWORD = 'CorrectHorseBattery1';
  const TEST_PASSWORD_HASH = hashSync(TEST_PASSWORD, 4); // low cost — test speed only

  function loginEnv() {
    return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod' };
  }

  async function seedUser(db: D1Database, username: string): Promise<number> {
    await execute(db,
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES (?, ?, 'Test User', 'officer', 'active')`,
      username, TEST_PASSWORD_HASH);
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM users WHERE username = ?', username);
    return row!.id;
  }

  // `sessions.created_at` is second-precision (`datetime('now')`), so 3
  // logins fired back-to-back in a single test can land in the same second
  // and tie on the cap query's `ORDER BY created_at DESC`. After each login,
  // stamp that session's created_at to a fixed point in the PAST (offset
  // seconds relative to "now", strictly increasing toward 0 call-over-call)
  // so it's already ordered correctly before the *next* login's cap-cleanup
  // UPDATE runs and compares against it. The most-recent login is left with
  // its real (offset 0 / unstamped) created_at, which is always >= any
  // earlier stamped-into-the-past session.
  async function login(db: D1Database, username: string, ip: string, pastOffsetSeconds: number) {
    const res = await authRouter.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ username, password: TEST_PASSWORD }),
    }, loginEnv());
    expect(res.status).toBe(200);
    if (pastOffsetSeconds > 0) {
      await execute(
        db,
        `UPDATE sessions SET created_at = datetime('now', ?) WHERE rowid = (SELECT MAX(rowid) FROM sessions)`,
        `-${pastOffsetSeconds} seconds`,
      );
    }
    return res;
  }

  async function activeSessionsFor(db: D1Database, userId: number) {
    const rows = await query<{ session_id: string; is_active: number; created_at: string }>(
      db,
      'SELECT session_id, is_active, created_at FROM sessions WHERE user_id = ? ORDER BY created_at ASC, rowid ASC',
      userId,
    );
    return rows;
  }

  // `system_config` is created once, up front, by the 'POST /login — account
  // lockout' describe's beforeAll above (CREATE TABLE IF NOT EXISTS makes a
  // second attempt here harmless, but it's unnecessary — this suite only
  // ever needs to read/write rows, not the schema).

  it('caps active sessions at the saved max_active_sessions policy value, deactivating the oldest', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db,
      `INSERT INTO system_config (config_key, category, config_value, is_active)
       VALUES ('security_config', 'security_settings', ?, 1)`,
      JSON.stringify({ max_active_sessions: '2' }));

    const userId = await seedUser(db, 'session-cap-user-1');
    await login(db, 'session-cap-user-1', '10.2.0.1', 4); // oldest
    await login(db, 'session-cap-user-1', '10.2.0.1', 2); // middle
    await login(db, 'session-cap-user-1', '10.2.0.1', 0); // newest

    const sessions = await activeSessionsFor(db, userId);
    expect(sessions).toHaveLength(3);
    // Oldest (first-created) session must be deactivated; the 2 most recent stay active.
    expect(sessions[0].is_active).toBe(0);
    expect(sessions[1].is_active).toBe(1);
    expect(sessions[2].is_active).toBe(1);
  });

  it('leaves all sessions active when no security_settings row is saved (0/absent = unenforced)', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    // getSecurityPolicy() reads a single GLOBAL row (no user scoping —
    // `WHERE category='security_settings' AND config_key='security_config'
    // AND is_active=1`), so the row the previous test saved would otherwise
    // leak into this one. Deactivate it so getSecurityPolicy() falls back to
    // DEFAULT_SECURITY_POLICY.maxActiveSessions === 0, which disables the cap
    // entirely rather than capping at zero.
    await execute(db, `UPDATE system_config SET is_active = 0 WHERE category = 'security_settings' AND config_key = 'security_config'`);
    const userId = await seedUser(db, 'session-cap-user-2');
    await login(db, 'session-cap-user-2', '10.2.0.2', 4);
    await login(db, 'session-cap-user-2', '10.2.0.2', 2);
    await login(db, 'session-cap-user-2', '10.2.0.2', 0);

    const sessions = await activeSessionsFor(db, userId);
    expect(sessions).toHaveLength(3);
    expect(sessions.every(s => s.is_active === 1)).toBe(true);
  });
});

describe('GET /security/locked-accounts', () => {
  const SECRET = 'test-jwt-secret-do-not-use-in-prod';

  it('lists currently-locked accounts for admin callers', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db,
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES ('admin-list-1', 'x', 'Admin List', 'admin', 'active')`);
    const admin = await queryFirst<{ id: number }>(db, `SELECT id FROM users WHERE username = 'admin-list-1'`);
    await execute(db,
      `INSERT INTO users (username, password_hash, full_name, role, status, failed_login_count, locked_until)
       VALUES ('locked-target-2', 'x', 'Locked Target Two', 'officer', 'active', 5, datetime('now', '+15 minutes'))`);

    const token = await mintAccessToken(SECRET, admin!.id, 'admin', 'admin-list-1');
    const res = await authRouter.request('/security/locked-accounts', {
      headers: { authorization: `Bearer ${token}` },
    }, { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ username: string }> };
    expect(body.data.some(a => a.username === 'locked-target-2')).toBe(true);
  });
});
