# Fleet V2 — Live Sync Channel Inventory

Audit of every `useLiveSync()` call in the existing `/fleet` UI tree.
Generated for [PR 7'a spec](../superpowers/specs/2026-06-21-fleet-manager-ui-fleetio-style-design.md) §6.4.

Each row documents the channel string, payload shape (best-effort from
the server-side broadcast), and which new v2 Route will subscribe to
the same channel in PR 7'a/b.

## Inventory

| File:line | Channel | Payload shape | v2 Route that subscribes |
|---|---|---|---|
| `client/src/pages/fleet/FleetPage.tsx:281` | `'fleet'` | Broadcast triggers `silentRefreshVehicles()` — payload is opaque (the v1 handler ignores it and just re-fetches `/api/fleet`). Server-side: `src/routes/ws.ts` broadcasts `{ channel: 'fleet', ... }` whenever any `fleet_vehicles` row is inserted/updated/deleted. | PR 7'b: `VehiclesListRoute` (re-fetches the list) and `VehicleDetailRoute` (re-fetches the current vehicle). PR 7'a doesn't subscribe — v2 routes ship fetch-on-mount only; live re-fetch lands in 7'b. |

## Findings

- **Single channel only** — the entire 9,118-line `/fleet` UI uses exactly one `useLiveSync` call, on the channel `'fleet'`, in the top-level `FleetPage`. None of the 14 tab files (`FleetOverviewTab`, `FleetFuelTab`, `FleetInspectionsTab`, etc.) calls `useLiveSync` directly — they all live inside `FleetPage` and inherit the parent's refresh.
- **Channel name is RESOURCE-based** (`'fleet'`), not component-instance-based. Stable — v2 can subscribe to the same string with zero server-side change.
- **Payload is opaque** — the v1 handler ignores the broadcast body and just re-fetches. v2 can do the same in 7'b without needing to know what's in the payload.
- **No risk of stale component IDs** — the spec §6.4 mitigation ("refactor to stable resource IDs if broadcasts target component instances") is not needed: the channel is already resource-named.

## v2 plan

- **PR 7'a (this PR)**: NO `useLiveSync` calls in `client/src/pages/fleet/v2/`. Every route is fetch-on-mount only. This is intentional — the v2 routes are parallel-mounted alongside `/fleet` during the soak; we don't want both UIs simultaneously reacting to the same broadcast (could cause confused user experiences if both are open in different tabs).
- **PR 7'b**: `VehiclesListRoute` and `VehicleDetailRoute` subscribe to `'fleet'`. The channel-parity test (spec §6.4) asserts:
  1. Both v1 (`FleetPage`) and v2 (`VehiclesListRoute`) subscribe to the same channel string.
  2. A simulated broadcast triggers the same re-fetch behavior in both.
- **PR 7'c**: At cutover, only v2 subscribes. v1 deletion removes its `useLiveSync('fleet', ...)` call.

## References

- Server-side broadcast: `src/routes/ws.ts` (search for `'fleet'` channel emits in any fleet-route mutation handler).
- Hook implementation: `client/src/hooks/useLiveSync.ts` (single hook used by 30+ subscribers across the app — well-trodden pattern).
