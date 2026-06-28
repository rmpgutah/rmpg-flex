# Strangler Cutover: Three Workers → One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Phases 2–5 each get their own session with a bake period between them — never execute more than one traffic-flipping phase per session.**

**Goal:** Migrate all `rmpgutah.us/api/*` production traffic off the legacy `rmpg-flex` Worker so `rmpg-flex-api` (`/src/`) serves everything, then retire the legacy Worker — with a one-line rollback at every step.

**Architecture:** The proxy (`rmpg-api-proxy`, source `proxy/index.ts`) is the control plane: STUBS → 246 `API_ROUTES` rules → `env.API` (rewrite) → fallthrough `env.LEGACY` (legacy). The cutover is data-driven: instrument the fallthrough, inventory what still hits legacy, flip batches behind the proxy, then flip the default and retire. Both Workers share live D1 `785de7ae` — there is **no data migration**, only routing.

**Tech Stack:** Cloudflare Workers (service bindings), Workers Logs, Hono (`/src/`), D1, GitHub Actions (`deploy.yml` auto-deploys both Workers + proxy on push to main).

---

## Verified ground truth (2026-06-12 — do NOT re-litigate, but DO re-verify Phase 0 outputs)

| Fact | Evidence |
|------|----------|
| SPA sends API traffic same-origin to `rmpgutah.us/api/*` | `client/src/hooks/useApi.ts:188` (`baseUrl = '/api'`) |
| Zone route `rmpgutah.us/api/*` → `rmpg-api-proxy`; no catch-all worker on `rmpgutah.us/*` (Pages serves static directly) | memory `project-partial-cutover-via-proxy`, `project-swjs-edge-cache-loop` (zone verified 2026-06-11) |
| Proxy dispatch: STUBS first, then 246 API_ROUTES rules → `env.API`, else `env.LEGACY.fetch` at `proxy/index.ts:1880` | read 2026-06-12 |
| JWT compat is SOLVED both directions: rewrite issues `{userId, user_id}` (auth.ts:59-60); rewrite middleware reads `user_id ?? userId` (middleware/auth.ts:89) | read 2026-06-12 |
| Both workers verify each other's tokens in prod today ⇒ `JWT_SECRET` values already match | dispatch routes on env.API authenticate proxy-issued legacy tokens daily |
| Rewrite has real `/login /me /logout /refresh /password /change-password` + 2FA + webauthn handlers, schema-verified against live `sessions` | src/routes/auth.ts:26-78 comments + `project-auth-outage-name-collision` |
| `/api/ws` (main realtime socket) falls through to LEGACY; rewrite's per-isolate `broadcastAll` is dead for clients; `AlertHubDO` (one global instance, `/api/alerts-ws`) is the proven cross-isolate bus | `useLiveSync.ts:93` comment; wrangler.toml AlertHubDO block |
| Proxy has NO fallthrough logging and NO observability | grep 2026-06-12 |
| `rmpg-api-proxy` must keep exporting the 4 inert DO classes (CF error 10064) until a `deleted_classes` migration | proxy/index.ts tail block |
| NEVER rename root `wrangler.toml` `name` (login-outage incident 2026-06-02) | CLAUDE.md + `project-auth-login-500-incident` |

**Known rewrite gaps (stubs that must become handlers or stay stubs deliberately):** `/api/auth/forgot-password` is stubbed in the proxy ("form is a no-op"). Phase 2 keeps that stub.

---

## Phase 0: Instrument the fallthrough + build the legacy-traffic inventory

*One session. No traffic changes. Produces the artifact that drives Phases 3–5.*

### Task 0.1: Add fallthrough logging + observability to the proxy

**Files:**
- Modify: `proxy/index.ts:1880` (the `env.LEGACY.fetch` line)
- Modify: `proxy/wrangler.toml` (add observability)

- [ ] **Step 1: Log every legacy fallthrough**

In `proxy/index.ts`, replace:

```ts
    return env.LEGACY.fetch(request);
```

with:

```ts
    // Cutover instrumentation (Phase 0, docs/superpowers/plans/2026-06-12-
    // worker-cutover.md): every request that still reaches the legacy worker
    // is logged so Workers Logs can produce the migration inventory. Remove
    // after Phase 5 retirement.
    console.log(`[legacy-fallthrough] ${method} ${pathname}`);
    return env.LEGACY.fetch(request);
```

- [ ] **Step 2: Enable Workers Logs on the proxy**

Append to `proxy/wrangler.toml`:

```toml
# Workers Logs — required for the cutover inventory (Phase 0 of
# docs/superpowers/plans/2026-06-12-worker-cutover.md). Captures the
# [legacy-fallthrough] lines for the route-migration batches.
[observability]
enabled = true
head_sampling_rate = 1
```

- [ ] **Step 3: Verify the proxy still typechecks/builds**

Run: `cd proxy && npx wrangler deploy --dry-run 2>&1 | tail -5`
Expected: no errors, bundle summary printed.

- [ ] **Step 4: Commit + push (deploy.yml auto-deploys the proxy)**

```bash
git add proxy/index.ts proxy/wrangler.toml
git commit -m "chore(proxy): log legacy fallthroughs + enable Workers Logs (cutover Phase 0)"
git push origin HEAD:main
```

- [ ] **Step 5: Verify live**

Hit a known-legacy path in a real browser (e.g. log in at rmpgutah.us), then check the Cloudflare dashboard → Workers & Pages → `rmpg-api-proxy` → Logs for `[legacy-fallthrough] POST /api/auth/login`. Alternatively `cd proxy && npx wrangler tail rmpg-api-proxy --format pretty` while a colleague uses the app.

### Task 0.2: Static inventory of the legacy worker's route table

- [ ] **Step 1: Pull the deployed legacy source**

Use the Cloudflare MCP `workers_get_worker_code({scriptName: 'rmpg-flex'})` (extraction recipe in memory `project-live-worker-is-rmpg-flex`). Save to `docs/superpowers/plans/cutover-artifacts/legacy-worker-snapshot/` (gitignore if > a few MB).

- [ ] **Step 2: Extract its route registrations**

Grep the snapshot for route registrations (legacy is bundled Express-style: `app.get('/api/...`, `router.post(...)` etc.) and write every distinct `METHOD path-pattern` to `docs/superpowers/plans/cutover-artifacts/legacy-routes-static.md`, one per line, grouped by subsystem.

- [ ] **Step 3: Commit the artifact**

```bash
git add docs/superpowers/plans/cutover-artifacts/legacy-routes-static.md
git commit -m "docs(cutover): static legacy route inventory (Phase 0)"
git push origin HEAD:main
```

### Task 0.3: After ≥7 days, produce the dynamic traffic inventory

*(Separate session, ≥7 days after Task 0.1 ships — 7 days covers weekly usage patterns like payroll/reports.)*

- [ ] **Step 1: Query Workers Logs** for all `[legacy-fallthrough]` lines over the window (dashboard Query Builder on `rmpg-api-proxy`, filter message contains `legacy-fallthrough`, group by message, count).
- [ ] **Step 2: Write `docs/superpowers/plans/cutover-artifacts/legacy-traffic-inventory.md`**: table of `METHOD path | 7-day count | subsystem | rewrite handler exists? (grep src/routes/) | risk (low/med/high)`. Cross-check against `legacy-routes-static.md` — static-but-zero-traffic routes go in a "dormant" section (they still need Phase 3 coverage or an explicit stub decision; do not silently drop them).
- [ ] **Step 3: Derive the Phase 3 batch list** (bottom of the same file): batches of ≤15 routes, ordered lowest-risk → highest, one subsystem per batch where possible. `/api/auth/*` and `/api/ws` are EXCLUDED (they are Phases 2 and 4).
- [ ] **Step 4: Commit + push the inventory.**

---

## Phase 1: Cross-worker token proof (no traffic changes; same session as Task 0.1 is fine)

### Task 1.1: Prove a rewrite-issued token works on legacy-served routes (and vice versa)

- [ ] **Step 1: Login directly against the rewrite** (api.rmpgutah.us hosts it; `/api/health` skips the WAF but auth paths do not — run from a real browser devtools console on rmpgutah.us, or temporarily test with the WAF-skipped health pattern as a guide):

In the rmpgutah.us browser console (already past the WAF):
```js
const r = await fetch('https://api.rmpgutah.us/api/auth/login', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({username:'<test-account>', password:'<test-pass>'})});
const j = await r.json(); console.log(r.status, Object.keys(j));
```
Expected: 200 with a token. **Use a test/non-admin account.**

- [ ] **Step 2: Use that token against a known LEGACY-served path** (pick one from the fallthrough log, e.g. whatever appeared in Task 0.1 Step 5):
```js
const r2 = await fetch('/api/<legacy-served-path>', {headers:{authorization:`Bearer ${j.token}`}});
console.log(r2.status);
```
Expected: 200 (not 401). This proves the flip order is safe: after the auth flip, tokens minted by the rewrite still authorize every route still on legacy.

- [ ] **Step 3: Record the result** in `docs/superpowers/plans/cutover-artifacts/phase1-token-proof.md` (commands run, statuses observed, date). Commit + push.

**If Step 2 returns 401: STOP THE ENTIRE PLAN** and debug the legacy middleware claim requirements before any flip (this would contradict the verified ground truth — re-verify `JWT_SECRET` equality first: same secret on both workers).

---

## Phase 2: Auth flip (highest risk — its own session, off-peak, ≤30 min active window)

*Pre-req: Phase 1 proof committed. The rewrite's auth handlers are already schema-verified against live `sessions` (auth.ts comments), but they have never carried prod login traffic.*

### Task 2.1: Pre-flight verification of every auth subpath

- [ ] **Step 1: Enumerate auth routes on both sides.** From `proxy/index.ts` (the "round 3 — auth sub-paths" comment block, line ~610) the rewrite serves: `/login, /me, /logout, /refresh, /password, /change-password, /sign-urls, /webauthn/*, /login/verify-2fa, /login/verify-backup-code, /signature (GET+PUT), /2fa/*`. The proxy stubs `/forgot-password`. Grep `src/routes/auth.ts` for the current full list and diff against the legacy snapshot's auth routes (Task 0.2 artifact). Any legacy auth route missing from the rewrite either gets a handler backported FIRST (own commit, smoke test) or a documented stub.
- [ ] **Step 2: Exercise the rewrite's login/refresh/me/logout directly** (browser console against `https://api.rmpgutah.us`, test account): login → 200, `GET /api/auth/me` with the new token → 200 + correct profile fields (incl. `profile_image` — see memory `project-signature-and-avatar-upgrade`), refresh → 200 + new token, logout → 200. Verify a `sessions` row appeared and was cleared (D1 query via MCP: `SELECT user_id, created_at FROM sessions ORDER BY created_at DESC LIMIT 3`).

### Task 2.2: Flip `/api/auth` to the rewrite

- [ ] **Step 1: Add the route rule.** In `proxy/index.ts`, add to `API_ROUTES` (top of the array so it documents the flip date):

```ts
  // ── AUTH CUTOVER (Phase 2, 2026-MM-DD) ──
  // Login/refresh/me/logout now served by the rewrite (src/routes/auth.ts,
  // schema-verified vs live `sessions`; issues dual-claim {userId, user_id}
  // tokens verifiable by BOTH workers — Phase 1 proof in cutover-artifacts/).
  // The /forgot-password STUB above still wins (STUBS are checked first).
  // ROLLBACK: delete this rule, push to main (deploy.yml redeploys ≤3 min).
  { kind: 'prefix', value: '/api/auth' },
```

- [ ] **Step 2: Dry-run, commit, push** (same commands as Task 0.1 Steps 3–4, message `feat(proxy): cutover /api/auth to rewrite (Phase 2)`).
- [ ] **Step 3: Live canary, immediately after deploy:** real browser, fresh private window → login on rmpgutah.us → expect normal dispatch board. Hard-refresh an already-logged-in tab → stays logged in (old legacy-issued token still verifies on rewrite: dual-claim middleware). Test the 2FA account if one exists.
- [ ] **Step 4: Watch logs 15 minutes.** `rmpg-flex-api` Workers Logs (now enabled): filter status>=400 path startsWith /api/auth. A spike of 401/500 = rollback now (Step 1's rollback line).
- [ ] **Step 5: Bake 48h.** Next session checks: zero `[legacy-fallthrough] * /api/auth/*` lines AND no auth error spike. Record in `cutover-artifacts/phase2-auth-flip.md`.

**Rollback (any point):** delete the one rule, push to main. Tokens issued by the rewrite during the window keep working on legacy (dual-claim) — no forced logouts on rollback.

---

## Phase 3: Route-batch migration (N sessions, driven by the Task 0.3 inventory)

*Repeat this template per batch. One batch per session, 24–48h bake between batches. The proxy diff is the entire blast radius.*

### Task 3.N: Migrate batch N (template)

- [ ] **Step 1: For each route in the batch**, confirm the rewrite handler exists and is schema-true: `grep` the handler in `src/routes/`, then verify every column it touches via `pragma_table_info` on live D1 (MCP `d1_database_query`, db `785de7ae-…`). Routes with no rewrite handler get one backported first — separate commit per subsystem, with a vitest smoke test in `src/**` matching the existing test layout, run `npm test`.
- [ ] **Step 2: Add the batch's rules to `API_ROUTES`** with a dated batch comment (same pattern as Phase 2). Mind rule order: more-specific regex rules BEFORE broader prefix rules (see existing dl-records comment for the trap).
- [ ] **Step 3: Dry-run → commit → push → live-verify each endpoint** (logged-in browser network tab, or console fetch loop checking status + non-stub body — watch for `X-RMPG-Stub` headers which mean a STUB shadowed your rule).
- [ ] **Step 4: Bake 24–48h**, then check Workers Logs: zero fallthrough lines for the batch's paths, no new 4xx/5xx on rmpg-flex-api for them. Tick the batch off in `legacy-traffic-inventory.md` (commit the edit).

**Rollback:** delete that batch's rules, push.

---

## Phase 4: WebSocket cutover (`/api/ws`) — own session

*Removes the documented officer-safety caveat (useLiveSync best-effort). The rewrite's per-isolate WS map cannot work multi-isolate — the socket must be DO-backed, exactly like the proven `/api/alerts-ws` (AlertHubDO, one global instance).*

### Task 4.1: Serve `/api/ws` from AlertHubDO

- [ ] **Step 1: Read first:** `src/durable-objects/` AlertHubDO implementation + `src/routes/ws.ts` + how `/api/alerts-ws` upgrade is routed in `src/index.ts`. The implementation must relay the SAME message envelope legacy emits (`dispatch_update`, etc. — capture a sample from a live legacy socket in browser devtools BEFORE writing code, save to `cutover-artifacts/ws-message-samples.md`).
- [ ] **Step 2: Implement** `/api/ws` upgrade on the rewrite → forward into AlertHubDO `idFromName('global')`; give route handlers that currently call the dead `broadcastAll` a DO-backed `broadcast` (the AlertHub bus pattern already used by panic). Unit-test the envelope shaping (pure function) with vitest; the socket plumbing is verified live.
- [ ] **Step 3: Deploy rewrite (push to main), verify DIRECT:** browser console `new WebSocket('wss://api.rmpgutah.us/api/ws?...auth-as-current-client-does')` → receives a `dispatch_update` when a second browser changes a call status.
- [ ] **Step 4: Flip in proxy:** add `{ kind: 'exact', value: '/api/ws' }`-style rule (match the proxy's RouteRule kinds; check how WS upgrade headers traverse `env.API.fetch` — service bindings pass upgrades through). Push.
- [ ] **Step 5: Two-device live drill:** dispatcher board on machine A, change call status on machine B → A updates without the 20s poll (disable network throttling, watch the WS frame). Trigger a test panic → instant popup (this is the officer-safety fix). Record in `cutover-artifacts/phase4-ws.md`.

**Rollback:** remove the proxy rule → clients reconnect to legacy WS within their normal retry loop.

---

## Phase 5: Default flip + legacy retirement (two sessions, 1–2 weeks apart)

### Task 5.1: Flip the default (when the inventory shows 7 consecutive zero-fallthrough days)

- [ ] **Step 1:** In `proxy/index.ts`, replace the fallthrough:

```ts
    // Phase 5 (2026-MM-DD): default flipped to the rewrite. LEGACY_EMERGENCY
    // lists any path temporarily pinned back to legacy (empty = full cutover).
    // ROLLBACK: swap the two fetch lines below and push.
    for (const rule of LEGACY_EMERGENCY) {
      if (matches(rule, pathname, method)) return env.LEGACY.fetch(request);
    }
    console.log(`[default-to-rewrite] ${method} ${pathname}`);
    return env.API.fetch(request);
```

with `const LEGACY_EMERGENCY: RouteRule[] = [];` declared beside `API_ROUTES`. Keep the `env.LEGACY` service binding in `proxy/wrangler.toml` — it is the rollback lever.

- [ ] **Step 2:** Push; watch `[default-to-rewrite]` logs for surprise paths (anything unexpected = a route the inventory missed → add to LEGACY_EMERGENCY or fix forward). Bake 1–2 weeks.

### Task 5.2: Retire the legacy worker + cleanup

- [ ] **Step 1: Archive first:** `workers_get_worker_code('rmpg-flex')` → commit snapshot under `legacy/worker-cf/` with a README (same convention as `legacy/server-vps/`).
- [ ] **Step 2:** Remove the `env.LEGACY` service binding from `proxy/wrangler.toml` + the now-dead emergency block; push. THEN delete the `rmpg-flex` worker in the dashboard (deleting before unbinding breaks the proxy deploy).
- [ ] **Step 3: DO stub cleanup:** confirm in dashboard the 4 DO namespaces on `rmpg-api-proxy` are instance-free → add `deleted_classes = ["WelfareWatchDO","VoiceHubDO","AlertHubDO","PdfToolsContainer"]` migration to `proxy/wrangler.toml`, delete the inert class exports at the tail of `proxy/index.ts`, push.
- [ ] **Step 4: Docs sweep:** update CLAUDE.md (topology section), `LEGACY.md`, and memory files `project-live-worker-is-rmpg-flex` / `project-partial-cutover-via-proxy` / MEMORY.md header warning — the architecture CLAUDE.md describes finally becomes TRUE.
- [ ] **Step 5 (optional, separate decision):** retire the proxy itself by pointing the zone route `rmpgutah.us/api/*` at `rmpg-flex-api`. Only after the STUBS list is empty (each stub either implemented or intentionally 404). Zone-route changes are the single riskiest op in this repo's history — do it as its own session with the dashboard open for instant revert.

---

## Risk register (read before every phase)

1. **Never rename a worker** (`name =` in any wrangler.toml). Per-worker secrets don't follow renames → org-wide login 500s (2026-06-02 incident).
2. **deploy.yml deploys proxy from `main`** — uncommitted dashboard/manual proxy changes get reverted on the next push. Before each phase: `workers_get_worker_code('rmpg-api-proxy')` and diff against `proxy/index.ts` if there's any doubt (memory `project-partial-cutover-via-proxy` documents a stale-bundle incident).
3. **STUBS shadow API_ROUTES** — a new rule that doesn't take effect is usually a stub matching first (check `X-RMPG-Stub` header).
4. **DO migration prefix rule** — root wrangler.toml `[[migrations]]` tags are append-only.
5. **Shared D1 = no data migration, but shared schema drift** — every backported handler verifies columns via `pragma_table_info` before shipping (CLAUDE.md schema rule 5).
6. **WAF**: only `/api/health` is curl-able; all live verification happens from a logged-in browser (devtools/console) or via D1 MCP.
7. **One traffic-flipping phase per session.** Bake periods are mandatory, not optional.
