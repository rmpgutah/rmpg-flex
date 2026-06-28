# Warrant Poller Enhancement — Design

**Date**: 2026-04-10
**Author**: Claude + RMPG
**Status**: Approved — ready for implementation planning
**Approach**: B — Incremental Overlay (layer enhancements onto existing `multiStateWarrantScraper.ts` without rewriting it)

## Context

The current warrant poller is a scheduled polling system in `server/src/utils/multiStateWarrantScraper.ts` (1,842 lines) covering ~173 county, state, and federal sources across 50 states. After recent stabilization work it has:

- **Error rate**: 1.4% (down from 22%)
- **Coverage**: 2,985 warrants across 13 states
- **Architecture**: Per-source `setInterval` with staggered starts, circuit breaker (15 errors → 2h–48h exponential backoff), UA rotation, 17 custom parsers + generic HTML fallback

### Known gaps

1. No observability — can't tell which sources are healthy without tailing logs
2. No content-change detection — stable sites get re-parsed every 2 hours even when nothing changed
3. No priority tiers — all sources treated equally, so FBI gets same interval as a backwater county
4. No jitter — scheduler boot storms can fire 30+ requests in the same second
5. Only 2 retries with no backoff — transient errors convert to circuit-broken sources
6. Parser failures fall back silently — an HTTP 200 returning 0 warrants looks identical to a genuinely empty page
7. No admin UI for scraper control — changes require direct DB edits

### Design goals

- **Visibility**: Admin dashboard showing per-source health, live event feed, metrics charts
- **Efficiency**: Cut request volume ~80% on stable sources via content hashing + ETags
- **Priority**: 4-tier system so critical sources (FBI, Utah state) poll more often than low-value ones
- **Resilience**: Better retry/backoff, parser fallback cascade, WAF detection
- **Operability**: HTTP API + CLI + UI surfaces for test/trigger/reset/preview
- **Zero regression** on the 1.4% error rate already achieved

---

## Section 1 — Data Model Changes

Three schema additions using the existing `addCol()` lazy-migration pattern in `server/src/models/database.ts`.

### 1a. Extend `warrant_scraper_config`

```sql
priority INTEGER DEFAULT 3            -- 1=critical, 2=high, 3=normal, 4=low
content_hash TEXT                     -- SHA-256 of last successful response body
content_hash_updated_at TEXT          -- when hash last changed
etag TEXT                             -- HTTP ETag from last response
last_modified TEXT                    -- HTTP Last-Modified from last response
last_success_at TEXT                  -- separate from last_scrape_at (which logs all attempts)
avg_parse_count REAL                  -- rolling avg warrants parsed per run
p95_latency_ms INTEGER                -- rolling p95 fetch+parse latency
jitter_seed INTEGER                   -- deterministic per-source jitter (0-1200 seconds)
```

### 1b. New `warrant_scraper_runs` table

```sql
CREATE TABLE warrant_scraper_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  http_status INTEGER,               -- 200, 304, 403, 404, 500, etc.
  bytes_received INTEGER,
  parsed_count INTEGER DEFAULT 0,
  inserted_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  skipped_reason TEXT,                -- 'content_unchanged' | 'circuit_broken' | null
  error_message TEXT,
  parser_used TEXT,                   -- 'custom' | 'generic' | 'fallback'
  FOREIGN KEY (source_key) REFERENCES warrant_scraper_config(source_key)
);
CREATE INDEX idx_scraper_runs_source_time ON warrant_scraper_runs (source_key, started_at DESC);
```

Retention: 500 runs per source, pruned nightly. Estimated steady state ~86k rows.

### 1c. Priority tier defaults

| Tier | Interval | Example sources |
|------|----------|-----------------|
| 1 Critical | 30 min | FBI, Utah state warrants, SLC metro |
| 2 High | 90 min | Neighboring Utah counties, Denver, Las Vegas |
| 3 Normal | 180 min | Most out-of-state county sheriffs |
| 4 Low | 360 min | Small counties, rarely updated pages |

Seeded via one-time migration assigning tier based on state + source type.

---

## Section 2 — Scheduler Enhancements

### 2a. Tier-based base intervals with jitter

```typescript
const TIER_INTERVALS_MS = {
  1: 30 * 60_000,   2: 90 * 60_000,
  3: 180 * 60_000,  4: 360 * 60_000,
};

function resolveInterval(config: WarrantSourceConfig): number {
  if (config.scrape_interval_minutes && config.scrape_interval_minutes > 0) {
    return config.scrape_interval_minutes * 60_000; // explicit override
  }
  return TIER_INTERVALS_MS[config.priority] ?? TIER_INTERVALS_MS[3];
}

function resolveJitterMs(sourceKey: string): number {
  const hash = simpleHash(sourceKey);
  return (hash % 1200) * 1000; // 0–20 min deterministic offset
}
```

### 2b. Content-unchanged early exit

Before parsing, send conditional request using stored ETag / Last-Modified. If server returns 304, skip. Otherwise SHA-256 the body and compare to `content_hash`. If matches, skip parse and store run as `skipped_reason = 'content_unchanged'`.

### 2c. Adaptive priority bump

Nightly job analyzes last 50 runs per source:
- `insertRate > 0.6` → bump priority up one tier
- `unchangedRate > 0.9` → drop priority one tier

Logs priority changes to audit log and emits `priority_changed` WebSocket event.

### 2d. Concurrency cap

Global semaphore limits concurrent fetches to **5** sources at a time. Prevents boot-storm thundering herd and WAF correlation.

---

## Section 3 — Metrics & Observability

### 3a. Rolling metrics aggregator

`getSourceMetrics(sourceKey, windowHours)` returns `SourceMetrics`:

```typescript
interface SourceMetrics {
  source_key: string;
  window_hours: number;
  total_runs: number;
  successful_runs: number;
  unchanged_runs: number;
  failed_runs: number;
  success_rate: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  avg_parsed: number;
  total_inserted: number;
  total_updated: number;
  last_error: string | null;
  last_error_at: string | null;
  status_distribution: Record<string, number>;
  health_grade: 'A' | 'B' | 'C' | 'D' | 'F';
}
```

**Health grade formula:**
- **A**: success_rate ≥ 0.95 AND fresh (< 2 × interval)
- **B**: success_rate ≥ 0.80 AND fresh (< 4 × interval)
- **C**: success_rate ≥ 0.50 OR stale 4–12 × interval
- **D**: success_rate ≥ 0.20 OR stale 12–24 × interval
- **F**: circuit_broken OR success_rate < 0.20 OR stale > 24 × interval

### 3b. Live event stream

WebSocket channel `scraper_events` via existing `broadcastDispatchUpdate` infra. Events:

- `run_started` — `{ source_key, started_at, priority }`
- `run_completed` — `{ source_key, duration_ms, parsed, inserted, updated, http_status, health_grade }`
- `run_failed` — `{ source_key, duration_ms, error, consecutive_errors }`
- `circuit_broken` — `{ source_key, attempt, recovery_at }`
- `circuit_restored` — `{ source_key }`
- `priority_changed` — `{ source_key, old, new, reason }`
- `drift_detected` — `{ source_key, signal }`

### 3c. Alerting hooks

Trigger `createNotification()` (admin/manager roles) on:

1. **Source down** — `circuit_broken` transitions 0 → 1
2. **Parser drift** — HTTP 200 + `parsed_count = 0` for 5 consecutive runs
3. **Mass failure** — >30% of enabled sources graded D/F (rate-limited to 1/hour)

### 3d. Nightly summary job

Pruning + rollups + daily health report via `setInterval` running once every 24 hours.

---

## Section 4 — Parser Resilience

### 4a. Fallback cascade

```typescript
parseWithFallback(config, html) →
  1. custom parser (if registered)
  2. generic HTML parser
  3. all-caps name extraction (last resort)
```

Returns `{ entries, parserUsed: 'custom' | 'generic' | 'fallback' }` and logs drift signals when tiers fall through.

### 4b. Retry with exponential backoff

`fetchPage` upgraded from 2 flat retries to 3 retries with 1s → 2s → 4s → 8s + random jitter 0–500ms. Retries only on 5xx, 429, 408 — other codes return immediately.

### 4c. Redirect hygiene

Track redirects. On permanent host/path change, log warning and optionally auto-update `source_url`.

### 4d. Cloudflare/WAF detection

Post-fetch check for Cloudflare challenges, generic "Access Denied" wrappers, suspicious small response bodies. Classifies these as failures but with specific `error_message` so dashboard can separate "WAF blocked" from "parser broken."

### 4e. CLI dev harness

`npm run scrapers test <source_key> [--html file.html]` — fetches and parses offline without writing to DB. Useful for iterating on broken parsers.

---

## Section 5 — API Endpoints

All new routes under `/api/warrants/scrapers`. **Critical**: defined BEFORE `/:id` in `warrants.ts` per Express route ordering rule.

### Read endpoints

```
GET  /api/warrants/scrapers                      — list all with 24h metrics
GET  /api/warrants/scrapers/:source_key          — single source + 7d metrics
GET  /api/warrants/scrapers/:source_key/runs     — paginated run history
GET  /api/warrants/scrapers/metrics/summary      — aggregate rollups
GET  /api/warrants/scrapers/health               — cheap health badge (for header)
```

### Action endpoints (admin + manager)

```
POST /api/warrants/scrapers/:source_key/trigger       — force immediate scrape
POST /api/warrants/scrapers/:source_key/test          — dry-run (fetch + parse, no DB write)
POST /api/warrants/scrapers/:source_key/reset-circuit — clear circuit breaker
POST /api/warrants/scrapers/:source_key/preview       — parse pasted HTML
PUT  /api/warrants/scrapers/:source_key               — update priority, interval, enabled
POST /api/warrants/scrapers/bulk                      — batch enable/disable/reset/prioritize
```

### Streaming

Existing WebSocket channel `scraper_events` (subscribed via `useLiveSync` hook).

### CLI

```bash
npm run scrapers status [--grade=F]
npm run scrapers test <source_key> [--file=sample.html]
npm run scrapers trigger <source_key>
npm run scrapers reset <source_key>
npm run scrapers metrics <source_key> --window=168
npm run scrapers export --state=UT
```

### Role gating

- Read: admin, manager, supervisor, dispatcher
- Action (trigger/test/preview/edit): admin, manager
- Bulk ops, reset circuit: admin, manager
- CLI: requires DB access (VPS only)

---

## Section 6 — UI Surfaces

Spillman Flex aesthetic: 2px corners, `bg-surface-*` tokens, gold `#d4a017` accent, LED indicators, JetBrains Mono for data.

### 6a. Scrapers tab on WarrantsPage

New tab alongside existing (Dashboard, Warrants, Watch Hits, Person Intel). Layout:

- **Header**: 4 counters (healthy/degraded/failed/broken), last-hour summary, refresh + admin buttons
- **Health distribution**: A–F bar chart using `grid gap-px bg-rmpg-700` trick (hand-rolled, no chart lib)
- **Live feed**: WebSocket-driven event log (last 50 events)
- **Source list**: filterable (state, grade, search), sortable, clicking expands inline detail pane

Inline expanded detail:
- 7-day sparkline (hand-rolled SVG)
- Last 50 runs log
- 5 most recent warrants
- Action buttons (Trigger, Test, Reset, Edit, Preview)

Files:
- `client/src/pages/warrants/tabs/ScrapersTab.tsx`
- `client/src/pages/warrants/tabs/ScraperHealthHeader.tsx`
- `client/src/pages/warrants/tabs/ScraperHealthDistribution.tsx`
- `client/src/pages/warrants/tabs/ScraperLiveFeed.tsx`
- `client/src/pages/warrants/tabs/ScraperSourceList.tsx`
- `client/src/pages/warrants/tabs/ScraperSourceCard.tsx`
- `client/src/pages/warrants/tabs/ScraperPreviewModal.tsx`

### 6b. Admin section

`WarrantScrapersSection` under AdminPage. Dense table view with bulk ops:

- Multi-select + bulk enable/disable/reset/set-priority
- CSV import/export of source config
- "Reset all circuit breakers" (with confirm)
- "Pause all scrapers" kill switch (stored in `system_config`)
- Raw runs table explorer

File: `client/src/pages/admin/sections/WarrantScrapersSection.tsx`

### 6c. Dispatch header badge

Tiny LED badge in Layout.tsx toolbar showing `[●132 ◐18 ○23] WARRANTS`. Polls `/api/warrants/scrapers/health` every 30s. **Invisible when all grades are A or B** to prevent alert fatigue.

### 6d. Shared types

`client/src/types/scrapers.ts` — `ScraperHealthGrade`, `ScraperPriority`, `ScraperSourceListItem`, `ScraperRunEvent`.

---

## Rollout Plan (Phased)

Each phase ships independently and is deploy-safe on its own.

### Phase 1 — Data model + metrics (backend only, invisible to users)
- Section 1 (schema migrations)
- Section 3a (metrics aggregator) + 3d (nightly job)
- Wire run tracking into existing `syncSource()` flow
- **Ship it**: data starts accumulating, no UI yet

### Phase 2 — Scheduler upgrades (backend only)
- Section 2a/b/d (tier intervals + jitter + content hashing + concurrency cap)
- Section 4b (retry backoff) + 4d (WAF detection)
- **Ship it**: request volume drops, efficiency measurable in Phase 1 metrics

### Phase 3 — Parser resilience (backend only)
- Section 4a (fallback cascade) + 4c (redirect hygiene) + 4e (CLI test harness)
- Section 2c (adaptive priority — optional, can defer)
- **Ship it**: silent parser drift becomes visible

### Phase 4 — API + events (backend only)
- Section 5 (read + action + streaming endpoints)
- Section 3b (WebSocket events) + 3c (alerts)
- **Ship it**: CLI + API usable for ops

### Phase 5 — UI (frontend only)
- Section 6a (Scrapers tab)
- Section 6b (Admin section)
- Section 6c (header badge)
- **Ship it**: full visibility for admins/dispatchers

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Schema migrations break existing scraper | Low | High | Use `addCol()` lazy pattern — already proven in 50+ migrations; all columns nullable with sensible defaults |
| Content hashing causes missed warrants | Low | High | Keep 7-day max staleness — force full parse if `content_hash_updated_at` > 7 days even when hash matches |
| Adaptive priority bumps overload a fragile source | Low | Medium | Cap tier transitions at one step per nightly run; require 10+ baseline runs before adapting |
| Concurrency cap 5 too restrictive | Low | Low | Configurable via `system_config`; monitor queue depth in metrics |
| WebSocket event volume overwhelms dashboard | Low | Low | Client-side debounce + throttle; event ring buffer caps at 50 entries |
| Route ordering regression | Medium | Medium | Explicit warning comment in `warrants.ts`; add test in server test suite |
| Deploy breaks 1.4% error rate | Medium | High | Phased rollout — Phases 1–2 are additive, easy to revert; each phase verified via `/api/warrants/scrapers/metrics/summary` before next |

---

## Success Criteria

**Phase 1** (data model + metrics):
- `warrant_scraper_runs` table populating correctly
- `getSourceMetrics()` returns valid grades for all 173 sources
- No regression in error rate (still ≤ 1.5%)

**Phase 2** (scheduler):
- Request volume cut by ≥ 50% (tracked via total runs with `skipped_reason` set)
- No new circuit breaker trips in the 48h following deploy
- p95 latency stable or improved

**Phase 3** (parser):
- "Parser drift" alerts fire on at least one source within first week (proves detection works)
- CLI test harness runs against ≥ 5 sources successfully

**Phase 4** (API + events):
- All 11 HTTP endpoints return valid responses with correct role gating
- WebSocket events reach the client in < 500ms after run completion
- CLI commands work end-to-end on the VPS

**Phase 5** (UI):
- Scrapers tab loads in < 1s with 173 sources
- Live feed updates in real time
- Inline expand works on mobile + desktop without layout shift
- Header badge hides correctly when all sources grade A/B

---

## Out of Scope (Explicitly YAGNI)

- Headless browser fallback for JS-heavy sites (Playwright is heavy, most target sites are server-rendered)
- ML-based parser generation (no training data, not worth the complexity)
- International warrant coverage (Interpol requires credentials we don't have)
- Dedup/enrichment/cross-linking (deferred — this was Approach C, rejected in favor of infra-first)
- Proxy rotation / IP pool (only relevant if WAF blocks scale up)
- SSE endpoint (WebSocket reuses existing infra, no need)
- Separate chart library (hand-rolled SVG sufficient for this density)

These can be added later if evidence shows they're needed.

---

## Open Questions (to resolve during implementation)

1. Should "pause all scrapers" emergency switch persist across restarts? (Default: yes, store in `system_config`.)
2. How long to keep `warrant_scraper_runs` history beyond the 500/source retention? (Default: no archive — 500 recent per source is enough for debugging; aggregated metrics live in config table.)
3. Should the Scrapers tab be visible to dispatchers or admin-only? (Default: visible to dispatchers, action buttons gated to admin/manager.)
4. CLI script location — `server/scripts/scrapers.ts` or new `scripts/` root dir? (Default: `server/scripts/` to reuse server's `tsx` runtime.)

These are implementation details, not design decisions — they can be resolved when writing the plan.
