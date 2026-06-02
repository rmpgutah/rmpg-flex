# Warrant Puller — Advancements & Multi-Source Expansion (Design)

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — ready for implementation plan
**Owner:** Christopher Zamora (RMPG)

## 1. Context

RMPG Flex pulls active warrants from **one** source today: `warrants.utah.gov`
(a JSON API), via `src/utils/utahWarrantPoller.ts` on a 4-hour cron
(`wrangler.toml` `crons = ["0 */4 * * *"]`). It iterates the `persons` table,
matches candidates by name + DOB-derived age, and stores hits in
`utah_warrants`.

**Key discovery:** the system is already *scaffolded for multi-source* but only
Utah is wired:

- An **unused generic `scraped_warrants` table** with a rich schema:
  `source_key, full_name, first/last/middle_name, date_of_birth, age, gender,
  race, city, state, warrant_type, charge_description, court_name, case_number,
  bail_amount, offense_level, issue_date, status, warrant_id, person_id,
  photo_url, detail_url, scraped_at, first_seen_at, last_seen_at, cleared_at,
  dob_verified`.
- A **`warrant_scraper_config`** table with polite-scraping fields already
  present: `content_hash`, `content_hash_updated_at`, `etag`, `last_modified`
  (conditional GET), `avg_parse_count`, `p95_latency_ms`, `jitter_seed`,
  `priority`, `source_type`.
- A code-resident **`SOURCE_REGISTRY`** (`src/routes/warrants.ts`) — currently
  only `utah-warrant-watch`.
- A **"Multi-State Scraped"** results section in the Warrants UI
  (`uniResults.scraped`) that is always empty.

So this work is mostly *lighting up existing infrastructure*, not greenfield.

### Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Coverage scope | Utah counties first, then neighboring states (ID, NV, AZ, WY, CO) |
| Acquisition posture | Aggressive — scrape whatever loads (headless browser, proxies, CAPTCHA, Firecrawl). Authorized LE/security context; official `.gov` sources preferred, third-party aggregators excluded as primary. |
| Advancement focus | All four categories (coverage, match accuracy, officer-safety, ops/audit) |
| Deliverable | This design + the researched source catalog, then a **Phase-1** implementation plan |
| Architecture | **A now** (in-Worker adapter framework), designed to grow into **C** (Queues + Browser Rendering) |

## 2. Architecture

### 2.1 Phase 1 — source-adapter framework (in-Worker fetch)

A registry of **source adapters**, each implementing a small interface:

```ts
interface WarrantSourceAdapter {
  key: string;                 // 'ada-county-id'
  kind: 'api' | 'html' | 'browser' | 'portal';
  meta: { display_name; state; county; source_url; priority };
  // Query the source for one local person; return raw hits (no persistence).
  fetchForPerson(person: PersonRow, env): Promise<RawWarrantHit[]>;
}
```

- The cron iterates **enabled sources × persons**, calls `fetchForPerson`, and
  writes results to the generic **`scraped_warrants`** table (not the
  Utah-specific `utah_warrants` — Utah keeps its dedicated table; a thin view/
  reconcile pass unifies both).
- Per-source **rate-limit + jitter + circuit breaker + conditional GET** use the
  `warrant_scraper_config` fields that already exist.
- A **reconcile pass** (after each run) dedups across sources, scores
  confidence, and updates the watch-list / notifications.
- The existing Utah poller is refactored into an `api` adapter so there's one
  code path; its behavior is preserved.

Phase 1 transports: `api` + `html` (plain `fetch` + HTML parse). `browser` and
`portal` adapters are defined in the interface but throw "not yet supported"
until Phase 2.

### 2.2 Phase 2+ — grow into Queues + Browser Rendering (Approach C)

When CAPTCHA/JS sources are needed, decouple via **Cloudflare Queues**: the cron
*enqueues* `(person × source)` jobs; a consumer Worker processes each with the
right transport — `fetch` for api/html, **Cloudflare Browser Rendering** (or
**Firecrawl** as fallback) for `browser`/`portal` sites, with proxy rotation.
This avoids the 15-minute cron CPU ceiling and isolates flaky sources. The
adapter interface from Phase 1 is unchanged — only the *executor* changes.

**LLM extraction (Firecrawl) is a fallback transport only, never the source of
truth** — warrant charges/names must come from deterministic parsing or be
flagged unverified, because a hallucinated charge is an officer-safety hazard.

## 3. The 10 advancements (phased)

**Coverage & source framework**
1. Generic source-adapter engine → populates `scraped_warrants`, lights up the
   Multi-State UI. *(P1)*
2. Headless-browser + Firecrawl transport (Browser Rendering + proxy rotation)
   for CAPTCHA/JS sites. *(P2)*
3. Per-source resilience: conditional GET, adaptive rate-limit/jitter, circuit
   breakers, A–F health grades (Scrapers tab already renders these). *(P1–2)*

**Match accuracy & data quality**
4. Cross-source dedup + identity resolution (alias/fuzzy name + DOB/age
   corroboration); extends the confirmed/unverified confidence model. *(P1–2)*
5. DOB & photo corroboration via `photo_url`/`detail_url`/`dob_verified`. *(P2)*
6. Charge normalization + severity classification (raw text → normalized
   offense + felony/misd/infraction). *(P1)*

**Officer-safety & alerting**
7. Real-time hit alerts → BOLO auto-gen + radio/voice (VoiceHubDO) +
   `warrant_watch_log` feed, severity-tiered. *(P2)*
8. Watch-list tiers + auto-enroll (persons tied to active cases/incidents;
   scan frequency scales with tier). *(P2)*
9. Dispatch-linked alerts (flagged person linked to an active call/address →
   surface to dispatcher/unit; uses the record-links work). *(P3)*

**Ops, audit & compliance**
10. Source attribution + audit + retention + scheduled daily BOLO digest;
    every record carries source + scrape time + `detail_url` provenance. *(P1
    provenance, P3 digest)*

## 4. Source catalog

Official `.gov` prioritized. Third-party aggregators (`*courtrecords.us`,
`recordspage.org`, `govbackgroundchecks.com`, …) are **excluded as primary**
(corroboration only). `reports.nevcounty.net` was excluded — it is Nevada
*County, California*, not Nevada state.

| # | Source | URL | Transport | Phase |
|---|--------|-----|-----------|-------|
| — | Utah Statewide (live) | warrants.utah.gov/api/v1 | api | ✅ |
| 1 | Arizona DPS (state, name-based) | azdps.gov/warrant-search | api/form | 1–2 |
| 2 | **Ada County, ID** (public ASP report) | apps.adacounty.id.gov/sheriff/reports/warrants.aspx | html | **1** |
| 3 | **Natrona County, WY** (public search) | warrants.natronacounty-wy.gov | html | **1** |
| 4 | Aurora Municipal Court, CO (public list) | court.auroragov.org/warrant | html | 1–2 |
| 5 | Utah County Sheriff | sheriff.utahcounty.gov/.../warrants | html | 2 |
| 6 | Maricopa County (MCSO), AZ | mcso.org/i-want-to/warrant-lookup | browser (CAPTCHA) | 2 |
| 7 | City of Las Vegas Muni Court, NV | lasvegasnevada.gov/.../Warrant-Search | browser/form | 2 |
| 8 | Idaho iCourt portal (all ID counties) | mycourts.idaho.gov | portal | 2–3 |
| 9 | Colorado Judicial Branch portal | courts.state.co.us | portal | 3 |
| 10 | Clark County DA / Justice Court, NV | clarkcountynv.gov | portal | 3 |

Highest-value adds are **Arizona DPS** and **Idaho iCourt** (state / all-county,
like Utah). **Phase-1 picks:** Ada County (ID) + Natrona County (WY) — clean,
official, name-searchable `html` sources — proving the adapter engine next to
the existing Utah `api` adapter. AZ DPS is a Phase-1 stretch if its form is a
simple POST.

## 5. Data flow

```
cron (4h)
  └─ for each enabled source (warrant_scraper_config)
       └─ for each person (persons, filtered)
            └─ adapter.fetchForPerson(person)        // api | html
                 └─ upsert scraped_warrants (source_key, person_id, ...)
  └─ reconcile pass
       ├─ mark cleared (datetime()-normalized; per the Utah poller fix)
       ├─ dedup across sources → canonical hits
       ├─ confidence score (DOB/age corroboration)  // confirmed vs unverified
       ├─ promote confirmed → warrants records (auto_created, source attribution)
       └─ warrant_watch_log events (found/cleared) → Alert Feed + notifications
```

Phase 1 reuses the lifecycle invariants already shipped: `datetime()`-normalized
clear comparison, confirmed-only promotion to the canonical `warrants` table,
retain-on-clear (archive, not delete), and `warrant_watch_log` notifications.

## 6. Error handling

- Per-source `try/catch`; one failing source/person never aborts the run
  (mirrors the Utah poller).
- Circuit breaker (≥5 trailing failures → `circuit_broken`); Scrapers tab shows
  health grade + Reset Circuit.
- Conditional GET (etag/content-hash) to skip unchanged pages and stay polite.
- Timeouts + abort per request; jitter to avoid WAF "scraper" heuristics.
- Browser/Firecrawl transports (P2) get their own retry + proxy-rotation policy.

## 7. Testing

- Unit tests per adapter parser against captured HTML/JSON fixtures (no live
  network in CI) — the parser is the risky part.
- Reconcile/dedup/confidence unit tests with synthetic multi-source hits.
- Smoke test: a fake adapter through the full cron → `scraped_warrants` →
  reconcile → watch-list, asserting no cross-source double-count.
- Existing worker typecheck gate; client tests for the Multi-State UI rendering.

## 8. Legal / operational note

Public warrant registries are public records, but acquisition posture
("aggressive — scrape whatever loads", including CAPTCHA/ToS-restricted sites)
carries blocking, ToS, and maintenance risk. This is accepted by the operator
for authorized law-enforcement/security use. Mitigations baked in: official
`.gov` sources first, per-source provenance + audit trail, polite defaults
(rate-limit/jitter/conditional-GET) even where aggressive transports are
available, and confirmed-vs-unverified confidence so namesake/low-trust hits are
never treated as confirmed.

## 9. Phase-1 scope (for the implementation plan)

1. Define `WarrantSourceAdapter` interface + a source registry keyed off
   `warrant_scraper_config` + code metadata.
2. Refactor the Utah poller into an `api` adapter (behavior-preserving).
3. Implement two `html` adapters: **Ada County, ID** and **Natrona County, WY**
   (fetch + deterministic parse + fixtures).
4. Generic `scraped_warrants` upsert + clear (datetime-normalized) +
   per-source resilience (rate-limit/jitter/circuit/conditional-GET).
5. Reconcile pass: dedup + confidence + confirmed-promotion + watch-log events,
   unified with the existing `utah_warrants` pipeline.
6. Charge normalization + severity (advancement #6) for cross-source uniformity.
7. Wire the Multi-State UI section + Scrapers tab to the new sources;
   seed `warrant_scraper_config` rows + `SOURCE_REGISTRY` entries.
8. Tests (parsers, reconcile, smoke) + SW bump.

Later phases (2–3): Browser Rendering/Firecrawl transport + CAPTCHA/portal
sources (MCSO, iCourt, AZ DPS if gated), real-time alerts/BOLO, watch-list
tiers, dispatch-linked alerts, daily digest.
