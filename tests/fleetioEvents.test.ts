import { describe, it, expect } from 'vitest';
import {
  buildEventIdInput,
  resolveEmitKind,
  sha256Hex,
  emitFleetioEvent,
  type FleetioEmitKind,
  type EmitOpts,
} from '../src/utils/fleetio/events';

describe('resolveEmitKind', () => {
  it('maps each known kind to a resource + action', () => {
    expect(resolveEmitKind('vehicle.create')).toEqual({ resource: 'vehicle', action: 'create' });
    expect(resolveEmitKind('vehicle.update')).toEqual({ resource: 'vehicle', action: 'update' });
    expect(resolveEmitKind('vehicle.delete')).toEqual({ resource: 'vehicle', action: 'delete' });
    expect(resolveEmitKind('fuel.create')).toEqual({ resource: 'fuel_entry', action: 'create' });
    expect(resolveEmitKind('work_order.close')).toEqual({ resource: 'work_order', action: 'update' });
    expect(resolveEmitKind('inspection.submit')).toEqual({ resource: 'inspection', action: 'update' });
  });

  it('throws on an unknown kind (defensive runtime guard)', () => {
    expect(() => resolveEmitKind('vehicle.purge' as FleetioEmitKind)).toThrow();
  });
});

describe('buildEventIdInput', () => {
  const baseOpts: EmitOpts = { rmpgTable: 'fleet_vehicles', rmpgId: 42, versionToken: '2026-06-21T00:00:00Z' };

  it('encodes table + id + resource + action + token in a stable order', () => {
    expect(buildEventIdInput(baseOpts, 'vehicle.update'))
      .toBe('fleet_vehicles:42:vehicle:update:2026-06-21T00:00:00Z');
  });

  it('produces DIFFERENT inputs for different actions on the same row', () => {
    const create = buildEventIdInput(baseOpts, 'vehicle.create');
    const update = buildEventIdInput(baseOpts, 'vehicle.update');
    const del    = buildEventIdInput(baseOpts, 'vehicle.delete');
    expect(new Set([create, update, del]).size).toBe(3);
  });

  it('produces DIFFERENT inputs when the version_token changes', () => {
    const t1 = buildEventIdInput({ ...baseOpts, versionToken: '2026-06-21T00:00:00Z' }, 'vehicle.update');
    const t2 = buildEventIdInput({ ...baseOpts, versionToken: '2026-06-21T00:00:01Z' }, 'vehicle.update');
    expect(t1).not.toBe(t2);
  });

  it('produces the SAME input for two identical opts (dedup)', () => {
    const a = buildEventIdInput(baseOpts, 'vehicle.update');
    const b = buildEventIdInput({ ...baseOpts }, 'vehicle.update');
    expect(a).toBe(b);
  });
});

describe('sha256Hex', () => {
  it('produces a known hex digest for a known input', async () => {
    // Standard test vector: sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('returns a 64-character lowercase hex string', async () => {
    const out = await sha256Hex('fleet_vehicles:42:vehicle:update:2026-06-21T00:00:00Z');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across calls with identical input', async () => {
    const a = await sha256Hex('repeat me');
    const b = await sha256Hex('repeat me');
    expect(a).toBe(b);
  });
});

// ─── emitFleetioEvent — D1 INSERT path, stubbed D1 ──────────

/**
 * Minimal stub of c.env.DB that records the last prepared SQL + bindings,
 * and lets the test simulate a row landing OR being ignored by the
 * UNIQUE constraint.
 */
function makeStubCtx(opts: { changes: number; throwOnRun?: boolean }) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const ctx = { sql, bindings: [] as unknown[] };
        const stmt = {
          bind(...args: unknown[]) {
            ctx.bindings = args;
            return stmt;
          },
          async run() {
            calls.push(ctx);
            if (opts.throwOnRun) throw new Error('D1 boom');
            return { meta: { changes: opts.changes, last_row_id: 1 }, success: true };
          },
        };
        return stmt;
      },
    },
  };
  // The helper only reads `c.env`; build the smallest Context shape that satisfies that.
  const c = { env } as unknown as Parameters<typeof emitFleetioEvent>[0];
  return { c, calls };
}

describe('emitFleetioEvent', () => {
  const baseOpts: EmitOpts = { rmpgTable: 'fleet_vehicles', rmpgId: 7, versionToken: 'tok-1' };

  it('queues a row when D1 reports changes=1', async () => {
    const { c, calls } = makeStubCtx({ changes: 1 });
    const result = await emitFleetioEvent(c, 'vehicle.update', { name: 'Patrol 12' }, baseOpts);
    expect(result.queued).toBe(true);
    expect(result.skipped_reason).toBeUndefined();
    expect(result.event_id).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT OR IGNORE INTO fleetio_events/);
    // Bindings order: event_id, resource, rmpgId, action, payload_json
    expect(calls[0].bindings).toEqual([
      result.event_id, 'vehicle', 7, 'update',
      JSON.stringify({ name: 'Patrol 12' }),
    ]);
  });

  it('reports skipped_reason=duplicate when D1 reports changes=0', async () => {
    const { c } = makeStubCtx({ changes: 0 });
    const result = await emitFleetioEvent(c, 'fuel.create', { gallons: 14.2 }, baseOpts);
    expect(result.queued).toBe(false);
    expect(result.skipped_reason).toBe('duplicate');
    expect(result.event_id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports skipped_reason=db_error and DOES NOT throw when D1 rejects', async () => {
    const { c } = makeStubCtx({ changes: 0, throwOnRun: true });
    const result = await emitFleetioEvent(c, 'vehicle.update', { name: 'X' }, baseOpts);
    expect(result.queued).toBe(false);
    expect(result.skipped_reason).toBe('db_error');
    expect(result.error_message).toBe('D1 boom');
  });

  it('produces deterministic event_id for the same (kind, opts) — dedup proof', async () => {
    const { c: cA } = makeStubCtx({ changes: 1 });
    const { c: cB } = makeStubCtx({ changes: 0 }); // 2nd call would be ignored anyway
    const r1 = await emitFleetioEvent(cA, 'vehicle.update', { a: 1 }, baseOpts);
    const r2 = await emitFleetioEvent(cB, 'vehicle.update', { a: 1 }, baseOpts);
    expect(r1.event_id).toBe(r2.event_id);
  });

  it('produces DIFFERENT event_id when versionToken changes', async () => {
    const { c: cA } = makeStubCtx({ changes: 1 });
    const { c: cB } = makeStubCtx({ changes: 1 });
    const r1 = await emitFleetioEvent(cA, 'vehicle.update', { a: 1 }, baseOpts);
    const r2 = await emitFleetioEvent(cB, 'vehicle.update', { a: 1 }, { ...baseOpts, versionToken: 'tok-2' });
    expect(r1.event_id).not.toBe(r2.event_id);
  });

  it('serializes payload via JSON.stringify (object -> JSON, null -> "null")', async () => {
    const { c, calls } = makeStubCtx({ changes: 1 });
    await emitFleetioEvent(c, 'vehicle.update', null, baseOpts);
    expect(calls[0].bindings[4]).toBe('null');

    const { c: c2, calls: c2Calls } = makeStubCtx({ changes: 1 });
    await emitFleetioEvent(c2, 'vehicle.update', { foo: 'bar' }, { ...baseOpts, versionToken: 'tok-2' });
    expect(c2Calls[0].bindings[4]).toBe('{"foo":"bar"}');
  });

  it('handles a missing payload (undefined) as JSON null', async () => {
    const { c, calls } = makeStubCtx({ changes: 1 });
    await emitFleetioEvent(c, 'vehicle.update', undefined, baseOpts);
    expect(calls[0].bindings[4]).toBe('null');
  });
});
