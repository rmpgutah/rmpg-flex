// ============================================================
// /api/dispatch/units — dispose route + batch-status live-sync
// ============================================================
// DispatchPage's unit-delete confirm (useDispatchUnitActions.handleDisposeUnit)
// POSTs /dispatch/units/:id/dispose { mode: 'delete' | 'retire' }. The Worker
// never had that route, so every unit delete from the CAD board 404'd. The
// plain DELETE /:id also refuses a unit still attached to a call (409), which
// is exactly the stuck state operators need to dispose of.
//
// batch-status (shift change) wrote to D1 without any dispatch_update, so
// peer boards showed stale unit statuses until the next poll.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import units from '../src/routes/dispatch/units';
import type { Env } from '../src/types';
import { recordingDb } from './helpers/fakeD1';

const emitAlertSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/utils/alertHub', () => ({ emitAlert: emitAlertSpy }));

function buildApp(db: D1Database, role = 'admin') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, username: 'tester', role, full_name: 'Test User' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/dispatch/units', units);
  return (path: string, init?: RequestInit) => app.request(path, init, { DB: db, JWT_SECRET: 'test' });
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('POST /api/dispatch/units/:id/dispose', () => {
  beforeEach(() => emitAlertSpy.mockClear());

  it('404s for an unknown unit', async () => {
    const { db } = recordingDb([]);
    const res = await buildApp(db)('/api/dispatch/units/42/dispose', json({ mode: 'delete' }));
    expect(res.status).toBe(404);
  });

  it('400s on an invalid mode', async () => {
    const { db } = recordingDb([
      { match: /SELECT id, call_sign, current_call_id FROM units WHERE id = \?/, rows: [{ id: 7, call_sign: 'D190', current_call_id: null }] },
    ]);
    const res = await buildApp(db)('/api/dispatch/units/7/dispose', json({ mode: 'vaporise' }));
    expect(res.status).toBe(400);
  });

  it('403s for roles below manager', async () => {
    const { db } = recordingDb([]);
    const res = await buildApp(db, 'dispatcher')('/api/dispatch/units/7/dispose', json({ mode: 'delete' }));
    expect(res.status).toBe(403);
  });

  it('mode=delete force-clears the call assignment, unlinks vehicle/officer, deletes, and broadcasts unit_deleted', async () => {
    const { db, calls } = recordingDb([
      { match: /SELECT id, call_sign, current_call_id FROM units WHERE id = \?/, rows: [{ id: 7, call_sign: 'D190', current_call_id: 55 }] },
      { match: /SELECT assigned_unit_ids, unit_call_signs, status FROM calls_for_service WHERE id = \?/, rows: [{ assigned_unit_ids: '[7,8]', unit_call_signs: '["D190","D191"]', status: 'dispatched' }] },
      { match: /SELECT \* FROM calls_for_service WHERE id = \?/, rows: [{ id: 55, status: 'dispatched', assigned_unit_ids: '[8]' }] },
    ]);
    const res = await buildApp(db)('/api/dispatch/units/7/dispose', json({ mode: 'delete' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 7, mode: 'delete', cleared_call_id: 55 });

    const sqls = calls.map((c) => c.sql.replace(/\s+/g, ' '));
    const cfs = calls.find((c) => /UPDATE calls_for_service SET assigned_unit_ids/.test(c.sql));
    expect(cfs, 'unit removed from its call').toBeTruthy();
    expect(cfs!.args[0]).toBe('[8]');
    expect(cfs!.args[1]).toBe('["D191"]');
    expect(cfs!.sql, 'another unit remains → call status untouched').not.toMatch(/status = 'pending'/);
    // The call still has a responder, so peers get a call_updated for the roster change.
    const callUpdates = emitAlertSpy.mock.calls.filter(([, , p]) => (p as { action: string }).action === 'call_updated');
    expect(callUpdates).toHaveLength(1);
    expect(sqls.some((s) => /UPDATE fleet_assignments SET unassigned_at/.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE fleet_vehicles SET assigned_unit_id = NULL/.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE users SET assigned_unit_id = NULL/.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM units WHERE id = \?/.test(s))).toBe(true);

    const deleted = emitAlertSpy.mock.calls.filter(([, , p]) => (p as { action: string }).action === 'unit_deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0][1]).toBe('dispatch_update');
    expect(deleted[0][2]).toMatchObject({ action: 'unit_deleted', unit_id: 7, call_id: 55 });
  });

  it('disposing the only responder drops the call back to pending so it re-queues', async () => {
    const { db, calls } = recordingDb([
      { match: /SELECT id, call_sign, current_call_id FROM units WHERE id = \?/, rows: [{ id: 7, call_sign: 'D190', current_call_id: 56 }] },
      { match: /SELECT assigned_unit_ids, unit_call_signs, status FROM calls_for_service WHERE id = \?/, rows: [{ assigned_unit_ids: '[7]', unit_call_signs: '["D190"]', status: 'enroute' }] },
      { match: /SELECT \* FROM calls_for_service WHERE id = \?/, rows: [{ id: 56, status: 'pending', assigned_unit_ids: '[]' }] },
      { match: /SELECT \* FROM units WHERE id = \?/, rows: [{ id: 7, status: 'out_of_service' }] },
    ]);
    const res = await buildApp(db)('/api/dispatch/units/7/dispose', json({ mode: 'retire' }));
    expect(res.status).toBe(200);
    const cfs = calls.find((c) => /UPDATE calls_for_service SET assigned_unit_ids/.test(c.sql))!;
    expect(cfs.sql).toMatch(/status = 'pending'/);
    expect(cfs.args).toEqual(['[]', '[]', 'enroute', 56]);
    const callUpdates = emitAlertSpy.mock.calls.filter(([, , p]) => (p as { action: string }).action === 'call_updated');
    expect(callUpdates).toHaveLength(1);
    expect((callUpdates[0][2] as { call: { status: string } }).call.status).toBe('pending');
  });

  it('mode=retire keeps the row, sets out_of_service with the call detached, and broadcasts unit_status_changed', async () => {
    const { db, calls } = recordingDb([
      { match: /SELECT id, call_sign, current_call_id FROM units WHERE id = \?/, rows: [{ id: 7, call_sign: 'D190', current_call_id: null }] },
      { match: /SELECT \* FROM units WHERE id = \?/, rows: [{ id: 7, call_sign: 'D190', status: 'out_of_service' }] },
    ]);
    const res = await buildApp(db)('/api/dispatch/units/7/dispose', json({ mode: 'retire' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 7, mode: 'retire', unit: { status: 'out_of_service' } });

    const sqls = calls.map((c) => c.sql.replace(/\s+/g, ' '));
    expect(sqls.some((s) => /DELETE FROM units/.test(s))).toBe(false);
    const upd = sqls.find((s) => /UPDATE units SET status = 'out_of_service'/.test(s));
    expect(upd).toBeTruthy();
    expect(upd).toMatch(/current_call_id = NULL/);
    expect(upd).toMatch(/officer_id = NULL/);

    expect(emitAlertSpy).toHaveBeenCalledTimes(1);
    const [, type, payload] = emitAlertSpy.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(type).toBe('dispatch_update');
    expect(payload).toMatchObject({ action: 'unit_status_changed', unit: { id: 7, status: 'out_of_service' } });
  });
});

describe('unit status enum matches the live CHECK constraint', () => {
  // units.status CHECK (baseline schema) has no 'on_patrol'; advertising it
  // made the UPDATE fail the constraint and surface as a 500.
  it('PUT /:id/status rejects on_patrol with 400, not 500', async () => {
    const { db } = recordingDb([{ match: /SELECT officer_id FROM units WHERE id = \?/, rows: [{ officer_id: 1 }] }]);
    const res = await buildApp(db)('/api/dispatch/units/1/status', { ...json({ status: 'on_patrol' }), method: 'PUT' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('POST /batch-status rejects on_patrol with 400', async () => {
    const { db } = recordingDb([]);
    const res = await buildApp(db)('/api/dispatch/units/batch-status', json({ unit_ids: [1], status: 'on_patrol' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/dispatch/units/batch-status broadcasts', () => {
  beforeEach(() => emitAlertSpy.mockClear());

  it('emits one dispatch_update { action: "units_batch_status_changed" } with the ids and status', async () => {
    const { db } = recordingDb([]);
    const res = await buildApp(db, 'supervisor')('/api/dispatch/units/batch-status', json({ unit_ids: [1, 2, 3], status: 'off_duty' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 3, total: 3 });
    expect(emitAlertSpy).toHaveBeenCalledTimes(1);
    const [, type, payload] = emitAlertSpy.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(type).toBe('dispatch_update');
    expect(payload).toEqual({ action: 'units_batch_status_changed', unit_ids: [1, 2, 3], status: 'off_duty', updated: 3 });
  });

  it('does not broadcast when the request is rejected', async () => {
    const { db } = recordingDb([]);
    const res = await buildApp(db, 'supervisor')('/api/dispatch/units/batch-status', json({ unit_ids: [], status: 'off_duty' }));
    expect(res.status).toBe(400);
    expect(emitAlertSpy).not.toHaveBeenCalled();
  });
});
