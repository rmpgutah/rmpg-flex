# Fleet.io / Fleet Manager Gap Audit

**Date:** 2026-07-29
**Companion to:** docs/fleetio-api-reference.md

## Schema-mismatch bugs

| Finding | File:line | Severity | Evidence |
|---|---|---|---|
| ✅ FIXED 2026-07-30 (partial) — Vehicle create now sends `primary_meter_unit: 'mi'` (safe default, documented enum, US-only fleet). `vehicle_status_id`/`vehicle_type_id` remain unsent — deliberately not guessed at, no RMPG-side source of truth exists | `src/utils/fleetio/seed.ts` (`mapVehicleFieldsToFleetio`, `buildVehiclePayload`) | Medium — status/type ids may still 422 or silently rely on account defaults, unverified live | docs/fleetio-api-reference.md:85-86 |
| `updateVehicle` reuses the create-shaped payload type (`primary_meter_unit`/`purchase_detail`/`specs`/`in_service_meter_value`/`out_of_service_meter_value`) instead of the PATCH-only names (`meter_unit`/`purchase_detail_attributes`/`specs_attributes`/`in_service_meter`/`out_of_service_meter`) | `src/utils/fleetio/client.ts:480-487` | Low today (latent — no mapper currently populates these fields) | docs/fleetio-api-reference.md:89 |
| `archiveVehicle` PATCHes an undocumented `archived_at` field to `/vehicles/:id` instead of a verified archive mechanism | `src/utils/fleetio/client.ts:576-585` | High — every vehicle archive may be silently ignored | docs/fleetio-api-reference.md:91 |
| `archiveVendor` uses `POST /vendors/:id/archive`; live docs require `PATCH` | `src/utils/fleetio/client.ts:724-728` | High — every vendor archive attempt likely 404s (also breaks retry idempotency: POST is non-retryable, PATCH is) | docs/fleetio-api-reference.md:136 |
| `mapVendorFieldsToFleetio` sends `address`/`state`/`zip`/`email` — none are real Fleet.io fields (should be `street_address`/`region`/`postal_code`/`contact_email`) | `src/utils/fleetio/seed.ts` | High — silent data loss on every vendor sync (4 of 7 fields dropped) | docs/fleetio-api-reference.md:145-152 |
| `mapPartFieldsToFleetio` sends `name`/`part_number`/`category`/`supplier` — none are real Fleet.io fields (should be `number`/`part_category_name`/`part_manufacturer_name`; `name` has no equivalent) | `src/utils/fleetio/seed.ts` | High — silent data loss on every part sync (4 of 6 fields dropped) | docs/fleetio-api-reference.md:200-207 |
| No `mapWorkOrderFieldsToFleetio` mapper exists at all — raw pass-through. 15 of 18 sent fields have no Fleet.io equivalent, and the **required** `issued_at` field is never sent (RMPG sends `opened_at`, which Fleet.io doesn't recognize) | `src/utils/fleetio/sync.ts:406-414` (`dispatchOutbound`, `work_order`/`create` branch), payload built in `src/routes/fleet.ts` (`workOrders.ts` emit sites) | Critical — every `work_order.create` dispatch is missing a required field and should 422 on Fleet.io's side | docs/fleetio-api-reference.md:266-282 |
| Fuel entry mapper pre-#3162 sent nonexistent `cost` and omitted required `meter_entry_attributes` | `src/utils/fleetio/seed.ts:86-93` (pre-fix state) | Resolved | docs/fleetio-api-reference.md:325-346 — PR #3162 confirmed merged into `main`; this branch inherits the fix. Verified in this session: `sync.ts` `fuel_entry`/`create` branch calls `mapFuelEntryFieldsToFleetio` and `dispatchOutbound` has a working `fuel_entry`/`delete` branch (no longer falls through to 501). |
| CLAUDE.md's "Fleet.io's 50 req/min account ceiling" is not a documented Fleet.io platform limit | `CLAUDE.md` Fleet.io invariants section; self-imposed pacing lives at `PACE_MS` in `src/utils/fleetio/client.ts` | Low — doc-accuracy only, not a functional bug | docs/fleetio-api-reference.md:393 |

**Note on the work-order anomaly:** live D1 (queried in Step 3 below) shows exactly one `outbound`/`work_order`/`create` event with `status='completed'` (`most_recent = 2026-06-21 22:43:51`). That is inconsistent with the doc's prediction that this dispatch should 422 for missing `issued_at`. Possibilities: (a) Fleet.io defaults `issued_at` server-side despite documenting it as required, (b) this codebase's `status='completed'` marks "dispatch attempted and did not throw" rather than "Fleet.io accepted every field," or (c) the one completed row predates the current field set. This is flagged as unresolved and needs a live create call (or a Fleet.io-side lookup of the resulting work order) to settle — do not read the single "completed" row as proof the mismatch above is safe.

## Missing dispatch coverage

| Emit kind | Dispatch branch exists? | Severity | Evidence |
|---|---|---|---|
| `vehicle.create` / `.update` / `.delete` | Yes | — | `sync.ts:370-397` |
| `fuel.create` / `.update` / `.delete` | Yes | — | `sync.ts:399-405, 415-438` |
| `work_order.create` / `.update` / `.close` | Yes (`.close` maps to the same `work_order`/`update` branch as `.update`) | — | `events.ts:85-87` maps `work_order.close` → `{resource:'work_order', action:'update'}`; `sync.ts:440-445` |
| `inspection.create` / `.submit` | Yes, but intentionally a no-op (`return null`) — inspections are RMPG-only by design (`INSPECTION_OWNERSHIP`) | — (by design, not a gap) | `sync.ts:502-509` |
| `vendor.create` / `.update` / `.delete` | Yes | Delete branch works but calls the wrong HTTP verb (see schema-mismatch table above — `POST` instead of `PATCH`) | `sync.ts:447-478` |
| `part.create` / `.update` / `.delete` | Yes | — | `sync.ts:479-501` |
| `work_order.delete` (no emit site exists for it) | **No** — falls through to the 501 catch-all | N/A today (unreachable — `workOrders.ts` only emits create/update/close) but a live risk if a future route adds this emit without adding the branch | `sync.ts:510-523` comment explicitly documents this as the known gap and cites the `fuel.delete` precedent (dead-lettered for weeks before its handler was added, per CLAUDE.md) |

**Conclusion for Step 2:** every kind actually emitted today has a working `dispatchOutbound` branch — no live "missing handler → 501 → dead letter" bug exists right now (the fuel.delete and vendor-404 incidents CLAUDE.md documents are both already patched in this branch). The one gap (`work_order.delete`) is dormant because nothing emits it, but it is a real trap for the next contributor who adds a work-order hard-delete route.

## Bidirectional sync status ("is PR 4 done?")

**Partial / effectively dormant, not "live" in the sense CLAUDE.md's Fleet.io section implies.**

- The webhook receiver is wired up: `src/routes/fleetio.ts:36,55` mounts `fleetioWebhook` at `/` inside the `/api/fleetio` router (so the live path is `POST /api/fleetio/webhook`), and `src/routes/fleetioWebhook.ts:199-206` reads the shared secret from `c.env.FLEETIO_WEBHOOK_SECRET` (not hardcoded) and returns a `not_configured` response when it's unset, consistent with the repo's `503`/`not_configured` pattern.
- Live D1 query (verbatim, `database_id=785de7ae-3e7a-4e01-93bb-d24ddd813f6b`):

  ```sql
  SELECT resource, action, status, COUNT(*) AS n, MAX(created_at) AS most_recent
  FROM fleetio_events WHERE direction = 'inbound' GROUP BY resource, action, status
  ORDER BY most_recent DESC
  ```

  ```json
  [{"resource":"vehicle","action":"update","status":"completed","n":1,"most_recent":"2026-06-21 21:08:52"}]
  ```

  That is the **entire** inbound event history: one row, one resource/action pair, dated 2026-06-21 — over five weeks stale as of this audit (2026-07-29). For contrast, the outbound direction over the same period has 19 events across 5 resource/action pairs, with activity as recent as 2026-07-29 (today). A follow-up unscoped query (`GROUP BY direction, resource, action, status`) confirms the split:

  ```json
  [
    {"direction":"inbound","resource":"vehicle","action":"update","status":"completed","n":1,"most_recent":"2026-06-21 21:08:52"},
    {"direction":"outbound","resource":"vendor","action":"delete","status":"completed","n":3,"most_recent":"2026-07-29 21:53:44"},
    {"direction":"outbound","resource":"vehicle","action":"update","status":"completed","n":9,"most_recent":"2026-07-29 10:49:22"},
    {"direction":"outbound","resource":"vendor","action":"update","status":"completed","n":1,"most_recent":"2026-07-18 15:42:12"},
    {"direction":"outbound","resource":"vendor","action":"create","status":"completed","n":2,"most_recent":"2026-07-18 15:42:00"},
    {"direction":"outbound","resource":"fuel_entry","action":"create","status":"completed","n":2,"most_recent":"2026-07-18 04:20:31"},
    {"direction":"outbound","resource":"work_order","action":"create","status":"completed","n":1,"most_recent":"2026-06-21 22:43:51"},
    {"direction":"outbound","resource":"vehicle","action":"delete","status":"completed","n":1,"most_recent":"2026-06-21 21:22:35"}
  ]
  ```
- `fleetio_conflicts` (the field-level disagreement table PR 4 introduced) has **0 rows**, confirming this session's separate query (`SELECT COUNT(*) n FROM fleetio_conflicts` → `n: 0`).

**Reading of the evidence:** the outbound half of the sync (RMPG → Fleet.io) is genuinely active in production — real vehicle/vendor/fuel/work-order events are flowing today. The inbound half (Fleet.io → RMPG, i.e. the actual "PR 4" webhook-driven bidirectional feature) has fired exactly once, over a month ago, and never again since — most plausibly a single manual test webhook fired when the receiver was stood up, not evidence of a live, operator-registered webhook subscription in Fleet.io's dashboard. Combined with zero rows in `fleetio_conflicts` (the table that would populate the moment two sides genuinely disagreed on a shared field), the honest characterization is: **the webhook receiver code is deployed and technically correct (secret-gated, deduped, waitUntil-backed), but there is no evidence any real Fleet.io webhook subscription is currently configured to call it.** "Bidirectional real-time sync is live" (as CLAUDE.md's PR-numbering language implies) overstates the current state — it should read as "outbound sync live; inbound webhook code shipped but not observably in use."

## Stale or wrong documentation

| CLAUDE.md / spec claim | Actual state | Evidence |
|---|---|---|
| "bidirectional real-time + webhooks land in PR 4" (phrased as an accomplished fact in the Fleet.io section) | Code shipped and correctly wired, but live D1 shows only 1 inbound event ever, 5+ weeks stale, and 0 rows in `fleetio_conflicts` — the feature is not observably in active use | D1 query results above |
| "Fleet.io's 50 req/min account ceiling" (Fleet.io invariants section) | Not a documented Fleet.io platform limit; Fleet.io's own docs say limits are plan-dependent ("consult your plan"). The only public number is an unrelated recommendation (switch to Bulk API above ~20 req/min for certain endpoints). The figure is most likely this codebase's own `PACE_MS=1.2s` self-imposed pacing, misattributed as a Fleet.io-documented ceiling | docs/fleetio-api-reference.md:393 |
| Pagination-contract writeup (cursor-era `records`/`current_cursor`/`next_cursor` vs. legacy bare-array + `X-Pagination-*` headers; no `{records, pagination:{total_pages}}` envelope) | ✅ Confirmed accurate against live Fleet.io docs and against `parseListPage`/`fetchListPage`/`iterateList` in `src/utils/fleetio/client.ts:298-441` | docs/fleetio-api-reference.md:387 |
| Migration `0206_fleetio_link_resource_canonicalization.sql` normalizes `fleetio_links.fleetio_resource` to the five canonical plural values | ❓ Unverifiable from this audit's scope — Task 7's brief did not include a live `pragma_table_info`/`fleetio_links` GROUP BY query to confirm post-migration state; would need a dedicated `SELECT fleetio_resource, COUNT(*) FROM fleetio_links GROUP BY 1` against live D1 to confirm | Not queried in this session |
| Vendor archive fix from PR #3162 ("archive, NOT destroy" — corrected `DELETE` → `POST /vendors/:id/archive`) | ❌ Stale/incomplete as a fix: the path segment (`/archive`) was corrected, but the verb is still wrong (`POST` instead of the required `PATCH`), meaning the archive call very likely still 404s today, just via a different bug than the one #3162 fixed | `src/utils/fleetio/client.ts:724-728`; docs/fleetio-api-reference.md:136 |

## Fleet Manager UI gaps

- **`client/src/pages/fleet/FleetOverviewTab.tsx`** — fetches `/fleetio/conflicts?table=fleet_vehicles` and `?table=fleet_maintenance`, renders `FleetioConflictBadge`. Reads the vehicle-record fields covered by the vehicle mismatch findings (create/update field-name and `archived_at` issues above) but has no direct visibility into whether an archive actually succeeded remotely.
- **`client/src/pages/fleet/tabs/FleetFuelTab.tsx`** — fetches `/fleetio/conflicts?table=fleet_fuel_log`, renders conflict badges. Fuel entry mapper is the one resource confirmed fixed (PR #3162), so this tab is on the healthiest resource of the five.
- **`client/src/pages/fleet/tabs/FleetServiceTab.tsx`** — fetches `/fleetio/conflicts?table=fleet_maintenance`, renders conflict badges.
- **`client/src/pages/fleet/tabs/FleetWorkOrdersTab.tsx`** — fetches `/fleetio/conflicts?table=work_order`, renders conflict badges. This is the tab most exposed to the critical work-order mismatch (missing mapper, missing required `issued_at`) — a user creating a work order here is the trigger for the likely-422 create path, but the tab's conflict-badge UI would only ever show a *field disagreement*, not a hard create failure; a 422 surfaces (if at all) as a dead-lettered event visible only on `/admin/fleetio-health`, not in this tab.
- **`client/src/pages/fleet/tabs/FleetAnalyticsTab.tsx`** — fetches `/fleetio/analytics`, renders `link_coverage`, `latency_by_resource`, and a 14-day `conflict_trend` chart. This is the closest thing to a sync-health surface inside the Fleet Manager itself, but it's a different, narrower dataset than `/admin/fleetio-health`.
- **CORRECTION (2026-07-30):** the row below originally cited `client/src/pages/fleet/tabs/FleetVendorsTab.tsx` for the vendors gap. That was wrong — that file manages `fleet_fuel_vendors` (fuel-price-tracking, unrelated table), not `ref_vendors` (the Fleet.io-synced vendor directory, with the address/state/zip/email fields these bugs actually affect). The real vendor+parts editing UI is `client/src/pages/admin/AdminFleetioDirectoryTab.tsx` — corrected below, and now has conflict-badge coverage for both `ref_vendors` and `fleet_parts` as of [PR #3165](https://github.com/rmpgutah/rmpg-flex/pull/3165).
- **`client/src/pages/admin/AdminFleetioDirectoryTab.tsx`** — ~~originally: no `Fleetio`/conflict reference at all~~. Vendors had two of the most severe confirmed bugs (wrong archive verb, 4-of-7 field-name mismatches causing silent data loss) and Parts had a comparable 4-of-6 mismatch; the UI surface where an operator edits vendor/part fields gave zero indication those fields never reached Fleet.io. Both fixed in PR #3165 (correct field names, correct archive verb) and this tab now renders `FleetioConflictBadge` per row via `/fleetio/conflicts?table=ref_vendors` and `?table=fleet_parts`.
- **`client/src/pages/fleet/FleetDashboardPage.tsx`** — the only client consumer of `/api/fleet-viz/*` (PR 7-9 KPI/dossier/map/PM endpoints); no `/fleetio` conflict or sync-status calls.
- **`client/src/pages/admin/AdminFleetioHealthTab.tsx`** — the actual sync/queue health dashboard (dead-letter counts, queue-unhealthy alerts, per-resource status) lives under `/admin`, entirely separate from the Fleet Manager surface (`client/src/pages/fleet/*`). None of the Fleet Manager tabs above link to it — an operator working the Fleet Manager UI who hits a silently-dropped vendor field or a dead-lettered work-order create has no in-context path to the page that would explain why.

`src/routes/fleet.ts` itself (the RMPG-side CRUD API the Fleet Manager UI calls) is pure local D1 CRUD — no direct Fleet.io calls — plus the `fleet.post/put/delete` handlers documented elsewhere in CLAUDE.md as emitting `vehicle.*`/`fuel.*`/etc. events into `fleetio_events` for the async outbound sweep to pick up. It does not itself read or write any of the mismatched field names; the mismatches live entirely in the mapper functions in `seed.ts` that translate the already-correct local values before they leave the Worker.

## Recommended fix ordering

*(Opinion only — not scheduled or approved; the user decides what to act on and in what order.)*

*Ordered by hard-failure-before-silent-loss, then by blast radius and fix effort — a resource that visibly 422s beats one that silently drops data, which beats one that's merely undocumented.*

1. ✅ **DONE (PR #3165, 2026-07-30) — Work order create.** Added `mapWorkOrderFieldsToFleetio` (`src/utils/fleetio/seed.ts`), wired into both `work_order`/`create` and `work_order`/`update` in `dispatchOutbound`. Not yet verified against a real live Fleet.io create call — the field mapping is verified against the live reference docs, not against an actual round-trip.
2. ✅ **DONE (PR #3165) — Vendor archive verb (`POST` → `PATCH`).** `archiveVendor` (`src/utils/fleetio/client.ts`) now issues `PATCH`. CLAUDE.md's matching stale claim corrected too.
3. ✅ **DONE (PR #3165) — Vendor field-name mapper.** `mapVendorFieldsToFleetio` now sends `street_address`/`region`/`postal_code`/`contact_email`. UI visibility gap also closed: `client/src/pages/admin/AdminFleetioDirectoryTab.tsx` (the correct vendor-editing file — see the correction above) now renders `FleetioConflictBadge` per row.
4. ✅ **DONE (PR #3165) — Part field-name mapper.** `mapPartFieldsToFleetio` now sends `number`/`part_category_name`/`part_manufacturer_name`; `AdminFleetioDirectoryTab.tsx` now renders conflict badges for parts too.
5. **Open — Vehicle `archived_at` field verification.** Needs a live archive call to confirm whether it's silently ignored; if so, likely needs the same treatment as the vendor archive fix (find the real archive mechanism). Deliberately not guessed at — same discipline that caught the vendor/parts bugs. **Partially addressed 2026-07-30:** the other required-on-create field, `primary_meter_unit`, is now sent (`'mi'`, safe to default — see `docs/fleetio-api-reference.md`); `vehicle_status_id`/`vehicle_type_id` remain unsent, deliberately, since RMPG has no source of truth for Fleet.io's account-specific ids.
6. **Open — Confirm or retire the "bidirectional sync is live" claim in CLAUDE.md.** ✅ Partially done 2026-07-30: CLAUDE.md now explicitly states inbound sync is "shipped but not observably in use" rather than implying it's active. Still open: actually registering a live Fleet.io webhook subscription (or confirming none exists) is outside what this codebase can verify from inside the Worker.
7. ✅ **DONE (2026-07-30) — CLAUDE.md rate-limit figure.** Corrected to state `PACE_MS`/1.2s is this codebase's own self-imposed pacing, not a documented Fleet.io platform limit.
8. ✅ **DONE (2026-07-30) — Fleet Manager UI: link to `/admin/fleetio-health`.** Added an admin-only "Sync Health" toolbar button on `FleetPage.tsx` linking to `/admin?tab=fleetio_health`. Conflict-badge visibility for vendors/parts also done (see #3/#4).
9. **Open — `work_order.delete` dispatch branch.** Still no emit site exists (confirmed again 2026-07-30), so still no urgency — deliberately not guessed at, since adding a dispatch branch for an unverified Fleet.io delete/archive endpoint would repeat the exact mistake this audit exists to catch.
10. **Open — Vehicle update-payload type mismatch (`updateVehicle` reusing create-shaped field names).** Still latent — no mapper populates those fields yet.

## Hardening added beyond the original findings (2026-07-30)

Not gaps this audit originally flagged, but surfaced while fixing the ones above:

- **Vendor/part field-length and numeric validation** (`src/routes/refData.ts`, `src/routes/fleet.ts`) — Fleet.io's vendors/parts resources cap string fields at 255 chars and reject negative `unit_cost`. Before the field-name mappers were fixed, these constraints were never exercised (every value was silently dropped regardless of length/sign); now that fields round-trip correctly, an out-of-range value would otherwise 422 on sync instead of being caught at entry.
- **Fuel-log validation** (`src/routes/fleet.ts`) — `POST`/`PUT` fuel-log routes now reject invalid dates and non-positive/negative numeric fields.
- **Duplicate fuel-entry detection** (`client/src/pages/fleet/tabs/FleetFuelTab.tsx`) — flags entries sharing vehicle + date + total cost (the fuel-card-import-on-top-of-manual-entry pattern) with a one-click cleanup action.
