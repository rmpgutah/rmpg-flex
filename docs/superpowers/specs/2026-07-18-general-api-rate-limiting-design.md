# General API Rate Limiting — Design

**Date:** 2026-07-18
**Status:** Approved for planning

## Purpose

Extend rate limiting beyond `POST /api/auth/login` (and its forgot-password siblings) to cover
the rest of the authenticated API surface. Today, `src/utils/rateLimit.ts`'s `rateLimitAllow()`
is called from exactly 6 sites, all in `src/routes/auth.ts` — every other route under
`src/routes/` (~177 files) has no throttling at all. This is slice 2 of 4 in the
advanced-security-hardening program; slice 1 (account lockout) and the `readOnlyRoleGuard`
wiring fix are already merged.

## Scope

**In scope:**
- Every route mounted under an `auth: 'required'` prefix in `ROUTE_REGISTRY`
  (`src/routesConfig.ts`) — i.e. everything gated by the standard `authMiddleware`.
- The mobile PSO QR-token path (`src/routes/mobileCfs.ts`'s `verifyMobile()`), which uses its
  own scoped `pso-mobile` JWT and is not covered by the `ROUTE_REGISTRY` auth loop at all.

**Out of scope (explicitly, not silently):**
- `auth: 'public'` prefixes (`/api/health`, `/api/map-data`, `/api/auth` itself — login already
  has its own dedicated limiter).
- `src/utils/legalDataHunter/rateLimit.ts` — a different limiter for a different purpose
  (tracking a third-party's own daily/minute call budget, not general DoS protection). Not
  touched, not consolidated with this slice's limiter.
- Per-route tuning or overrides. One blanket limit for this slice; a follow-up can add
  per-prefix overrides if a specific route later proves to need a different value.

## Design

### Reuse, don't reimplement

`src/utils/rateLimit.ts`'s `rateLimitAllow(kv: KVNamespace, bucket: string, limit: number,
windowSeconds: number): Promise<boolean>` is reused as-is — no changes to that file. It's
already fail-open on KV errors (a deliberate choice: "a KV outage must never lock the org out"),
which is the right default here too.

### New middleware — `src/middleware/rateLimit.ts`

```ts
export async function apiRateLimit(c: Context, next: Next) {
  const userId = c.get('userId') as number | undefined;
  if (userId != null) {
    const allowed = await rateLimitAllow(c.env.KV, `api:user:${userId}`, 600, 300);
    if (!allowed) {
      log.warn('API rate limit exceeded', { userId, path: new URL(c.req.url).pathname });
      return c.json({ error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' }, 429);
    }
  }
  await next();
}
```

Bucket key: `` `api:user:${userId}` `` — distinct from login's `login:user:`/`login:ip:` and
LDH's `legal_data_hunter:usage:` prefixes, no collision in the shared `KV` namespace. Limit:
**600 requests / 5-minute (300s) window** per user — generous (~2 req/sec sustained average),
chosen to catch runaway/malicious traffic without risking throttling legitimate heavy use
(live dispatch board polling, GPS updates, etc.) on a system where availability matters.
Window length matches the existing convention used by login/forgot-password (300s), for
consistency across the file.

If `userId` is somehow absent (shouldn't happen post-`authMiddleware`, but the check is
defensive rather than asserting), the middleware is a no-op — it never blocks a request it
can't attribute to a user, since IP-only throttling isn't in scope for this slice.

### Wiring — `src/index.ts`

Added to the same `for (const prefix of authPrefixes)` loop that already wires
`authMiddleware` and `readOnlyRoleGuard`, after `authMiddleware` (needs `c.get('userId')`)
and in no particular order relative to `readOnlyRoleGuard` (independent concerns):

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

### Mobile path — `src/routes/mobileCfs.ts`

`verifyMobile()` is the single choke point every mobile PSO handler already calls before
proceeding (`MobileAuth { userId, callId, ... }` on success, `null` on failure). The rate
limit check goes inside it, right after a successful verification and before returning the
auth object — one place, not per-handler:

```ts
async function verifyMobile(c: any): Promise<MobileAuth | null> {
  // ... existing verification logic unchanged ...
  const allowed = await rateLimitAllow(c.env.KV, `api:user:${payload.userId}`, 600, 300);
  if (!allowed) {
    log.warn('Mobile API rate limit exceeded', { userId: payload.userId });
    return null; // caller's existing "auth failed" 401 path handles this — no new response shape needed
  }
  return { userId: payload.userId, callId: payload.callId, /* ...existing fields... */ };
}
```

Reuses the **same bucket prefix** (`api:user:${userId}`) as the standard path — a user who's
both logged into the desktop app and using the mobile PSO flow shares one budget, which is the
correct behavior (it's the same person, same threat model).

**Deviation from the general "no new response shape" note above:** returning `null` from
`verifyMobile()` on a rate-limit hit means the caller's existing auth-failure path fires,
which returns a generic 401 rather than a distinguishable 429/`RATE_LIMITED`. This is a
knowing tradeoff to keep the change inside `verifyMobile()`'s existing return contract
(`MobileAuth | null`) rather than widening it — acceptable because mobile clients already
handle 401 as "re-authenticate," and rate-limit hits should be rare enough that the coarser
signal doesn't matter operationally.

## Testing

- Unit test for `apiRateLimit` (`src/middleware/rateLimit.ts`) in isolation: allows under
  limit, blocks over limit with the exact 429 body, is a no-op when `userId` is absent.
- Route-level test (mirroring `test-workers/readOnlyRoleGuardWiring.test.ts`'s pattern —
  import the real `app` from `src/index.ts`) proving the middleware is actually wired: a user
  who exceeds 600 requests in the window gets 429 on a real `auth: 'required'` route.
- Test for the mobile path: `verifyMobile()` returns `null` (not a thrown error) once the
  per-user budget is exhausted.

## Non-goals

- No IP-based limiting for authenticated routes (per-user only, per the approved design).
- No per-route override mechanism (flagged as a possible future slice).
- No changes to `src/utils/rateLimit.ts` or `src/utils/legalDataHunter/rateLimit.ts`.
- No changes to `auth: 'public'` prefixes.

## Rollout

Pure Worker-side change, no migration, no client change needed. Ships in the normal PR flow.
