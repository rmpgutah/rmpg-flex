# Fleet.io Reliability & Observability Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the same silent-payload-passthrough risk PR #2970 fixed for vehicle/fuel_entry in vendor/part outbound sync, and make a stuck or failing Fleet.io sync queue impossible to miss — via existing in-app notification rules and an admin-tab badge — instead of requiring an operator to remember to open the health dashboard.

**Architecture:** Two independent, additive changes to the existing Fleet.io sync engine (`src/utils/fleetio/`): (1) explicit RMPG→Fleet.io field mappers for vendor/part, mirroring the vehicle/fuel_entry mappers already in `seed.ts`; (2) a new `healthSweep.ts` module, following the codebase's established "sweep file + `evaluateNotificationRules`" pattern (`certExpirationSweep.ts`, `fleetMaintenanceSweep.ts`), invoked from the existing `*/30` cron tick alongside `applyOutbound`. A small admin-facing badge surfaces the same "unhealthy" signal without opening the tab.

**Tech Stack:** Cloudflare Workers (Hono), D1, React 18 + TypeScript (Vite), Vitest.

## Global Constraints

- All D1 access is async — every `.prepare().bind().first/all/run()` call must be `await`ed.
- Migrations must be idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT ... WHERE NOT EXISTS`). D1 does **not** support `IF NOT EXISTS` on `ADD COLUMN` — a bare `ALTER TABLE ADD COLUMN` fails on re-apply forever and, per `migrations/README.md`, **wrangler aborts a migration file at the first failing statement and never records it, blocking every migration numbered after it**. Any `ALTER TABLE ADD COLUMN` MUST be the only statement in its own file, separate from any idempotent seed/DDL that needs to keep applying cleanly.
- After merging, apply new migrations directly to live D1 (`785de7ae-3e7a-4e01-93bb-d24ddd813f6b`) via `scripts/apply-migration.sh <file>` — the deploy step is `continue-on-error: true` and cannot be trusted alone. Verify via `pragma_table_info`/`SELECT`.
- No hardcoded hex colors in client code — use the existing `rmpg-*`/`brand-*`/`surface-*` Tailwind tokens.
- Never use `new Date()`/`Date.now()` in module scope of a testable pure function — accept an optional `now?: () => Date` (or a plain `nowMs: number` parameter) so tests stay deterministic. This repo's `sync.ts` already follows this convention (`now(deps)` in `applyOutbound`/`applyInbound`).
- Every new pure/testable unit gets a Vitest test in the same PR. Sweep-orchestration files that call `evaluateNotificationRules` directly (I/O, not pure) are NOT unit-tested — this matches the existing precedent (`certExpirationSweep.ts`, `fleetMaintenanceSweep.ts`, `retentionReminderSweep.ts`, `serveStaleAutoCloseSweep.ts` have no test files); only the pure logic they call out to is tested.

---

### Task 1: Vendor/Part Fleet.io payload mappers

**Files:**
- Modify: `src/utils/fleetio/seed.ts` (append after `mapFuelEntryFieldsToFleetio`, currently ending at line 93)
- Test: `tests/fleetioSeed.test.ts` (append after the existing `mapFuelEntryFieldsToFleetio` describe block)

**Interfaces:**
- Produces: `mapVendorFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown>`, `mapPartFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown>` — both pure, exported from `src/utils/fleetio/seed.ts`. Task 2 imports and calls both.

- [ ] **Step 1: Write the failing tests**

Append to `tests/fleetioSeed.test.ts`:

```ts
describe('mapVendorFieldsToFleetio', () => {
  it('keeps the fields Fleet.io\'s vendors resource accepts', () => {
    expect(mapVendorFieldsToFleetio({
      name: 'AutoZone', address: '123 Main St', city: 'Salt Lake City',
      state: 'UT', zip: '84115', phone: '801-555-0100', email: 'ap@autozone.example',
    })).toEqual({
      name: 'AutoZone', address: '123 Main St', city: 'Salt Lake City',
      state: 'UT', zip: '84115', phone: '801-555-0100', email: 'ap@autozone.example',
    });
  });

  it('drops RMPG-internal ref_vendors columns with no Fleet.io equivalent', () => {
    const mapped = mapVendorFieldsToFleetio({
      id: 2, name: 'AutoZone', kind: 'parts_supplier', lat: 40.7, lng: -111.9,
      notes: 'internal note', active: 1, created_at: 'x', updated_at: 'y',
    });
    expect(mapped).toEqual({ name: 'AutoZone' });
  });

  it('omits empty-string and null/undefined fields', () => {
    const mapped = mapVendorFieldsToFleetio({ name: 'AutoZone', phone: '', email: null, zip: undefined });
    expect(mapped).toEqual({ name: 'AutoZone' });
  });
});

describe('mapPartFieldsToFleetio', () => {
  it('keeps the fields Fleet.io\'s parts resource accepts', () => {
    expect(mapPartFieldsToFleetio({
      name: 'Oil Filter', part_number: 'PF-46', category: 'Filters',
      description: 'Standard oil filter', unit_cost: 8.5, supplier: 'AutoZone',
    })).toEqual({
      name: 'Oil Filter', part_number: 'PF-46', category: 'Filters',
      description: 'Standard oil filter', unit_cost: 8.5, supplier: 'AutoZone',
    });
  });

  it('drops RMPG-internal fleet_parts columns with no Fleet.io equivalent', () => {
    const mapped = mapPartFieldsToFleetio({
      id: 5, name: 'Oil Filter', quantity_on_hand: 12, reorder_point: 3,
      location: 'Shelf A2', compatible_vehicles: '[1,2,3]',
    });
    expect(mapped).toEqual({ name: 'Oil Filter' });
  });

  it('omits empty-string and null/undefined fields', () => {
    const mapped = mapPartFieldsToFleetio({ name: 'Oil Filter', supplier: '', unit_cost: null });
    expect(mapped).toEqual({ name: 'Oil Filter' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/fleetioSeed.test.ts`
Expected: FAIL — `mapVendorFieldsToFleetio`/`mapPartFieldsToFleetio` are not exported from `../src/utils/fleetio/seed`.

Update the test file's import line to include them:

```ts
import { buildVehiclePayload, mapVehicleFieldsToFleetio, mapFuelEntryFieldsToFleetio, mapVendorFieldsToFleetio, mapPartFieldsToFleetio } from '../src/utils/fleetio/seed';
```

- [ ] **Step 3: Implement the mappers**

Append to `src/utils/fleetio/seed.ts` (after the existing `mapFuelEntryFieldsToFleetio` function, end of file):

```ts

// Vendor/part update payloads still flow through dispatchOutbound's implicit
// ownership-filter pass-through (VENDOR_OWNERSHIP/PART_OWNERSHIP in
// ownership.ts). That happens to work today only because those maps were
// hand-written with field names that already match Fleet.io's vendors/parts
// resources — an unenforced coincidence, not a mapping. These explicit
// allowlists close the same class of risk the vehicle/fuel_entry mappers
// above closed: a future RMPG-only column added to ref_vendors/fleet_parts
// can no longer silently leak into an outbound payload.
export function mapVendorFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'address', 'city', 'state', 'zip', 'phone', 'email'] as const) {
    if (isNonEmptyString(payload[k])) out[k] = payload[k];
  }
  return out;
}

export function mapPartFieldsToFleetio(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['name', 'part_number', 'category', 'description', 'supplier'] as const) {
    if (isNonEmptyString(payload[k])) out[k] = payload[k];
  }
  if (typeof payload.unit_cost === 'number') out.unit_cost = payload.unit_cost;
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fleetioSeed.test.ts`
Expected: PASS — all cases including the pre-existing `buildVehiclePayload`/`mapVehicleFieldsToFleetio`/`mapFuelEntryFieldsToFleetio` ones.

- [ ] **Step 5: Commit**

```bash
git add src/utils/fleetio/seed.ts tests/fleetioSeed.test.ts
git commit -m "feat(fleetio): add vendor/part Fleet.io payload mappers"
```

---

### Task 2: Wire mappers into dispatchOutbound + queue-health pure helpers

**Files:**
- Modify: `src/utils/fleetio/sync.ts` (vendor/part branches, currently lines 305–340; add new exports near the end of the file, after `lookupFleetioId`, currently ending around line 379)
- Test: `tests/fleetioSync.test.ts`

**Interfaces:**
- Consumes: `mapVendorFieldsToFleetio`, `mapPartFieldsToFleetio` from Task 1 (`src/utils/fleetio/seed.ts`).
- Produces: `getQueueHealth(db: D1Database): Promise<FleetioQueueHealth>`, `interface FleetioQueueHealth { failedTotal: number; oldestPendingCreatedAt: string | null }`, `isFleetioQueueUnhealthy(health: FleetioQueueHealth, nowMs: number): boolean`, `shouldFireUnhealthyAlert(lastAlertedIso: string | null, nowMs: number): boolean` — all exported from `src/utils/fleetio/sync.ts`. Task 4 imports all four.

- [ ] **Step 1: Write the failing dispatch tests**

Append to `tests/fleetioSync.test.ts`, inside the existing `describe('applyOutbound', ...)` block (after the last existing `it(...)` inside that block, before its closing `});` — find the `fuel_entry/create — translates vehicle_id...` test block and add these two right after it):

```ts
  it('vendor/update — sends only Fleet.io-mapped fields, not the raw RMPG row', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 50, event_id: 'evt-vendor-upd', resource: 'vendor', resource_id: 2, action: 'update',
        payload_json: JSON.stringify({ id: 2, name: 'AutoZone', kind: 'parts_supplier', lat: 40.7, active: 1 }) })],
      links: [{ rmpg_table: 'ref_vendors', rmpg_id: 2, fleetio_id: 8001 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    let sentPayload: Record<string, unknown> | null = null;
    const adapter = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); }, async createFuelEntry() { throw new Error('nu'); },
      async createWorkOrder() { throw new Error('nu'); },
      async updateVendor(args: { fleetioId: number; payload: Record<string, unknown> }) {
        sentPayload = args.payload;
        return { id: args.fleetioId } as never;
      },
    };
    const result = await applyOutbound({ db: makeDb(state).db, adapter: adapter as never, config: stubConfig });
    expect(result.completed).toBe(1);
    expect(sentPayload).toEqual({ name: 'AutoZone' });
  });

  it('part/create — sends only Fleet.io-mapped fields, not the raw RMPG row', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 51, event_id: 'evt-part-create', resource: 'part', resource_id: 5, action: 'create',
        payload_json: JSON.stringify({ id: 5, name: 'Oil Filter', quantity_on_hand: 12, reorder_point: 3, unit_cost: 8.5 }) })],
      links: [], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    let sentPayload: Record<string, unknown> | null = null;
    const adapter = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); }, async createFuelEntry() { throw new Error('nu'); },
      async createWorkOrder() { throw new Error('nu'); },
      async createPart(args: { payload: Record<string, unknown> }) {
        sentPayload = args.payload;
        return { id: 9001 } as never;
      },
    };
    const result = await applyOutbound({ db: makeDb(state).db, adapter: adapter as never, config: stubConfig });
    expect(result.completed).toBe(1);
    expect(sentPayload).toEqual({ name: 'Oil Filter', unit_cost: 8.5 });
  });
```

Append a new top-level describe block after the `applyOutbound` block closes (find its closing `});` — the block right before `describe('applyInbound', ...)` or similar; add this new block there):

```ts
describe('getQueueHealth', () => {
  function makeHealthDb(failedCount: number, oldestPendingCreatedAt: string | null) {
    return {
      prepare(sql: string) {
        return {
          bind() { return this; },
          async first<T>(): Promise<T | null> {
            if (/COUNT\(\*\) AS n FROM fleetio_events WHERE direction='outbound' AND status='failed'/.test(sql)) {
              return { n: failedCount } as unknown as T;
            }
            if (/SELECT created_at FROM fleetio_events WHERE direction='outbound' AND status='pending'/.test(sql)) {
              return oldestPendingCreatedAt ? ({ created_at: oldestPendingCreatedAt } as unknown as T) : null;
            }
            return null;
          },
        };
      },
    } as unknown as Parameters<typeof getQueueHealth>[0];
  }

  it('returns failedTotal and oldestPendingCreatedAt from the two underlying queries', async () => {
    const db = makeHealthDb(3, '2026-07-23 10:00:00');
    expect(await getQueueHealth(db)).toEqual({ failedTotal: 3, oldestPendingCreatedAt: '2026-07-23 10:00:00' });
  });

  it('returns nulls/zeros when the queue is empty', async () => {
    const db = makeHealthDb(0, null);
    expect(await getQueueHealth(db)).toEqual({ failedTotal: 0, oldestPendingCreatedAt: null });
  });
});

describe('isFleetioQueueUnhealthy', () => {
  const NOW = Date.parse('2026-07-23T12:00:00Z');

  it('is healthy with no failures and no pending events', () => {
    expect(isFleetioQueueUnhealthy({ failedTotal: 0, oldestPendingCreatedAt: null }, NOW)).toBe(false);
  });

  it('is unhealthy at exactly 5 failed events (boundary)', () => {
    expect(isFleetioQueueUnhealthy({ failedTotal: 5, oldestPendingCreatedAt: null }, NOW)).toBe(true);
  });

  it('is healthy at 4 failed events', () => {
    expect(isFleetioQueueUnhealthy({ failedTotal: 4, oldestPendingCreatedAt: null }, NOW)).toBe(false);
  });

  it('is unhealthy when the oldest pending event is just over 2h old', () => {
    const oldest = new Date(NOW - (2 * 60 * 60 * 1000 + 1000)).toISOString();
    expect(isFleetioQueueUnhealthy({ failedTotal: 0, oldestPendingCreatedAt: oldest }, NOW)).toBe(true);
  });

  it('is healthy when the oldest pending event is exactly 2h old (boundary)', () => {
    const oldest = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    expect(isFleetioQueueUnhealthy({ failedTotal: 0, oldestPendingCreatedAt: oldest }, NOW)).toBe(false);
  });
});

describe('shouldFireUnhealthyAlert', () => {
  const NOW = Date.parse('2026-07-23T12:00:00Z');

  it('fires when there is no prior alert timestamp', () => {
    expect(shouldFireUnhealthyAlert(null, NOW)).toBe(true);
  });

  it('does not fire again within the 2h cooldown', () => {
    const lastAlert = new Date(NOW - 60 * 60 * 1000).toISOString();
    expect(shouldFireUnhealthyAlert(lastAlert, NOW)).toBe(false);
  });

  it('fires again once the cooldown has elapsed', () => {
    const lastAlert = new Date(NOW - (2 * 60 * 60 * 1000 + 1000)).toISOString();
    expect(shouldFireUnhealthyAlert(lastAlert, NOW)).toBe(true);
  });
});
```

Update the top-of-file import to include the new names:

```ts
import {
  applyOutbound,
  applyInbound,
  nextAttemptDelaySeconds,
  maxAttempts,
  BACKOFF_SECONDS,
  getQueueHealth,
  isFleetioQueueUnhealthy,
  shouldFireUnhealthyAlert,
} from '../src/utils/fleetio/sync';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/fleetioSync.test.ts`
Expected: FAIL — `getQueueHealth`/`isFleetioQueueUnhealthy`/`shouldFireUnhealthyAlert` not exported; the vendor/part dispatch tests fail because `sentPayload` still contains the raw RMPG fields (`kind`, `lat`, `active`, `quantity_on_hand`, `reorder_point`).

- [ ] **Step 3: Wire the mappers into dispatchOutbound**

In `src/utils/fleetio/sync.ts`, update the import line (currently `import { mapVehicleFieldsToFleetio, mapFuelEntryFieldsToFleetio } from './seed';`):

```ts
import { mapVehicleFieldsToFleetio, mapFuelEntryFieldsToFleetio, mapVendorFieldsToFleetio, mapPartFieldsToFleetio } from './seed';
```

Replace the vendor/part branches (currently lines 305–340):

```ts
  if (row.resource === 'vendor' && row.action === 'create') {
    const existing = await lookupFleetioId(deps.db, 'ref_vendors', row.resource_id);
    if (existing) return null;
    const created = await deps.adapter.createVendor({ payload: mapVendorFieldsToFleetio(filteredPayload) });
    await recordLink(deps.db, 'ref_vendors', row.resource_id, 'vendor', created.id, now(deps));
    return created;
  }
  if (row.resource === 'vendor' && row.action === 'update') {
    const fleetioId = await lookupFleetioId(deps.db, 'ref_vendors', row.resource_id);
    if (!fleetioId) return null; // never pushed — first push happens on next create-shaped emit
    return deps.adapter.updateVendor({ fleetioId, payload: mapVendorFieldsToFleetio(filteredPayload) });
  }
  if (row.resource === 'vendor' && row.action === 'delete') {
    const fleetioId = await lookupFleetioId(deps.db, 'ref_vendors', row.resource_id);
    if (!fleetioId) return null;
    return deps.adapter.archiveVendor({ fleetioId });
  }
  if (row.resource === 'part' && row.action === 'create') {
    const existing = await lookupFleetioId(deps.db, 'fleet_parts', row.resource_id);
    if (existing) return null;
    const created = await deps.adapter.createPart({ payload: mapPartFieldsToFleetio(filteredPayload) });
    await recordLink(deps.db, 'fleet_parts', row.resource_id, 'part', created.id, now(deps));
    return created;
  }
  if (row.resource === 'part' && row.action === 'update') {
    const fleetioId = await lookupFleetioId(deps.db, 'fleet_parts', row.resource_id);
    if (!fleetioId) return null;
    return deps.adapter.updatePart({ fleetioId, payload: mapPartFieldsToFleetio(filteredPayload) });
  }
  if (row.resource === 'part' && row.action === 'delete') {
    // Fleet.io parts support a hard DELETE (unlike vehicles/vendors). Only
    // meaningful if the row was ever linked; otherwise it was local-only.
    const fleetioId = await lookupFleetioId(deps.db, 'fleet_parts', row.resource_id);
    if (!fleetioId) return null;
    return deps.adapter.deletePart({ fleetioId });
  }
```

- [ ] **Step 4: Add the queue-health helpers**

In `src/utils/fleetio/sync.ts`, add after `lookupFleetioId` (find the function ending `return row ? row.fleetio_id : null; }` — add the new exports right after its closing brace, before the `// ─── applyInbound ─────────────────────────────────────────` section comment):

```ts
// ─── Queue health (Fleet.io reliability & observability hardening) ────

export interface FleetioQueueHealth {
  failedTotal: number;
  oldestPendingCreatedAt: string | null;
}

/** Two cheap COUNT/single-row queries — the same "unhealthy" signal both
 *  the /fleetio/sync-status route and the healthSweep cron consumer read,
 *  so the definition of "unhealthy" can't drift between the two. */
export async function getQueueHealth(db: D1Database): Promise<FleetioQueueHealth> {
  const [failedRow, oldestPendingRow] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS n FROM fleetio_events WHERE direction='outbound' AND status='failed'`,
    ).first<{ n: number }>(),
    db.prepare(
      `SELECT created_at FROM fleetio_events WHERE direction='outbound' AND status='pending' ORDER BY id ASC LIMIT 1`,
    ).first<{ created_at: string }>(),
  ]);
  return {
    failedTotal: failedRow?.n ?? 0,
    oldestPendingCreatedAt: oldestPendingRow?.created_at ?? null,
  };
}

const UNHEALTHY_FAILED_THRESHOLD = 5;
const UNHEALTHY_PENDING_AGE_MS = 2 * 60 * 60 * 1000;
const UNHEALTHY_ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/** Pure — no I/O, no clock reads. `nowMs` is the caller's `Date.now()`
 *  (or a fixed value in tests) so this stays deterministic. */
export function isFleetioQueueUnhealthy(health: FleetioQueueHealth, nowMs: number): boolean {
  if (health.failedTotal >= UNHEALTHY_FAILED_THRESHOLD) return true;
  if (health.oldestPendingCreatedAt) {
    const raw = health.oldestPendingCreatedAt;
    const parsed = Date.parse(raw.includes('T') ? raw : `${raw}Z`);
    if (Number.isFinite(parsed) && nowMs - parsed > UNHEALTHY_PENDING_AGE_MS) return true;
  }
  return false;
}

/** Pure — dedupes the queue-unhealthy alert so it doesn't refire every
 *  */30 cron tick; `lastAlertedIso` comes from fleetio_sync_state. */
export function shouldFireUnhealthyAlert(lastAlertedIso: string | null, nowMs: number): boolean {
  if (!lastAlertedIso) return true;
  const parsed = Date.parse(lastAlertedIso.includes('T') ? lastAlertedIso : `${lastAlertedIso}Z`);
  return !Number.isFinite(parsed) || nowMs - parsed > UNHEALTHY_ALERT_COOLDOWN_MS;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/fleetioSync.test.ts`
Expected: PASS — all cases, including the full pre-existing suite.

- [ ] **Step 6: Run the full Fleet.io test suite and typecheck**

Run: `npx vitest run tests/fleetio*.test.ts && npm run typecheck`
Expected: All PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/fleetio/sync.ts tests/fleetioSync.test.ts
git commit -m "feat(fleetio): map vendor/part payloads to Fleet.io schema; add queue-health helpers"
```

---

### Task 3: Migrations — dead-letter tracking column + seeded alert rules

**Files:**
- Create: `migrations/0202_fleetio_events_dead_letter_column.sql`
- Create: `migrations/0203_fleetio_health_alert_rules.sql`

**Interfaces:**
- Produces: `fleetio_events.dead_letter_notified_at` column (nullable TEXT) — Task 4 reads/writes it. Two `notification_rules` rows with `trigger_event` values `fleetio_event_dead_lettered` and `fleetio_queue_unhealthy` — Task 4's `evaluateNotificationRules` calls match against these.

- [ ] **Step 1: Create the column migration (its own file — see Global Constraints on ALTER isolation)**

`migrations/0202_fleetio_events_dead_letter_column.sql`:

```sql
-- Tracks whether an outbound event that reached status='failed' (exhausted
-- all maxAttempts() retries) has already fired the fleetio_event_dead_lettered
-- notification, so healthSweep.ts's cron consumer notifies exactly once per
-- dead-lettered event instead of re-firing every */30 tick. NULL = not yet
-- notified. A bare ADD COLUMN is not idempotent on D1 — this file contains
-- ONLY this one statement so a re-apply failure here can never block
-- migrations numbered after it (see migrations/README.md).
ALTER TABLE fleetio_events ADD COLUMN dead_letter_notified_at TEXT;
```

- [ ] **Step 2: Create the seed migration**

`migrations/0203_fleetio_health_alert_rules.sql`:

```sql
-- Default notification rules for the Fleet.io reliability hardening pass
-- (Reliability & Observability Hardening spec, 2026-07-23). Seeded here
-- (unlike every other trigger_event in this codebase, which is entirely
-- admin-authored via the Alert Rules tab) so the alerts work without
-- manual setup — an admin can edit or disable either row afterward from
-- Admin -> Alert Rules like any other rule. Idempotent via WHERE NOT
-- EXISTS since notification_rules has no unique index on trigger_event.
INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Fleet.io event dead-lettered', 'An outbound Fleet.io sync event exhausted all retry attempts and needs manual attention or a retry.', 'fleetio_event_dead_lettered', '{}', '["admin"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'fleetio_event_dead_lettered');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Fleet.io sync queue unhealthy', 'The Fleet.io outbound sync queue has 5+ failed events or a pending event stuck for over 2 hours.', 'fleetio_queue_unhealthy', '{}', '["admin"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'fleetio_queue_unhealthy');
```

- [ ] **Step 3: Apply both migrations locally**

Run: `npm run migrate:local`
Expected: Both files apply cleanly with no errors.

- [ ] **Step 4: Verify locally**

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('fleetio_events') WHERE name='dead_letter_notified_at'"`
Expected: One row: `dead_letter_notified_at`.

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT trigger_event, is_active, target_roles FROM notification_rules WHERE trigger_event LIKE 'fleetio_%'"`
Expected: Two rows — `fleetio_event_dead_lettered` and `fleetio_queue_unhealthy`, both `is_active=1`, `target_roles='["admin"]'`.

- [ ] **Step 5: Commit**

```bash
git add migrations/0202_fleetio_events_dead_letter_column.sql migrations/0203_fleetio_health_alert_rules.sql
git commit -m "feat(fleetio): add dead-letter tracking column + seeded health alert rules"
```

---

### Task 4: healthSweep.ts — dead-letter and stuck-queue notifications

**Files:**
- Create: `src/utils/fleetio/healthSweep.ts`

**Interfaces:**
- Consumes: `getQueueHealth`, `isFleetioQueueUnhealthy`, `shouldFireUnhealthyAlert` (Task 2, `src/utils/fleetio/sync.ts`); `evaluateNotificationRules` (`src/routes/notificationEngine.ts`, signature `(db: D1Database, triggerEvent: string, context: NotifyContext, env?: { ALERT_HUB?: DurableObjectNamespace }) => Promise<{ rulesMatched: number; notified: number }>`); `query`, `queryFirst`, `execute` (`src/utils/db.ts`); `dead_letter_notified_at` column and the two seeded `notification_rules` rows (Task 3).
- Produces: `sweepFleetioHealth(db: D1Database, env?: { ALERT_HUB?: DurableObjectNamespace }, now?: () => Date): Promise<{ deadLetterNotified: number; queueUnhealthy: boolean; queueAlertFired: boolean; failedTotal: number }>` — Task 5 imports and calls this from the cron handler.

Per Global Constraints, this file is I/O (calls `evaluateNotificationRules` directly, not injected) and follows the existing `certExpirationSweep.ts`/`fleetMaintenanceSweep.ts` precedent of no dedicated test file — its two building blocks (`getQueueHealth`, `isFleetioQueueUnhealthy`, `shouldFireUnhealthyAlert`) are already fully unit-tested in Task 2.

- [ ] **Step 1: Write the module**

`src/utils/fleetio/healthSweep.ts`:

```ts
// ============================================================
// Fleet.io Health Sweep
// ============================================================
// Runs once per */30 cron tick (src/index.ts), alongside applyOutbound.
// Same "proactively notify instead of dashboard-nobody-checks" pattern as
// certExpirationSweep.ts / fleetMaintenanceSweep.ts — see
// docs/superpowers/specs/2026-07-23-fleetio-reliability-observability-design.md.
//
// Two independent jobs:
//   1. Dead-letter notify: any outbound event with status='failed' (all
//      maxAttempts() retries exhausted) that hasn't yet fired its
//      one-time fleetio_event_dead_lettered notification (tracked via
//      the dead_letter_notified_at column, migration 0202) gets notified
//      exactly once, then marked so it's never re-notified.
//   2. Stuck-queue notify: if the queue is unhealthy (see
//      isFleetioQueueUnhealthy in sync.ts) and the last queue-unhealthy
//      alert was more than 2h ago (or never fired), fires
//      fleetio_queue_unhealthy once and records the new alert timestamp
//      in fleetio_sync_state (a generic key/value table, migration 0133).
// Both route through evaluateNotificationRules — the two seeded default
// rules live in migrations/0203_fleetio_health_alert_rules.sql.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from '../db';
import { evaluateNotificationRules } from '../../routes/notificationEngine';
import { getQueueHealth, isFleetioQueueUnhealthy, shouldFireUnhealthyAlert } from './sync';

interface DeadLetterCandidate {
  id: number;
  event_id: string;
  resource: string;
  action: string;
  error: string | null;
}

const UNHEALTHY_ALERT_STATE_KEY = 'fleetio_unhealthy_alert_at';
const DEAD_LETTER_SWEEP_LIMIT = 50;

export interface FleetioHealthSweepResult {
  deadLetterNotified: number;
  queueUnhealthy: boolean;
  queueAlertFired: boolean;
  failedTotal: number;
}

export async function sweepFleetioHealth(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
  now?: () => Date,
): Promise<FleetioHealthSweepResult> {
  const nowDate = now ? now() : new Date();
  const nowMs = nowDate.getTime();

  // ── 1. Dead-letter notify (once per event) ──
  const candidates = await query<DeadLetterCandidate>(
    db,
    `SELECT id, event_id, resource, action, error
     FROM fleetio_events
     WHERE direction = 'outbound' AND status = 'failed' AND dead_letter_notified_at IS NULL
     ORDER BY id ASC
     LIMIT ?`,
    DEAD_LETTER_SWEEP_LIMIT,
  );
  let deadLetterNotified = 0;
  for (const ev of candidates) {
    await evaluateNotificationRules(db, 'fleetio_event_dead_lettered', {
      title: 'Fleet.io sync: event permanently failed',
      message: `${ev.resource}/${ev.action} (event ${ev.event_id}) failed after exhausting all retry attempts: ${ev.error ?? '(no error message)'}`,
      priority: 'high',
      entity_type: 'fleetio_event',
      entity_id: ev.id,
    }, env);
    await execute(db, `UPDATE fleetio_events SET dead_letter_notified_at = datetime('now') WHERE id = ?`, ev.id);
    deadLetterNotified++;
  }

  // ── 2. Stuck-queue notify (cooldown-gated) ──
  const health = await getQueueHealth(db);
  const queueUnhealthy = isFleetioQueueUnhealthy(health, nowMs);
  let queueAlertFired = false;
  if (queueUnhealthy) {
    const lastAlertRow = await queryFirst<{ value: string }>(
      db, `SELECT value FROM fleetio_sync_state WHERE key = ?`, UNHEALTHY_ALERT_STATE_KEY,
    );
    if (shouldFireUnhealthyAlert(lastAlertRow?.value ?? null, nowMs)) {
      await evaluateNotificationRules(db, 'fleetio_queue_unhealthy', {
        title: 'Fleet.io sync queue unhealthy',
        message: `${health.failedTotal} failed event(s)${health.oldestPendingCreatedAt ? `; oldest pending event queued since ${health.oldestPendingCreatedAt}` : ''}.`,
        priority: 'high',
        entity_type: 'fleetio_queue',
      }, env);
      await execute(
        db,
        `INSERT INTO fleetio_sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        UNHEALTHY_ALERT_STATE_KEY, nowDate.toISOString(),
      );
      queueAlertFired = true;
    }
  }

  return { deadLetterNotified, queueUnhealthy, queueAlertFired, failedTotal: health.failedTotal };
}
```

- [ ] **Step 2: Verify `fleetio_sync_state`'s primary key supports `ON CONFLICT(key)`**

Run: `npx wrangler d1 execute rmpg-flex --local --command "SELECT sql FROM sqlite_master WHERE name='fleetio_sync_state'"`
Expected: `key TEXT PRIMARY KEY` is present in the output (confirmed already in `migrations/0133_fleetio_sync_tables.sql`) — `ON CONFLICT(key)` is valid against a `PRIMARY KEY` column.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/utils/fleetio/healthSweep.ts
git commit -m "feat(fleetio): add health sweep for dead-letter and stuck-queue notifications"
```

---

### Task 5: Wire the sweep into the cron handler + expose queue age on /sync-status

**Files:**
- Modify: `src/index.ts` (the `*/30 * * * *` cron block, currently lines 315–375)
- Modify: `src/routes/fleetio.ts` (the `/sync-status` route, currently lines 340–354)
- Test: `test-workers/` — none added (this task only touches the cron handler wiring and a route, both already covered at the unit level by Tasks 2 and 4; the Worker itself has no Miniflare test suite for `src/index.ts`'s cron dispatch per CLAUDE.md).

**Interfaces:**
- Consumes: `sweepFleetioHealth` (Task 4, `src/utils/fleetio/healthSweep.ts`).
- Produces: `/api/fleetio/sync-status` response gains an `oldest_pending_created_at: string | null` field — Task 6's client badge reads this alongside the existing `failed_total`.

- [ ] **Step 1: Add the sweep call to the `*/30` cron block**

In `src/index.ts`, insert immediately after the existing Fleet.io outbound-reconciliation `ctx.waitUntil(...)` block closes (currently ending at line 374 with `);`, right before the block's own closing `}` at line 375):

```ts
      // Fleet.io health sweep — dead-letter + stuck-queue notifications.
      // Independent of the reconciliation waitUntil above: it reads
      // whatever fleetio_events state exists at sweep time, so it doesn't
      // need to wait for that pass to finish first.
      ctx.waitUntil(
        import('./utils/fleetio/healthSweep').then((m) =>
          m.sweepFleetioHealth(env.DB, env).then((r) => {
            if (r.deadLetterNotified > 0 || r.queueAlertFired) {
              console.log(`[fleetio-health-sweep] deadLetterNotified=${r.deadLetterNotified} queueUnhealthy=${r.queueUnhealthy} queueAlertFired=${r.queueAlertFired} failedTotal=${r.failedTotal}`);
            }
          }),
        ).catch((err) => console.error('[fleetio-health-sweep] failed:', err)),
      );
```

- [ ] **Step 2: Add `oldest_pending_created_at` to `/sync-status`**

In `src/routes/fleetio.ts`, replace the `/sync-status` handler (currently lines 340–354):

```ts
fleetio.get('/sync-status', requireRole('admin'), async (c) => {
  const db = getDb(c.env);
  const [links, eventsPending, eventsFailed, conflicts, oldestPending] = await Promise.all([
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM fleetio_links'),
    queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM fleetio_events WHERE direction='outbound' AND status='pending'"),
    queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM fleetio_events WHERE status='failed'"),
    queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM fleetio_conflicts WHERE resolved_at IS NULL'),
    queryFirst<{ created_at: string }>(db, "SELECT created_at FROM fleetio_events WHERE direction='outbound' AND status='pending' ORDER BY id ASC LIMIT 1"),
  ]);
  return c.json({
    links_total: links?.n ?? 0,
    outbound_pending: eventsPending?.n ?? 0,
    failed_total: eventsFailed?.n ?? 0,
    conflicts_unresolved: conflicts?.n ?? 0,
    oldest_pending_created_at: oldestPending?.created_at ?? null,
  });
});
```

(`failed_total` intentionally keeps its existing all-directions semantics, unchanged from before this task — only the new field is added, to avoid changing behavior of an endpoint other code may already depend on.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Manual smoke test locally**

Run: `npm run dev` (in one terminal), then in another:
```bash
curl -s -H "Authorization: Bearer <a local admin JWT>" http://localhost:8787/api/fleetio/sync-status
```
Expected: JSON response includes `oldest_pending_created_at` (null or an ISO-ish string), alongside the four pre-existing fields.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/routes/fleetio.ts
git commit -m "feat(fleetio): wire health sweep into cron; expose oldest-pending age on sync-status"
```

---

### Task 6: Admin UI badge

**Files:**
- Create: `client/src/utils/fleetioHealth.ts`
- Test: `client/src/utils/__tests__/fleetioHealth.test.ts`
- Modify: `client/src/pages/AdminPage.tsx`

**Interfaces:**
- Consumes: `GET /api/fleetio/sync-status` response shape `{ links_total, outbound_pending, failed_total, conflicts_unresolved, oldest_pending_created_at }` (Task 5).
- Produces: `isFleetioSyncStatusUnhealthy(status: { failed_total: number; oldest_pending_created_at: string | null }, nowMs: number): boolean`, exported from `client/src/utils/fleetioHealth.ts`.

- [ ] **Step 1: Write the failing pure-helper test**

`client/src/utils/__tests__/fleetioHealth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isFleetioSyncStatusUnhealthy } from '../fleetioHealth';

describe('isFleetioSyncStatusUnhealthy', () => {
  const NOW = Date.parse('2026-07-23T12:00:00Z');

  it('is healthy with no failures and no pending events', () => {
    expect(isFleetioSyncStatusUnhealthy({ failed_total: 0, oldest_pending_created_at: null }, NOW)).toBe(false);
  });

  it('is unhealthy at exactly 5 failed events (boundary)', () => {
    expect(isFleetioSyncStatusUnhealthy({ failed_total: 5, oldest_pending_created_at: null }, NOW)).toBe(true);
  });

  it('is healthy at 4 failed events', () => {
    expect(isFleetioSyncStatusUnhealthy({ failed_total: 4, oldest_pending_created_at: null }, NOW)).toBe(false);
  });

  it('is unhealthy when the oldest pending event is over 2h old', () => {
    const oldest = new Date(NOW - (2 * 60 * 60 * 1000 + 1000)).toISOString();
    expect(isFleetioSyncStatusUnhealthy({ failed_total: 0, oldest_pending_created_at: oldest }, NOW)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/fleetioHealth.test.ts`
Expected: FAIL — `../fleetioHealth` module doesn't exist.

- [ ] **Step 3: Implement the pure helper**

`client/src/utils/fleetioHealth.ts`:

```ts
// Mirrors the worker-side threshold in src/utils/fleetio/sync.ts's
// isFleetioQueueUnhealthy — kept as a small, independently-testable
// duplicate since client code can't import from src/ (Worker) code.
// Keep the two thresholds in sync if either changes.
export interface FleetioSyncStatus {
  failed_total: number;
  oldest_pending_created_at: string | null;
}

const UNHEALTHY_FAILED_THRESHOLD = 5;
const UNHEALTHY_PENDING_AGE_MS = 2 * 60 * 60 * 1000;

export function isFleetioSyncStatusUnhealthy(status: FleetioSyncStatus, nowMs: number): boolean {
  if (status.failed_total >= UNHEALTHY_FAILED_THRESHOLD) return true;
  if (status.oldest_pending_created_at) {
    const raw = status.oldest_pending_created_at;
    const parsed = Date.parse(raw.includes('T') ? raw : `${raw}Z`);
    if (Number.isFinite(parsed) && nowMs - parsed > UNHEALTHY_PENDING_AGE_MS) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/fleetioHealth.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the badge into AdminPage.tsx**

Add `AlertTriangle` to the existing lucide-react import block (currently lines 3–35 — add it to the alphabetized-by-usage list; exact position doesn't matter, e.g. right after `Activity,` on line 12):

```ts
  Activity,
  AlertTriangle,
```

Add the import for the new helper, near the other utility imports (after `import type { User, Client, UserRole } from '../types';`, currently line 47):

```ts
import { isFleetioSyncStatusUnhealthy, type FleetioSyncStatus } from '../utils/fleetioHealth';
```

Add state, right after `const [loadingUsers, setLoadingUsers] = useState(false);` (currently line 321):

```ts
  const [fleetioUnhealthy, setFleetioUnhealthy] = useState(false);
```

Add a polling effect, right after the `document.title` effect (currently `useEffect(() => { document.title = 'Administration — RMPG Flex'; }, []);` at line 790):

```ts
  // Fleet.io queue health — small badge on the tab label so a stuck sync
  // doesn't require an admin to remember to open the tab (see
  // docs/superpowers/specs/2026-07-23-fleetio-reliability-observability-design.md).
  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;
    const check = () => {
      apiFetch<FleetioSyncStatus>('/fleetio/sync-status')
        .then((status) => { if (!cancelled && status) setFleetioUnhealthy(isFleetioSyncStatusUnhealthy(status, Date.now())); })
        .catch(() => { /* best-effort — a failed check just leaves the badge as-is */ });
    };
    check();
    const t = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [user?.role]);
```

Update the tab-label render (currently line 998, inside the `group.tabs.map((tab) => { ... })` block):

```tsx
                      <Icon style={{ width: 13, height: 13 }} className={`transition-colors duration-150 shrink-0 ${isActive ? 'text-brand-400' : 'text-rmpg-600'}`} aria-hidden="true" />
                      <span className={`truncate${tab.id === 'dev' ? ' text-red-400' : ''}`}>{tab.label}</span>
                      {tab.id === 'fleetio_health' && fleetioUnhealthy && (
                        <AlertTriangle
                          style={{ width: 11, height: 11 }}
                          className="shrink-0 text-amber-400 ml-auto"
                          aria-label="Fleet.io sync queue needs attention"
                        />
                      )}
```

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Manual verification in the browser**

Start the dev server, log in as an admin, open `/admin`. Confirm:
- With a healthy queue (or Fleet.io secrets unset, so `/fleetio/sync-status` returns zeros), no badge appears next to "Fleet.io Health".
- Temporarily lower `UNHEALTHY_FAILED_THRESHOLD` to `0` in `client/src/utils/fleetioHealth.ts` (do not commit this), reload — the amber warning icon appears next to the "Fleet.io Health" tab label. Revert the threshold change before committing.

- [ ] **Step 8: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: All PASS, including the new `fleetioHealth.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add client/src/utils/fleetioHealth.ts client/src/utils/__tests__/fleetioHealth.test.ts client/src/pages/AdminPage.tsx
git commit -m "feat(fleetio): add stuck-queue badge to the admin Fleet.io Health tab"
```

---

### Task 7: Push, open PR, apply migrations to live D1

**Files:** none (operational task)

- [ ] **Step 1: Run the full pre-push gate locally**

Run: `npm run typecheck && cd client && npx tsc --noEmit && npx vitest run && cd ..`
Expected: All pass — this mirrors `.husky/pre-push` so `git push` doesn't surprise-fail on the hook.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin <branch-name>
gh pr create -R rmpgutah/rmpg-flex --title "feat(fleetio): reliability & observability hardening" --body "$(cat <<'EOF'
## Summary
- Vendor/part outbound sync now goes through explicit Fleet.io field mappers (closes the same silent-passthrough risk PR #2970 fixed for vehicle/fuel_entry).
- New `fleetio_event_dead_lettered` / `fleetio_queue_unhealthy` in-app notifications (via the existing notification_rules engine, two rules seeded by migration) fire when an event exhausts retries or the queue backs up — no more relying on someone remembering to check the dashboard.
- Admin tab badge on "Fleet.io Health" surfaces the same unhealthy signal at a glance.

## Test plan
- [x] `npm run typecheck`
- [x] `npx vitest run tests/fleetio*.test.ts`
- [x] `cd client && npx tsc --noEmit && npx vitest run`
- [ ] After merge: apply migrations 0202 + 0203 to live D1 (see below), then verify a seeded rule fires by manually flipping a failed event's `dead_letter_notified_at` to NULL and waiting for the next */30 cron tick (or triggering `sweepFleetioHealth` manually via `wrangler dev` against remote D1).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After merge — apply both migrations to live D1**

```bash
scripts/apply-migration.sh 0202_fleetio_events_dead_letter_column.sql
scripts/apply-migration.sh 0203_fleetio_health_alert_rules.sql
```

- [ ] **Step 4: Verify on live D1**

```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM pragma_table_info('fleetio_events') WHERE name='dead_letter_notified_at'"
npx wrangler d1 execute rmpg-flex --remote --command "SELECT trigger_event, is_active FROM notification_rules WHERE trigger_event LIKE 'fleetio_%'"
```

Expected: The column exists; both rules exist with `is_active=1`.

- [ ] **Step 5: Confirm the 6 already-dead-lettered events (from PR #2970) get notified once**

They currently have `dead_letter_notified_at IS NULL` (the column is brand new), so the next `*/30` cron tick's `sweepFleetioHealth` will notify on all 6 in one pass — expected and correct (one-time backlog notification), not a bug. Confirm via:

```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT COUNT(*) AS n FROM fleetio_events WHERE status='failed' AND dead_letter_notified_at IS NULL"
```

before the next tick (should show 6), and again ~30 minutes after deploy (should show 0, with matching in-app notifications for admin-role users).
