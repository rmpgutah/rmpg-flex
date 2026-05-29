# Incident report: Production traffic isn't reaching `/src/` (the rewrite is dead code)

**Date discovered:** 2026-05-24
**Discovered during:** systematic-debugging session investigating 404/500 errors reported by Christopher (`festive-mendeleev-d6c908` worktree)
**Severity:** Architectural / Misalignment — no production outage, but every PR adding routes to `/src/` is shipping dead code from a user-visible standpoint

---

## TL;DR

| Where the team thinks production is | Where production actually is |
|---|---|
| `rmpgutah.us/api/*` → Pages `_redirects` 200-proxy → `api.rmpgutah.us` → `rmpg-flex-api` (built from `/src/` by CI) | `rmpgutah.us/api/*` → `rmpg-flex` Worker (legacy-port lineage, source NOT in this repo) via zone Workers Routes; **`rmpg-flex-api` is deployed but receives zero user traffic** |

Workers Routes evaluate before Cloudflare Pages. The `rmpg-flex` Worker has zone-level route bindings (`rmpgutah.us/*`, `www.rmpgutah.us/*`) that intercept every request — the Pages `_redirects` file and `functions/_middleware.ts` are dead code.

Every PR that adds a new route into `/src/` (warrants, trespass-orders, run-cards/by-type, premise-history, calls/check-duplicate, citations, arrests, cases, field-interviews, etc.) compiles, deploys to `rmpg-flex-api`, and is never hit by a user. The recent `route-registry` refactor likewise has zero production effect.

---

## Evidence

The session captured these in the active Cloudflare account:

### Workers (account `5caa95c5...`):

| Worker | Modified | Bound to | Notes |
|---|---|---|---|
| `rmpg-flex-api` | 2026-05-24 15:36 | `api.rmpgutah.us` (custom_domain) | Current `/src/` build. Receives no real user traffic. |
| `rmpg-flex` | 2026-05-24 09:36 | `rmpgutah.us/*`, `www.rmpgutah.us/*` (zone routes) | **Live Worker.** 63,774 lines bundled. Source references `server/src/routes/warrants-worker.ts` — a file that exists nowhere in HEAD or in `legacy/server-vps/`. |
| `rmpgflex` (no dash) | 2026-05-21 | nothing | Zombie. Delete eventually. |
| `rmpg-flex-production` | 2026-05-21 | nothing | Zombie. |
| `rmpg-flex-api-production` | 2026-05-20 | nothing | Zombie. |

### Zone Workers Routes on `rmpgutah.us`:

```
rmpgutah.us/*        → rmpg-flex
www.rmpgutah.us/*    → rmpg-flex
```

That's it. Nothing routes to `rmpg-flex-api` at the zone level. The `api.rmpgutah.us` `custom_domain` binding means the new Worker is reachable at that exact hostname, but **the client SPA never calls `api.rmpgutah.us` directly** — all client API calls use relative `/api/*` paths that resolve to `rmpgutah.us` and get intercepted by `rmpg-flex`.

### Response fingerprints proving `rmpg-flex` is what the user hits:

The user's browser response headers on every failing call carried:
- `x-request-id: <uuid>` — set by pino-http–style middleware in the bundled `rmpg-flex` source, NOT by any code in current `/src/`.
- `access-control-expose-headers: X-Request-Id` — set by `rmpg-flex`'s CORS config `exposeHeaders: ["X-Request-Id"]`. Current `src/index.ts` cors() call doesn't pass `exposeHeaders`.

Both fingerprints are absent from any build of `/src/`. The response is unambiguously from `rmpg-flex`.

---

## The original complaint (and why the obvious "fix" makes things worse)

User reported these failing in production:

- `GET /api/warrants/watch/runs` → 404
- `GET /api/dispatch/run-cards/by-type/:type` → 404
- `GET /api/dispatch/premise-history` → 404
- `GET /api/trespass-orders/check` → 500 (the deployed `rmpg-flex` has a stale handler using `LIKE ... ESCAPE '\\'` syntax that D1 rejects)
- `GET /api/dispatch/calls/check-duplicate` → 500 (same)

All of these endpoints **exist in `/src/`**. The team built them, CI deployed them, but `rmpg-flex` is the one taking the traffic — and `rmpg-flex` doesn't have them (or has older buggy versions).

The obvious "fix" — route `rmpgutah.us/api/*` to `rmpg-flex-api` — was tried in this session via a thin proxy Worker (`rmpg-api-proxy`) with a service binding. **Three blockers killed it:**

### Blocker 1: JWT format mismatch

`rmpg-flex` issues JWTs with this payload:
```js
{ userId: user.id, username, role, fullName, type: "access" }
```

`src/middleware/auth.ts` reads `jwtPayload.user_id` (snake_case). When the proxy forwarded a valid request with the user's existing `rmpg-flex`–issued JWT, `rmpg-flex-api`:
1. Verified the JWT signature (secrets match ✓)
2. Read `jwtPayload.user_id` → `undefined`
3. Queried `SELECT … WHERE id = undefined` → no row
4. Returned `{"error":"User not found or inactive"}` 401

Every authenticated request from a real user would fail this way. `src/routes/auth.ts`'s own `/login` issues `{ sub, user_id, username, role }` — incompatible with `rmpg-flex`'s clients.

### Blocker 2: Route registry bug gates all public routes

In `src/routesConfig.ts` (as of `aae02e80`):

```ts
// ── Geocode (BEFORE /api/integrations stubs catch-all) ─────
{
  prefix: '/api',  // ← bare /api root!
  router: geocode_default,
  auth: 'required',
  note: "Mounts at root /api to serve /api/geocode/* and /api/integrations/mapbox/client-token",
},
```

The registry loop in `src/index.ts` generates `app.use('/api/*', authMiddleware)` for any `auth: 'required'` prefix. With `prefix: '/api'`, that gates **every** path under `/api/` — including `/api/auth/login`, `/api/health`, `/api/map-data`. Verified by curl through the proxy:

```
GET /api/auth/login   → 401 {"error":"Authentication required"}
GET /api/health       → 401 {"error":"Authentication required"}
GET /api/map-data     → 401 {"error":"Authentication required"}
GET /                 → 200 (the `app.get('/')` handler, registered before the registry loop)
```

After cutover, no user can log in if they log out.

### Blocker 3: Feature gap is much larger than 85%

Browser console during a typical session called these (all 404 on `rmpg-flex-api` because they don't exist in `/src/`):

```
GET /api/warrants?status=active&per_page=1
GET /api/warrants/scrapers/health
GET /api/dispatch/gps/my-unit
GET /api/dispatch/gps/speed-zones
GET /api/dispatch/gps/speed-violations?hours=8
GET /api/dispatch/gps/pursuit-segments?hours=8
POST /api/dispatch/gps                                       (400)
GET /api/admin/clients                                       (500 stub)
GET /api/admin/users
GET /api/admin/training
GET /api/admin/sessions
GET /api/admin/shift-plans
GET /api/admin/map-config
GET /api/admin/mapbox-config
GET /api/admin/call-templates                                (500 stub)
GET /api/admin/third-party-keys
GET /api/admin/third-party-keys/{owntracks_webhook_token,mapbox_username,mapbox_password,...}   (~50 keys)
GET /api/integrations/services/rmpgutahps
GET /api/integrations/keys
GET /api/integrations/keys/request-log
GET /api/auth/security/login-history?limit=15&offset=0
GET /api/clearpathgps/{status,settings,mappings,dashcam-events,media-status}
GET /api/servemanager/{status,sync/log}
GET /api/email/status
GET /api/records/properties                                  (500 stub)
PUT /api/personnel/:id
```

None of these are in `/src/`. The CF migration estimate of "85% built" is wrong by at least 50 routes that real UI features depend on. Calling it 30-40% by live route count is more accurate.

---

## What this session tried, and why we reverted

**Attempt 1:** Delete `rmpg-flex`'s zone route bindings, expecting Pages to take over `rmpgutah.us` via the `_redirects` proxy. **Result:** site went offline. Cloudflare Pages was never bound as a custom-domain owner of `rmpgutah.us`; the assumption that "no Worker route → falls through to Pages" required Pages to actually own the hostname, which it doesn't. Rolled back in <30 seconds.

**Attempt 2:** Deploy a new `rmpg-api-proxy` Worker with `env.API.fetch(request)` service binding to `rmpg-flex-api`, bound to the more-specific pattern `rmpgutah.us/api/*` (wins over the less-specific `rmpgutah.us/*` by CF route specificity). Site loaded fine — non-`/api` traffic kept hitting `rmpg-flex`. But every authenticated `/api/*` call broke per Blocker 1 above. Reverted.

**Final state at end of session:** route table back to the pre-session configuration. `rmpg-api-proxy` Worker still exists in the account but is unbound; safe to delete.

---

## Action items (proposed)

Ordered by what unblocks what.

### Phase 1 — agree on the architecture

1. **Decide who owns the live `rmpg-flex` Worker's source.** Currently no one in this repo can fix bugs in it because the source isn't here. Either:
   - (a) Treat `rmpg-flex` as a black box and accept that fixes require bypassing it.
   - (b) Find the source (other branch, other repo, original CF-migration agent's worktree) and bring it into this repo as the deployed truth.
2. **Decide cutover strategy.** Options:
   - (a) **Backport everything into `rmpg-flex`'s source** (if found per #1b), keeping `/src/` as a parallel WIP. Status quo just less wasteful.
   - (b) **Finish `/src/` to true parity**, then flip routes. Multi-week project.
   - (c) **Run both in parallel**: route some path prefixes to `rmpg-flex-api`, leave the rest on `rmpg-flex`, with a router worker. Buys time but doubles operational complexity.

### Phase 2 — if (1b) or (2b): make `/src/` actually deployable safely

3. **Fix the route registry bug.** Either split the geocode router into specific prefixes:
   ```ts
   { prefix: '/api/geocode', router: geocode, auth: 'required' },
   { prefix: '/api/integrations/mapbox', router: mapboxToken, auth: 'required' },
   ```
   Or special-case the `applyAuthMiddleware` loop so bare-`/api` prefixes skip the `${prefix}/*` wildcard registration. About 4 lines either way.

4. **Add JWT backcompat to `src/middleware/auth.ts`.** Accept both `user_id` AND `userId` in the JWT payload. After 7 days of cutover (refresh-token lifetime), the legacy camelCase tokens are gone; backcompat becomes dead code that can be removed.

5. **Update `src/routes/auth.ts`** to issue tokens with BOTH `user_id` and `userId` for forward compatibility (so a brief rollback to `rmpg-flex` would still work for users who logged in via the new Worker).

6. **Inventory and backport the route gap.** Top of the list, by user-visible impact:
   - `admin/clients`, `admin/users`, `admin/training`, `admin/sessions` (admin page)
   - `admin/third-party-keys/*` (~50 key endpoints — likely worth a generic stub returning `{value: null}` so the admin page stops 404-spamming)
   - `admin/call-templates`, `admin/shift-plans`, `admin/map-config`, `admin/mapbox-config`
   - `clearpathgps/{status,settings,mappings,dashcam-events,media-status}` (vehicle telematics integration)
   - `servemanager/{status,sync/log}` (process server integration)
   - `dispatch/gps/{my-unit,speed-zones,speed-violations,pursuit-segments}`
   - `dispatch/gps` POST (real handler — current `/src/` may reject the body shape)
   - `warrants` (real CRUD, not just `watch/runs`)
   - `warrants/scrapers/health`
   - `auth/security/login-history`
   - `integrations/services/rmpgutahps`, `integrations/keys`, `integrations/keys/request-log`
   - `email/status`
   - `personnel/:id` PUT

### Phase 3 — cutover

7. With Phase 2 complete and verified, swap zone routes from `rmpg-flex` to `rmpg-flex-api`:
   ```bash
   # delete rmpg-flex bindings
   curl -X DELETE .../zones/{zone}/workers/routes/{id}  # rmpgutah.us/*
   curl -X DELETE .../zones/{zone}/workers/routes/{id}  # www.rmpgutah.us/*
   # create rmpg-flex-api bindings (or run wrangler deploy with routes in wrangler.toml)
   curl -X POST .../zones/{zone}/workers/routes -d '{"pattern":"rmpgutah.us/*","script":"rmpg-flex-api"}'
   curl -X POST .../zones/{zone}/workers/routes -d '{"pattern":"www.rmpgutah.us/*","script":"rmpg-flex-api"}'
   ```
   Rollback is the inverse — keep a snapshot of the original routes.

8. **Verify functions/_middleware.ts CSP actually applies post-cutover** — currently overridden by `rmpg-flex`'s own CSP injection. Once `rmpg-flex` is unbound, the Pages middleware takes over.

9. **Bump `client/public/sw.js` `CACHE_NAME`** to flush all stale SW caches in case any UI code paths depend on `x-request-id` (search the client codebase first).

10. **Delete `rmpg-flex`, `rmpgflex`, `rmpg-flex-production`, `rmpg-flex-api-production`** after a 7-day grace period.

### Phase 4 — clean up the documentation

11. Rewrite `CLAUDE.md` so the architecture section matches reality, with a section on the zone-level Workers Routes that override Pages. Note in the security section that the live `rmpg-flex` Worker's source is NOT in this repo (or update it after #1b).

12. Update the `[[project-pages-api-proxy]]` memory — it describes a flow that doesn't exist.

13. Update the `[[project-cf-existing-adoption]]` memory — the "85% built" estimate was wrong.

14. Mark `[[project-dual-worker-codebases]]` as historical — its "RESOLVED" claim only applies to the in-repo `/server/` quarantine, not the on-CF dual-Worker problem.

---

## Open questions for the team

1. **Where is the `rmpg-flex` Worker's source?** The bundle references files that don't exist in HEAD or in `legacy/server-vps/`. Possibilities: a long-running branch on a different fork, a manually-uploaded build from a previous agent's worktree, an in-Cloudflare-dashboard edit. Until this is known, fixing bugs in the LIVE Worker requires either guessing-and-uploading or running the cutover.

2. **Was the original CF migration meant to be incremental or big-bang?** The estimate of "85% built" suggested big-bang. The route gap suggests incremental was always more realistic.

3. **Who is currently editing `rmpg-flex`?** It was modified at 2026-05-24 09:36 — today. If that was a manual upload, we need to know what changed.

4. **What's the deployment cadence for `rmpg-flex-api`?** CI runs on every push to main, but no one verifies the changes go to a real user. A smoke test that hits `api.rmpgutah.us` directly (with valid auth) after every deploy would catch divergence between what `/src/` claims to do and what's actually reachable.

---

## Reference: route IDs as of end of session

For audit:

```
zone id          addedd9f3c798f85de2d3eea18ccef9a (rmpgutah.us)
account id       5caa95c5789f4fc4ed3934b2a2c29ed4

rmpgutah.us/*        → rmpg-flex     (route id 198541ff9d9145cfad04f18a4757d76a)
www.rmpgutah.us/*    → rmpg-flex     (route id 194e5ac53577471dabdc56ad135719d6)

rmpg-api-proxy worker  exists, no bindings, safe to delete
```

Snapshot of pre-session state saved at `/tmp/cf-routes-before-20260524-095507.json` on Christopher's laptop.
