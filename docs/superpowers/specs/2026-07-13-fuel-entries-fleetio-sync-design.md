# Fuel Entries — v2 CRUD + Fleet.io Two-Way Sync — Design

**Date:** 2026-07-13
**Scope:** Three related gaps in the Fleet Manager v2 Fuel Entries feature, found while auditing the Fleet.io integration.

## Background

Fleet v2's Fuel Entries UI (`client/src/pages/fleet/v2/routes/FuelEntriesRoute.tsx` fleet-wide list, `client/src/pages/fleet/v2/vehicleDetail/FuelTab.tsx` per-vehicle) is **read-only** — creating a fuel entry punts to the legacy `/fleet` app's `FuelLogModal.tsx`. Meanwhile the backend (`src/routes/fleet.ts`) already has full CRUD (`GET/POST /:id/fuel`, `PUT/DELETE /fuel/:id`) and every mutation already calls `emitFleetioEvent(...)` to queue an outbound push to Fleet.io — the push mechanism exists but is never exercised because the v2 UI never calls these endpoints.

Separately, Fleet.io's *inbound* pull (`POST /fleetio/pull` in `src/routes/fleetio.ts`) only reconciles **vehicles** — it never imports Fleet.io's fuel entry history into `fleet_fuel_log`. And `FleetioConflictBadge`'s resolve buttons (`local_wins`/`remote_wins` → `POST /fleetio/conflicts/:id/resolve`) only render in its non-`compact` mode, which both fuel screens don't use — so conflicts are visible but not actionable from these screens.

All three are addressed together since they form one coherent "fuel entry sync loop": create/edit exercises push, pull brings in Fleet.io's existing history, and conflict-resolve closes the loop when the two disagree.

## Part 1 — Fuel Entry Create/Edit/Delete in the v2 UI

### New component: `FuelEntryModal.tsx`

New file: `client/src/pages/fleet/v2/vehicleDetail/FuelEntryModal.tsx`. A modal form with the same field set as the legacy `FuelFormState` (`client/src/pages/fleet/modals/FuelLogModal.tsx`): `fuel_date`, `gallons`, `cost_per_gallon`, `total_cost`, `odometer_reading` (mapped to backend's `odometer` column), `fuel_type` (`regular`/`premium`/`diesel`), `station`, `notes`, `is_full_tank`, `payment_method`, `driver_name`, `location`. Two modes:
- **Create**: `POST /fleet/:vehicleId/fuel` via `apiFetchV2`
- **Edit**: `PUT /fleet/fuel/:fuelId` via `apiFetchV2`

Both already emit outbound Fleet.io events server-side — the modal doesn't need any Fleet.io-specific logic, just calls the existing endpoints. Follows the same modal shell conventions as `WorkOrdersRoute.tsx`'s `NewWorkOrderModal` (dialog role, Esc-to-close, `Field` label wrapper).

### Wiring into `FuelTab.tsx` (per-vehicle detail)

Add a "New Fuel Entry" button (opens `FuelEntryModal` in create mode, pre-filled `vehicleId` from the tab's prop) and per-row edit/delete icon buttons. Delete calls `DELETE /fleet/fuel/:fuelId` via `apiFetchV2` with a confirm step (reuse whatever lightweight confirm pattern `WorkOrdersTab.tsx`/sibling tabs use, or a simple `window.confirm` if none exists — check before deciding). On success, refetch the tab's rows.

### Wiring into `FuelEntriesRoute.tsx` (fleet-wide list)

Add the same edit/delete icons per row, using each row's `vehicle_id` (already present in the fanned-out row data) to call `PUT`/`DELETE /fleet/fuel/:fuelId`. Replace the `LegacyActionLink label="New Fuel Entry"` with a button opening `FuelEntryModal` — but since this view isn't scoped to one vehicle, the modal needs a vehicle picker (reuse the `<select>` + `VehicleStub[]` pattern from `WorkOrdersRoute.tsx`'s `NewWorkOrderModal`, fetching `/fleet?limit=500` the same way).

## Part 2 — Inbound pull of Fleet.io fuel entries

### New client function: `listFuelEntries()`

Add to `src/utils/fleetio/client.ts`, modeled on `listVehicles()`:
```ts
export interface ListFuelEntriesInput {
  config: FleetioConfig;
  vehicleId: number; // Fleet.io vehicle id, not RMPG id
  page?: number;
  perPage?: number;
  fetchImpl?: typeof fetch;
}
export async function listFuelEntries(input: ListFuelEntriesInput): Promise<FleetioListResponse<FleetioFuelEntry>> {
  return fleetioFetch<FleetioListResponse<FleetioFuelEntry>>({
    method: 'GET',
    path: '/fuel_entries',
    config: input.config,
    query: { vehicle_id: input.vehicleId, page: input.page ?? 1, per_page: input.perPage ?? 100 },
    fetchImpl: input.fetchImpl,
  });
}
```

### Extend `POST /fleetio/pull` (`src/routes/fleetio.ts`)

After the existing vehicle-linking loop completes, add a second phase: for every vehicle now present in `fleetio_links` (`rmpg_table='fleet_vehicles'`), page through `listFuelEntries({vehicleId: link.fleetio_id})`. For each Fleet.io fuel entry:
- Skip if already linked (`fleetio_links` where `rmpg_table='fleet_fuel_log' AND fleetio_resource='fuel_entries' AND fleetio_id=<entry.id>`)
- Otherwise, `INSERT INTO fleet_fuel_log` (map Fleet.io's `date`→`fuel_date`, `us_gallons`→`gallons`, `cost`→`total_cost`; leave RMPG-only fields like `driver_name`/`payment_method` null since Fleet.io doesn't carry them) and `INSERT INTO fleetio_links (rmpg_table, rmpg_id, fleetio_resource, fleetio_id, last_pulled_at) VALUES ('fleet_fuel_log', ?, 'fuel_entries', ?, datetime('now'))`

No new migration — `fleetio_links`' existing unique indexes `(rmpg_table, rmpg_id)` and `(fleetio_resource, fleetio_id)` already support a third resource type. No conflict-detection needed for the *pull* side (fuel entries are append-only historical records, not a single mutable entity like a vehicle — there's no name-matching ambiguity to resolve). The response body's existing `outcomes` array gains additional entries for the fuel-entry phase (`status: 'fuel_linked_existing' | 'fuel_created' | 'fuel_skipped_no_link'` for vehicles with no Fleet.io link yet to pull against).

## Part 3 — Conflict-resolve buttons in compact mode

`client/src/components/FleetioConflictBadge.tsx`'s compact-mode `Tooltip` currently shows read-only local/remote values. Add two small buttons ("Keep local" / "Use remote") at the bottom of the tooltip content, calling the same `resolve()` function the non-compact mode already uses, gated behind the same `!conflict.resolution || conflict.resolution === 'unresolved'` check. This is a change to the shared component, so it improves every screen using compact badges, not just fuel — scoped narrowly to adding the two buttons, no other behavior change.

## Error handling

- All new endpoints follow the existing `dbErrorResponse(c, err, 'Failed')` pattern.
- The fuel-entry pull phase reuses `/pull`'s existing `FleetioConfigError` → `503 {ok:false, code:'not_configured'}` gate (already present at the top of the handler) — no new config-gate logic needed since it's the same handler.
- `listFuelEntries` failures for one vehicle during the pull loop should not abort the whole `/pull` run — catch per-vehicle, record an outcome entry (`status: 'fuel_pull_failed'`), and continue to the next vehicle (matches the existing per-record resilience pattern in the vehicle-linking loop).

## Testing

- **`FuelEntryModal.tsx`**: Vitest component tests — renders create mode with empty fields, renders edit mode pre-filled from a passed row, calls the correct endpoint (`POST` vs `PUT`) on save, closes on Esc while not saving.
- **`FuelTab.tsx` / `FuelEntriesRoute.tsx`**: extend existing test files with cases for the new button/icons opening the modal and triggering a refetch on success.
- **`listFuelEntries()`**: unit test in `src/utils/fleetio/client.test.ts` (or wherever `client.ts`'s existing tests live) verifying the query params and response typing, mirroring `listVehicles` test coverage.
- **`/pull` fuel-entry phase**: extend the existing `/pull` route test (find it — likely `tests/` at repo root per this Worker's test layout) with cases: new fuel entry gets inserted + linked, already-linked entry is skipped, a vehicle with no Fleet.io link is skipped entirely for the fuel phase.
- **`FleetioConflictBadge`**: extend its existing test file with a case that compact-mode resolve buttons call `resolve()` with the right resolution value and hide once resolved.

## Out of scope

- Fleet.io webhook-driven real-time push (existing cron-drain via `fleetio_events` is sufficient; no move to webhooks for fuel entries).
- Editing/deleting a fuel entry that originated from a Fleet.io pull (still fully editable — no special-casing; an edit just triggers the normal outbound `fuel.update` push back to Fleet.io).
- Any UI to manually trigger `/pull` beyond what already exists in the admin health tooling — this design only extends what `/pull` does, not who can call it.
