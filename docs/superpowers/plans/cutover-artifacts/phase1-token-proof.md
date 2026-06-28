# Phase 1 — Cross-Worker Token Proof

> **Task 1.1** of [docs/superpowers/plans/2026-06-12-worker-cutover.md](../2026-06-12-worker-cutover.md).
> **Result: ✅ PROOF_PASS** — a token minted by the **rewrite** (`rmpg-flex-api`, served at
> `api.rmpgutah.us`) authorizes a route still served by the **legacy** worker (`rmpg-flex`).
> The flip order in the plan is therefore safe: after the Phase 2 auth flip, tokens minted by the
> rewrite still authorize every route that remains on legacy.

**Date:** 2026-06-12
**Run by:** Claude (executing-plans), driving the operator's WAF-cleared Chrome session on `rmpgutah.us`.
**Account:** `chzamo5000` (role `admin`). The plan recommends a *test/non-admin* account; no such
account was available this session, so — with the operator's explicit approval — the proof used the
existing admin session via a **password-free refresh-token exchange** (read-only: one token exchange
+ two GETs). The rotated refresh token was written back to `localStorage` so the live session was not
disrupted. JWT verification is role-independent, so the admin role does not affect the proof's validity.

---

## Method (why this proves the claim)

- **`/api/auth/me` is the ideal target.** It *requires* a valid token (a 200 proves the token was
  *accepted*, not merely that a public route answered), and `/api/auth/me` is **not** in the proxy's
  `API_ROUTES` (verified against the deployed bundle), so the proxy falls it through to `env.LEGACY`.
- **Token provenance is unambiguous.** The token was obtained by `POST`ing the existing
  `rmpg_refresh_token` **directly to `https://api.rmpgutah.us/api/auth/refresh`**, bypassing the proxy
  entirely → it is definitively rewrite-minted. The returned token carries **both** `userId` and
  `user_id` claims (the rewrite's dual-claim format, `src/routes/auth.ts`).
- **A no-auth control** (`GET /api/auth/me` with no Authorization header) was run to confirm the
  legacy route actually enforces auth (401), making the authenticated 200 meaningful.

## Commands run (browser console, `rmpgutah.us` origin)

```js
// 1. Rewrite-minted token via direct refresh exchange (bypasses the proxy):
const rr = await fetch('https://api.rmpgutah.us/api/auth/refresh', {
  method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ refreshToken: <rmpg_refresh_token>, refresh_token: <rmpg_refresh_token> })
});
// rr.status === 200; body keys: ["token","refreshToken","sessionId","expiresIn","user"]
// token claims: ["sub","userId","user_id","username","role","fullName","full_name","sessionId","type","iat","exp"]  → dualClaim = true

// 2. CONTROL — legacy /api/auth/me with NO token:
await fetch('/api/auth/me?cutoverproof_noauth=1');            // → 401

// 3. PROOF — rewrite-minted token against the LEGACY-served path:
await fetch('/api/auth/me?cutoverproof=1', { headers:{ authorization:`Bearer ${newTok}` } });  // → 200
```

## Statuses observed

| Step | Request | Expected | Observed |
|------|---------|----------|----------|
| Refresh exchange | `POST api.rmpgutah.us/api/auth/refresh` (direct → rewrite) | 200 + token | **200** (dual-claim token returned) |
| Control | `GET rmpgutah.us/api/auth/me` (no token, → legacy) | 401 | **401** |
| **Proof** | `GET rmpgutah.us/api/auth/me` + rewrite Bearer (→ legacy) | 200 | **200** (`username: chzamo5000`) |

**`RESULT: PROOF_PASS`** (proof 200 AND control 401).

This also independently re-confirms the verified ground truth that `JWT_SECRET` is identical on both
workers (the legacy auth middleware accepted a token signed by the rewrite).

---

## Task 0.1 Step 5 — live fallthrough-log verification (same tail session)

`wrangler tail rmpg-api-proxy --format json` was running during the proof. The deployed proxy bundle
(scriptVersion `f3d63f22-5877-409f-a6e0-8ea542fec9d0`) emitted the new instrumentation line live in
production. Distinct `[legacy-fallthrough]` messages captured during the window:

```
[legacy-fallthrough] GET /api/auth/me            ← the proof request (url ...?cutoverproof=1)
[legacy-fallthrough] GET /api/comms/activity-feed
[legacy-fallthrough] GET /api/dispatch/gps/my-vehicle
[legacy-fallthrough] GET /api/ws
```

✅ Task 0.1 instrumentation confirmed firing in prod. (These few paths are only an incidental snapshot —
the authoritative legacy-traffic inventory is **Task 0.3**, a separate session after ≥7 days of logs.)

---

## Gate decision

Step 2 returned **200, not 401** → the "STOP THE ENTIRE PLAN" condition did **not** trigger.
Phase 1 is complete; the plan may proceed to Phase 2 (auth flip) **in its own later session** after the
Phase 0 bake, per the one-traffic-flip-per-session rule.
