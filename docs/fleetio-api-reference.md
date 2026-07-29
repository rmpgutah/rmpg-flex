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
