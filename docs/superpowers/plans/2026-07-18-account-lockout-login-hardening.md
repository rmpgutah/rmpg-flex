# Account Lockout + Login Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock a user's account after 5 consecutive wrong-password attempts on `POST /api/auth/login`, auto-expiring after 15 minutes, with an admin override to unlock early.

**Architecture:** Two new columns on `users` (`failed_login_count`, `locked_until`), reconciled at runtime the same way every other post-migration column in this repo self-heals (`ensureAccountLockoutColumns()` in `src/utils/db.ts`, mirroring `ensureDialerOidcColumns`). The login handler in `src/routes/auth.ts` checks/updates these columns inline — no new table, no KV, no new dependency. Two new admin-only endpoints expose lock state to the existing Security Dashboard.

**Tech Stack:** Hono (Worker), Cloudflare D1, bcryptjs, `@cloudflare/vitest-pool-workers` (Miniflare) for route-level tests, React/TypeScript client.

## Global Constraints

- D1 does not support `IF NOT EXISTS` on `ALTER TABLE ... ADD COLUMN` — the migration accepts failure on re-apply; the runtime reconciler is the actual safety net (CLAUDE.md rule #5).
- `FAILED_LOGIN_THRESHOLD = 5`, `LOCKOUT_DURATION_MINUTES = 15` — named constants, not env-configurable (YAGNI per the approved design).
- Lockout applies ONLY to `POST /api/auth/login` (username/password). The mobile PSO QR-token flow (`src/routes/mobileCfs.ts`) is explicitly out of scope.
- Lockout response is explicit (`"Account locked... try again in N minutes"`, code `ACCOUNT_LOCKED`), not a generic invalid-credentials message — approved tradeoff, see design spec.
- Design spec: `docs/superpowers/specs/2026-07-18-account-lockout-login-hardening-design.md`.

---

## File Structure

- **Create:** `migrations/0192_account_lockout.sql` — the two `ALTER TABLE` statements, for the record (deploy applies with `continue-on-error: true`).
- **Modify:** `src/utils/db.ts` — add `ensureAccountLockoutColumns()`, mirroring the existing `ensureDialerOidcColumns()` reconciler pattern already in this file.
- **Create:** `test-workers/dbEnsureAccountLockoutColumns.test.ts` — unit test for the reconciler, mirroring `test-workers/dbEnsureAssessorColumns.test.ts`.
- **Modify:** `src/routes/auth.ts` — import the reconciler, add the two threshold/duration constants, rewrite the login handler's user-lookup/lock-check/failure-tracking block, add `GET /security/locked-accounts` and `POST /security/unlock-account`.
- **Modify:** `test-workers/auth.test.ts` — add two new `describe` blocks covering the login lockout flow and the admin unlock endpoint.
- **Modify:** `client/src/pages/SecurityDashboardPage.tsx` — add a "Locked Accounts" panel (mirrors the existing "Blocked IPs" panel) with an unlock button + confirm dialog.

---

### Task 1: Migration + column reconciler

**Files:**
- Create: `migrations/0192_account_lockout.sql`
- Modify: `src/utils/db.ts` (append after `ensureDialerOidcColumns`, i.e. after line 305)
- Test: `test-workers/dbEnsureAccountLockoutColumns.test.ts`

**Interfaces:**
- Produces: `export async function ensureAccountLockoutColumns(db: D1Database): Promise<void>` — idempotent, adds `users.failed_login_count` (`INTEGER NOT NULL DEFAULT 0`) and `users.locked_until` (`TEXT`, nullable) if missing. Task 2 calls this at the top of the login handler and the two new security endpoints.

- [ ] **Step 1: Write the failing test**

Create `test-workers/dbEnsureAccountLockoutColumns.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureAccountLockoutColumns, columnExists } from '../src/utils/db';

describe('ensureAccountLockoutColumns', () => {
  it('adds failed_login_count and locked_until to users', async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL
    )`).run();
    await ensureAccountLockoutColumns(env.DB);
    expect(await columnExists(env.DB, 'users', 'failed_login_count')).toBe(true);
    expect(await columnExists(env.DB, 'users', 'locked_until')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- dbEnsureAccountLockoutColumns`
Expected: FAIL — `ensureAccountLockoutColumns is not a function` (or a TS build error citing the missing export), since `src/utils/db.ts` doesn't export it yet.

- [ ] **Step 3: Write minimal implementation**

In `src/utils/db.ts`, append after the `ensureDialerOidcColumns` block (after line 305, before the `Jurisdiction override...` section comment at line 307):

```ts
// ── Account lockout columns reconciler ──────────────────────
// Migration 0192_account_lockout.sql adds failed_login_count and
// locked_until to users for login-attempt lockout (see
// docs/superpowers/specs/2026-07-18-account-lockout-login-hardening-design.md).
// Same self-heal situation as above (CLAUDE.md rule #5).
let _accountLockoutColumnsEnsured = false;

const ACCOUNT_LOCKOUT_COLUMNS: Array<[string, string]> = [
  ['failed_login_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['locked_until', 'TEXT'],
];

export async function ensureAccountLockoutColumns(db: D1Database): Promise<void> {
  if (_accountLockoutColumnsEnsured) return;
  for (const [col, type] of ACCOUNT_LOCKOUT_COLUMNS) {
    try {
      if (!(await columnExists(db, 'users', col))) {
        await db.prepare(`ALTER TABLE users ADD COLUMN ${col} ${type}`).run();
      }
    } catch {
      // Race or pre-existing column — tolerated by design (CLAUDE.md rule #5).
    }
  }
  _accountLockoutColumnsEnsured = await columnExists(db, 'users', 'failed_login_count');
}
```

Create `migrations/0192_account_lockout.sql`:

```sql
-- Account lockout: failed_login_count + locked_until on users.
-- D1 lacks `ADD COLUMN IF NOT EXISTS`, so the boot reconciler
-- ensureAccountLockoutColumns() in src/utils/db.ts self-heals if this
-- migration doesn't reach live D1 (see CLAUDE.md "Migrations routinely
-- fail to reach live D1 silently").
-- See docs/superpowers/specs/2026-07-18-account-lockout-login-hardening-design.md
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- dbEnsureAccountLockoutColumns`
Expected: PASS (1 test)

- [ ] **Step 5: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add migrations/0192_account_lockout.sql src/utils/db.ts test-workers/dbEnsureAccountLockoutColumns.test.ts
git commit -m "feat(auth): add account-lockout columns + runtime reconciler"
```

---

### Task 2: Login route — lockout enforcement

**Files:**
- Modify: `src/routes/auth.ts:6` (import), `:40-41` (constants), `:213-239` (login user-lookup/password-check block)
- Test: `test-workers/auth.test.ts`

**Interfaces:**
- Consumes: `ensureAccountLockoutColumns(db: D1Database): Promise<void>` from Task 1.
- Produces: `POST /login` now returns `403 { error, code: 'ACCOUNT_LOCKED', retry_after_seconds }` when locked. This is the response shape Task 4's client UI (indirectly, via the dashboard's own read of `users`) and Task 3's tests rely on.

- [ ] **Step 1: Write the failing tests**

Append to `test-workers/auth.test.ts`. Add these imports at the top of the file (alongside the existing ones):

```ts
import { hashSync } from 'bcryptjs';
import authRouter from '../src/routes/auth';
import { getDb, execute, queryFirst, columnExists } from '../src/utils/db';
```

Append this block at the end of the file, after the existing `describe('auth middleware — media-path query-auth passthrough', ...)` block:

```ts
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
      totp_enabled INTEGER NOT NULL DEFAULT 0, login_count INTEGER NOT NULL DEFAULT 0, last_login_at TEXT
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, ip_address TEXT,
      success INTEGER NOT NULL DEFAULT 0, failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, refresh_token_hash TEXT NOT NULL,
      ip_address TEXT, user_agent TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:worker -- auth.test`
Expected: FAIL — the lockout-specific tests get `401`/no `ACCOUNT_LOCKED` code where `403`/`ACCOUNT_LOCKED` is expected (current login handler has no lockout logic yet). The pre-existing middleware tests in the same file still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/routes/auth.ts:6`, change:

```ts
import { getDb, queryFirst, query, execute } from '../utils/db';
```

to:

```ts
import { getDb, queryFirst, query, execute, ensureAccountLockoutColumns } from '../utils/db';
```

After `src/routes/auth.ts:41` (`const REFRESH_TTL_SECONDS = ...`), add:

```ts
const FAILED_LOGIN_THRESHOLD = 5;
const LOCKOUT_DURATION_MINUTES = 15;
```

Replace the block at `src/routes/auth.ts:214-239` (from `const db = getDb(c.env);` through the closing `}` of the `compareSync` check) with:

```ts
    const db = getDb(c.env);
    await ensureAccountLockoutColumns(db);
    const user = await queryFirst<any>(
      db,
      `SELECT ${USER_SELECT}, password_hash, failed_login_count, locked_until,
              (locked_until IS NOT NULL AND locked_until > datetime('now')) AS is_locked,
              CAST(max(0, (julianday(locked_until) - julianday('now')) * 86400) AS INTEGER) AS lock_retry_seconds
       FROM users WHERE username = ?`,
      username
    );

    if (!user) {
      await recordLoginAttempt(db, username, ip, false, 'user_not_found');
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }

    if (user.is_locked) {
      await recordLoginAttempt(db, username, ip, false, 'account_locked');
      const minutes = Math.max(1, Math.ceil((user.lock_retry_seconds ?? 0) / 60));
      return c.json({
        error: `Account locked due to repeated failed attempts. Try again in ${minutes} minutes.`,
        code: 'ACCOUNT_LOCKED',
        retry_after_seconds: user.lock_retry_seconds ?? 0,
      }, 403);
    }

    if (user.status !== 'active') {
      await recordLoginAttempt(db, username, ip, false, 'account_inactive');
      return c.json({ error: 'Account is inactive', code: 'ACCOUNT_INACTIVE' }, 403);
    }

    if (!user.password_hash || !user.password_hash.startsWith('$2')) {
      console.error(`[auth] User "${username}" has an invalid password_hash (not a bcrypt hash). Use /api/auth/recover-all to reset.`);
      await recordLoginAttempt(db, username, ip, false, 'invalid_hash');
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }

    if (!compareSync(password, user.password_hash)) {
      const newCount = (user.failed_login_count ?? 0) + 1;
      if (newCount >= FAILED_LOGIN_THRESHOLD) {
        await execute(
          db,
          `UPDATE users SET failed_login_count = ?, locked_until = datetime('now', '+${LOCKOUT_DURATION_MINUTES} minutes') WHERE id = ?`,
          newCount, user.id,
        ).catch(() => undefined);
        await recordLoginAttempt(db, username, ip, false, 'account_locked');
        return c.json({
          error: `Account locked due to repeated failed attempts. Try again in ${LOCKOUT_DURATION_MINUTES} minutes.`,
          code: 'ACCOUNT_LOCKED',
          retry_after_seconds: LOCKOUT_DURATION_MINUTES * 60,
        }, 403);
      }
      await execute(db, `UPDATE users SET failed_login_count = ? WHERE id = ?`, newCount, user.id).catch(() => undefined);
      await recordLoginAttempt(db, username, ip, false, 'invalid_password');
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }

    // Correct password — reset the failure counter regardless of what happens
    // next (2FA gate, trusted-device check, etc). Password-guessing is what
    // lockout defends against; a wrong 2FA code afterward is unrelated.
    if (user.failed_login_count || user.locked_until) {
      await execute(db, `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?`, user.id).catch(() => undefined);
    }
```

Note: `LOCKOUT_DURATION_MINUTES` is interpolated directly into the SQL string for the `datetime('now', '+N minutes')` modifier. This is safe — it's a `const` numeric literal defined in this file, never user input (same pattern CLAUDE.md documents for internal-constant interpolation, e.g. `fleetio/sync.ts`'s `resourceToRmpgTable()`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:worker -- auth.test`
Expected: PASS (all tests in the file, including the pre-existing middleware tests and the 4 new lockout tests).

- [ ] **Step 5: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth.ts test-workers/auth.test.ts
git commit -m "feat(auth): lock account after 5 failed logins, auto-expire after 15min"
```

---

### Task 3: Admin lock-list + unlock endpoints

**Files:**
- Modify: `src/routes/auth.ts` — insert two new routes immediately after the existing `auth.post('/security/unblock-ip', ...)` handler (after `src/routes/auth.ts:1863`, before the `// ── Account recovery ...` comment block).
- Test: `test-workers/auth.test.ts`

**Interfaces:**
- Consumes: `ensureAccountLockoutColumns` (Task 1), the `failed_login_count`/`locked_until` columns (Task 1/2), `auth.use('/security/*', authMiddleware)` already mounted at `src/routes/auth.ts:1190`.
- Produces: `GET /security/locked-accounts` → `{ data: Array<{ id, username, full_name, failed_login_count, locked_until }> }`. `POST /security/unlock-account` (body `{ username }`) → `{ success: true, cleared: number }`. Task 4's client UI calls both by these exact paths/shapes.

- [ ] **Step 1: Write the failing tests**

Append to `test-workers/auth.test.ts`, after the `describe('POST /login — account lockout', ...)` block added in Task 2:

```ts
import { sign } from 'hono/jwt';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:worker -- auth.test`
Expected: FAIL — both new endpoints don't exist yet, so requests 404.

- [ ] **Step 3: Write minimal implementation**

In `src/routes/auth.ts`, immediately after the existing `auth.post('/security/unblock-ip', ...)` handler (after line 1863, before the `// ── Account recovery ...` comment), add:

```ts
// GET /api/auth/security/locked-accounts — accounts currently locked out.
auth.get('/security/locked-accounts', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  try {
    const db = getDb(c.env);
    await ensureAccountLockoutColumns(db);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT id, username, full_name, failed_login_count, locked_until
       FROM users WHERE locked_until IS NOT NULL AND locked_until > datetime('now')
       ORDER BY locked_until DESC LIMIT 100`);
    return c.json({ data: rows || [] });
  } catch {
    return c.json({ data: [] });
  }
});

// ── Security: unlock account ────────────────────────────────
auth.post('/security/unlock-account', authMiddleware, async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  try {
    const { username } = await c.req.json<{ username: string }>();
    if (!username) return c.json({ error: 'username required' }, 400);
    const db = getDb(c.env);
    await ensureAccountLockoutColumns(db);
    const r = await execute(db,
      `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE username = ?`, username);
    return c.json({ success: true, cleared: r.meta.changes ?? 0 });
  } catch { return c.json({ error: 'Failed to unlock account' }, 500); }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:worker -- auth.test`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth.ts test-workers/auth.test.ts
git commit -m "feat(auth): add admin locked-accounts list + unlock-account endpoint"
```

---

### Task 4: Admin UI — Locked Accounts panel

**Files:**
- Modify: `client/src/pages/SecurityDashboardPage.tsx`

**Interfaces:**
- Consumes: `GET /auth/security/locked-accounts` → `{ data: LockedAccount[] }`, `POST /auth/security/unlock-account` (body `{ username }`) from Task 3.

- [ ] **Step 1: Add the `LockedAccount` interface**

After the `ThreatEntry` interface (`client/src/pages/SecurityDashboardPage.tsx:24-27`), add:

```tsx
interface LockedAccount {
  id: number; username: string; full_name?: string;
  failed_login_count: number; locked_until: string;
}
```

- [ ] **Step 2: Add state**

After `const [blockedIps, setBlockedIps] = useState<any[]>([]);` (line 48), add:

```tsx
const [lockedAccounts, setLockedAccounts] = useState<LockedAccount[]>([]);
```

After `const [unblocking, setUnblocking] = useState(false);` (line 57), add:

```tsx
const [unlockTarget, setUnlockTarget] = useState<string | null>(null);
const [unlocking, setUnlocking] = useState(false);
```

- [ ] **Step 3: Fetch locked accounts in `fetchAll`**

Replace the `Promise.all` destructuring at `client/src/pages/SecurityDashboardPage.tsx:76-84`:

```tsx
      const [s, lh, t, bi, pc, sa, et] = await Promise.all([
        safeGet<SecurityStatus>('/auth/security/status'),
        safeGet<{ data: LoginEntry[] }>('/auth/security/login-history?limit=50'),
        isAdmin ? safeGet<{ data: ThreatEntry[] }>('/auth/security/recent-threats') : null,
        isAdmin ? safeGet<{ data: any[] }>('/auth/security/blocked-ips') : null,
        isAdmin ? safeGet<any>('/auth/security/password-compliance') : null,
        isAdmin ? safeGet<any>('/auth/security/session-analytics') : null,
        isAdmin ? safeGet<{ data: any[] }>('/auth/security/event-timeline?limit=100') : null,
      ]);
```

with:

```tsx
      const [s, lh, t, bi, la, pc, sa, et] = await Promise.all([
        safeGet<SecurityStatus>('/auth/security/status'),
        safeGet<{ data: LoginEntry[] }>('/auth/security/login-history?limit=50'),
        isAdmin ? safeGet<{ data: ThreatEntry[] }>('/auth/security/recent-threats') : null,
        isAdmin ? safeGet<{ data: any[] }>('/auth/security/blocked-ips') : null,
        isAdmin ? safeGet<{ data: LockedAccount[] }>('/auth/security/locked-accounts') : null,
        isAdmin ? safeGet<any>('/auth/security/password-compliance') : null,
        isAdmin ? safeGet<any>('/auth/security/session-analytics') : null,
        isAdmin ? safeGet<{ data: any[] }>('/auth/security/event-timeline?limit=100') : null,
      ]);
```

Then, right after `if (bi) setBlockedIps(bi.data || []);` (line 96), add:

```tsx
      if (la) setLockedAccounts(la.data || []);
```

- [ ] **Step 4: Add `confirmUnlock` handler**

After the `confirmUnblock` function (`client/src/pages/SecurityDashboardPage.tsx:132-144`), add:

```tsx
  const confirmUnlock = async () => {
    if (!unlockTarget) return;
    setUnlocking(true);
    try {
      await apiFetch('/auth/security/unlock-account', { method: 'POST', body: JSON.stringify({ username: unlockTarget }) });
      setLockedAccounts(prev => prev.filter(a => a.username !== unlockTarget));
      setUnlockTarget(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to unlock account');
    } finally {
      setUnlocking(false);
    }
  };
```

- [ ] **Step 5: Add the Locked Accounts panel**

Immediately after the closing of the "Blocked IPs" conditional block (the `)}` at `client/src/pages/SecurityDashboardPage.tsx:298`, right before the "Password Compliance" comment), add:

```tsx
          {/* Locked Accounts — admin only, hidden when list is empty */}
          {isAdmin && lockedAccounts.length > 0 && (
            <div className="panel-beveled bg-surface-base p-3">
              <div className="text-[9px] text-red-400 uppercase font-bold mb-2">Locked Accounts ({lockedAccounts.length})</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {lockedAccounts.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800">
                    <Lock className="w-3 h-3 text-red-400 flex-shrink-0" />
                    <span className="text-rmpg-100 flex-1 truncate">{a.full_name || a.username}</span>
                    <span className="text-rmpg-500">{a.failed_login_count} failed attempts</span>
                    <button
                      type="button"
                      className="text-[9px] text-amber-400 hover:underline"
                      onClick={() => setUnlockTarget(a.username)}
                    >
                      Unlock
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
```

- [ ] **Step 6: Add the unlock confirm dialog**

After the existing `<ConfirmDialog ... />` for unblock-IP (`client/src/pages/SecurityDashboardPage.tsx:422-432`), add:

```tsx
      <ConfirmDialog
        isOpen={!!unlockTarget}
        onClose={() => setUnlockTarget(null)}
        onConfirm={confirmUnlock}
        title="Unlock Account"
        message="Are you sure you want to unlock this account? The user will be able to attempt logins again immediately."
        details={unlockTarget ? <span className="font-mono text-rmpg-100">{unlockTarget}</span> : undefined}
        confirmLabel="Unlock"
        confirmVariant="warning"
        isLoading={unlocking}
      />
```

- [ ] **Step 7: Run client typecheck and build**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

Run: `cd client && npx vite build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/SecurityDashboardPage.tsx
git commit -m "feat(security-dashboard): show locked accounts with unlock action"
```

---

### Task 5: Rollout — apply migration to live D1

This task has no automated test — it's the operational step documented in the design spec's Rollout section and required by CLAUDE.md's migration workflow (deploy applies migrations with `continue-on-error: true`, so this must be done explicitly and verified).

- [ ] **Step 1: Merge to main**

Land Tasks 1-4 on `main` via the normal PR flow (per `feedback-use-pr-flow-not-direct-push` — do not push directly).

- [ ] **Step 2: Apply the migration directly to live D1**

Run:
```bash
scripts/apply-migration.sh 0192_account_lockout.sql
```
Expected: the script runs `wrangler d1 execute --remote --file` then records the migration in `d1_migrations`. If it reports "duplicate column" for either ALTER, that's fine — it means the runtime reconciler (Task 1) already self-healed the columns via production traffic before this step ran.

- [ ] **Step 3: Verify the columns landed**

Run:
```bash
wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM pragma_table_info('users') WHERE name IN ('failed_login_count','locked_until')"
```
Expected: both column names returned.

- [ ] **Step 4: Verify a live login still works**

```bash
curl -sf https://api.rmpgutah.us/api/health
```
Expected: `{"status":"ok",...}` (per CLAUDE.md's post-deploy health check). Then manually confirm a real login in the browser (per CLAUDE.md — most paths are behind Cloudflare's managed challenge, so `curl` against `/api/auth/login` directly won't reflect real user experience).

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1) — done. Login flow lockout/reset (Task 2) — done, including the "5th attempt reports lockout immediately" correction from spec self-review. Mobile PSO flow explicitly untouched (no task modifies `mobileCfs.ts`). Messaging (explicit lockout message) — done in Task 2. Admin unlock (Task 3) — done, mirrors `unblock-ip`. Admin UI (Task 4) — done, mirrors the Blocked IPs panel. Testing — covered per-task, matches the spec's test list (the one "column-missing degrade path" item from the spec was refined into the more precise "self-heals a users table that predates the lockout columns" test in Task 2, since a literal missing-column crash isn't reachable once the reconciler runs first). Rollout (Task 5) — done.
- **Placeholder scan:** none found — every step has complete, runnable code.
- **Type consistency:** `LockedAccount` (Task 4 client) fields match the `GET /security/locked-accounts` response shape (Task 3) exactly: `id, username, full_name, failed_login_count, locked_until`. `ensureAccountLockoutColumns` signature is identical everywhere it's referenced (Tasks 1, 2, 3).
