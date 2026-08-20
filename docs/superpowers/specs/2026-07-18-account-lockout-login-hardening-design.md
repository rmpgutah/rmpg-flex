# Account Lockout + Login Hardening — Design

**Date:** 2026-07-18
**Status:** Approved for planning

## Purpose

Add account-level lockout to the standard username/password login path
(`POST /api/auth/login`) so repeated failed attempts against a specific account are stopped even
if an attacker rotates source IPs (defeating the existing per-IP KV rate limit). This is the first
slice of a broader "advanced security hardening" pass; the other slices (general API rate
limiting, app-wide CSP/security headers, zod validation rollout) are separate specs to follow.

## Current state (context, not being changed here)

- `src/utils/rateLimit.ts` already throttles login at the edge: 30 attempts/5min per IP, 10/5min
  per username (KV fixed-window, fails open on KV error). This stays as-is — it's a fast, cheap
  first line of defense against high-volume hammering.
- `login_attempts` (migration `0001_initial*.sql`) logs every attempt (username, IP, success,
  failure_reason) but nothing reads it to gate future attempts — it's audit-only today.
- `users.status` (`active`/`inactive`/`terminated`) is the only existing account-level gate, and
  it's a manual admin field, not failure-driven.
- **No column on `users` and no logic anywhere increments a failure count or locks an account.**

## Scope

**In scope:** `POST /api/auth/login` (username/password auth) only.

**Explicitly out of scope:** the mobile PSO QR-token flow (`src/routes/mobileCfs.ts`,
`verifyMobile()`). That path has no password — it authenticates via a scanned QR `token` bound to
a specific call, with its own `max_scans` counter — a completely different threat model. Lockout
logic does not apply there and should not be bolted on as part of this change.

## Design

### Data model — new migration, `ALTER TABLE users`

```sql
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;  -- nullable ISO datetime, UTC
```

D1 doesn't support `IF NOT EXISTS` on `ADD COLUMN` (per `migrations/README.md` convention) — the
migration accepts failure on re-apply. The login route defensively checks column presence the same
way `src/routes/alpr.ts` reconciles its own columns at runtime, so a deploy where the migration
hasn't landed on live D1 yet (per the documented `continue-on-error` deploy gap) degrades to
"lockout not enforced" instead of a 500.

No new table: the counter belongs on the row the login handler already loads by username, so
checking it costs zero extra queries. This intentionally does **not** touch `login_attempts` —
that table stays a pure audit log, per `feedback-verify-live-schema-before-insert`-style caution
about not over-loading a table that already has read-audit consumers (`security/recent-threats`
etc.) with new query patterns.

### Login flow changes — `src/routes/auth.ts`, `POST /login`

Order of checks (existing steps unchanged except where noted):

1. KV rate-limit check (existing, unchanged, runs first).
2. User lookup by username (existing, unchanged).
3. **New:** if `locked_until` is set and is still in the future →
   - Return `403 { code: 'account_locked', message: 'Account locked due to repeated failed
     attempts. Try again in N minutes.', retry_after_seconds: N }`.
   - Log a `login_attempts` row with `failure_reason='account_locked'`.
   - Password is **never checked** in this branch — no timing side-channel between "wrong
     password" and "locked" responses beyond the explicit lockout message itself, which is an
     accepted tradeoff (see Messaging below).
4. `users.status !== 'active'` check (existing, unchanged).
5. Password verify (existing bcrypt compare):
   - **Wrong password** → in the same statement, atomically:
     ```sql
     UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = ?
     ```
     Read back the new count. If it has reached **5**, also set
     `locked_until = datetime('now', '+15 minutes')` (a second `UPDATE`, or combined via a `CASE`
     in one statement — implementation detail for the plan). Log the triggering attempt to
     `login_attempts` as `failure_reason='invalid_password'` (unchanged).
     **The response for this exact 5th attempt is the lockout response** (403
     `account_locked`, same shape as step 3), not a plain `invalid_password` 401 — the account is
     already locked by the time this request returns, so the user should be told immediately
     rather than finding out on their next attempt.
   - **Correct password** → reset `failed_login_count = 0, locked_until = NULL` in the same
     `UPDATE` that already bumps `login_count`/`last_login_at` on success (existing code path,
     just adds two columns to the existing `SET`).

**Threshold and duration** are named constants in `auth.ts` (`FAILED_LOGIN_THRESHOLD = 5`,
`LOCKOUT_DURATION_MINUTES = 15`), not env-configurable — YAGNI until there's a concrete need to
tune them per-deployment.

### Messaging

Lockout returns an explicit message (`"Account locked... try again in N minutes"`) rather than a
generic `"invalid credentials"`. This is an internal CAD/RMS with a known, small user base (not a
public signup surface), so the usual account-enumeration concern is low value here, and a clear
message meaningfully reduces confused-officer support load — approved tradeoff.

### Admin unlock

New endpoint `POST /api/auth/security/unlock-account` (admin-only, `requireRole`, mirrors the
existing `POST /security/unblock-ip` at `auth.ts:1853`): body `{ username }` or `{ user_id }`,
clears both `failed_login_count = 0` and `locked_until = NULL`. This exists **in addition to**
auto-expiry, not instead of it — an admin can clear a lockout early if needed.

### Admin UI

- `client/src/pages/admin/AdminUsersTab.tsx` and/or `SecurityDashboardPage.tsx` /
  `LoginHistoryTable.tsx` gain a "locked" badge on affected accounts and an "Unlock" button next
  to the existing per-IP unblock control — same visual pattern, new target.
- No new notification channel (no email-on-lockout). Dashboard visibility is the only surface,
  matching how IP blocks are already handled today.

### Non-goals

- No changes to the KV rate limiter, its thresholds, or its fail-open behavior.
- No lockout logic for the mobile PSO auth path (see Scope above).
- No admin-configurable threshold/duration (constants only, for now).
- No email/notification on lockout.

## Testing

Extend `test-workers/auth.test.ts` (existing Miniflare suite, currently 6 passing tests) with:

- 5 consecutive wrong-password attempts locks the account; the 5th attempt's response is asserted
  to be `account_locked` (not `invalid_password`), and a 6th attempt (correct or incorrect
  password) also reports `account_locked`.
- A locked account rejects login even with the **correct** password while `locked_until` is in
  the future.
- After `locked_until` passes (simulate via direct D1 write in the test, not a real 15-minute
  wait), a correct-password login succeeds and resets both columns.
- A successful login before reaching the threshold resets `failed_login_count` to 0.
- `POST /security/unlock-account` clears both columns and is rejected for non-admin roles.
- Column-missing degrade path: if the migration hasn't run (columns absent), login still succeeds
  for valid credentials without erroring (mirrors the `alpr.ts` `columnExists()` pattern's intent).

No client-side test changes required beyond whatever `AdminUsersTab`/`SecurityDashboardPage`
already has — this is primarily worker-side logic with a UI display layer on existing data.

## Rollout

1. Add migration (next free integer prefix — check `migrations/` high-water at implementation
   time, per `migrations/README.md`).
2. Apply directly to live D1 via `scripts/apply-migration.sh` after merge (deploy's migration
   step is `continue-on-error`, per CLAUDE.md) and verify via `pragma_table_info('users')`.
3. Ship worker logic + admin UI in the same PR (small enough not to need separate phasing).
