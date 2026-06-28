# Cloudflare Migration — Architectural Decisions

> **Status**: draft for review. None of the four decisions in this doc have been made yet. Each blocks a category of follow-up work. Mark each as Decided / Deferred / Rejected and link back to this doc from the resulting PR.

Audited 2026-05-24. Companion to PR #556 and the **Port Completion Status** table in `CLAUDE.md`.

---

## 1. `/geography/identify` — point-in-polygon strategy

### Context
The endpoint takes `?lat&lng` and returns the dispatch area / sector / zone / beat for that coordinate, plus nearby premise alerts. The Express version uses `identifyBeat()` in `server/src/utils/geofence.ts`, which `fs.readFileSync`s `client/public/geojson/beat.geojson` (8.9 MB, 719 features) and runs a ray-casting algorithm against the polygon features.

On Workers: `fs.*` doesn't exist; bundling 8.9 MB into the Worker script pushes near or over the 10 MB compressed limit; and the per-request CPU cost of full PIP across 719 polygons is real.

The current production endpoint returns HTTP 501 (PR #556 replaced a silent-wrong-data stub).

### Option A — R2 fetch + lazy in-isolate cache
Move `beat.geojson` to R2 (`UPLOADS` or a new bucket). On first `/identify` call per isolate, fetch + parse + cache in module scope. Subsequent calls reuse the parsed polygons.

- **Pro**: minimal client/contract change; faithful PIP; only the cold-start request pays the ~9 MB R2 fetch (~200-500 ms on warm region)
- **Pro**: parsed polygons survive for the life of the isolate (~minutes to hours of warmth)
- **Con**: cold-start latency is meaningful; Workers free tier caps memory at 128 MB so cached features compete with other modules
- **Con**: must re-upload to R2 every time the seed GeoJSON changes; risk of drift

### Option B — Client-side PIP (recommended for new design)
The client already serves `beat.geojson` at `/geojson/beat.geojson`. Move PIP to the browser: client computes the beat, then calls the existing `/api/dispatch/geography/beats?beat_code=X` to enrich with DB-side data + premise alerts.

- **Pro**: zero Worker memory cost; instant after first geojson load (client caches it anyway)
- **Pro**: scales freely — no Worker CPU per request
- **Con**: requires a client refactor (one new utility + caller updates in `useMapBreadcrumbs`, `useAutoPanToP1`, dispatch console); changes the API contract (server no longer authoritative on coord→beat)
- **Con**: client and server can disagree on geofence interpretation if the geojson versions drift

### Option C — Pre-computed MBR + candidate PIP (cheapest server-side)
The `dispatch_beats` table **already has** `min_lat, max_lat, min_lng, max_lng` columns (verified in schema). Add an index on those, look up candidate beats via `WHERE ? BETWEEN min_lat AND max_lat AND ? BETWEEN min_lng AND max_lng` (typically 0-5 candidates), then load just those candidate polygons (smaller payload) and run PIP only on the small set.

- **Pro**: bounded server work per request — D1 indexed query + 0-5 polygons (vs 719)
- **Pro**: preserves authoritative server-side PIP
- **Con**: still needs the polygon geometry somewhere — could store per-beat polygon JSON in the `dispatch_beats.geometry` column (which exists but appears empty) populated at seed time
- **Con**: more upfront engineering (seed pipeline change) but no recurring R2 cost

### Recommendation: **B (client-side PIP)**, fall back to **C** if a server-side answer is required for audit/legal reasons

Client-side is the simplest, cheapest, most scalable answer for the dispatch console's needs (display "you're in Beat 14"). The only reason to keep PIP server-side is if some non-browser caller (e.g. Edge runner, Howen DVR webhook) needs to ask "what beat is this lat/lng in?" without geojson access — in that case Option C is the right server-side fit.

### Decision needed
1. Is there any non-browser caller of `/geography/identify`? (Grep `identify` in `client/`, `edge/`, `desktop/`.)
2. If no → pick B and stub the endpoint as 410 Gone after client port lands.
3. If yes → pick C; estimate one day to populate `dispatch_beats.geometry` + add the candidate-PIP route.

---

## 2. Stub subsystems — fleet / email / notifications / personnel / reports

### Context
Five subsystems shipped to production as heavy stubs in the cutover commit `a802d87a "Fix remaining API endpoints: all 18 critical routes operational"`:

| Subsystem | Worker / Express LOC | Worker route count | Express route count |
|---|---|---|---|
| fleet | 128 / 6142 | varies (mostly empty handlers) | 115 |
| email | 153 / 1900 | 6 | 52 |
| notifications | 54 / 636 | minimal | many |
| personnel | 357 / 4386 | minimal | many |
| reports | 393 / 2592 | minimal | many |

These endpoints return 200 with empty/fake data. Users hitting these pages today see broken UX (no errors — just missing data).

The choice for each subsystem is between two extremes, with a middle path:

### Option A — Re-port the full Express surface (faithful port)
Replicate every Express endpoint, line by line, in the corresponding `*-worker.ts`. Same contracts, same response shapes, same behavior.

- **Pro**: lowest risk to existing client code; familiar Express patterns; preserved feature parity
- **Pro**: enables direct A/B against the Express version for verification
- **Con**: re-ports legacy patterns (sync DB assumptions, in-memory state) that may not even fit Workers
- **Con**: high LOC count → high audit surface; the Express versions accumulated their own technical debt

**Estimate (per subsystem)**: fleet 2-3 wks, email 1-2 wks, notifications 3 days, personnel 1-2 wks, reports 1 wk. **Total: 6-10 weeks** for one engineer.

### Option B — Redesign as Workers-native (rewrite from spec)
Treat each subsystem as a redesign opportunity. Document what the feature must do, then write the smallest Workers-native implementation that delivers it.

- **Pro**: shed legacy debt; size each route to the minimum surface needed
- **Pro**: native Workers patterns (D1 batches, R2 streams, KV for cache) instead of porting around them
- **Con**: every endpoint contract changes — client refactor required
- **Con**: behavior parity is no longer the spec; new bugs are possible

**Estimate**: roughly half of A but with client refactor on top → **4-7 weeks** for one engineer.

### Option C — Triage per-subsystem (recommended)
Not all five need the same treatment. Score each on: actual user demand, blast radius if down, integration depth with other subsystems.

| Subsystem | User demand today | Blast radius | Recommended path |
|---|---|---|---|
| notifications | High (dispatch needs alerts) | Low (failure → no notification) | **A (port) — small, just 636 LOC** |
| personnel | High (HR, scheduling) | Medium (feeds other modules) | **A (port)** |
| fleet | Medium (maintenance tracking, fuel logs) | Low (back-office) | **B (redesign)** — biggest legacy surface, biggest payoff |
| email | Low? (Outlook MCP exists; users may use Outlook directly) | Low | **Confirm demand first.** If real, A; if synthetic, leave stubbed + remove from nav |
| reports | Low-Medium (admin dashboards) | Low | **B (redesign)** — Express version is overly complex for what's displayed |

### Decision needed
1. Confirm whether email-from-Flex is actually used vs Outlook MCP being the real path. If not used, delete the stub + remove from nav.
2. For each kept subsystem: A (port) or B (redesign)?
3. Sequence them — notifications first (smallest), then personnel (highest demand), then the bigger ones.

---

## 3. WebSocket → Durable Objects vs polling fallback

### Context
The Express server runs a single `ws` server with in-memory client tracking. ~50+ `broadcast*` call sites across the codebase push real-time updates (call dispatched, unit GPS, panic, citations, presence, dispatch messages). The Worker port has `server/src/worker-middleware/websocket.ts` using `webSocketPair()` — but Workers have **no shared memory across isolates**, so `wss.clients` doesn't exist as a global. Broadcasts to "all connected dispatchers" need either:

1. **Durable Objects** — each DO instance has a single isolate, can hold persistent WS connections, and is the canonical Cloudflare pattern for stateful pub/sub.
2. **Polling fallback** — clients poll a `/api/dispatch/live?since=<ts>` endpoint every 2-5s for new events.

### Option A — Durable Objects (DO) for pub/sub
One DO per channel (e.g. `dispatch-broadcast`, `presence`, `panic`). Clients connect WS to the DO. Route handlers POST to the DO to fan out.

- **Pro**: true real-time (sub-second latency); preserves existing client UX (no polling, no flicker)
- **Pro**: Cloudflare-recommended pattern; scales naturally
- **Con**: **cost** — DO charges per active duration + per request. With ~10 dispatchers connected 8 hrs/day: roughly $0.20/dispatcher-day in DO compute + request fees. Manageable for ~10 users, scales linearly
- **Con**: implementation complexity — DOs are their own deployable; need migration + careful state management
- **Con**: WebSocket disconnect-reconnect handling is more nuanced than Express (DO hibernation, alarm scheduling)

### Option B — Polling fallback (simpler, cheaper)
Clients poll `/api/dispatch/live?since=<last_event_ts>` every 2-5s. Server returns events since that timestamp from D1. Latency: poll-interval-bounded (2-5s).

- **Pro**: no DO complexity; runs on existing Worker; no special deployment
- **Pro**: cost = Worker request fee × poll rate. ~10 dispatchers polling every 3s = 200k requests/day = ~$0.10/day total
- **Pro**: graceful degradation under load (slower polling vs broken WS)
- **Con**: 2-5s latency on call dispatches matters for life-safety scenarios — a panic alert that takes 3s longer is potentially the difference
- **Con**: heavier on D1 (continuous reads)

### Option C — Hybrid: DO for critical channels, polling for the rest
- **DO** for `panic`, `call-dispatched`, `unit-status` (life-safety, low volume)
- **Polling** for `presence`, `citations`, `messages`, `audit-log` (informational, can tolerate latency)

- **Pro**: pays for DO only where latency matters
- **Pro**: limits DO blast radius — fewer connection-types to debug
- **Con**: split implementation; harder to reason about than picking one

### Recommendation: **C (hybrid)**

Panic / call dispatch / unit status are operationally critical and low-volume — they justify DO cost. Everything else (presence, citations, audit logs, dispatch messages) can absorb 2-5s polling latency without operational impact.

### Decision needed
1. Confirm dispatcher count + connected hours (drives DO cost estimate)
2. Pick the channels that *must* be real-time. My nomination: `panic`, `call-dispatched`, `unit-status`, `dispatch-broadcast` (operator-to-units)
3. Greenlight DO migration plan or push to all-polling for cost reasons

---

## 4. Cron Triggers — which schedulers run, which drop

### Context
The Express server runs **8 `setInterval`-based schedulers** that started on boot and ran forever. On Workers there's no long-lived process — schedulers must move to Cloudflare Cron Triggers (max 1 trigger per minute, max 100 invocations per Worker, max 30s CPU per invocation).

### Express schedulers (from `server/src/index.ts`)

| Scheduler | Frequency | Express call | Purpose |
|---|---|---|---|
| OFAC sync | configurable | `scheduleOfacSync()` | Refresh OFAC SDN list (~1k entries) |
| Utah warrant scraper | configurable | `scheduleUtahWarrantSync()` | Scrape Utah Courts warrant database |
| Arrest sync | configurable | `scheduleArrestSync()` | Scrape JailBase / county jail rosters |
| Multi-state warrant scraper | configurable | `scheduleWarrantScraper()` | 22+ data source scrapers |
| Nightly scraper run | every 24h | `runScraperNightly()` | Aggregate scraper batch |
| Patrol monitor | (in code) | (line 646) | Detect units off-shift / silent too long |
| Daily patrol report | midnight | (line 649) | Generate end-of-day patrol report PDF |
| Competitor monitor | configurable | `competitorMonitorPoller` | RMPG sales/CRM monitor |
| Traccar poller | short interval | `traccarPoller` | Pull GPS positions from Traccar API |
| Jail roster scraper | every 30 min (default) | `jailRosterScraper` | Scrape county jail roster |

Plus `totpService` cleanup, `websocket` ping/revalidate, and per-WS heartbeat — these are infrastructure-level and don't need to be cron jobs on Workers (the WS DO can manage its own alarms).

### Option A — Migrate all to Cron Triggers
Define each scheduler as a `[[triggers.crons]]` entry in `wrangler.toml`. The Worker's `scheduled()` handler dispatches by cron pattern.

- **Pro**: faithful behavior; same data freshness
- **Con**: 100-trigger limit per Worker — fine (we have 8)
- **Con**: 30s CPU limit per invocation. The scrapers (Utah warrants, multi-state warrants, jail roster) likely exceed this when processing large batches. Need to chunk + queue.
- **Con**: cost — minimal per-trigger, but if scrapers fan out to Queue + many Worker invocations, it adds up

### Option B — Move heavy scrapers off Workers entirely
Workers handle the lightweight stuff (TOTP cleanup, OFAC refresh — small payload). Heavy scrapers (Utah warrants, multi-state, jail roster — long-running with HTML parsing, retries, large inserts) run on:
- **Option B1**: An always-on container service (Render, Fly.io, dedicated VPS) that calls back to Workers via authenticated webhooks to push data
- **Option B2**: Cloudflare Containers (in beta) — same container-based approach but inside the Cloudflare ecosystem
- **Option B3**: GitHub Actions cron workflows — free, but requires a way for the Action to write to D1 (via `wrangler d1 execute` from CI, which works)

### Option C — Drop the cron features Workers can't handle (recommended for a pilot)
Identify which schedulers are actively used vs aspirational. Schedulers that aren't producing operational value can simply be turned off, not migrated.

| Scheduler | Active use? | Recommended action |
|---|---|---|
| OFAC sync | Yes (lookup is real) | **Cron Trigger** — small payload, fits in 30s |
| Utah warrant scraper | Production scraping? | **Confirm first.** If yes, B3 (GitHub Action). If no, drop. |
| Arrest sync | Same | Same |
| Multi-state warrant scraper | Same | Same — 22 sources is likely too much for one trigger; B3 with per-source action |
| Nightly scraper run | Wrapper around above | Becomes daily B3 workflow |
| Patrol monitor | Yes (operational) | **Cron Trigger** every 5 min, query D1 for silent units |
| Daily patrol report | Yes (end-of-day PDF) | **Cron Trigger** at midnight MT, write PDF to R2 |
| Competitor monitor | CRM/sales feature — is RMPG using? | Confirm. If no, drop. |
| Traccar poller | Yes (live GPS) | **Not a cron** — needs sub-minute frequency. Either: keep a small VPS for the poller (cheapest), or use Traccar's webhook push to Workers (best) |
| Jail roster scraper | Maybe | Confirm. If yes, B3 every 30 min. |
| TOTP cleanup | Infra | **Cron Trigger** daily |
| WS heartbeat | Infra | Handled by DO alarms (see Decision 3) |

### Recommendation: **C (triage), then mix A + B3 per-scheduler**

- Lightweight + operational schedulers → Cron Triggers (OFAC, patrol monitor, daily report, TOTP cleanup)
- Heavy scrapers, if actively used → GitHub Actions with `wrangler d1 execute` (free, no container needed)
- Traccar GPS poller → **needs decision**: sub-minute polling doesn't fit Cron Triggers at all. Either keep a small VPS, or persuade Traccar to push (Traccar has webhook support — preferred)
- Aspirational schedulers (competitor monitor if not used) → drop

### Decision needed
1. For each scheduler in the table above: confirm "active use" status with the operator
2. Pick Traccar strategy — VPS vs webhook (webhook strongly recommended)
3. Greenlight the per-scheduler plan; I'll write the `wrangler.toml` cron triggers + GH Action workflows in a follow-up PR

---

## Tracking

Once each decision is made, update this document with the chosen option and link to the implementing PR. Suggested cadence: revisit weekly until all four are landed.

| Decision | Status | Choice | Implementing PR |
|---|---|---|---|
| 1. `/geography/identify` strategy | ☐ pending | — | — |
| 2. Stub subsystems triage | ☐ pending | — | — |
| 3. WebSocket strategy | ☐ pending | — | — |
| 4. Schedulers / Cron Triggers | ☐ pending | — | — |
