import { describe, it, expect } from 'vitest';
import {
  applyOutbound,
  applyInbound,
  nextAttemptDelaySeconds,
  maxAttempts,
  BACKOFF_SECONDS,
} from '../src/utils/fleetio/sync';
import {
  FleetioRateLimitError,
  FleetioConfigError,
  FleetioHttpError,
} from '../src/utils/fleetio/errors';

// ─── In-memory D1 stub ──────────────────────────────────────
// Models the four prepare patterns the sync engine uses:
//   1. SELECT … FROM fleetio_events WHERE direction='outbound' AND status='pending' AND attempts < ?
//   2. SELECT … FROM fleetio_events WHERE direction='inbound' AND event_id = ?
//   3. SELECT fleetio_id FROM fleetio_links …
//   4. SELECT updated_at FROM <table> WHERE id = ?
//   5. UPDATE fleetio_events SET status=…, attempts=… WHERE id = ?
//   6. UPDATE <table> SET … WHERE id = ?
//   7. INSERT INTO fleetio_conflicts …

interface EventRow {
  id: number; direction: 'inbound' | 'outbound'; event_id: string; resource: string;
  resource_id: number | null; action: 'create' | 'update' | 'delete'; status: string;
  attempts: number; payload_json: string; error: string | null;
  created_at: string; processed_at: string | null;
}

interface FleetTables {
  events: EventRow[];
  links: { rmpg_table: string; rmpg_id: number; fleetio_id: number }[];
  fleet_vehicles: Record<number, Record<string, unknown>>;
  fleet_fuel_log: Record<number, Record<string, unknown>>;
  conflicts: { rmpg_table: string; rmpg_id: number; field: string; remote_value: string; resolution: string }[];
}

function makeDb(state: FleetTables) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const ctx = { sql, bindings: [] as unknown[] };
      const stmt = {
        bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
        async all<T>(): Promise<{ results: T[] }> {
          calls.push(ctx);
          if (/FROM fleetio_events\s+WHERE direction = 'outbound'/i.test(sql)) {
            const [maxAttempts, limit] = ctx.bindings as [number, number];
            const rows = state.events.filter(e =>
              e.direction === 'outbound' && e.status === 'pending' && e.attempts < maxAttempts,
            ).slice(0, limit);
            return { results: rows as unknown as T[] };
          }
          return { results: [] };
        },
        async first<T>(): Promise<T | null> {
          calls.push(ctx);
          if (/FROM fleetio_events\s+WHERE direction = 'inbound'/i.test(sql)) {
            const [eventId] = ctx.bindings as [string];
            const found = state.events.find(e => e.direction === 'inbound' && e.event_id === eventId);
            return (found ?? null) as T | null;
          }
          if (/FROM fleetio_links/i.test(sql)) {
            const [rmpgTable, rmpgId] = ctx.bindings as [string, number];
            const found = state.links.find(l => l.rmpg_table === rmpgTable && l.rmpg_id === rmpgId);
            return found ? ({ fleetio_id: found.fleetio_id } as unknown as T) : null;
          }
          if (/SELECT updated_at FROM/i.test(sql)) {
            const tableMatch = sql.match(/FROM\s+(\w+)/i);
            const table = tableMatch?.[1];
            const [id] = ctx.bindings as [number];
            const target = table === 'fleet_vehicles' ? state.fleet_vehicles : state.fleet_fuel_log;
            const row = target[id];
            if (!row) return null;
            return { updated_at: row.updated_at ?? null } as unknown as T;
          }
          return null;
        },
        async run() {
          calls.push(ctx);
          if (/^UPDATE fleetio_events/i.test(sql)) {
            const last = ctx.bindings[ctx.bindings.length - 1] as number;
            const ev = state.events.find(e => e.id === last);
            if (!ev) return { meta: { changes: 0, last_row_id: 0 } };
            // Two shapes:
            //   "SET status='completed', processed_at=…, attempts=attempts+1 WHERE id = ?"
            //   "SET status = CASE WHEN attempts+1 >= ? THEN 'failed' ELSE 'pending' END, attempts = attempts+1, error = ? WHERE id = ?"
            if (/status='completed'/.test(sql)) {
              ev.status = 'completed';
              ev.processed_at = new Date().toISOString();
              ev.attempts += 1;
            } else if (/CASE/.test(sql)) {
              const [maxAttempts_, error_msg] = ctx.bindings as [number, string, number];
              ev.attempts += 1;
              ev.status = ev.attempts >= maxAttempts_ ? 'failed' : 'pending';
              ev.error = error_msg;
            } else if (/status='completed'/.test(sql) || /processed_at=datetime/.test(sql)) {
              ev.status = 'completed';
              ev.processed_at = new Date().toISOString();
            }
            return { meta: { changes: 1, last_row_id: ev.id } };
          }
          if (/INSERT INTO fleetio_conflicts/i.test(sql)) {
            const [rmpgTable, rmpgId, field, remote, resolution] =
              [ctx.bindings[0] as string, ctx.bindings[1] as number, ctx.bindings[2] as string, ctx.bindings[3] as string, /'unresolved'/.test(sql) ? 'unresolved' : 'local_wins'];
            state.conflicts.push({ rmpg_table: rmpgTable, rmpg_id: rmpgId, field, remote_value: remote, resolution });
            return { meta: { changes: 1, last_row_id: state.conflicts.length } };
          }
          if (/^UPDATE\s+fleet_vehicles\s+SET/i.test(sql)) {
            const id = ctx.bindings[ctx.bindings.length - 1] as number;
            state.fleet_vehicles[id] = state.fleet_vehicles[id] ?? {};
            // Roughly apply SET assignments from the bindings (test doesn't care
            // about exact column names — only that an UPDATE was issued).
            state.fleet_vehicles[id].__last_update_bindings = ctx.bindings;
            return { meta: { changes: 1, last_row_id: id } };
          }
          if (/^UPDATE\s+fleet_fuel_log\s+SET/i.test(sql)) {
            const id = ctx.bindings[ctx.bindings.length - 1] as number;
            state.fleet_fuel_log[id] = state.fleet_fuel_log[id] ?? {};
            state.fleet_fuel_log[id].__last_update_bindings = ctx.bindings;
            return { meta: { changes: 1, last_row_id: id } };
          }
          // recordLink helper — sync engine records a new fleetio_links row
          // after a successful create dispatch.
          if (/^INSERT OR IGNORE INTO fleetio_links/i.test(sql)) {
            const [rmpgTable, rmpgId, , fleetioId] = ctx.bindings as [string, number, string, number];
            const exists = state.links.some(l => l.rmpg_table === rmpgTable && l.rmpg_id === rmpgId);
            if (!exists) state.links.push({ rmpg_table: rmpgTable, rmpg_id: rmpgId, fleetio_id: fleetioId });
            return { meta: { changes: exists ? 0 : 1, last_row_id: state.links.length } };
          }
          return { meta: { changes: 0, last_row_id: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as Parameters<typeof applyOutbound>[0]['db'];
  return { db, calls };
}

const stubConfig = { apiKey: 'k', accountToken: 'a', apiBase: 'https://example.test/api/v1' };

// ─── Backoff schedule ────────────────────────────────────

describe('backoff schedule', () => {
  it('exposes 7 steps: 1s, 4s, 16s, 60s, 5m, 30m, 2h', () => {
    expect(BACKOFF_SECONDS).toEqual([1, 4, 16, 60, 300, 1800, 7200]);
    expect(maxAttempts()).toBe(7);
  });

  it('nextAttemptDelaySeconds clamps below 0 and above max', () => {
    expect(nextAttemptDelaySeconds(-1)).toBe(0);
    expect(nextAttemptDelaySeconds(0)).toBe(1);
    expect(nextAttemptDelaySeconds(6)).toBe(7200);
    expect(nextAttemptDelaySeconds(20)).toBe(7200);
  });
});

// ─── applyOutbound ────────────────────────────────────────

describe('applyOutbound', () => {
  const baseEvent = (overrides: Partial<EventRow>): EventRow => ({
    id: 1,
    direction: 'outbound',
    event_id: 'evt-1',
    resource: 'vehicle',
    resource_id: 42,
    action: 'update',
    status: 'pending',
    attempts: 0,
    payload_json: JSON.stringify({ vehicle_name: 'Patrol 12' }),
    error: null,
    created_at: '2026-06-21T00:00:00Z',
    processed_at: null,
    ...overrides,
  });

  it('happy path — adapter call succeeds, row marked completed', async () => {
    const state: FleetTables = {
      events: [baseEvent({})],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let updateCalls = 0;
    const adapter = {
      async updateVehicle(args: { fleetioId: number; payload: Record<string, unknown> }): Promise<unknown> {
        updateCalls++;
        expect(args.fleetioId).toBe(999);
        expect(args.payload.vehicle_name).toBe('Patrol 12');
        return { id: args.fleetioId, name: 'Patrol 12' };
      },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(result.attempted).toBe(1);
    expect(result.completed).toBe(1);
    expect(updateCalls).toBe(1);
    expect(state.events[0].status).toBe('completed');
    expect(state.events[0].attempts).toBe(1);
  });

  it('adapter throws non-rate-limit — row stays pending, attempts++', async () => {
    const state: FleetTables = {
      events: [baseEvent({})],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const adapter = {
      async updateVehicle() { throw new FleetioHttpError('Bad Request', 400, 'invalid payload'); },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(result.attempted).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(state.events[0].status).toBe('pending');
    expect(state.events[0].attempts).toBe(1);
  });

  it('after maxAttempts failures, row transitions to failed', async () => {
    const state: FleetTables = {
      events: [baseEvent({ attempts: maxAttempts() - 1 })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const adapter = {
      async updateVehicle() { throw new FleetioHttpError('Internal', 500, 'down'); },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(result.failed).toBe(1);
    expect(state.events[0].status).toBe('failed');
    expect(state.events[0].attempts).toBe(maxAttempts());
  });

  it('rate-limit error stops the drain early (skip remainder)', async () => {
    const state: FleetTables = {
      events: [
        baseEvent({ id: 1, event_id: 'a' }),
        baseEvent({ id: 2, event_id: 'b' }),
        baseEvent({ id: 3, event_id: 'c' }),
      ],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const adapter = {
      async updateVehicle() { throw new FleetioRateLimitError(60); },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(result.attempted).toBe(1);    // bail after the first failure
    expect(result.skipped).toBe(2);
  });

  it('config error halts the drain immediately', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 1 }), baseEvent({ id: 2, event_id: 'evt-2' })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const adapter = {
      async updateVehicle() { throw new FleetioConfigError('FLEETIO_API_KEY is unset'); },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(result.attempted).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('unsupported (resource, action) records a failure and moves on', async () => {
    const state: FleetTables = {
      events: [baseEvent({ resource: 'work_order', action: 'update' })],
      links: [], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const adapter = {
      async updateVehicle() { throw new Error('should not be called'); },
      async createFuelEntry() { throw new Error('should not be called'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/Unsupported outbound/);
  });

  it('no link → returns no-op (does not throw) and marks completed', async () => {
    const state: FleetTables = {
      events: [baseEvent({})],
      links: [], // no fleetio_links row → no fleetio_id
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let updateCalled = false;
    const adapter = {
      async updateVehicle() { updateCalled = true; return {} as never; },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(updateCalled).toBe(false);
    expect(result.completed).toBe(1);
    expect(state.events[0].status).toBe('completed');
  });

  // ─── PR 4 hotfix coverage — 3 dispatch cases previously left 501 ────

  it('vehicle/create — pushes to Fleet.io, records fleetio_links, marks completed', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 11, event_id: 'evt-vc', resource: 'vehicle', action: 'create',
        payload_json: JSON.stringify({ name: 'Patrol 99', vin: '1HGCM82633A123456' }) })],
      links: [], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let createCalls = 0;
    const adapter = {
      async createVehicle(args: { payload: Record<string, unknown> }) {
        createCalls++;
        expect(args.payload.name).toBe('Patrol 99');
        return { id: 7777, name: args.payload.name } as never;
      },
      async updateVehicle() { throw new Error('not used'); },
      async archiveVehicle() { throw new Error('not used'); },
      async createFuelEntry() { throw new Error('not used'); },
      async createWorkOrder() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(createCalls).toBe(1);
    expect(result.completed).toBe(1);
    expect(state.events[0].status).toBe('completed');
    // Link recorded so the next emit (update/delete) can find the fleetio_id.
    expect(state.links).toEqual([{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 7777 }]);
  });

  it('vehicle/create — idempotent: skips remote call if link already exists', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 12, event_id: 'evt-vc-dup', resource: 'vehicle', action: 'create',
        payload_json: JSON.stringify({ name: 'Patrol 99' }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 7777 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let createCalls = 0;
    const adapter = {
      async createVehicle() { createCalls++; return {} as never; },
      async updateVehicle() { throw new Error('not used'); },
      async archiveVehicle() { throw new Error('not used'); },
      async createFuelEntry() { throw new Error('not used'); },
      async createWorkOrder() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(createCalls).toBe(0);                          // no duplicate push
    expect(result.completed).toBe(1);
    expect(state.events[0].status).toBe('completed');
  });

  it('vehicle/delete — archives via PATCH with ISO timestamp from injected now()', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 13, event_id: 'evt-vd', resource: 'vehicle', action: 'delete',
        payload_json: JSON.stringify({ id: 42, archived: true }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 7777 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let archivedAtSeen: string | null = null;
    const adapter = {
      async createVehicle() { throw new Error('not used'); },
      async updateVehicle() { throw new Error('not used'); },
      async archiveVehicle(args: { fleetioId: number; archivedAtIso: string }) {
        expect(args.fleetioId).toBe(7777);
        archivedAtSeen = args.archivedAtIso;
        return { id: args.fleetioId, name: 'Patrol' } as never;
      },
      async createFuelEntry() { throw new Error('not used'); },
      async createWorkOrder() { throw new Error('not used'); },
    };
    const fixedNow = () => new Date('2026-06-21T22:43:51Z');
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig, now: fixedNow });
    expect(result.completed).toBe(1);
    expect(archivedAtSeen).toBe('2026-06-21T22:43:51.000Z');
  });

  it('vehicle/delete with no link — no-op completion (never linked, nothing to archive)', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 14, event_id: 'evt-vd-unlinked', resource: 'vehicle', action: 'delete',
        payload_json: JSON.stringify({ id: 4 }) })],
      links: [], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let archiveCalls = 0;
    const adapter = {
      async createVehicle() { throw new Error('not used'); },
      async updateVehicle() { throw new Error('not used'); },
      async archiveVehicle() { archiveCalls++; return {} as never; },
      async createFuelEntry() { throw new Error('not used'); },
      async createWorkOrder() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(archiveCalls).toBe(0);
    expect(result.completed).toBe(1);
    expect(state.events[0].status).toBe('completed');
  });

  it('work_order/create — pushes to Fleet.io and records work_orders link', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 15, event_id: 'evt-wo', resource: 'work_order', resource_id: 1, action: 'create',
        payload_json: JSON.stringify({ vehicle_id: 7777, description: 'Brake job' }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 7777, fleetio_id: 99999 }], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let woCalls = 0;
    const adapter = {
      async createVehicle() { throw new Error('not used'); },
      async updateVehicle() { throw new Error('not used'); },
      async archiveVehicle() { throw new Error('not used'); },
      async createFuelEntry() { throw new Error('not used'); },
      async createWorkOrder(args: { payload: Record<string, unknown> }) {
        woCalls++;
        expect(args.payload.description).toBe('Brake job');
        // vehicle_id must be translated to Fleet.io id (99999), not the RMPG id (7777).
        expect(args.payload.vehicle_id).toBe(99999);
        return { id: 8888, vehicle_id: 99999 } as never;
      },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(woCalls).toBe(1);
    expect(result.completed).toBe(1);
    expect(state.links.some(l => l.rmpg_table === 'work_orders' && l.rmpg_id === 1 && l.fleetio_id === 8888)).toBe(true);
  });

  // ─── FK translation coverage (PR-after-1544 hotfix) ────────────────

  it('work_order/create — no-op completion when parent vehicle is not linked (avoids Fleet.io 422)', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 16, event_id: 'evt-wo-orphan', resource: 'work_order', resource_id: 2, action: 'create',
        payload_json: JSON.stringify({ vehicle_id: 1, summary: 'Rear collision' }) })],
      links: [], // no fleet_vehicles link → required FK can't translate
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let woCalls = 0;
    const adapter = {
      async createVehicle() { throw new Error('not used'); },
      async updateVehicle() { throw new Error('not used'); },
      async archiveVehicle() { throw new Error('not used'); },
      async createFuelEntry() { throw new Error('not used'); },
      async createWorkOrder() { woCalls++; return {} as never; },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(woCalls).toBe(0);                              // never reached Fleet.io
    expect(result.completed).toBe(1);                     // marked completed (no-op)
    expect(state.events[0].status).toBe('completed');
  });

  it('work_order/create — drops optional vendor_id/assigned_to_user_id when unlinked, keeps the rest', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 17, event_id: 'evt-wo-opt', resource: 'work_order', resource_id: 3, action: 'create',
        payload_json: JSON.stringify({ vehicle_id: 7777, vendor_id: 55, assigned_to_user_id: 12, summary: 'Tire rotation' }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 7777, fleetio_id: 99999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let sentPayload: Record<string, unknown> | null = null;
    const adapter = {
      async createVehicle() { throw new Error('not used'); },
      async updateVehicle() { throw new Error('not used'); },
      async archiveVehicle() { throw new Error('not used'); },
      async createFuelEntry() { throw new Error('not used'); },
      async createWorkOrder(args: { payload: Record<string, unknown> }) {
        sentPayload = args.payload;
        return { id: 9000 } as never;
      },
    };
    const result = await applyOutbound({ db, adapter: adapter as never, config: stubConfig });
    expect(result.completed).toBe(1);
    expect(sentPayload).not.toBeNull();
    expect(sentPayload!.vehicle_id).toBe(99999);          // translated
    expect(sentPayload!.summary).toBe('Tire rotation');   // preserved
    expect('vendor_id' in (sentPayload as object)).toBe(false);          // dropped (no link)
    expect('assigned_to_user_id' in (sentPayload as object)).toBe(false); // dropped (no link)
  });

  it('fuel_entry/create — translates vehicle_id; no-op when parent unlinked', async () => {
    const stateLinked: FleetTables = {
      events: [baseEvent({ id: 18, event_id: 'evt-fuel-ok', resource: 'fuel_entry', resource_id: 100, action: 'create',
        payload_json: JSON.stringify({ vehicle_id: 7777, gallons: 12.4, total_cost: 43.28 }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 7777, fleetio_id: 99999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    let sent: Record<string, unknown> | null = null;
    const adapterOk = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); },
      async createFuelEntry(args: { payload: Record<string, unknown> }) { sent = args.payload; return { id: 1 } as never; },
      async createWorkOrder() { throw new Error('nu'); },
    };
    const r1 = await applyOutbound({ db: makeDb(stateLinked).db, adapter: adapterOk as never, config: stubConfig });
    expect(r1.completed).toBe(1);
    expect(sent!.vehicle_id).toBe(99999);
    expect(sent!.gallons).toBe(12.4);

    // Orphan case
    const stateOrphan: FleetTables = {
      events: [baseEvent({ id: 19, event_id: 'evt-fuel-orphan', resource: 'fuel_entry', resource_id: 101, action: 'create',
        payload_json: JSON.stringify({ vehicle_id: 1, gallons: 8.0 }) })],
      links: [], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    let calls = 0;
    const adapterCount = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); },
      async createFuelEntry() { calls++; return {} as never; },
      async createWorkOrder() { throw new Error('nu'); },
    };
    const r2 = await applyOutbound({ db: makeDb(stateOrphan).db, adapter: adapterCount as never, config: stubConfig });
    expect(calls).toBe(0);
    expect(r2.completed).toBe(1);
  });
});

// ─── applyInbound ─────────────────────────────────────────

describe('applyInbound', () => {
  const inboundEvent = (overrides: Partial<EventRow>): EventRow => ({
    id: 100,
    direction: 'inbound',
    event_id: 'fleetio-evt-1',
    resource: 'vehicle',
    resource_id: 42,
    action: 'update',
    status: 'pending',
    attempts: 0,
    payload_json: '{}',
    error: null,
    created_at: '2026-06-21T00:00:00Z',
    processed_at: null,
    ...overrides,
  });

  it('returns unknown_event for an unknown event_id', async () => {
    const state: FleetTables = { events: [], links: [], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [] };
    const { db } = makeDb(state);
    const result = await applyInbound({ db }, 'nope');
    expect(result.status).toBe('unknown_event');
  });

  it('applies fleetio-owned fields and marks event completed', async () => {
    const payload = { next_service_mileage: 50000, next_service_date: '2026-12-31' };
    const state: FleetTables = {
      events: [inboundEvent({ payload_json: JSON.stringify(payload) })],
      links: [],
      fleet_vehicles: { 42: { id: 42, updated_at: '2026-06-20T00:00:00Z' } },
      fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const result = await applyInbound({ db }, 'fleetio-evt-1');
    expect(result.status).toBe('applied');
    expect(result.applied_fields.sort()).toEqual(['next_service_date', 'next_service_mileage']);
    expect(result.conflict_fields).toEqual([]);
    expect(state.events[0].status).toBe('completed');
  });

  it('logs a conflict for an rmpg-owned field and does not apply it', async () => {
    const payload = { vehicle_name: 'Imposter' };
    const state: FleetTables = {
      events: [inboundEvent({ payload_json: JSON.stringify(payload) })],
      links: [],
      fleet_vehicles: { 42: { id: 42, updated_at: '2026-06-20T00:00:00Z' } },
      fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const result = await applyInbound({ db }, 'fleetio-evt-1');
    expect(result.conflict_fields).toEqual(['vehicle_name']);
    expect(result.applied_fields).toEqual([]);
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0].field).toBe('vehicle_name');
  });

  it('routes unmapped fields to unknown_fields', async () => {
    const payload = { mystery_col: 'x' };
    const state: FleetTables = {
      events: [inboundEvent({ payload_json: JSON.stringify(payload) })],
      links: [], fleet_vehicles: { 42: { id: 42 } }, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const result = await applyInbound({ db }, 'fleetio-evt-1');
    expect(result.unknown_fields).toEqual(['mystery_col']);
  });

  it('marks already-completed events as no_op', async () => {
    const state: FleetTables = {
      events: [inboundEvent({ status: 'completed', payload_json: '{}' })],
      links: [], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const result = await applyInbound({ db }, 'fleetio-evt-1');
    expect(result.status).toBe('no_op');
  });
});
