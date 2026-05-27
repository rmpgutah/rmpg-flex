# Production Error Triage — 2026-05-27

Snapshot of the errors in your browser console, root-caused against deployed Worker source + live D1 schema. Each row says what's broken, *why* (with the evidence), and the cheapest fix that actually works.

## Architecture refresher (verified against deployed state)

- `rmpgutah.us/api/*` is fronted by `proxy/` (Worker name `rmpg-api-proxy`).
- The proxy dispatches per-path between **`rmpg-flex`** (legacy, source not in this repo, recoverable via `workers_get_worker_code`) and **`rmpg-flex-api`** (the `/src/` rewrite).
- Live D1 is `785de7ae-3e7a-4e01-93bb-d24ddd813f6b` (`rmpg-flex` DB). The DB named `rmpg-flex-db` (`8893480a-…`) in `wrangler.toml` exists but is empty — touching it via `wrangler d1 migrations apply` is a no-op for live.

---

## Bucket A — Dispatch list 500s: D1 100-column cap (legacy Worker)

| Endpoint | Page | Evidence |
|---|---|---|
| `GET /api/dispatch/queue` | MapPage | Deployed source line 13334: `SELECT c.*, p.name, u.full_name, ROUND(...) age_minutes, c.priority_score, c.response_time_seconds FROM calls_for_service c ...`. `calls_for_service` is at **100 columns** (confirmed via `pragma_table_info`). `SELECT c.*` plus joined extras blows past the D1 result-set cap. Error envelope: `Queue query failed`. |
| `GET /api/dispatch/calls?limit=*` | MdtPage, DispatchPage | Same root cause — `api.get("/calls", ...)` at line 12871. Falls through to legacy (proxy only routes specific sub-paths to new Worker). |
| `GET /api/dispatch/calls?archived=true&limit=500` | DispatchPage (archive view) | Same. |

**Why the proxy doesn't already fix this:** `proxy/index.ts` routes `/api/dispatch/calls/:id` (single-row GET/PUT/DELETE) and `POST /api/dispatch/calls` (create) to the new Worker, but the bare list `GET /api/dispatch/calls` and `GET /api/dispatch/queue` still go to legacy.

**Fix options (in order of effort):**
1. **Port `GET /api/dispatch/calls` + `GET /api/dispatch/queue` to `/src/` and route via proxy.** The new Worker already uses `LIST_VIEW_COLUMNS` per `src/routes/dispatch/calls.ts` (per existing memory `feedback-d1-column-cap-for-lists`). Add a `/queue` handler that does the same projection + the in-memory overdue/priority enrichment. Add two more lines to `API_ROUTES`. This is the right long-term fix.
2. **Hot-patch the legacy Worker** by listing the columns explicitly instead of `c.*`. We don't have legacy source in this repo, but it's recoverable. Slower iteration than option 1.

Recommend option 1.

---

## Bucket B — Radio 500s: migration `0038_radio.sql` was never applied

The radio routes go to `env.API` (proxy rule `{ prefix: '/api/radio' }`), so the handler is `/src/routes/radio.ts`. That handler was written against `migrations/0038_radio.sql`, which defines:

```sql
radio_channels: id, name, description, frequency, talkgroup, color, is_default, sort_order, archived_at, created_at, created_by
radio_transmissions: id, channel_id, user_id, unit_label, transmitted_at, duration_seconds, transcript, audio_url, priority, tags, call_id
radio_recordings: (table)
```

But live D1 actually has:

```
radio_channels: id, label, freq, channel_type, sort_order, is_active, created_at
radio_transmissions: id, channel_id, unit_call_sign, user_id, message, duration_ms, started_at, ended_at, is_emergency, created_at
radio_transcripts: (exists, unused by /src/)
radio_recordings: (DOES NOT EXIST)
```

That's a complete divergence — not just a missing column. Errors map:

| Error | Cause |
|---|---|
| `no such column: c.name` (channels list, transmissions list) | Handler does `SELECT c.name AS channel_name`. Live column is `label`. |
| `no such column: transmitted_at` (transmissions, stats, channels last_tx_at) | Live column is `started_at`. |
| `no such table: radio_recordings` (recordings list) | Table never created. |

**Fix options:**
1. **Drop and recreate** the three radio tables on live D1 from `migrations/0038_radio.sql`. Risk: loses any existing rows. `radio_transmissions` on live looks like it has the WS-broadcast columns from a pre-`0038` design — check `SELECT COUNT(*)` before nuking.
2. **Apply additive ALTERs + new table** (ALTER TABLE radio_channels ADD COLUMN name, etc. + CREATE TABLE radio_recordings). Keeps existing data but creates "dead" columns alongside the live ones; handler still won't read them unless updated.
3. **Rewrite the handler to match the live schema** (`label` instead of `name`, `started_at` instead of `transmitted_at`, skip recordings entirely for now). Keeps data, but the schema you actually want is the migration's, not what's live — this path is technical debt.

Recommend option 1 *after* `SELECT COUNT(*) FROM radio_transmissions` to confirm it's safe (the live schema looks like an old stub that may never have collected real data).

---

## Bucket C — Other 500s: handlers query missing tables or schema drift

| Endpoint | Root cause | Live D1 has? |
|---|---|---|
| `GET /api/arrests/recent` (AdminPage) | Handler queries `FROM arrests` | **No `arrests` table on live D1.** Returns 500. |
| `GET /api/admin/clients/1/billing` (AdminPage) | Handler at line 16045 queries `clients`, then `incidents`, then `invoices`. | `clients` ✓, but need to verify `incidents` and `invoices` exist with the expected columns. Quick `pragma_table_info` confirms before fixing. |
| `GET /api/hr/benefits` (HrPage) | Handler at line 33724 queries `FROM hr_benefits b JOIN users u ON u.id = b.officer_id` | **No `hr_benefits` table on live D1.** Per memory `project-hr-tables-stub-created`, three HR tables were patched directly on live but `hr_benefits` was apparently not one of them. |
| `GET /api/howen/devices` (DashcamPage) | Handler at line 63073 does `SELECT hd.*, u.call_sign, u.status, u.officer_name, fv.license_plate FROM howen_devices hd LEFT JOIN units u … LEFT JOIN fleet_vehicles fv …` | `howen_devices` ✓ but need to verify `units` and `fleet_vehicles` exist. |
| `GET /api/howen/events` (DashcamPage) | Handler at line 63272 | `howen_events` ✓ but probably similar join-table issue. |

**Fix:** Per-endpoint — either create the missing table on live D1 (HR pattern from `project-hr-tables-stub-created`) or add a stub to `proxy/index.ts` (HR benefits is a good stub candidate since it's a noisy poller).

---

## Bucket D — 404s: routes not registered on the Worker that serves them

The proxy assumes the new Worker has these handlers, but it doesn't (yet):

| Endpoint | Routed to | Status in new Worker |
|---|---|---|
| `/api/fleet`, `/api/fleet?archived=false`, `/api/fleet?per_page=200`, `/api/fleet/analytics`, `/api/fleet/dashcam-videos` | `env.API` (rule `'/api/fleet'`) | **No `src/routes/fleet.ts`.** All 404. |
| `/api/personnel/body-cameras`, `/api/personnel/bodycam-videos`, `/api/personnel/bodycam-videos/reviews/pending`, `/api/personnel/bodycam-videos/redaction-requests`, `/api/personnel/bodycam-videos/retention/report` | `env.API` (rules at lines 197-198) | Not implemented. 404. |
| `/api/reports/crime-analysis` | `env.API` (line 232) | Not implemented. 404. |
| `/api/audit/logs`, `/api/audit/stats`, `/api/audit/compliance-report`, `/api/audit/index-stats` | No proxy rule → falls through to **legacy** | Legacy has `/audit/logs` (line 16641) but the other three appear missing → 404. |
| `POST /api/dispatch/units` (creating a unit from DispatchPage) | No proxy rule → legacy | Legacy only registers GET `/units`. POST falls off → 404. |
| `GET /api/records/vehicles/:id/history` | No proxy rule → legacy | Not implemented → 404. |
| `POST /api/howen/enable` (DashcamPage) | No proxy rule → legacy | Not implemented → 404. |

**Fix:** Either stub these in `proxy/index.ts` (cheapest, kills console noise) or port real handlers. Body-cameras and audit logs are the most user-visible.

---

## Bucket E — 503: `POST /api/pdf-tools/sign-payload`

Routed to `env.API` per proxy line 153. Comment on that line says: *"Both currently return 503 from the rewrite (configurable in a follow-up). Routing here so the client gets a structured 'not configured' instead of a 404 it logs as a bug."* Not a regression. Leave alone unless wiring up PDF signing is in scope.

---

## Suggested order of attack

1. **Radio (Bucket B)** — most contained, restores a whole page, no cross-Worker coordination. ~15 min if option 1 (drop+recreate) is acceptable.
2. **Dispatch list (Bucket A)** — biggest user-visible impact (CAD core is broken). Port `/calls` list + `/queue` to new Worker, add proxy rules. Risk: hidden behaviors in the legacy enrichment loop. ~1-2 hr.
3. **HR benefits + arrests/recent (Bucket C)** — proxy stubs to silence console noise. ~5 min each.
4. **Body cameras + audit log (Bucket D)** — same stub treatment for unimplemented routes. ~10 min total.
5. **Fleet (Bucket D)** — heavier; FleetPage is a real page that needs handlers. Defer until the fleet rewrite slot.
6. **PDF signing (Bucket E)** — not actually broken. Skip.

If you want, I can start with **Bucket B (radio)**: confirm `radio_transmissions` row count is small/zero on live, then drop + recreate the three radio tables from `migrations/0038_radio.sql`.

---

# Addendum — 2026-05-27 system review

After the initial 5-bucket fix shipped, a broader pass found the radio migration was symptomatic of a recurring pattern: **migrations land in `migrations/` but never apply to live D1** because the pipeline has `continue-on-error: true` on the migration step and the new `rmpg-flex-api` Worker isn't bound to the live DB anyway.

## Bucket F — Unapplied migrations applied directly to live D1

All applied to `785de7ae-3e7a-4e01-93bb-d24ddd813f6b` via D1 MCP. Idempotent (CREATE IF NOT EXISTS + INSERT OR IGNORE) so re-running the pipeline is safe.

| Migration | What it creates | Why it mattered |
|---|---|---|
| `0014_dispatch_run_cards.sql` (table + index + 32-card seed) | `dispatch_run_cards` + 32 Spillman-style protocol cards | **Was silently 500-ing every `POST /api/dispatch/calls`** — `applyRunCard()` queried this missing table and threw. Now all 32 cards are live (structure_fire, shots_fired, domestic_in_progress, etc.). |
| `0015_nibrs_codes.sql` | 6 NIBRS reference tables + 62 offense codes + 138 reference rows (location/weapon/bias/property/loss) | `/api/nibrs/*` handlers queried these — 500 on any NIBRS report attempt. |
| `0023_business_records.sql` | `businesses`, `business_vehicles`, `business_visits`, `business_photos`, `call_businesses` | `/api/business-*` + Records subject-search business arm + future `/api/dispatch/calls/:id/businesses` were all dead. |
| `0024_document_folders.sql` | `document_folders` + `attachments.folder_id` | Document Intake folder hierarchy was missing; serve-intake auto-filing 500'd. |
| `0028_cases.sql` (`case_notes` + `case_person_links` only — `cases` already existed) | Two missing junctions | Case notes and case-person linking 500'd. |
| `0034_patrol.sql` (`patrol_breaks` + `patrol_tour_verifications` only) | Two missing tables | Patrol break tracking + supervisor tour sign-off endpoints 500'd; `patrol.ts:445` `SELECT v.*` on `patrol_tour_verifications` was a latent 500. |

**Intentionally NOT applied:** the `ALTER TABLE calls_for_service ADD COLUMN run_card_id / run_card_applied_at` from `0014_dispatch_run_cards.sql`. `calls_for_service` is at the D1 100-col cap; adding 2 more columns would break `GET /:id`'s `SELECT *`. Instead:
- Added `run_card_id` + `run_card_applied_at` to `calls_for_service_ext` (1:1 overflow table per the established PSO/process-service pattern).
- Updated `src/routes/dispatch/calls.ts` to write the run-card tracking columns to ext (best-effort, post-INSERT, never blocks call creation if ext write fails).
- Hardened `src/routes/runCards.ts::applyRunCard` with a `try/catch` so a missing table degrades to "no card applied" rather than a 500.

## Bucket G — Remaining ghost routes (NOT addressed by this PR)

These routes produce 404 when hit but didn't appear in the original console dump. Proxy routes them to `env.API` per existing rules, but the new worker has no matching handler. None of the pages that would hit them are currently working enough to fire the request, so they're filed under "next session".

- `/api/skiptracer/status`, `/api/skiptracer/stats` — proxy → env.API → no `/api/skiptracer` mount
- `/api/iped/*` — proxy → env.API → no `/api/iped` mount
- `/api/personnel/{schedules,time,deployments,coverage-gaps}` — `personnel` router mounted but sub-paths unimplemented
- `/api/reports/{incidents-summary,crime-trends,beat-activity,citation-revenue,schedules,templates,statute-analytics}` — `reports` mounted to the `stubs` router but only `/response-times` exists there; the other 7 paths 404

Fix path when needed: either add to `STUBS` array in `proxy/index.ts` (cheapest, ~2 min per route) or extend `src/routes/stubs.ts` with empty-shape handlers.

## Bucket H — Schema baseline gaps that informed Bucket F

Tables on live D1 NOT referenced by `/src/` handlers (legacy-only territory; do not delete without verifying):
- `body_cameras`, `bodycam_videos` (stubbed in proxy already)
- `call_units`, `call_visit_history` (legacy junctions)
- `criminal_history`, `dl_addresses`, `dl_records`, `microbilt_searches`, `skiptracer_dossiers` (records integrations)
- `fleet_*` (5 tables — fleet module not ported)
- `cpgps_*` (5 tables — legacy GPS integration)
- `forensic_case_links`, `forensic_hash_*` (3 tables — extends forensics)
- `notifications`, `messages`, `email_cache`, `email_rules`, `security_notifications`
- `ofac_sdn_*` (4 sanctions tables)
- `offender_alerts`, `officer_equipment`, `equipment_checkout_log`
- `patrol_incidents`, `patrol_reports`, `performance_reviews`, `hr_reviews`, `review_cycles`, `disciplinary_records`, `leave_requests`, `training_records`, `training_requirements`
- `password_history`, `trusted_devices`, `user_preferences`, `user_security_questions`
- `schedules`, `deployments` (different from the proxy-routed `/personnel/schedules` API)
- `scraped_warrants`, `warrant_scraper_config`, `warrant_service_attempts`, `warrant_watch_log`
- `serve_queue_persons`, `serve_skip_traces`
- `sm_*` (3 service-marshal tables)
- `speed_violations`, `time_entries`, `time_entry_edits`, `trespass_orders`, `use_of_force`, `vehicle_tows`
- `geofences`, `iped_imports`, `integration_api_keys`, `integration_health_log`, `invoice_items`, `invoice_payments`, `daily_activity_reports`, `dash_cameras`, `email_cache`, `code_violations`, `client_persons`, `record_links`

These don't break anything today — they're just rows the new worker can't see. Most don't need to be ported until their feature is rewritten.

---

# Addendum 2 — 2026-05-27 (afternoon) second-pass review

After the first push to PR #667, ran the silent-stale-bundle check and a deeper legacy-table sweep. Three new findings.

## Finding 1 — Run cards deactivated on live until PR #667 deploys

The 32 dispatch run cards seeded by Bucket F land on live D1 immediately, but the matching `src/routes/dispatch/calls.ts` change that writes `run_card_id` to **ext** (instead of the base table that doesn't have those columns) only deploys on PR merge. Until then, the *deployed* legacy/old-rewrite handler tries to write the columns to the base table, hits "no such column," and 500s.

Mitigation applied to live D1 right now:

```sql
UPDATE dispatch_run_cards SET active = 0;
```

This makes `applyRunCard` find no matching row → returns null card → the `if (rcResult.card)` block in the deployed handler is skipped → POST /api/dispatch/calls works (or fails for whatever other reason it was failing before, unchanged from prior state).

**After PR #667 merges and deploys**, reactivate:

```sql
UPDATE dispatch_run_cards SET active = 1;
```

This is captured at the bottom of [project-live-d1-schema-patches](https://github.com/anthropics/claude-code/issues/... memory file).

## Finding 2 — Bucket G stubs added in this batch

PR #667 now includes proxy stubs for the 14 routes flagged as 404s in the previous addendum's Bucket G:
- `/api/skiptracer/{status,stats}`
- `/api/iped/{status,hash-sets}`
- `/api/personnel/{schedules,time,deployments,coverage-gaps}`
- `/api/reports/{incidents-summary,crime-trends,beat-activity,citation-revenue,schedules,templates,statute-analytics}`

Same pattern as the earlier 14 — GET-only, empty/zeroed shapes the UI tolerates. POST/PUT/DELETE on these paths stay 404.

## Finding 3 — Bucket I: ~60 legacy-only tables (NOT addressed)

Cross-referencing the deployed `rmpg-flex` legacy bundle's `FROM <table>` patterns against live D1 finds 60 tables the legacy worker queries that live D1 doesn't have. Most map to features that aren't in active use (full CRM module, full HR module, lead scraping, etc). Each is a 500-on-feature-use waiting to happen.

Highlights, grouped:

| Domain | Missing tables | Risk if a user hits |
|---|---|---|
| **Cases junctions** | `case_calls`, `case_incidents`, `case_incident_links`, `case_evidence`, `case_evidence_links`, `case_persons`, `case_properties`, `case_vehicles`, `case_warrants`, `case_citations` | Case detail page 500 on tab open |
| **Arrests** | `arrests` (plural), `arrest_cross_links` | Arrest records 500 beyond /recent stub |
| **HR (full module)** | `hr_attendance`, `hr_disciplinary`, `hr_documents`, `hr_exit_interviews`, `hr_grievances`, `hr_handbook_acknowledgments`, `hr_leave_balances`, `hr_leave_requests`, `hr_pay_periods`, `hr_pay_rates`, `hr_payroll_entries`, `hr_performance_reviews`, `hr_pips`, `hr_salary_history`, `hr_workers_comp`, `leave_balances`, `overtime_requests`, `payments`, `personnel_certifications`, `officer_credentials` | Multiple HR tabs 500 |
| **CRM** | `crm_leads`, `crm_activity`, `crm_lead_activity`, `crm_proposals`, `crm_proposal_templates`, `crm_tasks` | CRM page 500 if used |
| **Invoicing** | `invoices`, `invoice_line_items`, `invoice_reminders`, `invoice_templates` | Invoicing page 500 |
| **Dashcam** | `dashcam_events`, `dashcam_video_links` | DashCamerasPage events tab 500 |
| **Skip tracer** | `dossiers`, `skip_tracer_searches_v`, `people_index` | Beyond the stubs above |
| **Misc** | `entity_statutes`, `gps_locations`, `howen_gps_breadcrumbs`, `cpg_device_mappings`, `sex_offender_registry`, `dispatch_units` (alternate name), `dispatch_messages`, `webauthn_credentials`, `user_totp_secrets`, `trespass_violations`, `speed_zones`, `vehicles` (alternate), `lead_scrape_log`, `lead_scrape_sources`, `connection_investigations`, `ai_dev_chat`, `dar_templates`, `months`, `company_documents`, `warrant_scraper_runs` | Feature-specific 500s |

**Why not fixing in this PR:**
1. Many tables are alternate names for tables that already exist (`calls` vs `calls_for_service`, `vehicles` vs `vehicles_records`, `dispatch_units` vs `units`) — fixing requires reading each handler, not blanket-creating empty tables.
2. Several map to features the user likely doesn't actively use (CRM, full HR, lead scraping, invoicing).
3. Blanket-applying empty CREATEs for 60 tables risks creating schemas the handlers don't match.

**Recommended path forward:** address per-feature as users report or as pages get opened in prod. Each fix is the same 3-step recipe: (a) grep legacy bundle for actual SQL referencing the missing table, (b) reverse-engineer the schema from the SELECT/INSERT, (c) apply CREATE TABLE on live D1 (via `d1_database_query`).

---

# Deploy state snapshot (2026-05-27 ~09:00 UTC)

| Component | State | Notes |
|---|---|---|
| `rmpg-flex` (legacy worker) | last modified 2026-05-24 | unchanged this session |
| `rmpg-flex-api` (new worker) | last modified 2026-05-27T06:37 | BEFORE PR #667 |
| `rmpg-api-proxy` | last modified 2026-05-27T06:37 | BEFORE PR #667 |
| Live D1 (`785de7ae-…`) | patched directly | radio + 7 migration applies + run_card_id on ext + run cards deactivated |
| PR #667 | open, not merged | both worker code fix and proxy stubs land on merge |

**The asymmetry matters:** all D1 schema fixes are live, all code fixes are pending merge.
