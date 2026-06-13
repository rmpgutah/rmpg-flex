# Person-Screening Framework — Design Spec

- **Date**: 2026-06-13
- **Status**: Draft — pending user review
- **Author**: Claude (brainstormed with Christopher Zamora)
- **Subsystem**: `src/routes/screening.ts`, `src/utils/screening/*`, `client/src/pages/ScreeningPage.tsx`
- **Migration**: `0106_screening` (next free prefix; 0104 is used 4×, 0105 taken)

## 1. Context & Motivation

RMPG Flex is a police CAD/RMS. Officers and dispatchers need to screen persons-of-interest against external law-enforcement databases. Three sources were requested:

1. **INTERPOL Notices** (`https://ws-public.interpol.int`) — internationally wanted (Red), missing (Yellow), and UN-sanctioned (UN) persons. Public, no auth, clean JSON (HAL) REST API.
2. **OFAC / Consolidated Screening List (CSL)** — US Treasury SDN + Commerce + State sanctions lists. Two access paths: a daily key-free bulk download (`consolidated.json`) and a free-key live fuzzy-search API (ITA developer portal).
3. **NSOPW** — National Sex Offender Public Website. **No official API exists** (DOJ/KBIC explicitly does not expose a web service). National coverage is therefore out of scope; the existing **Utah Sex Offender Registry** subsystem (`utah_sex_offenders`, `utahSorPoller.ts`) serves the SO-screening role, and the framework leaves a registered-but-disabled slot for a future national source (commercial or per-state).

Because the three sources differ in shape (notice / sanction / sex-offender), access model, and what a "confirmed hit" *means* (a Red Notice is a warrant; a sanction is a person flag; an SO match is a registry flag), they are built as **pluggable adapters behind one shared screening framework**, not three bespoke features.

## 2. Goals / Non-Goals

### Goals
- One framework with a small adapter interface; sources plug in.
- On-demand search across all enabled sources from a single client surface.
- A targeted, throttled background **watch** that screens watchlisted persons against enabled sources on the existing 4-hourly cron.
- A **pending-review gate**: no automated officer-safety alert fires until a human confirms a match. This is the core safeguard against false positives from fuzzy international/sanctions matching.
- Source-aware promotion of confirmed hits (Red → warrant + alert; sanction → person flag; etc.).
- Confirmed hits surface on the existing person dossier timeline.
- Ship as one cohesive PR via the normal feature-branch → `gh pr create` → `pr-tests.yml` → merge → `deploy.yml` flow.

### Non-Goals
- National NSOPW coverage (no API; deferred behind the framework).
- Polling *every* person against external APIs (rate-limit and noise hazard) — watch is opt-in only.
- Auto-promoting any match to an officer-safety alert without human confirmation.
- Encrypting third-party keys at rest (matches existing `system_config` plaintext pattern; out of scope).

## 3. Locked Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Integration depth | Full watch subsystem + on-demand search | User chose the heavier integration, full-stack. |
| Watch population | `intel_watchlist` persons **∪** dedicated `screening_watchlist` | User chose "both": reuse the existing opt-in list and add a dedicated one. |
| Notice types watched | All three (Red, Yellow, UN) for INTERPOL | User chose all three. |
| Match gate | **Pending review → human confirm → alert** | User chose the safe gate; prevents false officer-safety alerts. |
| NSOPW | Lean on existing Utah SOR; defer national | No official NSOPW API exists. |
| OFAC mode | **Both** bulk-ingest (local match) **and** live CSL API (free key) | User chose both. |
| Session scope | Framework + INTERPOL + OFAC + Utah-SOR adapter, one PR | User chose the ambitious cohesive PR. |

## 4. Architecture Overview

```
        ┌──────────────── client: ScreeningPage (/screening) ───────────────┐
        │  Search · Review Queue (cross-source) · Watchlist · Sources        │
        └───────────────────────────────┬───────────────────────────────────┘
                                         │ apiFetch
                  ┌──────────────────────▼────────────────────────┐
                  │  Worker  /api/screening/*   (src/routes/screening.ts)
                  │  search · hits · confirm/dismiss · watchlist · scan · status
                  └───────┬───────────────┬───────────────┬────────┘
                          │               │               │
              ┌───────────▼──┐   ┌────────▼───────┐  ┌────▼─────────┐
              │ interpolAdapter│   │  ofacAdapter   │  │ utahSorAdapter│
              │ live proxy →   │   │ bulk-ingest +  │  │ wraps existing│
              │ ws-public.     │   │ local match +  │  │ utah_sex_     │
              │ interpol.int   │   │ live CSL API   │  │ offenders     │
              └──────┬─────────┘   └───────┬────────┘  └──────┬───────┘
                     │                     │                  │
        4-hourly cron │  runScreeningScans(db, env)           │ (src/index.ts:387, beside runAllSourceScans)
                     ▼                     ▼                  ▼
              ┌────────────────────────── D1 ───────────────────────────┐
              │ screening_hits · screening_watchlist · screening_source_state
              │ screening_scan_runs · interpol_notices · ofac_sanctions
              │ ofac_ingest_runs · (reuse) utah_sex_offenders            │
              └──────────────────────────────────────────────────────────┘

  confirm(Red)      → INSERT warrants(external_source_key='interpol-red', subject_person_id) → existing call:warrant_alert
  confirm(OFAC/UN)  → person sanctions caution-flag
  confirm(Yellow/SO)→ person flag / dossier note
```

## 5. Shared Framework Core (`src/utils/screening/`)

### 5.1 Adapter interface (`types.ts`)
```ts
export interface NormalizedCandidate {
  sourceKey: string;
  externalId: string;
  displayName: string;
  summary: string;            // short human line ("Red Notice · wanted in DE · fraud")
  photoUrl?: string;
  country?: string;
  listType?: string;          // 'red' | 'yellow' | 'un' | 'SDN' | 'utah-sor' …
  dob?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  nationalities?: string[];
  raw: unknown;               // stored as raw_json for audit
}

export interface MatchResult {
  score: number;              // 0..1
  matchedFields: string[];    // ['surname','forename','age','nationality']
  isConfident: boolean;       // score >= source threshold
}

export interface ScreeningAdapter {
  sourceKey: string;
  kind: 'notice' | 'sanction' | 'sex_offender';
  label: string;
  supportsSearch: boolean;
  supportsWatch: boolean;
  searchAdHoc(env: Bindings, params: SearchParams): Promise<NormalizedCandidate[]>;
  fetchForPerson(env: Bindings, person: PersonRow): Promise<NormalizedCandidate[]>;
  scoreMatch(person: PersonRow, candidate: NormalizedCandidate): MatchResult;   // PURE
  normalize(raw: unknown): NormalizedCandidate;                                 // PURE
  confirmHit(env: Bindings, hit: ScreeningHitRow): Promise<{ promotedRef: string }>;
}
```
`scoreMatch` and `normalize` are pure functions (no I/O) so they are unit-testable without Miniflare.

### 5.2 Registry (`registry.ts`)
A code-defined array of adapters keyed by `sourceKey`. The orchestrator and the `/sources` route read from it; per-source enable/disable + circuit state live in `screening_source_state` (DB), and toggles + keys in `system_config` (`category='integrations'`).

### 5.3 Orchestrator (`runScreeningScans.ts`)
- Hooked into `scheduled()` on the `0 */4 * * *` branch in `src/index.ts`, beside `runAllSourceScans(env.DB)`, wrapped in its own `.catch()` so it can never crash the cron loop.
- For each **enabled, watch-capable** adapter:
  1. Skip if `circuit_broken`.
  2. (OFAC only) if `ofac_sanctions` data is older than 20h, run `ofacAdapter` bulk-ingest first (no dedicated cron entry needed).
  3. Build the watch population = `intel_watchlist`(entity_type='person', active) ∪ `screening_watchlist`(active, source_scope NULL or = sourceKey).
  4. Throttle: process at most `screening_<source>_max_per_run` persons (default 10), oldest-`last_seen_at` first, sequentially with small spacing (INTERPOL only — OFAC/Utah are local and cheap, can process all).
  5. For each person → `fetchForPerson` → `scoreMatch`; confident matches are upserted into `screening_hits` as `status='pending'` (dedupe by source_key+person_id+external_id; bump `last_seen_at`, keep prior status if already reviewed).
  6. Write a `screening_scan_runs` row; update `screening_source_state` (last_run/last_success/last_error/circuit).

### 5.4 Confirm / dismiss (`confirm.ts`)
- `confirmHit(hit)` dispatches to the adapter's `confirmHit` (source-aware promotion), sets `status='confirmed'`, `reviewed_by/at`, `promoted_ref`, and emits the appropriate alert (Red → the existing `call:warrant_alert` path via the canonical `warrants` row).
- `dismissHit(hit)` sets `status='dismissed'`; future scans will not re-open a dismissed hit (matched by source_key+person_id+external_id) unless the external record materially changes.

## 6. Data Model — migration `0106_screening.sql`

All `CREATE TABLE IF NOT EXISTS` (idempotent). No `ALTER` on capped tables (`calls_for_service`, `persons`).

```sql
-- Unified hits / review queue
CREATE TABLE IF NOT EXISTS screening_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  person_id INTEGER,                  -- local persons.id (nullable for ad-hoc-saved hits)
  external_id TEXT NOT NULL,          -- e.g. INTERPOL entity_id, OFAC uid
  match_score REAL DEFAULT 0,
  matched_fields TEXT,                -- JSON array
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | confirmed | dismissed
  display_name TEXT,
  summary TEXT,
  photo_url TEXT,
  country TEXT,
  list_type TEXT,
  raw_json TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  promoted_ref TEXT,                  -- warrant id / flag ref produced on confirm
  first_seen_at TEXT DEFAULT (datetime('now')),
  last_seen_at  TEXT DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_hits_uniq
  ON screening_hits(source_key, person_id, external_id);
CREATE INDEX IF NOT EXISTS idx_screening_hits_status ON screening_hits(status, is_active);
CREATE INDEX IF NOT EXISTS idx_screening_hits_person ON screening_hits(person_id);

-- Dedicated opt-in watch (unioned with intel_watchlist persons)
CREATE TABLE IF NOT EXISTS screening_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  source_scope TEXT,                  -- NULL = all sources, else a source_key
  reason TEXT,
  added_by INTEGER,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_screening_watch_person ON screening_watchlist(person_id, active);

-- Per-source operational state (generalized warrant_scraper_config)
CREATE TABLE IF NOT EXISTS screening_source_state (
  source_key TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  circuit_broken INTEGER DEFAULT 0,
  items_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Per-run metadata (mirrors warrant_watch_runs)
CREATE TABLE IF NOT EXISTS screening_scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  persons_checked INTEGER DEFAULT 0,
  new_hits INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  note TEXT
);

-- INTERPOL fetched-notice cache
CREATE TABLE IF NOT EXISTS interpol_notices (
  entity_id TEXT NOT NULL,
  notice_type TEXT NOT NULL,          -- red | yellow | un
  forename TEXT, name TEXT,
  date_of_birth TEXT,
  nationalities TEXT,                 -- JSON array
  sex_id TEXT,
  charges TEXT,                       -- JSON
  thumbnail_url TEXT,
  raw_json TEXT,
  fetched_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (notice_type, entity_id)
);

-- OFAC consolidated screening list (daily bulk ingest)
CREATE TABLE IF NOT EXISTS ofac_sanctions (
  uid TEXT PRIMARY KEY,               -- consolidated list id
  source_list TEXT,                   -- 'SDN', 'Non-SDN', Commerce/State list name
  entity_type TEXT,                   -- Individual | Entity | Vessel | Aircraft
  name TEXT,
  alt_names TEXT,                     -- JSON array
  programs TEXT,                      -- JSON array (sanctions programs)
  addresses TEXT,                     -- JSON
  dob TEXT,
  nationalities TEXT,                 -- JSON
  remarks TEXT,
  raw_json TEXT,
  ingested_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ofac_name ON ofac_sanctions(name);

CREATE TABLE IF NOT EXISTS ofac_ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  rows_loaded INTEGER DEFAULT 0,
  source_url TEXT,
  error TEXT
);

-- Seed the source registry state
INSERT OR IGNORE INTO screening_source_state (source_key, enabled) VALUES
  ('interpol-red', 1), ('interpol-yellow', 1), ('interpol-un', 1),
  ('ofac-csl', 1), ('utah-sor', 1);
```

Reused unchanged: `intel_watchlist` (mig 0099), `utah_sex_offenders` (mig 0096), `warrants` (canonical, for Red promotion), `persons` (`is_sex_offender`, `sor_number`, `caution_flags`, `nationality`, `citizenship`).

## 7. Adapters

### 7.1 INTERPOL (`interpolAdapter.ts`)
- **Base**: `https://ws-public.interpol.int`. No auth.
- `searchAdHoc`: `GET /notices/v1/{red|yellow|un}` with `forename`, `name`, `nationality`, `ageMin/Max`, `sexId`, `freeText`, `page`, `resultPerPage`; parse HAL `_embedded.notices[]`; `normalize` to `NormalizedCandidate`. Short-lived caching uses the existing `KV` binding (query-hash key, ~1h TTL); `interpol_notices` persists per-notice snapshots for the watch/dossier.
- `fetchForPerson`: query each watched notice type by surname+forename(+nationality if present), then `scoreMatch`.
- Detail/images proxied via `/api/screening/notice/:type/:id` and `/images` (UI drawer).
- `confirmHit`: Red → INSERT `warrants` (`warrant_number='interpol-red-<entity_id>'`, `external_source_key='interpol-red'`, `external_warrant_id=entity_id`, `subject_person_id`, `status='active'`) → existing officer-safety path. Yellow → missing-person dossier note. UN → sanctions caution-flag.

### 7.2 OFAC / CSL (`ofacAdapter.ts`) — both modes
- **Bulk ingest (primary, key-free)**: download `https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json`, upsert into `ofac_sanctions`, record `ofac_ingest_runs`. Triggered inside the 4-hourly orchestrator when data is >20h stale (Treasury refreshes ~daily 05:00 ET). All `searchAdHoc` + `fetchForPerson` matching runs **locally** against `ofac_sanctions` (no rate limit, resilient).
- **Live CSL API (optional, when key present)**: if `system_config` `screening_ofac_csl_api_key` is set, `searchAdHoc` may additionally call the ITA CSL fuzzy-search endpoint for an authoritative on-demand lookup. Absent a key, bulk-local is used exclusively.
- `scoreMatch`: name (normalized) + dob/nationality; programs add context, not score.
- `confirmHit`: set a sanctions caution-flag on the person (append to `caution_flags` / a screening note); **not** a warrant.

### 7.3 Utah SOR (`utahSorAdapter.ts`) — wraps existing infra
- Reuses `utah_sex_offenders` (mig 0096) and `runUtahSorPoll`/`importSorRows` (`utahSorPoller.ts`). No new ingestion code; the adapter exposes the existing data through the screening interface.
- `searchAdHoc`/`fetchForPerson`: local query against `utah_sex_offenders` (+ `persons.is_sex_offender`/`sor_number`).
- `confirmHit`: set `is_sex_offender`/`sor_number` flag on the matched local person (or surface as a dossier note if already flagged).
- The registry also defines a disabled `nsopw-national` slot (no implementation) documenting the deferred national source.

## 8. Matching & the Pending-Review Gate

- Name normalization: lowercase, strip diacritics/punctuation, collapse whitespace; surname is **required** for a confident match.
- Age tolerance: ±1 year vs the source's DOB/age range.
- Per-source `min_score` threshold in `system_config` (default ~0.8); only `isConfident` matches become `pending` hits.
- **Nothing alerts automatically.** A `pending` hit appears in the cross-source Review Queue with its score and matched fields. A `SCAN_ROLES` user **confirms** (→ source-aware promotion + alert) or **dismisses** (→ false positive, won't re-open).

## 9. Cron & Rate-Limit Safety

- Runs on the existing `0 */4 * * *` cron (no `wrangler.toml` change). `runScreeningScans` is `.catch()`-guarded.
- INTERPOL: throttled (default 10 persons/run, oldest-first, sequential) — the only rate-limited source.
- OFAC: local matching after a once-daily bulk ingest — effectively unlimited.
- Utah SOR: fully local.
- Circuit-breaker per source in `screening_source_state`; instant kill via `system_config` `screening_<source>_enabled=false`.

## 10. Worker Routes — `src/routes/screening.ts`, mounted `/api/screening/*`

| Method & path | Roles | Purpose |
|---|---|---|
| `GET /api/screening/sources` | READ | Registry + per-source state |
| `GET /api/screening/search?source=&q=&forename=&name=&nationality=&ageMin=&ageMax=&sexId=&page=` | READ | On-demand search via adapter(s) |
| `GET /api/screening/notice/:type/:id` | READ | INTERPOL detail proxy |
| `GET /api/screening/notice/:type/:id/images` | READ | INTERPOL images proxy |
| `GET /api/screening/hits?status=&person_id=&source=` | READ | Review queue / stored hits |
| `POST /api/screening/hits/:id/confirm` | SCAN | Promote + alert (source-aware) |
| `POST /api/screening/hits/:id/dismiss` | SCAN | Mark false positive |
| `GET/POST/DELETE /api/screening/watchlist` | GET=READ, write=SCAN | Manage dedicated watch entries |
| `POST /api/screening/scan` | SCAN | Manual scan (fire-and-forget, `waitUntil`, 202) |
| `GET /api/screening/status` | READ | Last runs, counts, circuit/enabled |

- `READ_ROLES = ['admin','manager','supervisor','officer','dispatcher']`; `SCAN_ROLES = ['admin','manager','supervisor']`.
- Defensive: pre-migration/table-missing reads fall back to empty arrays (no 500s) — matches `warrants.ts`.
- Mounted in `src/index.ts` with `app.use('/api/screening', authMiddleware)`.

### Ship-gate: proxy routing
`/api/screening` is a **new prefix**. Per the live routing model (`rmpgutah.us/api/*` dispatched by `proxy/index.ts` via `API_ROUTES`/`STUBS`), it must be added to `API_ROUTES` so it reaches the rewrite Worker, then **verified live** — otherwise it falls through to legacy and 404s (a recurring trap in this codebase).
- **Recommended (in plan):** evaluate nesting under the already-routed `/api/warrants/screening/*` to avoid a proxy edit entirely; choose during implementation after confirming current proxy routing for `/api/warrants`.

## 11. Client — `client/src/pages/ScreeningPage.tsx` (`/screening`)

- Nav entry added; route registered.
- Sub-tabs:
  - **Search** — source selector (INTERPOL Red/Yellow/UN, OFAC, Utah SOR) + name/forename/nationality/age/sex fields → results table with thumbnails → detail drawer (photos, charges/programs, country, "Link to person" + "Add to watch").
  - **Review Queue** — cross-source pending hits with score + matched fields; Confirm / Dismiss (role-gated, hidden for non-SCAN roles).
  - **Watchlist** — add/remove dedicated screening watch entries; shows union with intel-watchlist persons.
  - **Sources** — per-source status (last run, count, circuit, enabled).
- Confirmed hits surface on the **person dossier timeline** (`kind='screening_hit'` / source-specific).
- Reuses existing patterns: `apiFetch`, `PanelTitleBar`, table tokens, person-drawer, pure-black surfaces, 2px radius.
- **Bump `CACHE_NAME` in `client/public/sw.js`.**

## 12. Config & Admin

`system_config`, `category='integrations'`:
- `screening_interpol_enabled`, `screening_ofac_enabled`, `screening_utahsor_enabled` (toggles)
- `screening_ofac_csl_api_key` (optional, enables live CSL fuzzy search)
- `screening_<source>_min_score`, `screening_<source>_max_per_run` (tuning)

`AdminIntegrationsTab.tsx`: the reserved `interpol_api_key` slot becomes an INTERPOL **enable toggle** (no key needed); add an OFAC CSL key field + per-source enable toggles.

## 13. Security & Roles

- All `/api/screening/*` behind `authMiddleware`.
- Confirming a hit is an officer-safety action → `SCAN_ROLES` only; audited (`reviewed_by`).
- No new auth secrets; optional CSL key in `system_config` (plaintext, masked in UI — existing pattern).
- Watch is opt-in; no bulk screening of the full person table.

## 14. Testing

- **Unit (pure functions)**: `scoreMatch` and `normalize` for each adapter — name normalization, age tolerance, confidence thresholds, HAL/JSON parsing. The Worker has no vitest suite yet (Phase-2 debt per CLAUDE.md); the plan will either add a minimal Worker vitest harness for these pure modules or co-locate them so they can be exercised, and will document the choice.
- **Client**: typecheck + existing vitest run; a smoke render test for ScreeningPage tabs if feasible.
- **CI**: `pr-tests.yml` (worker typecheck, client typecheck, client vitest, client build) + `column-cap-check.yml` (no ALTERs on capped tables — satisfied).

## 15. Deployment & Ship-Gates

1. Feature branch off `origin/main` (main lives in a sibling worktree).
2. `gh pr create` → `pr-tests.yml` green → user reviews/merges → `deploy.yml`.
3. **Apply `0106_screening` directly to live D1 `785de7ae`** after merge (migration-drift rule — deploy step is `continue-on-error`); verify with `pragma_table_info`.
4. **Add `/api/screening` to `proxy/index.ts` `API_ROUTES`** (or nest under `/api/warrants/screening`) and verify live — else 404 via legacy fall-through.
5. **Bump `client/public/sw.js` `CACHE_NAME`.**
6. Post-deploy verify: `/api/screening/sources` returns the registry; run a manual `/scan`; confirm a known test name in Search.

## 16. Open Questions / Future Work

- National sex-offender source (commercial API or per-state adapters) — registered as disabled `nsopw-national`; revisit when access is procured.
- Whether to add a dedicated daily cron for OFAC ingest vs the "stale >20h" fold-in (current plan: fold-in, no cron change).
- Live CSL API exact endpoint/params + free-key procurement (only if the user enables live mode).
- Worker vitest harness (broader Phase-2 tech-debt item).
- **Verify during planning (don't assume):** exact `warrants` promotion columns (`external_source_key` / `external_warrant_id` / `subject_person_id`) via `pragma_table_info`; `utahSorPoller.ts` export signatures (`runUtahSorPoll`, `importSorRows`); whether `/api/warrants/*` is already routed to the rewrite Worker in `proxy/index.ts` (decides the §10 prefix choice).

## 17. Sources

- INTERPOL OpenAPI: `https://interpol.api.bund.dev/` (spec `bundesAPI/interpol-api`), API base `https://ws-public.interpol.int`.
- OFAC/CSL: Commerce CSL API (`https://data.commerce.gov/consolidated-screening-list-api`), bulk `https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json`, `https://www.trade.gov/data`.
- NSOPW (no API): `https://kbic.nsopw.gov/FAQs.aspx`, `https://www.nsopw.gov/faqs`.
