# Phase 2 — Auth Flip (`/api/auth` → rewrite)

> **Tasks 2.1 + 2.2** of [docs/superpowers/plans/2026-06-12-worker-cutover.md](../2026-06-12-worker-cutover.md).
> **Flip shipped 2026-06-12**, commit `b9791849` (`feat(proxy): cutover /api/auth to rewrite (Phase 2)`).
> Deployed live (deploy.yml success; rule confirmed in the running `rmpg-api-proxy` bundle at
> `{ kind: "prefix", value: "/api/auth" }`, line 775). **Note:** this was run in the *same session* as
> Phase 0/1 at the operator's explicit direction, overriding the plan's default "own session" guidance.

## Task 2.1 — Pre-flight (PASS)

**Route parity (legacy ↔ rewrite):** extracted the deployed legacy `auth` router's registrations from
the bundle (word-boundary grep to exclude the `oauth` router, which mounts at `/api/email-oauth`, not
`/api/auth`) and diffed against `src/routes/auth.ts`. **43/43 exact parity — zero legacy auth routes
lack a rewrite handler.** No backport or stub needed.

**What the broad `/api/auth` prefix flip newly moves** (everything not already covered by a pre-existing
specific prefix rule): `GET /me`, `POST /refresh`, `POST /logout`, `PUT /password`,
`POST /change-password`, `GET /password-policy`, `GET /session-timeout`, `GET|PUT /profile`.

**No 2FA-lockout risk:** `/api/auth/login` was already a *prefix* rule (proxy line 1319), so
`/login`, `/login/verify-2fa`, `/login/verify-backup-code`, `/login/change-password` — the entire 2FA
login handshake — plus `/refresh`, `/sessions`, `/totp/*`, `/2fa/*`, `/webauthn/*`, `/signature`,
`/profile-image`, `/security/*` were **already on the rewrite** and carrying prod traffic. The flip
only adds post-login token operations.

**Live handler exercise (rewrite direct, `api.rmpgutah.us`):** `/refresh` 200, `/me` 200,
`/password-policy` 200, `/session-timeout` 200, `/profile` 200. `/me` returns `{user: …}` with
`avatar_url` and omits `profile_image` — **identical shape to legacy** (client fetches `/profile-image`
separately, already on the rewrite). `/logout` and `/password` verified by handler reading + schema:

**Live D1 schema check (`785de7ae`):** `users` has `password_hash, avatar_url, updated_at,
must_change_password, password_changed_at`; `sessions` has `session_id, refresh_token_hash, is_active,
last_used_at`. The rewrite's `/refresh` wrote a real `sessions` row (`b11e035f-…`, user_id 1) — session
lifecycle confirmed against live D1.

## Task 2.2 — Flip + canary (PASS)

**Proxy change:** one rule added at the TOP of `API_ROUTES`: `{ kind: 'prefix', value: '/api/auth' }`,
with a dated comment + rollback note. The redundant pre-existing specific `/api/auth/*` rules were left
in place so that deleting this single line restores the exact prior routing. `wrangler deploy --dry-run`
clean; pre-push gates (272 tests) passed.

**Live routing canary (via `wrangler tail rmpg-api-proxy`, same-origin through the proxy):**

| Path | Result | Fallthrough line? |
|------|--------|-------------------|
| `GET /api/auth/me` (rewrite token) | **200** | **none** ✅ (logged `[legacy-fallthrough]` in Phase 1; gone after flip) |
| `GET /api/auth/password-policy` | **200** | none ✅ |
| `GET /api/auth/session-timeout` | **200** | none ✅ |
| `GET /api/comms/activity-feed` (known-legacy control) | 401 | **`[legacy-fallthrough]` present** ✅ (tail still capturing) |
| `GET /api/dispatch/gps/my-vehicle` (known-legacy control) | 401 | **`[legacy-fallthrough]` present** ✅ |

→ `/api/auth/*` no longer falls through (now served by `env.API`); non-auth paths still fall to legacy.
The flip is correctly **scoped to `/api/auth` only**.

**Rewrite health watch (`wrangler tail rmpg-flex-api`, ~90s ambient window):** 63 request events,
**63/63 `outcome: ok`, zero 4xx/5xx, zero exceptions.**

## Human login canary — PASS (2026-06-12)

The operator performed a full interactive login (username + password + **2FA TOTP**) → Dashboard
through the flipped routing. The live dashboard session's `GET /api/auth/me` (with the SPA's own token)
returned **200** (`chzamo5000`, admin), served by the rewrite with **zero `[legacy-fallthrough]`**,
while ambient dashboard traffic (`/api/comms/activity-feed`, `/api/ws`) still fell through to legacy in
the same tail window — confirming end-to-end correctness and correct scoping. Session restored.

## Outstanding (do NOT close Phase 2 yet)

- **Task 2.2 Step 5 — 48h bake (NEXT SESSION):** confirm zero `[legacy-fallthrough] * /api/auth/*`
  lines AND no `/api/auth` 4xx/5xx spike on `rmpg-flex-api` over 48h. Then mark Phase 2 complete.

## Rollback (one line, any time)

Delete the `{ kind: 'prefix', value: '/api/auth' }` rule in `proxy/index.ts`, push to main
(deploy.yml redeploys ≤3 min). Tokens minted by the rewrite during the window keep working on legacy
(dual-claim) — **no forced logouts on rollback** (Phase 1 proof).
