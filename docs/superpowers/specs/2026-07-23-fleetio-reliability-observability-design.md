# Fleet.io Integration — Reliability & Observability Hardening — Design

**Date:** 2026-07-23
**Scope:** First sub-project of a broader "advanced Fleet.io hardening" program. Follow-ons (inbound webhook hardening; deferred-coverage build-out — parts inventory, vendor lifecycle UI, custom fields engine) are separate specs, done after this one.

## Background

[fix(fleetio): correct outbound payload field mapping + admin UX](https://github.com/rmpgutah/rmpg-flex/pull/2970) fixed a confirmed live bug: `dispatchOutbound` (`src/utils/fleetio/sync.ts`) was sending raw RMPG DB rows to Fleet.io's API for vehicle and fuel_entry resources instead of translating field names to Fleet.io's schema, causing every such update to 422. That PR also added a manual retry path and made the admin health tab readable.

This spec covers the next layer: closing the same class of risk for the two resources that weren't part of the live incident (vendor, part), and making a stuck/failing sync queue impossible to miss — right now an operator has to remember to open `/admin?tab=fleetio_health` to discover a problem.

## Part 1 — Vendor/part payload mappers

`dispatchOutbound`'s vendor and part create/update branches still send `filteredPayload` (the ownership-filtered but otherwise raw DB row) straight to `createVendor`/`updateVendor`/`createPart`/`updatePart`. This happens to work today only because `VENDOR_OWNERSHIP`/`PART_OWNERSHIP` (`src/utils/fleetio/ownership.ts`) were hand-written with field names that already match Fleet.io's (`name`, `address`, `city`, `state`, `zip`, `phone`, `email` for vendor; `name`, `part_number`, `category`, `description`, `unit_cost`, `supplier` for part) — an unenforced coincidence, not a mapping. A future RMPG-only column added to `ref_vendors` or `fleet_parts` (the same way `fleet_vehicles` accumulated ~80 RMPG-only columns) would silently leak into an outbound payload again with no test to catch it.

Add to `src/utils/fleetio/seed.ts`, same shape as the existing `mapVehicleFieldsToFleetio`/`mapFuelEntryFieldsToFleetio`:

```ts
export function mapVendorFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'address', 'city', 'state', 'zip', 'phone', 'email'] as const) {
    if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') out[k] = payload[k];
  }
  return out;
}

export function mapPartFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'part_number', 'category', 'description', 'unit_cost', 'supplier'] as const) {
    if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') out[k] = payload[k];
  }
  return out;
}
```

Wire into `dispatchOutbound`'s four branches (`vendor`/create, `vendor`/update, `part`/create, `part`/update) the same way the vehicle/fuel branches were wired in PR 2970 — replace the raw `filteredPayload` argument with the mapped one. `work_order` is explicitly left alone: its payload already goes through `translateOutboundFks` for FK translation and its field names (`vehicle_id`, `vendor_id`, `summary`, `status`, `number`, `opened_at`, `closed_at`, `est_cost`, `actual_cost`, `vmrs_*_code`) are a closer match to Fleet.io's work_orders resource; no live failure evidence exists for it and adding a mapper without a schema reference to verify against risks introducing a new bug rather than fixing one. Flag as a follow-up if a live 422 ever surfaces for work_order.

Unit tests mirror the existing `fleetioSeed.test.ts` vehicle/fuel cases: one "translates known fields" case and one "drops RMPG-internal fields" case per mapper (e.g. `ref_vendors.kind`/`lat`/`lng`/`notes`/`active` dropped from vendor; `fleet_parts.quantity_on_hand`/`reorder_point`/`location`/`compatible_vehicles` dropped from part).

## Part 2 — Dead-letter and stuck-queue alerts

Two new trigger events fed into the existing rule engine (`src/routes/notificationEngine.ts` / `notification_rules` table, migration 0070 — the same mechanism the Admin → Alert Rules tab already manages for every other subsystem):

### `fleetio_event_dead_lettered`

Fired once, at the moment an outbound event exhausts all `maxAttempts()` (7) retries and is marked `status='failed'` — the existing branch in `applyOutbound` (`src/utils/fleetio/sync.ts`, the `if (row.attempts + 1 >= maxAttempts()) result.failed++;` line). `applyOutbound` is pure/deps-injected today (no `c: Context` access) — add an optional `onDeadLetter?: (row: FleetioEventRow, error: string) => void` callback to `ApplyOutboundDeps` so the pure function stays testable without a live D1/notification engine, and the Worker call site (`src/index.ts`'s `*/30` cron handler) supplies the real callback:

```ts
onDeadLetter: (row, error) => {
  evaluateNotificationRules(env.DB, 'fleetio_event_dead_lettered', {
    title: 'Fleet.io sync: event permanently failed',
    message: `${row.resource}/${row.action} (event ${row.event_id}) failed after ${maxAttempts()} attempts: ${error}`,
    entity_type: 'fleetio_event',
    entity_id: row.id,
  }, env).catch(() => {});
}
```

### `fleetio_queue_unhealthy`

Evaluated once per `*/30` cron tick, after `applyOutbound` returns, directly in the `src/index.ts` cron handler (same block that already runs the Fleet.io sync). Unhealthy = `failed_total >= 5` OR the oldest `pending` outbound event's `created_at` is more than 2 hours old (reuses the same queries `/fleetio/health` already runs — factor the two COUNT/oldest-pending queries into a small shared helper in `sync.ts`, e.g. `getQueueHealth(db)`, called from both the route and the cron handler so the "unhealthy" definition can't drift between the dashboard and the alert).

Deduped so it doesn't refire every 30 minutes: `fleetio_sync_state` (`0133_fleetio_sync_tables.sql`) is a generic key/value table (`key TEXT PRIMARY KEY, value TEXT, updated_at TEXT`), currently unused — no migration needed. Read/write a `key='last_unhealthy_alert_at'` row (`INSERT ... ON CONFLICT(key) DO UPDATE`) and only fire the trigger if that row is absent or its `value` (an ISO timestamp) is more than 2 hours old. On a tick where the queue is healthy, delete the row (or leave it — either way, the next unhealthy period after a healthy gap gets its own fresh alert rather than a global cooldown that could suppress a second, unrelated incident the same day).

### Seed migration

A migration inserts two default `notification_rules` rows (`is_active=1`, `target_roles='["admin"]'`, empty `conditions` so they always match their trigger event, `notification_type` matching whatever the existing rules use for a system/warning-level notice — check an existing row for the convention rather than inventing a new type). This is a new pattern (no other trigger_event in the codebase is pre-seeded — they're all admin-authored via the UI), but justified here because the whole point is "works without operator setup"; the seeded rows are just normal editable/disable-able rows from the Alert Rules tab afterward, not special-cased in code.

## Part 3 — Admin tab badge

`AdminPage.tsx`'s tab config array (`{ id: 'fleetio_health', label: 'Fleet.io Health', icon: Activity }`, line ~764) gets a small warning-icon badge when unhealthy. `AdminPage.tsx` already fetches per-tab badge counts for at least one other tab (check the existing pattern before adding a new one — likely a small `useEffect` fetching a handful of lightweight status endpoints on mount/interval). Add a call to `GET /api/fleetio/sync-status` (already exists, admin-only, cheap — 4 COUNT queries) on the same interval, and render a small dot/count next to the tab label when `failed_total >= 5` or `outbound_pending > 0` with a stale oldest-pending (same "unhealthy" definition as Part 2, via the shared `getQueueHealth` semantics — the route can expose it or the badge can apply the same threshold client-side against `sync-status`'s existing fields).

## Testing

- `mapVendorFieldsToFleetio`/`mapPartFieldsToFleetio`: unit tests in `tests/fleetioSeed.test.ts`, same shape as existing vehicle/fuel cases.
- `dispatchOutbound` vendor/part branches: extend `tests/fleetioSync.test.ts`'s existing mock-adapter harness with two new cases asserting the mapped (not raw) payload reaches the adapter.
- `onDeadLetter` callback: a new `applyOutbound` test asserting the callback fires exactly once per event that crosses into `failed`, and not on `pending`/`completed` transitions.
- `getQueueHealth`: pure unit test against the mock D1 harness — healthy/unhealthy boundary cases (exactly 5 failed, oldest pending at exactly 2h).
- Seed migration (the two `notification_rules` rows): verify locally via `npm run migrate:local` + `SELECT * FROM notification_rules WHERE trigger_event LIKE 'fleetio_%'`; apply to live D1 directly post-merge per `scripts/apply-migration.sh`, per CLAUDE.md's migration-drift caveat.
- No new Worker-level (Miniflare) tests required — the cron handler wiring is a thin composition of already-tested pure functions; a full cron-trigger integration test isn't proportionate to this scope.

## Out of scope (confirmed already solid — no changes)

- 429/5xx retry-and-backoff (`client.ts` fleetioFetch, `sync.ts`'s rate-limit-aborts-the-drain handling) — already correct, respects `Retry-After`, and the existing rate-limit path is covered by `tests/fleetioSync.test.ts`'s "rate-limit error stops the drain early" case.
- Inbound webhook hardening — separate follow-on spec (higher-risk unknown since no inbound event has ever been received live, deserves its own design pass).
- Parts inventory, vendor lifecycle UI, custom fields engine, VMRS picker — Phase 2 deferred items from the original integration spec; separate follow-on specs when prioritized.
