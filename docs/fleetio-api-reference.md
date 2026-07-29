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
