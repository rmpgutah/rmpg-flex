# Legacy Express Server → Cloudflare Worker Retirement Plan

**Date**: 2026-05-24
**Status**: Proposed
**Owner**: Migration team (CF agent + Christopher)

---

## TL;DR

The CF Worker at `api.rmpgutah.us` has ~19% route coverage (17 of 88 legacy route files). The legacy Express server at `rmpgutah.us` serves everything else and has no working deploy pipeline. This plan phases the remaining 71 route files into the Worker by user-impact priority and proposes a retirement gate for the Express origin once every active flow has a CF home.

## Current state (2026-05-24)

| Layer | Status |
|---|---|
| Legacy Express | Running at v5.8.0 behind Cloudflare proxy. Deploy pipeline **dormant** — `git push origin main` doesn't reach it. Last code update unknown. |
| CF Worker (`rmpg-flex-api`) | Auto-deploys on push to main via `.github/workflows/deploy.yml`. ~17 routes mounted. D1, KV, R2 bindings live. |
| Frontend (`client/`) | Hits relative paths (`/api/...`) which land on rmpgutah.us → legacy. A `maybeRedirectToCfWorker` allowlist in `apiFetch` peels off specific paths (currently `/api/warrants/watch/*` and `/api/warrants/utah/*`) to api.rmpgutah.us. Add to that list as routes port. |

### Ported (CF Worker)

`auth`, `health`, `admin`, `personnel`, `presence`, `records` (+ `properties`), `mapData`, `dispatch` (calls, units, gps, geography, aggregates, run-cards, welfare, extensions), `nibrs`, `incidents` (+ `incidentSupplements`), `warrants`, `ws` (per-isolate WebSocket).

### Not yet ported (71 files)

Categorized below. Counts approximate — exact LOC + risk profile depends on inspection.

| Category | Files | Notes |
|---|---|---|
| **RMS adjacencies** (Tier A) | `arrests`, `cases`, `citations`, `court`, `fieldInterviews`, `evidence`, `forensics`, `patrol`, `serve`, `serveIntake`, `shiftPlans`, `trespassOrders` | Officer-facing CAD/RMS surface. Highest user-impact. ~12 files. |
| **CRM / Business** (Tier B) | `crm`, `crmLeads`, `crmProposals`, `crmFirecrawl`, `businessPhotos`, `businessVehicles`, `businessVisits`, `invoices` | Account-management surface. Used by sales + ops, not field officers. ~8 files. |
| **External integrations** (Tier B) | `clearpathgps`, `traccar`, `jailRoster`, `microbilt`, `servemanager`, `skiptracer`, `firecrawlTools`, `webResearch`, `externalIntegrations`, `integrations`, `geocode` | Each is a wrapper around a third-party API. Mostly fetch-pass-through. Some have schedulers (jailRoster, traccar). ~11 files. |
| **Document + media** | `companyDocuments`, `documentFolders`, `documentIntake`, `downloads`, `uploads`, `pdfTools`, `dashcamVideos`, `dashcamAi` | File handling. Needs R2 lifecycle design (currently legacy uses local disk + nginx). ~8 files. |
| **Communications** | `comms`, `email`, `emailRules`, `notifications`, `tts`, `voice`, `voiceDialogue`, `voicePersona` | Includes Edge TTS, WS-driven dispatch messaging, email rules. WS-broadcast deps. ~8 files. |
| **HR + admin reporting** | `hr`, `audit`, `reports`, `adminMapConfig`, `adminSystems`, `systemConfig`, `userPreferences`, `diagnostics`, `iped`, `securityDashboard`, `subjectSearch`, `connections` | HR pipeline, audit log queries, reporting. Mostly read-heavy. ~12 files. |
| **AI subsystem** | `ai`, `aiDevChat` | Worker has Hono — but AI streaming responses need careful Workers-compat work. ~2 files. |
| **Specialty / niche** | `coloradoDoc`, `dar`, `dlRecords`, `drivingEvents`, `howen`, `intake`, `mapGeofences`, `mapSafety`, `mobileCfs`, `offenderRegistry`, `offline`, `sexOffenderRegistry`, `statutes`, `webauthn` | One-off features, lookup tables, niche integrations. Variable complexity. ~14 files. |
| **Active scheduler dependencies** | `dashcamAi`, `jailRoster`, `traccar` | Have cron-style or background polling in legacy. CF needs `[[triggers]] crons` + scheduled() handler per source. |
| **Stateful / WebSocket** | Cross-cutting | Anything that calls `broadcast()` or `sendToUser()` on the legacy server needs the Worker's WS layer (currently per-isolate) or a Durable Object hub for cross-isolate fanout. |

---

## Phasing

Six phases ordered by user-impact and inter-phase dependencies. Each phase is independently shippable; one PR per route file (or per tight cluster) keeps blast radius small.

### Phase 1: Officer-facing RMS (Tier A) — **~3-5 weeks**

**Why first**: these are routes officers hit during a shift. Visibility regression here = officer safety degradation. Highest stakes, but also the routes that get the most testing in real use.

- `arrests`, `cases`, `citations`, `court` — core RMS records
- `fieldInterviews` — FI cards with GPS
- `serve`, `serveIntake` — process service
- `patrol`, `shiftPlans` — shift tracking
- `evidence`, `forensics` — evidence chain
- `trespassOrders` — operational records

**Per-file checklist**:
1. Read legacy route + identify endpoints + auth roles + write events (broadcast/sendToUser)
2. Create `src/routes/<name>.ts` mirroring legacy response shapes (no breaking changes for frontend)
3. Add D1 migration if tables missing (most exist — verify)
4. Mount in `src/index.ts` with appropriate auth middleware
5. Add prefix to `CF_WORKER_PREFIXES` in `client/src/hooks/useApi.ts`
6. Smoke test: curl + a real-browser session against api.rmpgutah.us
7. Add integration test (`__tests__/` mirroring existing patterns)
8. Document any deferred features (e.g., scheduled jobs, WS broadcasts) in route file header

**Success criteria**: Officers can complete a full shift (arrest → citation → incident → case linkage → field interview) without any /api/* call hitting the legacy server.

### Phase 2: External integrations (Tier B) — **~2-3 weeks**

**Why next**: removes the legacy server's dependency on long-lived poller processes (jailRoster, traccar) — those don't naturally fit Workers' request-scoped model and need conversion to cron triggers.

- `clearpathgps`, `traccar` — GPS integrations. Convert pollers to `scheduled()` cron handlers.
- `jailRoster` — JailBase scraper. Same pattern.
- `microbilt`, `skiptracer`, `servemanager` — request-time third-party wrappers. Simple port.
- `firecrawlTools`, `webResearch` — Firecrawl + web search. Simple port.
- `externalIntegrations`, `integrations` — registry endpoints.
- `geocode` — request-time, simple.

**Risk**: each external API has its own quirks (auth, rate limits, payload shapes). Test against staging accounts before swapping prod traffic.

### Phase 3: Documents + media — **~2 weeks**

**Why later**: requires R2 storage strategy. Legacy uses local disk + nginx; R2 has different access patterns (signed URLs, lifecycle policies).

- `companyDocuments`, `documentFolders`, `documentIntake`
- `uploads`, `downloads`, `pdfTools`
- `dashcamVideos`, `dashcamAi`

**Specific work**:
- Choose: client uploads directly to R2 via presigned URL (recommended, avoids Worker bandwidth) vs Worker-mediated.
- Migrate existing `server/uploads/` content to R2 if any (assess size/cost).
- `dashcamAi` has HMAC-authenticated ingestion — special-case route, not standard JWT.

### Phase 4: Comms + AI — **~2-3 weeks**

**Why later still**: depends on having WS fan-out (Durable Object hub) for cross-isolate broadcast.

- `comms` — dispatch messaging. Needs DO for cross-isolate.
- `email`, `emailRules`, `notifications`
- `tts`, `voice`, `voiceDialogue`, `voicePersona` — Edge TTS. Test Workers compat first (current legacy uses `edge-tts-universal` which has Node-specific paths).
- `ai`, `aiDevChat` — Anthropic streaming. Workers fetch supports streaming responses but check token-budget tracking.

**Specific work**: build `src/durable-objects/WsHubDO.ts` (defer until first feature actually needs it — `comms` is the trigger).

### Phase 5: HR + admin reporting + niche — **~2 weeks**

- HR pipeline (`hr`, `audit`, `reports`)
- Admin config (`adminMapConfig`, `adminSystems`, `systemConfig`, `userPreferences`, `diagnostics`)
- Reporting + dashboards (`securityDashboard`, `iped`, `subjectSearch`, `connections`)
- Specialty (`coloradoDoc`, `dar`, `dlRecords`, `drivingEvents`, `howen`, `intake`, `mapGeofences`, `mapSafety`, `mobileCfs`, `offenderRegistry`, `offline`, `sexOffenderRegistry`, `statutes`, `webauthn`)

Mostly read-heavy queries against D1. Few stateful concerns. Port in batches of 3-5 per PR.

### Phase 6: Legacy retirement — **~1 week**

Once `CF_WORKER_PREFIXES` is `['/api/']` (catches everything):

1. Remove `maybeRedirectToCfWorker` from `apiFetch` — make api.rmpgutah.us the only origin
2. Update Cloudflare DNS / routing so rmpgutah.us frontend traffic stays on the static asset host (Pages, R2 with public bucket, or similar) and never proxies to the legacy origin
3. Decommission the legacy origin host (whatever it is)
4. Delete `server/src/` from the repo (preserve in a `legacy-archive` branch for ~1 year)
5. Delete `server/src/routes/*-worker.ts` (already-dead-code)
6. Update CLAUDE.md to remove all legacy-server gotchas
7. Final smoke: every operator surface verified working through api.rmpgutah.us only

---

## Cross-cutting risks (call out, address in flight)

| Risk | Phase | Mitigation |
|---|---|---|
| **WebSocket cross-isolate** | Phase 4 | DO hub pattern. Don't build until first real consumer (`comms`). |
| **File uploads + R2 lifecycle** | Phase 3 | Presigned URL strategy. Test with a low-traffic flow first (e.g. `companyDocuments`). |
| **Electron desktop offline sync** | Cross-cutting | Electron app calls `apiFetch` with local IPC fallback. As routes port, ensure offline IPC paths still resolve correctly for those endpoints. |
| **Long-running polls (Traccar, JailBase)** | Phase 2 | Convert to scheduled() cron with chunked work + checkpoint state in D1. |
| **JWT_SECRET sync** | Already done | Both systems share JWT_SECRET so tokens work cross-origin. Don't rotate without coordinated update. |
| **Per-route response-shape drift** | All phases | Mirror legacy response shapes exactly in initial port; deprecate and migrate frontend separately if shapes need to change. |
| **Audit log gaps** | All phases | Every route that mutates state needs `auditLog` equivalent on CF. Check `src/utils/db.ts` for the canonical pattern; some legacy routes use richer `auditLogger` than CF currently has. |
| **Test coverage parity** | All phases | Legacy has 1100+ tests across `server/tests/`. CF tests today are sparse — port `__tests__/` files alongside routes, not after. |

---

## Per-PR template

Use this for every route-port PR. Keep it consistent so reviewers know what to look for.

```
## Why
Phase N: porting `<route>` from legacy Express to CF Worker.

## What
- `src/routes/<name>.ts` — Hono router mirroring legacy endpoints
- D1 migration <if any>
- `client/src/hooks/useApi.ts` — adds `/api/<prefix>/` to CF_WORKER_PREFIXES
- `__tests__/<name>.test.ts` — coverage parity with legacy

## Frontend changes
<list any apiFetch call sites whose behavior changes>

## Deferred
<scheduled jobs, WS broadcasts, anything explicitly left for later>

## Verify
- [ ] `curl https://api.rmpgutah.us/api/<endpoint>` returns expected shape
- [ ] Browser session navigates to <feature> page and works end-to-end
- [ ] No new errors in CF Worker logs (`wrangler tail`)
- [ ] Legacy route still serves (no breakage during incremental migration)
```

---

## Open questions

1. **What happened to the legacy deploy pipeline?** Currently dormant; either restore (so legacy can be patched in flight) or accept it as frozen until Phase 6 retires it. Restoring requires SSH access to whichever host backs the Cloudflare proxy origin — unknown from outside CF.
2. **R2 strategy**: client-direct upload vs Worker-mediated? Trade-off is Worker bandwidth cost vs simplicity. Recommend client-direct via presigned URL for files >1MB.
3. **Test infrastructure**: legacy has full vitest with better-sqlite3 fixtures. CF Worker should use Workers' Miniflare for tests, or in-memory D1 via better-sqlite3. Pick one and document.
4. **Data migration**: legacy `data/rmpg-flex.db` (production SQLite) presumably has the bulk of operational data. D1 currently has 1 user. Cross-DB migration is its own project — schedule alongside Phase 6.

---

## Definition of done

Legacy retirement is complete when:

- [ ] Every route file in `server/src/routes/` has a CF Worker equivalent in `src/routes/`
- [ ] `CF_WORKER_PREFIXES` in `client/src/hooks/useApi.ts` is removed (everything redirects)
- [ ] No request from rmpgutah.us frontend reaches the legacy origin
- [ ] `rmpg-flex` systemd service on the legacy origin is stopped
- [ ] Repo's `server/src/` directory is removed (preserved on `legacy-archive` branch)
- [ ] CLAUDE.md no longer references legacy deploy paths, VPS IPs, or rsync deploy
- [ ] No active operator complaint about "this feature stopped working" attributable to the cutover

---

## Estimated total effort

Phases 1-5: **~10-14 weeks** of focused engineering time. Phase 6: **~1 week** + a soak period.

Could be parallelized across multiple engineers if the per-phase risk profile is understood. Single-engineer linear path is the safest, since each phase's success gates the next.
