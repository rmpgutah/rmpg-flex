# General API Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a blanket 600-requests-per-5-minutes-per-user rate limit across every `auth: 'required'` route and the mobile PSO QR-token path, reusing the existing `rateLimitAllow()` KV limiter.

**Architecture:** A new middleware (`apiRateLimit`) wired into the same `authPrefixes` loop in `src/index.ts` that already applies `authMiddleware`/`readOnlyRoleGuard`, plus a matching inline check inside `verifyMobile()` (`src/routes/mobileCfs.ts`) since the mobile path uses its own auth mechanism and isn't covered by that loop.

**Tech Stack:** Hono, Cloudflare KV, `@cloudflare/vitest-pool-workers` (Miniflare) for tests.

## Global Constraints

- Reuse `rateLimitAllow(kv, bucket, limit, windowSeconds)` from `src/utils/rateLimit.ts` as-is — do not modify that file.
- Bucket key: `` `api:user:${userId}` `` (full KV key becomes `` `rl:api:user:${userId}:${windowStart}` `` via `rateLimitAllow`'s own prefixing) — distinct from `login:`/`forgot-pw:`/`legal_data_hunter:` buckets already in use.
- Limit: **600 requests / 300-second (5-minute) window**, per user. Not configurable per-route in this slice.
- On limit hit: `429 { error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' }`.
- Per-user only — no IP-based keying for this slice. If `userId` is unavailable, the middleware is a no-op (never blocks a request it can't attribute to a user).
- Rate-limit hits are logged via `log.warn` (structured logger), never a D1 write.
- Do not touch `src/utils/rateLimit.ts`, `src/utils/legalDataHunter/rateLimit.ts`, or any `auth: 'public'` prefix's wiring in `src/index.ts` other than what's needed to add this middleware.
- Design spec: `docs/superpowers/specs/2026-07-18-general-api-rate-limiting-design.md`.

---

## File Structure

- **Create:** `src/middleware/rateLimit.ts` — the `apiRateLimit` middleware, self-contained (owns the limit/window constants and the bucket-key format).
- **Test:** `test-workers/rateLimitMiddleware.test.ts` — isolated unit tests for `apiRateLimit`, mirroring the pattern `test-workers/auth.test.ts` uses for `readOnlyRoleGuard`.
- **Modify:** `src/index.ts` — one new import, two new lines in the existing `authPrefixes` loop.
- **Test:** `test-workers/apiRateLimitWiring.test.ts` — proves the middleware is actually wired into the real exported `app`, mirroring `test-workers/readOnlyRoleGuardWiring.test.ts`.
- **Modify:** `src/routes/mobileCfs.ts` — two new imports, one new check inside `verifyMobile()`.
- **Test:** `test-workers/mobileRateLimit.test.ts` — differential test proving the mobile path is gated (see Task 3 for why a differential design is required here).

---

### Task 1: `apiRateLimit` middleware

**Files:**
- Create: `src/middleware/rateLimit.ts`
- Test: `test-workers/rateLimitMiddleware.test.ts`

**Interfaces:**
- Produces: `export async function apiRateLimit(c: Context, next: Next): Promise<Response | void>` — Task 2 imports and mounts this directly; Task 3 does NOT use this function (mobile has its own inline check per the design), but reuses the same `API_RATE_LIMIT`/`API_RATE_WINDOW_SECONDS` values (600, 300) and the same `api:user:${userId}` bucket format.

- [ ] **Step 1: Write the failing test**

Create `test-workers/rateLimitMiddleware.test.ts`:

```ts
// Isolated unit test for apiRateLimit's own logic — mounts it on a
// standalone test Hono app with a fake userId injected directly (no real
// authMiddleware/JWT involved). Mirrors the pattern test-workers/auth.test.ts
// uses for readOnlyRoleGuard: this file proves the middleware's behavior in
// isolation; test-workers/apiRateLimitWiring.test.ts (Task 2) proves it's
// actually mounted in the real app.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { apiRateLimit } from '../src/middleware/rateLimit';

function appWithUserId(userId: number | undefined) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { userId?: number } }>();
  app.use('*', async (c, next) => {
    if (userId != null) c.set('userId', userId);
    await next();
  });
  app.use('*', apiRateLimit);
  app.get('/probe', (c) => c.json({ ok: true }));
  return app;
}

// Pre-seeding KV directly at a known count avoids looping 600 real requests
// per test — rateLimitAllow's own window-bucketing logic is already covered
// by the existing login-flow tests in test-workers/auth.test.ts; this file
// only needs to prove apiRateLimit wires userId -> bucket -> response
// correctly, which a single pre-seeded read/write exercises just as well.
function currentWindowStart(windowSeconds: number): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % windowSeconds);
}

describe('apiRateLimit middleware', () => {
  it('allows a request well under the limit', async () => {
    const userId = 1001;
    const windowStart = currentWindowStart(300);
    await env.KV.put(`rl:api:user:${userId}:${windowStart}`, '5', { expirationTtl: 600 });

    const app = appWithUserId(userId);
    const res = await app.request('/probe', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });

  it('blocks with 429 once the count has reached the limit', async () => {
    const userId = 1002;
    const windowStart = currentWindowStart(300);
    await env.KV.put(`rl:api:user:${userId}:${windowStart}`, '600', { expirationTtl: 600 });

    const app = appWithUserId(userId);
    const res = await app.request('/probe', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' });
  });

  it('is a no-op (always allows) when userId is absent', async () => {
    const app = appWithUserId(undefined);
    const res = await app.request('/probe', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- rateLimitMiddleware`
Expected: FAIL — `Cannot find module '../src/middleware/rateLimit'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/middleware/rateLimit.ts`:

```ts
// ============================================================
// General per-user API rate limit — applied to every auth-required
// route (see src/index.ts) and, separately, the mobile PSO path
// (see src/routes/mobileCfs.ts's verifyMobile(), which is NOT covered
// by the authPrefixes loop this middleware is mounted through).
//
// Deliberately generous: this exists to catch runaway/malicious
// traffic, not to throttle normal heavy use (live dispatch board
// polling, GPS updates, etc.) on a system where availability matters.
// See docs/superpowers/specs/2026-07-18-general-api-rate-limiting-design.md
// ============================================================
import type { Context, Next } from 'hono';
import { rateLimitAllow } from '../utils/rateLimit';
import { log } from '../utils/logger';

export const API_RATE_LIMIT = 600;
export const API_RATE_WINDOW_SECONDS = 300;

export async function apiRateLimit(c: Context, next: Next) {
  const userId = c.get('userId') as number | undefined;
  if (userId != null) {
    const allowed = await rateLimitAllow(c.env.KV, `api:user:${userId}`, API_RATE_LIMIT, API_RATE_WINDOW_SECONDS);
    if (!allowed) {
      log.warn('API rate limit exceeded', { userId, path: new URL(c.req.url).pathname });
      return c.json({ error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' }, 429);
    }
  }
  await next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- rateLimitMiddleware`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the Worker typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/middleware/rateLimit.ts test-workers/rateLimitMiddleware.test.ts
git commit -m "feat(security): add apiRateLimit middleware (600 req/5min per user)"
```

---

### Task 2: Wire into the real app

**Files:**
- Modify: `src/index.ts:22` (new import line), `src/index.ts:112-117` (auth-wiring loop)
- Test: `test-workers/apiRateLimitWiring.test.ts`

**Interfaces:**
- Consumes: `apiRateLimit` (Task 1, `src/middleware/rateLimit.ts`).
- Consumes: `app` (existing export, `src/index.ts:47`) — the test imports this directly, same pattern as `test-workers/readOnlyRoleGuardWiring.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `test-workers/apiRateLimitWiring.test.ts`:

```ts
// Proves apiRateLimit is actually MOUNTED in the real app, not just correct
// in isolation (test-workers/rateLimitMiddleware.test.ts already covers the
// middleware's own logic). Same pattern as
// test-workers/readOnlyRoleGuardWiring.test.ts — imports `app` straight from
// src/index.ts and exercises it through a real, already-proven-reachable
// auth-required route (/api/warrants/scrapers, see
// test-workers/scrapersMount.test.ts).
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { sign } from 'hono/jwt';
import { getDb, execute } from '../src/utils/db';

const SECRET = 'test-jwt-secret-do-not-use-in-prod';

async function mintAccessToken(userId: number, role: string, username: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: String(userId), user_id: userId, userId, username, role, iat: now, exp: now + 900, type: 'access' }, SECRET);
}

function testEnv() {
  return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET };
}

function currentWindowStart(windowSeconds: number): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % windowSeconds);
}

describe('apiRateLimit — wired into the real app', () => {
  it('returns 429 once a user\'s bucket is already at the limit', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      full_name TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    )`);
    await execute(db,
      `INSERT INTO users (username, role, full_name, status) VALUES ('rate-limit-wiring-test', 'admin', 'Rate Limit Test', 'active')`);
    const user = await db.prepare(`SELECT id FROM users WHERE username = 'rate-limit-wiring-test'`).first<{ id: number }>();
    const token = await mintAccessToken(user!.id, 'admin', 'rate-limit-wiring-test');

    const windowStart = currentWindowStart(300);
    await env.KV.put(`rl:api:user:${user!.id}:${windowStart}`, '600', { expirationTtl: 600 });

    const res = await app.request(
      '/api/warrants/scrapers',
      { headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' });
  });

  it('does not rate-limit a user whose bucket is fresh', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db,
      `INSERT INTO users (username, role, full_name, status) VALUES ('rate-limit-fresh-test', 'admin', 'Fresh Test', 'active')`);
    const user = await db.prepare(`SELECT id FROM users WHERE username = 'rate-limit-fresh-test'`).first<{ id: number }>();
    const token = await mintAccessToken(user!.id, 'admin', 'rate-limit-fresh-test');

    const res = await app.request(
      '/api/warrants/scrapers',
      { headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );

    expect(res.status).not.toBe(429);
  });
});
```

Note: this test file's `beforeAll`-less inline `CREATE TABLE IF NOT EXISTS users` in the first test is intentional — Miniflare D1 storage is isolated per test *file* in this repo's pool config (confirmed: `test-workers/bodycamDetections.test.ts` and `test-workers/forensicsHashes.test.ts` each create differently-shaped minimal `users` tables with no conflict), so this file's own table is independent of `readOnlyRoleGuardWiring.test.ts`'s.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- apiRateLimitWiring`
Expected: FAIL — the first test gets a status other than 429 (the middleware isn't wired yet, so the pre-seeded KV bucket is never checked).

- [ ] **Step 3: Write minimal implementation**

In `src/index.ts:22`, change:

```ts
import { authMiddleware, readOnlyRoleGuard } from './middleware/auth';
```

to:

```ts
import { authMiddleware, readOnlyRoleGuard } from './middleware/auth';
import { apiRateLimit } from './middleware/rateLimit';
```

In `src/index.ts:112-117`, change:

```ts
for (const prefix of authPrefixes) {
  app.use(prefix, authMiddleware);
  app.use(`${prefix}/*`, authMiddleware);
  app.use(prefix, readOnlyRoleGuard);
  app.use(`${prefix}/*`, readOnlyRoleGuard);
}
```

to:

```ts
for (const prefix of authPrefixes) {
  app.use(prefix, authMiddleware);
  app.use(`${prefix}/*`, authMiddleware);
  app.use(prefix, apiRateLimit);
  app.use(`${prefix}/*`, apiRateLimit);
  app.use(prefix, readOnlyRoleGuard);
  app.use(`${prefix}/*`, readOnlyRoleGuard);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- apiRateLimitWiring`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full worker suite and typecheck**

Run: `npm run test:worker`
Expected: all files pass, no new failures beyond any documented pre-existing unrelated flakes (`dispatchCallClose.test.ts`, `panicSafetyFixes.test.ts` — known pre-existing, unrelated to auth/rate-limiting).

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test-workers/apiRateLimitWiring.test.ts
git commit -m "feat(security): wire apiRateLimit into the auth-required route chain"
```

---

### Task 3: Mobile PSO path

**Files:**
- Modify: `src/routes/mobileCfs.ts:19-24` (imports), `src/routes/mobileCfs.ts:43-58` (`verifyMobile`)
- Test: `test-workers/mobileRateLimit.test.ts`

**Interfaces:**
- Consumes: `rateLimitAllow` (existing, `src/utils/rateLimit.ts`) directly — NOT `apiRateLimit` from Task 1, since `verifyMobile()` isn't Hono middleware (it's a plain async function called inline by each mobile route handler). Reuses the same limit/window values as Task 1 (600, 300) and the same `api:user:${userId}` bucket prefix, so a user active on both the desktop app and the mobile PSO flow shares one budget.

- [ ] **Step 1: Write the failing test**

Create `test-workers/mobileRateLimit.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- mobileRateLimit`
Expected: FAIL — the second test gets a non-401 status (or a 401 with a different cause) because `verifyMobile()` doesn't check the KV budget yet, so the pre-seeded "exhausted" bucket has no effect.

- [ ] **Step 3: Write minimal implementation**

In `src/routes/mobileCfs.ts:19-24`, change:

```ts
import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../types';
import { getDb, queryFirst, execute } from '../utils/db';
import { recordAudit } from '../utils/auditLog';
import { requireRole } from '../middleware/auth';
```

to:

```ts
import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../types';
import { getDb, queryFirst, execute } from '../utils/db';
import { recordAudit } from '../utils/auditLog';
import { requireRole } from '../middleware/auth';
import { rateLimitAllow } from '../utils/rateLimit';
import { log } from '../utils/logger';
```

In `src/routes/mobileCfs.ts:43-58`, change:

```ts
// Verify the scoped mobile token and confirm it's bound to the :id call.
async function verifyMobile(c: any): Promise<MobileAuth | null> {
  const header = c.req.header('authorization');
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET as string);
    const { payload } = await jwtVerify(token, secret);
    if (payload.scope !== 'pso-mobile' || !payload.callId || !payload.userId) return null;
    const paramId = parseInt(String(c.req.param('id') || ''), 10);
    if (paramId && paramId !== payload.callId) return null;
    return {
      userId: Number(payload.userId), username: String(payload.username ?? ''),
      role: String(payload.role ?? ''), callId: Number(payload.callId),
    };
  } catch { return null; }
}
```

to:

```ts
// Verify the scoped mobile token and confirm it's bound to the :id call.
// Rate limiting shares the same bucket format as apiRateLimit
// (src/middleware/rateLimit.ts) — a user active on both the desktop app
// and the mobile PSO flow shares one budget. Returning null on a
// rate-limit hit (rather than a distinct response) keeps this function's
// existing MobileAuth | null contract unchanged; callers already treat
// null as "auth required" per their existing 401 handling.
async function verifyMobile(c: any): Promise<MobileAuth | null> {
  const header = c.req.header('authorization');
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET as string);
    const { payload } = await jwtVerify(token, secret);
    if (payload.scope !== 'pso-mobile' || !payload.callId || !payload.userId) return null;
    const paramId = parseInt(String(c.req.param('id') || ''), 10);
    if (paramId && paramId !== payload.callId) return null;
    const userId = Number(payload.userId);
    const allowed = await rateLimitAllow(c.env.KV, `api:user:${userId}`, 600, 300);
    if (!allowed) {
      log.warn('Mobile API rate limit exceeded', { userId });
      return null;
    }
    return {
      userId, username: String(payload.username ?? ''),
      role: String(payload.role ?? ''), callId: Number(payload.callId),
    };
  } catch { return null; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- mobileRateLimit`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full worker suite and typecheck**

Run: `npm run test:worker`
Expected: all files pass, no new failures beyond the same pre-existing unrelated flakes noted in Task 2.

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/mobileCfs.ts test-workers/mobileRateLimit.test.ts
git commit -m "feat(security): rate-limit the mobile PSO path via verifyMobile()"
```

---

## Self-Review Notes

- **Spec coverage:** reuse of `rateLimitAllow` unchanged (Task 1) — done. Wiring into the standard auth-required chain (Task 2) — done, matches the exact loop shape from the spec. Mobile path via `verifyMobile()`'s single choke point (Task 3) — done, including the documented "shares the null-return contract" tradeoff. Bucket key format (`api:user:${userId}`), limit (600/300s), 429 response shape, `log.warn`-not-D1 logging — all present verbatim in Task 1's implementation. Non-goals (no IP keying, no per-route override, `rateLimit.ts`/`legalDataHunter/rateLimit.ts` untouched, no `auth: 'public'` wiring changes) — respected; no task touches those.
- **Placeholder scan:** none — every step has complete, runnable code.
- **Type consistency:** `apiRateLimit(c: Context, next: Next)` signature (Task 1) matches how it's mounted via `app.use(prefix, apiRateLimit)` (Task 2, same calling convention as `authMiddleware`/`readOnlyRoleGuard`). Bucket key string `` `api:user:${userId}` `` is identical across Task 1's middleware, Task 2's test assertions, and Task 3's inline `verifyMobile()` check — verified byte-for-byte across all three.
