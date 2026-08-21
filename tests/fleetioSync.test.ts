import { describe, it, expect } from 'vitest';
import {
  applyOutbound,
  applyInbound,
  nextAttemptDelaySeconds,
  maxAttempts,
  BACKOFF_SECONDS,
  getQueueHealth,
  isFleetioQueueUnhealthy,
  coerceScalarForD1,
  PACE_MS,
  shouldFireUnhealthyAlert,
  isPermanentFleetioFailure,
  isPermanentFailureMessage,
  formatFleetioError,
  isBackoffElapsed,
  backoffDelayAfterFailures,
  backoffDueSql,
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
  links: { rmpg_table: string; rmpg_id: number; fleetio_id: number; fleetio_resource?: string }[];
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
            // Mirrors the `backoffDueSql()` predicate now in the real query —
            // without this the stub would happily hand back rows the live
            // drain would skip, and the backoff gate would be untested.
            const rows = state.events.filter(e =>
              e.direction === 'outbound' && e.status === 'pending' && e.attempts < maxAttempts
              && isBackoffElapsed(
                e.attempts,
                e.processed_at ? new Date(e.processed_at).getTime() : null,
                Date.now(),
              ),
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
            const rmpgTable = ctx.bindings[0] as string;
            if (/SELECT rmpg_id/i.test(sql)) {
              // lookupRmpgId — inverse direction: (table, ...resources, fleetio_id)
              const fleetioId = ctx.bindings[ctx.bindings.length - 1] as number;
              const found = state.links.find(l => l.rmpg_table === rmpgTable && l.fleetio_id === fleetioId);
              return found ? ({ rmpg_id: found.rmpg_id } as unknown as T) : null;
            }
            // lookupFleetioId — (table, rmpg_id, ...resources)
            const rmpgId = ctx.bindings[1] as number;
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
            // Stale-claim reaper — no bindings, matches nothing in these fixtures.
            if (ctx.bindings.length === 0) return { meta: { changes: 0, last_row_id: 0 } };
            const last = ctx.bindings[ctx.bindings.length - 1] as number;
            const ev = state.events.find(e => e.id === last);
            if (!ev) return { meta: { changes: 0, last_row_id: 0 } };
            // Compare-and-swap claim: only a row still 'pending' can be taken.
            if (/status='processing'/.test(sql)) {
              if (ev.status !== 'pending') return { meta: { changes: 0, last_row_id: ev.id } };
              ev.status = 'processing';
              return { meta: { changes: 1, last_row_id: ev.id } };
            }
            // Two shapes:
            //   "SET status='completed', processed_at=…, attempts=attempts+1 WHERE id = ?"
            //   "SET status = CASE WHEN attempts+1 >= ? THEN 'failed' ELSE 'pending' END, attempts = attempts+1, error = ? WHERE id = ?"
            if (/status='completed'/.test(sql)) {
              ev.status = 'completed';
              ev.processed_at = new Date().toISOString();
              ev.attempts += 1;
            } else if (/CASE/.test(sql)) {
              // "SET status = CASE WHEN ? = 1 OR attempts + 1 >= ? THEN 'failed'
              //  ELSE 'pending' END, attempts = attempts+1, error = ? WHERE id = ?"
              // The leading flag is the permanent-failure short circuit.
              const [permanent_, maxAttempts_, error_msg] = ctx.bindings as [number, number, string, number];
              ev.attempts += 1;
              ev.status = permanent_ === 1 || ev.attempts >= maxAttempts_ ? 'failed' : 'pending';
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
          if (/^DELETE FROM fleetio_links/i.test(sql)) {
            const [rmpgTable, rmpgId] = ctx.bindings as [string, number];
            const before = state.links.length;
            state.links = state.links.filter(l => !(l.rmpg_table === rmpgTable && l.rmpg_id === rmpgId));
            return { meta: { changes: before - state.links.length, last_row_id: 0 } };
          }
          // recordLink helper — sync engine records a new fleetio_links row
          // after a successful create dispatch.
          if (/^INSERT OR IGNORE INTO fleetio_links/i.test(sql)) {
            const [rmpgTable, rmpgId, fleetioResource, fleetioId] = ctx.bindings as [string, number, string, number];
            const exists = state.links.some(l => l.rmpg_table === rmpgTable && l.rmpg_id === rmpgId);
            if (!exists) state.links.push({ rmpg_table: rmpgTable, rmpg_id: rmpgId, fleetio_id: fleetioId, fleetio_resource: fleetioResource });
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

describe('retry backoff gate', () => {
  // Before this existed, BACKOFF_SECONDS / nextAttemptDelaySeconds were dead
  // code: exported, unit-tested, and never referenced by the drain, whose
  // SELECT had no time predicate at all.

  it('maps failure count to the declared schedule', () => {
    expect(backoffDelayAfterFailures(0)).toBe(0);      // never tried → due now
    expect(backoffDelayAfterFailures(1)).toBe(1);
    expect(backoffDelayAfterFailures(2)).toBe(4);
    expect(backoffDelayAfterFailures(6)).toBe(1800);   // 30m before the last try
  });

  it('holds a row back until its window elapses', () => {
    const t0 = 1_000_000_000_000;
    // 2 failures → 4s window.
    expect(isBackoffElapsed(2, t0, t0 + 3_999)).toBe(false);
    expect(isBackoffElapsed(2, t0, t0 + 4_000)).toBe(true);
    // Never attempted, or no claim stamp → always due.
    expect(isBackoffElapsed(0, t0, t0)).toBe(true);
    expect(isBackoffElapsed(3, null, t0)).toBe(true);
  });

  it('generates SQL arms straight from BACKOFF_SECONDS (one source of truth)', () => {
    const sql = backoffDueSql();
    BACKOFF_SECONDS.forEach((secs, i) => {
      expect(sql).toContain(`WHEN ${i + 1} THEN ${secs}`);
    });
    // Purely numeric literals — nothing request-derived can reach the string.
    expect(sql).not.toMatch(/\?/);
  });

  it('drain SKIPS a row whose backoff window has not elapsed', async () => {
    const justNow = new Date(Date.now() - 1_000).toISOString(); // 1s ago
    const state: FleetTables = {
      // 3 failures → 16s window, only 1s has passed.
      events: [{
        id: 1, direction: 'outbound', event_id: 'evt-b', resource: 'vehicle',
        resource_id: 42, action: 'update', status: 'pending', attempts: 3,
        payload_json: JSON.stringify({ vehicle_name: 'Patrol 12' }),
        error: null, created_at: '2026-06-21T00:00:00Z', processed_at: justNow,
      }],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db, calls: sqlCalls } = makeDb(state);
    let calls = 0;
    const adapter = {
      async updateVehicle() { calls++; return { id: 999 }; },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(calls).toBe(0);
    expect(result.attempted).toBe(0);
    expect(state.events[0].status).toBe('pending');   // untouched, not consumed
    expect(state.events[0].attempts).toBe(3);

    // The stub filters in TS, so the assertions above would still hold if the
    // production SELECT had no gate at all. Pin the real SQL: without this,
    // deleting the predicate from the query leaves every test green.
    const select = sqlCalls.find(c => /FROM fleetio_events\s+WHERE direction = 'outbound'/i.test(c.sql));
    expect(select).toBeDefined();
    expect(select!.sql).toContain('CASE attempts');
    expect(select!.sql).toContain('processed_at IS NULL');
  });

  it('drain TAKES the same row once the window has elapsed', async () => {
    const longAgo = new Date(Date.now() - 60_000).toISOString(); // 60s > 16s
    const state: FleetTables = {
      events: [{
        id: 1, direction: 'outbound', event_id: 'evt-b', resource: 'vehicle',
        resource_id: 42, action: 'update', status: 'pending', attempts: 3,
        payload_json: JSON.stringify({ vehicle_name: 'Patrol 12' }),
        error: null, created_at: '2026-06-21T00:00:00Z', processed_at: longAgo,
      }],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let calls = 0;
    const adapter = {
      async updateVehicle() { calls++; return { id: 999 }; },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(calls).toBe(1);
    expect(result.completed).toBe(1);
  });
});

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
        expect(args.payload.name).toBe('Patrol 12');
        return { id: args.fleetioId, name: 'Patrol 12' };
      },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(result.attempted).toBe(1);
    expect(result.completed).toBe(1);
    expect(updateCalls).toBe(1);
    expect(state.events[0].status).toBe('completed');
    expect(state.events[0].attempts).toBe(1);
  });

  it('adapter throws a TRANSIENT error — row stays pending, attempts++', async () => {
    const state: FleetTables = {
      events: [baseEvent({})],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const adapter = {
      // 5xx — Fleet.io is unwell, not the payload. Retryable.
      async updateVehicle() { throw new FleetioHttpError('Fleet.io 503', 503, 'unavailable'); },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(result.attempted).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(state.events[0].status).toBe('pending');
    expect(state.events[0].attempts).toBe(1);
  });

  // ── Regression: 2026-08-01 Fleet.io incident ──
  // Live event id=23 (fuel_entry/create, fleet_fuel_log 117) 422'd seven times
  // and dead-lettered, because (a) the row was ALREADY linked so the create
  // should never have dispatched, and (b) a 422 was treated as retryable.

  it('fuel_entry/create for an ALREADY-LINKED row is an idempotent no-op', async () => {
    const state: FleetTables = {
      events: [baseEvent({
        resource: 'fuel_entry', action: 'create', resource_id: 115,
        payload_json: JSON.stringify({ vehicle_id: 1, gallons: 12.5, odometer: 94590 }),
      })],
      links: [
        { rmpg_table: 'fleet_fuel_log', rmpg_id: 115, fleetio_id: 219997437, fleetio_resource: 'fuel_entries' },
        { rmpg_table: 'fleet_vehicles', rmpg_id: 1, fleetio_id: 555, fleetio_resource: 'vehicles' },
      ],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let createCalls = 0;
    const adapter = {
      async updateVehicle() { throw new Error('not used'); },
      async createFuelEntry() { createCalls++; return { id: 999999 }; },
    };
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });

    // The whole point: no duplicate POST to Fleet.io.
    expect(createCalls).toBe(0);
    expect(result.completed).toBe(1);
    expect(state.events[0].status).toBe('completed');
    // And the original link is untouched — not overwritten by a new remote id.
    expect(state.links.filter(l => l.rmpg_table === 'fleet_fuel_log')).toHaveLength(1);
    expect(state.links.find(l => l.rmpg_table === 'fleet_fuel_log')?.fleetio_id).toBe(219997437);
  });

  it('an UNLINKED fuel_entry/create still dispatches and records its link', async () => {
    const state: FleetTables = {
      events: [baseEvent({
        resource: 'fuel_entry', action: 'create', resource_id: 200,
        payload_json: JSON.stringify({ vehicle_id: 1, gallons: 12.5, odometer: 94590 }),
      })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 1, fleetio_id: 555, fleetio_resource: 'vehicles' }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    let createCalls = 0;
    const adapter = {
      async updateVehicle() { throw new Error('not used'); },
      async createFuelEntry() { createCalls++; return { id: 777 }; },
    };
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(createCalls).toBe(1);
    expect(result.completed).toBe(1);
    expect(state.links.find(l => l.rmpg_table === 'fleet_fuel_log' && l.rmpg_id === 200)?.fleetio_id).toBe(777);
  });

  it('a PERMANENT 4xx fails on attempt 1 instead of burning the retry budget', async () => {
    const state: FleetTables = {
      events: [baseEvent({})],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const adapter = {
      async updateVehicle() {
        throw new FleetioHttpError('Fleet.io 422', 422, { errors: ['Meter value must be greater than 93918.8'] });
      },
      async createFuelEntry() { throw new Error('not used'); },
    };
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });

    expect(state.events[0].status).toBe('failed');
    expect(state.events[0].attempts).toBe(1);     // NOT maxAttempts()
    expect(result.failed).toBe(1);                // drain accounting mirrors the DB
    // Fleet.io's actual reason must survive to the Health tab, not just "Fleet.io 422".
    expect(state.events[0].error).toContain('Meter value must be greater than 93918.8');
    expect(isPermanentFailureMessage(state.events[0].error)).toBe(true);
  });

  it('408 and 429 are 4xx but transient — still retried', () => {
    expect(isPermanentFleetioFailure(new FleetioHttpError('Fleet.io 408', 408))).toBe(false);
    expect(isPermanentFleetioFailure(new FleetioHttpError('Fleet.io 429', 429))).toBe(false);
    expect(isPermanentFleetioFailure(new FleetioHttpError('Fleet.io 422', 422))).toBe(true);
    expect(isPermanentFleetioFailure(new FleetioHttpError('Fleet.io 404', 404))).toBe(true);
    expect(isPermanentFleetioFailure(new FleetioHttpError('Fleet.io 500', 500))).toBe(false);
    expect(isPermanentFleetioFailure(new Error('socket hang up'))).toBe(false);
  });

  it('formatFleetioError keeps a transient error unmarked and detail-rich', () => {
    const msg = formatFleetioError(new FleetioHttpError('Fleet.io 503', 503, { message: 'upstream down' }));
    expect(msg).toContain('upstream down');
    expect(isPermanentFailureMessage(msg)).toBe(false);
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(result.attempted).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('unsupported (resource, action) records a failure and moves on', async () => {
    const state: FleetTables = {
      // work_order/delete is the only genuinely-unsupported verb left. (This
      // test previously used fuel_entry/delete, which is now implemented —
      // its 501 was a live defect, not a deferral: fleet.ts has emitted
      // 'fuel.delete' all along, so every fuel-log deletion dead-lettered.)
      events: [baseEvent({ resource: 'work_order', action: 'delete' })],
      links: [], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const adapter = {
      async updateVehicle() { throw new Error('should not be called'); },
      async createFuelEntry() { throw new Error('should not be called'); },
    };
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(updateCalled).toBe(false);
    expect(result.completed).toBe(1);
    expect(state.events[0].status).toBe('completed');
  });

  // ─── PR 4 hotfix coverage — 3 dispatch cases previously left 501 ────

  it('vehicle/create — pushes to Fleet.io, records fleetio_links, marks completed', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 11, event_id: 'evt-vc', resource: 'vehicle', action: 'create',
        payload_json: JSON.stringify({ vehicle_name: 'Patrol 99', vin: '1HGCM82633A123456' }) })],
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(createCalls).toBe(1);
    expect(result.completed).toBe(1);
    expect(state.events[0].status).toBe('completed');
    // Link recorded so the next emit (update/delete) can find the fleetio_id.
    // The link's `fleetio_resource` must be the CANONICAL plural form. Writing
    // the singular 'vehicle' here is what made /pull blind to sync-created
    // links (see src/utils/fleetio/resources.ts).
    expect(state.links).toEqual([{
      rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 7777, fleetio_resource: 'vehicles',
    }]);
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig, now: fixedNow });
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(archiveCalls).toBe(0);
    expect(result.completed).toBe(1);
    expect(state.events[0].status).toBe('completed');
  });

  it('work_order/create — pushes to Fleet.io and records work_orders link', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 15, event_id: 'evt-wo', resource: 'work_order', resource_id: 1, action: 'create',
        payload_json: JSON.stringify({ vehicle_id: 7777, summary: 'Brake job' }) })],
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
        // `summary` (RMPG) is mapped to Fleet.io's real field name `description`.
        expect(args.payload.description).toBe('Brake job');
        // vehicle_id must be translated to Fleet.io id (99999), not the RMPG id (7777).
        expect(args.payload.vehicle_id).toBe(99999);
        return { id: 8888, vehicle_id: 99999 } as never;
      },
    };
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
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
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(result.completed).toBe(1);
    expect(sentPayload).not.toBeNull();
    expect(sentPayload!.vehicle_id).toBe(99999);            // translated
    expect(sentPayload!.description).toBe('Tire rotation'); // `summary` mapped to Fleet.io's `description`
    expect(sentPayload!.vendor_id).toBeUndefined();            // dropped (no link)
    // assigned_to_user_id has no Fleet.io equivalent at all (see mapWorkOrderFieldsToFleetio) —
    // dropped by the mapper regardless of link state, not just because it's unlinked.
    expect(sentPayload!.assigned_to_user_id).toBeUndefined();
  });

  it('fuel_entry/update — PATCHes Fleet.io when the row is linked', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 30, event_id: 'evt-fuel-upd', resource: 'fuel_entry', resource_id: 200, action: 'update',
        payload_json: JSON.stringify({ vehicle_id: 7777, gallons: 13.5, total_cost: 48.0 }) })],
      links: [
        { rmpg_table: 'fleet_vehicles', rmpg_id: 7777, fleetio_id: 99999 },
        { rmpg_table: 'fleet_fuel_log',  rmpg_id: 200,  fleetio_id: 555 },
      ],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    let seen: { fleetioId?: number; payload?: Record<string, unknown> } = {};
    const adapter = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); },
      async createFuelEntry() { throw new Error('nu'); },
      async updateFuelEntry(args: { fleetioId: number; payload: Record<string, unknown> }) {
        seen = args;
        return { id: args.fleetioId } as never;
      },
      async createWorkOrder() { throw new Error('nu'); },
      async updateWorkOrder() { throw new Error('nu'); },
    };
    const result = await applyOutbound({ paceMs: 0, db: makeDb(state).db, adapter: adapter as never, config: stubConfig });
    expect(result.completed).toBe(1);
    expect(seen.fleetioId).toBe(555);
    expect(seen.payload!.vehicle_id).toBe(99999);    // translated
    expect(seen.payload!.us_gallons).toBe(13.5);     // mapped from RMPG's `gallons`
  });

  it('fuel_entry/update — no-op when the row was never linked', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 31, event_id: 'evt-fuel-upd-orphan', resource: 'fuel_entry', resource_id: 999, action: 'update',
        payload_json: JSON.stringify({ vehicle_id: 7777, gallons: 5 }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 7777, fleetio_id: 99999 }], // vehicle linked, fuel row NOT
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    let calls = 0;
    const adapter = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); },
      async createFuelEntry() { throw new Error('nu'); },
      async updateFuelEntry() { calls++; return {} as never; },
      async createWorkOrder() { throw new Error('nu'); }, async updateWorkOrder() { throw new Error('nu'); },
    };
    const result = await applyOutbound({ paceMs: 0, db: makeDb(state).db, adapter: adapter as never, config: stubConfig });
    expect(calls).toBe(0);
    expect(result.completed).toBe(1);
  });

  it('work_order/update — PATCHes Fleet.io when linked; no-op when unlinked', async () => {
    const linkedState: FleetTables = {
      events: [baseEvent({ id: 32, event_id: 'evt-wo-upd', resource: 'work_order', resource_id: 1, action: 'update',
        payload_json: JSON.stringify({ vehicle_id: 7777, summary: 'Updated summary', status: 'in_progress' }) })],
      links: [
        { rmpg_table: 'fleet_vehicles', rmpg_id: 7777, fleetio_id: 99999 },
        { rmpg_table: 'work_orders',    rmpg_id: 1,    fleetio_id: 8888 },
      ],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    let seen: { fleetioId?: number; payload?: Record<string, unknown> } = {};
    const adapter = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); },
      async createFuelEntry() { throw new Error('nu'); }, async updateFuelEntry() { throw new Error('nu'); },
      async createWorkOrder() { throw new Error('nu'); },
      async updateWorkOrder(args: { fleetioId: number; payload: Record<string, unknown> }) {
        seen = args; return { id: args.fleetioId } as never;
      },
    };
    const r1 = await applyOutbound({ paceMs: 0, db: makeDb(linkedState).db, adapter: adapter as never, config: stubConfig });
    expect(r1.completed).toBe(1);
    expect(seen.fleetioId).toBe(8888);
    expect(seen.payload!.description).toBe('Updated summary'); // `summary` mapped to Fleet.io's `description`
    expect(seen.payload!.vehicle_id).toBe(99999);

    // Unlinked work_order — no-op
    const orphanState: FleetTables = {
      events: [baseEvent({ id: 33, event_id: 'evt-wo-upd-orphan', resource: 'work_order', resource_id: 999, action: 'update',
        payload_json: JSON.stringify({ vehicle_id: 7777, summary: 'whatever' }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 7777, fleetio_id: 99999 }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    let calls = 0;
    const adapter2 = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); },
      async createFuelEntry() { throw new Error('nu'); }, async updateFuelEntry() { throw new Error('nu'); },
      async createWorkOrder() { throw new Error('nu'); }, async updateWorkOrder() { calls++; return {} as never; },
    };
    const r2 = await applyOutbound({ paceMs: 0, db: makeDb(orphanState).db, adapter: adapter2 as never, config: stubConfig });
    expect(calls).toBe(0);
    expect(r2.completed).toBe(1);
  });

  it('inspection — silent no-op completion (RMPG-only resource, no Fleet.io equivalent)', async () => {
    const state: FleetTables = {
      events: [
        baseEvent({ id: 40, event_id: 'i1', resource: 'inspection', action: 'create',
          payload_json: JSON.stringify({ vehicle_id: 1, phase: 'pre_trip' }) }),
        baseEvent({ id: 41, event_id: 'i2', resource: 'inspection', action: 'update',
          payload_json: JSON.stringify({ completed_at: '2026-06-22T01:00:00Z' }) }),
      ],
      links: [], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const adapter = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); },
      async createFuelEntry() { throw new Error('nu'); }, async updateFuelEntry() { throw new Error('nu'); },
      async createWorkOrder() { throw new Error('nu'); }, async updateWorkOrder() { throw new Error('nu'); },
    };
    const result = await applyOutbound({ paceMs: 0, db: makeDb(state).db, adapter: adapter as never, config: stubConfig });
    expect(result.completed).toBe(2);                        // both events drained as no-op
    expect(state.events.every(e => e.status === 'completed')).toBe(true);
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
      async createFuelEntry(args: { payload: Record<string, unknown> }) { sent = args.payload; return { id: 55555 } as never; },
      async createWorkOrder() { throw new Error('nu'); },
    };
    const linkedHarness = makeDb(stateLinked);
    const r1 = await applyOutbound({ paceMs: 0, db: linkedHarness.db, adapter: adapterOk as never, config: stubConfig });
    expect(r1.completed).toBe(1);
    expect(sent!.vehicle_id).toBe(99999);
    expect(sent!.us_gallons).toBe(12.4);   // mapped from RMPG's `gallons`
    // Regression: fuel_entry/create must record a fleetio_links row so a
    // subsequent /fleetio/pull dedup query sees this entry and doesn't
    // insert a duplicate local row for the same remote fill-up.
    expect(stateLinked.links).toContainEqual({
      rmpg_table: 'fleet_fuel_log', rmpg_id: 100, fleetio_id: 55555,
      fleetio_resource: 'fuel_entries',
    });

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
    const r2 = await applyOutbound({ paceMs: 0, db: makeDb(stateOrphan).db, adapter: adapterCount as never, config: stubConfig });
    expect(calls).toBe(0);
    expect(r2.completed).toBe(1);
  });

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
    const result = await applyOutbound({ paceMs: 0, db: makeDb(state).db, adapter: adapter as never, config: stubConfig });
    expect(result.completed).toBe(1);
    expect(sentPayload).toEqual({ name: 'AutoZone' });
  });

  it('vendor/delete — Fleet.io 404 (vendor already gone remotely) is treated as success, drops the stale link', async () => {
    // Confirmed live 2026-07-29 (vendor/delete event id=13): the vendor was
    // deleted directly in Fleet.io's UI, orphaning the fleetio_links row.
    // Archiving an already-gone vendor can never succeed, so retrying just
    // burns all 7 attempts and dead-letters — the 404 IS the desired end
    // state, not a failure.
    const state: FleetTables = {
      events: [baseEvent({ id: 52, event_id: 'evt-vendor-del-404', resource: 'vendor', resource_id: 2, action: 'delete',
        payload_json: JSON.stringify({ id: 2 }) })],
      links: [{ rmpg_table: 'ref_vendors', rmpg_id: 2, fleetio_id: 14242171, fleetio_resource: 'vendors' }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const adapter = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); }, async createFuelEntry() { throw new Error('nu'); },
      async createWorkOrder() { throw new Error('nu'); },
      async archiveVendor() { throw new FleetioHttpError('Fleet.io 404', 404); },
    };
    const { db } = makeDb(state);
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(state.links.some(l => l.rmpg_table === 'ref_vendors' && l.rmpg_id === 2)).toBe(false);
  });

  it('vendor/delete — a non-404 Fleet.io error still fails and dead-letters normally', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 53, event_id: 'evt-vendor-del-500', resource: 'vendor', resource_id: 3, action: 'delete',
        payload_json: JSON.stringify({ id: 3 }), attempts: 6 })],
      links: [{ rmpg_table: 'ref_vendors', rmpg_id: 3, fleetio_id: 9999, fleetio_resource: 'vendors' }],
      fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const adapter = {
      async createVehicle() { throw new Error('nu'); }, async updateVehicle() { throw new Error('nu'); },
      async archiveVehicle() { throw new Error('nu'); }, async createFuelEntry() { throw new Error('nu'); },
      async createWorkOrder() { throw new Error('nu'); },
      async archiveVendor() { throw new FleetioHttpError('Fleet.io 500', 500); },
    };
    const { db } = makeDb(state);
    const result = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(result.failed).toBe(1);
    expect(state.links.some(l => l.rmpg_table === 'ref_vendors' && l.rmpg_id === 3)).toBe(true);
  });

  it('part/create — sends only Fleet.io-mapped fields, not the raw RMPG row', async () => {
    const state: FleetTables = {
      events: [baseEvent({ id: 51, event_id: 'evt-part-create', resource: 'part', resource_id: 5, action: 'create',
        payload_json: JSON.stringify({ id: 5, name: 'Oil Filter', part_number: 'PF-46', quantity_on_hand: 12, reorder_point: 3, unit_cost: 8.5 }) })],
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
    const result = await applyOutbound({ paceMs: 0, db: makeDb(state).db, adapter: adapter as never, config: stubConfig });
    expect(result.completed).toBe(1);
    // `name` has no Fleet.io equivalent (Parts are identified by `number`, not a display name) — dropped.
    expect(sentPayload).toEqual({ number: 'PF-46', unit_cost: 8.5 });
  });
});

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

// ─── applyInbound ─────────────────────────────────────────

describe('applyInbound', () => {
  const inboundEvent = (overrides: Partial<EventRow>): EventRow => ({
    id: 100,
    direction: 'inbound',
    event_id: 'fleetio-evt-1',
    resource: 'vehicle',
    // ⚠️ INBOUND resource_id is the FLEET.IO id (see FleetioEventRow). Held
    // deliberately distinct from the local row id (42) so any regression that
    // reintroduces "use resource_id as the local id" fails instead of passing
    // by coincidence.
    resource_id: 999,
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
    const state: FleetTables = { events: [], links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999, fleetio_resource: 'vehicles' }], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [] };
    const { db } = makeDb(state);
    const result = await applyInbound({ db }, 'nope');
    expect(result.status).toBe('unknown_event');
  });

  it('applies fleetio-owned fields and marks event completed', async () => {
    const payload = { next_service_mileage: 50000, next_service_date: '2026-12-31' };
    const state: FleetTables = {
      events: [inboundEvent({ payload_json: JSON.stringify(payload) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999, fleetio_resource: 'vehicles' }],
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

  it('unwraps the real Fleet.io webhook envelope shape before applying fields', async () => {
    // fleetioWebhook.ts stores the RAW webhook body verbatim as payload_json —
    // Fleet.io's real shape is `{ event: 'vehicle_updated', payload: { ...fields } }`
    // (see normalizeResource's variant 4 doc comment), NOT a flat field dict.
    // A regression that reads Object.keys() on the envelope itself (rather than
    // unwrapping .payload/.data first) would see only ['event','payload'] and
    // silently apply nothing — this must fail loudly if that ever recurs.
    const envelope = {
      event: 'vehicle_updated',
      payload: { vehicle_id: 999, next_service_mileage: 60000, next_service_date: '2027-01-15' },
    };
    const state: FleetTables = {
      events: [inboundEvent({ payload_json: JSON.stringify(envelope) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999, fleetio_resource: 'vehicles' }],
      fleet_vehicles: { 42: { id: 42, updated_at: '2026-06-20T00:00:00Z' } },
      fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const result = await applyInbound({ db }, 'fleetio-evt-1');
    expect(result.status).toBe('applied');
    expect(result.applied_fields.sort()).toEqual(['next_service_date', 'next_service_mileage']);
    expect(state.events[0].status).toBe('completed');
  });

  it('logs a conflict for an rmpg-owned field and does not apply it', async () => {
    const payload = { vehicle_name: 'Imposter' };
    const state: FleetTables = {
      events: [inboundEvent({ payload_json: JSON.stringify(payload) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999, fleetio_resource: 'vehicles' }],
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
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999, fleetio_resource: 'vehicles' }], fleet_vehicles: { 42: { id: 42 } }, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const result = await applyInbound({ db }, 'fleetio-evt-1');
    expect(result.unknown_fields).toEqual(['mystery_col']);
  });

  it('marks already-completed events as no_op', async () => {
    const state: FleetTables = {
      events: [inboundEvent({ status: 'completed', payload_json: '{}' })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_id: 999, fleetio_resource: 'vehicles' }], fleet_vehicles: {}, fleet_fuel_log: {}, conflicts: [],
    };
    const { db } = makeDb(state);
    const result = await applyInbound({ db }, 'fleetio-evt-1');
    expect(result.status).toBe('no_op');
  });
});

describe('coerceScalarForD1', () => {
  it('passes scalars through untouched', () => {
    expect(coerceScalarForD1('abc')).toBe('abc');
    expect(coerceScalarForD1(42)).toBe(42);
    expect(coerceScalarForD1(null)).toBe(null);
  });

  it('JSON-stringifies objects and arrays so D1 bind() cannot throw', () => {
    expect(coerceScalarForD1({ a: 1 })).toBe('{"a":1}');
    expect(coerceScalarForD1([1, 2])).toBe('[1,2]');
  });
});

describe('outbound pacing constant', () => {
  it('exports the shared 1.2s pace', () => {
    expect(PACE_MS).toBe(1200);
  });
});
