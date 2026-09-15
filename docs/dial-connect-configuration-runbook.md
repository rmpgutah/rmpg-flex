# Dial Connect — Configuration Runbook

Ordered, copy-pasteable steps to take the Dial Connect / native-softphone
integration from "code deployed" to "dispatchers can place and receive calls."

**Who runs this:** someone holding the Cloudflare API token for account
`5caa95c5789f4fc4ed3934b2a2c29ed4` and admin access to `app.twilio.com` +
the dispatch-app repo. None of it can be done from a Claude Code session —
the session has no Cloudflare credentials.

**Two Workers are involved and both must be configured:**

| | Worker | Repo | Deploy |
|---|---|---|---|
| CAD API | `rmpg-flex-api` (`api.rmpgutah.us`) | `rmpgutah/rmpg-flex` (this one) | `git push origin main` → `deploy.yml` |
| Dialer | `dialer` (`rmpgutah.us/dialer`) | `rmpgutah/dispatch-app` | **manual** `npm run deploy` — no CI |

> ⚠️ **dispatch-app has no CI.** A merged PR there changes nothing until
> someone runs `npm run deploy` from `~/Call Center/dispatch-app`. If the
> softphone misbehaves after a dispatch-app change, confirm it was actually
> deployed before debugging anything else.

---

## 0. Preconditions (verify, don't assume)

```bash
# In the rmpg-flex repo. Both must already be true — they are, as of this commit.
grep -n 'global_fetch_strictly_public' wrangler.toml   # expect a hit on compatibility_flags
grep -n 'DIALER_OIDC_ISSUER\|DIAL_CONNECT_WEBHOOK_URL\|APP_ORIGIN' wrangler.toml
```

`global_fetch_strictly_public` is **not optional**. Without it, every
Worker→Worker `fetch()` from `rmpg-flex-api` to `rmpgutah.us/dialer` fails with
Cloudflare error 1042, and the symptom is misleading: SSO discovery and the
whole `/api/dialer/*` proxy silently degrade to `not_configured` /
`dialer_unreachable` rather than erroring loudly. Miniflare stubs `fetch`, so
**no test catches this** — only live traffic does.

---

## 1. The shared service key (softphone control plane)

One random secret, stored under **two different names**, one in each Worker.
They must be byte-identical or every `/api/dialer/*` call 403s.

```bash
# Generate once. Keep it in the password manager, not in a chat or a file.
openssl rand -base64 32
```

```bash
# a) CAD side — in the rmpg-flex repo:
npx wrangler secret put DIAL_CONNECT_SERVICE_KEY

# b) Dialer side — in ~/Call Center/dispatch-app:
npx wrangler secret put RMPG_FLEX_SERVICE_KEY   # SAME value
npm run deploy                                   # no CI — this is required
```

Read by `src/routes/dialerVoice.ts` (sent as `x-rmpg-service-key` with
`x-rmpg-dispatcher-id`) and by `src/routes/dialerConnectImport.ts`.

**If unset:** every `/api/dialer/*` route returns `200 {ok:false,
code:'not_configured'}` — deliberately a 200, so the softphone shows its
"not configured" state instead of throwing. In the retired iframe,
`"Telephony not configured"` meant *any* non-OK token fetch, not necessarily
a missing Twilio secret — do not read it as a Twilio problem.

Optional override (defaults to `https://rmpgutah.us/dialer`, which is correct
in production — only set it for a staging dialer):

```bash
# wrangler.toml [vars], NOT a secret:
# DIAL_CONNECT_API_BASE = "https://staging.example/dialer"
```

---

## 2. Call-archive ingest secret (dispatch-app → CAD)

Authorises `POST /api/dialer-connect/ingest`, the one public dialer route.

```bash
npx wrangler secret put DIAL_CONNECT_WEBHOOK_SECRET
```

Then set the same value in dispatch-app so it can call the CAD, and redeploy it.

Despite the "HMAC" wording in `src/routesConfig.ts`, this is a **shared bearer
secret**, not a signature: `verifyIngestSecret` does a timing-safe compare of
the token in `Authorization: Bearer <secret>` (or `X-Dial-Connect-Secret`)
against the env value. Same secret also signs the outbound CFS status push to
`DIAL_CONNECT_WEBHOOK_URL` from `src/routes/dispatch/calls.ts`.

**If unset:** ingest returns `401` for every request — call history and
voicemail stop arriving, with no other symptom.

---

## 3. SSO linking (`dialer_oidc_sub`)

A dispatcher who is authenticated in Flex still cannot use the softphone until
their Flex user row is linked to a dialer OIDC `sub`. Unlinked users get the
**"Link Dial Connect"** gate and `409 {code:'dialer_unlinked'}`.

The client ID, issuer and redirect URI are already in `wrangler.toml [vars]`.
Only the secret is missing:

```bash
npx wrangler secret put DIALER_OIDC_CLIENT_SECRET
```

In dispatch-app's OIDC client registration, confirm the redirect URI is exactly:

```
https://rmpgutah.us/api/oidc/dialer/callback
```

> It must be on `rmpgutah.us`, **not** `api.rmpgutah.us`. Browser callbacks need
> the zone proxy + WAF cookie; `api.rmpgutah.us` is behind a managed challenge
> on every path except `/api/health`, so a callback there fails for a human.

Linking then happens automatically: the SSO callback matches by e-mail on first
sign-in and writes `users.dialer_oidc_sub` (`src/routes/oidc.ts`). So **each
dispatcher must sign in once via "Sign in with Dialer"** to become linked.
`ensureDialerOidcColumns` in `src/utils/db.ts` reconciles the column at runtime,
so migration `0184` landing late is not fatal.

---

## 4. Schema

Normally nothing to do: `deploy.yml` applies migrations statement-by-statement
and the drift check verifies them, both **blocking**. Confirm from the deploy
log for your commit rather than hand-applying.

Dialer migrations: `0184` (oidc link), `0272` (core tables), `0273` (drops a
stale table), `0280` (recording mirror), `0289` (dispatcher command log),
`0290` (history import).

Only if the drift check is red:

```bash
gh workflow run apply-d1-migration.yml -f filename=0280_dialer_recording_mirror.sql
```

`0290` and `0280` are also reconciled at runtime via `columnExists()`, so a
re-apply failing on a duplicate `ALTER` is harmless.

---

## 5. Verify, in this order

Most of these need a **real browser**: every path except `/api/health` is behind
a Cloudflare managed challenge that `curl` cannot solve (it returns 403
"Just a moment…" even when the service is perfectly healthy).

1. **API alive** (the one curl-able path):
   ```bash
   curl -sf https://api.rmpgutah.us/api/health   # expect {"status":"ok",...}
   ```
2. **Token mints.** Sign in at `https://rmpgutah.us` as a *linked* dispatcher and
   open the softphone. `POST /api/dialer/token` should return `{token, identity,
   expiresAt}` with `identity` = `dispatcher_<id>`.
   - `{ok:false, code:'not_configured'}` → step 1 (service key missing on the CAD side).
   - `409 dialer_unlinked` → step 3 (that user has never completed SSO).
   - `503 dialer_unreachable` → dispatch-app not deployed, or
     `global_fetch_strictly_public` missing (step 0).
   - `403 dialer_forbidden` → the two key names hold *different* values (step 1).
3. **Presence + SSE.** With the softphone open, `GET /api/dialer/presence` lists
   peers and `GET /api/dialer/stream` stays open. A stream that reconnects every
   few seconds means the upstream is rejecting the dispatcher id.
4. **Place a test call** to a mobile. Confirm two-way audio, then hang up.
5. **Archive landed:**
   ```sql
   SELECT call_sid, status, direction, duration_seconds, recording_r2_key
   FROM dialer_calls ORDER BY id DESC LIMIT 5;
   ```
   `status` must reflect reality — a `failed`/`missed` call must NOT read
   `completed`, and numbers/duration must not be NULL.
6. **Recordings are being copied into R2**, not just linked. This should trend
   to 0 over a few `*/30` cron ticks:
   ```sql
   SELECT COUNT(*) FROM dialer_calls
   WHERE recording_source_url IS NOT NULL AND recording_r2_key IS NULL;
   ```
   If it stalls, read `recording_mirror_error` / `recording_mirror_attempts`.
   Only `rmpgutah.us/dialer/*`, `dialer.rmpgutah.us`, and `*.twilio.com` over
   HTTPS are ever fetched (`isAllowedRecordingSourceUrl`) — a recording hosted
   anywhere else is refused by design.
7. **Backfill history** (admin/manager, idempotent, safe to re-run):
   ```
   POST /api/dialer-connect/import/dial-connect
   ```

---

## 6. Rollback

**There is no longer a client-side kill-switch.** P6 deleted `DialerPanel` and
the `rmpg_dialer_iframe` localStorage flag; the native softphone is the only
telephony runtime, and a stale flag in a dispatcher's browser is inert.

Rolling telephony back now means reverting the P6 commit and redeploying.
To cut telephony *off* quickly without a deploy, unset the service key —
every `/api/dialer/*` route then degrades to `not_configured` and the rest of
the CAD keeps working:

```bash
npx wrangler secret delete DIAL_CONNECT_SERVICE_KEY
```

Call history, voicemail and recordings already archived in D1/R2 are unaffected.

---

## Secret inventory

| Name | Worker | Where | Unset behaviour |
|---|---|---|---|
| `DIAL_CONNECT_SERVICE_KEY` | rmpg-flex-api | secret | `/api/dialer/*` → `200 {ok:false,not_configured}` |
| `RMPG_FLEX_SERVICE_KEY` | dialer | secret | CAD calls rejected → `403 dialer_forbidden` |
| `DIAL_CONNECT_WEBHOOK_SECRET` | rmpg-flex-api | secret | `/ingest` → `401`; archive stops |
| `DIALER_OIDC_CLIENT_SECRET` | rmpg-flex-api | secret | SSO login fails; nobody can link |
| `DIAL_CONNECT_API_BASE` | rmpg-flex-api | var (optional) | defaults `https://rmpgutah.us/dialer` |
| `DIALER_OIDC_ISSUER` / `_CLIENT_ID` / `_REDIRECT_URI` | rmpg-flex-api | var ✅ already set | — |
| `DIAL_CONNECT_WEBHOOK_URL` / `APP_ORIGIN` | rmpg-flex-api | var ✅ already set | — |

Twilio credentials live **only** in dispatch-app — `rmpg-flex-api` never sees
them. It receives a short-lived Twilio Voice token minted by the dialer, so a
Twilio misconfiguration surfaces as a token error, never as a Flex secret.
