# Wire up readOnlyRoleGuard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Actually mount the existing `readOnlyRoleGuard` middleware on every `auth: 'required'` route prefix in `src/index.ts`, closing a gap where it was defined but never wired in despite its own comment claiming otherwise.

**Architecture:** One-line addition to the existing `for (const prefix of authPrefixes)` loop in `src/index.ts` that already wires `authMiddleware` per prefix — `readOnlyRoleGuard` goes in the same loop, immediately after, so it always runs after `authMiddleware` has populated `c.get('user')`.

**Tech Stack:** Hono, `@cloudflare/vitest-pool-workers` (Miniflare) for the route-level test.

## Global Constraints

- Do not touch `READ_ONLY_ROLES` or `MUTATING_METHODS` in `src/middleware/auth.ts` — already correct, only wiring was missing.
- Do not remove or modify the existing router-level guards in `src/routes/fleet.ts` or `src/routes/alarms.ts` — they stay as redundant defense-in-depth.
- No migration, no client change — Worker-side wiring only.
- Design spec: `docs/superpowers/specs/2026-07-18-wire-readonly-role-guard-design.md`.

---

## File Structure

- **Modify:** `src/index.ts` — import `readOnlyRoleGuard`, add it to the existing auth-wiring loop.
- **Test:** `test-workers/readOnlyRoleGuardWiring.test.ts` — new file, proves the wiring end-to-end through the real exported `app`, distinct from the existing isolated-unit tests for the guard's own logic in `test-workers/auth.test.ts`.

---

### Task 1: Wire the guard into the real app

**Files:**
- Modify: `src/index.ts:22` (import), `src/index.ts:112-115` (auth-wiring loop)
- Test: `test-workers/readOnlyRoleGuardWiring.test.ts`

**Interfaces:**
- Consumes: `readOnlyRoleGuard` (existing export, `src/middleware/auth.ts:148`, signature `(c: Context, next: Next) => Promise<void | Response>`) and `authMiddleware` (existing export, same file) — both already exist, no new interface produced by this task.
- Consumes: `app` (existing export, `src/index.ts:47`, `Hono<{ Bindings: Bindings; Variables: Variables }>`) — the test imports this directly, following the established pattern in `test-workers/scrapersMount.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `test-workers/readOnlyRoleGuardWiring.test.ts`:

```ts
// Proves readOnlyRoleGuard is actually MOUNTED in the real app, not just
// correct in isolation (test-workers/auth.test.ts already covers the
// function's own logic against a standalone test Hono instance). This
// imports `app` straight from src/index.ts — same pattern as
// test-workers/scrapersMount.test.ts, which caught a router-mounted-but-
// unreachable bug that isolated-harness tests couldn't see. The guard
// is middleware, so when it's wired it short-circuits BEFORE any route
// handler's own logic runs — meaning a POST from a client_viewer to
// ANY auth-required path will get the guard's exact response body,
// regardless of what that specific handler would otherwise do. That
// makes the assertion below robust to picking any real, already-proven-
// reachable auth-required route rather than needing a special "unguarded"
// one.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
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

describe('readOnlyRoleGuard — wired into the real app', () => {
  beforeAll(async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      full_name TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    )`);
    await execute(db,
      `INSERT INTO users (username, role, full_name, status) VALUES ('viewer-wiring-test', 'client_viewer', 'Viewer Test', 'active')`);
  });

  it('blocks a client_viewer POST to a real auth-required route with the guard\'s exact response', async () => {
    const viewer = await getDb(env as unknown as { DB: D1Database })
      .prepare(`SELECT id FROM users WHERE username = 'viewer-wiring-test'`)
      .first<{ id: number }>();
    const token = await mintAccessToken(viewer!.id, 'client_viewer', 'viewer-wiring-test');

    // /api/warrants/scrapers is a real, already-proven-reachable
    // auth-required route (see test-workers/scrapersMount.test.ts).
    const res = await app.request(
      '/api/warrants/scrapers',
      { method: 'POST', headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Read-only role cannot modify data', code: 'FORBIDDEN' });
  });

  it('does not block a client_viewer GET to the same route (guard only gates mutating methods)', async () => {
    const viewer = await getDb(env as unknown as { DB: D1Database })
      .prepare(`SELECT id FROM users WHERE username = 'viewer-wiring-test'`)
      .first<{ id: number }>();
    const token = await mintAccessToken(viewer!.id, 'client_viewer', 'viewer-wiring-test');

    const res = await app.request(
      '/api/warrants/scrapers',
      { method: 'GET', headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );

    // Not 403 with the guard's body — whatever warrants.ts's own GET
    // handling does for this role (its own router-level exclusion, a
    // real response, etc.) is out of scope here; the point is the
    // guard itself must not be the thing blocking a read.
    if (res.status === 403) {
      const body = await res.json();
      expect(body).not.toEqual({ error: 'Read-only role cannot modify data', code: 'FORBIDDEN' });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- readOnlyRoleGuardWiring`
Expected: FAIL — the first test gets something other than `403 { error: 'Read-only role cannot modify data', code: 'FORBIDDEN' }` (most likely a 401 from `authMiddleware` succeeding then the route's own logic running, or a 404/other response — whatever it is, it must NOT be the guard's exact body, since the guard isn't wired yet).

- [ ] **Step 3: Write minimal implementation**

In `src/index.ts:22`, change:

```ts
import { authMiddleware } from './middleware/auth';
```

to:

```ts
import { authMiddleware, readOnlyRoleGuard } from './middleware/auth';
```

In `src/index.ts:112-115`, change:

```ts
for (const prefix of authPrefixes) {
  app.use(prefix, authMiddleware);
  app.use(`${prefix}/*`, authMiddleware);
}
```

to:

```ts
for (const prefix of authPrefixes) {
  app.use(prefix, authMiddleware);
  app.use(`${prefix}/*`, authMiddleware);
  app.use(prefix, readOnlyRoleGuard);
  app.use(`${prefix}/*`, readOnlyRoleGuard);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- readOnlyRoleGuardWiring`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full worker suite and typecheck**

Run: `npm run test:worker`
Expected: all files pass, no new failures beyond any documented pre-existing unrelated flakes.

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test-workers/readOnlyRoleGuardWiring.test.ts
git commit -m "fix(auth): wire readOnlyRoleGuard into the real auth-required route chain"
```

---

## Self-Review Notes

- **Spec coverage:** the spec's only functional requirement — mount the guard on every `auth: 'required'` prefix, after `authMiddleware` — is implemented exactly as specified in Step 3. Non-goals (not touching `fleet.ts`/`alarms.ts`, not changing `READ_ONLY_ROLES`) are respected — no other files are touched.
- **Placeholder scan:** none — every step has complete, runnable code.
- **Type consistency:** N/A — single task, no cross-task interfaces beyond consuming two already-existing exports.
