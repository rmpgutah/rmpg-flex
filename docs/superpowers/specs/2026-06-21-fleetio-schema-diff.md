# Fleet.io ↔ RMPG Schema Diff

**Date**: 2026-06-21
**Status**: Authored alongside PR 3
**Owner**: Christopher Zamora
**Referenced by**: Fleet.io integration design spec
([`2026-06-21-fleetio-integration-design.md`](2026-06-21-fleetio-integration-design.md)),
all subsequent form-extension PRs (PR 5 work orders, PR 6 inspections).

---

## Purpose

A reviewable, field-by-field comparison of Fleet.io's resource schemas
against RMPG's existing tables, with explicit **must / should / nice**
priorities. Every column added to RMPG to mirror a Fleet.io concept is
listed here with the rationale; every Fleet.io field RMPG *doesn't*
mirror is listed with the deferral reason.

## Source-of-truth versions

- Fleet.io API version: `2023-03-01`
  ([Developer API](https://developer.fleetio.com/docs/api/2023-03-01/fleetio-developer-api))
- RMPG D1 schema baseline: `migrations/baseline/schema.sql` (live snapshot
  of `rmpg-flex` 785de7ae) + migrations through 0137 (PR 3).
- Pre-PR-3 column counts (verified against live D1 on 2026-06-21):
  - `fleet_vehicles`: **62 columns**
  - `fleet_fuel_log`: **17 columns**

## Priority legend

- **must** — required for bidirectional sync correctness; the column maps
  1:1 to a Fleet.io field RMPG also needs to read or write.
- **should** — improves dispatch / mechanic ergonomics on the RMPG side
  (autofill, dashboards, conflict UX) even if Fleet.io wouldn't notice.
- **nice** — future-proofing, useful only when a downstream feature ships.
- **defer (Phase 2)** — explicitly out of scope per the integration spec's
  Non-goals section.

---

## fleet_vehicles

Existing RMPG columns (62, pre-PR-3) cover: id, vehicle_name, vehicle_number,
vin, make, model, year, plate_number, plate_state, color, current_mileage,
status, fuel_type (free-text), is_pursuit_rated, is_take_home, garage_location,
assigned_unit_id, body_type, primary_meter_value, … and the existing audit /
created_at / updated_at metadata. The full pre-PR-3 column list is reproducible
via `SELECT name FROM pragma_table_info('fleet_vehicles') ORDER BY cid`.

### PR 3 additions (mig 0136)

| Column | Type | Default | Priority | Why |
|---|---|---|---|---|
| `fuel_volume_units` | TEXT | NULL | should | Fleet.io 1:1 (`gallons` vs `liters`). Surfaces in fuel form unit picker. |
| `primary_meter_unit` | TEXT | NULL | must | Fleet.io 1:1 (`mi` vs `km`). Without it, mileage joins with ClearPathGPS are unit-ambiguous. Joins `ref_units_of_measure.code` (PR 2). |
| `secondary_meter_value` | INTEGER | NULL | should | Fleet.io 1:1. Some patrol vehicles (K-9 unit idle, command post generator) bill hours, not miles. |
| `secondary_meter_unit` | TEXT | NULL | should | Pair with `secondary_meter_value`. |
| `secondary_meter_label` | TEXT | NULL | nice | Free-text label ("Engine Hours") — UX clarity in fuel/PM forms. |
| `watch_list` | INTEGER | 0 | should | Fleet.io 1:1. Boolean flag for "watch closely" vehicles (post-incident review, lemon candidates). Indexed partial WHERE watch_list=1 for the dashboard widget. |
| `default_image_url` | TEXT | NULL | should | Fleet.io 1:1. Avatar / hero photo for dossier page (PR 7). |
| `tire_size_id` | INTEGER | NULL | should | Soft FK → `ref_tire_sizes.id`. Replaces free-text tire size. Enables suggested-parts via `xref_vmrs_to_default_parts`. |
| `oil_type_id` | INTEGER | NULL | should | Soft FK → `ref_oil_types.id`. Enables next-service autofill in PM form. |
| `oil_capacity_qts` | REAL | NULL | should | Scalar paired with `oil_type_id`. Spillman parity. |
| `coolant_capacity_qts` | REAL | NULL | nice | Same shape; matters for cooling-system service. |
| `gvwr_lbs` | INTEGER | NULL | should | Fleet.io 1:1. Drives DOT inspection scheduling for vehicles >10K lbs. |
| `fuel_type_id` | INTEGER | NULL | must | Soft FK → `ref_fuel_types.id`. Existing `fuel_type` is free-text; the FK is what the fuel/PM forms and Fleet.io's bidirectional sync need. The old column stays in place; route layer prefers `fuel_type_id` and falls back. |

**Indexes added (PR 3)**: `idx_fleet_vehicles_fuel_type`, `idx_fleet_vehicles_oil_type`, `idx_fleet_vehicles_tire_size`, `idx_fleet_vehicles_watch_list (WHERE watch_list = 1)`.

### Fleet.io vehicle fields RMPG explicitly does NOT mirror

| Fleet.io field | Why deferred |
|---|---|
| `current_location_entry_id` | Fleet.io's "where is it parked" model duplicates ClearPathGPS live-location (RMPG's source of truth). Spec Non-goal #3. |
| `secondary_meter_*` history (separate entity in Fleet.io) | RMPG flattens current value onto `fleet_vehicles`; history reconstructs from `fleet_fuel_log` + `fleet_maintenance` updates. |
| `vehicle_renewal_reminders[]` | Phase 2. PM/registration/insurance reminders are covered by `fleet_maintenance` + `vehicle_registration` already. |
| `custom_fields_json` on vehicles | Carried but no UI yet. Custom-fields engine = Phase 2 (Non-goal #4). |

### Ownership map (where this column is written)

(Lives in `src/utils/fleetio/ownership.ts` — to be created in PR 4 alongside the sync engine.)

- `rmpg`: vehicle_name, vehicle_number, assigned_unit_id, status, current_mileage, is_pursuit_rated, is_take_home, garage_location, color, plate_state, default_image_url
- `fleetio`: next_service_mileage, next_service_date, warranty_expiry_date, watch_list
- `shared`: vin, make, model, year, plate_number, body_type, fuel_type_id, primary_meter_unit, tire_size_id, oil_type_id, oil_capacity_qts, coolant_capacity_qts, gvwr_lbs, fuel_volume_units, secondary_meter_*

---

## fleet_fuel_log

Existing RMPG columns (17, pre-PR-3): id, vehicle_id, fuel_date, gallons, total_cost, price_per_gallon, mpg, vendor (free-text), fuel_card_type, odometer, driver_id, location, fuel_grade, created_at, updated_at, audit_user_id, notes.

### PR 3 additions (mig 0137)

| Column | Type | Default | Priority | Why |
|---|---|---|---|---|
| `is_partial_fillup` | INTEGER | 0 | must | Fleet.io 1:1. Without it, RMPG's MPG calculation silently includes splash fills and reports garbage trend lines. |
| `vendor_id` | INTEGER | NULL | should | Soft FK → `ref_vendors.id` (kind='fuel'). Free-text `vendor` stays as fallback; new entries write the id and a NULL on the legacy column. Fleet.io expects the structured vendor reference. |
| `reference_number` | TEXT | NULL | should | Fleet.io 1:1. Receipt or fuel-card line-item id; enables reconciliation against billing imports. |
| `geo_lat` | REAL | NULL | should | Device geolocation at fuel entry — feeds the V6 "fuel anomaly heatmap" (Fleet.io literally can't build this: it needs RMPG's GPS join). |
| `geo_lng` | REAL | NULL | should | Pair. |
| `receipt_r2_key` | TEXT | NULL | should | R2 object key for the photo of the receipt. Storage in the existing `UPLOADS` bucket; route reads via signed URL like dashcam clips. |
| `comments` | TEXT | NULL | nice | Free-text driver note ("smelled funny", "pump 3 only partial"). |
| `custom_fields_json` | TEXT | NULL | nice | Carries Fleet.io custom fields verbatim. UI deferred to Phase 2. |

**Indexes added (PR 3)**: `idx_fleet_fuel_log_vendor`, `idx_fleet_fuel_log_geo`.

### Fleet.io fuel fields RMPG explicitly does NOT mirror

| Fleet.io field | Why deferred |
|---|---|
| `fuel_economy_units` | Derived (`mpg` is already computed on write). |
| `personal_use_amount` | RMPG has `is_take_home` on the vehicle; per-fill split deferred. |
| `expense_entries[]` | Phase 2 — accounting integration is out of scope. |

### Ownership map

- `rmpg`: vehicle_id, fuel_date, driver_id, geo_lat, geo_lng, receipt_r2_key, comments
- `shared`: gallons, total_cost, price_per_gallon, odometer, fuel_grade, vendor_id, reference_number, is_partial_fillup
- `fleetio`: (none — Fleet.io's fuel records are inbound-shared only)

---

## work_orders (PR 5)

Introduced fresh by mig 0138. The full header schema is in the migration;
the integration-relevant rows here document field ownership + priority for
the bidirectional sync.

| Column | Type | Default | Priority | Why |
|---|---|---|---|---|
| `vehicle_id` | INTEGER NOT NULL | — | must | RMPG-owned. The WO's parent row. |
| `status` | TEXT NOT NULL | `'open'` | must | Shared. CHECK constraint mirrors Fleet.io's WO lifecycle (`open` / `in_progress` / `waiting_parts` / `completed` / `cancelled`). Transitions validated server-side. |
| `number` | TEXT | NULL | should | Shared. Shop's WO number; either side may assign it first. |
| `opened_at`, `closed_at` | TEXT | now / NULL | must | Shared. `closed_at` only stamped on the close transition. |
| `summary` | TEXT | NULL | should | Shared. Short one-liner for the readiness board. |
| `vendor_id` | INTEGER | NULL | should | Shared. Soft FK → `ref_vendors(id)` where `kind='shop'`. |
| `category_code` | TEXT | NULL | should | RMPG-owned (RMPG's classification of internal vs external work). Soft FK → `ref_work_order_categories(code)`. |
| `assigned_to_user_id` | INTEGER | NULL | should | RMPG-owned. Soft FK → `users(id)`. |
| `est_cost`, `actual_cost` | REAL | NULL | must | Shared. `actual_cost` is rolled up server-side from line-item totals on the close transition. |
| `odometer_at_open`, `odometer_at_close` | INTEGER | NULL | must | RMPG-owned (ClearPathGPS-fed). |
| `vmrs_system_code`, `vmrs_assembly_code`, `vmrs_component_code` | TEXT | NULL | should | Shared. The WO header's VMRS coordinates; child line items can override per-row. |
| `notes` | TEXT | NULL | should | Shared. |
| `custom_fields_json` | TEXT | NULL | nice | Shared. Fleet.io custom-field passthrough (Phase 2 UI). |

### work_order_line_items

Per the spec, kinds are `labor` / `part` / `fee` with strict server-side
math (`total = qty × unit_cost` when total is missing; preserved when
both are supplied to support adjustment rows).

### Fleet.io WO fields RMPG explicitly does NOT mirror

| Fleet.io field | Why deferred |
|---|---|
| `service_reminders[]` | Fleet.io's PM-reminder engine remains the source of truth (PR 7's `next_service_*` fields on the vehicle row carry the computed dates). |
| `purchase_order_id` | Phase 2 — no PO subsystem in RMPG yet. |

## fleet_maintenance — PR 5 additions

| Column | Type | Default | Priority | Why |
|---|---|---|---|---|
| `work_order_id` | INTEGER | NULL | must | Soft FK → `work_orders(id)`. Cross-link a maintenance entry to its formal WO. |
| `vmrs_system_code`, `vmrs_assembly_code`, `vmrs_component_code` | TEXT | NULL | should | Same as the WO header's; lets non-WO maintenance entries carry VMRS too. |
| `attachments_json` | TEXT | NULL | nice | Inline thumbnail list (UI shortcut). Authoritative attachment storage is `work_order_attachments`. |
| `custom_fields_json` | TEXT | NULL | nice | Carry Fleet.io custom fields verbatim. UI deferred to Phase 2. |

**Index added**: `idx_fleet_maintenance_wo` (partial `WHERE work_order_id IS NOT NULL`).

## vehicle_inspections (deferred to PR 6)

PR 6 adds 3 columns (`template_id`, `items_json`, `escalated_issue_id`)
+ `inspection_templates` table. Same pattern: this doc gets appended by PR 6.

---

## Maintaining this document

When extending either table, **append a row** to the relevant additions
table here in the same PR that adds the column. The schema-diff doc is the
review surface where field ownership, priority, and rationale live; it's
also the document the conflict UI's tooltip cross-links.

Operator review: every column flagged `must` in this document should also
appear in the inbound-webhook payload mapper (PR 4) so a Fleet.io originated
change actually round-trips.
