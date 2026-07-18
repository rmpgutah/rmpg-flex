# Wire up readOnlyRoleGuard — Design

**Date:** 2026-07-18
**Status:** Approved for planning

## Purpose

`readOnlyRoleGuard` (`src/middleware/auth.ts:148-154`) blocks any `client_viewer`-role
request from reaching a POST/PUT/PATCH/DELETE handler. Its own comment
(`src/middleware/auth.ts:141-144`) claims it's "Mounted on every auth-required prefix in
src/index.ts, right after authMiddleware" — that's false today: the function is defined but
never imported or called anywhere in `src/`. This closes that gap by actually wiring it in.

## Why this is safe

Investigated before writing this spec (full findings in conversation, not duplicated here):
no UI path in `client/src/` ever enables a mutating action for `client_viewer`; no Worker
route allow-lists `client_viewer` for writes; the `users.role` CHECK constraint has no
scoped-write carve-out for it; there is no external client/vendor self-service portal that
depends on `client_viewer` being able to write. `src/routes/fleet.ts` and
`src/routes/alarms.ts` already added their own router-level write guards independently —
turning on `readOnlyRoleGuard` is redundant defense-in-depth for those two, not a behavior
change anywhere.

## Change

In `src/index.ts`, in the same loop that wires `authMiddleware` per `auth: 'required'` prefix
(`:112-115`), add the guard immediately after:

```ts
for (const prefix of requiredPrefixes) {
  app.use(prefix, authMiddleware);
  app.use(`${prefix}/*`, authMiddleware);
  app.use(prefix, readOnlyRoleGuard);
  app.use(`${prefix}/*`, readOnlyRoleGuard);
}
```

(Exact variable names to be confirmed against the live loop at implementation time — this is
the shape, not a byte-exact diff.) Import `readOnlyRoleGuard` alongside the existing
`authMiddleware` import from `./middleware/auth`.

Ordering matters: the guard must run **after** `authMiddleware` (it reads `c.get('user').role`,
which `authMiddleware` sets) — placing it in the same loop, right after the existing auth
lines, guarantees that for every prefix.

## Non-goals

- Not touching `fleet.ts`'s or `alarms.ts`'s existing router-level guards — they stay as
  belt-and-suspenders, redundant with the now-active global guard.
- Not changing `READ_ONLY_ROLES` (still just `client_viewer`) or `MUTATING_METHODS` in
  `src/middleware/auth.ts` — those are already correct, only the wiring was missing.
- Not adding a new role or changing the `users.role` CHECK constraint.

## Testing

`test-workers/auth.test.ts` already has unit tests for `readOnlyRoleGuard` in isolation
(mounting it directly on a test-only Hono app — see the existing `describe('readOnlyRoleGuard', ...)`
block). Add one new test that exercises the **real** `src/index.ts` app (or a representative
slice of it) to confirm a `client_viewer`-role POST against a real `auth: 'required'` route now
gets rejected end-to-end — the isolated unit tests alone don't prove the wiring itself is
correct, only that the function's internal logic is.

## Rollout

Pure Worker-side change, no migration, no client change needed. Ships in the normal PR flow.
