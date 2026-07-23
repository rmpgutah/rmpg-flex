# Fleet.io Webhook Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the zero-rate-limit gap on `POST /api/fleetio/webhook` (the app's general `apiRateLimit` middleware is a silent no-op there because it keys on `userId`, and this route bypasses JWT auth by design) — add an IP-keyed rate limit, a probe-detection alert via the existing notification engine, and bounded audit logging.

**Architecture:** Two additive changes to `src/routes/fleetioWebhook.ts`'s single route handler, backed by one new pure helper in `src/utils/rateLimit.ts` (`rateLimitCount`, a read-only companion to the existing `rateLimitAllow`) and one new seeded `notification_rules` row (migration), following the exact pattern the prior Fleet.io hardening phase (PR #2971) established for `fleetio_event_dead_lettered`/`fleetio_queue_unhealthy`.

**Tech Stack:** Cloudflare Workers (Hono), D1, KV, Vitest + Miniflare (`test-workers/`, `vitest.workers.config.mts`).

## Global Constraints

- All D1/KV access is async — every call must be `await`ed.
- Migrations must be idempotent. A bare `ALTER TABLE ADD COLUMN` is not idempotent on D1 and must be isolated in its own single-statement file if one is ever needed (not needed in this plan — no schema change, only a `notification_rules` seed row via `INSERT ... WHERE NOT EXISTS`, matching migration `0203`'s pattern exactly).
- After merging, apply the new migration directly to live D1 (`785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) via `scripts/apply-migration.sh <file>` and verify — the deploy step is `continue-on-error: true` and cannot be trusted alone.
- Rate limiting must fail open on a KV outage (existing `rateLimitAllow` behavior — never lock out legitimate Fleet.io traffic because of a transient KV error).
- The webhook route must keep its existing "always ACK 200 once auth passes" contract for already-covered cases (invalid JSON, unsupported event type, etc.) — this plan only touches the pre-auth rate-limit gate (new 429 path) and the bad-auth branch (401, unchanged status code, added counting/alerting behavior).
- Every new pure/testable unit gets a Vitest test in the same task. Route-level behavior (status codes, response bodies, KV state) is tested in `test-workers/fleetioWebhook.test.ts` using Miniflare's real `env.KV`/`env.DB` bindings (imported from `cloudflare:test`), not mocks — this file already does so for the existing auth/parsing/happy-path cases, and `test-workers/rateLimitMiddleware.test.ts` establishes the pattern for pre-seeding `env.KV` directly at a known window-bucket count to avoid looping real requests in a test.
- Distinct test cases that touch KV rate-limit buckets must use distinct `cf-connecting-ip` (or bucket-key) values per case — KV state is a real, shared Miniflare namespace across test cases within a file, so two cases sharing an IP would leak counts between them (mirrors `rateLimitMiddleware.test.ts`'s use of a distinct fake `userId` per case for the same reason).

---

### Task 1: `rateLimitCount` helper

**Files:**
- Modify: `src/utils/rateLimit.ts` (append after `rateLimitAllow`)
- Test: `tests/rateLimit.test.ts` (create — no existing test file for this module; check first with `ls tests/rateLimit*` in case one was added since this plan was written, and extend it instead of creating a duplicate if so)

**Interfaces:**
- Produces: `rateLimitCount(kv: KVNamespace, bucket: string, windowSeconds: number): Promise<number>` — Task 2 imports and calls this from `src/routes/fleetioWebhook.ts`.

- [ ] **Step 1: Check for an existing test file**

Run: `ls tests/rateLimit*.test.ts 2>/dev/null || echo "none"`

If a file exists, read it and follow its existing mock/import conventions for the new test cases in Step 2 below instead of the fresh-file shape shown. If none exists, proceed with Step 2 as written.

- [ ] **Step 2: Write the failing tests**

Create `tests/rateLimit.test.ts` (or extend the existing one, per Step 1):

```ts
import { describe, it, expect, vi } from 'vitest';
import { rateLimitAllow, rateLimitCount } from '../src/utils/rateLimit';

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async put(key: string, value: string) { store.set(key, value); },
    store,
  } as unknown as { get: (k: string) => Promise<string | null>; put: (k: string, v: string) => Promise<void>; store: Map<string, string> };
}

describe('rateLimitCount', () => {
  it('returns 0 for a bucket/window with no prior entries', async () => {
    const kv = fakeKv();
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(0);
  });

  it('returns the count rateLimitAllow already wrote to the same bucket/window', async () => {
    const kv = fakeKv();
    await rateLimitAllow(kv as never, 'test-bucket', 100, 60);
    await rateLimitAllow(kv as never, 'test-bucket', 100, 60);
    await rateLimitAllow(kv as never, 'test-bucket', 100, 60);
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(3);
  });

  it('does not itself increment the counter (read-only)', async () => {
    const kv = fakeKv();
    await rateLimitAllow(kv as never, 'test-bucket', 100, 60);
    await rateLimitCount(kv as never, 'test-bucket', 60);
    await rateLimitCount(kv as never, 'test-bucket', 60);
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(1);
  });

  it('fails open (returns 0) on a KV read error, matching rateLimitAllow\'s fail-open contract', async () => {
    const kv = { get: vi.fn().mockRejectedValue(new Error('KV down')) };
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(0);
  });

  it('reads the same window-bucketed key shape rateLimitAllow writes, so counts from different windows do not mix', async () => {
    const kv = fakeKv();
    // Directly seed a key for a DIFFERENT (much older) window than "now" —
    // rateLimitCount must compute the CURRENT window's key the same way
    // rateLimitAllow does, so a stale window's count is invisible.
    const staleWindowStart = Math.floor(Date.now() / 1000) - 10_000;
    kv.store.set(`rl:test-bucket:${staleWindowStart}`, '999');
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/rateLimit.test.ts`
Expected: FAIL — `rateLimitCount` is not exported from `../src/utils/rateLimit`.

- [ ] **Step 4: Implement `rateLimitCount`**

Append to `src/utils/rateLimit.ts` (after the existing `rateLimitAllow` function):

```ts

/** Read-only companion to rateLimitAllow — returns the current window's
 *  count for `bucket` WITHOUT incrementing it. Computes the same
 *  window-bucketed key (`rl:${bucket}:${windowStart}`) so it reads exactly
 *  what rateLimitAllow already wrote for "now". Used where a caller needs
 *  the running count for a decision (e.g. "has this IP crossed N failures
 *  in this window") separate from whether to allow/deny the request. */
export async function rateLimitCount(
  kv: KVNamespace,
  bucket: string,
  windowSeconds: number,
): Promise<number> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % windowSeconds);
    const key = `rl:${bucket}:${windowStart}`;
    return Number((await kv.get(key)) ?? '0');
  } catch (err) {
    log.error('KV error (failing open)', {}, err);
    return 0;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/rateLimit.test.ts`
Expected: PASS — all 5 cases.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/rateLimit.ts tests/rateLimit.test.ts
git commit -m "feat(rate-limit): add read-only rateLimitCount companion to rateLimitAllow"
```

---

### Task 2: Migration — seed the probe-detection alert rule

**Files:**
- Create: `migrations/0204_fleetio_webhook_probe_alert_rule.sql`

**Interfaces:**
- Produces: one `notification_rules` row with `trigger_event = 'fleetio_webhook_probe_detected'` — Task 3's route code calls `evaluateNotificationRules(db, 'fleetio_webhook_probe_detected', ...)`, matched against this row.

- [ ] **Step 1: Confirm the next free migration number**

Run: `ls migrations | sort -t_ -k1 -n | tail -3`
Expected: highest is `0203_fleetio_health_alert_rules.sql` (or higher, if something merged since this plan was written — if so, use the next free integer instead of `0204` and adjust the filename in every step below accordingly).

- [ ] **Step 2: Create the migration**

`migrations/0204_fleetio_webhook_probe_alert_rule.sql`:

```sql
-- Default notification rule for the Fleet.io webhook hardening pass
-- (Webhook Hardening spec, 2026-07-23). Fires when POST /api/fleetio/webhook
-- sees 10+ failed Authorization-header comparisons from one IP within a
-- 10-minute window (see src/routes/fleetioWebhook.ts) — signals active
-- credential-guessing against FLEETIO_WEBHOOK_SECRET, distinct from an
-- occasional operator mistake (e.g. re-registering the webhook with a
-- stale secret). Seeded here (same pattern as migration 0203's two rules)
-- so the alert works without manual setup; editable/disable-able afterward
-- from Admin -> Alert Rules like any other rule. Idempotent via WHERE NOT
-- EXISTS since notification_rules has no unique index on trigger_event.
INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Fleet.io webhook probe detected', 'The Fleet.io webhook receiver saw 10+ failed auth attempts from one IP within 10 minutes — possible credential-guessing against FLEETIO_WEBHOOK_SECRET.', 'fleetio_webhook_probe_detected', '{}', '["admin"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'fleetio_webhook_probe_detected');
```

- [ ] **Step 3: Apply locally and verify**

Run: `npm run migrate:local`
Expected: Applies cleanly.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT trigger_event, is_active, target_roles FROM notification_rules WHERE trigger_event = 'fleetio_webhook_probe_detected'"`
Expected: One row, `is_active=1`, `target_roles='["admin"]'`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0204_fleetio_webhook_probe_alert_rule.sql
git commit -m "feat(fleetio): seed webhook-probe-detected alert rule"
```

---

### Task 3: Wire rate limiting, probe alert, and bounded audit logging into the route

**Files:**
- Modify: `src/routes/fleetioWebhook.ts` (route handler, currently starting line 183)
- Test: `test-workers/fleetioWebhook.test.ts` (append new `describe` blocks)

**Interfaces:**
- Consumes: `rateLimitAllow`, `rateLimitCount` (Task 1, `src/utils/rateLimit.ts`); `evaluateNotificationRules` (`src/routes/notificationEngine.ts`, signature `(db, triggerEvent, context, env?) => Promise<{ rulesMatched: number; notified: number }>`); the seeded `fleetio_webhook_probe_detected` rule (Task 2).
- Produces: no new exports — this task only changes the route handler's internal behavior (new `429` response path; existing `401` path gains counting/alerting side effects).

- [ ] **Step 1: Re-read the current handler before editing**

The code shown below is a snapshot — re-read `src/routes/fleetioWebhook.ts` around its `fleetioWebhook.post('/webhook', ...)` handler (search for that string) before editing, since a prior commit could have shifted lines slightly. Match by the surrounding code shown here, not blindly by line number.

- [ ] **Step 2: Write the failing route-level tests**

Append to `test-workers/fleetioWebhook.test.ts` (after the existing `describe('POST /api/fleetio/webhook — happy path', ...)` block, at the end of the file):

```ts
describe('POST /api/fleetio/webhook — rate limiting', () => {
  it('returns 429 once an IP has hit the 30-req/60s cap, without touching D1', async () => {
    const ip = '203.0.113.10'; // TEST-NET-3, RFC 5737 — safe non-routable example IP
    const windowStart = Math.floor(Date.now() / 1000);
    const bucketWindowStart = windowStart - (windowStart % 60);
    await env.KV.put(`rl:fleetio-webhook:${ip}:${bucketWindowStart}`, '30', { expirationTtl: 120 });

    const req = new Request('http://localhost/api/fleetio/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET, 'cf-connecting-ip': ip },
      body: JSON.stringify({ event: 'vehicle_updated', payload: { id: 1 } }),
    });
    const res = await app.request(req, {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(429);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('rate_limited');
  });

  it('allows a request from an IP well under the cap', async () => {
    const ip = '203.0.113.11';
    const req = new Request('http://localhost/api/fleetio/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SECRET, 'cf-connecting-ip': ip },
      body: JSON.stringify({ event: 'vehicle_updated', payload: { id: 2 } }),
    });
    const res = await app.request(req, {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/fleetio/webhook — bad-auth counting, alerting, and bounded audit logging', () => {
  function badAuthRequest(ip: string): Request {
    return new Request('http://localhost/api/fleetio/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-secret', 'cf-connecting-ip': ip },
      body: JSON.stringify({ event: 'vehicle_updated', payload: { id: 1 } }),
    });
  }

  it('writes an audit_log row for the first bad-auth attempt from a fresh IP', async () => {
    const ip = '203.0.113.20';
    const res = await app.request(badAuthRequest(ip), {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action='FLEETIO_WEBHOOK_BAD_AUTH' AND details LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();
    expect(row?.n).toBeGreaterThanOrEqual(1);
  });

  it('stops writing audit_log rows after 5 bad-auth attempts from the same IP in one window, but still returns 401', async () => {
    const ip = '203.0.113.21';
    const windowStart = Math.floor(Date.now() / 1000);
    const bucketWindowStart = windowStart - (windowStart % 600);
    // Pre-seed the bad-auth counter at 5 so this single request is the 6th.
    await env.KV.put(`rl:fleetio-webhook-badauth:${ip}:${bucketWindowStart}`, '5', { expirationTtl: 1200 });

    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action='FLEETIO_WEBHOOK_BAD_AUTH' AND details LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();

    const res = await app.request(badAuthRequest(ip), {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);

    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action='FLEETIO_WEBHOOK_BAD_AUTH' AND details LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();
    expect(after?.n).toBe(before?.n ?? 0);
  });

  it('fires the probe-detected notification exactly once when the bad-auth count reaches 10', async () => {
    const ip = '203.0.113.22';
    const windowStart = Math.floor(Date.now() / 1000);
    const bucketWindowStart = windowStart - (windowStart % 600);
    // Pre-seed at 9 so this request is the 10th — the exact trigger point.
    await env.KV.put(`rl:fleetio-webhook-badauth:${ip}:${bucketWindowStart}`, '9', { expirationTtl: 1200 });

    await env.DB.prepare(
      `INSERT OR IGNORE INTO notification_rules (name, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active)
       VALUES ('test rule', 'fleetio_webhook_probe_detected', '{}', '["admin"]', '[]', 'in_app', 1)`,
    ).run();

    const res = await app.request(badAuthRequest(ip), {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    expect(res.status).toBe(401);

    const notified = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE title LIKE '%probe%' OR message LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();
    expect(notified?.n).toBeGreaterThanOrEqual(1);

    // An 11th attempt in the SAME window must NOT fire a second notification.
    await env.KV.put(`rl:fleetio-webhook-badauth:${ip}:${bucketWindowStart}`, '10', { expirationTtl: 1200 });
    await app.request(badAuthRequest(ip), {}, { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>);
    const notifiedAfter = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE title LIKE '%probe%' OR message LIKE ?`,
    ).bind(`%${ip}%`).first<{ n: number }>();
    expect(notifiedAfter?.n).toBe(notified?.n);
  });
});
```

The `notifications` table (`migrations/0001_initial.sql`) has confirmed `title TEXT NOT NULL` and `message TEXT` columns, matching the assertions above — no adjustment needed.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetioWebhook.test.ts`
Expected: FAIL — no `429` path exists yet (first new test gets `200`, not `429`); bad-auth counting/alerting tests fail because nothing writes to the `fleetio-webhook-badauth` bucket or fires the notification yet.

- [ ] **Step 4: Add the rate-limit gate**

In `src/routes/fleetioWebhook.ts`, add the import (near the top, with the other imports):

```ts
import { rateLimitAllow, rateLimitCount } from '../utils/rateLimit';
```

Replace the start of the handler — find `fleetioWebhook.post('/webhook', async (c) => {` and the line right after it (`const secret = (c.env as Record<string, unknown>).FLEETIO_WEBHOOK_SECRET;`) — insert the rate-limit gate as the very first statement in the handler, before that line:

```ts
fleetioWebhook.post('/webhook', async (c) => {
  // IP-keyed rate limit — apiRateLimit (src/middleware/rateLimit.ts) keys
  // only on userId and is a silent no-op here, since this route bypasses
  // JWT auth by design (Fleet.io has no session to send one from). 30
  // req/60s per IP is far above Fleet.io's documented retry policy
  // (5x/hr + 1x/hr for 24h per failed delivery); sized to stop abuse, not
  // throttle real traffic. Checked before any D1 read/write or crypto
  // compare so a flood is cheap to reject.
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const withinLimit = await rateLimitAllow(c.env.KV, `fleetio-webhook:${ip}`, 30, 60);
  if (!withinLimit) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  const secret = (c.env as Record<string, unknown>).FLEETIO_WEBHOOK_SECRET;
```

- [ ] **Step 5: Add bad-auth counting, bounded audit logging, and the probe alert**

Find the existing bad-auth branch — `if (!constantTimeEquals(authHeader, expected)) { ... }` — which currently unconditionally writes to `audit_log`. Replace its body:

```ts
  if (!constantTimeEquals(authHeader, expected)) {
    // Count this failure (10-minute window), independent of the general
    // rate limit above — that one blocks by request volume; this one
    // tracks specifically-failed auth attempts, to detect credential
    // guessing even from an IP that never crosses the 30/60s cap.
    await rateLimitAllow(c.env.KV, `fleetio-webhook-badauth:${ip}`, Number.MAX_SAFE_INTEGER, 600);
    const badAuthCount = await rateLimitCount(c.env.KV, `fleetio-webhook-badauth:${ip}`, 600);

    // Bounded audit logging — only the first 5 failures per IP per window;
    // once an IP is confirmed probing (see the count===10 alert below),
    // logging every subsequent identical failure adds no new information.
    if (badAuthCount <= 5) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO audit_log (action, entity_type, details, created_at)
           VALUES ('FLEETIO_WEBHOOK_BAD_AUTH', 'fleetio_webhook', ?, datetime('now'))`,
        ).bind(JSON.stringify({ ip: c.req.header('cf-connecting-ip') ?? null })).run();
      } catch (err) {
        console.error('[fleetio-webhook] audit_log INSERT failed', err);
      }
    }

    // Fire the probe-detected alert exactly once per 10-minute window — the
    // request that pushes the count to exactly 10 is the trigger; every
    // later failure in the same window also has count>=10 but is skipped.
    if (badAuthCount === 10) {
      try {
        const { evaluateNotificationRules } = await import('./notificationEngine');
        await evaluateNotificationRules(c.env.DB, 'fleetio_webhook_probe_detected', {
          title: 'Fleet.io webhook: possible credential probing',
          message: `10+ failed webhook auth attempts from ${ip} in the last 10 minutes.`,
          priority: 'high',
          entity_type: 'fleetio_webhook_probe',
        }, c.env as { ALERT_HUB?: DurableObjectNamespace });
      } catch (err) {
        console.error('[fleetio-webhook] probe-detected notification failed', err);
      }
    }

    return c.json({ error: 'invalid authorization' }, 401);
  }
```

Note: this uses a dynamic `import('./notificationEngine')` rather than a top-level static import, matching the lazy-import style `src/index.ts`'s cron handler already uses for Fleet.io modules — avoids adding `notificationEngine.ts` (and its own dependency tree) to this route's always-loaded import graph for the overwhelmingly common case (bad auth is the exception path, not the norm). If a static import reads more naturally to you when editing and doesn't meaningfully change bundle size, that's an acceptable deviation — note it in your report either way.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/fleetioWebhook.test.ts`
Expected: PASS — all cases, including every pre-existing test in this file (the rate-limit gate must not break the happy-path/parsing/dedup tests, which don't set `cf-connecting-ip` and so all share the bucket key `fleetio-webhook:unknown` — confirm this doesn't cross the 30-request cap across those tests; if it does, either raise the test-only limit isn't an option since the code is fixed at 30, so instead add a distinct `cf-connecting-ip` header to any pre-existing test request that doesn't already have one, keeping each pre-existing test's assertions unchanged otherwise).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 8: Run the full Fleet.io test suite (unit + Miniflare) and the pure rate-limit tests**

Run: `npx vitest run tests/fleetio*.test.ts tests/rateLimit.test.ts && npx vitest run --config vitest.workers.config.mts test-workers/fleetioWebhook.test.ts test-workers/rateLimitMiddleware.test.ts`
Expected: All PASS.

- [ ] **Step 9: Commit**

```bash
git add src/routes/fleetioWebhook.ts test-workers/fleetioWebhook.test.ts
git commit -m "feat(fleetio): rate-limit webhook by IP, alert on auth-probe pattern, bound audit logging"
```

---

### Task 4: Push, open PR, apply migration to live D1

**Files:** none (operational task)

- [ ] **Step 1: Run the full pre-push gate locally**

Run: `npm run typecheck && cd client && npx tsc --noEmit && npx vitest run && cd ..`
Expected: All pass — mirrors `.husky/pre-push`.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin <branch-name>
gh pr create -R rmpgutah/rmpg-flex --title "feat(fleetio): webhook hardening (rate limit + probe alert)" --body "$(cat <<'EOF'
## Summary
- POST /api/fleetio/webhook had zero rate limiting — the app's general apiRateLimit middleware keys on userId and is a silent no-op for this route, since it bypasses JWT auth by design (Fleet.io has no session). Added an IP-keyed 30 req/60s limit.
- New fleetio_webhook_probe_detected notification (seeded rule) fires once per 10-minute window if one IP racks up 10+ failed auth attempts — surfaces active credential-guessing instead of silent 401s forever.
- Bounded the existing bad-auth audit_log write to the first 5 failures per IP per window, avoiding unthrottled D1 write amplification during a flood.

## Test plan
- [x] `npm run typecheck`
- [x] `npx vitest run tests/fleetio*.test.ts tests/rateLimit.test.ts`
- [x] `npx vitest run --config vitest.workers.config.mts test-workers/fleetioWebhook.test.ts test-workers/rateLimitMiddleware.test.ts`
- [x] `cd client && npx tsc --noEmit && npx vitest run`
- [ ] After merge: apply migration 0204 to live D1 via `scripts/apply-migration.sh`, verify via `SELECT`

Design spec: `docs/superpowers/specs/2026-07-23-fleetio-webhook-hardening-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After merge — apply the migration to live D1**

```bash
scripts/apply-migration.sh 0204_fleetio_webhook_probe_alert_rule.sql
```

- [ ] **Step 4: Verify on live D1**

```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT trigger_event, is_active FROM notification_rules WHERE trigger_event = 'fleetio_webhook_probe_detected'"
```

Expected: One row, `is_active=1`.
