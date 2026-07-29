# Fleet.io API Reference (RMPG Flex integration surface)

> Captured live from developer.fleetio.com on 2026-07-29. Every field below
> is sourced from a live fetch of Fleet.io's own reference pages, not from
> memory — see the cited URL in each section. Cross-referenced against this
> codebase's mappers in `src/utils/fleetio/seed.ts` and `client.ts`.
>
> Scope: the 5 resources this codebase syncs (`FLEETIO_LINK_RESOURCE` in
> `src/utils/fleetio/resources.ts`). Not a full Fleet.io API reference.

## Vehicles

### `POST https://secure.fleetio.com/api/vehicles` (Create Vehicle)

Live source: https://developer.fleetio.com/reference/create-vehicle (fetched 2026-07-29)

| Field | Type | Required | Description |
|---|---|---|---|
| `color` | string (≤255 chars) | optional | The color of this Vehicle. |
| `fuel_type_id` | integer | optional | The ID of the Fuel Type associated with this Vehicle. |
| `fuel_volume_units` | enum `[us_gallons, uk_gallons, liters]` | optional | Fuel volume unit. |
| `group_id` | integer | optional | The id of the Group for the vehicle. |
| `group_hierarchy` | string | optional | Pipe-delimited group hierarchy, e.g. `"Level 1|Level 2|Level 3"`. Missing nodes are created. |
| `label_ids` | integer[] | optional | Label id(s) to assign; must re-include existing label ids to keep them. |
| `license_plate` | string (≤255 chars) | optional | The license plate number of this Vehicle. |
| `make` | string (≤255 chars) | optional | The name of this Vehicle's manufacturer. |
| `primary_meter_unit` | enum `[km, hr, mi]`, nullable | **required** | Measurement unit for the primary (or secondary, if applicable) meter. |
| `model` | string (≤255 chars) | optional | The name of the model of this Vehicle. |
| `name` | string (≤255 chars) | **required** | A name to assign to this Vehicle. Must be unique. |
| `ownership` | enum `[owned, leased, rented, customer, financed, rent_to_own]` | optional | Ownership type. |
| `registration_expiration_month` | integer (0–12) | optional | Month in which registration expires. |
| `registration_state` | string (≤255 chars) | optional | State/province/territory of registration. |
| `secondary_meter` | boolean | optional | Whether this Vehicle has a secondary meter. |
| `secondary_meter_unit` | enum `[km, hr, mi]`, nullable | optional | Unit for the secondary meter. |
| `system_of_measurement` | enum `[imperial, metric]` | optional | Measurement system. |
| `trim` | string (≤255 chars) | optional | Trim level. |
| `vehicle_status_id` | integer | **required** | The ID of the Vehicle Status for this Vehicle. |
| `vehicle_type_id` | integer | **required** | The ID of the Vehicle Type for this Vehicle. |
| `vin` | string (≤17 chars) | optional | VIN. Must be unique. |
| `year` | integer | optional | Model year. |
| `linked_vehicle_ids` | integer[] | optional | Vehicle id(s) to link to this Vehicle. |
| `purchase_detail` | object | optional | Nested purchase detail (comment, date, price, vendor_id, warranty fields, meter_entry_attributes). |
| `external_ids` | object | optional | Any External IDs associated with this Vehicle. |
| `vehicle_status_name` | string (≤255 chars) | optional | Alternative to `vehicle_status_id` — name instead of id. |
| `vehicle_type_name` | string (≤255 chars) | optional | Alternative to `vehicle_type_id` — name instead of id. |
| `in_service_date` | date-time | optional | Date the Vehicle was put into service (ISO-8601 recommended). |
| `in_service_meter_value` | string | optional | Meter value when put into service. |
| `estimated_service_months` | integer | optional | Estimated months in service. |
| `estimated_replacement_mileage` | float | optional | Estimated replacement mileage. |
| `estimated_resale_price` | float | optional | Estimated resale price. |
| `out_of_service_date` | date-time | optional | Date the Vehicle was/will be retired. |
| `out_of_service_meter_value` | string | optional | Meter value at retirement. |
| `specs` | object | optional | Large nested spec object (engine, tires, dimensions, etc. — ~50 sub-fields). |
| `custom_fields` | object, nullable | optional | Custom Fields (see Fleet.io's separate Custom Fields guide). |

Note: `vehicle_status_name`/`vehicle_type_name` can substitute for the `_id` variants — so the two `_id` fields marked "required" above are not strictly required if the corresponding `_name` field is sent instead. Fleet.io's page does not caveat this in the required-field markup, but the presence of both name and id variants for the same concept implies this.

### `PATCH https://secure.fleetio.com/api/vehicles/:id` (Update Vehicle)

Live source: https://developer.fleetio.com/reference/update-vehicle (fetched 2026-07-29)

Same field set as Create, with these differences:
- All fields are optional (partial update) — including `name`, `primary_meter_unit`, `vehicle_status_id`, `vehicle_type_id`, which were required on create.
- `meter_unit` replaces `primary_meter_unit` as the field name (per the live page's BODY section for Update — note this differs from Create's `primary_meter_unit`).
- `purchase_detail_attributes` replaces `purchase_detail` (Rails-style `_attributes` nested-write convention).
- `specs_attributes` replaces `specs`.
- `in_service_meter` (float) replaces `in_service_meter_value` (string) as the field name for the in-service meter value.
- `out_of_service_meter` (float) replaces `out_of_service_meter_value` (string).
- No `archived_at` field is documented on this endpoint's request body.

### Cross-check against this codebase

**`mapVehicleFieldsToFleetio`** (`src/utils/fleetio/seed.ts:55-66`), used by `dispatchOutbound` for `vehicle.create` / `vehicle.update` events pulled off the queue, sends only:

| Field sent | Source RMPG column | Fleet.io field? |
|---|---|---|
| `name` | derived from `vehicle_name` / `vehicle_number` / `VIN <vin>` | ✅ valid (create: required; update: optional) |
| `vin` | `vin` | ✅ valid |
| `license_plate` | `plate_number` | ✅ valid |
| `year` | `year` | ✅ valid |
| `make` | `make` | ✅ valid |
| `model` | `model` | ✅ valid |
| `color` | `color` | ✅ valid |

⚠️ **MISMATCH — required-on-create fields never sent.** `vehicle_status_id` and `vehicle_type_id` (or their `_name` equivalents) are marked **required** on `POST /vehicles`, and `primary_meter_unit` is also marked **required** (nullable, but required). `mapVehicleFieldsToFleetio` never sends any of the three. Whether a live create actually 422s on this depends on whether Fleet.io applies account-level defaults for a token-authenticated create with no value supplied — that behavior is not visible from the reference page and should be verified against a live create call, not assumed from the doc alone.

**`buildVehiclePayload`** (`src/utils/fleetio/seed.ts:12-26`), used only by the `/seed` route's own query, sends the identical 7-field set (`name`, `vin`, `license_plate`, `year`, `make`, `model`, `color`) via the same derivation logic. The two mappers agree with each other field-for-field — no mismatch between them. Both share the same gap noted above: neither ever sends `vehicle_status_id`/`vehicle_type_id`/`primary_meter_unit`.

⚠️ **MISMATCH — `updateVehicle` client method name doesn't match the update endpoint's field name.** `updateVehicle` (`src/utils/fleetio/client.ts:480-487`) types its payload as `Partial<FleetioVehicleCreatePayload>`, i.e. it reuses the **create** shape (`primary_meter_unit`, `purchase_detail`, `specs`, `in_service_meter_value`, `out_of_service_meter_value`) for PATCH calls. The live Update Vehicle page uses different field names for several of these on PATCH (`meter_unit`, `purchase_detail_attributes`, `specs_attributes`, `in_service_meter`, `out_of_service_meter`). None of the current mappers (`mapVehicleFieldsToFleetio` / `buildVehiclePayload`) populate any of these fields today, so this is currently latent — it would only bite if a future mapper starts sending meter/purchase/spec data through `updateVehicle` using the create-shaped field names.

⚠️ **MISMATCH — `archiveVehicle` sends a field the Update endpoint doesn't document.** `archiveVehicle` (`src/utils/fleetio/client.ts:576-585`) PATCHes `{ archived_at: <iso timestamp> }` to `/vehicles/:id`. `archived_at` does not appear anywhere in the Update Vehicle request body fields on the live reference page (it only appears in the **response** schema as a read-only, system-set field). The code comment above `archiveVehicle` asserts "Fleet.io has no DELETE on /vehicles — archiving = PATCH with archived_at," but the live docs do not confirm `archived_at` is a writable request field. This needs live verification (a real archive call) before being trusted; if Fleet.io actually archives vehicles via a dedicated action (e.g. an `/archive` endpoint, as this codebase already does for vendors per CLAUDE.md's vendor delete-semantics note) rather than a raw PATCH, every archive call is silently failing or being ignored.

## Vendors

### `POST https://secure.fleetio.com/api/vendors` (Create Vendor)

Live source: https://developer.fleetio.com/reference/create-vendor (fetched 2026-07-29)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string (≤255 chars) | **required** | The name of the Vendor. Must be unique. |
| `city` | string (≤255 chars) | optional | The city of the Vendor. |
| `contact_email` | string (≤255 chars) | optional | The email address of the contact person for the Vendor. |
| `contact_name` | string (≤255 chars) | optional | The name of the contact person for the Vendor. |
| `contact_phone` | string (≤255 chars) | optional | The phone number of the contact person for the Vendor. |
| `country` | string (≤255 chars) | optional | The country of the Vendor. |
| `external_id` | string (≤255 chars) | optional | An external ID for the Vendor. Must be unique. |
| `phone` | string (≤255 chars) | optional | The phone number of the Vendor. |
| `postal_code` | string (≤255 chars) | optional | The postal code or ZIP code of the Vendor. |
| `region` | string (≤255 chars) | optional | The region, state, province, or territory of the Vendor. |
| `street_address` | string (≤255 chars) | optional | The street address of the Vendor. |
| `street_address_line_2` | string (≤255 chars) | optional | The second line of the street address of the Vendor. |
| `website` | string (≤255 chars) | optional | The website of the Vendor. |
| `fuel` | boolean | optional | Whether the Vendor provides fuel (listable on Fuel Entries). |
| `service` | boolean | optional | Whether the Vendor provides service (listable on Service Entries and Work Orders). |
| `parts` | boolean | optional | Whether the Vendor provides parts (listable on Parts and Purchase Orders). |
| `vehicle` | boolean | optional | Whether the Vendor provides vehicles (listable on Acquisitions and Vehicles). |
| `custom_fields` | object, nullable | optional | Custom Fields (see Fleet.io's separate Custom Fields guide). |

Response codes documented: `200`, `401`, `403`, `422`, `500`.

### `PATCH https://secure.fleetio.com/api/vendors/:id` (Update Vendor)

Live source: https://developer.fleetio.com/reference/update-vendor (fetched 2026-07-29)

Identical field set to Create, all optional (partial update) — same names throughout, no Rails-style `_attributes` renaming (unlike Vehicles' Update endpoint). Path parameter `id` (string, `^[0-9]+$`) is required.

Response codes documented: `200`, `401`, `403`, `404`, `422`, `500` — note the addition of `404` versus Create's set (a `PATCH` targeting a nonexistent vendor id).

### `PATCH https://secure.fleetio.com/api/vendors/:id/archive` (Archive Vendor)

Live source: https://developer.fleetio.com/reference/archive-vendor (fetched 2026-07-29)

No request body — path parameter `id` only. Response codes documented: `204` (success, empty body), `401`, `403`, `404`, `500`. The live reference page gives no prose description of what a `404` means beyond listing it as a possible response; by standard REST semantics for a path-parameterized resource action, `404` here means "no Vendor exists with this id" (either it was never created remotely, or it was hard-deleted out from under a stale `fleetio_links` row). There is no `422` in this endpoint's documented response set, consistent with there being no request body to validate.

⚠️ **MISMATCH — `archiveVendor` calls the wrong HTTP method.** `archiveVendor` (`src/utils/fleetio/client.ts:724-728`) issues `POST /vendors/:id/archive`. The live reference page documents this endpoint as **`PATCH /vendors/:id/archive`**, not `POST`. The code comment directly above the function (lines 710-723) cites `developer.fleetio.com/docs/api/vendors` for the path and asserts "`POST /vendors/:id/archive` — archive, NOT destroy" as the fix for the prior `DELETE`-based bug (see PR #3162) — the path segment (`/archive`) was corrected, but the verb was not: it should have been `PATCH`, not `POST`. This also affects retry behavior: `isRetryableMethod` (`client.ts:67-68`) treats `PATCH` as idempotent/retryable and `POST` as not, so as coded today a transient 5xx from the archive call gets zero in-band retries and goes straight to dead-letter, when the live contract (an idempotent PATCH with no side-effect-doubling risk) would have allowed the same retry budget every other `vendor` action gets.

### Cross-check against this codebase

**`mapVendorFieldsToFleetio`** (`src/utils/fleetio/seed.ts:103-109`), used by `dispatchOutbound` (`src/utils/fleetio/sync.ts:447-461`) for `vendor.create` / `vendor.update` events, sends:

| Field sent | Fleet.io field? |
|---|---|
| `name` | ✅ valid |
| `address` | ⚠️ MISMATCH — not a Fleet.io field. Live schema has `street_address` / `street_address_line_2`, not `address`. |
| `city` | ✅ valid |
| `state` | ⚠️ MISMATCH — not a Fleet.io field. Live schema has `region`, not `state`. |
| `zip` | ⚠️ MISMATCH — not a Fleet.io field. Live schema has `postal_code`, not `zip`. |
| `phone` | ✅ valid |
| `email` | ⚠️ MISMATCH — not a Fleet.io field. Live schema has `contact_email`, not `email`. |

⚠️ **MISMATCH — 4 of the mapper's 7 field names don't exist on either Vendor endpoint.** `mapVendorFieldsToFleetio` sends `address`, `state`, `zip`, and `email` as top-level keys, but neither Create Vendor nor Update Vendor documents any of those names — the correct field names are `street_address`, `region`, `postal_code`, and `contact_email` respectively. A JSON API that ignores unrecognized keys (the typical behavior, and consistent with there being no separate `400`/`422` documented purely for unknown-field rejection) would silently drop these four values rather than error, meaning every vendor synced through this mapper has its address, state, ZIP, and contact email fields empty on the Fleet.io side even though the local RMPG record has that data and the sync reports success. Only `name`, `city`, and `phone` (3 of 7) land correctly. This is a functional data-loss bug, not just a doc-drift note, but per this task's scope it is recorded here and not fixed.

Both `createVendor` and `updateVendor` (`src/utils/fleetio/client.ts:685-702`) pass the mapper's output straight through as the request body with no additional field translation, so the mismatch above is the entire outbound vendor field story — there is no second mapper for vendors (unlike Vehicles, which has both `mapVehicleFieldsToFleetio` and `buildVehiclePayload`).

**Delete semantics.** `dispatchOutbound`'s `vendor`/`delete` branch (`sync.ts:459-462`) calls `archiveVendor`, matching RMPG's own soft-delete semantics for vendors (`active = 0`, never a hard delete) and CLAUDE.md's documented delete-matching rule ("RMPG soft-deletes vendors → Fleet.io `POST /vendors/:id/archive`" — the CLAUDE.md text itself still says `POST`, which is the same stale verb as the code; both should say `PATCH` per the live docs fetched here). Consistent with the endpoint keeping the vendor recoverable, `dropLink` is never called on this branch (per the comment at `sync.ts:534-538`, link rows are only dropped after a genuine hard delete) — the `fleetio_links` row survives an archive, which is correct.

## Parts

### `POST https://secure.fleetio.com/api/parts` (Create Part)

Live source: https://developer.fleetio.com/reference/create-part (fetched 2026-07-29)

| Field | Type | Required | Description |
|---|---|---|---|
| `description` | string | optional | A description of this Part. |
| `manufacturer_part_number` | string (≤255 chars) | optional | The part number from this Part's manufacturer. |
| `measurement_unit_id` | integer (≥1) | optional | The ID of the measurement unit. |
| `measurement_unit_name` | string | optional | The name of the measurement unit. If it does not exist, it will be ignored. |
| `number` | string (≤255 chars) | **required** | The part number to be used for this Part within Fleetio. Must be unique. Does not have to match the manufacturer's part number. |
| `part_category_id` | integer (≥1) | optional | The ID of the part category. |
| `part_category_name` | string (≤255 chars) | optional | The name of the part category. If it does not exist, it will be created. |
| `part_manufacturer_id` | integer (≥1) | optional | The ID of the part manufacturer. |
| `part_manufacturer_name` | string (≤255 chars) | optional | The name of the part manufacturer. If it does not exist, it will be created. |
| `unit_cost` | number | optional | Cost per unit, interpreted as dollars (or dollars and cents). May be sent as string, integer, or float; up to 2 decimal places. |
| `upc` | string (≤255 chars) | optional | The Universal Product Code for this Part. Must be unique. |
| `tire_config_attributes` | object | optional | Nested tire config (aspect_ratio, rim_diameter, load_index, metric_type, width, construction, speed_rating, factory/minimum tread depth, life_expectancy). |
| `custom_fields` | object, nullable | optional | Custom field values — see Fleet.io's Custom Fields docs. |
| `documents_attributes` | object[] | optional | Attached documents (name, file_url, file_mime_type, file_name, file_size). |
| `images_attributes` | object[] | optional | Attached images (same shape as documents_attributes). |

### `PATCH https://secure.fleetio.com/api/parts/:id` (Update Part)

Live source: https://developer.fleetio.com/reference/update-part (fetched 2026-07-29)

Same body fields as Create Part above, except `number` is optional on update (all other fields identical, including type/length constraints). Path parameter `id` (string matching `^[0-9]+$`) is required.

### `DELETE https://secure.fleetio.com/api/parts/:id` (Delete Part)

Live source: https://developer.fleetio.com/reference/delete-part (fetched 2026-07-29)

Path parameter `id` (string matching `^[0-9]+$`) is required. No request body. Response `204` on success. This IS a genuine hard delete on the resource it targets — but note Fleet.io's Parts API also separately exposes `PATCH /parts/:id/archive` (Archive Part), `GET /parts/archived` (List Archived Parts), and a Restore Part endpoint (confirmed live at https://developer.fleetio.com/docs/api/parts-archive, 2026-07-29) as an alternative, non-destructive way to retire a part. `DELETE /parts/:id` and the archive family are two distinct, coexisting endpoints — the hard delete is not the only option Fleet.io offers for parts, it's simply the one this codebase deliberately chooses. RMPG's own `deletePart` calls `DELETE /parts/:id`, matching RMPG's own hard-delete semantics for parts locally, and matching CLAUDE.md's documented delete-matching rule: "RMPG hard-deletes parts and fuel entries → Fleet.io `DELETE`" (as opposed to vendors, where RMPG soft-deletes and this codebase correctly reaches for the archive endpoint instead — see the Vendors section above).

### Cross-check against this codebase

`mapPartFieldsToFleetio` (`src/utils/fleetio/seed.ts:111-118`) sends:

| Field sent | Fleet.io field? |
|---|---|
| `name` | ⚠️ MISMATCH — no `name` field exists anywhere on the Part create/update schema. |
| `part_number` | ⚠️ MISMATCH — not a Fleet.io field. Live schema uses `number` for Fleetio's own part number. |
| `category` | ⚠️ MISMATCH — not a Fleet.io field. Live schema has `part_category_name` (or `part_category_id`), not `category`. |
| `description` | ✅ valid |
| `supplier` | ⚠️ MISMATCH — not a Fleet.io field. Live schema has `part_manufacturer_name` (or `part_manufacturer_id`), not `supplier`. |
| `unit_cost` | ✅ valid |

⚠️ **MISMATCH — 4 of the mapper's 6 field names don't exist on either Part endpoint.** `mapPartFieldsToFleetio` sends `name`, `part_number`, `category`, and `supplier` as top-level keys, but neither Create Part nor Update Part documents any of those names. `part_number` and `supplier` have obvious correct replacements (`number` and `part_manufacturer_name` respectively); `category` should be `part_category_name`; and `name` has no Fleet.io equivalent at all — Parts are identified by `number`, not a display name, so this key is not merely misspelled but conceptually absent from the resource. If Fleet.io silently ignores unrecognized keys (as observed for the Vendor mismatch above), every part synced through this mapper lands on Fleet.io with only its description and unit cost populated — no part number, no category, no manufacturer/supplier — while the sync reports success and the local RMPG record still has all of that data. Only `description` and `unit_cost` (2 of 6) land correctly. This is a functional data-loss bug, not just a doc-drift note, but per this task's scope it is recorded here and not fixed.

`createPart` and `updatePart` (`src/utils/fleetio/client.ts:736-753`) pass the mapper's output straight through as the request body with no additional field translation, so the mismatch above is the entire outbound part field story.

**Delete semantics.** `dispatchOutbound`'s `part`/`delete` branch (`sync.ts:476-482`) calls `deletePart`, which issues a real `DELETE /parts/:id` — matching RMPG's own hard-delete semantics for parts and CLAUDE.md's documented delete-matching rule ("RMPG hard-deletes parts and fuel entries → Fleet.io `DELETE`"). This asymmetry with Vendors (soft-delete/archive) is intentional and correctly implemented on both sides — no mismatch here, unlike the field-name issues above.

## Work Orders

### `POST https://secure.fleetio.com/api/work_orders` (Create Work Order)

Live source: https://developer.fleetio.com/reference/create-work-order (fetched 2026-07-29)

| Field | Type | Required | Description |
|---|---|---|---|
| `issued_at` | date-time | **required** | The date and time at which this Work Order was issued (ISO-8601 recommended). |
| `started_at` | date-time | optional | The date and time at which this Work Order was started. |
| `completed_at` | date-time | optional | The date and time at which this Work Order was completed. |
| `work_order_status_id` | integer (≥1) | **required** | The ID of the Work Order Status. |
| `invoice_number` | string (≤255 chars) | optional | The number of the Invoice associated with this Work Order. |
| `vendor_id` | integer (≥1), nullable | optional | The ID of the Vendor. |
| `vendor_name` | string (≤255 chars) | optional | The name of the Vendor associated with this Work Order. |
| `vehicle_id` | integer (≥1) | **required** | The ID of the Vehicle. |
| `vehicle_name` | string (≤255 chars) | optional | The name of the Vehicle associated with this Work Order. |
| `discount_type` / `discount` / `discount_percentage` | string / float / float | optional | Discount applied to this Work Order. |
| `parts_markup_type` / `parts_markup` / `parts_markup_percentage` | string / float / float | optional | Parts markup (Premium plan only — writable field). |
| `labor_markup_type` / `labor_markup` / `labor_markup_percentage` | string / float / float | optional | Labor markup (Premium plan only — writable field). |
| `tax_1_type` / `tax_1` / `tax_1_percentage`, `tax_2_type` / `tax_2` / `tax_2_percentage` | string / float / float | optional | Two independent tax slots. |
| `issued_by_id` | integer (≥1), nullable | optional | The ID of the User who issued this Work Order. |
| `contact_id` | integer (≥1), nullable | optional | The ID of the Contact assigned to this Work Order. |
| `label_list` | string (≤255 chars) | optional | Comma-separated tag list. |
| `purchase_order_number` | string | optional | The number of the associated Purchase Order. |
| `description` | string | optional | A description of this Work Order. |
| `number` | integer | optional | The Work Order number. Must be unique. |
| `meter_entry_attributes` / `secondary_meter_entry_attributes` / `starting_meter_entry_attributes` / `ending_meter_entry_attributes` / `starting_secondary_meter_entry_attributes` / `ending_secondary_meter_entry_attributes` | object | optional | Meter reading sub-objects (`{value, void}`). |
| `custom_fields` | object, nullable | optional | Custom field values — see Fleet.io's Custom Fields docs. |
| `ending_meter_same_as_start` | boolean | optional | Use start meter for completion meter? |
| `vmrs_repair_priority_class_id` | integer (≥1), nullable | optional | The ID of the VMRS repair priority class. |
| `scheduled_at` / `expected_completed_at` | date-time | optional | Scheduling dates. |
| `comments_attributes` | object[] | optional | `{title, comment}` entries. |
| `work_order_line_items_attributes` | object[] | optional | Nested line items (labor/part/issue/service-task types, VMRS ids, costs). |
| `work_order_sub_line_items_attributes` | object[] | optional | Nested sub-line items. |
| `issue_ids` | integer[] | optional | Issues to add to this Work Order. |
| `label_ids` | integer[] | optional | Labels to add to this Work Order. |
| `documents_attributes` / `images_attributes` | object[] | optional | Attached documents / images. |

### `PATCH https://secure.fleetio.com/api/work_orders/:id` (Update Work Order)

Live source: https://developer.fleetio.com/reference/update-work-order (fetched 2026-07-29)

Same body fields as Create Work Order above, except `issued_at`, `work_order_status_id`, and `vehicle_id` are all optional on update (every other field identical). Path parameter `id` (string matching `^[0-9]+$`) is required.

### Cross-check against this codebase

**Work orders have no explicit mapper** (unlike Vehicles/Vendors/Parts, each of which has a `mapXFieldsToFleetio` function). `dispatchOutbound`'s `work_order`/`create` and `work_order`/`update` branches (`src/utils/fleetio/sync.ts:406-414` and `:440-445`) build `filteredPayload` by taking the raw RMPG `work_orders` row from the emitted event (`src/routes/workOrders.ts` — `emitWorkOrderEvent(c, 'work_order.create'/'work_order.update', row, id)`, and `src/routes/dispatch/calls.ts:1379`), filtering out any field marked `'fleetio'`-owned via `outboundFieldFilter('work_order', …)` (`WORK_ORDER_OWNERSHIP` in `src/utils/fleetio/ownership.ts:105-131` marks **none** `'fleetio'`-owned, so this filter is a no-op today), running `translateOutboundFks(db, 'work_order', filteredPayload)` (rewrites `vehicle_id`/`vendor_id`/`assigned_to_user_id` from RMPG ids to Fleet.io ids, dropping the optional ones if unlinked), and sending the result straight through as the request body via `createWorkOrder`/`updateWorkOrder` (`src/utils/fleetio/client.ts:600-608`, `:663-670` — both explicitly documented as "Fleet.io work_orders shape — pass through"). So the fields that actually reach Fleet.io are exactly the RMPG `work_orders` table's own column names, listed in `WORK_ORDER_OWNERSHIP`:

| RMPG field sent | Fleet.io field? |
|---|---|
| `vehicle_id` | ✅ valid (translated to Fleet.io id by `translateOutboundFks`) |
| `vendor_id` | ✅ valid (translated to Fleet.io id; dropped if unlinked, which is fine since it's `NULLABLE`) |
| `category_code` | ⚠️ MISMATCH — not a Fleet.io field. No category concept on Work Order create/update; closest analog is per-line-item VMRS classification, not a top-level code. |
| `assigned_to_user_id` | ⚠️ MISMATCH — not a Fleet.io field. Fleet.io's closest concepts are `contact_id` (a Contact, not a User) and `issued_by_id` (a User, but semantically "who issued it," not "who's assigned"); RMPG's raw local user id is sent under neither of those names. |
| `odometer_at_open` | ⚠️ MISMATCH — not a Fleet.io field. Fleet.io models odometer via `starting_meter_entry_attributes: {value, void}` (or the plain `meter_entry_attributes`), not a bare integer. |
| `odometer_at_close` | ⚠️ MISMATCH — not a Fleet.io field. Fleet.io's equivalent is `ending_meter_entry_attributes: {value, void}`. |
| `created_by` | ⚠️ MISMATCH — not a Fleet.io request field. `created_by_id` exists but only in the **response** schema (server-set, read-only) — sending it as a request field does nothing. |
| `status` | ⚠️ MISMATCH — not a Fleet.io field. Fleet.io requires `work_order_status_id` (an **integer id**, required on create), not a string status. |
| `number` | ⚠️ TYPE MISMATCH — `number` is a valid Fleet.io field name, but Fleet.io's create/update schema types it as `integer`; RMPG's `work_orders.number` is very likely a formatted string (the response schema itself documents `number` as `string`, i.e. Fleet.io round-trips it as a string even though the request body types it as `integer`), so this is only reliably safe for pure numeric work-order numbers. |
| `opened_at` | ⚠️ MISMATCH — not a Fleet.io field, and this is the load-bearing one: Fleet.io's **required** create field is `issued_at`, which is never sent under any name. Every `work_order.create` dispatch is therefore missing a required field and should 422 on Fleet.io's side. |
| `closed_at` | ⚠️ MISMATCH — not a Fleet.io field. The correct name is `completed_at`. |
| `summary` | ⚠️ MISMATCH — not a Fleet.io field. The correct name is `description`. |
| `est_cost` | ⚠️ MISMATCH — not a Fleet.io field. Fleet.io computes cost totals (`parts_subtotal`, `labor_subtotal`, `subtotal`, `total_amount`) from `work_order_line_items_attributes`; there is no top-level estimated-cost input. |
| `actual_cost` | ⚠️ MISMATCH — not a Fleet.io field, same reasoning as `est_cost` — Fleet.io derives `total_amount` from line items rather than accepting a top-level actual-cost figure. |
| `vmrs_system_code` / `vmrs_assembly_code` / `vmrs_component_code` | ⚠️ MISMATCH — not Fleet.io Work Order fields. VMRS classification on Fleet.io's side lives per-line-item (`vmrs_system_id`, `vmrs_assembly_id`, `vmrs_component_id` inside `work_order_line_items_attributes`) as integer ids, not top-level string codes. |
| `notes` | ⚠️ MISMATCH — not a Fleet.io field. Fleet.io's closest analog is `comments_attributes: [{title, comment}]`, a different shape entirely. |
| `custom_fields_json` | ⚠️ MISMATCH — not a Fleet.io field. The correct name is `custom_fields` (a nested object, not a JSON-string-suffixed key). |

⚠️ **MISMATCH — 15 of the 18 fields RMPG sends don't exist on either Work Order endpoint, and the create path is missing a required field entirely.** Only `vehicle_id`, `vendor_id`, and (conditionally) `number` land as Fleet.io recognizes them; every other column — `category_code`, `assigned_to_user_id`, `odometer_at_open`, `odometer_at_close`, `created_by`, `status`, `opened_at`, `closed_at`, `summary`, `est_cost`, `actual_cost`, `vmrs_system_code`, `vmrs_assembly_code`, `vmrs_component_code`, `notes`, `custom_fields_json` — has no matching Fleet.io key. This is strictly worse than the Vendor/Part mismatches above: `issued_at` is **required** on Create Work Order and nothing in `WORK_ORDER_OWNERSHIP` ever supplies it (RMPG sends `opened_at` instead, which Fleet.io doesn't recognize), so — unless Fleet.io defaults a missing `issued_at` server-side, which is undocumented — every outbound `work_order/create` dispatch should be rejected with a `422` rather than silently dropping fields. That would surface as a hard failure (exhausted retries → dead letter, per the `fuel.delete` precedent documented in `sync.ts`), not a silent data-loss bug like Vendors/Parts. Because work orders have no mapper to patch, fixing this requires either adding a `mapWorkOrderFieldsToFleetio` translation layer (mirroring `mapVehicleFieldsToFleetio`) or renaming the RMPG-side columns/payload keys to match Fleet.io's naming — per this task's scope, it is recorded here and not fixed.

Both `createWorkOrder` and `updateWorkOrder` (`src/utils/fleetio/client.ts:600-608`, `:663-670`) pass the FK-translated payload straight through as the request body with no field-name translation, so the mismatch above is the entire outbound work-order field story — work orders are the one resource in this integration where "no mapper" is not a simplification but a bug surface: nothing stands between raw RMPG column names and the Fleet.io request body.

**Delete semantics.** There is no `work_order`/`delete` branch in `dispatchOutbound` — the comment at `sync.ts:495` ("Genuinely unsupported — today that's work_order/delete only. No RMPG route emits it") documents this as intentional: RMPG has no route that deletes a work order and emits `work_order.delete`, so the otherwise-required "every emit kind needs a `dispatchOutbound` branch" invariant (CLAUDE.md, Fleet.io invariants) doesn't apply here — there's no emit kind to dead-letter.
