// ============================================================
// Fleet.io sync engine — hardening regression suite (2026-07-26)
// ============================================================
// One describe per defect fixed in the hardening pass. Each test is written to
// FAIL against the pre-fix behaviour, so it documents the bug as much as the
// fix. See tests/fleetioSync.test.ts for the original behavioural suite.
// ============================================================

import { describe, it, expect } from 'vitest';
import { applyOutbound, applyInbound, parseD1TimestampMs, _internals } from '../src/utils/fleetio/sync';
import {
  FLEETIO_LINK_RESOURCE,
  FLEETIO_RMPG_TABLE,
  RMPG_TABLE_TO_KIND,
  acceptedLinkResources,
  linkResourceForTable,
} from '../src/utils/fleetio/resources';

// ─── Minimal D1 stub ────────────────────────────────────────
// Deliberately separate from fleetioSync.test.ts's stub: this one records the
// exact SQL + bindings so a test can assert WHICH row an UPDATE targeted, which
// is the crux of the inbound-id defect.

interface LinkRow { rmpg_table: string; rmpg_id: number; fleetio_resource: string; fleetio_id: number }
interface EvRow {
  id: number; direction: 'inbound' | 'outbound'; event_id: string; resource: string;
  resource_id: number | null; action: 'create' | 'update' | 'delete'; status: string;
  attempts: number; payload_json: string; error: string | null;
  created_at: string; processed_at: string | null;
}
interface State {
  events: EvRow[];
  links: LinkRow[];
  rows: Record<string, Record<number, Record<string, unknown>>>;
  conflicts: { rmpg_table: string; rmpg_id: number; field: string }[];
}

function makeDb(state: State) {
  const writes: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const ctx = { sql, bindings: [] as unknown[] };
      const stmt = {
        bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
        async all<T>() {
          if (/FROM fleetio_events\s+WHERE direction = 'outbound'/i.test(sql)) {
            const [max, limit] = ctx.bindings as [number, number];
            const rows = state.events.filter((e) => e.direction === 'outbound' && e.status === 'pending' && e.attempts < max).slice(0, limit);
            return { results: rows as unknown as T[] };
          }
          return { results: [] as T[] };
        },
        async first<T>() {
          if (/FROM fleetio_events\s+WHERE direction = 'inbound'/i.test(sql)) {
            const [eid] = ctx.bindings as [string];
            return (state.events.find((e) => e.direction === 'inbound' && e.event_id === eid) ?? null) as T | null;
          }
          if (/FROM fleetio_links/i.test(sql)) {
            const table = ctx.bindings[0] as string;
            const resources = ctx.bindings.filter((b) => typeof b === 'string').slice(1) as string[];
            if (/SELECT rmpg_id/i.test(sql)) {
              const fid = ctx.bindings[ctx.bindings.length - 1] as number;
              const hit = state.links.find((l) => l.rmpg_table === table && l.fleetio_id === fid
                && (resources.length === 0 || resources.includes(l.fleetio_resource)));
              return hit ? ({ rmpg_id: hit.rmpg_id } as unknown as T) : null;
            }
            const rid = ctx.bindings[1] as number;
            const hit = state.links.find((l) => l.rmpg_table === table && l.rmpg_id === rid
              && (resources.length === 0 || resources.includes(l.fleetio_resource)));
            return hit ? ({ fleetio_id: hit.fleetio_id } as unknown as T) : null;
          }
          if (/SELECT updated_at FROM (\w+)/i.test(sql)) {
            const table = sql.match(/FROM\s+(\w+)/i)![1];
            const [id] = ctx.bindings as [number];
            const row = state.rows[table]?.[id];
            return row ? ({ updated_at: row.updated_at ?? null } as unknown as T) : null;
          }
          if (/SELECT \w+ AS v FROM/i.test(sql)) {
            const table = sql.match(/FROM\s+(\w+)/i)![1];
            const col = sql.match(/SELECT (\w+) AS v/i)![1];
            const [id] = ctx.bindings as [number];
            const row = state.rows[table]?.[id];
            return row ? ({ v: row[col] ?? null } as unknown as T) : null;
          }
          return null;
        },
        async run() {
          writes.push({ sql, bindings: [...ctx.bindings] });
          if (/^UPDATE fleetio_events/i.test(sql)) {
            if (ctx.bindings.length === 0) return { meta: { changes: 0, last_row_id: 0 } };
            const id = ctx.bindings[ctx.bindings.length - 1] as number;
            const ev = state.events.find((e) => e.id === id);
            if (!ev) return { meta: { changes: 0, last_row_id: 0 } };
            if (/status='processing'/.test(sql)) {
              if (ev.status !== 'pending') return { meta: { changes: 0, last_row_id: id } };
              ev.status = 'processing';
              ev.processed_at = '2026-07-26 12:00:00';
              return { meta: { changes: 1, last_row_id: id } };
            }
            if (/status='completed'/.test(sql)) { ev.status = 'completed'; return { meta: { changes: 1, last_row_id: id } }; }
            if (/CASE/.test(sql)) {
              const [max, err] = ctx.bindings as [number, string, number];
              ev.attempts += 1;
              ev.status = ev.attempts >= max ? 'failed' : 'pending';
              ev.error = err;
              return { meta: { changes: 1, last_row_id: id } };
            }
            return { meta: { changes: 1, last_row_id: id } };
          }
          if (/^INSERT OR IGNORE INTO fleetio_links/i.test(sql)) {
            const [t, rid, res, fid] = ctx.bindings as [string, number, string, number];
            const dup = state.links.some((l) => l.rmpg_table === t && l.rmpg_id === rid);
            if (!dup) state.links.push({ rmpg_table: t, rmpg_id: rid, fleetio_resource: res, fleetio_id: fid });
            return { meta: { changes: dup ? 0 : 1, last_row_id: state.links.length } };
          }
          if (/^DELETE FROM fleetio_links/i.test(sql)) {
            const [t, rid] = ctx.bindings as [string, number];
            const before = state.links.length;
            state.links = state.links.filter((l) => !(l.rmpg_table === t && l.rmpg_id === rid));
            return { meta: { changes: before - state.links.length, last_row_id: 0 } };
          }
          if (/INSERT INTO fleetio_conflicts/i.test(sql)) {
            state.conflicts.push({
              rmpg_table: ctx.bindings[0] as string,
              rmpg_id: ctx.bindings[1] as number,
              field: ctx.bindings[2] as string,
            });
            return { meta: { changes: 1, last_row_id: state.conflicts.length } };
          }
          return { meta: { changes: 1, last_row_id: 0 } };
        },
      };
      return stmt;
    },
  };
  return { db: db as never, writes };
}

const stubConfig = { apiKey: 'k', accountToken: 't', apiBase: 'https://secure.fleetio.com/api/v1' };

const ev = (o: Partial<EvRow>): EvRow => ({
  id: 1, direction: 'outbound', event_id: 'e1', resource: 'vehicle', resource_id: 42,
  action: 'update', status: 'pending', attempts: 0, payload_json: '{}', error: null,
  created_at: '2026-07-26 00:00:00', processed_at: null, ...o,
});

const emptyState = (o: Partial<State> = {}): State => ({
  events: [], links: [], rows: {}, conflicts: [], ...o,
});

// ════════════════════════════════════════════════════════════

describe('canonical link resources', () => {
  it('every resource kind maps to its Fleet.io REST path segment', () => {
    expect(FLEETIO_LINK_RESOURCE).toEqual({
      vehicle: 'vehicles', fuel_entry: 'fuel_entries', work_order: 'work_orders',
      vendor: 'vendors', part: 'parts',
    });
  });

  it('RMPG table map round-trips through its inverse', () => {
    for (const [kind, table] of Object.entries(FLEETIO_RMPG_TABLE)) {
      expect(RMPG_TABLE_TO_KIND[table]).toBe(kind);
      expect(linkResourceForTable(table)).toBe(FLEETIO_LINK_RESOURCE[kind as 'vehicle']);
    }
  });

  it('accepts the legacy singular spelling alongside the canonical one', () => {
    // Links written before canonicalization used the singular token; readers
    // must still resolve them until migration 0206 lands (and during the
    // non-atomic Worker/Pages deploy window afterwards).
    expect(acceptedLinkResources('vehicle')).toEqual(['vehicles', 'vehicle']);
    expect(acceptedLinkResources('fuel_entry')).toEqual(['fuel_entries', 'fuel_entry']);
  });

  it('vendor FK translation targets ref_vendors, not "vendors"', () => {
    // The outbound FK map used the literal 'vendors' while every vendor link is
    // stored under 'ref_vendors', so vendor_id — an OPTIONAL FK — was silently
    // stripped from every outbound work order and fuel entry.
    expect(FLEETIO_RMPG_TABLE.vendor).toBe('ref_vendors');
  });
});

describe('outbound: vendor FK translation (was silently dropped)', () => {
  it('translates vendor_id via the ref_vendors link', async () => {
    const state = emptyState({
      events: [ev({ id: 5, resource: 'work_order', resource_id: 70, action: 'create',
        payload_json: JSON.stringify({ vehicle_id: 42, vendor_id: 8, summary: 'Brakes' }) })],
      links: [
        { rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_resource: 'vehicles', fleetio_id: 999 },
        { rmpg_table: 'ref_vendors', rmpg_id: 8, fleetio_resource: 'vendors', fleetio_id: 555 },
      ],
    });
    const { db } = makeDb(state);
    let sent: Record<string, unknown> | undefined;
    const adapter = { async createWorkOrder(a: { payload: Record<string, unknown> }) { sent = a.payload; return { id: 4242 } as never; } };

    const r = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });

    expect(r.completed).toBe(1);
    expect(sent!.vehicle_id).toBe(999);
    expect(sent!.vendor_id).toBe(555);   // ← was absent entirely before the fix
  });

  it('still drops vendor_id when the vendor genuinely has no link', async () => {
    const state = emptyState({
      events: [ev({ id: 6, resource: 'work_order', resource_id: 71, action: 'create',
        payload_json: JSON.stringify({ vehicle_id: 42, vendor_id: 8 }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_resource: 'vehicles', fleetio_id: 999 }],
    });
    const { db } = makeDb(state);
    let sent: Record<string, unknown> | undefined;
    const adapter = { async createWorkOrder(a: { payload: Record<string, unknown> }) { sent = a.payload; return { id: 1 } as never; } };

    await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });

    // Optional + unlinked → omitted, so Fleet.io doesn't receive an RMPG id.
    expect(sent!).not.toHaveProperty('vendor_id');
  });
});

describe('outbound: fuel_entry/delete (was a guaranteed dead letter)', () => {
  it('dispatches DELETE and removes the stale link', async () => {
    const state = emptyState({
      events: [ev({ id: 7, resource: 'fuel_entry', resource_id: 100, action: 'delete',
        payload_json: JSON.stringify({ id: 100, deleted: true }) })],
      links: [{ rmpg_table: 'fleet_fuel_log', rmpg_id: 100, fleetio_resource: 'fuel_entries', fleetio_id: 900 }],
    });
    const { db } = makeDb(state);
    const seen: number[] = [];
    const adapter = { async deleteFuelEntry(a: { fleetioId: number }) { seen.push(a.fleetioId); return null; } };

    const r = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });

    expect(seen).toEqual([900]);
    expect(r.completed).toBe(1);
    expect(state.events[0].status).toBe('completed');
    // Link dropped: a stale mapping would make a later event PATCH a record
    // that no longer exists, which Fleet.io answers with a 404 → dead letter.
    expect(state.links).toHaveLength(0);
  });

  it('no-ops for a fuel entry that was never pushed', async () => {
    const state = emptyState({
      events: [ev({ id: 8, resource: 'fuel_entry', resource_id: 101, action: 'delete' })],
    });
    const { db } = makeDb(state);
    const adapter = { async deleteFuelEntry() { throw new Error('must not be called'); } };
    const r = await applyOutbound({ paceMs: 0, db, adapter: adapter as never, config: stubConfig });
    expect(r.completed).toBe(1);
    expect(r.errors).toEqual([]);
  });
});

describe('outbound: concurrency claim', () => {
  it('a second drain cannot re-dispatch an event the first one claimed', async () => {
    const state = emptyState({
      events: [ev({ id: 9, resource: 'vehicle', action: 'create',
        payload_json: JSON.stringify({ vehicle_name: 'Patrol 1' }) })],
    });
    let creates = 0;
    const adapter = { async createVehicle() { creates++; return { id: 1234 } as never; } };

    // Two drains over the SAME state, as two overlapping cron ticks would be.
    const h1 = makeDb(state);
    const h2 = makeDb(state);
    await applyOutbound({ paceMs: 0, db: h1.db, adapter: adapter as never, config: stubConfig });
    await applyOutbound({ paceMs: 0, db: h2.db, adapter: adapter as never, config: stubConfig });

    // Exactly one remote create. Without the claim, a duplicate vehicle is
    // created in Fleet.io and its id is unreachable forever (INSERT OR IGNORE
    // keeps the first link).
    expect(creates).toBe(1);
    expect(state.links).toHaveLength(1);
  });

  it('stamps the claim time so the reaper can age it out', async () => {
    const state = emptyState({ events: [ev({ id: 10, resource: 'inspection', action: 'create' })] });
    const { db, writes } = makeDb(state);
    await applyOutbound({ paceMs: 0, db, adapter: {} as never, config: stubConfig });
    // `SET status='processing'` specifically — the reaper statement also
    // mentions 'processing' (in its WHERE clause).
    const claim = writes.find((w) => /SET status='processing'/.test(w.sql));
    expect(claim).toBeDefined();
    expect(claim!.sql).toMatch(/processed_at=datetime\('now'\)/);
  });

  it('the reaper only re-pends claims older than the stale window', async () => {
    const state = emptyState();
    const { db, writes } = makeDb(state);
    await applyOutbound({ paceMs: 0, db, adapter: {} as never, config: stubConfig });
    const reap = writes.find((w) => /status='pending'/.test(w.sql) && /status='processing'/.test(w.sql));
    expect(reap).toBeDefined();
    // Ages on processed_at (the claim stamp), NOT created_at (the queue time) —
    // a created_at window would instantly reap a just-claimed old event.
    expect(reap!.sql).toContain("processed_at <= datetime('now', '-30 minutes')");
    expect(reap!.sql).not.toMatch(/created_at\s*<=/);
  });
});

describe('inbound: resource_id is the FLEET.IO id, not the local row id', () => {
  const inbound = (o: Partial<EvRow>): EvRow => ev({
    id: 200, direction: 'inbound', event_id: 'in-1', resource: 'vehicle',
    resource_id: 999, action: 'update', ...o,
  });

  it('updates the LINKED local row, never the row whose id equals the remote id', async () => {
    const state = emptyState({
      events: [inbound({ payload_json: JSON.stringify({ next_service_mileage: 60000 }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_resource: 'vehicles', fleetio_id: 999 }],
      rows: { fleet_vehicles: { 42: { id: 42, updated_at: '2026-07-01 00:00:00' }, 999: { id: 999 } } },
    });
    const { db, writes } = makeDb(state);

    const r = await applyInbound({ db }, 'in-1');

    expect(r.status).toBe('applied');
    expect(r.local_id).toBe(42);
    const upd = writes.find((w) => /^UPDATE fleet_vehicles SET/i.test(w.sql));
    expect(upd).toBeDefined();
    // The WHERE id binding is the LOCAL id (42). Pre-fix it was 999 — the
    // Fleet.io id — so remote values landed on an unrelated RMPG vehicle.
    expect(upd!.bindings[upd!.bindings.length - 1]).toBe(42);
  });

  it('files conflicts against the local row id', async () => {
    const state = emptyState({
      events: [inbound({ payload_json: JSON.stringify({ vehicle_name: 'Imposter' }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_resource: 'vehicles', fleetio_id: 999 }],
      rows: { fleet_vehicles: { 42: { id: 42, vehicle_name: 'Patrol 7' } } },
    });
    const { db } = makeDb(state);

    const r = await applyInbound({ db }, 'in-1');

    expect(r.conflict_fields).toEqual(['vehicle_name']);
    expect(state.conflicts[0]).toMatchObject({ rmpg_table: 'fleet_vehicles', rmpg_id: 42 });
  });

  it('reports "unlinked" and writes nothing when no link maps the remote id', async () => {
    const state = emptyState({
      events: [inbound({ payload_json: JSON.stringify({ next_service_mileage: 1 }) })],
      rows: { fleet_vehicles: { 999: { id: 999, updated_at: '2026-07-01 00:00:00' } } },
    });
    const { db, writes } = makeDb(state);

    const r = await applyInbound({ db }, 'in-1');

    expect(r.status).toBe('unlinked');
    expect(r.local_id).toBeNull();
    // Critically: no UPDATE against fleet_vehicles at all. The row with id 999
    // exists here precisely to catch a regression that would write to it.
    expect(writes.some((w) => /^UPDATE fleet_vehicles/i.test(w.sql))).toBe(false);
  });

  it('resolves a link stored under the LEGACY singular resource spelling', async () => {
    const state = emptyState({
      events: [inbound({ payload_json: JSON.stringify({ next_service_mileage: 70000 }) })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_resource: 'vehicle', fleetio_id: 999 }],
      rows: { fleet_vehicles: { 42: { id: 42, updated_at: '2026-07-01 00:00:00' } } },
    });
    const { db } = makeDb(state);
    const r = await applyInbound({ db }, 'in-1');
    expect(r.local_id).toBe(42);
  });
});

describe('inbound: FK reverse-translation', () => {
  it('rewrites a shared vendor_id from the Fleet.io id to the RMPG id', async () => {
    const state = emptyState({
      events: [ev({
        id: 300, direction: 'inbound', event_id: 'in-wo', resource: 'work_order',
        resource_id: 4242, action: 'update',
        payload_json: JSON.stringify({ vendor_id: 555, summary: 'Rotors' }),
      })],
      links: [
        { rmpg_table: 'work_orders', rmpg_id: 70, fleetio_resource: 'work_orders', fleetio_id: 4242 },
        { rmpg_table: 'ref_vendors', rmpg_id: 8, fleetio_resource: 'vendors', fleetio_id: 555 },
      ],
      rows: { work_orders: { 70: { id: 70, updated_at: '2026-07-01 00:00:00' } } },
    });
    const { db, writes } = makeDb(state);

    const r = await applyInbound({ db }, 'in-wo');

    expect(r.applied_fields).toContain('vendor_id');
    const upd = writes.find((w) => /^UPDATE work_orders SET/i.test(w.sql))!;
    // The bound value must be RMPG's vendor id (8), not Fleet.io's (555).
    // Writing 555 into a column that references ref_vendors.id repoints the
    // work order at an unrelated vendor — silent FK corruption.
    expect(upd.bindings).toContain(8);
    expect(upd.bindings).not.toContain(555);
  });

  it('drops an unmappable FK rather than writing the remote id through', async () => {
    const state = emptyState({
      events: [ev({
        id: 301, direction: 'inbound', event_id: 'in-wo2', resource: 'work_order',
        resource_id: 4242, action: 'update',
        payload_json: JSON.stringify({ vendor_id: 777, summary: 'Rotors' }),
      })],
      links: [{ rmpg_table: 'work_orders', rmpg_id: 70, fleetio_resource: 'work_orders', fleetio_id: 4242 }],
      rows: { work_orders: { 70: { id: 70, updated_at: '2026-07-01 00:00:00' } } },
    });
    const { db, writes } = makeDb(state);

    const r = await applyInbound({ db }, 'in-wo2');

    expect(r.dropped_fk_fields).toEqual(['vendor_id']);
    expect(r.applied_fields).not.toContain('vendor_id');
    expect(r.applied_fields).toContain('summary');   // the rest still applies
    const upd = writes.find((w) => /^UPDATE work_orders SET/i.test(w.sql))!;
    expect(upd.bindings).not.toContain(777);
  });
});

describe('inbound: failure accounting', () => {
  it('records attempts + error on the event when the apply UPDATE fails', async () => {
    const state = emptyState({
      events: [ev({
        id: 400, direction: 'inbound', event_id: 'in-fail', resource: 'vehicle',
        resource_id: 999, action: 'update', attempts: 6,
        payload_json: JSON.stringify({ next_service_mileage: 1 }),
      })],
      links: [{ rmpg_table: 'fleet_vehicles', rmpg_id: 42, fleetio_resource: 'vehicles', fleetio_id: 999 }],
      rows: { fleet_vehicles: { 42: { id: 42, updated_at: '2026-07-01 00:00:00' } } },
    });
    const { db } = makeDb(state);
    // Force the target UPDATE to throw.
    const realPrepare = (db as unknown as { prepare: (s: string) => unknown }).prepare;
    (db as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => {
      const stmt = realPrepare.call(db, sql) as { run: () => Promise<unknown> };
      if (/^UPDATE fleet_vehicles SET/i.test(sql)) {
        return { ...stmt, bind: () => ({ run: async () => { throw new Error('no such column: next_service_mileage'); } }) };
      }
      return stmt;
    };

    const r = await applyInbound({ db }, 'in-fail');

    expect(r.status).toBe('failed');
    // attempts 6 → 7 = maxAttempts, so it dead-letters instead of sitting in
    // 'pending' with attempts=0 and error=NULL forever (the pre-fix behaviour,
    // which was invisible to the health sweep).
    expect(state.events[0].attempts).toBe(7);
    expect(state.events[0].status).toBe('failed');
    expect(state.events[0].error).toMatch(/no such column/);
  });
});

describe('parseD1TimestampMs', () => {
  it("treats D1's zone-less 'YYYY-MM-DD HH:MM:SS' as UTC", () => {
    // Date.parse() reads this form as LOCAL time per ECMA-262, so the old
    // inline parse was only accidentally correct on a UTC Worker and shifted by
    // 6-7h under TZ=America/Denver — silently skewing every `shared` field's
    // last-write-wins verdict and emptying the 60s unresolved window.
    expect(parseD1TimestampMs('2026-07-26 12:00:00'))
      .toBe(Date.parse('2026-07-26T12:00:00Z'));
  });

  it('leaves an already-zoned ISO timestamp alone', () => {
    expect(parseD1TimestampMs('2026-07-26T12:00:00Z')).toBe(Date.parse('2026-07-26T12:00:00Z'));
    expect(parseD1TimestampMs('2026-07-26T06:00:00-06:00')).toBe(Date.parse('2026-07-26T12:00:00Z'));
  });

  it('returns null for empty or unparseable input', () => {
    expect(parseD1TimestampMs(null)).toBeNull();
    expect(parseD1TimestampMs('')).toBeNull();
    expect(parseD1TimestampMs('   ')).toBeNull();
    expect(parseD1TimestampMs('not a date')).toBeNull();
  });

  it('a local and a remote timestamp for the same instant compare equal', () => {
    // The whole point: D1 writes 'YYYY-MM-DD HH:MM:SS', Fleet.io sends ISO-8601
    // UTC. resolveSharedConflict compares them directly.
    const local = parseD1TimestampMs('2026-07-26 12:00:00')!;
    const remote = parseD1TimestampMs('2026-07-26T12:00:00Z')!;
    expect(Math.abs(remote - local)).toBe(0);
  });
});

describe('_internals surface', () => {
  it('exports the helpers the hardening tests and future suites need', () => {
    expect(typeof _internals.lookupRmpgId).toBe('function');
    expect(typeof _internals.translateInboundFks).toBe('function');
    expect(typeof _internals.dropLink).toBe('function');
  });
});
