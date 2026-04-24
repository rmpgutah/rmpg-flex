# Utah Warrant API — Overhaul & Fix — Design Document

**Date:** 2026-04-14
**Status:** Approved (scope C from brainstorm)
**Scope:** Server-side Utah warrant pipeline (scraper, routes, schema) + the UI overhaul originally scoped in [2026-04-06-warrants-overhaul-design.md](./2026-04-06-warrants-overhaul-design.md)

This doc consolidates two pieces:

1. **API/pipeline fixes and enhancements** (new — this document)
2. **UI/overhaul per the approved 2026-04-06 design** (referenced, not duplicated)

---

## 1. Motivation

The current Utah warrant integration works but suffers from four classes of problems:

- **CloudFront WAF blocks**: `warrants.utah.gov` edge rejects our scan traffic intermittently, stalling hourly watch runs and forcing a 30-minute IP-block cooldown. Scans of 500+ persons routinely hit the WAF mid-run.
- **Search-accuracy bugs**: name-based matching uses `age ± 1` verification with year-only math, which rejects valid hits at year boundaries (e.g. a December 1990 birth reads as "age 36" in January when the person is actually still 35). Duplicate `severity`/`source` WHERE clauses in the list route apply the same filter twice.
- **Missing data fields**: the `UtahApiPerson` / `UtahApiWarrant` types capture only name, age, city, warrant id, court, case id, issue date, and charges. The public API returns more (DOB, race, sex, physical description, bond amount, statute, originating agency). Officers need those fields for positive ID and threat assessment.
- **Scanner coverage**: scanning every person every 4h is wasteful (most haven't been contacted in years), operationally noisy (WAF bans from bulk scans drop interactive searches too), and misses high-value tiers (recent arrestees, active-case subjects) that benefit from sub-hour refresh.

---

## 2. Architecture — Pipeline Changes

### 2.1 Priority scanner (replaces flat "scan all persons")

Introduce tiered scanning based on **operational recency**:

| Tier | Criteria | Cadence |
|------|----------|---------|
| T1 — Hot | Arrested in last 30 days, named on active case, listed as warrant subject, or flagged (`premise_alerts`, `bolo`) | Hourly |
| T2 — Warm | Named on an incident/citation/FI in last 90 days | Every 4 hours |
| T3 — Cold | Everyone else in `persons` | Weekly, in 50-person batches spread across the week |

Implementation: a new `warrant_scan_queue` table holds `(person_id, tier, next_due_at, last_checked_at, last_result)`. A refresh job recomputes tiers nightly based on the activity signals above.

Each scan cycle pulls `WHERE next_due_at <= now()` up to a batch cap (default 30 persons per cycle, capped by `getAdaptiveScanDelay()` pacing).

**Benefit**: ~80% fewer daily API calls, fewer WAF triggers, higher-value coverage where it matters.

### 2.2 Session-cookie warmup for CloudFront

Before each scan burst (not every request), do one GET to `https://warrants.utah.gov/` using the same UA. Capture `Set-Cookie` headers (`_cfuvid`, CloudFront session cookies) into an in-process cookie jar. Replay those cookies on the subsequent `POST /api/v1/persons` / `GET /api/v1/persons/.../warrants` calls.

Refresh cookies when a 403 is observed (treat as cookie expiry first, IP block second).

This does NOT defeat a real WAF ban — if our IP is on a blocklist we still have to cool down — but it removes the "first-hit from a fresh session" 403 that cycles of service restarts produce, and it reduces bot-shape detection by matching the real browser's cookie pattern.

### 2.3 Partial-failure propagation

`searchUtahWarrantsLive` already attaches `__hasPartialErrors` to the results array when per-person warrant fetches fail mid-search. The `/utah-search` route currently discards this flag. The route will copy it into a top-level `partial_errors: true` field on the JSON response, so the UI can render a "Partial results — some warrants could not be verified" banner.

Same treatment for `/utah-search/auto-poll-status` and `/check/:personId`.

### 2.4 Bug fixes

1. **Duplicate WHERE clauses** — [`warrants.ts:47-54` and `warrants.ts:77-84`](../../server/src/routes/warrants.ts) — dedupe the `severity`/`source` filter blocks.
2. **Age-boundary math** — [`utahWarrantScraper.ts:535-547`](../../server/src/utils/utahWarrantScraper.ts) — compute age using month/day, not just year. If the API returns a `dateOfBirth`, match exactly and skip the age approximation.
3. **One-name searches in watch scan** — currently skipped silently; emit a `warrant_watch_log` entry of kind `skipped_insufficient_name` so the UI can surface "X persons not scanned, missing first/last name."
4. **DOB-less persons never match** — the DOB check is in an `if (person.dob && r.age != null)` branch; if person has no DOB, match falls through on name-only (that's current behavior — correct). BUT if person has DOB and API omits age, match is silently skipped. Fix: fall through to name-match when either side of the comparison is missing, log a confidence score.

---

## 3. Schema Expansion

### 3.1 `utah_warrants` table — add columns via `addCol`

```
date_of_birth      TEXT     -- If returned, supersedes age-based matching
sex                TEXT
race               TEXT
height_inches      INTEGER
weight_lbs         INTEGER
eye_color          TEXT
hair_color         TEXT
home_street        TEXT
home_state         TEXT
home_zip           TEXT
bond_amount        REAL     -- Bail/bond if specified on warrant
statute            TEXT     -- Charge statute codes
disposition        TEXT     -- e.g. "ACTIVE" / "RECALLED"
ori                TEXT     -- Originating Agency Identifier
extradition        TEXT     -- if Utah exposes it
raw_json           TEXT     -- Full API response for future-proofing
```

**`raw_json`** is the escape hatch: anything the API returns that we don't have a column for is kept as JSON so later versions can mine it without re-scanning.

### 3.2 New `warrant_scan_queue` table

```
id                  INTEGER PRIMARY KEY
person_id           INTEGER NOT NULL
tier                TEXT NOT NULL        -- 'hot' | 'warm' | 'cold'
next_due_at         TEXT NOT NULL
last_checked_at     TEXT
last_result         TEXT                 -- 'hit' | 'clear' | 'error' | 'blocked'
consecutive_errors  INTEGER DEFAULT 0
created_at          TEXT DEFAULT (datetime('now','localtime'))
UNIQUE(person_id)
```

Indexed on `(tier, next_due_at)` for efficient pull.

### 3.3 2026-04-06 additions (recap)

Per the existing approved doc, also add via `addCol`:

**`warrants`** table: `oca_number`, `ori`, `ncic_entry_number`, `extradition`, `caution_flags` (JSON), `assigned_officer_id`, `assigned_unit_id`, `priority_score`

**`warrant_service_attempts`** table: `gps_lat`, `gps_lng`, `gps_accuracy`, `badge_number`, `photos` (JSON), `signature_data`, `attempt_duration_minutes`

---

## 4. API Endpoints

### 4.1 New / Modified (this doc)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/warrants/scan-queue` | Current queue state (admin/manager) — counts by tier, next due |
| POST | `/api/warrants/scan-queue/rebuild` | Force nightly tier reclassification (admin) |
| POST | `/api/warrants/scan-queue/enqueue/:personId` | Push a person to hot tier for immediate check (dispatcher+) |
| GET | `/api/warrants/utah-search` | **ADDED**: responses now include `partial_errors: boolean` |
| GET | `/api/warrants/check/:personId` | **CHANGED**: includes `partial_errors` flag |

### 4.2 Per 2026-04-06 design (recap, not duplicated)

Assignment board, analytics (clearance-rate, service-time, by-officer, trends, by-source), timeline, map-data/heatmap, BOLO generation — see [2026-04-06 doc §3](./2026-04-06-warrants-overhaul-design.md).

---

## 5. UI

The 2026-04-06 design is the UI plan. One addition from this doc:

- **Stats strip** gains a `SCAN QUEUE` LED — green when queue is healthy, amber when backlog > 2× batch size, red when WAF-blocked.
- **Detail panel** new "Utah API Data" section (collapsible) showing all fields we captured from `utah_warrants` (DOB, description, bond, statute, disposition) alongside our local warrant record. Makes it obvious when the state record disagrees with our copy.

---

## 6. Error Handling

- `null` return from scraper = API failure; scanner records `last_result='error'`, increments `consecutive_errors`, reschedules with exponential backoff (up to 24h).
- `[]` return = no warrants; scanner records `last_result='clear'`, reschedules per tier cadence.
- 403 CloudFront = `last_result='blocked'` on all in-flight persons; scanner pauses 30min (existing `IP_BLOCK_COOLDOWN_MS`).
- Cookie warmup 4xx = log, skip the warmup, let per-request 403 handling kick in.

Every branch that marks `warrant_cleared` will continue to require `last_result='hit'` from a successful scan — never mark cleared from an error. **This is the correctness bedrock and must not regress.**

---

## 7. Testing

Unit tests in `server/tests/integration/warrants.test.ts` (extend existing suite):

1. `partial_errors` flag propagates through `/utah-search` when scraper sets `__hasPartialErrors`
2. Duplicate-WHERE bug fix: filter combinations produce single SQL params list, not doubled
3. Age-boundary math: DOB of Dec 31, 1990 computes to 35 on Dec 30, 2026 and 35 on Jan 2, 2027
4. Scan queue tier assignment: person with arrest in last 30d → `hot`, with incident in 60d → `warm`, otherwise → `cold`
5. Cleared-warrant safety: mocked scraper returning `null` does NOT emit a `warrant_cleared` event
6. Enqueue endpoint: pushing a person to hot tier sets `next_due_at <= now()`

Integration tests that hit `warrants.utah.gov` are excluded (flaky + rate-limited) — scraper is tested with `fetch` mock.

---

## 8. What Does NOT Change

- `JWT_SECRET`, TOTP secret encryption, WebAuthn — untouched
- Existing `warrants`, `warrant_watch_runs`, `warrant_watch_log`, `utah_warrants` rows — all preserved via `addCol` migrations only
- WebSocket broadcast shapes — existing `dispatch_update` / `warrant_found` shapes preserved; new fields are additive
- Scan cadence on fresh VPS — `scheduleUtahWarrantSync()` still starts with 90s delay, just uses the new queue instead of flat persons scan
- `/api/warrants` existing endpoints remain backward-compatible (new fields are optional in responses)

---

## 9. Implementation Order

Phased — each phase is independently deployable.

**Phase 1 — Bug fixes (surgical, low-risk)**

1. Dedupe `severity`/`source` WHERE clauses in `GET /api/warrants`
2. Fix age-boundary math in scanner
3. Propagate `partial_errors` flag through `/utah-search`, `/utah-search/auto-poll-status`, `/check/:personId`
4. Tests for 1-3

**Phase 2 — Schema expansion**

5. `addCol` migrations for new `utah_warrants` columns (DOB, sex, race, description, bond, statute, ORI, raw_json)
6. Expand `UtahApiPerson` / `UtahApiWarrant` types + `UtahWarrantResult` to carry new fields
7. Update `cacheResults` INSERT to store new columns + `raw_json`
8. Tests: new fields persist round-trip; raw_json always populated

**Phase 3 — Session cookie warmup**

9. Add cookie jar + pre-scan warmup GET
10. Tests: warmup runs once per burst; 403 triggers warmup + retry

**Phase 4 — Priority scan queue**

11. Create `warrant_scan_queue` table + tier reclassification job
12. Refactor `runWarrantWatchScan` to pull from queue instead of all persons
13. New endpoints: `GET /scan-queue`, `POST /scan-queue/rebuild`, `POST /scan-queue/enqueue/:personId`
14. Tests: tier logic, due-time calculation, enqueue pushes to hot

**Phase 5 — 2026-04-06 overhaul** (per existing doc)

15. `addCol` migrations for `warrants` + `warrant_service_attempts` (OCA/ORI/NCIC/extradition/caution_flags/GPS/photos/signature)
16. Assignment, analytics, timeline, map-data, heatmap, BOLO endpoints
17. WarrantsPage layout rewrite (top/bottom CAD terminal split)
18. Detail panel sections + service-attempt form + map view + assignment board + analytics

---

## 10. Rollback

Each phase is reversible:

- Phase 1 bugs: `git revert` — only touches two files
- Phase 2 schema: `addCol` is idempotent; old queries still work because new columns are nullable
- Phase 3 cookies: feature flag `UTAH_SCRAPER_COOKIE_WARMUP=false` to disable
- Phase 4 queue: environment flag `WARRANT_SCAN_MODE=legacy` falls back to the current flat scan
- Phase 5 UI: Phase 5 work is gated behind the new page; old WarrantsPage remains until new one ships
