# Overwatch Deep Research — Design Spec

**Date:** 2026-06-15
**Author:** Christopher Zamora (with Claude)
**Status:** Draft for review
**Module:** Overwatch (CRM, `/crm`)

## 1. Goal

Bring a **real** Firecrawl-powered Deep Research capability into the Overwatch
system. Today the Overwatch Firecrawl tab, the Web Intel / Competitor panels, and
the standalone Web Research page all call backend endpoints that are **stubbed or
not mounted at all** — no `FIRECRAWL_API_KEY`, no `api.firecrawl.dev` call exists
in the codebase. This spec replaces the stubs with a working pipeline that:

1. Takes a **subject** (person, business, address, vehicle, lead, competitor, or
   free topic) plus optional seed angles.
2. **Fans out** the research across multiple angles, **searches + scrapes** the
   web via Firecrawl.
3. **Extracts structured findings** (entities, risk flags, facts, relationships,
   contacts, assets, timeline events) with honest confidence.
4. **Adversarially verifies** each high-impact finding against its sources before
   trusting it.
5. **Synthesizes a cited report** using the Claude → Workers-AI engine ladder.
6. Persists everything, lets findings **link to records** (persons / cases /
   leads / competitors), and can **re-run on a schedule** (monitoring) with delta
   detection.

It is a **unified console**: the same engine serves investigative OSINT and
business-development intel; `subject_type` + linking targets decide where a
finding lands.

## 2. Non-goals (this PR)

- Replacing/retiring the legacy `FirecrawlTab.tsx` (11k lines) or `WebResearchPage`
  — they keep their stubs; Deep Research is the new real surface. (Optionally
  repoint their basic search to the new client as a fast-follow — see §11.)
- Live "look-in" browser automation / interactive crawling.
- A general crawl/site-clone tool (the Firecrawl tab already mocks those).

## 3. Architecture

```
Client (Overwatch → Deep Research tab)
        │  POST /api/deep-research            (create job)
        │  GET  /api/deep-research/jobs/:id    (poll status + findings + report)
        ▼
Worker route  src/routes/deepResearch.ts  (auth: required, org-scoped)
        │  writes deep_research_jobs row (status=queued)
        │  env.DEEP_RESEARCH.idFromName(jobId) → DO stub → fetch /start
        ▼
Durable Object  src/durable-objects/DeepResearchDO.ts  (new_sqlite_classes)
   alarm-driven stage machine, ONE stage per tick (resumable, rate-limited):
     expand → search → scrape → extract → verify → synthesize → done
   writes progress to its own storage; writes sources/findings/report to D1.
   for monitors: reschedules an alarm at next_run_at, re-runs, diffs findings.
        │
        ├── src/utils/firecrawl.ts        Worker-safe REST client (no npm SDK)
        └── src/utils/researchEngine.ts   LLM ladder: Claude → Workers AI
```

### 3.1 Why a Durable Object (not `waitUntil`)
A full run is many subrequests (N angles × search + up to M scrapes + 3 LLM
stages) and can take minutes wall-clock. A single request / `waitUntil` is fragile
for that. A DO:
- Survives beyond one request; **alarms** drive one stage per tick → resumable,
  naturally throttled, never blows the per-request subrequest/CPU budget.
- Holds per-job progress in its own SQLite storage.
- The **same alarm mechanism powers scheduled monitoring** — re-run at
  `next_run_at`, diff, flag deltas.

Uses `new_sqlite_classes` (free-plan compatible) like `WelfareWatchDO`. Requires a
`[[durable_objects.bindings]]` + `[[migrations]]` entry in `wrangler.toml`.

### 3.2 Firecrawl client — `src/utils/firecrawl.ts`
Worker-safe, modeled on `src/utils/roboflowAlpr.ts`:
- REST against `https://api.firecrawl.dev/v1` (`/search`, `/scrape`). **No
  `firecrawl` npm SDK** (pulls `node:*`, breaks on Workers).
- `fetch` + `AbortController` timeout + bounded retries/backoff + typed errors
  (`FirecrawlConfigError | FirecrawlTimeoutError | FirecrawlHttpError`).
- Reads `FIRECRAWL_API_KEY` from `env`; **unset → throws `FirecrawlConfigError`**,
  and the route maps that to **HTTP 503** (matches ALPR/Roboflow/OCR pattern).
- v1 search response shape (verified live 2026-06-15):
  `{ success, data: [{ url, title, description, markdown? }], id }`. With
  `scrapeOptions: { formats: ['markdown'] }`, each item carries `markdown` inline.
- Functions: `firecrawlSearch(env, query, { limit, scrape })`,
  `firecrawlScrape(env, url)`.
- Pure response-parsing helpers are unit-tested.

### 3.3 LLM engine ladder — `src/utils/researchEngine.ts`
One seam used by every LLM stage:
`runResearchLLM(env, { system, user, maxTokens, json? }) → string`
- If `getAnthropicKey(env)` returns a key → `callClaude(...)` (`getClaudeModel`).
- Else → `env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', ...)` (free).
- `json: true` requests strict JSON; parsing tolerates markdown-fenced JSON
  (the `open_ai@v4`-style fence bug we hit on Roboflow — strip fences before
  `JSON.parse`). All parsing helpers unit-tested.

## 4. Data model — `migrations/0122_deep_research.sql`

All new tables, all well under the D1 100-column cap. Idempotent
`CREATE TABLE IF NOT EXISTS`. The route reconciles missing columns at boot via the
existing `columnExists()` pattern, and the migration is **applied directly to live
D1 `785de7ae` after merge** (deploy apply is `continue-on-error`).

**`deep_research_jobs`**
| col | type | notes |
|---|---|---|
| id | TEXT PK | uuid |
| org_id | INTEGER | scope |
| created_by | INTEGER | user id |
| subject | TEXT | what we're researching |
| subject_type | TEXT | person\|business\|address\|vehicle\|lead\|competitor\|topic |
| context | TEXT | optional operator notes fed to angle expansion |
| status | TEXT | queued\|expanding\|searching\|scraping\|extracting\|verifying\|synthesizing\|done\|error\|monitoring |
| stage_detail | TEXT | human progress line |
| progress | INTEGER | 0–100 |
| angles_json | TEXT | JSON array of angle strings |
| report_md | TEXT | final cited markdown |
| error | TEXT | nullable |
| source_count | INTEGER | |
| finding_count | INTEGER | |
| linked_entity_type | TEXT | nullable: incident\|person\|case\|lead\|competitor |
| linked_entity_id | INTEGER | nullable |
| monitor_interval_days | INTEGER | nullable; set = recurring monitor |
| next_run_at | TEXT | nullable ISO |
| last_run_at | TEXT | nullable ISO |
| run_count | INTEGER | default 0 |
| created_at / updated_at | TEXT | ISO, America/Denver |

**`research_sources`** (citations) — `id, job_id, run_no, url, title, description,
angle, scraped (INT bool), markdown_excerpt, fetched_at`.

**`research_findings`** — `id, job_id, run_no, org_id, finding_type
(entity|risk_flag|fact|relationship|contact|asset|timeline), title, detail,
confidence REAL (0–1, model self-report), trust REAL (0–1, derived), verdict
(supported|uncertain|refuted), source_urls_json, status
(proposed|confirmed|dismissed), entity_ref_type, entity_ref_id, is_delta INT,
created_at`.

**`research_runs`** (monitor history) — `id, job_id, run_no, started_at,
finished_at, new_findings, changed_findings, source_count`.

### Trust derivation (mirrors `captureTrust` / OCR-trust philosophy)
`trust` is **derived**, never the model's raw self-confidence:
- base = clamp(model confidence, 0, 0.85) for a single-source claim;
- +consensus bonus per independent corroborating source URL;
- ×verification multiplier (`supported` keep, `uncertain` ×0.6, `refuted` → status
  `dismissed`, trust floored).
A finding only auto-surfaces as high-trust when corroborated **and** verified.

## 5. Pipeline stages (DO alarm machine)

Each `alarm()` advances exactly one stage, persists, schedules the next tick.

1. **expand** — `runResearchLLM` turns `(subject, subject_type, context)` into
   3–6 angle strings (e.g. for a person: identity & aliases, criminal/legal,
   business affiliations, social/online presence, news mentions, associates).
   Seed angles from the operator are merged. Caps at 6.
2. **search** — for each angle, `firecrawlSearch(limit=5, scrape=true)`. Dedupe
   URLs across angles. Persist `research_sources`. Cap total sources (default 25).
3. **scrape** — ensure top sources have markdown (search already inlines it;
   scrape any missing high-value URL via `firecrawlScrape`). Store excerpts.
4. **extract** — feed source markdown (batched) to `runResearchLLM(json:true)` →
   structured findings with `finding_type`, `title`, `detail`, `confidence`,
   `source_urls`. Persist `research_findings` (status=proposed).
5. **verify** — for each finding above an impact threshold (risk_flag / entity /
   relationship, or confidence ≥ 0.5), re-prompt with **only that finding's source
   excerpts**: "Is this claim supported by the evidence? supported|uncertain|
   refuted + which source." Set `verdict`, recompute `trust`, dismiss `refuted`.
6. **synthesize** — `runResearchLLM` writes a cited markdown report from the
   verified findings + sources (inline `[n]` citations → source list). Store
   `report_md`, set `status=done`, `progress=100`.

**Monitor mode:** if `monitor_interval_days` set, after `done` the DO schedules an
alarm at `next_run_at`. A re-run bumps `run_count`/`run_no`, re-runs stages, and
**diffs** findings vs the prior run (by normalized title+type): new/changed
findings get `is_delta=1` and a `research_runs` row records the deltas.

### Budget guards (bound Firecrawl credit spend; config-overridable)
`MAX_ANGLES=6`, `MAX_SOURCES_PER_ANGLE=5`, `MAX_TOTAL_SCRAPES=25`,
per-Firecrawl-call timeout, LLM-stage timeout. Logged when a cap truncates work
(no silent truncation — per project rule).

## 6. API surface — `src/routes/deepResearch.ts` (mounted `/api/deep-research`)

| method | path | purpose |
|---|---|---|
| GET | `/health` | `{ configured: bool }` (key present?) |
| POST | `/` | create job `{ subject, subject_type, context?, seed_angles?, link?, monitor_interval_days? }` → `{ id }` (503 if key unset) |
| GET | `/jobs` | list org's jobs (filter `?subject_type=`, `?monitor=1`) |
| GET | `/jobs/:id` | job + sources + findings + report |
| POST | `/jobs/:id/rerun` | force a new run now |
| DELETE | `/jobs/:id` | delete job + children |
| POST | `/findings/:id/confirm` | confirm + optionally `{ entity_ref_type, entity_ref_id }` link → writes audit_log |
| POST | `/findings/:id/dismiss` | dismiss |
| PUT | `/jobs/:id/monitor` | set/clear `monitor_interval_days` |

All `auth: 'required'`, org-scoped, audit-logged on create / confirm.

## 7. Client UI — Overwatch "Deep Research" tab

- New `CrmSection` value `'deepresearch'` + entry in `SECTIONS` (icon `Telescope`/
  `Radar`), rendered in `CrmPage.tsx`. New component
  `client/src/components/crm/DeepResearchTab.tsx`.
- **New research form:** subject + subject_type select + optional context + seed
  angles + link-to-entity picker + "monitor every N days" toggle.
- **Live job view (poll `GET /jobs/:id`):** stage progress bar + `stage_detail`,
  angle chips, **sources list** (citations w/ favicons + external-link), **findings
  grouped by type** with a **TrustBadge** (reuse the OCR/ALPR `TrustBadge`),
  verdict chip, confirm/dismiss + "link to record", and the **synthesized report**
  (rendered markdown via existing `renderFormatted`), **Export PDF** (Arial-only
  per `registerArialFont` rule).
- **Jobs history list:** status, subject, run count, monitor badge; re-run; monitor
  deltas highlighted (`is_delta`).
- Theme: theme-token surfaces only (no hardcoded hex), 2px radius, `PanelTitleBar`,
  `IconButton` with `aria-label`. Tactical surfaces N/A (not a map/HUD).
- API access via `apiFetch`; new-job uses JSON (no multipart).

## 8. Security & compliance

- `auth: 'required'`, every query org-scoped on `c.var.user.org_id`.
- `FIRECRAWL_API_KEY` read only from `c.env`; never hard-coded; **503 when unset.**
- Job-create and finding-confirm write `audit_log` (who researched whom — this is
  investigative tooling; aligns with the Intel CI/28-CFR posture already in-app).
- Budget caps bound external spend; caps log when they truncate.

## 9. Testing

- Vitest (`tests/`) for pure helpers: Firecrawl response parsing, angle-list
  parsing, finding-JSON parsing (incl. markdown-fenced), trust derivation,
  verification-verdict parsing, citation numbering. Run
  `npx vitest run tests/deepResearch.test.ts`.
- Worker has no integration suite (Phase-2 debt) — add a `/health` smoke + typecheck.
- Client: typechecks + builds in CI (`pr-tests.yml`).

## 10. Rollout

- Ship as **one foundation PR** on a feature branch off `origin/main` →
  `gh pr create` (per the PR-flow rule); user reviews/merges → `deploy.yml`.
- After merge: **apply `0122` directly to live D1 `785de7ae`** and verify with
  `pragma_table_info`. Set prod secret: `wrangler secret put FIRECRAWL_API_KEY`.
- Add the DO binding + `[[migrations]]` tag in `wrangler.toml`
  (`new_sqlite_classes = ["DeepResearchDO"]`).
- **Bump `CACHE_NAME` in `client/public/sw.js`** (next SW version).
- Verify in a real browser (WAF managed-challenge blocks curl on non-`/api/health`).

## 11. Fast-follow / optional

- Repoint the legacy `WebResearchPage` `/web-research/*` + the CRM
  `/firecrawl/search` stub at the new Firecrawl client so those surfaces work too.
- Streaming progress over the existing WebSocket instead of polling.
- "Research this" launch buttons from a person/case/lead/competitor detail page
  (pre-fills subject + link).
